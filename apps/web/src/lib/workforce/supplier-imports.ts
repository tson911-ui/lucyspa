import type {
  CandidateBlocker,
  CandidateState,
  CandidateWarningItem,
  SupplierCandidateDetail,
  SupplierCandidateEditRequest,
} from '@lucy-spa/contracts';
import { OPEN_CANDIDATE_STATES } from '@lucy-spa/contracts';
import { supplierImportsDictionary } from '../../i18n/supplier-imports';
import type { Locale } from '../../i18n/locales';
import { ApiError, type Query } from './api';

/**
 * Phase 9 P9-6: the pure side of the supplier import review. The server is the authority for every rule (blockers, SKU shape, prices);
 * these functions only keep an obviously wrong form from being sent, build the list query and give each fact a sentence.
 */

/** Exactly Lucy's SKU shape (`product_variants_sku`): nothing is upper-cased or repaired for the person. */
export const LUCY_SKU = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

export type ImportListState = {
  /** `OPEN` or one state. */
  filter: string;
  warning: string;
  page: number;
  /** The candidate open in the review drawer (a link to it can be shared); empty when none. */
  review: string;
};

/** The order warnings are shown in a row: what blocks an approval first, the routine gaps last. */
const WARNING_ORDER = [
  'NAME_MISSING',
  'SKU_COLLISION',
  'SKU_DUPLICATE_CANDIDATE',
  'SKU_FORMAT',
  'SKU_MISSING',
  'IMAGE_SHARED',
  'POSSIBLE_DUPLICATE',
  'IMAGE_FAILED',
  'IMAGE_MISSING',
];

export function sortWarnings(codes: readonly string[]): string[] {
  const rank = (code: string) => {
    const index = WARNING_ORDER.indexOf(code);
    return index < 0 ? WARNING_ORDER.length : index;
  };
  return [...codes].sort((a, b) => rank(a) - rank(b));
}

export const IMPORT_LIST_DEFAULTS: ImportListState = {
  filter: 'OPEN',
  warning: '',
  page: 1,
  review: '',
};
/** The keys that go back to their default when a filter changes: the page and the open candidate. */
export const IMPORT_PAGE_KEYS = ['page', 'review'] as const;

const FILTERS = [
  'OPEN',
  'READY_FOR_REVIEW',
  'NEEDS_REVIEW',
  'IMPORTED',
  'REJECTED',
  'IGNORED',
] as const;
export const IMPORT_FILTERS = FILTERS;

export function normalizeImportList(state: ImportListState): ImportListState {
  return {
    filter: (FILTERS as readonly string[]).includes(state.filter) ? state.filter : 'OPEN',
    warning: /^[A-Z_]{3,40}$/.test(state.warning) ? state.warning : '',
    page: Number.isSafeInteger(state.page) && state.page >= 1 ? state.page : 1,
    review: /^[0-9a-f-]{36}$/.test(state.review) ? state.review : '',
  };
}

export function importListQuery(state: ImportListState): Query {
  const query: Query = { page: state.page, state: state.filter };
  if (state.warning !== '') query['warning'] = state.warning;
  return query;
}

/** The warnings a person can filter by (the codes the evaluation writes). */
export const IMPORT_WARNING_FILTERS = [
  'BRAND_UNMAPPED',
  'CATEGORY_UNMAPPED',
  'SKU_MISSING',
  'SKU_FORMAT',
  'SKU_COLLISION',
  'SKU_DUPLICATE_CANDIDATE',
  'POSSIBLE_DUPLICATE',
  'IMAGE_SHARED',
  'IMAGE_MISSING',
  'IMAGE_FAILED',
  'DESCRIPTION_EMPTY',
  'PRICE_MISSING',
] as const;

export type StateTone = 'success' | 'warning' | 'neutral' | 'error' | 'info';

export function stateTone(state: CandidateState): StateTone {
  if (state === 'READY_FOR_REVIEW') return 'success';
  if (state === 'IMPORTED' || state === 'APPROVED') return 'info';
  if (state === 'NEEDS_REVIEW') return 'warning';
  if (state === 'REJECTED') return 'error';
  return 'neutral';
}

/** The states a reviewer can still act on. */
export const isOpen = (state: CandidateState): boolean =>
  (OPEN_CANDIDATE_STATES as readonly string[]).includes(state);

// ------------------------------------------------------------------------------------------------------------- the form

export interface ReviewDraft {
  nameVi: string;
  nameEn: string;
  needsTranslation: boolean;
  descriptionVi: string;
  brandId: string;
  categoryId: string;
  proposedSku: string;
  listPriceVnd: string;
}

export const draftOf = (item: SupplierCandidateDetail): ReviewDraft => ({
  nameVi: item.nameVi,
  nameEn: item.nameEn,
  needsTranslation: item.needsTranslation,
  descriptionVi: item.descriptionVi ?? '',
  brandId: item.brandId ?? '',
  categoryId: item.categoryId ?? '',
  proposedSku: item.proposedSku ?? '',
  listPriceVnd: '',
});

export type ReviewProblems = Partial<
  Record<'nameVi' | 'nameEn' | 'proposedSku' | 'listPriceVnd', true>
>;

export function validateDraft(draft: ReviewDraft): ReviewProblems {
  const problems: ReviewProblems = {};
  if (draft.nameVi.trim() === '' || [...draft.nameVi].length > 500) problems.nameVi = true;
  if (draft.nameEn.trim() === '' || [...draft.nameEn].length > 500) problems.nameEn = true;
  const sku = draft.proposedSku;
  if (sku !== '' && !LUCY_SKU.test(sku)) problems.proposedSku = true;
  if (draft.listPriceVnd.trim() !== '' && !/^[1-9][0-9]{0,15}$/.test(draft.listPriceVnd.trim())) {
    problems.listPriceVnd = true;
  }
  return problems;
}

/** Only what changed (the price is not part of an edit: it goes with the approval); `null` when nothing changed. */
export function editRequest(
  draft: ReviewDraft,
  item: SupplierCandidateDetail,
): SupplierCandidateEditRequest | null {
  const body: SupplierCandidateEditRequest = { expectedVersion: item.rowVersion };
  let changed = false;
  const nameVi = draft.nameVi.trim();
  if (nameVi !== item.nameVi) {
    body.nameVi = nameVi;
    changed = true;
  }
  const nameEn = draft.nameEn.trim();
  if (nameEn !== item.nameEn) {
    body.nameEn = nameEn;
    changed = true;
  }
  if (draft.needsTranslation !== item.needsTranslation) {
    body.needsTranslation = draft.needsTranslation;
    changed = true;
  }
  const description = draft.descriptionVi.trim();
  if (description !== (item.descriptionVi ?? '')) {
    body.descriptionVi = description === '' ? null : description;
    changed = true;
  }
  if (draft.brandId !== (item.brandId ?? '')) {
    body.brandId = draft.brandId === '' ? null : draft.brandId;
    changed = true;
  }
  if (draft.categoryId !== (item.categoryId ?? '')) {
    body.categoryId = draft.categoryId === '' ? null : draft.categoryId;
    changed = true;
  }
  if (draft.proposedSku !== (item.proposedSku ?? '')) {
    body.proposedSku = draft.proposedSku === '' ? null : draft.proposedSku;
    changed = true;
  }
  return changed ? body : null;
}

// ------------------------------------------------------------------------------------------------------ warnings and text

export const warningText = (code: string, locale: Locale): string => {
  const known = supplierImportsDictionary(locale).warnings as Record<string, string>;
  return Object.hasOwn(known, code) ? (known[code] as string) : code;
};

export const blockerText = (blocker: CandidateBlocker, locale: Locale): string =>
  supplierImportsDictionary(locale).blockers[blocker];

/** A text field of a warning, or '' (the payloads are the evaluation's own facts, never page content). */
export const warningField = (warning: CandidateWarningItem, key: string): string => {
  const value = warning[key];
  return typeof value === 'string' ? value : '';
};

export interface DuplicateMatch {
  ref: string;
  kind: 'PRODUCT' | 'CANDIDATE';
  name: string;
}

/** The look-alikes a POSSIBLE_DUPLICATE warning names, each with the reference "keep separate" needs. */
export function duplicateMatches(item: SupplierCandidateDetail): DuplicateMatch[] {
  const warning = item.warnings.find((entry) => entry.code === 'POSSIBLE_DUPLICATE');
  const matches = Array.isArray(warning?.['matches']) ? (warning['matches'] as unknown[]) : [];
  const out: DuplicateMatch[] = [];
  for (const entry of matches) {
    if (typeof entry !== 'object' || entry === null) continue;
    const match = entry as Record<string, unknown>;
    const name = typeof match['name'] === 'string' ? match['name'] : '';
    if (match['kind'] === 'PRODUCT' && typeof match['productId'] === 'string') {
      out.push({ ref: `PRODUCT:${match['productId']}`, kind: 'PRODUCT', name });
    } else if (match['kind'] === 'CANDIDATE' && typeof match['candidateId'] === 'string') {
      out.push({ ref: `CANDIDATE:${match['candidateId']}`, kind: 'CANDIDATE', name });
    }
  }
  return out;
}

/** The source texts a brand or category mapping can be made for: the ones the warning lists (else the source's own categories). */
export function mappingTexts(item: SupplierCandidateDetail, kind: 'BRAND' | 'CATEGORY'): string[] {
  const warning = item.warnings.find(
    (entry) => entry.code === (kind === 'BRAND' ? 'BRAND_UNMAPPED' : 'CATEGORY_UNMAPPED'),
  );
  const texts = Array.isArray(warning?.['texts']) ? (warning['texts'] as unknown[]) : [];
  const listed = texts.filter((text): text is string => typeof text === 'string');
  if (listed.length > 0) return listed;
  return kind === 'BRAND' ? item.source.categoryNames : [];
}

export function suggestionFor(
  item: SupplierCandidateDetail,
  kind: 'BRAND' | 'CATEGORY',
): string | null {
  const warning = item.warnings.find(
    (entry) => entry.code === (kind === 'BRAND' ? 'BRAND_UNMAPPED' : 'CATEGORY_UNMAPPED'),
  );
  const suggestions = Array.isArray(warning?.['suggestions'])
    ? (warning['suggestions'] as unknown[])
    : [];
  const first = suggestions[0];
  return typeof first === 'object' &&
    first !== null &&
    typeof (first as Record<string, unknown>)['id'] === 'string'
    ? ((first as Record<string, unknown>)['id'] as string)
    : null;
}

/** This area's own words for a refused command; anything else falls back to the caller's message. */
export function importErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const dictionary = supplierImportsDictionary(locale);
    if (error.code === 'CANDIDATE_BLOCKED' && error.field) {
      const reason = (dictionary.blockers as Record<string, string>)[error.field];
      if (reason) return `${dictionary.errors.CANDIDATE_BLOCKED} ${reason}`;
    }
    const known = dictionary.errors as Record<string, string>;
    const text = Object.hasOwn(known, error.code) ? known[error.code] : undefined;
    if (text) return text;
  }
  return fallback(error);
}

export const isImportConflict = (error: unknown): boolean =>
  error instanceof ApiError && (error.code === 'CONFLICT' || error.code === 'CANDIDATE_DECIDED');

export function pictureUrl(
  candidateId: string,
  imageId: string,
  variant: 'thumb' | 'md' | 'lg',
): string {
  return `/api/v1/supplier-imports/candidates/${candidateId}/images/${imageId}/${variant}`;
}
