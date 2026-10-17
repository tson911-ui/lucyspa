// Text helpers for the counter screens (session 10, Step 5): lists and durations through Intl, cached per locale
// (js-cache-function-results), so no screen joins words with a hand-written " · " or "′".

import type { Locale } from '../../../i18n/locales';

const lists = new Map<string, Intl.ListFormat>();
const minuteFormats = new Map<Locale, Intl.NumberFormat>();

/** "A, B và C" (conjunction) for names; `meta` gives "A, B, C" for a line of facts that replaces a middle-dot string. */
export function listFormat(locale: Locale, kind: 'and' | 'meta' = 'and'): Intl.ListFormat {
  const key = `${locale}:${kind}`;
  let format = lists.get(key);
  if (!format) {
    format = new Intl.ListFormat(
      locale,
      kind === 'and' ? { type: 'conjunction' } : { type: 'unit', style: 'short' },
    );
    lists.set(key, format);
  }
  return format;
}

/** Facts of one line ("Gội đầu, bản thân, Lan"); empty parts are left out so no stray separator remains. */
export function metaLine(
  locale: Locale,
  parts: readonly (string | null | undefined | false)[],
): string {
  return listFormat(locale, 'meta').format(parts.filter((part): part is string => Boolean(part)));
}

const decimals = new Map<Locale, Intl.NumberFormat>();

/** A percentage number from basis points without the sign ("5,5" / "5.5"); the dictionary template places the "%". */
export function percentNumber(locale: Locale, basisPoints: number): string {
  let format = decimals.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    decimals.set(locale, format);
  }
  return format.format(basisPoints / 100);
}

const signedFormats = new Map<Locale, Intl.NumberFormat>();

/** "+2", "−2" or "0" through Intl `signDisplay` (wig: no sign added by hand). */
export function signedNumber(locale: Locale, value: number): string {
  let format = signedFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { signDisplay: 'exceptZero' });
    signedFormats.set(locale, format);
  }
  return format.format(value);
}

const percents = new Map<Locale, Intl.NumberFormat>();

/** A percentage from basis points with its sign from Intl ("5,5%" / "5.5%"), wig pos-sections.tsx:81. */
export function percentText(locale: Locale, basisPoints: number): string {
  let format = percents.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 });
    percents.set(locale, format);
  }
  return format.format(basisPoints / 10_000);
}

const clocks = new Map<string, Intl.DateTimeFormat>();
const days = new Map<Locale, Intl.DateTimeFormat>();

/**
 * A wall-clock time in the branch time zone ("09:05"), one cached formatter per locale and zone: the boards format every row
 * on every 30 s refresh (rbp js-cache-function-results, lib booking-board.ts:39 and pos.ts:50 as used by these screens).
 */
export function clockTime(locale: Locale, zone: string, iso: string): string {
  const key = `${locale}|${zone}`;
  let format = clocks.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    });
    clocks.set(key, format);
  }
  return format.format(new Date(iso));
}

/** "09:00–10:30" through Intl formatRange (wig booking-board-sections.tsx:75), with the same cached formatter. */
export function clockRange(locale: Locale, zone: string, startIso: string, endIso: string): string {
  clockTime(locale, zone, startIso);
  const format = clocks.get(`${locale}|${zone}`)!;
  return format.formatRange(new Date(startIso), new Date(endIso));
}

/** The day and month of a calendar date ("02/03"), through Intl, not a hand-built "dd/mm". Both languages use the
 * day/month order the app shows everywhere (formatDate: dd/mm/yyyy); vi-VN alone would print "02-03". */
export function dayMonth(locale: Locale, date: string): string {
  let format = days.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
    });
    days.set(locale, format);
  }
  return format.format(new Date(`${date}T00:00:00Z`));
}

const signedMoneyFormats = new Map<Locale, Intl.NumberFormat>();

/** "+12.000 ₫" / "−12.000 ₫": money with its sign from Intl `signDisplay` (wig cash-book.tsx:266), non-breaking before "₫". */
export function signedMoney(locale: Locale, value: number | bigint): string {
  let format = signedMoneyFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      signDisplay: 'exceptZero',
      maximumFractionDigits: 0,
    });
    signedMoneyFormats.set(locale, format);
  }
  return `${format.format(value)}\u00a0₫`;
}

/**
 * An amount taken off a bill ("-30.000 ₫") from a VND decimal string: the minus sign comes from Intl, never typed by hand
 * (wig Locale & i18n), and the amount stays a BigInt like formatVnd. A text that is not an amount is returned as it is.
 */
export function minusMoney(locale: Locale, vnd: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(vnd)) return vnd;
  return signedMoney(locale, -BigInt(vnd));
}

const groupings = new Map<Locale, Intl.NumberFormat>();

function groupingOf(locale: Locale): Intl.NumberFormat {
  let format = groupings.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US');
    groupings.set(locale, format);
  }
  return format;
}

/** "20.000" / "20,000": a whole number with the locale's grouping, one cached formatter (rbp js-cache-function-results). */
export function groupedNumber(locale: Locale, value: number | bigint): string {
  return groupingOf(locale).format(value);
}

/** The locale's thousands separator, read from Intl (for a money field), not picked by hand per locale. */
export function groupSeparator(locale: Locale): string {
  return (
    groupingOf(locale)
      .formatToParts(1000)
      .find((part) => part.type === 'group')?.value ?? '.'
  );
}

/** A dictionary fragment as a sentence: a full stop is added when it has no closing punctuation of its own. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** "45 phút" / "45 min". */
export function minutes(locale: Locale, value: number): string {
  let format = minuteFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' });
    minuteFormats.set(locale, format);
  }
  return format.format(value);
}
