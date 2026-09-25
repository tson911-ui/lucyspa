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
import { errorMessage } from './workflows';

/**
 * "Add workforce member" (Employee management Step 2). Creates an EMPLOYEE through the
 * existing `POST /api/v1/employees` only: no password, setup token, role, permission,
 * skill or salary. The API stays authoritative; these helpers only decide what the form
 * offers and catch obviously incomplete input before a request is sent.
 */

/** The only classifications a new workforce member can start with. ENDED never is one. */
export const INITIAL_CLASSIFICATIONS: readonly InitialEmploymentClassification[] = [
  'TRAINEE',
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
  };
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
  | 'branchIds';

/** Missing or clearly invalid input, for immediate feedback. Formats stay server-owned. */
export function createProblems(
  form: CreateForm,
  availability: OfficialAvailability,
  today: string,
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
  return problems;
}

/** A start date before today's business date records existing staff and needs a reason. */
export function needsStartReason(form: CreateForm, today: string): boolean {
  return isCalendarDate(form.employmentStartDate) && form.employmentStartDate < today;
}

/**
 * The exact request body: the fields of `EmployeeCreateRequest` the form collects, with an
 * explicit classification. No salary, password, role, permission or skill is ever sent.
 */
export function toCreateRequest(form: CreateForm, today: string): EmployeeCreateRequest {
  if (form.classification !== 'TRAINEE' && form.classification !== 'OFFICIAL_EMPLOYEE') {
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
    classification: form.classification,
    employmentStartDate: form.employmentStartDate,
    ...(needsStartReason(form, today) && reason.length > 0 ? { employmentReason: reason } : {}),
  };
}

/** The single create command. Account provisioning is a separate, later step. */
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
};

/** Localized create failures: duplicates and invalid fields name the field in plain words. */
export function createErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.employees.create;
  if (error instanceof ApiError) {
    const field = error.field ? FIELD_OF[error.field] : undefined;
    if (error.code === 'CONFLICT' && field === 'employeeId') return texts.duplicateEmployeeId;
    if (error.code === 'CONFLICT' && field === 'phone') return texts.duplicatePhone;
    if (error.code === 'CONFLICT' && field === 'email') return texts.duplicateEmail;
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
 * Directory label for the latest recorded classification. A classification that only takes
 * effect later (a future start date or a scheduled change) says from when.
 */
export function directoryClassification(
  entry: Pick<
    EmployeeDirectoryEntry,
    'classification' | 'classificationEffectiveDate' | 'branchIds'
  >,
  branches: ReadonlyMap<string, BranchSummary> | null,
  t: WorkforceDictionary,
  locale: Locale,
  now: Date = new Date(),
): string {
  if (!entry.classification) return '—';
  const label = classificationText(entry.classification, t);
  const from = entry.classificationEffectiveDate;
  if (from && from > businessToday(entry.branchIds, branches, now)) {
    return fill(t.employees.classificationFrom, { label, date: formatDate(from, locale) });
  }
  return label;
}
