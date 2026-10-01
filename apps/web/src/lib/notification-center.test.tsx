import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationItem,
  type NotificationPage,
} from '@lucy-spa/contracts';
import {
  NotificationIndicator,
  NotificationInbox,
  NotificationTable,
  notificationMenu,
} from '../components/notifications/inbox';
import { getNotificationDictionary } from '../i18n/notifications';
import { customer, employee } from '../test/support';
import {
  applyItemUpdate,
  DEFAULT_INBOX_FILTERS,
  INBOX_CATEGORIES,
  inboxCategories,
  notificationHref,
  notificationMessage,
  notificationQuery,
} from './notifications';
import { WorkforceApi } from './workforce/api';

const phase3: NotificationItem = {
  id: 'phase3',
  type: 'END_OVERDUE',
  branch: { id: 'A', name: 'Spa', timezone: 'Asia/Ho_Chi_Minh' },
  source: { type: 'Visit', id: 'visit', code: 'VS-9' },
  actionAt: '2030-01-02T10:00:00.000Z',
  createdAt: '2030-01-02T10:00:01.000Z',
  readAt: null,
  archivedAt: null,
  params: null,
};
const leaveRequested: NotificationItem = {
  id: 'leave-1',
  type: 'LEAVE_REQUESTED',
  branch: null,
  source: { type: 'LeaveRequest', id: 'leave', code: 'LVN-1' },
  actionAt: '2030-01-02T10:00:00.000Z',
  createdAt: '2030-01-02T10:00:01.000Z',
  readAt: null,
  archivedAt: null,
  params: {
    subjectUserId: '11111111-1111-4111-8111-111111111111',
    startDate: '2030-03-10',
    endDate: '2030-03-12',
    leaveType: 'ANNUAL',
  },
};
const decided = (decision: 'APPROVED' | 'REJECTED'): NotificationItem => ({
  ...leaveRequested,
  id: `leave-${decision}`,
  type: 'LEAVE_DECIDED',
  params: { decision, startDate: '2030-03-10', endDate: '2030-03-12', leaveType: 'SICK' },
});
const noop = () => undefined;
const table = (item: NotificationItem, locale: 'vi' | 'en', href: string | null = null) =>
  renderToStaticMarkup(
    <NotificationTable
      items={[item]}
      locale={locale}
      hrefFor={() => href}
      pendingId={null}
      onRead={noop}
      onArchive={noop}
    />,
  );
const menuIds = (item: NotificationItem, locale: 'vi' | 'en', archivable = true) =>
  notificationMenu(item, getNotificationDictionary(locale), {
    pendingId: null,
    onRead: noop,
    ...(archivable ? { onArchive: noop } : {}),
  }).map((entry) => entry.id);

test('Leave notifications render from structured params in VI and EN, never from free text', () => {
  const vi = getNotificationDictionary('vi');
  const en = getNotificationDictionary('en');
  assert.match(
    notificationMessage(leaveRequested, 'vi'),
    /Có đơn xin nghỉ \(phép năm\) từ .*2030.* đến .*2030.* cần bạn xử lý\./,
  );
  assert.match(
    notificationMessage(leaveRequested, 'en'),
    /leave request \(annual leave\) from .*2030.* to .*2030.* needs your attention/,
  );
  assert.match(notificationMessage(decided('APPROVED'), 'vi'), /nghỉ ốm.*đã được duyệt\./);
  assert.match(notificationMessage(decided('REJECTED'), 'vi'), /nghỉ ốm.*đã bị từ chối\./);
  assert.match(notificationMessage(decided('APPROVED'), 'en'), /sick leave.*was approved\./);
  assert.match(notificationMessage(decided('REJECTED'), 'en'), /sick leave.*was rejected\./);
  // Without params (older rows, or params that failed validation) the generic text is used.
  assert.equal(
    notificationMessage({ ...leaveRequested, params: null }, 'vi'),
    vi.types.LEAVE_REQUESTED,
  );
  assert.equal(
    notificationMessage({ ...decided('APPROVED'), params: null }, 'en'),
    en.types.LEAVE_DECIDED,
  );
  // Phase 3 messages are unchanged by the new rendering.
  assert.equal(notificationMessage(phase3, 'vi'), vi.types.END_OVERDUE);
  assert.equal(notificationMessage(phase3, 'en'), en.types.END_OVERDUE);
  for (const locale of ['vi', 'en'] as const) {
    const t = getNotificationDictionary(locale);
    const html = table(decided('REJECTED'), locale, '/x/leave');
    assert.ok(html.includes(notificationMessage(decided('REJECTED'), locale)));
    assert.ok(html.includes('LVN-1'));
    assert.ok(html.includes(t.openLeave));
    assert.ok(html.includes('href="/x/leave"'));
    assert.deepEqual(menuIds(decided('REJECTED'), locale), ['read', 'archive']);
    assert.ok(!html.includes('LEAVE_DECIDED'), 'no raw event code');
  }
});

test('Leave links target the existing leave page for workforce accounts only', () => {
  assert.equal(
    notificationHref(leaveRequested, employee(), '/vi/workforce'),
    '/vi/workforce/leave',
  );
  assert.equal(
    notificationHref(decided('APPROVED'), employee(), '/vi/workforce'),
    '/vi/workforce/leave',
  );
  assert.equal(notificationHref(leaveRequested, customer, '/vi/account'), null);
});

test('archived items show their badge and no archive action', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getNotificationDictionary(locale);
    const archivedItem = { ...phase3, archivedAt: phase3.createdAt, readAt: phase3.createdAt };
    assert.ok(table(archivedItem, locale).includes(t.archivedBadge));
    assert.deepEqual(menuIds(archivedItem, locale), [], 'nothing left to do');
    // Without an archive handler (older callers) no archive action is offered.
    assert.deepEqual(menuIds(phase3, locale, false), ['read']);
  }
});

test('inbox filters translate to the API query and never name a recipient', () => {
  assert.deepEqual(notificationQuery(DEFAULT_INBOX_FILTERS), {});
  assert.deepEqual(notificationQuery(DEFAULT_INBOX_FILTERS, 'cursor'), { cursor: 'cursor' });
  const full = notificationQuery({ category: 'HR', unreadOnly: true, archived: true }, 'c');
  assert.deepEqual(full, { cursor: 'c', category: 'HR', unread: 'true', archived: 'true' });
  assert.ok(!('recipientUserId' in full));
  assert.deepEqual([...INBOX_CATEGORIES], [...NOTIFICATION_CATEGORIES], 'mirrors the registry');
  assert.deepEqual(inboxCategories(customer), []);
  assert.deepEqual([...inboxCategories(employee())], [...NOTIFICATION_CATEGORIES]);
});

test('a server result replaces the row and a view that no longer matches drops it', () => {
  const page: NotificationPage = {
    items: [phase3, leaveRequested],
    nextCursor: null,
    unreadCount: 2,
    unreadByCategory: { OPERATIONS: 1, HR: 1, FINANCE: 0 },
  };
  const read = { ...phase3, readAt: phase3.createdAt };
  assert.deepEqual(applyItemUpdate(page, read, DEFAULT_INBOX_FILTERS).items[0], read);
  // Reading an item leaves an "unread only" view; archiving leaves the default view.
  const unreadOnly = { ...DEFAULT_INBOX_FILTERS, unreadOnly: true };
  assert.equal(applyItemUpdate(page, read, unreadOnly).items.length, 1);
  const archived = { ...phase3, archivedAt: phase3.createdAt };
  assert.equal(applyItemUpdate(page, archived, DEFAULT_INBOX_FILTERS).items.length, 1);
  const archivedView = { ...DEFAULT_INBOX_FILTERS, archived: true };
  assert.equal(applyItemUpdate(page, archived, archivedView).items.length, 2);
});

test('bell and inbox render VI/EN chrome; customers get no category tabs, workforce does', () => {
  const api = new WorkforceApi({ fetch: () => new Promise<Response>(() => undefined) });
  for (const locale of ['vi', 'en'] as const) {
    const t = getNotificationDictionary(locale);
    const bell = renderToStaticMarkup(
      <NotificationIndicator api={api} base="/x" locale={locale} />,
    );
    assert.ok(bell.includes('<svg'));
    assert.ok(bell.includes(`aria-label="${t.bell}"`));
    const staff = renderToStaticMarkup(
      <NotificationInbox api={api} account={employee()} base="/x" locale={locale} />,
    );
    for (const text of [
      t.unreadOnly,
      t.showArchived,
      t.markAllRead,
      t.categories.HR,
      t.categories.OPERATIONS,
    ]) {
      assert.ok(staff.includes(text), text);
    }
    const guest = renderToStaticMarkup(
      <NotificationInbox api={api} account={customer} base="/x" locale={locale} />,
    );
    assert.ok(guest.includes(t.unreadOnly));
    assert.ok(!guest.includes(t.categories.HR));
  }
});

const finance = (
  type: NotificationItem['type'],
  params: NotificationItem['params'],
  source: NotificationItem['source'] = { type: 'Invoice', id: 'inv-1', code: 'INV-260930-ABCDEF' },
): NotificationItem => ({
  id: `fin-${type}`,
  type,
  branch: { id: 'A', name: 'Spa', timezone: 'Asia/Ho_Chi_Minh' },
  source,
  actionAt: '2030-01-02T10:00:00.000Z',
  createdAt: '2030-01-02T10:00:01.000Z',
  readAt: null,
  archivedAt: null,
  params,
});

test('finance notifications render amounts from validated params in VI and EN; the fallback is the type text', () => {
  const paid = finance('INVOICE_PAID', { amountVnd: '200000' });
  assert.match(notificationMessage(paid, 'vi'), /đã được thanh toán đủ \(200\.000 ₫\)/);
  assert.match(notificationMessage(paid, 'en'), /paid in full \(200,000 ₫\)/);
  const anomaly = finance('PAYOS_PAYMENT_ANOMALY', {
    anomaly: 'AMOUNT_MISMATCH',
    expectedAmountVnd: '200000',
    receivedAmountVnd: '150000',
  });
  assert.match(
    notificationMessage(anomaly, 'vi'),
    /sai số tiền.*nhận 150\.000 ₫, dự kiến 200\.000 ₫/,
  );
  assert.match(
    notificationMessage(anomaly, 'en'),
    /amount mismatch.*received 150,000 ₫, expected 200,000 ₫/,
  );
  const noExpected = finance('PAYOS_PAYMENT_ANOMALY', {
    anomaly: 'INVOICE_NOT_PAYABLE',
    expectedAmountVnd: null,
    receivedAmountVnd: '1000',
  });
  assert.match(notificationMessage(noExpected, 'en'), /expected n\/a/);
  assert.match(
    notificationMessage(finance('PAYMENT_REVERSED', { method: 'CASH', amountVnd: '5000' }), 'vi'),
    /tiền mặt \(5\.000 ₫\).*không phải hoàn tiền/,
  );
  assert.match(
    notificationMessage(finance('PAYMENT_REVERSED', { method: 'CASH', amountVnd: '5000' }), 'en'),
    /cash payment \(5,000 ₫\).*not a refund/,
  );
  assert.match(
    notificationMessage(
      finance('INVOICE_CANCELLED_ALERT', { cancelledFrom: 'PAID', amountVnd: '0' }),
      'en',
    ),
    /cancelled while paid/,
  );
  assert.match(
    notificationMessage(finance('PAYOS_PAYMENT_SUCCEEDED', { amountVnd: '200000' }), 'vi'),
    /PayOS bạn tạo đã thành công \(200\.000 ₫\)/,
  );
  const summary = finance(
    'REVENUE_DAILY_SUMMARY',
    {
      businessDate: '2030-01-02',
      totalVnd: '500000',
      cashVnd: '300000',
      payosVnd: '200000',
      paidInvoiceCount: 2,
      pendingPaymentCount: 3,
    },
    { type: 'Branch', id: 'A', code: '2030-01-02' },
  );
  for (const locale of ['vi', 'en'] as const) {
    const text = notificationMessage(summary, locale);
    for (const part of ['500', '300', '200', '21:30', '2 ', '3 '])
      assert.ok(text.includes(part), part);
  }
  // The customer cancellation carries no params: the generic text, with no reason anywhere.
  assert.equal(
    notificationMessage(finance('INVOICE_CANCELLED', null), 'vi'),
    getNotificationDictionary('vi').types.INVOICE_CANCELLED,
  );
  // Missing or mismatched params never break rendering.
  assert.equal(
    notificationMessage(finance('INVOICE_PAID', null), 'en'),
    getNotificationDictionary('en').types.INVOICE_PAID,
  );
  assert.equal(
    notificationMessage(finance('REVENUE_DAILY_SUMMARY', { amountVnd: '1' }), 'en'),
    getNotificationDictionary('en').types.REVENUE_DAILY_SUMMARY,
  );
});

test('invoice links open the customer invoice or the POS invoice for staff who may view it; a summary has no link', () => {
  const paid = finance('INVOICE_PAID', { amountVnd: '200000' });
  assert.equal(notificationHref(paid, customer, '/vi/account'), '/vi/account/invoices/inv-1');
  assert.equal(
    notificationHref(paid, employee([['VIEW_INVOICES', 'A']]), '/vi/workforce'),
    '/vi/workforce/pos/inv-1',
  );
  // Another branch or no permission: no link (the destination API would refuse anyway).
  assert.equal(notificationHref(paid, employee([['VIEW_INVOICES', 'B']]), '/vi/workforce'), null);
  assert.equal(
    notificationHref(paid, employee([['PERFORM_SERVICES', 'A']]), '/vi/workforce'),
    null,
  );
  const summary = finance(
    'REVENUE_DAILY_SUMMARY',
    {
      businessDate: '2030-01-02',
      totalVnd: '0',
      cashVnd: '0',
      payosVnd: '0',
      paidInvoiceCount: 0,
      pendingPaymentCount: 0,
    },
    { type: 'Branch', id: 'A', code: '2030-01-02' },
  );
  assert.equal(notificationHref(summary, employee([['VIEW_REVENUE', 'A']]), '/vi/workforce'), null);
});

test('a finance card shows the invoice code, the VI/EN message and the invoice action', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getNotificationDictionary(locale);
    const item = finance('INVOICE_PAID', { amountVnd: '200000' });
    const html = table(item, locale, '/x/invoices/inv-1');
    assert.ok(html.includes('INV-260930-ABCDEF'));
    assert.ok(html.includes(t.finance.openInvoice));
    assert.ok(html.includes(locale === 'vi' ? '200.000' : '200,000'), 'the amount is rendered');
    assert.ok(!html.includes('INVOICE_PAID'), 'no raw event code');
  }
});
