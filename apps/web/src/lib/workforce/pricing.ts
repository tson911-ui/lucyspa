import type { ServicePricingUnit } from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { isVndInput } from './format';

/** Pricing units offered in the form, in display order. */
export const PRICING_UNITS: readonly ServicePricingUnit[] = ['PER_SERVICE', 'PER_NAIL'];

/** Form values (strings as typed) for a service price. */
export interface PriceForm {
  priceVnd: string;
  priceMaxVnd: string;
  pricingUnit: ServicePricingUnit;
  /**
   * The per-service quantity limit (Phase 4 OP-1) as typed. It applies only to PER_NAIL (PER_SERVICE
   * is always one unit and sends none); the API and SQL remain authoritative.
   */
  maxQuantity: string;
}

export type PriceProblem = 'invalid' | 'maxBeforeMin';

/**
 * UX mirror of the API rule `0 <= min <= max` in whole VND. Comparison uses BigInt, never
 * floating point; the API (and SQL) remain authoritative.
 */
export function priceProblem(
  form: Pick<PriceForm, 'priceVnd' | 'priceMaxVnd'>,
): PriceProblem | null {
  if (!isVndInput(form.priceVnd) || !isVndInput(form.priceMaxVnd)) return 'invalid';
  return BigInt(form.priceMaxVnd) < BigInt(form.priceVnd) ? 'maxBeforeMin' : null;
}

const MAX_QUANTITY_CEILING = 2_147_483_647;

/** UX mirror of the API rule: a PER_NAIL limit is a positive integer that fits the database. */
export function quantityProblem(
  form: Pick<PriceForm, 'pricingUnit' | 'maxQuantity'>,
): 'invalid' | null {
  if (form.pricingUnit !== 'PER_NAIL') return null;
  if (!/^[1-9][0-9]{0,9}$/.test(form.maxQuantity)) return 'invalid';
  return Number(form.maxQuantity) <= MAX_QUANTITY_CEILING ? null : 'invalid';
}

/** The request field: only a PER_NAIL service sends its limit. */
export function maxQuantityBody(form: Pick<PriceForm, 'pricingUnit' | 'maxQuantity'>): {
  maxQuantity?: number;
} {
  return form.pricingUnit === 'PER_NAIL' ? { maxQuantity: Number(form.maxQuantity) } : {};
}

function digits(value: string, locale: Locale): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return value;
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'vi' ? '.' : ',');
}

/**
 * The displayed price: one amount when exact, a range otherwise, followed by the unit
 * suffix ("40.000 ₫", "5.000 ₫/ngón", "5.000–10.000 ₫/ngón"; English "/nail").
 */
export function formatServicePrice(
  price: { priceVnd: string; priceMaxVnd: string; pricingUnit: ServicePricingUnit },
  t: WorkforceDictionary,
  locale: Locale,
): string {
  const amount =
    price.priceVnd === price.priceMaxVnd
      ? digits(price.priceVnd, locale)
      : `${digits(price.priceVnd, locale)}–${digits(price.priceMaxVnd, locale)}`;
  return `${amount} ₫${t.services.unitSuffix[price.pricingUnit]}`;
}
