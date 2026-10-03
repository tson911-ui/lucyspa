import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicService, PublicServiceGroup, PublicSiteResponse } from '@lucy-spa/contracts';
import {
  bookServiceHref,
  directionsUrl,
  featuredServices,
  groupFilter,
  hoursHeadline,
  parsePublicServices,
  parsePublicSite,
  parseServiceDetail,
  serviceEstimate,
  serviceHref,
  servicePrice,
  telHref,
} from './public-site-core';

const service = (patch: Partial<PublicService> = {}): PublicService => ({
  code: 'GOI_THUONG',
  name: 'Gội thường',
  description: null,
  priceMinVnd: '50000',
  priceMaxVnd: '50000',
  pricingUnit: 'PER_SERVICE',
  estimatedMinMinutes: 30,
  estimatedMaxMinutes: 45,
  ...patch,
});

const site: PublicSiteResponse = {
  tagline: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
  address: '04 Nguyễn Quang Bích, Đà Nẵng',
  hotline: '0934 936 101',
  hotlineTel: '+84934936101',
  mapUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
  hours: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], closed: false, opensAt: '09:00', closesAt: '21:00' }],
  heroImage: null,
};

test('the shop profile is accepted as sent and drops anything unsafe or malformed', () => {
  assert.deepEqual(parsePublicSite(site), site);
  assert.equal(parsePublicSite({ ...site, hotlineTel: '0934936101' }), null);
  assert.equal(parsePublicSite({ ...site, hours: [{ weekdays: [8], closed: true }] }), null);
  assert.equal(parsePublicSite({ ...site, hours: 'always' }), null);
  assert.equal(parsePublicSite({ ...site, tagline: 5 }), null);
  assert.equal(parsePublicSite(null), null);
  assert.equal(parsePublicSite([]), null);
  // The map link is drawn as a real link: only https survives.
  assert.equal(parsePublicSite({ ...site, mapUrl: 'javascript:alert(1)' })?.mapUrl, null);
  assert.equal(parsePublicSite({ ...site, mapUrl: 'http://maps.example.com' })?.mapUrl, null);
  assert.equal(
    parsePublicSite({ ...site, mapUrl: 'https://maps.example.com/?q=Lucy' })?.mapUrl,
    'https://maps.example.com/?q=Lucy',
  );
  const id = '0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c';
  const image = {
    alt: 'Ảnh',
    width: 800,
    height: 600,
    sources: [{ url: `/api/v1/public/media/${id}/md`, width: 960 }],
  };
  assert.deepEqual(parsePublicSite({ ...site, heroImage: image })?.heroImage, image);
  assert.equal(
    parsePublicSite({
      ...site,
      heroImage: { ...image, sources: [{ url: 'https://evil.example/x.png', width: 960 }] },
    }),
    null,
  );
});

test('the catalogue and a service detail are checked field by field', () => {
  const groups = { groups: [{ code: 'GOI', name: 'Gội đầu', services: [service()] }] };
  assert.deepEqual(parsePublicServices(groups), groups);
  assert.deepEqual(parsePublicServices({ groups: [] }), { groups: [] });
  assert.equal(parsePublicServices({}), null);
  assert.equal(parsePublicServices({ groups: [{ code: 'GOI', name: 'x' }] }), null);
  assert.equal(
    parsePublicServices({
      groups: [{ code: 'GOI', name: 'x', services: [service({ priceMinVnd: '-5' })] }],
    }),
    null,
  );
  assert.equal(
    parsePublicServices({
      groups: [
        { code: 'GOI', name: 'x', services: [service({ pricingUnit: 'PER_HOUR' as never })] },
      ],
    }),
    null,
  );
  const detail = { service: service(), group: { code: 'GOI', name: 'Gội đầu' }, related: [] };
  assert.deepEqual(parseServiceDetail(detail), detail);
  assert.equal(parseServiceDetail({ ...detail, group: null }), null);
  assert.equal(parseServiceDetail({ ...detail, service: { code: 'x y' } }), null);
});

test('prices: exact, range, per nail, in both languages', () => {
  assert.equal(servicePrice(service(), 'vi'), '50.000 ₫');
  assert.equal(servicePrice(service(), 'en'), '50,000 ₫');
  const nails = service({
    priceMinVnd: '5000',
    priceMaxVnd: '30000',
    pricingUnit: 'PER_NAIL',
  });
  assert.equal(servicePrice(nails, 'vi'), '5.000 ₫ – 30.000 ₫/ngón');
  assert.equal(servicePrice(nails, 'en'), '5,000 ₫ – 30,000 ₫/nail');
  assert.equal(servicePrice(service({ priceMinVnd: '0', priceMaxVnd: '0' }), 'vi'), '0 ₫');
});

test('estimates: one number when equal, a range otherwise; never the scheduling duration', () => {
  assert.equal(
    serviceEstimate(service({ estimatedMinMinutes: 60, estimatedMaxMinutes: 60 }), 'vi'),
    '60 phút',
  );
  assert.equal(serviceEstimate(service(), 'vi'), '30–45 phút');
  assert.equal(serviceEstimate(service(), 'en'), '30–45 min');
});

test('home helpers: first three services, hours headline, links', () => {
  const group: PublicServiceGroup = {
    code: 'G',
    name: 'G',
    services: ['A', 'B', 'C', 'D'].map((code) => service({ code })),
  };
  assert.deepEqual(
    featuredServices(group).map((entry) => entry.code),
    ['A', 'B', 'C'],
  );
  assert.deepEqual(hoursHeadline(site.hours, 'vi', 'Đóng cửa'), {
    label: 'Mỗi ngày',
    value: '09:00 – 21:00',
  });
  assert.equal(
    hoursHeadline([{ weekdays: [1], closed: true, opensAt: null, closesAt: null }], 'vi', 'x'),
    null,
  );
  assert.equal(telHref(site), 'tel:+84934936101');
  assert.equal(
    directionsUrl(site),
    'https://www.google.com/maps/search/?api=1&query=04%20Nguy%E1%BB%85n%20Quang%20B%C3%ADch%2C%20%C4%90%C3%A0%20N%E1%BA%B5ng',
  );
  assert.equal(
    directionsUrl({ ...site, mapUrl: 'https://maps.example.com/x' }),
    'https://maps.example.com/x',
  );
  assert.equal(serviceHref('vi', 'GOI_THUONG'), '/vi/services/GOI_THUONG');
  assert.equal(bookServiceHref('en', 'GOI_THUONG'), '/en/account/book?service=GOI_THUONG');
});

test('the group filter accepts only a group that exists', () => {
  const groups = [{ code: 'GOI', name: 'a', services: [] }];
  assert.equal(groupFilter('GOI', groups), 'GOI');
  assert.equal(groupFilter(['GOI', 'x'], groups), 'GOI');
  assert.equal(groupFilter('NOPE', groups), '');
  assert.equal(groupFilter(undefined, groups), '');
  assert.equal(groupFilter('', groups), '');
});
