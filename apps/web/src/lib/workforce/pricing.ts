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
