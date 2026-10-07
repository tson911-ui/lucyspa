import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBirthday, withBirthday, type BirthdayContext } from './birthday.engine.js';
import {
  evaluateDiscounts,
  type EngineLine,
  type EngineMember,
  type EngineProgram,
  type EngineVoucher,
} from './discount.engine.js';
import { compareV2WithV3, runShadow, shadowControl } from './pricing.shadow.js';
import { evaluatePricingV3, type PricingV3Input, type V3Line } from './pricing.v3.js';

/**
 * Phase 6 P6-9 (T17, OQ-59): the DIFFERENTIAL test. For an invoice with no product line the version 3 engine must give exactly the
 * version 2 result. 6,000 seeded random service-only invoices (lines, promotions of every scope and selection, vouchers, member
 * tiers, birthday gifts) are priced by both engines and compared field by field, then the shadow runner's contract is checked.
 */
const NOW = new Date('2027-03-01T10:00:00.000Z');

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SERVICES = ['svc-a', 'svc-b', 'svc-c'];
const CATEGORIES = ['cat-1', 'cat-2'];
const TIERS: EngineMember[] = [
  { tier: 'NONE', tierTableVersion: 1, balanceBefore: 0, discountBp: 0 },
  { tier: 'SILVER', tierTableVersion: 1, balanceBefore: 600, discountBp: 300 },
  { tier: 'GOLD', tierTableVersion: 1, balanceBefore: 1500, discountBp: 400 },
  { tier: 'RUBY', tierTableVersion: 1, balanceBefore: 12000, discountBp: 900 },
];

interface Case {
  v2Lines: EngineLine[];
  v3Lines: V3Line[];
  promotions: EngineProgram[];
  supplied: { voucher: EngineVoucher; program: EngineProgram }[];
  hasMemberPayer: boolean;
  member: EngineMember | null;
  birthday: BirthdayContext | null;
}

function generate(random: () => number): Case {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const lineCount = Math.floor(random() * 6);
  const v2Lines: EngineLine[] = [];
  const v3Lines: V3Line[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const grossVnd = random() < 0.1 ? null : BigInt(Math.floor(random() * 3_000_000));
    const serviceId = pick(SERVICES);
    const categoryId = random() < 0.15 ? null : pick(CATEGORIES);
    v2Lines.push({ serviceId, categoryId, grossVnd });
    v3Lines.push({
      lineId: `line-${index}`,
      sequence: index + 1,
      side: 'SPA',
      grossVnd,
      serviceId,
      serviceCategoryId: categoryId,
      productId: null,
      brandId: null,
      productCategoryId: null,
    });
  }
  const makeProgram = (n: number, requiresCode: boolean): EngineProgram => {
    const kind = random() < 0.5 ? 'PERCENT' : 'FIXED_AMOUNT';
    const selected = random() < 0.4;
    const scopeRoll = random();
    const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);
    const window = random();
    return {
      id: `prog-${n}`,
      code: `CODE${Math.floor(random() * 5)}`,
      nameVi: 'x',
      nameEn: 'x',
      requiresCode,
      isActive: random() < 0.92,
      terminated: random() < 0.05,
      activeRedemptions: Math.floor(random() * 3),
      payerRedemptions: Math.floor(random() * 3),
      version: {
        id: `ver-${n}`,
        versionNo: 1,
        kind,
        percentBp: kind === 'PERCENT' ? 1 + Math.floor(random() * 5000) : null,
        fixedAmountVnd: kind === 'FIXED_AMOUNT' ? BigInt(1 + Math.floor(random() * 800_000)) : null,
        validFrom: window < 0.1 ? day(2) : day(-30),
        validUntil: window > 0.9 ? day(-1) : day(30),
        minSpendVnd: random() < 0.5 ? 0n : BigInt(Math.floor(random() * 1_500_000)),
        scopeMode: selected ? 'SELECTED' : 'ALL_SERVICES',
        serviceIds: new Set(selected && random() < 0.7 ? [pick(SERVICES)] : []),
        categoryIds: new Set(selected && random() < 0.5 ? [pick(CATEGORIES)] : []),
        usageLimitTotal: random() < 0.3 ? 1 + Math.floor(random() * 3) : null,
        usageLimitPerCustomer: random() < 0.3 ? 1 + Math.floor(random() * 2) : null,
        // Programs from before Phase 6 have no scope (absent = SERVICES); the rest cover every scope.
        ...(scopeRoll < 0.3
          ? {}
          : { scope: scopeRoll < 0.6 ? 'SERVICES' : scopeRoll < 0.85 ? 'BOTH' : 'PRODUCTS' }),
        brandIds: new Set(),
        productCategoryIds: new Set(),
        productIds: new Set(),
      } as EngineProgram['version'],
    };
  };
  const promotions = Array.from({ length: Math.floor(random() * 4) }, (_, i) =>
    makeProgram(i, false),
  );
  const supplied = Array.from({ length: Math.floor(random() * 3) }, (_, i) => {
    const program = makeProgram(100 + i, true);
    return {
      program,
      voucher: {
        id: `vou-${i}`,
        code: `V${Math.floor(random() * 4)}`,
        isActive: random() < 0.9,
        programId: program.id,
      },
    };
  });
  const hasMemberPayer = random() < 0.8;
  const member = hasMemberPayer && random() < 0.8 ? pick(TIERS) : null;
  const birthday: BirthdayContext | null =
    hasMemberPayer && random() < 0.35
      ? {
          version: {
            id: 'bv',
            configId: 'bc',
            versionNo: 1,
            isActive: true,
            kind: random() < 0.5 ? 'PERCENT' : 'FIXED_AMOUNT',
            percentBp: null,
            fixedAmountVnd: null,
            minSpendVnd: random() < 0.5 ? 0n : BigInt(Math.floor(random() * 1_000_000)),
            windowDaysBefore: 7,
            windowDaysAfter: 7,
            combineMember: random() < 0.5,
            combinePromotion: random() < 0.5,
            combineVoucher: random() < 0.5,
            usageLimitUnlimited: random() < 0.7,
            usageLimitPerYear: 2,
          },
          birthdayOn: '2027-03-02',
          usesInYear: Math.floor(random() * 3),
        }
      : null;
  if (birthday) {
    const version = birthday.version;
    if (version.kind === 'PERCENT') version.percentBp = 1 + Math.floor(random() * 3000);
    else version.fixedAmountVnd = BigInt(1 + Math.floor(random() * 500_000));
    if (version.usageLimitUnlimited) version.usageLimitPerYear = null;
  }
  return { v2Lines, v3Lines, promotions, supplied, hasMemberPayer, member, birthday };
}

function runBoth(c: Case) {
  const ordinary = evaluateDiscounts({
    lines: c.v2Lines,
    promotions: c.promotions,
    supplied: c.supplied,
    hasMemberPayer: c.hasMemberPayer,
    member: c.member,
    now: NOW,
  });
  const v2 = withBirthday(
    ordinary,
    c.member && c.birthday ? evaluateBirthday(ordinary, c.birthday) : null,
  );
  const input: PricingV3Input = {
    lines: c.v3Lines,
    promotions: c.promotions,
    supplied: c.supplied,
    hasMemberPayer: c.hasMemberPayer,
    members: { SPA: c.member },
    birthday: c.birthday,
    now: NOW,
  };
  return { v2, input, v3: evaluatePricingV3(input) };
}

test('differential: 6,000 random service-only invoices price identically under version 2 and version 3', () => {
  const random = mulberry32(8_102_026);
  let withWinner = 0;
  let withMember = 0;
  let withBirthdayApplied = 0;
  let withBothScope = 0;
  for (let round = 0; round < 6_000; round += 1) {
    const c = generate(random);
    const { v2, v3 } = runBoth(c);
    const mismatches = compareV2WithV3(v2, v3);
    assert.deepEqual(mismatches, [], `round ${round}: ${JSON.stringify(mismatches)}`);
    // Beyond the compared fields: the amounts and the exact candidate objects agree.
    if (c.v2Lines.length > 0) {
      assert.deepEqual(
        v3.sides.SPA?.candidates.map((x) => [
          x.program.id,
          x.voucher?.id,
          x.eligibleSubtotalVnd,
          x.amountVnd,
        ]),
        v2.candidates.map((x) => [x.program.id, x.voucher?.id, x.eligibleSubtotalVnd, x.amountVnd]),
      );
    }
    if (v2.winner) withWinner += 1;
    if (v2.winnerSource === 'MEMBER_TIER') withMember += 1;
    if (v2.birthday?.applied) withBirthdayApplied += 1;
    if (c.promotions.some((p) => p.version.scope === 'BOTH')) withBothScope += 1;
  }
  // The generator really exercised the interesting branches.
  assert.ok(withWinner > 500, `winners ${withWinner}`);
  assert.ok(withMember > 300, `members ${withMember}`);
  assert.ok(withBirthdayApplied > 100, `birthdays ${withBirthdayApplied}`);
  assert.ok(withBothScope > 500, `BOTH ${withBothScope}`);
});

test('shadow runner: agreement is empty; a forced difference is reported; a forced failure is reported and never thrown', () => {
  const random = mulberry32(77);
  let c = generate(random);
  while (c.v2Lines.length === 0) c = generate(random);
  const { v2, input } = runBoth(c);
  assert.deepEqual(runShadow(v2, input), { ran: true, mismatches: [] });

  const original = shadowControl.evaluate;
  try {
    shadowControl.evaluate = (given) => {
      const real = evaluatePricingV3(given);
      return {
        ...real,
        discountTotalVnd: real.discountTotalVnd + 1n,
        totalVnd: real.totalVnd - 1n,
      };
    };
    const forced = runShadow(v2, input);
    assert.equal(forced.ran, true);
    assert.ok(forced.mismatches.some((m) => m.field === 'discountTotalVnd'));
    assert.ok(forced.mismatches.some((m) => m.field === 'totalVnd'));

    shadowControl.evaluate = () => {
      throw new Error('boom');
    };
    const failed = runShadow(v2, input);
    assert.equal(failed.ran, false);
    assert.deepEqual(
      failed.mismatches.map((m) => m.field),
      ['v3.error'],
    );
  } finally {
    shadowControl.evaluate = original;
  }
});
