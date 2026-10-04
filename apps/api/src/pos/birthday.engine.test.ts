import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  birthdayOccurrence,
  evaluateBirthday,
  giftAmount,
  withBirthday,
  type BirthdayContext,
  type BirthdayVersion,
} from './birthday.engine.js';
import {
  evaluateDiscounts,
  type EngineLine,
  type EngineMember,
  type EngineProgram,
} from './discount.engine.js';

/** Phase 5 P5-6: the birthday gift layer (design 6.3, 8; Owner decisions of 2026-10-04, OQ-8). */
const NOW = new Date('2027-03-01T10:00:00.000Z');
const line = (gross: bigint): EngineLine => ({
  serviceId: 's1',
  categoryId: 'c1',
  grossVnd: gross,
});

function program(code: string, percentBp: number, requiresCode = false): EngineProgram {
  return {
    id: `id-${code}`,
    code,
    nameVi: code,
    nameEn: code,
    requiresCode,
    isActive: true,
    terminated: false,
    activeRedemptions: 0,
    payerRedemptions: 0,
    version: {
      id: `v-${code}`,
      versionNo: 1,
      kind: 'PERCENT',
      percentBp,
      fixedAmountVnd: null,
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validUntil: new Date('2027-12-31T00:00:00.000Z'),
      minSpendVnd: 0n,
      scopeMode: 'ALL_SERVICES',
      serviceIds: new Set(),
      categoryIds: new Set(),
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
    },
  };
}

const diamond: EngineMember = {
  tier: 'DIAMOND',
  tierTableVersion: 1,
  balanceBefore: 5_200,
  discountBp: 700,
};

const version = (over: Partial<BirthdayVersion> = {}): BirthdayVersion => ({
  id: 'bv1',
  configId: 'bc1',
  versionNo: 1,
  isActive: true,
  kind: 'FIXED_AMOUNT',
  percentBp: null,
  fixedAmountVnd: 50_000n,
  minSpendVnd: 0n,
  windowDaysBefore: 7,
  windowDaysAfter: 7,
  combineMember: false,
  combinePromotion: false,
  combineVoucher: false,
  usageLimitUnlimited: false,
  usageLimitPerYear: 1,
  ...over,
});

const context = (over: Partial<BirthdayVersion> = {}, usesInYear = 0): BirthdayContext => ({
  version: version(over),
  birthdayOn: '2027-03-01',
  usesInYear,
});

const ordinary = (input: { gross: bigint; promotions?: EngineProgram[]; member?: EngineMember }) =>
  evaluateDiscounts({
    lines: [line(input.gross)],
    promotions: input.promotions ?? [],
    supplied: [],
    hasMemberPayer: true,
    member: input.member ?? null,
    now: NOW,
  });

test('occurrence: the window around the birthday, inclusive on both ends', () => {
  assert.equal(birthdayOccurrence('1990-03-10', '2027-03-10', 0, 0), '2027-03-10');
  assert.equal(birthdayOccurrence('1990-03-10', '2027-03-03', 7, 7), '2027-03-10');
  assert.equal(birthdayOccurrence('1990-03-10', '2027-03-17', 7, 7), '2027-03-10');
  assert.equal(birthdayOccurrence('1990-03-10', '2027-03-02', 7, 7), null);
  assert.equal(birthdayOccurrence('1990-03-10', '2027-03-18', 7, 7), null);
  // A window of days after only: the day itself and the days after it.
  assert.equal(birthdayOccurrence('1990-03-10', '2027-03-09', 0, 3), null);
  assert.equal(birthdayOccurrence('1990-03-10', '2027-03-13', 0, 3), '2027-03-10');
});

test('occurrence: 29 February is 28 February in a non-leap year, 29 February in a leap year (Owner, OQ-8)', () => {
  assert.equal(birthdayOccurrence('2000-02-29', '2027-02-28', 0, 0), '2027-02-28');
  assert.equal(birthdayOccurrence('2000-02-29', '2027-03-01', 0, 0), null);
  assert.equal(birthdayOccurrence('2000-02-29', '2028-02-29', 0, 0), '2028-02-29');
  assert.equal(birthdayOccurrence('2000-02-29', '2028-02-28', 0, 0), null);
  // 1900 and 2100 are not leap years, 2000 is.
  assert.equal(birthdayOccurrence('2000-02-29', '2100-02-28', 0, 0), '2100-02-28');
});

test('occurrence: a window crossing New Year belongs to ONE birthday occurrence', () => {
  // Born 30 December, 5 days either side: 25 December .. 4 January.
  assert.equal(birthdayOccurrence('1990-12-30', '2027-12-26', 5, 5), '2027-12-30');
  assert.equal(birthdayOccurrence('1990-12-30', '2028-01-03', 5, 5), '2027-12-30');
  assert.equal(birthdayOccurrence('1990-12-30', '2028-01-05', 5, 5), null);
  // Born 2 January, 5 days before: the window opens in the previous calendar year.
  assert.equal(birthdayOccurrence('1990-01-02', '2027-12-29', 5, 0), '2028-01-02');
});

test('gift amount: a fixed amount is capped by the base, a percentage rounds half up', () => {
  assert.equal(giftAmount(version(), 500_000n), 50_000n);
  assert.equal(giftAmount(version(), 30_000n), 30_000n);
  assert.equal(
    giftAmount(version({ kind: 'PERCENT', percentBp: 500, fixedAmountVnd: null }), 10_010n),
    501n,
  );
  assert.equal(giftAmount(version(), 0n), 0n);
});

test('alone: no ordinary winner, the gift applies on the whole eligible amount', () => {
  const base = ordinary({ gross: 500_000n });
  const evaluation = evaluateBirthday(base, context());
  assert.equal(evaluation.applied, true);
  assert.equal(evaluation.mode, 'ALONE');
  assert.equal(evaluation.baseVnd, 500_000n);
  const result = withBirthday(base, evaluation);
  assert.equal(result.winnerSource, 'BIRTHDAY');
  assert.equal(result.discountTotalVnd, 50_000n);
  assert.equal(result.totalVnd, 450_000n);
});

test('stacked: a combinable gift is added after the best offer (PRD 19 example: 500,000 - 35,000 - 50,000)', () => {
  const base = ordinary({ gross: 500_000n, member: diamond });
  assert.equal(base.winnerSource, 'MEMBER_TIER');
  const evaluation = evaluateBirthday(base, context({ combineMember: true }));
  assert.equal(evaluation.mode, 'STACKED');
  assert.equal(evaluation.baseVnd, 465_000n);
  const result = withBirthday(base, evaluation);
  assert.equal(result.winnerSource, 'MEMBER_TIER', 'the ordinary winner stays the winner');
  assert.equal(result.discountTotalVnd, 85_000n);
  assert.equal(result.totalVnd, 415_000n);
});

test('stacked percentage: calculated on the amount remaining AFTER the best offer (Owner, OQ-8 #3)', () => {
  const base = ordinary({ gross: 500_000n, promotions: [program('SALE15', 1500)] });
  const evaluation = evaluateBirthday(
    base,
    context({ kind: 'PERCENT', percentBp: 1000, fixedAmountVnd: null, combinePromotion: true }),
  );
  // 500,000 - 75,000 = 425,000; 10% of that is 42,500.
  assert.equal(evaluation.baseVnd, 425_000n);
  assert.equal(evaluation.amountVnd, 42_500n);
  assert.equal(withBirthday(base, evaluation).totalVnd, 382_500n);
});

test('a combine flag is per source: member, promotion and voucher are independent switches', () => {
  const promo = ordinary({ gross: 500_000n, promotions: [program('SALE15', 1500)] });
  assert.equal(evaluateBirthday(promo, context({ combineMember: true })).applied, false);
  assert.equal(evaluateBirthday(promo, context({ combinePromotion: true })).mode, 'STACKED');
  const member = ordinary({ gross: 500_000n, member: diamond });
  // The member flag is off: the 50,000 gift is compared with the 35,000 member discount and is larger, so it replaces it.
  assert.equal(
    evaluateBirthday(member, context({ combinePromotion: true })).mode,
    'REPLACES_OFFER',
  );
});

test('not combinable: it is compared with the best offer and the larger discount wins (Owner, OQ-8 #4)', () => {
  // Offer 15% = 75,000. A 100,000 gift is larger: it replaces the offer; the customer pays 400,000.
  const base = ordinary({ gross: 500_000n, promotions: [program('SALE15', 1500)] });
  const bigger = evaluateBirthday(base, context({ fixedAmountVnd: 100_000n }));
  assert.equal(bigger.mode, 'REPLACES_OFFER');
  const replaced = withBirthday(base, bigger);
  assert.equal(replaced.winner, null, 'the offer is dropped');
  assert.equal(replaced.winnerSource, 'BIRTHDAY');
  assert.equal(replaced.discountTotalVnd, 100_000n);
  assert.equal(replaced.totalVnd, 400_000n);
  assert.equal(replaced.selectionReason, 'BIRTHDAY_BEATS_OFFER');
  // A 50,000 gift is smaller: the offer stays and the gift is not used.
  const smaller = evaluateBirthday(base, context());
  assert.equal(smaller.applied, false);
  assert.equal(smaller.reason, 'OFFER_IS_BETTER');
  const kept = withBirthday(base, smaller);
  assert.equal(kept.discountTotalVnd, 75_000n);
  assert.equal(kept.winnerSource, 'PROMOTION');
});

test('not combinable, equal amounts: the offer stays and the yearly gift is not used up', () => {
  const base = ordinary({ gross: 500_000n, promotions: [program('SALE15', 1500)] });
  const tie = evaluateBirthday(base, context({ fixedAmountVnd: 75_000n }));
  assert.equal(tie.applied, false);
  assert.equal(tie.reason, 'OFFER_IS_BETTER');
});

test('minimum spend is tested on the eligible subtotal BEFORE any benefit (OP-4)', () => {
  const base = ordinary({ gross: 500_000n, member: diamond });
  const evaluation = evaluateBirthday(
    base,
    context({ minSpendVnd: 500_000n, combineMember: true }),
  );
  assert.equal(
    evaluation.applied,
    true,
    '500,000 before the member discount meets a 500,000 minimum',
  );
  const below = evaluateBirthday(base, context({ minSpendVnd: 500_001n, combineMember: true }));
  assert.equal(below.applied, false);
  assert.equal(below.reason, 'BELOW_MIN_SPEND');
});

test('usage limit: N per birthday year, or an explicit unlimited', () => {
  const base = ordinary({ gross: 500_000n });
  const reached = evaluateBirthday(base, context({}, 1));
  assert.equal(reached.applied, false);
  assert.equal(reached.reason, 'USAGE_LIMIT_REACHED');
  assert.equal(evaluateBirthday(base, context({ usageLimitPerYear: 2 }, 1)).applied, true);
  assert.equal(
    evaluateBirthday(base, context({ usageLimitUnlimited: true, usageLimitPerYear: null }, 99))
      .applied,
    true,
  );
});

test('a fixed gift never exceeds what is left; nothing left means no gift', () => {
  const small = ordinary({ gross: 30_000n });
  const capped = evaluateBirthday(small, context());
  assert.equal(capped.amountVnd, 30_000n);
  assert.equal(withBirthday(small, capped).totalVnd, 0n);
  // The offer took everything: nothing is left to take a gift from.
  const free = ordinary({ gross: 100_000n, promotions: [program('FREE', 10000)] });
  const none = evaluateBirthday(free, context({ combinePromotion: true }));
  assert.equal(none.applied, false);
  assert.equal(none.reason, 'NO_AMOUNT');
});

test('no gift context: the result is exactly the ordinary result', () => {
  const base = ordinary({ gross: 500_000n, member: diamond });
  assert.equal(withBirthday(base, null), base);
});
