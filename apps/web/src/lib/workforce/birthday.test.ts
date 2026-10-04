import type { BirthdayRewardVersionResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  birthdayRequest,
  combineText,
  draftFromVersion,
  emptyBirthdayDraft,
  giftText,
  parsePercentBp,
  usageText,
  validateBirthdayDraft,
  windowText,
  type BirthdayDraft,
} from './birthday';

/** Phase 5 P5-6: the birthday gift form ships empty and forces an explicit usage limit (Owner, OQ-8 #6). */
const filled = (change: Partial<BirthdayDraft> = {}): BirthdayDraft => ({
  ...emptyBirthdayDraft(),
  kind: 'FIXED_AMOUNT',
  fixed: 50_000,
  before: '7',
  after: '7',
  usage: 'ONE',
  ...change,
});

const version = (
  change: Partial<BirthdayRewardVersionResponse> = {},
): BirthdayRewardVersionResponse => ({
  id: 'v1',
  versionNo: 3,
  isActive: true,
  kind: 'PERCENT',
  percentBp: 750,
  fixedAmountVnd: null,
  minSpendVnd: '300000',
  windowDaysBefore: 3,
  windowDaysAfter: 10,
  combineMember: true,
  combinePromotion: false,
  combineVoucher: false,
  usageLimit: { mode: 'PER_YEAR', perYear: 2 },
  createdAt: '2027-03-01T03:00:00.000Z',
  createdByName: 'Chủ spa',
  ...change,
});

test('a new setup is empty: no preset gift, no preselected usage limit, nothing can be sent', () => {
  const empty = emptyBirthdayDraft();
  assert.equal(empty.kind, null);
  assert.equal(empty.fixed, null);
  assert.equal(empty.percent, '');
  assert.equal(empty.before, '');
  assert.equal(empty.after, '');
  assert.equal(empty.usage, null, 'the Owner must choose the usage limit');
  assert.equal(empty.combineMember || empty.combinePromotion || empty.combineVoucher, false);
  assert.deepEqual(Object.keys(validateBirthdayDraft(empty)).sort(), [
    'after',
    'before',
    'kind',
    'usage',
  ]);
  assert.equal(birthdayRequest(empty, null), null);
});

test('saving is refused until the usage limit is chosen, whatever else is filled in', () => {
  const draft = filled({ usage: null });
  assert.deepEqual(validateBirthdayDraft(draft), { usage: 'required' });
  assert.equal(birthdayRequest(draft, null), null);
  assert.deepEqual(birthdayRequest(filled(), null)?.usageLimit, { mode: 'PER_YEAR', perYear: 1 });
  assert.deepEqual(birthdayRequest(filled({ usage: 'UNLIMITED' }), null)?.usageLimit, {
    mode: 'UNLIMITED',
  });
  assert.deepEqual(birthdayRequest(filled({ usage: 'MANY', usageCount: '3' }), null)?.usageLimit, {
    mode: 'PER_YEAR',
    perYear: 3,
  });
  assert.equal(
    validateBirthdayDraft(filled({ usage: 'MANY', usageCount: '' })).usageCount,
    'required',
  );
  assert.equal(
    validateBirthdayDraft(filled({ usage: 'MANY', usageCount: '1' })).usageCount,
    'invalid',
  );
});

test('percentages become basis points without floating point; commas and dots both work', () => {
  assert.equal(parsePercentBp('10'), 1000);
  assert.equal(parsePercentBp('7,5'), 750);
  assert.equal(parsePercentBp('7.25'), 725);
  assert.equal(parsePercentBp('0,01'), 1);
  assert.equal(parsePercentBp('100'), 10_000);
  assert.equal(parsePercentBp('100,01'), null);
  assert.equal(parsePercentBp('0'), null);
  assert.equal(parsePercentBp('7,555'), null);
  assert.equal(parsePercentBp('abc'), null);
});

test('the request carries exactly what the Owner chose: money gift, min spend, window, combine switches', () => {
  const fixed = birthdayRequest(
    filled({ minSpend: 300_000, combineMember: true, combineVoucher: true }),
    2,
  );
  assert.deepEqual(fixed, {
    expectedVersionNo: 2,
    isActive: true,
    kind: 'FIXED_AMOUNT',
    percentBp: null,
    fixedAmountVnd: '50000',
    minSpendVnd: '300000',
    windowDaysBefore: 7,
    windowDaysAfter: 7,
    combineMember: true,
    combinePromotion: false,
    combineVoucher: true,
    usageLimit: { mode: 'PER_YEAR', perYear: 1 },
  });
  const percent = birthdayRequest(filled({ kind: 'PERCENT', percent: '12,5', fixed: null }), null);
  assert.equal(percent?.percentBp, 1250);
  assert.equal(percent?.fixedAmountVnd, null);
  assert.equal(percent?.minSpendVnd, '0', 'an empty minimum spend means none');
});

test('the window is whole days, each side at most 364, both together at most 364', () => {
  assert.equal(validateBirthdayDraft(filled({ before: '0', after: '0' })).before, undefined);
  assert.equal(validateBirthdayDraft(filled({ before: '-1' })).before, 'invalid');
  assert.equal(validateBirthdayDraft(filled({ before: '1.5' })).before, 'invalid');
  assert.equal(validateBirthdayDraft(filled({ after: '365' })).after, 'invalid');
  assert.equal(
    validateBirthdayDraft(filled({ before: '300', after: '65' })).after,
    'windowTooLong',
  );
  assert.equal(validateBirthdayDraft(filled({ before: '300', after: '64' })).after, undefined);
});

test('editing starts from the saved version, including a usage limit that was chosen before', () => {
  const draft = draftFromVersion(version());
  assert.equal(draft.kind, 'PERCENT');
  assert.equal(draft.percent, '7.5');
  assert.equal(draft.minSpend, 300_000);
  assert.equal(draft.usage, 'MANY');
  assert.equal(draft.usageCount, '2');
  assert.deepEqual(validateBirthdayDraft(draft), {});
  assert.equal(draftFromVersion(version({ usageLimit: { mode: 'UNLIMITED' } })).usage, 'UNLIMITED');
  assert.equal(
    draftFromVersion(version({ usageLimit: { mode: 'PER_YEAR', perYear: 1 } })).usage,
    'ONE',
  );
  assert.equal(draftFromVersion(version({ minSpendVnd: '0' })).minSpend, null);
});

test('texts: the gift, its window, the combine switches and the usage limit read in Vietnamese and English', () => {
  const v = version();
  assert.equal(giftText(v, 'vi'), 'Giảm 7,5%');
  assert.equal(giftText(v, 'en'), '7.5% off');
  assert.equal(giftText(v, 'vi', true), '7,5%');
  const money = version({ kind: 'FIXED_AMOUNT', percentBp: null, fixedAmountVnd: '50000' });
  assert.equal(giftText(money, 'vi', true), '50.000 ₫');
  assert.equal(windowText(v, 'vi'), '3 ngày trước và 10 ngày sau ngày sinh nhật');
  assert.equal(
    windowText(version({ windowDaysBefore: 0, windowDaysAfter: 0 }), 'vi'),
    'Đúng ngày sinh nhật',
  );
  assert.equal(
    combineText(v, 'vi'),
    'Được cộng thêm với: giảm giá hội viên (tính trên số còn lại sau ưu đãi đó)',
  );
  assert.ok(combineText(version({ combineMember: false }), 'vi').startsWith('Không cộng thêm'));
  assert.equal(
    usageText({ mode: 'PER_YEAR', perYear: 1 }, 'vi'),
    '1 lần mỗi khách mỗi năm sinh nhật',
  );
  assert.equal(usageText({ mode: 'UNLIMITED' }, 'en'), 'Unlimited');
  // Lucy Spa is a spa, not a clinic: the Vietnamese texts never use the clinic word.
  for (const text of [giftText(v, 'vi'), windowText(v, 'vi'), combineText(v, 'vi')]) {
    assert.ok(!/khám/i.test(text));
  }
});
