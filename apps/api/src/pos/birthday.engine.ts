import type {
  BirthdayGiftKindName,
  BirthdayGiftMode,
  BirthdayNotAppliedReason,
} from '@lucy-spa/contracts';
import { percentAmount, type EngineResult } from './discount.engine.js';

/**
 * Phase 5 P5-6: the birthday gift layer (design 6.3, 8; Owner decisions of 2026-10-04, OQ-8). A PURE function of stored inputs:
 * integer VND in `bigint`, no I/O. It runs AFTER the single ordinary winner of `evaluateDiscounts`:
 *
 * - the base of the gift is the eligible amount LEFT AFTER the best offer (`subtotal - ordinary amount`);
 * - a percentage rounds half up to 1 VND, a fixed amount is capped by the base (money gifts only);
 * - when the configuration allows the gift to combine with the winner's source, it is ADDED to the offer (`STACKED`);
 * - when it does not, it is compared with the offer and the LARGER discount wins: the gift replaces the offer only when its
 *   amount is strictly larger (a tie keeps the offer, so the yearly gift is not used up);
 * - with no ordinary winner the gift stands alone (`ALONE`).
 *
 * Whether the invoice is in the payer's window, the go-live switch, the guest payer and the usage count are decided by the
 * loader (`discount.eval.ts`); this function is handed the occurrence and the number of active uses in its year.
 * The SQL twin `lucy_birthday_occurrence` and the redemption guard re-verify the occurrence, the amount and the limit.
 */

export interface BirthdayVersion {
  id: string;
  configId: string;
  versionNo: number;
  isActive: boolean;
  kind: BirthdayGiftKindName;
  percentBp: number | null;
  fixedAmountVnd: bigint | null;
  minSpendVnd: bigint;
  windowDaysBefore: number;
  windowDaysAfter: number;
  combineMember: boolean;
  combinePromotion: boolean;
  combineVoucher: boolean;
  usageLimitUnlimited: boolean;
  usageLimitPerYear: number | null;
}

/** What the loader knows for a payer whose birthday window contains the invoice date. */
export interface BirthdayContext {
  version: BirthdayVersion;
  /** The birthday (`YYYY-MM-DD`) this business date belongs to. */
  birthdayOn: string;
  /** Active (unreleased) uses of this payer in that birthday's year, across every version. */
  usesInYear: number;
}

export interface BirthdayEvaluation {
  context: BirthdayContext;
  /** The eligible amount left after the best offer (the subtotal when no offer won). */
  baseVnd: bigint;
  /** The gift on that base; 0 when none can be computed. */
  amountVnd: bigint;
  applied: boolean;
  mode: BirthdayGiftMode | null;
  reason: BirthdayNotAppliedReason | null;
}

const pad = (value: number, width: number) => String(value).padStart(width, '0');

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** A `YYYY-MM-DD` day as a UTC day number, so day arithmetic never meets a time zone. */
function dayNumber(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Not a calendar day: ${value}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

/**
 * The birthday whose window `[birthday - before, birthday + after]` contains `on`, or null. A 29 February birthday is
 * 28 February in a non-leap year (Owner, OQ-8). Because before + after <= 364, at most one occurrence matches. The TypeScript
 * twin of the SQL function `lucy_birthday_occurrence` (parity-tested).
 */
export function birthdayOccurrence(
  dateOfBirth: string,
  on: string,
  daysBefore: number,
  daysAfter: number,
): string | null {
  const month = Number(dateOfBirth.slice(5, 7));
  const day = Number(dateOfBirth.slice(8, 10));
  const year = Number(on.slice(0, 4));
  const today = dayNumber(on);
  for (let candidateYear = year - 1; candidateYear <= year + 1; candidateYear += 1) {
    const effectiveDay = month === 2 && day === 29 && !isLeap(candidateYear) ? 28 : day;
    const occurrence = `${pad(candidateYear, 4)}-${pad(month, 2)}-${pad(effectiveDay, 2)}`;
    const center = dayNumber(occurrence);
    if (today >= center - daysBefore && today <= center + daysAfter) return occurrence;
  }
  return null;
}

/** The gift on a base: a percentage rounds half up to 1 VND, a fixed amount is capped by the base. */
export function giftAmount(version: BirthdayVersion, baseVnd: bigint): bigint {
  if (baseVnd <= 0n) return 0n;
  if (version.kind === 'PERCENT') return percentAmount(baseVnd, version.percentBp ?? 0);
  const fixed = version.fixedAmountVnd ?? 0n;
  return fixed < baseVnd ? fixed : baseVnd;
}

function combinesWith(version: BirthdayVersion, source: EngineResult['winnerSource']): boolean {
  switch (source) {
    case 'MEMBER_TIER':
      return version.combineMember;
    case 'PROMOTION':
      return version.combinePromotion;
    case 'VOUCHER':
      return version.combineVoucher;
    default:
      return false;
  }
}

/** The ordinary winner's amount (program or member), 0 when nothing won. */
function ordinaryAmount(result: EngineResult): bigint {
  if (result.winnerSource === 'MEMBER_TIER') return result.member?.amountVnd ?? 0n;
  return result.winner?.amountVnd ?? 0n;
}

export function evaluateBirthday(
  result: EngineResult,
  context: BirthdayContext,
): BirthdayEvaluation {
  const { version } = context;
  const ordinary = ordinaryAmount(result);
  const baseVnd = result.subtotalVnd - ordinary;
  const amountVnd = giftAmount(version, baseVnd);
  const notApplied = (reason: BirthdayNotAppliedReason): BirthdayEvaluation => ({
    context,
    baseVnd,
    amountVnd,
    applied: false,
    mode: null,
    reason,
  });
  // OP-4: the minimum spend is tested on the eligible subtotal BEFORE any benefit.
  if (result.subtotalVnd < version.minSpendVnd) return notApplied('BELOW_MIN_SPEND');
  if (
    !version.usageLimitUnlimited &&
    context.usesInYear >= (version.usageLimitPerYear ?? Number.MAX_SAFE_INTEGER)
  ) {
    return notApplied('USAGE_LIMIT_REACHED');
  }
  if (amountVnd <= 0n) return notApplied('NO_AMOUNT');
  const applied = (mode: BirthdayGiftMode): BirthdayEvaluation => ({
    context,
    baseVnd,
    amountVnd,
    applied: true,
    mode,
    reason: null,
  });
  if (result.winnerSource === null) return applied('ALONE');
  if (combinesWith(version, result.winnerSource)) return applied('STACKED');
  // Not allowed to combine: the larger discount wins; a tie keeps the offer.
  return amountVnd > ordinary ? applied('REPLACES_OFFER') : notApplied('OFFER_IS_BETTER');
}

/**
 * The invoice result with the gift folded in: the discount total and the winner source follow the mode. `REPLACES_OFFER`
 * drops the program winner (nothing of it is applied or redeemed) and the member amount; `ALONE` makes the gift the winner.
 */
export function withBirthday(
  result: EngineResult,
  birthday: BirthdayEvaluation | null,
): EngineResult {
  if (!birthday) return result;
  if (!birthday.applied) return { ...result, birthday };
  const mode = birthday.mode;
  const ordinary = ordinaryAmount(result);
  if (mode === 'STACKED') {
    const discountTotalVnd = ordinary + birthday.amountVnd;
    return {
      ...result,
      birthday,
      discountTotalVnd,
      totalVnd: result.subtotalVnd - discountTotalVnd,
    };
  }
  const replaced = mode === 'REPLACES_OFFER';
  return {
    ...result,
    birthday,
    winner: null,
    winnerSource: 'BIRTHDAY',
    selectionReason: replaced ? 'BIRTHDAY_BEATS_OFFER' : 'BIRTHDAY_ONLY',
    discountTotalVnd: birthday.amountVnd,
    totalVnd: result.subtotalVnd - birthday.amountVnd,
  };
}
