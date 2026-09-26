import type { Prisma } from './generated/prisma/client.js';
import type {
  DataClassification,
  PermissionCode,
  ScopeCapability,
} from './generated/prisma/enums.js';

export interface PermissionDefinition {
  readonly code: PermissionCode;
  readonly scopeCapability: ScopeCapability;
  readonly dataClassification: DataClassification;
}

/**
 * Code-owned catalog (Phase 1 design section 7, extended in Phase 2). Every permission
 * is branch-capable except MANAGE_SERVICE_PRICES (GLOBAL_ONLY); only the two pay
 * permissions are EMPLOYEE_PAY data. Semantics are immutable in SQL.
 */
export const PERMISSION_CATALOG = Object.freeze([
  { code: 'VIEW_EMPLOYEES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'CREATE_EMPLOYEES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'UPDATE_EMPLOYEES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  {
    code: 'MANAGE_EMPLOYEE_STATUS',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  {
    code: 'MANAGE_EMPLOYEE_ACCESS',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  {
    code: 'MANAGE_EMPLOYEE_SCOPE',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  {
    code: 'VIEW_EMPLOYEE_PAY',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'EMPLOYEE_PAY',
  },
  {
    code: 'MANAGE_EMPLOYEE_PAY',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'EMPLOYEE_PAY',
  },
  { code: 'MANAGE_PERMISSIONS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'VIEW_AUDIT_LOG', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  // Phase 2. Catalog-wide actions (services, skills, branch creation) still require a
  // GLOBAL grant in the engine; branch grants cover per-branch operations only.
  { code: 'MANAGE_BRANCHES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'MANAGE_SERVICES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  // One price per service for every branch: never grantable at branch scope.
  {
    code: 'MANAGE_SERVICE_PRICES',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'STANDARD',
  },
  { code: 'MANAGE_SKILLS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'VIEW_ATTENDANCE', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'MANAGE_ATTENDANCE', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'APPROVE_LEAVE', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  // Follow-up Step 6: collaborator work schedule. Scheduling never grants pay: setting or
  // changing agreed pay also needs MANAGE_EMPLOYEE_PAY, seeing it VIEW_EMPLOYEE_PAY.
  {
    code: 'VIEW_WORK_SCHEDULE',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  {
    code: 'MANAGE_WORK_SCHEDULE',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
] as const satisfies readonly PermissionDefinition[]);

export interface PermissionCatalogSyncResult {
  readonly inserted: number;
  readonly unchanged: number;
}

export class PermissionCatalogMismatchError extends Error {
  constructor(readonly codes: readonly PermissionCode[]) {
    super(`Stored permission semantics differ from the code-owned catalog: ${codes.join(', ')}`);
    this.name = 'PermissionCatalogMismatchError';
  }
}

/**
 * Idempotent operator sync: inserts missing catalog rows and verifies existing ones.
 * It never updates or deletes a row; a semantic mismatch fails the whole transaction.
 */
export async function syncPermissionCatalog(
  transaction: Pick<Prisma.TransactionClient, 'permission'>,
): Promise<PermissionCatalogSyncResult> {
  const created = await transaction.permission.createMany({
    data: PERMISSION_CATALOG.map((entry) => ({ ...entry })),
    skipDuplicates: true,
  });
  const stored = await transaction.permission.findMany({
    select: { code: true, scopeCapability: true, dataClassification: true },
  });
  const byCode = new Map(stored.map((row) => [row.code, row]));
  const mismatched = PERMISSION_CATALOG.filter((entry) => {
    const row = byCode.get(entry.code);
    return (
      !row ||
      row.scopeCapability !== entry.scopeCapability ||
      row.dataClassification !== entry.dataClassification
    );
  }).map((entry) => entry.code);
  if (mismatched.length > 0 || stored.length !== PERMISSION_CATALOG.length) {
    throw new PermissionCatalogMismatchError(mismatched);
  }
  return { inserted: created.count, unchanged: PERMISSION_CATALOG.length - created.count };
}
