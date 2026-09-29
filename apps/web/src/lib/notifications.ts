import type { CurrentAccountResponse, NotificationItem } from '@lucy-spa/contracts';
import { canAt } from './workforce/permissions';

/** Allowlisted internal destinations. The destination API still enforces current authority. */
export function notificationHref(
  item: NotificationItem,
  account: CurrentAccountResponse,
  base: string,
): string | null {
  // Leave destinations arrive with the Leave notification work; person-level items have no branch.
  if (item.source.type === 'LeaveRequest' || item.branch === null) return null;
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
