import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productOrderKit } from '../testing/product-order-kit.js';
import { customerInvoiceDetail } from '../pos/customer-invoice.core.js';

/**
 * Phase 6 P6-15/P6-16 against real PostgreSQL (design 18; T28-T32, OQ-29, OQ-34, OQ-35, OQ-P6-42): a counter pre-order. The cashier
 * chooses the mode of a line; finalization writes the order with the customer's phone number and reserves only the in-stock lines;
 * payment fixes the expected range; an unpaid invoice that is cancelled cancels its lines; the digital ticket is a secret link whose
 * token is shown once and only its hash is stored. After every step the deferred database checks run and each test ends with the
 * reconciliation of the stock and of the orders. Every fixture rolls back.
 */
test(
  'Phase 6 P6-16 counter pre-order: line mode, order at finalization, payment, cancellation and the ticket link; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productOrderKit(base);
      const { tx, fails } = base;
      const { invoices, people } = k;
      const localDate = async (offsetDays: number, from: string) =>
        (
          await tx.$queryRawUnsafe<{ d: string }[]>(
            `SELECT to_char((${from} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + ${offsetDays}, 'YYYY-MM-DD') AS d`,
          )
        )[0]!.d;

      await suite.test(
        'the cashier chooses pre-order: only for a variant sold on order, never merged with an in-stock line',
        async () => {
          const shelf = await k.preOrderProduct('shelf', 100_000, { sellOnOrder: false });
          const ordered = await k.preOrderProduct('ordered', 150_000);
          await k.receive(ordered.variantId, 5);
          const draft = await k.openSale();
          await fails(
            () => k.addPreOrderLine(draft, shelf.variantId, 1),
            'PRODUCT_PRE_ORDER_NOT_ALLOWED',
            'variantId',
          );
          // Nobody who may not sell can add a line, in any mode.
          await fails(
            () => k.addPreOrderLine(draft, ordered.variantId, 1, people.nobody),
            'FORBIDDEN',
          );
          const inStock = await k.addLine(draft, ordered.variantId, 1);
          const both = await k.addPreOrderLine(inStock, ordered.variantId, 2);
          assert.deepEqual(
            both.productLines.map((line) => [line.fulfilmentMode, line.quantity]),
            [
              ['IN_STOCK', 1],
              ['PRE_ORDER', 2],
            ],
            'one line for each mode',
          );
          const more = await k.addPreOrderLine(both, ordered.variantId, 1);
          assert.deepEqual(
            more.productLines.map((line) => [line.fulfilmentMode, line.quantity]),
            [
              ['IN_STOCK', 1],
              ['PRE_ORDER', 3],
            ],
            'a pre-order line grows only with pre-order',
          );
          assert.equal(more.productOrder, null, 'a draft has no order');
          await k.settle();
          await k.reconcileAll();
        },
      );

      await suite.test(
        'finalization writes the order with the phone number, reserves only the in-stock lines and is refused without a contact',
        async () => {
          const shelf = await k.preOrderProduct('mix-shelf', 100_000);
          const waiting = await k.preOrderProduct('mix-wait', 250_000);
          await k.receive(shelf.variantId, 5);
          const draft = await k.addPreOrderLine(
            await k.addLine(await k.openSale(), shelf.variantId, 1),
            waiting.variantId,
            2,
          );
          await fails(() => k.finalizeWith(draft, null), 'PRE_ORDER_CONTACT_REQUIRED');
          await fails(
            () => k.finalizeWith(draft, 'abc'),
            'VALIDATION_FAILED',
            'preOrderContact.phone',
          );
          await fails(
            () => k.finalizeWith(draft, '0123'),
            'VALIDATION_FAILED',
            'preOrderContact.phone',
          );
          assert.equal(
            (await invoices.get(people.cashier.token, draft.id)).status,
            'DRAFT',
            'a refused finalization writes nothing',
          );
          assert.equal(await tx.productOrder.count({ where: { invoiceId: draft.id } }), 0);
          const done = await k.finalizeWith(draft, '0901 234 567', ' Chị  Lan ');
          assert.equal(done.status, 'PENDING_PAYMENT');
          const order = done.productOrder!;
          assert.match(order.code, /^DT[0-9]{6}$/);
          assert.equal(order.contactPhone, '+84901234567');
          assert.equal(order.contactName, 'Chị Lan');
          assert.equal(order.status, 'AWAITING_PAYMENT');
          assert.equal(order.lines.length, 1);
          assert.equal(order.lines[0]!.quantity, 2);
          assert.equal(order.lines[0]!.expectedFrom, null, 'no range before payment');
          const byMode = new Map(done.productLines.map((line) => [line.fulfilmentMode, line]));
          assert.deepEqual(byMode.get('IN_STOCK')!.reservation, {
            status: 'RESERVED',
            quantity: 1,
          });
          assert.equal(
            byMode.get('PRE_ORDER')!.reservation,
            null,
            'a pre-order line holds nothing',
          );
          assert.deepEqual(await k.levelOf(shelf.variantId), { onHand: 5, reserved: 1 });
          assert.equal(await k.levelOf(waiting.variantId), null);
          // The audit record names the order and its lines, never the phone number.
          const audit = await tx.auditEvent.findFirstOrThrow({
            where: { action: 'PRODUCT_ORDER_CREATED', entityId: order.id },
          });
          assert.ok(!JSON.stringify(audit).includes('901234567'), 'no phone number in the audit');
          // The same finalization again changes nothing.
          const again = await k.ok(() =>
            invoices.finalize(people.cashier.token, draft.id, {
              expectedVersion: draft.version,
              preOrderContact: { phone: '0901 234 567' },
            }),
          );
          assert.equal(again.productOrder!.id, order.id);
          assert.equal(await tx.productOrder.count({ where: { invoiceId: draft.id } }), 1);
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a contact is refused when nothing is pre-ordered, and a pre-order is refused when the stock already covers it',
        async () => {
          const stocked = await k.preOrderProduct('covered', 90_000);
          await k.receive(stocked.variantId, 3);
          const plain = await k.addLine(await k.openSale(), stocked.variantId, 1);
          await fails(
            () => k.finalizeWith(plain, '0901234567'),
            'VALIDATION_FAILED',
            'preOrderContact',
          );
          const covered = await k.addPreOrderLine(await k.openSale(), stocked.variantId, 3);
          const lineId = covered.productLines[0]!.id;
          await fails(() => k.finalizeWith(covered), 'PRODUCT_PRE_ORDER_NOT_NEEDED', lineId);
          // More than the stock holds: that is a pre-order (the line is not split, OQ-84).
          const over = await k.addPreOrderLine(await k.openSale(), stocked.variantId, 4);
          const done = await k.finalizeWith(over);
          assert.equal(done.productOrder!.lines[0]!.quantity, 4);
          assert.deepEqual(await k.levelOf(stocked.variantId), { onHand: 3, reserved: 0 });
          // An in-stock sale of a variant that is out of stock is still refused (never silently a pre-order).
          const empty = await k.preOrderProduct('empty', 80_000);
          const noStock = await k.addLine(await k.openSale(), empty.variantId, 1);
          await fails(() => k.finalize(noStock), 'PRODUCT_OUT_OF_STOCK');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'payment fixes the paid time and the expected range; the stock events leave the waiting line alone',
        async () => {
          const shelf = await k.preOrderProduct('pay-shelf', 60_000);
          const waiting = await k.preOrderProduct('pay-wait', 300_000);
          const custom = await k.preOrderProduct('pay-custom', 40_000, { leadMin: 7, leadMax: 10 });
          await k.receive(shelf.variantId, 2);
          const draft = await k.addPreOrderLine(
            await k.addPreOrderLine(
              await k.addLine(await k.openSale(), shelf.variantId, 1),
              waiting.variantId,
              1,
            ),
            custom.variantId,
            1,
          );
          const sale = await k.finalizeWith(draft);
          const result = await k.pay(sale.id, Number(sale.totalVnd));
          assert.equal(result.invoice.status, 'PAID');
          const order = (await invoices.get(people.cashier.token, sale.id)).productOrder!;
          assert.equal(order.status, 'PAID');
          const base = await localDate(0, `(SELECT paid_at FROM invoices WHERE id = '${sale.id}')`);
          const lines = new Map(order.lines.map((line) => [line.variantId, line]));
          const wait = lines.get(waiting.variantId)!;
          assert.equal(wait.status, 'PAID');
          assert.ok(wait.paidAt);
          assert.equal(
            wait.expectedFrom,
            await localDate(3, `(SELECT paid_at FROM invoices WHERE id = '${sale.id}')`),
          );
          assert.equal(
            wait.expectedTo,
            await localDate(5, `(SELECT paid_at FROM invoices WHERE id = '${sale.id}')`),
          );
          const own = lines.get(custom.variantId)!;
          assert.equal(
            own.expectedFrom,
            await localDate(7, `(SELECT paid_at FROM invoices WHERE id = '${sale.id}')`),
          );
          assert.equal(
            own.expectedTo,
            await localDate(10, `(SELECT paid_at FROM invoices WHERE id = '${sale.id}')`),
          );
          assert.ok(base);
          // The inventory consumer sells the in-stock line and leaves the pre-order lines exactly as they are.
          assert.deepEqual(await k.relayInventory(), ['APPLIED']);
          const after = await invoices.get(people.cashier.token, sale.id);
          const modes = new Map(after.productLines.map((line) => [line.fulfilmentMode, line]));
          assert.equal(modes.get('IN_STOCK')!.reservation!.status, 'CONSUMED');
          assert.equal(after.productOrder!.status, 'PAID');
          assert.deepEqual(await k.levelOf(shelf.variantId), { onHand: 1, reserved: 0 });
          assert.equal(await k.levelOf(waiting.variantId), null);
          await k.reconcileAll();
        },
      );

      await suite.test('an unpaid invoice that is cancelled cancels its order lines', async () => {
        const waiting = await k.preOrderProduct('cancel-wait', 120_000);
        const sale = await k.preOrder(waiting.variantId, 2);
        const cancelled = await k.ok(() =>
          invoices.cancel(people.boss.token, sale.invoice.id, {
            expectedVersion: sale.invoice.version,
            reason: 'Khách đổi ý',
          }),
        );
        assert.equal(cancelled.status, 'CANCELLED');
        const order = cancelled.productOrder!;
        assert.equal(order.status, 'CANCELLED');
        assert.equal(order.lines[0]!.cancelCause, 'INVOICE_CANCELLED');
        assert.ok(order.lines[0]!.cancelledAt);
        await k.reconcileAll();
      });

      await suite.test(
        'the ticket link: shown once, stored as a hash, replaced by the next one, read without a session, revealing nothing else',
        async () => {
          const waiting = await k.preOrderProduct('ticket', 110_000);
          const sale = await k.paidPreOrder(waiting.variantId, 2);
          const orderId = sale.order.id;
          // Who may make the link: sellers and queue workers at the branch, nobody else.
          await fails(() => k.orders.createTicketLink(people.nobody.token, orderId), 'FORBIDDEN');
          await fails(
            () => k.orders.createTicketLink(people.otherBranch.token, orderId),
            'FORBIDDEN',
          );
          await fails(
            () => k.orders.createTicketLink(people.cashier.token, 'not-a-uuid'),
            'NOT_FOUND',
          );
          const first = await k.ok(() => k.orders.createTicketLink(people.cashier.token, orderId));
          assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
          const stored = await tx.productOrderTicket.findMany({ where: { orderId } });
          assert.equal(stored.length, 1);
          assert.notEqual(stored[0]!.tokenHash, first.token);
          assert.match(stored[0]!.tokenHash, /^[0-9a-f]{64}$/);
          assert.ok(
            !JSON.stringify(stored).includes(first.token),
            'the token itself is never stored',
          );
          const ticket = await k.publicTickets.ticket(first.token);
          assert.equal(ticket.code, sale.order.code);
          assert.equal(ticket.status, 'PAID');
          assert.equal(ticket.branchName, 'Chi nhánh A');
          assert.equal(ticket.totalVnd, sale.invoice.totalVnd);
          assert.equal(ticket.lines.length, 1);
          assert.equal(ticket.lines[0]!.quantity, 2);
          assert.ok(ticket.lines[0]!.expectedFrom && ticket.lines[0]!.expectedTo);
          const text = JSON.stringify(ticket);
          assert.ok(
            !text.includes('901234567') && !text.includes('+84'),
            'no phone number on the ticket',
          );
          assert.ok(
            !/sellerUserId|seller|contact|customer|invoiceId/i.test(Object.keys(ticket).join(' ')),
          );
          // The audit trail records that a link was made, never the token.
          const audits = await tx.auditEvent.findMany({
            where: { action: 'PRODUCT_ORDER_TICKET_LINK_CREATED', entityId: orderId },
          });
          assert.equal(audits.length, 1);
          assert.ok(!JSON.stringify(audits).includes(first.token));
          // A new link revokes the old one.
          const second = await k.ok(() => k.orders.createTicketLink(people.queue.token, orderId));
          assert.notEqual(second.token, first.token);
          await fails(() => k.publicTickets.ticket(first.token), 'NOT_FOUND');
          assert.equal((await k.publicTickets.ticket(second.token)).code, sale.order.code);
          assert.equal(
            await tx.productOrderTicket.count({ where: { orderId, revokedAt: null } }),
            1,
          );
          assert.equal((await k.orderOf(sale.invoice.id)).ticketLinkActive, true);
          // Revoking leaves no link; a wrong, short or empty token is the same NOT_FOUND.
          const revoked = await k.ok(() =>
            k.orders.revokeTicketLink(people.cashier.token, orderId),
          );
          assert.equal(revoked.ticketLinkActive, false);
          await fails(() => k.publicTickets.ticket(second.token), 'NOT_FOUND');
          await fails(() => k.publicTickets.ticket('x'.repeat(43)), 'NOT_FOUND');
          await fails(() => k.publicTickets.ticket('short'), 'NOT_FOUND');
          await fails(() => k.publicTickets.ticket(''), 'NOT_FOUND');
          // A link row is history: it can be revoked but never rewritten or deleted.
          await tx.$executeRawUnsafe('SAVEPOINT ticket_delete');
          await assert.rejects(() =>
            tx.$executeRawUnsafe(
              `DELETE FROM product_order_tickets WHERE order_id = '${orderId}'::uuid`,
            ),
          );
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT ticket_delete');
          await k.reconcileAll();
        },
      );

      await suite.test(
        'a member sees the ticket inside the invoice: the code, the status and the expected range, never the phone number or the staff',
        async () => {
          const member = await k.customer('member');
          const waiting = await k.preOrderProduct('member-wait', 130_000);
          const sale = await k.paidPreOrder(waiting.variantId, 1, { payer: member.id });
          const view = await customerInvoiceDetail(tx, member.id, sale.invoice.id);
          assert.equal(view.productOrder?.code, sale.order.code);
          assert.equal(view.productOrder?.status, 'PAID');
          assert.equal(view.productOrder?.lines.length, 1);
          assert.ok(view.productOrder?.lines[0]?.expectedFrom);
          const text = JSON.stringify(view);
          assert.ok(
            !text.includes('901234567') && !text.includes('contact'),
            'no contact on the member view',
          );
          assert.deepEqual(view.productSequences, [1]);
          // An invoice without a pre-order has no such block.
          const plain = await k.preOrderProduct('member-plain', 70_000);
          await k.receive(plain.variantId, 2);
          const bought = await k.finalize(
            await k.addLine(await k.openSale(people.cashier, member.id), plain.variantId, 1),
          );
          const plainView = await customerInvoiceDetail(tx, member.id, bought.id);
          assert.equal('productOrder' in plainView, false);
          await k.reconcileAll();
        },
      );
    });
  },
);
