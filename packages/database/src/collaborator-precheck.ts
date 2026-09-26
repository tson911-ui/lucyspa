import type { Prisma } from './generated/prisma/client.js';

export interface CollaboratorPrecheckFinding {
  employee_code: string;
  full_name: string;
  classification: string | null;
  detail: string;
}

/**
 * Read-only findings that would violate the follow-up Step 2 rules in existing data:
 * active manager-group roles held by members who are not OFFICIAL_EMPLOYEE today, and base
 * salaries on members whose latest classification is not OFFICIAL_EMPLOYEE.
 */
export async function collaboratorPrecheck(tx: Prisma.TransactionClient): Promise<{
  managers: CollaboratorPrecheckFinding[];
  salaries: CollaboratorPrecheckFinding[];
}> {
  // "Today" per employee: the latest local date among their active branches (UTC
  // without one), exactly as the API computes it.
  const managers = await tx.$queryRaw<CollaboratorPrecheckFinding[]>`
    WITH today AS (
      SELECT ep.user_id, COALESCE(
        (SELECT MAX(to_char(now() AT TIME ZONE b.timezone, 'YYYY-MM-DD'))
           FROM employee_branch_assignments a JOIN branches b ON b.id = a.branch_id
           WHERE a.employee_user_id = ep.user_id AND a.revoked_at IS NULL),
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'))::date AS day
      FROM employee_profiles ep
    )
    SELECT ep.employee_code_canonical AS employee_code, u.full_name,
      (SELECT c.classification::text FROM employment_classification_changes c
        WHERE c.employee_user_id = ep.user_id AND c.effective_date <= t.day
        ORDER BY c.effective_date DESC LIMIT 1) AS classification,
      string_agg(DISTINCT r.code, ', ') AS detail
    FROM employee_profiles ep
    JOIN users u ON u.id = ep.user_id
    JOIN today t ON t.user_id = ep.user_id
    JOIN user_role_assignments ura ON ura.user_id = ep.user_id
    JOIN roles r ON r.id = ura.role_id AND r.is_active AND r.is_manager_group
    GROUP BY ep.user_id, ep.employee_code_canonical, u.full_name, t.day
    HAVING (SELECT c.classification::text FROM employment_classification_changes c
        WHERE c.employee_user_id = ep.user_id AND c.effective_date <= t.day
        ORDER BY c.effective_date DESC LIMIT 1) IS DISTINCT FROM 'OFFICIAL_EMPLOYEE'
    ORDER BY 1`;
  const salaries = await tx.$queryRaw<CollaboratorPrecheckFinding[]>`
    SELECT ep.employee_code_canonical AS employee_code, u.full_name,
      (SELECT c.classification::text FROM employment_classification_changes c
        WHERE c.employee_user_id = ep.user_id ORDER BY c.effective_date DESC LIMIT 1)
        AS classification,
      'base salary set' AS detail
    FROM employee_profiles ep JOIN users u ON u.id = ep.user_id
    WHERE ep.base_salary_vnd IS NOT NULL
      AND (SELECT c.classification::text FROM employment_classification_changes c
        WHERE c.employee_user_id = ep.user_id ORDER BY c.effective_date DESC LIMIT 1)
        IS DISTINCT FROM 'OFFICIAL_EMPLOYEE'
    ORDER BY 1`;
  return { managers, salaries };
}
