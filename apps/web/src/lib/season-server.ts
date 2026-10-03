import type { PublicSeasonResponse } from '@lucy-spa/contracts';
import type { Locale } from '../i18n/locales';
import { parsePublicSeason, publicSeasonUrl } from './season-core';
import { ttlMemo, type Answer } from './ttl-memo';

/** Where the API listens for the server (the same setting the rewrites use); never taken from a request. */
export const apiOrigin = () => process.env['API_UPSTREAM_ORIGIN'] ?? 'http://127.0.0.1:3001';

/** A slow API must never slow a page down: past this the answer is "no season". */
export const SEASON_FETCH_TIMEOUT_MS = 1_500;

/**
 * The active season for a language, read by the server layouts (docs/UXUI_REDESIGN_DESIGN.md 20.9). The answer
 * is remembered for 60 seconds in this process (`ttlMemo`; the API says the same, and Next's own fetch cache is not
 * used because it never replaces a stored 200 with a 204, so an ended season would linger); any failure, timeout,
 * `204` or malformed body is `null`, so the app renders exactly as it does without the feature.
 */
export async function fetchActiveSeason(
  locale: Locale,
  fetcher: typeof fetch = fetch,
): Promise<PublicSeasonResponse | null> {
  const load = async (): Promise<Answer<PublicSeasonResponse | null>> => {
    try {
      const response = await fetcher(`${apiOrigin()}${publicSeasonUrl(locale)}`, {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        signal: AbortSignal.timeout(SEASON_FETCH_TIMEOUT_MS),
        cache: 'no-store',
      });
      // 204 is a real answer ("no season now"); only a transport failure or an error status is a failure.
      if (response.status === 204) return { value: null, ok: true };
      if (response.status !== 200) return { value: null, ok: false };
      const season = parsePublicSeason(await response.json());
      return { value: season, ok: season !== null };
    } catch {
      return { value: null, ok: false };
    }
  };
  // A caller-supplied fetcher (tests) is never memoized.
  return fetcher === fetch ? ttlMemo(`season:${locale}`, load) : (await load()).value;
}
