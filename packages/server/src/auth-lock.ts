import type { Prisma } from '@lucy-spa/database';

// Stable, process-independent lock identity. Security-graph writers take
// pg_advisory_xact_lock with this same pair (exclusive, not shared).
export const AUTH_GRAPH_LOCK_NAMESPACE = 0x4c554359;
export const AUTH_GRAPH_LOCK_KEY = 1;

export function assertAuthTransaction(transaction: Prisma.TransactionClient): void {
  // Prisma 7 supports nested transactions, so $transaction is not a discriminator.
  if (typeof Reflect.get(transaction, '$connect') === 'function') {
    throw new Error('Authentication mutations require an active Prisma transaction.');
  }
}

/** Lock order: graph, identity/throttle, Users sorted by UUID, then Session IDs. */
export async function takeSharedAuthGraphLock(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  assertAuthTransaction(transaction);
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock_shared(${AUTH_GRAPH_LOCK_NAMESPACE}::integer, ${AUTH_GRAPH_LOCK_KEY}::integer)::text
  `;
}

/**
 * Security-graph writers (role, override, scope and grant-affecting changes) take this
 * exclusive lock as the FIRST statement of their transaction, instead of the shared
 * lock, so no authentication mutation can observe a partially applied graph. Never
 * upgrade from a shared lock taken earlier in the same transaction.
 */
export async function takeExclusiveAuthGraphLock(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  assertAuthTransaction(transaction);
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(${AUTH_GRAPH_LOCK_NAMESPACE}::integer, ${AUTH_GRAPH_LOCK_KEY}::integer)::text
  `;
}

export interface AuthTransactionRunner {
  withTransaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

/** Authentication-data transactions outside the API: the shared graph lock comes first. */
export function authTransactionRunner(client: {
  $transaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}): AuthTransactionRunner {
  return {
    withTransaction: (work) =>
      client.$transaction(async (transaction) => {
        await takeSharedAuthGraphLock(transaction);
        return work(transaction);
      }),
  };
}
