/**
 * Phase 3 Step 3: the authoritative Availability & Qualification Engine (design contract
 * section 5). Every later Phase 3 feature asks this engine; nothing re-implements its rules.
 * Reasons are stable machine codes, never UI text.
 */

/**
 * Why a requested sequence cannot be placed at all (independent of any employee).
 * - `BRANCH_CLOSED`: the branch is inactive, or closed on the date's weekday.
 * - `OUTSIDE_HOURS`: the first line starts before opening or the last line ends after closing.
 * - `SERVICE_UNAVAILABLE`: a service is inactive, unknown, or not offered at the branch.
 * - `HORIZON`: BOOKING context outside [branch-local today, today + booking.maxAdvanceDays],
 *   or a start in the past.
 * - `INVALID_SLOT`: BOOKING context start not on the booking.slotIntervalMinutes grid from opening.
 * - `NOT_SAME_DAY`: OPERATIONAL context for a date other than the branch-local today.
 * - `CUSTOMER_CONFLICT`: the customer already has a CONFIRMED booking overlapping the sequence.
 */
export type SequenceReason =
  | 'BRANCH_CLOSED'
  | 'OUTSIDE_HOURS'
  | 'SERVICE_UNAVAILABLE'
  | 'HORIZON'
  | 'INVALID_SLOT'
  | 'NOT_SAME_DAY'
  | 'CUSTOMER_CONFLICT';

/**
 * Why one employee cannot take one service line (reported in this fixed order).
 * - `EMPLOYEE_INACTIVE`: not an EMPLOYEE account, account not ACTIVE, or employment ENDED /
 *   not yet started on the date.
 * - `TRAINEE`: classified TRAINEE on the date (never bookable).
 * - `NOT_ASSIGNED`: no active branch assignment at the branch.
 * - `NOT_QUALIFIED`: the service's eligible skills and the employee's active skills do not intersect.
 * - `ON_LEAVE`: APPROVED leave covers the branch-local date (leave is whole-day).
 * - `CTV_NOT_SCHEDULED`: COLLABORATOR without a SCHEDULED occurrence at the branch covering
 *   the whole line interval.
 * - `NOT_CHECKED_IN`: OPERATIONAL context and no open attendance record at the branch today.
 * - `SERVICE_RUNNING`: the employee has an unended service execution that started before the
 *   line's occupancy ends. It occupies the employee from its start until END (or a manager
 *   resolution) is recorded, even past its expected end; nothing ends it automatically.
 * - `CONFLICT`: another occupying interval of the employee overlaps the line occupancy.
 */
export type EmployeeReason =
  | 'EMPLOYEE_INACTIVE'
  | 'TRAINEE'
  | 'NOT_ASSIGNED'
  | 'NOT_QUALIFIED'
  | 'ON_LEAVE'
  | 'CTV_NOT_SCHEDULED'
  | 'NOT_CHECKED_IN'
  | 'SERVICE_RUNNING'
  | 'CONFLICT';

/**
 * The caller states which rules apply; nothing is inferred from the clock.
 * - `BOOKING`: customer or desk scheduling. Horizon and slot grid apply; attendance never does (O6).
 * - `OPERATIONAL`: same-day walk-in, queue and "now" assignment, and the START eligibility check.
 *   The date must be the branch-local today and the employee must be checked in (O6).
 * - `REVALIDATION`: re-checking an already established sequence (for example a reassignment of a
 *   future line). No horizon, slot grid or attendance; every other rule applies.
 */
export type AvailabilityContext = 'BOOKING' | 'OPERATIONAL' | 'REVALIDATION';

export interface AvailabilityExclusions {
  /** Lines being re-validated or replaced; their own occupancy never conflicts with themselves. */
  bookingServiceLineIds?: readonly string[];
  visitServiceLineIds?: readonly string[];
  /** The customer's booking being re-validated (for CUSTOMER_CONFLICT). */
  bookingId?: string;
}

export interface SequenceRequest {
  branchId: string;
  /** Branch-local business date, `YYYY-MM-DD`. */
  serviceDate: string;
  /** The ordered services of the sequence (one line each). */
  serviceIds: readonly string[];
  context: AvailabilityContext;
  /** The evaluation instant (branch-local today, horizon, past starts). Always explicit. */
  now: Date;
  /** Evaluate only these employees (a specific KTV); default: everyone assigned at the branch. */
  employeeUserIds?: readonly string[];
  /** The booking owner, for the customer's own-overlap rule. */
  customerUserId?: string;
  exclude?: AvailabilityExclusions;
}

export interface SequenceAtRequest extends SequenceRequest {
  /** Branch-local minute of the day (0–1439) at which the first line starts. */
  startMinute: number;
}

export interface EmployeeVerdict {
  employeeUserId: string;
  eligible: boolean;
  reasons: EmployeeReason[];
}

export interface PlannedLine {
  index: number;
  serviceId: string;
  /** Snapshot values a later write stores on the line. */
  durationMinutes: number;
  bufferMinutes: number;
  startMinute: number;
  endMinute: number;
  startsAt: Date;
  endsAt: Date;
  /** End of KTV occupancy: `endsAt + bufferMinutes` (the Step 2 `[start, end + buffer)` range). */
  occupiedUntil: Date;
  /** Every evaluated employee, sorted by user id (deterministic; not a ranking). */
  verdicts: EmployeeVerdict[];
  eligibleEmployeeUserIds: string[];
}

export interface SequenceEvaluation {
  feasible: boolean;
  reasons: SequenceReason[];
  /** Indexes of the services behind SERVICE_UNAVAILABLE. */
  unavailableServiceIndexes: number[];
  lines: PlannedLine[];
  /**
   * Employees eligible for every line (the Q3 single-KTV candidates). Lines are chained with the
   * buffer, so per-line eligibility means continuous availability over the whole sequence.
   */
  wholeSequenceEmployeeUserIds: string[];
  /** Every line has at least one eligible employee (a split plan exists). */
  everyLineCovered: boolean;
}

export interface AssignmentCheck {
  valid: boolean;
  reasons: SequenceReason[];
  lines: { index: number; employeeUserId: string; eligible: boolean; reasons: EmployeeReason[] }[];
}

export interface BookingSettingsSnapshot {
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  serviceBufferMinutes: number;
}
