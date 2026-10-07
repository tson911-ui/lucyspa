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
 * is branch-capable except MANAGE_SERVICE_PRICES, MANAGE_BOOKING_SETTINGS, MANAGE_DISCOUNTS,
 * CREATE_VOUCHERS, MANAGE_WEBSITE_CONTENT and seven Phase 5 codes (GLOBAL_ONLY); the two pay permissions are EMPLOYEE_PAY data and
 * the nine Phase 4 financial permissions plus two Phase 5 codes are FINANCIAL data. Semantics are immutable in SQL.
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
  // Phase 3 Booking & Visits (design O8). Skills qualify KTVs; these codes authorize actions.
  { code: 'VIEW_BOOKINGS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'MANAGE_BOOKINGS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'MANAGE_QUEUE', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'REASSIGN_SERVICES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'PERFORM_SERVICES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  {
    code: 'RESOLVE_SERVICE_EXECUTION',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  // Booking settings are organization-wide (section 18): never grantable at branch scope.
  {
    code: 'MANAGE_BOOKING_SETTINGS',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'STANDARD',
  },
  // Organization hierarchy and team management (appended: catalog order is append-only).
  { code: 'VIEW_ORGANIZATION', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  {
    code: 'MANAGE_ORGANIZATION',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  {
    code: 'MANAGE_ORG_ASSIGNMENTS',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  { code: 'VIEW_TEAMS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'MANAGE_TEAMS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  // Phase 4 POS, Invoices & Payments (design Q9). FINANCIAL data; nothing is granted by default (the
  // Owner assigns them, never by role name). Only discount programs and voucher codes are
  // organization-wide (GLOBAL_ONLY in V1). CORRECT_PAYMENTS and cancelling a finalized invoice will
  // require fresh re-authentication when those actions exist (Steps 5 and 7); the codes alone do
  // nothing yet.
  { code: 'VIEW_INVOICES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'FINANCIAL' },
  { code: 'MANAGE_INVOICES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'FINANCIAL' },
  { code: 'COLLECT_PAYMENTS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'FINANCIAL' },
  { code: 'APPLY_DISCOUNTS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'FINANCIAL' },
  { code: 'MANAGE_DISCOUNTS', scopeCapability: 'GLOBAL_ONLY', dataClassification: 'FINANCIAL' },
  { code: 'CREATE_VOUCHERS', scopeCapability: 'GLOBAL_ONLY', dataClassification: 'FINANCIAL' },
  { code: 'CANCEL_INVOICES', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'FINANCIAL' },
  { code: 'CORRECT_PAYMENTS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'FINANCIAL' },
  { code: 'VIEW_REVENUE', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'FINANCIAL' },
  {
    code: 'MANAGE_WEBSITE_CONTENT',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'STANDARD',
  },
  // Phase 5 loyalty, referral, combos and rewards (design section 13, P5-T13). Nothing is granted by default.
  // Manual points, combo restoration, combo/birthday/catalog configuration and the exceptions list are
  // organization-wide (GLOBAL_ONLY); points adjustment and combo restoration are FINANCIAL data and will
  // require fresh re-authentication when those actions exist (P5-3, P5-8). The codes alone do nothing yet.
  { code: 'VIEW_LOYALTY', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  {
    code: 'ADJUST_LOYALTY_POINTS',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'FINANCIAL',
  },
  { code: 'MANAGE_REFERRALS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'MANAGE_COMBOS', scopeCapability: 'GLOBAL_ONLY', dataClassification: 'STANDARD' },
  { code: 'SELL_COMBOS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  {
    code: 'CONSUME_COMBO_SESSIONS',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  {
    code: 'RESTORE_COMBO_SESSIONS',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'FINANCIAL',
  },
  {
    code: 'MANAGE_BIRTHDAY_REWARDS',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'STANDARD',
  },
  {
    code: 'MANAGE_REWARD_CATALOG',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'STANDARD',
  },
  { code: 'ISSUE_REWARDS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  {
    code: 'VIEW_LOYALTY_EXCEPTIONS',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'STANDARD',
  },
  // P5-3: the loyalty go-live switch. Owner only: SQL refuses to attach it to any role or override.
  { code: 'ACTIVATE_LOYALTY', scopeCapability: 'GLOBAL_ONLY', dataClassification: 'STANDARD' },
  // P5-5: correcting a customer's referrer before the reward. Owner only, like the go-live switch.
  { code: 'CHANGE_REFERRER', scopeCapability: 'GLOBAL_ONLY', dataClassification: 'STANDARD' },
  // Phase 6 P6-2 (design PHASE6_PRODUCTS_INVENTORY_DESIGN.md section 9, P6-T24): products, inventory, product sales and returns.
  // Nothing is granted to anyone and none of them is Owner-only; the Owner grants them. The Wave 2 and 3 codes exist now so
  // the catalog stays one append-only list; the features that use them arrive with their Steps.
  { code: 'MANAGE_PRODUCTS', scopeCapability: 'GLOBAL_ONLY', dataClassification: 'STANDARD' },
  {
    code: 'MANAGE_PRODUCT_PRICES',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'FINANCIAL',
  },
  { code: 'VIEW_PRODUCT_COST', scopeCapability: 'GLOBAL_ONLY', dataClassification: 'FINANCIAL' },
  { code: 'VIEW_INVENTORY', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  {
    code: 'MANAGE_STOCK_RECEIPTS',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'FINANCIAL',
  },
  { code: 'ADJUST_STOCK', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  { code: 'IMPORT_PRODUCT_DATA', scopeCapability: 'GLOBAL_ONLY', dataClassification: 'FINANCIAL' },
  { code: 'SELL_PRODUCTS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'STANDARD' },
  {
    code: 'MANAGE_PRODUCT_RETURNS',
    scopeCapability: 'BRANCH_CAPABLE',
    dataClassification: 'STANDARD',
  },
  { code: 'REFUND_PRODUCTS', scopeCapability: 'BRANCH_CAPABLE', dataClassification: 'FINANCIAL' },
  {
    code: 'MANAGE_PRODUCT_CAMPAIGNS',
    scopeCapability: 'GLOBAL_ONLY',
    dataClassification: 'FINANCIAL',
  },
] as const satisfies readonly PermissionDefinition[]);

/** Codes that only the virtual Owner holds: no role and no override may carry them (SQL refuses too). */
export const OWNER_ONLY_PERMISSIONS: readonly string[] = Object.freeze([
  'ACTIVATE_LOYALTY',
  'CHANGE_REFERRER',
  // P5-6: the birthday gift configuration is the Owner's alone (Owner instruction 2026-10-04).
  'MANAGE_BIRTHDAY_REWARDS',
]);

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
