/** Public, transport-only contracts. No ORM, Node runtime or domain implementation exports. */
import type {
  NotificationCategory,
  NotificationEntityType,
  NotificationParams,
  NotificationType,
} from './notification-registry.js';
import type { SeasonDensity, SeasonSlot, SeasonSlotSwitches } from './season-registry.js';
export type OrganizationLevel =
  | 'CEO'
  | 'REGIONAL_MANAGER'
  | 'AREA_MANAGER'
  | 'STORE_MANAGER'
  | 'DEPUTY_STORE_MANAGER'
  | 'TEAM_LEADER';

export interface OrganizationRegion {
  id: string;
  code: string;
  name: string;
  version: number;
  isActive: boolean;
}
export interface OrganizationArea extends OrganizationRegion {
  regionId: string;
}
export interface OrganizationBranch extends OrganizationRegion {
  areaId: string | null;
  regionId: string | null;
}
export interface OrganizationSnapshotResponse {
  regions: OrganizationRegion[];
  areas: OrganizationArea[];
  branches: OrganizationBranch[];
}
export interface OrganizationAppointment {
  id: string;
  userId: string;
  fullName: string;
  level: OrganizationLevel;
  scope: AuthorizationScope;
  teamId: string | null;
  version: number;
  startedAt: string;
  endedAt: string | null;
}
export interface OrganizationAppointmentsResponse {
  items: OrganizationAppointment[];
}
export interface OrganizationRegionCreateRequest {
  code: string;
  name: string;
  reason: string;
}
export interface OrganizationRegionUpdateRequest {
  name?: string;
  isActive?: boolean;
  expectedVersion: number;
  reason: string;
}
export interface OrganizationAreaCreateRequest extends OrganizationRegionCreateRequest {
  regionId: string;
}
export interface OrganizationAreaUpdateRequest extends OrganizationRegionUpdateRequest {
  regionId?: string;
}
export interface OrganizationBranchPlacementRequest {
  areaId: string | null;
  expectedVersion: number;
  reason: string;
}
export interface OrganizationAppointmentCreateRequest {
  userId: string;
  level: OrganizationLevel;
  scope: AuthorizationScope;
  reason: string;
}
export interface OrganizationAppointmentEndRequest {
  expectedVersion: number;
  reason: string;
}

export interface TeamSummary {
  id: string;
  branchId: string;
  code: string;
  name: string;
  isActive: boolean;
  version: number;
  leader: { assignmentId: string; userId: string; fullName: string } | null;
  memberCount: number;
  canManage: boolean;
  canAssignLeader: boolean;
}
export interface OrganizationPage {
  number: number;
  size: number;
  total: number;
}
export interface TeamListResponse {
  items: TeamSummary[];
  page: OrganizationPage;
}
export interface TeamCreateRequest {
  branchId: string;
  code: string;
  name: string;
  reason: string;
}
export interface TeamUpdateRequest {
  name: string;
  expectedVersion: number;
  reason: string;
}
export interface TeamDeleteRequest {
  expectedVersion: number;
  reason: string;
  confirmed: true;
}
export interface TeamLeaderRequest {
  userId: string | null;
  expectedVersion: number;
  reason: string;
}
export type TeamMembershipFilter = 'ALL' | 'MEMBERS' | 'UNASSIGNED' | 'OTHER_TEAM';
export interface TeamEmployeeFilters {
  q?: string;
  status?: EmployeeStatus;
  classification?: Exclude<EmploymentClassification, 'ENDED'>;
  membership?: TeamMembershipFilter;
}
export interface TeamEmployee {
  userId: string;
  employeeCode: string;
  fullName: string;
  status: EmployeeStatus;
  classification: EmploymentClassification | null;
  teamId: string | null;
  teamName: string | null;
}
export interface TeamEmployeesResponse {
  items: TeamEmployee[];
  page: OrganizationPage;
}
/** All-matching commands process bounded batches and return a stable user-id cursor. */
export type TeamBulkSelection =
  | { userIds: string[] }
  | { allMatching: true; filters: TeamEmployeeFilters; excludedUserIds?: string[]; after?: string };
export interface TeamMembersRequest {
  action: 'ADD' | 'REMOVE' | 'TRANSFER';
  targetTeamId?: string;
  expectedVersion: number;
  reason: string;
  selection: TeamBulkSelection;
}
export interface TeamMembersResponse {
  processed: number;
  changed: number;
  hasMore: boolean;
  nextAfter: string | null;
  version: number;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  checks?: { database: 'up' | 'down'; redis: 'up' | 'down' };
}

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string | string[];
  /** Only on a 401: the session ended because the person's permissions changed. */
  reason?: 'AUTHORIZATION_CHANGED';
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

/** GLOBAL is the existing transport identifier for SYSTEM scope. */
export type AuthorizationScope =
  | { kind: 'GLOBAL' }
  | { kind: 'REGION'; regionId: string }
  | { kind: 'AREA'; areaId: string }
  | { kind: 'BRANCH'; branchId: string };

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
  /** Server-derived organization hints; the API rechecks authority for every action. */
  organization?: {
    regions: readonly { readonly id: string; readonly name?: string }[];
    areas: readonly { readonly id: string; readonly regionId: string; readonly name?: string }[];
    branches: readonly {
      readonly id: string;
      readonly areaId: string | null;
      readonly regionId: string | null;
    }[];
  };
  organizationAppointments?: readonly {
    readonly id: string;
    readonly level: OrganizationLevel;
    readonly scope: AuthorizationScope;
    readonly teamId: string | null;
  }[];
  teamMemberships?: readonly { readonly teamId: string; readonly branchId: string }[];
  /** False for Owner and current Store Manager-or-higher organizational appointments. */
  attendanceRequired?: boolean;
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
  /**
   * Object read only (GET /employees/:id): active Organization Appointments the caller may
   * see, the same data and authorization as the directory. Omitted when there are none.
   */
  organizationAppointments?: EmployeeDirectoryAppointment[];
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
  /**
   * Active Organization Appointments visible to the caller (VIEW_ORGANIZATION or
   * MANAGE_ORG_ASSIGNMENTS at the appointment scope). Separate from `title`, which is the
   * employment title and is never replaced. Omitted when the employee has none the caller may
   * see; one entry per appointment, so several scopes are all kept.
   */
  organizationAppointments?: EmployeeDirectoryAppointment[];
}

export interface EmployeeDirectoryAppointment {
  id: string;
  level: OrganizationLevel;
  scope: AuthorizationScope;
  teamId: string | null;
  teamName: string | null;
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
  | 'VIEW_ORGANIZATION'
  | 'MANAGE_ORGANIZATION'
  | 'MANAGE_ORG_ASSIGNMENTS'
  | 'VIEW_TEAMS'
  | 'MANAGE_TEAMS'
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
  | 'MANAGE_WORK_SCHEDULE'
  | 'VIEW_BOOKINGS'
  | 'MANAGE_BOOKINGS'
  | 'MANAGE_QUEUE'
  | 'REASSIGN_SERVICES'
  | 'PERFORM_SERVICES'
  | 'RESOLVE_SERVICE_EXECUTION'
  | 'MANAGE_BOOKING_SETTINGS'
  | 'VIEW_INVOICES'
  | 'MANAGE_INVOICES'
  | 'COLLECT_PAYMENTS'
  | 'APPLY_DISCOUNTS'
  | 'MANAGE_DISCOUNTS'
  | 'CREATE_VOUCHERS'
  | 'CANCEL_INVOICES'
  | 'CORRECT_PAYMENTS'
  | 'VIEW_REVENUE'
  | 'MANAGE_WEBSITE_CONTENT';

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
  dataClassification: 'STANDARD' | 'EMPLOYEE_PAY' | 'FINANCIAL';
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
  /**
   * Phase 4 OP-1: the per-service limit of an invoice line's quantity (an integer >= 1; always 1 for
   * PER_SERVICE). Configured per service through the price command, snapshotted on booking and visit
   * lines when they are established, so a later change never alters an existing visit or invoice.
   */
  maxQuantity: number;
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
  /**
   * The quantity limit (OP-1). Required for PER_NAIL; PER_SERVICE is exactly 1 (omit it or send 1).
   */
  maxQuantity?: number;
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
  /**
   * The quantity limit (OP-1), changed under the same authority and audit as the price. Required when
   * the unit becomes PER_NAIL; omitted for an existing PER_NAIL service means unchanged; PER_SERVICE is
   * always 1. It affects only lines established afterwards.
   */
  maxQuantity?: number;
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

// ---------------------------------------------------------------- Phase 3 Step 4: customer booking

/** Who receives a service (O11). SELF is the signed-in owner; others are named, never accounts. */
export type BookingRecipientRelationName = 'SELF' | 'CHILD' | 'FAMILY' | 'OTHER';

/** GET /api/v1/me/booking/branches: active branches open for online booking. */
export interface CustomerBookingBranchesResponse {
  branches: { id: string; code: string; name: string }[];
}

/**
 * GET /api/v1/me/booking/branches/:branchId: services offered there and the bookable date
 * range (branch-local, from the booking settings; never hard-coded in the client).
 */
export interface CustomerBookingBranchResponse {
  branch: { id: string; code: string; name: string; timezone: string };
  /** First and last bookable branch-local dates, `YYYY-MM-DD`. */
  firstDate: string;
  lastDate: string;
  services: {
    id: string;
    code: string;
    nameVi: string;
    nameEn: string;
    categoryNameVi: string;
    categoryNameEn: string;
    durationMinutes: number;
    /** Catalog reference price range (integer VND strings); not a bill (O5). */
    priceMinVnd: string;
    priceMaxVnd: string;
    pricingUnit: 'PER_SERVICE' | 'PER_NAIL';
  }[];
}

/**
 * GET /api/v1/me/booking/branches/:branchId/employees?serviceIds=a,b: for each requested
 * service, the KTVs qualified for it (display name only). Time is checked later.
 */
export interface CustomerBookingEmployeesResponse {
  services: { serviceId: string; employees: { id: string; displayName: string }[] }[];
}

/** One requested line: the service, its recipient key and a KTV (null = Any KTV). */
export interface CustomerBookingLineInput {
  serviceId: string;
  recipientKey: string;
  employeeUserId: string | null;
}

/** GET /api/v1/me/booking/availability: feasible starts for the whole ordered sequence. */
export interface CustomerBookingAvailabilityResponse {
  date: string;
  /** Branch-local start times `HH:MM`, on the configured slot grid. */
  starts: string[];
}

export interface CustomerBookingRecipientInput {
  /** Client-chosen key, unique within the request, referenced by lines. */
  key: string;
  relation: BookingRecipientRelationName;
  /** Required unless SELF. */
  displayName?: string;
  phone?: string;
}

/** POST /api/v1/me/bookings. The owner is always the session's customer. */
export interface CustomerBookingCreateRequest {
  /** Client UUID; a retry with the same key returns the same booking. */
  idempotencyKey: string;
  branchId: string;
  /** Branch-local `YYYY-MM-DD` and `HH:MM`. */
  date: string;
  startTime: string;
  recipients: CustomerBookingRecipientInput[];
  lines: CustomerBookingLineInput[];
}

/** Displayed state (contract section 3): after check-in it is derived from the visit. */
export type CustomerBookingDisplayStatus =
  'CONFIRMED' | 'ARRIVED' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface CustomerBookingSummary {
  id: string;
  code: string;
  /** Times are shown in the branch's IANA timezone. */
  branch: { id: string; name: string; timezone: string };
  date: string;
  startsAt: string;
  endsAt: string;
  status: CustomerBookingDisplayStatus;
  serviceNames: { vi: string; en: string }[];
  canCancel: boolean;
}

export interface CustomerBookingDetail extends CustomerBookingSummary {
  createdAt: string;
  cancelledAt: string | null;
  cancelledLate: boolean | null;
  recipients: { key: string; relation: BookingRecipientRelationName; displayName: string | null }[];
  lines: {
    sequence: number;
    serviceNameVi: string;
    serviceNameEn: string;
    durationMinutes: number;
    startsAt: string;
    endsAt: string;
    recipientKey: string;
    assignmentMode: 'SPECIFIC' | 'ANY';
    employee: { id: string; displayName: string };
    /** Catalog reference snapshot (O5), not a bill. */
    priceMinVnd: string;
    priceMaxVnd: string;
    pricingUnit: 'PER_SERVICE' | 'PER_NAIL';
  }[];
}

/** GET /api/v1/me/bookings */
export interface CustomerBookingListResponse {
  upcoming: CustomerBookingSummary[];
  history: CustomerBookingSummary[];
}

/** POST /api/v1/me/bookings/:id/cancel */
export interface CustomerBookingCancelRequest {
  reason?: string;
}

// ---------------------------------------------------------------- Phase 3 Step 5: operations

/**
 * Derived operational state of a booking (never stored; computed by the server from the
 * booking, its visit, the settings and `now`):
 * UPCOMING → ARRIVAL_WINDOW_OPEN (from `booking.checkInWindowMinutes` before the start) →
 * LATE_HOLD (after the start, until `booking.lateHoldMinutes` after it) → HOLD_EXPIRED
 * (a Manager decides; nothing is automatic). After arrival: ARRIVED, IN_SERVICE, COMPLETED.
 */
export type OperationalBookingState =
  | 'UPCOMING'
  | 'ARRIVAL_WINDOW_OPEN'
  | 'LATE_HOLD'
  | 'HOLD_EXPIRED'
  | 'ARRIVED'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

/** When an arrived booking arrived relative to its start and hold. */
export type ArrivalPunctuality = 'ON_TIME' | 'LATE_IN_HOLD' | 'LATE_AFTER_HOLD';

export interface OperationalBooking {
  id: string;
  code: string;
  startsAt: string;
  endsAt: string;
  state: OperationalBookingState;
  /** Arrival (check-in) is allowed from this instant (O2). */
  arrivalOpensAt: string;
  /** End of the late hold (Q4); the reservation stays protected until a Manager acts. */
  holdUntil: string;
  owner: { displayName: string; phoneMasked: string | null };
  recipients: { relation: BookingRecipientRelationName; displayName: string | null }[];
  lines: {
    sequence: number;
    serviceNameVi: string;
    serviceNameEn: string;
    startsAt: string;
    endsAt: string;
    recipientRelation: BookingRecipientRelationName;
    recipientName: string | null;
    employee: { id: string; displayName: string };
    /** Set by the Step 8 leave-conflict workflow; shown, never resolved here. */
    conflict: 'LEAVE' | null;
  }[];
  visit: {
    id: string;
    code: string;
    arrivedAt: string;
    punctuality: ArrivalPunctuality;
    queueOverrideAt: string | null;
  } | null;
  actions: { arrive: boolean; noShow: boolean; advance: boolean };
}

/**
 * Group of a waiting line in the computed queue (contract section 8 with Owner decision 3):
 * OVERRIDE, then booked priority (ON_TIME, LATE_IN_HOLD, by planned start), then everyone
 * ordered by actual arrival time: LATE_AFTER_HOLD (the hold expired before arrival, so the
 * appointment priority is lost) together with WALK_IN (Step 6).
 */
export type QueueGroup = 'OVERRIDE' | 'ON_TIME' | 'LATE_IN_HOLD' | 'LATE_AFTER_HOLD' | 'WALK_IN';

export interface OperationalQueueKtv {
  employee: { id: string; displayName: string };
  /** No running line and no planned or reserved interval covering now. */
  freeNow: boolean;
  serving: {
    visitCode: string;
    participantName: string;
    serviceNameVi: string;
    serviceNameEn: string;
  }[];
  /** Arrived, not started: the computed order (position 1 is next). */
  waiting: {
    position: number;
    group: QueueGroup;
    visitId: string;
    visitCode: string;
    bookingCode: string | null;
    participantName: string;
    serviceNameVi: string;
    serviceNameEn: string;
    plannedStartAt: string;
  }[];
  /** Not arrived yet: reservations that still block this KTV's capacity. */
  reserved: {
    bookingId: string;
    bookingCode: string;
    startsAt: string;
    endsAt: string;
    state: 'UPCOMING' | 'ARRIVAL_WINDOW_OPEN' | 'LATE_HOLD' | 'HOLD_EXPIRED';
  }[];
}

/** GET /api/v1/operations/branches/:branchId/today */
export interface OperationalTodayResponse {
  branch: { id: string; name: string; timezone: string };
  /** Branch-local business date and the server instant used for every derived state. */
  date: string;
  now: string;
  settings: { checkInWindowMinutes: number; lateHoldMinutes: number };
  bookings: OperationalBooking[];
  queue: OperationalQueueKtv[];
  /** Step 6: unassigned (WAITING) service sequences, branch-wide; no KTV until assignment. */
  waitingPool: OperationalWaitingEntry[];
  /**
   * Phase 4 Step 2: arrived visits that are still open (today's, plus any older one with a running
   * service so a forgotten END stays reachable), with the two management actions per line.
   */
  activeVisits: OperationalActiveVisit[];
  /**
   * `arrive` (MANAGE_BOOKINGS) also covers walk-in intake, assignment and waiting intent.
   * `cancelLine` (MANAGE_BOOKINGS) and `resolveExecution` (RESOLVE_SERVICE_EXECUTION) only shape
   * which actions are offered; each command is authorized again in its own transaction.
   */
  permissions: {
    arrive: boolean;
    manageQueue: boolean;
    cancelLine: boolean;
    resolveExecution: boolean;
  };
}

/** An open (OPEN or IN_SERVICE) visit and its service lines, for Phase 4 Step 2 management actions. */
export interface OperationalActiveVisit {
  id: string;
  code: string;
  status: 'OPEN' | 'IN_SERVICE';
  origin: 'BOOKING' | 'WALK_IN';
  arrivedAt: string;
  /** Who receives services in this visit (the target of a staff-added service). */
  participants: { id: string; name: string | null }[];
  lines: OperationalActiveVisitLine[];
  /** Phase 4 Step 3: MANAGE_BOOKINGS at the branch (the command re-authorizes). */
  actions: { addService: boolean };
}

export interface OperationalActiveVisitLine {
  id: string;
  sequence: number;
  status: 'WAITING' | 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  participantName: string | null;
  serviceNameVi: string;
  serviceNameEn: string;
  /** Null for a WAITING line (no KTV yet). */
  employee: { id: string; displayName: string } | null;
  plannedStartAt: string | null;
  /** Only for a line with a running execution. `overdue` is computed by the server clock. */
  execution: { startedAt: string; expectedEndAt: string; overdue: boolean } | null;
  actions: { cancel: boolean; resolve: boolean };
}

/** POST /api/v1/operations/bookings/:id/no-show and /visits/:id/advance */
export interface OperationalReasonRequest {
  reason: string;
}

// ---------------------------------------------------------------- Phase 3 Step 6: walk-in

export type VisitParticipantKindName = 'MEMBER' | 'GUEST' | 'CHILD';

/** One participant's WAITING service sequence in the branch waiting pool (no KTV yet). */
export interface OperationalWaitingEntry {
  position: number;
  /** OVERRIDE (a Manager advanced the visit) or WALK_IN (by actual arrival time). */
  group: QueueGroup;
  visitId: string;
  visitCode: string;
  participantId: string;
  participantName: string;
  participantKind: VisitParticipantKindName;
  arrivedAt: string;
  lines: {
    id: string;
    sequence: number;
    serviceId: string;
    serviceNameVi: string;
    serviceNameEn: string;
    durationMinutes: number;
    assignmentMode: 'SPECIFIC' | 'ANY';
    /** The requested KTV of a SPECIFIC line (intent, not an assignment). */
    requestedEmployee: { id: string; displayName: string } | null;
  }[];
  /** `cancel`: the walk-in left before any service started (MANAGE_BOOKINGS). */
  actions: { assign: boolean; changeIntent: boolean; advance: boolean; cancel: boolean };
}

/** GET /api/v1/operations/branches/:branchId/members?phone=… or ?email=… (exact match only). */
export interface WalkInMemberLookupResponse {
  members: {
    id: string;
    displayName: string;
    phoneMasked: string | null;
    emailMasked: string | null;
  }[];
}

/** GET /api/v1/operations/branches/:branchId/walk-in-options */
export interface WalkInOptionsResponse {
  branch: { id: string; name: string; timezone: string };
  services: {
    id: string;
    nameVi: string;
    nameEn: string;
    durationMinutes: number;
    priceMinVnd: string;
    priceMaxVnd: string;
    pricingUnit: 'PER_SERVICE' | 'PER_NAIL';
    /** KTVs passing the time-independent rules today (account, employment, branch, skills). */
    employees: { id: string; displayName: string; checkedIn: boolean }[];
  }[];
}

export interface WalkInParticipantInput {
  /** Client key, unique in the request, referenced by lines and guardians. */
  key: string;
  kind: VisitParticipantKindName;
  /** MEMBER: the existing customer account chosen from the lookup. */
  customerUserId?: string;
  /** GUEST and CHILD: the name to call; never an account. */
  displayName?: string;
  phone?: string;
  /** CHILD: the key of the adult participant in the same walk-in. */
  guardianKey?: string;
}

/** POST /api/v1/operations/branches/:branchId/walk-ins */
export interface WalkInCreateRequest {
  /** Client UUID; a retry with the same key returns the same visit. */
  idempotencyKey: string;
  participants: WalkInParticipantInput[];
  /** In order per participant; `requestedEmployeeUserId` null = Any KTV. */
  lines: { participantKey: string; serviceId: string; requestedEmployeeUserId: string | null }[];
}

/** Why a participant's sequence could not be assigned now (it stays WAITING). */
export type WalkInWaitReason =
  'NO_CAPACITY' | 'REQUESTED_KTV_UNAVAILABLE' | 'OUTSIDE_HOURS' | 'SERVICE_UNAVAILABLE';

export interface WalkInParticipantResult {
  participantId: string;
  displayName: string;
  kind: VisitParticipantKindName;
  /** ASSIGNED: every line PLANNED with a real KTV and time; WAITING: none assigned. */
  state: 'ASSIGNED' | 'WAITING' | 'NO_SERVICES';
  waitReason: WalkInWaitReason | null;
  lines: {
    id: string;
    sequence: number;
    serviceNameVi: string;
    serviceNameEn: string;
    status: 'WAITING' | 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
    assignmentMode: 'SPECIFIC' | 'ANY';
    requestedEmployee: { id: string; displayName: string } | null;
    employee: { id: string; displayName: string } | null;
    plannedStartAt: string | null;
    plannedEndAt: string | null;
  }[];
}

/** Walk-in creation and assignment results. */
export interface WalkInVisitResponse {
  visitId: string;
  visitCode: string;
  arrivedAt: string;
  timezone: string;
  participants: WalkInParticipantResult[];
}

/** POST /api/v1/operations/visits/:visitId/lines/:lineId/intent (WAITING lines only). */
export interface WalkInIntentRequest {
  requestedEmployeeUserId: string | null;
}
// Phase 3 Step 7: normal execution of the signed-in employee's assigned visit lines.
export type ServiceStartBlock =
  | 'SERVICE_START_NOT_ALLOWED'
  | 'SERVICE_SEQUENCE_BLOCKED'
  | 'SERVICE_KTV_BUSY'
  | 'SERVICE_NOT_TODAY'
  | 'SERVICE_NOT_READY'
  | 'SERVICE_START_UNAVAILABLE';

export interface ServiceExecutionWork {
  lineId: string;
  visitId: string;
  visitCode: string;
  visitStatus: 'OPEN' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED';
  branchId: string;
  serviceDate: string;
  participantId: string;
  participantName: string | null;
  sequence: number;
  service: { code: string; nameVi: string; nameEn: string; durationMinutes: number };
  status: 'WAITING' | 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  execution: {
    id: string;
    status: 'IN_PROGRESS' | 'ENDED';
    startedAt: string;
    expectedEndAt: string;
    endedAt: string | null;
    endKind: 'NORMAL' | 'MANAGER_RESOLVED' | null;
  } | null;
  actions: {
    start: boolean;
    end: boolean;
    startBlockedBy: ServiceStartBlock | null;
    /** Phase 4 Step 3: the performer may order another catalog service on behalf of the customer. */
    addService: boolean;
  };
}

export interface MyServiceWorkResponse {
  branch: { id: string; name: string; timezone: string };
  date: string;
  now: string;
  /** Today's own assigned lines, plus older unfinished executions so END remains reachable. */
  lines: ServiceExecutionWork[];
}

/** START/END accept only an empty JSON object; the line id is the idempotency identity. */
export type ServiceExecutionActionRequest = Record<string, never>;

/**
 * POST /api/v1/operations/service-lines/:id/resolve-end (RESOLVE_SERVICE_EXECUTION, Phase 4 Step 2).
 * `endedAt` is optional (default: the server clock). When given it is an ISO-8601 instant with a time
 * zone that must lie between the execution's start and the server clock; it never rewrites `startedAt`.
 */
export interface ResolveServiceExecutionRequest {
  reason: string;
  endedAt?: string;
}

export interface ResolvedServiceExecutionResponse {
  lineId: string;
  visitId: string;
  visitCode: string;
  visitStatus: 'IN_SERVICE' | 'COMPLETED';
  executionId: string;
  employeeUserId: string;
  startedAt: string;
  endedAt: string;
  endKind: 'MANAGER_RESOLVED';
}

/** POST /api/v1/operations/service-lines/:id/cancel (MANAGE_BOOKINGS, Phase 4 Step 2). */
export interface CancelServiceLineRequest {
  reason: string;
}

export interface CancelledServiceLineResponse {
  lineId: string;
  visitId: string;
  visitCode: string;
  /** The visit after the cancellation: it may complete or (when nothing was performed) be cancelled. */
  visitStatus: 'OPEN' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED';
}

/**
 * POST /api/v1/operations/visits/:id/lines (Phase 4 Step 3, staff-added service). Only a catalog
 * service id: the request has no name, price, quantity or time. `requestedEmployeeUserId` is the
 * optional SPECIFIC-KTV intent (omitted or null = any qualified KTV). `idempotencyKey` is a client
 * UUID, unique per actor, so a replay returns the same line.
 */
export interface AddServiceLineRequest {
  participantId: string;
  serviceId: string;
  requestedEmployeeUserId?: string | null;
  idempotencyKey: string;
}

export interface AddedServiceLineResponse {
  lineId: string;
  visitId: string;
  visitCode: string;
  participantId: string;
  sequence: number;
  /** PLANNED with a real KTV and time, or WAITING (see `waitReason`) until the existing assignment flow places it. */
  status: 'WAITING' | 'PLANNED';
  assignmentMode: 'SPECIFIC' | 'ANY';
  employee: { id: string; displayName: string } | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  waitReason: WalkInWaitReason | null;
  /** True when the same actor and key already created this line. */
  replayed: boolean;
}
// Phase 3 Step 8: explicit reassignment of existing assigned, unstarted work.
export type ReassignmentLineKind = 'BOOKING' | 'VISIT';
export type ReassignmentScope = 'LINE' | 'PARTICIPANT';
export interface ReassignmentLine {
  kind: ReassignmentLineKind;
  id: string;
  version: number;
  branchId: string;
  parentId: string;
  parentCode: string;
  participantId: string;
  participantName: string | null;
  sequence: number;
  serviceDate: string;
  service: { nameVi: string; nameEn: string };
  plannedStartAt: string;
  plannedEndAt: string;
  employee: { id: string; displayName: string };
  assignmentMode: 'ANY' | 'SPECIFIC';
  /** Original request: existing walk-in reference or the first assignment-history source. */
  requestedEmployeeId: string | null;
  leaveConflict: boolean;
  leaveRequestId: string | null;
}
export interface ReassignmentWorkResponse {
  branch: { id: string; name: string; timezone: string };
  from: string;
  to: string;
  lines: ReassignmentLine[];
  nextCursor: string | null;
}
export interface ReplacementOptionsResponse {
  scope: ReassignmentScope;
  /** Exact explicit scope: only this participant's unstarted lines assigned to the current KTV. */
  lines: ReassignmentLine[];
  candidates: { id: string; displayName: string; preferred: boolean }[];
  /** Existing Q3 planner suggestion, never a persisted or implicit assignment. */
  suggestedAssignments: { lineId: string; employeeUserId: string }[];
  requiresSpecificAcknowledgement: boolean;
}
export interface ReassignServicesRequest {
  scope: ReassignmentScope;
  targets: { id: string; expectedVersion: number }[];
  employeeUserId: string;
  context: 'LEAVE' | 'MANAGER';
  reason: string;
  acknowledgeSpecific: boolean;
}
export interface ReassignServicesResponse {
  lines: ReassignmentLine[];
}
// Phase 3 in-app inbox. No event payload, recipient identity or free-text audit notes are exposed.
export * from './notification-registry.js';
// Seasonal theme presets (docs/UXUI_REDESIGN_DESIGN.md 20): data only; the database stores the preset key.
export * from './season-registry.js';
export * from './lunar-year.js';
export interface NotificationItem {
  id: string;
  type: NotificationType;
  /** Null for a notification about a person rather than a place (leave requests). */
  branch: { id: string; name: string; timezone: string } | null;
  source: { type: NotificationEntityType; id: string; code: string };
  actionAt: string;
  createdAt: string;
  readAt: string | null;
  /** Archived items are hidden from the default inbox and never counted as unread. */
  archivedAt: string | null;
  /** Structured facts (ids, dates, enums) validated by the registry; never free text. */
  params: NotificationParams | null;
}
/** Unread, non-archived notifications per registry category. */
export type NotificationCategoryCounts = Record<NotificationCategory, number>;
export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
  /** Total unread, non-archived notifications (the bell badge). */
  unreadCount: number;
  unreadByCategory: NotificationCategoryCounts;
}
export interface NotificationCountResponse {
  unreadCount: number;
  unreadByCategory: NotificationCategoryCounts;
}
/** GET /api/v1/notifications query: the caller's own inbox only (there is no recipient parameter). */
export interface NotificationQuery {
  cursor?: string;
  category?: NotificationCategory;
  /** `true` lists only unread items. */
  unread?: boolean;
  /** `true` lists only archived items; the default lists only non-archived items. */
  archived?: boolean;
}
export interface NotificationReadAllRequest {
  /** Limit to one category; omitted marks every unread non-archived item. */
  category?: NotificationCategory;
}
export interface NotificationReadAllResponse extends NotificationCountResponse {
  /** How many rows this call changed (0 on a repeat). */
  updated: number;
}

// ------------------------------------------------------------------------------------------------
// Phase 4 Step 5: Invoice / POS ("Hóa đơn"), the internal commercial receipt of one completed visit.
// It is NOT an official VAT/e-invoice. Money is an integer VND decimal string; the client never sends
// a total, a price range, a quantity limit, a state or the visit's completion (all server-derived).
// ------------------------------------------------------------------------------------------------

export type InvoiceStatusName = 'DRAFT' | 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';

/** A customer account as staff may see it: masked contacts (no enumeration, no full identifiers). */
export interface InvoicePersonSummary {
  id: string;
  displayName: string;
  phoneMasked: string | null;
  emailMasked: string | null;
}

/**
 * One invoiced service performance. `priceMinVnd`/`priceMaxVnd`/`quantityLimit` are the HISTORICAL
 * snapshot of the visit line (never the live catalog). `quantity` is the financial quantity of the
 * pricing unit (1 for PER_SERVICE); `unitPriceVnd` and `quantity` are null until selected.
 */
export interface InvoiceLineResponse {
  id: string;
  sequence: number;
  visitServiceLineId: string;
  participant: { id: string; kind: VisitParticipantKindName; displayName: string | null };
  employee: { id: string; displayName: string };
  itemCode: string;
  nameVi: string;
  nameEn: string;
  pricingUnit: 'PER_SERVICE' | 'PER_NAIL';
  priceMinVnd: string;
  priceMaxVnd: string;
  quantityLimit: number;
  quantity: number | null;
  unitPriceVnd: string | null;
  grossVnd: string | null;
  priceSetAt: string | null;
  addedOnBehalf: boolean;
  /** The actor may still choose the price (a range) or the quantity (PER_NAIL) of this line. */
  priceEditable: boolean;
}

/**
 * Payment method of a recorded payment: cash (recorded directly by the cashier) and PayOS (a bank-transfer QR
 * request that becomes a payment only when PayOS confirms it, Phase 4 Step 8). A CARD / POS-terminal method
 * is a later, additive widening of this union.
 */
export type PaymentMethodName = 'CASH' | 'PAYOS';
export type PaymentStatusName = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

/**
 * One payment of an invoice (append-only history). `amountVnd` is what was CREDITED toward the invoice,
 * `tenderedVnd` what was handed over, `changeVnd` the difference (derived by the server). A payment is
 * `effective` while it succeeded and has no correction; a reversed payment stays listed with its correction.
 */
export interface InvoicePaymentResponse {
  id: string;
  method: PaymentMethodName;
  status: PaymentStatusName;
  /** The invoice balance at the moment of collection, before this payment. */
  amountDueVnd: string;
  amountVnd: string;
  tenderedVnd: string;
  changeVnd: string;
  collectedBy: { id: string; displayName: string };
  /** Server time; never supplied by a client. */
  collectedAt: string;
  businessDate: string;
  effective: boolean;
  correction: {
    reason: string;
    actor: { id: string; displayName: string };
    occurredAt: string;
  } | null;
  /** The actor may reverse this payment now (CORRECT_PAYMENTS; the API authorizes and re-authenticates again). */
  reversible: boolean;
  /** PayOS payments only (null for cash). */
  provider: InvoicePaymentProvider | null;
  /** A pending PayOS request the actor may cancel or re-check now (COLLECT_PAYMENTS). */
  cancellable: boolean;
}

/**
 * The PayOS side of a payment. `checkoutUrl` and `qrCode` are shown only to an actor holding COLLECT_PAYMENTS,
 * and only while the request is PENDING. `late` marks money confirmed after its request had already ended.
 */
export interface InvoicePaymentProvider {
  orderCode: string;
  checkoutUrl: string | null;
  qrCode: string | null;
  /** When the request stops accepting payment (15 minutes after it was created). */
  expiresAt: string;
  /** The bank transaction reference, once PayOS confirmed the transfer. */
  reference: string | null;
  late: boolean;
}

export type PaymentAnomalyKindName = 'AMOUNT_MISMATCH' | 'INVOICE_NOT_PAYABLE' | 'EXCEEDS_BALANCE';

/**
 * Money PayOS confirmed that Lucy Spa did NOT apply (amount mismatch, invoice already paid or cancelled, more than
 * the balance). Flagged for management review; nothing was credited.
 */
export interface InvoicePaymentAnomaly {
  id: string;
  kind: PaymentAnomalyKindName;
  status: 'OPEN' | 'REVIEWED';
  paymentId: string | null;
  orderCode: string;
  providerReference: string;
  expectedAmountVnd: string | null;
  receivedAmountVnd: string;
  invoiceStatus: InvoiceStatusName;
  openedAt: string;
  reviewedBy: { id: string; displayName: string } | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

/** An audited management note on an invoice settled through PayOS (Owner answer Q7 item 8). */
export interface InvoiceManagementNoteResponse {
  id: string;
  note: string;
  author: { id: string; displayName: string };
  createdAt: string;
}

export interface InvoiceResponse {
  id: string;
  code: string;
  status: InvoiceStatusName;
  branch: { id: string; name: string; timezone: string };
  visit: { id: string; code: string; serviceDate: string; completedAt: string | null };
  /** The payer; null = guest payer (no account, never inferred from guest details). */
  payer: InvoicePersonSummary | null;
  /** The booking owner (the default payer) when the visit has one. */
  defaultPayer: InvoicePersonSummary | null;
  businessDate: string;
  calculationVersion: number;
  subtotalVnd: string;
  discountTotalVnd: string;
  totalVnd: string;
  createdAt: string;
  finalizedAt: string | null;
  paidAt: string | null;
  paidSeq: number;
  cancelledAt: string | null;
  cancelledFromStatus: InvoiceStatusName | null;
  cancelReason: string | null;
  /** Optimistic-concurrency version: send it back as `expectedVersion` with every command. */
  version: number;
  lines: InvoiceLineResponse[];
  /** The benefit: a live evaluation while DRAFT, the frozen application once finalized. */
  discount: InvoiceDiscountResponse;
  /** Every payment ever recorded, oldest first (reversed ones included, with their correction). */
  payments: InvoicePaymentResponse[];
  /** Sum of the effective payments (0 for a zero-balance invoice). */
  paidVnd: string;
  /** Remaining amount to collect: total - paid while PENDING_PAYMENT, otherwise 0. */
  balanceVnd: string;
  /** Part of the balance held by a live PayOS request (cash can only collect the rest until it ends). */
  pendingProviderVnd: string;
  /** Unapplied PayOS money awaiting management review (only for CORRECT_PAYMENTS holders; else empty). */
  anomalies: InvoicePaymentAnomaly[];
  /** Management notes (only for CORRECT_PAYMENTS holders; else empty). */
  managementNotes: InvoiceManagementNoteResponse[];
  /** Finalization needs every line priced with a quantity. */
  readiness: { ready: boolean; unpricedLines: number };
  /** Which commands this actor may issue now (the API authorizes each again). */
  actions: {
    editPrices: boolean;
    setPayer: boolean;
    finalize: boolean;
    /** Supply or remove a voucher code (APPLY_DISCOUNTS) while DRAFT. */
    applyVouchers: boolean;
    /** Record a cash payment (COLLECT_PAYMENTS) while PENDING_PAYMENT. */
    collectPayment: boolean;
    /** Start a PayOS QR request (COLLECT_PAYMENTS) while PENDING_PAYMENT; the API also needs PayOS configured. */
    collectPayos: boolean;
    /** Review PayOS anomalies and add management notes (CORRECT_PAYMENTS). */
    manageAnomalies: boolean;
    /** Add a management note: the invoice was settled through a confirmed PayOS payment. */
    addManagementNote: boolean;
    cancel: boolean;
    /** A finalized invoice needs fresh password re-authentication to be cancelled. */
    cancelNeedsReauth: boolean;
  };
}

/** POST /api/v1/pos/visits/:visitId/invoice: opens the visit's active invoice, creating a DRAFT if none. */
export interface InvoiceOpenedResponse {
  invoice: InvoiceResponse;
  /** False when the visit already had an active invoice (a retry or another cashier created it). */
  created: boolean;
}

/** POST /api/v1/pos/invoices/:id/lines/:lineId/price: choose the price and/or quantity of one line (DRAFT only). */
export interface InvoiceLinePriceRequest {
  expectedVersion: number;
  /** Inside the historical [min, max] of the line. */
  unitPriceVnd?: string;
  /** A positive integer within the historical quantity limit (PER_SERVICE is exactly 1). */
  quantity?: number;
}

/** POST /api/v1/pos/invoices/:id/payer: a member (an id found by the exact lookup) or null for a guest payer. */
export interface InvoicePayerRequest {
  expectedVersion: number;
  payerUserId: string | null;
}

/** POST /api/v1/pos/invoices/:id/finalize: DRAFT -> PENDING_PAYMENT, or directly PAID for a receivable of exactly 0. */
export interface InvoiceFinalizeRequest {
  expectedVersion: number;
}

/** POST /api/v1/pos/invoices/:id/cancel (CANCEL_INVOICES; a finalized invoice needs fresh re-authentication). */
export interface InvoiceCancelRequest {
  expectedVersion: number;
  reason: string;
}

/**
 * POST /api/v1/pos/invoices/:id/payments (COLLECT_PAYMENTS at the invoice's branch). There is no time, change,
 * status or branch field: the server records the collector, the collection time and the change. `amountVnd`
 * is credited toward the invoice (a smaller amount than the balance is a split payment); `tenderedVnd` is what
 * the customer handed over (>= amountVnd). `idempotencyKey` (a client UUID, unique per collector) makes a
 * retry return the stored payment instead of collecting twice.
 */
export interface PaymentRecordRequest {
  method: 'CASH';
  amountVnd: string;
  tenderedVnd: string;
  idempotencyKey: string;
}

/**
 * POST /api/v1/pos/invoices/:id/payments/payos (COLLECT_PAYMENTS at the invoice's branch): asks PayOS for a QR
 * request for part or all of the remaining balance (Owner answer Q7 items 4 and 7). Only the amount and the
 * client's idempotency UUID can be supplied; the request expires 15 minutes after it is created and an invoice
 * has at most one pending request. Staff can never mark a transfer as received: the payment becomes
 * SUCCEEDED only when PayOS confirms it.
 */
export interface PaymentPayosRequest {
  amountVnd: string;
  idempotencyKey: string;
}

/** POST /api/v1/pos/invoices/:id/management-notes (CORRECT_PAYMENTS; PayOS-settled invoices only). */
export interface InvoiceManagementNoteRequest {
  note: string;
}

/** A payment anomaly with the invoice it belongs to (branch list for management). */
export interface PaymentAnomalyListItem extends InvoicePaymentAnomaly {
  invoice: { id: string; code: string; status: InvoiceStatusName; totalVnd: string };
}

export interface PaymentAnomalyListResponse {
  anomalies: PaymentAnomalyListItem[];
}

/** POST /api/v1/pos/payment-anomalies/:id/review (CORRECT_PAYMENTS): records that management looked at it. */
export interface PaymentAnomalyReviewRequest {
  note: string;
}

/** POST /api/v1/pos/invoices/:id/payments/:paymentId/reverse (CORRECT_PAYMENTS, reason, fresh re-authentication). */
export interface PaymentReverseRequest {
  reason: string;
}

/**
 * The result of recording or reversing a payment: the payment and the invoice's money state only. Reading
 * the whole invoice needs VIEW_INVOICES (independent of COLLECT_PAYMENTS / CORRECT_PAYMENTS), so a payment
 * command never returns more than its own effect; the screen re-reads the invoice.
 */
export interface PaymentResultResponse {
  payment: InvoicePaymentResponse;
  invoice: {
    id: string;
    code: string;
    status: InvoiceStatusName;
    totalVnd: string;
    paidVnd: string;
    balanceVnd: string;
    paidSeq: number;
    version: number;
  };
}

export interface PosBoardVisit {
  visitId: string;
  visitCode: string;
  serviceDate: string;
  completedAt: string | null;
  participants: string[];
  performedServices: number;
}

export interface PosBoardInvoice {
  id: string;
  code: string;
  status: InvoiceStatusName;
  visitId: string;
  visitCode: string;
  payerName: string | null;
  totalVnd: string;
  businessDate: string;
  createdAt: string;
}

/**
 * GET /api/v1/pos/branches/:branchId/board?date=YYYY-MM-DD (VIEW_INVOICES): completed visits still
 * without an active invoice and the invoices of a trailing 7-day window ending at `date` (a branch-local
 * business date; default today).
 */
export interface PosBoardResponse {
  branch: { id: string; name: string; timezone: string };
  date: string;
  windowStart: string;
  awaiting: PosBoardVisit[];
  invoices: PosBoardInvoice[];
  /** MANAGE_INVOICES here: the "open invoice" action is offered. */
  canManage: boolean;
}

// ------------------------------------------------------------------ Phase 4 Step 6: discounts / vouchers

export type DiscountKindName = 'PERCENT' | 'FIXED_AMOUNT';
export type DiscountScopeModeName = 'ALL_SERVICES' | 'SELECTED';

/** Why a candidate benefit is not eligible (a stable code; the UI shows a localized text). */
export type DiscountIneligibleReason =
  | 'NOT_ACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'VOUCHER_INACTIVE'
  | 'NO_ELIGIBLE_LINES'
  | 'BELOW_MIN_SPEND'
  | 'TOTAL_LIMIT_REACHED'
  | 'MEMBER_REQUIRED'
  | 'CUSTOMER_LIMIT_REACHED';

export interface InvoiceDiscountCandidate {
  source: 'PROMOTION' | 'VOUCHER';
  discountId: string;
  discountCode: string;
  nameVi: string;
  nameEn: string;
  versionId: string;
  versionNo: number;
  voucherId: string | null;
  voucherCode: string | null;
  kind: DiscountKindName;
  percentBp: number | null;
  fixedAmountVnd: string | null;
  /** In-scope lines' gross before any benefit (design OP-4); 0 when nothing is in scope. */
  eligibleSubtotalVnd: string;
  eligible: boolean;
  reason: DiscountIneligibleReason | null;
  /** The computed benefit; 0 when not eligible. */
  amountVnd: string;
  winner: boolean;
}

export interface InvoiceVoucherEntryResponse {
  id: string;
  voucherId: string;
  code: string;
  nameVi: string;
  nameEn: string;
  suppliedAt: string;
}

export interface InvoiceDiscountResponse {
  /** True while DRAFT: candidates are re-evaluated now; false once finalized (the stored application). */
  preview: boolean;
  candidates: InvoiceDiscountCandidate[];
  /** The one winning benefit, or null when none is eligible/worth more than 0. */
  winner: InvoiceDiscountCandidate | null;
  /** Why this benefit won (or null when there is none). */
  selectionReason: string | null;
  /** Codes supplied to the draft (kept as history after finalization). */
  vouchers: InvoiceVoucherEntryResponse[];
  appliedAt: string | null;
}

/** POST /api/v1/pos/invoices/:id/vouchers: supply a voucher code to a DRAFT (APPLY_DISCOUNTS). */
export interface InvoiceVoucherSupplyRequest {
  expectedVersion: number;
  code: string;
}

/** POST /api/v1/pos/invoices/:id/vouchers/:entryId/remove: withdraw a supplied code from a DRAFT. */
export interface InvoiceVoucherRemoveRequest {
  expectedVersion: number;
}

export interface DiscountVersionResponse {
  id: string;
  versionNo: number;
  kind: DiscountKindName;
  /** Basis points (1–10000); PERCENT only. */
  percentBp: number | null;
  /** Integer VND decimal string; FIXED_AMOUNT only. */
  fixedAmountVnd: string | null;
  validFrom: string;
  validUntil: string;
  minSpendVnd: string;
  scopeMode: DiscountScopeModeName;
  serviceIds: string[];
  categoryIds: string[];
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  createdAt: string;
}

export interface VoucherResponse {
  id: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  version: number;
  /** Active (unreleased) redemptions of this code. */
  redemptions: number;
}

export type DiscountStatusName = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'PAUSED' | 'TERMINATED';

export interface DiscountSummaryResponse {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  requiresCode: boolean;
  isActive: boolean;
  terminatedAt: string | null;
  /** Derived now from the active flag, termination and the current version's validity window. */
  status: DiscountStatusName;
  current: DiscountVersionResponse;
  /** Active (unreleased) redemptions of the program. */
  redemptions: number;
  voucherCount: number;
  version: number;
}

export interface DiscountListResponse {
  discounts: DiscountSummaryResponse[];
  permissions: { manage: boolean; createVouchers: boolean };
}

export interface DiscountDetailResponse extends DiscountSummaryResponse {
  terminatedReason: string | null;
  versions: DiscountVersionResponse[];
  vouchers: VoucherResponse[];
  permissions: { manage: boolean; createVouchers: boolean };
}

/** The configuration of one version. Owner-defined only; staff can never type a percentage or amount. */
export interface DiscountVersionInput {
  kind: DiscountKindName;
  percentBp?: number;
  fixedAmountVnd?: string;
  validFrom: string;
  validUntil: string;
  minSpendVnd: string;
  scopeMode: DiscountScopeModeName;
  serviceIds: string[];
  categoryIds: string[];
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
}

/** POST /api/v1/discounts (MANAGE_DISCOUNTS, GLOBAL only). */
export interface DiscountCreateRequest {
  code: string;
  nameVi: string;
  nameEn: string;
  requiresCode: boolean;
  version: DiscountVersionInput;
}

/** POST /api/v1/discounts/:id/versions: append a version (existing versions are never edited). */
export interface DiscountVersionRequest {
  expectedVersion: number;
  nameVi?: string;
  nameEn?: string;
  version: DiscountVersionInput;
}

export interface DiscountActiveRequest {
  expectedVersion: number;
  isActive: boolean;
}

export interface DiscountTerminateRequest {
  expectedVersion: number;
  reason: string;
}

/** POST /api/v1/discounts/:id/vouchers (CREATE_VOUCHERS, GLOBAL only); a code is generated when omitted. */
export interface VoucherCreateRequest {
  code?: string;
}

export interface VoucherActiveRequest {
  expectedVersion: number;
  isActive: boolean;
}

// ------------------------------------------------------------------ Phase 4 Step 9: customer invoice history

/**
 * A customer sees an invoice only once it is a finalized document (never a DRAFT, and never a draft that was
 * cancelled) and only when they are its payer. `CANCELLED` means cancelled after finalization.
 */
export type CustomerInvoiceStatus = 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';

export interface CustomerInvoiceSummary {
  id: string;
  /** The only customer-facing identifier (`INV-YYMMDD-XXXXXX`). */
  code: string;
  status: CustomerInvoiceStatus;
  /** Times are shown in the branch's IANA timezone. */
  branch: { id: string; name: string; timezone: string };
  /** Branch-local business date, `YYYY-MM-DD`. */
  businessDate: string;
  finalizedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  totalVnd: string;
  /** Sum of the payments that still count (0 for a zero-balance invoice). */
  paidVnd: string;
  /** Remaining amount while PENDING_PAYMENT, otherwise 0. */
  balanceVnd: string;
}

export interface CustomerInvoiceLine {
  sequence: number;
  nameVi: string;
  nameEn: string;
  quantity: number;
  unitPriceVnd: string;
  grossVnd: string;
  pricingUnit: 'PER_SERVICE' | 'PER_NAIL';
  /** The service was for the signed-in customer; otherwise `recipientName` is the name given at the desk or booking. */
  forSelf: boolean;
  recipientName: string | null;
}

/** A payment that was recorded; a reversed one stays listed and is flagged (its reason and staff are not shown). */
export interface CustomerInvoicePayment {
  id: string;
  method: 'CASH' | 'PAYOS';
  amountVnd: string;
  paidAt: string;
  reversed: boolean;
}

export interface CustomerInvoiceDetail extends CustomerInvoiceSummary {
  visitDate: string;
  subtotalVnd: string;
  discountTotalVnd: string;
  /** The benefit applied at finalization, if any (name and the voucher code the customer used). */
  discount: {
    nameVi: string;
    nameEn: string;
    voucherCode: string | null;
    amountVnd: string;
  } | null;
  lines: CustomerInvoiceLine[];
  payments: CustomerInvoicePayment[];
}

/** GET /api/v1/me/invoices?cursor= : newest first; `nextCursor` is passed back as `cursor` for the next page. */
export interface CustomerInvoiceListResponse {
  invoices: CustomerInvoiceSummary[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------------------------
// UX/UI Step 11: website media library (design 16.3). MANAGE_WEBSITE_CONTENT, GLOBAL only.
// ---------------------------------------------------------------------------------------------

export type MediaVariantName = 'thumb' | 'md' | 'lg';

/** One library image. The original is kept but never served; renditions are WebP (thumb 320w, md 960w, lg 1920w). */
export interface MediaAssetSummary {
  id: string;
  originalFilename: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: number;
  width: number;
  height: number;
  altVi: string | null;
  altEn: string | null;
  createdAt: string;
  rowVersion: number;
}

/** Where an image is used (filled by the popup and slider Steps); an image with any usage cannot be deleted. */
export interface MediaUsage {
  kind: 'POPUP' | 'SLIDE' | 'SEASON' | 'SHOP_INFO';
  id: string;
  title: string;
}

export interface MediaAssetDetail extends MediaAssetSummary {
  usedIn: MediaUsage[];
}

/** GET /api/v1/website/media?search=&page=  (24 per page, newest first). */
export interface MediaListResponse {
  items: MediaAssetSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /api/v1/website/media (multipart: file, altVi?, altEn?). The same bytes again return the existing asset. */
export interface MediaUploadResponse {
  asset: MediaAssetDetail;
  duplicate: boolean;
}

/** POST /api/v1/website/media/:id/alt : alt text only (never the file). VI alt is required before an image is used. */
export interface MediaUpdateRequest {
  expectedVersion: number;
  altVi: string | null;
  altEn: string | null;
}

// ---------------------------------------------------------------------------------------------
// UX/UI Step 12: the promotional popup (design 16.5). MANAGE_WEBSITE_CONTENT, GLOBAL only.
// ---------------------------------------------------------------------------------------------

/** Derived, never stored: Draft (disabled), Scheduled (enabled, not started), Active (live now), Ended. */
export type WebsitePopupStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED';

/** The fields an admin writes. `startsAt`/`endsAt` are ISO instants (the form enters them in Vietnam time). */
export interface WebsitePopupInput {
  mediaId: string | null;
  titleVi: string | null;
  titleEn: string | null;
  /** Plain text, at most 300 characters. */
  bodyVi: string | null;
  bodyEn: string | null;
  ctaLabelVi: string | null;
  ctaLabelEn: string | null;
  /** An internal path (`/vi/...`, `/en/...`, `/{locale}/...`) or an `https://` URL; a link needs a label. */
  ctaUrl: string | null;
  startsAt: string;
  endsAt: string;
  isEnabled: boolean;
  /**
   * Follow a season (design 20.6): the API then stores the season's window in place of `startsAt`/`endsAt` (what is
   * sent is ignored) and the popup is public only while its season is enabled. Absent or null = independent.
   */
  seasonId?: string | null;
}

/** The library image a popup shows, as much of it as a list or the form's preview needs. */
export interface WebsitePopupMedia {
  id: string;
  filename: string;
  width: number;
  height: number;
  altVi: string | null;
  altEn: string | null;
}

export interface WebsitePopupResponse extends WebsitePopupInput {
  id: string;
  seasonId: string | null;
  media: WebsitePopupMedia | null;
  status: WebsitePopupStatus;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/v1/website/popups : every popup, newest start first; `now` is the server clock the statuses use. */
export interface WebsitePopupListResponse {
  items: WebsitePopupResponse[];
  now: string;
}

/** POST /api/v1/website/popups/:id/update */
export interface WebsitePopupUpdateRequest extends WebsitePopupInput {
  expectedVersion: number;
}

/** POST /api/v1/website/popups/:id/enabled : publish or unpublish without touching the content. */
export interface WebsitePopupEnabledRequest {
  expectedVersion: number;
  isEnabled: boolean;
}

/** GET /api/v1/public/website/popup?locale=vi|en : the one live popup in the visitor's language, or 204. */
export interface PublicPopupResponse {
  id: string;
  /** Part of the "seen" key: an edited popup shows again. */
  rowVersion: number;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  image: {
    alt: string;
    width: number;
    height: number;
    /** Public renditions, narrowest first. */
    sources: { url: string; width: number }[];
  } | null;
}

// ---------------------------------------------------------------------------------------------
// UX/UI Step 13: the homepage slider (design 16.6). MANAGE_WEBSITE_CONTENT, GLOBAL only.
// ---------------------------------------------------------------------------------------------

/** Derived, never stored: Hidden (disabled), Scheduled (enabled, not started), Visible (live now), Ended. */
export type WebsiteSlideStatus = 'HIDDEN' | 'SCHEDULED' | 'VISIBLE' | 'ENDED';

/** The fields an admin writes. `startsAt`/`endsAt` are optional ISO instants (the form enters Vietnam time). */
export interface WebsiteSlideInput {
  /** The desktop image (required, recommended 1920 x 800). */
  mediaId: string;
  /** The phone image (optional, recommended 1080 x 1350); without it the main image is cropped to fit. */
  mobileMediaId: string | null;
  titleVi: string | null;
  titleEn: string | null;
  subtitleVi: string | null;
  subtitleEn: string | null;
  /** An internal path (`/vi/...`, `/en/...`, `/{locale}/...`) or an `https://` URL; a link needs a label. */
  linkUrl: string | null;
  linkLabelVi: string | null;
  linkLabelEn: string | null;
  /** Overrides the image's own description for this slide; empty means "use the image's". */
  altVi: string | null;
  altEn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isEnabled: boolean;
  /** Follow a season (design 20.6): same rule as the popup, the season window replaces `startsAt`/`endsAt`. */
  seasonId?: string | null;
}

export interface WebsiteSlideResponse extends WebsiteSlideInput {
  id: string;
  seasonId: string | null;
  media: WebsitePopupMedia;
  mobileMedia: WebsitePopupMedia | null;
  /** 1-based place in the slider; dense. */
  position: number;
  status: WebsiteSlideStatus;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/v1/website/slides : every slide in slider order; `now` is the server clock the statuses use. */
export interface WebsiteSlideListResponse {
  items: WebsiteSlideResponse[];
  now: string;
  /** At most this many slides may be visible at once. */
  maxVisible: number;
}

/** POST /api/v1/website/slides/:id/update */
export interface WebsiteSlideUpdateRequest extends WebsiteSlideInput {
  expectedVersion: number;
}

/** POST /api/v1/website/slides/:id/enabled : show or hide without touching the content. */
export interface WebsiteSlideEnabledRequest {
  expectedVersion: number;
  isEnabled: boolean;
}

/**
 * POST /api/v1/website/slides/reorder : every slide id in the new order, in one call. The list must be exactly
 * the slides that exist (a slide added or deleted meanwhile is `CONFLICT`: reload and arrange again).
 */
export interface WebsiteSlideReorderRequest {
  orderedIds: string[];
}

export interface PublicSlideImage {
  alt: string;
  width: number;
  height: number;
  /** Public renditions, narrowest first. */
  sources: { url: string; width: number }[];
}

export interface PublicSlide {
  id: string;
  title: string | null;
  subtitle: string | null;
  linkLabel: string | null;
  linkUrl: string | null;
  image: PublicSlideImage;
  /** The phone image, when the slide has one. */
  mobileImage: PublicSlideImage | null;
}

/** GET /api/v1/public/website/slides?locale=vi|en : the visible slides in order (at most 8), possibly none. */
export interface PublicSlidesResponse {
  items: PublicSlide[];
}

// ---------------------------------------------------------------------------------------------
// UX/UI Step S3: scheduled seasonal themes (design 20.4). MANAGE_WEBSITE_CONTENT, GLOBAL only.
// ---------------------------------------------------------------------------------------------

/** Derived, never stored: Draft (disabled), Scheduled (enabled, not started), Active (live now), Ended. */
export type WebsiteSeasonStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED';

/**
 * The decoration of a season (S6b): which of the seven slots draw (`particlesEnabled` is the particles slot), how
 * many particles, whether the greeting shows in the strip and in the footer scene, and the media-library image
 * that replaces a slot's drawn art (`slotMedia`: slot name -> media asset id).
 */
export interface SeasonDecorationFields {
  slotHeader: boolean;
  slotLogo: boolean;
  slotCorners: boolean;
  slotDividers: boolean;
  slotFooter: boolean;
  slotTint: boolean;
  greetingStrip: boolean;
  greetingFooter: boolean;
  particleDensity: SeasonDensity;
  slotMedia: Partial<Record<SeasonSlot, string>>;
}

/**
 * The fields an admin writes. `startsAt`/`endsAt` are ISO instants; the end is exclusive. The decoration fields are
 * optional so an older client keeps working: omitted on create means all on, medium, no images; omitted on update
 * means unchanged.
 */
export interface WebsiteSeasonInput extends Partial<SeasonDecorationFields> {
  /** One of `SEASON_PRESET_KEYS`. */
  presetKey: string;
  /** The event name, 1-80 characters (for example "Tet 2027" or "Grand opening"). */
  label: string;
  startsAt: string;
  endsAt: string;
  /** Plain text, at most 80 characters; empty (null) means the preset default. */
  greetingVi: string | null;
  greetingEn: string | null;
  applyCustomer: boolean;
  applyAdmin: boolean;
  particlesEnabled: boolean;
  isEnabled: boolean;
}

export interface WebsiteSeasonResponse
  extends Omit<WebsiteSeasonInput, keyof SeasonDecorationFields>, SeasonDecorationFields {
  id: string;
  status: WebsiteSeasonStatus;
  /** Ids of the popups and slides that follow this season. */
  popupIds: string[];
  slideIds: string[];
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/v1/website/seasons : every season, newest start first; `now` is the server clock the statuses use. */
export interface WebsiteSeasonListResponse {
  items: WebsiteSeasonResponse[];
  now: string;
}

/** POST /api/v1/website/seasons/:id/update */
export interface WebsiteSeasonUpdateRequest extends WebsiteSeasonInput {
  expectedVersion: number;
}

/** POST /api/v1/website/seasons/:id/enabled : switch on or off without touching the content. */
export interface WebsiteSeasonEnabledRequest {
  expectedVersion: number;
  isEnabled: boolean;
}

/**
 * GET /api/v1/public/website/season?locale=vi|en : the one active season in the visitor's language, or 204
 * (none active, or both `customer` and `admin` are off). No personal data, no cookie. The mobile app reads the
 * same answer plus the shared registry.
 */
export interface PublicSeasonResponse {
  presetKey: string;
  /** The schedule's greeting in the locale, else the preset default. */
  greeting: string;
  /** Exclusive end, ISO instant. */
  endsAt: string;
  particles: boolean;
  /** The customer side (website, customer area, app) wears the season. */
  customer: boolean;
  /** The admin side gets its subtle touch. */
  admin: boolean;
  /** The seven decoration slots (S6b); `particles` equals the field above. A kit without a slot ignores it. */
  slots: SeasonSlotSwitches;
  density: SeasonDensity;
  /** Whether the greeting shows in the strip under the header and in the footer scene. */
  greetingStrip: boolean;
  greetingFooter: boolean;
  /** Images that replace a slot's drawn art: slot name -> public URL. */
  media: Partial<Record<SeasonSlot, string>>;
}

// UX/UI Part 2 (P2-2): the public shop profile and the public service catalogue (docs/UXUI_REDESIGN_PART2_DESIGN.md 6).
// Shop info is edited with MANAGE_WEBSITE_CONTENT (GLOBAL only); both public reads are anonymous and cached for 60 s.

/** One group of opening hours: the ISO weekdays (1 = Monday ... 7 = Sunday) that share the same hours. */
export interface PublicHoursGroup {
  weekdays: number[];
  closed: boolean;
  /** `HH:MM` in the branch time zone; null when closed. */
  opensAt: string | null;
  closesAt: string | null;
}

export interface PublicSiteImage {
  alt: string;
  width: number;
  height: number;
  /** Narrowest first. */
  sources: { url: string; width: number }[];
}

export interface PublicSiteResponse {
  tagline: string;
  address: string;
  /** As the Owner typed it, for display. */
  hotline: string;
  /** For a `tel:` link, digits with a leading plus (`+84934936101`). */
  hotlineTel: string;
  mapUrl: string | null;
  /** The branch time zone the hours are in. */
  timezone: string;
  hours: PublicHoursGroup[];
  heroImage: PublicSiteImage | null;
}

export interface WebsiteShopInfoInput {
  taglineVi: string;
  taglineEn: string;
  address: string;
  hotline: string;
  mapUrl: string | null;
  hoursBranchId: string | null;
  heroMediaId: string | null;
}

export interface WebsiteShopInfoUpdateRequest extends WebsiteShopInfoInput {
  expectedVersion: number;
}

export interface WebsiteShopInfoBranchOption {
  id: string;
  code: string;
  name: string;
}

export interface WebsiteShopInfoResponse extends WebsiteShopInfoInput {
  rowVersion: number;
  updatedAt: string;
  /** The active branches the hours can come from. */
  branches: WebsiteShopInfoBranchOption[];
  /** The branch the hours currently come from (the chosen one, or the first active branch), or null when there is none. */
  hoursBranch: WebsiteShopInfoBranchOption | null;
  /** Read-only preview of those hours, as the public site shows them. */
  hours: PublicHoursGroup[];
  timezone: string | null;
}

export type PublicPricingUnit = 'PER_SERVICE' | 'PER_NAIL';

/** A service as a visitor sees it. Only the customer-facing estimate is public; the scheduling duration never is. */
export interface PublicService {
  code: string;
  name: string;
  description: string | null;
  /** Integer VND as a string; `priceMinVnd` equals `priceMaxVnd` for an exact price. */
  priceMinVnd: string;
  priceMaxVnd: string;
  pricingUnit: PublicPricingUnit;
  estimatedMinMinutes: number;
  estimatedMaxMinutes: number;
}

export interface PublicServiceGroup {
  code: string;
  name: string;
  services: PublicService[];
}

export interface PublicServicesResponse {
  groups: PublicServiceGroup[];
}

export interface PublicServiceDetailResponse {
  service: PublicService;
  group: { code: string; name: string };
  /** The other services of the same group, in catalogue order. */
  related: PublicService[];
}
