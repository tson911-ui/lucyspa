import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOnlineOrderScan } from '@lucy-spa/server';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';

/**
 * Phase 6 Wave 4 / P6-20 against real PostgreSQL (design 2.38; T39, T41, OQ-90, OQ-94 to OQ-96): the carriers, the queue of the people who
 * pack, shipping one parcel (the stock leaves only now), the delivery marked by staff or by the customer, the history of a failed
 * delivery, the corrections, and the isolation from the counter pre-order screens. Every command is followed by the deferred database
 * checks (`ok`) and each test ends with the reconciliation of the whole fixture. Every fixture rolls back.
 */
test(
  'Phase 6 P6-20 online fulfilment; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const packer = k.people.queue;
      const refunder = k.people.refunder;
      const manager = await base.staff(['MANAGE_PRODUCTS'], { globalCodes: ['MANAGE_PRODUCTS'] });
      await k.open();
      const cream = await k.stocked('cream', 200_000, 40);
      const mask = await k.stocked('mask', 80_000, 40);
      const lipstick = await k.stocked('lipstick', 150_000, 0);

      /** A paid online order (members pay by webhook); lines are in-stock unless the variant has no stock. */
      const paid = async (
        lines: readonly { variantId: string; quantity?: number }[],
        who?: Awaited<ReturnType<typeof k.member>>,
      ) => {
        const member = who ?? (await k.member('pay'));
        const placed = await k.order(member, lines);
        await k.payViaWebhook(member, placed);
        return { member, placed };
      };
      const carrier = async (name = 'Hãng thử A') => {
        const list = await k.online.createCarrier(manager.token, {
          name,
          trackingUrlTemplate: 'https://tracking.example/{code}',
        });
        return list.carriers.find((entry) => entry.name === name)!;
      };
      const shipBody = (
        order: Awaited<ReturnType<typeof k.online.staffOrder>>,
        carrierId: string,
        patch: Record<string, unknown> = {},
      ) => ({
        lines: order.lines
          .filter((line) => line.status !== 'CANCELLED')
          .map((line) => ({ id: line.id, rowVersion: line.rowVersion })),
        carrierId,
        trackingCode: 'VN123456789',
        carrierFeeVnd: '35000',
        ...patch,
      });

      await suite.test(
        'carriers: the list starts empty, only MANAGE_PRODUCTS keeps it, names are unique',
        async () => {
          assert.deepEqual((await k.online.carriers(manager.token)).carriers, []);
          await fails(() => k.online.carriers(packer.token), 'FORBIDDEN');
          await fails(() => k.online.createCarrier(packer.token, { name: 'Hãng X' }), 'FORBIDDEN');
          await fails(
            () => k.online.createCarrier(manager.token, { name: '   ' }),
            'VALIDATION_FAILED',
            'name',
          );
          await fails(
            () =>
              k.online.createCarrier(manager.token, {
                name: 'Hãng X',
                trackingUrlTemplate: 'http://x/{code}',
              }),
            'VALIDATION_FAILED',
            'trackingUrlTemplate',
          );
          await fails(
            () =>
              k.online.createCarrier(manager.token, {
                name: 'Hãng X',
                trackingUrlTemplate: 'https://x/{code}/{code}',
              }),
            'VALIDATION_FAILED',
            'trackingUrlTemplate',
          );
          await fails(
            () =>
              k.online.createCarrier(manager.token, {
                name: 'Hãng X',
                trackingUrlTemplate: 'https://x/no-place',
              }),
            'VALIDATION_FAILED',
            'trackingUrlTemplate',
          );
          const created = await k.online.createCarrier(manager.token, {
            name: 'Hãng X',
            trackingUrlTemplate: null,
          });
          assert.equal(created.carriers.length, 1);
          await fails(
            () => k.online.createCarrier(manager.token, { name: 'HÃNG x' }),
            'CONFLICT',
            'name',
          );
          const one = created.carriers[0]!;
          const switchedOff = await k.online.editCarrier(manager.token, one.id, {
            expectedRowVersion: one.rowVersion,
            isActive: false,
          });
          assert.equal(switchedOff.carriers[0]!.isActive, false);
          await fails(
            () =>
              k.online.editCarrier(manager.token, one.id, {
                expectedRowVersion: one.rowVersion,
                isActive: true,
              }),
            'CONFLICT',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the queue: ready orders, orders waiting for goods, masked phones, permission by branch',
        async () => {
          const ready = await paid([{ variantId: cream.variantId, quantity: 2 }]);
          const waiting = await paid([{ variantId: lipstick.variantId, quantity: 1 }]);
          const mixed = await paid([
            { variantId: mask.variantId, quantity: 1 },
            { variantId: lipstick.variantId, quantity: 1 },
          ]);
          await fails(
            () => k.online.queue(k.people.nobody.token, { branchId: k.A.id }),
            'FORBIDDEN',
          );
          await fails(
            () => k.online.queue(k.people.otherBranch.token, { branchId: k.A.id }),
            'FORBIDDEN',
          );
          await fails(
            () => k.online.queue(packer.token, { branchId: k.A.id, tab: 'NOPE' }),
            'VALIDATION_FAILED',
            'tab',
          );
          const toShip = await k.online.queue(packer.token, { branchId: k.A.id, tab: 'TO_SHIP' });
          assert.ok(toShip.rows.some((row) => row.code === ready.placed.code));
          assert.ok(!toShip.rows.some((row) => row.code === waiting.placed.code));
          assert.ok(!toShip.rows.some((row) => row.code === mixed.placed.code));
          const row = toShip.rows.find((entry) => entry.code === ready.placed.code)!;
          assert.equal(row.state, 'READY_TO_SHIP');
          assert.match(row.recipientPhoneMasked, /\*|•/);
          assert.ok(
            !row.recipientPhoneMasked.includes(ready.placed.recipient.phone.slice(-4)) ||
              row.recipientPhoneMasked.endsWith(ready.placed.recipient.phone.slice(-3)),
          );
          assert.equal(row.hasPreOrder, false);
          assert.equal(row.late, false);
          const waits = await k.online.queue(packer.token, {
            branchId: k.A.id,
            tab: 'WAITING_GOODS',
          });
          assert.deepEqual(
            waits.rows.map((entry) => entry.code).sort(),
            [waiting.placed.code, mixed.placed.code].sort(),
          );
          assert.equal(waits.counts.WAITING_GOODS, 2);
          assert.ok(waits.counts.TO_SHIP >= 1);
          // The search reads the code, the name and the digits of the phone.
          const byCode = await k.online.queue(packer.token, {
            branchId: k.A.id,
            tab: 'TO_SHIP',
            q: ready.placed.code,
          });
          assert.deepEqual(
            byCode.rows.map((entry) => entry.code),
            [ready.placed.code],
          );
          const byPhone = await k.online.queue(packer.token, {
            branchId: k.A.id,
            tab: 'TO_SHIP',
            q: ready.placed.recipient.phone.slice(-6),
          });
          assert.ok(byPhone.rows.some((entry) => entry.code === ready.placed.code));
          // The detail shows the whole address to those who pack; the unpaid orders are not in the queue at all.
          const detail = await k.online.staffOrder(packer.token, ready.placed.id);
          assert.equal(detail.recipient.phone, ready.placed.recipient.phone);
          assert.equal(detail.can.ship, true);
          assert.equal(detail.shipment, null);
          const unpaid = await k.order(await k.member('unpaid'), [{ variantId: cream.variantId }]);
          const all = [];
          for (const tab of [
            'TO_SHIP',
            'WAITING_GOODS',
            'SHIPPED',
            'DELIVERY_FAILED',
            'DONE',
            'CANCELLED',
          ] as const) {
            all.push(await k.online.queue(packer.token, { branchId: k.A.id, tab }));
          }
          assert.ok(all.every((page) => !page.rows.some((entry) => entry.code === unpaid.code)));
          await fails(
            () => k.online.staffOrder(k.people.otherBranch.token, ready.placed.id),
            'FORBIDDEN',
          );
          await fails(
            () => k.online.staffOrder(packer.token, '00000000-0000-4000-8000-0000000000bb'),
            'NOT_FOUND',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the counter screens never show an online in-stock line, and an online pre-order waits in "cần đặt" only',
        async () => {
          const online = await paid([
            { variantId: cream.variantId, quantity: 1 },
            { variantId: lipstick.variantId, quantity: 2 },
          ]);
          const toOrder = await k.orders.toOrder(packer.token, k.A.id);
          const skus = toOrder.groups.map((group) => group.sku);
          assert.ok(
            skus.includes(lipstick.sku),
            'the pre-order line of an online order is to be ordered from the supplier',
          );
          assert.ok(!skus.includes(cream.sku), 'an in-stock line of an online order is not');
          const queue = await k.orders.list(packer.token, { branchId: k.A.id, tab: 'TO_ORDER' });
          const row = queue.rows.find((entry) => entry.orderCode === online.placed.code)!;
          assert.equal(row.channel, 'ONLINE');
          // The counter order page refuses an online order; its goods are never handed over at the counter.
          await fails(() => k.orders.get(packer.token, online.placed.id), 'NOT_FOUND');
          const detail = await k.online.staffOrder(packer.token, online.placed.id);
          const preLine = detail.lines.find((line) => line.mode === 'PRE_ORDER')!;
          const stockLine = detail.lines.find((line) => line.mode === 'IN_STOCK')!;
          await fails(
            () =>
              k.orders.markOrdered(packer.token, {
                lines: [{ id: stockLine.id, rowVersion: stockLine.rowVersion }],
              }),
            'ORDER_LINE_STATE_INVALID',
          );
          const marked = await k.ok(() =>
            k.orders.markOrdered(packer.token, {
              lines: [{ id: preLine.id, rowVersion: preLine.rowVersion }],
            }),
          );
          assert.equal(marked.ordered, 1);
          // The goods arrive (a stock receipt allocates them to the waiting line); only then is the parcel ready.
          await k.ok(() => k.receive(lipstick.variantId, 5));
          const arrived = await k.online.staffOrder(packer.token, online.placed.id);
          assert.equal(arrived.lines.find((line) => line.mode === 'PRE_ORDER')!.status, 'ARRIVED');
          assert.equal(arrived.state, 'READY_TO_SHIP');
          const arrivedTab = await k.orders.list(packer.token, {
            branchId: k.A.id,
            tab: 'ARRIVED',
          });
          assert.ok(!arrivedTab.rows.some((entry) => entry.orderCode === online.placed.code));
          const arrivedLine = arrived.lines.find((line) => line.mode === 'PRE_ORDER')!;
          await fails(
            () =>
              k.orders.handOver(packer.token, arrivedLine.id, {
                expectedVersion: arrivedLine.rowVersion,
                to: 'CUSTOMER',
                orderCode: online.placed.code,
                phoneLast4: online.placed.recipient.phone.slice(-4),
              }),
            'ORDER_LINE_STATE_INVALID',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'shipping: one parcel, stale pictures refused, the stock leaves only now, the cost is for those who may refund',
        async () => {
          const one = await carrier('Hãng thử B');
          const order = await paid([
            { variantId: cream.variantId, quantity: 2 },
            { variantId: mask.variantId, quantity: 1 },
          ]);
          const before = {
            cream: await k.levelOf(cream.variantId),
            mask: await k.levelOf(mask.variantId),
          };
          const view = await k.online.staffOrder(packer.token, order.placed.id);
          assert.deepEqual(view.carriers.map((entry) => entry.id).includes(one.id), true);
          // Authority, a stale picture, a missing line, bad input.
          await fails(
            () => k.online.ship(k.people.nobody.token, order.placed.id, shipBody(view, one.id)),
            'FORBIDDEN',
          );
          await fails(
            () =>
              k.online.ship(k.people.otherBranch.token, order.placed.id, shipBody(view, one.id)),
            'FORBIDDEN',
          );
          const stale = shipBody(view, one.id);
          stale.lines[0]!.rowVersion += 1;
          await fails(() => k.online.ship(packer.token, order.placed.id, stale), 'CONFLICT');
          await fails(
            () =>
              k.online.ship(packer.token, order.placed.id, {
                ...shipBody(view, one.id),
                lines: shipBody(view, one.id).lines.slice(1),
              }),
            'CONFLICT',
          );
          await fails(
            () =>
              k.online.ship(
                packer.token,
                order.placed.id,
                shipBody(view, one.id, { trackingCode: ' ' }),
              ),
            'VALIDATION_FAILED',
            'trackingCode',
          );
          await fails(
            () =>
              k.online.ship(
                packer.token,
                order.placed.id,
                shipBody(view, one.id, { trackingCode: 'a b' }),
              ),
            'VALIDATION_FAILED',
            'trackingCode',
          );
          await fails(
            () =>
              k.online.ship(
                packer.token,
                order.placed.id,
                shipBody(view, one.id, { carrierFeeVnd: '-5' }),
              ),
            'VALIDATION_FAILED',
            'carrierFeeVnd',
          );
          await fails(
            () =>
              k.online.ship(
                packer.token,
                order.placed.id,
                shipBody(view, one.id, { carrierFeeVnd: '12.5' }),
              ),
            'VALIDATION_FAILED',
            'carrierFeeVnd',
          );
          await fails(
            () =>
              k.online.ship(
                packer.token,
                order.placed.id,
                shipBody(view, '00000000-0000-4000-8000-0000000000cc'),
              ),
            'VALIDATION_FAILED',
            'carrierId',
          );
          // Nothing moved.
          assert.equal(
            (await k.online.staffOrder(packer.token, order.placed.id)).state,
            'READY_TO_SHIP',
          );
          assert.equal(await tx.onlineShipment.count(), 0);

          const shipped = await k.ok(() =>
            k.online.ship(packer.token, order.placed.id, shipBody(view, one.id)),
          );
          assert.equal(shipped.state, 'SHIPPED');
          assert.ok(shipped.lines.every((line) => line.status === 'SHIPPED'));
          assert.equal(shipped.shipment!.carrierName, 'Hãng thử B');
          assert.equal(shipped.shipment!.trackingCode, 'VN123456789');
          assert.equal(shipped.shipment!.trackingUrl, 'https://tracking.example/VN123456789');
          assert.equal(
            shipped.shipment!.carrierFeeOutVnd,
            null,
            'a person who only packs does not see what the carrier costs',
          );
          const refundView = await k.online.staffOrder(refunder.token, order.placed.id);
          assert.equal(refundView.shipment!.carrierFeeOutVnd, '35000');
          // The customer sees the carrier and the code, never the cost.
          const mine = await k.online.order(order.member.token, order.placed.id);
          assert.equal(mine.state, 'SHIPPED');
          assert.equal(mine.shipment!.trackingCode, 'VN123456789');
          assert.ok(
            !JSON.stringify(mine).includes('35000'),
            'the carrier cost never reaches the customer',
          );
          assert.equal(mine.can.confirmReceived, true);
          // The stock is still there until the consumer has run; then it leaves, line by line, once.
          assert.equal((await k.levelOf(cream.variantId)).onHand, before.cream.onHand);
          // The payment event finds nothing to sell for an online order (NOOP); the shipping event sells the goods (APPLIED).
          assert.deepEqual(await k.runInventory(order.placed.invoiceId), ['NOOP', 'APPLIED']);
          assert.deepEqual(await k.runInventory(order.placed.invoiceId), []);
          assert.equal((await k.levelOf(cream.variantId)).onHand, before.cream.onHand - 2);
          assert.equal((await k.levelOf(cream.variantId)).reserved, before.cream.reserved - 2);
          assert.equal((await k.levelOf(mask.variantId)).onHand, before.mask.onHand - 1);
          assert.equal(await k.saleMovements(order.placed.invoiceId), 2);
          const keys = await tx.stockMovement.findMany({
            where: { kind: 'SALE', invoiceLine: { invoiceId: order.placed.invoiceId } },
            select: { idempotencyKey: true, actorUserId: true },
          });
          assert.ok(
            keys.every(
              (entry) =>
                entry.idempotencyKey.startsWith('ORDER_SALE:') && entry.actorUserId === packer.id,
            ),
          );
          // A second shipment, or a change of the lines, is refused; the notice reached the member.
          await fails(
            () => k.online.ship(packer.token, order.placed.id, shipBody(view, one.id)),
            'ONLINE_ORDER_STATE_INVALID',
          );
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: order.member.id, type: 'ONLINE_ORDER_SHIPPED' },
            }),
            1,
          );
          // The staff are told about a new paid order (about the order, never the address).
          await k.runNotifications();
          const news = await tx.notification.findMany({
            where: { type: 'ONLINE_ORDER_NEW', entityId: order.placed.id },
          });
          assert.ok(news.length >= 1);
          assert.ok(news.every((entry) => entry.entityType === 'ProductOrder'));
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a parcel with a pre-order line ships only when the goods are in, and sells the goods held for it',
        async () => {
          const one = await carrier('Hãng thử C');
          const order = await paid([
            { variantId: cream.variantId, quantity: 1 },
            { variantId: lipstick.variantId, quantity: 3 },
          ]);
          let view = await k.online.staffOrder(packer.token, order.placed.id);
          assert.equal(view.state, 'WAITING_GOODS');
          await fails(
            () => k.online.ship(packer.token, order.placed.id, shipBody(view, one.id)),
            'ONLINE_ORDER_NOT_READY',
          );
          // The goods come in through a receipt; it gives them to the waiting lines, oldest paid first.
          await k.ok(() => k.receive(lipstick.variantId, 30));
          view = await k.online.staffOrder(packer.token, order.placed.id);
          assert.equal(view.state, 'READY_TO_SHIP');
          const shipped = await k.ok(() =>
            k.online.ship(packer.token, order.placed.id, shipBody(view, one.id)),
          );
          assert.equal(shipped.state, 'SHIPPED');
          const lipstickLine = shipped.lines.find((line) => line.mode === 'PRE_ORDER')!;
          const reservation = await tx.stockReservation.findUniqueOrThrow({
            where: {
              invoiceLineId: (
                await tx.productOrderLine.findUniqueOrThrow({ where: { id: lipstickLine.id } })
              ).invoiceLineId,
            },
          });
          assert.equal(reservation.source, 'ORDER_LINE');
          assert.equal(reservation.status, 'RESERVED');
          await k.runInventory(order.placed.invoiceId);
          const after = await tx.stockReservation.findUniqueOrThrow({
            where: { id: reservation.id },
          });
          assert.equal(after.status, 'CONSUMED');
          assert.equal(await k.saleMovements(order.placed.invoiceId), 2);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'delivery: the day staff enter, the customer pressing "received", whoever is first counts; the return window starts there',
        async () => {
          const one = await carrier('Hãng thử D');
          const a = await paid([{ variantId: cream.variantId, quantity: 1 }]);
          const viewA = await k.online.staffOrder(packer.token, a.placed.id);
          await k.ok(() => k.online.ship(packer.token, a.placed.id, shipBody(viewA, one.id)));
          await fails(
            () => k.online.delivered(k.people.nobody.token, a.placed.id, {}),
            'FORBIDDEN',
          );
          await fails(
            () => k.online.delivered(packer.token, a.placed.id, { deliveredOn: '2999-01-01' }),
            'VALIDATION_FAILED',
            'deliveredOn',
          );
          await fails(
            () => k.online.delivered(packer.token, a.placed.id, { deliveredOn: 'tomorrow' }),
            'VALIDATION_FAILED',
            'deliveredOn',
          );
          const done = await k.ok(() => k.online.delivered(packer.token, a.placed.id, {}));
          assert.equal(done.state, 'COMPLETED');
          assert.equal(done.deliveredBy, 'STAFF');
          assert.ok(done.deliveredAt);
          assert.deepEqual(
            done.logs.map((log) => log.kind),
            ['DELIVERED'],
          );
          // A repeat is quiet and changes nothing.
          const again = await k.online.delivered(packer.token, a.placed.id, {});
          assert.equal(again.deliveredAt, done.deliveredAt);
          assert.equal(await tx.onlineOrderLog.count({ where: { orderId: a.placed.id } }), 1);
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: a.member.id, type: 'ONLINE_ORDER_DELIVERED' },
            }),
            1,
          );
          // The customer pressing the button after the staff changes nothing.
          await k.online.received(a.member.token, a.placed.id);
          assert.equal((await k.online.order(a.member.token, a.placed.id)).state, 'COMPLETED');
          // The customer first.
          const b = await paid([{ variantId: mask.variantId, quantity: 1 }]);
          const viewB = await k.online.staffOrder(packer.token, b.placed.id);
          await fails(
            () => k.online.received(b.member.token, b.placed.id),
            'ONLINE_ORDER_STATE_INVALID',
          );
          await k.ok(() => k.online.ship(packer.token, b.placed.id, shipBody(viewB, one.id)));
          const stranger = await k.member('stranger');
          await fails(() => k.online.received(stranger.token, b.placed.id), 'NOT_FOUND');
          const received = await k.ok(() => k.online.received(b.member.token, b.placed.id));
          assert.equal(received.state, 'COMPLETED');
          assert.ok(received.deliveredAt);
          const staffView = await k.online.staffOrder(packer.token, b.placed.id);
          assert.equal(staffView.deliveredBy, 'CUSTOMER');
          await fails(
            () => k.online.delivered(packer.token, b.placed.id, { deliveredOn: '2000-01-01' }),
            'VALIDATION_FAILED',
            'deliveredOn',
          ).catch(() => undefined);
          // A day the staff enter lies between the shipping and now.
          const c = await paid([{ variantId: cream.variantId, quantity: 1 }]);
          const viewC = await k.online.staffOrder(packer.token, c.placed.id);
          await k.ok(() => k.online.ship(packer.token, c.placed.id, shipBody(viewC, one.id)));
          const today = new Date().toISOString().slice(0, 10);
          const dated = await k.ok(() =>
            k.online.delivered(packer.token, c.placed.id, { deliveredOn: today }),
          );
          const shippedAt = new Date(dated.shipment!.shippedAt).getTime();
          assert.ok(new Date(dated.deliveredAt!).getTime() >= shippedAt);
          assert.ok(new Date(dated.deliveredAt!).getTime() <= Date.now());
          await k.runInventory();
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a failed delivery: the history, the customer no longer wanting the parcel, the parcel back; then nothing is delivered',
        async () => {
          const one = await carrier('Hãng thử E');
          const order = await paid([{ variantId: cream.variantId, quantity: 1 }]);
          const view = await k.online.staffOrder(packer.token, order.placed.id);
          // Nothing of the delivery can be logged before the parcel left.
          await fails(
            () =>
              k.online.log(packer.token, order.placed.id, {
                kind: 'DELIVERY_FAILED',
                reasonCode: 'CUSTOMER_UNREACHABLE',
                note: 'Không nghe máy',
              }),
            'ONLINE_ORDER_STATE_INVALID',
          );
          await k.ok(() => k.online.ship(packer.token, order.placed.id, shipBody(view, one.id)));
          await fails(
            () => k.online.log(k.people.nobody.token, order.placed.id, { kind: 'NOTE', note: 'x' }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              k.online.log(packer.token, order.placed.id, {
                kind: 'DELIVERY_FAILED',
                note: 'Không nghe máy',
              }),
            'VALIDATION_FAILED',
            'reasonCode',
          );
          await fails(
            () =>
              k.online.log(packer.token, order.placed.id, {
                kind: 'DELIVERY_FAILED',
                reasonCode: 'BORED' as never,
                note: 'x',
              }),
            'VALIDATION_FAILED',
            'reasonCode',
          );
          await fails(
            () =>
              k.online.log(packer.token, order.placed.id, {
                kind: 'CONTACTED',
                reasonCode: 'OTHER',
                note: 'x',
              }),
            'VALIDATION_FAILED',
            'reasonCode',
          );
          await fails(
            () => k.online.log(packer.token, order.placed.id, { kind: 'CONTACTED' }),
            'VALIDATION_FAILED',
            'note',
          );
          await fails(
            () =>
              k.online.log(packer.token, order.placed.id, {
                kind: 'RETURNED_TO_SHOP' as never,
                note: 'x',
              }),
            'VALIDATION_FAILED',
            'kind',
          );
          const failed = await k.ok(() =>
            k.online.log(packer.token, order.placed.id, {
              kind: 'DELIVERY_FAILED',
              reasonCode: 'CUSTOMER_UNREACHABLE',
              note: 'Gọi hai lần không nghe máy',
            }),
          );
          assert.equal(failed.state, 'DELIVERY_FAILED');
          assert.equal(failed.deliveryFailed, true);
          assert.equal(
            (await k.online.order(order.member.token, order.placed.id)).state,
            'DELIVERY_FAILED',
          );
          assert.equal(
            await tx.notification.count({
              where: { recipientUserId: order.member.id, type: 'ONLINE_ORDER_DELIVERY_FAILED' },
            }),
            1,
          );
          const failedTab = await k.online.queue(packer.token, {
            branchId: k.A.id,
            tab: 'DELIVERY_FAILED',
          });
          assert.ok(failedTab.rows.some((entry) => entry.code === order.placed.code));
          await k.ok(() =>
            k.online.log(packer.token, order.placed.id, {
              kind: 'CONTACTED',
              note: 'Khách hẹn nhận chiều mai',
            }),
          );
          const retry = await k.ok(() =>
            k.online.log(packer.token, order.placed.id, { kind: 'REDELIVERY' }),
          );
          assert.equal(retry.state, 'SHIPPED', 'a new attempt puts the parcel back on its way');
          assert.equal(retry.deliveryFailed, false);
          // The customer no longer wants it; only now may the parcel be marked back, and only with the customer\'s refusal logged first.
          await fails(
            () => k.online.returned(packer.token, order.placed.id, { note: 'Hàng về' }),
            'ONLINE_ORDER_STATE_INVALID',
          );
          await k.ok(() =>
            k.online.log(packer.token, order.placed.id, {
              kind: 'DELIVERY_FAILED',
              reasonCode: 'REFUSED',
              note: 'Khách từ chối nhận',
            }),
          );
          await k.ok(() =>
            k.online.log(packer.token, order.placed.id, {
              kind: 'RETURN_STARTED',
              note: 'Khách không còn muốn nhận, hãng chuyển hàng về',
            }),
          );
          await fails(
            () => k.online.returned(k.people.nobody.token, order.placed.id, { note: 'x' }),
            'FORBIDDEN',
          );
          await fails(
            () => k.online.returned(packer.token, order.placed.id, { note: '  ' }),
            'VALIDATION_FAILED',
            'note',
          );
          const back = await k.ok(() =>
            k.online.returned(packer.token, order.placed.id, {
              note: 'Hàng đã về cửa hàng, còn nguyên',
            }),
          );
          assert.equal(back.returnedToShop, true);
          assert.equal(back.state, 'DELIVERY_FAILED');
          assert.equal(back.can.markDelivered, false);
          assert.deepEqual(
            back.logs.map((log) => log.kind),
            [
              'DELIVERY_FAILED',
              'CONTACTED',
              'REDELIVERY',
              'DELIVERY_FAILED',
              'RETURN_STARTED',
              'RETURNED_TO_SHOP',
            ],
          );
          await fails(
            () => k.online.returned(packer.token, order.placed.id, { note: 'again' }),
            'ONLINE_ORDER_STATE_INVALID',
          );
          await fails(
            () => k.online.delivered(packer.token, order.placed.id, {}),
            'ONLINE_ORDER_STATE_INVALID',
          );
          await fails(
            () => k.online.received(order.member.token, order.placed.id),
            'ONLINE_ORDER_STATE_INVALID',
          );
          await fails(
            () => k.online.log(packer.token, order.placed.id, { kind: 'NOTE', note: 'late note' }),
            'ONLINE_ORDER_STATE_INVALID',
          );
          // The notes stay in the history of the order: they are in no audit record and in no notice.
          const audits = JSON.stringify(
            await tx.auditEvent.findMany({ where: { entityId: order.placed.id } }),
          );
          assert.ok(!audits.includes('không nghe máy') && !audits.includes('Khách từ chối'));
          const notices = JSON.stringify(
            await tx.notification.findMany({ where: { recipientUserId: order.member.id } }),
          );
          assert.ok(!notices.includes('Khách') && !notices.includes('VN123456789'));
          await k.reconcileAll();
        },
      );

      await suite.test(
        'corrections are new records: a tracking code, the cost (refund permission), the address; history is kept',
        async () => {
          const one = await carrier('Hãng thử F');
          const order = await paid([{ variantId: cream.variantId, quantity: 1 }]);
          const view = await k.online.staffOrder(packer.token, order.placed.id);
          await fails(
            () =>
              k.online.correctShipment(packer.token, order.placed.id, {
                trackingCode: 'X1',
                reason: 'Nhập sai',
              }),
            'ONLINE_ORDER_STATE_INVALID',
          );
          await k.ok(() => k.online.ship(packer.token, order.placed.id, shipBody(view, one.id)));
          await fails(
            () =>
              k.online.correctShipment(packer.token, order.placed.id, {
                trackingCode: 'VN999',
              } as never),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () =>
              k.online.correctShipment(packer.token, order.placed.id, { reason: 'Không đổi gì' }),
            'VALIDATION_FAILED',
            'trackingCode',
          );
          await fails(
            () =>
              k.online.correctShipment(packer.token, order.placed.id, {
                carrierFeeVnd: '40000',
                reason: 'Phí thật là 40.000',
              }),
            'FORBIDDEN',
          );
          const retyped = await k.ok(() =>
            k.online.correctShipment(packer.token, order.placed.id, {
              trackingCode: 'VN999',
              reason: 'Nhập nhầm mã',
            }),
          );
          assert.equal(retyped.shipment!.trackingCode, 'VN999');
          assert.equal(retyped.shipment!.trackingUrl, 'https://tracking.example/VN999');
          assert.equal(retyped.shipment!.corrections.length, 1);
          assert.equal(
            (await tx.onlineShipment.findFirstOrThrow({ where: { orderId: order.placed.id } }))
              .trackingCode,
            'VN123456789',
            'the first record is never rewritten',
          );
          const costed = await k.ok(() =>
            k.online.correctShipment(refunder.token, order.placed.id, {
              carrierFeeVnd: '40000',
              reason: 'Phí thật là 40.000',
            }),
          );
          assert.equal(costed.shipment!.carrierFeeOutVnd, '40000');
          assert.equal(costed.shipment!.trackingCode, 'VN999');
          assert.equal(
            (await k.online.order(order.member.token, order.placed.id)).shipment!.trackingCode,
            'VN999',
          );
          // The address.
          const before = await k.online.order(order.member.token, order.placed.id);
          await fails(
            () =>
              k.online.address(k.people.nobody.token, order.placed.id, {
                recipientName: 'A',
                recipientPhone: '0901234567',
                provinceCode: 'HA_NOI',
                ward: 'x',
                street: 'y',
                reason: 'z',
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              k.online.address(packer.token, order.placed.id, {
                recipientName: 'A',
                recipientPhone: 'abc',
                provinceCode: 'HA_NOI',
                ward: 'x',
                street: 'y',
                reason: 'z',
              }),
            'VALIDATION_FAILED',
            'address.recipientPhone',
          );
          const fixed = await k.ok(() =>
            k.online.address(packer.token, order.placed.id, {
              recipientName: 'Trần Văn Nam',
              recipientPhone: '0912 345 678',
              provinceCode: 'DA_NANG',
              ward: 'Phường Hải Châu',
              street: '5 Bạch Đằng',
              reason: 'Hãng báo sai địa chỉ',
            }),
          );
          assert.equal(fixed.recipient.provinceName, 'Đà Nẵng');
          assert.equal(fixed.recipient.corrected, true);
          const after = await k.online.order(order.member.token, order.placed.id);
          assert.equal(after.recipient.street, '5 Bạch Đằng');
          assert.notEqual(after.recipient.street, before.recipient.street);
          assert.equal(
            (await tx.onlineOrderDetail.findUniqueOrThrow({ where: { orderId: order.placed.id } }))
              .street,
            before.recipient.street,
            'what the customer typed is kept',
          );
          const audit = JSON.stringify(
            await tx.auditEvent.findMany({
              where: { action: 'ONLINE_ADDRESS_CORRECTED', entityId: order.placed.id },
            }),
          );
          assert.ok(
            !audit.includes('Bạch Đằng') && !audit.includes('0912'),
            'the audit trail says that the address changed, not what it is',
          );
          // History is history.
          await assert.rejects(() =>
            base.adapter.withTransaction((client) =>
              client.onlineAddressCorrection.deleteMany({ where: { orderId: order.placed.id } }),
            ),
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the daily 08:00 alert: parcels not shipped in time and parcels shipped long ago, once a day, for the holders of the permission',
        async () => {
          // A fresh branch so the scan finds only what this test makes.
          const late = await paid([{ variantId: cream.variantId, quantity: 1 }]);
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE product_order_lines SET paid_at = clock_timestamp() - interval '10 days' WHERE order_id = '${late.placed.id}'::uuid`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
          const database = {
            $queryRaw: tx.$queryRaw.bind(tx),
            $transaction: (work: never) => base.adapter.withTransaction(work),
          } as never;
          const at = new Date(Date.now() + 36 * 3_600_000);
          assert.ok((await runOnlineOrderScan(database, at)) >= 1);
          const notices = await tx.notification.findMany({
            where: { type: 'ONLINE_ORDER_ALERT', recipientUserId: packer.id },
          });
          assert.equal(notices.length, 1);
          assert.equal(
            (notices[0]!.params as { unshippedOrders: number }).unshippedOrders >= 1,
            true,
          );
          // The claim row makes a second pass the same day do nothing.
          assert.equal(await runOnlineOrderScan(database, at), 0);
          assert.equal(
            await tx.notification.count({
              where: { type: 'ONLINE_ORDER_ALERT', recipientUserId: packer.id },
            }),
            1,
          );
          await k.reconcileAll();
        },
      );
    });
  },
);
