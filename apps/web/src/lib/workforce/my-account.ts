import type {
  AcceptedFlowResponse,
  EmailChangeRequest,
  EmailChangeResendRequest,
  EmailChangeVerifyRequest,
  MyAccountProfileUpdateRequest,
  MyAccountResponse,
  SelfPasswordChangeRequest,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError, type WorkforceApi } from './api';
import { passwordProblem } from './employee-detail';
import { errorMessage } from './workflows';

/**
 * "Tài khoản của tôi / My Account": the signed-in account's own view over the same profile
 * that employee detail shows. The session is the only identity; no ID is ever sent.
 */
export const myAccountCommands = {
  get: (api: WorkforceApi) => api.get<MyAccountResponse>('/api/v1/me/account', {}),
  updateProfile: (api: WorkforceApi, body: MyAccountProfileUpdateRequest) =>
    api.post<MyAccountResponse>('/api/v1/me/account/profile', body),
};

export interface MyProfileForm {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  address: string;
  locale: Locale;
}

export function myProfileForm(account: MyAccountResponse): MyProfileForm {
  return {
    fullName: account.fullName,
    phone: account.phone ?? '',
    dateOfBirth: account.employee?.dateOfBirth ?? '',
    address: account.employee?.address ?? '',
    locale: account.locale,
  };
}

/**
 * Only the self-editable fields that changed. The Owner has no employee profile, so date of
 * birth and address are never sent for them. Null when nothing changed.
 */
export function myProfilePatch(
  account: MyAccountResponse,
  form: MyProfileForm,
): MyAccountProfileUpdateRequest | null {
  const patch: MyAccountProfileUpdateRequest = { expectedVersion: account.version };
  const fullName = form.fullName.trim();
  const phone = form.phone.trim();
  if (fullName !== account.fullName) patch.fullName = fullName;
  if (phone !== '' && phone !== account.phone) patch.phone = phone;
  if (account.employee) {
    const address = form.address.trim();
    if (form.dateOfBirth !== account.employee.dateOfBirth) patch.dateOfBirth = form.dateOfBirth;
    if (address !== account.employee.address) patch.address = address;
  }
  if (form.locale !== account.locale) patch.locale = form.locale;
  return Object.keys(patch).length > 1 ? patch : null;
}

// ------------------------------------------------------------------ change password

/** Held only in the form's state while typing; cleared after a successful change. */
export interface ChangePasswordForm {
  current: string;
  next: string;
  confirm: string;
}

export const EMPTY_CHANGE_PASSWORD: ChangePasswordForm = { current: '', next: '', confirm: '' };

export type ChangePasswordProblem = 'currentRequired' | 'length' | 'mismatch' | 'same' | null;

/** Usability checks only; the server stays authoritative (policy, blocklist, proof). */
export function changePasswordProblem(form: ChangePasswordForm): ChangePasswordProblem {
  if (form.current === '') return 'currentRequired';
  const problem = passwordProblem(form.next, form.confirm);
  if (problem !== null) return problem;
  return form.next === form.current ? 'same' : null;
}

/**
 * POST /api/v1/me/password: passwords only (identity is the session). The response rotates
 * the session cookie, so the CSRF token is refreshed afterwards, as after reauthentication.
 */
export async function changeOwnPassword(
  api: WorkforceApi,
  form: ChangePasswordForm,
): Promise<void> {
  const body: SelfPasswordChangeRequest = { currentPassword: form.current, newPassword: form.next };
  await api.post<void>('/api/v1/me/password', body);
  await api.context();
}

export function changePasswordErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.myAccount.changePassword;
  if (error instanceof ApiError) {
    if (error.code === 'AUTHENTICATION_FAILED') return texts.wrongCurrent;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'newPasswordUnchanged') {
      return texts.same;
    }
    if (error.code === 'VALIDATION_FAILED' && error.field === 'newPassword') return texts.rejected;
  }
  return errorMessage(error, t);
}

// ------------------------------------------------------------------ change email

export type EmailChangeProblem =
  'passwordRequired' | 'emailRequired' | 'invalidEmail' | 'sameEmail' | null;

/** Usability only; the server normalizes, validates and decides availability. */
export function emailChangeProblem(
  currentPassword: string,
  newEmail: string,
  currentEmail: string | null = null,
): EmailChangeProblem {
  if (currentPassword === '') return 'passwordRequired';
  const email = newEmail.trim();
  if (email === '') return 'emailRequired';
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return 'invalidEmail';
  return currentEmail !== null && email.toLowerCase() === currentEmail.toLowerCase()
    ? 'sameEmail'
    : null;
}

/**
 * POST /api/v1/me/email/request: current password + new address (identity is the session).
 * The code goes to the NEW address only; the account email is unchanged until verified.
 */
export function requestEmailChange(
  api: WorkforceApi,
  currentPassword: string,
  newEmail: string,
): Promise<AcceptedFlowResponse> {
  const body: EmailChangeRequest = { currentPassword, newEmail: newEmail.trim() };
  return api.post<AcceptedFlowResponse>('/api/v1/me/email/request', body);
}

export async function resendEmailChange(api: WorkforceApi, flowToken: string): Promise<void> {
  const body: EmailChangeResendRequest = { flowToken };
  await api.post<void>('/api/v1/me/email/resend', body);
}

/** Verification rotates the session cookie, so the CSRF token is refreshed afterwards. */
export async function verifyEmailChange(
  api: WorkforceApi,
  flowToken: string,
  otp: string,
): Promise<void> {
  const body: EmailChangeVerifyRequest = { flowToken, otp: otp.trim() };
  await api.post<void>('/api/v1/me/email/verify', body);
  await api.context();
}

export function emailChangeErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.myAccount.changeEmail;
  if (error instanceof ApiError) {
    if (error.code === 'AUTHENTICATION_FAILED') return texts.wrongPassword;
    if (error.code === 'VERIFICATION_FAILED') return texts.codeRejected;
    if (error.code === 'CONFLICT' && error.field === 'email') return texts.taken;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'newEmail') return texts.invalidEmail;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'newEmailUnchanged') {
      return texts.sameEmail;
    }
  }
  return errorMessage(error, t);
}
