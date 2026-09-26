import type { SequenceEvaluation, SequenceReason } from '../availability/availability.types.js';

/** A requested line: its service and a specific KTV, or null for Any KTV. */
export interface PlanLine {
  serviceId: string;
  employeeUserId: string | null;
}

/**
 * Facts for the deterministic tie-break of contract section 6 (Owner-locked in Step 4):
 * 1. fewest booked minutes for that employee at that branch on that date;
 * 2. then earliest employee code;
 * 3. then user id.
 * Booked minutes = the sum of the duration snapshots (`duration_minutes`, never the buffer) of
 * the employee's lines on CONFIRMED or CHECKED_IN bookings at the same branch on the same
 * branch-local business date as the booking being planned. It exists only for this tie-break
 * (not payroll or any financial figure). The planner adds the minutes it has provisionally
 * assigned within the same new booking.
 */
export interface TieBreakFacts {
  bookedMinutes: ReadonlyMap<string, number>;
  employeeCode: ReadonlyMap<string, string>;
}

export type PlanFailure =
  | 'SERVICE_UNAVAILABLE'
  | 'OUTSIDE_HORIZON'
  | 'INVALID_TIME'
  | 'CUSTOMER_CONFLICT'
  | 'KTV_UNAVAILABLE'
  | 'NO_SUITABLE_KTV';

export type PlanOutcome =
  | { ok: true; assignments: { employeeUserId: string; mode: 'SPECIFIC' | 'ANY' }[] }
  | { ok: false; failure: PlanFailure };

/** Sequence reasons in a fixed precedence, mapped to one customer-facing outcome. */
export function sequenceFailure(reasons: readonly SequenceReason[]): PlanFailure | null {
  if (reasons.includes('SERVICE_UNAVAILABLE')) return 'SERVICE_UNAVAILABLE';
  if (reasons.includes('HORIZON') || reasons.includes('NOT_SAME_DAY')) return 'OUTSIDE_HORIZON';
  if (
    reasons.includes('BRANCH_CLOSED') ||
    reasons.includes('OUTSIDE_HOURS') ||
    reasons.includes('INVALID_SLOT')
  ) {
    return 'INVALID_TIME';
  }
  if (reasons.includes('CUSTOMER_CONFLICT')) return 'CUSTOMER_CONFLICT';
  return null;
}

/** Orders candidates by the section 6 tie-break; never random, never by role or UI order. */
export function compareByTieBreak(tie: TieBreakFacts) {
  return (a: string, b: string): number => {
    const minutes = (tie.bookedMinutes.get(a) ?? 0) - (tie.bookedMinutes.get(b) ?? 0);
    if (minutes !== 0) return minutes;
    const codeA = tie.employeeCode.get(a) ?? '';
    const codeB = tie.employeeCode.get(b) ?? '';
    if (codeA !== codeB) return codeA < codeB ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

/**
 * Assigns a KTV to every line (contract sections 6 and 7), from an engine evaluation of the
 * same sequence at the same start:
 * - a specific KTV is kept only if the engine finds them eligible for that line; it is never
 *   replaced (`KTV_UNAVAILABLE` instead);
 * - Any-KTV lines: single-KTV first, one employee eligible for every Any line, chosen by the
 *   tie-break;
 * - only when nobody can take all of them, line by line in order, preferring the previous
 *   line's employee, then the tie-break. A line with nobody eligible makes the start infeasible.
 * `allowed` limits Any-KTV candidates (the employees whose rows the write transaction locked).
 */
export function planAssignment(
  evaluation: SequenceEvaluation,
  lines: readonly PlanLine[],
  tie: TieBreakFacts,
  allowed?: ReadonlySet<string>,
): PlanOutcome {
  const failure = sequenceFailure(evaluation.reasons);
  if (failure) return { ok: false, failure };
  const eligible = (index: number): string[] =>
    (evaluation.lines[index]?.eligibleEmployeeUserIds ?? []).filter(
      (id) => !allowed || allowed.has(id),
    );
  const assigned: ({ employeeUserId: string; mode: 'SPECIFIC' | 'ANY' } | null)[] = lines.map(
    () => null,
  );
  // Workload = persisted booked minutes + minutes already given to them in this new booking.
  const workload = new Map(tie.bookedMinutes);
  const assign = (index: number, employeeUserId: string, mode: 'SPECIFIC' | 'ANY') => {
    assigned[index] = { employeeUserId, mode };
    workload.set(
      employeeUserId,
      (workload.get(employeeUserId) ?? 0) + (evaluation.lines[index]?.durationMinutes ?? 0),
    );
  };

  for (const [index, line] of lines.entries()) {
    if (line.employeeUserId === null) continue;
    if (!(evaluation.lines[index]?.eligibleEmployeeUserIds ?? []).includes(line.employeeUserId)) {
      return { ok: false, failure: 'KTV_UNAVAILABLE' };
    }
    assign(index, line.employeeUserId, 'SPECIFIC');
  }

  const anyIndexes = lines.flatMap((line, index) => (line.employeeUserId === null ? [index] : []));
  if (anyIndexes.length > 0) {
    // The comparator reads the live workload, so each decision sees earlier provisional ones.
    const order = compareByTieBreak({ bookedMinutes: workload, employeeCode: tie.employeeCode });
    const [first, ...rest] = anyIndexes.map(eligible);
    const everyAnyLine = (first ?? []).filter((id) => rest.every((set) => set.includes(id)));
    // Q3 first: one KTV for every Any line whenever anyone can; the tie-break only picks who.
    const single = [...everyAnyLine].sort(order)[0];
    if (single !== undefined) {
      for (const index of anyIndexes) assign(index, single, 'ANY');
    } else {
      for (const index of anyIndexes) {
        const candidates = eligible(index);
        if (candidates.length === 0) return { ok: false, failure: 'NO_SUITABLE_KTV' };
        const previous = index > 0 ? assigned[index - 1]?.employeeUserId : undefined;
        const chosen =
          previous !== undefined && candidates.includes(previous)
            ? previous
            : [...candidates].sort(order)[0];
        assign(index, chosen as string, 'ANY');
      }
    }
  }
  return {
    ok: true,
    assignments: assigned.map((entry) => {
      if (!entry) throw new Error('Every line is assigned.');
      return entry;
    }),
  };
}
