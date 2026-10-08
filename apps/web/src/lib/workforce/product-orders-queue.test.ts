import type { NotificationItem } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNotificationDictionary } from '../../i18n/notifications';
import { productOrdersDictionary } from '../../i18n/product-orders';
import { customer, employee, owner } from '../../test/support';
import { notificationHref, notificationMessage } from '../notifications';
import { ApiError } from './api';
import {
  cancelRequest,
  emptyCancelDraft,
  emptyHandOverDraft,
  handOverRequest,
  isQueueConflict,
  normalizeQueueList,
  queueErrorText,
  queueTab,
  declineNoteProblem,
  validAmount,
  validateCancel,
  validateHandOver,
} from './product-orders';

/** Phase 6 P6-17: the parts of the queue screens that are not drawing. */

test('the queue address: an unknown tab or page falls back, the search is bounded', () => {
  assert.deepEqual(
    normalizeQueueList({ branch: 'A', tab: 'NONSENSE', q: 'x'.repeat(200), page: -3 }),
    {
      branch: 'A',
      tab: 'TO_ORDER',
      q: 'x'.repeat(80),
      page: 1,
    },
  );
  assert.equal(queueTab('ARRIVED'), 'ARRIVED');
  assert.equal(queueTab('zzz'), 'TO_ORDER');
});

test('a hand-over needs the order code and exactly four digits, and a name for a representative', () => {
  const draft = { ...emptyHandOverDraft(), orderCode: ' DT000012 ', last4: '4567' };
  assert.deepEqual(validateHandOver(draft), {});
  assert.deepEqual(handOverRequest(draft, 3), {
    expectedVersion: 3,
    to: 'CUSTOMER',
    representativeName: null,
    orderCode: 'DT000012',
    phoneLast4: '4567',
    note: null,
  });
  assert.deepEqual(validateHandOver({ ...draft, last4: '45' }), { last4: true });
  assert.deepEqual(validateHandOver({ ...draft, last4: '45a7' }), { last4: true });
  assert.deepEqual(validateHandOver({ ...draft, orderCode: '  ' }), { orderCode: true });
  const rep = { ...draft, to: 'REPRESENTATIVE' as const };
  assert.deepEqual(validateHandOver(rep), { representative: true });
  assert.equal(handOverRequest(rep, 3), null);
  assert.equal(
    handOverRequest({ ...rep, representative: ' Bà Lan ', note: ' con gái ' }, 3)
      ?.representativeName,
    'Bà Lan',
  );
  assert.equal(
    handOverRequest({ ...rep, representative: 'Bà Lan', note: ' con gái ' }, 3)?.note,
    'con gái',
  );
});

test('a cancellation needs a cause and a note; a transfer needs its reference; cash sends none', () => {
  const base = {
    ...emptyCancelDraft(),
    cause: 'CUSTOMER_CHANGED_MIND' as const,
    note: ' Khách đổi ý ',
  };
  assert.deepEqual(validateCancel(base), {});
  assert.deepEqual(cancelRequest(base, 5, 'r1'), {
    expectedVersion: 5,
    cause: 'CUSTOMER_CHANGED_MIND',
    note: 'Khách đổi ý',
    method: 'CASH',
    bankReference: null,
    clientRequestId: 'r1',
  });
  assert.deepEqual(validateCancel({ ...base, cause: '' }), { cause: true });
  assert.deepEqual(validateCancel({ ...base, note: ' ' }), { note: true });
  const transfer = { ...base, method: 'BANK_TRANSFER_MANUAL' as const };
  assert.deepEqual(validateCancel(transfer), { bankReference: true });
  assert.deepEqual(validateCancel({ ...transfer, bankReference: 'x'.repeat(65) }), {
    bankReference: true,
  });
  assert.equal(
    cancelRequest({ ...transfer, bankReference: ' FT0001 ' }, 5, 'r1')?.bankReference,
    'FT0001',
  );
  // A reference typed before switching back to cash is never sent.
  assert.equal(cancelRequest({ ...base, bankReference: 'FT0001' }, 5, 'r1')?.bankReference, null);
  assert.equal(cancelRequest({ ...base, cause: '' }, 5, 'r1'), null);
});

test('a change of mind may refund a part of the share: whole dong from 1 up to the share; whole share or no amount sends none', () => {
  const share = '400000';
  const mind = {
    ...emptyCancelDraft(),
    cause: 'CUSTOMER_CHANGED_MIND' as const,
    note: 'Khách đổi ý',
    amount: share,
  };
  assert.deepEqual(validateCancel(mind, share), {});
  assert.equal(
    cancelRequest(mind, 5, 'r1', share)?.amountVnd,
    undefined,
    'the whole share is the default',
  );
  assert.equal(cancelRequest({ ...mind, amount: ' 150000 ' }, 5, 'r1', share)?.amountVnd, '150000');
  assert.equal(cancelRequest({ ...mind, amount: '1' }, 5, 'r1', share)?.amountVnd, '1');
  for (const amount of [
    '',
    '0',
    '-5',
    '12.5',
    '1e5',
    'abc',
    '0400',
    '400001',
    '99999999999999999999',
  ]) {
    assert.deepEqual(validateCancel({ ...mind, amount }, share), { amount: true }, amount);
    assert.equal(cancelRequest({ ...mind, amount }, 5, 'r1', share), null, amount);
  }
  // Another cause never sends an amount, and a line nothing was paid for has none to check.
  const supplier = { ...mind, cause: 'SUPPLIER_CANNOT_DELIVER' as const, amount: '100' };
  assert.deepEqual(validateCancel(supplier, share), {});
  assert.equal(cancelRequest(supplier, 5, 'r1', share)?.amountVnd, undefined);
  assert.deepEqual(validateCancel({ ...mind, amount: '' }, '0'), {});
  assert.equal(validAmount('400000', '400000'), true);
  assert.equal(validAmount('400000', '399999'), false);
  assert.equal(declineNoteProblem('  '), true);
  assert.equal(declineNoteProblem('Đã đặt hàng xong'), false);
});

test('refused commands read as plain Vietnamese or English; a moved line asks for a reload', () => {
  const proof = new ApiError(409, 'ORDER_HANDOVER_PROOF_INVALID');
  assert.equal(
    queueErrorText(proof, 'vi', () => 'fallback'),
    productOrdersDictionary('vi').queueErrors.ORDER_HANDOVER_PROOF_INVALID,
  );
  assert.match(
    queueErrorText(proof, 'en', () => 'fallback'),
    /do not match/,
  );
  assert.equal(
    queueErrorText(new Error('boom'), 'vi', () => 'fallback'),
    'fallback',
  );
  assert.equal(isQueueConflict(new ApiError(409, 'CONFLICT')), true);
  assert.equal(isQueueConflict(new ApiError(409, 'ORDER_LINE_STATE_INVALID')), true);
  assert.equal(isQueueConflict(new ApiError(403, 'FORBIDDEN')), false);
  for (const text of Object.values(productOrdersDictionary('vi').queueErrors)) {
    assert.doesNotMatch(text, /khám/i);
  }
});

// ------------------------------------------------------------------------------------------------ notifications

const branch = { id: 'A', name: 'Chi nhánh A', timezone: 'Asia/Ho_Chi_Minh' };
const arrived = (): NotificationItem => ({
  id: 'n1',
  type: 'PRODUCT_ORDER_ARRIVED',
  branch,
  source: { type: 'Invoice', id: 'inv-1', code: 'DT000012' },
  actionAt: '2026-10-09T03:00:00.000Z',
  createdAt: '2026-10-09T03:00:00.000Z',
  readAt: null,
  archivedAt: null,
  params: null,
});
const alert = (lateLines: number, heldLines: number): NotificationItem => ({
  id: 'n2',
  type: 'PRODUCT_ORDER_ALERT',
  branch,
  source: { type: 'Branch', id: 'A', code: '2026-10-09' },
  actionAt: '2026-10-09T01:00:00.000Z',
  createdAt: '2026-10-09T01:00:00.000Z',
  readAt: null,
  archivedAt: null,
  params: { lateLines, heldLines },
});
const cancelRefund = (): NotificationItem => ({
  id: 'n3',
  type: 'PRODUCT_REFUND_MADE',
  branch,
  source: { type: 'ProductOrder', id: 'o1', code: 'DT000012' },
  actionAt: '2026-10-09T03:00:00.000Z',
  createdAt: '2026-10-09T03:00:00.000Z',
  readAt: null,
  archivedAt: null,
  params: {
    source: 'ORDER_CANCEL',
    invoiceCode: 'HD000042',
    sku: 'KEM-50',
    quantity: 2,
    amountVnd: '400000',
    method: 'CASH',
    refundedBy: 'Lan',
  },
});

test('the member is told the goods arrived, with the order code and no personal detail', () => {
  assert.equal(
    notificationMessage(arrived(), 'vi'),
    'Hàng đặt trước DT000012 của bạn đã về. Mời bạn đến cửa hàng nhận hàng.',
  );
  assert.match(notificationMessage(arrived(), 'en'), /DT000012/);
  assert.doesNotMatch(notificationMessage(arrived(), 'vi'), /khám|\+84|0\d{9}/);
  // The member opens their own invoice from it.
  assert.equal(notificationHref(arrived(), customer, '/vi/account'), '/vi/account/invoices/inv-1');
});

test('the daily alert says only what is true and opens the queue for those who work the orders', () => {
  assert.match(
    notificationMessage(alert(2, 1), 'vi'),
    /2 dòng trễ hẹn, 1 dòng hàng đã về chờ khách nhận quá 7 ngày/,
  );
  assert.equal(
    notificationMessage(alert(3, 0), 'vi'),
    'Đặt trước: 3 dòng trễ hẹn so với ngày dự kiến.',
  );
  assert.equal(
    notificationMessage(alert(0, 4), 'vi'),
    'Đặt trước: 4 dòng hàng đã về chờ khách nhận quá 7 ngày.',
  );
  assert.doesNotMatch(notificationMessage(alert(3, 0), 'vi'), /\b0 dòng/);
  assert.equal(
    notificationHref(alert(1, 1), employee([['MANAGE_PRODUCT_ORDERS', 'A']]), '/vi/workforce'),
    '/vi/workforce/product-orders?branch=A',
  );
  assert.equal(
    notificationHref(alert(1, 1), employee([['VIEW_INVENTORY', 'A']]), '/vi/workforce'),
    null,
  );
  assert.equal(
    notificationHref(alert(1, 1), employee([['MANAGE_PRODUCT_ORDERS', 'B']]), '/vi/workforce'),
    null,
    'another branch gives no link',
  );
});

test('a refund of a cancelled pre-order line reads as such and opens the order for those who may', () => {
  assert.match(
    notificationMessage(cancelRefund(), 'vi'),
    /^Hủy hàng đặt trước: đã hoàn 400\.000 ₫ \(tiền mặt\)/,
  );
  assert.match(notificationMessage(cancelRefund(), 'en'), /^Pre-order cancelled: refunded/);
  assert.equal(
    notificationHref(cancelRefund(), employee([['REFUND_PRODUCTS', 'A']]), '/vi/workforce'),
    '/vi/workforce/product-orders/o1',
  );
  assert.equal(
    notificationHref(cancelRefund(), owner, '/vi/workforce'),
    '/vi/workforce/product-orders/o1',
  );
  assert.equal(
    notificationHref(cancelRefund(), employee([['SELL_PRODUCTS', 'A']]), '/vi/workforce'),
    null,
  );
  // Every new type has its own generic text in both languages.
  for (const locale of ['vi', 'en'] as const) {
    const types = getNotificationDictionary(locale).types;
    assert.ok(types.PRODUCT_ORDER_ARRIVED.length > 10);
    assert.ok(types.PRODUCT_ORDER_ALERT.length > 10);
  }
});
