import type {
  WebsitePopupInput,
  WebsitePopupMedia,
  WebsitePopupResponse,
  WebsitePopupStatus,
} from '@lucy-spa/contracts';
import type { PromoContent } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { ApiError } from '../api/client';
import { POPUP_LIMITS, validPopupUrl } from '../popup-core';
import { isoToVnLocal, vnLocalToIso } from './discounts';
import { mediaVariantUrl } from './media';

/**
 * Promotional popup, admin side (docs/UXUI_REDESIGN_DESIGN.md 16.5). The server is authoritative for every
 * rule; these helpers only save a round trip and shape the form. Times are typed in Vietnam time (Q-CM6).
 */

export type PopupTone = 'neutral' | 'info' | 'success' | 'warning';

export const popupTone = (status: WebsitePopupStatus): PopupTone =>
  status === 'ACTIVE'
    ? 'success'
    : status === 'SCHEDULED'
      ? 'info'
      : status === 'ENDED'
        ? 'neutral'
        : 'warning';

// ------------------------------------------------------------------ form

export interface PopupForm {
  /** The chosen library image; the request sends only its id. */
  media: WebsitePopupMedia | null;
  titleVi: string;
  titleEn: string;
  bodyVi: string;
  bodyEn: string;
  ctaLabelVi: string;
  ctaLabelEn: string;
  ctaUrl: string;
  /** `datetime-local` text in Vietnam time. */
  startsAt: string;
  endsAt: string;
  isEnabled: boolean;
  /** The season this popup follows ('' = none). A followed season's window replaces the dates above. */
  seasonId: string;
}

const DAY_MS = 86_400_000;

/** A new popup starts now and runs a week; it is a draft until the Owner turns it on. */
export function emptyPopupForm(now: Date = new Date(), seasonId = ''): PopupForm {
  return {
    media: null,
    titleVi: '',
    titleEn: '',
    bodyVi: '',
    bodyEn: '',
    ctaLabelVi: '',
    ctaLabelEn: '',
    ctaUrl: '',
    startsAt: isoToVnLocal(now.toISOString()),
    endsAt: isoToVnLocal(new Date(now.getTime() + 7 * DAY_MS).toISOString()),
    isEnabled: false,
    seasonId,
  };
}

export function formOfPopup(popup: WebsitePopupResponse): PopupForm {
  return {
    media: popup.media,
    titleVi: popup.titleVi ?? '',
    titleEn: popup.titleEn ?? '',
    bodyVi: popup.bodyVi ?? '',
    bodyEn: popup.bodyEn ?? '',
    ctaLabelVi: popup.ctaLabelVi ?? '',
    ctaLabelEn: popup.ctaLabelEn ?? '',
    ctaUrl: popup.ctaUrl ?? '',
    startsAt: isoToVnLocal(popup.startsAt),
    endsAt: isoToVnLocal(popup.endsAt),
    isEnabled: popup.isEnabled,
    seasonId: popup.seasonId ?? '',
  };
}

const text = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export type PopupProblem =
  | 'content'
  | 'titleVi'
  | 'titleEn'
  | 'bodyVi'
  | 'bodyEn'
  | 'ctaLabelVi'
  | 'ctaLabelEn'
  | 'ctaLabel'
  | 'ctaUrl'
  | 'startsAt'
  | 'endsAt'
  | 'window';

/** The form field a problem belongs to (the first invalid control to focus). */
export const problemField = (problem: PopupProblem): keyof PopupForm => {
  switch (problem) {
    case 'content':
      return 'titleVi';
    case 'ctaLabel':
      return 'ctaLabelVi';
    case 'window':
      return 'endsAt';
    default:
      return problem;
  }
};

const length = (value: string) => [...value.trim()].length;

/** The request for the API, or the first problem found (so the form can say what to fix). */
export function popupInputOf(
  form: PopupForm,
): { body: WebsitePopupInput } | { problem: PopupProblem } {
  const { title, body, ctaLabel } = POPUP_LIMITS;
  const limits: [PopupProblem, string, number][] = [
    ['titleVi', form.titleVi, title],
    ['titleEn', form.titleEn, title],
    ['bodyVi', form.bodyVi, body],
    ['bodyEn', form.bodyEn, body],
    ['ctaLabelVi', form.ctaLabelVi, ctaLabel],
    ['ctaLabelEn', form.ctaLabelEn, ctaLabel],
  ];
  for (const [problem, value, max] of limits) if (length(value) > max) return { problem };
  if (form.media === null && text(form.titleVi) === null && text(form.titleEn) === null) {
    return { problem: 'content' };
  }
  const url = text(form.ctaUrl);
  const hasLabel = text(form.ctaLabelVi) !== null || text(form.ctaLabelEn) !== null;
  if (url !== null && !validPopupUrl(url)) return { problem: 'ctaUrl' };
  if (url !== null && !hasLabel) return { problem: 'ctaLabel' };
  if (url === null && hasLabel) return { problem: 'ctaUrl' };
  const startsAt = vnLocalToIso(form.startsAt);
  const endsAt = vnLocalToIso(form.endsAt);
  if (startsAt === null) return { problem: 'startsAt' };
  if (endsAt === null) return { problem: 'endsAt' };
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return { problem: 'window' };
  return {
    body: {
      mediaId: form.media?.id ?? null,
      titleVi: text(form.titleVi),
      titleEn: text(form.titleEn),
      bodyVi: text(form.bodyVi),
      bodyEn: text(form.bodyEn),
      ctaLabelVi: text(form.ctaLabelVi),
      ctaLabelEn: text(form.ctaLabelEn),
      ctaUrl: url,
      startsAt,
      endsAt,
      isEnabled: form.isEnabled,
      // Always sent: an omitted `seasonId` would unlink a popup that follows a season.
      seasonId: form.seasonId === '' ? null : form.seasonId,
    },
  };
}

export const popupFormChanged = (a: PopupForm, b: PopupForm): boolean =>
  JSON.stringify(a) !== JSON.stringify(b);

/** The name a popup goes by in lists, toasts and warnings: its title, else its image's file name. */
export function popupName(
  popup: Pick<WebsitePopupResponse, 'titleVi' | 'titleEn' | 'media'>,
  locale: Locale,
  fallback: string,
): string {
  const title =
    locale === 'vi' ? (popup.titleVi ?? popup.titleEn) : (popup.titleEn ?? popup.titleVi);
  return title ?? popup.media?.filename ?? fallback;
}

// ------------------------------------------------------------------ preview

/** The chosen image as the preview draws it: the admin route's medium rendition and its own description. */
export function previewImageOf(
  media: WebsitePopupMedia | null,
  locale: Locale,
): { src: string; alt: string; width: number; height: number } | null {
  if (media === null) return null;
  const alt = locale === 'vi' ? (media.altVi ?? media.altEn) : (media.altEn ?? media.altVi);
  return {
    src: mediaVariantUrl(media.id, 'md'),
    alt: alt ?? media.filename,
    width: media.width,
    height: media.height,
  };
}

/** What the live popup would show for one language, from the form (the same rules the API applies). */
export function previewContent(
  form: PopupForm,
  locale: Locale,
  image: { src: string; alt: string; width: number; height: number } | null,
): PromoContent | null {
  const pick = (vi: string, en: string) =>
    (locale === 'vi' ? (text(vi) ?? text(en)) : (text(en) ?? text(vi))) ?? null;
  const title = pick(form.titleVi, form.titleEn);
  if (title === null && image === null) return null;
  const label = pick(form.ctaLabelVi, form.ctaLabelEn);
  const href = text(form.ctaUrl);
  return {
    title,
    body: pick(form.bodyVi, form.bodyEn),
    image,
    cta: label !== null && href !== null ? { label, href } : null,
  };
}

// ------------------------------------------------------------------ errors

/** The other popup an overlap refusal names (the API sends its id as the field). */
export const overlapId = (error: unknown): string | null =>
  error instanceof ApiError && error.code === 'POPUP_OVERLAP' ? error.field : null;
