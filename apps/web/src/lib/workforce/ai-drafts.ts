import {
  AI_DRAFT_STATUSES,
  type AiApproveAllSkipReason,
  type AiDraftContent,
  type AiDraftDetail,
  type AiDraftEditRequest,
  type AiDraftSections,
  type AiDraftStatus,
} from '@lucy-spa/contracts';
import type { Tone } from '../../components/workforce/ui';

/** URL state of the drafts list: the status filter and the page (20 per page, decided by the server). */
export const AI_DRAFT_LIST_DEFAULTS: { status: string; page: number } = { status: '', page: 1 };
export type AiDraftListState = typeof AI_DRAFT_LIST_DEFAULTS;
export const AI_DRAFT_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeAiDraftList(state: AiDraftListState): AiDraftListState {
  return {
    status: (AI_DRAFT_STATUSES as readonly string[]).includes(state.status) ? state.status : '',
    page: Number.isInteger(state.page) && state.page >= 1 ? state.page : 1,
  };
}

export const statusTone = (status: AiDraftStatus): Tone =>
  status === 'APPLIED'
    ? 'success'
    : status === 'DRAFT_READY'
      ? 'info'
      : status === 'FAILED' || status === 'NEEDS_ATTENTION' || status === 'STALE'
        ? 'warning'
        : 'neutral';

/** Where a draft is worked on. */
export const draftHref = (base: string, id: string): string => `${base}/product-rewrites/${id}`;

// ------------------------------------------------------------------------------------------------------------ the editable fields

export type SectionKey = keyof AiDraftSections;
export type TextFieldKey = 'descriptionVi' | 'descriptionEn' | 'nameEn';
export type SeoFieldKey = 'seoTitleVi' | 'seoTitleEn' | 'seoDescriptionVi' | 'seoDescriptionEn';

/** One row of the side-by-side editor: where the text lives, its label, how tall its box starts and the length it should keep. */
export interface FieldSpec {
  /** A unique id of the row, used in the DOM and in warnings (`field` of a warning is `path`). */
  path: string;
  label: string;
  language: 'vi' | 'en';
  kind: 'text' | 'section' | 'seo';
  /** The key inside `AiDraftContent` (or the section key). */
  key: string;
  /** Recommended maximum (the SEO house rules); the screen counts characters against it. */
  limit?: number;
}

const SECTION_KEYS: readonly SectionKey[] = ['benefits', 'ingredients', 'usage', 'suitableFor'];

/** The rows of one language tab in reading order: description, the four sections, then the search texts (and the English name). */
export function fieldSpecs(language: 'vi' | 'en'): FieldSpec[] {
  const suffix = language === 'vi' ? 'Vi' : 'En';
  return [
    ...(language === 'en'
      ? [{ path: 'nameEn', label: 'nameEn', language, kind: 'text', key: 'nameEn' } as FieldSpec]
      : []),
    {
      path: `description${suffix}`,
      label: `description${suffix}`,
      language,
      kind: 'text',
      key: `description${suffix}`,
    },
    ...SECTION_KEYS.map((key): FieldSpec => ({
      path: `sections${suffix}.${key}`,
      label: key,
      language,
      kind: 'section',
      key,
    })),
    {
      path: `seoTitle${suffix}`,
      label: `seoTitle${suffix}`,
      language,
      kind: 'seo',
      key: `seoTitle${suffix}`,
      limit: 60,
    },
    {
      path: `seoDescription${suffix}`,
      label: `seoDescription${suffix}`,
      language,
      kind: 'seo',
      key: `seoDescription${suffix}`,
      limit: 155,
    },
  ];
}

const sectionsKey = (language: 'vi' | 'en') => (language === 'vi' ? 'sectionsVi' : 'sectionsEn');

/** The text of a field of some content ('' when empty). */
export function readField(content: AiDraftContent, spec: FieldSpec): string {
  if (spec.kind === 'section') {
    return content[sectionsKey(spec.language)][spec.key as SectionKey] ?? '';
  }
  return String(Reflect.get(content, spec.key) ?? '');
}

/** The content with one field changed (a new object; an emptied section becomes null). */
export function writeField(
  content: AiDraftContent,
  spec: FieldSpec,
  value: string,
): AiDraftContent {
  if (spec.kind === 'section') {
    const key = sectionsKey(spec.language);
    return {
      ...content,
      [key]: { ...content[key], [spec.key]: value.trim() === '' ? null : value },
    };
  }
  return { ...content, [spec.key]: value };
}

/** What the reviewer is working on: their saved edit, else the model's draft. Null while there is no draft. */
export const workingContent = (detail: AiDraftDetail): AiDraftContent | null =>
  detail.edited ?? detail.draft;

const same = (a: AiDraftContent, b: AiDraftContent): boolean =>
  JSON.stringify(normalizeContent(a)) === JSON.stringify(normalizeContent(b));

function normalizeContent(content: AiDraftContent): AiDraftContent {
  const sections = (value: AiDraftSections): AiDraftSections => ({
    benefits: value.benefits?.trim() || null,
    ingredients: value.ingredients?.trim() || null,
    usage: value.usage?.trim() || null,
    suitableFor: value.suitableFor?.trim() || null,
  });
  return {
    descriptionVi: content.descriptionVi.trim(),
    sectionsVi: sections(content.sectionsVi),
    descriptionEn: content.descriptionEn.trim(),
    sectionsEn: sections(content.sectionsEn),
    nameEn: content.nameEn.trim(),
    seoTitleVi: content.seoTitleVi.trim(),
    seoTitleEn: content.seoTitleEn.trim(),
    seoDescriptionVi: content.seoDescriptionVi.trim(),
    seoDescriptionEn: content.seoDescriptionEn.trim(),
  };
}

/** True when the form differs from what is saved on the server (the edit, or the draft when nothing was edited). */
export function isDirty(
  detail: AiDraftDetail,
  working: AiDraftContent | null,
  useName: boolean,
): boolean {
  const saved = workingContent(detail);
  if (working === null || saved === null) return false;
  return !same(working, saved) || useName !== detail.useNameSuggestion;
}

export function editRequest(
  detail: AiDraftDetail,
  working: AiDraftContent,
  useName: boolean,
): AiDraftEditRequest {
  return {
    expectedRowVersion: detail.rowVersion,
    content: normalizeContent(working),
    useNameSuggestion: useName,
  };
}

/** The textarea rows a text of this length starts with (3 to 12). */
export const rowsFor = (text: string): number =>
  Math.min(14, Math.max(3, Math.ceil(text.length / 44) + 1));

/** The reason line of a failed or refused item, as a dictionary key. */
export const errorKey = (code: string | null, known: readonly string[]): string =>
  code !== null && known.includes(code) ? code : 'OTHER';

/** The field a failed save points at, when the server names one. */
export function serverField(error: unknown): string | null {
  const code = Reflect.get(Object(error), 'code') as unknown;
  const field = Reflect.get(Object(error), 'field') as unknown;
  return code === 'VALIDATION_FAILED' && typeof field === 'string' ? field : null;
}

export const isConflict = (error: unknown): boolean =>
  Reflect.get(Object(error), 'code') === 'CONFLICT';

/** "reason (n), reason (n)" for the drafts a confirm left out, most common first; null when none were left out. */
export function skipReasonsLine(
  select: { skipReasons: Record<AiApproveAllSkipReason, string> },
  counts: Partial<Record<AiApproveAllSkipReason, number>>,
): string | null {
  const parts = (Object.entries(counts) as [AiApproveAllSkipReason, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${select.skipReasons[reason]} (${count})`);
  return parts.length === 0 ? null : parts.join(', ');
}
