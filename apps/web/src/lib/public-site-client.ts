import type { Locale } from '../i18n/locales';
import { parsePublicServices, parsePublicSite, type HomeData } from './public-site-core';
import { loadPublicSlides } from './slider-core';

import type { PopupFetchResponse } from './popup-core';

type Fetcher = (
  url: string,
  init: { credentials: 'omit'; headers: Record<string, string> },
) => Promise<PopupFetchResponse>;

async function readJson(fetcher: Fetcher, url: string): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * What the home page draws, read in the browser through the same public routes (the admin's season preview draws the
 * real home page and has no server pass). A part that cannot be read is null, as on the server.
 */
export async function loadHomeDataInBrowser(fetcher: Fetcher, locale: Locale): Promise<HomeData> {
  const [site, services, slides] = await Promise.all([
    readJson(fetcher, `/api/v1/public/site?locale=${locale}`),
    readJson(fetcher, `/api/v1/public/services?locale=${locale}`),
    loadPublicSlides(fetcher, locale),
  ]);
  return { site: parsePublicSite(site), services: parsePublicServices(services), slides };
}
