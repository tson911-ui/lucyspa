import { createHash } from 'node:crypto';

/**
 * Phase 9 P9-3: turning untrusted supplier text into plain text, and hashing normalized records. Descriptions are stored as plain
 * text only (design section 3): no tag, script or style survives, entities are decoded once, and the page text is never treated as
 * instructions.
 */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  middot: '·',
  bull: '•',
  euro: '€',
};

/** Decodes HTML entities in one pass (so `&amp;lt;` becomes `&lt;`, never `<`). Unknown entities stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g,
    (whole, dec, hex, name) => {
      if (dec !== undefined || hex !== undefined) {
        const code = dec !== undefined ? Number(dec) : Number.parseInt(hex as string, 16);
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
        return String.fromCodePoint(code);
      }
      return NAMED[name as string] ?? whole;
    },
  );
}

/** Control characters, zero-width and bidirectional marks, line and paragraph separators and the BOM (but not a line feed). */
function removed(code: number): boolean {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function clean(text: string): string {
  let out = '';
  for (const char of text) {
    if (!removed(char.codePointAt(0) as number)) out += char;
  }
  return out.normalize('NFC');
}

/** A one-line text (a product name, a category): tags removed, entities decoded once, white space collapsed. */
export function plainLine(html: string, maxLength = 300): string {
  const withoutTags = html.replace(/<[^>]*>/g, ' ');
  return clean(decodeEntities(withoutTags)).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Description text: blocks become line breaks, script and style are dropped with their content, everything else is text. */
export function htmlToPlainText(html: string, maxLength = 20_000): string {
  const text = html
    .replace(/<(script|style|noscript|template|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|section|blockquote)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]*>/g, ' ');
  return clean(decodeEntities(text))
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .trim()
    .slice(0, maxLength);
}

/** Stable JSON: object keys sorted, so equal data always hashes equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function hashOf(value: unknown): string {
  return sha256Text(canonicalJson(value));
}
