import type {
  OnlineContextResponse,
  OnlineStaffLine,
  OnlineStaffOrderResponse,
  ShippingCarrierResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onlineFulfilmentDictionary } from '../../i18n/online-fulfilment';
import { ApiError } from './api';
import {
  addressDraft,
  addressRequest,
  carrierCreateRequest,
  carrierDraftOf,
  carrierEditRequest,
  carrierSwitchRequest,
  correctShipmentDraft,
  correctShipmentRequest,
  costText,
  deliveredRequest,
  deliveryDayOk,
  emptyLogDraft,
  emptyCarrierDraft,
  emptySettleDraft,
  emptyShipDraft,
  fieldOfError,
  isOnlineConflict,
  logKindsFor,
  logRequest,
  namesOfLines,
  normalizeOnlineList,
  ONLINE_LIST_DEFAULTS,
  onlineErrorText,
  onlineStateTone,
  onlineTab,
  parcelLines,
  resolveOnlineBranch,
  returnCostRequest,
  seeableBranches,
  settleFigures,
  settleRequest,
  shipRequest,
  templateProblem,
  trackingProblem,
  validateAddress,
  validateCarrier,
  validateCorrectShipment,
  validateLog,
  validateSettle,
  validateShip,
  type SettleDraft,
} from './online-orders';

const vi = onlineFulfilmentDictionary('vi');
const en = onlineFulfilmentDictionary('en');

const line = (patch: Partial<OnlineStaffLine> = {}): OnlineStaffLine => ({
  id: 'l1',
  sequence: 1,
  variantId: 'v1',
  nameVi: 'Kem dưỡng',
  nameEn: 'Day cream',
  variantLabelVi: null,
  variantLabelEn: null,
  quantity: 1,
  unitPriceVnd: '500000',
  lineTotalVnd: '500000',
  mode: 'IN_STOCK',
  status: 'PAID',
  expectedFrom: null,
  expectedTo: null,
  cancelCause: null,
  refundedVnd: null,
  rowVersion: 3,
  sku: 'KEM-1',
  ready: true,
  cancelCauses: [],
  refundShareVnd: '500000',
  ...patch,
});

const shipment = (
  patch: Partial<NonNullable<OnlineStaffOrderResponse['shipment']>> = {},
): NonNullable<OnlineStaffOrderResponse['shipment']> => ({
  id: 's1',
  carrierId: 'c1',
  carrierName: 'GHN',
  trackingCode: 'GHN123',
  trackingUrl: null,
  shippedAt: '2026-10-09T03:00:00.000Z',
  shippedByName: 'Lan',
  carrierFeeOutVnd: '30000',
  corrections: [],
  ...patch,
});

const two = [line(), line({ id: 'l2', sequence: 2, rowVersion: 7, refundShareVnd: '250000' })];

// -------------------------------------------------------------------------------------------------- the queue

test('the list state falls back to the first tab, the first page and short text', () => {
  assert.deepEqual(
    normalizeOnlineList({ branch: 'x'.repeat(100), tab: 'nope', q: 'y'.repeat(200), page: -4 }),
    {
      branch: 'x'.repeat(64),
      tab: 'TO_SHIP',
      q: 'y'.repeat(80),
      page: 1,
    },
  );
  assert.equal(normalizeOnlineList({ ...ONLINE_LIST_DEFAULTS, tab: 'SHIPPED' }).tab, 'SHIPPED');
  assert.equal(onlineTab('DELIVERY_FAILED'), 'DELIVERY_FAILED');
  assert.equal(onlineTab('UNPAID'), 'TO_SHIP', 'there is no unpaid tab');
});

test('a branch is seeable when the person packs or may refund there, and the chosen one wins', () => {
  const context: OnlineContextResponse = {
    branches: [
      { id: 'a', code: 'A', name: 'A', work: false, refund: false },
      { id: 'b', code: 'B', name: 'B', work: false, refund: true },
      { id: 'c', code: 'C', name: 'C', work: true, refund: false },
    ],
  };
  assert.deepEqual(
    seeableBranches(context).map((branch) => branch.id),
    ['b', 'c'],
  );
  assert.equal(resolveOnlineBranch(context, 'c')?.id, 'c');
  assert.equal(
    resolveOnlineBranch(context, 'a')?.id,
    'b',
    'a branch the person may not see is not chosen',
  );
  assert.equal(resolveOnlineBranch({ branches: [context.branches[0]!] }, ''), null);
});

test('every state has a tone and a word in both languages', () => {
  const states = Object.keys(vi.states) as (keyof typeof vi.states)[];
  for (const state of states) {
    assert.ok(onlineStateTone(state));
    assert.ok(en.states[state]);
  }
  assert.equal(onlineStateTone('DELIVERY_FAILED'), 'warning');
  assert.equal(onlineStateTone('COMPLETED'), 'success');
});

// ------------------------------------------------------------------------------------------------------ ship

test('the parcel is every line that is not cancelled, with the version the person saw', () => {
  const lines = [...two, line({ id: 'l3', status: 'CANCELLED', rowVersion: 9 })];
  assert.deepEqual(parcelLines({ lines }), [
    { id: 'l1', rowVersion: 3 },
    { id: 'l2', rowVersion: 7 },
  ]);
});

test('a tracking code follows the server rule', () => {
  for (const ok of ['GHN123', 'a.b-c_d/9', ' 123 ', 'A'.repeat(80)])
    assert.equal(trackingProblem(ok), false, ok);
  for (const bad of ['', ' ', '-abc', 'ab cd', 'ab#', 'A'.repeat(81), 'mã']) {
    assert.equal(trackingProblem(bad), true, bad);
  }
});

test('a cost is whole dong from 0 to the limit; zero is valid', () => {
  assert.equal(costText(0), '0');
  assert.equal(costText(30000), '30000');
  assert.equal(costText(100_000_000), '100000000');
  for (const bad of [null, -1, 1.5, 100_000_001]) assert.equal(costText(bad), null);
});

test('shipping needs a carrier, a code and a cost, and sends the whole parcel', () => {
  const empty = emptyShipDraft([{ id: 'c1' }, { id: 'c2' }]);
  assert.equal(empty.carrierId, '', 'two carriers: the person chooses');
  assert.deepEqual(validateShip(empty), { carrierId: true, trackingCode: true, fee: true });
  assert.equal(emptyShipDraft([{ id: 'c1' }]).carrierId, 'c1', 'one carrier is preselected');
  assert.equal(shipRequest(empty, { lines: two }), null);
  const draft = { carrierId: 'c1', trackingCode: ' GHN1 ', fee: 0 };
  assert.deepEqual(validateShip(draft), {});
  assert.deepEqual(shipRequest(draft, { lines: two }), {
    lines: [
      { id: 'l1', rowVersion: 3 },
      { id: 'l2', rowVersion: 7 },
    ],
    carrierId: 'c1',
    trackingCode: 'GHN1',
    carrierFeeVnd: '0',
  });
});

// ------------------------------------------------------------------------------------------ correct shipment

test('a shipment correction sends only what changed, with a reason', () => {
  const current = shipment();
  const draft = correctShipmentDraft(current);
  assert.deepEqual(draft, { trackingCode: 'GHN123', fee: 30000, reason: '' });
  assert.deepEqual(validateCorrectShipment(draft, current, true), { reason: true });
  assert.deepEqual(
    validateCorrectShipment({ ...draft, reason: 'x' }, current, true),
    { nothing: true },
    'nothing changed',
  );
  assert.deepEqual(
    correctShipmentRequest(
      { ...draft, trackingCode: 'GHN999', reason: ' gõ nhầm ' },
      current,
      true,
    ),
    {
      trackingCode: 'GHN999',
      reason: 'gõ nhầm',
    },
  );
  assert.deepEqual(
    correctShipmentRequest({ ...draft, fee: 35000, reason: 'phí sai' }, current, true),
    {
      carrierFeeVnd: '35000',
      reason: 'phí sai',
    },
  );
});

test('a person who cannot see the cost never sends one', () => {
  const hidden = shipment({ carrierFeeOutVnd: null });
  const draft = correctShipmentDraft(hidden);
  assert.equal(draft.fee, null);
  const request = correctShipmentRequest(
    { ...draft, trackingCode: 'NEW1', reason: 'sai mã' },
    hidden,
    false,
  );
  assert.deepEqual(request, { trackingCode: 'NEW1', reason: 'sai mã' });
  assert.equal(
    correctShipmentRequest({ ...draft, reason: 'x' }, hidden, false),
    null,
    'nothing changed',
  );
});

// -------------------------------------------------------------------------------------------------- delivered

test('the delivery day may be empty, today or earlier, never later', () => {
  const now = new Date('2026-10-09T18:30:00.000Z'); // 01:30 on the 10th in Vietnam
  assert.equal(deliveryDayOk('', now), true);
  assert.equal(deliveryDayOk('2026-10-10', now), true, 'today in the branch day, not the UTC day');
  assert.equal(deliveryDayOk('2026-10-11', now), false);
  assert.equal(deliveryDayOk('10/10/2026', now), false);
  assert.deepEqual(deliveredRequest(''), {});
  assert.deepEqual(deliveredRequest('2026-10-08'), { deliveredOn: '2026-10-08' });
});

// ------------------------------------------------------------------------------------------------------ log

test('the log offers a failed attempt, a new attempt and "no longer wanted" only for a parcel on its way', () => {
  const sent = { lines: [line({ status: 'SHIPPED' })], returnedToShop: false };
  assert.deepEqual(logKindsFor(sent), [
    'DELIVERY_FAILED',
    'CONTACTED',
    'REDELIVERY',
    'RETURN_STARTED',
    'NOTE',
  ]);
  assert.deepEqual(logKindsFor({ lines: [line()], returnedToShop: false }), ['CONTACTED', 'NOTE']);
  assert.deepEqual(
    logKindsFor({ ...sent, returnedToShop: true }),
    [],
    'nothing after the parcel is back',
  );
});

test('a failed attempt needs its reason and a note; a new attempt needs neither', () => {
  assert.deepEqual(validateLog({ kind: '', reasonCode: '', note: '' }), { kind: true });
  assert.deepEqual(validateLog({ kind: 'DELIVERY_FAILED', reasonCode: '', note: '' }), {
    reasonCode: true,
    note: true,
  });
  assert.deepEqual(validateLog({ kind: 'REDELIVERY', reasonCode: '', note: '' }), {});
  assert.deepEqual(
    logRequest({ kind: 'DELIVERY_FAILED', reasonCode: 'CUSTOMER_AWAY', note: ' vắng ' }),
    {
      kind: 'DELIVERY_FAILED',
      reasonCode: 'CUSTOMER_AWAY',
      note: 'vắng',
    },
  );
  assert.deepEqual(logRequest({ kind: 'REDELIVERY', reasonCode: '', note: '' }), {
    kind: 'REDELIVERY',
    note: null,
  });
  const contacted = logRequest({ kind: 'CONTACTED', reasonCode: 'OTHER', note: 'gọi khách' });
  assert.ok(
    contacted && !('reasonCode' in contacted),
    'the server refuses a reason on any other kind',
  );
  assert.equal(emptyLogDraft(['NOTE']).kind, 'NOTE');
  assert.equal(emptyLogDraft(['NOTE', 'CONTACTED']).kind, '');
});

// --------------------------------------------------------------------------------------------------- address

test('an address correction needs every part and a reason, and must change something', () => {
  const recipient = {
    name: 'Lê Văn Bình',
    phone: '+84912000003',
    provinceCode: 'HA_NOI',
    provinceName: 'Hà Nội',
    ward: 'Phường A',
    street: '12 Phố B',
    corrected: false,
  };
  const draft = addressDraft(recipient);
  assert.deepEqual(validateAddress(draft, recipient), { reason: true });
  assert.deepEqual(validateAddress({ ...draft, reason: 'x' }, recipient), { nothing: true });
  assert.deepEqual(
    validateAddress({ ...draft, recipientPhone: '12', ward: ' ', reason: 'x' }, recipient),
    { recipientPhone: true, ward: true },
  );
  assert.deepEqual(
    addressRequest({ ...draft, street: ' 14 Phố C ', reason: ' đã gọi ' }, recipient),
    {
      recipientName: 'Lê Văn Bình',
      recipientPhone: '+84912000003',
      provinceCode: 'HA_NOI',
      ward: 'Phường A',
      street: '14 Phố C',
      reason: 'đã gọi',
    },
  );
});

// ------------------------------------------------------------------------------------------------ settlement

const ship = { lines: two, shipment: shipment() };

test('the settlement figures follow the Owner formula: goods minus both carrier costs, never below zero', () => {
  // goods = 500000 + 250000, out = 30000
  assert.deepEqual(settleFigures(ship, 20000), {
    goods: 750000n,
    out: 30000n,
    back: 20000n,
    refund: 700000n,
  });
  assert.equal(settleFigures(ship, null).refund, 720000n, 'an empty cost counts as 0 while typing');
  assert.equal(settleFigures(ship, 200_000_000).back, 0n, 'a cost above the limit is not counted');
  const small = { lines: [line({ refundShareVnd: '40000' })], shipment: shipment() };
  assert.equal(settleFigures(small, 20000).refund, 0n, '40000 - 30000 - 20000 < 0');
});

test('cancelled lines are not part of the goods paid', () => {
  const lines = [...two, line({ id: 'l3', status: 'CANCELLED', refundShareVnd: '999999' })];
  assert.equal(settleFigures({ lines, shipment: shipment() }, 0).goods, 750000n);
});

test('a person who cannot see the cost out gets no preview and cannot send', () => {
  const blind = { lines: two, shipment: shipment({ carrierFeeOutVnd: null }) };
  const figures = settleFigures(blind, 1000);
  assert.equal(figures.out, null);
  assert.equal(figures.refund, null);
  const draft: SettleDraft = { ...emptySettleDraft(), back: 1000, reason: 'khách từ chối' };
  assert.deepEqual(validateSettle(draft, figures), { preview: true });
  assert.equal(settleRequest(draft, blind, 'req-1'), null);
});

test('with a refund the method is sent, a bank transfer needs its reference, and the restock choice stands', () => {
  const draft: SettleDraft = {
    ...emptySettleDraft(),
    back: 20000,
    reason: ' khách đi vắng ',
    restock: 'SELLABLE',
  };
  assert.deepEqual(settleRequest(draft, ship, 'req-1'), {
    lines: [
      { id: 'l1', rowVersion: 3 },
      { id: 'l2', rowVersion: 7 },
    ],
    carrierFeeBackVnd: '20000',
    reason: 'khách đi vắng',
    restock: 'SELLABLE',
    method: 'CASH',
    bankReference: null,
    clientRequestId: 'req-1',
  });
  const bank: SettleDraft = { ...draft, method: 'BANK_TRANSFER_MANUAL', bankReference: '' };
  assert.deepEqual(validateSettle(bank, settleFigures(ship, 20000)), { bankReference: true });
  assert.equal(settleRequest(bank, ship, 'req-1'), null);
  assert.equal(
    settleRequest({ ...bank, bankReference: ' FT99 ' }, ship, 'req-1')?.bankReference,
    'FT99',
  );
});

test('with no refund the method and the reference are left out and the goods cannot be "sellable"', () => {
  const small = { lines: [line({ refundShareVnd: '40000' })], shipment: shipment() };
  const draft: SettleDraft = {
    ...emptySettleDraft(),
    back: 20000,
    reason: 'khách từ chối',
    restock: 'SELLABLE',
    method: 'BANK_TRANSFER_MANUAL',
    bankReference: 'FT1',
  };
  const request = settleRequest(draft, small, 'req-2');
  assert.ok(request);
  assert.equal(request.restock, 'NOT_SELLABLE');
  assert.ok(!('method' in request) && !('bankReference' in request));
  assert.equal(request.carrierFeeBackVnd, '20000');
});

test('the settlement needs the cost back and a reason', () => {
  const figures = settleFigures(ship, null);
  assert.deepEqual(validateSettle(emptySettleDraft(), figures), { back: true, reason: true });
});

// ------------------------------------------------------------------------------------------- return cost

test('a return cost is whole dong from 0, with an optional note', () => {
  assert.deepEqual(returnCostRequest(25000, ' gửi Viettel '), {
    costVnd: '25000',
    note: 'gửi Viettel',
  });
  assert.deepEqual(returnCostRequest(0, ''), { costVnd: '0', note: null });
  assert.equal(returnCostRequest(null, ''), null);
  assert.equal(returnCostRequest(-5, ''), null);
});

// ---------------------------------------------------------------------------------------------- carriers

const carrier = (patch: Partial<ShippingCarrierResponse> = {}): ShippingCarrierResponse => ({
  id: 'c1',
  name: 'GHN',
  trackingUrlTemplate: 'https://track.example.vn/?code={code}',
  isActive: true,
  rowVersion: 4,
  ...patch,
});

test('a tracking link is empty or an https address with exactly one {code}', () => {
  assert.equal(templateProblem(''), false);
  assert.equal(templateProblem('https://a.vn/{code}'), false);
  for (const bad of [
    'http://a.vn/{code}',
    'https://a.vn/',
    'https://a.vn/{code}/{code}',
    'https://a b/{code}',
  ]) {
    assert.equal(templateProblem(bad), true, bad);
  }
  assert.equal(templateProblem(`https://a.vn/${'x'.repeat(300)}{code}`), true, 'too long');
});

test('a carrier needs a name of up to 80 characters', () => {
  assert.deepEqual(validateCarrier(emptyCarrierDraft()), { name: true });
  assert.deepEqual(validateCarrier({ name: 'x'.repeat(81), template: '' }), { name: true });
  assert.deepEqual(carrierCreateRequest({ name: ' Viettel Post ', template: '' }), {
    name: 'Viettel Post',
    trackingUrlTemplate: null,
  });
  assert.equal(carrierCreateRequest({ name: 'A', template: 'ftp://x' }), null);
});

test('a carrier edit sends the row version and only what changed; no change sends nothing', () => {
  const current = carrier();
  const draft = carrierDraftOf(current);
  assert.equal(carrierEditRequest(draft, current), null, 'nothing changed');
  assert.deepEqual(carrierEditRequest({ ...draft, name: 'GHN Express' }, current), {
    expectedRowVersion: 4,
    name: 'GHN Express',
  });
  assert.deepEqual(carrierEditRequest({ ...draft, template: '' }, current), {
    expectedRowVersion: 4,
    trackingUrlTemplate: null,
  });
  assert.deepEqual(carrierSwitchRequest(current, false), {
    expectedRowVersion: 4,
    isActive: false,
  });
});

// ------------------------------------------------------------------------------------------------- errors

test('the names of the lines that are not ready come from the ids the API names', () => {
  const lines = [line({ id: 'a', nameVi: 'Kem' }), line({ id: 'b', nameVi: 'Sữa rửa mặt' })];
  assert.deepEqual(
    namesOfLines('b,zzz,a', { lines }, (entry) => entry.nameVi),
    ['Sữa rửa mặt', 'Kem'],
  );
  assert.deepEqual(
    namesOfLines(null, { lines }, (entry) => entry.nameVi),
    [],
  );
});

test('a refused command is told in this area’s words; unknown codes fall back', () => {
  const fallback = () => 'chung';
  const named = (id: string) => ({ a: 'Kem', b: 'Sữa' })[id as 'a'] ?? null;
  assert.equal(
    onlineErrorText(new ApiError(409, 'ONLINE_ORDER_NOT_READY', 'a,b'), 'vi', fallback, named),
    vi.errors.ONLINE_ORDER_NOT_READY.replace('{names}', 'Kem, Sữa'),
  );
  assert.match(
    onlineErrorText(new ApiError(409, 'ONLINE_ORDER_NOT_READY', 'x'), 'vi', fallback),
    /…/,
    'unknown ids still give a sentence',
  );
  assert.equal(
    onlineErrorText(new ApiError(409, 'ONLINE_ORDER_STATE_INVALID'), 'vi', fallback),
    vi.errors.ONLINE_ORDER_STATE_INVALID,
  );
  assert.equal(
    onlineErrorText(new ApiError(409, 'CONFLICT', 'name'), 'en', fallback),
    en.errors.CARRIER_NAME_TAKEN,
    'a conflict on the carrier name is a duplicate name',
  );
  assert.equal(onlineErrorText(new ApiError(409, 'CONFLICT'), 'vi', fallback), vi.errors.CONFLICT);
  assert.equal(onlineErrorText(new ApiError(500, 'WHATEVER'), 'vi', fallback), 'chung');
  assert.equal(onlineErrorText(new Error('x'), 'vi', fallback), 'chung');
});

test('a conflict or a changed state reloads; the field of a validation error is named', () => {
  assert.equal(isOnlineConflict(new ApiError(409, 'CONFLICT')), true);
  assert.equal(isOnlineConflict(new ApiError(409, 'ONLINE_ORDER_STATE_INVALID')), true);
  assert.equal(isOnlineConflict(new ApiError(400, 'VALIDATION_FAILED', 'note')), false);
  assert.equal(
    fieldOfError(new ApiError(400, 'VALIDATION_FAILED', 'trackingCode')),
    'trackingCode',
  );
  assert.equal(fieldOfError(new ApiError(409, 'CONFLICT', 'name')), null);
  assert.equal(fieldOfError(new Error('x')), null);
});

test('no word of the staff texts uses the clinic word', () => {
  const walk = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(walk)
        : [];
  for (const text of walk(vi)) assert.doesNotMatch(text, /khám/i, text);
});

test('both languages have the same shape', () => {
  const shape = (value: unknown): unknown =>
    value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shape(entry)]))
      : typeof value;
  assert.deepEqual(shape(en), shape(vi));
});
