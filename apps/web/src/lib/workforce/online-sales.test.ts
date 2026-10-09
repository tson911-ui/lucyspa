import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OnlineSalesSettingsResponse } from '@lucy-spa/contracts';
import { onlineSalesDictionary } from '../../i18n/online-sales';
import { ApiError } from '../api/client';
import {
  POLICY_MAX,
  cannotEnable,
  changes,
  defaultPolicy,
  draftFromSettings,
  editRequest,
  isDirty,
  onlineSalesErrorMessage,
  serverProblem,
  switchRequest,
  validateDraft,
  validateForSave,
} from './online-sales';

const settings = (
  patch: Partial<OnlineSalesSettingsResponse> = {},
): OnlineSalesSettingsResponse => ({
  enabled: false,
  fulfilmentBranchId: 'b1',
  fulfilmentBranchName: 'Chi nhánh 1',
  unpaidTimeoutMinutes: 30,
  maxUnpaidOrders: 3,
  maxCartLines: 20,
  maxLineQuantity: 10,
  shipWithinWorkingDays: 2,
  transitDaysMin: 2,
  transitDaysMax: 4,
  shippingFeeEnabled: false,
  shippingFeeVnd: '0',
  freeShippingThresholdVnd: null,
  policyVersion: 1,
  policyVi: null,
  policyEn: null,
  rowVersion: 7,
  updatedAt: '2026-10-09T00:00:00.000Z',
  branches: [{ id: 'b1', name: 'Chi nhánh 1' }],
  paymentConfigured: true,
  ...patch,
});

test('the draft mirrors the settings and nothing is dirty until something is typed', () => {
  const saved = settings();
  const draft = draftFromSettings(saved);
  assert.equal(draft.unpaidTimeoutMinutes, '30');
  assert.equal(draft.shippingFeeEnabled, false);
  assert.equal(draft.freeShippingThresholdVnd, null);
  assert.equal(draft.policyVi, '');
  assert.ok(!isDirty(draft, saved));
  assert.deepEqual(changes(draft, saved), {});
});

test('the request carries the row version and only the fields that changed', () => {
  const saved = settings();
  const draft = {
    ...draftFromSettings(saved),
    unpaidTimeoutMinutes: '45',
    transitDaysMax: '6',
    shippingFeeEnabled: true,
    shippingFeeVnd: 30000,
    freeShippingThresholdVnd: 500000,
    policyVi: '  Chính sách mới  ',
  };
  assert.deepEqual(editRequest(draft, saved), {
    expectedVersion: 7,
    unpaidTimeoutMinutes: 45,
    transitDaysMax: 6,
    shippingFeeEnabled: true,
    shippingFeeVnd: '30000',
    freeShippingThresholdVnd: '500000',
    policyVi: 'Chính sách mới',
  });
  assert.ok(isDirty(draft, saved));
});

test('an emptied policy goes back to the default draft (null) and an unchanged empty one is not sent', () => {
  const saved = settings({ policyVi: 'Cũ', policyEn: null });
  const draft = { ...draftFromSettings(saved), policyVi: '   ', policyEn: '' };
  assert.deepEqual(changes(draft, saved), { policyVi: null });
});

test('the threshold can be cleared and the branch can be unset', () => {
  const saved = settings({ freeShippingThresholdVnd: '500000' });
  const draft = {
    ...draftFromSettings(saved),
    freeShippingThresholdVnd: null,
    fulfilmentBranchId: '',
  };
  assert.deepEqual(changes(draft, saved), {
    freeShippingThresholdVnd: null,
    fulfilmentBranchId: null,
  });
});

test('numbers are checked against the same ranges as the server', () => {
  const base = draftFromSettings(settings());
  assert.deepEqual(validateDraft(base), {});
  assert.deepEqual(validateDraft({ ...base, unpaidTimeoutMinutes: '4' }), {
    unpaidTimeoutMinutes: true,
  });
  assert.deepEqual(validateDraft({ ...base, unpaidTimeoutMinutes: '121' }), {
    unpaidTimeoutMinutes: true,
  });
  assert.deepEqual(validateDraft({ ...base, maxUnpaidOrders: '0' }), { maxUnpaidOrders: true });
  assert.deepEqual(validateDraft({ ...base, maxCartLines: '101' }), { maxCartLines: true });
  assert.deepEqual(validateDraft({ ...base, maxLineQuantity: '' }), { maxLineQuantity: true });
  assert.deepEqual(validateDraft({ ...base, shipWithinWorkingDays: '1.5' }), {
    shipWithinWorkingDays: true,
  });
  assert.deepEqual(validateDraft({ ...base, transitDaysMin: '5', transitDaysMax: '4' }), {
    transitDaysMax: true,
  });
  assert.deepEqual(validateDraft({ ...base, transitDaysMin: '0', transitDaysMax: '0' }), {});
  assert.deepEqual(validateDraft({ ...base, policyVi: 'x'.repeat(POLICY_MAX + 1) }), {
    policyVi: true,
  });
  assert.deepEqual(validateDraft({ ...base, policyEn: 'x'.repeat(POLICY_MAX) }), {});
});

test('the fee is checked only while it is charged; a threshold must be money', () => {
  const base = draftFromSettings(settings());
  assert.deepEqual(validateDraft({ ...base, shippingFeeVnd: null }), {});
  assert.deepEqual(validateDraft({ ...base, shippingFeeEnabled: true, shippingFeeVnd: null }), {
    shippingFeeVnd: true,
  });
  assert.deepEqual(validateDraft({ ...base, shippingFeeEnabled: true, shippingFeeVnd: 30000 }), {});
  assert.deepEqual(validateDraft({ ...base, freeShippingThresholdVnd: 100_000_001 }), {
    freeShippingThresholdVnd: true,
  });
});

test('the branch may be empty while the switch is off, never while it is on', () => {
  const off = settings({ enabled: false, fulfilmentBranchId: null });
  const draft = draftFromSettings(off);
  assert.deepEqual(validateForSave(draft, off), {});
  const on = settings({ enabled: true });
  assert.deepEqual(validateForSave({ ...draftFromSettings(on), fulfilmentBranchId: '' }, on), {
    fulfilmentBranchId: true,
  });
});

test('the master switch is a request of its own and says why it cannot be turned on yet', () => {
  assert.deepEqual(switchRequest(settings(), true), { expectedVersion: 7, enabled: true });
  assert.equal(cannotEnable(settings({ paymentConfigured: false }), false), 'PAYMENT');
  assert.equal(cannotEnable(settings({ fulfilmentBranchId: null }), false), 'BRANCH');
  assert.equal(cannotEnable(settings(), true), 'DIRTY');
  assert.equal(cannotEnable(settings(), false), null);
});

test('a refused field is mapped back to the form; other refusals use this page words', () => {
  assert.equal(
    serverProblem(new ApiError(400, 'VALIDATION_FAILED', 'transitDaysMax')),
    'transitDaysMax',
  );
  assert.equal(
    serverProblem(new ApiError(400, 'VALIDATION_FAILED', 'freeShippingThresholdVnd')),
    'freeShippingThresholdVnd',
  );
  assert.equal(serverProblem(new ApiError(400, 'VALIDATION_FAILED', 'expectedVersion')), null);
  assert.equal(serverProblem(new ApiError(409, 'CONFLICT', 'transitDaysMax')), null);
  const vi = onlineSalesDictionary('vi');
  const general = () => 'chung';
  assert.equal(
    onlineSalesErrorMessage(
      new ApiError(409, 'PAYMENT_METHOD_UNAVAILABLE', 'enabled'),
      vi,
      general,
    ),
    vi.errors.PAYMENT_METHOD_UNAVAILABLE,
  );
  assert.equal(
    onlineSalesErrorMessage(new ApiError(409, 'CONFLICT'), vi, general),
    vi.errors.CONFLICT,
  );
  assert.equal(onlineSalesErrorMessage(new ApiError(500, 'X'), vi, general), 'chung');
});

test('the default policy preview uses the numbers of the form, the saved ones while a number is not valid', () => {
  const saved = settings();
  const draft = { ...draftFromSettings(saved), unpaidTimeoutMinutes: '45', transitDaysMin: '' };
  const text = defaultPolicy('vi', draft, saved);
  assert.match(text, /sau 45 phút/);
  assert.match(text, /ngày làm việc/);
  assert.match(text, /2 đến 4 ngày/);
  assert.match(defaultPolicy('en', draft, saved), /within 45 minutes/);
});

test('the page words are complete in both languages and name the free delivery rule', () => {
  const vi = onlineSalesDictionary('vi');
  const en = onlineSalesDictionary('en');
  assert.equal(vi.title, 'Bán online');
  assert.equal(vi.fee.offHelp, 'Đang miễn phí giao hàng cho mọi đơn. Chỉ bật khi cần.');
  assert.deepEqual(Object.keys(vi.problems), Object.keys(en.problems));
  assert.doesNotMatch(JSON.stringify(vi), /khám/i);
});
