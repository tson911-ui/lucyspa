import assert from 'node:assert/strict';
import type { Phase6Kit } from './phase6-fixture.js';

/**
 * Gives a person a NEW password confirmation, as a real person re-entering their password would (a confirmation covers one money
 * action). The test-only way: the session row is rewritten with the replica role, because session authority is immutable otherwise.
 */
export async function confirmAgain(base: Phase6Kit, token: string): Promise<void> {
  const { tx } = base;
  const principal = await base.adapter.resolve(token);
  assert.ok(principal?.userId, 'a signed-in person');
  await tx.$executeRawUnsafe('SELECT pg_sleep(0.003)');
  await tx.$executeRawUnsafe('SAVEPOINT confirm');
  try {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.$executeRawUnsafe(
      `UPDATE sessions SET reauthenticated_at = date_trunc('milliseconds', clock_timestamp()) WHERE user_id = '${principal.userId}'`,
    );
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT confirm');
  } catch (error) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT confirm');
    throw error;
  }
}
