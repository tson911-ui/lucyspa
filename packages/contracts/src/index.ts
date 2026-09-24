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
