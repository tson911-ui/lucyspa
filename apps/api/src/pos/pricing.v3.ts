import type { DiscountIneligibleReason, PricingSideName } from '@lucy-spa/contracts';
import { evaluateBirthday, withBirthday, type BirthdayContext } from './birthday.engine.js';
import {
  compare,
  evaluateMember,
  percentAmount,
  type EngineCandidate,
  type EngineMember,
  type EngineProgram,
  type EngineResult,
  type EngineVersion,
  type EngineVoucher,
} from './discount.engine.js';
import { splitProRata } from './split.js';

/**
 * Phase 6 P6-9 (T17, T18, Q1, Q2, Q7, OQ-P6-20, OQ-P6-21): the pricing engine of `calculation_version = 3`. A PURE function of
 * stored inputs (integer VND in `bigint`, no floating point, no I/O); design section 6.
 *
 * - Two SIDES: SPA (service and combo lines, Spa wallet) and BEAUTY (product lines, Beauty wallet). A side exists only if it has
 *   lines. Each side picks EXACTLY ONE winner among its candidates (the member discount of the payer's tier IN THAT WALLET, code-less
 *   promotions, supplied vouchers): the largest amount; on an equal amount the member discount, then program code, program id,
 *   voucher code. Nothing stacks inside a side. The birthday gift is a Spa-side layer on top (design 6.3).
 * - A program has a scope SERVICES / PRODUCTS / BOTH. A BOTH program is evaluated ONCE on the eligible subtotal of both sides
 *   (validity, minimum spend, limits, payer rule), its amount is computed as in Phase 4 on that total and split between the sides
 *   by the proportional primitive (weights = the sides' eligible subtotals). If it wins on at least one side it is redeemed ONCE;
 *   only the sides it won receive its share (an unused share is simply not applied, OQ-P6-20).
 * - Every side's discount is then allocated to its lines (weights = line gross) so each line has a net amount.
 *
 * The version 2 engine (`discount.engine.ts`) stays the source of truth for an invoice with no product line (OQ-59); this engine
 * runs beside it for comparison there (`pricing.shadow.ts`). The choice below deliberately re-states the version 2 rules instead of
 * calling them, so a mistake in either shows up as a difference; the differential tests pin them to each other.
 */

export const PRICING_SIDES: readonly PricingSideName[] = ['SPA', 'BEAUTY'];

export interface V3Line {
  lineId: string;
  /** The invoice line sequence: the order allocations are made in. */
  sequence: number;
  side: PricingSideName;
  /** Null until priced; an unpriced line is never in any subtotal. */
  grossVnd: bigint | null;
  /** SPA lines: the service and its historical category snapshot. */
  serviceId: string | null;
  serviceCategoryId: string | null;
  /** BEAUTY lines: the product and its historical brand and category snapshots (null = unknown, matches no selection). */
  productId: string | null;
  brandId: string | null;
  productCategoryId: string | null;
}

export interface PricingV3Input {
  lines: readonly V3Line[];
  promotions: readonly EngineProgram[];
  supplied: readonly { voucher: EngineVoucher; program: EngineProgram }[];
  hasMemberPayer: boolean;
  /** The payer's tier per wallet from the balance BEFORE the invoice; absent/null = no member candidate on that side. */
  members: { SPA?: EngineMember | null; BEAUTY?: EngineMember | null };
  /** The birthday context for the Spa side (the loader decides the payer, the window and the usage); null = no gift. */
  birthday: BirthdayContext | null;
  now: Date;
}

export interface LineAllocation {
  lineId: string;
  side: PricingSideName;
  grossVnd: bigint;
  /** The line's share of its side's discount (cumulative rounding, so the shares add up to the side discount). */
  discountShareVnd: bigint;
  netVnd: bigint;
}

/** One program use on the invoice: counted once however many sides it won. */
export interface V3Redemption {
  program: EngineProgram;
  voucher: EngineVoucher | null;
  sides: PricingSideName[];
}

export interface PricingV3Result {
  /** Only the sides that have lines. Each is shaped exactly like a version 2 result of that side. */
  sides: Partial<Record<PricingSideName, EngineResult>>;
  subtotalVnd: bigint;
  discountTotalVnd: bigint;
  /** `subtotal - discount` (the shipping fee is added by the caller, T33). */
  totalVnd: bigint;
  redemptions: V3Redemption[];
  allocations: LineAllocation[];
}

type Scope = NonNullable<EngineVersion['scope']>;
const scopeOf = (version: EngineVersion): Scope => version.scope ?? 'SERVICES';
const touches = (scope: Scope, side: PricingSideName) =>
  scope === 'BOTH' || (side === 'SPA' ? scope === 'SERVICES' : scope === 'PRODUCTS');

function inScope(line: V3Line, version: EngineVersion): boolean {
  if (line.grossVnd === null) return false;
  const scope = scopeOf(version);
  if (!touches(scope, line.side)) return false;
  if (version.scopeMode === 'ALL_SERVICES') return true;
  if (line.side === 'SPA') {
    return (
      (line.serviceId !== null && version.serviceIds.has(line.serviceId)) ||
      (line.serviceCategoryId !== null && version.categoryIds.has(line.serviceCategoryId))
    );
  }
  return (
    (line.productId !== null && (version.productIds?.has(line.productId) ?? false)) ||
    (line.brandId !== null && (version.brandIds?.has(line.brandId) ?? false)) ||
    (line.productCategoryId !== null &&
      (version.productCategoryIds?.has(line.productCategoryId) ?? false))
  );
}

interface Evaluated {
  program: EngineProgram;
  voucher: EngineVoucher | null;
  /** In-scope gross per side, before any benefit (OP-4). */
  bySide: Record<PricingSideName, bigint>;
  eligibleSubtotalVnd: bigint;
  reason: DiscountIneligibleReason | null;
  /** The program's amount on the TOTAL eligible subtotal, exactly as Phase 4. */
  amountVnd: bigint;
  shares: Record<PricingSideName, bigint>;
}

function evaluateProgram(
  program: EngineProgram,
  voucher: EngineVoucher | null,
  lines: readonly V3Line[],
  hasMemberPayer: boolean,
  now: Date,
): Evaluated {
  const version = program.version;
  const bySide: Record<PricingSideName, bigint> = { SPA: 0n, BEAUTY: 0n };
  for (const line of lines) {
    if (inScope(line, version)) bySide[line.side] += line.grossVnd ?? 0n;
  }
  const eligibleSubtotalVnd = bySide.SPA + bySide.BEAUTY;
  const none = { SPA: 0n, BEAUTY: 0n };
  const refuse = (reason: DiscountIneligibleReason): Evaluated => ({
    program,
    voucher,
    bySide,
    eligibleSubtotalVnd,
    reason,
    amountVnd: 0n,
    shares: none,
  });
  if (!program.isActive || program.terminated) return refuse('NOT_ACTIVE');
  if (voucher && !voucher.isActive) return refuse('VOUCHER_INACTIVE');
  if (now < version.validFrom) return refuse('NOT_STARTED');
  if (now >= version.validUntil) return refuse('EXPIRED');
  if (eligibleSubtotalVnd <= 0n) return refuse('NO_ELIGIBLE_LINES');
  if (eligibleSubtotalVnd < version.minSpendVnd) return refuse('BELOW_MIN_SPEND');
  if (version.usageLimitTotal !== null && program.activeRedemptions >= version.usageLimitTotal) {
    return refuse('TOTAL_LIMIT_REACHED');
  }
  if (version.usageLimitPerCustomer !== null) {
    if (!hasMemberPayer) return refuse('MEMBER_REQUIRED');
    if (program.payerRedemptions >= version.usageLimitPerCustomer) {
      return refuse('CUSTOMER_LIMIT_REACHED');
    }
  }
  const amountVnd =
    version.kind === 'PERCENT'
      ? percentAmount(eligibleSubtotalVnd, version.percentBp ?? 0)
      : (version.fixedAmountVnd ?? 0n) < eligibleSubtotalVnd
        ? (version.fixedAmountVnd ?? 0n)
        : eligibleSubtotalVnd;
  const [spa, beauty] = splitProRata(amountVnd, [bySide.SPA, bySide.BEAUTY]);
  return {
    program,
    voucher,
    bySide,
    eligibleSubtotalVnd,
    reason: null,
    amountVnd,
    shares: { SPA: spa ?? 0n, BEAUTY: beauty ?? 0n },
  };
}

function sideCandidate(evaluated: Evaluated, side: PricingSideName): EngineCandidate {
  const scope = scopeOf(evaluated.program.version);
  const sideEligible = evaluated.bySide[side];
  // Eligible at program level but nothing of this side is in its selection: nothing to give on this side.
  const reason = evaluated.reason ?? (sideEligible <= 0n ? 'NO_ELIGIBLE_LINES' : null);
  return {
    source: evaluated.voucher ? 'VOUCHER' : 'PROMOTION',
    program: evaluated.program,
    voucher: evaluated.voucher,
    // The candidate is shown on THIS side with this side's in-scope part (version 2 parity on a Spa-only invoice); a BOTH
    // program carries the program-level figures that were split in `shared`.
    eligibleSubtotalVnd: sideEligible,
    eligible: reason === null,
    reason,
    amountVnd: reason === null ? evaluated.shares[side] : 0n,
    ...(scope === 'BOTH'
      ? {
          shared: {
            eligibleSubtotalVnd: evaluated.eligibleSubtotalVnd,
            amountVnd: evaluated.amountVnd,
          },
        }
      : {}),
  };
}

/** One side's choice: version 2's rules on that side's candidates (one winner, member wins a tie, no stacking). */
function chooseSide(
  side: PricingSideName,
  subtotalVnd: bigint,
  evaluated: readonly Evaluated[],
  member: EngineMember | null | undefined,
  birthday: BirthdayContext | null,
): EngineResult {
  // A code-less promotion is a candidate of the sides its scope touches; a SUPPLIED voucher shows on every side (as ineligible
  // where it has nothing to discount) so staff see why a code gives nothing, exactly as version 2 does.
  const candidates = evaluated
    .filter((entry) => entry.voucher !== null || touches(scopeOf(entry.program.version), side))
    .map((entry) => sideCandidate(entry, side));
  const winning = candidates.filter((candidate) => candidate.eligible && candidate.amountVnd > 0n);
  winning.sort(compare);
  const programWinner = winning[0] ?? null;
  const memberCandidate = member ? evaluateMember(member, subtotalVnd) : null;
  const memberWins =
    memberCandidate !== null &&
    memberCandidate.eligible &&
    (programWinner === null || memberCandidate.amountVnd >= programWinner.amountVnd);
  const winner = memberWins ? null : programWinner;
  const discountTotalVnd = memberWins ? memberCandidate.amountVnd : winner ? winner.amountVnd : 0n;
  let selectionReason: string | null = null;
  if (memberWins) {
    selectionReason =
      programWinner === null
        ? 'MEMBER_ONLY_ELIGIBLE'
        : memberCandidate.amountVnd > programWinner.amountVnd
          ? 'MEMBER_LARGEST_BENEFIT'
          : 'MEMBER_TIE_OVER_PROGRAM';
  } else if (winner) {
    const runnerUp = winning[1];
    selectionReason = !runnerUp
      ? 'ONLY_ELIGIBLE'
      : runnerUp.amountVnd < winner.amountVnd
        ? 'LARGEST_BENEFIT'
        : 'TIE_BREAK_CODE_ORDER';
    if (memberCandidate?.eligible) selectionReason = 'PROGRAM_BEATS_MEMBER';
  }
  const winnerSource: EngineResult['winnerSource'] = memberWins
    ? 'MEMBER_TIER'
    : (winner?.source ?? null);
  candidates.sort((a, b) => {
    if (a === winner) return -1;
    if (b === winner) return 1;
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return compare(a, b);
  });
  const ordinary: EngineResult = {
    subtotalVnd,
    candidates,
    winner,
    member: memberCandidate,
    winnerSource,
    birthday: null,
    discountTotalVnd,
    totalVnd: subtotalVnd - discountTotalVnd,
    selectionReason,
  };
  // The birthday gift is a Spa-side layer after the single ordinary winner, for an identified member payer only (design 6.3).
  return side === 'SPA'
    ? withBirthday(ordinary, member && birthday ? evaluateBirthday(ordinary, birthday) : null)
    : ordinary;
}

export function evaluatePricingV3(input: PricingV3Input): PricingV3Result {
  const lines = [...input.lines].sort((a, b) => a.sequence - b.sequence);
  const subtotals: Record<PricingSideName, bigint> = { SPA: 0n, BEAUTY: 0n };
  const present = new Set<PricingSideName>();
  for (const line of lines) {
    present.add(line.side);
    subtotals[line.side] += line.grossVnd ?? 0n;
  }
  // An invoice with no product line is a Spa invoice even while it has no line yet (a fresh draft), exactly like version 2.
  if (!present.has('BEAUTY')) present.add('SPA');
  const programs = [
    ...input.promotions
      .filter((program) => !program.requiresCode)
      .map((program) => evaluateProgram(program, null, lines, input.hasMemberPayer, input.now)),
    ...input.supplied.map(({ voucher, program }) =>
      evaluateProgram(program, voucher, lines, input.hasMemberPayer, input.now),
    ),
  ];
  const sides: PricingV3Result['sides'] = {};
  const allocations: LineAllocation[] = [];
  for (const side of PRICING_SIDES) {
    if (!present.has(side)) continue;
    const result = chooseSide(side, subtotals[side], programs, input.members[side], input.birthday);
    sides[side] = result;
    const sideLines = lines.filter((line) => line.side === side);
    const shares = splitProRata(
      result.discountTotalVnd,
      sideLines.map((line) => line.grossVnd ?? 0n),
    );
    sideLines.forEach((line, index) => {
      const grossVnd = line.grossVnd ?? 0n;
      const discountShareVnd = shares[index] ?? 0n;
      allocations.push({
        lineId: line.lineId,
        side,
        grossVnd,
        discountShareVnd,
        netVnd: grossVnd - discountShareVnd,
      });
    });
  }
  // One redemption per program however many sides it won (OQ-P6-20); a program winning two sides must do so with one code.
  const redemptions = new Map<string, V3Redemption>();
  for (const side of PRICING_SIDES) {
    const winner = sides[side]?.winner;
    if (!winner) continue;
    const known = redemptions.get(winner.program.id);
    if (known) {
      if ((known.voucher?.id ?? null) !== (winner.voucher?.id ?? null)) {
        throw new Error('A program won two sides with two different codes.');
      }
      known.sides.push(side);
    } else {
      redemptions.set(winner.program.id, {
        program: winner.program,
        voucher: winner.voucher,
        sides: [side],
      });
    }
  }
  const subtotalVnd = subtotals.SPA + subtotals.BEAUTY;
  const discountTotalVnd = PRICING_SIDES.reduce(
    (sum, side) => sum + (sides[side]?.discountTotalVnd ?? 0n),
    0n,
  );
  return {
    sides,
    subtotalVnd,
    discountTotalVnd,
    totalVnd: subtotalVnd - discountTotalVnd,
    redemptions: [...redemptions.values()],
    allocations,
  };
}
