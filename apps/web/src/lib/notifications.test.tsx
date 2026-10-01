import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NotificationItem } from '@lucy-spa/contracts';
import { NotificationTable, notificationMenu } from '../components/notifications/inbox';
import { WorkforceNotificationsScreen } from '../components/workforce/screens/notifications';
import { getNotificationDictionary } from '../i18n/notifications';
import { customer, employee, render } from '../test/support';
import { mergeNotifications, notificationHref } from './notifications';

const item: NotificationItem = {
  id: 'notification',
  type: 'END_OVERDUE',
  branch: { id: 'A', name: 'Spa', timezone: 'Asia/Ho_Chi_Minh' },
  source: { type: 'Visit', id: 'visit', code: 'VS-9' },
  actionAt: '2030-01-02T10:00:00.000Z',
  createdAt: '2030-01-02T10:00:01.000Z',
  readAt: null,
  archivedAt: null,
  params: null,
};
const table = (items: NotificationItem[], locale: 'vi' | 'en') =>
  renderToStaticMarkup(
    <NotificationTable
      items={items}
      locale={locale}
      hrefFor={() => null}
      pendingId={null}
      onRead={() => undefined}
    />,
  );
test('workforce inbox and operational warnings render VI/EN without exposing event codes', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getNotificationDictionary(locale);
    assert.ok(render(<WorkforceNotificationsScreen />, employee(), locale).includes(t.title));
    for (const type of Object.keys(t.types) as NotificationItem['type'][]) {
      const html = table([{ ...item, type }], locale);
      assert.ok(html.includes(t.types[type]));
      assert.ok(html.includes(t.unread));
      assert.ok(!html.includes(type));
      const menu = notificationMenu({ ...item, type }, t, {
        pendingId: null,
        onRead: () => undefined,
      });
      assert.deepEqual(
        menu.map((entry) => [entry.id, entry.label]),
        [['read', t.markRead]],
      );
    }
    const readItem = { ...item, readAt: item.createdAt };
    const read = table([readItem], locale);
    assert.ok(read.includes(t.read));
    assert.deepEqual(
      notificationMenu(readItem, t, { pendingId: null, onRead: () => undefined }),
      [],
    );
    const busy = notificationMenu(item, t, { pendingId: item.id, onRead: () => undefined });
    assert.equal(busy[0]?.disabled, true);
    assert.equal(busy[0]?.label, t.working);
  }
});
test('notification links use permission hints and internal routes; server read results replace unread rows', () => {
  assert.equal(
    notificationHref(item, employee([['PERFORM_SERVICES', 'A']]), '/en/workforce'),
    '/en/workforce/my-services',
  );
  assert.equal(
    notificationHref(item, employee([['PERFORM_SERVICES', 'B']]), '/en/workforce'),
    null,
  );
  assert.equal(
    notificationHref(item, employee([['VIEW_BOOKINGS', 'A']]), '/en/workforce'),
    '/en/workforce/booking-board',
  );
  assert.equal(
    notificationHref(
      { ...item, type: 'KTV_REASSIGNED' },
      employee([['REASSIGN_SERVICES', 'A']]),
      '/en/workforce',
    ),
    '/en/workforce/reassignment',
  );
  assert.equal(notificationHref(item, customer, '/en/account'), null);
  assert.equal(
    notificationHref(
      { ...item, source: { type: 'Booking', id: 'booking', code: 'BK' } },
      customer,
      '/en/account',
    ),
    '/en/account/bookings/booking',
  );
  assert.deepEqual(mergeNotifications([item], [{ ...item, readAt: item.createdAt }]), [
    { ...item, readAt: item.createdAt },
  ]);
});
