import type { HttpClient, HttpResponse } from './http-client.js';

/**
 * Synthetic WooCommerce Store API data for tests (no real supplier content is kept in the repository). `shop.example` is the source.
 */
export const FIXTURE_BASE_URL = 'https://shop.example/';
export const FIXTURE_HOST = 'shop.example';

export type StoreProductFixture = Record<string, unknown>;

export function storeProduct(id: number, overrides: StoreProductFixture = {}): StoreProductFixture {
  return {
    id,
    name: `Sản phẩm ${id}`,
    slug: `san-pham-${id}`,
    parent: 0,
    type: 'simple',
    permalink: `https://shop.example/san-pham/san-pham-${id}/`,
    sku: `SKU-${id}`,
    short_description: `<p>Mô tả ngắn ${id}</p>`,
    description: `<p>Mô tả dài ${id}</p>`,
    on_sale: false,
    prices: {
      price: '250000',
      regular_price: '250000',
      sale_price: '250000',
      currency_code: 'VND',
      currency_minor_unit: 0,
    },
    images: [
      {
        id: id * 10,
        src: `https://shop.example/wp-content/uploads/2026/10/product-${id}.jpg`,
        alt: `Ảnh ${id}`,
      },
    ],
    categories: [
      { id: 5, name: 'Chăm sóc da', slug: 'cham-soc-da', link: 'https://shop.example/c/' },
    ],
    brands: [],
    attributes: [],
    variations: [],
    is_in_stock: true,
    ...overrides,
  };
}

export interface FakeRoute {
  status?: number;
  headers?: Record<string, string>;
  body: string;
}

/** A client that answers from a table keyed by the request URL (path and query), and records every URL asked. */
export function fakeClient(
  routes: Record<string, FakeRoute | ((url: URL) => FakeRoute)>,
): HttpClient & {
  urls: string[];
  minInterval: number | null;
} {
  const urls: string[] = [];
  let minInterval: number | null = null;
  return {
    urls,
    get minInterval() {
      return minInterval;
    },
    requestCount: () => urls.length,
    setMinInterval(ms) {
      minInterval = ms;
    },
    async get(raw): Promise<HttpResponse> {
      const url = new URL(raw);
      urls.push(`${url.pathname}${url.search}`);
      const route = routes[`${url.pathname}${url.search}`] ?? routes[url.pathname] ?? routes['*'];
      if (!route) return { status: 404, headers: {}, body: Buffer.from('not found'), url: raw };
      const answer = typeof route === 'function' ? route(url) : route;
      return {
        status: answer.status ?? 200,
        headers: {
          'content-type': 'application/json',
          ...(answer.headers ?? {}),
        },
        body: Buffer.from(answer.body),
        url: raw,
      };
    },
  };
}

export const jsonRoute = (value: unknown, headers: Record<string, string> = {}): FakeRoute => ({
  body: JSON.stringify(value),
  headers,
});
