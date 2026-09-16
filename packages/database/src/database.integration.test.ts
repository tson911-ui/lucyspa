import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendOutboxEvent, createDatabaseClient } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) {
  loadEnvFile(environmentPath);
}

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for database integration tests.');
}
const database = createDatabaseClient(databaseUrl);
before(async () => {
  await database.$connect();
});
after(async () => {
  await database.$disconnect();
});

test("outbox writes require the caller's transaction", async () => {
  await assert.rejects(
    appendOutboxEvent(database, {
      aggregateType: 'FoundationTest',
      aggregateId: randomUUID(),
      eventType: 'foundation.test',
      schemaVersion: 1,
      payload: { fixture: true },
    }),
    /requires an active Prisma transaction/,
  );
});

test('independent branches and their outbox events roll back together', async () => {
  const branchIds = [randomUUID(), randomUUID()];
  const runId = randomUUID();
  const rollback = new Error('Intentional integration test rollback');

  await assert.rejects(
    database.$transaction(async (transaction) => {
      for (const id of branchIds) {
        const branch = await transaction.branch.create({
          data: { id, code: `integration-${id}`, name: 'Integration test branch' },
        });
        assert.equal(branch.timezone, 'Asia/Ho_Chi_Minh');
        const event = await appendOutboxEvent(transaction, {
          branchId: branch.id,
          aggregateType: 'FoundationTest',
          aggregateId: runId,
          eventType: 'foundation.test',
          schemaVersion: 1,
          payload: { fixture: true },
        });
        assert.equal(event.branchId, branch.id);
        assert.equal(event.publishedAt, null);
      }
      assert.equal(await transaction.branch.count({ where: { id: { in: branchIds } } }), 2);
      assert.equal(await transaction.outboxEvent.count({ where: { aggregateId: runId } }), 2);
      throw rollback;
    }),
    (error: unknown) => error === rollback,
  );

  assert.equal(await database.branch.count({ where: { id: { in: branchIds } } }), 0);
  assert.equal(await database.outboxEvent.count({ where: { aggregateId: runId } }), 0);
});

test('an invalid outbox branch reference rejects the transaction and its source write', async () => {
  const branchId = randomUUID();
  const runId = randomUUID();
  await assert.rejects(
    database.$transaction(async (transaction) => {
      await transaction.branch.create({
        data: { id: branchId, code: `integration-${branchId}`, name: 'Integration test branch' },
      });
      await appendOutboxEvent(transaction, {
        branchId: randomUUID(),
        aggregateType: 'FoundationTest',
        aggregateId: runId,
        eventType: 'foundation.test',
        schemaVersion: 1,
        payload: { fixture: true },
      });
    }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'P2003',
  );

  assert.equal(await database.branch.count({ where: { id: branchId } }), 0);
  assert.equal(await database.outboxEvent.count({ where: { aggregateId: runId } }), 0);
});
