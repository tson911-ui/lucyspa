import {
  PRODUCT_REFUND_REASON_MAX,
  PRODUCT_REFUND_REFERENCE,
  type ProductExchangeCompleteRequest,
  type ProductExchangeOption,
  type ProductExchangePreviewResponse,
  type ProductExchangeRequest,
  type ProductExchangeResponse,
  type ProductExchangeSummaryResponse,
  type ProductRefundMethodName,
  type ProductRefundRestockName,
} from '@lucy-spa/contracts';
import { ApiError } from './api';
import type { Locale } from '../../i18n/locales';
import { productExchangesDictionary } from '../../i18n/product-exchanges';
import { productTitle } from './product-sale';
import { formatVnd } from './format';

/**
 * Phase 6 P6-14: the exchange screens' pure logic (the draft, its checks, the request and the wording of the figures). Nothing here
 * decides authority or money: the preview comes from the API and only decides what the form offers and shows; the API authorizes,
 * checks the password confirmation and computes every figure again on each request (the figures sent are only the ones shown, and the
 * API refuses the request if they moved).
 */

export const EXCHANGE_METHODS: readonly ProductRefundMethodName[] = [
  'CASH',
  'BANK_TRANSFER_MANUAL',
];
export { PRODUCT_REFUND_REASON_MAX as EXCHANGE_REASON_MAX };

export interface ExchangeDraft {
  /** The chosen replacement (from the options list); null until chosen. */
  option: ProductExchangeOption | null;
  sellerUserId: string;
  refundMethod: ProductRefundMethodName;
  bankReference: string;
  /** Empty until the person decides (needed only when nothing is to be paid: the old goods are taken in at once). */
  restock: ProductRefundRestockName | '';
  reason: string;
}

export const emptyExchangeDraft = (defaultSellerUserId: string | null): ExchangeDraft => ({
  option: null,
  sellerUserId: defaultSellerUserId ?? '',
  refundMethod: 'CASH',
  bankReference: '',
  restock: '',
  reason: '',
});

/** What the form must ask for, from the figures of the preview. */
export interface ExchangeNeeds {
  /** The old goods are taken in now (nothing to pay), so the person says whether they can be sold again. */
  restock: boolean;
  /** Money is handed back, so the method (and a transfer's reference) is needed. */
  refund: boolean;
  /** The customer pays more on the exchange invoice. */
  payable: boolean;
}

export const exchangeNeeds = (
  preview: Pick<ProductExchangePreviewResponse, 'payableVnd' | 'refundVnd'> | null,
): ExchangeNeeds => ({
  restock: preview !== null && preview.payableVnd === '0',
  refund: preview !== null && preview.refundVnd !== '0',
  payable: preview !== null && preview.payableVnd !== '0',
});

export type ExchangeIssue = 'required' | 'invalid';
export type ExchangeDraftErrors = Partial<
  Record<'option' | 'stock' | 'seller' | 'bankReference' | 'restock' | 'reason', ExchangeIssue>
>;

export function validateExchangeDraft(
  draft: ExchangeDraft,
  preview: ProductExchangePreviewResponse | null,
  needSeller: boolean,
): ExchangeDraftErrors {
  const errors: ExchangeDraftErrors = {};
  if (!draft.option) errors.option = 'required';
  else if (preview && !preview.inStock) errors.stock = 'invalid';
  if (needSeller && draft.sellerUserId === '') errors.seller = 'required';
  const needs = exchangeNeeds(preview);
  if (needs.refund && draft.refundMethod === 'BANK_TRANSFER_MANUAL') {
    const reference = draft.bankReference.normalize('NFC').trim();
    if (reference === '') errors.bankReference = 'required';
    else if (!PRODUCT_REFUND_REFERENCE.test(reference)) errors.bankReference = 'invalid';
  }
  if (needs.restock && draft.restock === '') errors.restock = 'required';
  const reason = draft.reason.normalize('NFC').trim();
  if (reason === '') errors.reason = 'required';
  else if ([...reason].length > PRODUCT_REFUND_REASON_MAX) errors.reason = 'invalid';
  return errors;
}

/** The request to exchange, or `null` while the draft is not valid or the figures are not known. */
export function exchangeRequest(
  draft: ExchangeDraft,
  preview: ProductExchangePreviewResponse | null,
  needSeller: boolean,
  clientRequestId: string,
): ProductExchangeRequest | null {
  if (!draft.option || !preview) return null;
  if (Object.keys(validateExchangeDraft(draft, preview, needSeller)).length > 0) return null;
  const needs = exchangeNeeds(preview);
  return {
    variantId: draft.option.variantId,
    expectedPayableVnd: preview.payableVnd,
    expectedRefundVnd: preview.refundVnd,
    restock: needs.restock && draft.restock !== '' ? draft.restock : null,
    refundMethod: needs.refund ? draft.refundMethod : null,
    bankReference:
      needs.refund && draft.refundMethod === 'BANK_TRANSFER_MANUAL'
        ? draft.bankReference.normalize('NFC').trim()
        : null,
    sellerUserId: draft.sellerUserId === '' ? null : draft.sellerUserId,
    reason: draft.reason.normalize('NFC').trim(),
    clientRequestId,
  };
}

export const completeRequest = (
  restock: ProductRefundRestockName | '',
): ProductExchangeCompleteRequest | null => (restock === '' ? null : { restock });

/** A search result as the picker shows it: name, today's price and what is available. */
export function exchangeOptionLabel(option: ProductExchangeOption, locale: Locale): string {
  const f = productExchangesDictionary(locale).form;
  const stock =
    option.available > 0 ? f.available.replace('{count}', String(option.available)) : f.outOfStock;
  return [productTitle(option, locale), formatVnd(option.unitPriceVnd, locale), stock].join(' — ');
}

/** The exchanges that wait for their payment or for the old goods, newest last. */
export const openExchanges = (summary: Pick<ProductExchangeSummaryResponse, 'exchanges'>) =>
  summary.exchanges.filter(
    (exchange: ProductExchangeResponse) =>
      exchange.status === 'AWAITING_COMPLETION' || exchange.status === 'AWAITING_PAYMENT',
  );

/** The exchanges that waited for the old goods (the one the completion form acts on). */
export const completableExchanges = (summary: Pick<ProductExchangeSummaryResponse, 'exchanges'>) =>
  summary.exchanges.filter((exchange) => exchange.status === 'AWAITING_COMPLETION');

/** The transfer refunds of exchanges whose reference can still be corrected (newest last). */
export const transferExchanges = (summary: Pick<ProductExchangeSummaryResponse, 'exchanges'>) =>
  summary.exchanges.filter((exchange) => exchange.refund?.method === 'BANK_TRANSFER_MANUAL');

/** The text of a failed exchange command: its own texts first, then the shared ones. */
export function exchangeErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const texts = productExchangesDictionary(locale).errors;
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

/** The figures the API said moved, or a conflict: the screen reloads the latest data. */
export const isExchangeConflict = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.code === 'EXCHANGE_FIGURES_CHANGED' ||
    (error.code === 'CONFLICT' && error.field === null));
