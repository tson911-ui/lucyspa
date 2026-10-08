import type {
  ProductExchangeOption,
  ProductExchangePreviewResponse,
  ProductExchangeSummaryResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productExchangesDictionary } from '../../i18n/product-exchanges';
import { ApiError } from './api';
import {
  completableExchanges,
  completeRequest,
  emptyExchangeDraft,
  exchangeErrorText,
  exchangeNeeds,
  exchangeOptionLabel,
  exchangeRequest,
  isExchangeConflict,
  openExchanges,
  transferExchanges,
  validateExchangeDraft,
} from './product-exchanges';

const option = (patch: Partial<ProductExchangeOption> = {}): ProductExchangeOption => ({
  variantId: 'v2',
  productId: 'p2',
  sku: 'SERUM-30',
  nameVi: 'Serum',
  nameEn: 'Serum',
  variantLabelVi: '30 ml',
  variantLabelEn: '30 ml',
  listPriceVnd: '150000',
  unitPriceVnd: '150000',
  onPromotion: false,
  available: 5,
  sameItem: false,
  ...patch,
});

const preview = (
  patch: Partial<ProductExchangePreviewResponse> = {},
): ProductExchangePreviewResponse => ({
  caseId: 'c1',
  caseCode: 'TH000001',
  quantity: 2,
  option: option(),
  rule: 'PRICE_DIFFERENCE',
  creditVnd: '200000',
  replacementGrossVnd: '300000',
  appliedCreditVnd: '200000',
  payableVnd: '100000',
  refundVnd: '0',
  inStock: true,
  ...patch,
});

const chosen = (patch: Partial<ReturnType<typeof emptyExchangeDraft>> = {}) => ({
  ...emptyExchangeDraft('u1'),
  option: option(),
  reason: 'Sản phẩm lỗi',
  ...patch,
});

test('the form asks for what the figures need: goods now when nothing is to be paid, money back when the new goods are cheaper', () => {
  assert.deepEqual(exchangeNeeds(null), { restock: false, refund: false, payable: false });
  assert.deepEqual(exchangeNeeds(preview()), { restock: false, refund: false, payable: true });
  assert.deepEqual(exchangeNeeds(preview({ payableVnd: '0', refundVnd: '0' })), {
    restock: true,
    refund: false,
    payable: false,
  });
  assert.deepEqual(exchangeNeeds(preview({ payableVnd: '0', refundVnd: '60000' })), {
    restock: true,
    refund: true,
    payable: false,
  });
});

test('the draft is checked: goods chosen and in stock, a seller when none is proposed, a reference for a transfer, a reason', () => {
  const dearer = preview();
  assert.deepEqual(validateExchangeDraft(chosen(), dearer, false), {});
  assert.deepEqual(validateExchangeDraft(emptyExchangeDraft('u1'), null, false), {
    option: 'required',
    reason: 'required',
  });
  assert.deepEqual(validateExchangeDraft(chosen({ reason: '  ' }), dearer, false), {
    reason: 'required',
  });
  assert.deepEqual(validateExchangeDraft(chosen({ reason: 'x'.repeat(501) }), dearer, false), {
    reason: 'invalid',
  });
  assert.deepEqual(validateExchangeDraft(chosen(), preview({ inStock: false }), false), {
    stock: 'invalid',
  });
  assert.deepEqual(validateExchangeDraft(chosen({ sellerUserId: '' }), dearer, true), {
    seller: 'required',
  });
  const cheaper = preview({ payableVnd: '0', refundVnd: '60000' });
  assert.deepEqual(validateExchangeDraft(chosen(), cheaper, false), { restock: 'required' });
  assert.deepEqual(
    validateExchangeDraft(
      chosen({ restock: 'SELLABLE', refundMethod: 'BANK_TRANSFER_MANUAL' }),
      cheaper,
      false,
    ),
    { bankReference: 'required' },
  );
  assert.deepEqual(
    validateExchangeDraft(
      chosen({
        restock: 'SELLABLE',
        refundMethod: 'BANK_TRANSFER_MANUAL',
        bankReference: '0123 4567',
      }),
      cheaper,
      false,
    ),
    { bankReference: 'invalid' },
  );
  assert.deepEqual(
    validateExchangeDraft(
      chosen({
        restock: 'NOT_SELLABLE',
        refundMethod: 'BANK_TRANSFER_MANUAL',
        bankReference: 'FT26100801',
      }),
      cheaper,
      false,
    ),
    {},
  );
});

test('the request carries the shown figures and nothing the person cannot decide; the old goods only when nothing is to be paid', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const dearer = exchangeRequest(chosen(), preview(), false, id);
  assert.deepEqual(dearer, {
    variantId: 'v2',
    expectedPayableVnd: '100000',
    expectedRefundVnd: '0',
    restock: null,
    refundMethod: null,
    bankReference: null,
    sellerUserId: 'u1',
    reason: 'Sản phẩm lỗi',
    clientRequestId: id,
  });
  // A restock choice made earlier is not sent when the customer is going to pay.
  assert.equal(
    exchangeRequest(chosen({ restock: 'SELLABLE' }), preview(), false, id)!.restock,
    null,
  );
  const cheaper = preview({ payableVnd: '0', refundVnd: '60000' });
  assert.deepEqual(
    exchangeRequest(
      chosen({
        restock: 'SELLABLE',
        refundMethod: 'BANK_TRANSFER_MANUAL',
        bankReference: ' FT26100801 ',
      }),
      cheaper,
      false,
      id,
    ),
    {
      variantId: 'v2',
      expectedPayableVnd: '0',
      expectedRefundVnd: '60000',
      restock: 'SELLABLE',
      refundMethod: 'BANK_TRANSFER_MANUAL',
      bankReference: 'FT26100801',
      sellerUserId: 'u1',
      reason: 'Sản phẩm lỗi',
      clientRequestId: id,
    },
  );
  // Cash carries no reference even if one was typed first.
  const cash = exchangeRequest(
    chosen({ restock: 'SELLABLE', refundMethod: 'CASH', bankReference: 'FT26100801' }),
    cheaper,
    false,
    id,
  )!;
  assert.equal(cash.refundMethod, 'CASH');
  assert.equal(cash.bankReference, null);
  // No request without figures, goods or a valid draft; no price, credit or amount field exists in it.
  assert.equal(exchangeRequest(chosen(), null, false, id), null);
  assert.equal(exchangeRequest(emptyExchangeDraft(null), preview(), false, id), null);
  assert.equal(exchangeRequest(chosen({ reason: '' }), preview(), false, id), null);
  assert.deepEqual(Object.keys(dearer!).sort(), [
    'bankReference',
    'clientRequestId',
    'expectedPayableVnd',
    'expectedRefundVnd',
    'reason',
    'refundMethod',
    'restock',
    'sellerUserId',
    'variantId',
  ]);
  assert.deepEqual(completeRequest('SELLABLE'), { restock: 'SELLABLE' });
  assert.equal(completeRequest(''), null);
});

test('a search result shows the name, today’s price and the stock in the language of the person', () => {
  assert.equal(exchangeOptionLabel(option(), 'vi'), 'Serum · 30 ml — 150.000 ₫ — 5 có sẵn');
  assert.equal(
    exchangeOptionLabel(option({ available: 0 }), 'en'),
    'Serum · 30 ml — 150,000 ₫ — sold out',
  );
});

const summary = (
  patch: Partial<ProductExchangeSummaryResponse> = {},
): ProductExchangeSummaryResponse => ({
  caseId: 'c1',
  caseCode: 'TH000001',
  invoiceCode: 'HD000042',
  caseQuantity: 2,
  creditVnd: null,
  exchangeable: false,
  blocked: null,
  exchanges: [],
  can: { exchange: false, complete: false, correctReference: false },
  ...patch,
});
const row = (
  status: ProductExchangeSummaryResponse['exchanges'][number]['status'],
  method?: 'CASH' | 'BANK_TRANSFER_MANUAL',
) =>
  ({
    id: status,
    status,
    refund: method
      ? { method, bankReference: null, firstBankReference: null, corrections: [] }
      : null,
  }) as ProductExchangeSummaryResponse['exchanges'][number];

test('the open, completable and transfer exchanges are picked from the summary', () => {
  const s = summary({
    exchanges: [
      row('CANCELLED'),
      row('AWAITING_PAYMENT'),
      row('AWAITING_COMPLETION'),
      row('COMPLETED', 'BANK_TRANSFER_MANUAL'),
      row('COMPLETED', 'CASH'),
    ],
  });
  assert.deepEqual(
    openExchanges(s).map((e) => e.status),
    ['AWAITING_PAYMENT', 'AWAITING_COMPLETION'],
  );
  assert.deepEqual(
    completableExchanges(s).map((e) => e.status),
    ['AWAITING_COMPLETION'],
  );
  assert.equal(transferExchanges(s).length, 1);
});

test('errors: own texts for the exchange codes and fields, the shared text otherwise, and which ones reload the data', () => {
  const t = productExchangesDictionary('vi').errors;
  const err = (code: string, field: string | null = null) => new ApiError(409, code, field);
  assert.equal(
    exchangeErrorText(err('EXCHANGE_FIGURES_CHANGED'), 'vi', () => 'shared'),
    t.EXCHANGE_FIGURES_CHANGED,
  );
  assert.equal(
    exchangeErrorText(err('EXCHANGE_IN_PROGRESS'), 'vi', () => 'shared'),
    t.EXCHANGE_IN_PROGRESS,
  );
  assert.equal(
    exchangeErrorText(err('PRODUCT_OUT_OF_STOCK'), 'vi', () => 'shared'),
    t.PRODUCT_OUT_OF_STOCK,
  );
  assert.equal(
    exchangeErrorText(err('CONFLICT'), 'vi', () => 'shared'),
    t.conflict,
  );
  assert.equal(
    exchangeErrorText(err('VALIDATION_FAILED', 'bankReference'), 'vi', () => 'shared'),
    t.fields.bankReference,
  );
  assert.equal(
    exchangeErrorText(err('VALIDATION_FAILED', 'unknownField'), 'vi', () => 'shared'),
    'shared',
  );
  assert.equal(
    exchangeErrorText(new Error('x'), 'vi', () => 'shared'),
    'shared',
  );
  assert.equal(isExchangeConflict(err('EXCHANGE_FIGURES_CHANGED')), true);
  assert.equal(isExchangeConflict(err('CONFLICT')), true);
  assert.equal(isExchangeConflict(err('EXCHANGE_NOT_PAID')), false);
});
