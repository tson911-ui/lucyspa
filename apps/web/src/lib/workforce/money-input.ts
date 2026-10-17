import type { Locale } from '../../i18n/locales';

/**
 * The digit grouping and currency sign a `MoneyInput` shows, taken from `Intl.NumberFormat` for the locale instead of being
 * written by hand (wig Locale & i18n). Money is integer VND.
 */
const cache = new Map<Locale, { separator: string; unit: string }>();

export function moneyInputFormat(locale: Locale): { separator: string; unit: string } {
  let format = cache.get(locale);
  if (!format) {
    const tag = locale === 'vi' ? 'vi-VN' : 'en-US';
    const group = new Intl.NumberFormat(tag)
      .formatToParts(1000000)
      .find((part) => part.type === 'group');
    const sign = new Intl.NumberFormat(tag, { style: 'currency', currency: 'VND' })
      .formatToParts(1)
      .find((part) => part.type === 'currency');
    format = { separator: group?.value ?? '.', unit: sign?.value ?? '₫' };
    cache.set(locale, format);
  }
  return format;
}
