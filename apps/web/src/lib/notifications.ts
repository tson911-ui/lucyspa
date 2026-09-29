import type {
  CurrentAccountResponse,
  NotificationCategory,
  NotificationItem,
  NotificationPage,
} from '@lucy-spa/contracts';
import { fill } from '../i18n/workforce';
import type { Locale } from '../i18n/locales';
import { getNotificationDictionary } from '../i18n/notifications';
import { canAt } from './workforce/permissions';

/**
 * Allowlisted internal destinations. The destination API still enforces current authority, and a
 * link is only produced when a real screen exists for the resource:
 * - Booking and Visit keep their existing behavior (branch-scoped permission hints);
 * - a leave notification opens the existing leave page for workforce accounts. That page has no
 *   per-request route, so it is the leave page, not a specific request.
 */
export function notificationHref(
  item: NotificationItem,
  account: CurrentAccountResponse,
  base: string,
): string | null {
  if (item.source.type === 'LeaveRequest') {
    return account.kind === 'EMPLOYEE' || account.kind === 'OWNER' ? `${base}/leave` : null;
  }
  if (item.branch === null) return null;
  const branchId = item.branch.id;
  if (account.kind === 'CUSTOMER')
    return item.source.type === 'Booking'
      ? `${base}/bookings/${encodeURIComponent(item.source.id)}`
      : null;
  if (
    ['BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED'].includes(item.type) &&
    canAt(account, 'REASSIGN_SERVICES', branchId)
  )
    return `${base}/reassignment`;
  if (account.kind === 'EMPLOYEE' && canAt(account, 'PERFORM_SERVICES', branchId))
    return `${base}/my-services`;
  if (canAt(account, 'VIEW_BOOKINGS', branchId)) return `${base}/booking-board`;
  return null;
}

/** Date-only text (`YYYY-MM-DD`) in the viewer's locale; no time zone conversion applies. */
export function formatLeaveDate(value: string, locale: Locale): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'UTC',
    dateStyle: 'medium',
  }).format(parsed);
}

/**
 * The message shown for a notification. Leave notifications render from the structured `params`
 * (dates, leave type, decision); when they are missing the generic per-type text is used. No
 * free-form reason or note exists anywhere in a notification, so none can be shown.
 */
export function notificationMessage(item: NotificationItem, locale: Locale): string {
  const t = getNotificationDictionary(locale);
  const params = item.params;
  if (params && 'startDate' in params) {
    const values = {
      type: t.leave.types[params.leaveType],
      from: formatLeaveDate(params.startDate, locale),
      to: formatLeaveDate(params.endDate, locale),
    };
    if (item.type === 'LEAVE_REQUESTED' && 'subjectUserId' in params) {
      return fill(t.leave.requested, values);
    }
    if (item.type === 'LEAVE_DECIDED' && 'decision' in params) {
      return fill(params.decision === 'APPROVED' ? t.leave.approved : t.leave.rejected, values);
    }
  }
  return t.types[item.type];
}

export function mergeNotifications(
  previous: readonly NotificationItem[],
  incoming: readonly NotificationItem[],
) {
  const items = new Map(previous.map((item) => [item.id, item]));
  incoming.forEach((item) => items.set(item.id, item));
  return [...items.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

export interface InboxFilters {
  category: NotificationCategory | 'ALL';
  unreadOnly: boolean;
  archived: boolean;
}
export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  category: 'ALL',
  unreadOnly: false,
  archived: false,
};

/** Query parameters for the caller's own inbox; false flags are omitted (the API default). */
export function notificationQuery(filters: InboxFilters, cursor?: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (cursor) query['cursor'] = cursor;
  if (filters.category !== 'ALL') query['category'] = filters.category;
  if (filters.unreadOnly) query['unread'] = 'true';
  if (filters.archived) query['archived'] = 'true';
  return query;
}

/** Category tabs: customers only ever receive operational messages, so they get no tabs. */
/** Mirrors the registry's categories (a test compares them, so they cannot drift). */
export const INBOX_CATEGORIES: readonly NotificationCategory[] = ['OPERATIONS', 'HR'];
export function inboxCategories(account: CurrentAccountResponse): readonly NotificationCategory[] {
  return account.kind === 'CUSTOMER' ? [] : INBOX_CATEGORIES;
}

/** The server's authoritative item replaces the row; a view that no longer matches drops it. */
export function applyItemUpdate(
  page: NotificationPage,
  updated: NotificationItem,
  filters: InboxFilters,
): NotificationPage {
  const stays =
    (filters.archived ? updated.archivedAt !== null : updated.archivedAt === null) &&
    (!filters.unreadOnly || updated.readAt === null);
  const items = stays
    ? page.items.map((item) => (item.id === updated.id ? updated : item))
    : page.items.filter((item) => item.id !== updated.id);
  return { ...page, items };
}
