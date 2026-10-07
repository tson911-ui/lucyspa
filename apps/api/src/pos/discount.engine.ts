import type {
  DiscountIneligibleReason,
  DiscountKindName,
  DiscountScopeName,
  LoyaltyTierName,
  MemberIneligibleReason,
} from '@lucy-spa/contracts';
import type { BirthdayEvaluation } from './birthday.engine.js';

/**
 * Phase 4 Step 6 — the discount candidate engine (design 7.3, 8.3, OP-3/4/5). A PURE function of stored
 * inputs: integer VND in `bigint`, no floating point, no I/O. It is the only place a benefit amount is
 * computed; the Step 4 database guards re-verify the result (percent rounds half up to 1 VND, a fixed
 * amount is capped by the eligible subtotal, one benefit only).
 *
 * `calculation_version = 2` (Phase 5 P5-4) adds the Member Discount (tier) as one more candidate of the same
 * single choice; without a `member` input the result is exactly the version 1 result. The birthday gift (P5-6) is a separate layer applied afterwards by `birthday.engine.ts`.
 */

export interface EngineLine {
  serviceId: string;
  /** The historical category snapshot; null = unknown (never guessed), which no category scope matches. */
  categoryId: string | null;
  /** Null until the line is priced; an unpriced line is never in an eligible subtotal. */
  grossVnd: bigint | null;
}

export interface EngineVersion {
  id: string;
  versionNo: number;
  kind: DiscountKindName;
  percentBp: number | null;
  fixedAmountVnd: bigint | null;
  validFrom: Date;
  validUntil: Date;
  minSpendVnd: bigint;
  scopeMode: 'ALL_SERVICES' | 'SELECTED';
  serviceIds: ReadonlySet<string>;
  categoryIds: ReadonlySet<string>;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  /**
   * Phase 6 P6-9 (Q7): what the program may discount. Absent = `SERVICES` (every program that existed before Phase 6), which keeps
   * the version 2 behavior. The product selection (OQ-P6-21) applies to PRODUCTS and BOTH programs: a product line matches by its
   * snapshotted brand, its snapshotted category (that exact category, children are not included) or its product.
   */
  scope?: DiscountScopeName;
  brandIds?: ReadonlySet<string>;
  productCategoryIds?: ReadonlySet<string>;
  productIds?: ReadonlySet<string>;
}

export interface EngineProgram {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  requiresCode: boolean;
  isActive: boolean;
  terminated: boolean;
  /** The CURRENT (highest) version. */
  version: EngineVersion;
  /** Active (unreleased) redemptions of the program. */
  activeRedemptions: number;
  /** Active redemptions of this program by the invoice's payer; 0 for a guest. */
  payerRedemptions: number;
}

export interface EngineVoucher {
  id: string;
  code: string;
  isActive: boolean;
  programId: string;
}

export interface EngineCandidate {
  source: 'PROMOTION' | 'VOUCHER';
  program: EngineProgram;
  voucher: EngineVoucher | null;
  eligibleSubtotalVnd: bigint;
  eligible: boolean;
  reason: DiscountIneligibleReason | null;
  amountVnd: bigint;
  /**
   * Version 3 only (P6-9, OQ-P6-20): set for a `BOTH` program. `eligibleSubtotalVnd` and `amountVnd` above are THIS SIDE's part
   * (the share of the program's amount); the program-level eligible subtotal and amount that were split are here.
   */
  shared?: { eligibleSubtotalVnd: bigint; amountVnd: bigint };
}

/** The payer's Spa tier from the balance BEFORE the invoice (P5-T3/T4); only given for a member payer once loyalty is live. */
export interface EngineMember {
  tier: LoyaltyTierName;
  tierTableVersion: number;
  balanceBefore: number;
  /** The tier's Member Discount in basis points; 0 = no tier yet. */
  discountBp: number;
}

/** The Member Discount as a candidate (Phase 5, calculation_version 2). It consumes nothing: no program, no usage. */
export interface MemberCandidate {
  member: EngineMember;
  /** All priced lines before any benefit (OP-4). */
  eligibleSubtotalVnd: bigint;
  eligible: boolean;
  reason: MemberIneligibleReason | null;
  amountVnd: bigint;
}

export interface EngineResult {
  subtotalVnd: bigint;
  candidates: EngineCandidate[];
  /** The winning PROGRAM benefit; null when none won or when the Member Discount won. */
  winner: EngineCandidate | null;
  /** The Member Discount candidate, when the payer is a member and loyalty is live. */
  member: MemberCandidate | null;
  winnerSource: 'PROMOTION' | 'VOUCHER' | 'MEMBER_TIER' | 'BIRTHDAY' | null;
  /** The birthday gift layer (P5-6), set by `withBirthday` after the ordinary choice; null when no gift context applies. */
  birthday: BirthdayEvaluation | null;
  discountTotalVnd: bigint;
  totalVnd: bigint;
  /** Machine-readable explanation of the choice; null without a winner. */
  selectionReason: string | null;
}

/** Ordinal (binary) string comparison, never locale-dependent. */
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** PERCENT rounds half up to 1 VND in integer arithmetic: floor((base x bp + 5000) / 10000). */
export function percentAmount(eligibleSubtotal: bigint, percentBp: number): bigint {
  return (eligibleSubtotal * BigInt(percentBp) + 5000n) / 10000n;
}

function inScope(line: EngineLine, version: EngineVersion): boolean {
  if (line.grossVnd === null) return false;
  // Phase 6 P6-9: this engine prices service and combo lines; a program that may only discount products never touches them.
  if (version.scope === 'PRODUCTS') return false;
  if (version.scopeMode === 'ALL_SERVICES') return true;
  return (
    version.serviceIds.has(line.serviceId) ||
    (line.categoryId !== null && version.categoryIds.has(line.categoryId))
  );
}

function evaluateOne(
  program: EngineProgram,
  voucher: EngineVoucher | null,
  lines: readonly EngineLine[],
  hasMemberPayer: boolean,
  now: Date,
): EngineCandidate {
  const version = program.version;
  // The eligible subtotal is fixed BEFORE the benefit (OP-4) and never re-evaluated afterwards.
  const eligibleSubtotalVnd = lines
    .filter((line) => inScope(line, version))
    .reduce((sum, line) => sum + (line.grossVnd ?? 0n), 0n);
  const result = (reason: DiscountIneligibleReason | null, amountVnd = 0n): EngineCandidate => ({
    source: voucher ? 'VOUCHER' : 'PROMOTION',
    program,
    voucher,
    eligibleSubtotalVnd,
    eligible: reason === null,
    reason,
    amountVnd,
  });

  if (!program.isActive || program.terminated) return result('NOT_ACTIVE');
  if (voucher && !voucher.isActive) return result('VOUCHER_INACTIVE');
  if (now < version.validFrom) return result('NOT_STARTED');
  if (now >= version.validUntil) return result('EXPIRED');
  if (eligibleSubtotalVnd <= 0n) return result('NO_ELIGIBLE_LINES');
  if (eligibleSubtotalVnd < version.minSpendVnd) return result('BELOW_MIN_SPEND');
  if (version.usageLimitTotal !== null && program.activeRedemptions >= version.usageLimitTotal) {
    return result('TOTAL_LIMIT_REACHED');
  }
  // OP-3: a per-customer limit needs an identified member payer; a guest is never eligible for it.
  if (version.usageLimitPerCustomer !== null) {
    if (!hasMemberPayer) return result('MEMBER_REQUIRED');
    if (program.payerRedemptions >= version.usageLimitPerCustomer) {
      return result('CUSTOMER_LIMIT_REACHED');
    }
  }
  const amount =
    version.kind === 'PERCENT'
      ? percentAmount(eligibleSubtotalVnd, version.percentBp ?? 0)
      : (version.fixedAmountVnd ?? 0n) < eligibleSubtotalVnd
        ? (version.fixedAmountVnd ?? 0n)
        : eligibleSubtotalVnd;
  return result(null, amount);
}

/** Candidate order for the choice: largest benefit, then program code, program id, voucher code (ordinal). */
export function compare(a: EngineCandidate, b: EngineCandidate): number {
  if (a.amountVnd !== b.amountVnd) return a.amountVnd > b.amountVnd ? -1 : 1;
  return (
    ordinal(a.program.code, b.program.code) ||
    ordinal(a.program.id, b.program.id) ||
    ordinal(a.voucher?.code ?? '', b.voucher?.code ?? '')
  );
}

/** The Member Discount: the tier's percent of every priced line, rounded half up to 1 VND (PRD 16.1, 18.5; Phase 4 Q3). */
export function evaluateMember(member: EngineMember, subtotalVnd: bigint): MemberCandidate {
  const base = { member, eligibleSubtotalVnd: subtotalVnd };
  if (member.discountBp <= 0) {
    return { ...base, eligible: false, reason: 'NO_TIER', amountVnd: 0n };
  }
  if (subtotalVnd <= 0n) {
    return { ...base, eligible: false, reason: 'NO_ELIGIBLE_LINES', amountVnd: 0n };
  }
  const amountVnd = percentAmount(subtotalVnd, member.discountBp);
  return amountVnd > 0n
    ? { ...base, eligible: true, reason: null, amountVnd }
    : { ...base, eligible: false, reason: 'NO_ELIGIBLE_LINES', amountVnd: 0n };
}

/**
 * Evaluates every candidate independently and picks exactly one winner (no stacking):
 * (a) every code-less promotion handed in as `promotions`, (b) every supplied voucher of `supplied`, (c) the
 * Member Discount of `member`. The larger benefit for the customer wins; on an equal amount the Member Discount wins,
 * so the customer keeps the promotion or voucher (P5-T6, Owner decision of 2026-10-04: it replaces the earlier "promotion first" answer).
 * `total = subtotal - discount` (never negative; may be 0).
 */
export function evaluateDiscounts(input: {
  lines: readonly EngineLine[];
  promotions: readonly EngineProgram[];
  supplied: readonly { voucher: EngineVoucher; program: EngineProgram }[];
  hasMemberPayer: boolean;
  /** Only for an identified member payer once loyalty is live; absent = exactly the version 1 result. */
  member?: EngineMember | null;
  now: Date;
}): EngineResult {
  const subtotalVnd = input.lines.reduce((sum, line) => sum + (line.grossVnd ?? 0n), 0n);
  const candidates = [
    ...input.promotions
      // A code-less promotion that may only discount products is not a candidate of the Spa side (P6-9); a voucher of one still
      // shows, as ineligible, so staff see why a supplied code gives nothing.
      .filter((program) => !program.requiresCode && program.version.scope !== 'PRODUCTS')
      .map((program) => evaluateOne(program, null, input.lines, input.hasMemberPayer, input.now)),
    ...input.supplied.map(({ voucher, program }) =>
      evaluateOne(program, voucher, input.lines, input.hasMemberPayer, input.now),
    ),
  ];
  const winning = candidates.filter((candidate) => candidate.eligible && candidate.amountVnd > 0n);
  winning.sort(compare);
  const programWinner = winning[0] ?? null;
  const member = input.member ? evaluateMember(input.member, subtotalVnd) : null;
  const memberWins =
    member !== null &&
    member.eligible &&
    (programWinner === null || member.amountVnd >= programWinner.amountVnd);
  const winner = memberWins ? null : programWinner;
  const discountTotalVnd = memberWins ? member.amountVnd : winner ? winner.amountVnd : 0n;
  let selectionReason: string | null = null;
  if (memberWins) {
    selectionReason =
      programWinner === null
        ? 'MEMBER_ONLY_ELIGIBLE'
        : member.amountVnd > programWinner.amountVnd
          ? 'MEMBER_LARGEST_BENEFIT'
          : 'MEMBER_TIE_OVER_PROGRAM';
  } else if (winner) {
    const runnerUp = winning[1];
    selectionReason = !runnerUp
      ? 'ONLY_ELIGIBLE'
      : runnerUp.amountVnd < winner.amountVnd
        ? 'LARGEST_BENEFIT'
        : 'TIE_BREAK_CODE_ORDER';
    // Staff are told when the program also beat an eligible Member Discount (PRD 16.1); an equal amount never gets here.
    if (member?.eligible) selectionReason = 'PROGRAM_BEATS_MEMBER';
  }
  const winnerSource: EngineResult['winnerSource'] = memberWins
    ? 'MEMBER_TIER'
    : (winner?.source ?? null);
  // Presentation order: the winner first, then eligible by benefit, then ineligible by code.
  candidates.sort((a, b) => {
    if (a === winner) return -1;
    if (b === winner) return 1;
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return compare(a, b);
  });
  return {
    subtotalVnd,
    candidates,
    winner,
    member,
    winnerSource,
    birthday: null,
    discountTotalVnd,
    totalVnd: subtotalVnd - discountTotalVnd,
    selectionReason,
  };
}
