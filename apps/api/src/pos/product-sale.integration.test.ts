import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { LOYALTY_EVENT_TYPES, processLoyaltyEvent } from '@lucy-spa/server';
import { DiscountService } from '../discounts/discount.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { customerInvoiceDetail } from './customer-invoice.core.js';

/**
 * Phase 6 P6-8 against real PostgreSQL (design 4.5, 5, T15, T20, T33): product lines on a visit invoice and on a product-only
 * invoice, the seller on every line, the price chosen by the server, the stock reserved by the finalization and released by the
 * cancellation, no oversell, and a service-only invoice that behaves exactly as before. After every command the deferred database
 * checks run (`ok`), and each test ends with the reconciliation of the whole fixture. Every fixture rolls back.
 */
test(
  'Phase 6 P6-8 product lines, seller, reservation, channel and fee; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { invoices, people, A, B } = k;
      // Catalog: a two-variant cream (50 ml, 100 ml), a single-variant serum, a draft product, a variant never received.
      const cream = await k.product('cream', [200_000, 350_000]);
      const [v50, v100] = cream.variants as [
        (typeof cream.variants)[number],
        (typeof cream.variants)[number],
      ];
      const serum = await k.product('serum', [120_000]);
      const sv = serum.variants[0]!;
      const unreleased = await k.product('draft', [90_000], { publish: false });
      const neverReceived = await k.product('never', [60_000]);
      await k.receive(v50.id, 5);
      await k.receive(v100.id, 10);
      await k.receive(sv.id, 3);
      const member = await k.customer('member');

      await suite.test(
        'authority: SELL_PRODUCTS at the branch opens and edits a draft; finalizing needs MANAGE_INVOICES',
        async () => {
          await fails(() => invoices.openProductSale(people.nobody.token, A.id, {}), 'FORBIDDEN');
          await fails(
            () => invoices.openProductSale(people.otherBranch.token, A.id, {}),
            'FORBIDDEN',
          );
          await fails(
            () => invoices.openProductSale(people.plainCashier.token, A.id, {}),
            'FORBIDDEN',
          );
          await fails(
            () => invoices.openProductSale(people.ktv.token, randomUUID(), {}),
            'NOT_FOUND',
          );
          await fails(
            () => invoices.openProductSale(people.ktv.token, A.id, { payerUserId: people.ktv.id }),
            'VALIDATION_FAILED',
            'payerUserId',
          );
          await fails(
            () => invoices.openProductSale(people.ktv.token, A.id, { payerUserId: 'not-a-uuid' }),
            'VALIDATION_FAILED',
            'payerUserId',
          );
          const draft = await k.openSale(people.ktv);
          assert.equal(draft.kind, 'PRODUCT_SALE');
          assert.equal(draft.status, 'DRAFT');
          assert.equal(draft.visit, null);
          assert.equal(draft.channel, 'COUNTER');
          assert.equal(draft.shippingFeeVnd, '0');
          assert.equal(draft.calculationVersion, 2);
          assert.deepEqual(draft.productLines, []);
          assert.equal(draft.actions.sellProducts, true);
          assert.equal(draft.actions.finalize, false);
          assert.equal(draft.readiness.ready, false);
          // A KTV sells but does not finalize; a cashier who cannot sell does not add lines.
          const withLine = await k.addLine(draft, v50.id, 1, undefined, people.ktv);
          await fails(
            () =>
              invoices.finalize(people.ktv.token, withLine.id, {
                expectedVersion: withLine.version,
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              invoices.addProductLine(people.plainCashier.token, withLine.id, {
                expectedVersion: withLine.version,
                variantId: v50.id,
                quantity: 1,
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              invoices.addProductLine(people.otherBranch.token, withLine.id, {
                expectedVersion: withLine.version,
                variantId: v50.id,
                quantity: 1,
              }),
            'FORBIDDEN',
          );
          // A product sale does not depend on loyalty being live.
          assert.equal(await tx.loyaltyGoLive.count(), 0);
          await k.reconcile();
        },
      );

      await suite.test(
        'the draft: the server prices, the seller is required, lines merge by variant and seller, edits recompute the header',
        async () => {
          const draft = await k.openSale(people.cashier);
          // The caller is an active employee of the branch: the default seller. The Owner is not: the seller must be named.
          const one = await k.addLine(draft, v50.id, 2);
          assert.equal(one.productLines.length, 1);
          const line = one.productLines[0]!;
          assert.equal(line.seller!.id, people.cashier.id);
          assert.equal(line.unitPriceVnd, '200000');
          assert.equal(line.grossVnd, '400000');
          assert.equal(line.listPriceVnd, '200000');
          assert.equal(line.onPromotion, false);
          assert.equal(line.sku, v50.sku);
          assert.equal(line.nameVi, 'Sản phẩm cream - Loại 1');
          assert.equal(line.reservation, null);
          assert.equal(one.subtotalVnd, '400000');
          assert.equal(one.totalVnd, '400000');
          assert.equal(one.discountTotalVnd, '0');
          assert.equal(one.version, draft.version + 1);
          assert.equal(one.readiness.ready, true);
          await fails(
            () =>
              invoices.addProductLine(people.owner.token, one.id, {
                expectedVersion: one.version,
                variantId: v50.id,
                quantity: 1,
              }),
            'PRODUCT_SELLER_REQUIRED',
          );
          // Same variant, same seller: one line grows. Another seller: another line (a mixed-seller invoice).
          const grown = await k.addLine(one, v50.id, 1);
          assert.equal(grown.productLines.length, 1);
          assert.equal(grown.productLines[0]!.quantity, 3);
          assert.equal(grown.subtotalVnd, '600000');
          const second = await k.addLine(grown, v50.id, 1, people.ktv.id);
          assert.equal(second.productLines.length, 2);
          assert.deepEqual(
            second.productLines.map((entry) => [entry.quantity, entry.seller!.id]),
            [
              [3, people.cashier.id],
              [1, people.ktv.id],
            ],
          );
          assert.equal(second.subtotalVnd, '800000');
          // The Owner names the seller; the seller must be an active employee assigned to THIS branch.
          const ownerSold = await k.addLine(second, sv.id, 1, people.ktv.id, people.owner);
          assert.equal(ownerSold.productLines.at(-1)!.seller!.id, people.ktv.id);
          for (const sellerUserId of [
            people.otherBranch.id,
            member.id,
            people.nobody.id,
            randomUUID(),
          ]) {
            await fails(
              () =>
                invoices.addProductLine(people.cashier.token, ownerSold.id, {
                  expectedVersion: ownerSold.version,
                  variantId: v50.id,
                  quantity: 1,
                  sellerUserId,
                }),
              'PRODUCT_SELLER_INVALID',
            );
          }
          // Change quantity and seller; a no-op changes nothing.
          const target = ownerSold.productLines[1]!;
          const changed = await k.ok(() =>
            invoices.updateProductLine(people.cashier.token, ownerSold.id, target.id, {
              expectedVersion: ownerSold.version,
              quantity: 2,
              sellerUserId: people.cashier.id,
            }),
          );
          assert.equal(changed.productLines[1]!.quantity, 2);
          assert.equal(changed.productLines[1]!.seller!.id, people.cashier.id);
          assert.equal(changed.subtotalVnd, String(3 * 200_000 + 2 * 200_000 + 120_000));
          const same = await invoices.updateProductLine(
            people.cashier.token,
            changed.id,
            target.id,
            {
              expectedVersion: changed.version,
              quantity: 2,
            },
          );
          assert.equal(same.version, changed.version, 'a repeated choice writes nothing');
          // Remove: the line and its detail are deleted from the draft; the header follows; the audit log keeps the record.
          const removed = await k.ok(() =>
            invoices.removeProductLine(people.cashier.token, changed.id, target.id, {
              expectedVersion: changed.version,
            }),
          );
          assert.equal(removed.productLines.length, 2);
          assert.equal(removed.subtotalVnd, String(3 * 200_000 + 120_000));
          assert.equal(await tx.invoiceLine.count({ where: { id: target.id } }), 0);
          assert.equal(
            await tx.invoiceLineProduct.count({ where: { invoiceLineId: target.id } }),
            0,
          );
          const trail = await tx.auditEvent.findMany({
            where: { entityId: removed.id },
            orderBy: { occurredAt: 'asc' },
          });
          assert.deepEqual(
            trail.map((entry) => entry.action),
            [
              'INVOICE_CREATED',
              'INVOICE_PRODUCT_LINE_ADDED',
              'INVOICE_PRODUCT_LINE_ADDED',
              'INVOICE_PRODUCT_LINE_ADDED',
              'INVOICE_PRODUCT_LINE_ADDED',
              'INVOICE_PRODUCT_LINE_UPDATED',
              'INVOICE_PRODUCT_LINE_REMOVED',
            ],
          );
          assert.ok(trail.every((entry) => entry.dataClassification === 'FINANCIAL'));
          // Nobody can set a price on a product line: there is no field, and the staff price command refuses a product line.
          await fails(
            () =>
              invoices.setPrice(people.cashier.token, removed.id, removed.productLines[0]!.id, {
                expectedVersion: removed.version,
                unitPriceVnd: '1',
              }),
            'NOT_FOUND',
          );
          // Validation and stale versions.
          for (const quantity of [0, -1, 1.5, 1001, Number.NaN]) {
            await fails(
              () =>
                invoices.addProductLine(people.cashier.token, removed.id, {
                  expectedVersion: removed.version,
                  variantId: v50.id,
                  quantity,
                }),
              'VALIDATION_FAILED',
              'quantity',
            );
          }
          await fails(
            () =>
              invoices.addProductLine(people.cashier.token, removed.id, {
                expectedVersion: removed.version,
                variantId: 'nope',
                quantity: 1,
              }),
            'VALIDATION_FAILED',
            'variantId',
          );
          await fails(
            () =>
              invoices.addProductLine(people.cashier.token, removed.id, {
                expectedVersion: removed.version - 1,
                variantId: v50.id,
                quantity: 1,
              }),
            'CONFLICT',
          );
          // Not sellable: a draft product, an unknown variant, an inactive variant.
          const inactive = await k.product('retired', [70_000, 80_000]);
          await tx.productVariant.update({
            where: { id: inactive.variants[1]!.id },
            data: { isActive: false, rowVersion: { increment: 1 } },
          });
          for (const variantId of [
            unreleased.variants[0]!.id,
            randomUUID(),
            inactive.variants[1]!.id,
          ]) {
            await fails(
              () =>
                invoices.addProductLine(people.cashier.token, removed.id, {
                  expectedVersion: removed.version,
                  variantId,
                  quantity: 1,
                }),
              'PRODUCT_NOT_SELLABLE',
              'variantId',
            );
          }
          // Product lines can be added to a combo sale? No: only a visit or a product sale takes them.
          await k.reconcile();
        },
      );

      await suite.test(
        'prices follow the catalog while the draft changes: a promotion applies, a new list price is picked up, the finalization freezes it',
        async () => {
          const promo = await k.promote(sv.id, 100_000);
          const draft = await k.openSale(people.cashier);
          const withSerum = await k.addLine(draft, sv.id, 1);
          assert.equal(withSerum.productLines[0]!.unitPriceVnd, '100000');
          assert.equal(withSerum.productLines[0]!.listPriceVnd, '120000');
          assert.equal(withSerum.productLines[0]!.onPromotion, true);
          // A new list price for the 100 ml cream appears at the next edit of the draft ("re-resolves on every calculation").
          const withCream = await k.addLine(withSerum, v100.id, 2);
          assert.equal(withCream.productLines[1]!.unitPriceVnd, '350000');
          await k.reprice(v100.id, 360_000);
          const touched = await k.addLine(withCream, sv.id, 1);
          assert.equal(touched.productLines[0]!.quantity, 2);
          assert.equal(touched.productLines[1]!.unitPriceVnd, '360000', 'repriced at the edit');
          assert.equal(touched.subtotalVnd, String(2 * 100_000 + 2 * 360_000));
          // The price changes once more between the last edit and the finalization: the invoice is frozen at the final price.
          await k.reprice(v100.id, 370_000);
          const done = await k.finalize(touched);
          assert.equal(done.status, 'PENDING_PAYMENT');
          assert.equal(done.productLines[1]!.unitPriceVnd, '370000');
          assert.equal(done.subtotalVnd, String(2 * 100_000 + 2 * 370_000));
          assert.equal(done.totalVnd, done.subtotalVnd);
          const frozenAt = done.finalizedAt!;
          assert.equal(
            done.productLines[1]!.pricedAt,
            frozenAt,
            'the price instant IS the finalization instant',
          );
          // Later changes of the catalog never touch a finalized invoice.
          await k.reprice(v100.id, 500_000);
          await tx.productPromotion.update({
            where: { id: promo.id },
            data: { endedEarlyAt: new Date(), endedEarlyByUserId: people.cashier.id },
          });
          const reread = await invoices.get(people.cashier.token, done.id);
          assert.deepEqual(
            reread.productLines.map((line) => line.unitPriceVnd),
            ['100000', '370000'],
          );
          await k.reconcile();
        },
      );

      await suite.test(
        'finalization reserves every product line (T15), once; availability, levels and the replay agree',
        async () => {
          const before50 = await k.levelOf(v50.id);
          const before100 = await k.levelOf(v100.id);
          const draft = await k.openSale(people.cashier, member.id);
          const lined = await k.addLine(
            await k.addLine(draft, v50.id, 2),
            v100.id,
            3,
            people.ktv.id,
          );
          const done = await k.finalize(lined);
          assert.equal(done.status, 'PENDING_PAYMENT');
          assert.equal(done.payer?.id, member.id);
          assert.deepEqual(
            done.productLines.map((line) => line.reservation),
            [
              { status: 'RESERVED', quantity: 2 },
              { status: 'RESERVED', quantity: 3 },
            ],
          );
          assert.equal((await k.levelOf(v50.id))!.reserved, before50!.reserved + 2);
          assert.equal((await k.levelOf(v100.id))!.reserved, before100!.reserved + 3);
          assert.equal(
            (await k.levelOf(v50.id))!.onHand,
            before50!.onHand,
            'stock is held, not sold',
          );
          assert.equal(await k.availableOf(v50.id), before50!.onHand - before50!.reserved - 2);
          // Replaying the same finalization is quiet: no second reservation, audit or event.
          const events = await tx.outboxEvent.count({ where: { aggregateId: done.id } });
          const again = await invoices.finalize(people.cashier.token, done.id, {
            expectedVersion: lined.version,
          });
          assert.equal(again.version, done.version);
          assert.equal(await tx.stockReservation.count({ where: { invoiceId: done.id } }), 2);
          assert.equal(await tx.outboxEvent.count({ where: { aggregateId: done.id } }), events);
          // A finalized invoice no longer takes lines.
          await fails(
            () =>
              invoices.addProductLine(people.cashier.token, done.id, {
                expectedVersion: done.version,
                variantId: v50.id,
                quantity: 1,
              }),
            'INVOICE_STATE_INVALID',
          );
          // The finalization events and the audit entry carry the facts of a service-only invoice, plus the reservation count.
          const finalized = await tx.auditEvent.findFirstOrThrow({
            where: { entityId: done.id, action: 'INVOICE_FINALIZED' },
          });
          assert.equal(Reflect.get(Object(finalized.after), 'stockReservations'), 2);
          await k.reconcile();
        },
      );

      await suite.test(
        'no oversell: a short line refuses the WHOLE finalization and writes nothing; an unreceived variant is out of stock',
        async () => {
          const level = await k.levelOf(sv.id);
          const room = level!.onHand - level!.reserved;
          const draft = await k.openSale(people.cashier);
          const greedy = await k.addLine(await k.addLine(draft, v50.id, 1), sv.id, room + 1);
          const rowsBefore = await tx.stockReservation.count();
          await fails(
            () =>
              invoices.finalize(people.cashier.token, greedy.id, {
                expectedVersion: greedy.version,
              }),
            'PRODUCT_OUT_OF_STOCK',
            greedy.productLines[1]!.id,
          );
          assert.equal(
            await tx.stockReservation.count(),
            rowsBefore,
            'nothing is reserved when one line is short',
          );
          const unchanged = await invoices.get(people.cashier.token, greedy.id);
          assert.equal(unchanged.status, 'DRAFT');
          assert.equal(unchanged.version, greedy.version);
          assert.equal((await k.levelOf(sv.id))!.reserved, level!.reserved);
          // Sums per variant count across lines: two lines of one variant that together exceed the stock.
          const split = await k.addLine(await k.openSale(people.cashier), sv.id, room);
          const twice = await k.addLine(split, sv.id, 1, people.ktv.id);
          await fails(
            () =>
              invoices.finalize(people.cashier.token, twice.id, { expectedVersion: twice.version }),
            'PRODUCT_OUT_OF_STOCK',
          );
          // The line that fits is fine, and exactly the remaining stock can be taken (the last unit).
          const fitting = await k.addLine(await k.openSale(people.cashier), sv.id, room);
          const fits = await k.finalize(fitting);
          assert.equal(fits.status, 'PENDING_PAYMENT');
          assert.equal(await k.availableOf(sv.id), 0);
          const late = await k.addLine(await k.openSale(people.cashier), sv.id, 1);
          await fails(
            () =>
              invoices.finalize(people.cashier.token, late.id, { expectedVersion: late.version }),
            'PRODUCT_OUT_OF_STOCK',
            late.productLines[0]!.id,
          );
          // A variant that was never received has no stock row at all: out of stock, never an error.
          const ghost = await k.addLine(
            await k.openSale(people.cashier),
            neverReceived.variants[0]!.id,
            1,
          );
          await fails(
            () =>
              invoices.finalize(people.cashier.token, ghost.id, { expectedVersion: ghost.version }),
            'PRODUCT_OUT_OF_STOCK',
            ghost.productLines[0]!.id,
          );
          // A product withdrawn, or a seller who left the branch, between the draft and the finalization.
          const sold = await k.product('withdrawn', [55_000]);
          await k.receive(sold.variants[0]!.id, 4);
          const withdrawn = await k.addLine(
            await k.openSale(people.cashier),
            sold.variants[0]!.id,
            1,
          );
          await tx.product.update({
            where: { id: sold.id },
            data: { status: 'INACTIVE', rowVersion: { increment: 1 } },
          });
          await fails(
            () =>
              invoices.finalize(people.cashier.token, withdrawn.id, {
                expectedVersion: withdrawn.version,
              }),
            'PRODUCT_NOT_SELLABLE',
            withdrawn.productLines[0]!.id,
          );
          const leaver = await base.staff(['SELL_PRODUCTS'], { branchId: A.id });
          const left = await k.addLine(await k.openSale(people.cashier), v50.id, 1, leaver.id);
          await tx.employeeBranchAssignment.updateMany({
            where: { employeeUserId: leaver.id },
            data: { revokedAt: new Date() },
          });
          await fails(
            () =>
              invoices.finalize(people.cashier.token, left.id, { expectedVersion: left.version }),
            'PRODUCT_SELLER_INVALID',
            left.productLines[0]!.id,
          );
          await k.reconcile();
        },
      );

      await suite.test(
        'cancelling releases the stock in the same transaction; a draft holds none; payment and reversal leave the hold in place',
        async () => {
          // A draft cancelled: nothing was ever held.
          const draft = await k.addLine(await k.openSale(people.cashier), v100.id, 1);
          const dropped = await k.ok(() =>
            invoices.cancel(people.boss.token, draft.id, {
              expectedVersion: draft.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.equal(dropped.status, 'CANCELLED');
          assert.equal(await tx.stockReservation.count({ where: { invoiceId: draft.id } }), 0);
          // A finalized unpaid invoice cancelled: released once, level back.
          const reservedBefore = (await k.levelOf(v100.id))!.reserved;
          const unpaid = await k.finalize(
            await k.addLine(await k.openSale(people.cashier), v100.id, 2),
          );
          assert.equal((await k.levelOf(v100.id))!.reserved, reservedBefore + 2);
          const cancelled = await k.ok(() =>
            invoices.cancel(people.boss.token, unpaid.id, {
              expectedVersion: unpaid.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.equal(cancelled.status, 'CANCELLED');
          assert.deepEqual(
            cancelled.productLines.map((line) => line.reservation?.status),
            ['RELEASED'],
          );
          assert.equal((await k.levelOf(v100.id))!.reserved, reservedBefore);
          const stored = await tx.stockReservation.findFirstOrThrow({
            where: { invoiceId: unpaid.id },
          });
          assert.equal(stored.releasedByUserId, people.boss.id);
          assert.equal(stored.releaseCause, 'INVOICE_CANCELLED_UNPAID');
          assert.ok(stored.releasedAt);
          const cancelAudit = await tx.auditEvent.findFirstOrThrow({
            where: { entityId: unpaid.id, action: 'INVOICE_CANCELLED' },
          });
          assert.equal(Reflect.get(Object(cancelAudit.after), 'stockReservationsReleased'), 1);
          // Repeating the cancellation is quiet (no second release).
          const replay = await invoices.cancel(people.boss.token, unpaid.id, {
            expectedVersion: unpaid.version,
            reason: 'Khách đổi ý',
          });
          assert.equal(replay.status, 'CANCELLED');
          assert.equal(
            await tx.stockReservation.count({
              where: { invoiceId: unpaid.id, status: 'RELEASED' },
            }),
            1,
          );
          // Paid: the money is collected, the hold stays (consumption is the point-of-sale Step), a reversal returns to unpaid and
          // the invoice can then be cancelled, which releases the stock.
          const open = await k.finalize(
            await k.addLine(await k.openSale(people.cashier), v100.id, 1),
          );
          const total = Number(open.totalVnd);
          const paid = await k.pay(open.id, total);
          assert.equal(paid.invoice.status, 'PAID');
          const afterPay = await invoices.get(people.cashier.token, open.id);
          assert.deepEqual(
            afterPay.productLines.map((line) => line.reservation?.status),
            ['RESERVED'],
          );
          assert.equal((await k.levelOf(v100.id))!.reserved, reservedBefore + 1);
          await fails(
            () =>
              invoices.cancel(people.boss.token, open.id, {
                expectedVersion: paid.invoice.version,
                reason: 'x',
              }),
            'INVOICE_CANCEL_NOT_ALLOWED',
          );
          const reversed = await k.ok(() =>
            invoices.reversePayment(people.boss.token, open.id, paid.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          assert.equal(reversed.invoice.status, 'PENDING_PAYMENT');
          const afterReversal = await invoices.get(people.cashier.token, open.id);
          assert.deepEqual(
            afterReversal.productLines.map((line) => line.reservation?.status),
            ['RESERVED'],
          );
          const final = await k.ok(() =>
            invoices.cancel(people.boss.token, open.id, {
              expectedVersion: reversed.invoice.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.deepEqual(
            final.productLines.map((line) => line.reservation?.status),
            ['RELEASED'],
          );
          assert.equal((await k.levelOf(v100.id))!.reserved, reservedBefore);
          await k.reconcile();
        },
      );

      await suite.test(
        'stock cannot be taken from under a reservation: adjustments and counts are refused cleanly (T13)',
        async () => {
          const level = await k.levelOf(v50.id);
          const held = level!.reserved;
          assert.ok(held > 0, 'earlier tests left reservations on the 50 ml cream');
          const lot = await tx.inventoryLot.findFirstOrThrow({
            where: { branchId: A.id, variantId: v50.id, quantityOnHand: { gt: 0 } },
          });
          // Taking more than the free stock (on hand - reserved) is refused; taking the free part is allowed.
          const free = level!.onHand - held;
          await fails(
            () =>
              k.inventory.adjust(people.receiver.token, {
                requestKey: randomUUID(),
                branchId: A.id,
                variantId: v50.id,
                lotId: lot.id,
                quantity: free + 1,
                reason: 'LOSS',
                note: null,
              }),
            'INVENTORY_STOCK_RESERVED',
            'quantity',
          );
          await k.inventory.adjust(people.receiver.token, {
            requestKey: randomUUID(),
            branchId: A.id,
            variantId: v50.id,
            lotId: lot.id,
            quantity: free,
            reason: 'LOSS',
            note: null,
          });
          assert.deepEqual(await k.levelOf(v50.id), { onHand: held, reserved: held });
          const count = await k.inventory.createCount(people.receiver.token, {
            branchId: A.id,
            notes: null,
            variantIds: [v50.id],
          });
          const lined = await k.inventory.setCountLines(people.receiver.token, count.id, {
            expectedRowVersion: count.rowVersion,
            lines: [{ variantId: v50.id, countedQuantity: held - 1 }],
            removeVariantIds: [],
          });
          await fails(
            () =>
              k.inventory.approveCount(people.receiver.token, count.id, {
                expectedRowVersion: lined.rowVersion,
              }),
            'INVENTORY_STOCK_RESERVED',
            'countedQuantity',
          );
          assert.deepEqual(await k.levelOf(v50.id), { onHand: held, reserved: held });
          await k.reconcile();
        },
      );

      await suite.test(
        'a visit invoice may hold services AND products: the Spa side is priced exactly as a service-only twin, products are not discounted',
        async () => {
          await k.receive(v50.id, 20);
          await k.receive(v100.id, 20);
          const owner = await k.customer('payer');
          const programs = new DiscountService(base.adapter, base.throttle);
          const created = await programs.create(people.owner.token, {
            code: `P68${base.run}`.slice(0, 20),
            nameVi: 'Giảm 10%',
            nameEn: '10% off',
            requiresCode: true,
            version: {
              kind: 'PERCENT',
              percentBp: 1000,
              validFrom: new Date(Date.now() - 86_400_000).toISOString(),
              validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
              minSpendVnd: '0',
              scopeMode: 'ALL_SERVICES',
              serviceIds: [],
              categoryIds: [],
              usageLimitTotal: null,
              usageLimitPerCustomer: null,
            },
          });
          const code = `V68${base.run}`.slice(0, 20);
          await programs.createVoucher(people.owner.token, created.id, { code });
          const withVoucher = async (invoice: Awaited<ReturnType<typeof k.serviceDraft>>) =>
            k.ok(() =>
              invoices.supplyVoucher(people.cashier.token, invoice.id, {
                expectedVersion: invoice.version,
                code,
              }),
            );
          const twin = await withVoucher(await k.serviceDraft([k.exact, k.ranged], owner.id));
          const mixedBase = await k.serviceDraft([k.exact, k.ranged], owner.id);
          // The cashier adds a product to the visit invoice (VISIT drafts take product lines).
          const lined = await k.addLine(mixedBase, v50.id, 2);
          assert.equal(lined.kind, 'VISIT');
          assert.equal(lined.lines.length, 2);
          assert.equal(lined.productLines.length, 1);
          const mixed = await withVoucher(lined);
          // The Spa side is the twin's: same benefit, same discount; the product adds its gross to subtotal and total, undiscounted.
          assert.equal(mixed.discount.winner?.discountId, twin.discount.winner?.discountId);
          assert.equal(mixed.discountTotalVnd, twin.discountTotalVnd);
          assert.equal(BigInt(twin.discountTotalVnd) > 0n, true);
          assert.equal(mixed.subtotalVnd, String(BigInt(twin.subtotalVnd) + 400_000n));
          assert.equal(mixed.totalVnd, String(BigInt(twin.totalVnd) + 400_000n));
          const twinDone = await k.finalize(twin);
          const mixedDone = await k.finalize(mixed);
          assert.equal(mixedDone.discountTotalVnd, twinDone.discountTotalVnd);
          assert.equal(mixedDone.totalVnd, String(BigInt(twinDone.totalVnd) + 400_000n));
          assert.equal(mixedDone.productLines[0]!.unitPriceVnd, '200000');
          assert.deepEqual(
            mixedDone.productLines.map((line) => line.reservation?.status),
            ['RESERVED'],
          );
          // The twin is a service-only invoice: nothing new on it, no stock, as before Wave 2.
          assert.deepEqual(twinDone.productLines, []);
          assert.equal(twinDone.channel, 'COUNTER');
          assert.equal(twinDone.shippingFeeVnd, '0');
          assert.equal(await tx.stockReservation.count({ where: { invoiceId: twinDone.id } }), 0);
          // Both redeemed the voucher once each; the application/snapshot tables are the Phase 4/5 ones.
          for (const id of [twinDone.id, mixedDone.id]) {
            assert.equal(await tx.discountRedemption.count({ where: { invoiceId: id } }), 1);
            assert.equal(
              await tx.invoiceDiscountApplication.count({ where: { invoiceId: id } }),
              1,
            );
          }
          // A service line is untouched by the product line in the response.
          assert.deepEqual(
            mixedDone.lines.map((line) => [line.itemCode, line.unitPriceVnd, line.grossVnd]),
            twinDone.lines.map((line) => [line.itemCode, line.unitPriceVnd, line.grossVnd]),
          );
          // Cancelling the mixed invoice releases its stock and returns the voucher, exactly once each.
          const held = (await k.levelOf(v50.id))!.reserved;
          const gone = await k.ok(() =>
            invoices.cancel(people.boss.token, mixedDone.id, {
              expectedVersion: mixedDone.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.equal(gone.status, 'CANCELLED');
          assert.equal((await k.levelOf(v50.id))!.reserved, held - 2);
          assert.equal(
            await tx.discountRedemptionRelease.count({
              where: { redemption: { invoiceId: mixedDone.id } },
            }),
            1,
          );
          await k.reconcile();
        },
      );

      await suite.test(
        'loyalty: the Spa wallet earns on the SPA side only and the Beauty wallet on the product side only (P6-11)',
        async () => {
          await k.receive(v50.id, 20);
          await k.receive(v100.id, 20);
          await tx.loyaltyGoLive.create({ data: { activatedByUserId: people.owner.id } });
          const payer = await k.customer('loyal');
          const spaDraft = await k.serviceDraft([k.exact], payer.id);
          const mixedDraft = await k.addLine(await k.serviceDraft([k.exact], payer.id), v100.id, 1);
          const productOnly = await k.addLine(
            await k.openSale(people.cashier, payer.id),
            v100.id,
            1,
          );
          const consume = async (invoiceId: string) => {
            const outcomes: string[] = [];
            const events = await tx.outboxEvent.findMany({
              where: { aggregateId: invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
              orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            });
            for (const event of events) {
              outcomes.push(await processLoyaltyEvent(tx, event.id));
              await k.settle();
            }
            return outcomes;
          };
          const earned = async (invoiceId: string, wallet: 'SPA' | 'BEAUTY') =>
            (
              await tx.loyaltyLedgerEntry.aggregate({
                where: { invoiceId, kind: 'EARN', wallet },
                _sum: { points: true },
              })
            )._sum.points ?? 0;
          // A member without points has no tier discount, so each side is paid its gross: Spa 200,000, products 500,000 (the 100 ml cream
          // was repriced to 500,000 by the price tests above).
          for (const [draft, spaPoints, beautyPoints] of [
            [spaDraft, 200, 0],
            [mixedDraft, 200, 500],
            // By now the member holds 500 Beauty points (Silver, 3%): 500,000 less 15,000 = 485,000.
            [productOnly, 0, 485],
          ] as const) {
            const done = await k.finalize(draft);
            await k.pay(done.id, done.totalVnd);
            await consume(done.id);
            assert.equal(await earned(done.id, 'SPA'), spaPoints, `Spa points of ${done.kind}`);
            assert.equal(
              await earned(done.id, 'BEAUTY'),
              beautyPoints,
              `Beauty points of ${done.kind}`,
            );
          }
          // The service-only visit invoice has no Beauty entry at all.
          assert.equal(
            await tx.loyaltyLedgerEntry.count({
              where: { invoiceId: spaDraft.id, wallet: 'BEAUTY' },
            }),
            0,
          );
          await k.reconcile();
        },
      );

      await suite.test(
        'the customer sees product lines (name, quantity, price) without seller, SKU or stock; the list and totals mirror the staff view',
        async () => {
          await k.receive(v50.id, 20);
          await k.receive(v100.id, 20);
          const buyer = await k.customer('buyer');
          const sale = await k.finalize(
            await k.addLine(
              await k.addLine(await k.openSale(people.cashier, buyer.id), v50.id, 2),
              v100.id,
              1,
              people.ktv.id,
            ),
          );
          const view = await customerInvoiceDetail(tx, buyer.id, sale.id);
          assert.equal(view.kind, 'PRODUCT_SALE');
          assert.equal(view.totalVnd, sale.totalVnd);
          assert.equal(view.lines.length, 2);
          assert.deepEqual(
            view.lines.map((line) => [
              line.nameVi,
              line.quantity,
              line.unitPriceVnd,
              line.grossVnd,
            ]),
            sale.productLines.map((line) => [
              line.nameVi,
              line.quantity,
              line.unitPriceVnd,
              line.grossVnd,
            ]),
          );
          const text = JSON.stringify(view);
          for (const secret of [
            people.cashier.id,
            people.ktv.id,
            v50.sku,
            v100.sku,
            'seller',
            'sku',
            'reservation',
          ]) {
            assert.ok(!text.includes(secret), `the customer view leaks ${secret}`);
          }
          assert.deepEqual(Object.keys(view.lines[0]!).sort(), [
            'forSelf',
            'grossVnd',
            'nameEn',
            'nameVi',
            'pricingUnit',
            'quantity',
            'recipientName',
            'sequence',
            'unitPriceVnd',
          ]);
          await k.reconcile();
        },
      );

      await suite.test(
        'a service-only invoice is exactly what it was: same shape, same facts, no product rows, same audit and events',
        async () => {
          const draft = await k.serviceDraft([k.exact, k.ranged], null);
          assert.deepEqual(draft.productLines, []);
          assert.equal(draft.channel, 'COUNTER');
          assert.equal(draft.shippingFeeVnd, '0');
          assert.equal(draft.actions.sellProducts, true, 'a cashier who may sell sees the action');
          assert.equal(draft.calculationVersion, 2);
          const done = await k.finalize(draft);
          assert.equal(done.subtotalVnd, String(200_000 + 100_000));
          assert.equal(done.totalVnd, done.subtotalVnd);
          assert.equal(await tx.invoiceLineProduct.count({ where: { invoiceId: done.id } }), 0);
          assert.equal(await tx.stockReservation.count({ where: { invoiceId: done.id } }), 0);
          const audit = await tx.auditEvent.findFirstOrThrow({
            where: { entityId: done.id, action: 'INVOICE_FINALIZED' },
          });
          const after = Object(audit.after);
          assert.equal(Reflect.has(after, 'stockReservations'), false);
          assert.equal(Reflect.has(after, 'shippingFeeVnd'), false);
          const finalized = await tx.outboxEvent.findFirstOrThrow({
            where: { aggregateId: done.id, eventType: 'INVOICE_FINALIZED' },
          });
          assert.deepEqual(Object.keys(Object(finalized.payload)).sort(), [
            'branchId',
            'calculationVersion',
            'discountTotalVnd',
            'invoiceId',
            'totalVnd',
            'visitId',
          ]);
          // A cashier without SELL_PRODUCTS has the same invoice with the action off.
          const seen = await invoices.get(people.plainCashier.token, done.id);
          assert.equal(seen.actions.sellProducts, false);
          await fails(
            () =>
              invoices.addProductLine(people.plainCashier.token, seen.id, {
                expectedVersion: seen.version,
                variantId: v50.id,
                quantity: 1,
              }),
            'FORBIDDEN',
          );
          await k.reconcile();
        },
      );

      await suite.test(
        'the POS board lists a product sale with the same fields as any invoice',
        async () => {
          const board = await invoices.board(people.cashier.token, A.id, undefined);
          const sales = board.invoices.filter((entry) => entry.kind === 'PRODUCT_SALE');
          assert.ok(sales.length > 0);
          assert.ok(sales.every((entry) => entry.visitId === null && entry.comboName === null));
          await fails(() => invoices.board(people.otherBranch.token, A.id, undefined), 'FORBIDDEN');
          assert.ok(B.id);
        },
      );
    });
  },
);
