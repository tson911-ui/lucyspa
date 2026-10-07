import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseClient } from '@lucy-spa/database';
import { processFinancialNotificationEvent, processLeaveEvent } from '@lucy-spa/server';
import { relayBookingEvent } from './booking-jobs.js';

/**
 * Phase 6 P6-4: the stock events (the receipt event waiting for the later pre-order Wave, and the alert events the inventory loop
 * writes itself) belong to no existing relay. None of the Phase 3 booking relay, the Leave consumer or the financial notification
 * consumer may claim, mark or notify them. A pure stub transaction: no database.
 */
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const STOCK_EVENTS = [
  ['StockReceipt', 'STOCK_RECEIPT_CONFIRMED'],
  ['StockAlert', 'LOW_STOCK_REACHED'],
  ['StockAlert', 'EXPIRY_ALERT'],
] as const;

function stub(event: { aggregateType: string; eventType: string }) {
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
    $executeRaw: () => Promise.resolve(0),
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
    outboxConsumption: {
      create: () => {
        calls.consumptions += 1;
        return Promise.resolve({});
      },
    },
  };
  return { tx, calls };
}

test('the booking relay leaves every stock event alone', async () => {
  for (const [aggregateType, eventType] of STOCK_EVENTS) {
    const { tx, calls } = stub({ aggregateType, eventType });
    const database = { $transaction: (work: (t: unknown) => unknown) => work(tx) };
    const handled = await relayBookingEvent(database as unknown as DatabaseClient, EVENT_ID, () =>
      Promise.resolve(),
    );
    assert.equal(handled, false, `${eventType} is not a booking event`);
    assert.equal(calls.updated, 0, 'never marked consumed by the booking relay');
    assert.equal(calls.notifications, 0);
  }
});

test('the Leave consumer ignores every stock event', async () => {
  for (const [aggregateType, eventType] of STOCK_EVENTS) {
    const { tx, calls } = stub({ aggregateType, eventType });
    const outcome = await processLeaveEvent(tx as never, EVENT_ID);
    assert.equal(outcome, 'IGNORED', `${aggregateType}/${eventType}`);
    assert.equal(calls.updated, 0);
    assert.equal(calls.notifications, 0);
  }
});

test('the financial notification consumer ignores every stock event and writes nothing', async () => {
  for (const [aggregateType, eventType] of STOCK_EVENTS) {
    const { tx, calls } = stub({ aggregateType, eventType });
    const outcome = await processFinancialNotificationEvent(tx as never, EVENT_ID);
    assert.equal(outcome, 'IGNORED', `${aggregateType}/${eventType}`);
    assert.equal(calls.updated, 0);
    assert.equal(calls.notifications, 0);
    assert.equal(calls.consumptions, 0, 'it does not even record a consumption');
  }
});
