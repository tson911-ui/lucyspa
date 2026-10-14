import {
  parseRichText,
  validPageSlugFormat,
  WEBSITE_PAGE_LIMITS,
  RESERVED_PAGE_SLUGS,
  type RichTextProblem,
  type WebsitePageInput,
  type WebsitePageResponse,
  type WebsitePageRole,
} from '@lucy-spa/contracts';
import { ApiError } from '../api/client';

/**
 * Information pages, admin side (session 7b). The server is authoritative for every rule (the same parser and link rule from the
 * contracts decide what saves); these helpers only save a round trip, shape the form and format the text. Never "khám".
 */

export const pageTone = (published: boolean): 'success' | 'neutral' =>
  published ? 'success' : 'neutral';

export interface PageForm {
  slug: string;
  role: WebsitePageRole;
  titleVi: string;
  titleEn: string;
  bodyVi: string;
  bodyEn: string;
  seoTitleVi: string;
  seoTitleEn: string;
  seoDescriptionVi: string;
  seoDescriptionEn: string;
  isPublished: boolean;
}

/** A new page is a draft information page; the Owner publishes it when it reads right. */
export const emptyPageForm = (): PageForm => ({
  slug: '',
  role: 'INFO',
  titleVi: '',
  titleEn: '',
  bodyVi: '',
  bodyEn: '',
  seoTitleVi: '',
  seoTitleEn: '',
  seoDescriptionVi: '',
  seoDescriptionEn: '',
  isPublished: false,
});

export const formOfPage = (page: WebsitePageResponse): PageForm => ({
  slug: page.slug,
  role: page.role,
  titleVi: page.titleVi,
  titleEn: page.titleEn ?? '',
  bodyVi: page.bodyVi,
  bodyEn: page.bodyEn ?? '',
  seoTitleVi: page.seoTitleVi ?? '',
  seoTitleEn: page.seoTitleEn ?? '',
  seoDescriptionVi: page.seoDescriptionVi ?? '',
  seoDescriptionEn: page.seoDescriptionEn ?? '',
  isPublished: page.isPublished,
});

export function pageFormChanged(form: PageForm, initial: PageForm): boolean {
  return (Object.keys(form) as (keyof PageForm)[]).some((key) => form[key] !== initial[key]);
}

/** What is wrong, and where: the field that shows it and the reason (the text of the reason is in the dictionary). */
export type PageIssueKind =
  | 'slugRequired'
  | 'slugFormat'
  | 'slugReserved'
  | 'slugTaken'
  | 'titleRequired'
  | 'titleTooLong'
  | 'seoTitleTooLong'
  | 'seoDescriptionTooLong'
  | 'roleTaken'
  | RichTextProblem;

export interface PageIssue {
  field: keyof PageForm;
  kind: PageIssueKind;
  /** The line of the text a rich-text problem is on. */
  line?: number;
  /** `roleTaken`: the id of the page that holds the role. */
  other?: string;
}

const length = (value: string) => [...value.trim()].length;

/** One text of the form, checked with the contracts' own parser. English text may be empty (then the Vietnamese shows). */
export function bodyIssue(field: 'bodyVi' | 'bodyEn', value: string): PageIssue | null {
  if (field === 'bodyEn' && value.trim() === '') return null;
  const parsed = parseRichText(value);
  return parsed.ok ? null : { field, kind: parsed.problem, line: parsed.line };
}

/** The first problem of the form in the order it is read, or null. */
export function pageIssue(form: PageForm): PageIssue | null {
  const slug = form.slug.trim().toLowerCase();
  if (slug === '') return { field: 'slug', kind: 'slugRequired' };
  if (!validPageSlugFormat(slug)) return { field: 'slug', kind: 'slugFormat' };
  if (RESERVED_PAGE_SLUGS.includes(slug)) return { field: 'slug', kind: 'slugReserved' };
  if (length(form.titleVi) === 0) return { field: 'titleVi', kind: 'titleRequired' };
  if (length(form.titleVi) > WEBSITE_PAGE_LIMITS.title) {
    return { field: 'titleVi', kind: 'titleTooLong' };
  }
  if (length(form.titleEn) > WEBSITE_PAGE_LIMITS.title) {
    return { field: 'titleEn', kind: 'titleTooLong' };
  }
  const vi = bodyIssue('bodyVi', form.bodyVi);
  if (vi) return vi;
  const en = bodyIssue('bodyEn', form.bodyEn);
  if (en) return en;
  for (const field of ['seoTitleVi', 'seoTitleEn'] as const) {
    if (length(form[field]) > WEBSITE_PAGE_LIMITS.seoTitle)
      return { field, kind: 'seoTitleTooLong' };
  }
  for (const field of ['seoDescriptionVi', 'seoDescriptionEn'] as const) {
    if (length(form[field]) > WEBSITE_PAGE_LIMITS.seoDescription) {
      return { field, kind: 'seoDescriptionTooLong' };
    }
  }
  return null;
}

const empty = (value: string): string | null => (value.trim() === '' ? null : value);

/** The request, or the problem that stops it. The text is sent as written (the server normalizes it). */
export function pageInputOf(form: PageForm): { body: WebsitePageInput } | { issue: PageIssue } {
  const issue = pageIssue(form);
  if (issue) return { issue };
  return {
    body: {
      slug: form.slug.trim().toLowerCase(),
      role: form.role,
      titleVi: form.titleVi.trim(),
      titleEn: empty(form.titleEn.trim()),
      bodyVi: form.bodyVi,
      bodyEn: empty(form.bodyEn),
      seoTitleVi: empty(form.seoTitleVi.trim()),
      seoTitleEn: empty(form.seoTitleEn.trim()),
      seoDescriptionVi: empty(form.seoDescriptionVi.trim()),
      seoDescriptionEn: empty(form.seoDescriptionEn.trim()),
      isPublished: form.isPublished,
    },
  };
}

const FORM_FIELDS: ReadonlySet<string> = new Set<keyof PageForm>([
  'slug',
  'role',
  'titleVi',
  'titleEn',
  'bodyVi',
  'bodyEn',
  'seoTitleVi',
  'seoTitleEn',
  'seoDescriptionVi',
  'seoDescriptionEn',
]);

/** What the API refused, as an issue on a field of the form; null when it is not about a field. */
export function serverPageIssue(error: unknown): PageIssue | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'CONFLICT' && error.field === 'slug')
    return { field: 'slug', kind: 'slugTaken' };
  if (error.code === 'PAGE_ROLE_TAKEN' && error.field) {
    return { field: 'role', kind: 'roleTaken', other: error.field };
  }
  if (error.code === 'VALIDATION_FAILED' && error.field && FORM_FIELDS.has(error.field)) {
    const field = error.field as keyof PageForm;
    // The reason is not sent (the form already ran the same checks and passed): a refusal only the server saw reads as the generic
    // one of its field.
    return {
      field,
      kind:
        field === 'slug'
          ? 'slugFormat'
          : field === 'bodyVi' || field === 'bodyEn'
            ? 'empty'
            : field.startsWith('seoTitle')
              ? 'seoTitleTooLong'
              : field.startsWith('seoDescription')
                ? 'seoDescriptionTooLong'
                : 'titleRequired',
    };
  }
  return null;
}

/** The id of the published page that holds the terms or privacy role, from a refused save or publish; null for any other error. */
export const roleHolderId = (error: unknown): string | null =>
  error instanceof ApiError && error.code === 'PAGE_ROLE_TAKEN' ? error.field : null;

/** `/vi/chinh-sach-bao-mat`: where a published page is on the website. */
export const pagePublicPath = (locale: string, slug: string): string => `/${locale}/${slug}`;

// ------------------------------------------------------------------ the text editor's buttons

export type FormatKind = 'h2' | 'h3' | 'bold' | 'italic' | 'ul' | 'ol' | 'link';

export interface Formatted {
  value: string;
  /** The selection after the change (the caret when both are equal). */
  start: number;
  end: number;
}

export interface FormatWords {
  bold: string;
  italic: string;
  link: string;
}

const HEADING_PREFIX = /^#{1,6}[ \t]+/;
const LIST_PREFIX = /^(?:[-*+]|[0-9]{1,3}[.)])[ \t]+/;

/**
 * Applies one toolbar button to the selection `[start, end)` of `value`. Headings and lists work on whole lines (pressing the same
 * button again takes the mark off); bold, italic and link wrap the selected words, or put a placeholder in and select it so the
 * next keystroke replaces it. The result is the plain markup the page parser reads: nothing hidden.
 */
export function applyFormat(
  value: string,
  start: number,
  end: number,
  kind: FormatKind,
  words: FormatWords,
): Formatted {
  const from = Math.max(0, Math.min(start, end, value.length));
  const to = Math.max(from, Math.min(Math.max(start, end), value.length));
  if (kind === 'bold' || kind === 'italic') {
    const mark = kind === 'bold' ? '**' : '*';
    const selected = value.slice(from, to);
    const inner = selected === '' ? (kind === 'bold' ? words.bold : words.italic) : selected;
    const next = `${value.slice(0, from)}${mark}${inner}${mark}${value.slice(to)}`;
    return { value: next, start: from + mark.length, end: from + mark.length + inner.length };
  }
  if (kind === 'link') {
    const label = value.slice(from, to) || words.link;
    const url = 'https://';
    const next = `${value.slice(0, from)}[${label}](${url})${value.slice(to)}`;
    const urlStart = from + label.length + 3;
    return { value: next, start: urlStart, end: urlStart + url.length };
  }
  // Whole lines from the start of the first selected line to the end of the last.
  const blockStart = value.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = value.indexOf('\n', to);
  const blockEnd = lineEnd === -1 ? value.length : lineEnd;
  const lines = value.slice(blockStart, blockEnd).split('\n');
  const filled = lines.filter((line) => line.trim() !== '');
  const prefixOf = (index: number) =>
    kind === 'h2' ? '## ' : kind === 'h3' ? '### ' : kind === 'ul' ? '- ' : `${index + 1}. `;
  const matches = (line: string) =>
    kind === 'h2'
      ? /^##[ \t]+/.test(line) && !/^###/.test(line)
      : kind === 'h3'
        ? /^###[ \t]+/.test(line) && !/^####/.test(line)
        : kind === 'ul'
          ? /^[-*+][ \t]+/.test(line)
          : /^[0-9]{1,3}[.)][ \t]+/.test(line);
  const off = filled.length > 0 && filled.every(matches);
  let counter = 0;
  const changed = lines.map((line) => {
    if (line.trim() === '') return line;
    const bare = line.replace(kind === 'h2' || kind === 'h3' ? HEADING_PREFIX : LIST_PREFIX, '');
    if (off) return bare;
    const prefixed = `${prefixOf(counter)}${bare}`;
    counter += 1;
    return prefixed;
  });
  const replaced = changed.join('\n');
  return {
    value: `${value.slice(0, blockStart)}${replaced}${value.slice(blockEnd)}`,
    start: blockStart,
    end: blockStart + replaced.length,
  };
}
