import type {
  AttendanceRecordResponse,
  CurrentAccountResponse,
  LeaveRequestResponse,
  LoginRequest,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { fill } from '../../i18n/workforce';
import { ApiError, type WorkforceApi } from './api';
import { canAt, isWorkforce, type Account } from './permissions';
import { todayIn } from './format';

// ------------------------------------------------------------------ attendance

export type AttendanceState =
  | { kind: 'none' }
  | { kind: 'in'; record: AttendanceRecordResponse }
  | { kind: 'out'; record: AttendanceRecordResponse }
  | { kind: 'openPast'; record: AttendanceRecordResponse };

/**
 * The caller's state at one branch, derived only from the backend's records: today's
 * record (by the branch-timezone business date) decides checked-in / checked-out; an
 * older record without a check-out is surfaced so the employee asks for a correction.
 * The server still decides whether a check-in or check-out is allowed.
 */
export function attendanceState(
  records: readonly AttendanceRecordResponse[],
  branchId: string,
  timeZone: string,
  now: Date = new Date(),
): AttendanceState {
  const today = todayIn(timeZone, now);
  const atBranch = records.filter((record) => record.branchId === branchId);
  const current = atBranch.find((record) => record.businessDate === today);
  if (current)
    return current.checkOutAt ? { kind: 'out', record: current } : { kind: 'in', record: current };
  const stale = atBranch.find(
    (record) => record.businessDate < today && record.checkOutAt === null,
  );
  return stale ? { kind: 'openPast', record: stale } : { kind: 'none' };
}

/**
 * Whether to offer the correction form for a record: MANAGE_ATTENDANCE at the record's
 * branch, and never on one's own record unless Owner (the API applies the same rules).
 */
export function canCorrectAttendance(account: Account, record: AttendanceRecordResponse): boolean {
  return (
    canAt(account, 'MANAGE_ATTENDANCE', record.branchId) &&
    (account.kind === 'OWNER' || record.employeeId !== account.id)
  );
}

// ------------------------------------------------------------------ leave

export interface LeaveActions {
  cancel: boolean;
  decide: boolean;
}

/**
 * Actions offered for one request. Only the requester may cancel, and only while
 * PENDING (APPROVED is never self-cancelled). Deciding needs APPROVE_LEAVE coverage of
 * the employee (`canDecide`, from the list the API scoped for the caller) and is never
 * offered on one's own request.
 */
export function leaveActions(
  request: LeaveRequestResponse,
  viewerId: string,
  canDecide: boolean,
): LeaveActions {
  const own = request.employeeId === viewerId;
  const pending = request.status === 'PENDING';
  return { cancel: own && pending, decide: pending && canDecide && !own };
}

// ------------------------------------------------------------------ errors

/** A safe, localized message for any failure; never a stack trace or raw server text. */
export function errorMessage(error: unknown, t: WorkforceDictionary): string {
  if (!(error instanceof ApiError)) return t.errors.unexpected;
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return error.field
        ? fill(t.errors.validationField, { field: error.field })
        : t.errors.validation;
    case 'HTTP_400':
      return t.errors.validation;
    case 'AUTHENTICATION_REQUIRED':
      return t.errors.unauthenticated;
    case 'AUTHENTICATION_FAILED':
      return t.auth.loginFailed;
    case 'FORBIDDEN':
    case 'REQUEST_NOT_ALLOWED':
      return t.errors.forbidden;
    case 'REAUTHENTICATION_REQUIRED':
      return t.errors.reauthenticate;
    case 'NOT_FOUND':
      return t.errors.notFound;
    case 'CONFLICT':
      return t.errors.conflict;
    case 'RATE_LIMITED':
      return t.errors.rateLimited;
    case 'SERVICE_UNAVAILABLE':
      return t.errors.unavailable;
    case 'NETWORK':
      return t.errors.network;
    default:
      return t.errors.unexpected;
  }
}

export type MutationOutcome<T> =
  { ok: true; value: T } | { ok: false; error: unknown; reloaded: boolean };

/**
 * Runs one command. A 409 (stale `expectedVersion` or changed state) never retries or
 * overwrites: the affected resource is reloaded so the user sees the current data and
 * decides again.
 */
export async function runMutation<T>(
  action: () => Promise<T>,
  reload: () => Promise<void> | void,
): Promise<MutationOutcome<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CONFLICT') {
      await reload();
      return { ok: false, error, reloaded: true };
    }
    return { ok: false, error, reloaded: false };
  }
}

// ------------------------------------------------------------------ session

export type SessionResult =
  | { kind: 'workforce'; account: CurrentAccountResponse }
  | { kind: 'customer'; account: CurrentAccountResponse }
  | { kind: 'anonymous' };

/** Establishes the CSRF context and resolves who the session belongs to. */
export async function loadSession(api: WorkforceApi): Promise<SessionResult> {
  const context = await api.context();
  if (!context.authenticated) return { kind: 'anonymous' };
  try {
    const account = await api.get<CurrentAccountResponse>('/api/v1/auth/me');
    return isWorkforce(account) ? { kind: 'workforce', account } : { kind: 'customer', account };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { kind: 'anonymous' };
    throw error;
  }
}

/**
 * Workforce login through the existing endpoint: a CSRF context for the anonymous
 * session, `POST /auth/login` in the WORKFORCE realm (it rotates the session cookie),
 * then a fresh CSRF context for the new session.
 */
export async function workforceLogin(
  api: WorkforceApi,
  input: { identifierType: 'EMAIL' | 'EMPLOYEE_ID'; identifier: string; password: string },
): Promise<CurrentAccountResponse> {
  await api.context();
  const body: LoginRequest = { realm: 'WORKFORCE', ...input };
  const account = await api.post<CurrentAccountResponse>('/api/v1/auth/login', body);
  await api.context();
  return account;
}

/** Ends the current session server-side; the next context call issues a new anonymous one. */
export async function workforceLogout(api: WorkforceApi): Promise<void> {
  try {
    await api.post<void>('/api/v1/auth/logout', {});
  } finally {
    api.resetCsrf();
  }
}
