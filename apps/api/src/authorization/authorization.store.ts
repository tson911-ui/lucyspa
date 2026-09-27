import type { Prisma } from '@lucy-spa/database';
import { assertAuthTransaction } from '../auth/auth-store.js';
export { loadAuthorityGraph } from '@lucy-spa/server';

/**
 * Same-transaction consequence of any role/override/scope change: increment each
 * affected User's authzVersion and revoke their sessions, so client permission hints
 * cannot prolong access. Users are locked in UUID order, then sessions (documented
 * lock order). Returns the number of revoked sessions.
 */
export async function invalidateAuthorization(
  transaction: Prisma.TransactionClient,
  userIds: Iterable<string>,
  now: Date,
): Promise<number> {
  assertAuthTransaction(transaction);
  const ids = [...new Set(userIds)].sort();
  if (ids.length === 0) return 0;
  for (const id of ids) {
    await transaction.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
  }
  await transaction.user.updateMany({
    where: { id: { in: ids }, kind: 'EMPLOYEE' },
    data: { authzVersion: { increment: 1 } },
  });
  const revoked = await transaction.session.updateMany({
    where: { userId: { in: ids }, revokedAt: null },
    data: { revokedAt: now },
  });
  return revoked.count;
}
