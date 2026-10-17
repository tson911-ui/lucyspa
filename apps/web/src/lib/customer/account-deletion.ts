import type {
  AccountDeletionCheckResponse,
  AccountDeletionOrder,
  AccountDeletionRequest,
} from '@lucy-spa/contracts';
import type { CustomerProfileDictionary } from '../../i18n/customer-profile';
import { ApiError, type ApiClient } from '../api/client';

/**
 * Session 10 A2: the customer's own account deletion. The session is the only identity; the server checks the blockers again and the
 * password before anything is deleted.
 */
export const ACCOUNT_DELETION_PATH = '/api/v1/me/account-deletion';

/** The shop's returns and refunds policy page (an info page of the site; Owner answer 3 links it from the combo blocker). */
export const REFUND_POLICY_SLUG = 'chinh-sach-doi-tra-hoan-tien';

export const loadDeletionCheck = (api: ApiClient): Promise<AccountDeletionCheckResponse> =>
  api.get<AccountDeletionCheckResponse>(ACCOUNT_DELETION_PATH);

/**
 * Deletes the account; the server ends every session and clears the cookie. The cached CSRF context belongs to the ended session, so
 * it is dropped: the next session check reads "signed out" from a fresh context instead of meeting a 401 (which would send the page to
 * the sign-in screen before the confirmation page opens).
 */
export async function deleteAccount(api: ApiClient, currentPassword: string): Promise<void> {
  const body: AccountDeletionRequest = { currentPassword };
  await api.post<void>(ACCOUNT_DELETION_PATH, body);
  api.resetCsrf();
}

export function sessionsLeft(check: AccountDeletionCheckResponse): number {
  return check.blockers.combos.reduce((sum, combo) => sum + combo.sessionsLeft, 0);
}

/** The sentence (with its `{code}` place) that says what to do about one unfinished order. */
export function adviceTemplate(
  order: AccountDeletionOrder,
  text: CustomerProfileDictionary['deletion'],
): string {
  return order.kind === 'ONLINE_UNPAID'
    ? text.orderUnpaid
    : order.kind === 'ONLINE_IN_PROGRESS'
      ? text.orderInProgress
      : text.orderPreorder;
}

/** What to do about one unfinished order, in plain words. */
export function orderAdvice(
  order: AccountDeletionOrder,
  text: CustomerProfileDictionary['deletion'],
): string {
  return adviceTemplate(order, text).replace('{code}', order.code);
}

/** The text before and after the `{code}` place, so the page can mark the code itself `translate="no"`. */
export function aroundCode(template: string): [string, string] {
  const at = template.indexOf('{code}');
  return at < 0 ? [template, ''] : [template.slice(0, at), template.slice(at + '{code}'.length)];
}

/** The member's order page exists for online orders only; a counter pre-order has none. */
export function orderHref(order: AccountDeletionOrder, base: string): string | null {
  return order.kind === 'COUNTER_PREORDER' ? null : `${base}/orders/${order.id}`;
}

/** A message for a failed deletion, or null when the generic message fits. */
export function deletionErrorMessage(
  error: unknown,
  text: CustomerProfileDictionary,
): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'AUTHENTICATION_FAILED') return text.wrongPassword;
  if (error.code === 'ACCOUNT_DELETION_BLOCKED') return text.deletion.blockedNow;
  return null;
}
