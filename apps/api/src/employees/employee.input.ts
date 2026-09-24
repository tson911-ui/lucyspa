import type { EmployeeCreateRequest, EmployeeProfileUpdateRequest } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import {
  IdentityValidationError,
  normalizeEmail,
  normalizeEmployeeCode,
  normalizePhone,
} from '../auth/identity.js';
import { parseDateOfBirth, REGISTRATION_LIMITS, text } from '../auth/registration.js';

export const EMPLOYEE_LIMITS = Object.freeze({
  ...REGISTRATION_LIMITS,
  reasonMaxCodePoints: 500,
  maxBranches: 50,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface EmployeeCandidate {
  employeeCodeCanonical: string;
  fullName: string;
  dateOfBirth: Date;
  address: string;
  phoneCanonical: string;
  emailCanonical: string | null;
  emailDelivery: string | null;
  normalizationVersion: number;
  locale: 'vi' | 'en';
  branchIds: string[];
  baseSalaryVnd: bigint | null;
}

export interface ProfilePatch {
  fullName?: string;
  dateOfBirth?: Date;
  address?: string;
  locale?: 'vi' | 'en';
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function identity<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      throw new AuthError('VALIDATION_FAILED', error.field);
    }
    throw error;
  }
}

/** A deduplicated, lowercase set of branch UUIDs; the server decides whether each exists. */
export function normalizeBranchIds(value: readonly string[]): string[] {
  const ids = [...new Set(value.map((id) => id.toLowerCase()))];
  if (ids.length > EMPLOYEE_LIMITS.maxBranches || !ids.every(isUuid)) {
    throw new AuthError('VALIDATION_FAILED', 'branchIds');
  }
  return ids.sort();
}

/** Nonnegative integer VND carried as a decimal string and stored as bigint; never a float. */
export function parseBaseSalary(value: string | null | undefined): bigint | null {
  if (value === undefined || value === null) return null;
  if (!/^(?:0|[1-9][0-9]{0,17})$/.test(value)) {
    throw new AuthError('VALIDATION_FAILED', 'baseSalaryVnd');
  }
  return BigInt(value);
}

export function normalizeReason(value: string): string {
  return text(value, 'reason', EMPLOYEE_LIMITS.reasonMaxCodePoints);
}

/** Server-owned normalization, identical to signup/login canonicalization. */
export function normalizeEmployee(input: EmployeeCreateRequest): EmployeeCandidate {
  const code = identity(() => normalizeEmployeeCode(input.employeeId));
  const phone = identity(() => normalizePhone(input.phone));
  const email =
    input.email === undefined || input.email === null
      ? null
      : identity(() => normalizeEmail(input.email));
  if (input.locale !== 'vi' && input.locale !== 'en') {
    throw new AuthError('VALIDATION_FAILED', 'locale');
  }
  return {
    employeeCodeCanonical: code.employeeCodeCanonical,
    fullName: text(input.fullName, 'fullName', EMPLOYEE_LIMITS.fullNameMaxCodePoints),
    dateOfBirth: parseDateOfBirth(input.dateOfBirth),
    address: text(input.address, 'address', EMPLOYEE_LIMITS.addressMaxCodePoints),
    phoneCanonical: phone.phoneCanonical,
    emailCanonical: email?.emailCanonical ?? null,
    emailDelivery: email?.emailDelivery ?? null,
    normalizationVersion: code.normalizationVersion,
    locale: input.locale,
    branchIds: normalizeBranchIds(input.branchIds),
    baseSalaryVnd: parseBaseSalary(input.baseSalaryVnd),
  };
}

/** Allowlisted non-security fields only; at least one must be supplied. */
export function normalizeProfilePatch(input: EmployeeProfileUpdateRequest): ProfilePatch {
  const patch: ProfilePatch = {};
  if (input.fullName !== undefined) {
    patch.fullName = text(input.fullName, 'fullName', EMPLOYEE_LIMITS.fullNameMaxCodePoints);
  }
  if (input.dateOfBirth !== undefined) patch.dateOfBirth = parseDateOfBirth(input.dateOfBirth);
  if (input.address !== undefined) {
    patch.address = text(input.address, 'address', EMPLOYEE_LIMITS.addressMaxCodePoints);
  }
  if (input.locale !== undefined) {
    if (input.locale !== 'vi' && input.locale !== 'en') {
      throw new AuthError('VALIDATION_FAILED', 'locale');
    }
    patch.locale = input.locale;
  }
  if (Object.keys(patch).length === 0) throw new AuthError('VALIDATION_FAILED');
  return patch;
}
