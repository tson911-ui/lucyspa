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
}

export interface EmployeeDirectoryResponse {
  items: EmployeeDirectoryEntry[];
  nextCursor: string | null;
}

/** POST /api/v1/employees/:id/profile. Contact identifiers and pay are excluded. */
export interface EmployeeProfileUpdateRequest {
  expectedVersion: number;
  fullName?: string;
  dateOfBirth?: string;
  address?: string;
  locale?: PreferredLocale;
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
  | 'APPROVE_LEAVE';

/** A named permission bundle. OWNER is virtual and never a role. */
export interface RoleResponse {
  id: string;
  code: string;
  displayNameVi: string;
  displayNameEn: string;
  isActive: boolean;
  permissions: PermissionCodeName[];
  /** Send back as `expectedVersion`. */
  version: number;
}

/** GET /api/v1/roles */
export interface RoleListResponse {
  roles: RoleResponse[];
  permissions: PermissionCodeName[];
}

/** POST /api/v1/roles → 201 RoleResponse. */
export interface RoleCreateRequest {
  code: string;
  displayNameVi: string;
  displayNameEn: string;
  permissions: PermissionCodeName[];
  reason: string;
}

/** POST /api/v1/roles/:id → names and activation only; the code is immutable. */
export interface RoleUpdateRequest {
  expectedVersion: number;
  displayNameVi?: string;
  displayNameEn?: string;
  isActive?: boolean;
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

/** Whether a branch offers the service. No row means the service is not offered there. */
export interface ServiceBranchAvailabilityEntry {
  branchId: string;
  isActive: boolean;
  version: number;
}

/**
 * Workforce view of a service. `durationMinutes` is internal scheduling data and must
 * never be shown as a public menu label. `priceVnd` is a nonnegative integer VND string.
 * `availability` lists only branches the caller may see.
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
  durationMinutes: number;
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
 */
export interface ServiceCreateRequest {
  code: string;
  categoryId: string;
  nameVi: string;
  nameEn: string;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  priceVnd: string;
  durationMinutes: number;
  reason?: string;
}

/** POST /api/v1/services/:id: master data only (GLOBAL MANAGE_SERVICES; no price, no code). */
export interface ServiceUpdateRequest {
  expectedVersion: number;
  categoryId?: string;
  nameVi?: string;
  nameEn?: string;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  durationMinutes?: number;
  reason?: string;
}

/** POST /api/v1/services/:id/price: GLOBAL_ONLY MANAGE_SERVICE_PRICES; always audited. */
export interface ServicePriceRequest {
  expectedVersion: number;
  priceVnd: string;
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

/** GET /api/v1/employees/:id/skills: the employee's active skills (history is kept). */
export interface EmployeeSkillsResponse {
  employeeId: string;
  skills: EmployeeSkillEntry[];
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
