import type { DiscountIneligibleReason, DiscountKindName } from '@lucy-spa/contracts';

/**
 * Phase 4 Step 6 — the discount candidate engine (design 7.3, 8.3, OP-3/4/5). A PURE function of stored
 * inputs: integer VND in `bigint`, no floating point, no I/O. It is the only place a benefit amount is
 * computed; the Step 4 database guards re-verify the result (percent rounds half up to 1 VND, a fixed
 * amount is capped by the eligible subtotal, one benefit only).
 *
 * `calculation_version = 1`. Phase 5 adds Member/Birthday candidates to the same list under a new version.
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
}

export interface EngineResult {
  subtotalVnd: bigint;
  candidates: EngineCandidate[];
  winner: EngineCandidate | null;
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
function compare(a: EngineCandidate, b: EngineCandidate): number {
  if (a.amountVnd !== b.amountVnd) return a.amountVnd > b.amountVnd ? -1 : 1;
  return (
    ordinal(a.program.code, b.program.code) ||
    ordinal(a.program.id, b.program.id) ||
    ordinal(a.voucher?.code ?? '', b.voucher?.code ?? '')
  );
}

/**
 * Evaluates every candidate independently and picks exactly one winner (no stacking):
 * (a) every code-less promotion handed in as `promotions`, (b) every supplied voucher of `supplied`.
 * `total = subtotal - discount` (never negative; may be 0).
 */
export function evaluateDiscounts(input: {
  lines: readonly EngineLine[];
  promotions: readonly EngineProgram[];
  supplied: readonly { voucher: EngineVoucher; program: EngineProgram }[];
  hasMemberPayer: boolean;
  now: Date;
}): EngineResult {
  const subtotalVnd = input.lines.reduce((sum, line) => sum + (line.grossVnd ?? 0n), 0n);
  const candidates = [
    ...input.promotions
      .filter((program) => !program.requiresCode)
      .map((program) => evaluateOne(program, null, input.lines, input.hasMemberPayer, input.now)),
    ...input.supplied.map(({ voucher, program }) =>
      evaluateOne(program, voucher, input.lines, input.hasMemberPayer, input.now),
    ),
  ];
  const winning = candidates.filter((candidate) => candidate.eligible && candidate.amountVnd > 0n);
  winning.sort(compare);
  const winner = winning[0] ?? null;
  const discountTotalVnd = winner ? winner.amountVnd : 0n;
  let selectionReason: string | null = null;
  if (winner) {
    const runnerUp = winning[1];
    selectionReason = !runnerUp
      ? 'ONLY_ELIGIBLE'
      : runnerUp.amountVnd < winner.amountVnd
        ? 'LARGEST_BENEFIT'
        : 'TIE_BREAK_CODE_ORDER';
  }
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
    discountTotalVnd,
    totalVnd: subtotalVnd - discountTotalVnd,
    selectionReason,
  };
}
