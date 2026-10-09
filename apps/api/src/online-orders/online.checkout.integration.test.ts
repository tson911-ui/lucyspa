import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';

/**
 * Phase 6 Wave 4 / P6-19 against real PostgreSQL (design 2.38; T41, OQ-39, OQ-89 to OQ-93, OQ-102, OQ-103): the master switch, the cart, the
 * checkout of an online order, the PayOS payment of a member, the cancellation of an unpaid order and the automatic cancel after the
 * deadline. Every command is followed by the deferred database checks (`ok`), and each test ends with the reconciliation of the whole
 * fixture (stock levels, invoices, order lines, reservations and sales). Every fixture rolls back.
 */
test(
  'Phase 6 P6-19 online checkout, payment and cancellation; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const manager = await base.staff(['MANAGE_PRODUCTS'], { globalCodes: ['MANAGE_PRODUCTS'] });
      const nobody = await base.staff([]);
      const cream = await k.stocked('cream', 200_000, 60);
      const serum = await k.stocked('serum', 120_000, 0);

      await suite.test('the shop is closed until the Owner opens it', async () => {
        const hoa = await k.member('hoa');
        const publicBefore = await k.online.publicSettings();
        assert.equal(publicBefore.enabled, false);
        assert.equal(publicBefore.freeShipping, true);
        assert.equal(publicBefore.shippingFeeVnd, '0');
        assert.equal(publicBefore.provinces.length, 34);
        assert.ok(publicBefore.policyVi.includes('Miễn phí giao hàng'));
        await fails(() => k.addToCart(hoa, cream.variantId), 'ONLINE_SALES_CLOSED');
        await fails(
          () =>
            k.online.place(hoa.token, {
              address: k.address(),
              acceptedPolicyVersion: 1,
              clientRequestId: '00000000-0000-4000-8000-0000000000aa',
            }),
          'ONLINE_SALES_CLOSED',
        );
        // The cart can be read while the shop is closed; it is empty and not ready.
        const cart = await k.cart(hoa);
        assert.deepEqual(cart.lines, []);
        assert.equal(cart.checkoutReady, false);
        // Staff and guests have no cart.
        await fails(() => k.online.cart(undefined), 'AUTHENTICATION_REQUIRED');
        await fails(() => k.online.cart(base.ownerToken), 'FORBIDDEN');
        await k.reconcileAll();
      });

      await suite.test(
        'the master switch: MANAGE_PRODUCTS only, never without a branch, every change audited',
        async () => {
          const initial = await k.online.settings(manager.token);
          assert.equal(initial.enabled, false);
          assert.equal(initial.fulfilmentBranchId, null);
          assert.equal(initial.shippingFeeEnabled, false);
          assert.equal(initial.unpaidTimeoutMinutes, 30);
          assert.equal(initial.maxUnpaidOrders, 3);
          assert.equal(initial.maxCartLines, 20);
          assert.equal(initial.maxLineQuantity, 10);
          await fails(() => k.online.settings(nobody.token), 'FORBIDDEN');
          await fails(
            () =>
              k.online.editSettings(nobody.token, {
                expectedVersion: initial.rowVersion,
                enabled: false,
              }),
            'FORBIDDEN',
          );
          await fails(
            () =>
              k.online.editSettings(manager.token, {
                expectedVersion: initial.rowVersion,
                enabled: true,
              }),
            'ONLINE_SALES_NEEDS_BRANCH',
          );
          await fails(
            () =>
              k.online.editSettings(manager.token, {
                expectedVersion: initial.rowVersion,
                enabled: true,
                fulfilmentBranchId: '00000000-0000-4000-8000-000000000001',
              }),
            'VALIDATION_FAILED',
            'fulfilmentBranchId',
          );
          await fails(
            () =>
              k.online.editSettings(manager.token, {
                expectedVersion: initial.rowVersion,
                transitDaysMin: 7,
                transitDaysMax: 3,
              }),
            'VALIDATION_FAILED',
            'transitDaysMax',
          );
          const opened = await k.online.editSettings(manager.token, {
            expectedVersion: initial.rowVersion,
            enabled: true,
            fulfilmentBranchId: k.A.id,
          });
          assert.equal(opened.enabled, true);
          assert.equal(opened.fulfilmentBranchName, 'Chi nhánh A');
          assert.equal(opened.rowVersion, initial.rowVersion + 1);
          await fails(
            () =>
              k.online.editSettings(manager.token, {
                expectedVersion: initial.rowVersion,
                enabled: false,
              }),
            'CONFLICT',
          );
          // A provider that is not configured keeps the switch from being turned on.
          const off = await k.online.editSettings(manager.token, {
            expectedVersion: opened.rowVersion,
            enabled: false,
          });
          await fails(
            () =>
              k.closedProvider.editSettings(manager.token, {
                expectedVersion: off.rowVersion,
                enabled: true,
              }),
            'PAYMENT_METHOD_UNAVAILABLE',
          );
          const again = await k.online.editSettings(manager.token, {
            expectedVersion: off.rowVersion,
            enabled: true,
          });
          // A new policy text is a new version customers accept again.
          const texted = await k.online.editSettings(manager.token, {
            expectedVersion: again.rowVersion,
            policyVi: 'Chính sách của cửa hàng.',
          });
          assert.equal(texted.policyVersion, again.policyVersion + 1);
          assert.equal((await k.online.publicSettings()).policyVi, 'Chính sách của cửa hàng.');
          const unchanged = await k.online.editSettings(manager.token, {
            expectedVersion: texted.rowVersion,
            policyVi: 'Chính sách của cửa hàng.',
          });
          assert.equal(unchanged.rowVersion, texted.rowVersion, 'a repeated value changes nothing');
          const audits = await tx.auditEvent.findMany({
            where: { entityType: 'OnlineSalesSettings' },
            orderBy: { occurredAt: 'asc' },
            select: { action: true, dataClassification: true },
          });
          assert.deepEqual(
            audits.map((entry) => entry.action),
            [
              'ONLINE_SALES_SWITCHED',
              'ONLINE_SALES_SWITCHED',
              'ONLINE_SALES_SWITCHED',
              'ONLINE_SALES_SETTINGS_UPDATED',
            ],
          );
          assert.ok(audits.every((entry) => entry.dataClassification === 'FINANCIAL'));
          await k.reconcileAll();
        },
      );

      await suite.test(
        "the cart: limits, today's price, the mode of each line, products sold in the shop only",
        async () => {
          const mai = await k.member('mai');
          const limited = await k.stocked('limited', 200_000, 5);
          const added = await k.addToCart(mai, limited.variantId, 2);
          assert.equal(added.lines.length, 1);
          assert.equal(added.lines[0]!.unitPriceVnd, '200000');
          assert.equal(added.lines[0]!.lineTotalVnd, '400000');
          assert.equal(added.lines[0]!.mode, 'IN_STOCK');
          assert.equal(added.subtotalVnd, '400000');
          assert.equal(added.checkoutReady, true);
          // Adding again grows the line; the line stops at the limit of 10.
          const grown = await k.addToCart(mai, limited.variantId, 3);
          assert.equal(grown.lines[0]!.quantity, 5);
          await fails(() => k.addToCart(mai, limited.variantId, 6), 'CART_LIMIT', 'quantity');
          // More than the stock holds, for a variant sold on order, is a pre-order of the whole line (never a split, OQ-90).
          const more = await k.online.setCartLine(mai.token, {
            variantId: limited.variantId,
            quantity: 7,
          });
          assert.equal(more.lines[0]!.mode, 'PRE_ORDER');
          assert.equal(more.hasPreOrder, true);
          assert.equal(more.lines[0]!.expectedDaysMin, 3);
          assert.equal(more.lines[0]!.expectedDaysMax, 5);
          // A variant that is not sold on order and not in stock has a problem.
          await k.updateVariant(serum.variantId, { sellOnOrder: false });
          const soldOut = await k.addToCart(mai, serum.variantId, 1);
          assert.equal(
            soldOut.lines.find((line) => line.variantId === serum.variantId)!.problem,
            'OUT_OF_STOCK',
          );
          assert.equal(soldOut.checkoutReady, false);
          await fails(() => k.online.quote(mai.token, {}), 'CART_NOT_READY');
          // A variant switched off online cannot be added (OQ-91).
          const shopOnly = await k.stocked('shop-only', 90_000, 3);
          await k.updateVariant(shopOnly.variantId, { sellOnline: false });
          await fails(
            () => k.addToCart(mai, shopOnly.variantId),
            'PRODUCT_NOT_SOLD_ONLINE',
            'variantId',
          );
          await fails(
            () => k.addToCart(mai, '00000000-0000-4000-8000-000000000009'),
            'PRODUCT_NOT_SELLABLE',
          );
          await fails(() => k.addToCart(mai, 'not-a-uuid'), 'VALIDATION_FAILED', 'variantId');
          // The price is the price of today.
          await k.updateVariant(serum.variantId, { sellOnOrder: true });
          await k.online.setCartLine(mai.token, { variantId: serum.variantId, quantity: 0 });
          await k.reprice(limited.variantId, 250_000);
          const repriced = await k.cart(mai);
          assert.equal(repriced.lines[0]!.unitPriceVnd, '250000');
          await k.reprice(limited.variantId, 200_000);
          // Another member never sees this cart.
          const other = await k.member('other');
          assert.deepEqual((await k.cart(other)).lines, []);
          // The limit of lines is the setting's.
          await k.configure({ maxCartLines: 1 });
          const extra = await k.stocked('extra', 50_000, 2);
          await fails(() => k.addToCart(mai, extra.variantId), 'CART_LIMIT', 'variantId');
          await k.configure({ maxCartLines: 20 });
          await k.online.setCartLine(mai.token, { variantId: limited.variantId, quantity: 0 });
          assert.deepEqual((await k.cart(mai)).lines, []);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the checkout: one order and one parcel, stock held for the in-stock line only, delivery details frozen',
        async () => {
          const lan = await k.member('lan');
          await k.addToCart(lan, cream.variantId, 2);
          await k.addToCart(lan, serum.variantId, 1);
          const quote = await k.online.quote(lan.token, {});
          assert.equal(quote.totalVnd, '520000');
          assert.equal(quote.shippingFeeVnd, '0');
          assert.equal(quote.hasPreOrder, true);
          // The quote saved nothing.
          assert.equal(await tx.invoice.count({ where: { payerUserId: lan.id } }), 0);
          assert.equal((await k.cart(lan)).lines.length, 2);
          const request = await k.checkoutRequest({ saveAddress: true });
          const placed = await k.ok(() => k.online.place(lan.token, request));
          assert.equal(placed.state, 'AWAITING_PAYMENT');
          assert.match(placed.code, /^ON[0-9]{6,}$/);
          assert.equal(placed.totalVnd, quote.totalVnd, 'the quote is the order');
          assert.equal(placed.shippingFeeVnd, '0');
          assert.equal(placed.hasPreOrder, true);
          assert.equal(placed.lines.length, 2);
          assert.deepEqual(
            placed.lines.map((line) => [line.mode, line.status]),
            [
              ['IN_STOCK', 'AWAITING_PAYMENT'],
              ['PRE_ORDER', 'AWAITING_PAYMENT'],
            ],
          );
          assert.equal(placed.recipient.provinceName, 'Hà Nội');
          assert.ok(placed.recipient.phone.startsWith('+84'));
          assert.ok(placed.deadlineAt);
          const minutes =
            (new Date(placed.deadlineAt!).getTime() - new Date(placed.placedAt).getTime()) / 60_000;
          assert.ok(minutes > 29 && minutes <= 30.5, `deadline ${minutes}`);
          const invoice = await k.invoiceRow(placed.invoiceId);
          assert.equal(invoice.channel, 'ONLINE');
          assert.equal(invoice.status, 'PENDING_PAYMENT');
          // Only the in-stock line holds stock (the whole line, an ordinary invoice reservation).
          assert.deepEqual(await k.reservationsOf(placed.invoiceId), [
            { source: 'INVOICE_LINE', status: 'RESERVED', quantity: 2, releaseCause: null },
          ]);
          // No seller on an online line; the cart is empty; the address is kept for next time.
          const details = await tx.invoiceLineProduct.findMany({
            where: { invoiceId: placed.invoiceId },
          });
          assert.ok(details.every((detail) => detail.sellerUserId === null));
          assert.deepEqual((await k.cart(lan)).lines, []);
          const kept = await k.online.addresses(lan.token);
          assert.equal(kept.addresses.length, 1);
          assert.equal(kept.addresses[0]!.provinceName, 'Hà Nội');
          // The same request returns the same order; nothing is made twice.
          const repeat = await k.online.place(lan.token, request);
          assert.equal(repeat.id, placed.id);
          assert.equal(await tx.productOrder.count({ where: { customerUserId: lan.id } }), 1);
          // The audit trail names the order and the lines, never the address or the phone.
          const audit = await tx.auditEvent.findFirstOrThrow({
            where: { action: 'ONLINE_ORDER_PLACED', entityId: placed.id },
          });
          const text = JSON.stringify(audit);
          assert.ok(
            !text.includes('Phố Huế') && !text.includes('+84'),
            'no personal data in the audit trail',
          );
          // Another member can neither read nor pay nor cancel it.
          const stranger = await k.member('stranger');
          await fails(() => k.online.order(stranger.token, placed.id), 'NOT_FOUND');
          await fails(() => k.online.pay(stranger.token, placed.id, 'vi'), 'NOT_FOUND');
          await fails(() => k.online.cancel(stranger.token, placed.id), 'NOT_FOUND');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a stale policy, an empty cart, the limit of unpaid orders (3), a bad address',
        async () => {
          const quan = await k.member('quan');
          await fails(() => k.place(quan), 'CART_EMPTY');
          await k.addToCart(quan, cream.variantId, 1);
          await fails(() => k.place(quan, { acceptedPolicyVersion: 999 }), 'ONLINE_POLICY_STALE');
          await fails(
            () => k.place(quan, { address: k.address({ provinceCode: 'ATLANTIS' }) }),
            'VALIDATION_FAILED',
            'address.provinceCode',
          );
          await fails(
            () => k.place(quan, { address: k.address({ recipientPhone: '12345' }) }),
            'VALIDATION_FAILED',
            'address.recipientPhone',
          );
          await fails(
            () => k.place(quan, { address: k.address({ street: '   ' }) }),
            'VALIDATION_FAILED',
            'address.street',
          );
          // Nothing was written by the refusals.
          assert.equal(await tx.invoice.count({ where: { payerUserId: quan.id } }), 0);
          assert.equal((await k.cart(quan)).lines.length, 1);
          const first = await k.place(quan);
          await k.addToCart(quan, cream.variantId, 1);
          const second = await k.place(quan);
          await k.addToCart(quan, cream.variantId, 1);
          const third = await k.place(quan);
          await k.addToCart(quan, cream.variantId, 1);
          await fails(() => k.place(quan), 'ONLINE_UNPAID_LIMIT');
          await fails(() => k.online.quote(quan.token, {}), 'ONLINE_UNPAID_LIMIT');
          // Cancelling one makes room again.
          await k.ok(() => k.online.cancel(quan.token, first.id));
          const fourth = await k.place(quan);
          assert.equal(fourth.state, 'AWAITING_PAYMENT');
          assert.notEqual(second.id, third.id);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the payment: a link until the deadline, one live request, the webhook pays the order; nothing is sold until it ships',
        async () => {
          const nga = await k.member('nga');
          const placed = await k.order(nga, [{ variantId: cream.variantId, quantity: 1 }]);
          const before = await k.levelOf(cream.variantId);
          const link = await k.ok(() => k.online.pay(nga.token, placed.id, 'vi'));
          assert.equal(link.status, 'PENDING');
          assert.ok(link.checkoutUrl && link.qrCode);
          assert.equal(link.amountVnd, '200000');
          assert.equal(
            link.expiresAt,
            placed.deadlineAt,
            'the link never outlives the order deadline',
          );
          // A second call returns the same live request (the provider is asked once).
          const calls = k.simulator.calls.length;
          const again = await k.online.pay(nga.token, placed.id, 'vi');
          assert.equal(again.paymentId, link.paymentId);
          assert.equal(k.simulator.calls.length, calls);
          const orderCode = [...k.simulator.orders.keys()].at(-1)!;
          const simulated = k.simulator.orders.get(orderCode)!;
          assert.equal(simulated.amount, 200_000);
          const outcome = await k.ok(() =>
            k.webhook.receive(k.simulator.pay(orderCode, { reference: 'TF-NGA-1' })),
          );
          assert.deepEqual(outcome, { received: true });
          // A second delivery of the same notification changes nothing.
          await k.ok(() =>
            k.webhook.receive(
              k.simulator.webhook({ orderCode, amount: 200_000, reference: 'TF-NGA-1' }),
            ),
          );
          const paid = await k.online.order(nga.token, placed.id);
          assert.equal(paid.state, 'READY_TO_SHIP');
          assert.equal(paid.lines[0]!.status, 'PAID');
          assert.ok(paid.paidAt);
          assert.equal(paid.can.cancel, false);
          assert.equal(paid.can.pay, false);
          // The stock stays held; the payment consumer sells nothing for an online order.
          await k.runInventory(placed.invoiceId);
          await k.relayInventory();
          assert.equal(
            await k.saleMovements(placed.invoiceId),
            0,
            'no sale before the parcel leaves',
          );
          const after = await k.levelOf(cream.variantId);
          assert.equal(after.onHand, before.onHand);
          assert.equal(after.reserved, before.reserved);
          assert.deepEqual(await k.reservationsOf(placed.invoiceId), [
            { source: 'INVOICE_LINE', status: 'RESERVED', quantity: 1, releaseCause: null },
          ]);
          // A paid order cannot be paid again or cancelled by the member.
          await fails(() => k.online.pay(nga.token, placed.id, 'vi'), 'ONLINE_ORDER_STATE_INVALID');
          await fails(() => k.online.cancel(nga.token, placed.id), 'ONLINE_ORDER_STATE_INVALID');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'cancelling an unpaid order releases the stock and the live PayOS request; the member can do it, nobody else',
        async () => {
          const oanh = await k.member('oanh');
          const placed = await k.order(oanh, [{ variantId: cream.variantId, quantity: 2 }]);
          const reservedBefore = (await k.levelOf(cream.variantId)).reserved;
          await k.ok(() => k.online.pay(oanh.token, placed.id, 'vi'));
          const orderCode = [...k.simulator.orders.keys()].at(-1)!;
          const cancelled = await k.ok(() => k.online.cancel(oanh.token, placed.id));
          assert.equal(cancelled.state, 'CANCELLED');
          assert.equal(
            k.simulator.orders.get(orderCode)!.status,
            'CANCELLED',
            'the request was cancelled at the provider',
          );
          assert.equal((await k.levelOf(cream.variantId)).reserved, reservedBefore - 2);
          assert.deepEqual(await k.reservationsOf(placed.invoiceId), [
            {
              source: 'INVOICE_LINE',
              status: 'RELEASED',
              quantity: 2,
              releaseCause: 'INVOICE_CANCELLED_UNPAID',
            },
          ]);
          const invoice = await k.invoiceRow(placed.invoiceId);
          assert.equal(invoice.status, 'CANCELLED');
          assert.equal(invoice.cancelledByUserId, oanh.id);
          // Repeating is quiet; a cancelled order cannot be paid.
          const repeat = await k.online.cancel(oanh.token, placed.id);
          assert.equal(repeat.state, 'CANCELLED');
          await fails(
            () => k.online.pay(oanh.token, placed.id, 'vi'),
            'ONLINE_ORDER_STATE_INVALID',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'after the deadline the system cancels the order and returns the stock; a payment at the last moment is credited, not cancelled',
        async () => {
          const phuong = await k.member('phuong');
          const waiting = await k.order(phuong, [{ variantId: cream.variantId, quantity: 1 }]);
          await k.ok(() => k.online.pay(phuong.token, waiting.id, 'vi'));
          const reservedBefore = (await k.levelOf(cream.variantId)).reserved;
          // Not yet overdue: nothing happens.
          const none = await k.sweep();
          assert.equal(none.cancelled, 0);
          await k.makeOverdue(waiting.id);
          const swept = await k.ok(() => k.sweep());
          assert.equal(swept.cancelled, 1);
          const gone = await k.online.order(phuong.token, waiting.id);
          assert.equal(gone.state, 'CANCELLED');
          assert.equal((await k.levelOf(cream.variantId)).reserved, reservedBefore - 1);
          const invoice = await k.invoiceRow(waiting.invoiceId);
          assert.equal(
            invoice.cancelledByUserId,
            phuong.id,
            "the order's own customer is the recorded user",
          );
          assert.match(invoice.cancelReason ?? '', /Quá hạn/);
          const audit = await tx.auditEvent.findFirstOrThrow({
            where: { entityId: waiting.invoiceId, action: 'INVOICE_CANCELLED' },
          });
          assert.equal(audit.actorKind, 'SYSTEM');
          assert.equal(audit.actorUserId, null);
          // The sweep is idempotent.
          assert.equal((await k.sweep()).examined, 0);

          // A customer who paid at the provider but whose webhook was missed is credited by the sweep, never cancelled.
          const tam = await k.member('tam');
          const late = await k.order(tam, [{ variantId: cream.variantId, quantity: 1 }]);
          await k.ok(() => k.online.pay(tam.token, late.id, 'vi'));
          const code = [...k.simulator.orders.keys()].at(-1)!;
          k.simulator.pay(code, { reference: 'TF-TAM-1' });
          await k.makeOverdue(late.id);
          const credited = await k.ok(() => k.sweep());
          assert.equal(credited.cancelled, 0);
          assert.equal(credited.credited, 1);
          assert.equal((await k.online.order(tam.token, late.id)).state, 'READY_TO_SHIP');
          // An unreachable provider means nothing is cancelled on a guess.
          const huong = await k.member('huong');
          const unsure = await k.order(huong, [{ variantId: cream.variantId, quantity: 1 }]);
          await k.ok(() => k.online.pay(huong.token, unsure.id, 'vi'));
          await k.makeOverdue(unsure.id);
          k.simulator.fail('read', 'UNREACHABLE', 1);
          const blind = await k.ok(() => k.sweep());
          assert.equal(blind.cancelled, 0);
          assert.equal((await k.online.order(huong.token, unsure.id)).state, 'AWAITING_PAYMENT');
          const retry = await k.ok(() => k.sweep());
          assert.equal(retry.cancelled, 1);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a confirmation that arrives after the cancel is an anomaly for management, never a silent double state',
        async () => {
          const kim = await k.member('kim');
          const placed = await k.order(kim, [{ variantId: cream.variantId, quantity: 1 }]);
          await k.ok(() => k.online.pay(kim.token, placed.id, 'vi'));
          const orderCode = [...k.simulator.orders.keys()].at(-1)!;
          await k.ok(() => k.online.cancel(kim.token, placed.id));
          const body = k.simulator.webhook({
            orderCode,
            amount: 200_000,
            reference: 'TF-KIM-LATE',
          });
          await k.ok(() => k.webhook.receive(body));
          const anomalies = await tx.paymentAnomaly.findMany({
            where: { invoiceId: placed.invoiceId },
          });
          assert.equal(anomalies.length, 1);
          assert.equal(anomalies[0]!.kind, 'INVOICE_NOT_PAYABLE');
          assert.equal((await k.online.order(kim.token, placed.id)).state, 'CANCELLED');
          assert.equal((await k.invoiceRow(placed.invoiceId)).status, 'CANCELLED');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'one voucher at most; the member discount and the shipping fee setting',
        async () => {
          const hang = await k.member('hang');
          await k.addToCart(hang, cream.variantId, 1);
          await fails(
            () => k.online.quote(hang.token, { voucherCode: 'khong-co-ma' }),
            'VOUCHER_INVALID',
          );
          // The shipping fee setting is OFF: a fee typed into it changes nothing until it is switched on (T40).
          await k.configure({ shippingFeeVnd: 30_000n });
          const free = await k.online.quote(hang.token, {});
          assert.equal(free.shippingFeeVnd, '0');
          assert.equal(free.totalVnd, '200000');
          await k.configure({ shippingFeeEnabled: true, freeShippingThresholdVnd: 500_000n });
          const charged = await k.online.quote(hang.token, {});
          assert.equal(charged.shippingFeeVnd, '30000');
          assert.equal(charged.totalVnd, '230000');
          const placed = await k.place(hang);
          assert.equal(placed.shippingFeeVnd, '30000');
          assert.equal(placed.totalVnd, '230000');
          await k.configure({
            shippingFeeEnabled: false,
            freeShippingThresholdVnd: null,
            shippingFeeVnd: 0n,
          });
          await k.ok(() => k.online.cancel(hang.token, placed.id));
          await k.reconcileAll();
        },
      );
    });
  },
);
