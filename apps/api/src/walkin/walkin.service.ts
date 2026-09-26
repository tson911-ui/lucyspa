import type {
  WalkInCreateRequest,
  WalkInIntentRequest,
  WalkInMemberLookupResponse,
  WalkInOptionsResponse,
  WalkInVisitResponse,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  loadAvailabilityFacts,
  qualifiedEmployeesByService,
} from '../availability/availability.engine.js';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import {
  assignWaitingSequence,
  cancelWaitingWalkIn,
  changeWaitingIntent,
  createWalkIn,
  lookupMember,
  normalizeWalkIn,
  walkInVisit,
} from './walkin.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const at = (branchId: string) => ({ kind: 'BRANCH', branchId }) as const;

/**
 * Walk-in intake, member lookup, initial assignment and waiting intent (Phase 3 Step 6). One
 * permission covers them (contract §14: MANAGE_BOOKINGS "create walk-ins and participants, add
 * lines"), decided at transaction time at the branch of the record itself; initial assignment is
 * not REASSIGN_SERVICES (Step 8). No role names; skills never authorize.
 */
@Injectable()
export class WalkInService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  async lookup(
    token: string | undefined,
    branchId: string,
    query: { phone?: string; email?: string },
  ): Promise<WalkInMemberLookupResponse> {
    const branch = this.branch(branchId);
    return this.run(token, undefined, ({ tx, actor }) => {
      this.check(actor.graph, branch);
      return lookupMember(tx, query);
    });
  }

  async options(token: string | undefined, branchId: string): Promise<WalkInOptionsResponse> {
    const id = this.branch(branchId);
    return this.run(token, undefined, async ({ tx, actor, now }) => {
      this.check(actor.graph, id);
      const branch = await tx.branch.findFirst({
        where: { id, isActive: true },
        select: { id: true, name: true, timezone: true },
      });
      if (!branch) throw new AuthError('NOT_FOUND');
      const services = await tx.service.findMany({
        where: { isActive: true, branches: { some: { branchId: id, isActive: true } } },
        orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          nameVi: true,
          nameEn: true,
          durationMinutes: true,
          priceVnd: true,
          priceMaxVnd: true,
          pricingUnit: true,
        },
      });
      if (services.length === 0) return { branch, services: [] };
      const [day] = await tx.$queryRaw<{ day: string }[]>`
        SELECT to_char(${now}::timestamptz AT TIME ZONE ${branch.timezone}, 'YYYY-MM-DD') AS day`;
      const facts = await loadAvailabilityFacts(tx, {
        branchId: id,
        serviceDate: day!.day,
        serviceIds: services.map((service) => service.id),
        context: 'OPERATIONAL',
        now,
      });
      const qualified = qualifiedEmployeesByService(facts);
      const checkedIn = new Map(
        facts.employees.map((employee) => [employee.userId, employee.checkedIn]),
      );
      const names = new Map(
        (
          await tx.user.findMany({
            where: { id: { in: [...new Set(qualified.flat())] } },
            select: { id: true, fullName: true },
          })
        ).map((row) => [row.id, row.fullName]),
      );
      return {
        branch,
        services: services.map((service, index) => ({
          id: service.id,
          nameVi: service.nameVi,
          nameEn: service.nameEn,
          durationMinutes: service.durationMinutes,
          priceMinVnd: service.priceVnd.toString(),
          priceMaxVnd: service.priceMaxVnd.toString(),
          pricingUnit: service.pricingUnit,
          employees: (qualified[index] ?? [])
            .map((employeeId) => ({
              id: employeeId,
              displayName: names.get(employeeId) ?? '',
              checkedIn: checkedIn.get(employeeId) ?? false,
            }))
            .sort(
              (a, b) => a.displayName.localeCompare(b.displayName, 'vi') || (a.id < b.id ? -1 : 1),
            ),
        })),
      };
    });
  }

  async create(
    token: string | undefined,
    branchId: string,
    body: WalkInCreateRequest,
    requestId?: string,
  ): Promise<WalkInVisitResponse> {
    const id = this.branch(branchId);
    const request = normalizeWalkIn(body);
    return this.run(token, requestId, async (context) => {
      this.check(context.actor.graph, id);
      const created = await createWalkIn(context, id, request);
      return walkInVisit(context.tx, created.visitId, created.waitReasons);
    });
  }

  async assign(
    token: string | undefined,
    visitId: string,
    participantId: string,
    requestId?: string,
  ): Promise<WalkInVisitResponse> {
    if (!UUID.test(visitId) || !UUID.test(participantId)) throw new AuthError('NOT_FOUND');
    return this.run(token, requestId, async (context) => {
      const result = await assignWaitingSequence(
        context,
        visitId.toLowerCase(),
        participantId.toLowerCase(),
        (branchId) => this.check(context.actor.graph, branchId),
      );
      return walkInVisit(
        context.tx,
        visitId.toLowerCase(),
        new Map([[participantId.toLowerCase(), result.waitReason]]),
      );
    });
  }

  async changeIntent(
    token: string | undefined,
    visitId: string,
    lineId: string,
    body: WalkInIntentRequest,
    requestId?: string,
  ): Promise<WalkInVisitResponse> {
    if (!UUID.test(visitId) || !UUID.test(lineId)) throw new AuthError('NOT_FOUND');
    const requested = body.requestedEmployeeUserId;
    if (requested !== null && (typeof requested !== 'string' || !UUID.test(requested))) {
      throw new AuthError('VALIDATION_FAILED', 'requestedEmployeeUserId');
    }
    return this.run(token, requestId, async (context) => {
      await changeWaitingIntent(
        context,
        visitId.toLowerCase(),
        lineId.toLowerCase(),
        requested?.toLowerCase() ?? null,
        (branchId) => this.check(context.actor.graph, branchId),
      );
      return walkInVisit(context.tx, visitId.toLowerCase());
    });
  }

  /** Cancels a waiting walk-in whose customer left before any service started (reason required). */
  async cancel(
    token: string | undefined,
    visitId: string,
    body: { reason?: unknown },
    requestId?: string,
  ): Promise<WalkInVisitResponse> {
    if (!UUID.test(visitId)) throw new AuthError('NOT_FOUND');
    const reason = typeof body.reason === 'string' ? body.reason.normalize('NFC').trim() : '';
    if (!reason || [...reason].length > 500) throw new AuthError('VALIDATION_FAILED', 'reason');
    return this.run(token, requestId, async (context) => {
      await cancelWaitingWalkIn(context, visitId.toLowerCase(), reason, (branchId) =>
        this.check(context.actor.graph, branchId),
      );
      return walkInVisit(context.tx, visitId.toLowerCase());
    });
  }

  private branch(branchId: string): string {
    if (!UUID.test(branchId)) throw new AuthError('NOT_FOUND');
    return branchId.toLowerCase();
  }

  private check(graph: AdminContext['actor']['graph'], branchId: string): void {
    if (!decide(graph, 'MANAGE_BOOKINGS', at(branchId))) throw new AuthError('FORBIDDEN');
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
