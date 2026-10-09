import type {
  OnlineSalesSettingsResponse,
  OnlineSalesSettingsUpdateRequest,
} from '@lucy-spa/contracts';
import { onlinePolicyDefault } from '@lucy-spa/contracts';
import type { OnlineSalesText } from '../../i18n/online-sales';
import { ApiError } from '../api/client';

/**
 * Phase 6 P6-19: the form of the staff page "Bán online". The draft keeps what is typed (numbers as text, money as a whole
 * number or empty); the request carries only what changed, with the row version the settings were read at. The server decides every
 * rule again and names the field it refused.
 */
export interface OnlineSalesDraft {
  fulfilmentBranchId: string;
  unpaidTimeoutMinutes: string;
  maxUnpaidOrders: string;
  maxCartLines: string;
  maxLineQuantity: string;
  shipWithinWorkingDays: string;
  transitDaysMin: string;
  transitDaysMax: string;
  shippingFeeEnabled: boolean;
  shippingFeeVnd: number | null;
  freeShippingThresholdVnd: number | null;
  policyVi: string;
  policyEn: string;
}

export type OnlineSalesField = Exclude<keyof OnlineSalesDraft, 'shippingFeeEnabled'>;

/** The most characters of a policy text (the server's limit). */
export const POLICY_MAX = 6000;
export const MONEY_MAX = 100_000_000;

export const NUMBER_RULES: Readonly<
  Record<
    | 'unpaidTimeoutMinutes'
    | 'maxUnpaidOrders'
    | 'maxCartLines'
    | 'maxLineQuantity'
    | 'shipWithinWorkingDays'
    | 'transitDaysMin'
    | 'transitDaysMax',
    { min: number; max: number }
  >
> = {
  unpaidTimeoutMinutes: { min: 5, max: 120 },
  maxUnpaidOrders: { min: 1, max: 20 },
  maxCartLines: { min: 1, max: 100 },
  maxLineQuantity: { min: 1, max: 100 },
  shipWithinWorkingDays: { min: 1, max: 30 },
  transitDaysMin: { min: 0, max: 60 },
  transitDaysMax: { min: 0, max: 60 },
};

type NumberField = keyof typeof NUMBER_RULES;
const NUMBER_FIELDS = Object.keys(NUMBER_RULES) as NumberField[];

export function draftFromSettings(settings: OnlineSalesSettingsResponse): OnlineSalesDraft {
  return {
    fulfilmentBranchId: settings.fulfilmentBranchId ?? '',
    unpaidTimeoutMinutes: String(settings.unpaidTimeoutMinutes),
    maxUnpaidOrders: String(settings.maxUnpaidOrders),
    maxCartLines: String(settings.maxCartLines),
    maxLineQuantity: String(settings.maxLineQuantity),
    shipWithinWorkingDays: String(settings.shipWithinWorkingDays),
    transitDaysMin: String(settings.transitDaysMin),
    transitDaysMax: String(settings.transitDaysMax),
    shippingFeeEnabled: settings.shippingFeeEnabled,
    shippingFeeVnd: Number(settings.shippingFeeVnd),
    freeShippingThresholdVnd:
      settings.freeShippingThresholdVnd === null ? null : Number(settings.freeShippingThresholdVnd),
    policyVi: settings.policyVi ?? '',
    policyEn: settings.policyEn ?? '',
  };
}

/** A whole number from its text, or null when it is empty, fractional or not a number. */
function whole(value: string): number | null {
  const text = value.trim();
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

const validMoney = (value: number | null) =>
  value !== null && Number.isInteger(value) && value >= 0 && value <= MONEY_MAX;

const policyOk = (value: string) => [...value.trim()].length <= POLICY_MAX;

/** The fields that cannot be saved yet. An empty result means the form can be sent. */
export function validateDraft(draft: OnlineSalesDraft): Partial<Record<OnlineSalesField, true>> {
  const problems: Partial<Record<OnlineSalesField, true>> = {};
  for (const field of NUMBER_FIELDS) {
    const value = whole(draft[field]);
    const rule = NUMBER_RULES[field];
    if (value === null || value < rule.min || value > rule.max) problems[field] = true;
  }
  const min = whole(draft.transitDaysMin);
  const max = whole(draft.transitDaysMax);
  if (min !== null && max !== null && max < min) problems.transitDaysMax = true;
  if (draft.fulfilmentBranchId === '') problems.fulfilmentBranchId = true;
  // The fee is only checked while it is charged; an unused amount stays whatever it was.
  if (draft.shippingFeeEnabled && !validMoney(draft.shippingFeeVnd)) problems.shippingFeeVnd = true;
  if (draft.freeShippingThresholdVnd !== null && !validMoney(draft.freeShippingThresholdVnd)) {
    problems.freeShippingThresholdVnd = true;
  }
  if (!policyOk(draft.policyVi)) problems.policyVi = true;
  if (!policyOk(draft.policyEn)) problems.policyEn = true;
  return problems;
}

/** The branch is not required to save while the switch is off and nothing was chosen yet (it is required to turn on). */
export function validateForSave(
  draft: OnlineSalesDraft,
  settings: OnlineSalesSettingsResponse,
): Partial<Record<OnlineSalesField, true>> {
  const problems = validateDraft(draft);
  if (!settings.enabled && draft.fulfilmentBranchId === '') delete problems.fulfilmentBranchId;
  if (settings.enabled && draft.fulfilmentBranchId === '') problems.fulfilmentBranchId = true;
  return problems;
}

const policyValue = (value: string): string | null => {
  const text = value.normalize('NFC').trim();
  return text === '' ? null : text;
};

/** Whether the draft differs from the saved settings. */
export function isDirty(draft: OnlineSalesDraft, settings: OnlineSalesSettingsResponse): boolean {
  return Object.keys(changes(draft, settings)).length > 0;
}

/** Only the fields that changed, ready for the request (without the version). */
export function changes(
  draft: OnlineSalesDraft,
  settings: OnlineSalesSettingsResponse,
): Omit<OnlineSalesSettingsUpdateRequest, 'expectedVersion'> {
  const patch: Omit<OnlineSalesSettingsUpdateRequest, 'expectedVersion'> = {};
  const branch = draft.fulfilmentBranchId === '' ? null : draft.fulfilmentBranchId;
  if (branch !== settings.fulfilmentBranchId) patch.fulfilmentBranchId = branch;
  for (const field of NUMBER_FIELDS) {
    const value = whole(draft[field]);
    if (value !== null && value !== settings[field]) patch[field] = value;
  }
  if (draft.shippingFeeEnabled !== settings.shippingFeeEnabled) {
    patch.shippingFeeEnabled = draft.shippingFeeEnabled;
  }
  if (draft.shippingFeeVnd !== null && String(draft.shippingFeeVnd) !== settings.shippingFeeVnd) {
    patch.shippingFeeVnd = String(draft.shippingFeeVnd);
  }
  const threshold =
    draft.freeShippingThresholdVnd === null ? null : String(draft.freeShippingThresholdVnd);
  if (threshold !== settings.freeShippingThresholdVnd) patch.freeShippingThresholdVnd = threshold;
  const policyVi = policyValue(draft.policyVi);
  if (policyVi !== settings.policyVi) patch.policyVi = policyVi;
  const policyEn = policyValue(draft.policyEn);
  if (policyEn !== settings.policyEn) patch.policyEn = policyEn;
  return patch;
}

export function editRequest(
  draft: OnlineSalesDraft,
  settings: OnlineSalesSettingsResponse,
): OnlineSalesSettingsUpdateRequest {
  return { expectedVersion: settings.rowVersion, ...changes(draft, settings) };
}

/** The master switch changes by itself: nothing else is sent with it. */
export function switchRequest(
  settings: Pick<OnlineSalesSettingsResponse, 'rowVersion'>,
  enabled: boolean,
): OnlineSalesSettingsUpdateRequest {
  return { expectedVersion: settings.rowVersion, enabled };
}

/** Why the switch cannot be turned on yet, in the order the page explains them; null when it can. */
export function cannotEnable(
  settings: OnlineSalesSettingsResponse,
  dirty: boolean,
): 'PAYMENT' | 'BRANCH' | 'DIRTY' | null {
  if (!settings.paymentConfigured) return 'PAYMENT';
  if (settings.fulfilmentBranchId === null) return 'BRANCH';
  if (dirty) return 'DIRTY';
  return null;
}

/** The field a refused save names, when it is one of the form's. */
export function serverProblem(error: unknown): OnlineSalesField | null {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED' || !error.field) {
    return null;
  }
  const fields: readonly string[] = [
    ...NUMBER_FIELDS,
    'fulfilmentBranchId',
    'shippingFeeVnd',
    'freeShippingThresholdVnd',
    'policyVi',
    'policyEn',
  ];
  return fields.includes(error.field) ? (error.field as OnlineSalesField) : null;
}

/** The words for a failed command: this page's own text for its codes, else the general text. */
export function onlineSalesErrorMessage(
  error: unknown,
  text: Pick<OnlineSalesText, 'errors'>,
  general: (error: unknown) => string,
): string {
  const known = text.errors as Record<string, string>;
  if (error instanceof ApiError && Object.hasOwn(known, error.code)) return known[error.code] ?? '';
  return general(error);
}

/** The default draft of the policy as customers read it, with the numbers of the form (the saved ones while a number is not valid). */
export function defaultPolicy(
  locale: 'vi' | 'en',
  draft: OnlineSalesDraft,
  settings: OnlineSalesSettingsResponse,
): string {
  const number = (field: NumberField) => whole(draft[field]) ?? settings[field];
  return onlinePolicyDefault(locale, {
    unpaidTimeoutMinutes: number('unpaidTimeoutMinutes'),
    shipWithinWorkingDays: number('shipWithinWorkingDays'),
    transitDaysMin: number('transitDaysMin'),
    transitDaysMax: number('transitDaysMax'),
  });
}
