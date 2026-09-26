import type {
  EmployeeDirectoryGroup,
  EmploymentClassification,
  WorkforceTitle,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { businessToday, classificationOn, day } from './employment.js';

/**
 * The one authoritative workforce display title (Employee management follow-up Step 2).
 * Derived, never stored: kind, the classification in effect today and an active
 * manager-group role. A manager-group role only counts for an OFFICIAL_EMPLOYEE, so an
 * inconsistent legacy assignment is never shown as "Quản lý".
 */
export function workforceTitle(input: {
  owner: boolean;
  current: EmploymentClassification | null;
  manager: boolean;
}): WorkforceTitle {
  if (input.owner) return 'OWNER';
  switch (input.current) {
    case null:
      return 'NOT_STARTED';
    case 'ENDED':
      return 'ENDED';
    case 'OFFICIAL_EMPLOYEE':
      return input.manager ? 'MANAGER' : 'EMPLOYEE';
    case 'COLLABORATOR':
      return 'COLLABORATOR';
    case 'TRAINEE':
      return 'TRAINEE';
  }
}

/** An assignment of an active manager-group role (the management marker). */
export const MANAGER_ASSIGNMENT = {
  role: { isActive: true, isManagerGroup: true },
} satisfies Prisma.UserRoleAssignmentWhereInput;

export async function holdsManagerRole(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  return (await tx.userRoleAssignment.count({ where: { userId, ...MANAGER_ASSIGNMENT } })) > 0;
}

/** The classification in effect today for the employee's branches (null before the start). */
export async function currentClassification(
  tx: Prisma.TransactionClient,
  userId: string,
  branchIds: readonly string[],
): Promise<EmploymentClassification | null> {
  const today = await businessToday(tx, branchIds);
  return (await classificationOn(tx, userId, today))?.classification ?? null;
}

export async function titleOfEmployee(
  tx: Prisma.TransactionClient,
  userId: string,
  branchIds: readonly string[],
): Promise<WorkforceTitle> {
  const current = await currentClassification(tx, userId, branchIds);
  const manager = current === 'OFFICIAL_EMPLOYEE' && (await holdsManagerRole(tx, userId));
  return workforceTitle({ owner: false, current, manager });
}

/**
 * Directory section (four mutually exclusive groups). Current managers (OFFICIAL today with
 * an active manager-group role) are Managers. Everyone else is placed by the classification
 * in effect today, or, when ended or not yet started, by the last active or upcoming one, so
 * nobody disappears or is listed twice. Without any history: Employees.
 */
export function directoryGroupOf(
  changesNewestFirst: readonly { classification: EmploymentClassification; effectiveDate: Date }[],
  today: string,
  manager: boolean,
): EmployeeDirectoryGroup {
  const current = changesNewestFirst.find((row) => day(row.effectiveDate) <= today)?.classification;
  if (current === 'OFFICIAL_EMPLOYEE' && manager) return 'MANAGERS';
  const placed =
    current === undefined || current === 'ENDED'
      ? changesNewestFirst.find((row) => row.classification !== 'ENDED')?.classification
      : current;
  return GROUP_OF[placed ?? 'OFFICIAL_EMPLOYEE'];
}

const GROUP_OF: Record<EmploymentClassification, EmployeeDirectoryGroup> = {
  OFFICIAL_EMPLOYEE: 'EMPLOYEES',
  COLLABORATOR: 'COLLABORATORS',
  TRAINEE: 'TRAINEES',
  ENDED: 'EMPLOYEES',
};

/** The same rule as `directoryGroupOf`, evaluated in SQL for one group (ids only). */
export async function directoryGroupIds(
  tx: Prisma.TransactionClient,
  group: EmployeeDirectoryGroup,
  today: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ user_id: string }[]>`
    WITH placed AS (
      SELECT ep.user_id,
        (SELECT c.classification::text FROM employment_classification_changes c
          WHERE c.employee_user_id = ep.user_id AND c.effective_date <= ${today}::date
          ORDER BY c.effective_date DESC LIMIT 1) AS current,
        (SELECT c.classification::text FROM employment_classification_changes c
          WHERE c.employee_user_id = ep.user_id AND c.classification <> 'ENDED'
          ORDER BY c.effective_date DESC LIMIT 1) AS last_active,
        EXISTS (
          SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id = a.role_id
          WHERE a.user_id = ep.user_id AND r.is_active AND r.is_manager_group
        ) AS manager
      FROM employee_profiles ep
    )
    SELECT user_id FROM placed
    WHERE (CASE
      WHEN current = 'OFFICIAL_EMPLOYEE' AND manager THEN 'MANAGERS'
      ELSE CASE COALESCE(
          CASE WHEN current IS NULL OR current = 'ENDED' THEN last_active ELSE current END,
          'OFFICIAL_EMPLOYEE')
        WHEN 'COLLABORATOR' THEN 'COLLABORATORS'
        WHEN 'TRAINEE' THEN 'TRAINEES'
        ELSE 'EMPLOYEES'
      END
    END) = ${group}`;
  return rows.map((row) => row.user_id);
}
