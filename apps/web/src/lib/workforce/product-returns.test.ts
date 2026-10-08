import type {
  ProductReturnCaseResponse,
  ProductReturnLookupLine,
  ProductReturnWindowStatus,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productReturnsDictionary } from '../../i18n/product-returns';
import { customer, employee, owner } from '../../test/support';
import { ApiError } from './api';
import { navigationFor } from './permissions';
import {
  emptyReturnDraft,
  isReturnConflict,
  needsQualifyingPhoto,
  normalizeReturnList,
  photoProblemText,
  precheckReturnPhoto,
  presentPhotos,
  reasonOpen,
  reasonPastWindow,
  removedPhotoCount,
  returnDraftValid,
  returnErrorText,
  returnOpenRequest,
  returnPhotoUrl,
  returnProductName,
  returnStatusTone,
  RETURN_LIST_DEFAULTS,
  RETURN_OUTCOMES,
  RETURN_REASONS,
  RETURN_STATUSES,
  validateReturnDraft,
  type ReturnDraft,
} from './product-returns';

const open: ProductReturnWindowStatus = { open: true, endsAt: '2026-10-15T03:00:00.000Z' };
const closed: ProductReturnWindowStatus = { open: false, endsAt: '2026-10-09T03:00:00.000Z' };

const line = (patch: Partial<ProductReturnLookupLine> = {}): ProductReturnLookupLine => ({
  lineId: 'l1',
  sequence: 1,
  sku: 'KEM-50',
  productNameVi: 'Kem dưỡng',
  productNameEn: 'Moisturizer',
  variantLabelVi: '50 ml',
  variantLabelEn: '50 ml',
  quantity: 3,
  claimedQuantity: 1,
  availableQuantity: 2,
  reasons: {
    PERSONAL_PREFERENCE: open,
    WRONG_OR_DAMAGED: open,
    SKIN_IRRITATION: { open: true, endsAt: null },
  },
  ...patch,
});

const draft = (patch: Partial<ReturnDraft> = {}): ReturnDraft => ({
  ...emptyReturnDraft(),
  invoiceCode: 'HD000001',
  lineId: 'l1',
  reason: 'PERSONAL_PREFERENCE',
  quantity: '1',
  seal: true,
  ...patch,
});

test('list state: bounded search, a known status and reason, a positive page', () => {
  assert.deepEqual(normalizeReturnList(RETURN_LIST_DEFAULTS), RETURN_LIST_DEFAULTS);
  assert.deepEqual(
    normalizeReturnList({
      branch: 'b'.repeat(80),
      q: 'x'.repeat(300),
      status: 'WEIRD',
      reason: 'BORED',
      page: 0,
    }),
    { branch: 'b'.repeat(64), q: 'x'.repeat(100), status: '', reason: '', page: 1 },
  );
  assert.equal(
    normalizeReturnList({
      ...RETURN_LIST_DEFAULTS,
      status: 'OPEN',
      reason: 'SKIN_IRRITATION',
      page: 3,
    }).page,
    3,
  );
});

test('a status is told by its tone and its words', () => {
  assert.equal(returnStatusTone('OPEN'), 'info');
  assert.equal(returnStatusTone('ACCEPTED'), 'success');
  assert.equal(returnStatusTone('DECLINED'), 'error');
  assert.equal(returnStatusTone('CANCELLED'), 'neutral');
  assert.equal(new Set(RETURN_STATUSES.map(returnStatusTone)).size, 4);
});

test('a reason is chosen only while its window is open and a unit is left', () => {
  assert.equal(reasonOpen(line(), 'PERSONAL_PREFERENCE'), true);
  assert.equal(
    reasonOpen(
      line({ reasons: { ...line().reasons, WRONG_OR_DAMAGED: closed } }),
      'WRONG_OR_DAMAGED',
    ),
    false,
  );
  assert.equal(reasonOpen(line({ availableQuantity: 0 }), 'SKIN_IRRITATION'), false);
  assert.equal(reasonOpen(line(), 'SKIN_IRRITATION'), true, 'a skin irritation never closes');
});

test('the new-case draft needs a product, an open reason, a quantity that is left, and the seal for a change of mind', () => {
  assert.deepEqual(validateReturnDraft(draft(), line()), {});
  assert.equal(returnDraftValid(validateReturnDraft(draft(), line())), true);
  assert.equal(validateReturnDraft(draft(), null).line, 'required');
  assert.equal(validateReturnDraft(draft({ reason: '' }), line()).reason, 'required');
  assert.equal(
    validateReturnDraft(
      draft(),
      line({ reasons: { ...line().reasons, PERSONAL_PREFERENCE: closed } }),
    ).reason,
    'invalid',
  );
  assert.equal(validateReturnDraft(draft({ quantity: '' }), line()).quantity, 'required');
  for (const quantity of ['0', '3', '1.5', '-1', 'abc', '99999999']) {
    assert.equal(validateReturnDraft(draft({ quantity }), line()).quantity, 'invalid', quantity);
  }
  assert.equal(validateReturnDraft(draft({ quantity: '2' }), line()).quantity, undefined);
  assert.equal(validateReturnDraft(draft({ seal: false }), line()).seal, 'invalid');
  assert.equal(
    validateReturnDraft(draft({ reason: 'WRONG_OR_DAMAGED', seal: false }), line()).seal,
    undefined,
    'a damaged product need not be sealed',
  );
  assert.equal(validateReturnDraft(draft({ notes: 'x'.repeat(1001) }), line()).notes, 'invalid');
});

test('the request carries what the counter checked and nothing the screen computed', () => {
  const request = returnOpenRequest(
    draft({ outcome: 'REFUND', quantity: ' 2 ', notes: '  Khách đổi ý  ' }),
    line(),
    'branch-1',
    'req-1',
  );
  assert.deepEqual(request, {
    branchId: 'branch-1',
    invoiceLineId: 'l1',
    reason: 'PERSONAL_PREFERENCE',
    requestedOutcome: 'REFUND',
    quantity: 2,
    sealIntact: true,
    notes: 'Khách đổi ý',
    clientRequestId: 'req-1',
  });
  assert.deepEqual(Object.keys(request!).sort(), [
    'branchId',
    'clientRequestId',
    'invoiceLineId',
    'notes',
    'quantity',
    'reason',
    'requestedOutcome',
    'sealIntact',
  ]);
  const damaged = returnOpenRequest(
    draft({ reason: 'WRONG_OR_DAMAGED', seal: false }),
    line(),
    'b',
    'r',
  );
  assert.equal(damaged?.sealIntact, false);
  assert.equal(damaged?.notes, null);
  const skin = returnOpenRequest(
    draft({ reason: 'SKIN_IRRITATION', seal: true }),
    line(),
    'b',
    'r',
  );
  assert.equal(skin?.sealIntact, null, 'the seal is not asked for a skin irritation');
  assert.equal(returnOpenRequest(draft({ seal: false }), line(), 'b', 'r'), null);
  assert.equal(returnOpenRequest(draft(), null, 'b', 'r'), null);
  assert.equal(returnOpenRequest(draft({ quantity: '9' }), line(), 'b', 'r'), null);
});

const caseOf = (patch: Partial<ProductReturnCaseResponse> = {}): ProductReturnCaseResponse =>
  ({
    id: 'c1',
    code: 'TH000001',
    reason: 'WRONG_OR_DAMAGED',
    status: 'OPEN',
    windowEndsAt: '2026-10-10T03:00:00.000Z',
    photos: [],
    ...patch,
  }) as ProductReturnCaseResponse;

const photo = (patch: Partial<ProductReturnCaseResponse['photos'][number]> = {}) => ({
  id: 'p1',
  width: 10,
  height: 10,
  uploadedAt: '2026-10-09T03:00:00.000Z',
  uploadedByName: 'Lan',
  removedAt: null,
  removedByName: null,
  removalNote: null,
  ...patch,
});

test('a wrong or damaged case asks for a photo until one taken inside the window is present', () => {
  assert.equal(needsQualifyingPhoto(caseOf()), true);
  assert.equal(needsQualifyingPhoto(caseOf({ photos: [photo()] })), false);
  assert.equal(
    needsQualifyingPhoto(caseOf({ photos: [photo({ uploadedAt: '2026-10-10T03:00:00.001Z' })] })),
    true,
    'a photo after the window does not count',
  );
  assert.equal(
    needsQualifyingPhoto(caseOf({ photos: [photo({ removedAt: '2026-10-09T05:00:00.000Z' })] })),
    true,
    'a removed photo does not count',
  );
  assert.equal(needsQualifyingPhoto(caseOf({ status: 'ACCEPTED' })), false);
  assert.equal(needsQualifyingPhoto(caseOf({ reason: 'PERSONAL_PREFERENCE' })), false);
  assert.equal(
    needsQualifyingPhoto(caseOf({ reason: 'SKIN_IRRITATION', windowEndsAt: null })),
    false,
  );
  const mixed = caseOf({
    photos: [photo(), photo({ id: 'p2', removedAt: '2026-10-09T05:00:00.000Z' })],
  });
  assert.deepEqual(
    presentPhotos(mixed).map((entry) => entry.id),
    ['p1'],
  );
  assert.equal(removedPhotoCount(mixed), 1);
});

test('photos are only ever addressed through the permission-checked case route', () => {
  assert.equal(
    returnPhotoUrl('c1', 'p1', 'thumb'),
    '/api/v1/product-returns/cases/c1/photos/p1/thumb',
  );
  assert.equal(returnPhotoUrl('c1', 'p1', 'lg'), '/api/v1/product-returns/cases/c1/photos/p1/lg');
  assert.doesNotMatch(returnPhotoUrl('c1', 'p1', 'md'), /media|public|uploads/);
});

test('the browser refuses what the server would refuse: a wrong type or more than 10 MB', () => {
  assert.equal(precheckReturnPhoto({ type: 'image/png', size: 1000 }), null);
  assert.equal(precheckReturnPhoto({ type: 'image/jpeg', size: 10 * 1024 * 1024 }), null);
  assert.equal(precheckReturnPhoto({ type: 'image/webp', size: 10 * 1024 * 1024 + 1 }), 'size');
  assert.equal(precheckReturnPhoto({ type: 'image/svg+xml', size: 10 }), 'type');
  assert.equal(precheckReturnPhoto({ type: 'application/pdf', size: 10 }), 'type');
  assert.equal(
    photoProblemText('size', 'vi'),
    productReturnsDictionary('vi').errors.MEDIA_TOO_LARGE,
  );
  assert.equal(
    photoProblemText('type', 'en'),
    productReturnsDictionary('en').errors.MEDIA_TYPE_UNSUPPORTED,
  );
});

test('the product reads in the reader’s language, with its variant', () => {
  const product = {
    productNameVi: 'Kem dưỡng',
    productNameEn: 'Moisturizer',
    variantLabelVi: '50 ml',
    variantLabelEn: '1.7 oz',
  };
  assert.equal(returnProductName(product, 'vi'), 'Kem dưỡng · 50 ml');
  assert.equal(returnProductName(product, 'en'), 'Moisturizer · 1.7 oz');
  assert.equal(
    returnProductName({ ...product, variantLabelVi: null, variantLabelEn: null }, 'vi'),
    'Kem dưỡng',
  );
});

test('every return error has plain words, a conflict asks to review, and an unknown error falls back', () => {
  const texts = productReturnsDictionary('vi').errors;
  const fallback = () => 'chung';
  for (const code of [
    'RETURN_NOT_ELIGIBLE',
    'RETURN_WINDOW_EXPIRED',
    'RETURN_SEAL_REQUIRED',
    'RETURN_QUANTITY_EXCEEDED',
    'RETURN_CLOSED',
    'RETURN_PHOTO_REQUIRED',
    'RETURN_PHOTO_LIMIT',
    'RETURN_PHOTO_GONE',
    'MEDIA_TOO_LARGE',
    'MEDIA_TYPE_UNSUPPORTED',
    'MEDIA_INVALID_IMAGE',
    'RATE_LIMITED',
  ] as const) {
    assert.equal(
      returnErrorText(new ApiError(409, code), 'vi', fallback),
      (texts as unknown as Record<string, string>)[code],
      code,
    );
  }
  assert.equal(returnErrorText(new ApiError(409, 'CONFLICT'), 'vi', fallback), texts.conflict);
  assert.equal(isReturnConflict(new ApiError(409, 'CONFLICT')), true);
  assert.equal(isReturnConflict(new ApiError(409, 'RETURN_CLOSED')), false);
  assert.equal(
    returnErrorText(new ApiError(400, 'VALIDATION_FAILED', 'quantity'), 'vi', fallback),
    texts.fields.quantity,
  );
  assert.equal(returnErrorText(new ApiError(500, 'SOMETHING'), 'vi', fallback), 'chung');
  assert.equal(returnErrorText(new Error('x'), 'vi', fallback), 'chung');
});

test('both languages say the same things, and a spa never "khám"', () => {
  const vi = productReturnsDictionary('vi');
  const en = productReturnsDictionary('en');
  const shape = (value: unknown): unknown =>
    typeof value === 'string'
      ? 'text'
      : Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
            key,
            shape(entry),
          ]),
        );
  assert.deepEqual(shape(vi), shape(en));
  const every = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : Object.values(value as Record<string, unknown>).flatMap(every);
  for (const text of every(vi)) assert.doesNotMatch(text, /khám/i, text);
  for (const reason of RETURN_REASONS) {
    assert.ok(vi.reasons[reason] && en.reasons[reason] && vi.reasonHints[reason]);
  }
  for (const outcome of RETURN_OUTCOMES) assert.ok(vi.outcomes[outcome] && en.outcomes[outcome]);
  // A skin irritation is noted and photographed, never diagnosed (PRD 28.3).
  assert.match(vi.reasonHints.SKIN_IRRITATION, /không chẩn đoán/);
  assert.match(vi.view.acceptBody, /chưa hoàn tiền và chưa đổi hàng/);
});

test('the Owner may go past a closed window with a written reason; nobody else can, and the reason is sent only then', () => {
  const past = line({ reasons: { ...line().reasons, PERSONAL_PREFERENCE: closed } });
  const text = (patch: Partial<ReturnDraft> = {}) =>
    draft({ exceptionReason: 'Chủ đồng ý', ...patch });
  // Everyone else: the closed reason is refused, whatever is typed.
  assert.equal(validateReturnDraft(text(), past).reason, 'invalid');
  assert.equal(returnOpenRequest(text(), past, 'b', 'r'), null);
  // The Owner: the reason needs words, not blanks, and not more than 1000 characters.
  assert.deepEqual(validateReturnDraft(text(), past, true), {});
  assert.equal(
    validateReturnDraft(text({ exceptionReason: '   ' }), past, true).exception,
    'required',
  );
  assert.equal(
    validateReturnDraft(text({ exceptionReason: 'x'.repeat(1001) }), past, true).exception,
    'invalid',
  );
  assert.equal(validateReturnDraft(text(), past, true).reason, undefined);
  // The Owner still cannot return units that are gone.
  assert.equal(validateReturnDraft(text(), line({ availableQuantity: 0 }), true).reason, 'invalid');
  const request = returnOpenRequest(
    text({ exceptionReason: '  Chủ đồng ý  ' }),
    past,
    'b',
    'r',
    true,
  );
  assert.equal(request?.windowExceptionReason, 'Chủ đồng ý');
  // Inside the window the reason is never sent, even if the Owner typed one earlier.
  const inside = returnOpenRequest(text(), line(), 'b', 'r', true);
  assert.ok(inside);
  assert.equal('windowExceptionReason' in inside, false);
  assert.equal(reasonPastWindow(past, 'PERSONAL_PREFERENCE'), true);
  assert.equal(reasonPastWindow(line(), 'PERSONAL_PREFERENCE'), false);
  assert.equal(reasonPastWindow(line({ availableQuantity: 0 }), 'PERSONAL_PREFERENCE'), false);
});

test('an exception case asks for any photo that is still present, not one taken inside the window', () => {
  const exception = { byName: 'Chủ', at: '2026-10-20T03:00:00.000Z', reason: 'Khách ở xa' };
  const late = photo({ uploadedAt: '2026-10-20T04:00:00.000Z' });
  assert.equal(needsQualifyingPhoto(caseOf({ photos: [late] })), true);
  assert.equal(needsQualifyingPhoto(caseOf({ photos: [late], windowException: exception })), false);
  assert.equal(needsQualifyingPhoto(caseOf({ windowException: exception })), true);
  assert.equal(
    needsQualifyingPhoto(
      caseOf({
        photos: [photo({ removedAt: '2026-10-20T05:00:00.000Z' })],
        windowException: exception,
      }),
    ),
    true,
  );
});

test('the Returns page is offered to people who handle returns or refunds at a branch, and to nobody else', () => {
  const keys = (account: Parameters<typeof navigationFor>[0]) =>
    navigationFor(account).map((item) => item.key);
  assert.ok(keys(owner).includes('productReturns'));
  assert.ok(keys(employee([['MANAGE_PRODUCT_RETURNS', 'A']])).includes('productReturns'));
  assert.ok(keys(employee([['REFUND_PRODUCTS', 'A']])).includes('productReturns'));
  assert.ok(!keys(employee()).includes('productReturns'));
  assert.ok(!keys(employee([['SELL_PRODUCTS', 'A']])).includes('productReturns'));
  assert.ok(!keys(employee([['VIEW_INVENTORY', 'A']])).includes('productReturns'));
  assert.ok(!keys(customer).includes('productReturns'));
  const entry = navigationFor(owner).find((item) => item.key === 'productReturns');
  assert.deepEqual(entry, { key: 'productReturns', group: 'sales', path: '/product-returns' });
});
