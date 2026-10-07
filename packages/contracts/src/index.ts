/** Public, transport-only contracts. No ORM, Node runtime or domain implementation exports. */
import type {
  NotificationCategory,
  NotificationEntityType,
  NotificationParams,
  NotificationType,
} from './notification-registry.js';
import type { InvoiceBirthdayGift } from './birthday.js';
import type {
  InvoiceComboLineResponse,
  InvoiceKindName,
  InvoiceLineComboUseResponse,
} from './combo.js';
import type { InvoiceMemberCandidate } from './loyalty.js';
import type { InvoiceChannelName, InvoiceProductLineResponse } from './product-sale.js';
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
  /**
   * Optional referrer (P5-5): the phone of the member who recommended Lucy Spa. Accepted when well-formed and resolved silently
   * when the account is activated; the response never reveals whether it belongs to a member.
   */
  referrerPhone?: string;
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
  | 'MANAGE_WEBSITE_CONTENT'
  | 'VIEW_LOYALTY'
  | 'ADJUST_LOYALTY_POINTS'
  | 'MANAGE_REFERRALS'
  | 'MANAGE_COMBOS'
  | 'SELL_COMBOS'
  | 'CONSUME_COMBO_SESSIONS'
  | 'RESTORE_COMBO_SESSIONS'
  | 'MANAGE_BIRTHDAY_REWARDS'
  | 'MANAGE_REWARD_CATALOG'
  | 'ISSUE_REWARDS'
  | 'VIEW_LOYALTY_EXCEPTIONS'
  | 'MANAGE_PRODUCTS'
  | 'MANAGE_PRODUCT_PRICES'
  | 'VIEW_PRODUCT_COST'
  | 'VIEW_INVENTORY'
  | 'MANAGE_STOCK_RECEIPTS'
  | 'ADJUST_STOCK'
  | 'IMPORT_PRODUCT_DATA'
  | 'SELL_PRODUCTS'
  | 'MANAGE_PRODUCT_RETURNS'
  | 'REFUND_PRODUCTS'
  | 'MANAGE_PRODUCT_CAMPAIGNS'
  | 'ACTIVATE_LOYALTY'
  | 'CHANGE_REFERRER';

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
    /** Whole minutes started before the planned start; 0 when on time or late. */
    startedEarlyMinutes: number;
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
  execution: {
    startedAt: string;
    expectedEndAt: string;
    overdue: boolean;
    /** Whole minutes started before the planned start; 0 when on time or late. */
    startedEarlyMinutes: number;
  } | null;
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
  | 'SERVICE_START_UNAVAILABLE'
  /** Early START only (planned start still ahead): other work of the KTV is in the way. */
  | 'SERVICE_EARLY_START_CONFLICT'
  /** Early START only: a collaborator's scheduled shift does not cover the early period. */
  | 'SERVICE_EARLY_START_OUTSIDE_SHIFT';

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
    /** Whole minutes started before the planned start; 0 when on time or late. */
    startedEarlyMinutes: number;
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
// Phase 5 P5-3: loyalty tiers, points and the admin loyalty API.
export * from './loyalty.js';
// Phase 5 P5-5: referral (bind, Owner correction, list).
export * from './referral.js';
// Phase 5 P5-6: the birthday gift (Owner configuration and the invoice layer).
export * from './birthday.js';
// Phase 5 P5-7: combos (definitions, the counter sale and its invoice line).
export * from './combo.js';
// Phase 5 P5-9: the gift / benefit catalog framework (definitions, issuing, marking used, revoking).
export * from './reward.js';
// Phase 5 P5-10: the customer's own membership page (points, combos, referrals, gifts; read only).
export * from './customer-loyalty.js';
// Owner request 2026-10-06: the shop's Facebook / Zalo contact links (validation and the links the public site opens).
export * from './contact-links.js';
// Phase 6 P6-8: product lines on invoices (seller, reservation, product-only invoices).
export * from './product-sale.js';
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
  /** Phase 5 P5-8: the combo session that pays this line (a 0 VND line), or null. */
  comboUse: InvoiceLineComboUseResponse | null;
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
  /** `VISIT`: an invoice of a completed visit (`lines`). `COMBO_SALE` (Phase 5 P5-7): a counter sale of a combo (`comboLine`), no visit. */
  kind: InvoiceKindName;
  /** Null for a combo sale. */
  visit: { id: string; code: string; serviceDate: string; completedAt: string | null } | null;
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
  /** The performed-service lines of a VISIT invoice; empty for a combo sale. */
  lines: InvoiceLineResponse[];
  /** The single combo line of a COMBO_SALE invoice; null for a VISIT invoice. */
  comboLine: InvoiceComboLineResponse | null;
  /** Phase 6 P6-8: the product lines of a VISIT or PRODUCT_SALE invoice (empty for service-only invoices and combo sales). */
  productLines: InvoiceProductLineResponse[];
  /** Phase 6 P6-8 (T33): `COUNTER` until the online channel exists; the shipping fee is 0 unless ONLINE. total = subtotal - discount + fee. */
  channel: InvoiceChannelName;
  shippingFeeVnd: string;
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
    /** Pay a service line with a combo session (CONSUME_COMBO_SESSIONS and MANAGE_INVOICES) while DRAFT (Phase 5 P5-8). */
    useCombos: boolean;
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
    /** Phase 6 P6-8: add, change or remove product lines (SELL_PRODUCTS at the branch) while DRAFT. */
    sellProducts: boolean;
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
  kind: InvoiceKindName;
  /** Null for a combo sale (no visit). */
  visitId: string | null;
  visitCode: string | null;
  /** The combo sold, for a combo sale; null for a visit invoice. */
  comboName: { vi: string; en: string } | null;
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
  /** SELL_COMBOS and MANAGE_INVOICES here: the "sell a combo" action is offered (Phase 5 P5-7). */
  canSellCombos: boolean;
}

// ------------------------------------------------------------------ Phase 4 Step 6: discounts / vouchers

export type DiscountKindName = 'PERCENT' | 'FIXED_AMOUNT';
/** `ALL_SERVICES` means "every item of the program's scope" (Phase 6 P6-9: the scope below decides services, products or both). */
export type DiscountScopeModeName = 'ALL_SERVICES' | 'SELECTED';
/** Phase 6 P6-9 (Q7): what a program may discount. Every program that existed before Phase 6 is `SERVICES`. */
export type DiscountScopeName = 'SERVICES' | 'PRODUCTS' | 'BOTH';
/** Phase 6 P6-9 (T17): the two sides of an invoice. SPA = service and combo lines (Spa wallet); BEAUTY = product lines (Beauty wallet). */
export type PricingSideName = 'SPA' | 'BEAUTY';

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
  /** The computed benefit; 0 when not eligible. On a version 3 invoice it is THIS SIDE's share of a shared program. */
  amountVnd: string;
  winner: boolean;
  /** Version 3 (P6-9), a shared (BOTH) program only: the program-level eligible subtotal and amount that were split between the sides. */
  shared?: { eligibleSubtotalVnd: string; amountVnd: string } | null;
}

/**
 * Phase 6 P6-9 (T17): one side of a version 3 invoice (an invoice with a product line). Each side has its own subtotal, candidates,
 * single winner, discount and net amount; the Spa side's discount includes the birthday gift.
 */
export interface InvoiceSideDiscount {
  side: PricingSideName;
  subtotalVnd: string;
  discountVnd: string;
  netVnd: string;
  candidates: InvoiceDiscountCandidate[];
  winner: InvoiceDiscountCandidate | null;
  winnerSource: 'PROMOTION' | 'VOUCHER' | 'MEMBER_TIER' | 'BIRTHDAY' | null;
  member: InvoiceMemberCandidate | null;
  birthday: InvoiceBirthdayGift | null;
  selectionReason: string | null;
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
  /** The winning PROGRAM benefit (promotion or voucher); null when none won or when the Member Discount won (see `winnerSource`). */
  winner: InvoiceDiscountCandidate | null;
  /** Which kind of benefit is the invoice discount: a promotion, a voucher or the member tier (Phase 5); null when none. */
  winnerSource: 'PROMOTION' | 'VOUCHER' | 'MEMBER_TIER' | 'BIRTHDAY' | null;
  /** The Member Discount candidate (payer is a member and loyalty is live); null otherwise. */
  member: InvoiceMemberCandidate | null;
  /**
   * The birthday gift layer (Phase 5 P5-6), applied AFTER the single ordinary winner: present when the payer's birthday window
   * contains the invoice date. `winnerSource` is `BIRTHDAY` only when the gift is the invoice's only benefit.
   */
  birthday: InvoiceBirthdayGift | null;
  /** Why this benefit won (or null when there is none). */
  selectionReason: string | null;
  /** Codes supplied to the draft (kept as history after finalization). */
  vouchers: InvoiceVoucherEntryResponse[];
  appliedAt: string | null;
  /**
   * Phase 6 P6-9: present exactly for an invoice with a product line (version 3): both sides, Spa first. The fields above then describe
   * the Spa side (empty for a product-only invoice), so a reader that knows only one side keeps working.
   */
  sides?: InvoiceSideDiscount[];
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
  /** Phase 6 P6-9 (Q7): what the program may discount; absent = SERVICES (a response from before Phase 6, or any fixture of it). */
  scope?: DiscountScopeName;
  /** Product targets of a PRODUCTS or BOTH selection (OQ-P6-21); a product category also covers all its subcategories (OQ-66, changed 2026-10-08). */
  brandIds?: string[];
  productCategoryIds?: string[];
  productIds?: string[];
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
  /**
   * Phase 6 P6-9: absent = SERVICES. Appending a version to a program whose scope is not SERVICES must state the scope (leaving it out
   * would silently turn it back into a services-only program); the screens for it come with P6-11.
   */
  scope?: DiscountScopeName;
  brandIds?: string[];
  productCategoryIds?: string[];
  productIds?: string[];
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
  /** `COMBO_SALE`: the member bought a combo at the counter (no visit). */
  kind: InvoiceKindName;
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
  kind: 'POPUP' | 'SLIDE' | 'SEASON' | 'SHOP_INFO' | 'PRODUCT';
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

/** The icons an Owner can give a custom fact; the web draws them with the kit's icons of the same names. */
export const SHOP_FACT_ICONS = [
  'clock',
  'map-pin',
  'phone',
  'calendar',
  'sparkles',
  'award',
  'shield',
  'globe',
  'tag',
  'info',
] as const;
export type ShopFactIcon = (typeof SHOP_FACT_ICONS)[number];

/** The icons of a "why choose us" card: one line-icon set, drawn in the theme's brand colours (light and dark). */
export const WHY_ICONS = [
  'sparkles',
  'heart',
  'clock',
  'leaf',
  'droplet',
  'towel',
  'flower',
  'shield',
  'award',
  'gem',
  'smile',
  'calendar-check',
] as const;
export type WhyIcon = (typeof WHY_ICONS)[number];

/** One card of the optional "why choose us" section, as the Owner edits it (both languages required). */
export interface WebsiteWhyCard {
  /** A UUID chosen by the form. */
  id: string;
  icon: WhyIcon;
  headingVi: string;
  headingEn: string;
  descriptionVi: string;
  descriptionEn: string;
}

export interface PublicWhyCard {
  icon: WhyIcon;
  heading: string;
  description: string;
}

/** The "why choose us" section in the visitor's language. Absent from `PublicSiteResponse.why` while hidden or empty. */
export interface PublicWhy {
  title: string;
  cards: PublicWhyCard[];
}
export type ShopFactKind = 'HOURS' | 'ADDRESS' | 'HOTLINE' | 'CUSTOM';

/**
 * One item of the home page's facts strip, as the Owner edits it. The three built-in items (opening hours, address,
 * hotline) can be hidden and moved but not deleted; their text comes from the shop profile. A custom item has its own
 * icon and one line of text per language (both required, so a visitor never sees the other language).
 */
export interface WebsiteShopFact {
  /** `hours`, `address`, `hotline` for the built-ins; a UUID chosen by the form for a custom item. */
  id: string;
  kind: ShopFactKind;
  visible: boolean;
  icon: ShopFactIcon | null;
  textVi: string | null;
  textEn: string | null;
}

/** A group of the service catalogue shown on the home page, with the Owner's short description (either language optional). */
export interface WebsiteFeaturedGroup {
  code: string;
  descriptionVi: string | null;
  descriptionEn: string | null;
}

export interface WebsiteGroupOption {
  code: string;
  nameVi: string;
  nameEn: string;
}

/** A visible fact for the visitor: built-ins carry no text (the site formats hours, address and hotline itself). */
export interface PublicFact {
  kind: ShopFactKind;
  icon: ShopFactIcon;
  text: string | null;
}

export interface PublicFeaturedGroup {
  code: string;
  description: string | null;
}

/** The social networks of a footer "social icons" block, in the order the icons are drawn. */
export const FOOTER_SOCIAL_NETWORKS = [
  'facebook',
  'zalo',
  'tiktok',
  'instagram',
  'youtube',
  'messenger',
] as const;
export type FooterSocialNetwork = (typeof FOOTER_SOCIAL_NETWORKS)[number];

/** The block types of the footer's brand column (Owner request 2026-10-04). */
export const FOOTER_BLOCK_TYPES = ['SOCIAL', 'APP', 'TEXT', 'LINKS', 'IMAGE', 'SLOGAN'] as const;
export type FooterBlockType = (typeof FOOTER_BLOCK_TYPES)[number];

/** A block's identity and visibility, common to every type. `id` is a UUID chosen by the form. */
interface WebsiteFooterBlockBase {
  id: string;
  visible: boolean;
}

/** Round icon buttons, one per network that has a link (https only); a network with no link is not drawn. */
export interface WebsiteFooterSocialBlock extends WebsiteFooterBlockBase {
  type: 'SOCIAL';
  urls: Record<FooterSocialNetwork, string | null>;
}

/** The official Google Play and App Store badges, each drawn only when its https link is set. */
export interface WebsiteFooterAppBlock extends WebsiteFooterBlockBase {
  type: 'APP';
  googlePlayUrl: string | null;
  appStoreUrl: string | null;
}

/** A short plain-text paragraph, in both languages. */
export interface WebsiteFooterTextBlock extends WebsiteFooterBlockBase {
  type: 'TEXT';
  textVi: string;
  textEn: string;
}

/** One link of a link list: a label per language and an https address or a site path (`/services`). */
export interface WebsiteFooterLink {
  labelVi: string;
  labelEn: string;
  url: string;
}

/** A list of links with an optional title (both languages or neither). */
export interface WebsiteFooterLinksBlock extends WebsiteFooterBlockBase {
  type: 'LINKS';
  titleVi: string | null;
  titleEn: string | null;
  items: WebsiteFooterLink[];
}

/** A picture from the media library, optionally a link (https address or site path). Its alt text is the media's. */
export interface WebsiteFooterImageBlock extends WebsiteFooterBlockBase {
  type: 'IMAGE';
  mediaId: string;
  linkUrl: string | null;
}

/** The shop slogan (the Shop info tagline); no settings of its own. */
export interface WebsiteFooterSloganBlock extends WebsiteFooterBlockBase {
  type: 'SLOGAN';
}

export type WebsiteFooterBlock =
  | WebsiteFooterSocialBlock
  | WebsiteFooterAppBlock
  | WebsiteFooterTextBlock
  | WebsiteFooterLinksBlock
  | WebsiteFooterImageBlock
  | WebsiteFooterSloganBlock;

/** A footer block as a visitor gets it: visible and complete only, one language, links already resolved. */
export type PublicFooterBlock =
  | { id: string; type: 'SOCIAL'; links: { network: FooterSocialNetwork; url: string }[] }
  | { id: string; type: 'APP'; googlePlayUrl: string | null; appStoreUrl: string | null }
  | { id: string; type: 'TEXT'; text: string }
  | {
      id: string;
      type: 'LINKS';
      title: string | null;
      items: { label: string; url: string }[];
    }
  | { id: string; type: 'IMAGE'; image: PublicSiteImage; linkUrl: string | null }
  | { id: string; type: 'SLOGAN'; text: string };

export interface PublicSiteResponse {
  tagline: string;
  /**
   * The blocks under the footer logo, in the Owner's order. Empty by default: the footer then shows only the logo
   * (nothing is seeded; the slogan appears only through a SLOGAN block).
   */
  footerBlocks: PublicFooterBlock[];
  /** The visible items of the facts strip, in the Owner's order; empty when the whole strip is hidden. */
  facts: PublicFact[];
  /**
   * The groups the Owner chose for the home page, in their order. Empty means none chosen: the home then lists every
   * group of the catalogue (without descriptions).
   */
  featuredGroups: PublicFeaturedGroup[];
  /** The optional "why choose us" section (hidden by default: the Owner writes it); null when hidden or empty. */
  why: PublicWhy | null;
  /** The sentence under the home headline in the visitor language; null when the Owner set none (the site then uses its own text). */
  intro: string | null;
  address: string;
  /** As the Owner typed it, for display. */
  hotline: string;
  /** For a `tel:` link, digits with a leading plus (`+84934936101`). */
  hotlineTel: string;
  mapUrl: string | null;
  /** The Facebook page link for the footer icon; null when the Owner set none. */
  facebookUrl: string | null;
  /** `https://m.me/<page>` for the Messenger button, derived from the Facebook page; null when there is none. */
  messengerUrl: string | null;
  /** `https://zalo.me/...` for the Zalo button and footer icon; null when the Owner set none. */
  zaloUrl: string | null;
  /** The branch time zone the hours are in. */
  timezone: string;
  hours: PublicHoursGroup[];
  heroImage: PublicSiteImage | null;
}

export interface WebsiteShopInfoInput {
  taglineVi: string;
  taglineEn: string;
  /** Optional; null (or empty) falls back to the website's built-in sentence. */
  introVi: string | null;
  introEn: string | null;
  address: string;
  hotline: string;
  mapUrl: string | null;
  /** Optional Facebook page link (https); also gives the Messenger link. See `facebookPageLinks`. */
  facebookUrl: string | null;
  /** Optional Zalo number or `https://zalo.me/...` link. See `zaloLink`. */
  zaloContact: string | null;
  hoursBranchId: string | null;
  heroMediaId: string | null;
  /** Show the facts strip at all. */
  factsVisible: boolean;
  /** Ordered; always contains the three built-in items once. */
  facts: WebsiteShopFact[];
  /** Ordered; empty = every group, no descriptions. */
  featuredGroups: WebsiteFeaturedGroup[];
  /** Show the "why choose us" section (off by default; needs a title in both languages and at least one card). */
  whyVisible: boolean;
  whyTitleVi: string | null;
  whyTitleEn: string | null;
  /** Ordered. */
  whyCards: WebsiteWhyCard[];
  /** The footer's brand-column blocks, ordered; empty by default (the footer then shows only the logo). */
  footerBlocks: WebsiteFooterBlock[];
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
  /** The active catalogue groups the Owner can feature on the home page. */
  groupOptions: WebsiteGroupOption[];
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

// ---------------------------------------------------------------------------------------------------------------
// Phase 6 P6-6: the public cosmetics catalog (design 11.1, 16). Anonymous and read-only. Only PUBLISHED products with at
// least one active, priced variant appear. A response never carries a cost, a quantity, a branch, an internal id or a SKU:
// stock is a state, never a number.
// ---------------------------------------------------------------------------------------------------------------

export const PUBLIC_PRODUCT_SORTS = ['featured', 'newest', 'price_asc', 'price_desc'] as const;
export type PublicProductSort = (typeof PUBLIC_PRODUCT_SORTS)[number];
export const PUBLIC_PRODUCTS_PAGE_SIZE = 20;

/**
 * What a visitor learns about availability. IN_STOCK shows nothing; PRE_ORDER reads "Đặt trước, dự kiến n ngày" with the
 * waiting time in days; OUT_OF_STOCK reads "Hết hàng". The waiting time is present only for PRE_ORDER.
 */
export interface PublicProductStock {
  state: 'IN_STOCK' | 'PRE_ORDER' | 'OUT_OF_STOCK';
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
}

/** The price of one thing: what is paid now, the struck list price while a promotion runs, and its rounded percent. */
export interface PublicProductPrice {
  priceVnd: string;
  /** The list price, only while a promotion makes the price lower; null otherwise. */
  listPriceVnd: string | null;
  /** Round half up of (list - price) / list in whole percent, 1 to 99; null when there is no promotion or it rounds to nothing. */
  discountPercent: number | null;
}

export interface PublicProductCategoryRef {
  code: string;
  name: string;
}

/** One product as a card of the list and of the related products. */
export interface PublicProductCard {
  code: string;
  name: string;
  category: PublicProductCategoryRef | null;
  brand: string | null;
  image: PublicSlideImage | null;
  /** The cheapest variant's price (with its struck list price and percent); `priceMaxVnd` differs when the prices differ. */
  price: PublicProductPrice;
  priceMaxVnd: string;
  isNew: boolean;
  featured: boolean;
  stock: PublicProductStock;
}

export interface PublicProductCategory extends PublicProductCategoryRef {
  /** The parent's code when it is a sub-category; filtering by a parent includes its sub-categories. */
  parentCode: string | null;
}

/** The hero of the page as the Owner wrote it; null while the Owner has written none of it. */
export interface PublicProductsHero {
  title: string | null;
  text: string | null;
  image: PublicSlideImage | null;
}

/** The commitment box as the Owner wrote it; null while it has no lines. */
export interface PublicProductsCommitment {
  title: string | null;
  items: string[];
}

/** GET /api/v1/public/products?locale&q&category&brand&sort&page : one page of the catalog and what the filters need. */
export interface PublicProductsResponse {
  hero: PublicProductsHero | null;
  commitment: PublicProductsCommitment | null;
  /** Categories that hold at least one visible product (a parent holds its children's products too). */
  categories: PublicProductCategory[];
  /** Brands that hold at least one visible product. */
  brands: { code: string; name: string }[];
  items: PublicProductCard[];
  page: number;
  pageSize: number;
  /** Products matching the filters, over all pages. */
  total: number;
}

export interface PublicProductVariant {
  label: string | null;
  price: PublicProductPrice;
  stock: PublicProductStock;
}

export interface PublicProductDetail {
  code: string;
  name: string;
  description: string | null;
  category: PublicProductCategoryRef | null;
  brand: string | null;
  images: PublicSlideImage[];
  /** In the shop's own order. */
  variants: PublicProductVariant[];
  priceMaxVnd: string;
  isNew: boolean;
  featured: boolean;
  stock: PublicProductStock;
}

/** GET /api/v1/public/products/:code?locale : one visible product, 404 for anything else (draft, discontinued, unknown). */
export interface PublicProductDetailResponse {
  product: PublicProductDetail;
  commitment: PublicProductsCommitment | null;
  /** Up to four other products of the same category. */
  related: PublicProductCard[];
}

/** GET /api/v1/public/products/codes : the codes of every visible product, for the sitemap (at most 5000). */
export interface PublicProductCodesResponse {
  codes: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 6 P6-3: product catalog administration (design PHASE6_PRODUCTS_INVENTORY_DESIGN.md sections 3 and 16.5).
// Money is integer VND carried as a decimal string. Cost price and margin exist ONLY in responses built for a caller
// who holds VIEW_PRODUCT_COST: for everyone else the keys are absent (never null), on every endpoint.
// ---------------------------------------------------------------------------------------------------------------

export type ProductStatusName = 'DRAFT' | 'PUBLISHED' | 'INACTIVE';

/** What the caller may do with the catalog (UX hints; the API decides again on every request). */
export interface ProductAccess {
  /** MANAGE_PRODUCTS: brands, categories, products, variants, images, status. */
  manage: boolean;
  /** MANAGE_PRODUCT_PRICES: list price, promotions. */
  prices: boolean;
  /** VIEW_PRODUCT_COST: cost price and margin. */
  cost: boolean;
}

export interface ProductBrandResponse {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  isActive: boolean;
  rowVersion: number;
  productCount: number;
}

export interface ProductBrandListResponse {
  brands: ProductBrandResponse[];
  access: ProductAccess;
}

/** POST /api/v1/product-brands. The code is derived from the English name and never changes. */
export interface ProductBrandCreateRequest {
  nameVi: string;
  nameEn: string;
}

/** POST /api/v1/product-brands/:id/edit */
export interface ProductBrandEditRequest {
  expectedRowVersion: number;
  nameVi: string;
  nameEn: string;
  isActive: boolean;
}

export interface ProductCategoryResponse {
  id: string;
  parentId: string | null;
  code: string;
  nameVi: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
  rowVersion: number;
  productCount: number;
}

export interface ProductCategoryListResponse {
  categories: ProductCategoryResponse[];
  access: ProductAccess;
}

/** POST /api/v1/product-categories. At most two levels: a parent must itself be a top-level category. */
export interface ProductCategoryCreateRequest {
  parentId: string | null;
  nameVi: string;
  nameEn: string;
  sortOrder?: number;
}

/** POST /api/v1/product-categories/:id/edit */
export interface ProductCategoryEditRequest {
  expectedRowVersion: number;
  parentId: string | null;
  nameVi: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductNameRef {
  id: string;
  nameVi: string;
  nameEn: string;
}

/** One row of the products list. It never carries a cost. */
export interface ProductListItem {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  status: ProductStatusName;
  featured: boolean;
  brand: ProductNameRef | null;
  category: ProductNameRef | null;
  activeVariantCount: number;
  /** Lowest and highest effective price of the active variants that have a price; null when none is priced. */
  priceFromVnd: string | null;
  priceToVnd: string | null;
  /** The first image of the product (media library asset id), or null. */
  coverMediaId: string | null;
  rowVersion: number;
  updatedAt: string;
}

export interface ProductListResponse {
  products: ProductListItem[];
  access: ProductAccess;
}

export type ProductPromotionState = 'SCHEDULED' | 'ACTIVE' | 'ENDED';

export interface ProductPromotionResponse {
  id: string;
  promoPriceVnd: string;
  startsAt: string;
  /** The planned end. */
  endsAt: string;
  /** Set when someone ended it by hand before `endsAt`. */
  endedEarlyAt: string | null;
  state: ProductPromotionState;
  createdByName: string;
}

export interface ProductPriceVersionResponse {
  versionNo: number;
  listPriceVnd: string;
  reason: string | null;
  createdAt: string;
  createdByName: string;
}

export interface ProductVariantResponse {
  id: string;
  sku: string;
  labelVi: string | null;
  labelEn: string | null;
  barcode: string | null;
  lowStockThreshold: number | null;
  /** Sold on order: the shop orders it from the supplier after payment (Owner, OQ-P6-30; on by default). */
  sellOnOrder: boolean;
  /** This variant's own waiting time in days (both set or both null); null means the settings default applies. */
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  sortOrder: number;
  isActive: boolean;
  rowVersion: number;
  /** The current list price (newest version), or null before a price is set. */
  listPriceVnd: string | null;
  /** The number of the newest price version (0 before a price is set); send it back as `expectedVersionNo`. */
  priceVersionNo: number;
  /** The price a customer pays now: the running promotion's price, else the list price. */
  effectivePriceVnd: string | null;
  /** The promotion running now, if any. */
  activePromotion: ProductPromotionResponse | null;
  /** Every promotion of the variant, newest start first (the price-change history of promotions). */
  promotions: ProductPromotionResponse[];
  /** Every list price version, newest first. */
  priceHistory: ProductPriceVersionResponse[];
  /**
   * ONLY for a caller who holds VIEW_PRODUCT_COST; the keys are absent otherwise. `marginVnd` is the effective price
   * minus the cost, computed on the server.
   */
  costPriceVnd?: string | null;
  marginVnd?: string | null;
}

export interface ProductImageResponse {
  id: string;
  mediaAssetId: string;
  altVi: string | null;
  sortOrder: number;
}

/** The full product: every product command returns this same shape. */
export interface ProductDetailResponse {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string | null;
  descriptionEn: string | null;
  status: ProductStatusName;
  featured: boolean;
  publishedAt: string | null;
  brand: ProductNameRef | null;
  category: ProductNameRef | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  variants: ProductVariantResponse[];
  images: ProductImageResponse[];
  /** Active brands and categories to choose from, plus the current ones even when inactive. */
  brandOptions: ProductNameRef[];
  categoryOptions: ProductNameRef[];
  access: ProductAccess;
}

/** POST /api/v1/products creates a DRAFT; variants, prices and images are added on its page. */
export interface ProductCreateRequest {
  nameVi: string;
  nameEn: string;
  descriptionVi: string | null;
  descriptionEn: string | null;
  brandId: string | null;
  categoryId: string | null;
  featured: boolean;
}

/** POST /api/v1/products/:id/edit */
export interface ProductEditRequest extends ProductCreateRequest {
  expectedRowVersion: number;
}

/** POST /api/v1/products/:id/status. Allowed: DRAFT to PUBLISHED, PUBLISHED to INACTIVE, INACTIVE to PUBLISHED. */
export interface ProductStatusRequest {
  expectedRowVersion: number;
  status: 'PUBLISHED' | 'INACTIVE';
}

/**
 * POST /api/v1/products/:id/variants. A list price needs MANAGE_PRODUCT_PRICES and a cost needs VIEW_PRODUCT_COST;
 * sending either without that permission is refused (403) and nothing is written.
 */
export interface ProductVariantCreateRequest {
  sku: string;
  labelVi: string | null;
  labelEn: string | null;
  barcode: string | null;
  lowStockThreshold: number | null;
  /** Absent means on (OQ-P6-30). */
  sellOnOrder?: boolean;
  /** Both or neither (1 to 90 days, min <= max); absent or null means the settings default. */
  leadTimeDaysMin?: number | null;
  leadTimeDaysMax?: number | null;
  sortOrder?: number;
  listPriceVnd?: string;
  costPriceVnd?: string | null;
}

/** POST /api/v1/products/:id/variants/:variantId/edit. An absent `costPriceVnd` leaves the stored cost unchanged. */
export interface ProductVariantEditRequest {
  expectedRowVersion: number;
  labelVi: string | null;
  labelEn: string | null;
  barcode: string | null;
  lowStockThreshold: number | null;
  /** Absent leaves the stored value unchanged. */
  sellOnOrder?: boolean;
  /** Both together, or both null to fall back to the settings default; absent leaves them unchanged. */
  leadTimeDaysMin?: number | null;
  leadTimeDaysMax?: number | null;
  sortOrder: number;
  isActive: boolean;
  costPriceVnd?: string | null;
}

/** POST /api/v1/products/:id/variants/:variantId/price (MANAGE_PRODUCT_PRICES). Appends a price version. */
export interface ProductPriceChangeRequest {
  /** The `priceVersionNo` the editor saw; another change in between is a conflict. */
  expectedVersionNo: number;
  listPriceVnd: string;
  reason: string | null;
}

/** POST /api/v1/products/:id/variants/:variantId/promotions (MANAGE_PRODUCT_PRICES). ISO instants with an offset. */
export interface ProductPromotionCreateRequest {
  promoPriceVnd: string;
  startsAt: string;
  endsAt: string;
}

/** POST /api/v1/products/:id/images */
export interface ProductImageAddRequest {
  mediaAssetId: string;
}

/** POST /api/v1/products/:id/images/order: every image id of the product, in the new order. */
export interface ProductImageOrderRequest {
  imageIds: string[];
}

/** GET /api/v1/product-settings (MANAGE_PRODUCTS or MANAGE_PRODUCT_PRICES): the one settings row of the product module. */
export interface ProductSettingsResponse {
  /** The default waiting time of an item sold on order, in days (OQ-P6-31: 3 to 5), unless a variant has its own. */
  leadTimeDaysMin: number;
  leadTimeDaysMax: number;
  /** Lots expiring within this many days are warned about (P6-Q14: 90 by default). */
  expiryWarningDays: number;
  /** The "Mới" badge shows for this many days after the first publication (OQ-P6-28: 30; 1 to 365). */
  newBadgeDays: number;
  /** The copy of the public cosmetics page, as the Owner wrote it (both languages); all empty until he fills it in. */
  publicPage: ProductPublicPageCopy;
  rowVersion: number;
  access: ProductAccess;
}

/** One line of the commitment box, in both languages (both required, so a visitor never sees the other language). */
export interface ProductCommitmentLine {
  textVi: string;
  textEn: string;
}

export interface ProductPublicPageCopy {
  heroMediaId: string | null;
  heroTitleVi: string | null;
  heroTitleEn: string | null;
  heroTextVi: string | null;
  heroTextEn: string | null;
  commitmentTitleVi: string | null;
  commitmentTitleEn: string | null;
  commitmentItems: ProductCommitmentLine[];
}

/**
 * POST /api/v1/product-settings/edit (MANAGE_PRODUCTS). Only the keys present change; the lead-time pair is sent together.
 * `publicPage` is replaced as a whole when present (an empty string or null clears a text).
 */
export interface ProductSettingsEditRequest {
  expectedRowVersion: number;
  leadTimeDaysMin?: number;
  leadTimeDaysMax?: number;
  expiryWarningDays?: number;
  newBadgeDays?: number;
  publicPage?: ProductPublicPageCopy;
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 6 P6-4: inventory (suppliers, stock receipts, stock levels, lots, adjustments, physical counts).
// Stock is per branch. Every command re-decides authority in its transaction: VIEW_INVENTORY (levels, lots, movements, counts),
// MANAGE_STOCK_RECEIPTS (receipts), ADJUST_STOCK (adjustments and counts) at the branch, MANAGE_PRODUCTS (suppliers) globally.
// A unit cost exists only for a caller who holds VIEW_PRODUCT_COST: for everyone else the keys are absent (never null).
// ---------------------------------------------------------------------------------------------------------------

export type StockMovementKindName = 'OPENING' | 'RECEIPT' | 'ADJUSTMENT';
/** The reasons a person may choose for an adjustment (COUNT_CORRECTION is written only by an approved count). */
export type StockAdjustmentReasonName =
  'INTERNAL_USE' | 'TESTER' | 'DAMAGED' | 'EXPIRED' | 'LOSS' | 'COUNT_CORRECTION';
export type StockReceiptStatusName = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
export type StockCountStatusName = 'OPEN' | 'APPROVED' | 'CANCELLED';

/** GET /api/v1/inventory/context: the branches the caller may work in and what they may do there. */
export interface InventoryContextResponse {
  branches: {
    id: string;
    code: string;
    name: string;
    view: boolean;
    receipts: boolean;
    adjust: boolean;
  }[];
  /** MANAGE_PRODUCTS: suppliers, the expiry-warning setting. */
  manageProducts: boolean;
  /** VIEW_PRODUCT_COST: a unit cost on receipts and lots. */
  cost: boolean;
}

export interface InventoryItem {
  variantId: string;
  sku: string;
  productId: string;
  productNameVi: string;
  productNameEn: string;
  labelVi: string | null;
  labelEn: string | null;
  /** The product cover picture (a media library id), or null. */
  coverMediaId: string | null;
  variantActive: boolean;
  onHand: number;
  reserved: number;
  /** The one definition of available stock (non-expired lots in the branch calendar minus reservations). */
  available: number;
  /** Units in lots that are past their expiry date today (branch calendar); still counted in `onHand`. */
  expiredQuantity: number;
  lowStockThreshold: number | null;
  /** On hand is at or below the threshold. */
  lowStock: boolean;
  /** Lots with stock. */
  lotCount: number;
  /** The earliest expiry date among lots with stock (YYYY-MM-DD), or null. */
  nextExpiry: string | null;
  /** Some lot with stock expires within the warning window, or has already expired. */
  expiryAlert: boolean;
}

/** GET /api/v1/inventory/overview?branchId= (VIEW_INVENTORY at the branch). */
export interface InventoryOverviewResponse {
  branchId: string;
  /** Lots expiring within this many days are flagged. */
  expiryWarningDays: number;
  items: InventoryItem[];
}

export interface InventoryLotResponse {
  id: string;
  lotCode: string;
  expiryDate: string | null;
  quantityOnHand: number;
  receivedQuantity: number;
  expired: boolean;
  receiptCode: string | null;
  createdAt: string;
  /** Only for a caller who holds VIEW_PRODUCT_COST. */
  unitCostVnd?: string | null;
}

export interface InventoryMovementResponse {
  id: string;
  kind: StockMovementKindName;
  quantityDelta: number;
  reason: StockAdjustmentReasonName | null;
  note: string | null;
  lotCode: string;
  actorName: string;
  createdAt: string;
  receiptCode: string | null;
  countCode: string | null;
}

/** GET /api/v1/inventory/branches/:branchId/variants/:variantId (VIEW_INVENTORY at the branch). */
export interface InventoryVariantDetailResponse {
  branchId: string;
  branchName: string;
  item: InventoryItem;
  expiryWarningDays: number;
  /** Lots with stock first (earliest expiry first), then the emptied ones. */
  lots: InventoryLotResponse[];
  /** The newest 100 movements, newest first. */
  movements: InventoryMovementResponse[];
  /** ADJUST_STOCK at the branch. */
  canAdjust: boolean;
}

/** POST /api/v1/stock-adjustments (ADJUST_STOCK at the branch). Takes `quantity` units out of one lot. */
export interface StockAdjustmentRequest {
  /** A fresh id per attempt: sending the same request again returns the same result and writes nothing twice. */
  requestKey: string;
  branchId: string;
  variantId: string;
  lotId: string;
  quantity: number;
  reason: Exclude<StockAdjustmentReasonName, 'COUNT_CORRECTION'>;
  note: string | null;
}

/** GET /api/v1/inventory/variant-options (MANAGE_STOCK_RECEIPTS or ADJUST_STOCK somewhere): what a receipt or count may list. */
export interface InventoryVariantOptionsResponse {
  variants: {
    variantId: string;
    sku: string;
    productNameVi: string;
    productNameEn: string;
    labelVi: string | null;
    labelEn: string | null;
  }[];
}

// ------------------------------------------------------------------------------------------------- suppliers

export interface SupplierResponse {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  rowVersion: number;
  receiptCount: number;
}

/** GET /api/v1/suppliers (MANAGE_PRODUCTS, or MANAGE_STOCK_RECEIPTS at some branch). */
export interface SupplierListResponse {
  suppliers: SupplierResponse[];
  /** MANAGE_PRODUCTS: create and edit. */
  manage: boolean;
}

export interface SupplierCreateRequest {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface SupplierEditRequest extends SupplierCreateRequest {
  expectedRowVersion: number;
  isActive: boolean;
}

// -------------------------------------------------------------------------------------------------- receipts

export interface StockReceiptListItem {
  id: string;
  code: string;
  receiptDate: string;
  status: StockReceiptStatusName;
  supplierName: string | null;
  lineCount: number;
  totalQuantity: number;
  createdByName: string;
  createdAt: string;
  confirmedAt: string | null;
  /** Only for a caller who holds VIEW_PRODUCT_COST (lines without a cost count as zero). */
  totalCostVnd?: string;
}

/** GET /api/v1/stock-receipts?branchId= (MANAGE_STOCK_RECEIPTS at the branch). */
export interface StockReceiptListResponse {
  branchId: string;
  receipts: StockReceiptListItem[];
}

export interface StockReceiptLineResponse {
  lineNo: number;
  variantId: string;
  sku: string;
  productNameVi: string;
  productNameEn: string;
  labelVi: string | null;
  labelEn: string | null;
  quantity: number;
  lotCode: string | null;
  expiryDate: string | null;
  /** Only for a caller who holds VIEW_PRODUCT_COST. */
  unitCostVnd?: string | null;
}

export interface StockReceiptResponse {
  id: string;
  code: string;
  branchId: string;
  branchName: string;
  supplierId: string | null;
  supplierName: string | null;
  receiptDate: string;
  notes: string | null;
  status: StockReceiptStatusName;
  rowVersion: number;
  createdByName: string;
  createdAt: string;
  confirmedByName: string | null;
  confirmedAt: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: StockReceiptLineResponse[];
  /** VIEW_PRODUCT_COST: unit costs are shown and may be entered. */
  cost: boolean;
}

export interface StockReceiptLineRequest {
  variantId: string;
  quantity: number;
  /** Only with VIEW_PRODUCT_COST (403 otherwise). An absent key on an edit keeps the cost of the same line and variant. */
  unitCostVnd?: string | null;
  lotCode: string | null;
  /** YYYY-MM-DD, or null for a lot that does not expire. */
  expiryDate: string | null;
}

/** POST /api/v1/stock-receipts (MANAGE_STOCK_RECEIPTS at the branch). Creates a draft. */
export interface StockReceiptCreateRequest {
  branchId: string;
  supplierId: string | null;
  receiptDate: string;
  notes: string | null;
  lines: StockReceiptLineRequest[];
}

/** POST /api/v1/stock-receipts/:id/edit: replaces the header and the lines of a DRAFT. */
export interface StockReceiptEditRequest {
  expectedRowVersion: number;
  supplierId: string | null;
  receiptDate: string;
  notes: string | null;
  lines: StockReceiptLineRequest[];
}

export interface StockReceiptVersionRequest {
  expectedRowVersion: number;
}

export interface StockReceiptCancelRequest {
  expectedRowVersion: number;
  reason: string;
}

// ---------------------------------------------------------------------------------------------------- counts

export interface StockCountListItem {
  id: string;
  code: string;
  status: StockCountStatusName;
  lineCount: number;
  /** Sum of the absolute differences once approved, else null. */
  differenceUnits: number | null;
  createdByName: string;
  createdAt: string;
  approvedAt: string | null;
}

/** GET /api/v1/stock-counts?branchId= (VIEW_INVENTORY or ADJUST_STOCK at the branch). */
export interface StockCountListResponse {
  branchId: string;
  counts: StockCountListItem[];
  canAdjust: boolean;
}

export interface StockCountLineResponse {
  variantId: string;
  sku: string;
  productNameVi: string;
  productNameEn: string;
  labelVi: string | null;
  labelEn: string | null;
  countedQuantity: number;
  /** The system quantity stamped at approval, null while the count is open. */
  systemQuantity: number | null;
  difference: number | null;
  /** The live quantity on hand while the count is open (it may move while people count). */
  currentOnHand: number | null;
}

export interface StockCountResponse {
  id: string;
  code: string;
  branchId: string;
  branchName: string;
  status: StockCountStatusName;
  notes: string | null;
  rowVersion: number;
  createdByName: string;
  createdAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  lines: StockCountLineResponse[];
  canAdjust: boolean;
}

/**
 * POST /api/v1/stock-counts (ADJUST_STOCK at the branch). A new count lists the given variants, or every variant that has stock
 * when `variantIds` is null. Each line starts at the quantity on hand: people then enter what they counted.
 */
export interface StockCountCreateRequest {
  branchId: string;
  notes: string | null;
  variantIds: string[] | null;
}

/** POST /api/v1/stock-counts/:id/lines: sets counted quantities (adding a variant if needed) and removes lines. */
export interface StockCountLinesRequest {
  expectedRowVersion: number;
  lines: { variantId: string; countedQuantity: number }[];
  removeVariantIds: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 6 P6-5: Excel/CSV import of the catalog (products and variants, with the pre-order columns) and of opening stock.
// IMPORT_PRODUCT_DATA (GLOBAL_ONLY) for every endpoint. A file is parsed and checked into a PREVIEW (nothing is saved); only an
// explicit confirmation applies it (PRD 31.2). A price column needs MANAGE_PRODUCT_PRICES, a cost column VIEW_PRODUCT_COST: the cells
// of a column the viewer may not see are absent from every response. Row problems are language-neutral codes; the screens write them
// in Vietnamese or English.
// ---------------------------------------------------------------------------------------------------------------

export type ProductImportKindName = 'CATALOG' | 'OPENING_STOCK';
export type ProductImportStatusName = 'UPLOADED' | 'PREVIEWED' | 'APPLIED' | 'FAILED' | 'CANCELLED';
export type ProductImportActionName = 'CREATE' | 'UPDATE' | 'NONE';

/** Why a row cannot be imported (an error), or what deserves a look (a warning). `field` is the column key of the template. */
export const PRODUCT_IMPORT_ISSUE_CODES = [
  // errors, both kinds
  'SKU_REQUIRED',
  'SKU_INVALID',
  'SKU_DUPLICATE_IN_FILE',
  'COST_INVALID',
  'COST_NOT_ALLOWED',
  // errors, catalog
  'NAME_REQUIRED',
  'NAME_INVALID',
  'TEXT_INVALID',
  'BRAND_NOT_FOUND',
  'BRAND_AMBIGUOUS',
  'BRAND_INACTIVE',
  'CATEGORY_NOT_FOUND',
  'CATEGORY_AMBIGUOUS',
  'CATEGORY_INACTIVE',
  'FEATURED_INVALID',
  'BARCODE_INVALID',
  'BARCODE_DUPLICATE_IN_FILE',
  'BARCODE_IN_USE',
  'THRESHOLD_INVALID',
  'SELL_ON_ORDER_INVALID',
  'LEAD_TIME_INVALID',
  'PRICE_INVALID',
  'PRICE_NOT_ALLOWED',
  'PRICE_BELOW_PROMOTION',
  'GROUP_MISMATCH',
  'GROUP_CONFLICT',
  'PRODUCT_HAS_ERRORS',
  // errors, opening stock
  'QUANTITY_REQUIRED',
  'QUANTITY_INVALID',
  'VARIANT_NOT_FOUND',
  'VARIANT_INACTIVE',
  'ALREADY_STOCKED',
  'LOT_CODE_INVALID',
  'LOT_DUPLICATE_IN_FILE',
  'EXPIRY_INVALID',
  'EXPIRY_PAST',
  // warnings
  'PRODUCT_NAME_EXISTS',
  'UNKNOWN_COLUMN',
  'SAME_FILE_APPLIED',
] as const;
export type ProductImportIssueCode = (typeof PRODUCT_IMPORT_ISSUE_CODES)[number];

export interface ProductImportIssue {
  code: ProductImportIssueCode;
  /** The template column the issue is about (a key such as "sku", "price"), when there is one. */
  field?: string;
  /** Small facts for the message: a row number, the text that was not found. Never a cost or a price. */
  params?: Record<string, string | number>;
}

export interface ProductImportRowResponse {
  /** The row number in the sheet, counting the header as row 1. */
  rowNo: number;
  status: 'VALID' | 'INVALID';
  action: ProductImportActionName;
  /** The SKU of the row (as written when it could not be read). */
  sku: string;
  /** What the row is about: the product name (catalog) or the lot (opening stock). */
  title: string | null;
  errors: ProductImportIssue[];
  warnings: ProductImportIssue[];
  /** For an UPDATE: the columns that would change. */
  changes: string[];
  /** The cells as read, by column key. A price cell needs MANAGE_PRODUCT_PRICES to appear, a cost cell VIEW_PRODUCT_COST. */
  cells: Record<string, string>;
}

export interface ProductImportJobResponse {
  id: string;
  kind: ProductImportKindName;
  status: ProductImportStatusName;
  filename: string;
  branchId: string | null;
  branchName: string | null;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  createCount: number;
  updateCount: number;
  /** Valid rows that would change nothing. */
  unchangedCount: number;
  /** Problems of the whole file (an unknown column, the same file applied before). */
  warnings: ProductImportIssue[];
  /** The columns of the file that were recognized, by column key. */
  columns: string[];
  failureMessage: string | null;
  createdByName: string;
  createdAt: string;
  previewedAt: string | null;
  appliedByName: string | null;
  appliedAt: string | null;
  rowVersion: number;
}

/** GET /api/v1/product-imports/:id */
export interface ProductImportDetailResponse extends ProductImportJobResponse {
  rows: ProductImportRowResponse[];
  /** The job is PREVIEWED and has at least one valid row that changes something. */
  canApply: boolean;
}

/** GET /api/v1/product-imports (IMPORT_PRODUCT_DATA). */
export interface ProductImportListResponse {
  jobs: ProductImportJobResponse[];
  /** The branches an opening-stock file may name. */
  branches: { id: string; name: string }[];
  /** What the caller may import: price and cost columns need their own permissions. */
  access: { prices: boolean; cost: boolean };
  limits: { maxBytes: number; maxRows: number };
}

/** POST /api/v1/product-imports/:id/apply. Invalid rows are never applied; `skipInvalid` says the person accepts that. */
export interface ProductImportApplyRequest {
  expectedRowVersion: number;
  skipInvalid: boolean;
}

export interface ProductImportCancelRequest {
  expectedRowVersion: number;
}

/**
 * The columns of the two import templates. The key is stable (stored with the preview, used in messages); the header is what the
 * template shows and what an error message names. A file may use the Vietnamese header, the English one or the key.
 * `needs` marks a column only a person holding that authority may fill (price: MANAGE_PRODUCT_PRICES, cost: VIEW_PRODUCT_COST).
 */
export interface ProductImportColumn {
  key: string;
  header: { vi: string; en: string };
  /** The column must exist in the file (a cell may still be blank where the guide says so). */
  required: boolean;
  needs?: 'prices' | 'cost';
  note: { vi: string; en: string };
  example: string;
}

export const PRODUCT_IMPORT_COLUMNS: Record<ProductImportKindName, readonly ProductImportColumn[]> =
  {
    CATALOG: [
      {
        key: 'sku',
        header: { vi: 'Mã SKU', en: 'SKU' },
        required: true,
        note: {
          vi: 'Bắt buộc. Mỗi dòng là một phân loại. SKU đã có trong hệ thống thì dòng đó cập nhật.',
          en: 'Required. One row is one variant. A SKU that already exists updates that variant.',
        },
        example: 'KEM-DUONG-50',
      },
      {
        key: 'product_key',
        header: { vi: 'Nhóm sản phẩm', en: 'Product group' },
        required: false,
        note: {
          vi: 'Các dòng cùng nhóm là các phân loại của một sản phẩm. Để trống thì mỗi dòng là một sản phẩm.',
          en: 'Rows with the same group are variants of one product. Blank: each row is its own product.',
        },
        example: 'KEM-DUONG',
      },
      {
        key: 'name_vi',
        header: { vi: 'Tên tiếng Việt', en: 'Name (Vietnamese)' },
        required: false,
        note: {
          vi: 'Bắt buộc khi tạo sản phẩm mới. Khi cập nhật, để trống là giữ nguyên.',
          en: 'Required for a new product. On update, blank keeps the current value.',
        },
        example: 'Kem dưỡng da',
      },
      {
        key: 'name_en',
        header: { vi: 'Tên tiếng Anh', en: 'Name (English)' },
        required: false,
        note: { vi: 'Bắt buộc khi tạo sản phẩm mới.', en: 'Required for a new product.' },
        example: 'Face cream',
      },
      {
        key: 'description_vi',
        header: { vi: 'Mô tả tiếng Việt', en: 'Description (Vietnamese)' },
        required: false,
        note: { vi: 'Tối đa 2.000 ký tự.', en: 'Up to 2,000 characters.' },
        example: '',
      },
      {
        key: 'description_en',
        header: { vi: 'Mô tả tiếng Anh', en: 'Description (English)' },
        required: false,
        note: { vi: 'Tối đa 2.000 ký tự.', en: 'Up to 2,000 characters.' },
        example: '',
      },
      {
        key: 'brand',
        header: { vi: 'Thương hiệu', en: 'Brand' },
        required: false,
        note: {
          vi: 'Tên hoặc mã của thương hiệu đã có. Hệ thống không tự tạo thương hiệu mới.',
          en: 'Name or code of an existing brand. New brands are never created by an import.',
        },
        example: 'Lucy',
      },
      {
        key: 'category',
        header: { vi: 'Danh mục', en: 'Category' },
        required: false,
        note: {
          vi: 'Tên hoặc mã của danh mục đã có. Hệ thống không tự tạo danh mục mới.',
          en: 'Name or code of an existing category. New categories are never created by an import.',
        },
        example: 'Chăm sóc da',
      },
      {
        key: 'featured',
        header: { vi: 'Nổi bật', en: 'Featured' },
        required: false,
        note: { vi: 'Có hoặc Không.', en: 'Yes or No.' },
        example: 'Không',
      },
      {
        key: 'label_vi',
        header: { vi: 'Phân loại (VI)', en: 'Variant label (VI)' },
        required: false,
        note: { vi: 'Ví dụ: 50 ml.', en: 'For example: 50 ml.' },
        example: '50 ml',
      },
      {
        key: 'label_en',
        header: { vi: 'Phân loại (EN)', en: 'Variant label (EN)' },
        required: false,
        note: { vi: 'Ví dụ: 50 ml.', en: 'For example: 50 ml.' },
        example: '50 ml',
      },
      {
        key: 'barcode',
        header: { vi: 'Mã vạch', en: 'Barcode' },
        required: false,
        note: { vi: 'Không trùng với mặt hàng khác.', en: 'Not shared with another item.' },
        example: '8936000000017',
      },
      {
        key: 'low_stock_threshold',
        header: { vi: 'Ngưỡng sắp hết', en: 'Low-stock threshold' },
        required: false,
        note: {
          vi: 'Số nguyên từ 0. Dưới hoặc bằng số này thì báo sắp hết hàng.',
          en: 'A whole number from 0. At or below it the item is reported as running low.',
        },
        example: '5',
      },
      {
        key: 'sell_on_order',
        header: { vi: 'Cho đặt trước', en: 'Pre-order allowed' },
        required: false,
        note: {
          vi: 'Có hoặc Không. Để trống: sản phẩm mới là Có, sản phẩm đã có giữ nguyên.',
          en: 'Yes or No. Blank: a new item is Yes, an existing item is unchanged.',
        },
        example: 'Có',
      },
      {
        key: 'lead_time_min',
        header: { vi: 'Chờ tối thiểu (ngày)', en: 'Wait, at least (days)' },
        required: false,
        note: {
          vi: 'Từ 1 đến 90. Điền cả hai ô chờ hoặc để trống cả hai (dùng mặc định của cửa hàng).',
          en: 'From 1 to 90. Fill both wait columns or leave both blank (the shop default applies).',
        },
        example: '3',
      },
      {
        key: 'lead_time_max',
        header: { vi: 'Chờ tối đa (ngày)', en: 'Wait, at most (days)' },
        required: false,
        note: {
          vi: 'Từ 1 đến 90, không nhỏ hơn ô chờ tối thiểu.',
          en: 'From 1 to 90, not below the minimum.',
        },
        example: '5',
      },
      {
        key: 'price',
        header: { vi: 'Giá bán (₫)', en: 'List price (VND)' },
        required: false,
        needs: 'prices',
        note: {
          vi: 'Số nguyên đồng, lớn hơn 0. Giá khác giá hiện tại sẽ tạo phiên bản giá mới.',
          en: 'Whole VND above 0. A different price creates a new price version.',
        },
        example: '250000',
      },
      {
        key: 'cost',
        header: { vi: 'Giá vốn (₫)', en: 'Cost (VND)' },
        required: false,
        needs: 'cost',
        note: { vi: 'Số nguyên đồng, từ 0.', en: 'Whole VND, from 0.' },
        example: '120000',
      },
    ],
    OPENING_STOCK: [
      {
        key: 'sku',
        header: { vi: 'Mã SKU', en: 'SKU' },
        required: true,
        note: {
          vi: 'SKU của phân loại đã có trong danh mục.',
          en: 'The SKU of a variant that already exists in the catalog.',
        },
        example: 'KEM-DUONG-50',
      },
      {
        key: 'quantity',
        header: { vi: 'Số lượng', en: 'Quantity' },
        required: true,
        note: {
          vi: 'Số nguyên lớn hơn 0. Chỉ nhập được khi phân loại chưa từng có nhập hay xuất kho tại chi nhánh này.',
          en: 'A whole number above 0. Only for a variant with no stock history at this branch.',
        },
        example: '24',
      },
      {
        key: 'lot_code',
        header: { vi: 'Mã lô', en: 'Lot code' },
        required: false,
        note: { vi: 'Để trống thì hệ thống tự đặt.', en: 'Blank: the system names it.' },
        example: 'L2610',
      },
      {
        key: 'expiry_date',
        header: { vi: 'Hạn dùng', en: 'Expiry date' },
        required: false,
        note: {
          vi: 'Ngày dạng 2027-12-31 hoặc 31/12/2027. Để trống nếu không có hạn.',
          en: 'A date like 2027-12-31 or 31/12/2027. Blank when there is none.',
        },
        example: '2027-12-31',
      },
      {
        key: 'cost',
        header: { vi: 'Giá vốn (₫)', en: 'Cost (VND)' },
        required: false,
        needs: 'cost',
        note: { vi: 'Giá vốn một đơn vị, số nguyên đồng.', en: 'Cost of one unit, whole VND.' },
        example: '120000',
      },
    ],
  };
