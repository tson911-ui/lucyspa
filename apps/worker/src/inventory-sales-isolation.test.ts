import assert from 'node:assert/strict';
import test from 'node:test';
import { processInventoryEvent } from '@lucy-spa/server';

/**
 * Phase 6 P6-10: the `inventory` consumer handles invoice events only. Every other event (the stock alerts, the receipt event, a
 * booking, a leave request) is left alone: no consumption row, no stock row touched. A pure stub transaction: no database.
 */
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_EVENTS = [
  ['StockReceipt', 'STOCK_RECEIPT_CONFIRMED'],
  ['StockAlert', 'LOW_STOCK_REACHED'],
  ['StockAlert', 'EXPIRY_ALERT'],
  ['StockAlert', 'EXPIRED_LOT_SOLD'],
  ['Booking', 'BOOKING_CONFIRMED'],
  ['Invoice', 'INVOICE_FINALIZED'],
  ['Invoice', 'PRICING_V3_MISMATCH'],
] as const;

test('the inventory consumer ignores every event that is not a paid, reopened or cancelled invoice', async () => {
  for (const [aggregateType, eventType] of OTHER_EVENTS) {
    let consumptions = 0;
    let queries = 0;
    const row = {
      id: EVENT_ID,
      schemaVersion: 1,
      aggregateType,
      eventType,
      aggregateId: '33333333-3333-4333-8333-333333333333',
      branchId: '44444444-4444-4444-8444-444444444444',
      payload: { invoiceId: '33333333-3333-4333-8333-333333333333' },
      occurredAt: new Date(),
      publishedAt: null,
    };
    const tx = {
      $executeRaw: () => Promise.resolve(0),
      $queryRaw: () => {
        queries += 1;
        return Promise.resolve([{ id: row.id }]);
      },
      outboxEvent: { findUniqueOrThrow: () => Promise.resolve(row) },
      outboxConsumption: {
        create: () => {
          consumptions += 1;
          return Promise.resolve({});
        },
      },
    };
    const outcome = await processInventoryEvent(tx as never, EVENT_ID);
    assert.equal(outcome, 'IGNORED', `${aggregateType}/${eventType}`);
    assert.equal(consumptions, 0, 'it does not even record a consumption');
    assert.equal(
      queries,
      2,
      'only the graph lock and the claim of the event ran: no invoice, no stock row was read',
    );
  }
});

test('a claimed event that another worker already consumed is left alone', async () => {
  const tx = {
    $executeRaw: () => Promise.resolve(0),
    $queryRaw: () => Promise.resolve([]),
  };
  assert.equal(await processInventoryEvent(tx as never, EVENT_ID), 'NOT_CLAIMED');
});
