import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LocalDiskMediaStorage } from '@lucy-spa/server';
import { pino } from 'pino';
import { ProductReturnService } from '../product-returns/return.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productOrderKit } from '../testing/product-order-kit.js';

/**
 * Phase 6 P6-17 against real PostgreSQL (design 18.3, 18.4; T28, T31, T32, OQ-32, OQ-34, OQ-85, OQ-86, OQ-87): working the orders.
 * The queue and its tabs, marking goods ordered, the arrival of a receipt (oldest paid first, the member told), the hand-over with the
 * proof (the code and the last four digits of the phone number), the cancellation with a cause and the refund that goes with it (the
 * password once, the Owner told, the goods released), and the immutability of what was recorded. Every test ends with the
 * reconciliation of the stock and of the orders. Every fixture rolls back.
 */
test(
  'Phase 6 P6-17 working the orders: queue, ordered, arrival, hand-over, cancel with refund; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productOrderKit(base);
      const { tx, fails } = base;
      const { orders, people } = k;
      const worker = people.queue;
      const refunder = people.refunder;

      /** Gives a person a NEW password confirmation, as re-entering the password would (one confirmation covers one refund). */
      const confirmAgain = async (token: string) => {
        const principal = await base.adapter.resolve(token);
        assert.ok(principal?.userId, 'a signed-in person');
        await tx.$executeRawUnsafe('SELECT pg_sleep(0.003)');
        await tx.$executeRawUnsafe('SAVEPOINT confirm');
        try {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE sessions SET reauthenticated_at = date_trunc('milliseconds', clock_timestamp()) WHERE user_id = '${principal.userId}'`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT confirm');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT confirm');
          throw error;
        }
      };
      /** Moves a person's sessions ten minutes back (the test-only way to make a password confirmation stale). */
      const ageSession = async (userId: string) => {
        await tx.$executeRawUnsafe('SAVEPOINT age');
        try {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE sessions SET created_at = created_at - interval '10 minutes', reauthenticated_at = reauthenticated_at - interval '10 minutes' WHERE user_id = '${userId}'`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT age');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT age');
          throw error;
        }
      };
      const cancelBody = (version: number, patch: Record<string, unknown> = {}) => ({
        expectedVersion: version,
        cause: 'CUSTOMER_CHANGED_MIND',
        note: 'Khách đổi ý, đã hoàn tiền mặt',
        method: 'CASH',
        bankReference: null,
        clientRequestId: randomUUID(),
        ...patch,
      });
      const cancel = async (
        lineId: string,
        version: number,
        patch: Record<string, unknown> = {},
        actor: { token: string } = refunder,
      ) => {
        await confirmAgain(actor.token);
        return orders.cancelLine(actor.token, lineId, cancelBody(version, patch));
      };
      const mark = (lines: { id: string; rowVersion: number }[], actor = worker) =>
        orders.markOrdered(actor.token, { lines });
      const proof = (order: { code: string }, phone = '0901 234 567') => ({
        orderCode: order.code,
        phoneLast4: phone.replace(/\D/g, '').slice(-4),
      });
      /** Moves the expected date of a line back (the test-only way to make it late). */
      const setExpected = async (lineId: string, to: string) => {
        await tx.$executeRawUnsafe('SAVEPOINT late');
        try {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE product_order_lines SET expected_to = '${to}'::date, expected_from = LEAST(expected_from, '${to}'::date) WHERE id = '${lineId}'`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT late');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT late');
          throw error;
        }
      };
      const dateAfter = async (days: number) =>
        (
          await tx.$queryRawUnsafe<{ d: string }[]>(
            `SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + ${days}, 'YYYY-MM-DD') AS d`,
          )
        )[0]!.d;
      const arrivedNotices = (userId: string) =>
        tx.notification.findMany({
          where: { recipientUserId: userId, type: 'PRODUCT_ORDER_ARRIVED' },
        });

      await suite.test(
        'the queue: tabs by status, counts, search, oldest paid first, and only for those who work the orders',
        async () => {
          const product = await k.preOrderProduct('queue', 100_000);
          const first = await k.paidPreOrder(product.variantId, 1);
          const second = await k.paidPreOrder(product.variantId, 2, { phone: '0912 000 111' });
          const unpaid = await k.preOrder(product.variantId, 1);
          const list = (tab?: string, extra: { q?: string; page?: number } = {}) =>
            orders.list(worker.token, { branchId: k.A.id, ...(tab ? { tab } : {}), ...extra });

          const toOrderTab = await list();
          assert.equal(toOrderTab.tab, 'TO_ORDER');
          assert.deepEqual(
            toOrderTab.rows.map((row) => row.lineId),
            [first.line.id, second.line.id],
            'oldest paid first; the unpaid line is not in the queue',
          );
          assert.deepEqual(toOrderTab.counts, {
            TO_ORDER: 2,
            ORDERED: 0,
            ARRIVED: 0,
            DONE: 0,
            CANCELLED: 0,
          });
          assert.equal(toOrderTab.rows[0]!.late, false);
          assert.equal(toOrderTab.rows[1]!.contactPhone, '+84912000111');
          assert.deepEqual(
            (await list('TO_ORDER', { q: second.order.code })).rows.map((row) => row.lineId),
            [second.line.id],
          );
          assert.deepEqual(
            (await list('TO_ORDER', { q: '000111' })).rows.map((row) => row.lineId),
            [second.line.id],
            'the phone number is searched by its digits',
          );
          assert.equal((await list('ORDERED')).rows.length, 0);
          await fails(() => list('NONSENSE'), 'VALIDATION_FAILED', 'tab');
          // Those who sell but do not work the orders, and those at another branch, see nothing of the queue.
          await fails(() => orders.list(people.cashier.token, { branchId: k.A.id }), 'FORBIDDEN');
          await fails(() => orders.list(people.nobody.token, { branchId: k.A.id }), 'FORBIDDEN');
          await fails(() => orders.list(worker.token, { branchId: k.B.id }), 'FORBIDDEN');
          await fails(() => orders.list(worker.token, { branchId: randomUUID() }), 'NOT_FOUND');
          // The detail of an order carries what each line can do now.
          const detail = await orders.get(worker.token, first.order.id);
          assert.equal(detail.contactMasked, false);
          assert.equal(detail.lines[0]!.actions.markOrdered, true);
          assert.equal(detail.lines[0]!.actions.handOver, false);
          assert.deepEqual(detail.lines[0]!.actions.cancelCauses, [], 'the worker may not refund');
          assert.equal(detail.can.work, true);
          assert.equal(unpaid.line.status, 'AWAITING_PAYMENT');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'to order: paid lines grouped by variant under the usual supplier, those without a supplier last',
        async () => {
          const supplier = await tx.supplier.create({
            data: { name: 'Nhà cung cấp A' },
            select: { id: true },
          });
          const withSupplier = await k.preOrderProduct('with-supplier', 100_000);
          const without = await k.preOrderProduct('without-supplier', 100_000);
          await tx.productVariant.update({
            where: { id: withSupplier.variantId },
            data: { usualSupplierId: supplier.id, rowVersion: { increment: 1 } },
          });
          await k.paidPreOrder(without.variantId, 1);
          await k.paidPreOrder(withSupplier.variantId, 2);
          await k.paidPreOrder(withSupplier.variantId, 3);
          const result = await orders.toOrder(worker.token, k.A.id);
          const mine = result.groups.filter((group) =>
            [withSupplier.variantId, without.variantId].includes(group.variantId),
          );
          assert.deepEqual(
            mine.map((group) => [group.variantId, group.totalQuantity, group.lines.length]),
            [
              [withSupplier.variantId, 5, 2],
              [without.variantId, 1, 1],
            ],
          );
          assert.equal(mine[0]!.supplier?.id, supplier.id);
          assert.equal(mine[1]!.supplier, null);
          await fails(() => orders.toOrder(people.cashier.token, k.A.id), 'FORBIDDEN');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'mark ordered: paid to ordered, by version, never twice, never without the permission',
        async () => {
          const product = await k.preOrderProduct('mark', 100_000);
          const a = await k.paidPreOrder(product.variantId, 1);
          const b = await k.paidPreOrder(product.variantId, 1);
          const unpaid = await k.preOrder(product.variantId, 1);
          await fails(
            () => mark([{ id: a.line.id, rowVersion: a.line.rowVersion }], people.cashier),
            'FORBIDDEN',
          );
          await fails(
            () => mark([{ id: a.line.id, rowVersion: a.line.rowVersion + 5 }]),
            'CONFLICT',
          );
          await fails(
            () => mark([{ id: unpaid.line.id, rowVersion: unpaid.line.rowVersion }]),
            'ORDER_LINE_STATE_INVALID',
          );
          await fails(() => mark([]), 'VALIDATION_FAILED', 'lines');
          // One request, two lines: all or nothing.
          await fails(
            () =>
              mark([
                { id: a.line.id, rowVersion: a.line.rowVersion },
                { id: unpaid.line.id, rowVersion: unpaid.line.rowVersion },
              ]),
            'ORDER_LINE_STATE_INVALID',
          );
          assert.equal((await k.lineRow(a.line.id)).status, 'PAID');
          const done = await k.ok(() =>
            mark([
              { id: a.line.id, rowVersion: a.line.rowVersion },
              { id: b.line.id, rowVersion: b.line.rowVersion },
            ]),
          );
          assert.equal(done.ordered, 2);
          const row = await k.lineRow(a.line.id);
          assert.equal(row.status, 'ORDERED');
          assert.equal(row.orderedByUserId, worker.id);
          assert.ok(row.orderedAt);
          // The same lines again are no longer paid.
          await fails(
            () => mark([{ id: a.line.id, rowVersion: row.rowVersion }]),
            'ORDER_LINE_STATE_INVALID',
          );
          const events = await tx.productOrderEvent.findMany({
            where: { orderLineId: a.line.id },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          });
          assert.deepEqual(
            events.map((event) => event.toStatus),
            ['AWAITING_PAYMENT', 'PAID', 'ORDERED'],
          );
          const audit = await tx.auditEvent.findFirst({
            where: {
              action: 'PRODUCT_ORDER_LINES_ORDERED',
              entityId: { in: [a.order.id, b.order.id] },
            },
          });
          assert.ok(audit, 'the audit record exists');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a receipt gives the arrival to the oldest paid line first and tells the member, not the guest',
        async () => {
          const product = await k.preOrderProduct('arrival', 100_000);
          const member = await k.customer('arrive1');
          const first = await k.paidPreOrder(product.variantId, 2, { payer: member.id });
          const second = await k.paidPreOrder(product.variantId, 2);
          const third = await k.paidPreOrder(product.variantId, 2);
          await k.ok(() => mark([{ id: first.line.id, rowVersion: first.line.rowVersion }]));
          // Three units arrive: the first line takes two (T28, oldest paid first); one is left.
          await k.receive(product.variantId, 3);
          const a = await k.lineRow(first.line.id);
          assert.equal(a.status, 'ARRIVED');
          assert.ok(a.arrivedAt);
          assert.ok(a.arrivalReceiptId, 'the receipt that brought the goods is recorded');
          assert.equal((await k.reservationOf(first.line.invoiceLineId))?.status, 'RESERVED');
          const notices = await arrivedNotices(member.id);
          assert.equal(notices.length, 1, 'the member is told once');
          assert.equal(notices[0]!.contextCode, first.order.code);
          assert.equal(notices[0]!.entityId, first.invoice.id);
          const guestNotices = await tx.notification.count({
            where: { type: 'PRODUCT_ORDER_ARRIVED', contextCode: second.order.code },
          });
          assert.equal(guestNotices, 0, 'a customer without an account has no inbox');
          // One unit is left and every other line needs two: nothing else arrives (a line is given whole or not at all).
          assert.equal((await k.lineRow(second.line.id)).status, 'PAID');
          assert.equal((await k.lineRow(third.line.id)).status, 'PAID');
          // One more unit makes two free: the OLDEST waiting line gets them, the member is not told again.
          await k.receive(product.variantId, 1);
          assert.equal((await k.lineRow(second.line.id)).status, 'ARRIVED');
          assert.equal((await k.lineRow(third.line.id)).status, 'PAID');
          assert.equal((await arrivedNotices(member.id)).length, 1);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'allocate now: the same allocation on demand, and only for those who work the orders',
        async () => {
          const product = await k.preOrderProduct('allocate-now', 100_000);
          const sale = await k.paidPreOrder(product.variantId, 1);
          await fails(
            () => orders.allocate(people.cashier.token, { branchId: k.A.id }),
            'FORBIDDEN',
          );
          const none = await k.ok(() => orders.allocate(worker.token, { branchId: k.A.id }));
          assert.equal(none.allocated, 0, 'nothing to give');
          assert.equal((await k.lineRow(sale.line.id)).status, 'PAID');
          await k.receive(product.variantId, 1);
          assert.equal(
            (await k.lineRow(sale.line.id)).status,
            'ARRIVED',
            'the receipt already did it',
          );
          const again = await k.ok(() => orders.allocate(worker.token, { branchId: k.A.id }));
          assert.equal(again.allocated, 0, 'a repeat gives nothing twice');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'hand over: the proof must match; to the customer or a representative; the stock sale follows; nothing said is stored',
        async () => {
          const product = await k.preOrderProduct('hand', 100_000);
          const sale = await k.paidPreOrder(product.variantId, 1);
          // The goods arrive with the receipt, which gives them to the waiting line.
          await k.receive(product.variantId, 4);
          let line = await k.lineRow(sale.line.id);
          assert.equal(line.status, 'ARRIVED');
          const body = (patch: Record<string, unknown> = {}) => ({
            expectedVersion: line.rowVersion,
            to: 'CUSTOMER',
            representativeName: null,
            ...proof(sale.order),
            note: null,
            ...patch,
          });
          await fails(
            () => orders.handOver(people.cashier.token, sale.line.id, body()),
            'FORBIDDEN',
          );
          await fails(
            () => orders.handOver(worker.token, sale.line.id, body({ phoneLast4: '0000' })),
            'ORDER_HANDOVER_PROOF_INVALID',
          );
          await fails(
            () => orders.handOver(worker.token, sale.line.id, body({ orderCode: 'DH-SAI' })),
            'ORDER_HANDOVER_PROOF_INVALID',
          );
          await fails(
            () => orders.handOver(worker.token, sale.line.id, body({ phoneLast4: '12' })),
            'VALIDATION_FAILED',
            'phoneLast4',
          );
          await fails(
            () => orders.handOver(worker.token, sale.line.id, body({ to: 'REPRESENTATIVE' })),
            'VALIDATION_FAILED',
            'representativeName',
          );
          await fails(
            () =>
              orders.handOver(worker.token, sale.line.id, body({ representativeName: 'Bà Lan' })),
            'VALIDATION_FAILED',
            'representativeName',
          );
          await fails(
            () =>
              orders.handOver(
                worker.token,
                sale.line.id,
                body({ expectedVersion: line.rowVersion + 3 }),
              ),
            'CONFLICT',
          );
          assert.equal(
            (await k.lineRow(sale.line.id)).status,
            'ARRIVED',
            'a wrong proof changes nothing',
          );
          const handed = await k.ok(() =>
            orders.handOver(
              worker.token,
              sale.line.id,
              body({ to: 'REPRESENTATIVE', representativeName: 'Bà Lan', note: 'Con gái đến lấy' }),
            ),
          );
          assert.equal(handed.lines[0]!.status, 'HANDED_OVER');
          line = await k.lineRow(sale.line.id);
          assert.equal(line.handedOverTo, 'REPRESENTATIVE');
          assert.equal(line.handedOverToName, 'Bà Lan');
          assert.equal(line.handedOverByUserId, worker.id);
          // The goods leave the stock when the `inventory` consumer has run, and only then is the line complete.
          assert.equal(
            (await k.saleOf(sale.line.invoiceLineId)).movements.filter((m) => m.kind === 'SALE')
              .length,
            0,
          );
          await k.runInventory(sale.invoice.id);
          line = await k.lineRow(sale.line.id);
          assert.equal(line.status, 'COMPLETED');
          assert.ok(line.completedAt);
          assert.equal((await k.reservationOf(sale.line.invoiceLineId))?.status, 'CONSUMED');
          const audit = await tx.auditEvent.findFirst({
            where: { action: 'PRODUCT_ORDER_LINE_HANDED_OVER', entityId: sale.order.id },
          });
          assert.ok(audit);
          assert.ok(
            !JSON.stringify(audit.after).includes('0901'),
            'the phone digits are not in the audit record',
          );
          assert.equal(Reflect.get(Object(audit.after), 'proofChecked'), true);
          await fails(
            () =>
              orders.handOver(
                worker.token,
                sale.line.id,
                body({ expectedVersion: line.rowVersion }),
              ),
            'ORDER_LINE_STATE_INVALID',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'cancel: the cause must fit the state; the refund is the whole net share; the password is spent once; the Owner is told',
        async () => {
          const product = await k.preOrderProduct('cancel', 100_000);
          const sale = await k.paidPreOrder(product.variantId, 2);
          const version = sale.line.rowVersion;
          await fails(() => cancel(sale.line.id, version, {}, people.cashier), 'FORBIDDEN');
          await fails(() => cancel(sale.line.id, version, {}, worker), 'FORBIDDEN');
          // PAID may be cancelled before ordering, or when the supplier cannot deliver; changing the mind comes after the supplier order.
          await fails(
            () => cancel(sale.line.id, version, { cause: 'CUSTOMER_CHANGED_MIND' }),
            'ORDER_CANCEL_CAUSE_INVALID',
            'cause',
          );
          await fails(
            () => cancel(sale.line.id, version, { cause: 'LATE_OVER_7_DAYS' }),
            'ORDER_CANCEL_CAUSE_INVALID',
            'cause',
          );
          await fails(
            () =>
              cancel(sale.line.id, version, {
                cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING',
                method: 'BANK_TRANSFER_MANUAL',
              }),
            'VALIDATION_FAILED',
            'bankReference',
          );
          await fails(
            () =>
              cancel(sale.line.id, version + 4, { cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING' }),
            'CONFLICT',
          );
          // A stale password confirmation: refused, nothing written.
          const stale = await base.staff(['REFUND_PRODUCTS'], { branchId: k.A.id });
          await ageSession(stale.id);
          await fails(
            () =>
              orders.cancelLine(
                stale.token,
                sale.line.id,
                cancelBody(version, { cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING' }),
              ),
            'REAUTHENTICATION_REQUIRED',
          );
          assert.equal((await k.lineRow(sale.line.id)).status, 'PAID');
          const clientRequestId = randomUUID();
          const done = await k.ok(() =>
            cancel(sale.line.id, version, {
              cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING',
              clientRequestId,
            }),
          );
          assert.equal(done.lines[0]!.status, 'CANCELLED');
          assert.equal(done.lines[0]!.cancelCause, 'CUSTOMER_CANCELLED_BEFORE_ORDERING');
          assert.equal(done.lines[0]!.refunded, true);
          const refund = await tx.productRefund.findFirstOrThrow({
            where: { orderLineId: sale.line.id },
          });
          assert.equal(refund.amountVnd, 200_000n, 'two units at 100 000: the whole net share');
          assert.equal(refund.restock, 'NOT_SELLABLE');
          assert.equal(refund.quantity, 2);
          assert.equal(refund.method, 'CASH');
          const spent = await tx.refundReauthenticationUse.count({
            where: { productRefundId: refund.id },
          });
          assert.equal(spent, 1, 'the confirmation is spent');
          // The repeat of the same request reads back the result, with no new refund.
          const again = await orders.cancelLine(
            refunder.token,
            sale.line.id,
            cancelBody(version, { cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING', clientRequestId }),
          );
          assert.equal(again.lines[0]!.status, 'CANCELLED');
          assert.equal(await tx.productRefund.count({ where: { orderLineId: sale.line.id } }), 1);
          // A cancelled line cannot be cancelled again with a new request.
          await fails(
            () =>
              cancel(sale.line.id, done.lines[0]!.rowVersion, {
                cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING',
              }),
            'ORDER_CANCEL_CAUSE_INVALID',
            'cause',
          );
          const owners = await tx.notification.count({
            where: {
              type: 'PRODUCT_REFUND_MADE',
              entityType: 'ProductOrder',
              entityId: sale.order.id,
            },
          });
          assert.ok(owners >= 1, 'the Owner is told in the app');
          const audit = await tx.auditEvent.findFirst({
            where: { action: 'PRODUCT_ORDER_LINE_CANCELLED', entityId: sale.order.id },
          });
          assert.ok(audit);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'cancel after arrival frees the goods held for the line, and a cancelled line is not given stock again',
        async () => {
          const product = await k.preOrderProduct('cancel-arrived', 100_000);
          const first = await k.paidPreOrder(product.variantId, 2);
          const second = await k.paidPreOrder(product.variantId, 2);
          await k.receive(product.variantId, 2);
          assert.equal((await k.lineRow(first.line.id)).status, 'ARRIVED');
          assert.equal((await k.lineRow(second.line.id)).status, 'PAID');
          const level = await k.levelOf(product.variantId);
          assert.equal(level?.reserved, 2);
          const arrived = await k.lineRow(first.line.id);
          const cancelled = await k.ok(() => cancel(first.line.id, arrived.rowVersion));
          assert.equal(cancelled.lines[0]!.status, 'CANCELLED');
          assert.equal((await k.reservationOf(first.line.invoiceLineId))?.status, 'RELEASED');
          assert.equal(
            (await k.levelOf(product.variantId))?.reserved,
            2,
            'the two units are now held for the next waiting line',
          );
          // The released goods go to the next waiting line in the same transaction.
          assert.equal((await k.lineRow(second.line.id)).status, 'ARRIVED');
          assert.equal((await k.lineRow(first.line.id)).status, 'CANCELLED');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'cancel for lateness only after 7 days past the expected date; late lines are marked late',
        async () => {
          const product = await k.preOrderProduct('late', 100_000);
          const sale = await k.paidPreOrder(product.variantId, 1);
          const version = sale.line.rowVersion;
          const yesterday = await dateAfter(-1);
          await setExpected(sale.line.id, yesterday);
          const detail = await orders.get(worker.token, sale.order.id);
          assert.equal(detail.lines[0]!.late, true, 'past the expected date');
          // Exactly 7 days late is not yet "over 7 days".
          await setExpected(sale.line.id, await dateAfter(-7));
          await fails(
            async () =>
              cancel(sale.line.id, (await k.lineRow(sale.line.id)).rowVersion, {
                cause: 'LATE_OVER_7_DAYS',
              }),
            'ORDER_CANCEL_CAUSE_INVALID',
            'cause',
          );
          const eight = await dateAfter(-8);
          await setExpected(sale.line.id, eight);
          const row = await k.lineRow(sale.line.id);
          assert.ok(row.rowVersion >= version);
          const done = await k.ok(() =>
            cancel(sale.line.id, row.rowVersion, { cause: 'LATE_OVER_7_DAYS' }),
          );
          assert.equal(done.lines[0]!.cancelCause, 'LATE_OVER_7_DAYS');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the queue tabs follow the lines: ordered, arrived, done and cancelled; the contact is masked for those who only refund',
        async () => {
          const product = await k.preOrderProduct('tabs', 100_000);
          const sale = await k.paidPreOrder(product.variantId, 1);
          await k.ok(() => mark([{ id: sale.line.id, rowVersion: sale.line.rowVersion }]));
          const tabOf = async (tab: string) =>
            (await orders.list(worker.token, { branchId: k.A.id, tab })).rows.map(
              (row) => row.lineId,
            );
          assert.ok((await tabOf('ORDERED')).includes(sale.line.id));
          await k.receive(product.variantId, 1);
          assert.ok((await tabOf('ARRIVED')).includes(sale.line.id));
          const row = await k.lineRow(sale.line.id);
          await k.ok(() =>
            orders.handOver(worker.token, sale.line.id, {
              expectedVersion: row.rowVersion,
              to: 'CUSTOMER',
              representativeName: null,
              ...proof(sale.order),
              note: null,
            }),
          );
          await k.runInventory(sale.invoice.id);
          assert.ok((await tabOf('DONE')).includes(sale.line.id));
          const refundOnly = await base.staff(['REFUND_PRODUCTS'], { branchId: k.A.id });
          const view = await orders.get(refundOnly.token, sale.order.id);
          assert.equal(view.contactMasked, false, 'those who refund may call the customer');
          const other = await base.staff(['VIEW_INVOICES'], { branchId: k.A.id });
          await fails(() => orders.get(other.token, sale.order.id), 'FORBIDDEN');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a manual transfer refund: the reference is required, kept, and corrected only by a new linked record, by those who refund',
        async () => {
          const product = await k.preOrderProduct('transfer', 100_000);
          const sale = await k.paidPreOrder(product.variantId, 1);
          const version = sale.line.rowVersion;
          const cause = 'CUSTOMER_CANCELLED_BEFORE_ORDERING';
          await fails(
            () => cancel(sale.line.id, version, { cause, method: 'BANK_TRANSFER_MANUAL' }),
            'VALIDATION_FAILED',
            'bankReference',
          );
          await fails(
            () => cancel(sale.line.id, version, { cause, method: 'CASH', bankReference: 'FT0001' }),
            'VALIDATION_FAILED',
            'bankReference',
          );
          const done = await k.ok(() =>
            cancel(sale.line.id, version, {
              cause,
              method: 'BANK_TRANSFER_MANUAL',
              bankReference: 'FT0001',
            }),
          );
          assert.equal(done.lines[0]!.refund?.bankReference, 'FT0001');
          assert.equal(done.lines[0]!.refund?.amountVnd, '100000');
          assert.equal(done.lines[0]!.actions.correctReference, true);
          const body = { bankReference: 'FT0002', reason: 'Gõ nhầm mã giao dịch' };
          await fails(() => orders.correctReference(worker.token, sale.line.id, body), 'FORBIDDEN');
          await fails(
            () =>
              orders.correctReference(refunder.token, sale.line.id, { ...body, bankReference: '' }),
            'VALIDATION_FAILED',
            'bankReference',
          );
          const fixed = await k.ok(() =>
            orders.correctReference(refunder.token, sale.line.id, body),
          );
          assert.equal(fixed.lines[0]!.refund?.bankReference, 'FT0002');
          assert.equal(fixed.lines[0]!.refund?.corrections, 1);
          const refund = await tx.productRefund.findFirstOrThrow({
            where: { orderLineId: sale.line.id },
          });
          assert.equal(refund.bankReference, 'FT0001', 'the refund itself is never rewritten');
          // The money and the reference are not shown to those who only work the queue.
          const seen = await orders.get(worker.token, sale.order.id);
          assert.equal(seen.lines[0]!.refund, null);
          // A cash refund has no reference to correct.
          const cash = await k.paidPreOrder(product.variantId, 1);
          await k.ok(() => cancel(cash.line.id, cash.line.rowVersion, { cause }));
          await fails(
            () => orders.correctReference(refunder.token, cash.line.id, body),
            'VALIDATION_FAILED',
            'bankReference',
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a pre-order line can be returned only once its goods were handed over and sold; the window runs from the hand-over',
        async () => {
          const returns = new ProductReturnService(
            base.adapter,
            base.throttle,
            new LocalDiskMediaStorage(await mkdtemp(path.join(tmpdir(), 'lucy-p617-'))),
            pino({ level: 'silent' }),
          );
          const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: k.A.id });
          const product = await k.preOrderProduct('return', 100_000);
          const sale = await k.paidPreOrder(product.variantId, 1);
          const open = () =>
            returns.open(clerk.token, {
              branchId: k.A.id,
              invoiceLineId: sale.line.invoiceLineId,
              reason: 'PERSONAL_PREFERENCE',
              requestedOutcome: 'REFUND',
              quantity: 1,
              sealIntact: true,
              notes: null,
              clientRequestId: randomUUID(),
            });
          const lookup = () => returns.lookup(clerk.token, k.A.id, sale.invoice.code);
          // Paid but the goods have not arrived: there is nothing to return (the customer cancels the order instead).
          await fails(open, 'RETURN_NOT_ELIGIBLE');
          assert.equal((await lookup()).lines.length, 0);
          await k.receive(product.variantId, 1);
          await fails(open, 'RETURN_NOT_ELIGIBLE');
          const row = await k.lineRow(sale.line.id);
          await k.ok(() =>
            orders.handOver(worker.token, sale.line.id, {
              expectedVersion: row.rowVersion,
              to: 'CUSTOMER',
              representativeName: null,
              ...proof(sale.order),
              note: null,
            }),
          );
          // Handed over but the stock sale has not been written: still not returnable.
          await fails(open, 'RETURN_NOT_ELIGIBLE');
          await k.runInventory(sale.invoice.id);
          const done = await k.lineRow(sale.line.id);
          assert.equal(done.status, 'COMPLETED');
          const opened = await k.ok(open);
          assert.equal(
            opened.handoverAt,
            done.handedOverAt?.toISOString(),
            'the window starts when the goods were handed over, not when the invoice was paid',
          );
          assert.equal((await lookup()).lines.length, 1);
          await k.reconcileAll();
        },
      );
    });
  },
);
