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
  // A return notice opens the case page for people who handle returns or refunds at its branch.
  if (item.source.type === 'ProductReturnCase') {
    return item.branch !== null &&
      (canAt(account, 'MANAGE_PRODUCT_RETURNS', item.branch.id) ||
        canAt(account, 'REFUND_PRODUCTS', item.branch.id))
      ? `${base}/product-returns/${encodeURIComponent(item.source.id)}`
      : null;
  }
  // A stock alert opens the inventory of its branch (the item page for one variant, the stock list for the daily expiry scan).
  if (item.source.type === 'ProductVariant') {
    return item.branch !== null && canAt(account, 'VIEW_INVENTORY', item.branch.id)
      ? `${base}/inventory/items/${encodeURIComponent(item.source.id)}?branch=${encodeURIComponent(item.branch.id)}`
      : null;
  }
  if (item.source.type === 'Branch' && item.type === 'EXPIRY_ALERT') {
    return item.branch !== null && canAt(account, 'VIEW_INVENTORY', item.branch.id)
      ? `${base}/inventory?branch=${encodeURIComponent(item.branch.id)}`
      : null;
  }
  // The revenue summary is about a branch and has no screen (reports are a later phase).
  if (item.source.type === 'Branch') return null;
  if (item.source.type === 'Invoice') {
    // A customer opens their own invoice; staff open the POS invoice when they may view it there.
    if (account.kind === 'CUSTOMER')
      return `${base}/invoices/${encodeURIComponent(item.source.id)}`;
    return item.branch !== null && canAt(account, 'VIEW_INVOICES', item.branch.id)
      ? `${base}/pos/${encodeURIComponent(item.source.id)}`
      : null;
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
  if (params) {
    return (
      financeMessage(item, params, locale) ??
      inventoryMessage(item, params, locale) ??
      returnMessage(item, params, locale) ??
      t.types[item.type]
    );
  }
  return t.types[item.type];
}

const money = (value: string, locale: Locale) =>
  `${new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(BigInt(value))} ₫`;

/** Finance messages render from validated params only; a missing/unknown shape falls back to the type text. */
function financeMessage(
  item: NotificationItem,
  params: NonNullable<NotificationItem['params']>,
  locale: Locale,
): string | null {
  const t = getNotificationDictionary(locale);
  const f = t.finance;
  switch (item.type) {
    case 'INVOICE_PAID':
      return 'amountVnd' in params
        ? fill(f.paid, { amount: money(params.amountVnd, locale) })
        : null;
    case 'PAYOS_PAYMENT_SUCCEEDED':
      return 'amountVnd' in params
        ? fill(f.paymentSucceeded, { amount: money(params.amountVnd, locale) })
        : null;
    case 'PAYOS_PAYMENT_ANOMALY':
      return 'anomaly' in params
        ? fill(f.anomaly, {
            kind: f.anomalyKinds[params.anomaly],
            received: money(params.receivedAmountVnd, locale),
            expected:
              params.expectedAmountVnd === null
                ? f.notApplicable
                : money(params.expectedAmountVnd, locale),
          })
        : null;
    case 'PAYMENT_REVERSED':
      return 'method' in params && !('refundedBy' in params)
        ? fill(f.reversed, {
            method: f.methods[params.method],
            amount: money(params.amountVnd, locale),
          })
        : null;
    case 'INVOICE_CANCELLED_ALERT':
      return 'cancelledFrom' in params
        ? fill(f.cancelledAlert, {
            from: f.cancelledFrom[params.cancelledFrom],
            amount: money(params.amountVnd, locale),
          })
        : null;
    case 'REVENUE_DAILY_SUMMARY':
      return 'businessDate' in params && 'totalVnd' in params
        ? fill(f.summary, {
            date: formatLeaveDate(params.businessDate, locale),
            total: money(params.totalVnd, locale),
            cash: money(params.cashVnd, locale),
            payos: money(params.payosVnd, locale),
            paid: String(params.paidInvoiceCount),
            pending: String(params.pendingPaymentCount),
          })
        : null;
    default:
      return null;
  }
}

/**
 * A return notice names the case code (its context code) and the closed reason; a refund notice names the invoice, the SKU, the
 * quantity, the amount, the method and who refunded (all validated params); anything else falls back.
 */
function returnMessage(
  item: NotificationItem,
  params: NonNullable<NotificationItem['params']>,
  locale: Locale,
): string | null {
  const r = getNotificationDictionary(locale).returns;
  if (item.type === 'PRODUCT_REFUND_MADE' && 'refundedBy' in params) {
    return fill(params.source === 'EXCHANGE' ? r.exchangeRefundMade : r.refundMade, {
      amount: money(params.amountVnd, locale),
      method: r.methods[params.method],
      quantity: params.quantity,
      sku: params.sku,
      invoice: params.invoiceCode,
      who: params.refundedBy,
    });
  }
  if (item.type !== 'PRODUCT_RETURN_OPENED' || !('reason' in params)) return null;
  return fill(r.opened, { code: item.source.code, reason: r.reasons[params.reason] });
}

/** Stock alerts render from validated counts and the SKU (the notification's context code); anything else falls back. */
function inventoryMessage(
  item: NotificationItem,
  params: NonNullable<NotificationItem['params']>,
  locale: Locale,
): string | null {
  const i = getNotificationDictionary(locale).inventory;
  if (item.type === 'LOW_STOCK_REACHED' && 'onHand' in params) {
    return fill(i.lowStock, {
      sku: item.source.code,
      onHand: params.onHand,
      threshold: params.threshold,
    });
  }
  if (item.type === 'EXPIRED_LOT_SOLD' && 'lotCode' in params) {
    return fill(i.expiredLotSold, {
      quantity: params.quantity,
      sku: item.source.code,
      lot: params.lotCode,
      invoice: params.invoiceCode,
    });
  }
  if (item.type === 'EXPIRY_ALERT' && 'expiredLots' in params) {
    // Say only what is true: no "0 lots expired".
    const template =
      params.expiredLots === 0
        ? i.expiringOnly
        : params.expiringLots === 0
          ? i.expiredOnly
          : i.expiry;
    return fill(template, {
      expired: params.expiredLots,
      expiring: params.expiringLots,
      days: params.withinDays,
    });
  }
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

/** Category tabs: customers get no tabs (their few invoice messages need no filtering). */
/** Mirrors the registry's categories (a test compares them, so they cannot drift). */
export const INBOX_CATEGORIES: readonly NotificationCategory[] = ['OPERATIONS', 'HR', 'FINANCE'];
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
