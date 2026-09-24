import { AuthError } from './auth.error.js';
import { IdentityValidationError, normalizeEmail, normalizePhone } from './identity.js';
import { PasswordPolicyError, validatePasswordForSetting } from './password.service.js';

export const REGISTRATION_LIMITS = Object.freeze({
  fullNameMaxCodePoints: 200,
  addressMaxCodePoints: 500,
});

export interface RegistrationInput {
  fullName: string;
  dateOfBirth: string;
  address: string;
  email: string;
  phone: string;
  password: string;
  locale: 'vi' | 'en';
}

export interface RegistrationCandidate {
  fullName: string;
  dateOfBirth: Date;
  address: string;
  emailCanonical: string;
  emailDelivery: string;
  phoneCanonical: string;
  normalizationVersion: number;
  password: string;
  locale: 'vi' | 'en';
}

/** Trimmed NFC profile text without controls; also used for employee profiles. */
export function text(value: string, field: string, maxCodePoints: number): string {
  // Reject lone surrogates and control characters, including CR/LF, before storage.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const normalized = value.normalize('NFC').trim();
  const length = [...normalized].length;
  if (length === 0 || length > maxCodePoints || /\p{Cc}/u.test(normalized)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return normalized;
}

function spaToday(now: Date): string {
  // Calendar date where the spa operates; no minimum customer age is imposed.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Calendar YYYY-MM-DD stored as a date, never a timezone-dependent timestamp. */
export function parseDateOfBirth(value: string, now = new Date()): Date {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) throw new AuthError('VALIDATION_FAILED', 'dateOfBirth');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    value > spaToday(now)
  ) {
    throw new AuthError('VALIDATION_FAILED', 'dateOfBirth');
  }
  return date;
}

/** Server-owned normalization; only safe field identifiers are ever reported. */
export function normalizeRegistration(input: RegistrationInput): RegistrationCandidate {
  const fullName = text(input.fullName, 'fullName', REGISTRATION_LIMITS.fullNameMaxCodePoints);
  const dateOfBirth = parseDateOfBirth(input.dateOfBirth);
  const address = text(input.address, 'address', REGISTRATION_LIMITS.addressMaxCodePoints);
  let email: ReturnType<typeof normalizeEmail>;
  let phone: ReturnType<typeof normalizePhone>;
  let password: string;
  try {
    email = normalizeEmail(input.email);
    phone = normalizePhone(input.phone);
  } catch (error) {
    if (error instanceof IdentityValidationError)
      throw new AuthError('VALIDATION_FAILED', error.field);
    throw error;
  }
  try {
    password = validatePasswordForSetting(input.password);
  } catch (error) {
    if (error instanceof PasswordPolicyError) throw new AuthError('VALIDATION_FAILED', 'password');
    throw error;
  }
  if (input.locale !== 'vi' && input.locale !== 'en') {
    throw new AuthError('VALIDATION_FAILED', 'locale');
  }
  return {
    fullName,
    dateOfBirth,
    address,
    emailCanonical: email.emailCanonical,
    emailDelivery: email.emailDelivery,
    phoneCanonical: phone.phoneCanonical,
    normalizationVersion: email.normalizationVersion,
    password,
    locale: input.locale,
  };
}
