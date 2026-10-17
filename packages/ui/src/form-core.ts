// Pure helpers for form controls; DOM-free so they are unit tested in Node.

/** Keeps the digits of a typed amount. */
export function digitsOnly(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * Integer VND from typed text. Empty text is `null`. Money is always an integer (no decimals);
 * `undefined` means the digits do not fit a safe integer and the keystroke should be ignored.
 */
export function parseMoney(text: string): number | null | undefined {
  const digits = digitsOnly(text);
  if (digits === '') return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

// Groups of three from Intl (WIG locale: no hand-written grouping); the caller's separator replaces the neutral one.
const GROUPED_INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `1234567` -> `1.234.567` (Vietnamese grouping). */
export function formatMoney(value: number | null, separator = '.'): string {
  if (value === null || !Number.isFinite(value)) return '';
  return GROUPED_INTEGER.format(Math.trunc(value)).replaceAll(',', separator);
}

// U+0300..U+036F, the combining diacritical marks left over after NFD normalisation.
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  'g',
);
const D_STROKE = new RegExp(String.fromCharCode(0x111), 'gi');

/** Lower-cases and removes Vietnamese diacritics so "nguyen" finds "Nguyễn" and "dong" finds "Đồng". */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(D_STROKE, 'd')
    .toLocaleLowerCase();
}

export interface ComboOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// Normalised labels per options array, built once and reused on every keystroke (rbp js-cache-function-results).
const normalizedLabels = new WeakMap<readonly ComboOption[], string[]>();

export function filterOptions<T extends ComboOption>(options: readonly T[], query: string): T[] {
  const needle = normalizeSearch(query.trim());
  if (!needle) return [...options];
  let labels = normalizedLabels.get(options);
  if (!labels) {
    labels = options.map((option) => normalizeSearch(option.label));
    normalizedLabels.set(options, labels);
  }
  const found = labels;
  return options.filter((_, index) => found[index]?.includes(needle));
}

export interface Debouncer<Args extends unknown[]> {
  call: (...args: Args) => void;
  cancel: () => void;
}

export function createDebouncer<Args extends unknown[]>(
  action: (...args: Args) => void,
  ms: number,
): Debouncer<Args> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (handle !== null) clearTimeout(handle);
    handle = null;
  };
  return {
    call: (...args) => {
      cancel();
      handle = setTimeout(() => {
        handle = null;
        action(...args);
      }, ms);
    },
    cancel,
  };
}

/** Space-separated ids for `aria-describedby`; empty parts are dropped, `undefined` if none. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}
