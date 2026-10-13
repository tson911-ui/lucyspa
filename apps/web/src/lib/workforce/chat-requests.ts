import { CHAT_REQUEST_STATUSES, type ChatRequestStatus } from '@lucy-spa/contracts';
import type { Tone } from '../../components/workforce/ui';

/** URL state of the callback inbox: the status filter and the page (20 per page, decided by the server). */
export const CHAT_REQUEST_LIST_DEFAULTS: { status: string; page: number } = {
  status: '',
  page: 1,
};
export type ChatRequestListState = typeof CHAT_REQUEST_LIST_DEFAULTS;
export const CHAT_REQUEST_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeChatRequestList(state: ChatRequestListState): ChatRequestListState {
  return {
    status: (CHAT_REQUEST_STATUSES as readonly string[]).includes(state.status) ? state.status : '',
    page: Number.isInteger(state.page) && state.page >= 1 ? state.page : 1,
  };
}

export const statusTone = (status: ChatRequestStatus): Tone =>
  status === 'NEW' ? 'warning' : status === 'CALLED' ? 'info' : 'neutral';

/**
 * A stored number (`+84905123456`) as people read and dial it in Vietnam (`0905 123 456`); another country's number is shown as stored
 * with spaces after the country code. Anything unexpected is returned unchanged.
 */
export function displayPhone(phone: string): string {
  const match = /^\+84(\d{9,10})$/.exec(phone);
  if (!match) return phone;
  const national = `0${match[1]}`;
  return national.length === 10
    ? `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`
    : `${national.slice(0, 4)} ${national.slice(4, 8)} ${national.slice(8)}`;
}

/** The `tel:` link of a stored number: digits and the plus sign only. */
export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** What the row menu offers for a status: a new request can be marked called or closed, a called one closed, a closed one nothing. */
export function nextStatuses(status: ChatRequestStatus): ('CALLED' | 'CLOSED')[] {
  return status === 'NEW' ? ['CALLED', 'CLOSED'] : status === 'CALLED' ? ['CLOSED'] : [];
}
