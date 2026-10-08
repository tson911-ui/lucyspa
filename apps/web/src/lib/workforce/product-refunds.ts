import {
  PRODUCT_REFUND_REASON_MAX,
  PRODUCT_REFUND_REFERENCE,
  productRefundAmount,
  type ProductRefundMethodName,
  type ProductRefundRequest,
  type ProductRefundResponse,
  type ProductRefundRestockName,
  type ProductRefundSummaryResponse,
} from '@lucy-spa/contracts';
import { ApiError } from './api';
import type { Locale } from '../../i18n/locales';
import { productRefundsDictionary } from '../../i18n/product-refunds';

/**
 * Phase 6 P6-13: the refund screens' pure logic (the draft, its checks, the request and the amount shown before the person confirms).
 * Nothing here decides authority or money: the summary comes from the API and only decides what the screen offers; the API authorizes,
 * checks the password confirmation and computes the amount again on every request.
 */

export const REFUND_METHODS: readonly ProductRefundMethodName[] = ['CASH', 'BANK_TRANSFER_MANUAL'];
export const REFUND_RESTOCKS: readonly ProductRefundRestockName[] = ['SELLABLE', 'NOT_SELLABLE'];
export { PRODUCT_REFUND_REASON_MAX as REFUND_REASON_MAX };

export interface RefundDraft {
  quantity: string;
  method: ProductRefundMethodName;
  bankReference: string;
  /** Empty until the person decides: the refunding person always states whether the goods can be sold again (OQ-80). */
  restock: ProductRefundRestockName | '';
  reason: string;
}

export const emptyRefundDraft = (): RefundDraft => ({
  quantity: '1',
  method: 'CASH',
  bankReference: '',
  restock: '',
  reason: '',
});

export type RefundIssue = 'required' | 'invalid';
export type RefundDraftErrors = Partial<
  Record<'quantity' | 'bankReference' | 'restock' | 'reason', RefundIssue>
>;

const wholeNumber = (text: string): number | null =>
  /^[0-9]{1,7}$/.test(text.trim()) ? Number(text.trim()) : null;

export function validateRefundDraft(
  draft: RefundDraft,
  summary: Pick<ProductRefundSummaryResponse, 'caseRemainingQuantity'>,
): RefundDraftErrors {
  const errors: RefundDraftErrors = {};
  const quantity = wholeNumber(draft.quantity);
  if (draft.quantity.trim() === '') errors.quantity = 'required';
  else if (quantity === null || quantity < 1 || quantity > summary.caseRemainingQuantity) {
    errors.quantity = 'invalid';
  }
  if (draft.method === 'BANK_TRANSFER_MANUAL') {
    const reference = draft.bankReference.normalize('NFC').trim();
    if (reference === '') errors.bankReference = 'required';
    else if (!PRODUCT_REFUND_REFERENCE.test(reference)) errors.bankReference = 'invalid';
  }
  if (draft.restock === '') errors.restock = 'required';
  const reason = draft.reason.normalize('NFC').trim();
  if (reason === '') errors.reason = 'required';
  else if ([...reason].length > PRODUCT_REFUND_REASON_MAX) errors.reason = 'invalid';
  return errors;
}

export const refundDraftValid = (errors: RefundDraftErrors): boolean =>
  Object.keys(errors).length === 0;

/** The request to refund, or `null` while the draft is not valid. Cash carries no reference; the request carries no amount at all. */
export function refundRequest(
  draft: RefundDraft,
  summary: Pick<ProductRefundSummaryResponse, 'caseRemainingQuantity'>,
  clientRequestId: string,
): ProductRefundRequest | null {
  if (draft.restock === '' || !refundDraftValid(validateRefundDraft(draft, summary))) return null;
  return {
    quantity: wholeNumber(draft.quantity)!,
    method: draft.method,
    bankReference:
      draft.method === 'BANK_TRANSFER_MANUAL' ? draft.bankReference.normalize('NFC').trim() : null,
    restock: draft.restock,
    reason: draft.reason.normalize('NFC').trim(),
    clientRequestId,
  };
}

/**
 * What the units about to be refunded come to, by the same rule as the API and the database (the line's net share, cumulative
 * rounding), or `null` when it cannot be shown (no recorded net, or a quantity that is not valid). It is only shown; the API computes it.
 */
export function refundPreview(
  summary: Pick<
    ProductRefundSummaryResponse,
    'lineNetVnd' | 'soldQuantity' | 'lineClaimedQuantity' | 'caseRemainingQuantity'
  >,
  quantityText: string,
): string | null {
  const quantity = wholeNumber(quantityText);
  if (
    summary.lineNetVnd === null ||
    quantity === null ||
    quantity < 1 ||
    quantity > summary.caseRemainingQuantity ||
    summary.lineClaimedQuantity + quantity > summary.soldQuantity
  ) {
    return null;
  }
  return productRefundAmount(
    BigInt(summary.lineNetVnd),
    summary.soldQuantity,
    summary.lineClaimedQuantity,
    quantity,
  ).toString();
}

/** The transfer refunds whose reference can still be corrected (newest last), for the correction form. */
export const transferRefunds = (summary: Pick<ProductRefundSummaryResponse, 'refunds'>) =>
  summary.refunds.filter(
    (refund: ProductRefundResponse) => refund.method === 'BANK_TRANSFER_MANUAL',
  );

/** The text of a failed refund command: its own texts first, then the shared ones. */
export function refundErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const texts = productRefundsDictionary(locale).errors;
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

export const isRefundConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'CONFLICT' && error.field === null;
