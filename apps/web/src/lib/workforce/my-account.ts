import type { MyAccountProfileUpdateRequest, MyAccountResponse } from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import type { WorkforceApi } from './api';

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
