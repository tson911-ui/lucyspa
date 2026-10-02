import { apiOrigin } from './season-server';

/** A slow API must never hang a page: past this the preview is simply not available. */
export const PREVIEW_GUARD_TIMEOUT_MS = 3_000;

/**
 * Whether this session may open the season preview page: it holds `MANAGE_WEBSITE_CONTENT` (GLOBAL). Decided by the
 * API, not by the web app: the seasons list is a call that answers 200 only for that permission, and the page's own
 * session cookie is forwarded to it. Any other answer (not signed in, no permission, API down, timeout) is "no", and
 * the page answers 404, so there is no link to share and nothing to learn from probing it.
 */
export async function canPreviewSeasons(
  cookieHeader: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (cookieHeader.trim() === '') return false;
  try {
    const response = await fetcher(`${apiOrigin()}/api/v1/website/seasons`, {
      headers: { accept: 'application/json', cookie: cookieHeader },
      cache: 'no-store',
      signal: AbortSignal.timeout(PREVIEW_GUARD_TIMEOUT_MS),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
