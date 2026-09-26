/** Public, transport-only contracts. No ORM, Node runtime or domain implementation exports. */
export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  checks?: { database: 'up' | 'down'; redis: 'up' | 'down' };
}

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string | string[];
  requestId: string;
}

export interface AuthContextResponse {
  csrfToken: string;
  authenticated: boolean;
}

export type PreferredLocale = 'vi' | 'en';

/** POST /api/v1/auth/register. Role, kind, status and other fields are rejected. */
export interface RegisterCustomerRequest {
  fullName: string;
  /** Calendar date `YYYY-MM-DD`. */
  dateOfBirth: string;
  address: string;
  email: string;
  phone: string;
  password: string;
  locale: PreferredLocale;
}

/** Constant for real, duplicate, throttled and suppressed requests; not a delivery promise. */
export interface AcceptedFlowResponse {
  status: 'accepted';
  flowToken: string;
  codeLifetimeSeconds: 300;
  resendAfterSeconds: 60;
}

/** POST /api/v1/auth/activation/verify; success is 204 without a login cookie. */
export interface ActivationVerifyRequest {
  flowToken: string;
  otp: string;
}

export interface ChallengeResendRequest {
  flowToken: string;
}

export interface ChallengeResendResponse {
  status: 'accepted';
  resendAfterSeconds: 60;
}

/**
 * POST /api/v1/auth/login. CUSTOMER uses EMAIL. WORKFORCE uses EMAIL (Owner, or an
 * employee's verified email) or EMPLOYEE_ID. A credential in one realm grants nothing
 * in the other.
 */
export type LoginRequest =
  | { realm: 'CUSTOMER'; identifierType: 'EMAIL'; identifier: string; password: string }
  | {
      realm: 'WORKFORCE';
      identifierType: 'EMAIL' | 'EMPLOYEE_ID';
      identifier: string;
      password: string;
    };

/** POST /api/v1/auth/reauthenticate → 204 with a rotated cookie; refetch CSRF context. */
export interface ReauthenticateRequest {
  password: string;
}

/**
 * POST /api/v1/me/password → 204 with a rotated cookie; refetch CSRF context. The signed-in
 * Owner or employee changes their own password: the current password is verified, the new
 * one must pass the password policy and differ from it. Every other session is revoked; this
 * device continues on a new session. Identity comes from the session only.
 */
export interface SelfPasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * POST /api/v1/me/email/request → 202 AcceptedFlowResponse. Verified self-service email
 * change for the signed-in Owner or employee: the current password is required; the code is
 * sent ONLY to `newEmail`. The account's email does not change until verification.
 * Refusals: 401 AUTHENTICATION_FAILED (password), 400 `newEmail` / `newEmailUnchanged`,
 * 409 `email` (taken or reserved), 429.
 */
export interface EmailChangeRequest {
  currentPassword: string;
  newEmail: string;
}

/** POST /api/v1/me/email/resend → 204: a new code for the caller's own live flow. */
export interface EmailChangeResendRequest {
  flowToken: string;
}

/**
 * POST /api/v1/me/email/verify → 204 with a rotated session cookie (refetch the CSRF
 * context). The new address becomes the account's one verified email; every other session
 * is revoked. A wrong, expired, used or superseded code is 400 VERIFICATION_FAILED.
 */
export interface EmailChangeVerifyRequest {
  flowToken: string;
  otp: string;
}

export type AuthorizationScope = { kind: 'GLOBAL' } | { kind: 'BRANCH'; branchId: string };

/** The caller's own display hints only; customers have empty grant lists. */
export interface CurrentAccountResponse {
  id: string;
  kind: 'CUSTOMER' | 'EMPLOYEE' | 'OWNER';
  displayName: string;
  locale: PreferredLocale;
  authorization:
    | {
        version: number;
        grants: { permission: string; scope: AuthorizationScope }[];
        denies: { permission: string; scope: AuthorizationScope }[];
      }
    | { version: number; owner: true };
  /**
   * Owner and employees only (absent for customers): the stored recovery email and whether
   * it is verified. Workforce password recovery by email works only once it is verified.
   */
  recoveryEmail?: { address: string; verified: boolean } | null;
  /** Owner and employees only: the authoritative display title. */
  workforceTitle?: WorkforceTitle;
}

/** CUSTOMER recovers customers; WORKFORCE recovers the Owner and employees. */
export type PasswordResetRealm = 'CUSTOMER' | 'WORKFORCE';

/**
 * POST /api/v1/auth/password-reset/request → 202 AcceptedFlowResponse for every
 * well-formed request. A code is sent only to an ACTIVE account of that realm with a
 * verified email.
 */
export interface PasswordResetRequest {
  realm: PasswordResetRealm;
  email: string;
  locale: PreferredLocale;
}

/** POST /api/v1/auth/password-reset/complete → 204; all sessions revoked, log in again. */
export interface PasswordResetCompleteRequest {
  flowToken: string;
  otp: string;
  newPassword: string;
}

/**
 * POST /api/v1/auth/recovery-email/request takes an empty object from an authenticated
 * Owner/employee session reauthenticated within the fresh-proof window → 202
 * AcceptedFlowResponse for the stored, still unverified recovery email.
 *
 * POST /api/v1/auth/recovery-email/verify → 204 from the same authenticated User; marks
 * that stored email verified and changes nothing else.
 */
export interface RecoveryEmailVerifyRequest {
  flowToken: string;
  otp: string;
}

/** Employee lifecycle status. Owner and customers are never employee-administration targets. */
export type EmployeeStatus = 'PENDING_SETUP' | 'ACTIVE' | 'INACTIVE';

/**
 * POST /api/v1/employees → 201 EmployeeResponse. Creates only PENDING_SETUP. No password,
 * kind, status, verification flag or grant is accepted. `baseSalaryVnd` is a nonnegative
 * integer decimal string; omitting it stores null (unknown), never zero.
 */
export interface EmployeeCreateRequest {
  employeeId: string;
  fullName: string;
  /** Calendar date `YYYY-MM-DD`. */
  dateOfBirth: string;
  address: string;
  phone: string;
  /** Optional recovery email; stored unverified until the employee proves it. */
  email?: string | null;
  locale: PreferredLocale;
  branchIds: string[];
  baseSalaryVnd?: string | null;
  /**
   * Initial employment classification, chosen explicitly: TRAINEE or OFFICIAL_EMPLOYEE (an
   * official hire does not start as a trainee). OFFICIAL_EMPLOYEE creates payroll eligibility
   * and therefore also needs MANAGE_EMPLOYEE_PAY.
   */
  classification: InitialEmploymentClassification;
  /** Workforce start date `YYYY-MM-DD`: the effective date of the initial classification. */
  employmentStartDate: string;
  /** Required when the start date is before today's business date. */
  employmentReason?: string;
  /**
   * Optional initial workforce password (existing policy: 8–128 characters, not a common
   * password). When present the account is created ACTIVE and can sign in immediately with
   * the employee code; this additionally needs MANAGE_EMPLOYEE_ACCESS in every branch and a
   * fresh reauthentication of the creator. Without it the account stays PENDING_SETUP.
   */
  initialPassword?: string;
}

/**
 * Employment classification, separate from the account status (`EmployeeStatus`), roles,
 * branches and skills. Only OFFICIAL_EMPLOYEE is payroll-eligible:
 * - TRAINEE (Học viên): no salary, service/tour pay, commission or other payroll pay;
 * - OFFICIAL_EMPLOYEE (Nhân viên chính thức): payroll-eligible from its effective date;
 * - ENDED (Đã kết thúc làm việc/học việc): not payroll-eligible from its effective date.
 */
export type EmploymentClassification = 'TRAINEE' | 'COLLABORATOR' | 'OFFICIAL_EMPLOYEE' | 'ENDED';
export type InitialEmploymentClassification = 'TRAINEE' | 'COLLABORATOR' | 'OFFICIAL_EMPLOYEE';

/**
 * The one authoritative workforce display title, derived by the server (never stored):
 * OWNER "Chủ Spa"; MANAGER "Quản lý" (OFFICIAL_EMPLOYEE today with an active manager-group
 * role); EMPLOYEE "Nhân viên"; COLLABORATOR "CTV"; TRAINEE "Học viên"; NOT_STARTED
 * "Chưa bắt đầu" (start date in the future); ENDED "Đã nghỉ".
 */
export type WorkforceTitle =
  'OWNER' | 'MANAGER' | 'EMPLOYEE' | 'COLLABORATOR' | 'TRAINEE' | 'NOT_STARTED' | 'ENDED';

/** One append-only history entry. `recordedByUserId` is null only for migration backfill. */
export interface EmploymentClassificationEntry {
  classification: EmploymentClassification;
  /** Calendar date `YYYY-MM-DD`; the classification applies from this date on. */
  effectiveDate: string;
  reason: string | null;
  recordedByUserId: string | null;
  recordedAt: string;
}

/**
 * GET /api/v1/employees/:id/employment?date=YYYY-MM-DD. `history` is oldest first.
 * `current` is the classification in effect on today's business date (null before the start
 * date); `onDate` answers the optional `date` query. `version` is the employee version used as
 * `expectedVersion` for classification changes.
 */
export interface EmploymentResponse {
  employeeId: string;
  version: number;
  today: string;
  current: EmploymentClassificationEntry | null;
  onDate: { date: string; entry: EmploymentClassificationEntry | null } | null;
  payrollEligibleToday: boolean;
  /** Authoritative display title today (includes the manager-group role). */
  title: WorkforceTitle;
  history: EmploymentClassificationEntry[];
}

/**
 * POST /api/v1/employees/:id/employment: record a classification change with MANAGE_EMPLOYEE_PAY
 * at every branch of the employee (never for oneself unless Owner). Allowed: TRAINEE →
 * OFFICIAL_EMPLOYEE (promotion), TRAINEE → ENDED, OFFICIAL_EMPLOYEE → ENDED. The effective date
 * must be later than the latest change; an effective date before today's business date
 * (backdating) is Owner-only.
 */
export interface EmploymentClassificationChangeRequest {
  expectedVersion: number;
  classification: 'COLLABORATOR' | 'OFFICIAL_EMPLOYEE' | 'ENDED';
  effectiveDate: string;
  reason: string;
}

/**
 * The employee record visible to an authorized workforce actor. `baseSalaryVnd` is
 * present only when VIEW_EMPLOYEE_PAY passes for every branch of the employee.
 */
export interface EmployeeResponse {
  id: string;
  employeeId: string;
  fullName: string;
  dateOfBirth: string;
  address: string;
  phone: string;
  email: string | null;
  emailVerified: boolean;
  locale: PreferredLocale;
  status: EmployeeStatus;
  branchIds: string[];
  /** Optimistic-concurrency version; send it back as `expectedVersion`. */
  version: number;
  baseSalaryVnd?: string | null;
}

/**
 * GET /api/v1/employees?q&branchId&status&cursor&limit: the employee directory. Only
 * employees the caller may read under VIEW_EMPLOYEES (every active branch of the
 * employee; GLOBAL for an employee without one) are included, filtered before paging.
 * `q` matches the employee code or full name. Ordered by employee code; keyset cursor;
 * `limit` 1–100 (default 50). No contact, birth-date, address or pay data.
 */
export interface EmployeeDirectoryQuery {
  q?: string;
  branchId?: string;
  status?: EmployeeStatus;
  cursor?: string;
  limit?: number;
}

export interface EmployeeDirectoryEntry {
  id: string;
  employeeId: string;
  fullName: string;
  status: EmployeeStatus;
  branchIds: string[];
  version: number;
  /**
   * The latest recorded employment classification and the date it takes effect
   * (`YYYY-MM-DD`, possibly in the future for a new hire or scheduled change). Null only for
   * an employee without classification history.
   */
  classification: EmploymentClassification | null;
  classificationEffectiveDate: string | null;
  /** Authoritative display title today. */
  title: WorkforceTitle;
}

/**
 * Directory section (`group` query), four mutually exclusive groups: MANAGERS (OFFICIAL
 * today + active manager-group role), EMPLOYEES (other OFFICIAL), COLLABORATORS, TRAINEES.
 * Ended or not-yet-started members are placed by their last active or upcoming
 * classification.
 */
export type EmployeeDirectoryGroup = 'MANAGERS' | 'EMPLOYEES' | 'COLLABORATORS' | 'TRAINEES';

export interface EmployeeDirectoryResponse {
  items: EmployeeDirectoryEntry[];
  /** Keyset mode (no `page` query). */
  nextCursor: string | null;
  /** Numbered-page mode (`page` query): server-side offset over the scoped, filtered set. */
  page?: { number: number; size: number; total: number };
}

/**
 * POST /api/v1/employees/:id/profile (management) and POST /api/v1/me/account/profile
 * (self). Both write the same `users` / `employee_profiles` rows through one shared write
 * path. Email, login ID, classification, roles, branches, skills, status and pay are
 * excluded. `phone` is unique across all users (409 `phone` on a clash).
 */
export interface EmployeeProfileUpdateRequest {
  expectedVersion: number;
  fullName?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
  locale?: PreferredLocale;
}

/** Self-service profile update: the same allowlisted fields as the management command. */
export type MyAccountProfileUpdateRequest = EmployeeProfileUpdateRequest;

/**
 * GET /api/v1/me/account: the signed-in workforce account's own view over the same
 * authoritative rows employee detail reads (no copy). Identity comes from the session only.
 * The Owner has no employee profile: `employee` is null. No pay or authorization data.
 */
export interface MyAccountResponse {
  id: string;
  kind: 'OWNER' | 'EMPLOYEE';
  fullName: string;
  phone: string | null;
  /** The stored (recovery) email and whether it is verified; changed only by a later verified flow. */
  email: { address: string; verified: boolean } | null;
  locale: PreferredLocale;
  status: EmployeeStatus;
  /** Authoritative server-derived title (Step 2). */
  title: WorkforceTitle;
  employee: {
    employeeId: string;
    dateOfBirth: string;
    address: string;
    /** In effect today (null before the start date). */
    classification: EmploymentClassification | null;
    branches: { id: string; code: string; name: string }[];
    skills: { id: string; code: string; nameVi: string; nameEn: string }[];
  } | null;
  /** Optimistic-concurrency version shared with employee detail; send back as `expectedVersion`. */
  version: number;
}

/**
 * POST /api/v1/employees/:id/status. INACTIVE from ACTIVE/PENDING_SETUP; ACTIVE only from
 * INACTIVE, resulting in ACTIVE with a remaining credential, otherwise PENDING_SETUP.
 */
export interface EmployeeStatusChangeRequest {
  expectedVersion: number;
  status: 'ACTIVE' | 'INACTIVE';
  reason: string;
}

/** POST /api/v1/employees/:id/scope: the complete resulting branch membership set. */
export interface EmployeeScopeChangeRequest {
  expectedVersion: number;
  branchIds: string[];
  reason: string;
}

/** POST /api/v1/employees/:id/base-salary; null clears it to unknown. No payroll math. */
export interface EmployeeBaseSalaryRequest {
  expectedVersion: number;
  baseSalaryVnd: string | null;
  reason: string;
}

/** POST /api/v1/employees/:id/setup; requires fresh password reauthentication. */
/**
 * POST /api/v1/employees/:id/credentials: the Owner or an authorized manager sets or replaces
 * an employee's workforce password directly (no employee OTP). Needs MANAGE_EMPLOYEE_ACCESS in
 * every branch of the employee, fresh reauthentication and containment; never for oneself
 * (unless Owner), never for INACTIVE or ENDED employment. The account becomes ACTIVE, the
 * credential version increments and every existing session of the employee is revoked.
 */
export interface EmployeeCredentialsRequest {
  expectedVersion: number;
  newPassword: string;
  reason: string;
}

/**
 * POST /api/v1/employees/:id/end-employment ("Kết thúc làm việc"): appends ENDED to the
 * classification history (Step 1 rules) and, with `disableAccess` and an effective date of
 * today or earlier, sets the account INACTIVE in the same transaction. Nothing is deleted.
 * There is no scheduler: a future effective date never disables access automatically.
 */
export interface EmploymentEndRequest {
  expectedVersion: number;
  effectiveDate: string;
  reason: string;
  disableAccess: boolean;
}

/**
 * What happened to sign-in access: DISABLED now; ALREADY_INACTIVE; UNCHANGED (not requested);
 * UNCHANGED_FUTURE_DATE (requested, but the end date is in the future: access stays enabled
 * until someone disables it — nothing does this automatically).
 */
export type EmploymentEndAccess =
  'DISABLED' | 'ALREADY_INACTIVE' | 'UNCHANGED' | 'UNCHANGED_FUTURE_DATE';

export interface EmploymentEndResponse {
  employee: EmployeeResponse;
  employment: EmploymentResponse;
  access: EmploymentEndAccess;
}

export interface EmployeeSetupIssueRequest {
  expectedVersion: number;
  reason: string;
}

/** Returned once; hand over through the authorized secure channel. Never stored raw. */
export interface EmployeeSetupIssueResponse {
  setupToken: string;
  expiresAt: string;
}

/** POST /api/v1/auth/employee-setup/complete → 204; no login cookie, sign in normally. */
export interface EmployeeSetupCompleteRequest {
  setupToken: string;
  newPassword: string;
}

/** Code-owned Phase 1 permission catalog; any other code is rejected. */
export type PermissionCodeName =
  | 'VIEW_EMPLOYEES'
  | 'CREATE_EMPLOYEES'
  | 'UPDATE_EMPLOYEES'
  | 'MANAGE_EMPLOYEE_STATUS'
  | 'MANAGE_EMPLOYEE_ACCESS'
  | 'MANAGE_EMPLOYEE_SCOPE'
  | 'VIEW_EMPLOYEE_PAY'
  | 'MANAGE_EMPLOYEE_PAY'
  | 'MANAGE_PERMISSIONS'
  | 'VIEW_AUDIT_LOG'
  | 'MANAGE_BRANCHES'
  | 'MANAGE_SERVICES'
  | 'MANAGE_SERVICE_PRICES'
  | 'MANAGE_SKILLS'
  | 'VIEW_ATTENDANCE'
  | 'MANAGE_ATTENDANCE'
  | 'APPROVE_LEAVE'
  | 'VIEW_WORK_SCHEDULE'
  | 'MANAGE_WORK_SCHEDULE';

/** A named permission bundle. OWNER is virtual and never a role. */
export interface RoleResponse {
  id: string;
  code: string;
  displayNameVi: string;
  displayNameEn: string;
  isActive: boolean;
  /**
   * Members holding this role are listed under "Quản lý / Managers" in the employee
   * directory. Display grouping only: it grants no permission.
   */
  isManagerGroup: boolean;
  permissions: PermissionCodeName[];
  /** Send back as `expectedVersion`. */
  version: number;
}

/**
 * How a permission may be granted: BRANCH_CAPABLE (GLOBAL or per branch) or GLOBAL_ONLY
 * (never at branch scope). From the code-owned permission catalog.
 */
export type PermissionScopeCapability = 'BRANCH_CAPABLE' | 'GLOBAL_ONLY';

/** GET /api/v1/roles */
export interface RoleListResponse {
  roles: RoleResponse[];
  permissions: PermissionCodeName[];
  /** The same catalog with each permission's scope capability (read-only metadata). */
  permissionCatalog: { code: PermissionCodeName; scopeCapability: PermissionScopeCapability }[];
}

/** POST /api/v1/roles → 201 RoleResponse. */
export interface RoleCreateRequest {
  code: string;
  displayNameVi: string;
  displayNameEn: string;
  permissions: PermissionCodeName[];
  /** Directory grouping (default false). */
  isManagerGroup?: boolean;
  reason: string;
}

/** POST /api/v1/roles/:id → names and activation only; the code is immutable. */
export interface RoleUpdateRequest {
  expectedVersion: number;
  displayNameVi?: string;
  displayNameEn?: string;
  isActive?: boolean;
  isManagerGroup?: boolean;
  reason: string;
}

/** POST /api/v1/roles/:id/permissions → the complete resulting permission set. */
export interface RolePermissionsRequest {
  expectedVersion: number;
  permissions: PermissionCodeName[];
  reason: string;
}

/**
 * GET /api/v1/employees/:id/authorization. `version` is the employee's authorization
 * version, used as `expectedVersion` by assignment and override commands.
 */
export interface EmployeeAuthorizationResponse {
  userId: string;
  version: number;
  roleAssignments: { id: string; roleId: string; roleCode: string; scope: AuthorizationScope }[];
  overrides: {
    id: string;
    permission: PermissionCodeName;
    effect: 'ALLOW' | 'DENY';
    scope: AuthorizationScope;
  }[];
}

/** POST /api/v1/employees/:id/roles → 200 EmployeeAuthorizationResponse. */
export interface RoleAssignRequest {
  expectedVersion: number;
  roleId: string;
  scope: AuthorizationScope;
  reason: string;
}

/** POST /api/v1/employees/:id/roles/revoke */
export interface RoleRevokeRequest {
  expectedVersion: number;
  assignmentId: string;
  reason: string;
}

/** POST /api/v1/employees/:id/overrides: creates or changes the override at that scope. */
export interface PermissionOverrideSetRequest {
  expectedVersion: number;
  permission: PermissionCodeName;
  effect: 'ALLOW' | 'DENY';
  scope: AuthorizationScope;
  reason: string;
}

/** POST /api/v1/employees/:id/overrides/remove: removal restores inheritance. */
export interface PermissionOverrideRemoveRequest {
  expectedVersion: number;
  overrideId: string;
  reason: string;
}

/** One permitted audit record; before/after are per-action allowlisted snapshots. */
export interface AuditEventResponse {
  id: string;
  action: string;
  occurredAt: string;
  actorKind: 'USER' | 'BOOTSTRAP' | 'SYSTEM';
  actorUserId: string | null;
  subjectUserId: string | null;
  entityType: string;
  entityId: string;
  branchId: string | null;
  requestId: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  dataClassification: 'STANDARD' | 'EMPLOYEE_PAY';
}

/**
 * GET /api/v1/audit-events?limit&cursor&branchId&action&subjectUserId&actorUserId&
 * entityType&entityId&from&to. Newest first; scope filtering happens before paging.
 */
export interface AuditEventPageResponse {
  items: AuditEventResponse[];
  nextCursor: string | null;
}

/** Branch-local wall-clock time `HH:MM` (24-hour); `24:00` is allowed as a closing time. */
export type LocalTime = string;

/** One ISO weekday (1 = Monday ... 7 = Sunday) of a branch's regular operating hours. */
export interface BranchOperatingDay {
  isoWeekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  isClosed: boolean;
  /** Present only when open. */
  opensAt: LocalTime | null;
  closesAt: LocalTime | null;
}

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  /** IANA timezone; attendance business dates are computed in it. */
  timezone: string;
  isActive: boolean;
  /** Send back as `expectedVersion`. Covers the branch and its operating hours. */
  version: number;
}

/** GET /api/v1/branches/:id */
export interface BranchResponse extends BranchSummary {
  /**
   * Configured weekdays, Monday first. Branches created through the API always have all
   * seven; a branch created before Phase 2 (development seed) may have none until set.
   */
  hours: BranchOperatingDay[];
}

/** GET /api/v1/branches: only branches the caller may see. */
export interface BranchListResponse {
  branches: BranchSummary[];
}

/**
 * POST /api/v1/branches → 201 BranchResponse. Requires GLOBAL MANAGE_BRANCHES. The new
 * branch gets default hours of 09:00–21:00 every day, all editable afterwards.
 */
export interface BranchCreateRequest {
  code: string;
  name: string;
  /** Defaults to Asia/Ho_Chi_Minh. */
  timezone?: string;
  /** Defaults to true. */
  isActive?: boolean;
  reason?: string;
}

/**
 * POST /api/v1/branches/:id → name and timezone. The code is immutable. The timezone
 * can change only while the branch has no attendance records.
 */
export interface BranchUpdateRequest {
  expectedVersion: number;
  name?: string;
  timezone?: string;
  reason?: string;
}

/** POST /api/v1/branches/:id/status: activation changes members' effective authority. */
export interface BranchStatusRequest {
  expectedVersion: number;
  isActive: boolean;
  reason: string;
}

/** POST /api/v1/branches/:id/hours: one or more weekdays; the others are unchanged. */
export interface BranchHoursUpdateRequest {
  expectedVersion: number;
  days: BranchOperatingDay[];
  reason?: string;
}

/** Workforce view of a service category. */
export interface ServiceCategoryResponse {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

/**
 * GET /api/v1/service-categories. Inactive categories are included only for GLOBAL
 * MANAGE_SERVICES holders.
 */
export interface ServiceCategoryListResponse {
  categories: ServiceCategoryResponse[];
}

/** POST /api/v1/service-categories → 201. GLOBAL MANAGE_SERVICES. The code is immutable. */
export interface ServiceCategoryCreateRequest {
  code: string;
  nameVi: string;
  nameEn: string;
  sortOrder?: number;
  reason?: string;
}

/** POST /api/v1/service-categories/:id. */
export interface ServiceCategoryUpdateRequest {
  expectedVersion: number;
  nameVi?: string;
  nameEn?: string;
  sortOrder?: number;
  reason?: string;
}

/** POST /api/v1/service-categories/:id/status and /api/v1/services/:id/status. */
export interface CatalogStatusRequest {
  expectedVersion: number;
  isActive: boolean;
  reason: string;
}

/**
 * POST /api/v1/services/:id/delete and /api/v1/service-categories/:id/delete: permanent
 * deletion of incorrectly created configuration data. This is not deactivation: the row is
 * removed and only its audit snapshot remains.
 * - A service needs GLOBAL MANAGE_SERVICES and GLOBAL_ONLY MANAGE_SERVICE_PRICES (the
 *   authority that creates one). Its eligible-skill links and branch-availability rows are
 *   removed with it. Any other record referencing the service (future history such as
 *   bookings or invoices) refuses the deletion: 409 CONFLICT "inUse"; deactivate instead.
 * - A category needs GLOBAL MANAGE_SERVICES and must contain no service at all (active or
 *   inactive): 409 CONFLICT "services". Its services are never cascaded.
 */
export interface CatalogDeleteRequest {
  expectedVersion: number;
  reason?: string;
}

export interface CatalogDeleteResponse {
  id: string;
  deleted: true;
}

/** Whether a branch offers the service. No row means the service is not offered there. */
export interface ServiceBranchAvailabilityEntry {
  branchId: string;
  isActive: boolean;
  version: number;
}

/**
 * What one service price applies to: the whole service, or one nail ("/ngón", "/nail").
 * Further units are added only for real menu data.
 */
export type ServicePricingUnit = 'PER_SERVICE' | 'PER_NAIL';

/**
 * Workforce view of a service. `availability` lists only branches the caller may see.
 *
 * Price (integer VND strings), always `0 <= priceVnd <= priceMaxVnd`, per `pricingUnit`:
 * - `priceVnd`: the minimum price, and the price itself when exact (min = max). Existing
 *   clients that read `priceVnd` keep reading the same value for flat-price services.
 * - `priceMaxVnd`: the maximum price ("5.000–10.000 ₫/ngón"); equal to `priceVnd` when exact.
 * - `pricingUnit`: PER_SERVICE (a flat price) or PER_NAIL (per nail).
 *
 * Durations (minutes), always `1 <= estimatedMinMinutes <= estimatedMaxMinutes <=
 * durationMinutes <= 1440`:
 * - `estimatedMinMinutes` / `estimatedMaxMinutes`: the customer-facing estimate ("about
 *   30–45 minutes"); equal for an exact-duration service.
 * - `durationMinutes`: the one internal scheduling duration that booking reserves. It is
 *   never shorter than the estimate's maximum and must never be shown as a public label.
 */
export interface ServiceResponse {
  id: string;
  code: string;
  categoryId: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string | null;
  descriptionEn: string | null;
  priceVnd: string;
  priceMaxVnd: string;
  pricingUnit: ServicePricingUnit;
  durationMinutes: number;
  estimatedMinMinutes: number;
  estimatedMaxMinutes: number;
  isActive: boolean;
  version: number;
  availability: ServiceBranchAvailabilityEntry[];
  /**
   * Skills that qualify an employee for this service. An employee satisfies the skill
   * dimension with ANY one of them (evaluated by the Phase 3 booking engine, not here).
   */
  eligibleSkills: SkillSummary[];
}

/** GET /api/v1/services?categoryId&branchId (branchId: only services offered there). */
export interface ServiceListResponse {
  services: ServiceResponse[];
}

/**
 * POST /api/v1/services → 201. Requires GLOBAL MANAGE_SERVICES and, because it sets a
 * price, GLOBAL_ONLY MANAGE_SERVICE_PRICES. A 30-minute and a 60-minute offering are
 * separate services. The new service is offered nowhere until availability is set.
 * Give both estimate bounds, or neither: without them the estimate is exact
 * (min = max = `durationMinutes`).
 */
export interface ServiceCreateRequest {
  code: string;
  categoryId: string;
  nameVi: string;
  nameEn: string;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  priceVnd: string;
  /** Defaults to `priceVnd` (an exact price). */
  priceMaxVnd?: string;
  /** Defaults to PER_SERVICE. */
  pricingUnit?: ServicePricingUnit;
  durationMinutes: number;
  estimatedMinMinutes?: number;
  estimatedMaxMinutes?: number;
  reason?: string;
}

/**
 * POST /api/v1/services/:id: master data only (GLOBAL MANAGE_SERVICES; no price, no code).
 * Duration fields may change independently; the resulting values must still satisfy
 * `1 <= estimatedMinMinutes <= estimatedMaxMinutes <= durationMinutes <= 1440`.
 */
export interface ServiceUpdateRequest {
  expectedVersion: number;
  categoryId?: string;
  nameVi?: string;
  nameEn?: string;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  durationMinutes?: number;
  estimatedMinMinutes?: number;
  estimatedMaxMinutes?: number;
  reason?: string;
}

/** POST /api/v1/services/:id/price: GLOBAL_ONLY MANAGE_SERVICE_PRICES; always audited. */
export interface ServicePriceRequest {
  expectedVersion: number;
  /** Minimum price (the price itself when exact). */
  priceVnd: string;
  /** Omitted: the price is exact (maximum = `priceVnd`). */
  priceMaxVnd?: string;
  /** Omitted: the pricing unit is unchanged. */
  pricingUnit?: ServicePricingUnit;
  reason: string;
}

/**
 * POST /api/v1/services/:id/branches/:branchId: MANAGE_SERVICES for that branch.
 * `expectedVersion` is the availability row's version, or null when none exists yet.
 */
export interface ServiceAvailabilityRequest {
  expectedVersion: number | null;
  isActive: boolean;
  reason?: string;
}

/** A skill as referenced from services and employees. */
export interface SkillSummary {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  isActive: boolean;
}

export interface SkillResponse extends SkillSummary {
  version: number;
}

/** GET /api/v1/skills. Inactive skills are included only for GLOBAL MANAGE_SKILLS holders. */
export interface SkillListResponse {
  skills: SkillResponse[];
}

/** POST /api/v1/skills → 201. GLOBAL MANAGE_SKILLS. The code is immutable. */
export interface SkillCreateRequest {
  code: string;
  nameVi: string;
  nameEn: string;
  reason?: string;
}

/** POST /api/v1/skills/:id: names only. Status uses /api/v1/skills/:id/status. */
export interface SkillUpdateRequest {
  expectedVersion: number;
  nameVi?: string;
  nameEn?: string;
  reason?: string;
}

/**
 * POST /api/v1/services/:id/skills: GLOBAL MANAGE_SERVICES. Replaces the complete set of
 * eligible skills (it may be empty). `expectedVersion` is the service's version.
 */
export interface ServiceSkillsRequest {
  expectedVersion: number;
  skillIds: string[];
  reason?: string;
}

/** One active skill of an employee. */
export interface EmployeeSkillEntry {
  skill: SkillSummary;
  grantedAt: string;
  grantedByUserId: string;
}

/** A former grant: the same row, ended at `revokedAt` (never deleted). */
export interface EmployeeSkillHistoryEntry extends EmployeeSkillEntry {
  revokedAt: string;
}

/**
 * GET /api/v1/employees/:id/skills: the employee's active skills, and `history`: the
 * revoked grants (most recently revoked first). Grants are never deleted.
 */
export interface EmployeeSkillsResponse {
  employeeId: string;
  skills: EmployeeSkillEntry[];
  history: EmployeeSkillHistoryEntry[];
}

/**
 * POST /api/v1/employees/:id/skills: MANAGE_SKILLS for every branch of the employee.
 * Skills are employee capabilities, not per-branch copies. Granting an already active
 * skill is 409.
 */
export interface EmployeeSkillGrantRequest {
  skillId: string;
  reason?: string;
}

/** POST /api/v1/employees/:id/skills/:skillId/revoke: ends the active grant; history kept. */
export interface EmployeeSkillRevokeRequest {
  reason?: string;
}

/**
 * One EmployeeBranchAssignment row: the single source of truth for an employee's
 * operational (and authorization) branch membership. Revoked rows are kept as history.
 */
export interface EmployeeBranchAssignmentEntry {
  id: string;
  branchId: string;
  grantedAt: string;
  grantedByUserId: string;
  /** null while active. */
  revokedAt: string | null;
}

/**
 * GET /api/v1/employees/:id/branch-assignments. `version` is the employee's version (the
 * same `expectedVersion` used by the employee scope commands).
 */
export interface EmployeeBranchAssignmentsResponse {
  employeeId: string;
  version: number;
  active: EmployeeBranchAssignmentEntry[];
  history: EmployeeBranchAssignmentEntry[];
}

/**
 * POST /api/v1/employees/:id/branch-assignments: add one active branch. MANAGE_EMPLOYEE_SCOPE
 * at every current and new branch (a security-graph change). An already active branch is
 * 409; an inactive or unknown branch is 400.
 */
export interface EmployeeBranchAssignRequest {
  expectedVersion: number;
  branchId: string;
  reason: string;
}

/**
 * POST /api/v1/employees/:id/branch-assignments/:branchId/revoke: end one active
 * assignment and keep it as history. Removing the last branch is allowed; afterwards the
 * employee can be administered only with GLOBAL authority.
 */
export interface EmployeeBranchRevokeRequest {
  expectedVersion: number;
  reason: string;
}

/**
 * Attendance V1: one check-in + one check-out per employee + branch + business date, with
 * no breaks and no shifts. `businessDate` is the check-in's calendar date in the branch
 * timezone. Timestamps are UTC ISO-8601.
 */
export interface AttendanceRecordResponse {
  id: string;
  employeeId: string;
  branchId: string;
  businessDate: string;
  checkInAt: string;
  checkOutAt: string | null;
  /** Send back as `expectedVersion` for corrections. */
  version: number;
}

export interface AttendanceListResponse {
  records: AttendanceRecordResponse[];
}

/**
 * POST /api/v1/attendance/check-in → 201. The caller checks themself in at a branch where
 * they have an active EmployeeBranchAssignment. The server clock sets the time.
 */
export interface AttendanceCheckInRequest {
  branchId: string;
}

/**
 * POST /api/v1/attendance/:id/check-out: the caller's own open record for the current
 * branch business date. A forgotten check-out from an earlier day is corrected by a
 * manager.
 */
export type AttendanceCheckOutRequest = Record<string, never>;

/**
 * GET /api/v1/attendance/me?from&to&branchId: the caller's own records. GET
 * /api/v1/attendance?from&to&branchId&employeeId: VIEW_ATTENDANCE, branch-scoped. Dates
 * are `YYYY-MM-DD` business dates; the range is at most 93 days (default: the last 31).
 */
export interface AttendanceQuery {
  from?: string;
  to?: string;
  branchId?: string;
  employeeId?: string;
}

/**
 * POST /api/v1/attendance/:id/correct: MANAGE_ATTENDANCE for the record's branch. It
 * corrects a forgotten or wrong check-out, and the check-in within the same business
 * date. A reason is required and the change is always audited.
 */
export interface AttendanceCorrectionRequest {
  expectedVersion: number;
  checkInAt?: string;
  checkOutAt?: string;
  reason: string;
}

/**
 * Leave type: what the leave is for. It never implies paid/unpaid treatment, quota use or
 * payroll effect; those belong to a future configurable Leave Policy. Display labels
 * (VI/EN) are UI concerns.
 */
export type LeaveType = 'ANNUAL' | 'SICK' | 'PERSONAL' | 'FAMILY_EVENT' | 'MATERNITY' | 'OTHER';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/**
 * One employee-level leave request (never per branch) over whole calendar days.
 * `startDate` / `endDate` are inclusive `YYYY-MM-DD` dates; `days` is the inclusive
 * calendar-day count (informational; no quota is enforced).
 */
export interface LeaveRequestResponse {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  requestedAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  cancelledByUserId: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  version: number;
}

export interface LeaveRequestListResponse {
  requests: LeaveRequestResponse[];
}

/** POST /api/v1/leave-requests: the caller's own request, created PENDING. */
export interface LeaveRequestCreateRequest {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
}

/** POST /api/v1/leave-requests/:id/cancel: the employee's own PENDING request only. */
export interface LeaveRequestCancelRequest {
  expectedVersion: number;
  reason?: string;
}

/**
 * POST /api/v1/leave-requests/:id/approve (reason optional) and /:id/reject (reason
 * required): APPROVE_LEAVE over every active branch of the employee.
 */
export interface LeaveRequestDecisionRequest {
  expectedVersion: number;
  reason?: string;
}

/**
 * GET /api/v1/leave-requests/me and GET /api/v1/leave-requests (APPROVE_LEAVE scope):
 * requests overlapping `[from, to]` (`YYYY-MM-DD`, at most 400 days; default from 93
 * days ago to 306 days ahead, 400 days inclusive), optionally filtered by status (and
 * employee).
 */
export interface LeaveRequestQuery {
  from?: string;
  to?: string;
  status?: LeaveStatus;
  employeeId?: string;
}

// ------------------------------------------------------------------ collaborator work (Step 6)

/** Theo ca (explicit times) or Full ngày (snapshot of the branch hours when agreed). */
export type CollaboratorWorkMode = 'SHIFT' | 'FULL_DAY';
export type CollaboratorWorkStatus = 'SCHEDULED' | 'CANCELLED';

/**
 * One collaborator (CTV) work occurrence. Times are "HH:MM" on the branch-local work date
 * (end may be "24:00"). `agreedPayVnd` is the manually agreed amount for this occurrence as
 * an integer VND string (never derived from hours or attendance); null = not agreed yet.
 * It is present only for the collaborator themself, or with VIEW_EMPLOYEE_PAY or
 * MANAGE_EMPLOYEE_PAY at the occurrence's branch; otherwise the key is absent.
 */
export interface CollaboratorWorkOccurrence {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string;
  workDate: string;
  mode: CollaboratorWorkMode;
  startTime: string;
  endTime: string;
  agreedPayVnd?: string | null;
  status: CollaboratorWorkStatus;
  note: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CollaboratorWorkListResponse {
  items: CollaboratorWorkOccurrence[];
}

/**
 * GET /api/v1/collaborator-work?from&to[&branchId][&employeeId][&status]: occurrences at the
 * branches where the caller holds VIEW_WORK_SCHEDULE or MANAGE_WORK_SCHEDULE (at most 62
 * days). GET /api/v1/me/collaborator-work?from&to: the caller's own, with pay.
 */
export interface CollaboratorWorkQuery {
  from: string;
  to: string;
  branchId?: string;
  employeeId?: string;
  status?: CollaboratorWorkStatus;
}

/**
 * POST /api/v1/collaborator-work (MANAGE_WORK_SCHEDULE at the branch). SHIFT needs
 * `startTime` and `endTime` inside the branch hours; FULL_DAY takes the branch hours of that
 * date as a snapshot. `agreedPayVnd` (optional) needs MANAGE_EMPLOYEE_PAY at the branch.
 * A past work date needs `reason`.
 */
export interface CollaboratorWorkCreateRequest {
  employeeId: string;
  branchId: string;
  workDate: string;
  mode: CollaboratorWorkMode;
  startTime?: string;
  endTime?: string;
  agreedPayVnd?: string | null;
  note?: string | null;
  reason?: string;
}

/**
 * POST /api/v1/collaborator-work/:id: controlled edit of a SCHEDULED occurrence. Every rule
 * is re-checked; changing pay needs MANAGE_EMPLOYEE_PAY; a past (old or new) date needs
 * `reason`. A FULL_DAY occurrence keeps its snapshot unless its date, branch or mode changes.
 */
export interface CollaboratorWorkUpdateRequest {
  expectedVersion: number;
  branchId?: string;
  workDate?: string;
  mode?: CollaboratorWorkMode;
  startTime?: string;
  endTime?: string;
  agreedPayVnd?: string | null;
  note?: string | null;
  reason?: string;
}

/** POST /api/v1/collaborator-work/:id/cancel: kept as history; a reason is required. */
export interface CollaboratorWorkCancelRequest {
  expectedVersion: number;
  reason: string;
}

/**
 * GET /api/v1/collaborator-work/options?branchId&workDate (MANAGE_WORK_SCHEDULE at the
 * branch): the branch hours of that date (null when closed) and the collaborators who may be
 * scheduled there (COLLABORATOR on that date, active assignment at the branch).
 */
export interface CollaboratorWorkOptionsResponse {
  window: { startTime: string; endTime: string } | null;
  collaborators: { id: string; employeeCode: string; fullName: string }[];
}

// ------------------------------------------------------------------ my income (Step 7)

/** Day, ISO week (Monday–Sunday) or calendar month, on branch-local work dates. */
export type IncomePeriod = 'DAY' | 'WEEK' | 'MONTH';

/** Income sources that do not exist yet; listed, never reported as 0. */
export type UnavailableIncomeSource = 'SERVICE_TOUR' | 'COMMISSION' | 'TIPS' | 'ADJUSTMENTS';

/**
 * GET /api/v1/me/income?period&date: the signed-in member's own compensation information,
 * read from the authoritative sources that exist (no income ledger). Amounts are integer
 * VND strings. Nothing here is payroll, paid, net or attendance-adjusted.
 */
export interface MyIncomeResponse {
  kind: 'OWNER' | 'EMPLOYEE';
  title: WorkforceTitle;
  /** Classification in effect today (null before the start, or for the Owner). */
  classification: EmploymentClassification | null;
  period: { kind: IncomePeriod; date: string; from: string; to: string };
  /**
   * Official employees only: the configured current base salary, a monthly amount as
   * recorded on the employee profile (null amount = not configured). Never prorated or
   * converted to earnings for a day, week or month. Null when not applicable.
   */
  baseSalary: { amountVnd: string | null; unit: 'MONTH' } | null;
  /**
   * Collaborator work in the period (for a current collaborator, or when the period holds
   * earlier collaborator work). Scheduled occurrences only; cancelled work never counts.
   * The total sums only agreed amounts: an occurrence without agreed pay is listed and
   * counted as unagreed, never as 0. Null when not applicable.
   */
  collaboratorWork: {
    totalAgreedPayVnd: string;
    occurrenceCount: number;
    unagreedCount: number;
    byBranch: {
      branchId: string;
      totalAgreedPayVnd: string;
      occurrenceCount: number;
      unagreedCount: number;
    }[];
    items: {
      id: string;
      workDate: string;
      branchId: string;
      mode: CollaboratorWorkMode;
      startTime: string;
      endTime: string;
      agreedPayVnd: string | null;
    }[];
  } | null;
  /** Future sources (not implemented yet) for this classification; never zeroes. */
  unavailableSources: UnavailableIncomeSource[];
}
