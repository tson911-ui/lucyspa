import type {
  BirthdayRewardSaveRequest,
  BirthdayRewardVersionResponse,
  BirthdayUsageLimit,
} from '@lucy-spa/contracts';
import { BIRTHDAY_WINDOW_MAX_TOTAL_DAYS } from '@lucy-spa/contracts';
import { birthdayDictionary } from '../../i18n/birthday';
import type { Locale } from '../../i18n/locales';
import { fill } from '../../i18n/workforce';
import { ApiError } from './api';
import { bpToPercent } from './discounts';
import { formatVnd } from './format';

/**
 * Phase 5 P5-6: the form state of the birthday gift configuration and its conversion to the request. Nothing is preset: a
 * new configuration starts with every value empty and the usage limit unchosen (the Owner must choose it explicitly).
 */

export type UsageChoice = 'ONE' | 'MANY' | 'UNLIMITED';

export interface BirthdayDraft {
  isActive: boolean;
  /** Null until chosen. */
  kind: 'PERCENT' | 'FIXED_AMOUNT' | null;
  /** Text as typed, `7,5` or `7.5`. */
  percent: string;
  fixed: number | null;
  minSpend: number | null;
  before: string;
  after: string;
  combineMember: boolean;
  combinePromotion: boolean;
  combineVoucher: boolean;
  /** Null until chosen: the form refuses to save without an explicit choice. */
  usage: UsageChoice | null;
  usageCount: string;
}

export type DraftField = 'kind' | 'value' | 'before' | 'after' | 'usage' | 'usageCount';
export type DraftIssue = 'required' | 'invalid' | 'windowTooLong';
export type DraftErrors = Partial<Record<DraftField, DraftIssue>>;

export const emptyBirthdayDraft = (): BirthdayDraft => ({
  isActive: true,
  kind: null,
  percent: '',
  fixed: null,
  minSpend: null,
  before: '',
  after: '',
  combineMember: false,
  combinePromotion: false,
  combineVoucher: false,
  usage: null,
  usageCount: '',
});

/** Editing starts from the saved version (every value was chosen explicitly when it was saved). */
export function draftFromVersion(version: BirthdayRewardVersionResponse): BirthdayDraft {
  const limit = version.usageLimit;
  return {
    isActive: version.isActive,
    kind: version.kind,
    percent: version.percentBp === null ? '' : bpToPercent(version.percentBp),
    fixed: version.fixedAmountVnd === null ? null : Number(version.fixedAmountVnd),
    minSpend: Number(version.minSpendVnd) === 0 ? null : Number(version.minSpendVnd),
    before: String(version.windowDaysBefore),
    after: String(version.windowDaysAfter),
    combineMember: version.combineMember,
    combinePromotion: version.combinePromotion,
    combineVoucher: version.combineVoucher,
    usage: limit.mode === 'UNLIMITED' ? 'UNLIMITED' : limit.perYear === 1 ? 'ONE' : 'MANY',
    usageCount: limit.mode === 'PER_YEAR' && limit.perYear > 1 ? String(limit.perYear) : '',
  };
}

/** `10`, `7.5`, `7,5` or `0,05` as basis points (1..10000), or null. No floating point. */
export function parsePercentBp(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return bp >= 1 && bp <= 10_000 ? bp : null;
}

const wholeDays = (text: string): number | null =>
  /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null;

/** What is still missing or wrong, per field; empty when the draft can be sent. */
export function validateBirthdayDraft(draft: BirthdayDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.kind === null) errors.kind = 'required';
  else if (draft.kind === 'PERCENT') {
    if (draft.percent.trim() === '') errors.value = 'required';
    else if (parsePercentBp(draft.percent) === null) errors.value = 'invalid';
  } else if (draft.fixed === null) errors.value = 'required';
  else if (draft.fixed <= 0) errors.value = 'invalid';
  const before = wholeDays(draft.before);
  const after = wholeDays(draft.after);
  if (draft.before.trim() === '') errors.before = 'required';
  else if (before === null || before > BIRTHDAY_WINDOW_MAX_TOTAL_DAYS) errors.before = 'invalid';
  if (draft.after.trim() === '') errors.after = 'required';
  else if (after === null || after > BIRTHDAY_WINDOW_MAX_TOTAL_DAYS) errors.after = 'invalid';
  else if (before !== null && before + after > BIRTHDAY_WINDOW_MAX_TOTAL_DAYS) {
    errors.after = 'windowTooLong';
  }
  if (draft.usage === null) errors.usage = 'required';
  else if (draft.usage === 'MANY') {
    const count = /^\d{1,4}$/.test(draft.usageCount.trim()) ? Number(draft.usageCount.trim()) : NaN;
    if (draft.usageCount.trim() === '') errors.usageCount = 'required';
    else if (!(count >= 2 && count <= 1_000)) errors.usageCount = 'invalid';
  }
  return errors;
}

/** The request for a complete draft, or null while anything is missing (nothing is sent then). */
export function birthdayRequest(
  draft: BirthdayDraft,
  expectedVersionNo: number | null,
): BirthdayRewardSaveRequest | null {
  if (Object.keys(validateBirthdayDraft(draft)).length > 0 || draft.kind === null) return null;
  const usageLimit: BirthdayUsageLimit =
    draft.usage === 'UNLIMITED'
      ? { mode: 'UNLIMITED' }
      : { mode: 'PER_YEAR', perYear: draft.usage === 'ONE' ? 1 : Number(draft.usageCount.trim()) };
  return {
    expectedVersionNo,
    isActive: draft.isActive,
    kind: draft.kind,
    percentBp: draft.kind === 'PERCENT' ? parsePercentBp(draft.percent) : null,
    fixedAmountVnd: draft.kind === 'FIXED_AMOUNT' ? String(draft.fixed) : null,
    minSpendVnd: String(draft.minSpend ?? 0),
    windowDaysBefore: Number(draft.before.trim()),
    windowDaysAfter: Number(draft.after.trim()),
    combineMember: draft.combineMember,
    combinePromotion: draft.combinePromotion,
    combineVoucher: draft.combineVoucher,
    usageLimit,
  };
}

const percentText = (bp: number, locale: Locale) => {
  const text = bpToPercent(bp);
  return locale === 'vi' ? text.replace('.', ',') : text;
};

/** The gift as one phrase, long (with its base) or short (just the value). */
export function giftText(
  version: Pick<BirthdayRewardVersionResponse, 'kind' | 'percentBp' | 'fixedAmountVnd'>,
  locale: Locale,
  short = false,
): string {
  const d = birthdayDictionary(locale).describe;
  if (version.kind === 'PERCENT') {
    return fill(short ? d.giftShort.percent : d.percent, {
      percent: percentText(version.percentBp ?? 0, locale),
    });
  }
  return fill(short ? d.giftShort.fixed : d.fixed, {
    amount: formatVnd(version.fixedAmountVnd ?? '0', locale),
  });
}

export function windowText(
  version: Pick<BirthdayRewardVersionResponse, 'windowDaysBefore' | 'windowDaysAfter'>,
  locale: Locale,
): string {
  const d = birthdayDictionary(locale).describe;
  const before = version.windowDaysBefore;
  const after = version.windowDaysAfter;
  if (before === 0 && after === 0) return d.windowSameDay;
  if (after === 0) return fill(d.windowBeforeOnly, { before: String(before) });
  if (before === 0) return fill(d.windowAfterOnly, { after: String(after) });
  return fill(d.window, { before: String(before), after: String(after) });
}

/** The window and the usage limit in the few words a table cell has room for. */
export function windowShortText(
  version: Pick<BirthdayRewardVersionResponse, 'windowDaysBefore' | 'windowDaysAfter'>,
  locale: Locale,
): string {
  const d = birthdayDictionary(locale).describe;
  if (version.windowDaysBefore === 0 && version.windowDaysAfter === 0) return d.windowShortSameDay;
  return fill(d.windowShort, {
    before: String(version.windowDaysBefore),
    after: String(version.windowDaysAfter),
  });
}

export function usageShortText(limit: BirthdayUsageLimit, locale: Locale): string {
  const d = birthdayDictionary(locale).describe;
  return limit.mode === 'UNLIMITED'
    ? d.usageUnlimited
    : fill(d.usageShort, { n: String(limit.perYear) });
}

export function combineText(
  version: Pick<
    BirthdayRewardVersionResponse,
    'combineMember' | 'combinePromotion' | 'combineVoucher'
  >,
  locale: Locale,
): string {
  const d = birthdayDictionary(locale).describe;
  const names = [
    version.combineMember ? d.combineMember : null,
    version.combinePromotion ? d.combinePromotion : null,
    version.combineVoucher ? d.combineVoucher : null,
  ].filter((name): name is string => name !== null);
  return names.length === 0
    ? d.combineNone
    : fill(d.combinePrefix, { list: names.join(d.combineJoin) });
}

export function usageText(limit: BirthdayUsageLimit, locale: Locale): string {
  const d = birthdayDictionary(locale).describe;
  if (limit.mode === 'UNLIMITED') return d.usageUnlimited;
  return limit.perYear === 1 ? d.usageOne : fill(d.usageMany, { n: String(limit.perYear) });
}

/** The error text of a birthday command: its own texts first, then the shared messages. */
export function birthdayErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  const texts = birthdayDictionary(locale).errors as Record<string, string>;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return fallback(error);
}
