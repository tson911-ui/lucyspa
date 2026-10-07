import type {
  PublicServiceDetailResponse,
  PublicServicesResponse,
  PublicSiteResponse,
} from '@lucy-spa/contracts';
import type { Locale } from '../i18n/locales';
import {
  parsePublicServices,
  parsePublicSite,
  parseServiceDetail,
  type HomeData,
} from './public-site-core';
import {
  parseProductCodes,
  parseProductDetail,
  parsePublicProducts,
  productsQuery,
  productsStateOf,
  isProductCode,
  type ProductsState,
} from './public-products-core';
import { apiOrigin } from './season-server';
import { asPublicSlides, publicSlidesUrl } from './slider-core';
import { ttlMemo, type Answer } from './ttl-memo';

/** A slow API must not hold a page for long: past this a section shows a notice instead. */
export const PUBLIC_FETCH_TIMEOUT_MS = 3_000;

async function read(
  path: string,
  fetcher: typeof fetch,
  memo = true,
): Promise<{ status: number; body: unknown } | null> {
  const load = async (): Promise<Answer<{ status: number; body: unknown } | null>> => {
    try {
      const response = await fetcher(`${apiOrigin()}${path}`, {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        signal: AbortSignal.timeout(PUBLIC_FETCH_TIMEOUT_MS),
        cache: 'no-store',
      });
      // A 404 is an answer (an unknown or paused service); other statuses and transport errors are failures.
      if (response.status === 404) return { value: { status: 404, body: null }, ok: true };
      if (response.status !== 200) return { value: null, ok: false };
      return { value: { status: 200, body: await response.json() }, ok: true };
    } catch {
      return { value: null, ok: false };
    }
  };
  // Remembered for a minute by the process (see ttlMemo); a caller-supplied fetcher (tests) is never memoized, and neither is a
  // visitor's free-text search (the memo holds 200 entries: an unbounded set of search words must not push the real pages out).
  return fetcher === fetch && memo ? ttlMemo(`public:${path}`, load) : (await load()).value;
}

/** The shop profile for a language, or null on any failure or malformed answer. */
export async function fetchPublicSite(
  locale: Locale,
  fetcher: typeof fetch = fetch,
): Promise<PublicSiteResponse | null> {
  const answer = await read(`/api/v1/public/site?locale=${locale}`, fetcher);
  return answer?.status === 200 ? parsePublicSite(answer.body) : null;
}

export async function fetchPublicServices(
  locale: Locale,
  fetcher: typeof fetch = fetch,
): Promise<PublicServicesResponse | null> {
  const answer = await read(`/api/v1/public/services?locale=${locale}`, fetcher);
  return answer?.status === 200 ? parsePublicServices(answer.body) : null;
}

/** One service: the detail, 'missing' when the API says there is no such visible service, null when it could not be read. */
export async function fetchPublicService(
  locale: Locale,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicServiceDetailResponse | 'missing' | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) return 'missing';
  const answer = await read(
    `/api/v1/public/services/${encodeURIComponent(code)}?locale=${locale}`,
    fetcher,
  );
  if (answer?.status === 404) return 'missing';
  return answer?.status === 200 ? parseServiceDetail(answer.body) : null;
}

/** One page of the cosmetics catalog for the address bar's state, or null when it could not be read. */
export async function fetchPublicProducts(
  locale: Locale,
  state: ProductsState,
  fetcher: typeof fetch = fetch,
) {
  const query = productsQuery(state);
  const path = `/api/v1/public/products?locale=${locale}${query === '' ? '' : `&${query.slice(1)}`}`;
  const answer = await read(path, fetcher, state.q === '');
  return answer?.status === 200 ? parsePublicProducts(answer.body) : null;
}

/**
 * Whether the shop has any published product, for the menus (the entry is left out while it has none). It is the first
 * page of the list in its default state, so the answer is the one the list page itself uses (remembered for a minute).
 * When the catalog cannot be read this is true: an outage must not hide the entry.
 */
export async function fetchHasPublicProducts(
  locale: Locale,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const data = await fetchPublicProducts(locale, productsStateOf({}), fetcher);
  return data === null || data.total > 0;
}

/** One product: the detail, 'missing' when the API says there is no such visible product, null when it could not be read. */
export async function fetchPublicProduct(
  locale: Locale,
  code: string,
  fetcher: typeof fetch = fetch,
) {
  if (!isProductCode(code)) return 'missing' as const;
  const answer = await read(
    `/api/v1/public/products/${encodeURIComponent(code)}?locale=${locale}`,
    fetcher,
  );
  if (answer?.status === 404) return 'missing' as const;
  return answer?.status === 200 ? parseProductDetail(answer.body) : null;
}

/** The codes of every visible product, for the sitemap (empty when they cannot be read). */
export async function fetchPublicProductCodes(fetcher: typeof fetch = fetch): Promise<string[]> {
  const answer = await read('/api/v1/public/products/codes', fetcher);
  return (answer?.status === 200 ? parseProductCodes(answer.body)?.codes : undefined) ?? [];
}

export async function fetchPublicSlidesServer(locale: Locale, fetcher: typeof fetch = fetch) {
  const answer = await read(publicSlidesUrl(locale), fetcher);
  return answer?.status === 200 ? asPublicSlides(answer.body) : [];
}

/** Everything the home page draws, read in parallel; a part that fails is null (slides: none). */
export async function loadHomeData(
  locale: Locale,
  fetcher: typeof fetch = fetch,
): Promise<HomeData> {
  const [site, services, slides] = await Promise.all([
    fetchPublicSite(locale, fetcher),
    fetchPublicServices(locale, fetcher),
    fetchPublicSlidesServer(locale, fetcher),
  ]);
  return { site, services, slides };
}
