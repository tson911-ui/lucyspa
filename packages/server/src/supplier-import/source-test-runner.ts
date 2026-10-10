import type { DatabaseClient, Prisma } from '@lucy-spa/database';
import { createGuardedHttpClient, type HttpClient } from './http-client.js';
import { runSourceTest, type SourceTestResult } from './source-test.js';

/**
 * Phase 9 P9-3: the worker side of Test Source. It claims one queued test (`FOR UPDATE SKIP LOCKED`, so two workers never run the same
 * one), checks again that the source still has a confirmed permission and the same address (nothing is requested otherwise), reads the
 * sample through the guarded client, and stores the result. A failed test moves the source to the status that tells the Owner what is
 * wrong (ADAPTER_REQUIRED, AUTHENTICATION_REQUIRED or SOURCE_ERROR); a passed test changes nothing on the source: a person confirms
 * it (API) and only then does the source become READY. A test whose worker vanished is failed when its lease runs out.
 */

export const SOURCE_TEST_LEASE_MINUTES = 3;

/** The worker passes its client; a test may pass a transaction client so everything rolls back. */
export type SourceTestDatabase = DatabaseClient | Prisma.TransactionClient;

type TestClientFactory = (baseUrl: string) => HttpClient;

const defaultClient: TestClientFactory = (baseUrl) =>
  createGuardedHttpClient({ allowedHosts: [new URL(baseUrl).hostname] });

interface Claimed {
  id: string;
  source_id: string;
  base_url: string;
}

type FailedStatus = 'ADAPTER_REQUIRED' | 'AUTHENTICATION_REQUIRED' | 'SOURCE_ERROR';

/** Fails tests whose lease has run out (the worker died while it was RUNNING). Returns how many. */
export async function failExpiredSourceTests(database: SourceTestDatabase): Promise<number> {
  const rows = await database.$queryRaw<{ id: string; source_id: string }[]>`
    UPDATE supplier_source_tests
       SET status = 'FAILED', finished_at = clock_timestamp(), failure_code = 'WORKER_LOST',
           failure_source_status = 'SOURCE_ERROR'
     WHERE status = 'RUNNING' AND lease_expires_at < clock_timestamp()
    RETURNING id, source_id`;
  for (const row of rows) await setSourceStatus(database, row.source_id, 'SOURCE_ERROR');
  return rows.length;
}

async function setSourceStatus(
  database: SourceTestDatabase,
  sourceId: string,
  status: FailedStatus,
): Promise<void> {
  // The version moves by one, as every update of a source must (a screen that is open then refetches before its next command).
  await database.$executeRaw`
    UPDATE supplier_sources SET status = ${status}::"SupplierSourceStatus", row_version = row_version + 1
     WHERE id = ${sourceId}::uuid AND status <> ${status}::"SupplierSourceStatus"`;
}

async function claim(database: SourceTestDatabase): Promise<Claimed | null> {
  const rows = await database.$queryRaw<Claimed[]>`
    UPDATE supplier_source_tests
       SET status = 'RUNNING', started_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(mins => ${SOURCE_TEST_LEASE_MINUTES})
     WHERE id = (SELECT id FROM supplier_source_tests WHERE status = 'QUEUED'
                  ORDER BY requested_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, source_id, base_url`;
  return rows[0] ?? null;
}

async function failWithoutRequest(
  database: SourceTestDatabase,
  test: Claimed,
  code: string,
): Promise<void> {
  await database.$executeRaw`
    UPDATE supplier_source_tests SET status = 'FAILED', finished_at = clock_timestamp(), failure_code = ${code}
     WHERE id = ${test.id}::uuid`;
}

async function store(
  database: SourceTestDatabase,
  test: Claimed,
  result: SourceTestResult,
): Promise<void> {
  const failure = result.outcome === 'FAILED' ? result.failure : null;
  const inTransaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    '$transaction' in database ? database.$transaction(work) : work(database);
  await inTransaction(async (tx) => {
    // Same lock order as the API (source first), so a command on the source never deadlocks with the worker.
    await tx.$queryRaw`SELECT id FROM supplier_sources WHERE id = ${test.source_id}::uuid FOR UPDATE`;
    await tx.$executeRaw`
      UPDATE supplier_source_tests
         SET status = ${result.outcome}::"SourceTestStatus", finished_at = clock_timestamp(),
             failure_code = ${failure?.code ?? null}, failure_detail = ${failure?.detail?.slice(0, 200) ?? null},
             failure_source_status = ${failure?.status ?? null}::"SupplierSourceStatus",
             summary = ${JSON.stringify(result.summary ?? {})}::jsonb,
             sample = ${JSON.stringify(result.sample)}::jsonb,
             problems = ${JSON.stringify(result.problems)}::jsonb,
             request_count = ${Math.min(result.requests, 10)}
       WHERE id = ${test.id}::uuid AND status = 'RUNNING'`;
    if (failure) {
      await tx.$executeRaw`
        UPDATE supplier_sources SET status = ${failure.status}::"SupplierSourceStatus", row_version = row_version + 1
         WHERE id = ${test.source_id}::uuid AND base_url = ${test.base_url} AND status <> ${failure.status}::"SupplierSourceStatus"`;
    }
  });
}

/** Runs at most one queued test. Returns the outcome, or null when nothing was queued. */
export async function processNextSourceTest(
  database: SourceTestDatabase,
  options: { createClient?: TestClientFactory } = {},
): Promise<'PASSED' | 'FAILED' | null> {
  await failExpiredSourceTests(database);
  const test = await claim(database);
  if (!test) return null;
  const [source] = await database.$queryRaw<
    { base_url: string | null; confirmed: boolean; covers: boolean }[]
  >`
    SELECT base_url, permission_confirmed_at IS NOT NULL AS confirmed, (permits_text OR permits_images) AS covers
      FROM supplier_sources WHERE id = ${test.source_id}::uuid`;
  if (!source || !source.confirmed || !source.covers) {
    await failWithoutRequest(database, test, 'PERMISSION_CHANGED');
    return 'FAILED';
  }
  if (source.base_url !== test.base_url) {
    await failWithoutRequest(database, test, 'ADDRESS_CHANGED');
    return 'FAILED';
  }
  let result: SourceTestResult;
  const client = (options.createClient ?? defaultClient)(test.base_url);
  try {
    result = await runSourceTest({ client, baseUrl: test.base_url });
  } catch {
    // runSourceTest reports every expected failure itself; this is a bug or a broken client, never a reason to leave the test RUNNING.
    result = {
      outcome: 'FAILED',
      failure: { code: 'CONNECTION', status: 'SOURCE_ERROR', detail: 'INTERNAL' },
      summary: null,
      sample: [],
      problems: [],
      requests: client.requestCount(),
    };
  }
  await store(database, test, result);
  return result.outcome;
}
