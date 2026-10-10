import type { HttpClient, HttpResponse } from '@lucy-spa/server';
import sharp from 'sharp';

/**
 * Test double of a WooCommerce shop for the supplier import tests (no real site is ever contacted by a test): robots.txt, the Store API
 * product list (`orderby=id`, paged), the `include` re-read, one product or variation by id, and picture files. The tests change the
 * shop between scans (reorder the list, swap pictures, hide a product) and read back which addresses were requested.
 */
export interface FakeVariation {
  id: number;
  images: string[];
  /** The parent id the variation names; defaults to the product it hangs under. */
  parent?: number;
}

export interface FakeProduct {
  id: number;
  name: string;
  /** Picture paths on the shop's own host (`/wp-content/uploads/x.png`), in the order the shop lists them. */
  images: string[];
  sku?: string;
  type?: 'simple' | 'variable';
  variations?: FakeVariation[];
  priceVnd?: number;
}

export type ImageAnswer = Buffer | { status: number; body: Buffer };

export class FakeSite {
  readonly products = new Map<number, FakeProduct>();
  readonly files = new Map<string, ImageAnswer>();
  /** Requested path and query, in order. */
  readonly urls: string[] = [];
  /** List the products newest id first (a reshuffled site). */
  reversed = false;
  /** What the `include` re-read and the by-id read answer for a product (default: the same as the list). */
  rereadOverride: ((product: FakeProduct) => FakeProduct | null) | null = null;
  robots: string | null = null;

  add(product: FakeProduct): this {
    this.products.set(product.id, product);
    return this;
  }

  private json(product: FakeProduct, host: string): Record<string, unknown> {
    return {
      id: product.id,
      name: product.name,
      slug: `san-pham-${product.id}`,
      parent: 0,
      type: product.type ?? 'simple',
      permalink: `https://${host}/san-pham/${product.id}/`,
      sku: product.sku ?? '',
      description: '<p>Mô tả</p>',
      prices: {
        regular_price: String(product.priceVnd ?? 250_000),
        sale_price: String(product.priceVnd ?? 250_000),
        currency_code: 'VND',
        currency_minor_unit: 0,
      },
      images: product.images.map((path) => ({ id: 1, src: `https://${host}${path}`, alt: '' })),
      categories: [{ name: 'Chăm sóc da' }],
      brands: [],
      attributes: [],
      variations: (product.variations ?? []).map((variation) => ({
        id: variation.id,
        attributes: [{ name: 'Dung tích', value: String(variation.id) }],
      })),
    };
  }

  private variationJson(variation: FakeVariation, parent: FakeProduct, host: string) {
    return {
      ...this.json(
        {
          id: variation.id,
          name: `${parent.name} (loại ${variation.id})`,
          images: variation.images,
        },
        host,
      ),
      type: 'variation',
      parent: variation.parent ?? parent.id,
    };
  }

  client(): HttpClient {
    const respond = (
      raw: string,
      status: number,
      body: string | Buffer,
      extra: Record<string, string> = {},
    ): HttpResponse => ({
      status,
      headers: {
        'content-type': 'application/json',
        'x-wp-total': String(this.products.size),
        ...extra,
      },
      body: Buffer.isBuffer(body) ? body : Buffer.from(body),
      url: raw,
    });
    return {
      requestCount: () => this.urls.length,
      setMinInterval: () => undefined,
      get: async (raw) => {
        const url = new URL(raw);
        const host = url.hostname;
        this.urls.push(`${url.pathname}${url.search}`);
        if (url.pathname === '/robots.txt') {
          return this.robots === null
            ? respond(raw, 404, '', { 'content-type': 'text/plain' })
            : respond(raw, 200, this.robots, { 'content-type': 'text/plain' });
        }
        const file = this.files.get(url.pathname);
        if (file !== undefined) {
          const answer = Buffer.isBuffer(file) ? { status: 200, body: file } : file;
          return respond(raw, answer.status, answer.body, { 'content-type': 'image/png' });
        }
        const reread = (product: FakeProduct) =>
          this.rereadOverride ? this.rereadOverride(product) : product;
        const one = url.pathname.match(/^\/wp-json\/wc\/store\/v1\/products\/(\d+)$/);
        if (one) {
          const id = Number(one[1]);
          const product = this.products.get(id);
          if (product) {
            const shown = reread(product);
            return shown
              ? respond(raw, 200, JSON.stringify(this.json(shown, host)))
              : respond(raw, 404, '{}');
          }
          for (const parent of this.products.values()) {
            const variation = (parent.variations ?? []).find((entry) => entry.id === id);
            if (variation) {
              return respond(raw, 200, JSON.stringify(this.variationJson(variation, parent, host)));
            }
          }
          return respond(raw, 404, '{}');
        }
        if (url.pathname === '/wp-json/wc/store/v1/products') {
          const include = url.searchParams.get('include');
          let list = [...this.products.values()].sort((a, b) => a.id - b.id);
          if (include) {
            const wanted = new Set(include.split(',').map(Number));
            list = list.filter((product) => wanted.has(product.id));
          }
          const perPage = Number(url.searchParams.get('per_page') ?? '20');
          const page = Number(url.searchParams.get('page') ?? '1');
          if (!include) list = list.slice((page - 1) * perPage, page * perPage);
          if (this.reversed) list.reverse();
          const shown = list
            .map((product) => (include ? reread(product) : product))
            .filter((product): product is FakeProduct => product !== null);
          return respond(
            raw,
            200,
            JSON.stringify(shown.map((product) => this.json(product, host))),
          );
        }
        return respond(raw, 404, '{}');
      },
    };
  }
}

/** A deterministic 64x64 picture of blocky grey patches from a seed: different seeds look different, the same seed is the same file. */
export async function patternPicture(
  seed: number,
  format: 'png' | 'jpeg' = 'png',
): Promise<Buffer> {
  let state = (seed * 2_654_435_761) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const blocks = Array.from({ length: 64 }, () => Math.floor(next() * 256));
  const pixels = Buffer.alloc(64 * 64);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      pixels[y * 64 + x] = blocks[Math.floor(y / 8) * 8 + Math.floor(x / 8)] as number;
    }
  }
  const image = sharp(pixels, { raw: { width: 64, height: 64, channels: 1 } });
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 70 }).toBuffer();
}
