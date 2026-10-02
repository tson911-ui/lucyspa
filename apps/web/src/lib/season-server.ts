import type { PublicSeasonResponse } from '@lucy-spa/contracts';
import type { Locale } from '../i18n/locales';
import { parsePublicSeason, publicSeasonUrl } from './season-core';

/** Where the API listens for the server (the same setting the rewrites use); never taken from a request. */
const apiOrigin = () => process.env['API_UPSTREAM_ORIGIN'] ?? 'http://127.0.0.1:3001';

/** A slow API must never slow a page down: past this the answer is "no season". */
export const SEASON_FETCH_TIMEOUT_MS = 1_500;

/**
 * The active season for a language, read by the server layouts (docs/UXUI_REDESIGN_DESIGN.md 20.9). The answer
 * is cached for 60 seconds (the API says the same); any failure, timeout, `204` or malformed body is `null`, so
 * the app renders exactly as it does without the feature.
 */
export async function fetchActiveSeason(
  locale: Locale,
  fetcher: typeof fetch = fetch,
): Promise<PublicSeasonResponse | null> {
  try {
    const response = await fetcher(`${apiOrigin()}${publicSeasonUrl(locale)}`, {
      headers: { accept: 'application/json' },
      credentials: 'omit',
      signal: AbortSignal.timeout(SEASON_FETCH_TIMEOUT_MS),
      next: { revalidate: 60 },
    });
    if (response.status !== 200) return null;
    return parsePublicSeason(await response.json());
  } catch {
    return null;
  }
}
