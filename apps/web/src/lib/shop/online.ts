import type {
  CustomerAddressResponse,
  OnlineAddressInput,
  OnlineCartLineResponse,
  OnlineCartProblem,
  OnlineCartResponse,
  OnlineCheckoutRequest,
  OnlineOrderState,
  OnlineSalesPublicResponse,
  PublicProductVariant,
} from '@lucy-spa/contracts';
import { ApiError } from '../api/client';

/**
 * Phase 6 P6-19 (online orders, web side): the pure logic of the cart, the checkout and the member's online orders. Every
 * amount, state and permission comes from the server; this only formats, labels and checks what the form can check first.
 * The server decides everything again and names the field it refused.
 */

/** The price of the cart as the checkout would place it (nothing is saved); the shape of `POST me/checkout/quote`. */
export interface QuoteResponse {
  lines: {
    variantId: string;
    quantity: number;
    unitPriceVnd: string;
    lineTotalVnd: string;
    mode: 'IN_STOCK' | 'PRE_ORDER';
  }[];
  subtotalVnd: string;
  discountVnd: string;
  shippingFeeVnd: string;
  totalVnd: string;
  hasPreOrder: boolean;
  voucherCode: string | null;
  /** True when the code lowered the price. */
  voucherEffective: boolean | null;
  unpaidOrders: number;
}

/** Fired on the window whenever the cart changes, so the header's count reads it again. */
export const CART_CHANGED = 'lucy-cart-changed';

export function announceCartChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CART_CHANGED));
}

/** The browser caches nothing of the shop settings for long: one answer is shared by the page's islands for this long. */
export const SALES_CACHE_MS = 30_000;

// ------------------------------------------------------------------------------------------------ the product page

export type PurchaseMode =
  /** Shown while the shop's settings are not known yet. */
  | 'LOADING'
  /** Online ordering is not open, or the variant is sold in the shop only. */
  | 'STORE'
  | 'SOLD_OUT'
  | 'SIGN_IN'
  | 'ADD'
  | 'PRE_ORDER';

/** What the product page offers for the chosen variant. A quantity of stock is never part of it. */
export function purchaseMode(input: {
  sales: Pick<OnlineSalesPublicResponse, 'enabled'> | null | 'failed';
  sessionKnown: boolean;
  signedIn: boolean;
  variant: Pick<PublicProductVariant, 'sellOnline' | 'stock'>;
}): PurchaseMode {
  if (input.sales === null) return 'LOADING';
  if (input.sales === 'failed' || !input.sales.enabled || !input.variant.sellOnline) return 'STORE';
  if (input.variant.stock.state === 'OUT_OF_STOCK') return 'SOLD_OUT';
  if (!input.sessionKnown) return 'LOADING';
  if (!input.signedIn) return 'SIGN_IN';
  return input.variant.stock.state === 'PRE_ORDER' ? 'PRE_ORDER' : 'ADD';
}

/** A quantity stepper value kept inside 1..max (an empty or broken entry is 1). */
export function clampQuantity(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), Math.max(max, 1));
}

/** The sign-in link that brings the visitor back to the page they were on. */
export function signInHref(locale: string, returnTo: string): string {
  return `/${locale}/account/login?${new URLSearchParams({ next: returnTo }).toString()}`;
}

// ------------------------------------------------------------------------------------------------------------ cart

/** The lines the checkout would refuse (a line with a problem), in cart order. */
export function problemLines(cart: Pick<OnlineCartResponse, 'lines'>): OnlineCartLineResponse[] {
  return cart.lines.filter((line) => line.problem !== null);
}

export function cartLineCount(cart: Pick<OnlineCartResponse, 'lines'> | null): number {
  return cart?.lines.length ?? 0;
}

/** The ids a `CART_NOT_READY` answer names (a comma-separated list in the error's field). */
export function notReadyIds(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'CART_NOT_READY' || !error.field) return [];
  return error.field.split(',').filter((id) => id !== '');
}

/** The picture of a cart line: the public rendition of its product image, or none. */
export function cartImageUrl(line: Pick<OnlineCartLineResponse, 'imageMediaId'>): string | null {
  return line.imageMediaId ? `/api/v1/public/media/${line.imageMediaId}/thumb` : null;
}

/** The expected wait of a pre-order line as "3–5 ngày"-style numbers; one number when both ends are equal; null when unknown. */
export function waitRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const low = min ?? max ?? 0;
  const high = max ?? min ?? low;
  return low === high ? String(low) : `${low}–${high}`;
}

export function problemOf(line: Pick<OnlineCartLineResponse, 'problem'>): OnlineCartProblem | null {
  return line.problem;
}

// ----------------------------------------------------------------------------------------------------------- address

export type AddressField = 'recipientName' | 'recipientPhone' | 'provinceCode' | 'ward' | 'street';

export interface AddressDraft {
  recipientName: string;
  recipientPhone: string;
  provinceCode: string;
  ward: string;
  street: string;
}

export const EMPTY_ADDRESS: AddressDraft = {
  recipientName: '',
  recipientPhone: '',
  provinceCode: '',
  ward: '',
  street: '',
};

/** The lengths the server accepts (the same numbers as its parser). */
export const ADDRESS_LIMITS = Object.freeze({ name: 120, phone: 40, ward: 120, street: 200 });

/**
 * A phone number in any common spelling: spaces, dots, dashes and brackets are ignored; a national number starts with 0 (a mobile
 * has 10 digits, a landline 10 or 11), an international one with + or 0084. This only keeps typing mistakes out: the server checks
 * the number again with the full numbering plan and has the last word.
 */
export function phoneLooksValid(value: string): boolean {
  if (!/^[0-9+ ().-]+$/.test(value)) return false;
  const digits = value.replace(/[ ().-]/g, '');
  return /^(?:0084[1-9]|\+[1-9]|0)\d{8,14}$/.test(digits) && digits.replace(/\D/g, '').length <= 15;
}

const squash = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Which address fields are not acceptable yet. An empty result means the form can be sent. */
export function addressProblems(draft: AddressDraft): Partial<Record<AddressField, true>> {
  const problems: Partial<Record<AddressField, true>> = {};
  const name = squash(draft.recipientName);
  if (name === '' || [...name].length > ADDRESS_LIMITS.name) problems.recipientName = true;
  if (!phoneLooksValid(draft.recipientPhone)) problems.recipientPhone = true;
  if (draft.provinceCode === '') problems.provinceCode = true;
  const ward = squash(draft.ward);
  if (ward === '' || [...ward].length > ADDRESS_LIMITS.ward) problems.ward = true;
  const street = squash(draft.street);
  if (street === '' || [...street].length > ADDRESS_LIMITS.street) problems.street = true;
  return problems;
}

export function addressRequest(draft: AddressDraft): OnlineAddressInput {
  return {
    recipientName: squash(draft.recipientName),
    recipientPhone: squash(draft.recipientPhone),
    provinceCode: draft.provinceCode,
    ward: squash(draft.ward),
    street: squash(draft.street),
  };
}

export function draftFromSaved(
  saved: Pick<
    CustomerAddressResponse,
    'recipientName' | 'recipientPhone' | 'provinceCode' | 'ward' | 'street'
  >,
): AddressDraft {
  return {
    recipientName: saved.recipientName,
    recipientPhone: nationalPhone(saved.recipientPhone),
    provinceCode: saved.provinceCode,
    ward: saved.ward,
    street: saved.street,
  };
}

/** A Vietnamese number stored as +84… is shown the way people write it, 0…; any other number stays as it is. */
export function nationalPhone(value: string): string {
  return /^\+84[1-9]\d{8,9}$/.test(value) ? `0${value.slice(3)}` : value;
}

/** The first address of a member: the name and phone of the profile fill what the member would type first. */
export function draftFromProfile(profile: {
  fullName: string;
  phone: string | null;
}): AddressDraft {
  return {
    ...EMPTY_ADDRESS,
    recipientName: profile.fullName,
    recipientPhone: nationalPhone(profile.phone ?? ''),
  };
}

/** Whether a saved address is the one in the form (the choice highlights it). */
export function sameAddress(a: AddressDraft, b: AddressDraft): boolean {
  const key = (x: AddressDraft) =>
    [x.recipientName, x.recipientPhone.replace(/\D/g, ''), x.provinceCode, x.ward, x.street]
      .map(squash)
      .join('|');
  return key(a) === key(b);
}

/** A saved address on one line: "Phường 3, 12 Lê Lợi, Hà Nội". */
export function addressLine(parts: { street: string; ward: string; provinceName: string }): string {
  return [parts.street, parts.ward, parts.provinceName].filter((part) => part !== '').join(', ');
}

/** The field a refused address names (`address.recipientPhone`), or null. */
export function addressFieldOf(error: unknown): AddressField | null {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED' || !error.field) {
    return null;
  }
  const name = error.field.startsWith('address.') ? error.field.slice('address.'.length) : '';
  return ['recipientName', 'recipientPhone', 'provinceCode', 'ward', 'street'].includes(name)
    ? (name as AddressField)
    : null;
}

// --------------------------------------------------------------------------------------------------------- checkout

/** An empty voucher field is no voucher. */
export function voucherOf(value: string): string | null {
  const code = value.trim();
  return code === '' ? null : code;
}

export function checkoutRequest(input: {
  draft: AddressDraft;
  saveAddress: boolean;
  voucher: string;
  policyVersion: number;
  clientRequestId: string;
}): OnlineCheckoutRequest {
  const voucherCode = voucherOf(input.voucher);
  return {
    address: addressRequest(input.draft),
    saveAddress: input.saveAddress,
    ...(voucherCode ? { voucherCode } : {}),
    acceptedPolicyVersion: input.policyVersion,
    clientRequestId: input.clientRequestId,
  };
}

/** A fresh id for one checkout attempt; kept in the page's state so a double click or a retry sends the same one. */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The words of the shipping promise for the checkout and the product page: the numbers come from the shop's settings, and the
 * text says it is not a promise (Owner).
 */
export function promiseNumbers(
  sales: Pick<
    OnlineSalesPublicResponse,
    'shipWithinWorkingDays' | 'transitDaysMin' | 'transitDaysMax'
  >,
): { days: number; min: number; max: number } {
  return {
    days: sales.shipWithinWorkingDays,
    min: sales.transitDaysMin,
    max: sales.transitDaysMax,
  };
}

/** The policy text in the reader's language, split into its paragraphs (one per line). */
export function policyParagraphs(
  sales: Pick<OnlineSalesPublicResponse, 'policyVi' | 'policyEn'>,
  locale: string,
): string[] {
  const text = locale === 'vi' ? sales.policyVi : sales.policyEn;
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

// ----------------------------------------------------------------------------------------------------------- orders

type Tone = 'success' | 'info' | 'warning' | 'neutral' | 'danger' | 'brand';

export function orderStateTone(state: OnlineOrderState): Tone {
  switch (state) {
    case 'AWAITING_PAYMENT':
      return 'warning';
    case 'PAID':
    case 'READY_TO_SHIP':
    case 'WAITING_GOODS':
      return 'info';
    case 'SHIPPED':
      return 'brand';
    case 'COMPLETED':
      return 'success';
    case 'DELIVERY_FAILED':
      return 'danger';
    case 'CANCELLED':
      return 'neutral';
  }
}

/** Whole seconds left until the deadline (never negative); null without a deadline. */
export function secondsLeft(deadlineAt: string | null, now: number): number | null {
  if (!deadlineAt) return null;
  const end = Date.parse(deadlineAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

/** "29:05" or "1:02:03". */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${two(minutes)}:${two(rest)}`;
}

/** The clock time of the deadline in the shop's local zone of the browser: "14:35". */
export function formatClock(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Whether the page was opened by PayOS bringing the customer back from the bank. PayOS adds `code`, `id`, `cancel`, `status` and
 * `orderCode` to the return address; the cancel address also carries `cancelled=1` (set by the API).
 */
export function cameBackFromBank(search: string): boolean {
  const params = new URLSearchParams(search);
  return ['cancelled', 'cancel', 'status', 'orderCode', 'code'].some((key) => params.has(key));
}

/** The order page reads the pending PayOS request on return, then every 5 seconds for about two minutes (only while unpaid). */
export const POLL_INTERVAL_MS = 5_000;
export const POLL_WINDOW_MS = 120_000;

export function shouldPoll(input: {
  state: OnlineOrderState;
  returned: boolean;
  elapsedMs: number;
}): boolean {
  return input.returned && input.state === 'AWAITING_PAYMENT' && input.elapsedMs < POLL_WINDOW_MS;
}

/** An order that still waits for money, from the server's own permission to pay. */
export function awaitsPayment(order: { state: OnlineOrderState }): boolean {
  return order.state === 'AWAITING_PAYMENT';
}

// ---------------------------------------------------------------------------------------------------------- errors

/** Codes the shop screens give their own words; anything else falls back to the member area's general messages. */
export const SHOP_ERROR_CODES = [
  'ONLINE_SALES_CLOSED',
  'CART_LIMIT',
  'CART_EMPTY',
  'CART_NOT_READY',
  'PRODUCT_NOT_SOLD_ONLINE',
  'PRODUCT_NOT_SELLABLE',
  'ONLINE_UNPAID_LIMIT',
  'ONLINE_POLICY_STALE',
  'ONLINE_ORDER_STATE_INVALID',
  'ONLINE_ORDER_EXPIRED',
  'VOUCHER_INVALID',
  'PAYMENT_PROVIDER_REJECTED',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'PAYMENT_PROVIDER_PENDING',
  'PAYMENT_METHOD_UNAVAILABLE',
  'ONLINE_SALES_NEEDS_BRANCH',
  'CONFLICT',
] as const;
export type ShopErrorCode = (typeof SHOP_ERROR_CODES)[number];

/**
 * The words for a failed shop command: the shop's own text for its codes, else the general text of the member area. The
 * refused field is never part of the message; a stale policy and a price change are asked again, not blamed on the customer.
 */
export function shopErrorMessage(
  error: unknown,
  shop: Readonly<Record<string, string>>,
  general: (error: unknown) => string,
): string {
  if (error instanceof ApiError && Object.hasOwn(shop, error.code)) return shop[error.code] ?? '';
  return general(error);
}

/** The error codes after which the checkout reads the policy and the cart again. */
export function reloadsPolicy(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'ONLINE_POLICY_STALE';
}

/** A code that means the order was not placed and the member should look at the cart. */
export function needsCart(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    [
      'CART_EMPTY',
      'CART_NOT_READY',
      'CART_LIMIT',
      'PRODUCT_NOT_SOLD_ONLINE',
      'PRODUCT_NOT_SELLABLE',
    ].includes(error.code)
  );
}
