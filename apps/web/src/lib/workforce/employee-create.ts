import type {
  BranchSummary,
  EmployeeCreateRequest,
  EmployeeDirectoryEntry,
  EmployeeResponse,
  EmploymentClassification,
  InitialEmploymentClassification,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { fill } from '../../i18n/workforce';
import type { Locale } from '../../i18n/locales';
import { ApiError, type WorkforceApi } from './api';
import { formatDate, todayIn } from './format';
import { canAcross, canAnywhere, canAt, type Account } from './permissions';
import { ReauthenticationCancelled } from './reauth';
import { errorMessage } from './workflows';

/**
 * "Add workforce member" (Employee management Step 2). Creates an EMPLOYEE through the
 * existing `POST /api/v1/employees`, optionally with Owner/manager-set sign-in access (an
 * initial password; the employee code is the login ID). Never a setup token, role,
 * permission, skill or salary. The API stays authoritative; these helpers only decide what
 * the form offers and catch obviously incomplete input before a request is sent.
 */

/** The only classifications a new workforce member can start with. ENDED never is one. */
export const INITIAL_CLASSIFICATIONS: readonly InitialEmploymentClassification[] = [
  'TRAINEE',
  'COLLABORATOR',
  'OFFICIAL_EMPLOYEE',
];

export interface CreateForm {
  employeeId: string;
  fullName: string;
  dateOfBirth: string;
  address: string;
  phone: string;
  email: string;
  locale: Locale;
  /** Empty until the creator chooses explicitly; there is no default classification. */
  classification: InitialEmploymentClassification | '';
  employmentStartDate: string;
  employmentReason: string;
  branchIds: string[];
  /** "Cấp tài khoản đăng nhập ngay": create the account ACTIVE with an initial password. */
  provisionAccess: boolean;
  initialPassword: string;
  confirmPassword: string;
}

export function emptyCreateForm(locale: Locale, branchIds: string[] = []): CreateForm {
  return {
    employeeId: '',
    fullName: '',
    dateOfBirth: '',
    address: '',
    phone: '',
    email: '',
    locale,
    classification: '',
    employmentStartDate: '',
    employmentReason: '',
    branchIds,
    provisionAccess: false,
    initialPassword: '',
    confirmPassword: '',
  };
}

/** The existing workforce password policy's length bounds (the API also blocks common ones). */
export const PASSWORD_LENGTH = { min: 15, max: 128 } as const;

/** Code points after NFC normalization, as the API counts them. */
export function passwordLength(value: string): number {
  return [...value.normalize('NFC')].length;
}

/** The login ID is the employee code itself (the API upper-cases it). */
export function loginIdPreview(employeeId: string): string {
  return employeeId.trim().toUpperCase();
}

/**
 * Sign-in access at creation needs MANAGE_EMPLOYEE_ACCESS in every selected branch (the API
 * additionally requires a recent password confirmation of the creator).
 */
export function canProvisionAccess(account: Account, branchIds: readonly string[]): boolean {
  return branchIds.length > 0
    ? canAcross(account, 'MANAGE_EMPLOYEE_ACCESS', branchIds)
    : canAnywhere(account, 'MANAGE_EMPLOYEE_ACCESS');
}

/** Whether to offer the "Add workforce member" action at all (CREATE_EMPLOYEES somewhere). */
export function canOfferCreate(account: Account): boolean {
  return account.kind !== 'CUSTOMER' && canAnywhere(account, 'CREATE_EMPLOYEES');
}

/** Active branches in which the caller may create employees (the API checks every one). */
export function creatableBranches(
  account: Account,
  branches: Iterable<BranchSummary>,
): BranchSummary[] {
  return [...branches].filter(
    (branch) => branch.isActive && canAt(account, 'CREATE_EMPLOYEES', branch.id),
  );
}

export type OfficialAvailability = 'allowed' | 'noPay' | 'noPayForBranches';

/**
 * OFFICIAL_EMPLOYEE creates payroll eligibility, so the API also requires
 * MANAGE_EMPLOYEE_PAY in every selected branch. A TRAINEE needs only CREATE_EMPLOYEES.
 */
export function officialAvailability(
  account: Account,
  branchIds: readonly string[],
): OfficialAvailability {
  if (!canAnywhere(account, 'MANAGE_EMPLOYEE_PAY')) return 'noPay';
  if (branchIds.length > 0 && !canAcross(account, 'MANAGE_EMPLOYEE_PAY', branchIds)) {
    return 'noPayForBranches';
  }
  return 'allowed';
}

/**
 * Today's business date for the selected branches, as the API computes it: the latest local
 * date among their timezones (UTC without a branch). Only used to ask for a reason when the
 * start date is in the past; the API decides.
 */
export function businessToday(
  branchIds: readonly string[],
  branches: ReadonlyMap<string, BranchSummary> | null,
  now: Date = new Date(),
): string {
  const dates = branchIds
    .map((id) => branches?.get(id)?.timezone)
    .filter((zone): zone is string => Boolean(zone))
    .map((zone) => todayIn(zone, now));
  return dates.length > 0 ? dates.sort().at(-1)! : todayIn('UTC', now);
}

const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

export function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type CreateProblem =
  | 'employeeId'
  | 'fullName'
  | 'dateOfBirth'
  | 'address'
  | 'phone'
  | 'classification'
  | 'official'
  | 'employmentStartDate'
  | 'employmentReason'
  | 'branchIds'
  | 'access'
  | 'initialPassword'
  | 'confirmPassword';

/** Missing or clearly invalid input, for immediate feedback. Formats stay server-owned. */
export function createProblems(
  form: CreateForm,
  availability: OfficialAvailability,
  today: string,
  accessAllowed = true,
): CreateProblem[] {
  const problems: CreateProblem[] = [];
  const blank = (value: string) => value.trim().length === 0;
  if (blank(form.employeeId)) problems.push('employeeId');
  if (blank(form.fullName)) problems.push('fullName');
  if (!isCalendarDate(form.dateOfBirth)) problems.push('dateOfBirth');
  if (blank(form.address)) problems.push('address');
  if (blank(form.phone)) problems.push('phone');
  if (!(INITIAL_CLASSIFICATIONS as readonly string[]).includes(form.classification)) {
    problems.push('classification');
  } else if (form.classification === 'OFFICIAL_EMPLOYEE' && availability !== 'allowed') {
    problems.push('official');
  }
  if (!isCalendarDate(form.employmentStartDate)) problems.push('employmentStartDate');
  else if (needsStartReason(form, today) && blank(form.employmentReason)) {
    problems.push('employmentReason');
  }
  if (form.branchIds.length === 0) problems.push('branchIds');
  if (form.provisionAccess) {
    if (!accessAllowed) problems.push('access');
    const length = passwordLength(form.initialPassword);
    if (length < PASSWORD_LENGTH.min || length > PASSWORD_LENGTH.max) {
      problems.push('initialPassword');
    } else if (form.confirmPassword !== form.initialPassword) {
      problems.push('confirmPassword');
    }
  }
  return problems;
}

/** A start date before today's business date records existing staff and needs a reason. */
export function needsStartReason(form: CreateForm, today: string): boolean {
  return isCalendarDate(form.employmentStartDate) && form.employmentStartDate < today;
}

/**
 * The exact request body: the fields of `EmployeeCreateRequest` the form collects, with an
 * explicit classification, plus the initial password only when access is set up now (sent
 * exactly as typed: the API normalizes it). No salary, role, permission or skill is sent.
 */
export function toCreateRequest(form: CreateForm, today: string): EmployeeCreateRequest {
  const classification = form.classification;
  if (classification === '') {
    throw new Error('An initial classification must be chosen explicitly.');
  }
  const email = form.email.trim();
  const reason = form.employmentReason.trim();
  return {
    employeeId: form.employeeId.trim(),
    fullName: form.fullName.trim(),
    dateOfBirth: form.dateOfBirth,
    address: form.address.trim(),
    phone: form.phone.trim(),
    email: email.length > 0 ? email : null,
    locale: form.locale,
    branchIds: [...form.branchIds],
    classification,
    employmentStartDate: form.employmentStartDate,
    ...(needsStartReason(form, today) && reason.length > 0 ? { employmentReason: reason } : {}),
    ...(form.provisionAccess ? { initialPassword: form.initialPassword } : {}),
  };
}

/** The single create command (employee, classification, branches and optional access). */
export function createEmployee(
  api: WorkforceApi,
  request: EmployeeCreateRequest,
): Promise<EmployeeResponse> {
  return api.post<EmployeeResponse>('/api/v1/employees', request);
}

/**
 * Runs `work` only when no earlier run is still pending: repeated clicks or Enter presses
 * while a create is in flight never send a second request.
 */
export function oneAtATime<T>(work: () => Promise<T>): () => Promise<T | undefined> {
  let pending = false;
  return async () => {
    if (pending) return undefined;
    pending = true;
    try {
      return await work();
    } finally {
      pending = false;
    }
  };
}

type FieldLabelKey = keyof WorkforceDictionary['employees']['create']['fields'];

const FIELD_OF: Record<string, FieldLabelKey> = {
  employeeId: 'employeeId',
  employeeCode: 'employeeId',
  fullName: 'fullName',
  dateOfBirth: 'dateOfBirth',
  address: 'address',
  phone: 'phone',
  email: 'email',
  locale: 'locale',
  branchIds: 'branchIds',
  classification: 'classification',
  employmentStartDate: 'employmentStartDate',
  employmentReason: 'employmentReason',
  initialPassword: 'initialPassword',
};

/** Localized create failures: duplicates and invalid fields name the field in plain words. */
export function createErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.employees.create;
  if (error instanceof ReauthenticationCancelled) return t.reauth.cancelled;
  if (error instanceof ApiError) {
    const field = error.field ? FIELD_OF[error.field] : undefined;
    if (error.code === 'CONFLICT' && field === 'employeeId') return texts.duplicateEmployeeId;
    if (error.code === 'CONFLICT' && field === 'phone') return texts.duplicatePhone;
    if (error.code === 'CONFLICT' && field === 'email') return texts.duplicateEmail;
    if (error.code === 'VALIDATION_FAILED' && field === 'initialPassword') {
      return texts.passwordRejected;
    }
    if (error.code === 'VALIDATION_FAILED' && field) {
      return fill(texts.invalidField, { field: texts.fields[field] });
    }
    if (error.code === 'FORBIDDEN') return texts.forbidden;
  }
  return errorMessage(error, t);
}

export function classificationText(
  classification: EmploymentClassification,
  t: WorkforceDictionary,
): string {
  return t.employees.classifications[classification];
}

/**
 * Directory label: the authoritative server title. A member whose start date is still ahead
 * shows from when ("Chưa bắt đầu (từ 01/10/2026)").
 */
export function directoryTitle(
  entry: Pick<EmployeeDirectoryEntry, 'title' | 'classificationEffectiveDate'>,
  t: WorkforceDictionary,
  locale: Locale,
): string {
  const label = t.employees.titles[entry.title];
  if (entry.title === 'NOT_STARTED' && entry.classificationEffectiveDate) {
    return fill(t.employees.classificationFrom, {
      label,
      date: formatDate(entry.classificationEffectiveDate, locale),
    });
  }
  return label;
}
