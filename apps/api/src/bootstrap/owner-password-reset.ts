import { randomUUID } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';
import { invalidatePendingDeliveries } from '../auth/auth-delivery.js';

export type OwnerPasswordResetOutcome =
  | { readonly status: 'RESET'; readonly ownerId: string; readonly revokedSessions: number }
  | { readonly status: 'NO_OWNER' }
  | { readonly status: 'AMBIGUOUS' }
  | { readonly status: 'IDENTITY_MISMATCH' };

export interface OwnerPasswordResetInput {
  /**
   * The Owner's email as the operator states it (canonical form). It must match the
   * stored Owner email; it only confirms the target and is never used to find another
   * principal, so an employee or customer can never be reset through this channel.
   */
  readonly confirmEmailCanonical: string;
  /** Argon2id PHC hash produced under the password policy; never the password itself. */
  readonly passwordHash: string;
  /** Operator execution context for audit; never a credential. */
  readonly executionContext: string;
}

/** Credential flows that must not survive an operator reset. */
const CREDENTIAL_FLOWS = ['RESET_PASSWORD', 'EMPLOYEE_SETUP', 'VERIFY_RECOVERY_EMAIL'] as const;

/**
 * Last-resort Owner recovery through the protected operator channel (server shell), for an
 * Owner who can no longer use email recovery. Only the single OWNER principal is ever
 * touched. Atomically: new password hash, next credential version, every Owner session
 * revoked, open reset/setup/recovery challenges and their pending emails retired, and an
 * audit record without password material. Status, email and verification are unchanged.
 */
export async function resetOwnerPassword(
  transaction: Prisma.TransactionClient,
  input: OwnerPasswordResetInput,
): Promise<OwnerPasswordResetOutcome> {
  const owners = await transaction.user.findMany({
    where: { kind: 'OWNER' },
    select: { id: true },
    take: 2,
  });
  if (owners.length === 0) return { status: 'NO_OWNER' };
  // The sole-Owner index makes this impossible; refuse rather than guess if it ever happens.
  if (owners.length > 1) return { status: 'AMBIGUOUS' };
  const ownerId = owners[0]!.id;
  await transaction.$queryRaw`SELECT id FROM users WHERE id = ${ownerId}::uuid FOR UPDATE`;
  const owner = await transaction.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { kind: true, emailCanonical: true, credentialVersion: true },
  });
  if (owner.kind !== 'OWNER' || owner.emailCanonical !== input.confirmEmailCanonical) {
    return { status: 'IDENTITY_MISMATCH' };
  }
  const rows = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = rows[0]?.now ?? new Date();
  const credentialVersion = owner.credentialVersion + 1;
  const changed = await transaction.user.updateMany({
    where: { id: ownerId, kind: 'OWNER', credentialVersion: owner.credentialVersion },
    data: { passwordHash: input.passwordHash, credentialVersion, rowVersion: { increment: 1 } },
  });
  if (changed.count !== 1) throw new Error('Owner credential changed concurrently.');
  const revoked = await transaction.session.updateMany({
    where: { userId: ownerId, revokedAt: null },
    data: { revokedAt: now },
  });
  const flows = await transaction.authChallenge.findMany({
    where: {
      userId: ownerId,
      purpose: { in: [...CREDENTIAL_FLOWS] },
      consumedAt: null,
      invalidatedAt: null,
    },
    select: { id: true },
  });
  if (flows.length > 0) {
    await transaction.authChallenge.updateMany({
      where: { id: { in: flows.map((row) => row.id) } },
      data: { invalidatedAt: now },
    });
    await invalidatePendingDeliveries(
      transaction,
      flows.map((row) => row.id),
    );
  }
  const correlationId = randomUUID();
  const audit = {
    actorKind: 'BOOTSTRAP',
    subjectUserId: ownerId,
    entityType: 'User',
    entityId: ownerId,
    correlationId,
    occurredAt: now,
    dataClassification: 'STANDARD',
  } as const;
  await transaction.auditEvent.createMany({
    data: [
      {
        ...audit,
        action: 'OWNER_PASSWORD_RESET_BY_OPERATOR',
        before: { credentialVersion: owner.credentialVersion },
        after: {
          credentialVersion,
          method: 'OPERATOR_CLI',
          executionContext: input.executionContext,
          retiredFlows: flows.length,
        },
      },
      ...(revoked.count > 0
        ? [
            {
              ...audit,
              action: 'SESSIONS_REVOKED',
              after: { reason: 'OWNER_PASSWORD_RESET_BY_OPERATOR', revokedSessions: revoked.count },
            },
          ]
        : []),
    ],
  });
  return { status: 'RESET', ownerId, revokedSessions: revoked.count };
}
