import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BirthdayContext } from './birthday.engine.js';
import type { EngineMember, EngineProgram, EngineVoucher } from './discount.engine.js';
import { evaluatePricingV3, type V3Line } from './pricing.v3.js';

/** Phase 6 P6-9 (T17, Q1, Q7, OQ-P6-20, OQ-P6-21): the version 3 engine; the worked examples of design 6.8 are the first four tests. */
const NOW = new Date('2027-03-01T10:00:00.000Z');

const spaLine = (
  id: string,
  sequence: number,
  gross: bigint | null,
  service = 's1',
  category = 'c1',
): V3Line => ({
  lineId: id,
  sequence,
  side: 'SPA',
  grossVnd: gross,
  serviceId: service,
  serviceCategoryId: category,
  productId: null,
  brandId: null,
  productCategoryId: null,
});

const productLine = (
  id: string,
  sequence: number,
  gross: bigint,
  ids: { product?: string; brand?: string | null; category?: string | null } = {},
): V3Line => ({
  lineId: id,
  sequence,
  side: 'BEAUTY',
  grossVnd: gross,
  serviceId: null,
  serviceCategoryId: null,
  productId: ids.product ?? 'p1',
  brandId: ids.brand === undefined ? 'b1' : ids.brand,
  productCategoryId: ids.category === undefined ? 'pc1' : ids.category,
});

type ProgramOptions = {
  kind?: 'PERCENT' | 'FIXED_AMOUNT';
  percentBp?: number;
  fixed?: bigint;
  scope?: 'SERVICES' | 'PRODUCTS' | 'BOTH';
  requiresCode?: boolean;
  minSpend?: bigint;
  selected?: {
    services?: string[];
    categories?: string[];
    brands?: string[];
    productCategories?: string[];
    products?: string[];
  };
  usageLimitTotal?: number | null;
  activeRedemptions?: number;
};

function program(code: string, options: ProgramOptions = {}): EngineProgram {
  const selected = options.selected;
  return {
    id: `id-${code}`,
    code,
    nameVi: code,
    nameEn: code,
    requiresCode: options.requiresCode ?? false,
    isActive: true,
    terminated: false,
    activeRedemptions: options.activeRedemptions ?? 0,
    payerRedemptions: 0,
    version: {
      id: `v-${code}`,
      versionNo: 1,
      kind: options.kind ?? 'PERCENT',
      percentBp: options.kind === 'FIXED_AMOUNT' ? null : (options.percentBp ?? 1000),
      fixedAmountVnd: options.kind === 'FIXED_AMOUNT' ? (options.fixed ?? 0n) : null,
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validUntil: new Date('2027-12-31T00:00:00.000Z'),
      minSpendVnd: options.minSpend ?? 0n,
      scopeMode: selected ? 'SELECTED' : 'ALL_SERVICES',
      serviceIds: new Set(selected?.services ?? []),
      categoryIds: new Set(selected?.categories ?? []),
      usageLimitTotal: options.usageLimitTotal ?? null,
      usageLimitPerCustomer: null,
      scope: options.scope ?? 'SERVICES',
      brandIds: new Set(selected?.brands ?? []),
      productCategoryIds: new Set(selected?.productCategories ?? []),
      productIds: new Set(selected?.products ?? []),
    },
  };
}

const voucherOf = (code: string, programValue: EngineProgram) => ({
  voucher: { id: `vid-${code}`, code, isActive: true, programId: programValue.id } as EngineVoucher,
  program: programValue,
});

const member = (tier: EngineMember['tier'], bp: number): EngineMember => ({
  tier,
  tierTableVersion: 1,
  balanceBefore: 0,
  discountBp: bp,
});

const gold = member('GOLD', 400);
const silver = member('SILVER', 300);
const ruby = member('RUBY', 900);

const price = (input: Partial<Parameters<typeof evaluatePricingV3>[0]> & { lines: V3Line[] }) =>
  evaluatePricingV3({
    promotions: [],
    supplied: [],
    hasMemberPayer: true,
    members: {},
    birthday: null,
    now: NOW,
    ...input,
  });

const MIXED = [spaLine('l1', 1, 300_000n), productLine('l2', 2, 200_000n)];

test('A (no program): each side takes its own member discount; total 482,000', () => {
  const result = price({ lines: MIXED, members: { SPA: gold, BEAUTY: silver } });
  assert.equal(result.sides.SPA?.discountTotalVnd, 12_000n);
  assert.equal(result.sides.SPA?.winnerSource, 'MEMBER_TIER');
  assert.equal(result.sides.BEAUTY?.discountTotalVnd, 6_000n);
  assert.equal(result.sides.BEAUTY?.winnerSource, 'MEMBER_TIER');
  assert.equal(result.sides.SPA?.totalVnd, 288_000n);
  assert.equal(result.sides.BEAUTY?.totalVnd, 194_000n);
  assert.equal(result.subtotalVnd, 500_000n);
  assert.equal(result.discountTotalVnd, 18_000n);
  assert.equal(result.totalVnd, 482_000n);
  assert.equal(result.redemptions.length, 0);
  // Points follow the side net per wallet (floor(net / 1000)): 288 Spa, 194 Beauty.
  assert.equal((result.sides.SPA?.totalVnd ?? 0n) / 1000n, 288n);
  assert.equal((result.sides.BEAUTY?.totalVnd ?? 0n) / 1000n, 194n);
});

test('B (shared fixed voucher 100,000, scope BOTH): shares 60,000 and 40,000 beat both member discounts; one redemption', () => {
  const both = program('SHARED100', {
    kind: 'FIXED_AMOUNT',
    fixed: 100_000n,
    scope: 'BOTH',
    requiresCode: true,
  });
  const result = price({
    lines: MIXED,
    supplied: [voucherOf('CODE100', both)],
    members: { SPA: gold, BEAUTY: silver },
  });
  const spa = result.sides.SPA;
  const beauty = result.sides.BEAUTY;
  assert.equal(spa?.winnerSource, 'VOUCHER');
  assert.equal(spa?.discountTotalVnd, 60_000n);
  assert.equal(beauty?.winnerSource, 'VOUCHER');
  assert.equal(beauty?.discountTotalVnd, 40_000n);
  assert.equal(spa?.totalVnd, 240_000n);
  assert.equal(beauty?.totalVnd, 160_000n);
  assert.equal(result.totalVnd, 400_000n);
  assert.equal(result.discountTotalVnd, 100_000n);
  assert.equal(result.redemptions.length, 1);
  assert.deepEqual(result.redemptions[0]?.sides, ['SPA', 'BEAUTY']);
  assert.equal(spa?.winner?.shared?.amountVnd, 100_000n);
  assert.equal(spa?.winner?.shared?.eligibleSubtotalVnd, 500_000n);
});

test('C (shared voucher 30,000; Beauty Ruby 9%): the voucher wins Spa only, Beauty keeps the member discount, still one redemption', () => {
  const both = program('SHARED30', {
    kind: 'FIXED_AMOUNT',
    fixed: 30_000n,
    scope: 'BOTH',
    requiresCode: true,
  });
  const result = price({
    lines: MIXED,
    supplied: [voucherOf('CODE30', both)],
    members: { SPA: gold, BEAUTY: ruby },
  });
  assert.equal(result.sides.SPA?.winnerSource, 'VOUCHER');
  assert.equal(result.sides.SPA?.discountTotalVnd, 18_000n);
  assert.equal(result.sides.BEAUTY?.winnerSource, 'MEMBER_TIER');
  assert.equal(result.sides.BEAUTY?.discountTotalVnd, 18_000n);
  assert.equal(result.sides.SPA?.totalVnd, 282_000n);
  assert.equal(result.sides.BEAUTY?.totalVnd, 182_000n);
  assert.equal(result.totalVnd, 464_000n);
  assert.equal(result.discountTotalVnd, 36_000n);
  assert.equal(result.redemptions.length, 1);
  assert.deepEqual(result.redemptions[0]?.sides, ['SPA']);
  // The voucher's Beauty share (12,000) is shown as a candidate but not applied.
  const beautyCandidate = result.sides.BEAUTY?.candidates.find(
    (c) => c.program.code === 'SHARED30',
  );
  assert.equal(beautyCandidate?.amountVnd, 12_000n);
  assert.equal(result.sides.BEAUTY?.winner, null);
});

test('D (line net): Beauty lines 100,000 and 200,000 with a Beauty discount of 30,000 net 90,000 and 180,000', () => {
  const products = program('PROD30', { kind: 'FIXED_AMOUNT', fixed: 30_000n, scope: 'PRODUCTS' });
  const result = price({
    lines: [productLine('a', 1, 100_000n), productLine('b', 2, 200_000n)],
    promotions: [products],
    members: { BEAUTY: silver },
  });
  const nets = result.allocations.map((line) => [line.lineId, line.discountShareVnd, line.netVnd]);
  assert.deepEqual(nets, [
    ['a', 10_000n, 90_000n],
    ['b', 20_000n, 180_000n],
  ]);
  assert.equal(result.sides.BEAUTY?.totalVnd, 270_000n);
  assert.equal((result.sides.BEAUTY?.totalVnd ?? 0n) / 1000n, 270n);
  assert.equal(result.sides.SPA, undefined);
});

test('scope: SERVICES touches only Spa lines, PRODUCTS only products, BOTH both (and a code-less promotion shows only on its sides)', () => {
  const services = program('SVC', { percentBp: 1000, scope: 'SERVICES' });
  const products = program('PRD', { percentBp: 2000, scope: 'PRODUCTS' });
  const result = price({ lines: MIXED, promotions: [services, products] });
  assert.equal(result.sides.SPA?.discountTotalVnd, 30_000n);
  assert.equal(result.sides.BEAUTY?.discountTotalVnd, 40_000n);
  assert.deepEqual(
    result.sides.SPA?.candidates.map((c) => c.program.code),
    ['SVC'],
  );
  assert.deepEqual(
    result.sides.BEAUTY?.candidates.map((c) => c.program.code),
    ['PRD'],
  );
  // A PRODUCTS-only program on a service-only invoice gives nothing.
  const serviceOnly = price({ lines: [spaLine('l1', 1, 300_000n)], promotions: [products] });
  assert.equal(serviceOnly.discountTotalVnd, 0n);
  assert.equal(serviceOnly.sides.BEAUTY, undefined);
});

test('a supplied voucher of the other scope shows as ineligible (NO_ELIGIBLE_LINES) and gives nothing', () => {
  const productsOnly = program('PRDV', { percentBp: 5000, scope: 'PRODUCTS', requiresCode: true });
  const result = price({
    lines: [spaLine('l1', 1, 300_000n)],
    supplied: [voucherOf('PRDV1', productsOnly)],
  });
  assert.equal(result.discountTotalVnd, 0n);
  const candidate = result.sides.SPA?.candidates[0];
  assert.equal(candidate?.eligible, false);
  assert.equal(candidate?.reason, 'NO_ELIGIBLE_LINES');
});

test('product targeting (OQ-P6-21): by brand, by that exact category, by product; nothing else matches', () => {
  const lines = [
    productLine('a', 1, 100_000n, { product: 'pa', brand: 'brandA', category: 'catX' }),
    productLine('b', 2, 200_000n, { product: 'pb', brand: 'brandB', category: 'catY' }),
    productLine('c', 3, 400_000n, { product: 'pc', brand: null, category: null }),
  ];
  const byBrand = price({
    lines,
    promotions: [
      program('BR', { percentBp: 1000, scope: 'PRODUCTS', selected: { brands: ['brandA'] } }),
    ],
  });
  assert.equal(byBrand.discountTotalVnd, 10_000n);
  const byCategory = price({
    lines,
    promotions: [
      program('CT', {
        percentBp: 1000,
        scope: 'PRODUCTS',
        selected: { productCategories: ['catY'] },
      }),
    ],
  });
  assert.equal(byCategory.discountTotalVnd, 20_000n);
  const byProduct = price({
    lines,
    promotions: [
      program('PR', { percentBp: 1000, scope: 'PRODUCTS', selected: { products: ['pc'] } }),
    ],
  });
  assert.equal(byProduct.discountTotalVnd, 40_000n);
  // The pure engine matches the snapshotted category against the set of ids it is given; the loader widens each target with its
  // subcategories (OQ-66, tested through the API in pricing-v3.integration.test).
  const parent = price({
    lines,
    promotions: [
      program('PA', {
        percentBp: 1000,
        scope: 'PRODUCTS',
        selected: { productCategories: ['parentOfCatX'] },
      }),
    ],
  });
  assert.equal(parent.discountTotalVnd, 0n);
  // A line with unknown brand/category (null) matches no brand or category selection.
  const unknown = price({
    lines: [productLine('u', 1, 100_000n, { brand: null, category: null })],
    promotions: [
      program('UN', { scope: 'PRODUCTS', selected: { brands: ['x'], productCategories: ['y'] } }),
    ],
  });
  assert.equal(unknown.discountTotalVnd, 0n);
});

test('a BOTH program with a selection applies each selection to its own side and splits by what matched', () => {
  const lines = [
    spaLine('s-hit', 1, 100_000n, 'svcA', 'catS'),
    spaLine('s-miss', 2, 900_000n, 'svcB', 'catT'),
    productLine('p-hit', 3, 300_000n, { brand: 'brandA' }),
    productLine('p-miss', 4, 700_000n, { brand: 'brandZ' }),
  ];
  const both = program('BOTHSEL', {
    kind: 'FIXED_AMOUNT',
    fixed: 40_000n,
    scope: 'BOTH',
    selected: { services: ['svcA'], brands: ['brandA'] },
  });
  const result = price({ lines, promotions: [both] });
  // E = 100,000 + 300,000 = 400,000; 40,000 split 1:3.
  assert.equal(result.sides.SPA?.discountTotalVnd, 10_000n);
  assert.equal(result.sides.BEAUTY?.discountTotalVnd, 30_000n);
  // Each side's lines only get a share of their own side's discount.
  const spaShares = result.allocations
    .filter((l) => l.side === 'SPA')
    .map((l) => l.discountShareVnd);
  assert.deepEqual(spaShares, [1_000n, 9_000n]);
});

test('minimum spend of a BOTH program is tested once on the eligible subtotal of both sides (OP-4)', () => {
  const both = program('MIN400', {
    kind: 'FIXED_AMOUNT',
    fixed: 10_000n,
    scope: 'BOTH',
    minSpend: 400_000n,
  });
  assert.equal(price({ lines: MIXED, promotions: [both] }).discountTotalVnd, 10_000n);
  const result = price({ lines: [spaLine('l1', 1, 300_000n)], promotions: [both] });
  assert.equal(result.discountTotalVnd, 0n);
  assert.equal(result.sides.SPA?.candidates[0]?.reason, 'BELOW_MIN_SPEND');
});

test('a total usage limit that is reached makes the program ineligible on both sides at once', () => {
  const both = program('LIM', {
    percentBp: 1000,
    scope: 'BOTH',
    usageLimitTotal: 1,
    activeRedemptions: 1,
  });
  const result = price({ lines: MIXED, promotions: [both] });
  assert.equal(result.discountTotalVnd, 0n);
  assert.equal(result.sides.SPA?.candidates[0]?.reason, 'TOTAL_LIMIT_REACHED');
  assert.equal(result.sides.BEAUTY?.candidates[0]?.reason, 'TOTAL_LIMIT_REACHED');
  assert.equal(result.redemptions.length, 0);
});

test('ties: the member discount wins an equal amount on each side; programs then break by code', () => {
  const equalSpa = program('EQS', { percentBp: 400, scope: 'SERVICES' });
  const equalBeauty = program('EQB', { percentBp: 300, scope: 'PRODUCTS' });
  const tie = price({
    lines: MIXED,
    promotions: [equalSpa, equalBeauty],
    members: { SPA: gold, BEAUTY: silver },
  });
  assert.equal(tie.sides.SPA?.winnerSource, 'MEMBER_TIER');
  assert.equal(tie.sides.SPA?.selectionReason, 'MEMBER_TIE_OVER_PROGRAM');
  assert.equal(tie.sides.BEAUTY?.winnerSource, 'MEMBER_TIER');
  assert.equal(tie.redemptions.length, 0);
  const a = program('AAA', { percentBp: 1000, scope: 'SERVICES' });
  const b = program('BBB', { percentBp: 1000, scope: 'SERVICES' });
  const byCode = price({ lines: [spaLine('l1', 1, 100_000n)], promotions: [b, a] });
  assert.equal(byCode.sides.SPA?.winner?.program.code, 'AAA');
  assert.equal(byCode.sides.SPA?.selectionReason, 'TIE_BREAK_CODE_ORDER');
});

test('no stacking: a program that beats the member discount replaces it on that side only', () => {
  const services = program('SVC20', { percentBp: 2000, scope: 'SERVICES' });
  const result = price({
    lines: MIXED,
    promotions: [services],
    members: { SPA: gold, BEAUTY: silver },
  });
  assert.equal(result.sides.SPA?.winnerSource, 'PROMOTION');
  assert.equal(result.sides.SPA?.selectionReason, 'PROGRAM_BEATS_MEMBER');
  assert.equal(result.sides.SPA?.discountTotalVnd, 60_000n);
  assert.equal(result.sides.BEAUTY?.winnerSource, 'MEMBER_TIER');
  assert.equal(result.sides.BEAUTY?.discountTotalVnd, 6_000n);
});

test('two different programs may win the two sides: two redemptions', () => {
  const services = program('SVC', { percentBp: 1000, scope: 'SERVICES' });
  const products = program('PRD', { percentBp: 1000, scope: 'PRODUCTS' });
  const result = price({ lines: MIXED, promotions: [services, products] });
  assert.deepEqual(
    result.redemptions.map((r) => [r.program.code, r.sides]),
    [
      ['SVC', ['SPA']],
      ['PRD', ['BEAUTY']],
    ],
  );
});

test('two codes of one BOTH program: the same code wins both sides (equal amounts break by code), one redemption', () => {
  const both = program('TWOCODES', {
    kind: 'FIXED_AMOUNT',
    fixed: 50_000n,
    scope: 'BOTH',
    requiresCode: true,
  });
  const result = price({
    lines: MIXED,
    supplied: [voucherOf('ZZZ', both), voucherOf('AAA', both)],
  });
  assert.equal(result.redemptions.length, 1);
  assert.equal(result.redemptions[0]?.voucher?.code, 'AAA');
  assert.deepEqual(result.redemptions[0]?.sides, ['SPA', 'BEAUTY']);
});

test('birthday gift: Spa side only, on the Spa side after the Spa winner; never on a product-only invoice', () => {
  const birthday: BirthdayContext = {
    version: {
      id: 'bv',
      configId: 'bc',
      versionNo: 1,
      isActive: true,
      kind: 'PERCENT',
      percentBp: 1000,
      fixedAmountVnd: null,
      minSpendVnd: 0n,
      windowDaysBefore: 7,
      windowDaysAfter: 7,
      combineMember: true,
      combinePromotion: true,
      combineVoucher: true,
      usageLimitUnlimited: true,
      usageLimitPerYear: null,
    },
    birthdayOn: '2027-03-02',
    usesInYear: 0,
  };
  const mixed = price({ lines: MIXED, members: { SPA: gold, BEAUTY: silver }, birthday });
  // Spa: member 12,000, then 10% of the remaining 288,000 = 28,800 stacked; Beauty is unaffected.
  assert.equal(mixed.sides.SPA?.birthday?.applied, true);
  assert.equal(mixed.sides.SPA?.birthday?.baseVnd, 288_000n);
  assert.equal(mixed.sides.SPA?.discountTotalVnd, 40_800n);
  assert.equal(mixed.sides.BEAUTY?.birthday, null);
  assert.equal(mixed.sides.BEAUTY?.discountTotalVnd, 6_000n);
  const productOnly = price({
    lines: [productLine('a', 1, 200_000n)],
    members: { BEAUTY: silver },
    birthday,
  });
  assert.equal(productOnly.sides.SPA, undefined);
  assert.equal(productOnly.discountTotalVnd, 6_000n);
});

test('a guest payer has no member candidate on either side; a per-customer limit needs a member (OP-3)', () => {
  const limited = program('PERCUST', { percentBp: 1000, scope: 'BOTH' });
  limited.version.usageLimitPerCustomer = 1;
  const guest = price({ lines: MIXED, promotions: [limited], hasMemberPayer: false, members: {} });
  assert.equal(guest.discountTotalVnd, 0n);
  assert.equal(guest.sides.SPA?.candidates[0]?.reason, 'MEMBER_REQUIRED');
});

test('a draft with an unpriced Spa line: the unpriced line is in no subtotal and gets no allocation', () => {
  const result = price({
    lines: [spaLine('priced', 1, 100_000n), spaLine('unpriced', 2, null)],
    members: { SPA: gold },
  });
  assert.equal(result.subtotalVnd, 100_000n);
  assert.equal(result.sides.SPA?.discountTotalVnd, 4_000n);
  assert.deepEqual(
    result.allocations.map((l) => [l.lineId, l.discountShareVnd]),
    [
      ['priced', 4_000n],
      ['unpriced', 0n],
    ],
  );
});

test('a percent BOTH program gives each side the same as a per-side percent, within 1 VND; allocations add up exactly', () => {
  const both = program('PCTBOTH', { percentBp: 1234, scope: 'BOTH' });
  const lines = [
    spaLine('s1', 1, 33_333n),
    spaLine('s2', 2, 66_667n),
    productLine('p1', 3, 12_345n),
    productLine('p2', 4, 87_655n),
    productLine('p3', 5, 1n),
  ];
  const result = price({ lines, promotions: [both] });
  const spaSubtotal = 100_000n;
  const beautySubtotal = 100_001n;
  const exact = (subtotal: bigint) => (subtotal * 1234n + 5000n) / 10000n;
  const spa = result.sides.SPA?.discountTotalVnd ?? 0n;
  const beauty = result.sides.BEAUTY?.discountTotalVnd ?? 0n;
  assert.ok(spa - exact(spaSubtotal) >= -1n && spa - exact(spaSubtotal) <= 1n);
  assert.ok(beauty - exact(beautySubtotal) >= -1n && beauty - exact(beautySubtotal) <= 1n);
  assert.equal(spa + beauty, (200_001n * 1234n + 5000n) / 10000n);
  const net = result.allocations.reduce((sum, line) => sum + line.netVnd, 0n);
  assert.equal(net, result.totalVnd);
  for (const side of ['SPA', 'BEAUTY'] as const) {
    const shares = result.allocations
      .filter((l) => l.side === side)
      .reduce((s, l) => s + l.discountShareVnd, 0n);
    assert.equal(shares, result.sides[side]?.discountTotalVnd);
  }
});
