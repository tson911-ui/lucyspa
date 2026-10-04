import type {
  ComboCreateRequest,
  ComboResponse,
  ComboVersionRequest,
  ComboVersionResponse,
} from '@lucy-spa/contracts';
import { comboDictionary } from '../../i18n/combo';
import type { Locale } from '../../i18n/locales';
import { fill } from '../../i18n/workforce';
import { ApiError } from './api';
import { formatVnd } from './format';

/**
 * Phase 5 P5-7: the form state of a combo definition and its conversion to the request. Nothing is preset: a new combo starts
 * with every value empty (the Owner chooses the service, the sessions and the price). The server validates every value again.
 */

const MAX_SESSIONS = 200;
const MAX_NAME = 120;

export interface ComboDraft {
  serviceId: string;
  nameVi: string;
  nameEn: string;
  /** Text as typed. */
  paid: string;
  bonus: string;
  price: number | null;
  active: boolean;
}

export type ComboField = 'serviceId' | 'nameVi' | 'nameEn' | 'paid' | 'bonus' | 'price';
export type ComboIssue = 'required' | 'invalid';
export type ComboErrors = Partial<Record<ComboField, ComboIssue>>;

export const emptyComboDraft = (): ComboDraft => ({
  serviceId: '',
  nameVi: '',
  nameEn: '',
  paid: '',
  bonus: '0',
  price: null,
  active: true,
});

/** Editing starts from the current version (the service is fixed once the combo exists). */
export function draftFromCombo(combo: ComboResponse): ComboDraft {
  const version: ComboVersionResponse = combo.current;
  return {
    serviceId: combo.service.id,
    nameVi: version.nameVi,
    nameEn: version.nameEn,
    paid: String(version.paidSessions),
    bonus: String(version.bonusSessions),
    price: Number(version.priceVnd),
    active: version.active,
  };
}

const wholeNumber = (text: string, min: number): number | null => {
  const trimmed = text.trim();
  if (!/^[0-9]{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= MAX_SESSIONS ? value : null;
};

const nameProblem = (text: string): ComboIssue | undefined => {
  const trimmed = text.normalize('NFC').trim();
  if (!trimmed) return 'required';
  return [...trimmed].length > MAX_NAME ? 'invalid' : undefined;
};

export function validateComboDraft(draft: ComboDraft, editing: boolean): ComboErrors {
  const errors: ComboErrors = {};
  if (!editing && !draft.serviceId) errors.serviceId = 'required';
  const nameVi = nameProblem(draft.nameVi);
  if (nameVi) errors.nameVi = nameVi;
  const nameEn = nameProblem(draft.nameEn);
  if (nameEn) errors.nameEn = nameEn;
  if (!draft.paid.trim()) errors.paid = 'required';
  else if (wholeNumber(draft.paid, 1) === null) errors.paid = 'invalid';
  if (!draft.bonus.trim()) errors.bonus = 'required';
  else if (wholeNumber(draft.bonus, 0) === null) errors.bonus = 'invalid';
  if (draft.price === null) errors.price = 'required';
  else if (!Number.isSafeInteger(draft.price) || draft.price < 1) errors.price = 'invalid';
  return errors;
}

/** The values both requests share, or null while the draft is incomplete. */
function valuesOf(draft: ComboDraft, editing: boolean) {
  if (Object.keys(validateComboDraft(draft, editing)).length > 0) return null;
  return {
    nameVi: draft.nameVi.normalize('NFC').trim(),
    nameEn: draft.nameEn.normalize('NFC').trim(),
    paidSessions: wholeNumber(draft.paid, 1)!,
    bonusSessions: wholeNumber(draft.bonus, 0)!,
    priceVnd: String(draft.price),
    active: draft.active,
  };
}

export function createRequest(draft: ComboDraft): ComboCreateRequest | null {
  const values = valuesOf(draft, false);
  return values ? { serviceId: draft.serviceId, ...values } : null;
}

export function versionRequest(
  draft: ComboDraft,
  expectedVersionNo: number,
): ComboVersionRequest | null {
  const values = valuesOf(draft, true);
  return values ? { expectedVersionNo, ...values } : null;
}

/** "5 buổi + 1 tặng" or "7 buổi". */
export function sessionsText(paid: number, bonus: number, locale: Locale): string {
  const c = comboDictionary(locale);
  return bonus > 0 ? fill(c.sessionsText, { paid, bonus }) : fill(c.sessionsPaidOnly, { paid });
}

export const comboName = (combo: { nameVi: string; nameEn: string }, locale: Locale): string =>
  locale === 'vi' ? combo.nameVi : combo.nameEn;

/** "Combo massage · 1.000.000 ₫" for the sale picker. */
export const comboOptionLabel = (
  option: { nameVi: string; nameEn: string; priceVnd: string },
  locale: Locale,
): string =>
  fill(comboDictionary(locale).sale.comboLabel, {
    name: comboName(option, locale),
    price: formatVnd(option.priceVnd, locale),
  });

/** The error text of a combo command: its own texts first, then the shared messages. */
export function comboErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  const texts = comboDictionary(locale).errors as Record<string, string>;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return fallback(error);
}
