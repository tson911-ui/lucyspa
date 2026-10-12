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

export interface ReviewTextStrip {
  /** The text without the supplier's customer comments; the input itself when nothing was found. */
  text: string;
  /** How many comment entries were removed. */
  removed: number;
  /** A review-like heading was found but its entries could not be read: the text was kept for a person to look at. */
  suspected: boolean;
}

// Claude integration CI-0 (Owner, 2026-10-12): some supplier descriptions end with a block of "customer comments" (a heading such as
// "Đánh giá người dùng Việt Nam" and two to four entries "Minh Thư (35 tuổi) 🌸: Chất kem ..."). They are the supplier's own text, not
// Lucy Spa customers, and four of the headings say "giả lập" (simulated). They must never reach a candidate, a product or a rewrite.
const REVIEW_HEADINGS = [
  'đánh giá',
  'cảm nhận khách',
  'nhận xét',
  'phản hồi',
  'review',
  'reviews',
  'feedback',
];
const NAME = String.raw`(?:(?:Bạn|Chị|Anh|Cô|Em|Khách)\s+)?\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+){0,3}`;
// Real emoji only (default emoji presentation, or a pictograph with the emoji variation selector): `\p{Extended_Pictographic}` alone
// also matches ™ ® © and arrows such as ➔, which appear in ingredient lists and routines.
const PICTOGRAM = String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)`;
const MARK = String.raw`${PICTOGRAM}[\u{1F3FB}-\u{1F3FF}]?`;
const BRACKET = String.raw`(?:\s*\([^)]{1,60}\))?`;
const EMOJIS = String.raw`(?:\s*${MARK})*`;
const NAME_FIRST = new RegExp(`^${NAME}${BRACKET}${EMOJIS}\\s*[:：]\\s*(\\S.*)$`, 'u');
const EMOJI_FIRST = new RegExp(
  `^(?:${MARK}\\s*)+${NAME}${BRACKET}${EMOJIS}\\s*[:：]\\s*(\\S.*)$`,
  'u',
);
const BULLET = /^[-–•*]\s*/u;
const DASH_ONLY = /^[-–•*]$/u;
const FIRST_PERSON = /(?<![\p{L}])(?:mình|tôi|em|mẹ)(?![\p{L}])/iu;
const EMOJI = new RegExp(PICTOGRAM, 'u');

function isReviewHeading(line: string): boolean {
  if (line.length > 110 || /[.!?](?:\s|$)/u.test(line)) return false;
  const lower = line.toLowerCase().replace(BULLET, '');
  return REVIEW_HEADINGS.some(
    (word) =>
      lower.startsWith(word) &&
      (lower.length === word.length || /^[\s:：\-–]/u.test(lower.slice(word.length))),
  );
}

/** A comment entry: a first name (title, age, city, emoji) followed by a colon and the praise. STRONG = it carries an emoji, an age or a quote; WEAK = only first-person wording. */
function reviewEntry(line: string): 'STRONG' | 'WEAK' | null {
  const body = line.replace(BULLET, '');
  const match = NAME_FIRST.exec(body) ?? EMOJI_FIRST.exec(body);
  if (match === null) return null;
  const rest = match[1] ?? '';
  const head = body.slice(0, body.length - rest.length);
  if (
    EMOJI.test(head) ||
    EMOJI.test(rest) ||
    /\d{1,2}\s*tuổi/iu.test(head) ||
    /^[“"«]/u.test(rest)
  ) {
    return 'STRONG';
  }
  return FIRST_PERSON.test(rest) ? 'WEAK' : null;
}

/** Reads entries (and lone dashes between them) from `start`; `end` is just after the last consumed line. */
function readEntries(
  lines: readonly string[],
  start: number,
  strongOnly: boolean,
): { end: number; entries: number } {
  let entries = 0;
  let end = start;
  for (let at = start; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    if (DASH_ONLY.test(line)) {
      end = at + 1;
      continue;
    }
    const kind = reviewEntry(line);
    if (kind === null || (strongOnly && kind !== 'STRONG')) break;
    entries += 1;
    end = at + 1;
  }
  return { end, entries };
}

/**
 * Removes the supplier's customer comments from description text (plain text, one line per block, as `htmlToPlainText` makes it): a
 * review heading at the start of a line together with the entries after it, and a run of two or more unmistakable entries with no
 * heading. A closing paragraph after the entries is kept. Ordinary sentences that contain "đánh giá" are never touched; a heading whose
 * entries cannot be read is kept and reported as `suspected`. Cleaning twice gives the same text.
 */
export function stripSupplierReviewText(input: string): ReviewTextStrip {
  const lines = input.split('\n');
  const kept: string[] = [];
  let removed = 0;
  let suspected = false;
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? '';
    if (isReviewHeading(line)) {
      const run = readEntries(lines, at + 1, false);
      if (run.entries > 0) {
        removed += run.entries;
        at = run.end;
        continue;
      }
      suspected = true;
    } else if (reviewEntry(line) === 'STRONG' || DASH_ONLY.test(line)) {
      const run = readEntries(lines, at, true);
      if (run.entries >= 2) {
        removed += run.entries;
        at = run.end;
        continue;
      }
    }
    kept.push(line);
    at += 1;
  }
  if (removed === 0) return { text: input, removed: 0, suspected };
  while (kept.length > 0 && DASH_ONLY.test(kept[kept.length - 1] ?? '')) kept.pop();
  return { text: kept.join('\n').trim(), removed, suspected };
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
