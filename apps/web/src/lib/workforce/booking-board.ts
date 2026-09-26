import type {
  BranchSummary,
  CurrentAccountResponse,
  OperationalBooking,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { canAt } from './permissions';
import { errorMessage } from './workflows';

/** Branches where this account may view bookings (the API decides again on every call). */
export function boardBranches(
  account: CurrentAccountResponse,
  branches: ReadonlyMap<string, BranchSummary> | null,
): BranchSummary[] {
  return [...(branches?.values() ?? [])]
    .filter((branch) => branch.isActive && canAt(account, 'VIEW_BOOKINGS', branch.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/** Matches the booking code, the booker or a recipient name, or the last phone digits. */
export function matchesSearch(booking: OperationalBooking, search: string): boolean {
  const term = search.trim().toLocaleLowerCase('vi');
  if (!term) return true;
  const digits = term.replace(/\D/g, '');
  const texts = [
    booking.code,
    booking.owner.displayName,
    ...booking.recipients.map((recipient) => recipient.displayName ?? ''),
  ].map((text) => text.toLocaleLowerCase('vi'));
  return (
    texts.some((text) => text.includes(term)) ||
    (digits.length >= 2 && (booking.owner.phoneMasked ?? '').endsWith(digits))
  );
}

/** A wall-clock time in the branch timezone. */
export function branchTime(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function stateTone(
  state: OperationalBooking['state'],
): 'success' | 'error' | 'info' | 'warning' | 'neutral' {
  switch (state) {
    case 'ARRIVAL_WINDOW_OPEN':
    case 'ARRIVED':
      return 'success';
    case 'IN_SERVICE':
      return 'info';
    case 'LATE_HOLD':
    case 'HOLD_EXPIRED':
      return 'warning';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'error';
    default:
      return 'neutral';
  }
}

/** Operational outcomes are shown with their own texts; the rest as elsewhere. */
export function boardErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.bookingBoard.errors as Record<string, string>;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return errorMessage(error, t);
}

/** Automatic refresh interval; refreshes are passive and never extend the session. */
export const BOARD_REFRESH_MS = 30_000;
