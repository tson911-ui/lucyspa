import type { ProductRefundResponse, ProductRefundSummaryResponse } from '@lucy-spa/contracts';
import { productRefundAmount, productRefundLineState } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productRefundsDictionary } from '../../i18n/product-refunds';
import { ApiError } from './api';
import {
  emptyRefundDraft,
  isRefundConflict,
  refundErrorText,
  refundPreview,
  refundRequest,
  transferRefunds,
  validateRefundDraft,
  type RefundDraft,
} from './product-refunds';

const summary = (
  patch: Partial<ProductRefundSummaryResponse> = {},
): ProductRefundSummaryResponse => ({
  caseId: 'c1',
  caseCode: 'TH000001',
  invoiceCode: 'HD000001',
  lineNetVnd: '29129',
  soldQuantity: 3,
  lineRefundedQuantity: 0,
  lineRefundedVnd: '0',
  lineState: 'NOT_REFUNDED',
  caseQuantity: 3,
  caseRefundedQuantity: 0,
  caseRemainingQuantity: 3,
  refundable: true,
  blocked: null,
  refunds: [],
  can: { refund: true, correctReference: false },
  ...patch,
});

const draft = (patch: Partial<RefundDraft> = {}): RefundDraft => ({
  ...emptyRefundDraft(),
  restock: 'SELLABLE',
  reason: 'Khách trả hàng',
  ...patch,
});

test('the shared rule gives 9,710 + 9,709 + 9,710 for a net of 29,129 over 3 units', () => {
  assert.deepEqual(
    [0, 1, 2].map((before) => productRefundAmount(29_129n, 3, before, 1)),
    [9_710n, 9_709n, 9_710n],
  );
  assert.equal(productRefundAmount(29_129n, 3, 0, 3), 29_129n);
  assert.equal(productRefundAmount(29_129n, 3, 2, 1), 9_710n);
  assert.throws(() => productRefundAmount(100n, 3, 2, 2), RangeError);
  assert.throws(() => productRefundAmount(100n, 3, 0, 0), RangeError);
  assert.throws(() => productRefundAmount(100n, 0, 0, 1), RangeError);
});

test('a line is refunded only when every unit is', () => {
  assert.equal(productRefundLineState(0, 3), 'NOT_REFUNDED');
  assert.equal(productRefundLineState(2, 3), 'PARTIALLY_REFUNDED');
  assert.equal(productRefundLineState(3, 3), 'REFUNDED');
});

test('the form needs a quantity that is left, the goods decision, a reason, and a clean reference for a transfer', () => {
  assert.deepEqual(validateRefundDraft(draft(), summary()), {});
  assert.equal(validateRefundDraft(draft({ quantity: '' }), summary()).quantity, 'required');
  for (const quantity of ['0', '4', '1.5', '-1', 'abc']) {
    assert.equal(validateRefundDraft(draft({ quantity }), summary()).quantity, 'invalid', quantity);
  }
  assert.equal(
    validateRefundDraft(draft({ quantity: '2' }), summary({ caseRemainingQuantity: 1 })).quantity,
    'invalid',
    'no more than the case has left',
  );
  assert.equal(validateRefundDraft(draft({ restock: '' }), summary()).restock, 'required');
  assert.equal(validateRefundDraft(draft({ reason: '   ' }), summary()).reason, 'required');
  assert.equal(
    validateRefundDraft(draft({ reason: 'x'.repeat(501) }), summary()).reason,
    'invalid',
  );
  // Cash needs no reference; a transfer needs the bank's reference and nothing that looks like an account or a sentence.
  assert.equal(
    validateRefundDraft(draft({ bankReference: 'bậy' }), summary()).bankReference,
    undefined,
  );
  const transfer = (bankReference: string) =>
    validateRefundDraft(draft({ method: 'BANK_TRANSFER_MANUAL', bankReference }), summary());
  assert.equal(transfer('').bankReference, 'required');
  assert.equal(transfer('   ').bankReference, 'required');
  assert.equal(transfer('abc').bankReference, 'invalid');
  assert.equal(transfer('0123 4567 8901').bankReference, 'invalid');
  assert.equal(transfer('STK Vietcombank').bankReference, 'invalid');
  assert.equal(transfer('FT'.repeat(40)).bankReference, 'invalid');
  assert.equal(transfer('FT26280123456').bankReference, undefined);
  assert.equal(transfer(' FT-2628/0123.4_5 ').bankReference, undefined);
});

test('the request carries what the person decided and never an amount, a time or an account', () => {
  const cash = refundRequest(
    draft({ quantity: ' 2 ', reason: '  Khách trả hàng  ' }),
    summary(),
    'r1',
  );
  assert.deepEqual(cash, {
    quantity: 2,
    method: 'CASH',
    bankReference: null,
    restock: 'SELLABLE',
    reason: 'Khách trả hàng',
    clientRequestId: 'r1',
  });
  const transfer = refundRequest(
    draft({
      method: 'BANK_TRANSFER_MANUAL',
      bankReference: ' FT26280123 ',
      restock: 'NOT_SELLABLE',
    }),
    summary(),
    'r2',
  );
  assert.equal(transfer?.bankReference, 'FT26280123');
  assert.equal(transfer?.restock, 'NOT_SELLABLE');
  // A reference typed before the person switched to cash is not sent.
  const switched = refundRequest(
    draft({ method: 'CASH', bankReference: 'FT26280123' }),
    summary(),
    'r3',
  );
  assert.equal(switched?.bankReference, null);
  for (const key of Object.keys(cash!)) {
    assert.ok(!/amount|vnd|time|account/i.test(key), key);
  }
  assert.equal(refundRequest(draft({ restock: '' }), summary(), 'r4'), null);
  assert.equal(refundRequest(draft({ quantity: '9' }), summary(), 'r5'), null);
});

test('the amount shown is the net share of the units still to refund', () => {
  assert.equal(refundPreview(summary(), '1'), '9710');
  assert.equal(refundPreview(summary(), '3'), '29129');
  assert.equal(
    refundPreview(
      summary({ lineRefundedQuantity: 1, caseRemainingQuantity: 2, caseRefundedQuantity: 1 }),
      '1',
    ),
    '9709',
    'the second unit takes the rounding',
  );
  assert.equal(refundPreview(summary(), '0'), null);
  assert.equal(refundPreview(summary(), '4'), null);
  assert.equal(refundPreview(summary(), 'x'), null);
  assert.equal(refundPreview(summary({ lineNetVnd: null }), '1'), null);
});

test('only transfer refunds can have their reference corrected', () => {
  const refund = (id: string, method: ProductRefundResponse['method']) =>
    ({ id, method }) as ProductRefundResponse;
  assert.deepEqual(
    transferRefunds({
      refunds: [refund('a', 'CASH'), refund('b', 'BANK_TRANSFER_MANUAL'), refund('c', 'CASH')],
    }).map((r) => r.id),
    ['b'],
  );
});

test('every refund error has plain words, a conflict asks to review, and an unknown error falls back', () => {
  const fallback = () => 'chung';
  for (const locale of ['vi', 'en'] as const) {
    const texts = productRefundsDictionary(locale).errors;
    for (const code of [
      'REFUND_CASE_NOT_READY',
      'REFUND_QUANTITY_EXCEEDED',
      'REFUND_NOTHING_PAID',
      'REFUND_STOCK_PENDING',
      'INVOICE_HAS_REFUND',
      'INVOICE_STATE_INVALID',
    ] as const) {
      assert.equal(refundErrorText(new ApiError(409, code), locale, fallback), texts[code]);
    }
    assert.equal(refundErrorText(new ApiError(409, 'CONFLICT'), locale, fallback), texts.conflict);
    assert.equal(
      refundErrorText(new ApiError(400, 'VALIDATION_FAILED', 'bankReference'), locale, fallback),
      texts.fields.bankReference,
    );
  }
  assert.equal(refundErrorText(new ApiError(500, 'WHATEVER'), 'vi', fallback), 'chung');
  assert.equal(refundErrorText(new Error('x'), 'vi', fallback), 'chung');
  assert.equal(isRefundConflict(new ApiError(409, 'CONFLICT')), true);
  assert.equal(isRefundConflict(new ApiError(409, 'CONFLICT', 'quantity')), false);
});

test('both languages say the same things, and a spa never "khám"', () => {
  const vi = productRefundsDictionary('vi');
  const en = productRefundsDictionary('en');
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
      : [prefix];
  assert.deepEqual(keys(vi), keys(en));
  assert.doesNotMatch(JSON.stringify(vi), /khám/i);
  // The account number is never asked for, in either language.
  assert.match(vi.form.referenceHint, /Không nhập số tài khoản/);
  assert.match(en.form.referenceHint, /Never the customer’s account number/);
  // Money the person hands over is recorded after the fact, and the points rule is said plainly.
  assert.match(vi.form.warning, /sau khi bạn đã đưa tiền/);
  assert.match(vi.form.pointsNote, /Voucher hoặc quà đã dùng trên hóa đơn không tự trả lại/);
});
