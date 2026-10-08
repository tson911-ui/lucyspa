import type {
  InvoiceProductLineAddRequest,
  ProductLineModeName,
  InvoiceProductLineResponse,
  InvoiceProductLineUpdateRequest,
  InvoiceResponse,
  PosProductOption,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { productOrdersDictionary } from '../../i18n/product-orders';
import { productSaleDictionary } from '../../i18n/product-sale';
import { ApiError } from './api';
import { formatVnd } from './format';
import { preOrderErrorText } from './product-orders';

/**
 * Selling products at the counter (Phase 6 P6-10). The browser only carries the cashier's choices: which variant, how many, who
 * sells. The price, the stock and every rule are the server's; what is shown here (the availability, the price) is advisory and the
 * API decides again on every command.
 */

/** The largest quantity of one line, as the server accepts it. */
export const MAX_PRODUCT_QUANTITY = 1000;

/** A whole number from 1 to 1,000 typed as text, or null. */
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[1-9][0-9]{0,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_PRODUCT_QUANTITY ? value : null;
}

/** The name of a product (and its variant) in the locale, as one line. */
export function productTitle(
  product: {
    nameVi: string;
    nameEn: string;
    variantLabelVi: string | null;
    variantLabelEn: string | null;
  },
  locale: Locale,
): string {
  const name = locale === 'vi' ? product.nameVi : product.nameEn;
  const label = locale === 'vi' ? product.variantLabelVi : product.variantLabelEn;
  if (!label) return name;
  // The name of an invoice line already ends with " - <label>" (the catalog copy); show the label once, the same way as a search result.
  const suffix = ` - ${label}`;
  return name.endsWith(suffix)
    ? `${name.slice(0, -suffix.length)} · ${label}`
    : `${name} · ${label}`;
}

/**
 * One option of the product list: title, price, then what is left ("Hết hàng" when nothing is; a variant that is sold on order says
 * it can be pre-ordered with the expected days instead).
 */
export function optionLabel(option: PosProductOption, locale: Locale): string {
  const a = productSaleDictionary(locale).add;
  const o = productOrdersDictionary(locale).mode;
  const waiting =
    option.available === 0 && option.sellOnOrder
      ? (option.leadTimeDaysMin === option.leadTimeDaysMax ? o.optionOrderSame : o.optionOrder)
          .replace('{min}', String(option.leadTimeDaysMin))
          .replace('{max}', String(option.leadTimeDaysMax))
      : null;
  const parts = [
    productTitle(option, locale),
    formatVnd(option.unitPriceVnd, locale),
    waiting ??
      (option.available > 0
        ? a.available.replace('{count}', String(option.available))
        : a.outOfStock),
  ];
  return parts.join(' — ');
}

export type AddProblem = 'product' | 'seller' | 'quantity' | 'stock';

/**
 * The add request from the choices made: pre-checked (a product, a seller, a quantity, and not more than what the list said is
 * available). The server checks all of it again, so a stale list can still be refused there.
 */
export function addBody(
  input: {
    option: PosProductOption | null;
    quantity: string;
    sellerUserId: string;
    /** `PRE_ORDER` sells goods the shop does not hold yet (a variant sold on order); the default is `IN_STOCK`. */
    mode?: ProductLineModeName;
  },
  expectedVersion: number,
): { body: InvoiceProductLineAddRequest } | { problem: AddProblem } {
  if (!input.option) return { problem: 'product' };
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) return { problem: 'quantity' };
  const mode = input.mode ?? 'IN_STOCK';
  if (mode === 'PRE_ORDER' && !input.option.sellOnOrder) return { problem: 'product' };
  if (mode === 'IN_STOCK' && quantity > input.option.available) return { problem: 'stock' };
  if (!input.sellerUserId) return { problem: 'seller' };
  return {
    body: {
      expectedVersion,
      variantId: input.option.variantId,
      quantity,
      sellerUserId: input.sellerUserId,
      ...(mode === 'PRE_ORDER' ? { fulfilmentMode: mode } : {}),
    },
  };
}

/** The update request: only what changed; `unchanged` when nothing differs from the line. */
export function updateBody(
  line: Pick<InvoiceProductLineResponse, 'quantity' | 'seller'>,
  input: { quantity: string; sellerUserId: string },
  expectedVersion: number,
): { body: InvoiceProductLineUpdateRequest } | { problem: 'quantity' | 'seller' | 'unchanged' } {
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) return { problem: 'quantity' };
  if (!input.sellerUserId) return { problem: 'seller' };
  const body: InvoiceProductLineUpdateRequest = { expectedVersion };
  if (quantity !== line.quantity) body.quantity = quantity;
  if (input.sellerUserId !== line.seller.id) body.sellerUserId = input.sellerUserId;
  return 'quantity' in body || 'sellerUserId' in body ? { body } : { problem: 'unchanged' };
}

/**
 * The text of a failed product command. A refused finalization (`PRODUCT_OUT_OF_STOCK`) carries the ids of the lines that cannot be
 * served in `field`; they are turned into the names the cashier sees. Everything else falls back to the shared messages.
 */
export function productErrorText(
  error: unknown,
  locale: Locale,
  invoice: Pick<InvoiceResponse, 'productLines'> | null,
  fallback: (error: unknown) => string,
): string {
  const d = productSaleDictionary(locale);
  if (error instanceof ApiError) {
    const preOrder = preOrderErrorText(error, locale, invoice, (line) =>
      productTitle(line, locale),
    );
    if (preOrder) return preOrder;
    if (error.code === 'PRODUCT_OUT_OF_STOCK') {
      const ids = (error.field ?? '').split(',').filter(Boolean);
      const names = ids
        .map((id) => invoice?.productLines.find((line) => line.id === id))
        .filter((line): line is InvoiceProductLineResponse => line !== undefined)
        .map((line) => productTitle(line, locale));
      return names.length > 0
        ? d.outOfStock.named.replace('{names}', names.join(', '))
        : d.outOfStock.unnamed;
    }
    const texts = d.errors as Record<string, string>;
    if (error.code in texts) return texts[error.code] as string;
  }
  return fallback(error);
}

/** The state of the stock of a line once the invoice is finalized (nothing while a draft). */
export function stockState(line: Pick<InvoiceProductLineResponse, 'reservation'>) {
  return line.reservation?.status ?? null;
}

export function stockTone(
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED',
): 'info' | 'success' | 'neutral' {
  return status === 'CONSUMED' ? 'success' : status === 'RESERVED' ? 'info' : 'neutral';
}
