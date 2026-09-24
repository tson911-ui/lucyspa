import type { Prisma } from '@lucy-spa/database';
import type { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest } from '../auth/crypto.js';
import type { SessionPrincipal } from '../auth/session.policy.js';
import type { SessionService } from '../auth/session.service.js';
import { decideAcross, type AuthorityGraph } from './authorization.js';
import { loadAuthorityGraph } from './authorization.store.js';

export interface AdminActor {
  readonly principal: SessionPrincipal;
  readonly graph: AuthorityGraph;
  readonly userId: string;
  readonly owner: boolean;
}

export interface AdminContext {
  readonly tx: Prisma.TransactionClient;
  readonly now: Date;
  readonly actor: AdminActor;
  readonly requestId: string | null;
}

export interface AdminCommandDependencies {
  readonly sessions: Pick<
    SessionService,
    'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
  >;
  readonly throttle: Pick<AuthThrottleService, 'now'>;
}

export interface AdminCommandOptions {
  /** Security-graph writers take the exclusive graph lock as their first statement. */
  readonly exclusive: boolean;
  readonly requestId?: string | undefined;
  /**
   * Other Users this command reads or changes (targets, shared-role recipients). They
   * are locked together with the actor, sorted by UUID, before the actor's session.
   */
  readonly lockUsers?: (tx: Prisma.TransactionClient) => Promise<readonly string[]>;
}

function uniqueViolation(error: unknown): boolean {
  return Reflect.get(Object(error), 'code') === 'P2002';
}

/**
 * Shared workforce-administration frame (Steps 10 and 11). Lock order: graph (shared,
 * or exclusive for security-graph changes), Users sorted by UUID, the actor's session,
 * then any rows the work touches. The actor's authority graph is loaded under those
 * locks, so authorization is transaction-time. Customers never pass this frame.
 */
export async function runAdminCommand<T>(
  dependencies: AdminCommandDependencies,
  sessionToken: string | undefined,
  options: AdminCommandOptions,
  work: (context: AdminContext) => Promise<T>,
): Promise<T> {
  const digest = sessionToken === undefined ? null : capabilityDigest(sessionToken);
  if (sessionToken === undefined || digest === null) {
    throw new AuthError('AUTHENTICATION_REQUIRED');
  }
  const { sessions, throttle } = dependencies;
  const run = options.exclusive
    ? sessions.withExclusiveTransaction.bind(sessions)
    : sessions.withTransaction.bind(sessions);
  try {
    return await run(async (tx) => {
      const hint = await tx.session.findUnique({
        where: { tokenHash: new Uint8Array(digest) },
        select: { userId: true },
      });
      if (!hint?.userId) throw new AuthError('AUTHENTICATION_REQUIRED');
      const others = options.lockUsers ? await options.lockUsers(tx) : [];
      const users = [...new Set([hint.userId, ...others])].sort();
      for (const id of users) {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      }
      const principal = await sessions.resolveForMutation(sessionToken, tx);
      if (
        principal?.kind !== 'AUTHENTICATED' ||
        principal.userId === null ||
        principal.userId !== hint.userId
      ) {
        throw new AuthError('AUTHENTICATION_REQUIRED');
      }
      // Customers never reach workforce administration.
      if (principal.userKind !== 'OWNER' && principal.userKind !== 'EMPLOYEE') {
        throw new AuthError('FORBIDDEN');
      }
      const graph = await loadAuthorityGraph(tx, principal.userId);
      if (!graph) throw new AuthError('AUTHENTICATION_REQUIRED');
      const actor: AdminActor = {
        principal,
        graph,
        userId: principal.userId,
        owner: graph.kind === 'OWNER',
      };
      return work({ tx, now: await throttle.now(tx), actor, requestId: options.requestId ?? null });
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    // A concurrent insert won a unique key; reveal no conflicting record.
    if (uniqueViolation(error)) throw new AuthError('CONFLICT');
    throw new AuthError('SERVICE_UNAVAILABLE');
  }
}

/** Every affected branch must pass; no branch requires GLOBAL authority. */
export function requireAcross(
  actor: AdminActor,
  permission: string,
  branchIds: Iterable<string>,
): void {
  if (!decideAcross(actor.graph, permission, branchIds)) throw new AuthError('FORBIDDEN');
}

/** Same-transaction audit append by the acting User. */
export async function appendAdminAudit(
  context: AdminContext,
  event: {
    action: string;
    entityType: string;
    entityId: string;
    subjectUserId?: string | null;
    branchId?: string | null;
    reason?: string | null;
    before?: Prisma.InputJsonObject;
    after?: Prisma.InputJsonObject;
    classification?: 'STANDARD' | 'EMPLOYEE_PAY';
  },
): Promise<void> {
  await context.tx.auditEvent.create({
    data: {
      action: event.action,
      actorKind: 'USER',
      actorUserId: context.actor.userId,
      subjectUserId: event.subjectUserId ?? null,
      entityType: event.entityType,
      entityId: event.entityId,
      branchId: event.branchId ?? null,
      requestId: context.requestId,
      occurredAt: context.now,
      reason: event.reason ?? null,
      ...(event.before ? { before: event.before } : {}),
      ...(event.after ? { after: event.after } : {}),
      dataClassification: event.classification ?? 'STANDARD',
    },
    select: { id: true },
  });
}
