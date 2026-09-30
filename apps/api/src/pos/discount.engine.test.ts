import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateDiscounts,
  percentAmount,
  type EngineLine,
  type EngineProgram,
  type EngineVersion,
  type EngineVoucher,
} from './discount.engine.js';

const NOW = new Date('2027-03-01T10:00:00.000Z');
const S1 = 's1';
const S2 = 's2';
const C1 = 'c1';
const C2 = 'c2';

const line = (serviceId: string, categoryId: string, gross: bigint | null): EngineLine => ({
  serviceId,
  categoryId,
  grossVnd: gross,
});

function program(
  code: string,
  version: Partial<EngineVersion> = {},
  extra: Partial<EngineProgram> = {},
): EngineProgram {
  return {
    id: `id-${code}`,
    code,
    nameVi: code,
    nameEn: code,
    requiresCode: false,
    isActive: true,
    terminated: false,
    activeRedemptions: 0,
    payerRedemptions: 0,
    version: {
      id: `v-${code}`,
      versionNo: 1,
      kind: 'PERCENT',
      percentBp: 1000,
      fixedAmountVnd: null,
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validUntil: new Date('2027-12-31T00:00:00.000Z'),
      minSpendVnd: 0n,
      scopeMode: 'ALL_SERVICES',
      serviceIds: new Set(),
      categoryIds: new Set(),
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
      ...version,
    },
    ...extra,
  };
}

const voucher = (code: string, programId: string, isActive = true): EngineVoucher => ({
  id: `vid-${code}`,
  code,
  isActive,
  programId,
});

const run = (input: Partial<Parameters<typeof evaluateDiscounts>[0]> & { lines: EngineLine[] }) =>
  evaluateDiscounts({
    promotions: [],
    supplied: [],
    hasMemberPayer: false,
    now: NOW,
    ...input,
  });

test('percent rounds half up to 1 VND in integer arithmetic; fixed is capped by the eligible subtotal', () => {
  // 12.5% of 10,001 = 1,250.125 -> 1,250; 12.5% of 10,004 = 1,250.5 -> 1,251 (half up).
  assert.equal(percentAmount(10_001n, 1250), 1250n);
  assert.equal(percentAmount(10_004n, 1250), 1251n);
  assert.equal(percentAmount(3n, 5000), 2n); // 1.5 -> 2
  assert.equal(percentAmount(1n, 4999), 0n); // 0.4999 -> 0
  assert.equal(percentAmount(999_999_999_999n, 10_000), 999_999_999_999n);

  const percent = run({
    lines: [line(S1, C1, 10_004n)],
    promotions: [program('P', { percentBp: 1250 })],
  });
  assert.equal(percent.discountTotalVnd, 1251n);
  assert.equal(percent.totalVnd, 10_004n - 1251n);

  const fixed = run({
    lines: [line(S1, C1, 30_000n)],
    promotions: [program('F', { kind: 'FIXED_AMOUNT', percentBp: null, fixedAmountVnd: 50_000n })],
  });
  assert.equal(
    fixed.discountTotalVnd,
    30_000n,
    'a fixed amount never exceeds the eligible subtotal',
  );
  assert.equal(fixed.totalVnd, 0n, 'the receivable may be exactly 0');
});

test('scope: only in-scope lines form the eligible subtotal, before any benefit (OP-4 worked example)', () => {
  const lines = [line(S1, C1, 600_000n), line(S2, C2, 500_000n)];
  const scoped = program('SCOPED', {
    scopeMode: 'SELECTED',
    serviceIds: new Set([S1]),
    minSpendVnd: 500_000n,
  });
  const result = run({ lines, promotions: [scoped] });
  const candidate = result.candidates[0]!;
  assert.equal(
    candidate.eligibleSubtotalVnd,
    600_000n,
    'the 500,000 outside the scope is not counted',
  );
  assert.equal(
    candidate.eligible,
    true,
    'minimum spend compares the eligible subtotal, not the invoice',
  );
  assert.equal(result.subtotalVnd, 1_100_000n);
  assert.equal(result.discountTotalVnd, 60_000n);

  // By category, the other line.
  const byCategory = program('CAT', { scopeMode: 'SELECTED', categoryIds: new Set([C2]) });
  assert.equal(
    run({ lines, promotions: [byCategory] }).candidates[0]!.eligibleSubtotalVnd,
    500_000n,
  );

  // Minimum spend is never compared with the post-discount total.
  const min = program('MIN', { minSpendVnd: 100_000n, percentBp: 9000 });
  const small = run({ lines: [line(S1, C1, 100_000n)], promotions: [min] });
  assert.equal(small.candidates[0]!.eligible, true);
  assert.equal(small.totalVnd, 10_000n);
  const below = run({ lines: [line(S1, C1, 99_999n)], promotions: [min] });
  assert.equal(below.candidates[0]!.reason, 'BELOW_MIN_SPEND');
  assert.equal(below.discountTotalVnd, 0n);
});

test('unpriced lines never count; no eligible lines is its own reason', () => {
  const p = program('P');
  const result = run({ lines: [line(S1, C1, null), line(S2, C2, 50_000n)], promotions: [p] });
  assert.equal(result.subtotalVnd, 50_000n);
  assert.equal(result.discountTotalVnd, 5_000n);
  const none = run({ lines: [line(S1, C1, null)], promotions: [p] });
  assert.equal(none.candidates[0]!.reason, 'NO_ELIGIBLE_LINES');
  assert.equal(none.winner, null);
  const outside = run({
    lines: [line(S2, C2, 10_000n)],
    promotions: [program('S', { scopeMode: 'SELECTED', serviceIds: new Set([S1]) })],
  });
  assert.equal(outside.candidates[0]!.reason, 'NO_ELIGIBLE_LINES');
});

test('exactly one benefit wins: voucher vs code-less promotion (OP-5), no stacking', () => {
  const lines = [line(S1, C1, 1_000_000n)];
  const promo = program('PROMO', {
    kind: 'FIXED_AMOUNT',
    percentBp: null,
    fixedAmountVnd: 100_000n,
  });
  const vip = program(
    'VIP',
    { kind: 'FIXED_AMOUNT', percentBp: null, fixedAmountVnd: 150_000n },
    { requiresCode: true },
  );
  const suppliedBig = [{ voucher: voucher('CODE1', vip.id), program: vip }];
  const big = run({ lines, promotions: [promo], supplied: suppliedBig });
  assert.equal(big.winner?.voucher?.code, 'CODE1', 'a 150,000 voucher beats a 100,000 promotion');
  assert.equal(big.discountTotalVnd, 150_000n, 'never stacked: 250,000 is impossible');
  assert.equal(big.selectionReason, 'LARGEST_BENEFIT');

  const small = program(
    'VIP2',
    { kind: 'FIXED_AMOUNT', percentBp: null, fixedAmountVnd: 50_000n },
    { requiresCode: true },
  );
  const lower = run({
    lines,
    promotions: [promo],
    supplied: [{ voucher: voucher('CODE2', small.id), program: small }],
  });
  assert.equal(lower.winner?.program.code, 'PROMO');
  assert.equal(lower.discountTotalVnd, 100_000n);
  const loser = lower.candidates.find((candidate) => candidate.voucher)!;
  assert.equal(
    loser.eligible,
    true,
    'an eligible voucher that lost is still listed, consuming nothing',
  );
  assert.equal(lower.candidates[0], lower.winner, 'the winner is listed first');

  const only = run({ lines, promotions: [promo] });
  assert.equal(only.selectionReason, 'ONLY_ELIGIBLE');
  assert.equal(run({ lines, promotions: [] }).winner, null);
  assert.equal(run({ lines, promotions: [] }).selectionReason, null);
});

test('a voucher-program is never an automatic candidate; only supplied codes count', () => {
  const lines = [line(S1, C1, 200_000n)];
  const voucherProgram = program('V', {}, { requiresCode: true });
  assert.equal(run({ lines, promotions: [voucherProgram] }).candidates.length, 0);
  const supplied = run({
    lines,
    supplied: [{ voucher: voucher('X', voucherProgram.id), program: voucherProgram }],
  });
  assert.equal(supplied.candidates.length, 1);
  assert.equal(supplied.candidates[0]!.source, 'VOUCHER');
});

test('deterministic tie-break: equal amounts by program code, then program id, then voucher code (ordinal)', () => {
  const lines = [line(S1, C1, 100_000n)];
  const b = program('BETA');
  const a = program('ALPHA');
  const result = run({ lines, promotions: [b, a] });
  assert.equal(result.winner?.program.code, 'ALPHA');
  assert.equal(result.selectionReason, 'TIE_BREAK_CODE_ORDER');
  // Order-independent.
  assert.equal(run({ lines, promotions: [a, b] }).winner?.program.code, 'ALPHA');

  // Ordinal, not locale: upper-case sorts before lower-case, digits before letters.
  const upper = program('Z');
  const lower = program('a');
  assert.equal(run({ lines, promotions: [lower, upper] }).winner?.program.code, 'Z');

  // Two supplied codes of one program: equal amount -> voucher code ascending.
  const vp = program('VP', {}, { requiresCode: true });
  const two = run({
    lines,
    supplied: [
      { voucher: voucher('B-2', vp.id), program: vp },
      { voucher: voucher('A-1', vp.id), program: vp },
    ],
  });
  assert.equal(two.winner?.voucher?.code, 'A-1');
});

test('OP-3: a per-customer limit needs an identified member; a guest is ineligible for it only', () => {
  const lines = [line(S1, C1, 100_000n)];
  const limited = program('LIMITED', { usageLimitPerCustomer: 1, percentBp: 2000 });
  const unlimited = program('OPEN', { percentBp: 1000 });
  const guest = run({ lines, promotions: [limited, unlimited], hasMemberPayer: false });
  assert.equal(
    guest.candidates.find((c) => c.program.code === 'LIMITED')!.reason,
    'MEMBER_REQUIRED',
  );
  assert.equal(
    guest.winner?.program.code,
    'OPEN',
    'a guest still gets a benefit that needs no identity',
  );
  const member = run({ lines, promotions: [limited, unlimited], hasMemberPayer: true });
  assert.equal(member.winner?.program.code, 'LIMITED');
  const used = run({
    lines,
    promotions: [
      program('LIMITED', { usageLimitPerCustomer: 1, percentBp: 2000 }, { payerRedemptions: 1 }),
      unlimited,
    ],
    hasMemberPayer: true,
  });
  assert.equal(
    used.candidates.find((c) => c.program.code === 'LIMITED')!.reason,
    'CUSTOMER_LIMIT_REACHED',
  );
  assert.equal(used.winner?.program.code, 'OPEN');
});

test('total usage limit counts active redemptions; state and validity reasons are stable', () => {
  const lines = [line(S1, C1, 100_000n)];
  assert.equal(
    run({ lines, promotions: [program('T', { usageLimitTotal: 2 }, { activeRedemptions: 1 })] })
      .winner?.program.code,
    'T',
  );
  assert.equal(
    run({ lines, promotions: [program('T', { usageLimitTotal: 2 }, { activeRedemptions: 2 })] })
      .candidates[0]!.reason,
    'TOTAL_LIMIT_REACHED',
  );
  const reason = (extra: Partial<EngineProgram>, version: Partial<EngineVersion> = {}) =>
    run({ lines, promotions: [program('R', version, extra)] }).candidates[0]!.reason;
  assert.equal(reason({ isActive: false }), 'NOT_ACTIVE');
  assert.equal(reason({ terminated: true }), 'NOT_ACTIVE');
  assert.equal(reason({}, { validFrom: new Date('2027-06-01T00:00:00.000Z') }), 'NOT_STARTED');
  assert.equal(reason({}, { validUntil: NOW }), 'EXPIRED', 'the end instant is exclusive');
  assert.equal(reason({}, { validFrom: NOW }), null, 'the start instant is inclusive');
  const vp = program('VP', {}, { requiresCode: true });
  const inactive = run({
    lines,
    supplied: [{ voucher: voucher('OFF', vp.id, false), program: vp }],
  });
  assert.equal(inactive.candidates[0]!.reason, 'VOUCHER_INACTIVE');
  assert.equal(inactive.winner, null);
});

test('100% benefit makes a zero receivable; an amount of 0 never wins', () => {
  const all = run({
    lines: [line(S1, C1, 80_000n)],
    promotions: [program('FREE', { percentBp: 10_000 })],
  });
  assert.equal(all.totalVnd, 0n);
  assert.equal(all.discountTotalVnd, 80_000n);
  // 0.01% of 1 VND rounds to 0: eligible but worth nothing -> no winner, no application row.
  const tiny = run({ lines: [line(S1, C1, 1n)], promotions: [program('TINY', { percentBp: 1 })] });
  assert.equal(tiny.candidates[0]!.eligible, true);
  assert.equal(tiny.candidates[0]!.amountVnd, 0n);
  assert.equal(tiny.winner, null);
  assert.equal(tiny.totalVnd, 1n);
});

test('the engine is pure: the same inputs give the same result and no input is mutated', () => {
  const lines = [line(S1, C1, 123_457n), line(S2, C2, 76_543n)];
  const promotions = [program('B', { percentBp: 1234 }), program('A', { percentBp: 1234 })];
  const first = run({ lines, promotions });
  const second = run({ lines, promotions });
  assert.equal(first.winner?.program.code, second.winner?.program.code);
  assert.equal(first.discountTotalVnd, second.discountTotalVnd);
  assert.equal(lines[0]!.grossVnd, 123_457n);
  assert.equal(first.totalVnd + first.discountTotalVnd, first.subtotalVnd);
});

test('an unknown historical category (null) never matches a category scope; service scope is unaffected', () => {
  const unknown = { serviceId: S1, categoryId: null, grossVnd: 100_000n } as EngineLine;
  const byCategory = program('CAT', {
    scopeMode: 'SELECTED',
    categoryIds: new Set([C1]),
  });
  const result = run({ lines: [unknown], promotions: [byCategory] });
  assert.equal(result.candidates[0]!.reason, 'NO_ELIGIBLE_LINES', 'unknown is never guessed');
  assert.equal(result.discountTotalVnd, 0n);
  // The same service by id still matches, and a known category still matches its own scope.
  const byService = program('SVC', { scopeMode: 'SELECTED', serviceIds: new Set([S1]) });
  assert.equal(run({ lines: [unknown], promotions: [byService] }).discountTotalVnd, 10_000n);
  const known = { serviceId: S2, categoryId: C1, grossVnd: 100_000n } as EngineLine;
  assert.equal(run({ lines: [known], promotions: [byCategory] }).discountTotalVnd, 10_000n);
  // Only the snapshot decides: the same service under another historical category is out of scope.
  const moved = { serviceId: S2, categoryId: C2, grossVnd: 100_000n } as EngineLine;
  assert.equal(run({ lines: [moved], promotions: [byCategory] }).discountTotalVnd, 0n);
});
