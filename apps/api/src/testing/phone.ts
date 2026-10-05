import { randomInt } from 'node:crypto';

/*
 * Test fixtures: a Vietnamese mobile number the real validator (`normalizePhone`) always accepts.
 *
 * Why it exists: fixtures used `+849` plus eight random digits, and about 1 in 100 of those start with `+84992`, which is
 * not an allocated mobile prefix, so the validator (correctly) rejected it whenever a test looked the customer up by phone.
 * Only prefixes that are allocated mobile ranges are drawn here, with seven random digits after them, and a number is never
 * handed out twice in one process.
 */
const PREFIXES = ['90', '91', '93', '94', '96', '97', '98'] as const;
const issued = new Set<string>();

/** A valid, unique mobile number in canonical form, for example `+84934936101`. */
export function validVnMobile(): string {
  for (;;) {
    const prefix = PREFIXES[randomInt(PREFIXES.length)]!;
    const number = `+84${prefix}${randomInt(0, 10_000_000).toString().padStart(7, '0')}`;
    if (!issued.has(number)) {
      issued.add(number);
      return number;
    }
  }
}

/** The same kind of number as a customer types it: `0934936101`. */
export function validVnMobileLocal(): string {
  return `0${validVnMobile().slice(3)}`;
}
