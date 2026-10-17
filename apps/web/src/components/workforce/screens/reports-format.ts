// Number helpers for the report and pay screens (session 10, Step 6): percentages through Intl (cached per locale,
// js-cache-function-results) and amounts with a true minus sign "−", so no screen builds "12.7%" with toFixed or prints a hyphen as a
// minus. Amounts stay the API's integer strings and go through `formatVnd` (no floating point).

import type { Locale } from '../../../i18n/locales';
import { formatVnd } from '../../../lib/workforce/format';

const percents = new Map<Locale, Intl.NumberFormat>();

/** "12,7 %" / "12.7%" from basis points (1 % = 100 bp), always one decimal, so every share in a column lines up. */
export function shareText(locale: Locale, basisPoints: number): string {
  let format = percents.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    percents.set(locale, format);
  }
  return format.format(basisPoints / 10000);
}

/** An amount that may be negative ("-45000"): "−45.000 ₫" with a true minus, else as `formatVnd`. */
export function vndText(value: string, locale: Locale): string {
  return value.startsWith('-') ? `−${formatVnd(value.slice(1), locale)}` : formatVnd(value, locale);
}

/** A difference: "+60.000 ₫", "−60.000 ₫" or "0 ₫" (the sign is part of the figure, never added by the caller). */
export function signedVndText(value: string, locale: Locale): string {
  if (value.startsWith('-')) return `−${formatVnd(value.slice(1), locale)}`;
  return /^0+$/.test(value) ? formatVnd('0', locale) : `+${formatVnd(value, locale)}`;
}

/** A deduction in a statement: always "−45.000 ₫", whether the API sends it signed or not. */
export function minusVndText(value: string, locale: Locale): string {
  const digits = value.startsWith('-') ? value.slice(1) : value;
  return /^0+$/.test(digits) ? formatVnd('0', locale) : `−${formatVnd(digits, locale)}`;
}

const decimals = new Map<Locale, string>();

/** The language's decimal mark from Intl ("," in vi, "." in en), for helpers that take it as a string (kit `formatBytes`). */
export function decimalSeparator(locale: Locale): string {
  let mark = decimals.get(locale);
  if (mark === undefined) {
    mark =
      new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US')
        .formatToParts(1.5)
        .find((part) => part.type === 'decimal')?.value ?? '.';
    decimals.set(locale, mark);
  }
  return mark;
}
