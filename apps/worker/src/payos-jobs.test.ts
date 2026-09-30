import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseClient } from '@lucy-spa/database';
import { createLogger, createPayosSimulator } from '@lucy-spa/server';
import { reconcilePayos, startPayosReconciliation } from './payos-jobs.js';

const logger = createLogger('worker', 'silent');

test('PayOS reconciliation is inert without configuration and never touches the database', async () => {
  let touched = false;
  const database = new Proxy(
    {},
    {
      get() {
        touched = true;
        throw new Error('the database must not be used');
      },
    },
  ) as unknown as DatabaseClient;
  const job = startPayosReconciliation(database, null, logger);
  await job.stop();
  assert.equal(touched, false);
});

test('the sweep reads pending PayOS payments from the database and calls nothing when there are none', async () => {
  const simulator = createPayosSimulator();
  const queries: unknown[] = [];
  const database = {
    payment: {
      findMany: (args: unknown) => {
        queries.push(args);
        return Promise.resolve([]);
      },
    },
    $transaction: () => Promise.reject(new Error('no transaction is needed')),
  } as unknown as DatabaseClient;
  const summary = await reconcilePayos(database, simulator.provider);
  assert.deepEqual(summary, { examined: 0, applied: 0, ended: 0, anomalies: 0, unavailable: 0 });
  assert.deepEqual(simulator.calls, []);
  // PostgreSQL is the source of truth: only pending PayOS rows are candidates.
  const where = (queries[0] as { where: { status: string; method: string } }).where;
  assert.equal(where.status, 'PENDING');
  assert.equal(where.method, 'PAYOS');
});

test('one failing payment never stops the sweep and never changes anything else', async () => {
  const simulator = createPayosSimulator();
  simulator.fail('read', 'UNREACHABLE', 2);
  const database = {
    payment: {
      findMany: () =>
        Promise.resolve([
          { id: 'p1', providerOrderCode: 111n, checkoutUrl: 'https://pay.payos.vn/web/a' },
          { id: 'p2', providerOrderCode: 222n, checkoutUrl: 'https://pay.payos.vn/web/b' },
        ]),
    },
    // The unreachable provider is recorded as an attempt inside the transaction; a database failure here
    // must be contained per payment.
    $transaction: () => Promise.reject(new Error('database is down')),
  } as unknown as DatabaseClient;
  const summary = await reconcilePayos(database, simulator.provider);
  assert.equal(summary.examined, 2);
  assert.equal(summary.applied, 0);
  assert.equal(summary.unavailable, 2);
});
