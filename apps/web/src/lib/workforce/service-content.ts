import {
  SERVICE_CONTENT_LIMITS,
  type ServiceFaqItem,
  type ServiceResponse,
  type ServiceUpdateRequest,
} from '@lucy-spa/contracts';

/**
 * The optional page content of a service as the admin form edits it (redesign group 1, C11b): two plain-text lists (one item per
 * line) and the question/answer pairs, in Vietnamese and in English. The API trims and drops blank items too; the form does the same
 * so "changed" means a real change, and it stops at the same limits the API enforces.
 */
export interface ServiceContentForm {
  includedVi: string;
  includedEn: string;
  stepsVi: string;
  stepsEn: string;
  faqVi: ServiceFaqItem[];
  faqEn: ServiceFaqItem[];
}

export const LIST_KEYS = ['includedVi', 'includedEn', 'stepsVi', 'stepsEn'] as const;
export const FAQ_KEYS = ['faqVi', 'faqEn'] as const;

export const linesOf = (list: readonly string[]): string => list.join('\n');

/** The items of a one-per-line text: trimmed, blank lines dropped. */
export const itemsOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** A pair with both sides blank is nothing; a pair with one side blank is a problem (see `contentProblem`). */
export const pairsOf = (rows: readonly ServiceFaqItem[]): ServiceFaqItem[] =>
  rows
    .map((row) => ({ question: row.question.trim(), answer: row.answer.trim() }))
    .filter((row) => row.question !== '' || row.answer !== '');

export function contentOf(service: ServiceResponse): ServiceContentForm {
  return {
    includedVi: linesOf(service.includedVi),
    includedEn: linesOf(service.includedEn),
    stepsVi: linesOf(service.stepsVi),
    stepsEn: linesOf(service.stepsEn),
    faqVi: service.faqVi.map((row) => ({ ...row })),
    faqEn: service.faqEn.map((row) => ({ ...row })),
  };
}

const codePoints = (value: string): number => [...value].length;

/** The field that breaks a limit (so the form can say which), or null when the content can be saved. */
export function contentProblem(
  form: ServiceContentForm,
): (typeof LIST_KEYS)[number] | (typeof FAQ_KEYS)[number] | null {
  for (const key of LIST_KEYS) {
    const items = itemsOf(form[key]);
    if (
      items.length > SERVICE_CONTENT_LIMITS.listItems ||
      items.some((item) => codePoints(item) > SERVICE_CONTENT_LIMITS.listItemMaxCodePoints)
    ) {
      return key;
    }
  }
  for (const key of FAQ_KEYS) {
    const pairs = pairsOf(form[key]);
    if (
      pairs.length > SERVICE_CONTENT_LIMITS.faqItems ||
      pairs.some(
        (row) =>
          row.question === '' ||
          row.answer === '' ||
          codePoints(row.question) > SERVICE_CONTENT_LIMITS.faqQuestionMaxCodePoints ||
          codePoints(row.answer) > SERVICE_CONTENT_LIMITS.faqAnswerMaxCodePoints,
      )
    ) {
      return key;
    }
  }
  return null;
}

/** Only the content fields that really changed, ready for the update request. */
export function contentChanges(
  form: ServiceContentForm,
  service: ServiceResponse,
): Pick<
  ServiceUpdateRequest,
  'includedVi' | 'includedEn' | 'stepsVi' | 'stepsEn' | 'faqVi' | 'faqEn'
> {
  const body: Record<string, unknown> = {};
  for (const key of LIST_KEYS) {
    const next = itemsOf(form[key]);
    if (JSON.stringify(next) !== JSON.stringify(service[key])) body[key] = next;
  }
  for (const key of FAQ_KEYS) {
    const next = pairsOf(form[key]);
    if (JSON.stringify(next) !== JSON.stringify(service[key])) body[key] = next;
  }
  return body;
}

/** Whether the form differs from the saved content (the Save button's "dirty"). */
export const contentDirty = (form: ServiceContentForm, service: ServiceResponse): boolean =>
  Object.keys(contentChanges(form, service)).length > 0;
