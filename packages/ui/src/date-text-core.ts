// A date typed as ngày/tháng/năm (dd/mm/yyyy) in the staff screens, whatever language the browser speaks: the native date field
// shows mm/dd/yyyy to a browser set to English. The screens keep the ISO date (yyyy-mm-dd); this file turns what is typed
// into it. Pure logic, no future-date rule (leave, schedules, expiry and campaigns need future dates).

/** The digits typed so far, laid out as dd/mm/yyyy ("15032026" -> "15/03/2026"; a partial entry stays partial). */
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

/** True when `iso` is a whole, real calendar date (`yyyy-mm-dd`, year 1900 to 2999). */
export function isRealIsoDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The ISO date as dd/mm/yyyy for display ('' when it is not an ISO date). */
export function isoToDayMonthYear(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** `dd/mm/yyyy` as an ISO date, or null when it is not a whole, real date. */
export function dayMonthYearToIso(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isRealIsoDate(iso) ? iso : null;
}

/**
 * What a typed or pasted value means: the ISO date it stands for, '' when it is empty, or null while it is still incomplete
 * or not a real date. An ISO date (a paste, or the native value of an older field) is accepted as well as dd/mm/yyyy.
 */
export function readTypedDate(raw: string): string | null {
  if (raw.trim() === '') return '';
  if (isRealIsoDate(raw)) return raw;
  return dayMonthYearToIso(maskDayMonthYear(raw));
}

/** True when `iso` lies within the optional `min` and `max` (ISO dates compare as text). */
export function isWithinRange(iso: string, min?: string, max?: string): boolean {
  return (!min || iso >= min) && (!max || iso <= max);
}
