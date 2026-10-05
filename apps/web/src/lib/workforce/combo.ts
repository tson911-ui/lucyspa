import type {
  ComboCreateRequest,
  ComboLookupComboResponse,
  ComboResponse,
  ComboSessionKindName,
  ComboUsedBy,
  ComboUseRequest,
  ComboUseState,
  ComboVersionRequest,
  ComboVersionResponse,
  InvoiceLineComboUseResponse,
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

// ------------------------------------------------------------------------------------- Phase 5 P5-8: using the sessions

export interface ComboUseDraft {
  purchaseId: string;
  usedBy: ComboUsedBy;
  /** Text as typed; only a relative's use carries it. */
  note: string;
}

const MAX_NOTE = 120;

/** The request to pay a line with a session, or null while no combo is chosen or the note is too long. */
export function comboUseBody(draft: ComboUseDraft, version: number): ComboUseRequest | null {
  if (!draft.purchaseId) return null;
  const note = draft.usedBy === 'RELATIVE' ? draft.note.normalize('NFC').trim() : '';
  if ([...note].length > MAX_NOTE) return null;
  return {
    expectedVersion: version,
    purchaseId: draft.purchaseId,
    usedBy: draft.usedBy,
    ...(note ? { relationshipNote: note } : {}),
  };
}

/** "Combo massage · còn 4/6 buổi" for the combo picker of the use dialog. */
export function comboLookupLabel(combo: ComboLookupComboResponse, locale: Locale): string {
  return fill(comboDictionary(locale).use.comboLabel, {
    name: comboName(combo, locale),
    left: combo.sessionsLeft,
    total: combo.totalSessions,
  });
}

export const usedByLabel = (usedBy: ComboUsedBy, locale: Locale): string => {
  const u = comboDictionary(locale).use;
  return usedBy === 'OWNER' ? u.usedByOwner : u.usedByRelative;
};

export const sessionKindLabel = (kind: ComboSessionKindName, locale: Locale): string => {
  const u = comboDictionary(locale).use;
  return kind === 'PAID' ? u.kindPaid : u.kindBonus;
};

/** What the invoice line shows for the combo that pays it: the combo, the session once taken, and who used it. */
export function comboUseBadgeText(use: InvoiceLineComboUseResponse, locale: Locale): string {
  const c = comboDictionary(locale);
  const u = c.use;
  const combo = locale === 'vi' ? use.comboNameVi : use.comboNameEn;
  const who = usedByLabel(use.usedBy, locale);
  return use.sessionNo === null
    ? fill(u.chosenBadge, { combo, who })
    : fill(u.takenBadge, {
        combo,
        no: use.sessionNo,
        who,
        kind: use.sessionKind === 'BONUS' ? c.usage.kindBonus : c.usage.kindPaid,
      });
}

/** "Buổi 3 · trả tiền" for the usage history. */
export const usageSessionText = (
  item: { sessionNo: number; sessionKind: ComboSessionKindName },
  locale: Locale,
): string => {
  const x = comboDictionary(locale).usage;
  return fill(x.sessionText, {
    no: item.sessionNo,
    kind: item.sessionKind === 'PAID' ? x.kindPaid : x.kindBonus,
  });
};

/** Tone of the state of a combo use on a line. */
export const comboUseTone = (state: ComboUseState): 'info' | 'success' | 'neutral' | 'warning' =>
  state === 'USED'
    ? 'success'
    : state === 'SELECTED'
      ? 'info'
      : state === 'RELEASED'
        ? 'neutral'
        : 'warning';

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
