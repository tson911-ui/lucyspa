import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VIETNAM_PROVINCES } from '@lucy-spa/contracts';
import type { OnlineCartLineResponse } from '@lucy-spa/contracts';
import { getShopText } from '../../i18n/online-shop';
import { ApiError } from '../api/client';
import {
  EMPTY_ADDRESS,
  addressFieldOf,
  addressLine,
  addressProblems,
  addressRequest,
  cameBackFromBank,
  cartImageUrl,
  checkoutRequest,
  clampQuantity,
  draftFromProfile,
  draftFromSaved,
  formatCountdown,
  nationalPhone,
  needsCart,
  notReadyIds,
  orderStateTone,
  phoneLooksValid,
  policyParagraphs,
  problemLines,
  purchaseMode,
  reloadsPolicy,
  sameAddress,
  secondsLeft,
  shopErrorMessage,
  shouldPoll,
  signInHref,
  voucherOf,
  waitRange,
  POLL_WINDOW_MS,
  SHOP_ERROR_CODES,
} from './online';

const variant = (state: 'IN_STOCK' | 'PRE_ORDER' | 'OUT_OF_STOCK', sellOnline = true) => ({
  sellOnline,
  stock: { state, leadTimeDaysMin: null, leadTimeDaysMax: null },
});
const open = { enabled: true };

test('the product page offers what the shop state, the session and the variant allow', () => {
  const base = { sessionKnown: true, signedIn: true };
  assert.equal(purchaseMode({ sales: null, ...base, variant: variant('IN_STOCK') }), 'LOADING');
  assert.equal(purchaseMode({ sales: 'failed', ...base, variant: variant('IN_STOCK') }), 'STORE');
  assert.equal(
    purchaseMode({ sales: { enabled: false }, ...base, variant: variant('IN_STOCK') }),
    'STORE',
  );
  assert.equal(
    purchaseMode({ sales: open, ...base, variant: variant('IN_STOCK', false) }),
    'STORE',
  );
  assert.equal(
    purchaseMode({ sales: open, ...base, variant: variant('OUT_OF_STOCK') }),
    'SOLD_OUT',
  );
  assert.equal(
    purchaseMode({
      sales: open,
      sessionKnown: false,
      signedIn: false,
      variant: variant('IN_STOCK'),
    }),
    'LOADING',
  );
  assert.equal(
    purchaseMode({
      sales: open,
      sessionKnown: true,
      signedIn: false,
      variant: variant('IN_STOCK'),
    }),
    'SIGN_IN',
  );
  assert.equal(purchaseMode({ sales: open, ...base, variant: variant('IN_STOCK') }), 'ADD');
  assert.equal(purchaseMode({ sales: open, ...base, variant: variant('PRE_ORDER') }), 'PRE_ORDER');
  // A shop-only variant never shows a buy button, signed in or not, and a closed shop never does either.
  assert.equal(
    purchaseMode({
      sales: open,
      sessionKnown: true,
      signedIn: false,
      variant: variant('PRE_ORDER', false),
    }),
    'STORE',
  );
});

test('a quantity stays a whole number from 1 to the limit', () => {
  assert.equal(clampQuantity(3, 10), 3);
  assert.equal(clampQuantity(0, 10), 1);
  assert.equal(clampQuantity(-4, 10), 1);
  assert.equal(clampQuantity(11, 10), 10);
  assert.equal(clampQuantity(2.9, 10), 2);
  assert.equal(clampQuantity(Number.NaN, 10), 1);
  assert.equal(clampQuantity(5, 0), 1);
});

test('the sign-in link carries the page to return to', () => {
  assert.equal(
    signInHref('vi', '/vi/products/kem-duong'),
    '/vi/account/login?next=%2Fvi%2Fproducts%2Fkem-duong',
  );
});

const line = (patch: Partial<OnlineCartLineResponse>): OnlineCartLineResponse => ({
  variantId: 'v1',
  productId: 'p1',
  productCode: 'kem',
  nameVi: 'Kem',
  nameEn: 'Cream',
  variantLabelVi: null,
  variantLabelEn: null,
  sku: 'S1',
  imageMediaId: null,
  quantity: 1,
  unitPriceVnd: '100000',
  listPriceVnd: '100000',
  onPromotion: false,
  lineTotalVnd: '100000',
  mode: 'IN_STOCK',
  expectedDaysMin: null,
  expectedDaysMax: null,
  problem: null,
  ...patch,
});

test('cart helpers: problem lines, the picture, the wait and the ids a refusal names', () => {
  const cart = { lines: [line({}), line({ variantId: 'v2', problem: 'OUT_OF_STOCK' })] };
  assert.deepEqual(
    problemLines(cart).map((l) => l.variantId),
    ['v2'],
  );
  assert.equal(cartImageUrl(line({ imageMediaId: 'm1' })), '/api/v1/public/media/m1/thumb');
  assert.equal(cartImageUrl(line({})), null);
  assert.equal(waitRange(3, 5), '3–5');
  assert.equal(waitRange(4, 4), '4');
  assert.equal(waitRange(null, null), null);
  assert.equal(waitRange(null, 6), '6');
  assert.deepEqual(notReadyIds(new ApiError(409, 'CART_NOT_READY', 'a,b')), ['a', 'b']);
  assert.deepEqual(notReadyIds(new ApiError(409, 'CART_NOT_READY')), []);
  assert.deepEqual(notReadyIds(new ApiError(409, 'CONFLICT', 'a')), []);
});

test('a phone number is accepted in the common spellings only; the server checks it again', () => {
  for (const ok of [
    '0912345678',
    '0912 345 678',
    '+84 912 345 678',
    '0084912345678',
    '0912.345.678',
    '(028) 3822 1234',
    '028 3822 1234',
    '+1 415 555 0100',
  ]) {
    assert.ok(phoneLooksValid(ok), ok);
  }
  for (const bad of [
    '',
    '12345',
    '091234',
    'abc',
    '0912 345 67a',
    '84912345678x',
    '++84912345678',
    '0912345678901234567',
  ]) {
    assert.ok(!phoneLooksValid(bad), bad);
  }
});

test('the address form names the fields that cannot be sent and the request is squashed text', () => {
  assert.deepEqual(addressProblems(EMPTY_ADDRESS), {
    recipientName: true,
    recipientPhone: true,
    provinceCode: true,
    ward: true,
    street: true,
  });
  const draft = {
    recipientName: '  Nguyễn   Thị Lan ',
    recipientPhone: ' 0912 345 678 ',
    provinceCode: 'DA_NANG',
    ward: ' Phường  Hải Châu ',
    street: '04 Nguyễn Quang Bích',
  };
  assert.deepEqual(addressProblems(draft), {});
  assert.deepEqual(addressRequest(draft), {
    recipientName: 'Nguyễn Thị Lan',
    recipientPhone: '0912 345 678',
    provinceCode: 'DA_NANG',
    ward: 'Phường Hải Châu',
    street: '04 Nguyễn Quang Bích',
  });
  assert.deepEqual(addressProblems({ ...draft, street: 'x'.repeat(201) }), { street: true });
  assert.deepEqual(addressProblems({ ...draft, recipientName: 'x'.repeat(121) }), {
    recipientName: true,
  });
  assert.deepEqual(addressProblems({ ...draft, recipientPhone: '123' }), { recipientPhone: true });
  assert.ok(VIETNAM_PROVINCES.some((p) => p.code === draft.provinceCode));
});

test('saved addresses and the profile fill the form; the same address is recognised', () => {
  const saved = {
    recipientName: 'Lan',
    recipientPhone: '+84912345678',
    provinceCode: 'HA_NOI',
    ward: 'Cầu Giấy',
    street: '1 Phố A',
  };
  assert.deepEqual(draftFromSaved(saved), { ...saved, recipientPhone: '0912345678' });
  assert.equal(nationalPhone('+84912345678'), '0912345678');
  assert.equal(nationalPhone('+14155550100'), '+14155550100');
  assert.equal(nationalPhone('0912345678'), '0912345678');
  assert.equal(nationalPhone(''), '');
  assert.deepEqual(draftFromProfile({ fullName: 'Lan', phone: null }), {
    ...EMPTY_ADDRESS,
    recipientName: 'Lan',
  });
  assert.ok(sameAddress(saved, { ...saved, recipientPhone: '+84 912 345 678' }));
  assert.ok(!sameAddress(saved, { ...saved, street: '2 Phố A' }));
  assert.equal(
    addressLine({ street: '1 Phố A', ward: 'Cầu Giấy', provinceName: 'Hà Nội' }),
    '1 Phố A, Cầu Giấy, Hà Nội',
  );
  assert.equal(
    addressLine({ street: '', ward: 'Cầu Giấy', provinceName: 'Hà Nội' }),
    'Cầu Giấy, Hà Nội',
  );
});

test('the checkout request carries the version of the policy read, one voucher at most and the attempt id', () => {
  const draft = {
    recipientName: 'Lan',
    recipientPhone: '0912345678',
    provinceCode: 'HA_NOI',
    ward: 'Cầu Giấy',
    street: '1 Phố A',
  };
  const request = checkoutRequest({
    draft,
    saveAddress: true,
    voucher: '  TET2026 ',
    policyVersion: 3,
    clientRequestId: 'id-1',
  });
  assert.equal(request.voucherCode, 'TET2026');
  assert.equal(request.acceptedPolicyVersion, 3);
  assert.equal(request.clientRequestId, 'id-1');
  assert.equal(request.saveAddress, true);
  const without = checkoutRequest({
    draft,
    saveAddress: false,
    voucher: '   ',
    policyVersion: 3,
    clientRequestId: 'id-1',
  });
  assert.ok(!('voucherCode' in without));
  assert.equal(voucherOf(''), null);
  assert.equal(voucherOf(' a '), 'a');
});

test('a refused address names its field; other refusals name none', () => {
  assert.equal(
    addressFieldOf(new ApiError(400, 'VALIDATION_FAILED', 'address.recipientPhone')),
    'recipientPhone',
  );
  assert.equal(
    addressFieldOf(new ApiError(400, 'VALIDATION_FAILED', 'address.provinceCode')),
    'provinceCode',
  );
  assert.equal(
    addressFieldOf(new ApiError(400, 'VALIDATION_FAILED', 'acceptedPolicyVersion')),
    null,
  );
  assert.equal(addressFieldOf(new ApiError(409, 'CONFLICT', 'address.street')), null);
  assert.equal(addressFieldOf(new Error('x')), null);
});

test('the policy is split into its paragraphs in the reader language', () => {
  const sales = { policyVi: 'Một\n\n Hai \r\nBa', policyEn: 'One' };
  assert.deepEqual(policyParagraphs(sales, 'vi'), ['Một', 'Hai', 'Ba']);
  assert.deepEqual(policyParagraphs(sales, 'en'), ['One']);
});

test('every order state has a tone and words in both languages', () => {
  const states = [
    'AWAITING_PAYMENT',
    'PAID',
    'READY_TO_SHIP',
    'WAITING_GOODS',
    'SHIPPED',
    'DELIVERY_FAILED',
    'COMPLETED',
    'CANCELLED',
  ] as const;
  for (const locale of ['vi', 'en'] as const) {
    const t = getShopText(locale).orders;
    for (const state of states) {
      assert.ok(t.state[state].length > 0, state);
      assert.ok(t.stateHint[state].length > 0, state);
      assert.ok(orderStateTone(state).length > 0);
    }
  }
  const vi = getShopText('vi').orders.state;
  assert.equal(vi.AWAITING_PAYMENT, 'Chờ thanh toán');
  assert.equal(vi.PAID, 'Đã thanh toán, chờ gửi');
  assert.equal(vi.READY_TO_SHIP, 'Đã thanh toán, chờ gửi');
  assert.equal(vi.WAITING_GOODS, 'Đang chờ hàng về');
  assert.equal(vi.SHIPPED, 'Đang giao');
  assert.equal(vi.DELIVERY_FAILED, 'Giao không thành công');
  assert.equal(vi.COMPLETED, 'Đã nhận hàng');
  assert.equal(vi.CANCELLED, 'Đã hủy');
  assert.equal(orderStateTone('AWAITING_PAYMENT'), 'warning');
  assert.equal(orderStateTone('CANCELLED'), 'neutral');
});

test('the countdown never goes below zero and reads as minutes and seconds', () => {
  const now = Date.parse('2026-10-09T10:00:00.000Z');
  assert.equal(secondsLeft('2026-10-09T10:30:00.000Z', now), 1800);
  assert.equal(secondsLeft('2026-10-09T10:00:00.400Z', now), 1);
  assert.equal(secondsLeft('2026-10-09T09:59:00.000Z', now), 0);
  assert.equal(secondsLeft(null, now), null);
  assert.equal(secondsLeft('not a date', now), null);
  assert.equal(formatCountdown(1745), '29:05');
  assert.equal(formatCountdown(9), '00:09');
  assert.equal(formatCountdown(3723), '1:02:03');
  assert.equal(formatCountdown(-5), '00:00');
});

test('coming back from the bank is recognised by what PayOS adds to the address', () => {
  assert.ok(cameBackFromBank('?cancelled=1'));
  assert.ok(cameBackFromBank('?code=00&id=abc&cancel=false&status=PAID&orderCode=123'));
  assert.ok(!cameBackFromBank(''));
  assert.ok(!cameBackFromBank('?payFailed=1'));
});

test('the order page polls only after the bank, only while unpaid and only for about two minutes', () => {
  const base = { state: 'AWAITING_PAYMENT' as const, returned: true, elapsedMs: 0 };
  assert.ok(shouldPoll(base));
  assert.ok(!shouldPoll({ ...base, returned: false }));
  assert.ok(!shouldPoll({ ...base, state: 'PAID' }));
  assert.ok(!shouldPoll({ ...base, elapsedMs: POLL_WINDOW_MS }));
  assert.ok(shouldPoll({ ...base, elapsedMs: POLL_WINDOW_MS - 1 }));
});

test('each shop error code has its own words in both languages, others use the general text', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getShopText(locale).errors;
    for (const code of SHOP_ERROR_CODES) assert.ok((t as Record<string, string>)[code], code);
  }
  const errors = getShopText('vi').errors;
  const general = () => 'chung';
  assert.equal(
    shopErrorMessage(new ApiError(409, 'ONLINE_UNPAID_LIMIT'), errors, general),
    errors.ONLINE_UNPAID_LIMIT,
  );
  assert.equal(shopErrorMessage(new ApiError(500, 'WHATEVER'), errors, general), 'chung');
  assert.equal(shopErrorMessage(new Error('x'), errors, general), 'chung');
  // An object property name is never mistaken for a code.
  assert.equal(shopErrorMessage(new ApiError(400, 'toString'), errors, general), 'chung');
  assert.ok(reloadsPolicy(new ApiError(409, 'ONLINE_POLICY_STALE')));
  assert.ok(!reloadsPolicy(new ApiError(409, 'CONFLICT')));
  assert.ok(needsCart(new ApiError(409, 'CART_NOT_READY')));
  assert.ok(!needsCart(new ApiError(409, 'VOUCHER_INVALID')));
});

test('the words say delivery is free and never call a date a promise', () => {
  const vi = getShopText('vi');
  assert.equal(vi.purchase.freeShipping, 'Miễn phí giao hàng');
  assert.equal(vi.purchase.store, 'Mua tại cửa hàng');
  assert.equal(vi.purchase.signIn, 'Đăng nhập để mua');
  assert.equal(vi.checkout.place, 'Đặt hàng và thanh toán');
  assert.match(vi.purchase.promise, /không phải cam kết/);
  assert.match(vi.cart.preOrderWait, /không phải cam kết/);
  assert.match(getShopText('en').purchase.promise, /not a promise/);
  // A spa, not a clinic.
  assert.doesNotMatch(JSON.stringify(vi), /khám(?! phá)/i);
});
