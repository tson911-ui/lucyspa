// A date typed as ngày/tháng/năm (dd/mm/yyyy), whatever language the visitor's browser speaks: the native date field shows
// mm/dd/yyyy to a browser set to English, which is wrong for a Vietnamese form. The form keeps the ISO date (yyyy-mm-dd) the
// server expects; this file turns what is typed into it. Pure logic.

/** The digits typed so far, laid out as dd/mm/yyyy ("15031990" -> "15/03/1990"; a partial entry stays partial). */
export function maskDayMonthYear(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  let out = day;
  if (digits.length > 2) out += `/${month}`;
  if (digits.length > 4) out += `/${year}`;
  return out;
}

/**
 * `dd/mm/yyyy` as an ISO date, or null when it is not a whole, real date on or before `today` (an ISO date) from 1900 on.
 * February 30th, a 13th month and a date in the future are not dates of birth.
 */
export function dayMonthYearToIso(text: string, today: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return iso > today ? null : iso;
}

/** The ISO date as dd/mm/yyyy for display ('' when it is not an ISO date). */
export function isoToDayMonthYear(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}
