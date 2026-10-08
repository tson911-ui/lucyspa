import type { NotificationItem } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNotificationDictionary } from '../i18n/notifications';
import { customer, employee, owner } from '../test/support';
import { notificationHref, notificationMessage } from './notifications';

/** Phase 6 P6-12 (T35): the notice a new return case sends to the holders of REFUND_PRODUCTS at the branch. */
const opened = (reason: 'PERSONAL_PREFERENCE' | 'WRONG_OR_DAMAGED' | 'SKIN_IRRITATION') =>
  ({
    id: 'n1',
    type: 'PRODUCT_RETURN_OPENED',
    branch: { id: 'A', name: 'Chi nhánh A', timezone: 'Asia/Ho_Chi_Minh' },
    source: { type: 'ProductReturnCase', id: 'case-1', code: 'TH000007' },
    actionAt: '2026-10-08T05:00:00.000Z',
    createdAt: '2026-10-08T05:00:00.000Z',
    readAt: null,
    archivedAt: null,
    params: { reason },
  }) satisfies NotificationItem;

test('the notice names the case code and a closed reason, in both languages', () => {
  assert.equal(
    notificationMessage(opened('SKIN_IRRITATION'), 'vi'),
    'Có hồ sơ trả hàng mới TH000007: kích ứng da.',
  );
  assert.equal(
    notificationMessage(opened('WRONG_OR_DAMAGED'), 'vi'),
    'Có hồ sơ trả hàng mới TH000007: giao nhầm hoặc hỏng do đóng gói.',
  );
  assert.equal(
    notificationMessage(opened('PERSONAL_PREFERENCE'), 'en'),
    'New return case TH000007: changed their mind.',
  );
  const noParams = { ...opened('SKIN_IRRITATION'), params: null };
  assert.equal(
    notificationMessage(noParams, 'vi'),
    getNotificationDictionary('vi').types.PRODUCT_RETURN_OPENED,
    'without params the generic text of the type is shown',
  );
  assert.doesNotMatch(notificationMessage(opened('SKIN_IRRITATION'), 'vi'), /khám/i);
});

test('the notice opens the case only for people who handle returns or refunds at its branch', () => {
  const base = '/vi/workforce';
  const href = '/vi/workforce/product-returns/case-1';
  assert.equal(notificationHref(opened('SKIN_IRRITATION'), owner, base), href);
  assert.equal(
    notificationHref(opened('SKIN_IRRITATION'), employee([['REFUND_PRODUCTS', 'A']]), base),
    href,
  );
  assert.equal(
    notificationHref(opened('SKIN_IRRITATION'), employee([['MANAGE_PRODUCT_RETURNS', 'A']]), base),
    href,
  );
  assert.equal(
    notificationHref(opened('SKIN_IRRITATION'), employee([['REFUND_PRODUCTS', 'B']]), base),
    null,
    'a holder at another branch gets no link',
  );
  assert.equal(notificationHref(opened('SKIN_IRRITATION'), employee(), base), null);
  assert.equal(notificationHref(opened('SKIN_IRRITATION'), customer, '/vi/account'), null);
});

/** Phase 6 P6-13 follow-up (Owner, 2026-10-08): every product refund tells the Owner. */
const refundMade = (
  patch: Partial<Extract<NonNullable<NotificationItem['params']>, { refundedBy: string }>> = {},
) =>
  ({
    id: 'n2',
    type: 'PRODUCT_REFUND_MADE',
    branch: { id: 'A', name: 'Chi nhánh A', timezone: 'Asia/Ho_Chi_Minh' },
    source: { type: 'ProductReturnCase', id: 'case-1', code: 'TH000007' },
    actionAt: '2026-10-08T05:00:00.000Z',
    createdAt: '2026-10-08T05:00:00.000Z',
    readAt: null,
    archivedAt: null,
    params: {
      source: 'REFUND',
      invoiceCode: 'HD20261008-0007',
      sku: 'WH-001',
      quantity: 2,
      amountVnd: '180000',
      method: 'BANK_TRANSFER_MANUAL',
      refundedBy: 'Nguyễn Thị Lan',
      ...patch,
    },
  }) satisfies NotificationItem;

test('the refund notice names invoice, product, quantity, amount, method and who refunded, in both languages', () => {
  assert.equal(
    notificationMessage(refundMade(), 'vi'),
    'Đã hoàn 180.000 ₫ (chuyển khoản) cho 2 × WH-001, hóa đơn HD20261008-0007. Người hoàn: Nguyễn Thị Lan.',
  );
  assert.equal(
    notificationMessage(refundMade({ method: 'CASH' }), 'en'),
    'Refunded 180,000 ₫ (cash) for 2 × WH-001, invoice HD20261008-0007. Refunded by: Nguyễn Thị Lan.',
  );
  assert.equal(
    notificationMessage(refundMade({ source: 'EXCHANGE', method: 'CASH' }), 'vi'),
    'Đổi hàng: đã hoàn phần chênh 180.000 ₫ (tiền mặt) cho 2 × WH-001, hóa đơn HD20261008-0007. Người hoàn: Nguyễn Thị Lan.',
  );
  const noParams = { ...refundMade(), params: null };
  assert.equal(
    notificationMessage(noParams, 'vi'),
    getNotificationDictionary('vi').types.PRODUCT_REFUND_MADE,
    'without params the generic text of the type is shown',
  );
  assert.doesNotMatch(notificationMessage(refundMade(), 'vi'), /khám/i);
});

test('the refund notice opens the case for people who handle refunds at its branch, and the Owner', () => {
  const base = '/vi/workforce';
  const href = '/vi/workforce/product-returns/case-1';
  assert.equal(notificationHref(refundMade(), owner, base), href);
  assert.equal(notificationHref(refundMade(), employee([['REFUND_PRODUCTS', 'A']]), base), href);
  assert.equal(notificationHref(refundMade(), employee(), base), null);
  assert.equal(notificationHref(refundMade(), customer, '/vi/account'), null);
});
