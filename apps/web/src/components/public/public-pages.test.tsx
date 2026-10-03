import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  PublicServiceDetailResponse,
  PublicServicesResponse,
  PublicSiteResponse,
} from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HomeData } from '../../lib/public-site-core';
import { HomeContent } from './home-content';
import { PublicFooter } from './site-chrome';
import { ServiceDetailView, ServicesView } from './services-view';

const site: PublicSiteResponse = {
  tagline: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
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
  mapUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
  hours: [
    { weekdays: [1, 2, 3, 4, 5, 6], closed: false, opensAt: '09:00', closesAt: '21:00' },
    { weekdays: [7], closed: true, opensAt: null, closesAt: null },
  ],
  heroImage: null,
};

const unit = {
  description: null,
  priceMinVnd: '50000',
  priceMaxVnd: '50000',
  pricingUnit: 'PER_SERVICE' as const,
  estimatedMinMinutes: 30,
  estimatedMaxMinutes: 45,
};

const services: PublicServicesResponse = {
  groups: [
    {
      code: 'GOI',
      name: 'Gội đầu',
      services: [
        { ...unit, code: 'GOI_THUONG', name: 'Gội thường' },
        {
          ...unit,
          code: 'GOI_CAO_CAP',
          name: 'Gội cao cấp',
          priceMinVnd: '80000',
          priceMaxVnd: '80000',
          description: 'Nhẹ nhàng',
        },
      ],
    },
    {
      code: 'NAIL',
      name: 'Nail',
      services: [
        {
          ...unit,
          code: 'DINH_DA',
          name: 'Đính đá / charm',
          priceMinVnd: '5000',
          priceMaxVnd: '30000',
          pricingUnit: 'PER_NAIL',
        },
      ],
    },
  ],
};

const full: HomeData = { site, services, slides: [] };
const home = (data: HomeData, locale: 'vi' | 'en' = 'vi') =>
  renderToStaticMarkup(<HomeContent locale={locale} data={data} popup={false} />);

test('home: the tagline is the one h1, facts and visit read the Owner data, no made-up claims', () => {
  const html = home(full);
  assert.equal(html.match(/<h1[ >]/g)?.length, 1);
  assert.match(html, /<h1[^>]*>Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc<\/h1>/);
  assert.match(html, /04 Nguyễn Quang Bích, Đà Nẵng/);
  assert.match(html, /href="tel:\+84934936101"/);
  assert.match(html, /Thứ Hai – Thứ Bảy/);
  assert.match(html, /09:00 – 21:00/);
  // The address opens the map (a search for the address while the Owner has set no link) in a new tab.
  assert.match(
    html,
    /<a href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=[^"]*" target="_blank"/,
  );
  // The "Ghé thăm" section is gone, and nothing is made up: the "why" section stays out until the Owner writes it.
  assert.doesNotMatch(html, /Ghé thăm/);
  assert.doesNotMatch(html, /Vì sao chọn/i);
  assert.doesNotMatch(html, /durationMinutes/);
});

test('home: an introduction set in Shop info replaces the built-in sentence; empty falls back to it, per language', () => {
  const builtIn = /Chọn dịch vụ, chọn giờ còn trống và giữ chỗ trực tuyến trong vài phút\./;
  assert.match(home(full), builtIn);
  assert.match(home({ ...full, site: null }), builtIn);
  assert.match(
    home(full, 'en'),
    /Choose your services, pick a free time and book online in minutes\./,
  );
  const own = home({ ...full, site: { ...site, intro: 'Mở cửa mỗi ngày, đặt lịch dễ dàng.' } });
  assert.match(own, /<p class="ls-lead">Mở cửa mỗi ngày, đặt lịch dễ dàng\.<\/p>/);
  assert.doesNotMatch(own, builtIn);
  // A Vietnamese sentence is never shown to an English visitor: the API sends null for that language.
  assert.match(
    home({ ...full, site: { ...site, intro: null } }, 'en'),
    /Choose your services, pick a free time/,
  );
});

test('home: one card per live group with its prices and a link to all of them', () => {
  const html = home(full);
  assert.match(html, /Gội đầu/);
  assert.doesNotMatch(html, /2 dịch vụ/);
  assert.match(html, /50\.000 ₫/);
  // A per-nail price on a card is one short line ("from"), not the range the services pages show.
  assert.match(html, /từ 5\.000 ₫\/ngón/);
  assert.doesNotMatch(html, /5\.000 ₫ – 30\.000 ₫/);
  assert.match(html, /href="\/vi\/services\?group=GOI"/);
  assert.match(html, /href="\/vi\/services\?group=NAIL"/);
  assert.match(html, /href="\/vi\/services"/);
  assert.match(home(full, 'en'), /from 5,000 ₫\/nail/);
});

test('home: a part that could not be read shows a notice and the rest still renders', () => {
  const noServices = home({ ...full, services: null });
  assert.match(noServices, /Không tải được danh mục dịch vụ/);
  assert.match(noServices, /ls-site-facts/);
  const noSite = home({ ...full, site: null });
  assert.doesNotMatch(noSite, /ls-site-facts/);
  assert.match(noSite, /<h1[^>]*>Lucy Spa<\/h1>/);
  assert.match(noSite, /Gội đầu/);
  assert.match(home({ ...full, services: { groups: [] } }), /Danh mục dịch vụ đang được cập nhật/);
});

test('home: the hero shows the chosen picture when there is no slide, else a brand panel', () => {
  const id = '0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c';
  const withImage = home({
    ...full,
    site: {
      ...site,
      heroImage: {
        alt: 'Quầy lễ tân',
        width: 800,
        height: 500,
        sources: [
          { url: `/api/v1/public/media/${id}/md`, width: 960 },
          { url: `/api/v1/public/media/${id}/lg`, width: 1920 },
        ],
      },
    },
  });
  assert.match(withImage, /<img[^>]*alt="Quầy lễ tân"/);
  assert.match(withImage, /srcSet="[^"]*\/md 960w, [^"]*\/lg 1920w"/);
  assert.doesNotMatch(withImage, /ls-brand-panel/);
  assert.match(home(full), /ls-brand-panel/);
});

test('footer: the contact column comes from the shop profile and is absent without it', () => {
  const html = renderToStaticMarkup(<PublicFooter locale="vi" site={site} year={2026} />);
  assert.match(html, /Liên hệ/);
  assert.match(html, /Liên kết/);
  assert.match(html, /04 Nguyễn Quang Bích/);
  assert.match(html, /Điện thoại: <a href="tel:\+84934936101">0934 936 101<\/a>/);
  assert.match(html, /Đăng nhập \/ Đăng ký/);
  assert.match(html, /Thư Giãn Tận Tâm/);
  assert.match(html, /© 2026 Lucy Spa/);
  const bare = renderToStaticMarkup(<PublicFooter locale="vi" site={null} year={2026} />);
  assert.doesNotMatch(bare, /Liên hệ/);
  assert.match(bare, /Dịch vụ/);
});

test('services list: the filter links, one section per group, a chosen group alone', () => {
  const all = renderToStaticMarkup(<ServicesView locale="vi" data={services} group="" />);
  assert.equal(all.match(/<h1[ >]/g)?.length, 1);
  assert.match(all, /aria-current="true"[^>]*>Tất cả/);
  assert.match(all, /Gội thường/);
  // A service name is a clamped span inside its link; the full name is the tooltip.
  assert.match(
    all,
    /<a[^>]*title="Gội thường"[^>]*><span class="ls-service-name">Gội thường<\/span><\/a>/,
  );
  assert.match(all, /Đính đá \/ charm/);
  assert.match(all, /href="\/vi\/services\/GOI_THUONG"/);
  assert.match(all, /href="\/vi\/account\/book\?service=GOI_THUONG"/);
  assert.match(all, /Dự kiến: 30–45 phút/);
  const nail = renderToStaticMarkup(<ServicesView locale="vi" data={services} group="NAIL" />);
  assert.match(nail, /Đính đá/);
  assert.doesNotMatch(nail, /Gội thường/);
  assert.match(nail, /aria-current="true"[^>]*>Nail/);
  assert.match(
    renderToStaticMarkup(<ServicesView locale="vi" data={null} group="" />),
    /Không tải được danh mục dịch vụ/,
  );
  assert.match(
    renderToStaticMarkup(<ServicesView locale="en" data={{ groups: [] }} group="" />),
    /There are no services to show yet/,
  );
});

test('service detail: facts, the per-nail note, the booking link and the group neighbours', () => {
  const detail: PublicServiceDetailResponse = {
    service: services.groups[1]!.services[0]!,
    group: { code: 'NAIL', name: 'Nail' },
    related: [{ ...unit, code: 'SON_GEL', name: 'Sơn gel' }],
  };
  const html = renderToStaticMarkup(<ServiceDetailView locale="vi" detail={detail} />);
  assert.match(html, /<h1[^>]*>Đính đá \/ charm<\/h1>/);
  assert.match(html, /5\.000 ₫ – 30\.000 ₫\/ngón/);
  assert.match(html, /Tính theo số ngón/);
  assert.match(html, /href="\/vi\/account\/book\?service=DINH_DA"/);
  assert.match(html, /Sơn gel/);
  assert.match(html, /href="\/vi\/services\?group=NAIL"/);
  const plain = renderToStaticMarkup(
    <ServiceDetailView
      locale="vi"
      detail={{ ...detail, service: services.groups[0]!.services[0]! }}
    />,
  );
  assert.match(plain, /Thời gian là dự kiến/);
  assert.match(
    renderToStaticMarkup(<ServiceDetailView locale="vi" detail={null} />),
    /Không tải được danh mục dịch vụ/,
  );
});

test('home facts strip: the Owner order, custom lines, hidden items; the whole strip can be off', () => {
  const custom = { kind: 'CUSTOM' as const, icon: 'sparkles' as const, text: 'Miễn phí gửi xe' };
  const html = home({
    ...full,
    site: {
      ...site,
      mapUrl: 'https://maps.example.com/lucy',
      facts: [
        custom,
        { kind: 'HOTLINE', icon: 'phone', text: null },
        { kind: 'ADDRESS', icon: 'map-pin', text: null },
      ],
    },
  });
  // Order is the Owner's; the hidden hours item (not in the list) is absent; the address opens the Owner's map link.
  assert.ok(html.indexOf('Miễn phí gửi xe') < html.indexOf('href="tel:+84934936101"'));
  assert.ok(
    html.indexOf('href="tel:+84934936101"') < html.indexOf('04 Nguyễn Quang Bích, Đà Nẵng'),
  );
  assert.doesNotMatch(html, /09:00 – 21:00/);
  assert.match(
    html,
    /<a href="https:\/\/maps\.example\.com\/lucy" target="_blank" rel="noopener noreferrer">/,
  );
  // One scrollable row (never wrapping), not a column grid.
  assert.match(html, /<div class="ls-site-facts" tabindex="0">/);
  assert.doesNotMatch(html, /--ls-facts-cols/);
  // The whole strip off: no band at all.
  assert.doesNotMatch(home({ ...full, site: { ...site, facts: [] } }), /ls-site-facts/);
});

test('home service groups: the Owner choice, order and description; none chosen lists every group', () => {
  const chosen = home({
    ...full,
    site: {
      ...site,
      featuredGroups: [
        { code: 'NAIL', description: 'Móng gọn gàng, sơn gel bền màu' },
        { code: 'GONE', description: 'Không còn' },
        { code: 'GOI', description: null },
      ],
    },
  });
  assert.ok(chosen.indexOf('Móng gọn gàng') < chosen.indexOf('Gội đầu'));
  assert.match(chosen, /<p class="ls-group-desc">Móng gọn gàng, sơn gel bền màu<\/p>/);
  assert.doesNotMatch(chosen, /Không còn/);
  assert.equal(chosen.match(/ls-group-card/g)?.length, 2);
  assert.match(chosen, /Xem tất cả/);
  const all = home(full);
  assert.equal(all.match(/ls-group-card/g)?.length, 2);
  assert.doesNotMatch(all, /ls-group-desc/);
  assert.match(all, /Nhóm dịch vụ nổi bật/);
});

test('home why section: only when the Owner wrote it, below the groups, in the visitor language', () => {
  const why = {
    title: 'Điều khách yêu mến',
    cards: [
      { icon: 'leaf' as const, heading: 'Dụng cụ sạch', description: 'Mỗi khách một bộ.' },
      { icon: 'heart' as const, heading: 'Tận tâm', description: 'Lắng nghe nhu cầu.' },
    ],
  };
  const html = home({ ...full, site: { ...site, why } });
  assert.match(html, /<h2[^>]*id="why-title"[^>]*>Điều khách yêu mến<\/h2>/);
  assert.match(html, /<h3[^>]*>Dụng cụ sạch<\/h3>/);
  assert.equal(html.match(/ls-icon-bubble/g)?.length, 2);
  assert.ok(html.indexOf('groups-title') < html.indexOf('why-title'));
  assert.doesNotMatch(home(full), /why-title/);
});
