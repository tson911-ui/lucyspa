import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateDiscounts,
  type EngineLine,
  type EngineMember,
  type EngineProgram,
  type EngineVoucher,
} from './discount.engine.js';

/** Phase 5 P5-4: the Member Discount as one more candidate of the single best-offer choice (design 5.2, 6). */
const NOW = new Date('2027-03-01T10:00:00.000Z');
const line = (gross: bigint | null): EngineLine => ({
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

const member = (tier: EngineMember['tier'], bp: number, balanceBefore = 0): EngineMember => ({
  tier,
  tierTableVersion: 1,
  balanceBefore,
  discountBp: bp,
});

const run = (input: {
  lines: EngineLine[];
  promotions?: EngineProgram[];
  supplied?: { voucher: EngineVoucher; program: EngineProgram }[];
  member?: EngineMember | null;
}) =>
  evaluateDiscounts({
    promotions: [],
    supplied: [],
    hasMemberPayer: true,
    now: NOW,
    ...input,
  });

test('member discount: the tier percent of every priced line, rounded half up; it is one more candidate', () => {
  const result = run({ lines: [line(500_000n)], member: member('DIAMOND', 700, 5_200) });
  assert.equal(result.winnerSource, 'MEMBER_TIER');
  assert.equal(result.winner, null, 'no program won');
  assert.equal(result.member?.amountVnd, 35_000n);
  assert.equal(result.discountTotalVnd, 35_000n);
  assert.equal(result.totalVnd, 465_000n);
  assert.equal(result.selectionReason, 'MEMBER_ONLY_ELIGIBLE');
  // Half up to 1 VND: 3% of 10,017 = 300.51 -> 301.
  assert.equal(
    run({ lines: [line(10_017n)], member: member('SILVER', 300) }).discountTotalVnd,
    301n,
  );
});

test('member discount versus a promotion: the better one for the customer wins, never both (PRD 16.1)', () => {
  const lines = [line(500_000n)];
  // Diamond 7% vs sale 15% on 500,000: the sale wins and 425,000 is paid.
  const sale = run({
    lines,
    promotions: [program('SALE15', 1500)],
    member: member('DIAMOND', 700, 5_200),
  });
  assert.equal(sale.winnerSource, 'PROMOTION');
  assert.equal(sale.winner?.program.code, 'SALE15');
  assert.equal(sale.totalVnd, 425_000n);
  assert.equal(sale.selectionReason, 'PROGRAM_BEATS_MEMBER');
  assert.equal(sale.member?.eligible, true, 'the member candidate is still shown');
  // Sale 5% vs Diamond 7%: the member discount wins.
  const memberWins = run({
    lines,
    promotions: [program('SALE5', 500)],
    member: member('DIAMOND', 700, 5_200),
  });
  assert.equal(memberWins.winnerSource, 'MEMBER_TIER');
  assert.equal(memberWins.winner, null);
  assert.equal(memberWins.totalVnd, 465_000n);
  assert.equal(memberWins.selectionReason, 'MEMBER_LARGEST_BENEFIT');
});

test('member discount tie: the member discount wins so the customer keeps the promotion or voucher (P5-T6, Owner decision)', () => {
  const lines = [line(100_000n)];
  const tie = run({
    lines,
    promotions: [program('SALE4', 400)],
    member: member('GOLD', 400, 1_100),
  });
  assert.equal(tie.winnerSource, 'MEMBER_TIER');
  assert.equal(tie.winner, null, 'no program is redeemed on a tie');
  assert.equal(tie.discountTotalVnd, 4_000n);
  assert.equal(tie.selectionReason, 'MEMBER_TIE_OVER_PROGRAM');
  const code = program('CODE4', 400, true);
  const voucherTie = run({
    lines,
    supplied: [
      { voucher: { id: 'vid', code: 'V4', isActive: true, programId: code.id }, program: code },
    ],
    member: member('GOLD', 400, 1_100),
  });
  assert.equal(voucherTie.winnerSource, 'MEMBER_TIER');
  assert.equal(voucherTie.winner, null, 'the voucher is not consumed on a tie');
  assert.equal(voucherTie.selectionReason, 'MEMBER_TIE_OVER_PROGRAM');
  // One VND below the member amount: the member discount still wins by amount; one VND above: the program wins.
  const above = run({
    lines,
    promotions: [program('SALE41', 401)],
    member: member('GOLD', 400, 1_100),
  });
  assert.equal(above.winnerSource, 'PROMOTION');
  assert.equal(above.selectionReason, 'PROGRAM_BEATS_MEMBER');
});

test('no tier, no priced line or no member input: no member benefit; without a member the result is version 1', () => {
  const lines = [line(100_000n)];
  const none = run({ lines, member: member('NONE', 0, 120) });
  assert.equal(none.member?.eligible, false);
  assert.equal(none.member?.reason, 'NO_TIER');
  assert.equal(none.winnerSource, null);
  assert.equal(none.discountTotalVnd, 0n);
  const unpriced = run({ lines: [line(null)], member: member('GOLD', 400, 1_100) });
  assert.equal(unpriced.member?.reason, 'NO_ELIGIBLE_LINES');
  const without = run({ lines, promotions: [program('P10', 1000)] });
  assert.equal(without.member, null);
  assert.equal(without.winnerSource, 'PROMOTION');
  assert.equal(without.selectionReason, 'ONLY_ELIGIBLE');
  // An ineligible member candidate never changes the program reasons.
  assert.equal(
    run({ lines, promotions: [program('P10', 1000)], member: member('NONE', 0) }).selectionReason,
    'ONLY_ELIGIBLE',
  );
});

test('every tier of the locked table gives its Member Discount on 1,000,000 VND', () => {
  const lines = [line(1_000_000n)];
  const amount = (bp: number) => run({ lines, member: member('SILVER', bp) }).discountTotalVnd;
  assert.deepEqual([300, 400, 500, 700, 900].map(amount), [
    30_000n,
    40_000n,
    50_000n,
    70_000n,
    90_000n,
  ]);
});
