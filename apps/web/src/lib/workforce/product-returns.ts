import type {
  ProductReturnCaseResponse,
  ProductReturnLookupLine,
  ProductReturnOpenRequest,
  ProductReturnOutcomeName,
  ProductReturnPhotoVariantName,
  ProductReturnReasonName,
  ProductReturnStatusName,
} from '@lucy-spa/contracts';
import { precheckFile } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { productReturnsDictionary } from '../../i18n/product-returns';
import { ApiError } from './api';
import { normalizePage } from './list-view';

/**
 * Phase 6 P6-12: the product return screens' pure logic (list state, the new-case draft and its request, display rules). Nothing
 * here decides authority: the context and the case come from the API and only decide what a screen offers; the API authorizes and
 * checks the windows again on every request.
 */

export const RETURN_STATUSES: readonly ProductReturnStatusName[] = [
  'OPEN',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
];
export const RETURN_REASONS: readonly ProductReturnReasonName[] = [
  'PERSONAL_PREFERENCE',
  'WRONG_OR_DAMAGED',
  'SKIN_IRRITATION',
];
export const RETURN_OUTCOMES: readonly ProductReturnOutcomeName[] = ['EXCHANGE', 'REFUND'];

export const RETURN_NOTE_MAX = 1000;
export const RETURN_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const RETURN_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

// ----------------------------------------------------------------------------------------------------- list state

export type ReturnListState = {
  branch: string;
  q: string;
  status: string;
  reason: string;
  page: number;
};

export const RETURN_LIST_DEFAULTS: ReturnListState = {
  branch: '',
  q: '',
  status: '',
  reason: '',
  page: 1,
};

export function normalizeReturnList(state: ReturnListState): ReturnListState {
  return {
    branch: state.branch.slice(0, 64),
    q: state.q.slice(0, 100),
    status: (RETURN_STATUSES as readonly string[]).includes(state.status) ? state.status : '',
    reason: (RETURN_REASONS as readonly string[]).includes(state.reason) ? state.reason : '',
    page: normalizePage(state.page),
  };
}

/** Changing a filter or the branch starts again at the first page. */
export const RETURN_PAGE_KEYS = ['branch', 'q', 'status', 'reason'] as const;

export function returnStatusTone(
  status: ProductReturnStatusName,
): 'info' | 'success' | 'error' | 'neutral' {
  if (status === 'ACCEPTED') return 'success';
  if (status === 'DECLINED') return 'error';
  if (status === 'CANCELLED') return 'neutral';
  return 'info';
}

// ------------------------------------------------------------------------------------------- the new-case draft

export interface ReturnDraft {
  invoiceCode: string;
  lineId: string;
  reason: ProductReturnReasonName | '';
  outcome: ProductReturnOutcomeName;
  quantity: string;
  seal: boolean;
  notes: string;
  /** The Owner's written reason for taking a product back after its window (P6-12 follow-up); empty otherwise. */
  exceptionReason: string;
}

export const emptyReturnDraft = (): ReturnDraft => ({
  invoiceCode: '',
  lineId: '',
  reason: '',
  outcome: 'EXCHANGE',
  quantity: '1',
  seal: false,
  notes: '',
  exceptionReason: '',
});

export type DraftIssue = 'required' | 'invalid';
export type ReturnDraftErrors = Partial<
  Record<'line' | 'reason' | 'quantity' | 'seal' | 'notes' | 'exception', DraftIssue>
>;

/** Whether a reason is still open for a line (its window has not ended) and a unit is left to return. */
export const reasonOpen = (
  line: ProductReturnLookupLine,
  reason: ProductReturnReasonName,
): boolean => line.availableQuantity > 0 && line.reasons[reason].open;

/** Whether the window of a reason is over for a line that still has units to return (only the Owner may go on, with a reason). */
export const reasonPastWindow = (
  line: ProductReturnLookupLine,
  reason: ProductReturnReasonName,
): boolean => line.availableQuantity > 0 && !line.reasons[reason].open;

const wholeNumber = (text: string): number | null =>
  /^[0-9]{1,7}$/.test(text.trim()) ? Number(text.trim()) : null;

/**
 * `canException` is true for the Owner only (the context says so): a reason whose window is over can then still be chosen, with a
 * written reason. Everyone else gets the same refusal as before. The API decides again.
 */
export function validateReturnDraft(
  draft: ReturnDraft,
  line: ProductReturnLookupLine | null,
  canException = false,
): ReturnDraftErrors {
  const errors: ReturnDraftErrors = {};
  if (!line) errors.line = 'required';
  if (draft.reason === '') errors.reason = 'required';
  else if (line && !reasonOpen(line, draft.reason)) {
    if (canException && reasonPastWindow(line, draft.reason)) {
      const reason = draft.exceptionReason.normalize('NFC').trim();
      if (reason === '') errors.exception = 'required';
      else if ([...reason].length > RETURN_NOTE_MAX) errors.exception = 'invalid';
    } else {
      errors.reason = 'invalid';
    }
  }
  const quantity = wholeNumber(draft.quantity);
  if (draft.quantity.trim() === '') errors.quantity = 'required';
  else if (quantity === null || quantity < 1 || (line && quantity > line.availableQuantity)) {
    errors.quantity = 'invalid';
  }
  if (draft.reason === 'PERSONAL_PREFERENCE' && !draft.seal) errors.seal = 'invalid';
  if ([...draft.notes.trim()].length > RETURN_NOTE_MAX) errors.notes = 'invalid';
  return errors;
}

export const returnDraftValid = (errors: ReturnDraftErrors): boolean =>
  Object.keys(errors).length === 0;

/** The request to open a case, or `null` while the draft is not valid. The seal is recorded as the counter checked it. */
export function returnOpenRequest(
  draft: ReturnDraft,
  line: ProductReturnLookupLine | null,
  branchId: string,
  clientRequestId: string,
  canException = false,
): ProductReturnOpenRequest | null {
  if (
    !line ||
    draft.reason === '' ||
    !returnDraftValid(validateReturnDraft(draft, line, canException))
  ) {
    return null;
  }
  const notes = draft.notes.normalize('NFC').trim();
  const exception =
    canException && reasonPastWindow(line, draft.reason)
      ? draft.exceptionReason.normalize('NFC').trim()
      : null;
  return {
    ...(exception ? { windowExceptionReason: exception } : {}),
    branchId,
    invoiceLineId: line.lineId,
    reason: draft.reason,
    requestedOutcome: draft.outcome,
    quantity: wholeNumber(draft.quantity)!,
    sealIntact: draft.reason === 'SKIN_IRRITATION' ? null : draft.seal,
    notes: notes === '' ? null : notes,
    clientRequestId,
  };
}

// -------------------------------------------------------------------------------------------------- case display

/** "Kem dưỡng · 50 ml": the product of a line in the reader's language, with its variant when it has one. */
export function returnProductName(
  product: {
    productNameVi: string;
    productNameEn: string;
    variantLabelVi: string | null;
    variantLabelEn: string | null;
  },
  locale: Locale,
): string {
  const name = locale === 'en' ? product.productNameEn : product.productNameVi;
  const label = locale === 'en' ? product.variantLabelEn : product.variantLabelVi;
  return label ? `${name} · ${label}` : name;
}

/** True when a wrong or damaged case still lacks a photo that counts: one present and taken before the window ended. */
export function needsQualifyingPhoto(
  c: Pick<ProductReturnCaseResponse, 'reason' | 'status' | 'windowEndsAt' | 'photos'> &
    Partial<Pick<ProductReturnCaseResponse, 'windowException'>>,
): boolean {
  if (c.reason !== 'WRONG_OR_DAMAGED' || c.status !== 'OPEN' || c.windowEndsAt === null)
    return false;
  // A case the Owner opened after its window accepts any photo that is still present.
  if (c.windowException) return !c.photos.some((photo) => photo.removedAt === null);
  const end = Date.parse(c.windowEndsAt);
  return !c.photos.some((photo) => photo.removedAt === null && Date.parse(photo.uploadedAt) <= end);
}

export const presentPhotos = (c: Pick<ProductReturnCaseResponse, 'photos'>) =>
  c.photos.filter((photo) => photo.removedAt === null);

export const removedPhotoCount = (c: Pick<ProductReturnCaseResponse, 'photos'>): number =>
  c.photos.filter((photo) => photo.removedAt !== null).length;

export const returnPhotoUrl = (
  caseId: string,
  photoId: string,
  variant: ProductReturnPhotoVariantName,
): string => `/api/v1/product-returns/cases/${caseId}/photos/${photoId}/${variant}`;

/** The browser-side check that saves a round trip; the server decides. */
export function precheckReturnPhoto(file: { type: string; size: number }): 'type' | 'size' | null {
  const problem = precheckFile(file, {
    accept: RETURN_PHOTO_TYPES,
    maxBytes: RETURN_PHOTO_MAX_BYTES,
  });
  return problem === 'type' || problem === 'size' ? problem : null;
}

/** "Ảnh lớn hơn 10 MB." for a file the browser refused. */
export function photoProblemText(problem: 'type' | 'size', locale: Locale): string {
  const errors = productReturnsDictionary(locale).errors;
  return problem === 'size' ? errors.MEDIA_TOO_LARGE : errors.MEDIA_TYPE_UNSUPPORTED;
}

// ------------------------------------------------------------------------------------------------------ errors

/**
 * The text of a failed return command: its own texts first (the P6-12 codes, the reload message after a conflict, the named field of a
 * refused value, the image refusals), then the shared ones.
 */
export function returnErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const texts = productReturnsDictionary(locale).errors;
    if (error.code === 'CONFLICT') return texts.conflict;
    if (error.code === 'VALIDATION_FAILED' && error.field) {
      const named = (texts.fields as Record<string, string>)[error.field];
      if (named) return named;
    }
    const own = (texts as Record<string, unknown>)[error.code];
    if (typeof own === 'string') return own;
  }
  return fallback(error);
}

export const isReturnConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'CONFLICT' && error.field === null;

/** A fresh id for one attempt to open a case (a repeat of the same attempt returns the case it opened). */
export function newClientRequestId(): string {
  return globalThis.crypto.randomUUID();
}
