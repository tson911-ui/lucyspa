import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseNotificationParams, type InvoiceResponse } from '@lucy-spa/contracts';
import { processInventoryEvent, settleInvoiceStock } from '@lucy-spa/server';
import { DiscountService } from '../discounts/discount.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';

/**
 * Phase 6 P6-10 against real PostgreSQL (design 4.5, 10.1-10.3; T15, T27): the sale of reserved stock. A paid invoice consumes its
 * reservations (first-expiry lot first, expired lots never first), the reversal of the payment gives the stock back to exactly the
 * lots it came from, a cancellation returns it too (also when the consumer has not yet seen the reversal), the events can be handled
 * in any order and twice, and the service-only history is never read as a backlog. After every step the deferred database checks run
 * and each test ends with the reconciliation of the whole fixture (movements = lots = on hand, reserved = open reservations, the
 * sale movements of a line add up to its quantity exactly while it is consumed). Every fixture rolls back.
 */
test(
  'Phase 6 P6-10 stock sale: consume at paid, give back at reversal and cancellation, any order, replay-safe; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { invoices, people, A } = k;
      const programs = new DiscountService(base.adapter, base.throttle);
      // A holder of the inventory permission at ANOTHER branch: never told about a sale at branch A.
      const outsiderViewer = await base.staff(['VIEW_INVENTORY'], { branchId: k.B.id });
      const plus = async (days: number) =>
        (
          await tx.$queryRawUnsafe<{ d: string }[]>(
            `SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + ${days}, 'YYYY-MM-DD') AS d`,
          )
        )[0]!.d;
      const receiveLot = async (
        variantId: string,
        quantity: number,
        lotCode: string,
        expiryDate: string | null,
      ) => {
        const draft = await k.inventory.createReceipt(people.receiver.token, {
          branchId: A.id,
          supplierId: null,
          receiptDate: await k.day(),
          notes: null,
          lines: [{ variantId, quantity, lotCode, expiryDate }],
        });
        return k.inventory.confirmReceipt(people.receiver.token, draft.id, {
          expectedRowVersion: draft.rowVersion,
        });
      };
      const saleOf = async (invoice: InvoiceResponse) => {
        const line = (await invoices.get(people.cashier.token, invoice.id)).productLines[0]!;
        return k.saleOf(line.id);
      };
      const fresh = (id: string) => invoices.get(people.cashier.token, id);
      const buy = async (variantId: string, quantity: number, payer: string | null = null) =>
        k.finalize(await k.addLine(await k.openSale(people.cashier, payer), variantId, quantity));
      const expiredLotAlerts = (variantId: string) =>
        tx.notification.count({ where: { type: 'EXPIRED_LOT_SOLD', entityId: variantId } });
      const lotsOf = async (variantId: string) =>
        Object.fromEntries(
          (
            await tx.inventoryLot.findMany({
              where: { branchId: A.id, variantId },
              select: { lotCode: true, quantityOnHand: true },
            })
          ).map((lot) => [lot.lotCode, lot.quantityOnHand]),
        );

      await suite.test(
        'paying consumes the reservation: first-expiry lot first, one movement per lot, reserved and on hand fall together',
        async () => {
          const product = await k.product('fefo', [100_000]);
          const variant = product.variants[0]!;
          await receiveLot(variant.id, 2, 'LOT-FAR', await plus(30));
          await receiveLot(variant.id, 3, 'LOT-NEAR', await plus(10));
          await receiveLot(variant.id, 4, 'LOT-NONE', null);
          const invoice = await buy(variant.id, 4);
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 9, reserved: 4 });
          const paid = await k.pay(invoice.id, Number(invoice.totalVnd));
          assert.equal(paid.invoice.status, 'PAID');
          // The sale waits for the consumer; the reservation holds the units in the meantime (no oversell, nothing sold yet).
          assert.equal((await saleOf(invoice)).status, 'RESERVED');
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 9, reserved: 4 });
          assert.equal(await k.availableOf(variant.id), 5);
          // The production relay selects the event itself (only invoices with a reservation).
          assert.deepEqual(await k.relayInventory(), ['APPLIED']);
          const sold = await saleOf(invoice);
          assert.equal(sold.status, 'CONSUMED');
          assert.equal(sold.consumedPaidSeq, 1);
          // 4 units: the 3 of the nearest expiry, then 1 of the next; the lot without an expiry is touched last.
          assert.deepEqual(sold.movements.map((m) => [m.kind, m.lot, m.delta, m.paidSeq]).sort(), [
            ['SALE', 'LOT-FAR', -1, 1],
            ['SALE', 'LOT-NEAR', -3, 1],
          ]);
          assert.deepEqual(await lotsOf(variant.id), {
            'LOT-FAR': 1,
            'LOT-NEAR': 0,
            'LOT-NONE': 4,
          });
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 5, reserved: 0 });
          assert.equal(await k.availableOf(variant.id), 5);
          assert.equal(
            await expiredLotAlerts(variant.id),
            0,
            'a sale from sellable lots sends no expired-lot alert',
          );
          const view = await fresh(invoice.id);
          assert.deepEqual(
            view.productLines.map((line) => line.reservation?.status),
            ['CONSUMED'],
          );
          // The consumer wrote one outcome for each event; a replay of the same event claims nothing and writes nothing.
          const consumptions = await tx.outboxConsumption.findMany({
            where: { consumer: 'inventory', event: { aggregateId: invoice.id } },
            select: { eventId: true, outcome: true },
          });
          assert.ok(consumptions.length >= 1);
          assert.equal(await processInventoryEvent(tx, consumptions[0]!.eventId), 'NOT_CLAIMED');
          assert.deepEqual(await k.runInventory(invoice.id), []);
          const before = (await saleOf(invoice)).movements.length;
          await settleInvoiceStock(tx, { id: invoice.id, status: 'PAID', paidSeq: 1 });
          assert.equal((await saleOf(invoice)).movements.length, before, 'a replay writes nothing');
          await k.settle();
          await k.reconcile();
        },
      );

      await suite.test(
        'reversing the payment gives the stock back to the same lots; paying again sells it again (a new paid episode)',
        async () => {
          const product = await k.product('reverse', [80_000]);
          const variant = product.variants[0]!;
          await receiveLot(variant.id, 2, 'R-1', await plus(5));
          await receiveLot(variant.id, 5, 'R-2', await plus(60));
          const invoice = await buy(variant.id, 4);
          const paid = await k.pay(invoice.id, Number(invoice.totalVnd));
          await k.runInventory(invoice.id);
          assert.deepEqual(await lotsOf(variant.id), { 'R-1': 0, 'R-2': 3 });
          const reversed = await k.ok(() =>
            invoices.reversePayment(people.boss.token, invoice.id, paid.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          assert.equal(reversed.invoice.status, 'PENDING_PAYMENT');
          // Before the consumer reacts the sale still stands; then the exact mirror of it is written and the unit is reserved again.
          assert.equal((await saleOf(invoice)).status, 'CONSUMED');
          assert.deepEqual(await k.runInventory(invoice.id), ['APPLIED']);
          const back = await saleOf(invoice);
          assert.equal(back.status, 'RESERVED');
          assert.equal(back.consumedPaidSeq, null);
          assert.equal(back.net, 0);
          assert.deepEqual(
            back.movements.map((m) => [m.kind, m.lot, m.delta]).sort(),
            [
              ['SALE', 'R-1', -2],
              ['SALE', 'R-2', -2],
              ['SALE_REVERSAL', 'R-1', 2],
              ['SALE_REVERSAL', 'R-2', 2],
            ].sort(),
          );
          assert.deepEqual(await lotsOf(variant.id), { 'R-1': 2, 'R-2': 5 });
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 7, reserved: 4 });
          // Paid again: episode 2 sells the same units again; the keys of the two episodes differ.
          await k.pay(invoice.id, Number(invoice.totalVnd));
          assert.deepEqual(await k.runInventory(invoice.id), ['APPLIED']);
          const again = await saleOf(invoice);
          assert.equal(again.status, 'CONSUMED');
          assert.equal(again.consumedPaidSeq, 2);
          assert.equal(again.net, -4);
          assert.equal(new Set(again.movements.map((m) => m.key)).size, again.movements.length);
          await k.reconcile();
        },
      );

      await suite.test(
        'cancelling after a full reversal returns the stock, also when the consumer has not yet seen the reversal (T27)',
        async () => {
          const product = await k.product('cancel', [50_000]);
          const variant = product.variants[0]!;
          await receiveLot(variant.id, 6, 'C-1', null);
          // (a) the consumer is behind by BOTH events: the cancelling transaction reverses the sale itself.
          const lagging = await buy(variant.id, 2);
          const paidA = await k.pay(lagging.id, Number(lagging.totalVnd));
          await k.runInventory(lagging.id);
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 4, reserved: 0 });
          const reversedA = await k.ok(() =>
            invoices.reversePayment(people.boss.token, lagging.id, paidA.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          const cancelledA = await k.ok(() =>
            invoices.cancel(people.boss.token, lagging.id, {
              expectedVersion: reversedA.invoice.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.deepEqual(
            cancelledA.productLines.map((line) => line.reservation?.status),
            ['RELEASED'],
          );
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 6, reserved: 0 });
          const sale = await saleOf(cancelledA);
          assert.equal(sale.net, 0);
          assert.deepEqual(
            sale.movements.map((m) => [m.kind, m.actor === people.boss.id]),
            [
              ['SALE', false],
              ['SALE_REVERSAL', true],
            ],
            'the reversal is recorded under who cancelled',
          );
          // The late events find nothing left to do and change nothing.
          const late = await k.runInventory(lagging.id);
          assert.ok(
            late.every((outcome) => outcome === 'NOOP' || outcome === 'SKIPPED_STALE'),
            late.join(),
          );
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 6, reserved: 0 });
          // (b) the consumer already gave the stock back before the cancellation: the cancel only releases the reservation.
          const caught = await buy(variant.id, 3);
          const paidB = await k.pay(caught.id, Number(caught.totalVnd));
          await k.runInventory(caught.id);
          const reversedB = await k.ok(() =>
            invoices.reversePayment(people.boss.token, caught.id, paidB.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          await k.runInventory(caught.id);
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 6, reserved: 3 });
          const cancelledB = await k.ok(() =>
            invoices.cancel(people.boss.token, caught.id, {
              expectedVersion: reversedB.invoice.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.deepEqual(
            cancelledB.productLines.map((line) => line.reservation?.status),
            ['RELEASED'],
          );
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 6, reserved: 0 });
          assert.deepEqual(await k.runInventory(caught.id), ['NOOP']);
          await k.reconcile();
        },
      );

      await suite.test(
        'a zero-balance invoice is sold at finalization and its correction cancel returns the stock',
        async () => {
          const product = await k.product('zero', [70_000]);
          const variant = product.variants[0]!;
          await receiveLot(variant.id, 3, 'Z-1', null);
          const created = await programs.create(people.owner.token, {
            code: `P610${base.run}`.slice(0, 24),
            nameVi: 'Tặng 100%',
            nameEn: 'Free',
            requiresCode: true,
            version: {
              kind: 'PERCENT',
              percentBp: 10000,
              validFrom: new Date(Date.now() - 86_400_000).toISOString(),
              validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
              minSpendVnd: '0',
              scope: 'PRODUCTS',
              scopeMode: 'ALL_SERVICES',
              serviceIds: [],
              categoryIds: [],
              usageLimitTotal: null,
              usageLimitPerCustomer: null,
            },
          });
          const code = `V610${base.run}`.slice(0, 24);
          await programs.createVoucher(people.owner.token, created.id, { code });
          let draft = await k.addLine(await k.openSale(people.cashier), variant.id, 2);
          draft = await k.ok(() =>
            invoices.supplyVoucher(people.cashier.token, draft.id, {
              expectedVersion: draft.version,
              code,
            }),
          );
          const settled = await k.finalize(draft);
          assert.equal(settled.totalVnd, '0');
          assert.equal(settled.status, 'PAID');
          assert.deepEqual(await k.runInventory(settled.id), ['APPLIED']);
          assert.equal((await saleOf(settled)).status, 'CONSUMED');
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 1, reserved: 0 });
          const cancelled = await k.ok(() =>
            invoices.cancel(people.boss.token, settled.id, {
              expectedVersion: settled.version,
              reason: 'Nhập nhầm',
            }),
          );
          assert.deepEqual(
            cancelled.productLines.map((line) => line.reservation?.status),
            ['RELEASED'],
          );
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 3, reserved: 0 });
          await k.runInventory(settled.id);
          await k.reconcile();
        },
      );

      await suite.test(
        'the events can arrive in any order: the state of the invoice decides, a stale event changes nothing',
        async () => {
          const product = await k.product('order', [60_000]);
          const variant = product.variants[0]!;
          await receiveLot(variant.id, 5, 'O-1', null);
          const eventsOf = async (invoiceId: string) =>
            (
              await tx.outboxEvent.findMany({
                where: {
                  aggregateId: invoiceId,
                  eventType: { in: ['INVOICE_PAID', 'INVOICE_REOPENED', 'INVOICE_CANCELLED'] },
                },
                orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
                select: { id: true, eventType: true },
              })
            ).map((event) => event);
          const handle = async (id: string) => {
            const outcome = await processInventoryEvent(tx, id);
            await k.settle();
            return outcome;
          };
          // Paid (1), reversed, paid (2): the consumer sees the SECOND payment first, then the reversal, then the first payment.
          const invoice = await buy(variant.id, 2);
          const first = await k.pay(invoice.id, Number(invoice.totalVnd));
          await k.ok(() =>
            invoices.reversePayment(people.boss.token, invoice.id, first.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          await k.pay(invoice.id, Number(invoice.totalVnd));
          const [paid1, reopened1, paid2] = (await eventsOf(invoice.id)).filter(
            (event) => event.eventType !== 'INVOICE_CANCELLED',
          ) as unknown as [{ id: string }, { id: string }, { id: string }];
          assert.equal(await handle(paid2.id), 'APPLIED');
          const sold = await saleOf(invoice);
          assert.equal(sold.status, 'CONSUMED');
          assert.equal(sold.consumedPaidSeq, 2);
          assert.equal(sold.net, -2);
          assert.equal(
            await handle(reopened1.id),
            'NOOP',
            'the reversed episode was already settled',
          );
          assert.equal(
            await handle(paid1.id),
            'SKIPPED_STALE',
            'episode 1 is no longer the current one',
          );
          assert.equal((await saleOf(invoice)).net, -2);
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 3, reserved: 0 });
          // A payment that is reversed and cancelled before its event is ever handled: PAID(1) arrives last and does nothing.
          const quick = await buy(variant.id, 1);
          const quickPaid = await k.pay(quick.id, Number(quick.totalVnd));
          const quickReversed = await k.ok(() =>
            invoices.reversePayment(people.boss.token, quick.id, quickPaid.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          await k.ok(() =>
            invoices.cancel(people.boss.token, quick.id, {
              expectedVersion: quickReversed.invoice.version,
              reason: 'Khách đổi ý',
            }),
          );
          const quickEvents = await eventsOf(quick.id);
          for (const event of [...quickEvents].reverse()) {
            assert.ok(['NOOP', 'SKIPPED_STALE'].includes(await handle(event.id)), event.eventType);
          }
          assert.equal((await saleOf(quick)).movements.length, 0, 'it was never sold');
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 3, reserved: 0 });
          await k.reconcile();
        },
      );

      await suite.test(
        'a lot that expires after the reservation: sellable lots first, an expired lot only as the last resort (OQ-75)',
        async () => {
          const product = await k.product('expiry', [90_000]);
          const variant = product.variants[0]!;
          // Fixture trick: a lot expiring on the earliest date on Earth today is "today" for a branch at UTC-11 (sellable) and
          // already expired for a branch at UTC+14, whatever the time of day.
          await tx.branch.update({ where: { id: A.id }, data: { timezone: 'Pacific/Pago_Pago' } });
          const earliest = (
            await tx.$queryRawUnsafe<{ d: string }[]>(
              `SELECT to_char((clock_timestamp() AT TIME ZONE 'Pacific/Pago_Pago')::date, 'YYYY-MM-DD') AS d`,
            )
          )[0]!.d;
          const draftReceipt = async (
            lotCode: string,
            quantity: number,
            expiryDate: string | null,
          ) => {
            const draft = await k.inventory.createReceipt(people.receiver.token, {
              branchId: A.id,
              supplierId: null,
              receiptDate: earliest,
              notes: null,
              lines: [{ variantId: variant.id, quantity, lotCode, expiryDate }],
            });
            await k.inventory.confirmReceipt(people.receiver.token, draft.id, {
              expectedRowVersion: draft.rowVersion,
            });
          };
          await draftReceipt('E-OLD', 3, earliest);
          await draftReceipt('E-OK', 2, null);
          const invoice = await buy(variant.id, 4);
          await k.pay(invoice.id, Number(invoice.totalVnd));
          // After the reservation the branch calendar moves ahead: E-OLD is now expired.
          await tx.branch.update({ where: { id: A.id }, data: { timezone: 'Pacific/Kiritimati' } });
          assert.deepEqual(await k.runInventory(invoice.id), ['APPLIED']);
          const sold = await saleOf(invoice);
          assert.deepEqual(
            sold.movements.map((m) => [m.lot, m.delta]).sort(),
            [
              ['E-OK', -2],
              ['E-OLD', -2],
            ],
            'the sellable lot is emptied first, the expired one gives only what is missing',
          );
          assert.deepEqual(await lotsOf(variant.id), { 'E-OLD': 1, 'E-OK': 0 });
          await tx.branch.update({ where: { id: A.id }, data: { timezone: 'Asia/Ho_Chi_Minh' } });

          // OQ-75 as changed by the Owner (2026-10-08): the same transaction wrote an in-app alert naming the invoice, the
          // product and the lot, for the holders of the inventory permission AT THIS BRANCH and nobody else.
          const alerts = await tx.notification.findMany({
            where: { type: 'EXPIRED_LOT_SOLD', entityId: variant.id },
            select: {
              recipientUserId: true,
              branchId: true,
              entityType: true,
              contextCode: true,
              params: true,
              sourceEventId: true,
            },
          });
          const recipients = alerts.map((alert) => alert.recipientUserId).sort();
          assert.ok(
            recipients.includes(people.receiver.id),
            'a VIEW_INVENTORY holder of the branch is told',
          );
          assert.ok(recipients.includes(people.owner.id), 'the Owner holds every permission');
          for (const outsider of [
            people.cashier,
            people.boss,
            people.ktv,
            people.otherBranch,
            outsiderViewer,
          ]) {
            assert.ok(
              !recipients.includes(outsider.id),
              'nobody without the permission at this branch is told',
            );
          }
          for (const alert of alerts) {
            assert.equal(alert.branchId, A.id);
            assert.equal(alert.entityType, 'ProductVariant');
            assert.equal(alert.contextCode, variant.sku);
            assert.deepEqual(parseNotificationParams('EXPIRED_LOT_SOLD', alert.params), {
              invoiceCode: invoice.code,
              lotCode: 'E-OLD',
              quantity: 2,
            });
          }
          const audit = await tx.auditEvent.findMany({
            where: {
              action: 'STOCK_EXPIRED_LOT_SOLD',
              after: { path: ['invoiceId'], equals: invoice.id },
            },
            select: { entityType: true, after: true },
          });
          assert.equal(audit.length, 1, 'one audit event for the one expired lot');
          assert.equal(audit[0]!.entityType, 'InventoryLot');
          assert.equal(
            (audit[0]!.after as { notifiedUsers: number }).notifiedUsers,
            recipients.length,
          );
          // The alert exists exactly when the SALE movement does: a replay (the state is aligned) writes no second one.
          const events = await tx.outboxEvent.count({
            where: { eventType: 'EXPIRED_LOT_SOLD', aggregateType: 'StockAlert', branchId: A.id },
          });
          await settleInvoiceStock(tx, { id: invoice.id, status: 'PAID', paidSeq: 1 });
          assert.deepEqual(await k.runInventory(invoice.id), []);
          assert.equal(await expiredLotAlerts(variant.id), alerts.length);
          assert.equal(
            await tx.outboxEvent.count({
              where: { eventType: 'EXPIRED_LOT_SOLD', aggregateType: 'StockAlert', branchId: A.id },
            }),
            events,
          );
          await k.reconcile();
        },
      );

      await suite.test(
        'an expired-lot sale with nobody to tell still goes through (stock stays reconciled) and is recorded in the audit',
        async () => {
          const product = await k.product('expiry-silent', [90_000]);
          const variant = product.variants[0]!;
          await tx.branch.update({ where: { id: A.id }, data: { timezone: 'Pacific/Pago_Pago' } });
          const earliest = (
            await tx.$queryRawUnsafe<{ d: string }[]>(
              `SELECT to_char((clock_timestamp() AT TIME ZONE 'Pacific/Pago_Pago')::date, 'YYYY-MM-DD') AS d`,
            )
          )[0]!.d;
          const draft = await k.inventory.createReceipt(people.receiver.token, {
            branchId: A.id,
            supplierId: null,
            receiptDate: earliest,
            notes: null,
            lines: [{ variantId: variant.id, quantity: 2, lotCode: 'S-OLD', expiryDate: earliest }],
          });
          await k.inventory.confirmReceipt(people.receiver.token, draft.id, {
            expectedRowVersion: draft.rowVersion,
          });
          const invoice = await buy(variant.id, 2);
          await k.pay(invoice.id, Number(invoice.totalVnd));
          await tx.branch.update({ where: { id: A.id }, data: { timezone: 'Pacific/Kiritimati' } });
          // Nobody holds the permission: the branch is switched off after the sale was reserved (no holder is resolvable).
          await tx.branch.update({ where: { id: A.id }, data: { isActive: false } });
          assert.deepEqual(await k.runInventory(invoice.id), ['APPLIED']);
          await tx.branch.update({
            where: { id: A.id },
            data: { isActive: true, timezone: 'Asia/Ho_Chi_Minh' },
          });
          assert.equal((await saleOf(invoice)).status, 'CONSUMED');
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 0, reserved: 0 });
          assert.equal(await expiredLotAlerts(variant.id), 0);
          const audit = await tx.auditEvent.findMany({
            where: {
              action: 'STOCK_EXPIRED_LOT_SOLD',
              after: { path: ['invoiceId'], equals: invoice.id },
            },
            select: { after: true },
          });
          assert.equal(audit.length, 1);
          assert.equal((audit[0]!.after as { notifiedUsers: number }).notifiedUsers, 0);
          await k.reconcile();
        },
      );

      await suite.test(
        'a lot code that is not a plain code never stops the sale: the alert shows a cleaned code',
        async () => {
          const product = await k.product('expiry-odd-code', [90_000]);
          const variant = product.variants[0]!;
          await tx.branch.update({ where: { id: A.id }, data: { timezone: 'Pacific/Pago_Pago' } });
          const earliest = (
            await tx.$queryRawUnsafe<{ d: string }[]>(
              `SELECT to_char((clock_timestamp() AT TIME ZONE 'Pacific/Pago_Pago')::date, 'YYYY-MM-DD') AS d`,
            )
          )[0]!.d;
          const draft = await k.inventory.createReceipt(people.receiver.token, {
            branchId: A.id,
            supplierId: null,
            receiptDate: earliest,
            notes: null,
            lines: [
              { variantId: variant.id, quantity: 1, lotCode: 'ODD-LOT', expiryDate: earliest },
            ],
          });
          await k.inventory.confirmReceipt(people.receiver.token, draft.id, {
            expectedRowVersion: draft.rowVersion,
          });
          // The lot code as stored: padded and with a line break (the application never writes this, a restore or a script could).
          await tx.$executeRawUnsafe(`ALTER TABLE inventory_lots DISABLE TRIGGER USER`);
          await tx.$executeRawUnsafe(
            `UPDATE inventory_lots SET lot_code = E'  ODD\\nLOT  ' WHERE branch_id = '${A.id}'::uuid AND variant_id = '${variant.id}'::uuid`,
          );
          await tx.$executeRawUnsafe(`ALTER TABLE inventory_lots ENABLE TRIGGER USER`);
          const invoice = await buy(variant.id, 1);
          await k.pay(invoice.id, Number(invoice.totalVnd));
          await tx.branch.update({ where: { id: A.id }, data: { timezone: 'Pacific/Kiritimati' } });
          assert.deepEqual(await k.runInventory(invoice.id), ['APPLIED']);
          await tx.branch.update({ where: { id: A.id }, data: { timezone: 'Asia/Ho_Chi_Minh' } });
          const alert = await tx.notification.findFirstOrThrow({
            where: { type: 'EXPIRED_LOT_SOLD', entityId: variant.id },
            select: { params: true },
          });
          assert.deepEqual(parseNotificationParams('EXPIRED_LOT_SOLD', alert.params), {
            invoiceCode: invoice.code,
            lotCode: 'ODD LOT',
            quantity: 1,
          });
          await k.reconcile();
        },
      );

      await suite.test(
        'the reservation holds the last unit between payment and sale; service-only history is never read as a backlog',
        async () => {
          const product = await k.product('last', [40_000]);
          const variant = product.variants[0]!;
          await k.receive(variant.id, 1);
          const first = await buy(variant.id, 1);
          await k.pay(first.id, Number(first.totalVnd));
          // Paid, not yet sold: still not available to anybody else.
          const second = await k.addLine(await k.openSale(people.cashier), variant.id, 1);
          await fails(
            () =>
              invoices.finalize(people.cashier.token, second.id, {
                expectedVersion: second.version,
              }),
            'PRODUCT_OUT_OF_STOCK',
          );
          await k.runInventory(first.id);
          assert.deepEqual(await k.levelOf(variant.id), { onHand: 0, reserved: 0 });
          await fails(
            () =>
              invoices.finalize(people.cashier.token, second.id, {
                expectedVersion: second.version,
              }),
            'PRODUCT_OUT_OF_STOCK',
          );
          // A paid SERVICE-only invoice: its events are never selected by the relay and no consumption row is written for them.
          const service = await k.serviceDraft([k.exact]);
          const serviceFinal = await k.ok(() =>
            invoices.finalize(people.cashier.token, service.id, {
              expectedVersion: service.version,
            }),
          );
          await k.pay(service.id, Number(serviceFinal.totalVnd));
          const relayed = await k.relayInventory();
          assert.ok(!relayed.includes('IGNORED'));
          const rows = await tx.outboxConsumption.count({
            where: { consumer: 'inventory', event: { aggregateId: service.id } },
          });
          assert.equal(rows, 0, 'a service-only invoice never reaches the inventory consumer');
          await k.reconcile();
        },
      );

      await suite.test(
        'the database refuses what the application never does: a sale without its consumed reservation, an oversale, a reversal beyond the lot, wrong transitions, a sale that does not add up',
        async () => {
          let savepoints = 0;
          const refused = async (sql: string, pattern: RegExp, settleInside = false) => {
            const name = `p610_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await tx.$executeRawUnsafe(sql);
              if (settleInside) await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
              const text = `${String((error as Error).message)} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
              assert.match(text, pattern);
              return;
            }
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          const product = await k.product('guards', [30_000]);
          const variant = product.variants[0]!;
          await receiveLot(variant.id, 4, 'G-1', null);
          await receiveLot(variant.id, 4, 'G-2', null);
          const [lot1, lot2] = (await Promise.all(
            ['G-1', 'G-2'].map((lotCode) =>
              tx.inventoryLot.findFirstOrThrow({
                where: { branchId: A.id, variantId: variant.id, lotCode },
              }),
            ),
          )) as unknown as [{ id: string }, { id: string }];
          const invoice = await buy(variant.id, 3);
          const line = (await fresh(invoice.id)).productLines[0]!;
          const sale = (lotId: string, delta: number, seq = 1, kind = 'SALE', key = randomUUID()) =>
            `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, invoice_line_id, paid_seq, idempotency_key, actor_user_id)
             VALUES ('${A.id}'::uuid, '${variant.id}'::uuid, '${lotId}'::uuid, '${kind}', ${delta}, '${line.id}'::uuid, ${seq}, '${key}', '${people.cashier.id}'::uuid)`;
          const reservation = `invoice_line_id = '${line.id}'::uuid`;
          // A sale needs the CONSUMED reservation of its line (the invoice is not even paid yet).
          await refused(sale(lot1.id, -3), /consumed reservation of its invoice line/);
          // A reservation is consumed only by a PAID invoice at its current paid episode.
          await refused(
            `UPDATE stock_reservations SET status = 'CONSUMED', consumed_paid_seq = 1 WHERE ${reservation}`,
            /changes only from reserved to released/,
          );
          const paid = await k.pay(invoice.id, Number(invoice.totalVnd));
          await refused(
            `UPDATE stock_reservations SET status = 'CONSUMED', consumed_paid_seq = 2 WHERE ${reservation}`,
            /changes only from reserved to released/,
          );
          // Consumed without its movements: refused at commit; with them it stands.
          await refused(
            `UPDATE stock_reservations SET status = 'CONSUMED', consumed_paid_seq = 1 WHERE ${reservation}`,
            /has sold exactly its quantity/,
            true,
          );
          await k.runInventory(invoice.id);
          assert.equal((await saleOf(invoice)).status, 'CONSUMED');
          // One more unit than the line has, or the right quantity with the wrong episode, is refused.
          await refused(sale(lot2.id, -1), /takes no more than the quantity of its invoice line/);
          await refused(sale(lot2.id, -1, 2), /consumed reservation of its invoice line/);
          // A reversal returns to a lot no more than the sale took from it (equal expiry: the lot is chosen by id, so ask which one it was).
          const tookFrom = (await saleOf(invoice)).movements[0]!.lot === 'G-1' ? lot1 : lot2;
          const untouched = tookFrom === lot1 ? lot2 : lot1;
          await refused(
            sale(untouched.id, 1, 1, 'SALE_REVERSAL'),
            /no more than the sale took from it/,
          );
          await refused(
            sale(tookFrom.id, 4, 1, 'SALE_REVERSAL'),
            /no more than the sale took from it/,
          );
          // The wrong direction for the kind is a shape error.
          await refused(sale(tookFrom.id, 1, 1, 'SALE'), /stock_movements_kind_shape/);
          await refused(sale(tookFrom.id, -1, 1, 'SALE_REVERSAL'), /stock_movements_kind_shape/);
          // A movement is append-only.
          await refused(
            `UPDATE stock_movements SET quantity_delta = -1 WHERE invoice_line_id = '${line.id}'::uuid`,
            /append-only/,
          );
          // A consumed reservation does not return while its paid episode stands, and is released only by a cancelled invoice.
          await refused(
            `UPDATE stock_reservations SET status = 'RESERVED' WHERE ${reservation}`,
            /returns to reserved only when its paid episode has ended/,
          );
          await refused(
            `UPDATE stock_reservations SET status = 'RELEASED', released_by_user_id = '${people.boss.id}'::uuid, release_cause = 'INVOICE_CANCELLED_UNPAID' WHERE ${reservation}`,
            /released only when its invoice is cancelled/,
          );
          // The reversal of the payment ends the episode: the reservation can go back, but only after the movements do.
          await k.ok(() =>
            invoices.reversePayment(people.boss.token, invoice.id, paid.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          await refused(
            `UPDATE stock_reservations SET status = 'RESERVED' WHERE ${reservation}`,
            /has sold exactly its quantity/,
            true,
          );
          await k.runInventory(invoice.id);
          assert.equal((await saleOf(invoice)).status, 'RESERVED');
          await k.reconcile();
        },
      );

      await suite.test(
        'the consumer reads the state, not the event: a draft or a cancelled draft holds nothing and is a no-op',
        async () => {
          const draft = await k.openSale(people.cashier);
          const result = await settleInvoiceStock(tx, {
            id: draft.id,
            status: 'DRAFT',
            paidSeq: 0,
          });
          assert.deepEqual(result, { consumed: 0, givenBack: 0, released: 0 });
          await k.reconcile();
        },
      );
    });
  },
);
