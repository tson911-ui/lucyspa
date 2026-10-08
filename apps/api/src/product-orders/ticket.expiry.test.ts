import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRODUCT_ORDER_TICKET_DAYS_AFTER_CLOSE,
  productOrderTicketExpiresAt,
  type ProductOrderLineStatusName,
} from '@lucy-spa/contracts';
import { ticketExpiry } from './order.core.js';

/**
 * The ticket link of a customer without an account expires 30 days after the order was closed (the Owner, 2026-10-09): after the
 * last of its lines was handed over or cancelled. While any line is open it never expires.
 */
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-10-01T03:00:00.000Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const handed = (days: number, status: ProductOrderLineStatusName = 'HANDED_OVER') => ({
  status,
  handedOverAt: at(days),
  cancelledAt: null,
});
const cancelled = (days: number) => ({
  status: 'CANCELLED' as const,
  handedOverAt: null,
  cancelledAt: at(days),
});
const open = (status: ProductOrderLineStatusName) => ({
  status,
  handedOverAt: null,
  cancelledAt: null,
});

test('the validity is 30 days', () => {
  assert.equal(PRODUCT_ORDER_TICKET_DAYS_AFTER_CLOSE, 30);
});

test('an order with any open line has no expiry, whatever else was finished long ago', () => {
  for (const status of ['AWAITING_PAYMENT', 'PAID', 'ORDERED', 'ARRIVED'] as const) {
    assert.equal(productOrderTicketExpiresAt([open(status)]), null, status);
    assert.equal(productOrderTicketExpiresAt([handed(-400), open(status)]), null, status);
    assert.equal(productOrderTicketExpiresAt([cancelled(-400), open(status)]), null, status);
  }
  assert.equal(productOrderTicketExpiresAt([]), null, 'no line, nothing to close');
});

test('a closed order expires 30 days after the LAST hand-over or cancellation', () => {
  assert.equal(productOrderTicketExpiresAt([handed(0)])?.toISOString(), at(30).toISOString());
  assert.equal(
    productOrderTicketExpiresAt([handed(0), handed(5)])?.toISOString(),
    at(35).toISOString(),
  );
  assert.equal(
    productOrderTicketExpiresAt([handed(9), cancelled(2)])?.toISOString(),
    at(39).toISOString(),
  );
  assert.equal(
    productOrderTicketExpiresAt([cancelled(3), cancelled(7)])?.toISOString(),
    at(37).toISOString(),
    'also an order whose every line was cancelled',
  );
});

test('a completed line counts at its hand-over time, not at the time the stock sale was written', () => {
  assert.equal(
    productOrderTicketExpiresAt([
      { status: 'COMPLETED', handedOverAt: at(1), cancelledAt: null },
    ])?.toISOString(),
    at(31).toISOString(),
  );
});

test('a finished line without its time keeps the order open rather than inventing a date', () => {
  assert.equal(
    productOrderTicketExpiresAt([{ status: 'HANDED_OVER', handedOverAt: null, cancelledAt: null }]),
    null,
  );
  assert.equal(
    productOrderTicketExpiresAt([{ status: 'CANCELLED', handedOverAt: null, cancelledAt: null }]),
    null,
  );
});

test('times may come as ISO strings (the web reads the same rule)', () => {
  assert.equal(
    productOrderTicketExpiresAt([
      { status: 'HANDED_OVER', handedOverAt: at(0).toISOString(), cancelledAt: null },
    ])?.toISOString(),
    at(30).toISOString(),
  );
});

test('the link is active until the exact instant of expiry; an unmade or revoked link is never active', () => {
  const lines = [handed(0)];
  const made = { tickets: [{ id: 'x' }], lines } as never;
  const revoked = { tickets: [], lines } as never;
  assert.equal(ticketExpiry(made, at(29.999)).linkActive, true);
  assert.equal(ticketExpiry(made, at(30)).linkActive, false, 'expired exactly 30 x 24 h later');
  assert.equal(ticketExpiry(made, at(30)).expired, true);
  assert.equal(ticketExpiry(made, at(31)).expiresAt, at(30).toISOString());
  assert.equal(ticketExpiry(revoked, at(1)).linkActive, false);
  const live = { tickets: [{ id: 'x' }], lines: [open('ARRIVED')] } as never;
  assert.deepEqual(ticketExpiry(live, at(900)), {
    linkActive: true,
    expiresAt: null,
    expired: false,
  });
});
