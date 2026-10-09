import type { NotificationItem } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNotificationDictionary } from '../../i18n/notifications';
import { employee, owner } from '../../test/support';
import { notificationHref, notificationMessage } from '../notifications';

const branch = { id: 'A', name: 'Chi nhánh A', timezone: 'Asia/Ho_Chi_Minh' };
const base = {
  branch,
  actionAt: '2026-10-09T03:00:00.000Z',
  createdAt: '2026-10-09T03:00:00.000Z',
  readAt: null,
  archivedAt: null,
  params: null,
};
const fresh = (): NotificationItem => ({
  ...base,
  id: 'n1',
  type: 'ONLINE_ORDER_NEW',
  source: { type: 'ProductOrder', id: 'o1', code: 'DO000012' },
});
const alert = (): NotificationItem => ({
  ...base,
  id: 'n2',
  type: 'ONLINE_ORDER_ALERT',
  source: { type: 'Branch', id: 'A', code: '2026-10-09' },
  params: { unshippedOrders: 2, undeliveredOrders: 1 },
});

test('a new online order opens the online order page for those who pack or refund at its branch', () => {
  assert.equal(
    notificationHref(fresh(), employee([['MANAGE_PRODUCT_ORDERS', 'A']]), '/vi/workforce'),
    '/vi/workforce/online-orders/o1',
  );
  assert.equal(
    notificationHref(fresh(), employee([['REFUND_PRODUCTS', 'A']]), '/vi/workforce'),
    '/vi/workforce/online-orders/o1',
  );
  assert.equal(notificationHref(fresh(), owner, '/vi/workforce'), '/vi/workforce/online-orders/o1');
  assert.equal(
    notificationHref(fresh(), employee([['MANAGE_PRODUCT_ORDERS', 'B']]), '/vi/workforce'),
    null,
    'another branch gives no link',
  );
});

test('the daily online alert opens the online queue of its branch, not the pre-order queue', () => {
  assert.equal(
    notificationHref(alert(), employee([['MANAGE_PRODUCT_ORDERS', 'A']]), '/vi/workforce'),
    '/vi/workforce/online-orders?branch=A',
  );
  assert.equal(
    notificationHref(alert(), employee([['VIEW_INVENTORY', 'A']]), '/vi/workforce'),
    null,
  );
});

test('the daily online alert says only what is true', () => {
  assert.equal(
    notificationMessage(alert(), 'vi'),
    'Đơn online: 2 đơn chưa gửi đúng hẹn, 1 đơn đã gửi quá 7 ngày mà chưa có ngày giao.',
  );
  const only = (unshipped: number, undelivered: number): NotificationItem => ({
    ...alert(),
    params: { unshippedOrders: unshipped, undeliveredOrders: undelivered },
  });
  assert.equal(notificationMessage(only(3, 0), 'vi'), 'Đơn online: 3 đơn chưa gửi đúng hẹn.');
  assert.doesNotMatch(notificationMessage(only(3, 0), 'vi'), /\b0 đơn/);
  assert.match(notificationMessage(only(0, 4), 'en'), /^Online orders: 4 shipped over 7 days ago/);
  assert.doesNotMatch(notificationMessage(alert(), 'vi'), /khám/i);
});

test('every online order notice has a text in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const types = getNotificationDictionary(locale).types;
    for (const type of [
      'ONLINE_ORDER_SHIPPED',
      'ONLINE_ORDER_DELIVERED',
      'ONLINE_ORDER_DELIVERY_FAILED',
      'ONLINE_ORDER_CANCELLED',
      'ONLINE_ORDER_REFUNDED',
      'ONLINE_ORDER_NEW',
      'ONLINE_ORDER_ALERT',
    ] as const) {
      assert.ok(types[type].length > 10, `${locale} ${type}`);
      assert.doesNotMatch(types[type], /khám/i);
    }
  }
});
