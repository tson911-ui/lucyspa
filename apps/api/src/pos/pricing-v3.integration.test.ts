import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DiscountVersionInput, InvoiceResponse } from '@lucy-spa/contracts';
import { appendLedgerEntry, LOYALTY_EVENT_TYPES, processLoyaltyEvent } from '@lucy-spa/server';
import { DiscountService } from '../discounts/discount.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { customerInvoiceDetail } from './customer-invoice.core.js';
import { shadowAlert } from './pricing.shadow-report.js';
import { shadowControl } from './pricing.shadow.js';
import { evaluatePricingV3 } from './pricing.v3.js';
import { cumulativeShare } from './split.js';

/**
 * Phase 6 P6-9 against real PostgreSQL (design 6, T17-T19, Q1-Q2, Q7, OQ-P6-20/21, OQ-59): the pricing of an invoice that has a product
 * line, per side (the worked examples of 6.8 through the real POS flow), the shared program, the scope and its product targets, the
 * birthday gift on the Spa side only, the payment attribution to the sides (A, B, reversal of A, C), the loyalty earn on the Spa
 * side net, the cancellation that releases every redemption, and the OQ-59 safety net of a service-only invoice. After every command
 * the deferred database checks run (`ok`), and each test ends with the pricing reconciliation of the whole fixture. Fixtures roll back.
 */
test(
  'Phase 6 P6-9 pricing v3: sides, shared programs, scope, allocations and the service-only safety net; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { invoices, people, A } = k;
      const programs = new DiscountService(base.adapter, base.throttle);
      const cream = await k.product('cream', [200_000, 350_000]);
      const [v200, v350] = cream.variants as [
        (typeof cream.variants)[number],
        (typeof cream.variants)[number],
      ];
      const plain = await k.product('plain', [100_000]);
      const v100 = plain.variants[0]!;
      const serum = await k.product('serum', [120_000]);
      const v120 = serum.variants[0]!;
      for (const variant of [v200, v350, v100, v120]) await k.receive(variant.id, 200);
      await tx.loyaltyGoLive.create({ data: { activatedByUserId: people.owner.id } });
      let customers = 0;
      /** A customer with the given points in each wallet (a manual ledger entry): Gold = 1000 Spa, Silver = 500, Ruby = 10000. */
      const member = async (spa: number, beauty: number, dateOfBirth?: Date) => {
        const created = await k.customer(`m${++customers}`);
        if (dateOfBirth) {
          await tx.customerProfile.update({ where: { userId: created.id }, data: { dateOfBirth } });
        }
        for (const [wallet, points] of [
          ['SPA', spa],
          ['BEAUTY', beauty],
        ] as const) {
          if (points === 0) continue;
          await appendLedgerEntry(tx, {
            userId: created.id,
            wallet,
            kind: 'MANUAL_ADJUSTMENT',
            points,
            idempotencyKey: randomUUID(),
            reason: 'P6-9 fixture',
            actorUserId: people.owner.id,
          });
        }
        return created;
      };
      let programNo = 0;
      const window = () => ({
        validFrom: new Date(Date.now() - 86_400_000).toISOString(),
        validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
      const version = (overrides: Partial<DiscountVersionInput> = {}): DiscountVersionInput => ({
        // A percentage program has no fixed amount, a fixed one has no percentage (the server refuses both).
        ...(overrides.kind === 'PERCENT'
          ? { kind: 'PERCENT' as const }
          : { kind: 'FIXED_AMOUNT' as const, fixedAmountVnd: '30000' }),
        ...window(),
        minSpendVnd: '0',
        scopeMode: 'ALL_SERVICES',
        serviceIds: [],
        categoryIds: [],
        usageLimitTotal: null,
        usageLimitPerCustomer: null,
        ...overrides,
      });
      /** A voucher program (a program that needs a code never touches an invoice that does not supply it) and one code of it. */
      const voucherProgram = async (overrides: Partial<DiscountVersionInput> = {}) => {
        programNo += 1;
        const created = await programs.create(people.owner.token, {
          code: `P69${base.run}${programNo}`.slice(0, 24),
          nameVi: `Voucher ${programNo}`,
          nameEn: `Voucher ${programNo}`,
          requiresCode: true,
          version: version(overrides),
        });
        const code = `V69${base.run}${programNo}`.slice(0, 24);
        await programs.createVoucher(people.owner.token, created.id, { code });
        return { id: created.id, code };
      };
      const supply = (invoice: InvoiceResponse, code: string) =>
        k.ok(() =>
          invoices.supplyVoucher(people.cashier.token, invoice.id, {
            expectedVersion: invoice.version,
            code,
          }),
        );
      /** A visit invoice of the exact service (200,000) and the ranged one at its minimum (100,000) = 300,000 of Spa, plus the products. */
      const mixed = async (
        payer: string | null,
        products: [{ id: string }, number][] = [[v200, 1]],
      ) => {
        let draft: InvoiceResponse = await k.serviceDraft([k.exact, k.ranged], payer);
        for (const [variant, quantity] of products) {
          draft = await k.addLine(draft, variant.id, quantity);
        }
        return draft;
      };
      const earned = async (invoiceId: string, wallet: 'SPA' | 'BEAUTY') =>
        (
          await tx.loyaltyLedgerEntry.aggregate({
            where: { invoiceId, kind: 'EARN', wallet },
            _sum: { points: true },
          })
        )._sum.points ?? 0;
      const consume = async (invoiceId: string) => {
        const events = await tx.outboxEvent.findMany({
          where: { aggregateId: invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        });
        for (const event of events) {
          await processLoyaltyEvent(tx, event.id);
          await k.settle();
        }
      };
      const sideOf = (invoice: InvoiceResponse, side: 'SPA' | 'BEAUTY') => {
        const found = invoice.discount.sides?.find((entry) => entry.side === side);
        assert.ok(found, `${side} side of ${invoice.code}`);
        return found;
      };
      type Rows = Awaited<ReturnType<typeof rowsOf>>;
      const rowsOf = async (invoiceId: string) => ({
        spaApplication: await tx.invoiceDiscountApplication.findUnique({ where: { invoiceId } }),
        beautyApplication: await tx.invoiceBeautyApplication.findUnique({ where: { invoiceId } }),
        spaSnapshot: await tx.invoiceLoyaltySnapshot.findUnique({ where: { invoiceId } }),
        beautySnapshot: await tx.invoiceBeautySnapshot.findUnique({ where: { invoiceId } }),
        redemptions: await tx.discountRedemption.findMany({
          where: { invoiceId },
          orderBy: { discountId: 'asc' },
          include: { release: true },
        }),
        gift: await tx.birthdayRedemption.findUnique({ where: { invoiceId } }),
        allocations: await tx.invoiceLineAllocation.findMany({
          where: { invoiceId },
          orderBy: { createdAt: 'asc' },
          include: { line: { select: { sequence: true } } },
        }),
      });
      const shares = (rows: Rows, side: 'SPA' | 'BEAUTY') =>
        rows.allocations
          .filter((entry) => entry.side === side)
          .sort((a, b) => a.line.sequence - b.line.sequence)
          .map((entry) => entry.discountShareVnd);
      /**
       * The pricing reconciliation of every invoice of the fixture (Owner's rules): the lines add up to the subtotal, the total is
       * subtotal - discount + fee, a version 3 invoice has one allocation per line whose nets add up to the receivable and whose
       * shares add up to the discount, the payments attributed to the sides add up to what is paid (and each side is paid exactly
       * its net when the invoice is PAID), every applied program has one redemption (released exactly when cancelled), and a
       * service-only invoice has none of the new rows.
       */
      const reconcilePricing = async () => {
        await k.reconcile();
        const all = await tx.invoice.findMany({
          where: { branchId: { in: [A.id, k.B.id] } },
          select: { id: true, code: true, status: true, calculationVersion: true, kind: true },
        });
        for (const invoice of all) {
          const row = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
          const allocations = await tx.invoiceLineAllocation.findMany({
            where: { invoiceId: invoice.id },
          });
          const attributed = await tx.paymentSideAllocation.findMany({
            where: { invoiceId: invoice.id },
          });
          const redemptions = await tx.discountRedemption.findMany({
            where: { invoiceId: invoice.id },
            include: { release: true },
          });
          if (row.calculationVersion < 3) {
            assert.equal(allocations.length, 0, `${invoice.code} has no line allocation`);
            assert.equal(attributed.length, 0, `${invoice.code} has no side attribution`);
            assert.equal(
              await tx.invoiceBeautyApplication.count({ where: { invoiceId: invoice.id } }),
              0,
            );
            assert.equal(
              await tx.invoiceBeautySnapshot.count({ where: { invoiceId: invoice.id } }),
              0,
            );
            continue;
          }
          const lineCount = await tx.invoiceLine.count({ where: { invoiceId: invoice.id } });
          assert.equal(allocations.length, lineCount, `${invoice.code} allocates every line`);
          const net = allocations.reduce((sum, entry) => sum + entry.netVnd, 0n);
          const discount = allocations.reduce((sum, entry) => sum + entry.discountShareVnd, 0n);
          assert.equal(net, row.totalVnd - row.shippingFeeVnd, `${invoice.code} nets = receivable`);
          assert.equal(discount, row.discountTotalVnd, `${invoice.code} shares = discount`);
          const sideNet = (side: 'SPA' | 'BEAUTY') =>
            allocations
              .filter((entry) => entry.side === side)
              .reduce((sum, entry) => sum + entry.netVnd, 0n);
          const paidRows = await tx.payment.findMany({
            where: { invoiceId: invoice.id, status: 'SUCCEEDED', correction: null },
          });
          const paid = paidRows.reduce((sum, entry) => sum + entry.amountVnd, 0n);
          const attributedTo = (side: 'SPA' | 'BEAUTY') =>
            attributed
              .filter((entry) => entry.side === side)
              .reduce((sum, entry) => sum + entry.amountVnd, 0n);
          assert.equal(
            attributedTo('SPA') + attributedTo('BEAUTY'),
            paid,
            `${invoice.code} attributed = paid`,
          );
          if (invoice.status === 'PAID') {
            assert.equal(
              attributedTo('SPA'),
              sideNet('SPA'),
              `${invoice.code} Spa side paid its net`,
            );
            assert.equal(
              attributedTo('BEAUTY'),
              sideNet('BEAUTY'),
              `${invoice.code} Beauty side paid its net`,
            );
          }
          const applied = new Set<string>();
          const spaApplication = await tx.invoiceDiscountApplication.findUnique({
            where: { invoiceId: invoice.id },
          });
          const beautyApplication = await tx.invoiceBeautyApplication.findUnique({
            where: { invoiceId: invoice.id },
          });
          if (spaApplication) applied.add(spaApplication.discountId);
          if (beautyApplication) applied.add(beautyApplication.discountId);
          assert.deepEqual(
            redemptions.map((entry) => entry.discountId).sort(),
            [...applied].sort(),
            `${invoice.code} redeems each applied program once`,
          );
          for (const redemption of redemptions) {
            assert.equal(
              redemption.release !== null,
              invoice.status === 'CANCELLED',
              `${invoice.code} releases its redemption exactly when cancelled`,
            );
          }
        }
      };

      await suite.test(
        'worked example A: no program, each side takes the member discount of the payer tier in ITS wallet; the Spa wallet earns on the Spa net',
        async () => {
          const payer = await member(1000, 500);
          const draft = await mixed(payer.id);
          // The draft is still version 2 and is previewed per side.
          assert.equal(draft.calculationVersion, 2);
          assert.equal(draft.subtotalVnd, '500000');
          assert.equal(draft.discountTotalVnd, '18000');
          assert.equal(draft.totalVnd, '482000');
          assert.equal(sideOf(draft, 'SPA').winnerSource, 'MEMBER_TIER');
          assert.equal(sideOf(draft, 'SPA').discountVnd, '12000');
          assert.equal(sideOf(draft, 'SPA').netVnd, '288000');
          assert.equal(sideOf(draft, 'BEAUTY').discountVnd, '6000');
          assert.equal(sideOf(draft, 'BEAUTY').netVnd, '194000');
          assert.equal(sideOf(draft, 'BEAUTY').member?.tier, 'SILVER');
          assert.equal(sideOf(draft, 'SPA').member?.tier, 'GOLD');
          const done = await k.finalize(draft);
          assert.equal(done.calculationVersion, 3);
          assert.equal(done.discountTotalVnd, '18000');
          assert.equal(done.totalVnd, '482000');
          assert.equal(done.status, 'PENDING_PAYMENT');
          assert.equal(sideOf(done, 'SPA').netVnd, '288000');
          assert.equal(sideOf(done, 'BEAUTY').netVnd, '194000');
          const rows = await rowsOf(done.id);
          // The Spa side is the Phase 5 snapshot, the Beauty side its own; no program benefit, so no application and no redemption.
          assert.equal(rows.spaSnapshot?.winnerSource, 'MEMBER_TIER');
          assert.equal(rows.spaSnapshot?.memberAmountVnd, 12_000n);
          assert.equal(rows.spaSnapshot?.calculationVersion, 3);
          assert.equal(rows.beautySnapshot?.tier, 'SILVER');
          assert.equal(rows.beautySnapshot?.memberAmountVnd, 6_000n);
          assert.equal(rows.beautySnapshot?.eligibleBeautyVnd, 200_000n);
          assert.equal(rows.spaApplication, null);
          assert.equal(rows.beautyApplication, null);
          assert.equal(rows.redemptions.length, 0);
          assert.deepEqual(shares(rows, 'SPA'), [8_000n, 4_000n]);
          assert.deepEqual(shares(rows, 'BEAUTY'), [6_000n]);
          // Pay in two parts; each side's share of what was paid follows the cumulative rule, and the sides end exactly at their nets.
          const first = await k.pay(done.id, 300_000);
          const second = await k.pay(done.id, 182_000);
          assert.equal(second.invoice.status, 'PAID');
          const paidSpa = cumulativeShare(300_000n, 288_000n, 482_000n);
          const attribution = await tx.paymentSideAllocation.findMany({
            where: { invoiceId: done.id },
            orderBy: { createdAt: 'asc' },
          });
          assert.deepEqual(
            attribution
              .filter((entry) => entry.paymentId === first.payment.id)
              .map((entry) => [entry.side, entry.amountVnd]),
            [
              ['SPA', paidSpa],
              ['BEAUTY', 300_000n - paidSpa],
            ],
          );
          // Points follow the side net per wallet: Spa 288 and, since P6-11, Beauty 194 (the product amount after its discount).
          await consume(done.id);
          assert.equal(await earned(done.id, 'SPA'), 288);
          assert.equal(await earned(done.id, 'BEAUTY'), 194);
          // The customer sees the product line and the invoice total.
          const view = await customerInvoiceDetail(tx, payer.id, done.id);
          assert.equal(view.totalVnd, '482000');
          await reconcilePricing();
        },
      );

      await suite.test(
        'worked example B: a shared fixed voucher of 100,000 is split 60,000 / 40,000 and beats both member discounts; one redemption; the Spa wallet earns 240',
        async () => {
          const payer = await member(1000, 500);
          const shared = await voucherProgram({
            fixedAmountVnd: '100000',
            scope: 'BOTH',
            usageLimitTotal: 1,
          });
          const draft = await supply(await mixed(payer.id), shared.code);
          assert.equal(sideOf(draft, 'SPA').winnerSource, 'VOUCHER');
          assert.equal(sideOf(draft, 'SPA').discountVnd, '60000');
          assert.equal(sideOf(draft, 'BEAUTY').discountVnd, '40000');
          const done = await k.finalize(draft);
          assert.equal(done.discountTotalVnd, '100000');
          assert.equal(done.totalVnd, '400000');
          assert.equal(sideOf(done, 'SPA').netVnd, '240000');
          assert.equal(sideOf(done, 'BEAUTY').netVnd, '160000');
          const rows = await rowsOf(done.id);
          assert.equal(rows.redemptions.length, 1, 'one redemption for the shared voucher');
          assert.equal(rows.spaApplication?.computedAmountVnd, 60_000n);
          assert.equal(rows.spaApplication?.sharedAmountVnd, 100_000n);
          assert.equal(rows.spaApplication?.sharedEligibleSubtotalVnd, 500_000n);
          assert.equal(rows.beautyApplication?.computedAmountVnd, 40_000n);
          assert.equal(rows.beautyApplication?.eligibleSubtotalVnd, 200_000n);
          assert.equal(rows.spaSnapshot?.winnerSource, 'VOUCHER');
          assert.equal(rows.beautySnapshot?.winnerSource, 'VOUCHER');
          assert.equal(rows.spaSnapshot?.memberAmountVnd, 0n);
          assert.deepEqual(shares(rows, 'SPA'), [40_000n, 20_000n]);
          assert.deepEqual(shares(rows, 'BEAUTY'), [40_000n]);
          await k.pay(done.id, 400_000);
          await consume(done.id);
          // The Spa earn is the SPA side's net (240,000), not the total less the product gross (200,000).
          assert.equal(await earned(done.id, 'SPA'), 240);
          // The voucher is used up (limit 1): the next draft with the same code gets the member discounts, on both sides.
          const next = await supply(await mixed(payer.id), shared.code);
          assert.equal(next.discount.sides?.[0]?.winnerSource, 'MEMBER_TIER');
          assert.equal(next.discount.sides?.[1]?.winnerSource, 'MEMBER_TIER');
          assert.equal(
            sideOf(next, 'SPA').candidates.find((c) => c.voucherCode === shared.code)?.reason,
            'TOTAL_LIMIT_REACHED',
          );
          await reconcilePricing();
        },
      );

      await suite.test(
        'worked example C: a shared voucher of 30,000 wins the Spa side only (Beauty keeps its Ruby member discount) and is still redeemed once',
        async () => {
          const payer = await member(1000, 10_000);
          const shared = await voucherProgram({ fixedAmountVnd: '30000', scope: 'BOTH' });
          const draft = await supply(await mixed(payer.id), shared.code);
          const done = await k.finalize(draft);
          assert.equal(sideOf(done, 'SPA').winnerSource, 'VOUCHER');
          assert.equal(sideOf(done, 'SPA').discountVnd, '18000');
          assert.equal(sideOf(done, 'BEAUTY').winnerSource, 'MEMBER_TIER');
          assert.equal(sideOf(done, 'BEAUTY').discountVnd, '18000');
          assert.equal(done.discountTotalVnd, '36000');
          assert.equal(done.totalVnd, '464000');
          const rows = await rowsOf(done.id);
          assert.equal(rows.redemptions.length, 1);
          assert.equal(rows.beautyApplication, null, 'its Beauty share (12,000) is not applied');
          assert.equal(rows.beautySnapshot?.winnerSource, 'MEMBER_TIER');
          assert.equal(rows.beautySnapshot?.memberAmountVnd, 18_000n);
          assert.equal(rows.spaApplication?.computedAmountVnd, 18_000n);
          assert.equal(rows.spaApplication?.sharedAmountVnd, 30_000n);
          // The candidate list still shows the Beauty share that was not used.
          assert.equal(
            sideOf(done, 'BEAUTY').candidates.find((c) => c.voucherCode === shared.code)?.amountVnd,
            '12000',
          );
          await k.pay(done.id, 464_000);
          await consume(done.id);
          assert.equal(await earned(done.id, 'SPA'), 282);
          await reconcilePricing();
        },
      );

      await suite.test(
        'worked example D: a product-only sale allocates its Beauty discount to the lines (nets 90,000 and 180,000)',
        async () => {
          const payer = await member(0, 500);
          const products = await voucherProgram({ fixedAmountVnd: '30000', scope: 'PRODUCTS' });
          let draft = await k.openSale(people.cashier, payer.id);
          draft = await k.addLine(draft, v100.id, 1);
          draft = await k.addLine(draft, v200.id, 1);
          draft = await supply(draft, products.code);
          const done = await k.finalize(draft);
          assert.equal(done.kind, 'PRODUCT_SALE');
          assert.equal(done.discount.sides?.length, 1, 'a product-only sale has no Spa side');
          assert.equal(sideOf(done, 'BEAUTY').discountVnd, '30000');
          const rows = await rowsOf(done.id);
          assert.deepEqual(
            rows.allocations
              .sort((a, b) => a.line.sequence - b.line.sequence)
              .map((entry) => [entry.discountShareVnd, entry.netVnd]),
            [
              [10_000n, 90_000n],
              [20_000n, 180_000n],
            ],
          );
          assert.equal(rows.spaSnapshot, null);
          assert.equal(rows.beautyApplication?.voucherId !== null, true);
          assert.equal(rows.beautySnapshot?.tier, 'SILVER');
          // The customer view takes the program name from the Beauty application when the Spa side has none.
          const view = await customerInvoiceDetail(tx, payer.id, done.id);
          assert.equal(view.discountTotalVnd, '30000');
          assert.ok(view.discount, 'the customer sees the program');
          await k.pay(done.id, 270_000);
          await consume(done.id);
          assert.equal(await earned(done.id, 'SPA'), 0, 'no Spa side, no Spa points');
          await reconcilePricing();
        },
      );

      await suite.test(
        'scope and targeting through the API: services, products or both; brands, that exact category, products; an edit must state the scope',
        async () => {
          const brand = await tx.brand.create({
            data: { code: `p69-${base.run.toLowerCase()}`, nameVi: 'Nhãn', nameEn: 'Brand' },
          });
          const otherBrand = await tx.brand.create({
            data: { code: `p69o-${base.run.toLowerCase()}`, nameVi: 'Nhãn khác', nameEn: 'Other' },
          });
          const category = await tx.productCategory.create({
            data: { code: `p69c-${base.run.toLowerCase()}`, nameVi: 'Nhóm', nameEn: 'Group' },
          });
          const child = await tx.productCategory.create({
            data: {
              code: `p69d-${base.run.toLowerCase()}`,
              nameVi: 'Nhóm con',
              nameEn: 'Child',
              parentId: category.id,
            },
          });
          await tx.product.update({
            where: { id: cream.id },
            data: { brandId: brand.id, categoryId: child.id, rowVersion: { increment: 1 } },
          });
          await tx.product.update({
            where: { id: serum.id },
            data: { brandId: otherBrand.id, rowVersion: { increment: 1 } },
          });
          // Validation: targets must fit the scope and the mode, and exist.
          const bad = (overrides: Partial<DiscountVersionInput>, field: string) =>
            fails(
              () =>
                programs.create(people.owner.token, {
                  code: `P69X${base.run}${++programNo}`.slice(0, 24),
                  nameVi: 'x',
                  nameEn: 'x',
                  requiresCode: true,
                  version: version(overrides),
                }),
              'VALIDATION_FAILED',
              field,
            );
          await bad({ scope: 'SERVICES', scopeMode: 'SELECTED', brandIds: [brand.id] }, 'brandIds');
          await bad(
            { scope: 'PRODUCTS', scopeMode: 'SELECTED', serviceIds: [randomUUID()] },
            'serviceIds',
          );
          await bad(
            { scope: 'PRODUCTS', scopeMode: 'SELECTED', brandIds: [randomUUID()] },
            'brandIds',
          );
          await bad({ scope: 'PRODUCTS', scopeMode: 'SELECTED', brandIds: [] }, 'serviceIds');
          await bad(
            { scope: 'PRODUCTS', scopeMode: 'ALL_SERVICES', brandIds: [brand.id] },
            'serviceIds',
          );
          await bad({ scope: 'EVERYTHING' as never }, 'scope');
          // A selection by brand discounts only the lines of that brand; by category only that EXACT category (not its parent).
          const byBrand = await voucherProgram({
            kind: 'PERCENT',
            percentBp: 1000,
            scope: 'PRODUCTS',
            scopeMode: 'SELECTED',
            brandIds: [brand.id],
          });
          const byParent = await voucherProgram({
            kind: 'PERCENT',
            percentBp: 1000,
            scope: 'PRODUCTS',
            scopeMode: 'SELECTED',
            productCategoryIds: [category.id],
          });
          const byChild = await voucherProgram({
            kind: 'PERCENT',
            percentBp: 1000,
            scope: 'PRODUCTS',
            scopeMode: 'SELECTED',
            productCategoryIds: [child.id],
          });
          const byProduct = await voucherProgram({
            kind: 'PERCENT',
            percentBp: 2000,
            scope: 'BOTH',
            scopeMode: 'SELECTED',
            productIds: [serum.id],
            serviceIds: [k.exact.id],
          });
          const sale = async (code: string) => {
            let draft = await k.openSale(people.cashier, null);
            draft = await k.addLine(draft, v200.id, 1); // cream: brand, child category: 200,000
            draft = await k.addLine(draft, v120.id, 1); // serum: other brand: 120,000
            return supply(draft, code);
          };
          assert.equal((await sale(byBrand.code)).discountTotalVnd, '20000');
          // OQ-66 (changed by the Owner, 2026-10-08): a category target also covers its subcategories.
          assert.equal(
            (await sale(byParent.code)).discountTotalVnd,
            '20000',
            'a parent includes its children',
          );
          assert.equal((await sale(byChild.code)).discountTotalVnd, '20000');
          assert.equal((await sale(byProduct.code)).discountTotalVnd, '24000');
          // The tree has two levels (the database refuses a grandchild): the serum moves to a SIBLING of the child, under the parent.
          const sibling = await tx.productCategory.create({
            data: {
              code: `p69f-${base.run.toLowerCase()}`,
              nameVi: 'Nhóm anh em',
              nameEn: 'Sibling',
              parentId: category.id,
            },
          });
          await tx.product.update({
            where: { id: serum.id },
            data: { categoryId: sibling.id, rowVersion: { increment: 1 } },
          });
          const target = (categoryId: string) =>
            voucherProgram({
              kind: 'PERCENT',
              percentBp: 1000,
              scope: 'PRODUCTS',
              scopeMode: 'SELECTED',
              productCategoryIds: [categoryId],
            });
          // cream (200,000) is in the child, serum (120,000) in its sibling: the parent covers both children, a child only itself.
          assert.equal((await sale((await target(category.id)).code)).discountTotalVnd, '32000');
          assert.equal(
            (await sale((await target(child.id)).code)).discountTotalVnd,
            '20000',
            'a sibling is not covered',
          );
          assert.equal((await sale((await target(sibling.id)).code)).discountTotalVnd, '12000');
          // A child target never reaches up: with the serum in the parent itself, only the cream (in the child) is covered.
          await tx.product.update({
            where: { id: serum.id },
            data: { categoryId: category.id, rowVersion: { increment: 1 } },
          });
          assert.equal((await sale((await target(child.id)).code)).discountTotalVnd, '20000');
          assert.equal((await sale((await target(category.id)).code)).discountTotalVnd, '32000');
          // A mixed invoice: the BOTH selection takes the exact service (200,000) and the serum (120,000): 20% of 320,000 = 64,000,
          // split 125,000 : 75,000... by what matched (200,000 of Spa, 120,000 of Beauty).
          let withServices: InvoiceResponse = await k.serviceDraft([k.exact, k.ranged], null);
          withServices = await k.addLine(withServices, v120.id, 1);
          withServices = await k.addLine(withServices, v200.id, 1);
          withServices = await supply(withServices, byProduct.code);
          assert.equal(sideOf(withServices, 'SPA').discountVnd, '40000');
          assert.equal(sideOf(withServices, 'BEAUTY').discountVnd, '24000');
          // The responses carry the scope and the targets; an edit that leaves the scope out is refused, one that states it is kept.
          const detail = await programs.get(people.owner.token, byProduct.id);
          assert.equal(detail.current.scope, 'BOTH');
          assert.deepEqual(detail.current.productIds, [serum.id]);
          assert.deepEqual(detail.current.serviceIds, [k.exact.id]);
          await fails(
            () =>
              programs.addVersion(people.owner.token, byProduct.id, {
                expectedVersion: detail.version,
                version: version({ scopeMode: 'ALL_SERVICES' }),
              }),
            'VALIDATION_FAILED',
            'scope',
          );
          const edited = await programs.addVersion(people.owner.token, byProduct.id, {
            expectedVersion: detail.version,
            version: version({ scope: 'PRODUCTS', scopeMode: 'ALL_SERVICES' }),
          });
          assert.equal(edited.current.scope, 'PRODUCTS');
          assert.deepEqual(edited.current.productIds, []);
          // A program written before Phase 6 is SERVICES, and editing it without a scope keeps it so.
          const legacy = await voucherProgram();
          const legacyDetail = await programs.get(people.owner.token, legacy.id);
          assert.equal(legacyDetail.current.scope, 'SERVICES');
          const legacyEdited = await programs.addVersion(people.owner.token, legacy.id, {
            expectedVersion: legacyDetail.version,
            version: version({ fixedAmountVnd: '40000' }),
          });
          assert.equal(legacyEdited.current.scope, 'SERVICES');
          // A SERVICES program never touches a product line.
          let services = await k.serviceDraft([k.exact], null);
          services = await k.addLine(services, v200.id, 1);
          services = await supply(services, legacy.code);
          assert.equal(sideOf(services, 'SPA').discountVnd, '40000');
          assert.equal(sideOf(services, 'BEAUTY').discountVnd, '0');
          await reconcilePricing();
        },
      );

      await suite.test(
        'two programs can win the two sides: two redemptions; cancelling the unpaid invoice releases both, the stock and the usage',
        async () => {
          const payer = await member(0, 0);
          const spaVoucher = await voucherProgram({
            fixedAmountVnd: '50000',
            scope: 'SERVICES',
            usageLimitTotal: 1,
          });
          const beautyVoucher = await voucherProgram({
            fixedAmountVnd: '20000',
            scope: 'PRODUCTS',
            usageLimitTotal: 1,
          });
          let draft = await supply(await mixed(payer.id), spaVoucher.code);
          draft = await supply(draft, beautyVoucher.code);
          assert.equal(sideOf(draft, 'SPA').discountVnd, '50000');
          assert.equal(sideOf(draft, 'BEAUTY').discountVnd, '20000');
          const reservedBefore = (await k.levelOf(v200.id))!.reserved;
          const done = await k.finalize(draft);
          const rows = await rowsOf(done.id);
          assert.equal(rows.redemptions.length, 2, 'one redemption per program');
          assert.ok(rows.spaApplication && rows.beautyApplication);
          assert.equal(rows.spaApplication.sharedAmountVnd, null);
          assert.equal(rows.beautyApplication.sharedAmountVnd, null);
          assert.equal(done.totalVnd, '430000');
          assert.equal((await k.levelOf(v200.id))!.reserved, reservedBefore + 1);
          const gone = await k.ok(() =>
            invoices.cancel(people.boss.token, done.id, {
              expectedVersion: done.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.equal(gone.status, 'CANCELLED');
          assert.equal((await k.levelOf(v200.id))!.reserved, reservedBefore);
          const after = await rowsOf(done.id);
          assert.ok(after.redemptions.every((entry) => entry.release !== null));
          assert.equal(
            await tx.discountRedemptionRelease.count({
              where: { redemption: { invoiceId: done.id } },
            }),
            2,
          );
          // The usage came back: both single-use vouchers can be used again.
          let again = await supply(await mixed(payer.id), spaVoucher.code);
          again = await supply(again, beautyVoucher.code);
          assert.equal(again.discountTotalVnd, '70000');
          await reconcilePricing();
        },
      );

      await suite.test(
        'the birthday gift stays on the Spa side: its base is the Spa side after the Spa winner; Beauty is untouched; cancelling returns the use',
        async () => {
          const today = (
            await tx.$queryRaw<{ d: string }[]>`
              SELECT to_char(lucy_branch_local_date(${A.id}::uuid, clock_timestamp()), 'MM-DD') AS d`
          )[0]!.d;
          const payer = await member(1000, 500, new Date(`2000-${today}T00:00:00.000Z`));
          const config = await tx.birthdayRewardConfig.create({
            data: { createdByUserId: people.owner.id },
            select: { id: true },
          });
          await tx.birthdayRewardVersion.create({
            data: {
              configId: config.id,
              versionNo: 1,
              isActive: true,
              kind: 'FIXED_AMOUNT',
              fixedAmountVnd: 20_000n,
              minSpendVnd: 0n,
              windowDaysBefore: 7,
              windowDaysAfter: 7,
              combineMember: true,
              combinePromotion: true,
              combineVoucher: true,
              usageLimitUnlimited: false,
              usageLimitPerYear: 5,
              createdByUserId: people.owner.id,
            },
          });
          const draft = await mixed(payer.id);
          assert.equal(sideOf(draft, 'SPA').birthday?.applied, true);
          assert.equal(sideOf(draft, 'BEAUTY').birthday, null);
          const done = await k.finalize(draft);
          // Spa: member 12,000, then 20,000 on the 288,000 left; Beauty: member 6,000 only.
          assert.equal(sideOf(done, 'SPA').discountVnd, '32000');
          assert.equal(sideOf(done, 'BEAUTY').discountVnd, '6000');
          assert.equal(done.totalVnd, '462000');
          const rows = await rowsOf(done.id);
          assert.equal(rows.spaSnapshot?.birthdayAmountVnd, 20_000n);
          assert.equal(rows.spaSnapshot?.birthdayBaseVnd, 288_000n);
          assert.equal(rows.gift?.amountVnd, 20_000n);
          assert.equal(rows.beautySnapshot?.memberAmountVnd, 6_000n);
          // The Spa side's shares include the gift: 32,000 over 200,000 and 100,000.
          assert.equal(
            shares(rows, 'SPA').reduce((a, b) => a + b, 0n),
            32_000n,
          );
          const gone = await k.ok(() =>
            invoices.cancel(people.boss.token, done.id, {
              expectedVersion: done.version,
              reason: 'Hủy',
            }),
          );
          assert.equal(gone.status, 'CANCELLED');
          const released = await tx.birthdayRedemption.findUniqueOrThrow({
            where: { invoiceId: done.id },
            include: { release: true },
          });
          assert.ok(released.release);
          // A product-only sale never has a gift, even on the payer's birthday.
          const only = await k.finalize(
            await k.addLine(await k.openSale(people.cashier, payer.id), v100.id, 1),
          );
          assert.equal(await tx.birthdayRedemption.count({ where: { invoiceId: only.id } }), 0);
          assert.equal(only.discountTotalVnd, '3000');
          await reconcilePricing();
        },
      );

      await suite.test(
        'payments are attributed to the sides pro-rata with a reversal that mirrors exactly: A, B, reverse A, C always end with each side at its net',
        async () => {
          const payer = await member(1000, 500);
          const done = await k.finalize(
            await mixed(payer.id, [
              [v200, 1],
              [v120, 1],
            ]),
          );
          // Spa 300,000 - 12,000 = 288,000; Beauty 320,000 - 9,600 = 310,400; total 598,400.
          assert.equal(done.totalVnd, '598400');
          const spaNet = 288_000n;
          const total = 598_400n;
          const attributedNow = async () => {
            const rows = await tx.paymentSideAllocation.findMany({ where: { invoiceId: done.id } });
            const sum = (side: 'SPA' | 'BEAUTY') =>
              rows.filter((entry) => entry.side === side).reduce((a, b) => a + b.amountVnd, 0n);
            return { spa: sum('SPA'), beauty: sum('BEAUTY') };
          };
          const a = await k.pay(done.id, 100_001);
          assert.deepEqual(await attributedNow(), {
            spa: cumulativeShare(100_001n, spaNet, total),
            beauty: 100_001n - cumulativeShare(100_001n, spaNet, total),
          });
          const b = await k.pay(done.id, 250_001);
          const paidAB = 350_002n;
          assert.deepEqual(await attributedNow(), {
            spa: cumulativeShare(paidAB, spaNet, total),
            beauty: paidAB - cumulativeShare(paidAB, spaNet, total),
          });
          // Reversing A removes exactly what A added (a mirror), whatever the rounding was.
          const before = await tx.paymentSideAllocation.findMany({
            where: { paymentId: a.payment.id },
          });
          await k.ok(() =>
            invoices.reversePayment(people.boss.token, done.id, a.payment.id, {
              reason: 'Nhập nhầm',
            }),
          );
          const mirror = await tx.paymentSideAllocation.findMany({
            where: { paymentId: a.payment.id, kind: 'REVERSAL' },
          });
          assert.deepEqual(
            mirror.map((entry) => [entry.side, entry.amountVnd]).sort(),
            before.map((entry) => [entry.side, -entry.amountVnd]).sort(),
          );
          const afterReversal = await attributedNow();
          assert.equal(afterReversal.spa + afterReversal.beauty, 250_001n);
          // C pays the rest: the sides realign to their nets exactly.
          const c = await k.pay(done.id, 598_400 - 250_001);
          assert.equal(c.invoice.status, 'PAID');
          assert.deepEqual(await attributedNow(), { spa: spaNet, beauty: 310_400n });
          assert.ok(b.payment.id);
          await reconcilePricing();
        },
      );

      await suite.test(
        'a draft is version 2 until it is finalized; removing the product line before finalization makes it an ordinary service-only invoice',
        async () => {
          const payer = await member(1000, 500);
          const draft = await mixed(payer.id);
          assert.equal(draft.calculationVersion, 2);
          assert.equal(draft.productLines.length, 1);
          const edited = await k.ok(() =>
            invoices.removeProductLine(people.cashier.token, draft.id, draft.productLines[0]!.id, {
              expectedVersion: draft.version,
            }),
          );
          assert.equal(edited.productLines.length, 0);
          assert.equal(edited.discount.sides, undefined, 'a service-only draft has no sides');
          assert.equal(edited.discountTotalVnd, '12000');
          const done = await k.finalize(edited);
          assert.equal(
            done.calculationVersion,
            2,
            'no product line: the version 2 engine, as before',
          );
          assert.equal(done.discount.sides, undefined);
          const rows = await rowsOf(done.id);
          assert.equal(rows.allocations.length, 0);
          assert.equal(rows.beautySnapshot, null);
          const audit = await tx.auditEvent.findFirstOrThrow({
            where: { entityId: done.id, action: 'INVOICE_FINALIZED' },
          });
          assert.equal(Reflect.has(Object(audit.after), 'pricing'), false);
          await reconcilePricing();
        },
      );

      await suite.test(
        'OQ-59 safety net: a service-only invoice is charged by version 2 even when version 3 differs or fails; the difference is logged, recorded and sent as an event',
        async () => {
          const alerts: Record<string, unknown>[] = [];
          const originalAlert = shadowAlert.error;
          const originalEvaluate = shadowControl.evaluate;
          shadowAlert.error = (entry) => {
            alerts.push(entry);
          };
          const mismatchRows = (invoiceId: string) =>
            tx.auditEvent.findMany({
              where: { entityId: invoiceId, action: 'PRICING_V3_MISMATCH' },
            });
          try {
            const payer = await member(1000, 0);
            // 1. Agreement: nothing is logged, recorded or sent.
            const agreeing = await k.finalize(await k.serviceDraft([k.exact, k.ranged], payer.id));
            assert.equal(agreeing.discountTotalVnd, '12000');
            assert.deepEqual(alerts, []);
            assert.equal((await mismatchRows(agreeing.id)).length, 0);
            assert.equal(
              await tx.outboxEvent.count({
                where: { aggregateId: agreeing.id, eventType: 'PRICING_V3_MISMATCH' },
              }),
              0,
            );
            // 2. A version 3 that disagrees by 1 VND: the version 2 amount is charged, the difference is reported.
            shadowControl.evaluate = (input) => {
              const real = evaluatePricingV3(input);
              return {
                ...real,
                discountTotalVnd: real.discountTotalVnd + 1n,
                totalVnd: real.totalVnd - 1n,
              };
            };
            const twin = await k.serviceDraft([k.exact, k.ranged], payer.id);
            const differing = await k.finalize(twin);
            assert.equal(differing.discountTotalVnd, '12000', 'the charged discount is version 2');
            assert.equal(differing.totalVnd, '288000', 'the charged total is version 2');
            assert.equal(alerts.length, 1);
            assert.equal(alerts[0]!['code'], 'PRICING_V3_MISMATCH');
            assert.equal(alerts[0]!['invoiceId'], differing.id);
            const recorded = await mismatchRows(differing.id);
            assert.equal(recorded.length, 1);
            const fields = (
              recorded[0]!.after as { mismatches: { field: string }[] }
            ).mismatches.map((entry) => entry.field);
            assert.ok(fields.includes('discountTotalVnd') && fields.includes('totalVnd'));
            const event = await tx.outboxEvent.findFirstOrThrow({
              where: { aggregateId: differing.id, eventType: 'PRICING_V3_MISMATCH' },
            });
            assert.equal(Object(event.payload).invoiceId, differing.id);
            // 3. A version 3 that throws: the finalization still succeeds with the version 2 amount, and the failure is reported.
            shadowControl.evaluate = () => {
              throw new Error('boom');
            };
            const failing = await k.finalize(await k.serviceDraft([k.exact, k.ranged], payer.id));
            assert.equal(failing.discountTotalVnd, '12000');
            assert.equal(failing.status, 'PENDING_PAYMENT');
            assert.equal(alerts.length, 2);
            const failure = await mismatchRows(failing.id);
            assert.deepEqual(
              (failure[0]!.after as { mismatches: { field: string }[] }).mismatches.map(
                (entry) => entry.field,
              ),
              ['v3.error'],
            );
            // The invoice and payment path is untouched either way: it is paid and reconciles like any other.
            await k.pay(differing.id, 288_000);
            const paid = await invoices.get(people.cashier.token, differing.id);
            assert.equal(paid.status, 'PAID');
            await reconcilePricing();
          } finally {
            shadowAlert.error = originalAlert;
            shadowControl.evaluate = originalEvaluate;
          }
        },
      );

      await suite.test(
        'a service-only invoice writes none of the new rows and keeps its exact shape (version 2, no allocation, no side attribution)',
        async () => {
          const payer = await member(1000, 0);
          const done = await k.finalize(await k.serviceDraft([k.exact, k.ranged], payer.id));
          assert.equal(done.calculationVersion, 2);
          assert.equal(done.discount.sides, undefined);
          await k.pay(done.id, 288_000);
          const rows = await rowsOf(done.id);
          assert.equal(rows.allocations.length, 0);
          assert.equal(rows.beautySnapshot, null);
          assert.equal(await tx.paymentSideAllocation.count({ where: { invoiceId: done.id } }), 0);
          assert.equal(rows.spaSnapshot?.calculationVersion, 2);
          await consume(done.id);
          assert.equal(await earned(done.id, 'SPA'), 288);
          await reconcilePricing();
        },
      );
    });
  },
);
