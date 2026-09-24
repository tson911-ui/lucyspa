import type { Prisma } from '@lucy-spa/database';

export const sessionSelect = {
  id: true,
  kind: true,
  userId: true,
  credentialVersion: true,
  authzVersion: true,
  csrfKeyVersion: true,
  createdAt: true,
  lastActivityAt: true,
  absoluteExpiresAt: true,
  revokedAt: true,
  reauthenticatedAt: true,
  user: {
    select: {
      kind: true,
      status: true,
      passwordHash: true,
      emailVerifiedAt: true,
      credentialVersion: true,
      authzVersion: true,
    },
  },
} as const satisfies Prisma.SessionSelect;

export type SessionRecord = Prisma.SessionGetPayload<{ select: typeof sessionSelect }>;
export type SessionPrincipal = Omit<SessionRecord, 'revokedAt' | 'user'> & {
  readonly userKind: 'CUSTOMER' | 'EMPLOYEE' | 'OWNER' | null;
};

export interface SessionPolicy {
  readonly idleTtlSeconds: number;
  readonly csrfKeys: ReadonlyMap<number, Uint8Array>;
}

export function hasActiveCredential(user: SessionRecord['user']): boolean {
  return (
    user !== null &&
    user.status === 'ACTIVE' &&
    user.passwordHash !== null &&
    ((user.kind === 'CUSTOMER' && user.emailVerifiedAt !== null) ||
      user.kind === 'EMPLOYEE' ||
      user.kind === 'OWNER')
  );
}

/** Returns only the minimum authority needed by guards; never a database record. */
export function sessionPrincipal(
  record: SessionRecord | null,
  now: Date,
  policy: SessionPolicy,
): SessionPrincipal | null {
  if (
    record === null ||
    record.revokedAt !== null ||
    record.createdAt > now ||
    record.lastActivityAt > now ||
    record.absoluteExpiresAt <= now ||
    !policy.csrfKeys.has(record.csrfKeyVersion)
  ) {
    return null;
  }
  if (record.kind === 'AUTHENTICATED') {
    if (
      !hasActiveCredential(record.user) ||
      record.userId === null ||
      record.lastActivityAt.getTime() + policy.idleTtlSeconds * 1_000 <= now.getTime() ||
      record.credentialVersion !== record.user?.credentialVersion ||
      record.authzVersion !== record.user?.authzVersion
    ) {
      return null;
    }
  } else if (
    record.kind !== 'ANONYMOUS' ||
    record.userId !== null ||
    record.user !== null ||
    record.credentialVersion !== null ||
    record.authzVersion !== null ||
    record.reauthenticatedAt !== null
  ) {
    return null;
  }
  return {
    id: record.id,
    kind: record.kind,
    userId: record.userId,
    credentialVersion: record.credentialVersion,
    authzVersion: record.authzVersion,
    csrfKeyVersion: record.csrfKeyVersion,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    absoluteExpiresAt: record.absoluteExpiresAt,
    reauthenticatedAt: record.reauthenticatedAt,
    userKind: record.user?.kind ?? null,
  };
}

export function hasFreshReauthentication(
  principal: SessionPrincipal,
  now: Date,
  freshAuthSeconds: number,
): boolean {
  return (
    principal.kind === 'AUTHENTICATED' &&
    principal.reauthenticatedAt !== null &&
    principal.reauthenticatedAt <= now &&
    principal.reauthenticatedAt.getTime() + freshAuthSeconds * 1_000 > now.getTime()
  );
}
