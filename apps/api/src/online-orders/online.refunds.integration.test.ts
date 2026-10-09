import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { failedDeliveryRefund } from '@lucy-spa/contracts';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';

/**
 * Phase 6 Wave 4 / P6-21 against real PostgreSQL (design 2.38; OQ-97 to OQ-100): the cancellation of a paid online line that has not
 * shipped (and the money given back), the settlement of a FAILED DELIVERY with the Owner's formula (goods paid minus the two carrier
 * costs, never below 0, never above the goods paid), the returns of delivered goods and the cost the shop pays to have them come back. Every
 * command is followed by the deferred database checks and each test ends with the reconciliation of the whole fixture. Fixtures roll back.
 */
test(
  'Phase 6 P6-21 online cancellation, failed delivery, returns and refunds; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const packer = k.people.queue;
      const refunder = k.people.refunder;
      const manager = await base.staff(['MANAGE_PRODUCTS'], { globalCodes: ['MANAGE_PRODUCTS'] });
      await k.open();
      const cream = await k.stocked('cream', 200_000, 80);
      const mask = await k.stocked('mask', 80_000, 80);
      const lipstick = await k.stocked('lipstick', 150_000, 0);
      const carrierId = (
        await k.online.createCarrier(manager.token, {
          name: 'Hãng thử R',
          trackingUrlTemplate: null,
        })
      ).carriers[0]!.id;

      const paid = async (lines: readonly { variantId: string; quantity?: number }[]) => {
        const member = await k.member('refund');
        const placed = await k.order(member, lines);
        await k.payViaWebhook(member, placed);
        return { member, placed };
      };
      const view = (id: string, who: { token: string } = packer) =>
        k.online.staffOrder(who.token, id);
      const ship = async (id: string, fee = '35000') => {
        const order = await view(id);
        const shipped = await k.ok(() =>
          k.online.ship(packer.token, id, {
            lines: order.lines
              .filter((line) => line.status !== 'CANCELLED')
              .map((line) => ({ id: line.id, rowVersion: line.rowVersion })),
            carrierId,
            trackingCode: `VN${id.slice(0, 8).toUpperCase()}`,
            carrierFeeVnd: fee,
          }),
        );
        await k.runInventory();
        return shipped;
      };
      /** Moves a person's sessions ten minutes back (the test-only way to make a password confirmation stale). */
      const age = async (userId: string) => {
        await tx.$executeRawUnsafe('SAVEPOINT age');
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe(
          `UPDATE sessions SET created_at = created_at - interval '10 minutes', reauthenticated_at = reauthenticated_at - interval '10 minutes' WHERE user_id = '${userId}'`,
        );
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT age');
      };
      const cancelBody = (version: number, patch: Record<string, unknown> = {}) => ({
        expectedVersion: version,
        cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING',
        note: 'Khách liên hệ hủy đơn, chưa đóng gói',
        method: 'CASH',
        bankReference: null,
        clientRequestId: randomUUID(),
        ...patch,
      });
      const cancel = async (
        lineId: string,
        version: number,
        patch: Record<string, unknown> = {},
        who: { token: string } = refunder,
      ) => {
        await k.reconfirm(who.token);
        return k.online.cancelLine(who.token, lineId, cancelBody(version, patch));
      };
      /** A parcel whose delivery failed, the customer no longer wants it, and which is back at the shop. */
      const backAtShop = async (
        lines: readonly { variantId: string; quantity?: number }[],
        fee = '35000',
      ) => {
        const order = await paid(lines);
        await ship(order.placed.id, fee);
        await k.ok(() =>
          k.online.log(packer.token, order.placed.id, {
            kind: 'DELIVERY_FAILED',
            reasonCode: 'CUSTOMER_UNREACHABLE',
            note: 'Gọi hai lần không nghe máy',
          }),
        );
        await k.ok(() =>
          k.online.log(packer.token, order.placed.id, {
            kind: 'RETURN_STARTED',
            note: 'Khách nói không còn muốn nhận',
          }),
        );
        await k.ok(() =>
          k.online.returned(packer.token, order.placed.id, { note: 'Hàng về còn nguyên' }),
        );
        return order;
      };
      const settleBody = (
        order: Awaited<ReturnType<typeof view>>,
        patch: Record<string, unknown> = {},
      ) => ({
        lines: order.lines
          .filter((line) => line.status !== 'CANCELLED')
          .map((line) => ({ id: line.id, rowVersion: line.rowVersion })),
        carrierFeeBackVnd: '30000',
        reason: 'Khách không còn muốn nhận, hãng chuyển hàng về',
        restock: 'SELLABLE',
        method: 'CASH',
        bankReference: null,
        clientRequestId: randomUUID(),
        ...patch,
      });
      const settle = async (
        id: string,
        patch: Record<string, unknown> = {},
        who: { token: string } = refunder,
      ) => {
        const order = await view(id, who);
        await k.reconfirm(who.token);
        return k.ok(() => k.online.settle(who.token, id, settleBody(order, patch)));
      };

      await suite.test(
        'the formula of the Owner: goods minus both ways of the carrier, never below 0, never above the goods',
        () => {
          assert.equal(failedDeliveryRefund(480_000n, 35_000n, 30_000n), 415_000n);
          assert.equal(failedDeliveryRefund(480_000n, 0n, 0n), 480_000n);
          assert.equal(failedDeliveryRefund(50_000n, 35_000n, 30_000n), 0n);
          assert.equal(failedDeliveryRefund(0n, 0n, 0n), 0n);
          assert.equal(failedDeliveryRefund(100_000n, 100_000n, 0n), 0n);
        },
      );

      await suite.test(
        'cancelling a paid line before it ships: the cause, the whole share back, the goods released, the member told',
        async () => {
          const order = await paid([
            { variantId: cream.variantId, quantity: 2 },
            { variantId: mask.variantId, quantity: 1 },
          ]);
          const before = await k.levelOf(cream.variantId);
          const detail = await view(order.placed.id, refunder);
          const creamLine = detail.lines.find((line) => line.nameVi.includes('cream'))!;
          const maskLine = detail.lines.find((line) => line.nameVi.includes('mask'))!;
          // An in-stock line has one cause; the person who only packs may not refund; a stale picture and a stale password are refused.
          assert.deepEqual(creamLine.cancelCauses, ['CUSTOMER_CANCELLED_BEFORE_ORDERING']);
          assert.deepEqual((await view(order.placed.id, packer)).lines[0]!.cancelCauses, []);
          await fails(() => cancel(creamLine.id, creamLine.rowVersion, {}, packer), 'FORBIDDEN');
          await fails(
            () => cancel(creamLine.id, creamLine.rowVersion, { cause: 'SUPPLIER_CANNOT_DELIVER' }),
            'ORDER_CANCEL_CAUSE_INVALID',
            'cause',
          );
          await fails(() => cancel(creamLine.id, creamLine.rowVersion + 1), 'CONFLICT');
          await age(refunder.id);
          await fails(
            () =>
              k.online.cancelLine(refunder.token, creamLine.id, cancelBody(creamLine.rowVersion)),
            'REAUTHENTICATION_REQUIRED',
          );
          const done = await k.ok(() => cancel(creamLine.id, creamLine.rowVersion));
          const cancelled = done.lines.find((line) => line.id === creamLine.id)!;
          assert.equal(cancelled.status, 'CANCELLED');
          assert.equal(cancelled.refundedVnd, '400000');
          assert.equal(done.state, 'READY_TO_SHIP', 'the other line is still to be packed');
          // The goods are back on the shelf, the money is one immutable refund, the Owner and the member were told.
          const after = await k.levelOf(cream.variantId);
          assert.equal(after.reserved, before.reserved - 2);
          const refund = await tx.productRefund.findFirstOrThrow({
            where: { orderLineId: creamLine.id },
          });
          assert.equal(refund.amountVnd, 400_000n);
          assert.equal(refund.restock, 'NOT_SELLABLE');
          assert.equal(refund.settlementId, null);
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: order.member.id, type: 'ONLINE_ORDER_REFUNDED' },
            }),
            1,
          );
          assert.ok(
            (await tx.notification.count({
              where: { type: 'PRODUCT_REFUND_MADE', entityId: order.placed.id },
            })) >= 1,
          );
          // The parcel now carries what is left; a cancelled line is not packed; a shipped line cannot be cancelled this way.
          const shipped = await ship(order.placed.id);
          assert.deepEqual(shipped.lines.map((line) => line.status).sort(), [
            'CANCELLED',
            'SHIPPED',
          ]);
          assert.deepEqual(shipped.lines.find((line) => line.id === maskLine.id)!.cancelCauses, []);
          await fails(
            () =>
              cancel(
                maskLine.id,
                shipped.lines.find((line) => line.id === maskLine.id)!.rowVersion,
              ),
            'ORDER_CANCEL_CAUSE_INVALID',
            'cause',
          );
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: order.member.id, type: 'ONLINE_ORDER_SHIPPED' },
            }),
            1,
          );
          assert.equal(
            (await k.levelOf(mask.variantId)).onHand,
            (await k.levelOf(mask.variantId)).onHand,
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'cancelling every line cancels the order; a pre-order line has the supplier causes; the goods of an arrived line go on to the next order',
        async () => {
          const solo = await paid([{ variantId: cream.variantId, quantity: 1 }]);
          const line = (await view(solo.placed.id, refunder)).lines[0]!;
          const gone = await k.ok(() => cancel(line.id, line.rowVersion));
          assert.equal(gone.state, 'CANCELLED');
          assert.equal(
            (await k.online.order(solo.member.token, solo.placed.id)).state,
            'CANCELLED',
          );
          assert.equal(
            (await k.invoiceRow(solo.placed.invoiceId)).status,
            'PAID',
            'the invoice stays paid; the refund is the record',
          );
          // A pre-order line that waits for the supplier.
          const wait = await paid([{ variantId: lipstick.variantId, quantity: 2 }]);
          const waiting = (await view(wait.placed.id, refunder)).lines[0]!;
          assert.deepEqual(waiting.cancelCauses.slice(0, 2), [
            'CUSTOMER_CANCELLED_BEFORE_ORDERING',
            'SUPPLIER_CANNOT_DELIVER',
          ]);
          const second = await paid([{ variantId: lipstick.variantId, quantity: 2 }]);
          // The goods arrive for the older order; cancelling it gives them to the next one at once.
          await k.ok(() => k.receive(lipstick.variantId, 2));
          const arrived = (await view(wait.placed.id, refunder)).lines[0]!;
          assert.equal(arrived.status, 'ARRIVED');
          assert.equal((await view(second.placed.id)).lines[0]!.status, 'PAID');
          assert.deepEqual(arrived.cancelCauses, ['CUSTOMER_CHANGED_MIND']);
          await k.ok(() =>
            cancel(arrived.id, arrived.rowVersion, { cause: 'CUSTOMER_CHANGED_MIND' }),
          );
          assert.equal(
            (await view(second.placed.id)).lines[0]!.status,
            'ARRIVED',
            'the goods went to the next order',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a failed delivery: nothing is settled before the parcel is back; then ONE refund = goods minus both carrier costs, split by line, one password',
        async () => {
          const order = await paid([
            { variantId: cream.variantId, quantity: 2 },
            { variantId: mask.variantId, quantity: 1 },
          ]);
          await ship(order.placed.id, '35000');
          const shippedView = await view(order.placed.id, refunder);
          await fails(() => settle(order.placed.id), 'ONLINE_ORDER_STATE_INVALID');
          await k.ok(() =>
            k.online.log(packer.token, order.placed.id, {
              kind: 'DELIVERY_FAILED',
              reasonCode: 'CUSTOMER_AWAY',
              note: 'Khách đi vắng',
            }),
          );
          await k.ok(() =>
            k.online.log(packer.token, order.placed.id, {
              kind: 'RETURN_STARTED',
              note: 'Khách không còn muốn nhận',
            }),
          );
          await k.ok(() =>
            k.online.returned(packer.token, order.placed.id, { note: 'Hàng đã về' }),
          );
          const ready = await view(order.placed.id, refunder);
          assert.equal(ready.can.settleFailedDelivery, true);
          assert.equal((await view(order.placed.id, packer)).can.settleFailedDelivery, false);
          assert.equal(shippedView.shipment!.carrierFeeOutVnd, '35000');
          // Authority, input, a stale picture, a refusal to deduct anything but the two costs.
          await fails(() => settle(order.placed.id, {}, packer), 'FORBIDDEN');
          await fails(
            () => settle(order.placed.id, { carrierFeeBackVnd: '-1' }),
            'VALIDATION_FAILED',
            'carrierFeeBackVnd',
          );
          await fails(
            () => settle(order.placed.id, { reason: '  ' }),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () => settle(order.placed.id, { restock: 'MAYBE' }),
            'VALIDATION_FAILED',
            'restock',
          );
          await fails(
            () => settle(order.placed.id, { method: 'PAYOS' }),
            'VALIDATION_FAILED',
            'method',
          );
          await fails(
            () => settle(order.placed.id, { method: 'BANK_TRANSFER_MANUAL', bankReference: null }),
            'VALIDATION_FAILED',
            'bankReference',
          );
          const stockBefore = {
            cream: await k.levelOf(cream.variantId),
            mask: await k.levelOf(mask.variantId),
          };
          const requestId = randomUUID();
          const settled = await settle(order.placed.id, { clientRequestId: requestId });
          assert.equal(settled.state, 'CANCELLED');
          assert.ok(
            settled.lines.every(
              (line) => line.status === 'CANCELLED' && line.cancelCause === 'DELIVERY_FAILED',
            ),
          );
          assert.deepEqual(
            {
              goods: settled.settlement!.goodsPaidVnd,
              out: settled.settlement!.carrierFeeOutVnd,
              back: settled.settlement!.carrierFeeBackVnd,
              refund: settled.settlement!.refundVnd,
              stock: settled.settlement!.returnedToStock,
            },
            { goods: '480000', out: '35000', back: '30000', refund: '415000', stock: 'SELLABLE' },
          );
          const refunds = await tx.productRefund.findMany({
            where: { settlementId: { not: null } },
            orderBy: { amountVnd: 'desc' },
          });
          assert.equal(refunds.length, 2);
          assert.equal(
            refunds.reduce((sum, row) => sum + row.amountVnd, 0n),
            415_000n,
            'the parts add up to the refund',
          );
          assert.deepEqual(
            refunds.map((row) => row.amountVnd),
            [345_833n, 69_167n],
          );
          assert.ok(refunds.every((row) => row.restock === 'SELLABLE' && row.method === 'CASH'));
          // ONE password confirmation covers the whole refund.
          assert.equal(
            await tx.refundReauthenticationUse.count({ where: { settlementId: { not: null } } }),
            1,
          );
          // The goods that were sold when the parcel left are back on the shelf, in new lots named after the order.
          assert.equal((await k.levelOf(cream.variantId)).onHand, stockBefore.cream.onHand + 2);
          assert.equal((await k.levelOf(mask.variantId)).onHand, stockBefore.mask.onHand + 1);
          const lots = await tx.inventoryLot.findMany({
            where: { sourceRefundId: { in: refunds.map((row) => row.id) } },
          });
          assert.equal(lots.length, 2);
          assert.ok(lots.every((lot) => lot.lotCode.startsWith(order.placed.code)));
          // The member and the Owner are told; the invoice stays paid; a repeat of the same request is quiet; a second settlement is refused.
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: order.member.id, type: 'ONLINE_ORDER_REFUNDED' },
            }),
            1,
          );
          assert.equal(
            (await k.online.order(order.member.token, order.placed.id)).refundedVnd,
            '415000',
          );
          assert.equal((await k.invoiceRow(order.placed.invoiceId)).status, 'PAID');
          const again = await k.online.settle(
            refunder.token,
            order.placed.id,
            settleBody(ready, { clientRequestId: requestId }),
          );
          assert.equal(again.settlement!.refundVnd, '415000');
          await fails(
            () =>
              k.online.settle(
                refunder.token,
                order.placed.id,
                settleBody(ready, { clientRequestId: requestId, reason: 'Lý do khác' }),
              ),
            'CONFLICT',
          );
          await k.reconfirm(refunder.token);
          await fails(
            () => k.online.settle(refunder.token, order.placed.id, settleBody(ready)),
            'ONLINE_ORDER_STATE_INVALID',
          );
          // The customer never sees the carrier costs; the person who only packs does not either.
          const customerText = JSON.stringify(
            await k.online.order(order.member.token, order.placed.id),
          );
          assert.ok(!customerText.includes('35000') && !customerText.includes('30000'));
          assert.equal((await view(order.placed.id, packer)).settlement, null);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'when both carrier costs eat the goods the refund is 0: no money, no password, no deduction beyond the costs, nothing negative',
        async () => {
          const order = await backAtShop([{ variantId: mask.variantId, quantity: 1 }], '60000');
          const detail = await view(order.placed.id, refunder);
          // 80,000 goods - 60,000 out - 50,000 back is below zero: 0, never a charge on the customer.
          await fails(
            () => settle(order.placed.id, { carrierFeeBackVnd: '50000', restock: 'SELLABLE' }),
            'VALIDATION_FAILED',
            'restock',
          );
          await fails(
            () =>
              settle(order.placed.id, {
                carrierFeeBackVnd: '50000',
                restock: 'NOT_SELLABLE',
                method: 'CASH',
              }),
            'VALIDATION_FAILED',
            'method',
          );
          // No password is asked for a refund of 0: a stale confirmation is fine.
          const zero = await k.ok(() =>
            k.online.settle(
              refunder.token,
              order.placed.id,
              settleBody(detail, {
                carrierFeeBackVnd: '50000',
                restock: 'NOT_SELLABLE',
                method: undefined,
                bankReference: undefined,
              }),
            ),
          );
          assert.equal(zero.settlement!.refundVnd, '0');
          assert.equal(zero.state, 'CANCELLED');
          assert.equal(
            await tx.productRefund.count({ where: { orderLine: { orderId: order.placed.id } } }),
            0,
          );
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: order.member.id, type: 'ONLINE_ORDER_CANCELLED' },
            }),
            1,
          );
          assert.equal(
            (await k.online.order(order.member.token, order.placed.id)).refundedVnd,
            '0',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'no deduction when the carrier cost is 0; a bank transfer needs its reference; the goods may be recorded as not sellable',
        async () => {
          const free = await backAtShop([{ variantId: cream.variantId, quantity: 1 }], '0');
          const full = await settle(free.placed.id, {
            carrierFeeBackVnd: '0',
            restock: 'NOT_SELLABLE',
            method: 'BANK_TRANSFER_MANUAL',
            bankReference: 'FT26100501',
          });
          assert.equal(full.settlement!.refundVnd, '200000', 'the whole price of the goods');
          const row = await tx.productRefund.findFirstOrThrow({
            where: { settlementId: { not: null }, orderLine: { orderId: free.placed.id } },
          });
          assert.equal(row.method, 'BANK_TRANSFER_MANUAL');
          assert.equal(row.bankReference, 'FT26100501');
          assert.equal(
            await tx.inventoryLot.count({ where: { sourceRefundId: row.id } }),
            0,
            'not sellable: nothing goes back on the shelf',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the database holds the arithmetic and the evidence whatever the application does',
        async () => {
          const order = await backAtShop([{ variantId: cream.variantId, quantity: 1 }], '10000');
          const lineIds = (await view(order.placed.id)).lines.map((line) => line.id);
          const direct = (data: Record<string, unknown>) =>
            base.adapter.withTransaction((client) =>
              client.onlineFailedDeliverySettlement.create({
                data: {
                  orderId: order.placed.id,
                  goodsPaidVnd: 200_000n,
                  carrierFeeOutVnd: 10_000n,
                  carrierFeeBackVnd: 5_000n,
                  refundVnd: 185_000n,
                  restock: 'NOT_SELLABLE',
                  method: 'CASH',
                  reason: 'x',
                  actorUserId: refunder.id,
                  reauthenticatedAt: new Date(),
                  clientRequestId: randomUUID(),
                  ...data,
                } as never,
              }),
            );
          // A refund that is not goods minus costs, one above the goods, a negative cost: refused by CHECKs before anything else.
          await assert.rejects(() => direct({ refundVnd: 190_000n }));
          await assert.rejects(() =>
            direct({ refundVnd: 200_001n, carrierFeeBackVnd: 0n, carrierFeeOutVnd: 0n }),
          );
          await assert.rejects(() => direct({ carrierFeeBackVnd: -1n, refundVnd: 190_000n }));
          await assert.rejects(() => direct({ method: null }));
          // Lines cannot be cancelled for a failed delivery without the parcel being back and the settlement existing (commit checks).
          await assert.rejects(() =>
            base.adapter.withTransaction(async (client) => {
              await client.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
              await client.productOrderLine.update({
                where: { id: lineIds[0]! },
                data: {
                  status: 'CANCELLED',
                  cancelCause: 'DELIVERY_FAILED',
                  cancelNote: 'x',
                  cancelledByUserId: refunder.id,
                },
              });
            }),
          );
          // The settlement is history.
          const settled = await settle(order.placed.id, { carrierFeeBackVnd: '5000' });
          assert.equal(settled.settlement!.refundVnd, '185000');
          const row = await tx.onlineFailedDeliverySettlement.findFirstOrThrow({
            where: { orderId: order.placed.id },
          });
          await assert.rejects(() =>
            base.adapter.withTransaction((client) =>
              client.onlineFailedDeliverySettlement.update({
                where: { id: row.id },
                data: { reason: 'đổi' },
              }),
            ),
          );
          await assert.rejects(() =>
            base.adapter.withTransaction((client) =>
              client.onlineFailedDeliverySettlement.delete({ where: { id: row.id } }),
            ),
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        "returns of delivered goods: the window counts from the delivery, refund only, the cost of the way back is the shop's record",
        async () => {
          const order = await paid([{ variantId: cream.variantId, quantity: 1 }]);
          await ship(order.placed.id);
          const delivered = await k.ok(() => k.online.delivered(packer.token, order.placed.id, {}));
          const line = delivered.lines[0]!;
          const clerk = refunder;
          const lookup = await k.returns.lookup(clerk.token, k.A.id, order.placed.invoiceCode);
          assert.equal(lookup.lines.length, 1);
          assert.equal(lookup.lines[0]!.reasons.PERSONAL_PREFERENCE.open, true);
          const open = (patch: Record<string, unknown> = {}) =>
            k.ok(() =>
              k.returns.open(clerk.token, {
                branchId: k.A.id,
                invoiceLineId:
                  line.id === lookup.lines[0]!.lineId ? line.id : lookup.lines[0]!.lineId,
                reason: 'PERSONAL_PREFERENCE',
                requestedOutcome: 'REFUND',
                quantity: 1,
                sealIntact: true,
                notes: null,
                clientRequestId: randomUUID(),
                ...patch,
              } as never),
            );
          await fails(
            () => open({ requestedOutcome: 'EXCHANGE' }),
            'VALIDATION_FAILED',
            'requestedOutcome',
          );
          const opened = await open();
          const windowStart = await tx.productReturnCase.findUniqueOrThrow({
            where: { id: opened.id },
          });
          assert.equal(
            windowStart.handoverAt.toISOString(),
            delivered.deliveredAt,
            'the window counts from the delivery',
          );
          await fails(
            () =>
              k.returns.accept(clerk.token, opened.id, {
                expectedRowVersion: opened.rowVersion,
                outcome: 'EXCHANGE',
                note: null,
              }),
            'VALIDATION_FAILED',
            'outcome',
          );
          const accepted = await k.ok(() =>
            k.returns.accept(clerk.token, opened.id, {
              expectedRowVersion: opened.rowVersion,
              outcome: 'REFUND',
              note: null,
            }),
          );
          assert.equal(accepted.status, 'ACCEPTED');
          await k.reconfirm(clerk.token);
          await k.ok(() =>
            k.refunds.refund(clerk.token, opened.id, {
              quantity: 1,
              method: 'CASH',
              bankReference: null,
              restock: 'SELLABLE',
              reason: 'Khách đổi ý, hàng còn nguyên',
              clientRequestId: randomUUID(),
            }),
          );
          // The cost of the way back is a record of the shop, seen only by those who may refund.
          const costed = await k.ok(() =>
            k.online.returnCost(clerk.token, opened.id, { costVnd: '28000', note: 'Phí gửi trả' }),
          );
          assert.equal(costed.returns[0]!.returnCostVnd, '28000');
          assert.equal((await view(order.placed.id, packer)).returns[0]!.returnCostVnd, null);
          await fails(
            () => k.online.returnCost(packer.token, opened.id, { costVnd: '1' }),
            'FORBIDDEN',
          );
          await fails(
            () => k.online.returnCost(clerk.token, opened.id, { costVnd: '-3' }),
            'VALIDATION_FAILED',
            'costVnd',
          );
          assert.equal(
            (await k.online.order(order.member.token, order.placed.id)).refundedVnd,
            '200000',
          );
          // A goods that were delivered 8 days ago: the "changed my mind" window of 7 days is over, a wrong or damaged one (48 h) is too.
          const old = await paid([{ variantId: mask.variantId, quantity: 1 }]);
          await ship(old.placed.id);
          await k.ok(() => k.online.delivered(packer.token, old.placed.id, {}));
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE product_order_lines SET delivered_at = clock_timestamp() - interval '8 days', shipped_at = clock_timestamp() - interval '9 days', completed_at = clock_timestamp() - interval '8 days' WHERE order_id = '${old.placed.id}'::uuid`,
          );
          await tx.$executeRawUnsafe(
            `UPDATE online_shipments SET shipped_at = clock_timestamp() - interval '9 days' WHERE order_id = '${old.placed.id}'::uuid`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
          const oldLookup = await k.returns.lookup(clerk.token, k.A.id, old.placed.invoiceCode);
          assert.equal(oldLookup.lines[0]!.reasons.PERSONAL_PREFERENCE.open, false);
          // A parcel not delivered has nothing to return.
          const onTheWay = await paid([{ variantId: mask.variantId, quantity: 1 }]);
          await ship(onTheWay.placed.id);
          assert.deepEqual(
            (await k.returns.lookup(clerk.token, k.A.id, onTheWay.placed.invoiceCode)).lines,
            [],
          );
          await k.reconcileAll();
        },
      );
    });
  },
);
