import type {
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
