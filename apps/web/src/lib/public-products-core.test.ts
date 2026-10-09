import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicProductDetail } from '@lucy-spa/contracts';
import {
  activeCampaign,
  activeFilterCount,
  campaignBanner,
  campaignEndText,
  campaignHref,
  cardPriceText,
  discountText,
  isPlainList,
  isProductCode,
  lastPage,
  parsePublicCampaigns,
  parseProductCodes,
  parseProductDetail,
  parsePublicProducts,
  productHref,
  productJsonLd,
  productsHref,
  productsQuery,
  priceBadgeText,
  productsStateOf,
  stockLabel,
  stripCampaigns,
  withFilter,
  EMPTY_PRODUCTS_STATE,
} from './public-products-core';

const stock = {
  IN_STOCK: { state: 'IN_STOCK', leadTimeDaysMin: null, leadTimeDaysMax: null },
  OUT: { state: 'OUT_OF_STOCK', leadTimeDaysMin: null, leadTimeDaysMax: null },
  PRE: { state: 'PRE_ORDER', leadTimeDaysMin: 3, leadTimeDaysMax: 5 },
} as const;

const price = { priceVnd: '329000', listPriceVnd: '389000', discountPercent: 15 };
const image = {
  alt: 'Ảnh',
  width: 800,
  height: 800,
  sources: [
    { url: '/api/v1/public/media/11111111-1111-4111-8111-111111111111/md', width: 480 },
    { url: '/api/v1/public/media/11111111-1111-4111-8111-111111111111/lg', width: 800 },
  ],
};
const card = {
  code: 'kem-duong',
  name: 'Kem dưỡng',
  category: { code: 'da', name: 'Chăm sóc da' },
  brand: 'Thương hiệu',
  image,
  price,
  priceMaxVnd: '389000',
  isNew: true,
  featured: false,
  stock: stock.PRE,
};
const list = {
  hero: null,
  commitment: null,
  categories: [{ code: 'da', name: 'Chăm sóc da', parentCode: null }],
  brands: [{ code: 'b', name: 'Thương hiệu' }],
  items: [card],
  page: 1,
  pageSize: 20,
  total: 1,
};

test('the address bar: known values are kept, anything else falls back, defaults stay out of the address', () => {
  assert.deepEqual(productsStateOf({}), EMPTY_PRODUCTS_STATE);
  assert.deepEqual(
    productsStateOf({ q: ' kem ', category: 'da', brand: 'b', sort: 'price_asc', page: '3' }),
    { q: 'kem', category: 'da', brand: 'b', sort: 'price_asc', page: 3 },
  );
  assert.deepEqual(productsStateOf({ q: ['kem', 'x'], category: 'a b', sort: 'cost', page: '0' }), {
    q: 'kem',
    category: '',
    brand: '',
    sort: 'featured',
    page: 1,
  });
  assert.equal(productsStateOf({ page: '501' }).page, 1);
  assert.equal(productsStateOf({ page: '2.5' }).page, 1);
  assert.equal([...productsStateOf({ q: 'x'.repeat(200) }).q].length, 80);
  assert.equal(productsQuery(EMPTY_PRODUCTS_STATE), '');
  assert.equal(
    productsQuery({ q: 'kem dưỡng', category: 'da', brand: '', sort: 'newest', page: 2 }),
    '?q=kem+d%C6%B0%E1%BB%A1ng&category=da&sort=newest&page=2',
  );
  assert.equal(productsHref('vi'), '/vi/products');
  assert.equal(productsHref('en', { ...EMPTY_PRODUCTS_STATE, page: 2 }), '/en/products?page=2');
  assert.equal(productHref('vi', 'kem duong/x'), '/vi/products/kem%20duong%2Fx');
});

test('a change of filter, search or sort starts again at the first page', () => {
  const state = { ...EMPTY_PRODUCTS_STATE, page: 4, category: 'da' };
  assert.equal(withFilter(state, { q: 'kem' }).page, 1);
  assert.equal(withFilter(state, { category: '' }).category, '');
  assert.equal(activeFilterCount(state), 1);
  assert.equal(activeFilterCount({ ...state, brand: 'b' }), 2);
  assert.equal(isPlainList(EMPTY_PRODUCTS_STATE), true);
  assert.equal(
    isPlainList({ ...EMPTY_PRODUCTS_STATE, sort: 'newest' }),
    true,
    'a sort alone is the same list',
  );
  assert.equal(isPlainList({ ...EMPTY_PRODUCTS_STATE, page: 2 }), false);
  assert.equal(isPlainList({ ...EMPTY_PRODUCTS_STATE, q: 'a' }), false);
  assert.equal(lastPage(0), 1);
  assert.equal(lastPage(20), 1);
  assert.equal(lastPage(21), 2);
  assert.equal(isProductCode('kem-duong_1'), true);
  assert.equal(isProductCode('a/b'), false);
});

test('wording: price ("từ" for a range), "-x%", and the one availability line (never a number)', () => {
  assert.equal(cardPriceText({ price, priceMaxVnd: '389000' }, 'vi'), 'từ 329.000 ₫');
  assert.equal(cardPriceText({ price, priceMaxVnd: '329000' }, 'vi'), '329.000 ₫');
  assert.equal(cardPriceText({ price, priceMaxVnd: '389000' }, 'en'), 'from 329,000 ₫');
  assert.equal(discountText(price), '-15%');
  assert.equal(discountText({ priceVnd: '1', listPriceVnd: null, discountPercent: null }), null);
  const texts = { outOfStock: 'Hết hàng', preOrder: 'Đặt trước, dự kiến {days} ngày' };
  assert.equal(stockLabel(stock.IN_STOCK, texts), null);
  assert.equal(stockLabel(stock.OUT, texts), 'Hết hàng');
  assert.equal(stockLabel(stock.PRE, texts), 'Đặt trước, dự kiến 3–5 ngày');
  assert.equal(
    stockLabel({ state: 'PRE_ORDER', leadTimeDaysMin: 4, leadTimeDaysMax: 4 }, texts),
    'Đặt trước, dự kiến 4 ngày',
  );
});

test('the list answer is checked; one malformed card makes it "could not be read"', () => {
  assert.deepEqual(parsePublicProducts(list)?.items[0]?.code, 'kem-duong');
  assert.equal(parsePublicProducts(null), null);
  assert.equal(parsePublicProducts({ ...list, total: -1 }), null);
  assert.equal(
    parsePublicProducts({ ...list, items: [{ ...card, price: { priceVnd: 'abc' } }] }),
    null,
  );
  assert.equal(
    parsePublicProducts({ ...list, items: [{ ...card, stock: { state: 'MAYBE' } }] }),
    null,
  );
  assert.equal(
    parsePublicProducts({
      ...list,
      items: [{ ...card, stock: { state: 'PRE_ORDER', leadTimeDaysMin: 5, leadTimeDaysMax: 3 } }],
    }),
    null,
  );
  assert.equal(
    parsePublicProducts({
      ...list,
      items: [
        {
          ...card,
          image: { ...image, sources: [{ url: 'https://evil.example/x.png', width: 1 }] },
        },
      ],
    }),
    null,
    "only the site's own media route is ever drawn",
  );
  assert.equal(parsePublicProducts({ ...list, categories: [{ code: 1 }] }), null);
  const withCopy = parsePublicProducts({
    ...list,
    hero: { title: 'Chăm da', text: null, image: null },
    commitment: { title: null, items: ['Giá rõ ràng'] },
  });
  assert.deepEqual(withCopy?.hero, { title: 'Chăm da', text: null, image: null });
  assert.deepEqual(withCopy?.commitment, { title: null, items: ['Giá rõ ràng'] });
  assert.equal(parsePublicProducts({ ...list, hero: { title: 5 } }), null);
  assert.equal(parseProductCodes({ codes: ['a', 'b c', 7, 'd'] })?.codes.join(), 'a,d');
  assert.equal(parseProductCodes({}), null);
});

const detail: PublicProductDetail = {
  code: 'kem-duong',
  name: 'Kem dưỡng',
  description: 'Mô tả',
  category: { code: 'da', name: 'Chăm sóc da' },
  brand: 'Thương hiệu',
  images: [image],
  variants: [
    { id: 'v1', sellOnline: true, label: '30 ml', price, stock: stock.IN_STOCK },
    {
      id: 'v2',
      sellOnline: true,
      label: '50 ml',
      price: { priceVnd: '389000', listPriceVnd: null, discountPercent: null },
      stock: stock.PRE,
    },
  ],
  priceMaxVnd: '389000',
  isNew: false,
  featured: true,
  stock: stock.IN_STOCK,
};

test('the detail answer is checked and needs at least one variant', () => {
  const ok = parseProductDetail({ product: detail, commitment: null, related: [card] });
  assert.equal(ok?.product.variants.length, 2);
  assert.equal(ok?.related[0]?.code, 'kem-duong');
  assert.equal(
    parseProductDetail({ product: { ...detail, variants: [] }, commitment: null, related: [] }),
    null,
  );
  assert.equal(parseProductDetail({ product: detail, commitment: null }), null);
  assert.equal(
    parseProductDetail({ product: { ...detail, images: [{}] }, commitment: null, related: [] }),
    null,
  );
});

test('JSON-LD: a Product with one Offer per variant, price in VND, availability, never a quantity', () => {
  const data = productJsonLd(detail, {
    url: 'https://spa.example/vi/products/kem-duong',
    images: ['https://spa.example/x.webp'],
  });
  assert.equal(data['@type'], 'Product');
  assert.equal(data.name, 'Kem dưỡng');
  assert.deepEqual(data.brand, { '@type': 'Brand', name: 'Thương hiệu' });
  const offers = data.offers as { price: string; priceCurrency: string; availability: string }[];
  assert.deepEqual(
    offers.map((offer) => [offer.price, offer.priceCurrency, offer.availability]),
    [
      ['329000', 'VND', 'https://schema.org/InStock'],
      ['389000', 'VND', 'https://schema.org/PreOrder'],
    ],
  );
  const one = productJsonLd(
    { ...detail, variants: [{ id: 'v1', sellOnline: true, label: null, price, stock: stock.OUT }] },
    { url: 'https://spa.example/p', images: [] },
  );
  assert.equal(
    (one.offers as { availability: string }).availability,
    'https://schema.org/OutOfStock',
  );
  assert.ok(!('image' in one));
  assert.ok(!/quantity|inventoryLevel/i.test(JSON.stringify(data)));
});

const running = {
  slug: 'ngay-hoi-lam-dep',
  name: 'Ngày hội làm đẹp',
  badge: '-25%',
  headline: 'Ngày hội làm đẹp',
  message: 'Giảm đến 25%',
  ctaLabel: 'Mua ngay',
  bannerUrl: '/api/v1/public/media/11111111-1111-4111-8111-111111111111/lg',
  endsAt: '2026-10-31T16:59:59.000Z',
};

test('campaign address: a campaign name is kept in the state, in the address and through paging and sorting', () => {
  const state = productsStateOf({ campaign: 'ngay-hoi-lam-dep', sort: 'newest', page: '2' });
  assert.deepEqual(state, {
    campaign: 'ngay-hoi-lam-dep',
    q: '',
    category: '',
    brand: '',
    sort: 'newest',
    page: 2,
  });
  assert.equal(productsQuery(state), '?campaign=ngay-hoi-lam-dep&sort=newest&page=2');
  assert.equal(
    productsHref('en', withFilter(state, { q: 'kem' })),
    '/en/products?campaign=ngay-hoi-lam-dep&q=kem&sort=newest',
  );
  assert.equal(campaignHref('vi', 'ngay-hoi-lam-dep'), '/vi/products?campaign=ngay-hoi-lam-dep');
  // A malformed name falls back to the plain list; no empty field is added to the plain state.
  for (const bad of ['Ngay Hoi', 'a b', '-x', 'x--y', '../x', '']) {
    assert.deepEqual(productsStateOf({ campaign: bad }), EMPTY_PRODUCTS_STATE, bad);
  }
  assert.equal(isPlainList(state), false, 'a sale view is a view of the list, not the list');
  assert.equal(isPlainList(productsStateOf({})), true);
});

test('prices: a campaign on a card or variant is read; a malformed one makes the answer unreadable', () => {
  const campaign = { slug: 'ngay-hoi-lam-dep', name: 'Ngày hội', badge: null };
  const withCampaign = { ...list, items: [{ ...card, price: { ...price, campaign } }] };
  assert.deepEqual(parsePublicProducts(withCampaign)?.items[0]?.price.campaign, campaign);
  assert.equal(parsePublicProducts(list)?.items[0]?.price.campaign, undefined);
  for (const broken of [
    { slug: 1, name: 'x', badge: null },
    { slug: 'a-b', name: 'x', badge: 5 },
    'x',
  ]) {
    assert.equal(
      parsePublicProducts({ ...list, items: [{ ...card, price: { ...price, campaign: broken } }] }),
      null,
    );
  }
});

test('the badge of a price: the words of the campaign, else the percent, else nothing', () => {
  const named = { ...price, campaign: { slug: 'a-b', name: 'N', badge: 'Giảm sâu' } };
  assert.equal(priceBadgeText(named), 'Giảm sâu');
  assert.equal(
    priceBadgeText({ ...named, campaign: { slug: 'a-b', name: 'N', badge: null } }),
    '-15%',
  );
  assert.equal(
    priceBadgeText({ ...named, campaign: { slug: 'a-b', name: 'N', badge: '  ' } }),
    '-15%',
  );
  assert.equal(priceBadgeText(price), '-15%');
  assert.equal(
    priceBadgeText({ priceVnd: '1000', listPriceVnd: null, discountPercent: null }),
    null,
  );
});

test('running campaigns: parsed leniently, at most two strips, the sale view finds its campaign only while it runs', () => {
  const parsed = parsePublicCampaigns({
    campaigns: [
      running,
      { ...running, slug: 'Bad Slug' },
      { ...running, slug: 'khong-banner', bannerUrl: 'https://evil.example/x.png' },
      {
        ...running,
        slug: 'khong-chu',
        badge: null,
        headline: null,
        message: null,
        ctaLabel: null,
        bannerUrl: null,
      },
      { slug: 'thieu' },
    ],
  });
  assert.deepEqual(
    parsed?.campaigns.map((entry) => [entry.slug, entry.bannerUrl]),
    [
      ['ngay-hoi-lam-dep', running.bannerUrl],
      ['khong-banner', null],
      ['khong-chu', null],
    ],
  );
  assert.equal(parsePublicCampaigns(null), null);
  assert.equal(parsePublicCampaigns({ campaigns: 'x' }), null);
  assert.deepEqual(parsePublicCampaigns({ campaigns: [] }), { campaigns: [] });
  const all = parsed?.campaigns ?? [];
  assert.equal(stripCampaigns(all).length, 2);
  assert.deepEqual(stripCampaigns(null), []);
  assert.equal(activeCampaign(all, { campaign: 'khong-chu' })?.slug, 'khong-chu');
  assert.equal(
    activeCampaign(all, { campaign: 'da-het-han' }),
    null,
    'unknown or ended: no sale view',
  );
  assert.equal(activeCampaign(all, {}), null);
  assert.equal(activeCampaign(null, { campaign: 'khong-chu' }), null);
  const banner = campaignBanner(running);
  assert.equal(banner?.sources[0]?.url, running.bannerUrl);
  assert.equal(banner?.alt, running.name);
  assert.equal(campaignBanner({ ...running, bannerUrl: null }), null);
});

test('the last day of a sale is read in the shop time zone', () => {
  // 16:59 UTC on 31 October is 23:59 on 31 October in Da Nang; one minute later it is already 1 November there.
  assert.equal(campaignEndText('2026-10-31T16:59:59.000Z', 'vi'), '31/10/2026');
  assert.equal(campaignEndText('2026-10-31T17:00:00.000Z', 'en'), '01/11/2026');
});
