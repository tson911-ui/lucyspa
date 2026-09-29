import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type {
  CancelServiceLineRequest,
  CancelledServiceLineResponse,
  ResolveServiceExecutionRequest,
  ResolvedServiceExecutionResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { endService, myServiceWork, serviceWork, startService } from './service-execution.core.js';
import { cancelServiceLine, resolveServiceExecution } from './visit-completion.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ServiceExecutionService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  myWork(token: string | undefined, branchId: string) {
    return this.run(token, branchId, undefined, (context, id) => myServiceWork(context, id));
  }

  get(token: string | undefined, lineId: string) {
    return this.run(token, lineId, undefined, serviceWork);
  }

  start(token: string | undefined, lineId: string, requestId?: string) {
    return this.run(token, lineId, requestId, startService);
  }

  end(token: string | undefined, lineId: string, requestId?: string) {
    return this.run(token, lineId, requestId, endService);
  }

  /**
   * Phase 4 Step 2: management resolution of a forgotten END. Needs RESOLVE_SERVICE_EXECUTION at the
   * visit's branch; the performer is locked with the actor so it serializes with their own END.
   */
  async resolve(
    token: string | undefined,
    lineId: string,
    body: ResolveServiceExecutionRequest,
    requestId?: string,
  ): Promise<ResolvedServiceExecutionResponse> {
    const reason = normalizeReason(body.reason);
    const endedAt = parseEndedAt(body.endedAt);
    return await this.run(
      token,
      lineId,
      requestId,
      (context, id) =>
        resolveServiceExecution(
          context,
          id,
          { reason, endedAt },
          this.require(context, 'RESOLVE_SERVICE_EXECUTION'),
        ),
      lineUsers(lineId),
    );
  }

  /** Phase 4 Step 2: cancel one unperformed line. Needs MANAGE_BOOKINGS at the visit's branch. */
  async cancelLine(
    token: string | undefined,
    lineId: string,
    body: CancelServiceLineRequest,
    requestId?: string,
  ): Promise<CancelledServiceLineResponse> {
    const reason = normalizeReason(body.reason);
    return await this.run(
      token,
      lineId,
      requestId,
      (context, id) =>
        cancelServiceLine(context, id, reason, this.require(context, 'MANAGE_BOOKINGS')),
      lineUsers(lineId),
    );
  }

  private require(context: AdminContext, permission: string) {
    return (branchId: string) => {
      if (!decide(context.actor.graph, permission, { kind: 'BRANCH', branchId })) {
        throw new AuthError('FORBIDDEN');
      }
    };
  }

  private run<T>(
    token: string | undefined,
    id: string,
    requestId: string | undefined,
    work: (context: AdminContext, id: string) => Promise<T>,
    lockUsers?: (tx: Prisma.TransactionClient) => Promise<readonly string[]>,
  ): Promise<T> {
    if (!UUID.test(id)) throw new AuthError('NOT_FOUND');
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId, ...(lockUsers ? { lockUsers } : {}) },
      async (context) => {
        try {
          return await work(context, id.toLowerCase());
        } catch (error) {
          if (error instanceof AuthError) throw error;
          const meta = Reflect.get(Object(error), 'meta');
          const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
          if (
            ['55P03', '40P01', '40001', '23505', '23P01'].includes(state ?? '') ||
            ['P2002', 'P2034'].includes(Reflect.get(Object(error), 'code'))
          ) {
            throw new AuthError('SERVICE_EXECUTION_CONFLICT');
          }
          throw error;
        }
      },
    );
  }
}

/** The line's KTV, locked with the actor (sorted by the frame) so it serializes with that KTV's own START/END. */
function lineUsers(lineId: string) {
  return async (tx: Prisma.TransactionClient): Promise<readonly string[]> => {
    if (!UUID.test(lineId)) return [];
    const line = await tx.visitServiceLine.findUnique({
      where: { id: lineId.toLowerCase() },
      select: { employeeUserId: true },
    });
    return line?.employeeUserId ? [line.employeeUserId] : [];
  };
}

/** A required, trimmed, NFC-normalized reason of at most 500 characters (as the other manager actions). */
export function normalizeReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (!reason || [...reason].length > 500) throw new AuthError('VALIDATION_FAILED', 'reason');
  return reason;
}

/** Optional ISO-8601 instant that must carry a time zone; anything else is a validation error. */
export function parseEndedAt(value: unknown): Date | null {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new AuthError('VALIDATION_FAILED', 'endedAt');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AuthError('VALIDATION_FAILED', 'endedAt');
  return date;
}
