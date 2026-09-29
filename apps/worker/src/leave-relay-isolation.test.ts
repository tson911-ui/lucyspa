import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseClient } from '@lucy-spa/database';
import { processLeaveEvent } from '@lucy-spa/server';
import { relayBookingEvent } from './booking-jobs.js';

// A pure stub transaction: no database. It looks like an interactive transaction (no $connect).
function stub(event: { aggregateType: string; eventType: string }) {
  const calls = { updated: 0, notifications: 0 };
  const row = {
    id: '22222222-2222-4222-8222-222222222222',
    schemaVersion: 1,
    aggregateId: '33333333-3333-4333-8333-333333333333',
    branchId: null,
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
    notification: {
      createMany: () => {
        calls.notifications += 1;
        return Promise.resolve({ count: 0 });
      },
    },
  };
  return { tx, calls };
}

test('the Phase 3 relay never claims or marks a Leave event', async () => {
  for (const eventType of ['LEAVE_REQUESTED', 'LEAVE_DECIDED', 'EMPLOYEE_LEAVE_APPROVED']) {
    const { tx, calls } = stub({ aggregateType: 'LeaveRequest', eventType });
    const database = { $transaction: (work: (t: unknown) => unknown) => work(tx) };
    const handled = await relayBookingEvent(
      database as unknown as DatabaseClient,
      '22222222-2222-4222-8222-222222222222',
      () => Promise.resolve(),
    );
    assert.equal(handled, false, `${eventType} is left for its own consumer`);
    assert.equal(calls.updated, 0, 'never marked consumed by the booking relay');
    assert.equal(calls.notifications, 0);
  }
});

test('the Leave consumer ignores booking events and the Phase 3 conflict event', async () => {
  for (const [aggregateType, eventType] of [
    ['Booking', 'BOOKING_CREATED'],
    ['Visit', 'CUSTOMER_ARRIVED'],
    ['ServiceExecution', 'SERVICE_STARTED'],
    ['LeaveRequest', 'EMPLOYEE_LEAVE_APPROVED'],
  ] as const) {
    const { tx, calls } = stub({ aggregateType, eventType });
    const outcome = await processLeaveEvent(tx as never, '22222222-2222-4222-8222-222222222222');
    assert.equal(outcome, 'IGNORED', `${aggregateType}/${eventType}`);
    assert.equal(calls.updated, 0);
    assert.equal(calls.notifications, 0);
  }
});
