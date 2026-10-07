import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  PublicProductCard,
  PublicProductDetailResponse,
  PublicProductsResponse,
  PublicSiteResponse,
} from '@lucy-spa/contracts';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { ReactElement } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { EMPTY_PRODUCTS_STATE } from '../../lib/public-products-core';
import { ProductDetailView, ProductsView } from './products-view';

function html(node: ReactElement, path = '/vi/products'): string {
  return render(
    <AppRouterContext.Provider value={{ push: () => undefined } as never}>
      <PathnameContext.Provider value={path}>{node}</PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

const image = {
  alt: 'Hũ kem',
  width: 800,
  height: 800,
  sources: [
    { url: '/api/v1/public/media/11111111-1111-4111-8111-111111111111/md', width: 480 },
    { url: '/api/v1/public/media/11111111-1111-4111-8111-111111111111/lg', width: 800 },
  ],
};
const stock = (state: 'IN_STOCK' | 'PRE_ORDER' | 'OUT_OF_STOCK') =>
  state === 'PRE_ORDER'
    ? ({ state, leadTimeDaysMin: 3, leadTimeDaysMax: 5 } as const)
    : ({ state, leadTimeDaysMin: null, leadTimeDaysMax: null } as const);
const card = (overrides: Partial<PublicProductCard> = {}): PublicProductCard => ({
  code: 'kem-duong',
  name: 'Kem dưỡng ẩm',
  category: { code: 'da', name: 'Chăm sóc da' },
  brand: 'Hãng thử',
  image,
  price: { priceVnd: '289000', listPriceVnd: null, discountPercent: null },
  priceMaxVnd: '289000',
  isNew: false,
  featured: false,
  stock: stock('IN_STOCK'),
  ...overrides,
});
const data = (overrides: Partial<PublicProductsResponse> = {}): PublicProductsResponse => ({
  hero: null,
  commitment: null,
  categories: [],
  brands: [],
  items: [card()],
  page: 1,
  pageSize: 20,
  total: 1,
  ...overrides,
});
const site: PublicSiteResponse = {
  tagline: 'Thư Giãn Tận Tâm',
  footerBlocks: [],
  intro: null,
  facts: [],
  featuredGroups: [],
  why: null,
  address: '04 Nguyễn Quang Bích, Đà Nẵng',
  hotline: '0934 936 101',
  hotlineTel: '+84934936101',
  mapUrl: null,
  facebookUrl: null,
  messengerUrl: null,
  zaloUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
  hours: [{ weekdays: [1, 2, 3, 4, 5, 6], closed: false, opensAt: '09:00', closesAt: '21:00' }],
  heroImage: null,
};

test('list: no hero from the Owner means a plain title; the page has exactly one h1', () => {
  const text = html(<ProductsView locale="vi" data={data()} state={EMPTY_PRODUCTS_STATE} />);
  assert.equal(count(text, /<h1\b/g), 1);
  assert.match(text, /<h1[^>]*>Mỹ phẩm<\/h1>/);
  assert.ok(!text.includes('ls-prod-hero'), 'no hero box');
  assert.ok(!text.includes('ls-prod-commitment'), 'no commitment box');
  assert.ok(!text.includes('LUCY BEAUTY SELECTION'), 'nothing is copied from the reference');
  assert.ok(!text.includes('Tư vấn phù hợp'), 'no claim the Owner did not write');
  // The section heading is text only: no count, badge or symbol beside it.
  assert.match(text, /<h2[^>]*id="products-list"[^>]*>Sản phẩm<\/h2>/);
});

test('list: the Owner hero and commitment box appear, in the visitor language, with one h1 (the hero headline)', () => {
  const owner = data({
    hero: { title: 'Chăm da đúng cách', text: 'Chọn lọc.', image },
    commitment: { title: 'Cam kết', items: ['Dòng một', 'Dòng hai'] },
  });
  const text = html(<ProductsView locale="vi" data={owner} state={EMPTY_PRODUCTS_STATE} />);
  assert.equal(count(text, /<h1\b/g), 1);
  assert.match(text, /<h1[^>]*>Chăm da đúng cách<\/h1>/);
  assert.ok(text.includes('Chọn lọc.'));
  assert.ok(text.includes('alt="Hũ kem"'));
  assert.ok(text.includes('ls-prod-hero-image'));
  assert.ok(text.includes('Cam kết') && text.includes('Dòng một') && text.includes('Dòng hai'));
  // A hero without a headline keeps the page's own h1.
  const noTitle = html(
    <ProductsView
      locale="en"
      data={data({ hero: { title: null, text: 'Words only', image: null } })}
      state={EMPTY_PRODUCTS_STATE}
    />,
    '/en/products',
  );
  assert.equal(count(noTitle, /<h1\b/g), 1);
  assert.match(noTitle, /<h1[^>]*>Cosmetics<\/h1>/);
});

test('cards: image, category, name link, price, struck list price, percent, "Mới", stock line; never a quantity', () => {
  const items = [
    card({
      code: 'giam-gia',
      name: 'Tinh chất',
      price: { priceVnd: '329000', listPriceVnd: '389000', discountPercent: 15 },
      priceMaxVnd: '329000',
      isNew: true,
    }),
    card({ code: 'het', name: 'Hết sạch', stock: stock('OUT_OF_STOCK'), image: null }),
    card({ code: 'dat-truoc', name: 'Đặt trước', stock: stock('PRE_ORDER') }),
    card({
      code: 'nhieu',
      name: 'Nhiều loại',
      price: { priceVnd: '100000', listPriceVnd: null, discountPercent: null },
      priceMaxVnd: '250000',
    }),
  ];
  const text = html(
    <ProductsView locale="vi" data={data({ items, total: 4 })} state={EMPTY_PRODUCTS_STATE} />,
  );
  assert.equal(count(text, /<article\b/g), 4);
  assert.ok(text.includes('href="/vi/products/giam-gia"'));
  assert.ok(text.includes('<del>389.000 ₫</del>') && text.includes('329.000 ₫'));
  assert.ok(text.includes('-15%'));
  assert.ok(text.includes('>Mới<'));
  assert.ok(text.includes('>Hết hàng<'), 'sold out is a badge');
  assert.ok(text.includes('Đặt trước, dự kiến 3–5 ngày'));
  assert.ok(text.includes('từ 100.000 ₫'), 'a range reads "from"');
  assert.match(text, /<h3[^>]*class="[^"]*ls-prod-name[^"]*"/);
  assert.ok(!/còn \d+|\d+ sản phẩm|tồn|quantity/i.test(text), 'no quantity anywhere');
  // A card without a picture shows a quiet placeholder icon, not a made-up photo.
  assert.ok(text.includes('<svg'));
});

test('filters: category links with the chosen one marked, sub-categories under their parent, brands only when there are several', () => {
  const rich = data({
    categories: [
      { code: 'da', name: 'Chăm sóc da', parentCode: null },
      { code: 'rua', name: 'Sữa rửa mặt', parentCode: 'da' },
      { code: 'mat-na', name: 'Mặt nạ', parentCode: null },
    ],
    brands: [{ code: 'b1', name: 'Hãng một' }],
  });
  const text = html(
    <ProductsView
      locale="vi"
      data={rich}
      state={{ ...EMPTY_PRODUCTS_STATE, category: 'rua', page: 3 }}
    />,
  );
  assert.ok(text.includes('href="/vi/products?category=rua"'), 'the chosen filter, back at page 1');
  assert.match(text, /<a[^>]*aria-current="true"[^>]*>Sữa rửa mặt<\/a>/);
  assert.ok(
    text.indexOf('Chăm sóc da') < text.indexOf('Sữa rửa mặt') &&
      text.indexOf('Sữa rửa mặt') < text.indexOf('Mặt nạ'),
  );
  assert.ok(text.includes('ls-prod-option-child'));
  assert.ok(!text.includes('Thương hiệu</h3>'), 'one brand is nothing to filter by');
  const many = html(
    <ProductsView
      locale="vi"
      data={{ ...rich, brands: [...rich.brands, { code: 'b2', name: 'Hãng hai' }] }}
      state={EMPTY_PRODUCTS_STATE}
    />,
  );
  assert.ok(many.includes('Thương hiệu') && many.includes('href="/vi/products?brand=b2"'));
  const none = html(<ProductsView locale="vi" data={data()} state={EMPTY_PRODUCTS_STATE} />);
  assert.ok(!none.includes('Danh mục'), 'nothing to filter by: no sidebar, no filter button');
  assert.ok(!none.includes('ls-prod-filter-button'));
});

test('states: nothing published, nothing matches (with a way out), and a list that could not be read', () => {
  const empty = html(
    <ProductsView locale="vi" data={data({ items: [], total: 0 })} state={EMPTY_PRODUCTS_STATE} />,
  );
  assert.ok(empty.includes('Chưa có sản phẩm nào để hiển thị.'));
  assert.ok(!empty.includes('ls-prod-grid'));
  const noMatch = html(
    <ProductsView
      locale="vi"
      data={data({
        items: [],
        total: 0,
        categories: [{ code: 'da', name: 'Chăm sóc da', parentCode: null }],
      })}
      state={{ ...EMPTY_PRODUCTS_STATE, q: 'zzz', category: 'da' }}
    />,
  );
  assert.ok(noMatch.includes('Không có sản phẩm phù hợp'));
  assert.ok(noMatch.includes('href="/vi/products"') && noMatch.includes('Xóa bộ lọc'));
  const failed = html(<ProductsView locale="vi" data={null} state={EMPTY_PRODUCTS_STATE} />);
  assert.equal(count(failed, /<h1\b/g), 1);
  assert.ok(failed.includes('Mỹ phẩm'));
  assert.ok(failed.toLowerCase().includes('thử lại') || failed.includes('ls-page-notice'));
});

const detail = (overrides: Partial<PublicProductDetailResponse['product']> = {}) =>
  ({
    product: {
      code: 'kem-duong',
      name: 'Kem dưỡng ẩm',
      description: 'Dưỡng ẩm cho da.\nDùng mỗi tối.',
      category: { code: 'da', name: 'Chăm sóc da' },
      brand: 'Hãng thử',
      images: [image, { ...image, alt: 'Mặt bên' }],
      variants: [
        {
          label: '30 ml',
          price: { priceVnd: '80000', listPriceVnd: '100000', discountPercent: 20 },
          stock: stock('IN_STOCK'),
        },
        {
          label: '50 ml',
          price: { priceVnd: '150000', listPriceVnd: null, discountPercent: null },
          stock: stock('PRE_ORDER'),
        },
      ],
      priceMaxVnd: '150000',
      isNew: true,
      featured: false,
      stock: stock('IN_STOCK'),
      ...overrides,
    },
    commitment: { title: 'Cam kết', items: ['Một dòng'] },
    related: [card({ code: 'khac', name: 'Sản phẩm khác' })],
  }) satisfies PublicProductDetailResponse;

test('detail: one h1, gallery, price per variant with its own stock, where to buy from the shop, related; no buy button yet', () => {
  const text = html(
    <ProductDetailView locale="vi" detail={detail()} site={site} />,
    '/vi/products/kem-duong',
  );
  assert.equal(count(text, /<h1\b/g), 1);
  assert.match(text, /<h1[^>]*>Kem dưỡng ẩm<\/h1>/);
  assert.equal(count(text, /class="ls-prod-thumb"/g), 2);
  assert.ok(
    text.includes('80.000 ₫') && text.includes('<del>100.000 ₫</del>') && text.includes('-20%'),
  );
  assert.equal(count(text, /type="radio"/g), 2, 'a picker only when there are several variants');
  assert.ok(text.includes('Đặt trước, dự kiến 3–5 ngày'));
  assert.ok(text.includes('Dưỡng ẩm cho da.'));
  assert.ok(text.includes('Mua trực tiếp tại cửa hàng'));
  assert.ok(text.includes('04 Nguyễn Quang Bích, Đà Nẵng') && text.includes('0934 936 101'));
  assert.ok(text.includes('href="tel:+84934936101"'));
  assert.ok(text.includes('Sản phẩm cùng danh mục') && text.includes('href="/vi/products/khac"'));
  assert.ok(text.includes('Cam kết') && text.includes('Một dòng'));
  // The breadcrumb leads back to the list and the category.
  assert.ok(text.includes('href="/vi/products?category=da"'));
  // Online ordering is Wave 4: no cart, no buy button, no quantity.
  assert.ok(!/Mua ngay|Thêm vào giỏ|Add to cart|Buy now|name="quantity"/i.test(text));
  assert.ok(!/<form\b/.test(text));
});

test('detail: one variant has no picker; no picture shows a placeholder; no shop profile means no store block', () => {
  const single = detail({
    images: [],
    variants: [
      {
        label: null,
        price: { priceVnd: '60000', listPriceVnd: null, discountPercent: null },
        stock: stock('OUT_OF_STOCK'),
      },
    ],
    priceMaxVnd: '60000',
    isNew: false,
  });
  const text = html(
    <ProductDetailView
      locale="vi"
      detail={{ ...single, related: [], commitment: null }}
      site={null}
    />,
    '/vi/products/kem-duong',
  );
  assert.equal(count(text, /type="radio"/g), 0);
  assert.equal(count(text, /class="ls-prod-thumb"/g), 0);
  assert.ok(text.includes('Hết hàng'));
  assert.ok(!text.includes('Mua trực tiếp tại cửa hàng'));
  assert.ok(!text.includes('Sản phẩm cùng danh mục'));
  assert.ok(text.includes('<svg'), 'a quiet placeholder, never a made-up photo');
  const failed = html(<ProductDetailView locale="vi" detail={null} site={site} />);
  assert.equal(count(failed, /<h1\b/g), 1);
});

test('the English page uses English wording and the English store block', () => {
  const text = html(
    <ProductDetailView locale="en" detail={detail()} site={site} />,
    '/en/products/kem-duong',
  );
  assert.ok(text.includes('Buy in the shop') && text.includes('Directions'));
  assert.ok(text.includes('Pre-order, expected 3–5 days'));
  assert.ok(text.includes('href="/en/products/khac"'));
});
