import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicServiceDetailResponse, PublicSiteResponse } from '@lucy-spa/contracts';
import {
  absoluteImage,
  clip,
  jsonLdString,
  languageAlternates,
  localBusinessJsonLd,
  openingHoursSpecification,
  ROBOTS_DISALLOW,
  serviceDescription,
  siteOrigin,
  productDescription,
  sitemapEntries,
} from './seo-core';

const site: PublicSiteResponse = {
  tagline: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
  footerBlocks: [],
  intro: null,
  facts: [
    { kind: 'HOURS', icon: 'clock', text: null },
    { kind: 'ADDRESS', icon: 'map-pin', text: null },
    { kind: 'HOTLINE', icon: 'phone', text: null },
  ],
  featuredGroups: [],
  why: null,
  address: '04 Nguyễn Quang Bích, Đà Nẵng',
  hotline: '0934 936 101',
  hotlineTel: '+84934936101',
  mapUrl: 'https://maps.example.com/lucy',
  facebookUrl: null,
  messengerUrl: null,
  zaloUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
  hours: [
    { weekdays: [1, 2, 3, 4, 5, 6], closed: false, opensAt: '09:00', closesAt: '21:00' },
    { weekdays: [7], closed: true, opensAt: null, closesAt: null },
  ],
  heroImage: null,
  chatEnabled: false,
  seoDescription: null,
  englishApproved: false,
};

const headersOf = (values: Record<string, string>) => (name: string) => values[name] ?? null;

test('the origin is the visitor’s host and protocol; anything that is not a plain host is ignored', () => {
  assert.equal(
    siteOrigin(headersOf({ 'x-forwarded-host': 'lucyspa.vn', 'x-forwarded-proto': 'https' })),
    'https://lucyspa.vn',
  );
  assert.equal(siteOrigin(headersOf({ host: 'lucyspa.vn' })), 'https://lucyspa.vn');
  assert.equal(siteOrigin(headersOf({ host: 'localhost:3100' })), 'http://localhost:3100');
  assert.equal(
    siteOrigin(
      headersOf({ 'x-forwarded-host': 'a.example, b.example', 'x-forwarded-proto': 'https, http' }),
    ),
    'https://a.example',
  );
  assert.equal(siteOrigin(headersOf({ host: 'evil.example/"><script>' })), null);
  assert.equal(
    siteOrigin(headersOf({ host: 'evil.example', 'x-forwarded-proto': 'javascript' })),
    'https://evil.example',
  );
  assert.equal(siteOrigin(headersOf({})), null);
});

test('language alternates cover both languages and default to Vietnamese', () => {
  assert.deepEqual(languageAlternates('https://x.vn', '/services'), {
    vi: 'https://x.vn/vi/services',
    en: 'https://x.vn/en/services',
    'x-default': 'https://x.vn/vi/services',
  });
  // Until a person approves the English text, the English address is not offered as an alternate.
  assert.deepEqual(languageAlternates('https://x.vn', '/services', false), {
    vi: 'https://x.vn/vi/services',
    'x-default': 'https://x.vn/vi/services',
  });
});

test('descriptions are clipped at a word with an ellipsis', () => {
  assert.equal(clip('ngắn gọn'), 'ngắn gọn');
  const long = 'một hai ba bốn năm sáu bảy tám chín mười '.repeat(8);
  const clipped = clip(long, 60);
  assert.ok(clipped.length <= 60);
  assert.ok(clipped.endsWith('…'));
  assert.doesNotMatch(clipped, /\s…$/);
});

test('a service description uses the Owner’s text, else a sentence from the catalogue, and the price', () => {
  const detail: PublicServiceDetailResponse = {
    service: {
      code: 'GOI',
      name: 'Gội thường',
      description: null,
      priceMinVnd: '50000',
      priceMaxVnd: '50000',
      pricingUnit: 'PER_SERVICE',
      estimatedMinMinutes: 30,
      estimatedMaxMinutes: 45,
      seoDescription: null,
      englishApproved: false,
    },
    group: { code: 'G', name: 'Gội đầu' },
    related: [],
  };
  assert.equal(
    serviceDescription(detail, 'vi', 'Lucy Spa'),
    'Gội thường tại Lucy Spa, nhóm Gội đầu. Giá 50.000 ₫.',
  );
  const described = { ...detail, service: { ...detail.service, description: 'Gội nhẹ nhàng.' } };
  assert.equal(serviceDescription(described, 'en', 'Lucy Spa'), 'Gội nhẹ nhàng. Price 50,000 ₫.');
});

test('opening hours become schema.org specifications; closed days and 24:00 are handled', () => {
  assert.deepEqual(openingHoursSpecification(site.hours), [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      opens: '09:00',
      closes: '21:00',
    },
  ]);
  const around = openingHoursSpecification([
    { weekdays: [1, 2, 3, 4, 5, 6, 7], closed: false, opensAt: '00:00', closesAt: '24:00' },
  ]);
  assert.equal(around[0]?.closes, '23:59');
  assert.equal(around[0]?.dayOfWeek.length, 7);
});

test('the LocalBusiness data comes only from the shop profile and is safe inside a script tag', () => {
  const data = localBusinessJsonLd(site, 'https://lucyspa.vn', 'vi', 'https://lucyspa.vn/img.webp');
  assert.equal(data['@type'], 'DaySpa');
  assert.equal(data.telephone, '+84934936101');
  assert.equal(data.url, 'https://lucyspa.vn/vi');
  assert.equal(data.address.streetAddress, site.address);
  assert.equal(data.hasMap, 'https://maps.example.com/lucy');
  const bare = localBusinessJsonLd({ ...site, mapUrl: null }, 'https://lucyspa.vn', 'en', null);
  assert.ok(!('hasMap' in bare) && !('image' in bare));
  const script = jsonLdString({ name: '</script><b>&' });
  assert.doesNotMatch(script, /[<>&]/);
  assert.deepEqual(JSON.parse(script), { name: '</script><b>&' });
});

const target = (code: string, english: boolean) => ({ code, english });

test('the sitemap lists every Vietnamese page, and an English page only once its English text is approved', () => {
  const entries = sitemapEntries(
    'https://lucyspa.vn',
    [target('GOI', true), target('NAIL 1', false)],
    [target('kem-duong', true), target('mat na', false)],
    true,
  );
  assert.deepEqual(
    entries.map((entry) => entry.url),
    [
      'https://lucyspa.vn/vi',
      'https://lucyspa.vn/en',
      'https://lucyspa.vn/vi/services',
      'https://lucyspa.vn/en/services',
      'https://lucyspa.vn/vi/services/GOI',
      'https://lucyspa.vn/en/services/GOI',
      'https://lucyspa.vn/vi/services/NAIL%201',
      'https://lucyspa.vn/vi/products',
      'https://lucyspa.vn/en/products',
      'https://lucyspa.vn/vi/products/kem-duong',
      'https://lucyspa.vn/en/products/kem-duong',
      'https://lucyspa.vn/vi/products/mat%20na',
    ],
  );
  // An approved page names both languages; an unapproved one only itself and the default.
  assert.equal(entries[0]?.alternates['en'], 'https://lucyspa.vn/en');
  assert.deepEqual(
    entries.find((entry) => entry.url.endsWith('/vi/services/NAIL%201'))?.alternates,
    {
      vi: 'https://lucyspa.vn/vi/services/NAIL%201',
      'x-default': 'https://lucyspa.vn/vi/services/NAIL%201',
    },
  );
  assert.equal(
    entries.find((entry) => entry.url.endsWith('/vi/products'))?.alternates['en'],
    'https://lucyspa.vn/en/products',
  );
  assert.ok(!entries.some((entry) => /account|workforce/.test(entry.url)));
  // Nothing approved yet: the Vietnamese pages only, the English home page included.
  const none = sitemapEntries('https://lucyspa.vn', [target('GOI', false)], [target('kem', false)]);
  assert.equal(
    none.some((entry) => entry.url.includes('/en')),
    false,
  );
  assert.equal(none.length, 5);
  // Without product codes (nothing published, or the list could not be read) the cosmetics list is left out too.
  assert.equal(
    sitemapEntries('https://lucyspa.vn', []).filter((entry) => /products/.test(entry.url)).length,
    0,
  );
});

test('a service page description is the one the shop approved; a LocalBusiness carries the shop’s own Facebook page and description, nothing invented', () => {
  const detail: PublicServiceDetailResponse = {
    service: {
      code: 'GOI',
      name: 'Gội thường',
      description: null,
      priceMinVnd: '50000',
      priceMaxVnd: '50000',
      pricingUnit: 'PER_SERVICE',
      estimatedMinMinutes: 30,
      estimatedMaxMinutes: 45,
      englishApproved: false,
      seoDescription: 'Gội đầu dưỡng sinh nhẹ nhàng tại Lucy Spa, Đà Nẵng.',
    },
    group: { code: 'g', name: 'Gội đầu' },
    related: [],
  };
  assert.equal(
    serviceDescription(detail, 'vi', 'Lucy Spa'),
    'Gội đầu dưỡng sinh nhẹ nhàng tại Lucy Spa, Đà Nẵng.',
  );
  assert.notEqual(
    serviceDescription(
      { ...detail, service: { ...detail.service, seoDescription: null } },
      'vi',
      'Lucy Spa',
    ),
    detail.service.seoDescription,
  );
  const data = localBusinessJsonLd(
    {
      ...site,
      facebookUrl: 'https://www.facebook.com/lucyspa',
      seoDescription: 'Lucy Spa, Đà Nẵng.',
    },
    'https://lucyspa.vn',
    'vi',
    null,
  );
  assert.deepEqual(data.sameAs, ['https://www.facebook.com/lucyspa']);
  assert.equal(data.description, 'Lucy Spa, Đà Nẵng.');
  const bare = localBusinessJsonLd(site, 'https://lucyspa.vn', 'vi', null);
  for (const key of ['sameAs', 'description', 'aggregateRating', 'review', 'priceRange', 'geo']) {
    assert.ok(!(key in bare), key);
  }
});

test('a product page description: its own text, else name and category; always the price (from, when sizes differ) and the shop address', () => {
  const price = (priceVnd: string) => ({ priceVnd, listPriceVnd: null, discountPercent: null });
  const stock = { state: 'IN_STOCK', leadTimeDaysMin: null, leadTimeDaysMax: null } as const;
  const product = {
    code: 'kem',
    name: 'Kem dưỡng',
    description: null,
    sections: [],
    seoTitle: null,
    seoDescription: null,
    englishApproved: false,
    category: { code: 'da', name: 'Chăm sóc da' },
    brand: null,
    images: [],
    variants: [
      { id: 'v1', sellOnline: true, label: '30 ml', price: price('150000'), stock },
      { id: 'v2', sellOnline: true, label: '50 ml', price: price('120000'), stock },
    ],
    priceMaxVnd: '150000',
    isNew: false,
    featured: false,
    stock,
  };
  assert.equal(
    productDescription(product, 'vi', 'Lucy Spa', '04 Nguyễn Quang Bích'),
    'Kem dưỡng tại Lucy Spa, danh mục Chăm sóc da. Giá từ 120.000 ₫. Mua tại 04 Nguyễn Quang Bích.',
  );
  assert.equal(
    productDescription(
      {
        ...product,
        description: 'Dưỡng ẩm.',
        variants: [product.variants[0]!],
        priceMaxVnd: '150000',
      },
      'en',
      'Lucy Spa',
      null,
    ),
    'Dưỡng ẩm. Price 150,000 ₫.',
  );
  assert.ok(
    productDescription({ ...product, description: 'x'.repeat(400) }, 'vi', 'Lucy Spa', null)
      .length <= 160,
  );
});

test('robots keep crawlers out of the member area, the staff area and the API', () => {
  for (const path of ['/vi/account', '/en/account', '/vi/workforce', '/en/workforce', '/api/']) {
    assert.ok(ROBOTS_DISALLOW.includes(path), path);
  }
});

test('an image address is made absolute only from a site path or an https address', () => {
  assert.equal(
    absoluteImage('https://x.vn', '/api/v1/media/a.webp'),
    'https://x.vn/api/v1/media/a.webp',
  );
  assert.equal(
    absoluteImage('https://x.vn', 'https://cdn.example/a.webp'),
    'https://cdn.example/a.webp',
  );
  assert.equal(absoluteImage('https://x.vn', '//evil.example/a.webp'), null);
  assert.equal(absoluteImage('https://x.vn', 'javascript:alert(1)'), null);
  assert.equal(absoluteImage('https://x.vn', undefined), null);
});
