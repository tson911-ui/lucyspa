import {
  AI_SEO_KINDS,
  AI_SEO_LIMITS,
  AI_SEO_STATUSES,
  type AiSeoApplyRequest,
  type AiSeoContent,
  type AiSeoDetail,
  type AiSeoEditRequest,
  type AiSeoKind,
  type AiSeoStatus,
} from '@lucy-spa/contracts';
import type { Tone } from '../../components/workforce/ui';

/** URL state of the drafts list: the status and kind filters and the page (20 per page, decided by the server). */
export const AI_SEO_LIST_DEFAULTS: { status: string; kind: string; page: number } = {
  status: '',
  kind: '',
  page: 1,
};
export type AiSeoListState = typeof AI_SEO_LIST_DEFAULTS;
export const AI_SEO_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeAiSeoList(state: AiSeoListState): AiSeoListState {
  return {
    status: (AI_SEO_STATUSES as readonly string[]).includes(state.status) ? state.status : '',
    kind: (AI_SEO_KINDS as readonly string[]).includes(state.kind) ? state.kind : '',
    page: Number.isInteger(state.page) && state.page >= 1 ? state.page : 1,
  };
}

export const statusTone = (status: AiSeoStatus): Tone =>
  status === 'APPLIED'
    ? 'success'
    : status === 'DRAFT_READY'
      ? 'info'
      : status === 'FAILED' || status === 'NEEDS_ATTENTION' || status === 'STALE'
        ? 'warning'
        : 'neutral';

/** A draft the worker is still on: the list asks again every few seconds while any exist. */
export const isWorking = (status: AiSeoStatus): boolean =>
  status === 'QUEUED' || status === 'GENERATING';

/** The text the reviewer sees in the three boxes: the saved edit, else the model's draft. Empty strings when there is none. */
export interface SeoForm {
  seoDescriptionVi: string;
  seoDescriptionEn: string;
  englishText: string;
}

export function formOf(detail: AiSeoDetail): SeoForm {
  const source = detail.edited ?? detail.draft;
  return {
    seoDescriptionVi: source?.seoDescriptionVi ?? '',
    seoDescriptionEn: source?.seoDescriptionEn ?? '',
    englishText: source?.englishText ?? '',
  };
}

/** Whether the English text is part of this draft at all (the target had none and the Vietnamese text exists). */
export const hasEnglishText = (detail: AiSeoDetail): boolean =>
  (detail.edited ?? detail.draft)?.englishText != null;

export function isDirty(form: SeoForm, detail: AiSeoDetail): boolean {
  const saved = formOf(detail);
  return (
    form.seoDescriptionVi !== saved.seoDescriptionVi ||
    form.seoDescriptionEn !== saved.seoDescriptionEn ||
    form.englishText !== saved.englishText
  );
}

export function editRequest(form: SeoForm, detail: AiSeoDetail): AiSeoEditRequest {
  const content: AiSeoContent = {
    seoDescriptionVi: form.seoDescriptionVi.trim(),
    seoDescriptionEn: form.seoDescriptionEn.trim(),
    englishText: hasEnglishText(detail) ? form.englishText.trim() : null,
  };
  return { expectedRowVersion: detail.rowVersion, content };
}

export function applyRequest(detail: AiSeoDetail, acknowledge: boolean): AiSeoApplyRequest {
  return {
    expectedRowVersion: detail.rowVersion,
    ...(acknowledge ? { acknowledgeWarnings: true } : {}),
  };
}

/** The most the search description may be, in characters (the house target; the box counts against it). */
export const SEO_TARGET = AI_SEO_LIMITS.descriptionTarget;

/** The code a failed draft carries, as one the dictionary has a sentence for. */
export function errorKey(code: string | null, known: readonly string[]): string {
  return code !== null && known.includes(code) ? code : 'OTHER';
}

export const isConflict = (error: unknown): boolean =>
  Reflect.get(Object(error), 'code') === 'CONFLICT';

/** The server's field name for a refused value, as the form's field. */
export function serverField(error: unknown): keyof SeoForm | null {
  const field = Reflect.get(Object(error), 'field') as unknown;
  if (typeof field !== 'string') return null;
  return (
    (['seoDescriptionVi', 'seoDescriptionEn', 'englishText'] as const).find(
      (name) => name === field,
    ) ?? null
  );
}

export const kindOf = (value: string): AiSeoKind | null =>
  (AI_SEO_KINDS as readonly string[]).includes(value) ? (value as AiSeoKind) : null;
