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
  sitemapEntries,
} from './seo-core';

const site: PublicSiteResponse = {
  tagline: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
  intro: null,
  address: '04 Nguyễn Quang Bích, Đà Nẵng',
  hotline: '0934 936 101',
  hotlineTel: '+84934936101',
  mapUrl: 'https://maps.example.com/lucy',
  timezone: 'Asia/Ho_Chi_Minh',
  hours: [
    { weekdays: [1, 2, 3, 4, 5, 6], closed: false, opensAt: '09:00', closesAt: '21:00' },
    { weekdays: [7], closed: true, opensAt: null, closesAt: null },
  ],
  heroImage: null,
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

test('the sitemap lists home, the service list and each service in both languages with alternates', () => {
  const entries = sitemapEntries('https://lucyspa.vn', ['GOI', 'NAIL 1']);
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
      'https://lucyspa.vn/en/services/NAIL%201',
    ],
  );
  assert.equal(entries[0]?.alternates['en'], 'https://lucyspa.vn/en');
  assert.ok(!entries.some((entry) => /account|workforce/.test(entry.url)));
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
