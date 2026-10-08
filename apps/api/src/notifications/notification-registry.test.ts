import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedNotificationEntity,
  isNotificationType,
  NOTIFICATION_TYPES,
  notificationMetadata,
  notificationTarget,
  notificationTypesInCategory,
  parseNotificationParams,
} from '@lucy-spa/contracts';

const PHASE3 = [
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'LATE_CANCELLATION',
  'BOOKING_NO_SHOW',
  'CUSTOMER_ARRIVED',
  'BOOKING_KTV_CONFLICT',
  'KTV_REASSIGNED',
  'START_OVERDUE',
  'PRE_END',
  'END_OVERDUE',
];

const FINANCE = [
  'INVOICE_PAID',
  'INVOICE_CANCELLED',
  'PAYOS_PAYMENT_SUCCEEDED',
  'PAYOS_PAYMENT_ANOMALY',
  'PAYMENT_REVERSED',
  'INVOICE_CANCELLED_ALERT',
  'REVENUE_DAILY_SUMMARY',
];

// Phase 6 P6-4: stock alerts for the holders of VIEW_INVENTORY at the branch (operations).
const INVENTORY = ['LOW_STOCK_REACHED', 'EXPIRY_ALERT', 'EXPIRED_LOT_SOLD'];

// Phase 6 P6-12 (T35): a new product return case tells the holders of REFUND_PRODUCTS at the branch (operations).
const RETURNS = ['PRODUCT_RETURN_OPENED'];

// Phase 6 P6-13 follow-up (Owner, 2026-10-08): every product refund tells the Owner (finance, about one return case).
const REFUND_NOTICE = ['PRODUCT_REFUND_MADE'];

// Phase 6 P6-17 (OQ-34, OQ-86): the member is told in-app that pre-ordered goods arrived (finance, about the invoice); the holders of
// MANAGE_PRODUCT_ORDERS get one daily alert about late or uncollected pre-orders (operations, about the branch).
const ORDER_ARRIVED = ['PRODUCT_ORDER_ARRIVED'];
const ORDER_ALERT = ['PRODUCT_ORDER_ALERT'];

test('the registry keeps every Phase 3 type unchanged and adds the Leave, finance and stock alert types', () => {
  assert.deepEqual(
    [...NOTIFICATION_TYPES].sort(),
    [
      ...PHASE3,
      'LEAVE_REQUESTED',
      'LEAVE_DECIDED',
      ...FINANCE,
      ...INVENTORY,
      ...RETURNS,
      ...REFUND_NOTICE,
      ...ORDER_ARRIVED,
      ...ORDER_ALERT,
    ].sort(),
  );
  assert.deepEqual(notificationMetadata('LOW_STOCK_REACHED').entityTypes, ['ProductVariant']);
  assert.deepEqual(notificationMetadata('EXPIRY_ALERT').entityTypes, ['Branch']);
  for (const type of INVENTORY) {
    assert.equal(notificationMetadata(type as never).category, 'OPERATIONS');
    assert.ok(!isAllowedNotificationEntity(type as never, 'Booking'));
    assert.ok(!isAllowedNotificationEntity(type as never, 'Invoice'));
  }
  for (const type of PHASE3) {
    assert.ok(isNotificationType(type));
    const meta = notificationMetadata(type as never);
    assert.equal(meta.category, 'OPERATIONS');
    assert.equal(meta.params, 'NONE');
    // Phase 3 rows may reference a Booking or a Visit, exactly as the worker writes them.
    assert.ok(isAllowedNotificationEntity(type as never, 'Booking'));
    assert.ok(isAllowedNotificationEntity(type as never, 'Visit'));
    assert.ok(!isAllowedNotificationEntity(type as never, 'LeaveRequest'));
  }
  for (const type of ['LEAVE_REQUESTED', 'LEAVE_DECIDED'] as const) {
    assert.equal(notificationMetadata(type).category, 'HR');
    assert.deepEqual(notificationMetadata(type).entityTypes, ['LeaveRequest']);
    assert.ok(!isAllowedNotificationEntity(type, 'Booking'));
  }
  for (const type of FINANCE) {
    const meta = notificationMetadata(type as never);
    assert.equal(meta.category, 'FINANCE');
    // Only the revenue summary is about a branch; every other finance type is about one invoice.
    assert.deepEqual(meta.entityTypes, [type === 'REVENUE_DAILY_SUMMARY' ? 'Branch' : 'Invoice']);
    assert.ok(!isAllowedNotificationEntity(type as never, 'Booking'));
  }
  assert.ok(!isNotificationType('NOT_A_TYPE'));
  assert.ok(!isNotificationType('toString'));
});

test('category filters are derived from the registry, and targets from the entity', () => {
  assert.deepEqual([...notificationTypesInCategory('HR')].sort(), [
    'LEAVE_DECIDED',
    'LEAVE_REQUESTED',
  ]);
  assert.deepEqual(
    [...notificationTypesInCategory('FINANCE')].sort(),
    [...FINANCE, ...REFUND_NOTICE, ...ORDER_ARRIVED].sort(),
  );
  assert.equal(
    notificationTypesInCategory('OPERATIONS').length,
    PHASE3.length + INVENTORY.length + RETURNS.length + ORDER_ALERT.length,
  );
  assert.equal(notificationTarget('ProductVariant'), 'PRODUCT_VARIANT');
  assert.equal(notificationTarget('Invoice'), 'INVOICE');
  assert.equal(notificationTarget('Branch'), 'BRANCH');
  assert.equal(notificationTarget('Booking'), 'BOOKING');
  assert.equal(notificationTarget('Visit'), 'VISIT');
  assert.equal(notificationTarget('LeaveRequest'), 'LEAVE_REQUEST');
  for (const type of NOTIFICATION_TYPES) assert.equal(notificationMetadata(type).i18nKey, type);
});

const subject = '11111111-1111-4111-8111-111111111111';

test('params are a strict allowlist of ids, dates and enums; never free text', () => {
  assert.deepEqual(
    parseNotificationParams('LEAVE_REQUESTED', {
      subjectUserId: subject.toUpperCase(),
      startDate: '2026-10-05',
      endDate: '2026-10-07',
      leaveType: 'ANNUAL',
    }),
    { subjectUserId: subject, startDate: '2026-10-05', endDate: '2026-10-07', leaveType: 'ANNUAL' },
  );
  assert.deepEqual(
    parseNotificationParams('LEAVE_DECIDED', {
      decision: 'REJECTED',
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      leaveType: 'SICK',
    }),
    { decision: 'REJECTED', startDate: '2026-10-05', endDate: '2026-10-05', leaveType: 'SICK' },
  );
  assert.equal(parseNotificationParams('BOOKING_CREATED', null), null);
  const bad = (type: never, value: unknown) =>
    assert.throws(() => parseNotificationParams(type, value));
  bad('BOOKING_CREATED' as never, { anything: 1 });
  bad('LEAVE_DECIDED' as never, null);
  bad('LEAVE_DECIDED' as never, [] as unknown);
  // Extra keys (a reason, a name) and missing keys are refused.
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    leaveType: 'ANNUAL',
    reason: 'sick child',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-10-05',
    leaveType: 'ANNUAL',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'MAYBE',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    leaveType: 'ANNUAL',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-10-07',
    endDate: '2026-10-05',
    leaveType: 'ANNUAL',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-13-05',
    endDate: '2026-13-06',
    leaveType: 'ANNUAL',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    leaveType: 'HOLIDAY',
  });
  bad('LEAVE_REQUESTED' as never, {
    subjectUserId: 'Nguyen Van A',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    leaveType: 'ANNUAL',
  });
});

test('finance params carry only integer VND strings, counts and enums; never a reason or a name', () => {
  assert.deepEqual(parseNotificationParams('INVOICE_PAID', { amountVnd: '0' }), { amountVnd: '0' });
  assert.deepEqual(parseNotificationParams('PAYOS_PAYMENT_SUCCEEDED', { amountVnd: '200000' }), {
    amountVnd: '200000',
  });
  assert.deepEqual(
    parseNotificationParams('PAYOS_PAYMENT_ANOMALY', {
      anomaly: 'AMOUNT_MISMATCH',
      expectedAmountVnd: null,
      receivedAmountVnd: '150000',
    }),
    { anomaly: 'AMOUNT_MISMATCH', expectedAmountVnd: null, receivedAmountVnd: '150000' },
  );
  assert.deepEqual(
    parseNotificationParams('PAYMENT_REVERSED', { method: 'CASH', amountVnd: '5' }),
    {
      method: 'CASH',
      amountVnd: '5',
    },
  );
  assert.deepEqual(
    parseNotificationParams('INVOICE_CANCELLED_ALERT', {
      cancelledFrom: 'PAID',
      amountVnd: '0',
    }),
    { cancelledFrom: 'PAID', amountVnd: '0' },
  );
  const summary = {
    businessDate: '2026-10-05',
    totalVnd: '500000',
    cashVnd: '300000',
    payosVnd: '200000',
    paidInvoiceCount: 2,
    pendingPaymentCount: 0,
  };
  assert.deepEqual(parseNotificationParams('REVENUE_DAILY_SUMMARY', summary), summary);
  // The customer cancellation carries no params at all (no reason).
  assert.equal(parseNotificationParams('INVOICE_CANCELLED', null), null);

  const bad = (type: string, value: unknown) =>
    assert.throws(() => parseNotificationParams(type as never, value));
  bad('INVOICE_CANCELLED', { reason: 'Khách đổi ý' });
  bad('INVOICE_PAID', { amountVnd: 200000 }); // number, not a string
  bad('INVOICE_PAID', { amountVnd: '-1' });
  bad('INVOICE_PAID', { amountVnd: '01' });
  bad('INVOICE_PAID', { amountVnd: '1.5' });
  bad('INVOICE_PAID', { amountVnd: '1000000000000000' }); // more than 15 digits
  bad('INVOICE_PAID', { amountVnd: '1', reason: 'x' });
  bad('INVOICE_PAID', null);
  bad('PAYOS_PAYMENT_ANOMALY', {
    anomaly: 'SOMETHING_ELSE',
    expectedAmountVnd: null,
    receivedAmountVnd: '1',
  });
  bad('PAYMENT_REVERSED', { method: 'CARD', amountVnd: '1' });
  bad('INVOICE_CANCELLED_ALERT', { cancelledFrom: 'DRAFT', amountVnd: '1' });
  bad('REVENUE_DAILY_SUMMARY', { ...summary, paidInvoiceCount: -1 });
  bad('REVENUE_DAILY_SUMMARY', { ...summary, pendingPaymentCount: 1.5 });
  bad('REVENUE_DAILY_SUMMARY', { ...summary, businessDate: '2026-13-01' });
  bad('REVENUE_DAILY_SUMMARY', { ...summary, note: 'Doanh thu' });
});

test('the expired-lot alert names the invoice and the lot by plain codes and the quantity, and nothing else', () => {
  assert.deepEqual(notificationMetadata('EXPIRED_LOT_SOLD').entityTypes, ['ProductVariant']);
  assert.equal(notificationMetadata('EXPIRED_LOT_SOLD').severity, 'WARNING');
  assert.deepEqual(
    parseNotificationParams('EXPIRED_LOT_SOLD', {
      invoiceCode: 'INV-0001',
      lotCode: 'LÔ 07/2026',
      quantity: 2,
    }),
    { invoiceCode: 'INV-0001', lotCode: 'LÔ 07/2026', quantity: 2 },
  );
  const bad = (value: unknown) =>
    assert.throws(() => parseNotificationParams('EXPIRED_LOT_SOLD', value));
  const ok = { invoiceCode: 'INV-1', lotCode: 'L1', quantity: 1 };
  bad(null);
  bad({ ...ok, quantity: 0 });
  bad({ ...ok, quantity: 1.5 });
  bad({ ...ok, lotCode: '' });
  bad({ ...ok, lotCode: 'x'.repeat(65) });
  bad({ ...ok, lotCode: ' padded ' });
  bad({ ...ok, lotCode: 'two\nlines' });
  bad({ ...ok, invoiceCode: 'a\u0000b' });
  bad({ ...ok, invoiceCode: 7 });
  bad({ ...ok, note: 'free text' });
  bad({ invoiceCode: 'INV-1', quantity: 1 });
});

test('the return-case notice names the entity, the reason and nothing else', () => {
  assert.deepEqual(notificationMetadata('PRODUCT_RETURN_OPENED').entityTypes, [
    'ProductReturnCase',
  ]);
  assert.equal(notificationMetadata('PRODUCT_RETURN_OPENED').category, 'OPERATIONS');
  assert.equal(notificationTarget('ProductReturnCase'), 'PRODUCT_RETURN');
  assert.ok(isAllowedNotificationEntity('PRODUCT_RETURN_OPENED', 'ProductReturnCase'));
  for (const entity of [
    'Booking',
    'Visit',
    'Invoice',
    'Branch',
    'ProductVariant',
    'LeaveRequest',
  ] as const) {
    assert.ok(!isAllowedNotificationEntity('PRODUCT_RETURN_OPENED', entity), entity);
  }
  for (const reason of ['PERSONAL_PREFERENCE', 'WRONG_OR_DAMAGED', 'SKIN_IRRITATION']) {
    assert.deepEqual(parseNotificationParams('PRODUCT_RETURN_OPENED', { reason }), { reason });
  }
  const bad = (value: unknown) =>
    assert.throws(() => parseNotificationParams('PRODUCT_RETURN_OPENED', value));
  bad(null);
  bad({});
  bad({ reason: 'BORED' });
  bad({ reason: 'SKIN_IRRITATION', note: 'Khách bị đỏ da' });
  bad({ reason: 'SKIN_IRRITATION', customerName: 'A' });
  bad({ reason: 5 });
});

test('the refund notice (Owner) names invoice, product, quantity, amount, method and who, as plain checked text', () => {
  assert.deepEqual(notificationMetadata('PRODUCT_REFUND_MADE').entityTypes, [
    'ProductReturnCase',
    'ProductOrder',
  ]);
  assert.equal(notificationMetadata('PRODUCT_REFUND_MADE').category, 'FINANCE');
  assert.ok(isAllowedNotificationEntity('PRODUCT_REFUND_MADE', 'ProductReturnCase'));
  for (const entity of ['Booking', 'Visit', 'Invoice', 'Branch', 'ProductVariant'] as const) {
    assert.ok(!isAllowedNotificationEntity('PRODUCT_REFUND_MADE', entity), entity);
  }
  const good = {
    source: 'REFUND',
    invoiceCode: 'HD20261008-0007',
    sku: 'WH-001',
    quantity: 2,
    amountVnd: '180000',
    method: 'BANK_TRANSFER_MANUAL',
    refundedBy: 'Nguyễn Thị Lan',
  };
  assert.deepEqual(parseNotificationParams('PRODUCT_REFUND_MADE', good), good);
  assert.deepEqual(
    parseNotificationParams('PRODUCT_REFUND_MADE', { ...good, source: 'EXCHANGE', method: 'CASH' }),
    { ...good, source: 'EXCHANGE', method: 'CASH' },
  );
  const bad = (patch: Record<string, unknown>) =>
    assert.throws(() => parseNotificationParams('PRODUCT_REFUND_MADE', { ...good, ...patch }));
  assert.throws(() => parseNotificationParams('PRODUCT_REFUND_MADE', null));
  assert.throws(() => parseNotificationParams('PRODUCT_REFUND_MADE', {}));
  bad({ source: 'GIFT' });
  bad({ method: 'PAYOS' });
  bad({ method: 'CARD' });
  bad({ quantity: 0 });
  bad({ quantity: 1.5 });
  bad({ amountVnd: '-5' });
  bad({ amountVnd: 180000 });
  bad({ amountVnd: '01' });
  bad({ refundedBy: '' });
  bad({ refundedBy: 'x'.repeat(65) });
  bad({ refundedBy: 'dòng 1\ndòng 2' });
  bad({ sku: ' WH-001' });
  bad({ invoiceCode: '' });
  bad({ bankReference: 'FT26100801' });
  bad({ accountNumber: '0123456789' });
});

test('stock alert params are counts only: no names, no free text', () => {
  assert.deepEqual(parseNotificationParams('LOW_STOCK_REACHED', { onHand: 2, threshold: 3 }), {
    onHand: 2,
    threshold: 3,
  });
  assert.deepEqual(
    parseNotificationParams('EXPIRY_ALERT', { withinDays: 90, expiredLots: 0, expiringLots: 4 }),
    { withinDays: 90, expiredLots: 0, expiringLots: 4 },
  );
  const bad = (type: string, value: unknown) =>
    assert.throws(() => parseNotificationParams(type as never, value));
  bad('LOW_STOCK_REACHED', null);
  bad('LOW_STOCK_REACHED', { onHand: -1, threshold: 3 });
  bad('LOW_STOCK_REACHED', { onHand: 1.5, threshold: 3 });
  bad('LOW_STOCK_REACHED', { onHand: '1', threshold: 3 });
  bad('LOW_STOCK_REACHED', { onHand: 1, threshold: 3, sku: 'ABC' });
  bad('EXPIRY_ALERT', { withinDays: 0, expiredLots: 0, expiringLots: 1 });
  bad('EXPIRY_ALERT', { withinDays: 90, expiredLots: -1, expiringLots: 1 });
  bad('EXPIRY_ALERT', { withinDays: 90, expiredLots: 0 });
  bad('EXPIRY_ALERT', { withinDays: 90, expiredLots: 0, expiringLots: 1, note: 'x' });
});
