import type { Prisma } from '@lucy-spa/database';
import type { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest } from '../auth/crypto.js';
import type { SessionPrincipal } from '../auth/session.policy.js';
import type { SessionService } from '../auth/session.service.js';

export interface CustomerContext {
  readonly tx: Prisma.TransactionClient;
  readonly now: Date;
  /** The session's customer: the only identity (no customer id is accepted from the browser). */
  readonly customerUserId: string;
  /** The resolved session, for commands that run a core written for a context with an actor (online checkout). */
  readonly principal: SessionPrincipal;
  /** The id of the request, for the audit trail. */
  readonly requestId: string | null;
}

/**
 * Thrown by a command to end its transaction WITHOUT saving anything and hand a value back (a price quote is computed by building the
 * real draft and rolling it back, so it can never differ from the real order). Any other error keeps its meaning.
 */
export class CommandRollback<T> extends Error {
  constructor(readonly value: T) {
    super('Rolled back on purpose');
    this.name = 'CommandRollback';
  }
}

export interface CustomerCommandDependencies {
  readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>;
  readonly throttle: Pick<AuthThrottleService, 'now'>;
}

/** PostgreSQL SQLSTATE of a failed statement, through the Prisma driver adapter. */
export function sqlStateOf(error: unknown): string | undefined {
  const meta = Reflect.get(Object(error), 'meta') as
    { driverAdapterError?: { cause?: { originalCode?: string; code?: string } } } | undefined;
  const cause = meta?.driverAdapterError?.cause;
  return cause?.originalCode ?? cause?.code;
}

/**
 * The customer-realm counterpart of `runAdminCommand` (same lock order): shared auth-graph
 * lock, the session's user row `FOR UPDATE`, the session, then the work. Only an authenticated
 * CUSTOMER passes; workforce sessions are refused. Known database outcomes are mapped to
 * stable codes and nothing else leaks: a KTV overlap caught by the Step 2 backstop (23P01)
 * becomes BOOKING_SLOT_UNAVAILABLE. A failure rolls the whole transaction back.
 */
export async function runCustomerCommand<T>(
  dependencies: CustomerCommandDependencies,
  sessionToken: string | undefined,
  work: (context: CustomerContext) => Promise<T>,
  options: { requestId?: string | undefined } = {},
): Promise<T> {
  const digest = sessionToken === undefined ? null : capabilityDigest(sessionToken);
  if (sessionToken === undefined || digest === null) {
    throw new AuthError('AUTHENTICATION_REQUIRED');
  }
  try {
    return await dependencies.sessions.withTransaction(async (tx) => {
      const hint = await tx.session.findUnique({
        where: { tokenHash: new Uint8Array(digest) },
        select: { userId: true },
      });
      if (!hint?.userId) throw new AuthError('AUTHENTICATION_REQUIRED');
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${hint.userId}::uuid FOR UPDATE`;
      const principal = await dependencies.sessions.resolveForMutation(sessionToken, tx);
      if (
        principal?.kind !== 'AUTHENTICATED' ||
        principal.userId === null ||
        principal.userId !== hint.userId
      ) {
        throw new AuthError('AUTHENTICATION_REQUIRED');
      }
      if (principal.userKind !== 'CUSTOMER') throw new AuthError('FORBIDDEN');
      return work({
        tx,
        now: await dependencies.throttle.now(tx),
        customerUserId: principal.userId,
        principal,
        requestId: options.requestId ?? null,
      });
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof CommandRollback) throw error;
    if (sqlStateOf(error) === '23P01') throw new AuthError('BOOKING_SLOT_UNAVAILABLE');
    if (Reflect.get(Object(error), 'code') === 'P2002') throw new AuthError('CONFLICT');
    throw new AuthError('SERVICE_UNAVAILABLE');
  }
}
