import type {
  AcceptedFlowResponse,
  CustomerProfileResponse,
  CustomerProfileUpdateRequest,
  EmailChangeRequest,
  EmailChangeResendRequest,
  EmailChangeVerifyRequest,
} from '@lucy-spa/contracts';
import type { CustomerProfileDictionary } from '../../i18n/customer-profile';
import { ApiError, type ApiClient } from '../api/client';

/**
 * The customer's own profile (session 7b). The session is the only identity: no id is sent. The name is the only profile field
 * written here; the sign-in email changes through a code sent to the NEW address (the flow shared with staff); the phone and the
 * birthday are shown, never written (the phone is the customer key, the birthday protects the birthday gift).
 */
export const NAME_MAX = 200;
export const OTP_PATTERN = /^[0-9]{6}$/;

export const loadCustomerProfile = (api: ApiClient): Promise<CustomerProfileResponse> =>
  api.get<CustomerProfileResponse>('/api/v1/me/profile');

export function saveCustomerName(
  api: ApiClient,
  version: number,
  fullName: string,
): Promise<CustomerProfileResponse> {
  const body: CustomerProfileUpdateRequest = {
    expectedVersion: version,
    fullName: fullName.trim(),
  };
  return api.post<CustomerProfileResponse>('/api/v1/me/profile', body);
}

export type NameProblem = 'nameRequired' | 'nameTooLong' | null;

/** What the form can see before sending; the server checks the same limits again. */
export function nameProblem(value: string): NameProblem {
  const name = value.trim();
  if (name === '') return 'nameRequired';
  return [...name].length > NAME_MAX ? 'nameTooLong' : null;
}

export type EmailProblem =
  'passwordRequired' | 'emailRequired' | 'invalidEmail' | 'sameEmail' | null;

export function emailProblem(
  password: string,
  newEmail: string,
  currentEmail: string,
): EmailProblem {
  if (password === '') return 'passwordRequired';
  const email = newEmail.trim();
  if (email === '') return 'emailRequired';
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return 'invalidEmail';
  return email.toLowerCase() === currentEmail.toLowerCase() ? 'sameEmail' : null;
}

/** The code is sent to the new address only; the account email is unchanged until it is verified. */
export function requestEmailChange(
  api: ApiClient,
  currentPassword: string,
  newEmail: string,
): Promise<AcceptedFlowResponse> {
  const body: EmailChangeRequest = { currentPassword, newEmail: newEmail.trim() };
  return api.post<AcceptedFlowResponse>('/api/v1/me/email/request', body);
}

export async function resendEmailChange(api: ApiClient, flowToken: string): Promise<void> {
  const body: EmailChangeResendRequest = { flowToken };
  await api.post<void>('/api/v1/me/email/resend', body);
}

/** Verifying rotates the session cookie and revokes the other sessions, so a fresh CSRF context follows. */
export async function verifyEmailChange(
  api: ApiClient,
  flowToken: string,
  otp: string,
): Promise<void> {
  const body: EmailChangeVerifyRequest = { flowToken, otp: otp.trim() };
  await api.post<void>('/api/v1/me/email/verify', body);
  api.resetCsrf();
  await api.context();
}

/** `2026-03-05` as `05/03/2026`: a calendar date, never read through a timezone. */
export function birthdayText(iso: string | null): string | null {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/** `+84901234567` as the number a person types, `0901234567`. */
export function phoneText(canonical: string | null): string | null {
  if (canonical === null) return null;
  return canonical.startsWith('+84') ? `0${canonical.slice(3)}` : canonical;
}

/** A message for a failed save of the name, or null when the generic message fits. */
export function nameErrorMessage(error: unknown, text: CustomerProfileDictionary): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'VALIDATION_FAILED' && error.field === 'fullName') return text.nameInvalid;
  if (error.code === 'CONFLICT') return text.stale;
  return null;
}

/** A message for a failed email request or verification, or null when the generic message fits. */
export function emailErrorMessage(error: unknown, text: CustomerProfileDictionary): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'AUTHENTICATION_FAILED') return text.wrongPassword;
  if (error.code === 'CONFLICT' && error.field === 'email') return text.emailTaken;
  if (error.code === 'VALIDATION_FAILED' && error.field === 'newEmail') return text.invalidEmail;
  if (error.code === 'VALIDATION_FAILED' && error.field === 'newEmailUnchanged') {
    return text.sameEmail;
  }
  if (error.code === 'VERIFICATION_FAILED') return text.badCode;
  return null;
}
