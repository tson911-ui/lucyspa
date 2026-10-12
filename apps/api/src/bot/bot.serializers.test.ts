import type { PublicSiteResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOT_ALLOWED_KEYS,
  botProducts,
  botPromotions,
  botServices,
  botShop,
  foreignKeys,
  hoursLines,
  openNow,
  promotionConditions,
  type PromotionSource,
} from './bot.serializers.js';

const HOURS = [
  { weekdays: [1, 2, 3, 4, 5], closed: false, opensAt: '09:00', closesAt: '21:00' },
  { weekdays: [6], closed: false, opensAt: '10:00', closesAt: '18:00' },
  { weekdays: [7], closed: true, opensAt: null, closesAt: null },
];

test('opening hours in words, in both languages', () => {
  assert.deepEqual(hoursLines(HOURS, 'vi'), [
    { days: 'Thứ Hai – Thứ Sáu', closed: false, opensAt: '09:00', closesAt: '21:00' },
    { days: 'Thứ Bảy', closed: false, opensAt: '10:00', closesAt: '18:00' },
    { days: 'Chủ nhật', closed: true, opensAt: null, closesAt: null },
  ]);
  assert.equal(
    hoursLines(
      [{ weekdays: [1, 2, 3, 4, 5, 6, 7], closed: false, opensAt: '09:00', closesAt: '21:00' }],
      'en',
    )[0]!.days,
    'Every day',
  );
  assert.equal(
    hoursLines([{ weekdays: [1, 3], closed: false, opensAt: '09:00', closesAt: '21:00' }], 'en')[0]!
      .days,
    'Monday, Wednesday',
  );
});

test('open now follows the shop time zone, the weekday group and the closing minute', () => {
  const zone = 'Asia/Ho_Chi_Minh';
  // Monday 2026-10-12 10:00 in Ho Chi Minh City is 03:00 UTC.
  assert.equal(openNow(HOURS, zone, new Date('2026-10-12T03:00:00Z')), true);
  assert.equal(
    openNow(HOURS, zone, new Date('2026-10-12T14:00:00Z')),
    false,
    '21:00 local: closed on the minute',
  );
  assert.equal(openNow(HOURS, zone, new Date('2026-10-12T01:59:00Z')), false, '08:59 local');
  assert.equal(openNow(HOURS, zone, new Date('2026-10-17T05:00:00Z')), true, 'Saturday 12:00');
  assert.equal(openNow(HOURS, zone, new Date('2026-10-18T05:00:00Z')), false, 'Sunday is closed');
  assert.equal(openNow([], zone, new Date()), null);
});

test('a promotion says its benefit, its scope, its minimum and its dates, and nothing about codes or limits', () => {
  const source: PromotionSource = {
    code: 'SECRET-CODE-1',
    nameVi: 'Tháng tri ân',
    nameEn: 'Thank-you month',
    version: {
      kind: 'PERCENT',
      percentBp: 1000,
      fixedAmountVnd: null,
      minSpendVnd: 500_000n,
      scope: 'BOTH',
      validFrom: new Date('2026-10-01T00:00:00Z'),
      validUntil: new Date('2026-10-31T16:59:00Z'),
    },
  };
  const vi = promotionConditions(source, 'vi', 'Asia/Ho_Chi_Minh');
  assert.match(
    vi,
    /^Giảm 10% cho dịch vụ và mỹ phẩm, cho hóa đơn từ 500\.000 ₫\. Từ 01\/10\/2026 đến 31\/10\/2026\.$/,
  );
  const fixed = promotionConditions(
    {
      ...source,
      version: {
        ...source.version,
        kind: 'FIXED_AMOUNT',
        percentBp: null,
        fixedAmountVnd: 50_000n,
        minSpendVnd: 0n,
        scope: 'SERVICES',
      },
    },
    'en',
    'Asia/Ho_Chi_Minh',
  );
  assert.match(fixed, /^50,000 ₫ off on services\. From /);
  const answer = botPromotions([source], 'vi', 'Asia/Ho_Chi_Minh');
  assert.deepEqual(Object.keys(answer.items[0]!).sort(), [
    'conditions',
    'name',
    'validFrom',
    'validUntil',
  ]);
  assert.ok(!JSON.stringify(answer).includes('SECRET-CODE'), 'a program code never appears');
  assert.deepEqual(foreignKeys(answer), []);
});

test('the allow-list: only written keys come through, and a foreign key anywhere is found', () => {
  assert.deepEqual(foreignKeys({ shop: { name: 'x', hours: [{ days: 'a', closed: false }] } }), []);
  assert.deepEqual(
    foreignKeys({
      shop: { costPriceVnd: '1' },
      items: [{ onHand: 3, sku: 'A', nested: { rowVersion: 1 } }],
    }).sort(),
    ['costPriceVnd', 'nested', 'onHand', 'rowVersion', 'sku'],
  );
  for (const forbidden of [
    'cost',
    'costPriceVnd',
    'margin',
    'sku',
    'barcode',
    'quantity',
    'onHand',
    'rowVersion',
    'email',
    'phone',
    'customer',
    'voucher',
    'review',
    'comment',
    'password',
    'id',
  ]) {
    assert.ok(!BOT_ALLOWED_KEYS.has(forbidden), forbidden);
  }
});

test('shop, services and products are shaped from the public readers without extra fields', () => {
  const site = {
    tagline: 'Thư giãn',
    address: '04 Nguyễn Quang Bích, Đà Nẵng',
    hotline: '0934 936 101',
    hotlineTel: '+84934936101',
    mapUrl: null,
    facebookUrl: null,
    messengerUrl: null,
    zaloUrl: null,
    timezone: 'Asia/Ho_Chi_Minh',
    hours: HOURS,
    footerBlocks: [{ id: 'internal-id', type: 'TEXT', text: 'x' }],
    whyCards: [],
    facts: [],
    featuredGroups: [],
    why: null,
    intro: null,
  } as unknown as PublicSiteResponse;
  const shop = botShop(
    site,
    'vi',
    [{ code: 'DN1', name: 'Đà Nẵng' }],
    new Date('2026-10-12T03:00:00Z'),
  );
  assert.deepEqual(foreignKeys({ shop }), []);
  assert.equal(shop.openNow, true);
  assert.ok(!JSON.stringify(shop).includes('internal-id'));
  const services = botServices({
    groups: [
      {
        code: 'cham-soc',
        name: 'Chăm sóc',
        services: [
          {
            code: 'goi-dau',
            name: 'Gội đầu',
            description: 'Thư giãn',
            priceMinVnd: '150000',
            priceMaxVnd: '200000',
            pricingUnit: 'PER_SERVICE',
            estimatedMinMinutes: 45,
            estimatedMaxMinutes: 60,
          },
        ],
      },
    ],
  });
  assert.deepEqual(foreignKeys(services), []);
  assert.equal(services.groups[0]!.services[0]!.perNail, false);
  const products = botProducts(
    {
      hero: null,
      commitment: null,
      categories: [],
      brands: [],
      items: [
        {
          code: 'kem-duong',
          name: 'Kem dưỡng',
          category: { code: 'da', name: 'Da' },
          brand: 'Hãng',
          image: null,
          price: { priceVnd: '80000', listPriceVnd: '100000', discountPercent: 20 },
          priceMaxVnd: '150000',
          isNew: false,
          featured: true,
          stock: { state: 'PRE_ORDER', leadTimeDaysMin: 3, leadTimeDaysMax: 5 },
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    },
    'vi',
    'https://lucyspa.vn',
  );
  assert.deepEqual(foreignKeys({ products }), []);
  const item = products.items[0]!;
  assert.equal(item.inStock, false);
  assert.equal(item.preOrder, true);
  assert.equal(item.url, 'https://lucyspa.vn/vi/products/kem-duong');
  assert.ok(!JSON.stringify(products).includes('leadTime'), 'no waiting time, only the state');
});
