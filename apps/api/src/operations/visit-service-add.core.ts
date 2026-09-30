import type { AddedServiceLineResponse, WalkInOptionsResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { loadServiceOptions } from '../walkin/service-options.js';
import {
  assignWaitingSequence,
  requireRequestedEmployee,
  WALKIN_LIMITS,
} from '../walkin/walkin.core.js';
import { requirePerformer } from './service-execution.core.js';

/**
 * How the actor is allowed to add a service to a visit (Phase 3 design section 14, O8):
 * - DESK: `MANAGE_BOOKINGS` at the visit's branch ("add lines"); may name any qualified KTV;
 * - PERFORMER: `PERFORM_SERVICES` at the visit's branch ("add a service on behalf of the customer")
 *   for an employee who is active there AND is assigned to a (non-cancelled) line of this very visit,
 *   so no KTV can add services to a visit they are not serving. A performer may leave the KTV open
 *   (any qualified KTV) or choose themselves, never another KTV.
 * Neither permission grants any price authority: the request has no price and no quantity.
 */
export type AddServiceAuthority = 'DESK' | 'PERFORMER';

async function authorizeAdd(
  context: AdminContext,
  visit: { id: string; branchId: string },
): Promise<AddServiceAuthority> {
  const { tx, actor } = context;
  if (decide(actor.graph, 'MANAGE_BOOKINGS', { kind: 'BRANCH', branchId: visit.branchId })) {
    return 'DESK';
  }
  await requirePerformer(context, visit.branchId);
  const serving = await tx.visitServiceLine.findFirst({
    where: {
      visitId: visit.id,
      employeeUserId: actor.userId,
      status: { in: ['PLANNED', 'IN_PROGRESS', 'DONE'] },
    },
    select: { id: true },
  });
  if (!serving) throw new AuthError('FORBIDDEN');
  return 'PERFORMER';
}

async function readVisit(tx: Prisma.TransactionClient, visitId: string) {
  const visit = await tx.visit.findUnique({
    where: { id: visitId },
    select: { id: true, code: true, branchId: true, status: true },
  });
  if (!visit) throw new AuthError('NOT_FOUND');
  return visit;
}

/** The add-service options for one open visit (services offered here, qualified KTVs for a desk actor). */
export async function addServiceOptions(
  context: AdminContext,
  visitId: string,
): Promise<WalkInOptionsResponse> {
  const visit = await readVisit(context.tx, visitId);
  const authority = await authorizeAdd(context, visit);
  if (visit.status !== 'OPEN' && visit.status !== 'IN_SERVICE') {
    throw new AuthError('VISIT_LINE_ADD_NOT_ALLOWED');
  }
  const options = await loadServiceOptions(context.tx, visit.branchId, context.now);
  return authority === 'DESK'
    ? options
    : { ...options, services: options.services.map((service) => ({ ...service, employees: [] })) };
}

const lineInclude = {
  employee: { select: { user: { select: { fullName: true } } } },
  addRequest: { select: { id: true } },
} satisfies Prisma.VisitServiceLineInclude;

async function present(
  tx: Prisma.TransactionClient,
  lineId: string,
  visit: { id: string; code: string },
  waitReason: AddedServiceLineResponse['waitReason'],
  replayed: boolean,
): Promise<AddedServiceLineResponse> {
  const line = await tx.visitServiceLine.findUniqueOrThrow({
    where: { id: lineId },
    include: lineInclude,
  });
  return {
    lineId: line.id,
    visitId: visit.id,
    visitCode: visit.code,
    participantId: line.participantId,
    sequence: line.sequence,
    status: line.status === 'WAITING' ? 'WAITING' : 'PLANNED',
    assignmentMode: line.assignmentMode,
    employee:
      line.employeeUserId && line.employee
        ? { id: line.employeeUserId, displayName: line.employee.user.fullName }
        : null,
    plannedStartAt: line.plannedStartAt?.toISOString() ?? null,
    plannedEndAt: line.plannedEndAt?.toISOString() ?? null,
    waitReason,
    replayed,
  };
}

/**
 * Adds ONE catalog service to an existing OPEN or IN_SERVICE visit, on behalf of the customer
 * (PRD 13.5), as a real visit service line that then follows the ordinary lifecycle (assignment,
 * START/END, Step 2 cancellation, shared completion rule). Nothing else is created: no invoice,
 * price, quantity or payment.
 *
 * - Source: an active catalog service offered (active) at the visit's branch, snapshotted like any
 *   other line (code, names, duration, catalog min/max price and unit: the reference range that a
 *   later invoice may use, never a billing amount). No free-form name, price or quantity exists in
 *   the request. A visit line is one performed service; the per-service quantity limit (OP-1) is
 *   introduced with the invoice foundation and applies to the invoice line, not here.
 * - Visit state: only OPEN or IN_SERVICE; a COMPLETED or CANCELLED visit is never reopened.
 * - Lifecycle: the line is created WAITING (intent ANY, or SPECIFIC with the requested KTV), marked
 *   `added_on_behalf` with the actor and the server time, and gets ONE immediate assignment attempt
 *   through the existing Phase 3 initial-assignment machinery (`assignWaitingSequence`: the
 *   OPERATIONAL availability engine, KTV row locks, the planner and the occupancy exclusion
 *   backstop). No capacity keeps it WAITING for the existing operational flow; it is never an error.
 *   An open line keeps the visit from completing (the shared rule counts WAITING/PLANNED/IN_PROGRESS).
 * - Serialization: the visit row is locked FOR UPDATE, the same row START/END (NOWAIT), Step 2
 *   cancellation (NOWAIT), walk-in assignment and completion take, so adding races with completion,
 *   cancellation and other adds are serialized and re-checked; KTV time is guarded by the engine
 *   re-read under KTV locks plus the database exclusion constraint.
 * - Idempotency: a client UUID unique per actor, stored append-only; a replay returns the same line
 *   with no second line, audit or event; reusing a key for a different request is a conflict.
 * - Audit VISIT_LINE_ADDED (STANDARD); the assignment writes its own VISIT_LINE_ASSIGNED audit and
 *   VISIT_LINE_SCHEDULED event (the existing event, which schedules the warnings). No other event.
 */
export async function addVisitServiceLine(
  context: AdminContext,
  visitId: string,
  input: {
    participantId: string;
    serviceId: string;
    requestedEmployeeUserId: string | null;
    idempotencyKey: string;
  },
): Promise<AddedServiceLineResponse> {
  const { tx, now, actor } = context;
  const hint = await readVisit(tx, visitId);
  const authority = await authorizeAdd(context, hint);
  if (
    authority === 'PERFORMER' &&
    input.requestedEmployeeUserId !== null &&
    input.requestedEmployeeUserId !== actor.userId
  ) {
    throw new AuthError('FORBIDDEN');
  }

  const replay = async (): Promise<AddedServiceLineResponse | null> => {
    const earlier = await tx.visitLineAddRequest.findUnique({
      where: {
        actorUserId_idempotencyKey: {
          actorUserId: actor.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { visitServiceLine: true },
    });
    if (!earlier) return null;
    const line = earlier.visitServiceLine;
    if (
      line.visitId !== visitId ||
      line.participantId !== input.participantId ||
      line.serviceId !== input.serviceId ||
      line.requestedEmployeeUserId !== input.requestedEmployeeUserId
    ) {
      throw new AuthError('CONFLICT');
    }
    return present(tx, line.id, hint, null, true);
  };
  const early = await replay();
  if (early) return early;

  await tx.$queryRaw`SELECT id FROM visits WHERE id = ${visitId}::uuid FOR UPDATE`;
  const visit = await readVisit(tx, visitId);
  const locked = await replay();
  if (locked) return locked;
  if (visit.status !== 'OPEN' && visit.status !== 'IN_SERVICE') {
    throw new AuthError('VISIT_LINE_ADD_NOT_ALLOWED');
  }
  const participant = await tx.visitParticipant.findFirst({
    where: { id: input.participantId, visitId },
    select: { id: true },
  });
  if (!participant) throw new AuthError('VALIDATION_FAILED', 'participantId');
  const service = await tx.service.findFirst({
    where: {
      id: input.serviceId,
      isActive: true,
      category: { isActive: true },
      branches: { some: { branchId: visit.branchId, isActive: true } },
    },
    select: {
      id: true,
      code: true,
      nameVi: true,
      nameEn: true,
      durationMinutes: true,
      priceVnd: true,
      priceMaxVnd: true,
      pricingUnit: true,
      maxQuantity: true,
      categoryId: true,
    },
  });
  if (!service) throw new AuthError('BOOKING_SERVICE_UNAVAILABLE');
  if (input.requestedEmployeeUserId) {
    await requireRequestedEmployee(tx, input.requestedEmployeeUserId, visit.branchId);
  }
  // Technical safety bound inherited from the walk-in architecture (Owner-approved), not a business policy.
  const open = await tx.visitServiceLine.count({
    where: { visitId, status: { not: 'CANCELLED' } },
  });
  if (open >= WALKIN_LIMITS.lines) throw new AuthError('VISIT_LINE_ADD_NOT_ALLOWED');
  const last = await tx.visitServiceLine.aggregate({
    where: { participantId: participant.id },
    _max: { sequence: true },
  });
  const sequence = (last._max.sequence ?? 0) + 1;

  const line = await tx.visitServiceLine.create({
    data: {
      visitId,
      participantId: participant.id,
      sequence,
      serviceId: service.id,
      status: 'WAITING',
      assignmentMode: input.requestedEmployeeUserId ? 'SPECIFIC' : 'ANY',
      requestedEmployeeUserId: input.requestedEmployeeUserId,
      durationMinutes: service.durationMinutes,
      serviceCode: service.code,
      serviceNameVi: service.nameVi,
      serviceNameEn: service.nameEn,
      catalogPriceMinVnd: service.priceVnd,
      catalogPriceMaxVnd: service.priceMaxVnd,
      catalogPricingUnit: service.pricingUnit,
      // OP-1: the per-service quantity limit is snapshotted with the other pricing inputs. The
      // visit line itself still has no quantity: one line is one performed service.
      maxQuantitySnapshot: service.maxQuantity,
      // Phase 4 Step 6: the category at this moment, for discount scope.
      serviceCategoryId: service.categoryId,
      addedOnBehalf: true,
      addedByUserId: actor.userId,
      addedAt: now,
    },
    select: { id: true },
  });
  await tx.visitLineAddRequest.create({
    data: {
      actorUserId: actor.userId,
      idempotencyKey: input.idempotencyKey,
      visitServiceLineId: line.id,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'VISIT_LINE_ADDED',
    entityType: 'VisitServiceLine',
    entityId: line.id,
    branchId: visit.branchId,
    after: {
      visitId,
      participantId: participant.id,
      sequence,
      serviceId: service.id,
      serviceCode: service.code,
      assignmentMode: input.requestedEmployeeUserId ? 'SPECIFIC' : 'ANY',
      requestedEmployeeUserId: input.requestedEmployeeUserId,
      durationMinutes: service.durationMinutes,
      catalogPriceMinVnd: service.priceVnd.toString(),
      catalogPriceMaxVnd: service.priceMaxVnd.toString(),
      catalogPricingUnit: service.pricingUnit,
      maxQuantitySnapshot: service.maxQuantity,
      serviceCategoryId: service.categoryId,
      addedOnBehalf: true,
      via: authority,
      visitStatus: visit.status,
      addedAt: now.toISOString(),
    },
  });
  // One immediate assignment attempt; waiting is a valid outcome, not a failure.
  const outcome = await assignWaitingSequence(context, visitId, participant.id, () => undefined);
  return present(tx, line.id, visit, outcome.waitReason, false);
}
