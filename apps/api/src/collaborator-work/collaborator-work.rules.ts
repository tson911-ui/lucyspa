import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';

/** "HH:MM" on the branch-local work date; "24:00" is allowed as an end (midnight close). */
const TIME = /^(?:([01][0-9]|2[0-3]):([0-5][0-9])|(24):(00))$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const VND = /^(?:0|[1-9][0-9]{0,17})$/;

export const COLLABORATOR_WORK_LIMITS = Object.freeze({
  noteMaxCodePoints: 500,
  reasonMaxCodePoints: 500,
  maxRangeDays: 62,
});

export function parseTime(value: string | undefined, field: string): number {
  const match = value === undefined ? null : TIME.exec(value);
  if (!match) throw new AuthError('VALIDATION_FAILED', field);
  const hours = Number(match[1] ?? match[3]);
  const minutes = Number(match[2] ?? match[4]);
  return hours * 60 + minutes;
}

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** A calendar date (YYYY-MM-DD) as a UTC-midnight Date; invalid dates are refused. */
export function parseWorkDate(value: string | undefined, field = 'workDate'): Date {
  if (value === undefined || !DATE.test(value)) throw new AuthError('VALIDATION_FAILED', field);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return date;
}

/** Integer VND carried as a decimal string and stored as bigint; never a float. */
export function parseAgreedPay(value: string | null | undefined): bigint | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || !VND.test(value)) {
    throw new AuthError('VALIDATION_FAILED', 'agreedPayVnd');
  }
  return BigInt(value);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekday(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

export interface WorkWindow {
  startMinute: number;
  endMinute: number;
}

/**
 * The branch's opening window for a calendar date (its weekday hours), or null when the
 * branch is closed that day or has no hours for it.
 */
export async function branchWindow(
  tx: Prisma.TransactionClient,
  branchId: string,
  workDate: Date,
): Promise<WorkWindow | null> {
  const hours = await tx.branchOperatingHours.findUnique({
    where: { branchId_isoWeekday: { branchId, isoWeekday: isoWeekday(workDate) } },
    select: { isClosed: true, opensAtMinute: true, closesAtMinute: true },
  });
  if (!hours || hours.isClosed || hours.opensAtMinute === null || hours.closesAtMinute === null) {
    return null;
  }
  return { startMinute: hours.opensAtMinute, endMinute: hours.closesAtMinute };
}

/** Half-open intervals [a, b) and [c, d) overlap. */
export function overlaps(a: WorkWindow, b: WorkWindow): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/**
 * Phase 3 booking contract (read-only). A COLLABORATOR can only be *potentially* available
 * at a branch for [startMinute, endMinute) on a branch-local date when a SCHEDULED
 * occurrence of theirs at that branch covers the whole window: SHIFT by its explicit
 * times, FULL_DAY by its snapshotted window (later branch-hour changes never move it).
 * Returns that occurrence, or null. Booking must still check employment on the date, the
 * branch assignment, skills, account state, existing bookings and its own rules.
 * TRAINEE is not bookable; OFFICIAL_EMPLOYEE does not need occurrences.
 */
export async function collaboratorWorkCovering(
  tx: Prisma.TransactionClient,
  query: {
    employeeUserId: string;
    branchId: string;
    workDate: Date;
    startMinute: number;
    endMinute: number;
  },
): Promise<{
  id: string;
  mode: 'SHIFT' | 'FULL_DAY';
  startMinute: number;
  endMinute: number;
} | null> {
  if (query.startMinute >= query.endMinute) return null;
  return tx.collaboratorWorkOccurrence.findFirst({
    where: {
      employeeUserId: query.employeeUserId,
      branchId: query.branchId,
      workDate: query.workDate,
      status: 'SCHEDULED',
      startMinute: { lte: query.startMinute },
      endMinute: { gte: query.endMinute },
    },
    select: { id: true, mode: true, startMinute: true, endMinute: true },
  });
}

/**
 * The batched form of `collaboratorWorkCovering` for the availability engine: every SCHEDULED
 * occurrence of these employees at the branch on the date. A window is covered under the same
 * rule when `coversWindow` holds for one of them (the whole window, never a partial one).
 */
export async function collaboratorWorkOnDate(
  tx: Prisma.TransactionClient,
  query: { employeeUserIds: readonly string[]; branchId: string; workDate: Date },
): Promise<Map<string, WorkWindow[]>> {
  const byEmployee = new Map<string, WorkWindow[]>();
  if (query.employeeUserIds.length === 0) return byEmployee;
  const rows = await tx.collaboratorWorkOccurrence.findMany({
    where: {
      employeeUserId: { in: [...query.employeeUserIds] },
      branchId: query.branchId,
      workDate: query.workDate,
      status: 'SCHEDULED',
    },
    select: { employeeUserId: true, startMinute: true, endMinute: true },
  });
  for (const row of rows) {
    const list = byEmployee.get(row.employeeUserId) ?? [];
    list.push({ startMinute: row.startMinute, endMinute: row.endMinute });
    byEmployee.set(row.employeeUserId, list);
  }
  return byEmployee;
}

/** An occurrence covers the whole window (the `collaboratorWorkCovering` predicate). */
export function coversWindow(occurrence: WorkWindow, window: WorkWindow): boolean {
  return (
    window.startMinute < window.endMinute &&
    occurrence.startMinute <= window.startMinute &&
    occurrence.endMinute >= window.endMinute
  );
}

/**
 * Employment moved away from COLLABORATOR from `fromDate` (ENDED, or promotion): every
 * SCHEDULED occurrence on or after that date is cancelled in the caller's transaction,
 * kept as history and audited. Earlier occurrences are untouched. Returns the count.
 */
export async function cancelCollaboratorWorkFrom(
  tx: Prisma.TransactionClient,
  input: {
    employeeUserId: string;
    fromDate: Date;
    actorUserId: string;
    now: Date;
    reason: string;
    requestId: string | null;
  },
): Promise<number> {
  const affected = await tx.collaboratorWorkOccurrence.findMany({
    where: {
      employeeUserId: input.employeeUserId,
      status: 'SCHEDULED',
      workDate: { gte: input.fromDate },
    },
    select: { id: true, branchId: true, rowVersion: true, workDate: true },
  });
  for (const row of affected) {
    await tx.collaboratorWorkOccurrence.update({
      where: { id: row.id },
      data: {
        status: 'CANCELLED',
        cancelledByUserId: input.actorUserId,
        cancelledAt: input.now,
        cancelReason: input.reason,
        updatedByUserId: input.actorUserId,
        rowVersion: { increment: 1 },
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        action: 'COLLABORATOR_WORK_CANCELLED',
        actorKind: 'USER',
        actorUserId: input.actorUserId,
        subjectUserId: input.employeeUserId,
        entityType: 'CollaboratorWorkOccurrence',
        entityId: row.id,
        branchId: row.branchId,
        requestId: input.requestId,
        occurredAt: input.now,
        reason: input.reason,
        before: { status: 'SCHEDULED' },
        after: {
          status: 'CANCELLED',
          cause: 'EMPLOYMENT_CLASSIFICATION_CHANGED',
          workDate: row.workDate.toISOString().slice(0, 10),
        },
        dataClassification: 'STANDARD',
      },
      select: { id: true },
    });
  }
  return affected.length;
}
