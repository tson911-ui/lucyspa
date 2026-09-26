import type { EmploymentClassification } from '@lucy-spa/contracts';
import { BOOKING_SETTINGS, isValidBookingSetting, type Prisma } from '@lucy-spa/database';
import {
  branchWindow,
  collaboratorWorkOnDate,
  coversWindow,
  parseWorkDate,
  type WorkWindow,
} from '../collaborator-work/collaborator-work.rules.js';
import { employeesOnApprovedLeave } from '../leave/leave.availability.js';
import type {
  AssignmentCheck,
  AvailabilityContext,
  AvailabilityExclusions,
  BookingSettingsSnapshot,
  EmployeeReason,
  EmployeeVerdict,
  PlannedLine,
  SequenceAtRequest,
  SequenceEvaluation,
  SequenceReason,
  SequenceRequest,
} from './availability.types.js';

/*
 * Structure: `loadAvailabilityFacts` reads every fact for one branch-local date in a fixed
 * number of set-based queries (no per-employee queries); `evaluateSequenceAt` is a pure
 * function of those facts and a start minute. Callers pass their own transaction client, so
 * the same code serves read-only lookups and the re-check inside a write transaction.
 *
 * Time: branch-local wall-clock minutes are mapped to instants by PostgreSQL in the branch's
 * IANA timezone (never the server or browser zone). Every interval is half-open [start, end),
 * exactly like the Step 2 `ktv_occupancies` ranges, so the engine and the database backstop
 * agree on adjacency.
 */

/** Minutes past local midnight the engine can map: closing (≤ 24:00) plus the maximum buffer. */
const MINUTE_SPAN = 1440 + 60;
const DAY_MS = 86_400_000;

// ------------------------------------------------------------------ settings

/**
 * The booking settings the engine consumes, read from the Step 2 registry (`app_settings`) in
 * the caller's transaction. A missing row falls back to the registry default; an invalid stored
 * value is an error, never silently replaced.
 */
export async function readAvailabilitySettings(
  tx: Prisma.TransactionClient,
): Promise<BookingSettingsSnapshot> {
  const keys = [
    'booking.maxAdvanceDays',
    'booking.slotIntervalMinutes',
    'booking.serviceBufferMinutes',
  ] as const;
  const rows = await tx.appSetting.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
  });
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const value = (key: (typeof keys)[number]): number => {
    const definition = BOOKING_SETTINGS.find((entry) => entry.key === key);
    if (!definition) throw new Error(`Unknown booking setting ${key}.`);
    const raw = stored.has(key) ? stored.get(key) : definition.defaultValue;
    if (!isValidBookingSetting(key, raw)) throw new Error(`Invalid stored booking setting ${key}.`);
    return raw as number;
  };
  return {
    maxAdvanceDays: value('booking.maxAdvanceDays'),
    slotIntervalMinutes: value('booking.slotIntervalMinutes'),
    serviceBufferMinutes: value('booking.serviceBufferMinutes'),
  };
}

// ------------------------------------------------------------------ facts

interface Interval {
  start: number;
  end: number;
}

interface ServiceFact {
  id: string;
  offered: boolean;
  durationMinutes: number;
  skillIds: Set<string>;
}

interface EmployeeFact {
  userId: string;
  accountActive: boolean;
  classification: EmploymentClassification | null;
  assigned: boolean;
  skillIds: Set<string>;
  onLeave: boolean;
  collaboratorWork: WorkWindow[];
  checkedIn: boolean;
  /** Planned occupancy of other lines and ended executions, as epoch-ms half-open intervals. */
  occupied: Interval[];
  /**
   * Unended executions: occupied from their start with no end (`end = Infinity`) until END or
   * a manager resolution is recorded, even past the expected end. Nothing ends them (no auto-END).
   */
  running: Interval[];
}

export interface AvailabilityFacts {
  context: AvailabilityContext;
  now: number;
  serviceDate: string;
  today: string;
  branchActive: boolean;
  window: WorkWindow | null;
  settings: BookingSettingsSnapshot;
  services: ServiceFact[];
  employees: EmployeeFact[];
  customerBookings: Interval[];
  /** Epoch ms of each branch-local minute 0..MINUTE_SPAN of the date (DST-safe). */
  minuteInstants: number[];
}

const uniqueSorted = (ids: readonly string[]) => [...new Set(ids)].sort();

export async function loadAvailabilityFacts(
  tx: Prisma.TransactionClient,
  request: SequenceRequest,
): Promise<AvailabilityFacts> {
  if (request.serviceIds.length === 0) throw new Error('A sequence needs at least one service.');
  const date = parseWorkDate(request.serviceDate, 'serviceDate');
  const branch = await tx.branch.findUnique({
    where: { id: request.branchId },
    select: { id: true, timezone: true, isActive: true },
  });
  if (!branch) throw new Error('Unknown branch.');

  const [clock] = await tx.$queryRaw<{ today: string; instants: number[] }[]>`
    SELECT
      to_char(${request.now}::timestamptz AT TIME ZONE ${branch.timezone}, 'YYYY-MM-DD') AS today,
      (SELECT array_agg(
          (extract(epoch FROM ((${date}::date + make_interval(mins => m)) AT TIME ZONE ${branch.timezone})) * 1000)::float8
          ORDER BY m)
        FROM generate_series(0, ${MINUTE_SPAN}) AS m) AS instants`;
  if (!clock) throw new Error('Branch clock unavailable.');
  const minuteInstants = clock.instants;
  const dayFrom = new Date(minuteInstants[0] ?? 0);
  const dayTo = new Date(minuteInstants[MINUTE_SPAN] ?? 0);

  const settings = await readAvailabilitySettings(tx);
  const window = await branchWindow(tx, branch.id, date);

  const serviceIds = uniqueSorted(request.serviceIds);
  const serviceRows = await tx.service.findMany({
    where: { id: { in: serviceIds } },
    select: {
      id: true,
      isActive: true,
      durationMinutes: true,
      branches: { where: { branchId: branch.id }, select: { isActive: true } },
      eligibleSkills: { select: { skillId: true } },
    },
  });
  const serviceById = new Map(serviceRows.map((row) => [row.id, row]));
  const services: ServiceFact[] = request.serviceIds.map((id) => {
    const row = serviceById.get(id);
    return {
      id,
      offered: Boolean(row?.isActive && row.branches[0]?.isActive),
      durationMinutes: row?.durationMinutes ?? 0,
      skillIds: new Set(row?.eligibleSkills.map((skill) => skill.skillId) ?? []),
    };
  });

  // The pool: the requested employees, or everyone actively assigned at the branch.
  const pool = request.employeeUserIds
    ? uniqueSorted(request.employeeUserIds)
    : uniqueSorted(
        (
          await tx.employeeBranchAssignment.findMany({
            where: { branchId: branch.id, revokedAt: null },
            select: { employeeUserId: true },
          })
        ).map((row) => row.employeeUserId),
      );

  const exclusions: Required<AvailabilityExclusions> = {
    bookingServiceLineIds: request.exclude?.bookingServiceLineIds ?? [],
    visitServiceLineIds: request.exclude?.visitServiceLineIds ?? [],
    bookingId: request.exclude?.bookingId ?? '',
  };

  const skillIds = uniqueSorted(services.flatMap((service) => [...service.skillIds]));
  const [users, classifications, assignments, skills, onLeave, collaboratorWork, attendance] =
    await Promise.all([
      tx.user.findMany({
        where: { id: { in: pool } },
        select: { id: true, kind: true, status: true },
      }),
      // Same rule as `classificationOn`: the latest change effective on or before the date.
      tx.employmentClassificationChange.findMany({
        where: { employeeUserId: { in: pool }, effectiveDate: { lte: date } },
        orderBy: [{ employeeUserId: 'asc' }, { effectiveDate: 'desc' }],
        distinct: ['employeeUserId'],
        select: { employeeUserId: true, classification: true },
      }),
      tx.employeeBranchAssignment.findMany({
        where: { employeeUserId: { in: pool }, branchId: branch.id, revokedAt: null },
        select: { employeeUserId: true },
      }),
      tx.employeeSkill.findMany({
        where: { employeeUserId: { in: pool }, revokedAt: null, skillId: { in: skillIds } },
        select: { employeeUserId: true, skillId: true },
      }),
      employeesOnApprovedLeave(tx, pool, date),
      collaboratorWorkOnDate(tx, { employeeUserIds: pool, branchId: branch.id, workDate: date }),
      request.context === 'OPERATIONAL'
        ? tx.attendanceRecord.findMany({
            where: {
              employeeUserId: { in: pool },
              branchId: branch.id,
              businessDate: date,
              checkOutAt: null,
            },
            select: { employeeUserId: true },
          })
        : Promise.resolve([]),
    ]);

  // Occupancy comes from the authoritative line and execution state, never from the derived
  // `ktv_occupancies` backstop. Planned ranges mirror its [planned_start, planned_end + buffer).
  const occupancy = await tx.$queryRaw<
    { employee: string; kind: 'PLANNED' | 'ENDED' | 'RUNNING'; start: Date; until: Date }[]
  >`
    SELECT l.employee_user_id::text AS employee, 'PLANNED' AS kind, l.planned_start_at AS start,
           l.planned_end_at + make_interval(mins => l.buffer_minutes) AS until
    FROM booking_service_lines l JOIN bookings b ON b.id = l.booking_id
    WHERE b.status = 'CONFIRMED'
      AND l.employee_user_id = ANY(${pool}::uuid[])
      AND NOT (l.id = ANY(${exclusions.bookingServiceLineIds}::uuid[]))
      AND NOT EXISTS (SELECT 1 FROM visit_service_lines v WHERE v.booking_service_line_id = l.id)
      AND l.planned_start_at < ${dayTo} AND l.planned_end_at + make_interval(mins => l.buffer_minutes) > ${dayFrom}
    UNION ALL
    SELECT v.employee_user_id::text, 'PLANNED', v.planned_start_at,
           v.planned_end_at + make_interval(mins => v.buffer_minutes)
    FROM visit_service_lines v
    WHERE v.status IN ('PLANNED', 'IN_PROGRESS')
      AND v.employee_user_id = ANY(${pool}::uuid[])
      AND NOT (v.id = ANY(${exclusions.visitServiceLineIds}::uuid[]))
      AND v.planned_start_at < ${dayTo} AND v.planned_end_at + make_interval(mins => v.buffer_minutes) > ${dayFrom}
    UNION ALL
    SELECT x.employee_user_id::text, 'ENDED', x.started_at,
           x.ended_at + make_interval(mins => v.buffer_minutes)
    FROM service_executions x JOIN visit_service_lines v ON v.id = x.visit_service_line_id
    WHERE x.status = 'ENDED'
      AND x.employee_user_id = ANY(${pool}::uuid[])
      AND NOT (v.id = ANY(${exclusions.visitServiceLineIds}::uuid[]))
      AND x.started_at < ${dayTo} AND x.ended_at + make_interval(mins => v.buffer_minutes) > ${dayFrom}
    UNION ALL
    SELECT x.employee_user_id::text, 'RUNNING', x.started_at, x.started_at
    FROM service_executions x JOIN visit_service_lines v ON v.id = x.visit_service_line_id
    WHERE x.status = 'IN_PROGRESS'
      AND x.employee_user_id = ANY(${pool}::uuid[])
      AND NOT (v.id = ANY(${exclusions.visitServiceLineIds}::uuid[]))`;

  const customerBookings = request.customerUserId
    ? (
        await tx.booking.findMany({
          where: {
            ownerUserId: request.customerUserId,
            status: 'CONFIRMED',
            ...(exclusions.bookingId ? { id: { not: exclusions.bookingId } } : {}),
            startsAt: { lt: dayTo },
            endsAt: { gt: dayFrom },
          },
          select: { startsAt: true, endsAt: true },
        })
      ).map((row) => ({ start: row.startsAt.getTime(), end: row.endsAt.getTime() }))
    : [];

  const userById = new Map(users.map((row) => [row.id, row]));
  const classificationBy = new Map(
    classifications.map((row) => [row.employeeUserId, row.classification]),
  );
  const assigned = new Set(assignments.map((row) => row.employeeUserId));
  const checkedIn = new Set(attendance.map((row) => row.employeeUserId));
  const employees: EmployeeFact[] = pool.map((userId) => {
    const user = userById.get(userId);
    const mine = occupancy.filter((row) => row.employee === userId);
    const toInterval = (row: (typeof occupancy)[number]) => ({
      start: row.start.getTime(),
      end: row.until.getTime(),
    });
    return {
      userId,
      accountActive: user?.kind === 'EMPLOYEE' && user.status === 'ACTIVE',
      classification: classificationBy.get(userId) ?? null,
      assigned: assigned.has(userId),
      skillIds: new Set(
        skills.filter((row) => row.employeeUserId === userId).map((row) => row.skillId),
      ),
      onLeave: onLeave.has(userId),
      collaboratorWork: collaboratorWork.get(userId) ?? [],
      checkedIn: checkedIn.has(userId),
      occupied: mine.filter((row) => row.kind !== 'RUNNING').map(toInterval),
      running: mine
        .filter((row) => row.kind === 'RUNNING')
        .map((row) => ({ start: row.start.getTime(), end: Number.POSITIVE_INFINITY })),
    };
  });

  return {
    context: request.context,
    now: request.now.getTime(),
    serviceDate: request.serviceDate,
    today: clock.today,
    branchActive: branch.isActive,
    window,
    settings,
    services,
    employees,
    customerBookings,
    minuteInstants,
  };
}

// ------------------------------------------------------------------ pure evaluation

const overlapsInterval = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

const EMPLOYEE_REASON_ORDER: readonly EmployeeReason[] = [
  'EMPLOYEE_INACTIVE',
  'TRAINEE',
  'NOT_ASSIGNED',
  'NOT_QUALIFIED',
  'ON_LEAVE',
  'CTV_NOT_SCHEDULED',
  'NOT_CHECKED_IN',
  'SERVICE_RUNNING',
  'CONFLICT',
];

function employeeVerdict(
  facts: AvailabilityFacts,
  employee: EmployeeFact,
  service: ServiceFact,
  line: { startMinute: number; endMinute: number; occupancy: Interval },
): EmployeeVerdict {
  const reasons = new Set<EmployeeReason>();
  const classification = employee.classification;
  if (!employee.accountActive || classification === null || classification === 'ENDED') {
    reasons.add('EMPLOYEE_INACTIVE');
  }
  if (classification === 'TRAINEE') reasons.add('TRAINEE');
  if (!employee.assigned) reasons.add('NOT_ASSIGNED');
  if (![...service.skillIds].some((skillId) => employee.skillIds.has(skillId))) {
    reasons.add('NOT_QUALIFIED');
  }
  if (employee.onLeave) reasons.add('ON_LEAVE');
  if (
    classification === 'COLLABORATOR' &&
    !employee.collaboratorWork.some((occurrence) =>
      coversWindow(occurrence, { startMinute: line.startMinute, endMinute: line.endMinute }),
    )
  ) {
    reasons.add('CTV_NOT_SCHEDULED');
  }
  if (facts.context === 'OPERATIONAL' && !employee.checkedIn) reasons.add('NOT_CHECKED_IN');
  if (employee.running.some((interval) => overlapsInterval(interval, line.occupancy))) {
    reasons.add('SERVICE_RUNNING');
  }
  if (employee.occupied.some((interval) => overlapsInterval(interval, line.occupancy))) {
    reasons.add('CONFLICT');
  }
  const ordered = EMPLOYEE_REASON_ORDER.filter((reason) => reasons.has(reason));
  return { employeeUserId: employee.userId, eligible: ordered.length === 0, reasons: ordered };
}

/**
 * Evaluates the sequence starting at `startMinute` (branch-local). Timing (contract section 6):
 * line 1 starts at the start; line k+1 starts at line k's end plus the buffer; each line
 * occupies its KTV over [start, end + buffer). The last line must end by closing; its trailing
 * buffer may run past closing. The buffer is turnover time, never part of the service duration.
 */
export function evaluateSequenceAt(
  facts: AvailabilityFacts,
  startMinute: number,
): SequenceEvaluation {
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= 1440) {
    throw new Error('startMinute must be an integer minute of the day.');
  }
  const reasons = new Set<SequenceReason>();
  const buffer = facts.settings.serviceBufferMinutes;
  const unavailableServiceIndexes = facts.services
    .map((service, index) => (service.offered ? -1 : index))
    .filter((index) => index >= 0);

  let cursor = startMinute;
  const timings = facts.services.map((service) => {
    const lineStart = cursor;
    const lineEnd = lineStart + service.durationMinutes;
    cursor = lineEnd + buffer;
    return { lineStart, lineEnd };
  });
  const lastEnd = timings[timings.length - 1]?.lineEnd ?? startMinute;

  if (!facts.branchActive || facts.window === null) reasons.add('BRANCH_CLOSED');
  if (unavailableServiceIndexes.length > 0) reasons.add('SERVICE_UNAVAILABLE');
  if (
    facts.window &&
    (startMinute < facts.window.startMinute || lastEnd > facts.window.endMinute)
  ) {
    reasons.add('OUTSIDE_HOURS');
  }
  if (facts.context === 'BOOKING') {
    const ahead = (Date.parse(facts.serviceDate) - Date.parse(facts.today)) / DAY_MS;
    const startsAt = facts.minuteInstants[startMinute] ?? Number.NaN;
    if (ahead < 0 || ahead > facts.settings.maxAdvanceDays || !(startsAt >= facts.now)) {
      reasons.add('HORIZON');
    }
    if (
      facts.window &&
      (startMinute - facts.window.startMinute) % facts.settings.slotIntervalMinutes !== 0
    ) {
      reasons.add('INVALID_SLOT');
    }
  }
  if (facts.context === 'OPERATIONAL' && facts.serviceDate !== facts.today) {
    reasons.add('NOT_SAME_DAY');
  }

  const instant = (minute: number) => facts.minuteInstants[minute] ?? Number.NaN;
  const mappable = lastEnd + buffer <= MINUTE_SPAN;
  if (mappable && facts.customerBookings.length > 0) {
    const whole = { start: instant(startMinute), end: instant(lastEnd) };
    if (facts.customerBookings.some((booking) => overlapsInterval(booking, whole))) {
      reasons.add('CUSTOMER_CONFLICT');
    }
  }

  // Employees are evaluated only for a placeable sequence; otherwise nobody can take it.
  const placeable = reasons.size === 0 && mappable;
  const lines: PlannedLine[] = facts.services.map((service, index) => {
    const timing = timings[index] ?? { lineStart: startMinute, lineEnd: startMinute };
    const startsAt = instant(timing.lineStart);
    const endsAt = instant(timing.lineEnd);
    const occupiedUntil = instant(timing.lineEnd + buffer);
    const verdicts = placeable
      ? facts.employees.map((employee) =>
          employeeVerdict(facts, employee, service, {
            startMinute: timing.lineStart,
            endMinute: timing.lineEnd,
            occupancy: { start: startsAt, end: occupiedUntil },
          }),
        )
      : [];
    return {
      index,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      bufferMinutes: buffer,
      startMinute: timing.lineStart,
      endMinute: timing.lineEnd,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      occupiedUntil: new Date(occupiedUntil),
      verdicts,
      eligibleEmployeeUserIds: verdicts
        .filter((verdict) => verdict.eligible)
        .map((verdict) => verdict.employeeUserId),
    };
  });

  const wholeSequenceEmployeeUserIds = placeable
    ? facts.employees
        .map((employee) => employee.userId)
        .filter((userId) => lines.every((line) => line.eligibleEmployeeUserIds.includes(userId)))
    : [];
  const everyLineCovered =
    placeable && lines.every((line) => line.eligibleEmployeeUserIds.length > 0);
  const orderedReasons = (
    [
      'BRANCH_CLOSED',
      'SERVICE_UNAVAILABLE',
      'OUTSIDE_HOURS',
      'HORIZON',
      'INVALID_SLOT',
      'NOT_SAME_DAY',
      'CUSTOMER_CONFLICT',
    ] as const
  ).filter((reason) => reasons.has(reason));
  return {
    feasible: placeable && everyLineCovered,
    reasons: orderedReasons,
    unavailableServiceIndexes,
    lines,
    wholeSequenceEmployeeUserIds,
    everyLineCovered,
  };
}

// ------------------------------------------------------------------ transaction-compatible API

/** One sequence at one start: sequence reasons, per-line verdicts and whole-sequence candidates. */
export async function evaluateSequence(
  tx: Prisma.TransactionClient,
  request: SequenceAtRequest,
): Promise<SequenceEvaluation> {
  return evaluateSequenceAt(await loadAvailabilityFacts(tx, request), request.startMinute);
}

/**
 * Feasible starts of a sequence on one date, from opening on the slot grid (BOOKING) or on
 * every `stepMinutes` minute otherwise. One fact load; each start is evaluated in memory. A
 * start is listed when every line has an eligible employee; whether one employee can take the
 * whole sequence is reported, but choosing the assignment is Step 4.
 */
export async function feasibleStarts(
  tx: Prisma.TransactionClient,
  request: SequenceRequest & { stepMinutes?: number },
): Promise<{ startMinute: number; singleEmployeeAvailable: boolean }[]> {
  const facts = await loadAvailabilityFacts(tx, request);
  if (!facts.window) return [];
  const step =
    request.context === 'BOOKING' ? facts.settings.slotIntervalMinutes : (request.stepMinutes ?? 1);
  const starts: { startMinute: number; singleEmployeeAvailable: boolean }[] = [];
  for (let minute = facts.window.startMinute; minute < facts.window.endMinute; minute += step) {
    const result = evaluateSequenceAt(facts, minute);
    if (result.feasible) {
      starts.push({
        startMinute: minute,
        singleEmployeeAvailable: result.wholeSequenceEmployeeUserIds.length > 0,
      });
    }
  }
  return starts;
}

/**
 * Re-check of a proposed assignment (one employee per line, in order) inside the caller's
 * transaction, immediately before the write. Only the proposed employees are loaded. Pass the
 * lines being replaced in `exclude` so they do not conflict with themselves.
 */
export async function validateAssignment(
  tx: Prisma.TransactionClient,
  request: SequenceAtRequest & { assignments: readonly string[] },
): Promise<AssignmentCheck> {
  if (request.assignments.length !== request.serviceIds.length) {
    throw new Error('One employee per service line is required.');
  }
  const evaluation = await evaluateSequence(tx, {
    ...request,
    employeeUserIds: request.assignments,
  });
  const lines = request.assignments.map((employeeUserId, index) => {
    const verdict = evaluation.lines[index]?.verdicts.find(
      (entry) => entry.employeeUserId === employeeUserId,
    );
    return {
      index,
      employeeUserId,
      eligible: verdict?.eligible ?? false,
      reasons: verdict?.reasons ?? [],
    };
  });
  return {
    valid: evaluation.reasons.length === 0 && lines.every((line) => line.eligible),
    reasons: evaluation.reasons,
    lines,
  };
}

/**
 * The deterministic lock order of contract section 16 for a later write: the employee `users`
 * rows (and the customer row) `FOR UPDATE`, sorted by UUID, before `validateAssignment`.
 * Taking these locks is the caller's write-transaction responsibility (Step 4+); a read-only
 * lookup never reserves capacity.
 */
export async function lockAvailabilitySubjects(
  tx: Prisma.TransactionClient,
  userIds: readonly string[],
): Promise<void> {
  const ids = uniqueSorted(userIds);
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM users WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}
