import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productOrderKit } from '../testing/product-order-kit.js';
import { RewardService } from './reward.service.js';

/**
 * Phase 6 P6-18 (Q10, design 4.7) against real PostgreSQL: a PRODUCT_GIFT linked to a product variant takes one unit out of the stock of
 * the branch where staff mark it used (nearest expiry first, never an expired lot, never stock that an invoice or a pre-order holds),
 * is refused with "Hết hàng" when none is free (nothing written), and a manager's restore puts the unit back into the same lot. A gift
 * that is not linked moves no stock. No money, no invoice and no points are involved. Every fixture rolls back.
 */
test(
  'Phase 6 P6-18 product gifts take stock when used and give it back when the use is restored; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productOrderKit(base);
      const { tx, fails } = base;
      const rewards = new RewardService(base.adapter, base.throttle, base.environment);
      const issuer = await base.staff(['ISSUE_REWARDS'], { branchId: k.A.id });
      const manager = await base.staff([], { globalCodes: ['MANAGE_REWARD_CATALOG'] });
      const otherBranch = await base.staff(['ISSUE_REWARDS'], { branchId: k.B.id });
      await tx.loyaltyGoLive.create({ data: { activatedByUserId: k.people.owner.id } });
      const member = await k.customer('qua');
      const receiverB = await base.staff(['MANAGE_STOCK_RECEIPTS'], { branchId: k.B.id });

      const day = (offset: number) =>
        tx
          .$queryRawUnsafe<{ d: string }[]>(
            `SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + ${offset}, 'YYYY-MM-DD') AS d`,
          )
          .then((rows) => rows[0]!.d);
      const receiveLot = async (
        variantId: string,
        quantity: number,
        expiry: string | null,
        lot: string,
        branchId = k.A.id,
      ) => {
        const receiver = branchId === k.A.id ? k.people.receiver : receiverB;
        const draft = await k.inventory.createReceipt(receiver.token, {
          branchId,
          supplierId: null,
          receiptDate: await k.day(),
          notes: null,
          lines: [{ variantId, quantity, lotCode: lot, expiryDate: expiry }],
        });
        await k.ok(() =>
          k.inventory.confirmReceipt(receiver.token, draft.id, {
            expectedRowVersion: draft.rowVersion,
          }),
        );
      };
      const giftItem = async (variantId: string | null, name = 'Quà') => {
        const created = await k.ok(() =>
          rewards.createItem(manager.token, {
            kind: 'PRODUCT_GIFT',
            serviceId: null,
            ...(variantId ? { variantId } : {}),
            nameVi: `${name} tặng`,
            nameEn: `${name} gift`,
            active: true,
            expiryDays: null,
          }),
        );
        return created;
      };
      const grant = (itemId: string, quantity = 1) =>
        k.ok(() =>
          rewards.issue(issuer.token, k.A.id, member.id, {
            catalogItemId: itemId,
            quantity,
            reason: 'Quà tri ân khách thân thiết',
          }),
        );
      const use = (entitlementId: string, actor = issuer, branchId = k.A.id) =>
        k.ok(() => rewards.use(actor.token, branchId, entitlementId, { note: 'Tặng tại quầy' }));
      const movements = (variantId: string) =>
        tx.stockMovement.findMany({
          where: { variantId, kind: { in: ['GIFT_OUT', 'GIFT_RETURN'] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            kind: true,
            quantityDelta: true,
            lotId: true,
            branchId: true,
            rewardManualUseId: true,
          },
        });

      await suite.test(
        'a gift linked to a product: only a PRODUCT_GIFT, an active variant, shown in the catalog',
        async () => {
          const product = await k.product('gift-a', [90_000]);
          const variantId = product.variants[0]!.id;
          const item = await giftItem(variantId);
          assert.equal(item.variant?.id, variantId);
          assert.equal(item.variant?.sku, product.variants[0]!.sku);
          const catalog = await rewards.catalog(manager.token);
          assert.ok(catalog.variantOptions.some((option) => option.id === variantId));
          assert.equal(catalog.items.find((entry) => entry.id === item.id)?.variant?.id, variantId);
          // Only a product gift may name a variant; an unknown or switched-off variant is refused.
          await fails(
            () =>
              rewards.createItem(manager.token, {
                kind: 'VOUCHER',
                serviceId: null,
                variantId,
                nameVi: 'Phiếu',
                nameEn: 'Voucher',
                active: true,
                expiryDays: null,
              }),
            'VALIDATION_FAILED',
            'variantId',
          );
          await fails(
            () =>
              rewards.createItem(manager.token, {
                kind: 'PRODUCT_GIFT',
                serviceId: null,
                variantId: randomUUID(),
                nameVi: 'Quà',
                nameEn: 'Gift',
                active: true,
                expiryDays: null,
              }),
            'REWARD_VARIANT_INVALID',
            'variantId',
          );
          await fails(
            () =>
              rewards.createItem(issuer.token, {
                kind: 'PRODUCT_GIFT',
                serviceId: null,
                variantId,
                nameVi: 'Quà',
                nameEn: 'Gift',
                active: true,
                expiryDays: null,
              }),
            'FORBIDDEN',
          );
          const plain = await giftItem(null, 'Không kho');
          assert.equal(plain.variant, null);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'using a unit takes one from the lot that expires first, never from an expired lot, and nothing from another branch',
        async () => {
          const product = await k.product('gift-b', [50_000]);
          const variantId = product.variants[0]!.id;
          await receiveLot(variantId, 2, await day(60), 'LATE');
          await receiveLot(variantId, 2, await day(10), 'SOON');
          await receiveLot(variantId, 1, null, 'NOEXP');
          await receiveLot(variantId, 5, await day(30), 'OTHER-BRANCH', k.B.id);
          const item = await giftItem(variantId);
          const entitlement = await grant(item.id, 4);
          const soon = await tx.inventoryLot.findFirstOrThrow({
            where: { variantId, branchId: k.A.id, lotCode: 'SOON' },
          });
          const done = await use(entitlement.id);
          assert.equal(done.uses.length, 1);
          const [first] = await movements(variantId);
          assert.deepEqual(
            [first!.kind, first!.quantityDelta, first!.lotId, first!.branchId],
            ['GIFT_OUT', -1, soon.id, k.A.id],
            'the lot that expires first',
          );
          assert.deepEqual(await k.levelOf(variantId), { onHand: 4, reserved: 0 });
          assert.deepEqual(await k.levelOf(variantId, k.B.id), { onHand: 5, reserved: 0 });
          // Two more uses empty SOON, then the next lot is LATE and the lot without a date comes last.
          await use(entitlement.id);
          await use(entitlement.id);
          const lots = await tx.inventoryLot.findMany({
            where: { variantId, branchId: k.A.id },
            select: { lotCode: true, quantityOnHand: true },
            orderBy: { lotCode: 'asc' },
          });
          assert.deepEqual(
            lots.map((lot) => [lot.lotCode, lot.quantityOnHand]),
            [
              ['LATE', 1],
              ['NOEXP', 1],
              ['SOON', 0],
            ],
          );
          // Used at the other branch, the unit comes from THAT branch's stock and this branch keeps its own.
          await use(entitlement.id, otherBranch, k.B.id);
          assert.deepEqual(await k.levelOf(variantId, k.B.id), { onHand: 4, reserved: 0 });
          assert.deepEqual(await k.levelOf(variantId), { onHand: 2, reserved: 0 });
          await k.reconcileAll();
        },
      );

      await suite.test(
        'out of stock is refused with the stock-out code and nothing is written; stock held for an invoice or a pre-order is not given away',
        async () => {
          const product = await k.product('gift-c', [50_000]);
          const variantId = product.variants[0]!.id;
          const item = await giftItem(variantId);
          const entitlement = await grant(item.id, 3);
          // No stock at all.
          await fails(() => use(entitlement.id), 'REWARD_OUT_OF_STOCK');
          assert.equal((await movements(variantId)).length, 0);
          assert.equal(
            await tx.rewardManualUse.count({ where: { entitlementId: entitlement.id } }),
            0,
          );
          // One unit on the shelf, held by an invoice that was finalized: not free to give.
          await receiveLot(variantId, 1, null, 'ONE');
          const held = await k.finalize(await k.addLine(await k.openSale(), variantId, 1));
          assert.equal(held.status, 'PENDING_PAYMENT');
          await fails(() => use(entitlement.id), 'REWARD_OUT_OF_STOCK');
          assert.equal((await movements(variantId)).length, 0, 'refused: nothing written');
          // One more unit arrives: that one is free and goes.
          await receiveLot(variantId, 1, null, 'TWO');
          const ok = await use(entitlement.id);
          assert.equal(ok.uses.length, 1);
          assert.deepEqual(await k.levelOf(variantId), { onHand: 1, reserved: 1 });
          await fails(() => use(entitlement.id), 'REWARD_OUT_OF_STOCK');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'goods that ARRIVED for a pre-order are held for it and are not given as a gift',
        async () => {
          const product = await k.preOrderProduct('gift-d', 80_000);
          const sale = await k.paidPreOrder(product.variantId, 2);
          await receiveLot(product.variantId, 2, null, 'ARRIVAL');
          assert.equal((await k.lineRow(sale.line.id)).status, 'ARRIVED');
          const item = await giftItem(product.variantId);
          const entitlement = await grant(item.id);
          await fails(() => use(entitlement.id), 'REWARD_OUT_OF_STOCK');
          assert.deepEqual(await k.levelOf(product.variantId), { onHand: 2, reserved: 2 });
          await receiveLot(product.variantId, 1, null, 'EXTRA');
          await use(entitlement.id);
          assert.deepEqual(await k.levelOf(product.variantId), { onHand: 2, reserved: 2 });
          assert.equal(
            (await k.lineRow(sale.line.id)).status,
            'ARRIVED',
            'the pre-order keeps its goods',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a manager restores a mistaken use: the unit goes back into the same lot, once; the use stays as history',
        async () => {
          const product = await k.product('gift-e', [50_000]);
          const variantId = product.variants[0]!.id;
          await receiveLot(variantId, 1, await day(20), 'A');
          await receiveLot(variantId, 3, await day(90), 'B');
          const item = await giftItem(variantId);
          const entitlement = await grant(item.id, 2);
          const used = await use(entitlement.id);
          const useId = used.uses[0]!.id;
          const lotA = await tx.inventoryLot.findFirstOrThrow({
            where: { variantId, lotCode: 'A' },
          });
          assert.equal(
            (await tx.inventoryLot.findUniqueOrThrow({ where: { id: lotA.id } })).quantityOnHand,
            0,
          );
          // Only a manager restores; staff at the counter cannot.
          await fails(
            () =>
              k.ok(() => rewards.restore(issuer.token, useId, { reason: 'Bấm nhầm khi đang bận' })),
            'FORBIDDEN',
          );
          // Meanwhile the lot A is gone from the shelf and lot B is next in line: a second use takes from B.
          await use(entitlement.id);
          const restored = await k.ok(() =>
            rewards.restore(manager.token, useId, { reason: 'Bấm nhầm khi đang bận' }),
          );
          assert.ok(
            restored.uses.some((entry) => entry.id === useId && entry.restoration !== null),
          );
          const rows = await movements(variantId);
          assert.deepEqual(
            rows.map((row) => [row.kind, row.quantityDelta, row.lotId === lotA.id]),
            [
              ['GIFT_OUT', -1, true],
              ['GIFT_OUT', -1, false],
              ['GIFT_RETURN', 1, true],
            ],
            'the unit goes back into the lot it came from, not the next one',
          );
          assert.equal(
            (await tx.inventoryLot.findUniqueOrThrow({ where: { id: lotA.id } })).quantityOnHand,
            1,
          );
          assert.equal(
            await tx.rewardManualUse.count({ where: { id: useId } }),
            1,
            'the use stays',
          );
          await fails(
            () => k.ok(() => rewards.restore(manager.token, useId, { reason: 'Lần hai' })),
            'REWARD_USE_NOT_RESTORABLE',
          );
          assert.equal((await movements(variantId)).length, 3, 'a second restore writes nothing');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a gift with no product moves no stock, before or after its restore',
        async () => {
          const product = await k.product('gift-f', [50_000]);
          const variantId = product.variants[0]!.id;
          await receiveLot(variantId, 2, null, 'PLAIN');
          const plain = await giftItem(null, 'Không kho');
          const entitlement = await grant(plain.id);
          const used = await use(entitlement.id);
          assert.equal((await movements(variantId)).length, 0);
          await k.ok(() =>
            rewards.restore(manager.token, used.uses[0]!.id, { reason: 'Bấm nhầm' }),
          );
          assert.equal((await movements(variantId)).length, 0);
          assert.deepEqual(await k.levelOf(variantId), { onHand: 2, reserved: 0 });
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the stock link of a gift changes only before a unit was used; saving the same link is a quiet no-op',
        async () => {
          const one = await k.product('gift-g1', [50_000]);
          const two = await k.product('gift-g2', [50_000]);
          const first = one.variants[0]!.id;
          const second = two.variants[0]!.id;
          await receiveLot(first, 2, null, 'G1');
          const item = await giftItem(first);
          const edit = (patch: Record<string, unknown>, version: number) =>
            k.ok(() =>
              rewards.editItem(manager.token, item.id, {
                expectedRowVersion: version,
                nameVi: item.nameVi,
                nameEn: item.nameEn,
                active: true,
                expiryDays: null,
                ...patch,
              } as never),
            );
          const same = await edit({ variantId: first }, item.rowVersion);
          assert.equal(same.rowVersion, item.rowVersion, 'the same link: no new version');
          const absent = await edit({ nameVi: 'Tên mới' }, item.rowVersion);
          assert.equal(absent.variant?.id, first, 'absent keeps the link');
          const moved = await edit({ variantId: second }, absent.rowVersion);
          assert.equal(moved.variant?.id, second);
          const cleared = await edit({ variantId: null }, moved.rowVersion);
          assert.equal(cleared.variant, null);
          const relinked = await edit({ variantId: first }, cleared.rowVersion);
          const entitlement = await grant(item.id);
          await use(entitlement.id);
          await fails(
            () => edit({ variantId: second }, relinked.rowVersion),
            'REWARD_GIFT_LINK_LOCKED',
            'variantId',
          );
          await fails(
            () => edit({ variantId: null }, relinked.rowVersion),
            'REWARD_GIFT_LINK_LOCKED',
            'variantId',
          );
          // The database says the same, whoever asks.
          await assert.rejects(
            tx.$executeRawUnsafe(
              `UPDATE reward_catalog_items SET variant_id = '${second}', row_version = row_version + 1 WHERE id = '${item.id}'`,
            ),
            /cannot change once a unit was used/,
          );
        },
      );
    });
  },
);
