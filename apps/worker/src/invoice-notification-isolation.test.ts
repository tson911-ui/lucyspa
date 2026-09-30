import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseClient } from '@lucy-spa/database';
import {
  FINANCIAL_NOTIFICATION_AGGREGATES,
  FINANCIAL_NOTIFICATION_EVENT_TYPES,
  processFinancialNotificationEvent,
  processLeaveEvent,
} from '@lucy-spa/server';
import { relayBookingEvent } from './booking-jobs.js';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';

// A pure stub transaction: no database. It looks like an interactive transaction (no $connect) and
// throws if anything beyond claiming/reading the event is touched.
function stub(event: { aggregateType: string; eventType: string; branchId?: string | null }) {
  const calls = { updated: 0, notifications: 0, consumptions: 0 };
  const row = {
    id: EVENT_ID,
    schemaVersion: 1,
    aggregateId: '33333333-3333-4333-8333-333333333333',
    branchId: '44444444-4444-4444-8444-444444444444',
    payload: {},
    occurredAt: new Date(),
    publishedAt: null,
    ...event,
  };
  const tx = {
    $queryRaw: () => Promise.resolve([{ id: row.id }]),
    outboxEvent: {
      findUniqueOrThrow: () => Promise.resolve(row),
      update: () => {
        calls.updated += 1;
        return Promise.resolve(row);
      },
    },
    outboxConsumption: {
      create: () => {
        calls.consumptions += 1;
        return Promise.resolve({});
      },
    },
    notification: {
      createMany: () => {
        calls.notifications += 1;
        return Promise.resolve({ count: 0 });
      },
    },
  };
  return { tx, calls };
}

test('the financial consumer handles exactly the Q8 events of the Invoice, Payment and Branch aggregates', () => {
  assert.deepEqual([...FINANCIAL_NOTIFICATION_AGGREGATES].sort(), ['Branch', 'Invoice', 'Payment']);
  assert.deepEqual([...FINANCIAL_NOTIFICATION_EVENT_TYPES].sort(), [
    'INVOICE_CANCELLED',
    'INVOICE_PAID',
    'PAYMENT_ANOMALY_FLAGGED',
    'PAYMENT_REVERSED',
    'PAYMENT_SUCCEEDED',
    'REVENUE_SUMMARY_DUE',
  ]);
});

test('the financial consumer ignores Phase 3, Leave and unrelated financial events without a consumption row', async () => {
  for (const [aggregateType, eventType] of [
    ['Booking', 'BOOKING_CREATED'],
    ['Visit', 'CUSTOMER_ARRIVED'],
    ['LeaveRequest', 'LEAVE_REQUESTED'],
    ['Invoice', 'INVOICE_FINALIZED'],
    ['Invoice', 'INVOICE_REOPENED'],
    ['Payment', 'PAYMENT_EXPIRED'],
    ['Payment', 'PAYMENT_FAILED'],
    // A handled type on the wrong aggregate is not this consumer's either.
    ['Visit', 'INVOICE_PAID'],
  ] as const) {
    const { tx, calls } = stub({ aggregateType, eventType });
    const outcome = await processFinancialNotificationEvent(tx as never, EVENT_ID);
    assert.equal(outcome, 'IGNORED', `${aggregateType}/${eventType}`);
    assert.deepEqual(calls, { updated: 0, notifications: 0, consumptions: 0 });
  }
});

test('the Phase 3 relay and the Leave consumer never claim or mark a financial event', async () => {
  for (const [aggregateType, eventType] of [
    ['Invoice', 'INVOICE_PAID'],
    ['Invoice', 'INVOICE_CANCELLED'],
    ['Payment', 'PAYMENT_SUCCEEDED'],
    ['Payment', 'PAYMENT_REVERSED'],
    ['Payment', 'PAYMENT_ANOMALY_FLAGGED'],
    ['Branch', 'REVENUE_SUMMARY_DUE'],
  ] as const) {
    const booking = stub({ aggregateType, eventType });
    const database = { $transaction: (work: (t: unknown) => unknown) => work(booking.tx) };
    const handled = await relayBookingEvent(database as unknown as DatabaseClient, EVENT_ID, () =>
      Promise.resolve(),
    );
    assert.equal(handled, false, `${eventType} is left for its own consumer`);
    assert.equal(booking.calls.updated, 0, 'published_at is never set by the booking relay');
    assert.equal(booking.calls.notifications, 0);

    const leave = stub({ aggregateType, eventType });
    assert.equal(await processLeaveEvent(leave.tx as never, EVENT_ID), 'IGNORED');
    assert.equal(leave.calls.updated, 0);
    assert.equal(leave.calls.notifications, 0);
  }
});

test('a financial event without a branch is never delivered', async () => {
  const { tx, calls } = stub({
    aggregateType: 'Invoice',
    eventType: 'INVOICE_PAID',
    branchId: null,
  });
  assert.equal(await processFinancialNotificationEvent(tx as never, EVENT_ID), 'IGNORED');
  assert.deepEqual(calls, { updated: 0, notifications: 0, consumptions: 0 });
});
