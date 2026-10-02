import type {
  WebsitePopupMedia,
  WebsiteSlideInput,
  WebsiteSlideResponse,
  WebsiteSlideStatus,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { ApiError } from '../api/client';
import { SLIDE_LIMITS, validSlideUrl } from '../slider-core';
import { isoToVnLocal, vnLocalToIso } from './discounts';

/**
 * Homepage slider, admin side (docs/UXUI_REDESIGN_DESIGN.md 16.6). The server is authoritative for every
 * rule; these helpers only save a round trip and shape the form. Times are typed in Vietnam time (Q-CM6) and
 * both ends are optional (no start = from now on, no end = until further notice).
 */

export const SLIDE_PAGE_SIZE = 20;

export type SlideTone = 'neutral' | 'info' | 'success' | 'warning';

export const slideTone = (status: WebsiteSlideStatus): SlideTone =>
  status === 'VISIBLE'
    ? 'success'
    : status === 'SCHEDULED'
      ? 'info'
      : status === 'ENDED'
        ? 'neutral'
        : 'warning';

// ------------------------------------------------------------------ form

export interface SlideForm {
  /** The desktop image (required); the request sends only its id. */
  media: WebsitePopupMedia | null;
  /** The phone image (optional). */
  mobileMedia: WebsitePopupMedia | null;
  titleVi: string;
  titleEn: string;
  subtitleVi: string;
  subtitleEn: string;
  linkLabelVi: string;
  linkLabelEn: string;
  linkUrl: string;
  altVi: string;
  altEn: string;
  /** `datetime-local` text in Vietnam time; empty = open end. */
  startsAt: string;
  endsAt: string;
  isEnabled: boolean;
  /** The season this slide follows ('' = none). A followed season's window replaces the dates above. */
  seasonId: string;
}

/** A new slide is hidden until the Owner turns it on, and always shown once on. */
export function emptySlideForm(seasonId = ''): SlideForm {
  return {
    media: null,
    mobileMedia: null,
    titleVi: '',
    titleEn: '',
    subtitleVi: '',
    subtitleEn: '',
    linkLabelVi: '',
    linkLabelEn: '',
    linkUrl: '',
    altVi: '',
    altEn: '',
    startsAt: '',
    endsAt: '',
    isEnabled: false,
    seasonId,
  };
}

export function formOfSlide(slide: WebsiteSlideResponse): SlideForm {
  return {
    media: slide.media,
    mobileMedia: slide.mobileMedia,
    titleVi: slide.titleVi ?? '',
    titleEn: slide.titleEn ?? '',
    subtitleVi: slide.subtitleVi ?? '',
    subtitleEn: slide.subtitleEn ?? '',
    linkLabelVi: slide.linkLabelVi ?? '',
    linkLabelEn: slide.linkLabelEn ?? '',
    linkUrl: slide.linkUrl ?? '',
    altVi: slide.altVi ?? '',
    altEn: slide.altEn ?? '',
    startsAt: slide.startsAt === null ? '' : isoToVnLocal(slide.startsAt),
    endsAt: slide.endsAt === null ? '' : isoToVnLocal(slide.endsAt),
    isEnabled: slide.isEnabled,
    seasonId: slide.seasonId ?? '',
  };
}

const text = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export type SlideProblem =
  | 'media'
  | 'mobileMedia'
  | 'titleVi'
  | 'titleEn'
  | 'subtitleVi'
  | 'subtitleEn'
  | 'linkLabelVi'
  | 'linkLabelEn'
  | 'linkLabel'
  | 'linkUrl'
  | 'altVi'
  | 'altEn'
  | 'startsAt'
  | 'endsAt'
  | 'window';

/** The form field a problem belongs to (the first invalid control to focus). */
export const problemField = (problem: SlideProblem): keyof SlideForm => {
  switch (problem) {
    case 'linkLabel':
      return 'linkLabelVi';
    case 'window':
      return 'endsAt';
    default:
      return problem;
  }
};

const length = (value: string) => [...value.trim()].length;

/** The request for the API, or the first problem found (so the form can say what to fix). */
export function slideInputOf(
  form: SlideForm,
): { body: WebsiteSlideInput } | { problem: SlideProblem } {
  const { title, subtitle, linkLabel, alt } = SLIDE_LIMITS;
  if (form.media === null) return { problem: 'media' };
  if (form.mobileMedia !== null && form.mobileMedia.id === form.media.id) {
    return { problem: 'mobileMedia' };
  }
  const limits: [SlideProblem, string, number][] = [
    ['titleVi', form.titleVi, title],
    ['titleEn', form.titleEn, title],
    ['subtitleVi', form.subtitleVi, subtitle],
    ['subtitleEn', form.subtitleEn, subtitle],
    ['linkLabelVi', form.linkLabelVi, linkLabel],
    ['linkLabelEn', form.linkLabelEn, linkLabel],
    ['altVi', form.altVi, alt],
    ['altEn', form.altEn, alt],
  ];
  for (const [problem, value, max] of limits) if (length(value) > max) return { problem };
  const url = text(form.linkUrl);
  const hasLabel = text(form.linkLabelVi) !== null || text(form.linkLabelEn) !== null;
  if (url !== null && !validSlideUrl(url)) return { problem: 'linkUrl' };
  if (url !== null && !hasLabel) return { problem: 'linkLabel' };
  if (url === null && hasLabel) return { problem: 'linkUrl' };
  const start = text(form.startsAt);
  const end = text(form.endsAt);
  const startsAt = start === null ? null : vnLocalToIso(start);
  const endsAt = end === null ? null : vnLocalToIso(end);
  if (start !== null && startsAt === null) return { problem: 'startsAt' };
  if (end !== null && endsAt === null) return { problem: 'endsAt' };
  if (startsAt !== null && endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { problem: 'window' };
  }
  return {
    body: {
      mediaId: form.media.id,
      mobileMediaId: form.mobileMedia?.id ?? null,
      titleVi: text(form.titleVi),
      titleEn: text(form.titleEn),
      subtitleVi: text(form.subtitleVi),
      subtitleEn: text(form.subtitleEn),
      linkUrl: url,
      linkLabelVi: text(form.linkLabelVi),
      linkLabelEn: text(form.linkLabelEn),
      altVi: text(form.altVi),
      altEn: text(form.altEn),
      startsAt,
      endsAt,
      isEnabled: form.isEnabled,
      // Always sent: an omitted `seasonId` would unlink a slide that follows a season.
      seasonId: form.seasonId === '' ? null : form.seasonId,
    },
  };
}

export const slideFormChanged = (a: SlideForm, b: SlideForm): boolean =>
  JSON.stringify(a) !== JSON.stringify(b);

// ------------------------------------------------------------------ list

/** The name a slide goes by in lists, toasts and warnings: its title, else its image's file name. */
export function slideName(
  slide: Pick<WebsiteSlideResponse, 'titleVi' | 'titleEn' | 'media'>,
  locale: Locale,
  fallback: string,
): string {
  const title =
    locale === 'vi' ? (slide.titleVi ?? slide.titleEn) : (slide.titleEn ?? slide.titleVi);
  return title ?? slide.media.filename ?? fallback;
}

/** How many slides are on screen right now (the Q-CM7 limit is on this count). */
export const visibleCount = (slides: readonly Pick<WebsiteSlideResponse, 'status'>[]): number =>
  slides.filter((slide) => slide.status === 'VISIBLE').length;

/**
 * The whole slider's ids in the new order after one page of the list was rearranged. The list is paged (20
 * a page) but the API takes the whole order in one call, so the page's new order replaces the page's slice.
 */
export function applyPageOrder(
  allIds: readonly string[],
  page: number,
  pageSize: number,
  pageIds: readonly string[],
): string[] {
  const start = (page - 1) * pageSize;
  return [...allIds.slice(0, start), ...pageIds, ...allIds.slice(start + pageIds.length)];
}

/** The slides in the order the list shows them: the saved order, except while a reorder is being saved. */
export function inOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[] | null,
): T[] {
  if (order === null) return [...items];
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  // A slide the order does not know yet (added meanwhile) keeps its place at the end.
  const known = new Set(order);
  return [...ordered, ...items.filter((item) => !known.has(item.id))];
}

export const slideLimitRefused = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'SLIDE_LIMIT';
