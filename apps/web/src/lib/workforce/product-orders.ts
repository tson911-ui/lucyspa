import type {
  InvoiceResponse,
  PreOrderContactRequest,
  ProductHandoverToName,
  ProductOrderCancelCauseName,
  ProductOrderCancelRequest,
  ProductOrderHandOverRequest,
  ProductOrderLineStatusName,
  ProductOrderQueueTab,
  ProductRefundMethodName,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { productOrdersDictionary } from '../../i18n/product-orders';
import { ApiError } from './api';
import { formatDate } from './format';
import { normalizePage } from './list-view';

/**
 * Counter pre-orders (Phase 6 P6-16/P6-17), the parts that are not drawing: the tone of a status, the expected range as text, the
 * check of the customer's phone number before it is sent, the address of the ticket link and the text of a refused command. The server
 * decides every rule again; what is here only saves a round trip.
 */

export type StatusTone = 'success' | 'info' | 'warning' | 'neutral';

export function orderStatusTone(status: ProductOrderLineStatusName): StatusTone {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return 'warning';
    case 'PAID':
    case 'ORDERED':
    case 'SHIPPED':
      return 'info';
    case 'ARRIVED':
      return 'warning';
    case 'HANDED_OVER':
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
      return 'neutral';
  }
}

/** The expected range of a line as one text, or the words for "decided at payment" when there is none yet. */
export function expectedText(
  line: { expectedFrom: string | null; expectedTo: string | null },
  locale: Locale,
  words: { range: string; afterPayment: string },
): string {
  if (!line.expectedFrom || !line.expectedTo) return words.afterPayment;
  if (line.expectedFrom === line.expectedTo) return formatDate(line.expectedFrom, locale);
  return words.range
    .replace('{from}', formatDate(line.expectedFrom, locale))
    .replace('{to}', formatDate(line.expectedTo, locale));
}

/** The lead time of a variant as the add dialog and the option list say it. */
export function leadTimeText(
  words: { expected: string; expectedSame: string },
  min: number,
  max: number,
): string {
  return (min === max ? words.expectedSame : words.expected)
    .replace('{min}', String(min))
    .replace('{max}', String(max));
}

/** True when the invoice has at least one pre-order line (the finalization then asks for the customer's phone number). */
export function hasPreOrderLine(invoice: Pick<InvoiceResponse, 'productLines'>): boolean {
  return invoice.productLines.some((line) => line.fulfilmentMode === 'PRE_ORDER');
}

export type ContactProblem = 'phone';

/**
 * The contact from what was typed. The phone is checked loosely here (digits, an optional leading +, spaces and the usual
 * separators; at least 9 digits); the server normalizes it to +84... and refuses what is not a real number.
 */
export function contactBody(input: {
  phone: string;
  name: string;
}): { contact: PreOrderContactRequest } | { problem: ContactProblem } {
  const phone = input.phone.trim();
  const digits = phone.replace(/\D/g, '');
  if (!/^[0-9+ ().-]+$/.test(phone) || digits.length < 9 || digits.length > 15) {
    return { problem: 'phone' };
  }
  const name = input.name.trim().replace(/\s+/g, ' ');
  return { contact: { phone, ...(name ? { name } : {}) } };
}

/** The address the customer opens for a ticket link: the website origin, the language and the secret token. */
export function ticketUrl(origin: string, locale: Locale, token: string): string {
  return `${origin.replace(/\/+$/, '')}/${locale}/ticket/${token}`;
}

/**
 * The text of a refused pre-order command. `PRODUCT_PRE_ORDER_NOT_NEEDED` names the lines the stock already covers by id in `field`;
 * they are turned into the names the cashier sees. Everything else falls back to the caller's messages.
 */
export function preOrderErrorText(
  error: unknown,
  locale: Locale,
  invoice: Pick<InvoiceResponse, 'productLines'> | null,
  nameOf: (line: InvoiceResponse['productLines'][number]) => string,
): string | null {
  if (!(error instanceof ApiError)) return null;
  const d = productOrdersDictionary(locale).errors;
  if (error.code === 'PRODUCT_PRE_ORDER_NOT_NEEDED') {
    const ids = (error.field ?? '').split(',').filter(Boolean);
    const names = ids
      .map((id) => invoice?.productLines.find((line) => line.id === id))
      .filter((line): line is NonNullable<typeof line> => line !== undefined)
      .map(nameOf);
    return d.PRODUCT_PRE_ORDER_NOT_NEEDED.replace('{names}', names.join(', ') || '…');
  }
  if (error.code === 'PRODUCT_PRE_ORDER_NOT_ALLOWED') return d.PRODUCT_PRE_ORDER_NOT_ALLOWED;
  if (error.code === 'PRE_ORDER_CONTACT_REQUIRED') return d.PRE_ORDER_CONTACT_REQUIRED;
  return null;
}

// ------------------------------------------------------------------------------------------------- the queue (P6-17)

export const QUEUE_TABS: readonly ProductOrderQueueTab[] = [
  'TO_ORDER',
  'ORDERED',
  'ARRIVED',
  'DONE',
  'CANCELLED',
];

export type QueueListState = { branch: string; tab: string; q: string; page: number };

export const QUEUE_LIST_DEFAULTS: QueueListState = { branch: '', tab: 'TO_ORDER', q: '', page: 1 };

export function normalizeQueueList(state: QueueListState): QueueListState {
  return {
    branch: state.branch.slice(0, 64),
    tab: (QUEUE_TABS as readonly string[]).includes(state.tab) ? state.tab : 'TO_ORDER',
    q: state.q.slice(0, 80),
    page: normalizePage(state.page),
  };
}

/** Changing the branch, the tab or the search starts again at the first page. */
export const QUEUE_PAGE_KEYS = ['branch', 'tab', 'q'] as const;

export const queueTab = (value: string): ProductOrderQueueTab =>
  (QUEUE_TABS as readonly string[]).includes(value) ? (value as ProductOrderQueueTab) : 'TO_ORDER';

// ------------------------------------------------------------------------------------------------- hand over

export const HANDOVER_TARGETS: readonly ProductHandoverToName[] = ['CUSTOMER', 'REPRESENTATIVE'];

export interface HandOverDraft {
  to: ProductHandoverToName;
  representative: string;
  orderCode: string;
  last4: string;
  note: string;
}

export const emptyHandOverDraft = (): HandOverDraft => ({
  to: 'CUSTOMER',
  representative: '',
  orderCode: '',
  last4: '',
  note: '',
});

export type HandOverProblem = 'representative' | 'orderCode' | 'last4';

export function validateHandOver(draft: HandOverDraft): Partial<Record<HandOverProblem, true>> {
  const problems: Partial<Record<HandOverProblem, true>> = {};
  if (draft.to === 'REPRESENTATIVE' && draft.representative.trim() === '')
    problems.representative = true;
  if (draft.orderCode.trim() === '') problems.orderCode = true;
  if (!/^[0-9]{4}$/.test(draft.last4.trim())) problems.last4 = true;
  return problems;
}

/** The request body, or null while the draft has a problem. The server compares the code and the digits with the order. */
export function handOverRequest(
  draft: HandOverDraft,
  expectedVersion: number,
): ProductOrderHandOverRequest | null {
  if (Object.keys(validateHandOver(draft)).length > 0) return null;
  const note = draft.note.trim();
  return {
    expectedVersion,
    to: draft.to,
    representativeName: draft.to === 'REPRESENTATIVE' ? draft.representative.trim() : null,
    orderCode: draft.orderCode.trim(),
    phoneLast4: draft.last4.trim(),
    note: note === '' ? null : note,
  };
}

// ------------------------------------------------------------------------------------------------- cancel + refund

export const CANCEL_METHODS: readonly ProductRefundMethodName[] = ['CASH', 'BANK_TRANSFER_MANUAL'];

export interface CancelDraft {
  cause: Exclude<ProductOrderCancelCauseName, 'INVOICE_CANCELLED'> | '';
  note: string;
  method: ProductRefundMethodName;
  bankReference: string;
  /** Whole dong as typed; used only for a change of mind (a part of the share, the Owner or a manager decides). */
  amount: string;
}

export const emptyCancelDraft = (): CancelDraft => ({
  cause: '',
  note: '',
  method: 'CASH',
  bankReference: '',
  amount: '',
});

export type CancelProblem = 'cause' | 'note' | 'bankReference' | 'amount';

/** Whole dong from 1 up to the whole share (a string of digits without a leading zero). */
export function validAmount(amount: string, shareVnd: string): boolean {
  const text = amount.trim();
  return /^[1-9][0-9]{0,14}$/.test(text) && BigInt(text) <= BigInt(shareVnd);
}

/** `shareVnd` is the whole net share of the line; with a change of mind the amount must lie within it. */
export function validateCancel(
  draft: CancelDraft,
  shareVnd = '0',
): Partial<Record<CancelProblem, true>> {
  const problems: Partial<Record<CancelProblem, true>> = {};
  if (
    draft.cause === 'CUSTOMER_CHANGED_MIND' &&
    shareVnd !== '0' &&
    !validAmount(draft.amount, shareVnd)
  ) {
    problems.amount = true;
  }
  if (draft.cause === '') problems.cause = true;
  if (draft.note.trim() === '') problems.note = true;
  const reference = draft.bankReference.trim();
  if (draft.method === 'BANK_TRANSFER_MANUAL' && (reference === '' || [...reference].length > 64)) {
    problems.bankReference = true;
  }
  return problems;
}

export function cancelRequest(
  draft: CancelDraft,
  expectedVersion: number,
  clientRequestId: string,
  shareVnd = '0',
): ProductOrderCancelRequest | null {
  if (Object.keys(validateCancel(draft, shareVnd)).length > 0 || draft.cause === '') return null;
  const part =
    draft.cause === 'CUSTOMER_CHANGED_MIND' && shareVnd !== '0' && draft.amount.trim() !== shareVnd
      ? { amountVnd: draft.amount.trim() }
      : {};
  return {
    expectedVersion,
    cause: draft.cause,
    note: draft.note.trim(),
    method: draft.method,
    bankReference: draft.method === 'BANK_TRANSFER_MANUAL' ? draft.bankReference.trim() : null,
    clientRequestId,
    ...part,
  };
}

/** The note of a declined request to cancel (required). */
export const declineNoteProblem = (note: string): boolean => note.trim() === '';

/** True when a command was refused because the line moved on meanwhile: the screen then reloads. */
export const isQueueConflict = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.code === 'CONFLICT' || error.code === 'ORDER_LINE_STATE_INVALID');

/** The text of a refused queue command; anything else falls back to the caller's message. */
export function queueErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const known = productOrdersDictionary(locale).queueErrors as Record<string, string>;
    const text = known[error.code];
    if (text) return text;
  }
  return fallback(error);
}
