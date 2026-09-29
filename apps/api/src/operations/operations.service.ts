import type { OperationalReasonRequest, OperationalTodayResponse } from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import {
  advanceVisit,
  arriveBooking,
  loadTimingSettings,
  markNoShow,
  operationalToday,
} from './operations.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const at = (branchId: string) => ({ kind: 'BRANCH', branchId }) as const;

/**
 * Staff operations on existing bookings (Phase 3 Step 5). Permission mapping (contract §14):
 * the board needs VIEW_BOOKINGS, arrival MANAGE_BOOKINGS, and NO_SHOW / release / advance
 * MANAGE_QUEUE, each at the booking's or visit's own branch, decided at transaction time
 * (never from a branch id sent by the browser). No role names; skills never authorize.
 */
@Injectable()
export class OperationsService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  async today(token: string | undefined, branchId: string): Promise<OperationalTodayResponse> {
    if (!UUID.test(branchId)) throw new AuthError('NOT_FOUND');
    const id = branchId.toLowerCase();
    return this.run(token, undefined, async ({ tx, now, actor }) => {
      if (!decide(actor.graph, 'VIEW_BOOKINGS', at(id))) throw new AuthError('FORBIDDEN');
      const branch = await tx.branch.findUnique({
        where: { id },
        select: { id: true, name: true, timezone: true },
      });
      if (!branch) throw new AuthError('NOT_FOUND');
      const [day] = await tx.$queryRaw<{ day: string }[]>`
        SELECT to_char(${now}::timestamptz AT TIME ZONE ${branch.timezone}, 'YYYY-MM-DD') AS day`;
      if (!day) throw new AuthError('SERVICE_UNAVAILABLE');
      const settings = await loadTimingSettings(tx);
      const permissions = {
        arrive: decide(actor.graph, 'MANAGE_BOOKINGS', at(id)),
        manageQueue: decide(actor.graph, 'MANAGE_QUEUE', at(id)),
        cancelLine: decide(actor.graph, 'MANAGE_BOOKINGS', at(id)),
        resolveExecution: decide(actor.graph, 'RESOLVE_SERVICE_EXECUTION', at(id)),
      };
      const board = await operationalToday(tx, {
        branchId: id,
        date: new Date(day.day),
        now,
        settings,
        canArrive: permissions.arrive,
        canManageQueue: permissions.manageQueue,
        actorUserId: actor.userId,
        canCancelLine: permissions.cancelLine,
        canResolveExecution: permissions.resolveExecution,
      });
      return { branch, date: day.day, now: now.toISOString(), settings, ...board, permissions };
    });
  }

  async arrive(
    token: string | undefined,
    bookingId: string,
    requestId?: string,
  ): Promise<{ visitId: string }> {
    if (!UUID.test(bookingId)) throw new AuthError('NOT_FOUND');
    return this.run(token, requestId, async (context) => ({
      visitId: await arriveBooking(
        context,
        bookingId.toLowerCase(),
        this.require(context, 'MANAGE_BOOKINGS'),
      ),
    }));
  }

  async noShow(
    token: string | undefined,
    bookingId: string,
    body: OperationalReasonRequest,
    requestId?: string,
  ): Promise<void> {
    if (!UUID.test(bookingId)) throw new AuthError('NOT_FOUND');
    const reason = this.reason(body);
    await this.run(token, requestId, (context) =>
      markNoShow(context, bookingId.toLowerCase(), reason, this.require(context, 'MANAGE_QUEUE')),
    );
  }

  async advance(
    token: string | undefined,
    visitId: string,
    body: OperationalReasonRequest,
    requestId?: string,
  ): Promise<void> {
    if (!UUID.test(visitId)) throw new AuthError('NOT_FOUND');
    const reason = this.reason(body);
    await this.run(token, requestId, (context) =>
      advanceVisit(context, visitId.toLowerCase(), reason, this.require(context, 'MANAGE_QUEUE')),
    );
  }

  /** Manager overrides are audited with a reason (contract §8). */
  private reason(body: OperationalReasonRequest): string {
    const reason = typeof body.reason === 'string' ? body.reason.normalize('NFC').trim() : '';
    if (!reason || [...reason].length > 500) throw new AuthError('VALIDATION_FAILED', 'reason');
    return reason;
  }

  private require(context: AdminContext, permission: string) {
    return (branchId: string) => {
      if (!decide(context.actor.graph, permission, at(branchId))) {
        throw new AuthError('FORBIDDEN');
      }
    };
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId },
      work,
    );
  }
}
