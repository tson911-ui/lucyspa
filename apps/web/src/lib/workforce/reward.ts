import type {
  BranchSummary,
  CurrentAccountResponse,
  RewardCatalogCreateRequest,
  RewardCatalogEditRequest,
  RewardCatalogItemResponse,
  RewardEntitlementStatus,
  RewardIssueRequest,
  RewardKindName,
} from '@lucy-spa/contracts';
import { REWARD_MAX_EXPIRY_DAYS, REWARD_MAX_QUANTITY } from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { rewardDictionary } from '../../i18n/reward';
import { fill } from '../../i18n/workforce';
import { ApiError } from './api';
import { canAt } from './permissions';

/**
 * Phase 5 P5-9: the form state of the reward catalog and of a grant, and its conversion to the request. Nothing is preset: a new
 * item starts empty (the Owner chooses the kind, the names and the validity). The server validates every value again.
 */

const MAX_NAME = 120;
export const REWARD_KINDS: readonly RewardKindName[] = ['FREE_SERVICE', 'VOUCHER', 'PRODUCT_GIFT'];

export interface RewardItemDraft {
  kind: RewardKindName | '';
  serviceId: string;
  /** The product variant a gift takes out of stock; empty means none. */
  variantId: string;
  nameVi: string;
  nameEn: string;
  /** `never` = no expiry, `days` = a number of days after the grant. */
  expiry: 'never' | 'days';
  /** Text as typed. */
  days: string;
  active: boolean;
}

export type RewardItemField = 'kind' | 'serviceId' | 'nameVi' | 'nameEn' | 'days';
export type RewardIssue = 'required' | 'invalid';
export type RewardItemErrors = Partial<Record<RewardItemField, RewardIssue>>;

export const emptyItemDraft = (): RewardItemDraft => ({
  kind: '',
  serviceId: '',
  variantId: '',
  nameVi: '',
  nameEn: '',
  expiry: 'never',
  days: '',
  active: true,
});

/** Editing starts from the saved item (the kind and the service are fixed once it exists). */
export function draftFromItem(item: RewardCatalogItemResponse): RewardItemDraft {
  return {
    kind: item.kind,
    serviceId: item.service?.id ?? '',
    variantId: item.variant?.id ?? '',
    nameVi: item.nameVi,
    nameEn: item.nameEn,
    expiry: item.expiryDays === null ? 'never' : 'days',
    days: item.expiryDays === null ? '' : String(item.expiryDays),
    active: item.active,
  };
}

const nameProblem = (text: string): RewardIssue | undefined => {
  const trimmed = text.normalize('NFC').trim();
  if (!trimmed) return 'required';
  return [...trimmed].length > MAX_NAME ? 'invalid' : undefined;
};

const wholeDays = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^[0-9]{1,4}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= REWARD_MAX_EXPIRY_DAYS ? value : null;
};

export function validateItemDraft(draft: RewardItemDraft, editing: boolean): RewardItemErrors {
  const errors: RewardItemErrors = {};
  if (!editing) {
    if (!draft.kind) errors.kind = 'required';
    else if (draft.kind === 'FREE_SERVICE' && !draft.serviceId) errors.serviceId = 'required';
  }
  const nameVi = nameProblem(draft.nameVi);
  if (nameVi) errors.nameVi = nameVi;
  const nameEn = nameProblem(draft.nameEn);
  if (nameEn) errors.nameEn = nameEn;
  if (draft.expiry === 'days') {
    if (!draft.days.trim()) errors.days = 'required';
    else if (wholeDays(draft.days) === null) errors.days = 'invalid';
  }
  return errors;
}

function valuesOf(draft: RewardItemDraft, editing: boolean) {
  if (Object.keys(validateItemDraft(draft, editing)).length > 0) return null;
  return {
    nameVi: draft.nameVi.normalize('NFC').trim(),
    nameEn: draft.nameEn.normalize('NFC').trim(),
    active: draft.active,
    expiryDays: draft.expiry === 'days' ? wholeDays(draft.days) : null,
  };
}

export function createItemRequest(draft: RewardItemDraft): RewardCatalogCreateRequest | null {
  const values = valuesOf(draft, false);
  if (!values || !draft.kind) return null;
  return {
    kind: draft.kind,
    serviceId: draft.kind === 'FREE_SERVICE' ? draft.serviceId : null,
    ...(draft.kind === 'PRODUCT_GIFT' && draft.variantId ? { variantId: draft.variantId } : {}),
    ...values,
  };
}

export function editItemRequest(
  draft: RewardItemDraft,
  expectedRowVersion: number,
  item?: Pick<RewardCatalogItemResponse, 'kind' | 'variant'>,
): RewardCatalogEditRequest | null {
  const values = valuesOf(draft, true);
  if (!values) return null;
  // The stock link is sent only when it changed (an absent key keeps it; the server refuses a change once a unit was used).
  const relink =
    item?.kind === 'PRODUCT_GIFT' && draft.variantId !== (item.variant?.id ?? '')
      ? { variantId: draft.variantId === '' ? null : draft.variantId }
      : {};
  return { expectedRowVersion, ...relink, ...values };
}

export const rewardName = (item: { nameVi: string; nameEn: string }, locale: Locale): string =>
  locale === 'vi' ? item.nameVi : item.nameEn;

/** "30 ngày kể từ ngày tặng" or "Không hết hạn". */
export function expiryText(expiryDays: number | null, locale: Locale): string {
  const r = rewardDictionary(locale).catalog;
  return expiryDays === null ? r.noExpiry : fill(r.expiryDays, { n: expiryDays });
}

export function statusTone(
  status: RewardEntitlementStatus,
): 'success' | 'neutral' | 'warning' | 'error' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'USED_UP') return 'neutral';
  return status === 'EXPIRED' ? 'warning' : 'error';
}

// ----------------------------------------------------------------------------------------------------------- a grant

export interface IssueDraft {
  catalogItemId: string;
  /** Text as typed. */
  quantity: string;
  reason: string;
}

export type IssueErrors = Partial<Record<'catalogItemId' | 'quantity' | 'reason', RewardIssue>>;

export const emptyIssueDraft = (): IssueDraft => ({ catalogItemId: '', quantity: '1', reason: '' });

const wholeQuantity = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^[0-9]{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= REWARD_MAX_QUANTITY ? value : null;
};

export function validateIssueDraft(draft: IssueDraft): IssueErrors {
  const errors: IssueErrors = {};
  if (!draft.catalogItemId) errors.catalogItemId = 'required';
  if (!draft.quantity.trim()) errors.quantity = 'required';
  else if (wholeQuantity(draft.quantity) === null) errors.quantity = 'invalid';
  const reason = draft.reason.normalize('NFC').trim();
  if (!reason) errors.reason = 'required';
  else if ([...reason].length > 500) errors.reason = 'invalid';
  return errors;
}

export function issueRequest(draft: IssueDraft): RewardIssueRequest | null {
  if (Object.keys(validateIssueDraft(draft)).length > 0) return null;
  return {
    catalogItemId: draft.catalogItemId,
    quantity: wholeQuantity(draft.quantity)!,
    reason: draft.reason.normalize('NFC').trim(),
  };
}

// ---------------------------------------------------------------------------------------------------------- access

/** Branches where this account may grant and use rewards (the API decides again on every call). */
export function rewardBranches(
  account: CurrentAccountResponse,
  branches: ReadonlyMap<string, BranchSummary> | null,
): BranchSummary[] {
  return [...(branches?.values() ?? [])]
    .filter((branch) => branch.isActive && canAt(account, 'ISSUE_REWARDS', branch.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/** The error text of a reward command: its own texts first, then the shared messages. */
export function rewardErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  const texts = rewardDictionary(locale).errors as Record<string, string>;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return fallback(error);
}
