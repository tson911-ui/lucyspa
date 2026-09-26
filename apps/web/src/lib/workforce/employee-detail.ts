import type {
  EmployeeCredentialsRequest,
  EmployeeProfileUpdateRequest,
  EmployeeResponse,
  EmployeeStatusChangeRequest,
  EmploymentClassification,
  EmploymentClassificationChangeRequest,
  EmploymentEndAccess,
  EmploymentEndRequest,
  EmploymentEndResponse,
  EmploymentResponse,
} from '@lucy-spa/contracts';
import { fill, type WorkforceDictionary } from '../../i18n/workforce';
import type { Locale } from '../../i18n/locales';
import { ApiError, type WorkforceApi } from './api';
import { isCalendarDate, PASSWORD_LENGTH, passwordLength } from './employee-create';
import { canAcross, type Account } from './permissions';
import { ReauthenticationCancelled } from './reauth';
import { errorMessage } from './workflows';

/**
 * Employee detail (Employee management Step 3): which lifecycle actions to offer and the
 * exact requests for the existing commands. UX hints only — every command is authorized
 * again by the API (all-branch permissions, containment, Owner protection, backdating).
 */

export interface DetailActions {
  editProfile: boolean;
  promote: boolean;
  end: boolean;
  /** The end-employment form may disable sign-in now (MANAGE_EMPLOYEE_STATUS as well). */
  disableWhenEnding: boolean;
  resetPassword: boolean;
  deactivate: boolean;
  reactivate: boolean;
}

/** Employment in effect on today's business date is ENDED (the API's no-rehire guard). */
export function employmentEnded(employment: EmploymentResponse): boolean {
  return employment.current?.classification === 'ENDED';
}

/** The latest recorded classification, which decides the next allowed transition. */
export function latestClassification(employment: EmploymentResponse) {
  return employment.history.at(-1)?.classification ?? null;
}

export function detailActions(
  account: Account,
  employee: EmployeeResponse,
  employment: EmploymentResponse | null,
): DetailActions {
  const branches = employee.branchIds;
  // Non-Owners never change their own classification, credentials or status.
  const other = account.kind === 'OWNER' || account.id !== employee.id;
  const pay = other && canAcross(account, 'MANAGE_EMPLOYEE_PAY', branches);
  const access = other && canAcross(account, 'MANAGE_EMPLOYEE_ACCESS', branches);
  const status = other && canAcross(account, 'MANAGE_EMPLOYEE_STATUS', branches);
  const latest = employment ? latestClassification(employment) : null;
  const ended = employment ? employmentEnded(employment) : false;
  return {
    editProfile: canAcross(account, 'UPDATE_EMPLOYEES', branches),
    // Forward changes only (TRAINEE → CTV/Nhân viên, CTV → Nhân viên); never after ENDED.
    promote: pay && nextClassifications(latest).length > 0,
    end:
      pay && (latest === 'TRAINEE' || latest === 'COLLABORATOR' || latest === 'OFFICIAL_EMPLOYEE'),
    disableWhenEnding: status,
    resetPassword: access && employee.status !== 'INACTIVE' && employment !== null && !ended,
    deactivate: status && employee.status !== 'INACTIVE',
    reactivate: status && employee.status === 'INACTIVE' && employment !== null && !ended,
  };
}

// ------------------------------------------------------------------ profile

export interface ProfileForm {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  address: string;
  locale: Locale;
}

export function profileForm(employee: EmployeeResponse): ProfileForm {
  return {
    fullName: employee.fullName,
    phone: employee.phone,
    dateOfBirth: employee.dateOfBirth,
    address: employee.address,
    locale: employee.locale,
  };
}

/**
 * Only the fields the profile command supports (full name, phone, date of birth, address,
 * language), and only those that changed. Employee code and email are not editable here.
 * The same fields and rules as My Account (one shared write path on the server). Null when
 * nothing changed.
 */
export function profilePatch(
  employee: EmployeeResponse,
  form: ProfileForm,
): EmployeeProfileUpdateRequest | null {
  const patch: EmployeeProfileUpdateRequest = { expectedVersion: employee.version };
  const fullName = form.fullName.trim();
  const address = form.address.trim();
  const phone = form.phone.trim();
  if (fullName !== employee.fullName) patch.fullName = fullName;
  if (phone !== employee.phone) patch.phone = phone;
  if (form.dateOfBirth !== employee.dateOfBirth) patch.dateOfBirth = form.dateOfBirth;
  if (address !== employee.address) patch.address = address;
  if (form.locale !== employee.locale) patch.locale = form.locale;
  return Object.keys(patch).length > 1 ? patch : null;
}

// ------------------------------------------------------------------ classification

/** A date before today's business date is Owner-only for classification changes. */
export function backdatedForNonOwner(account: Account, date: string, today: string): boolean {
  return account.kind !== 'OWNER' && isCalendarDate(date) && date < today;
}

/**
 * The classification changes offered from the latest recorded one (the API's matrix, minus
 * ENDED which has its own action): TRAINEE → COLLABORATOR | OFFICIAL_EMPLOYEE,
 * COLLABORATOR → OFFICIAL_EMPLOYEE. Never back from OFFICIAL_EMPLOYEE, never after ENDED.
 */
export function nextClassifications(
  latest: EmploymentClassification | null,
): ('COLLABORATOR' | 'OFFICIAL_EMPLOYEE')[] {
  if (latest === 'TRAINEE') return ['COLLABORATOR', 'OFFICIAL_EMPLOYEE'];
  if (latest === 'COLLABORATOR') return ['OFFICIAL_EMPLOYEE'];
  return [];
}

export function promotionRequest(
  version: number,
  classification: 'COLLABORATOR' | 'OFFICIAL_EMPLOYEE',
  effectiveDate: string,
  reason: string,
): EmploymentClassificationChangeRequest {
  return { expectedVersion: version, classification, effectiveDate, reason: reason.trim() };
}

export type EndingOutcome =
  'DISABLE_NOW' | 'ALREADY_INACTIVE' | 'NOT_REQUESTED' | 'FUTURE_NO_AUTO_DISABLE';

/** What the end-employment command will do to sign-in (mirrors the API). */
export function endingOutcome(
  effectiveDate: string,
  today: string,
  disableAccess: boolean,
  status: EmployeeResponse['status'],
): EndingOutcome {
  if (!disableAccess) return 'NOT_REQUESTED';
  if (isCalendarDate(effectiveDate) && effectiveDate > today) return 'FUTURE_NO_AUTO_DISABLE';
  return status === 'INACTIVE' ? 'ALREADY_INACTIVE' : 'DISABLE_NOW';
}

export function endRequest(
  version: number,
  effectiveDate: string,
  reason: string,
  disableAccess: boolean,
): EmploymentEndRequest {
  return { expectedVersion: version, effectiveDate, reason: reason.trim(), disableAccess };
}

export function endAccessMessage(access: EmploymentEndAccess, t: WorkforceDictionary): string {
  return t.employees.detail.endedAccess[access];
}

// ------------------------------------------------------------------ credentials

export type PasswordProblem = 'length' | 'mismatch' | null;

/** The policy length (15–128 code points) and the confirmation; the API checks the rest. */
export function passwordProblem(password: string, confirmation: string): PasswordProblem {
  const length = passwordLength(password);
  if (length < PASSWORD_LENGTH.min || length > PASSWORD_LENGTH.max) return 'length';
  return password === confirmation ? null : 'mismatch';
}

/** The password is sent exactly as typed (the API normalizes it) and never kept. */
export function credentialsRequest(
  version: number,
  newPassword: string,
  reason: string,
): EmployeeCredentialsRequest {
  return { expectedVersion: version, newPassword, reason: reason.trim() };
}

export function statusRequest(
  version: number,
  status: 'ACTIVE' | 'INACTIVE',
  reason: string,
): EmployeeStatusChangeRequest {
  return { expectedVersion: version, status, reason: reason.trim() };
}

// ------------------------------------------------------------------ commands (existing API)

export const employeeCommands = {
  updateProfile: (api: WorkforceApi, id: string, body: EmployeeProfileUpdateRequest) =>
    api.post<EmployeeResponse>(`/api/v1/employees/${id}/profile`, body),
  promote: (api: WorkforceApi, id: string, body: EmploymentClassificationChangeRequest) =>
    api.post<EmploymentResponse>(`/api/v1/employees/${id}/employment`, body),
  endEmployment: (api: WorkforceApi, id: string, body: EmploymentEndRequest) =>
    api.post<EmploymentEndResponse>(`/api/v1/employees/${id}/end-employment`, body),
  setCredentials: (api: WorkforceApi, id: string, body: EmployeeCredentialsRequest) =>
    api.post<EmployeeResponse>(`/api/v1/employees/${id}/credentials`, body),
  changeStatus: (api: WorkforceApi, id: string, body: EmployeeStatusChangeRequest) =>
    api.post<EmployeeResponse>(`/api/v1/employees/${id}/status`, body),
};

/** Localized failures of the detail commands; the API decides, this only explains. */
/** Shared profile refusals (management and My Account): phone clash, invalid field. */
export function profileFieldMessage(error: ApiError, t: WorkforceDictionary): string | null {
  const create = t.employees.create;
  if (error.code === 'CONFLICT' && error.field === 'phone') return create.duplicatePhone;
  const field = error.field;
  if (
    error.code === 'VALIDATION_FAILED' &&
    (field === 'fullName' || field === 'phone' || field === 'dateOfBirth' || field === 'address')
  ) {
    return fill(create.invalidField, { field: create.fields[field] });
  }
  return null;
}

export function detailErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.employees.detail;
  if (error instanceof ReauthenticationCancelled) return t.reauth.cancelled;
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_FAILED' && error.field === 'newPassword') {
      return t.employees.create.passwordRejected;
    }
    if (error.code === 'CONFLICT' && error.field === 'employment') {
      return texts.endedNoAccessChanges;
    }
    if (error.code === 'CONFLICT' && error.field === 'managerRole') {
      return texts.managerRoleFirst;
    }
    if (error.code === 'CONFLICT' && error.field === 'classification') {
      return texts.transitionNotAllowed;
    }
    if (error.code === 'VALIDATION_FAILED' && error.field === 'effectiveDate') {
      return texts.dateNotAfterLatest;
    }
    return profileFieldMessage(error, t) ?? errorMessage(error, t);
  }
  return errorMessage(error, t);
}
