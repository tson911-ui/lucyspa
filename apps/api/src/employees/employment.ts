import type {
  EmploymentClassification,
  EmploymentClassificationEntry,
  InitialEmploymentClassification,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';

/**
 * Employment classification (Employee management Step 1). The append-only
 * `employment_classification_changes` history is authoritative: the classification on a
 * business date D is the change with the latest `effectiveDate <= D`. SQL additionally
 * guards ordering, transitions and immutability.
 */
export const INITIAL_CLASSIFICATIONS: readonly InitialEmploymentClassification[] = [
  'TRAINEE',
  'COLLABORATOR',
  'OFFICIAL_EMPLOYEE',
];

/** Allowed changes after an existing classification. Nothing follows ENDED (no rehire). */
const TRANSITIONS: Readonly<Record<EmploymentClassification, readonly EmploymentClassification[]>> =
  {
    TRAINEE: ['COLLABORATOR', 'OFFICIAL_EMPLOYEE', 'ENDED'],
    // Never back from official to collaborator (Owner decision Q1).
    COLLABORATOR: ['OFFICIAL_EMPLOYEE', 'ENDED'],
    OFFICIAL_EMPLOYEE: ['ENDED'],
    ENDED: [],
  };

export function transitionAllowed(
  from: EmploymentClassification,
  to: EmploymentClassification,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Fixed/base salary payroll: official employment only. Collaborators are paid per scheduled
 * occurrence (a later step); trainees and ended employment are not paid.
 */
export function payrollEligible(classification: EmploymentClassification | null): boolean {
  return classification === 'OFFICIAL_EMPLOYEE';
}

const DAY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** A real calendar date `YYYY-MM-DD` (years 2000–2100) as a date-only value. */
export function parseEmploymentDate(value: string, field: string): Date {
  const match = DAY.exec(value);
  const date = match ? new Date(`${value}T00:00:00.000Z`) : null;
  if (
    !match ||
    !date ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    Number(match[1]) < 2000 ||
    Number(match[1]) > 2100
  ) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return date;
}

export const day = (date: Date) => date.toISOString().slice(0, 10);

export const classificationSelect = {
  classification: true,
  effectiveDate: true,
  reason: true,
  recordedByUserId: true,
  recordedAt: true,
} satisfies Prisma.EmploymentClassificationChangeSelect;

type ClassificationRow = Prisma.EmploymentClassificationChangeGetPayload<{
  select: typeof classificationSelect;
}>;

export function presentClassification(row: ClassificationRow): EmploymentClassificationEntry {
  return {
    classification: row.classification,
    effectiveDate: day(row.effectiveDate),
    reason: row.reason,
    recordedByUserId: row.recordedByUserId,
    recordedAt: row.recordedAt.toISOString(),
  };
}

/** The classification in effect on `date` (a date-only value), or null before the start. */
export async function classificationOn(
  tx: Prisma.TransactionClient,
  employeeUserId: string,
  date: Date,
): Promise<ClassificationRow | null> {
  return tx.employmentClassificationChange.findFirst({
    where: { employeeUserId, effectiveDate: { lte: date } },
    orderBy: { effectiveDate: 'desc' },
    select: classificationSelect,
  });
}

export function classificationHistory(
  tx: Prisma.TransactionClient,
  employeeUserId: string,
): Promise<ClassificationRow[]> {
  return tx.employmentClassificationChange.findMany({
    where: { employeeUserId },
    orderBy: { effectiveDate: 'asc' },
    select: classificationSelect,
  });
}

/**
 * Today's business date for an employee: the latest local calendar date among the timezones
 * of the employee's active branches (UTC when the employee has none), computed by the
 * database clock. Taking the latest date means a date that is already "yesterday" in any of
 * the employee's branches counts as the past, so backdating is never under-detected.
 */
export async function businessToday(
  tx: Prisma.TransactionClient,
  branchIds: readonly string[],
): Promise<Date> {
  const rows = await tx.$queryRaw<{ today: string }[]>`
    SELECT COALESCE(
      MAX(to_char(now() AT TIME ZONE b.timezone, 'YYYY-MM-DD')),
      to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    ) AS today
    FROM (SELECT timezone FROM branches WHERE id = ANY(${[...branchIds]}::uuid[])) b`;
  const value = rows[0]?.today;
  if (!value) throw new Error('Business date unavailable.');
  return new Date(`${value}T00:00:00.000Z`);
}
