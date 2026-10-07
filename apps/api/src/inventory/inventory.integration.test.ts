import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { InventoryVariantDetailResponse, StockReceiptLineRequest } from '@lucy-spa/contracts';
import { parseNotificationParams } from '@lucy-spa/contracts';
import type { DatabaseClient } from '@lucy-spa/database';
import {
  processFinancialNotificationEvent,
  processLowStockAlert,
  runExpiryScan,
} from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { InventoryService } from './inventory.service.js';

/**
 * Phase 6 P6-4 inventory (design 4; Owner decisions 2026-10-07) against real PostgreSQL: authority per permission and per branch
 * (a holder at branch A never sees branch B), the unit cost cut at the API for anyone without VIEW_PRODUCT_COST, suppliers,
 * receipts (draft, edit, confirm once, cancel, the event without a cost), levels and lots with the branch-local expiry, adjustments
 * (reason, lot, never below zero, idempotent), physical counts (earliest expiry first, found stock on its own lot), the low-stock
 * alert and the daily expiry scan as in-app notifications for VIEW_INVENTORY holders only. Every fixture rolls back.
 */
test(
  'Phase 6 P6-4 inventory: authority, cost privacy, receipts, adjustments, counts, alerts; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (kit) => {
      const { tx, run, fails } = kit;
      const inv = new InventoryService(kit.adapter, kit.throttle, kit.environment);
      const A = await kit.branch('A');
      const B = await kit.branch('B');

      const manager = await kit.staff(['MANAGE_PRODUCTS']);
      const viewerA = await kit.staff(['VIEW_INVENTORY'], { branchId: A.id });
      const receiverA = await kit.staff(['MANAGE_STOCK_RECEIPTS'], { branchId: A.id });
      const receiverCost = await kit.staff(['MANAGE_STOCK_RECEIPTS'], {
        branchId: A.id,
        globalCodes: ['VIEW_PRODUCT_COST'],
      });
      const adjusterA = await kit.staff(['ADJUST_STOCK', 'VIEW_INVENTORY'], { branchId: A.id });
      const viewerB = await kit.staff(['VIEW_INVENTORY'], { branchId: B.id });
      const receiverB = await kit.staff(['MANAGE_STOCK_RECEIPTS'], { branchId: B.id });
      const nobody = await kit.staff([]);
      const owner = { token: kit.ownerToken };

      const day = async (offset: number, zone = 'Asia/Ho_Chi_Minh') =>
        (
          await tx.$queryRawUnsafe<{ d: string }[]>(
            `SELECT to_char((clock_timestamp() AT TIME ZONE '${zone}')::date + ${offset}, 'YYYY-MM-DD') AS d`,
          )
        )[0]!.d;

      const product = await tx.product.create({
        data: {
          code: `inv-${run.toLowerCase()}`,
          nameVi: 'Kem tồn kho',
          nameEn: `Inventory cream ${run}`,
          createdByUserId: manager.id,
          variants: {
            create: [
              { sku: `INV-${run}-A`, labelVi: '50 ml', lowStockThreshold: 5, sortOrder: 1 },
              { sku: `INV-${run}-B`, labelVi: '100 ml', sortOrder: 2 },
              { sku: `INV-${run}-C`, labelVi: '150 ml', sortOrder: 3 },
            ],
          },
        },
        include: { variants: true },
      });
      const sorted = [...product.variants].sort((a, b) => a.sortOrder - b.sortOrder);
      const [vA, vB, vC] = sorted.map((variant) => variant.id) as [string, string, string];
      const retired = await tx.productVariant.create({
        data: { productId: product.id, sku: `INV-${run}-X`, isActive: false },
      });

      const line = (
        variantId: string,
        quantity: number,
        extra: Partial<StockReceiptLineRequest> = {},
      ): StockReceiptLineRequest => ({
        variantId,
        quantity,
        lotCode: null,
        expiryDate: null,
        ...extra,
      });
      const receive = async (
        token: string,
        branchId: string,
        lines: StockReceiptLineRequest[],
        supplierId: string | null = null,
      ) => {
        const draft = await inv.createReceipt(token, {
          branchId,
          supplierId,
          receiptDate: await day(0),
          notes: null,
          lines,
        });
        return inv.confirmReceipt(token, draft.id, { expectedRowVersion: draft.rowVersion });
      };
      const stockOf = async (branchId: string, variantId: string) =>
        (await tx.stockLevel.findUnique({ where: { branchId_variantId: { branchId, variantId } } }))
          ?.onHand ?? 0;
      const noCost = (value: unknown) =>
        assert.ok(!/unitCost|totalCost|costPrice/i.test(JSON.stringify(value)), 'no cost anywhere');

      await suite.test(
        'authority is per permission and per branch; nothing opens without it',
        async () => {
          const context = await inv.context(viewerA.token);
          assert.deepEqual(
            context.branches.map((branch) => [
              branch.id,
              branch.view,
              branch.receipts,
              branch.adjust,
            ]),
            [[A.id, true, false, false]],
          );
          assert.deepEqual([context.manageProducts, context.cost], [false, false]);
          const ownerContext = await inv.context(owner.token);
          const ownerA = ownerContext.branches.find((branch) => branch.id === A.id);
          assert.deepEqual([ownerA?.view, ownerA?.receipts, ownerA?.adjust], [true, true, true]);
          assert.equal(
            (await inv.context(manager.token)).branches.length,
            0,
            'a global product manager works no branch',
          );
          assert.equal((await inv.context(manager.token)).manageProducts, true);
          assert.equal((await inv.context(receiverCost.token)).cost, true);
          await fails(() => inv.context(nobody.token), 'FORBIDDEN');
          await fails(() => inv.context(undefined), 'AUTHENTICATION_REQUIRED');

          assert.equal((await inv.overview(viewerA.token, A.id)).branchId, A.id);
          for (const who of [viewerB, receiverA, nobody, manager]) {
            await fails(() => inv.overview(who.token, A.id), 'FORBIDDEN');
          }
          await fails(() => inv.overview(viewerA.token, B.id), 'FORBIDDEN');
          await fails(
            () => inv.overview(viewerA.token, 'not-a-uuid'),
            'VALIDATION_FAILED',
            'branchId',
          );
          assert.equal((await inv.variantDetail(viewerA.token, A.id, vA)).item.variantId, vA);
          await fails(() => inv.variantDetail(viewerA.token, B.id, vA), 'FORBIDDEN');
          await fails(
            () => inv.variantDetail(viewerA.token, A.id, '00000000-0000-4000-8000-000000000000'),
            'NOT_FOUND',
          );
          for (const who of [receiverA, adjusterA]) {
            assert.ok((await inv.variantOptions(who.token)).variants.length >= 3);
          }
          await fails(() => inv.variantOptions(viewerA.token), 'FORBIDDEN');
          const options = (await inv.variantOptions(receiverA.token)).variants.map(
            (v) => v.variantId,
          );
          assert.ok(
            options.includes(vA) && !options.includes(retired.id),
            'retired variants are not offered',
          );
        },
      );

      await suite.test(
        'suppliers: read by receipt holders, written by product managers, names unique',
        async () => {
          await fails(() => inv.suppliers(viewerA.token), 'FORBIDDEN');
          const asReceiver = await inv.suppliers(receiverA.token);
          assert.equal(asReceiver.manage, false);
          const base = {
            contactName: 'Chị Lan',
            phone: '0900 000 001',
            email: 'ncc@example.com',
            address: null,
            notes: null,
          };
          await fails(
            () => inv.createSupplier(receiverA.token, { name: `NCC ${run}`, ...base }),
            'FORBIDDEN',
          );
          const created = await inv.createSupplier(manager.token, { name: `NCC ${run}`, ...base });
          assert.equal(created.receiptCount, 0);
          await fails(
            () => inv.createSupplier(manager.token, { name: `ncc ${run.toLowerCase()}`, ...base }),
            'CONFLICT',
            'name',
          );
          await fails(
            () => inv.createSupplier(manager.token, { name: ' ', ...base }),
            'VALIDATION_FAILED',
            'name',
          );
          await fails(
            () => inv.createSupplier(manager.token, { name: `Y ${run}`, ...base, email: 'nope' }),
            'VALIDATION_FAILED',
            'email',
          );
          assert.ok(
            (await inv.suppliers(manager.token)).suppliers.some((s) => s.id === created.id),
          );
          await fails(
            () =>
              inv.editSupplier(manager.token, created.id, {
                ...created,
                expectedRowVersion: 9,
                isActive: true,
              }),
            'CONFLICT',
          );
          const off = await inv.editSupplier(manager.token, created.id, {
            ...created,
            expectedRowVersion: created.rowVersion,
            isActive: false,
          });
          assert.equal(off.isActive, false);
          // A switched-off supplier cannot be named on a new receipt.
          await fails(
            () =>
              inv.createReceipt(receiverA.token, {
                branchId: A.id,
                supplierId: created.id,
                receiptDate: '2027-01-01',
                notes: null,
                lines: [line(vA, 1)],
              }),
            'VALIDATION_FAILED',
            'supplierId',
          );
        },
      );

      await suite.test(
        'receipts: draft, edit, confirm once; stock, lots, movements and the event follow',
        async () => {
          const supplier = await inv.createSupplier(manager.token, {
            name: `Nhà cung cấp ${run}`,
            contactName: null,
            phone: null,
            email: null,
            address: null,
            notes: null,
          });
          const expiry = await day(120);
          const draft = await inv.createReceipt(receiverA.token, {
            branchId: A.id,
            supplierId: supplier.id,
            receiptDate: await day(0),
            notes: 'Đợt nhập đầu',
            lines: [line(vA, 10, { lotCode: 'LOT-1', expiryDate: expiry }), line(vB, 4)],
          });
          assert.match(draft.code, /^PN\d{6}$/);
          assert.equal(draft.status, 'DRAFT');
          assert.equal(draft.lines.length, 2);
          noCost(draft);
          assert.equal(await stockOf(A.id, vA), 0, 'a draft moves no stock');

          // A cost needs VIEW_PRODUCT_COST: refused before anything is written.
          const before = await tx.stockReceipt.count();
          await fails(
            () =>
              inv.createReceipt(receiverA.token, {
                branchId: A.id,
                supplierId: null,
                receiptDate: '2027-01-01',
                notes: null,
                lines: [line(vA, 1, { unitCostVnd: '100' })],
              }),
            'FORBIDDEN',
          );
          assert.equal(await tx.stockReceipt.count(), before);

          // Validation of the request.
          const bad =
            (lines: StockReceiptLineRequest[], extra: object = {}) =>
            () =>
              inv.createReceipt(receiverA.token, {
                branchId: A.id,
                supplierId: null,
                receiptDate: '2027-01-01',
                notes: null,
                lines,
                ...extra,
              });
          await fails(bad([]), 'VALIDATION_FAILED', 'lines');
          await fails(bad([line(vA, 0)]), 'VALIDATION_FAILED', 'quantity');
          await fails(bad([line(vA, 1.5)]), 'VALIDATION_FAILED', 'quantity');
          await fails(
            bad([line(vA, 1, { expiryDate: await day(-1) })]),
            'VALIDATION_FAILED',
            'expiryDate',
          );
          await fails(
            bad([line(vA, 1, { expiryDate: '2027-02-30' })]),
            'VALIDATION_FAILED',
            'expiryDate',
          );
          await fails(bad([line(retired.id, 1)]), 'INVENTORY_VARIANT_UNAVAILABLE', 'variantId');
          await fails(
            bad([line('00000000-0000-4000-8000-000000000000', 1)]),
            'VALIDATION_FAILED',
            'variantId',
          );
          await fails(
            bad([line(vA, 1)], { receiptDate: '01/01/2027' }),
            'VALIDATION_FAILED',
            'receiptDate',
          );
          await fails(
            bad([{ ...line(vA, 1), weight: 3 } as StockReceiptLineRequest]),
            'VALIDATION_FAILED',
            'lines',
          );
          await fails(
            () =>
              inv.createReceipt(viewerA.token, {
                branchId: A.id,
                supplierId: null,
                receiptDate: '2027-01-01',
                notes: null,
                lines: [line(vA, 1)],
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              inv.createReceipt(receiverA.token, {
                branchId: B.id,
                supplierId: null,
                receiptDate: '2027-01-01',
                notes: null,
                lines: [line(vA, 1)],
              }),
            'FORBIDDEN',
          );

          // Edit replaces the lines of a draft; the version is checked.
          const edited = await inv.editReceipt(receiverA.token, draft.id, {
            expectedRowVersion: draft.rowVersion,
            supplierId: supplier.id,
            receiptDate: draft.receiptDate,
            notes: 'Đã sửa',
            lines: [
              line(vA, 10, { lotCode: 'LOT-1', expiryDate: expiry }),
              line(vB, 6),
              line(vC, 3),
            ],
          });
          assert.equal(edited.lines.length, 3);
          assert.equal(edited.rowVersion, draft.rowVersion + 1);
          await fails(
            () =>
              inv.editReceipt(receiverA.token, draft.id, {
                expectedRowVersion: draft.rowVersion,
                supplierId: null,
                receiptDate: draft.receiptDate,
                notes: null,
                lines: [line(vA, 1)],
              }),
            'CONFLICT',
          );
          // Another branch's holder cannot touch or read it.
          await fails(
            () =>
              inv.confirmReceipt(receiverB.token, draft.id, {
                expectedRowVersion: edited.rowVersion,
              }),
            'FORBIDDEN',
          );
          await fails(() => inv.receipt(receiverB.token, draft.id), 'FORBIDDEN');

          const confirmed = await inv.confirmReceipt(receiverA.token, draft.id, {
            expectedRowVersion: edited.rowVersion,
          });
          assert.equal(confirmed.status, 'CONFIRMED');
          assert.ok(confirmed.confirmedAt && confirmed.confirmedByName);
          assert.equal(await stockOf(A.id, vA), 10);
          assert.equal(await stockOf(A.id, vB), 6);
          assert.equal(await stockOf(A.id, vC), 3);
          assert.equal(await stockOf(B.id, vA), 0, 'stock is per branch');
          const lotA = await tx.inventoryLot.findFirstOrThrow({
            where: { branchId: A.id, variantId: vA },
          });
          assert.equal(lotA.lotCode, 'LOT-1');
          assert.equal(lotA.expiryDate?.toISOString().slice(0, 10), expiry);
          const lotB = await tx.inventoryLot.findFirstOrThrow({
            where: { branchId: A.id, variantId: vB },
          });
          assert.equal(
            lotB.lotCode,
            `${draft.code}-2`,
            'a line without a lot code gets one from the receipt',
          );
          assert.equal(
            await tx.stockMovement.count({
              where: { kind: 'RECEIPT', receiptLine: { receipt: { id: draft.id } } },
            }),
            3,
          );
          // The second confirmation (a double click, a second person) changes nothing.
          await fails(
            () =>
              inv.confirmReceipt(receiverA.token, draft.id, {
                expectedRowVersion: edited.rowVersion,
              }),
            'CONFLICT',
          );
          await fails(
            () =>
              inv.confirmReceipt(receiverA.token, draft.id, {
                expectedRowVersion: confirmed.rowVersion,
              }),
            'INVENTORY_RECEIPT_NOT_DRAFT',
          );
          assert.equal(await stockOf(A.id, vA), 10);
          await fails(
            () =>
              inv.editReceipt(receiverA.token, draft.id, {
                expectedRowVersion: confirmed.rowVersion,
                supplierId: null,
                receiptDate: draft.receiptDate,
                notes: null,
                lines: [line(vA, 1)],
              }),
            'INVENTORY_RECEIPT_NOT_DRAFT',
          );
          await fails(
            () =>
              inv.cancelReceipt(receiverA.token, draft.id, {
                expectedRowVersion: confirmed.rowVersion,
                reason: 'Nhầm',
              }),
            'INVENTORY_RECEIPT_NOT_DRAFT',
          );

          // The event carries ids and quantities only, and no relay or consumer swallows it.
          const event = await tx.outboxEvent.findFirstOrThrow({
            where: { eventType: 'STOCK_RECEIPT_CONFIRMED', aggregateId: draft.id },
          });
          assert.equal(event.aggregateType, 'StockReceipt');
          assert.equal(event.branchId, A.id);
          assert.equal(event.publishedAt, null);
          const payload = event.payload as {
            receiptId: string;
            lines: { variantId: string; quantity: number }[];
          };
          assert.equal(payload.receiptId, draft.id);
          assert.deepEqual(
            payload.lines.map((l) => l.quantity).sort((a, b) => a - b),
            [3, 6, 10],
          );
          assert.ok(!/cost|price|name/i.test(JSON.stringify(event.payload)));
          assert.equal(await processFinancialNotificationEvent(tx, event.id), 'IGNORED');
          // Audit.
          const audit = await tx.auditEvent.findFirstOrThrow({
            where: { action: 'STOCK_RECEIPT_CONFIRMED', entityId: draft.id },
          });
          assert.equal(audit.branchId, A.id);
          assert.equal(audit.actorUserId, receiverA.id);
          assert.ok(!/cost/i.test(JSON.stringify(audit.after)));

          // Cancel: a draft, with a reason.
          const second = await inv.createReceipt(receiverA.token, {
            branchId: A.id,
            supplierId: null,
            receiptDate: await day(0),
            notes: null,
            lines: [line(vB, 1)],
          });
          await fails(
            () =>
              inv.cancelReceipt(receiverA.token, second.id, {
                expectedRowVersion: second.rowVersion,
                reason: ' ',
              }),
            'VALIDATION_FAILED',
            'reason',
          );
          const cancelled = await inv.cancelReceipt(receiverA.token, second.id, {
            expectedRowVersion: second.rowVersion,
            reason: 'Nhập nhầm',
          });
          assert.equal(cancelled.status, 'CANCELLED');
          assert.equal(cancelled.cancelReason, 'Nhập nhầm');
          assert.equal(await stockOf(A.id, vB), 6, 'a cancelled draft moves nothing');

          const list = await inv.receipts(receiverA.token, A.id);
          assert.deepEqual(
            list.receipts.map((receipt) => receipt.code),
            [second.code, draft.code],
            'newest first',
          );
          assert.ok(list.receipts.every((receipt) => receipt.totalCostVnd === undefined));
          noCost(list);
          await fails(() => inv.receipts(viewerA.token, A.id), 'FORBIDDEN');
          assert.equal(
            (await inv.receipts(receiverB.token, B.id)).receipts.length,
            0,
            'branch B sees nothing of A',
          );
        },
      );

      await suite.test('the unit cost exists only for VIEW_PRODUCT_COST, everywhere', async () => {
        const costed = await inv.createReceipt(receiverCost.token, {
          branchId: A.id,
          supplierId: null,
          receiptDate: await day(0),
          notes: null,
          lines: [line(vA, 4, { unitCostVnd: '120000' }), line(vB, 2, { unitCostVnd: null })],
        });
        assert.equal(costed.cost, true);
        assert.deepEqual(
          costed.lines.map((l) => l.unitCostVnd),
          ['120000', null],
        );
        const asOther = await inv.receipt(receiverA.token, costed.id);
        assert.equal(asOther.cost, false);
        noCost(asOther);
        // A caller who cannot see the cost edits the draft and keeps it (same line and variant); a new line has none.
        const kept = await inv.editReceipt(receiverA.token, costed.id, {
          expectedRowVersion: costed.rowVersion,
          supplierId: null,
          receiptDate: costed.receiptDate,
          notes: 'Không đổi giá vốn',
          lines: [line(vA, 5), line(vB, 2), line(vC, 1)],
        });
        noCost(kept);
        const seen = await inv.receipt(receiverCost.token, costed.id);
        assert.deepEqual(
          seen.lines.map((l) => l.unitCostVnd),
          ['120000', null, null],
        );
        const listed = (await inv.receipts(receiverCost.token, A.id)).receipts.find(
          (r) => r.id === costed.id,
        );
        assert.equal(listed?.totalCostVnd, String(5 * 120000));
        await fails(
          () =>
            inv.editReceipt(receiverA.token, costed.id, {
              expectedRowVersion: seen.rowVersion,
              supplierId: null,
              receiptDate: costed.receiptDate,
              notes: null,
              lines: [line(vA, 5, { unitCostVnd: '1' })],
            }),
          'FORBIDDEN',
        );
        await fails(
          () =>
            inv.createReceipt(receiverCost.token, {
              branchId: A.id,
              supplierId: null,
              receiptDate: '2027-01-01',
              notes: null,
              lines: [line(vA, 1, { unitCostVnd: '-5' })],
            }),
          'VALIDATION_FAILED',
          'unitCostVnd',
        );
        const confirmed = await inv.confirmReceipt(receiverCost.token, costed.id, {
          expectedRowVersion: seen.rowVersion,
        });
        assert.equal(confirmed.status, 'CONFIRMED');
        // The lot carries the cost; the stock screens show it only to a cost holder (and a viewer never).
        const asViewer = await inv.variantDetail(viewerA.token, A.id, vA);
        noCost(asViewer);
        const lotWithCost = await tx.inventoryLot.findFirstOrThrow({
          where: { branchId: A.id, variantId: vA, unitCostVnd: 120000n },
        });
        assert.ok(lotWithCost);
        const asOwner = await inv.variantDetail(owner.token, A.id, vA);
        assert.ok(asOwner.lots.some((lot) => lot.unitCostVnd === '120000'));
        for (const movement of asOwner.movements) assert.ok(!('unitCostVnd' in movement));
      });

      await suite.test('levels: on hand, available and the branch-local expiry flags', async () => {
        const overview = await inv.overview(viewerA.token, A.id);
        assert.equal(overview.expiryWarningDays, 90);
        const a = overview.items.find((item) => item.variantId === vA)!;
        assert.equal(a.sku, `INV-${run}-A`);
        assert.equal(a.onHand, a.available, 'nothing reserved yet');
        assert.equal(a.lotCount >= 1, true);
        assert.equal(a.lowStockThreshold, 5);
        // The lot of this fixture expires in 120 days: outside the 90 day window.
        assert.equal(a.expiryAlert, false);
        assert.ok(
          !overview.items.some((item) => item.variantId === retired.id),
          'a retired variant without stock is not listed',
        );
        const soon = await receive(receiverA.token, A.id, [
          line(vC, 2, { lotCode: 'SOON', expiryDate: await day(10) }),
        ]);
        assert.equal(soon.status, 'CONFIRMED');
        const c = (await inv.overview(viewerA.token, A.id)).items.find(
          (item) => item.variantId === vC,
        )!;
        assert.equal(c.expiryAlert, true);
        assert.equal(c.nextExpiry, await day(10));
        // Other branches see none of it.
        const b = (await inv.overview(viewerB.token, B.id)).items.find(
          (item) => item.variantId === vC,
        )!;
        assert.deepEqual([b.onHand, b.available, b.lotCount, b.nextExpiry], [0, 0, 0, null]);
        // The database function is the one definition of available.
        const [fn] = await tx.$queryRaw<
          { n: number }[]
        >`SELECT lucy_available_stock(${A.id}::uuid, ${vC}::uuid)::int AS n`;
        assert.equal(fn!.n, c.available);
      });

      let adjustLot = '';
      const adjusting = async (): Promise<InventoryVariantDetailResponse> => {
        const detail = await inv.variantDetail(adjusterA.token, A.id, vB);
        adjustLot = detail.lots.find((lot) => lot.quantityOnHand > 0)!.id;
        return detail;
      };
      await suite.test('adjustments take stock out of one lot with a reason, once', async () => {
        const detail = await adjusting();
        const onHand = detail.item.onHand;
        const request = (quantity: number, reason = 'DAMAGED', key = randomUUID()) => ({
          requestKey: key,
          branchId: A.id,
          variantId: vB,
          lotId: adjustLot,
          quantity,
          reason: reason as 'DAMAGED',
          note: 'Vỡ khi vận chuyển',
        });
        await fails(() => inv.adjust(viewerA.token, request(1)), 'FORBIDDEN');
        await fails(() => inv.adjust(receiverA.token, request(1)), 'FORBIDDEN');
        await fails(() => inv.adjust(nobody.token, request(1)), 'FORBIDDEN');
        await fails(
          () => inv.adjust(adjusterA.token, { ...request(1), branchId: B.id }),
          'FORBIDDEN',
        );
        await fails(() => inv.adjust(adjusterA.token, request(0)), 'VALIDATION_FAILED', 'quantity');
        await fails(
          () => inv.adjust(adjusterA.token, request(1, 'COUNT_CORRECTION')),
          'VALIDATION_FAILED',
          'reason',
        );
        await fails(
          () => inv.adjust(adjusterA.token, request(1, 'GIFT')),
          'VALIDATION_FAILED',
          'reason',
        );
        await fails(
          () => inv.adjust(adjusterA.token, { ...request(1), requestKey: 'x' }),
          'VALIDATION_FAILED',
          'requestKey',
        );
        await fails(
          () =>
            inv.adjust(adjusterA.token, {
              ...request(1),
              lotId: '00000000-0000-4000-8000-000000000000',
            }),
          'NOT_FOUND',
        );
        await fails(
          () => inv.adjust(adjusterA.token, { ...request(1), variantId: vA }),
          'NOT_FOUND',
        );
        await fails(
          () => inv.adjust(adjusterA.token, request(onHand + 1)),
          'INVENTORY_INSUFFICIENT_STOCK',
          'quantity',
        );
        assert.equal(await stockOf(A.id, vB), onHand, 'refusals wrote nothing');

        const key = randomUUID();
        const after = await inv.adjust(adjusterA.token, request(2, 'LOSS', key));
        assert.equal(after.item.onHand, onHand - 2);
        const movement = after.movements[0]!;
        assert.deepEqual(
          [movement.kind, movement.quantityDelta, movement.reason],
          ['ADJUSTMENT', -2, 'LOSS'],
        );
        assert.equal(movement.note, 'Vỡ khi vận chuyển');
        // Sending the same request again returns the same result and writes nothing twice.
        const again = await inv.adjust(adjusterA.token, request(2, 'LOSS', key));
        assert.equal(again.item.onHand, onHand - 2);
        assert.equal(await tx.stockMovement.count({ where: { idempotencyKey: `ADJ:${key}` } }), 1);
        // The same key with other content is refused.
        await fails(
          () => inv.adjust(adjusterA.token, request(1, 'LOSS', key)),
          'CONFLICT',
          'requestKey',
        );
        await fails(
          () => inv.adjust(owner.token, request(2, 'LOSS', key)),
          'CONFLICT',
          'requestKey',
        );
        // An adjustment is not revenue and never changes another variant or branch.
        assert.equal(await stockOf(B.id, vB), 0);
        // Everything out is allowed, never below zero.
        const rest = await inv.variantDetail(adjusterA.token, A.id, vB);
        const last = rest.lots.find((lot) => lot.id === adjustLot)!.quantityOnHand;
        const emptied = await inv.adjust(adjusterA.token, request(last, 'INTERNAL_USE'));
        assert.equal(emptied.lots.find((lot) => lot.id === adjustLot)!.quantityOnHand, 0);
        await fails(() => inv.adjust(adjusterA.token, request(1)), 'INVENTORY_INSUFFICIENT_STOCK');
        assert.ok(emptied.canAdjust);
        assert.equal((await inv.variantDetail(viewerA.token, A.id, vB)).canAdjust, false);
      });

      await suite.test(
        'counts: differences become correction movements, earliest expiry first',
        async () => {
          // One variant with three lots: expiry far, none, near. Total 9.
          const solo = await tx.productVariant.create({
            data: { productId: product.id, sku: `INV-${run}-D`, sortOrder: 4 },
          });
          await receive(receiverA.token, A.id, [
            line(solo.id, 4, { lotCode: 'FAR', expiryDate: await day(200) }),
            line(solo.id, 3, { lotCode: 'NONE' }),
            line(solo.id, 2, { lotCode: 'NEAR', expiryDate: await day(30) }),
          ]);
          assert.equal(await stockOf(A.id, solo.id), 9);
          await fails(
            () =>
              inv.createCount(viewerA.token, {
                branchId: A.id,
                notes: null,
                variantIds: [solo.id],
              }),
            'FORBIDDEN',
          );
          await fails(
            () => inv.createCount(adjusterA.token, { branchId: A.id, notes: null, variantIds: [] }),
            'VALIDATION_FAILED',
            'variantIds',
          );
          await fails(
            () =>
              inv.createCount(adjusterA.token, {
                branchId: A.id,
                notes: null,
                variantIds: ['00000000-0000-4000-8000-000000000000'],
              }),
            'VALIDATION_FAILED',
            'variantIds',
          );
          const count = await inv.createCount(adjusterA.token, {
            branchId: A.id,
            notes: 'Cuối tháng',
            variantIds: [solo.id, vA, vC],
          });
          assert.match(count.code, /^KK\d{6}$/);
          assert.equal(count.status, 'OPEN');
          assert.equal(count.lines.length, 3);
          assert.ok(
            count.lines.every((l) => l.countedQuantity === l.currentOnHand),
            'a line starts at the quantity on hand',
          );
          // Only holders at the branch read it; a viewer reads but cannot change.
          assert.equal((await inv.count(viewerA.token, count.id)).canAdjust, false);
          await fails(() => inv.count(viewerB.token, count.id), 'FORBIDDEN');
          await fails(
            () =>
              inv.setCountLines(viewerA.token, count.id, {
                expectedRowVersion: count.rowVersion,
                lines: [],
                removeVariantIds: [],
              }),
            'FORBIDDEN',
          );
          // Count: solo 6 (three missing), vA 12 (two found), vC unchanged.
          const lineOf = (id: string) => count.lines.find((l) => l.variantId === id)!;
          const edited = await inv.setCountLines(adjusterA.token, count.id, {
            expectedRowVersion: count.rowVersion,
            lines: [
              { variantId: solo.id, countedQuantity: 6 },
              { variantId: vA, countedQuantity: lineOf(vA).countedQuantity + 2 },
            ],
            removeVariantIds: [],
          });
          assert.equal(edited.rowVersion, count.rowVersion + 1);
          await fails(
            () =>
              inv.setCountLines(adjusterA.token, count.id, {
                expectedRowVersion: count.rowVersion,
                lines: [],
                removeVariantIds: [],
              }),
            'CONFLICT',
          );
          await fails(
            () =>
              inv.setCountLines(adjusterA.token, count.id, {
                expectedRowVersion: edited.rowVersion,
                lines: [{ variantId: vA, countedQuantity: -1 }],
                removeVariantIds: [],
              }),
            'VALIDATION_FAILED',
            'countedQuantity',
          );
          await fails(
            () =>
              inv.setCountLines(adjusterA.token, count.id, {
                expectedRowVersion: edited.rowVersion,
                lines: [{ variantId: vA, countedQuantity: 1 }],
                removeVariantIds: [vA],
              }),
            'VALIDATION_FAILED',
            'lines',
          );
          const trimmed = await inv.setCountLines(adjusterA.token, count.id, {
            expectedRowVersion: edited.rowVersion,
            lines: [],
            removeVariantIds: [vC],
          });
          assert.equal(trimmed.lines.length, 2);
          // Stock moves while people count (a sale, a loss): the approval compares with the quantity at THAT moment.
          const vBefore = await inv.variantDetail(adjusterA.token, A.id, vA);
          const lotOfA = vBefore.lots.find((lot) => lot.quantityOnHand > 0)!;
          await inv.adjust(adjusterA.token, {
            requestKey: randomUUID(),
            branchId: A.id,
            variantId: vA,
            lotId: lotOfA.id,
            quantity: 1,
            reason: 'TESTER',
            note: null,
          });
          const live = await inv.count(adjusterA.token, count.id);
          assert.equal(
            live.lines.find((l) => l.variantId === vA)!.currentOnHand,
            vBefore.item.onHand - 1,
          );

          const approved = await inv.approveCount(adjusterA.token, count.id, {
            expectedRowVersion: trimmed.rowVersion,
          });
          assert.equal(approved.status, 'APPROVED');
          assert.ok(approved.approvedAt && approved.approvedByName);
          const soloLine = approved.lines.find((l) => l.variantId === solo.id)!;
          assert.deepEqual([soloLine.systemQuantity, soloLine.difference], [9, -3]);
          const aLine = approved.lines.find((l) => l.variantId === vA)!;
          assert.deepEqual(
            [aLine.systemQuantity, aLine.difference],
            [vBefore.item.onHand - 1, 3],
            'the difference is to the quantity when approved',
          );
          assert.equal(await stockOf(A.id, solo.id), 6);
          assert.equal(await stockOf(A.id, vA), vBefore.item.onHand + 2);
          // Three missing: the nearest-expiry lot (2) first, then the next (no expiry last: FAR before NONE) 1 from FAR.
          const soloDetail = await inv.variantDetail(adjusterA.token, A.id, solo.id);
          const qty = (code: string) =>
            soloDetail.lots.find((lot) => lot.lotCode === code)!.quantityOnHand;
          assert.deepEqual([qty('NEAR'), qty('FAR'), qty('NONE')], [0, 3, 3]);
          const corrections = await tx.stockMovement.findMany({
            where: { variantId: solo.id, reason: 'COUNT_CORRECTION' },
            orderBy: { createdAt: 'asc' },
          });
          assert.deepEqual(
            corrections.map((m) => m.quantityDelta).sort((a, b) => a - b),
            [-2, -1],
          );
          // Found stock lands on a new lot named after the count, with no expiry date.
          const found = await inv.variantDetail(adjusterA.token, A.id, vA);
          const foundLot = found.lots.find((lot) => lot.lotCode === count.code)!;
          assert.deepEqual([foundLot.quantityOnHand, foundLot.expiryDate], [3, null]);
          assert.equal(
            found.movements.find((m) => m.countCode === count.code)?.reason,
            'COUNT_CORRECTION',
          );
          // Closed: nothing more can change; the list shows the units corrected.
          await fails(
            () =>
              inv.approveCount(adjusterA.token, count.id, {
                expectedRowVersion: approved.rowVersion,
              }),
            'INVENTORY_COUNT_NOT_OPEN',
          );
          await fails(
            () =>
              inv.cancelCount(adjusterA.token, count.id, {
                expectedRowVersion: approved.rowVersion,
              }),
            'INVENTORY_COUNT_NOT_OPEN',
          );
          await fails(
            () =>
              inv.setCountLines(adjusterA.token, count.id, {
                expectedRowVersion: approved.rowVersion,
                lines: [],
                removeVariantIds: [],
              }),
            'INVENTORY_COUNT_NOT_OPEN',
          );
          const listed = (await inv.counts(viewerA.token, A.id)).counts.find(
            (c) => c.id === count.id,
          )!;
          assert.deepEqual(
            [listed.status, listed.lineCount, listed.differenceUnits],
            ['APPROVED', 2, 6],
          );
          await fails(() => inv.counts(viewerB.token, A.id), 'FORBIDDEN');
          // A cancelled count changes nothing; an empty one cannot be approved.
          const open = await inv.createCount(adjusterA.token, {
            branchId: A.id,
            notes: null,
            variantIds: null,
          });
          assert.ok(open.lines.length >= 1, 'all variants with stock');
          const gone = await inv.cancelCount(adjusterA.token, open.id, {
            expectedRowVersion: open.rowVersion,
          });
          assert.equal(gone.status, 'CANCELLED');
          const empty = await inv.createCount(adjusterA.token, {
            branchId: A.id,
            notes: null,
            variantIds: [vA],
          });
          const none = await inv.setCountLines(adjusterA.token, empty.id, {
            expectedRowVersion: empty.rowVersion,
            lines: [],
            removeVariantIds: [vA],
          });
          await fails(
            () =>
              inv.approveCount(adjusterA.token, empty.id, { expectedRowVersion: none.rowVersion }),
            'VALIDATION_FAILED',
            'lines',
          );
        },
      );

      await suite.test(
        'low stock: one alert per crossing becomes in-app notices for VIEW_INVENTORY holders of the branch',
        async () => {
          const target = await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: `INV-${run}-E`,
              lowStockThreshold: 3,
              sortOrder: 5,
            },
          });
          await receive(receiverA.token, A.id, [line(target.id, 8)]);
          const drop = async (quantity: number) => {
            const detail = await inv.variantDetail(adjusterA.token, A.id, target.id);
            const lot = detail.lots.find((l) => l.quantityOnHand >= quantity)!;
            await inv.adjust(adjusterA.token, {
              requestKey: randomUUID(),
              branchId: A.id,
              variantId: target.id,
              lotId: lot.id,
              quantity,
              reason: 'INTERNAL_USE',
              note: null,
            });
          };
          await drop(3);
          assert.equal(
            await tx.inventoryLowStockAlert.count({ where: { variantId: target.id } }),
            0,
            '5 is above 3',
          );
          await drop(2);
          const [alert] = await tx.inventoryLowStockAlert.findMany({
            where: { variantId: target.id },
          });
          assert.ok(alert);
          assert.deepEqual([alert.onHand, alert.threshold, alert.handledAt], [3, 3, null]);

          assert.equal(await processLowStockAlert(tx, alert.id), 'PUBLISHED');
          assert.equal(await processLowStockAlert(tx, alert.id), 'NOT_CLAIMED');
          const stored = await tx.inventoryLowStockAlert.findUniqueOrThrow({
            where: { id: alert.id },
          });
          assert.deepEqual([stored.outcome, stored.handledAt !== null], ['PUBLISHED', true]);
          const notices = await tx.notification.findMany({
            where: { entityId: target.id, type: 'LOW_STOCK_REACHED' },
          });
          const recipients = new Set(notices.map((n) => n.recipientUserId));
          for (const person of [viewerA, adjusterA])
            assert.ok(recipients.has(person.id), 'a holder at branch A is told');
          for (const person of [viewerB, receiverA, nobody, manager]) {
            assert.ok(!recipients.has(person.id), 'nobody else is told');
          }
          const notice = notices.find((n) => n.recipientUserId === viewerA.id)!;
          assert.equal(notice.branchId, A.id);
          assert.equal(notice.entityType, 'ProductVariant');
          assert.equal(notice.contextCode, `INV-${run}-E`);
          assert.deepEqual(parseNotificationParams('LOW_STOCK_REACHED', notice.params), {
            onHand: 3,
            threshold: 3,
          });
          // The event belongs to the alert, is published at once and carries no stock figures or names.
          const event = await tx.outboxEvent.findUniqueOrThrow({
            where: { id: notice.sourceEventId },
          });
          assert.equal(event.eventType, 'LOW_STOCK_REACHED');
          assert.ok(event.publishedAt);

          // A restock before the worker runs makes the next alert stale: nothing is announced.
          await drop(1);
          const [, second] = await tx.inventoryLowStockAlert.findMany({
            where: { variantId: target.id },
            orderBy: { createdAt: 'asc' },
          });
          assert.equal(second, undefined, 'still low: no second alert');
          await receive(receiverA.token, A.id, [line(target.id, 20)]);
          await drop(19);
          const alerts = await tx.inventoryLowStockAlert.findMany({
            where: { variantId: target.id },
            orderBy: { createdAt: 'asc' },
          });
          assert.equal(alerts.length, 2, 're-armed above the threshold, alerts again at it');
          await receive(receiverA.token, A.id, [line(target.id, 10)]);
          assert.equal(await processLowStockAlert(tx, alerts[1]!.id), 'STALE');
          assert.equal(
            await tx.notification.count({
              where: { entityId: target.id, type: 'LOW_STOCK_REACHED' },
            }),
            notices.length,
          );
        },
      );

      await suite.test(
        'the daily expiry scan: once per branch per local day, from 08:00, only when there is something to say',
        async () => {
          const zone = await tx.branch.create({
            data: {
              code: `P6_E_${run}`.slice(0, 40),
              name: 'Chi nhánh E',
              timezone: 'Asia/Ho_Chi_Minh',
            },
          });
          const watcher = await kit.staff(['VIEW_INVENTORY'], { branchId: zone.id });
          const keeper = await kit.staff(['MANAGE_STOCK_RECEIPTS'], { branchId: zone.id });
          await receive(keeper.token, zone.id, [
            line(vA, 3, { lotCode: 'DUE', expiryDate: await day(30) }),
            line(vB, 2, { lotCode: 'LATER', expiryDate: await day(400) }),
          ]);
          const database = tx as unknown as DatabaseClient;
          const scans = () => tx.inventoryExpiryScan.findMany({ where: { branchId: zone.id } });
          // 07:30 in Ho Chi Minh City: not yet.
          await runExpiryScan(database, new Date('2027-06-14T00:30:00.000Z'));
          assert.equal((await scans()).length, 0);
          // 10:00 on 15 June 2027 (Ho Chi Minh): the lot that expires in 30 days from TODAY has by then expired; 400 days is not due.
          await runExpiryScan(database, new Date('2027-06-15T03:00:00.000Z'));
          const [scan] = await scans();
          assert.ok(scan);
          assert.equal(scan.businessDate.toISOString().slice(0, 10), '2027-06-15');
          assert.deepEqual(
            [scan.expiredLots, scan.expiringLots, scan.warningDays, scan.outcome],
            [1, 0, 90, 'PUBLISHED'],
          );
          const notice = await tx.notification.findFirstOrThrow({
            where: { recipientUserId: watcher.id, type: 'EXPIRY_ALERT' },
          });
          assert.equal(notice.entityType, 'Branch');
          assert.equal(notice.entityId, zone.id);
          assert.equal(notice.contextCode, '2027-06-15');
          assert.deepEqual(parseNotificationParams('EXPIRY_ALERT', notice.params), {
            withinDays: 90,
            expiredLots: 1,
            expiringLots: 0,
          });
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: keeper.id, type: 'EXPIRY_ALERT' },
            }),
            0,
            'receipts alone are not told',
          );
          // The same day again: nothing repeats.
          await runExpiryScan(database, new Date('2027-06-15T09:00:00.000Z'));
          assert.equal((await scans()).length, 1);
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: watcher.id, type: 'EXPIRY_ALERT' },
            }),
            1,
          );
          // The next local day scans again; with the window widened a lot is "expiring" and the warning days follow the setting.
          const settings = await tx.productSettings.findUniqueOrThrow({ where: { id: 1 } });
          assert.equal(settings.expiryWarningDays, 90);
          await runExpiryScan(database, new Date('2027-06-16T03:00:00.000Z'));
          assert.equal((await scans()).length, 2);
          // A quiet branch writes a scan row and no notice.
          const quiet = await tx.branch.create({
            data: {
              code: `P6_Q_${run}`.slice(0, 40),
              name: 'Chi nhánh Q',
              timezone: 'Asia/Ho_Chi_Minh',
            },
          });
          await runExpiryScan(database, new Date('2027-06-15T03:00:00.000Z'));
          const quietScan = await tx.inventoryExpiryScan.findFirstOrThrow({
            where: { branchId: quiet.id },
          });
          assert.deepEqual(
            [quietScan.expiredLots, quietScan.expiringLots, quietScan.outcome],
            [0, 0, 'NOTHING_TO_REPORT'],
          );
        },
      );

      await suite.test(
        'audit: stock changes name who, what and where, and never a cost',
        async () => {
          const actions = await tx.auditEvent.findMany({
            where: { action: { startsWith: 'STOCK_' }, branchId: A.id },
            select: { action: true, actorUserId: true, before: true, after: true },
          });
          const names = new Set(actions.map((a) => a.action));
          for (const expected of [
            'STOCK_RECEIPT_CREATED',
            'STOCK_RECEIPT_UPDATED',
            'STOCK_RECEIPT_CONFIRMED',
            'STOCK_RECEIPT_CANCELLED',
            'STOCK_ADJUSTED',
            'STOCK_COUNT_CREATED',
            'STOCK_COUNT_APPROVED',
            'STOCK_COUNT_CANCELLED',
          ]) {
            assert.ok(names.has(expected), expected);
          }
          assert.ok(
            actions.every((a) => !/unitCost|cost/i.test(JSON.stringify([a.before, a.after]))),
          );
          assert.ok(actions.every((a) => a.actorUserId !== null));
        },
      );
    });
  },
);
