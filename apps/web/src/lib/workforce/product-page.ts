import type {
  ProductCommitmentLine,
  ProductPublicPageCopy,
  ProductSettingsEditRequest,
} from '@lucy-spa/contracts';

/**
 * Phase 6 P6-6: the form of the public cosmetics page's copy (the hero and the commitment box), kept in the product settings.
 * The same limits as the API (which decides again): a block is written in both languages or not at all, a commitment line in both,
 * at most six lines. A block left empty is hidden on the public page.
 */

export const PAGE_LIMITS = Object.freeze({
  heroTitle: 120,
  heroText: 300,
  commitmentTitle: 80,
  commitmentLine: 120,
  commitmentLines: 6,
});

export interface PageLineDraft {
  /** A stable key for the row (the lines are reordered and removed). */
  key: number;
  textVi: string;
  textEn: string;
}

export interface PageDraft {
  mediaId: string | null;
  heroTitleVi: string;
  heroTitleEn: string;
  heroTextVi: string;
  heroTextEn: string;
  commitmentTitleVi: string;
  commitmentTitleEn: string;
  lines: PageLineDraft[];
}

export type PageProblem = 'heroTitle' | 'heroText' | 'commitmentTitle' | 'lines' | 'tooLong';

export function draftFromPage(copy: ProductPublicPageCopy): PageDraft {
  return {
    mediaId: copy.heroMediaId,
    heroTitleVi: copy.heroTitleVi ?? '',
    heroTitleEn: copy.heroTitleEn ?? '',
    heroTextVi: copy.heroTextVi ?? '',
    heroTextEn: copy.heroTextEn ?? '',
    commitmentTitleVi: copy.commitmentTitleVi ?? '',
    commitmentTitleEn: copy.commitmentTitleEn ?? '',
    lines: copy.commitmentItems.map((line, index) => ({ key: index, ...line })),
  };
}

const trimmed = (value: string): string => value.trim();
const length = (value: string): number => [...trimmed(value)].length;

/** Both boxes filled or both empty (a blank counts as empty). */
const paired = (vi: string, en: string): boolean => (trimmed(vi) === '') === (trimmed(en) === '');

/** The first thing wrong with the draft, or null. */
export function pageProblem(draft: PageDraft): PageProblem | null {
  if (!paired(draft.heroTitleVi, draft.heroTitleEn)) return 'heroTitle';
  if (!paired(draft.heroTextVi, draft.heroTextEn)) return 'heroText';
  if (!paired(draft.commitmentTitleVi, draft.commitmentTitleEn)) return 'commitmentTitle';
  if (
    draft.lines.length > PAGE_LIMITS.commitmentLines ||
    draft.lines.some((line) => trimmed(line.textVi) === '' || trimmed(line.textEn) === '')
  ) {
    return 'lines';
  }
  const over = (value: string, max: number) => length(value) > max;
  if (
    over(draft.heroTitleVi, PAGE_LIMITS.heroTitle) ||
    over(draft.heroTitleEn, PAGE_LIMITS.heroTitle) ||
    over(draft.heroTextVi, PAGE_LIMITS.heroText) ||
    over(draft.heroTextEn, PAGE_LIMITS.heroText) ||
    over(draft.commitmentTitleVi, PAGE_LIMITS.commitmentTitle) ||
    over(draft.commitmentTitleEn, PAGE_LIMITS.commitmentTitle) ||
    draft.lines.some(
      (line) =>
        over(line.textVi, PAGE_LIMITS.commitmentLine) ||
        over(line.textEn, PAGE_LIMITS.commitmentLine),
    )
  ) {
    return 'tooLong';
  }
  return null;
}

const orNull = (value: string): string | null => (trimmed(value) === '' ? null : trimmed(value));

export function copyOfDraft(draft: PageDraft): ProductPublicPageCopy {
  return {
    heroMediaId: draft.mediaId,
    heroTitleVi: orNull(draft.heroTitleVi),
    heroTitleEn: orNull(draft.heroTitleEn),
    heroTextVi: orNull(draft.heroTextVi),
    heroTextEn: orNull(draft.heroTextEn),
    commitmentTitleVi: orNull(draft.commitmentTitleVi),
    commitmentTitleEn: orNull(draft.commitmentTitleEn),
    commitmentItems: draft.lines.map((line): ProductCommitmentLine => ({
      textVi: trimmed(line.textVi),
      textEn: trimmed(line.textEn),
    })),
  };
}

export const pageChanged = (draft: PageDraft, initial: PageDraft): boolean =>
  JSON.stringify(copyOfDraft(draft)) !== JSON.stringify(copyOfDraft(initial));

/** The request that saves the page copy, or null when the draft is wrong. */
export function pageRequest(
  draft: PageDraft,
  rowVersion: number,
): ProductSettingsEditRequest | null {
  if (pageProblem(draft) !== null) return null;
  return { expectedRowVersion: rowVersion, publicPage: copyOfDraft(draft) };
}

export const nextLineKey = (lines: readonly PageLineDraft[]): number =>
  lines.reduce((max, line) => Math.max(max, line.key), -1) + 1;
