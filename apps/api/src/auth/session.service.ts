import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { takeExclusiveAuthGraphLock, takeSharedAuthGraphLock } from './auth-store.js';
import { AuthError } from './auth.error.js';
import { capabilityDigest, constantTimeEqual, generateCapability } from './crypto.js';
import {
  hasActiveCredential,
  sessionPrincipal,
  sessionSelect,
  type SessionPrincipal,
  type SessionRecord,
} from './session.policy.js';

export interface IssuedSession {
  readonly token: string;
  readonly session: SessionPrincipal;
}

/** Evidence comes from a completed server-side password verification, never a DTO. */
export interface CredentialEvidence {
  readonly userId: string;
  readonly passwordHash: string;
  readonly credentialVersion: number;
  readonly authzVersion: number;
}

interface RotationOptions {
  readonly reauthenticated: boolean;
  readonly requestId?: string;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  /** Future flows compose credential changes, session writes and audit in this transaction. */
  async withTransaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.client.$transaction(async (transaction) => {
      await takeSharedAuthGraphLock(transaction);
      return work(transaction);
    });
  }

  /**
   * Security-graph writers (membership/scope changes): the exclusive graph lock is the
   * first statement, so no authentication mutation observes a partially applied graph.
   * Later shared-lock requests by this same transaction are granted by PostgreSQL.
   */
  async withExclusiveTransaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.client.$transaction(async (transaction) => {
      await takeExclusiveAuthGraphLock(transaction);
      return work(transaction);
    });
  }

  /** Read-only: context/background polling must never refresh idle activity. */
  async resolve(
    token: string | undefined,
    transaction?: Prisma.TransactionClient,
  ): Promise<SessionPrincipal | null> {
    const digest = token === undefined ? null : capabilityDigest(token);
    if (digest === null) return null;
    const client = transaction ?? this.prisma.client;
    const record = await client.session.findUnique({
      where: { tokenHash: new Uint8Array(digest) },
      select: sessionSelect,
    });
    return sessionPrincipal(record, new Date(), this.environment.auth);
  }

  /** Caller must take the shared graph lock before any throttle/identity locks. */
  async createAnonymous(transaction?: Prisma.TransactionClient): Promise<IssuedSession> {
    if (!transaction) return this.withTransaction((tx) => this.createAnonymous(tx));
    await takeSharedAuthGraphLock(transaction);
    const now = await this.now(transaction);
    return this.insert(transaction, now, {
      kind: 'ANONYMOUS',
      userId: null,
      credentialVersion: null,
      authzVersion: null,
      absoluteExpiresAt: new Date(
        now.getTime() + this.environment.auth.anonymousTtlSeconds * 1_000,
      ),
      reauthenticatedAt: null,
    });
  }

  /**
   * Recheck authority under locks in the caller's mutation transaction. Do not
   * substitute an earlier resolve() result for transaction-time authorization.
   * Call before taking challenge/delivery/session locks in a future flow.
   */
  async resolveForMutation(
    token: string,
    transaction: Prisma.TransactionClient,
  ): Promise<SessionPrincipal | null> {
    await takeSharedAuthGraphLock(transaction);
    const digest = capabilityDigest(token);
    if (digest === null) return null;
    const hint = await transaction.session.findUnique({
      where: { tokenHash: new Uint8Array(digest) },
      select: { id: true, userId: true },
    });
    if (!hint) return null;
    await this.lockUsers(transaction, hint.userId === null ? [] : [hint.userId]);
    await this.lockSession(transaction, hint.id);
    const record = await transaction.session.findUnique({
      where: { id: hint.id },
      select: sessionSelect,
    });
    return sessionPrincipal(record, await this.now(transaction), this.environment.auth);
  }

  /**
   * Session primitive, not a login flow. The caller verifies a password first;
   * every checked credential/version is revalidated while holding the User lock.
   * Rotation inserts a new row and revokes the old one without an overlap window.
   */
  async rotateAuthenticated(
    previousToken: string,
    evidence: CredentialEvidence,
    options: RotationOptions,
    transaction?: Prisma.TransactionClient,
  ): Promise<IssuedSession> {
    if (!transaction) {
      return this.withTransaction((tx) =>
        this.rotateAuthenticated(previousToken, evidence, options, tx),
      );
    }
    await takeSharedAuthGraphLock(transaction);
    const digest = capabilityDigest(previousToken);
    if (digest === null) throw new AuthError('AUTHENTICATION_REQUIRED');
    const hint = await transaction.session.findUnique({
      where: { tokenHash: new Uint8Array(digest) },
      select: { id: true, userId: true },
    });
    if (!hint) throw new AuthError('AUTHENTICATION_REQUIRED');
    await this.lockUsers(
      transaction,
      [evidence.userId, hint.userId].filter((id): id is string => id !== null),
    );
    await this.lockSession(transaction, hint.id);
    const now = await this.now(transaction);
    const previous = sessionPrincipal(
      await transaction.session.findUnique({
        where: { id: hint.id },
        select: sessionSelect,
      }),
      now,
      this.environment.auth,
    );
    const user = await transaction.user.findUnique({
      where: { id: evidence.userId },
      select: sessionSelect.user.select,
    });
    if (
      previous === null ||
      !hasActiveCredential(user) ||
      user?.passwordHash === null ||
      user === null ||
      !constantTimeEqual(Buffer.from(user.passwordHash), Buffer.from(evidence.passwordHash)) ||
      user.credentialVersion !== evidence.credentialVersion ||
      user.authzVersion !== evidence.authzVersion ||
      (previous.userId !== null && previous.userId !== evidence.userId) ||
      (options.reauthenticated && previous.kind !== 'AUTHENTICATED')
    ) {
      throw new AuthError('AUTHENTICATION_REQUIRED');
    }
    const issued = await this.insert(transaction, now, {
      kind: 'AUTHENTICATED',
      userId: evidence.userId,
      credentialVersion: user.credentialVersion,
      authzVersion: user.authzVersion,
      // Reauthentication does not extend the original absolute login lifetime.
      absoluteExpiresAt: options.reauthenticated
        ? previous.absoluteExpiresAt
        : new Date(now.getTime() + this.environment.auth.absoluteTtlSeconds * 1_000),
      reauthenticatedAt: options.reauthenticated ? now : null,
    });
    await transaction.session.update({
      where: { id: previous.id },
      data: { revokedAt: now },
      select: { id: true },
    });
    await transaction.auditEvent.create({
      data: {
        action: options.reauthenticated ? 'SESSION_REAUTHENTICATED' : 'SESSION_CREATED',
        actorKind: 'USER',
        actorUserId: evidence.userId,
        subjectUserId: evidence.userId,
        entityType: 'Session',
        entityId: issued.session.id,
        requestId: options.requestId ?? null,
        occurredAt: now,
        dataClassification: 'STANDARD',
        before: { previousSessionId: previous.id },
        after: {
          sessionId: issued.session.id,
          credentialVersion: user.credentialVersion,
          authzVersion: user.authzVersion,
        },
      },
      select: { id: true },
    });
    return issued;
  }

  /** Invoke only for foreground activity; no endpoint calls this automatically. */
  async touch(token: string, transaction?: Prisma.TransactionClient): Promise<boolean> {
    if (!transaction) return this.withTransaction((tx) => this.touch(token, tx));
    const principal = await this.resolveForMutation(token, transaction);
    if (principal === null || principal.kind !== 'AUTHENTICATED') return false;
    const now = await this.now(transaction);
    if (
      now >= principal.absoluteExpiresAt ||
      principal.lastActivityAt.getTime() + this.environment.auth.idleTtlSeconds * 1_000 <=
        now.getTime()
    ) {
      return false;
    }
    await transaction.session.update({
      where: { id: principal.id },
      data: { lastActivityAt: now },
      select: { id: true },
    });
    return true;
  }

  /** Revocation primitive; no logout endpoint or logout flow is introduced here. */
  async revoke(
    token: string,
    requestId?: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (!transaction) return this.withTransaction((tx) => this.revoke(token, requestId, tx));
    const principal = await this.resolveForMutation(token, transaction);
    if (principal === null) return false;
    const now = await this.now(transaction);
    await transaction.session.update({
      where: { id: principal.id },
      data: { revokedAt: now },
      select: { id: true },
    });
    if (principal.kind === 'AUTHENTICATED') {
      await transaction.auditEvent.create({
        data: {
          action: 'SESSIONS_REVOKED',
          actorKind: 'USER',
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          entityType: 'Session',
          entityId: principal.id,
          requestId: requestId ?? null,
          occurredAt: now,
          dataClassification: 'STANDARD',
          after: { revokedSessionId: principal.id },
        },
        select: { id: true },
      });
    }
    return true;
  }

  private async insert(
    transaction: Prisma.TransactionClient,
    now: Date,
    authority: Pick<
      SessionRecord,
      | 'kind'
      | 'userId'
      | 'credentialVersion'
      | 'authzVersion'
      | 'absoluteExpiresAt'
      | 'reauthenticatedAt'
    >,
  ): Promise<IssuedSession> {
    const token = generateCapability();
    const digest = capabilityDigest(token);
    if (digest === null) throw new Error('Capability generation failed.');
    const record = await transaction.session.create({
      data: {
        ...authority,
        tokenHash: new Uint8Array(digest),
        csrfKeyVersion: this.environment.auth.csrfActiveVersion,
        createdAt: now,
        lastActivityAt: now,
      },
      select: sessionSelect,
    });
    const session = sessionPrincipal(record, now, this.environment.auth);
    if (session === null) throw new Error('Invalid session authority.');
    return { token, session };
  }

  private async now(transaction: Prisma.TransactionClient): Promise<Date> {
    const rows = await transaction.$queryRaw<{ now: Date }[]>`
      SELECT clock_timestamp() AS now
    `;
    const now = rows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error('Database clock unavailable.');
    }
    return now;
  }

  private async lockUsers(transaction: Prisma.TransactionClient, ids: string[]): Promise<void> {
    for (const id of [...new Set(ids)].sort()) {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
    }
  }

  private async lockSession(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    await transaction.$queryRaw`SELECT id FROM sessions WHERE id = ${id}::uuid FOR UPDATE`;
  }
}
