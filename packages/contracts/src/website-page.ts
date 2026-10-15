import type { PreferredLocale } from './index.js';

/**
 * Session 7b: the information pages the Owner writes in the website admin (about, policies, terms, privacy), their small text
 * markup, and the one link rule. Pure and dependency free: the API validates with it on every save, the admin preview and the
 * public page draw from the same parse. The text is drawn as elements, never as HTML.
 */

export type WebsitePageRole = 'INFO' | 'POLICY' | 'TERMS' | 'PRIVACY';
export const WEBSITE_PAGE_ROLES: readonly WebsitePageRole[] = [
  'INFO',
  'POLICY',
  'TERMS',
  'PRIVACY',
];

/**
 * The limits are in code points. A Vietnamese letter is up to 3 bytes, so a Vietnamese and an English body of the largest size
 * (about 2,000 words each) still fit the API's 100 kB JSON body (a test saves one).
 */
export const WEBSITE_PAGE_LIMITS = Object.freeze({
  slug: 80,
  title: 120,
  body: 12_000,
  seoTitle: 70,
  seoDescription: 200,
  blocks: 400,
});

/**
 * Addresses a page may not take: the first segment of every route the site already answers (a page there would never be
 * reached), the locales, and the API and health paths. A test walks `apps/web/src/app/[locale]` and fails when a route is
 * missing here.
 */
export const RESERVED_PAGE_SLUGS: readonly string[] = [
  'account',
  'api',
  'cart',
  'checkout',
  'contact',
  'en',
  'health',
  'products',
  'season-preview',
  'services',
  'ticket',
  'vi',
  'workforce',
];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validPageSlugFormat(slug: string): boolean {
  return slug.length >= 1 && slug.length <= WEBSITE_PAGE_LIMITS.slug && SLUG.test(slug);
}

/** A well-formed address that no existing route owns. */
export function validPageSlug(slug: string): boolean {
  return validPageSlugFormat(slug) && !RESERVED_PAGE_SLUGS.includes(slug);
}

// ------------------------------------------------------------------ links

const INTERNAL_URL = /^\/(vi|en|\{locale\})(\/[^\s<>"'\\]*)?$/;
const MAILTO = /^mailto:[^\s<>"'\\@:?#]+@[^\s<>"'\\@:?#]+\.[^\s<>"'\\@:?#]+$/;
const TEL = /^tel:\+?[0-9]{6,15}$/;
const ANCHOR = /^#[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The link rule of design 16.2: an internal `/vi/...`, `/en/...` or `/{locale}/...` path, or an `https://` URL with a host and
 * no credentials. Never `javascript:`, `data:`, `http:` or a protocol-relative `//host`. The popup's button and the shop's map
 * and footer links use exactly this.
 */
export function isWebsiteLink(value: string, max = 500): boolean {
  if ([...value].length > max) return false;
  if (INTERNAL_URL.test(value)) return true;
  if (!/^https:\/\/[^\s<>"'\\/]/.test(value) || /[\s<>"'\\]/.test(value)) return false;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === 'https:' && url.username === '' && url.password === '' && url.hostname !== ''
  );
}

/** A link inside page text: the website link rule, plus `mailto:`, `tel:` and an anchor to a heading of the same page. */
export function isRichTextLink(value: string): boolean {
  return isWebsiteLink(value) || MAILTO.test(value) || TEL.test(value) || ANCHOR.test(value);
}

// ------------------------------------------------------------------ rich text

export type RichInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: RichInline[] }
  | { type: 'em'; children: RichInline[] }
  | { type: 'link'; href: string; children: RichInline[] };

export interface RichHeading {
  type: 'h2' | 'h3';
  id: string;
  text: string;
  inlines: RichInline[];
}
export interface RichParagraph {
  type: 'p';
  inlines: RichInline[];
}
export interface RichList {
  type: 'ul' | 'ol';
  items: RichInline[][];
}
/** A pipe table: one header row and at least one body row, every row with the header's number of cells. */
export interface RichTable {
  type: 'table';
  header: RichInline[][];
  rows: RichInline[][][];
}
export type RichBlock = RichHeading | RichParagraph | RichList | RichTable;

export type RichTextProblem =
  /** Raw HTML (`<b>`, `</p>`, `<!--`): write the markup instead. */
  | 'html'
  | 'image'
  /** A heading level other than `##` and `###` (the page title is the one heading above them). */
  | 'headingLevel'
  | 'link'
  /** A `|` row that is not a table: no `| --- |` line under the header, a row with another number of cells, or too many columns. */
  | 'table'
  | 'control'
  | 'empty'
  | 'tooLong'
  | 'tooManyBlocks';

export type RichTextResult =
  { ok: true; blocks: RichBlock[] } | { ok: false; problem: RichTextProblem; line: number };

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const BULLET = /^[-*+][ \t]+(.+)$/;
const NUMBERED = /^[0-9]{1,3}[.)][ \t]+(.+)$/;
const TABLE_ROW = /^\|/;
const TABLE_RULE = /^:?-{3,}:?$/;
const TABLE_MAX_COLUMNS = 6;
const HTML_LIKE = /(?<!\\)<[A-Za-z/!?]/;
const IMAGE_LIKE = /(?<!\\)!\[/;
// Controls, lone surrogates and the text-direction overrides that can make a link read as another address.
const CONTROL = /[\p{Cc}\p{Cs}‪-‮⁦-⁩]/u;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!<>|~]/;

/** `Chính sách đổi trả` as `chinh-sach-doi-tra`: the id of a heading and of its table-of-contents entry. */
export function headingSlug(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'muc' : slug.slice(0, 60).replace(/-+$/g, '');
}

class Problem extends Error {
  constructor(
    readonly problem: RichTextProblem,
    readonly line: number,
  ) {
    super(problem);
  }
}

/** The text of inlines, flat (for a heading's id and the table of contents). */
export function inlineText(inlines: readonly RichInline[]): string {
  return inlines
    .map((inline) => (inline.type === 'text' ? inline.text : inlineText(inline.children)))
    .join('');
}

/**
 * Inline markup of one line: `**bold**`, `*italic*`, `[words](link)` and `\` before a symbol to write it as it is. Nothing else
 * is special, so a stray `*` or `[` stays text. A link may hold bold or italic words but not another link.
 */
function parseInlines(source: string, line: number, inLink = false): RichInline[] {
  const out: RichInline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer !== '') out.push({ type: 'text', text: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < source.length) {
    const char = source[i] as string;
    if (char === '\\' && i + 1 < source.length && ESCAPABLE.test(source[i + 1] as string)) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }
    // An opening mark is followed by a word and a closing mark follows one (so "2 * 3 * 4" stays as written).
    if (char === '*' && source[i + 1] === '*' && !/\s/.test(source[i + 2] ?? ' ')) {
      const end = findClosing(source, i + 2, '**');
      if (end > i + 2 && !/\s/.test(source[end - 1] as string)) {
        flush();
        out.push({
          type: 'strong',
          children: parseInlines(source.slice(i + 2, end), line, inLink),
        });
        i = end + 2;
        continue;
      }
    }
    if (char === '*' && source[i + 1] !== '*' && !/\s/.test(source[i + 1] ?? ' ')) {
      const end = findClosing(source, i + 1, '*');
      if (end > i + 1 && !/\s/.test(source[end - 1] as string)) {
        flush();
        out.push({ type: 'em', children: parseInlines(source.slice(i + 1, end), line, inLink) });
        i = end + 1;
        continue;
      }
    }
    if (char === '[' && !inLink) {
      const close = findClosing(source, i + 1, ']');
      if (close > i + 1 && source[close + 1] === '(') {
        const end = source.indexOf(')', close + 2);
        if (end > close + 2) {
          const href = source.slice(close + 2, end).trim();
          if (!isRichTextLink(href)) throw new Problem('link', line);
          flush();
          out.push({
            type: 'link',
            href,
            children: parseInlines(source.slice(i + 1, close), line, true),
          });
          i = end + 1;
          continue;
        }
      }
    }
    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

/** The cells of one `| a | b |` row: split on every `|` that is not escaped, the outer bars optional, each cell trimmed. */
function tableCells(row: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = row.startsWith('|') ? 1 : 0; i < row.length; i += 1) {
    const char = row[i] as string;
    if (char === '\\' && i + 1 < row.length) {
      cell += char + row[i + 1];
      i += 1;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  // A closing bar leaves nothing after it; text after the last bar is a last cell.
  if (cell.trim() !== '') cells.push(cell.trim());
  return cells;
}

/** The index of the next `marker` at or after `from` that is not escaped, or -1. */
function findClosing(source: string, from: number, marker: string): number {
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source.startsWith(marker, i)) {
      // A single `*` must not be the first half of a `**`.
      if (marker === '*' && source[i + 1] === '*') {
        i += 1;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/**
 * The page text as blocks. Blank lines separate blocks. `## Heading` and `### Heading` are headings, lines that start with `- `
 * or `1. ` are lists, anything else is a paragraph (its lines are joined). Raw HTML, images, other heading levels and links
 * outside the link rule are refused with the line they are on, so a save never silently changes what was written.
 */
export function parseRichText(source: string): RichTextResult {
  try {
    return { ok: true, blocks: parseBlocks(source) };
  } catch (error) {
    if (error instanceof Problem) return { ok: false, problem: error.problem, line: error.line };
    throw error;
  }
}

function parseBlocks(source: string): RichBlock[] {
  const text = source.normalize('NFC').replace(/\r\n?/g, '\n');
  if ([...text].length > WEBSITE_PAGE_LIMITS.body) throw new Problem('tooLong', 1);
  const lines = text.split('\n');
  const blocks: RichBlock[] = [];
  const ids = new Map<string, number>();
  const uniqueId = (base: string) => {
    const seen = ids.get(base) ?? 0;
    ids.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };
  let paragraph: { text: string; line: number }[] = [];
  let list: { type: 'ul' | 'ol'; items: { text: string; line: number }[] } | null = null;
  const closeParagraph = () => {
    if (paragraph.length === 0) return;
    const first = paragraph[0] as { text: string; line: number };
    blocks.push({
      type: 'p',
      inlines: parseInlines(paragraph.map((row) => row.text).join(' '), first.line),
    });
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    blocks.push({
      type: list.type,
      items: list.items.map((item) => parseInlines(item.text, item.line)),
    });
    list = null;
  };
  let table: { text: string; line: number }[] = [];
  const closeTable = () => {
    if (table.length === 0) return;
    const rows = table.map((row) => ({ cells: tableCells(row.text), line: row.line }));
    table = [];
    const [head, rule, ...body] = rows as [
      (typeof rows)[number],
      (typeof rows)[number] | undefined,
      ...(typeof rows)[number][],
    ];
    const columns = head.cells.length;
    if (
      !rule ||
      body.length === 0 ||
      columns < 2 ||
      columns > TABLE_MAX_COLUMNS ||
      rule.cells.length !== columns ||
      !rule.cells.every((cell) => TABLE_RULE.test(cell))
    ) {
      throw new Problem('table', head.line);
    }
    const cellsOf = (row: (typeof rows)[number]) => {
      if (row.cells.length !== columns) throw new Problem('table', row.line);
      return row.cells.map((cell) => parseInlines(cell, row.line));
    };
    blocks.push({ type: 'table', header: cellsOf(head), rows: body.map(cellsOf) });
  };
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (CONTROL.test(raw.replace(/\t/g, ' '))) throw new Problem('control', line);
    const row = raw.trim();
    if (!TABLE_ROW.test(row)) closeTable();
    if (row === '') {
      closeParagraph();
      closeList();
      return;
    }
    if (HTML_LIKE.test(row)) throw new Problem('html', line);
    if (IMAGE_LIKE.test(row)) throw new Problem('image', line);
    if (TABLE_ROW.test(row)) {
      closeParagraph();
      closeList();
      table.push({ text: row, line });
      return;
    }
    const heading = HEADING.exec(row);
    if (heading) {
      closeParagraph();
      closeList();
      const level = (heading[1] as string).length;
      if (level !== 2 && level !== 3) throw new Problem('headingLevel', line);
      const inlines = parseInlines(heading[2] as string, line);
      const plain = inlineText(inlines).trim();
      if (plain === '') throw new Problem('empty', line);
      blocks.push({
        type: level === 2 ? 'h2' : 'h3',
        id: uniqueId(headingSlug(plain)),
        text: plain,
        inlines,
      });
      return;
    }
    const bullet = BULLET.exec(row);
    const numbered = bullet ? null : NUMBERED.exec(row);
    const item = bullet ?? numbered;
    if (item) {
      closeParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (list && list.type !== type) closeList();
      list ??= { type, items: [] };
      list.items.push({ text: (item[1] as string).trim(), line });
      return;
    }
    closeList();
    paragraph.push({ text: row, line });
  });
  closeParagraph();
  closeList();
  closeTable();
  if (blocks.length === 0) throw new Problem('empty', 1);
  if (blocks.length > WEBSITE_PAGE_LIMITS.blocks) throw new Problem('tooManyBlocks', 1);
  return blocks;
}

export interface PageSection {
  id: string;
  heading: string;
  blocks: RichBlock[];
}

/**
 * The blocks as the info page lays them out: what comes before the first `##` is the intro (no heading, no table-of-contents
 * entry), then one section for every `##` with everything up to the next one (its `###` headings included).
 */
export function pageSections(blocks: readonly RichBlock[]): {
  intro: RichBlock[];
  sections: PageSection[];
} {
  const intro: RichBlock[] = [];
  const sections: PageSection[] = [];
  for (const block of blocks) {
    if (block.type === 'h2') {
      sections.push({ id: block.id, heading: block.text, blocks: [] });
    } else {
      (sections.at(-1)?.blocks ?? intro).push(block);
    }
  }
  return { intro, sections };
}

// ------------------------------------------------------------------ admin contracts

export interface WebsitePageInput {
  /** The address after the language, lowercase with dashes: `chinh-sach-bao-mat` is `/vi/chinh-sach-bao-mat`. */
  slug: string;
  role: WebsitePageRole;
  titleVi: string;
  titleEn: string | null;
  /** The page text in the small markup (see `parseRichText`). */
  bodyVi: string;
  bodyEn: string | null;
  seoTitleVi: string | null;
  seoTitleEn: string | null;
  seoDescriptionVi: string | null;
  seoDescriptionEn: string | null;
  isPublished: boolean;
}

export interface WebsitePageUpdateRequest extends WebsitePageInput {
  expectedVersion: number;
}

/** POST /api/v1/website/pages/:id/publish: publish or unpublish without touching the text. */
export interface WebsitePagePublishRequest {
  expectedVersion: number;
  isPublished: boolean;
}

export interface WebsitePageSummary {
  id: string;
  slug: string;
  role: WebsitePageRole;
  titleVi: string;
  titleEn: string | null;
  isPublished: boolean;
  /** Optimistic-concurrency version; the row menu sends it back as `expectedVersion` to publish or unpublish. */
  version: number;
  updatedAt: string;
}

export interface WebsitePageListResponse {
  items: WebsitePageSummary[];
}

export interface WebsitePageResponse extends WebsitePageInput {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ public contracts

/** A link of the footer: the policies column and the legal line. Only published pages are ever listed. */
export interface PublicPageLink {
  slug: string;
  title: string;
  role: WebsitePageRole;
}

/**
 * GET /api/v1/public/pages/:slug?locale=: a published page in the visitor's language. When the page has no English text the
 * English visitor gets the Vietnamese text and `language` says `vi` (the site then marks it so, and does not offer it to search
 * engines as English). An unpublished or unknown page is 404.
 */
export interface PublicPageResponse {
  slug: string;
  role: WebsitePageRole;
  title: string;
  body: string;
  language: PreferredLocale;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

/** GET /api/v1/public/pages: the published pages for the sitemap (the address and when the text last changed). */
export interface PublicPageIndexResponse {
  items: { slug: string; updatedAt: string; englishAvailable: boolean }[];
}
