import type { PublicPopupResponse } from '@lucy-spa/contracts';
import type { PromoContent } from '@lucy-spa/ui';
import type { Locale } from '../i18n/locales';

/**
 * The promotional popup rules both sides share (docs/UXUI_REDESIGN_DESIGN.md 16.5): the link rule, the
 * limits, and what the public site does with the API's answer. Nothing here knows about the workforce app.
 */

export const POPUP_LIMITS = Object.freeze({ title: 120, body: 300, ctaLabel: 40, ctaUrl: 500 });

/** The same link rule as the server and the database: an internal locale path or an https URL. */
export function validPopupUrl(value: string): boolean {
  if ([...value].length > POPUP_LIMITS.ctaUrl) return false;
  if (/^\/(vi|en|\{locale\})(\/[^\s<>"'\\]*)?$/.test(value)) return true;
  if (!/^https:\/\/[^\s<>"'\\/]/.test(value) || /[\s<>"'\\]/.test(value)) return false;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.username === '' && url.password === '';
}

/** The public popup request: anonymous, no cookie, cached for a minute by the API. */
export const publicPopupUrl = (locale: Locale) => `/api/v1/public/website/popup?locale=${locale}`;

/** Once per browser session; an edited popup (new row version) shows again (Q-CM4). */
export const popupSeenKey = (popup: Pick<PublicPopupResponse, 'id' | 'rowVersion'>) =>
  `ls-popup-seen:${popup.id}:${popup.rowVersion}`;

export const PUBLIC_POPUP_SIZES = '(max-width: 640px) 90vw, 560px';

/** The card for the public popup, with the image's renditions as a `srcset`. */
export function publicPopupContent(popup: PublicPopupResponse): PromoContent {
  const image = popup.image;
  const first = image?.sources[0];
  const many = (image?.sources.length ?? 0) > 1;
  return {
    title: popup.title,
    body: popup.body,
    image:
      image && first
        ? {
            src: first.url,
            srcSet: many
              ? image.sources.map((source) => `${source.url} ${source.width}w`).join(', ')
              : undefined,
            sizes: many ? PUBLIC_POPUP_SIZES : undefined,
            alt: image.alt,
            width: image.width,
            height: image.height,
          }
        : null,
    cta:
      popup.ctaLabel !== null && popup.ctaUrl !== null
        ? { label: popup.ctaLabel, href: popup.ctaUrl }
        : null,
  };
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * Narrow an untrusted JSON image to what the page may draw, or null. Only the API's own public image route is
 * accepted: public content never points the page at another origin. Shared by the popup and the slider.
 */
export function asPublicImage(raw: unknown): NonNullable<PublicPopupResponse['image']> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const i = raw as Record<string, unknown>;
  const sources = Array.isArray(i['sources'])
    ? (i['sources'] as unknown[]).flatMap((source) => {
        const s = (typeof source === 'object' ? source : null) as Record<string, unknown> | null;
        const url = text(s?.['url']);
        const width = s?.['width'];
        return url !== null && url.startsWith('/api/v1/public/media/') && typeof width === 'number'
          ? [{ url, width }]
          : [];
      })
    : [];
  const { width, height } = i;
  if (sources.length === 0 || typeof width !== 'number' || typeof height !== 'number') return null;
  return { alt: typeof i['alt'] === 'string' ? i['alt'] : '', width, height, sources };
}

/** Narrow an untrusted JSON body to the popup the page may show; anything else is "no popup". */
export function asPublicPopup(value: unknown): PublicPopupResponse | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const id = text(v['id']);
  const rowVersion = v['rowVersion'];
  if (id === null || typeof rowVersion !== 'number' || !Number.isSafeInteger(rowVersion)) {
    return null;
  }
  const image = asPublicImage(v['image']);
  const ctaUrl = text(v['ctaUrl']);
  const ctaLabel = text(v['ctaLabel']);
  const link = ctaUrl !== null && ctaLabel !== null && validPopupUrl(ctaUrl);
  const popup: PublicPopupResponse = {
    id,
    rowVersion,
    title: text(v['title']),
    body: text(v['body']),
    ctaLabel: link ? ctaLabel : null,
    ctaUrl: link ? ctaUrl : null,
    image,
  };
  return popup.title === null && popup.image === null ? null : popup;
}

export interface PopupFetchResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

/** The popup to show now, or null (none live, already seen this session, or any failure: never blocks the page). */
export async function loadPublicPopup(
  fetcher: (
    url: string,
    init: { credentials: 'omit'; headers: Record<string, string> },
  ) => Promise<PopupFetchResponse>,
  locale: Locale,
  seen: (key: string) => boolean,
): Promise<PublicPopupResponse | null> {
  try {
    const response = await fetcher(publicPopupUrl(locale), {
      credentials: 'omit',
      headers: { accept: 'application/json' },
    });
    if (response.status === 204 || !response.ok) return null;
    const popup = asPublicPopup(await response.json());
    return popup && !seen(popupSeenKey(popup)) ? popup : null;
  } catch {
    return null;
  }
}

/** sessionStorage can be blocked or full: the popup then simply shows (once per page load). */
export function sessionSeen(storage: Pick<Storage, 'getItem'> | null): (key: string) => boolean {
  return (key) => {
    try {
      const value = storage?.getItem(key);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  };
}

export function markSessionSeen(storage: Pick<Storage, 'setItem'> | null, key: string): void {
  try {
    storage?.setItem(key, '1');
  } catch {
    // Blocked or full: the popup may show again on the next page load; never an error.
  }
}
