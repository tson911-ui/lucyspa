import { randomUUID } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';
import { takeExclusiveAuthGraphLock } from '../auth/auth-store.js';

export type OwnerBootstrapOutcome =
  | { readonly status: 'CREATED'; readonly ownerId: string }
  | { readonly status: 'ALREADY_INITIALIZED' }
  | { readonly status: 'IDENTITY_CONFLICT' };

export interface OwnerBootstrapInput {
  readonly fullName: string;
  readonly emailCanonical: string;
  readonly emailDelivery: string;
  readonly phoneCanonical: string | null;
  readonly normalizationVersion: number;
  readonly locale: 'vi' | 'en';
  /** Argon2id PHC hash produced under the password policy; never the password itself. */
  readonly passwordHash: string;
  /** Operator execution context for audit; never a credential. */
  readonly executionContext: string;
}

/**
 * Design section 8: exclusive lock, recheck absence, insert User and audit atomically.
 * A repeated bootstrap reports ALREADY_INITIALIZED and never overwrites credentials.
 * The OWNER insert additionally requires the bootstrap-only database privilege, and
 * the sole-Owner partial unique index remains the final guard.
 */
export async function bootstrapOwner(
  transaction: Prisma.TransactionClient,
  input: OwnerBootstrapInput,
): Promise<OwnerBootstrapOutcome> {
  await takeExclusiveAuthGraphLock(transaction);
  const existing = await transaction.user.findFirst({
    where: { kind: 'OWNER' },
    select: { id: true },
  });
  if (existing) return { status: 'ALREADY_INITIALIZED' };
  const conflict = await transaction.user.findFirst({
    where: {
      OR: [
        { emailCanonical: input.emailCanonical },
        ...(input.phoneCanonical ? [{ phoneCanonical: input.phoneCanonical }] : []),
      ],
    },
    select: { id: true },
  });
  // Never convert or take over another principal's identity.
  if (conflict) return { status: 'IDENTITY_CONFLICT' };
  const rows = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = rows[0]?.now ?? new Date();
  const ownerId = randomUUID();
  await transaction.user.create({
    data: {
      id: ownerId,
      kind: 'OWNER',
      status: 'ACTIVE',
      fullName: input.fullName,
      preferredLocale: input.locale,
      emailCanonical: input.emailCanonical,
      emailDelivery: input.emailDelivery,
      // An operator-entered address is not verified by bootstrap.
      emailVerifiedAt: null,
      phoneCanonical: input.phoneCanonical,
      normalizationVersion: input.normalizationVersion,
      passwordHash: input.passwordHash,
      createdAt: now,
    },
    select: { id: true },
  });
  await transaction.auditEvent.create({
    data: {
      action: 'OWNER_BOOTSTRAPPED',
      actorKind: 'BOOTSTRAP',
      subjectUserId: ownerId,
      entityType: 'User',
      entityId: ownerId,
      correlationId: randomUUID(),
      occurredAt: now,
      dataClassification: 'STANDARD',
      after: { kind: 'OWNER', status: 'ACTIVE', executionContext: input.executionContext },
    },
    select: { id: true },
  });
  return { status: 'CREATED', ownerId };
}
