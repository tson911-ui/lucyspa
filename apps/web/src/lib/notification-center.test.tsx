import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationItem,
  type NotificationPage,
} from '@lucy-spa/contracts';
import {
  NotificationCard,
  NotificationIndicator,
  NotificationInbox,
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
    const html = renderToStaticMarkup(
      <NotificationCard
        item={decided('REJECTED')}
        locale={locale}
        href="/x/leave"
        busy={false}
        onRead={noop}
        onArchive={noop}
      />,
    );
    assert.ok(html.includes(notificationMessage(decided('REJECTED'), locale)));
    assert.ok(html.includes('LVN-1'));
    assert.ok(html.includes(t.openLeave));
    assert.ok(html.includes(`>${t.archive}</button>`));
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
    const archived = renderToStaticMarkup(
      <NotificationCard
        item={{ ...phase3, archivedAt: phase3.createdAt, readAt: phase3.createdAt }}
        locale={locale}
        href={null}
        busy={false}
        onRead={noop}
        onArchive={noop}
      />,
    );
    assert.ok(archived.includes(t.archivedBadge));
    assert.ok(!archived.includes(`>${t.archive}</button>`));
    // Without an archive handler (older callers) no archive action is offered.
    const plain = renderToStaticMarkup(
      <NotificationCard item={phase3} locale={locale} href={null} busy={false} onRead={noop} />,
    );
    assert.ok(!plain.includes(`>${t.archive}</button>`));
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
    unreadByCategory: { OPERATIONS: 1, HR: 1 },
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
