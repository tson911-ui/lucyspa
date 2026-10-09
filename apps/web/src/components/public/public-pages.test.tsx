import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  PublicServiceDetailResponse,
  PublicServicesResponse,
  PublicSiteResponse,
} from '@lucy-spa/contracts';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { ReactElement } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import type { HomeData } from '../../lib/public-site-core';
import { HomeContent } from './home-content';
import { getSiteText } from '../../i18n/site';
import { ContactWidget, contactItems } from './contact-widget';
import { PublicFooter } from './site-chrome';
import { PublicHeaderCta } from './site-chrome-client';
import { ServiceDetailView, ServicesView } from './services-view';

/** Renders inside a router at `path`: the Back button needs both the router and the current path. */
function renderToStaticMarkup(node: ReactElement, path = '/vi/services'): string {
  return render(
    <AppRouterContext.Provider value={{ push: () => undefined } as never}>
      <PathnameContext.Provider value={path}>{node}</PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

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
  mapUrl: null,
  facebookUrl: null,
  messengerUrl: null,
  zaloUrl: null,
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
  // Direction C draws the tagline over two lines (the dash is not drawn), the second one in the accent.
  assert.match(
    html,
    /<h1[^>]*>Thư Giãn Tận Tâm(?: |<!-- --> )<span class="ls-hero-title-2">Nâng Tầm Nhan Sắc<\/span><\/h1>/,
  );
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
  // A pebble says how many services the group holds and its lowest price (a per-nail price stays one short line).
  assert.match(html, /2 dịch vụ, 50\.000 ₫/);
  assert.match(html, /1 dịch vụ, từ 5\.000 ₫\/ngón/);
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

test('home: the hero shows the chosen picture when there is no slide, else designed photo placeholders', () => {
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
  assert.match(withImage, /data-kind="photo"/);
  assert.doesNotMatch(withImage, /ls-slot-caption|data-kind="slots"/);
  // Without a picture the placeholders say which of the shop's own photos belongs in each frame; none is made up.
  const slots = home(full);
  assert.match(slots, /data-kind="slots"/);
  assert.match(slots, /Ảnh của tiệm: không gian thư giãn/);
  assert.equal(slots.match(/<figure class="ls-slot /g)?.length, 3);
  assert.doesNotMatch(slots, /<img/);
});

test('footer: Facebook and Zalo icons sit with the contact lines, each only when its link is set', () => {
  const links = {
    facebookUrl: 'https://www.facebook.com/lucyspa.danang',
    zaloUrl: 'https://zalo.me/0934936101',
  };
  const both = renderToStaticMarkup(
    <PublicFooter locale="vi" site={{ ...site, ...links }} year={2026} />,
  );
  assert.match(
    both,
    /<a class="ls-footer-icon" data-network="facebook" href="https:\/\/www\.facebook\.com\/lucyspa\.danang" target="_blank" rel="noopener noreferrer" aria-label="Facebook \(mở trong tab mới\)">/,
  );
  assert.match(
    both,
    /<a class="ls-footer-icon" data-network="zalo" href="https:\/\/zalo\.me\/0934936101" target="_blank" rel="noopener noreferrer" aria-label="Zalo \(mở trong tab mới\)">/,
  );
  const onlyZalo = renderToStaticMarkup(
    <PublicFooter locale="en" site={{ ...site, zaloUrl: links.zaloUrl }} year={2026} />,
  );
  assert.match(onlyZalo, /data-network="zalo"[^>]*aria-label="Zalo \(opens in a new tab\)"/);
  assert.doesNotMatch(onlyZalo, /data-network="facebook"/);
  // None set (the default): no icons and no empty group.
  const none = renderToStaticMarkup(<PublicFooter locale="vi" site={site} year={2026} />);
  assert.doesNotMatch(none, /ls-footer-icon/);
});

test('contact button: Zalo, Messenger and phone in that order; an empty link is left out; none without the profile', () => {
  const vi = getSiteText('vi').contactFab;
  const labels = (data: Parameters<typeof contactItems>[0]) =>
    contactItems(data, vi).map((item) => `${item.key}:${item.label}`);
  assert.deepEqual(
    labels({
      zaloUrl: 'https://zalo.me/09',
      messengerUrl: 'https://m.me/lucy',
      hotlineTel: '+84934936101',
    }),
    ['zalo:Nhắn Zalo', 'messenger:Nhắn Messenger', 'call:Gọi Lucy Spa'],
  );
  assert.deepEqual(
    labels({ zaloUrl: null, messengerUrl: 'https://m.me/lucy', hotlineTel: '+84934936101' }),
    ['messenger:Nhắn Messenger', 'call:Gọi Lucy Spa'],
  );
  assert.deepEqual(labels({ zaloUrl: null, messengerUrl: null, hotlineTel: '+84934936101' }), [
    'call:Gọi Lucy Spa',
  ]);
  assert.deepEqual(labels(null), []);
  const call = contactItems(
    { zaloUrl: null, messengerUrl: null, hotlineTel: '+84934936101' },
    vi,
  )[0];
  assert.equal(call?.href, 'tel:+84934936101');
  // English wording.
  assert.equal(getSiteText('en').contactFab.zalo, 'Message on Zalo');
  assert.equal(getSiteText('en').contactFab.call, 'Call Lucy Spa');
  // No profile: no widget at all.
  assert.equal(renderToStaticMarkup(<ContactWidget locale="vi" site={null} />), '');
  const html = renderToStaticMarkup(<ContactWidget locale="vi" site={site} />);
  assert.match(html, /aria-label="Liên hệ"/);
  assert.match(html, /Gọi Lucy Spa/);
});

test('footer: the contact column comes from the shop profile and is absent without it', () => {
  const html = renderToStaticMarkup(<PublicFooter locale="vi" site={site} year={2026} />);
  assert.match(html, /Liên hệ/);
  assert.match(html, /Liên kết/);
  assert.match(html, /04 Nguyễn Quang Bích/);
  assert.match(html, /Điện thoại: <a href="tel:\+84934936101">0934 936 101<\/a>/);
  assert.match(html, /Đăng nhập \/ Đăng ký/);
  assert.match(html, /© 2026 Lucy Spa/);
  // The brand column holds the logo and the shop's own tagline (Shop info), with no blocks seeded; without a profile only the logo.
  assert.match(html, /<p class="ls-footer-tagline">Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc<\/p>/);
  assert.doesNotMatch(
    renderToStaticMarkup(<PublicFooter locale="vi" site={null} year={2026} />),
    /ls-footer-tagline/,
  );
  assert.doesNotMatch(html, /ls-site-footer-blocks/);
  const bare = renderToStaticMarkup(<PublicFooter locale="vi" site={null} year={2026} />);
  assert.doesNotMatch(bare, /Liên hệ/);
  assert.match(bare, /Dịch vụ/);
});

const mediaId = '8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d90';
const blockId = (n: number) => `8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d${String(n).padStart(2, '0')}`;
const blocks: PublicSiteResponse['footerBlocks'] = [
  {
    id: blockId(1),
    type: 'SOCIAL',
    links: [
      { network: 'facebook', url: 'https://facebook.com/lucyspa' },
      { network: 'zalo', url: 'https://zalo.me/0934936101' },
    ],
  },
  {
    id: blockId(2),
    type: 'APP',
    googlePlayUrl: 'https://play.google.com/store/apps/details?id=vn.lucyspa',
    appStoreUrl: 'https://apps.apple.com/vn/app/lucy-spa/id1',
  },
  { id: blockId(3), type: 'TEXT', text: 'Mở cửa mỗi ngày.\nĐặt lịch trước để không phải chờ.' },
  {
    id: blockId(4),
    type: 'LINKS',
    title: 'Khám phá',
    items: [
      { label: 'Dịch vụ', url: '/vi/services' },
      { label: 'Fanpage', url: 'https://facebook.com/lucyspa' },
    ],
  },
  {
    id: blockId(5),
    type: 'IMAGE',
    image: {
      alt: 'Chứng nhận',
      width: 800,
      height: 600,
      sources: [{ url: `/api/v1/public/media/${mediaId}/md`, width: 640 }],
    },
    linkUrl: '/vi/services',
  },
  { id: blockId(6), type: 'SLOGAN', text: 'Thư Giãn Tận Tâm' },
];

test('footer: the Owner blocks are drawn under the logo in order, with safe, named links', () => {
  const html = renderToStaticMarkup(
    <PublicFooter locale="vi" site={{ ...site, footerBlocks: blocks }} year={2026} />,
  );
  const order = [
    'ls-social"',
    'ls-store-badges',
    'ls-footer-text',
    'ls-footer-links"',
    'ls-footer-picture',
    'Thư Giãn Tận Tâm',
  ].map((marker) =>
    // The footer's own tagline under the logo has the same words as the slogan block: the block is the LAST one.
    marker === 'Thư Giãn Tận Tâm' ? html.lastIndexOf(marker) : html.indexOf(marker),
  );
  assert.ok(
    order.every((at) => at > 0),
    'every block is drawn',
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'in the Owner order',
  );
  // The blocks sit in the brand column, before the contact column.
  assert.ok(order.every((at) => at < html.indexOf('Liên hệ')));
  // Social: round buttons that leave the site in a new tab, named for the network and the new tab.
  assert.match(
    html,
    /<a class="ls-social-btn" href="https:\/\/facebook.com\/lucyspa" target="_blank" rel="noopener noreferrer" aria-label="Facebook \(mở trong tab mới\)"/,
  );
  // The official Vietnamese badges, each with the official wording as its name.
  assert.match(html, /aria-label="Tải trên Google Play \(mở trong tab mới\)"/);
  assert.match(html, /aria-label="Tải về trên App Store \(mở trong tab mới\)"/);
  assert.match(html, /src="\/badges\/google-play-vi\.png"/);
  assert.match(html, /src="\/badges\/app-store-vi\.svg"/);
  // Text keeps its lines; a site link stays in the tab, an address opens a new one.
  assert.match(html, /<p class="ls-footer-text">Mở cửa mỗi ngày\.\nĐặt lịch trước/);
  assert.match(html, /<a href="\/vi\/services">Dịch vụ<\/a>/);
  assert.match(
    html,
    /<a href="https:\/\/facebook.com\/lucyspa" target="_blank" rel="noopener noreferrer" aria-label="Fanpage \(mở trong tab mới\)">Fanpage<\/a>/,
  );
  // The picture is a link to a site path (same tab); the link carries the name and the picture's alt is empty.
  assert.match(html, /<a aria-label="Chứng nhận" href="\/vi\/services"><img[^>]*alt=""/);
  assert.match(html, /srcSet="[^"]*\/md 640w"/);
  // Below the fold: no picture of the footer is preloaded or fetched before it is needed.
  assert.doesNotMatch(html, /rel="preload"/);
  assert.equal(html.match(/loading="lazy"/g)?.length, 3, 'two badges and the picture');
  // The slogan block is the shop's slogan as text.
  assert.match(html, /<p class="ls-footer-text">Thư Giãn Tận Tâm<\/p>/);
});

test('footer: the English footer uses the English badges and wording, and a hidden or empty block adds nothing', () => {
  const html = renderToStaticMarkup(
    <PublicFooter
      locale="en"
      site={{
        ...site,
        footerBlocks: [
          blocks[1] as PublicSiteResponse['footerBlocks'][number],
          {
            id: blockId(7),
            type: 'APP',
            googlePlayUrl: 'https://play.google.com/x',
            appStoreUrl: null,
          },
        ],
      }}
      year={2026}
    />,
  );
  assert.match(html, /aria-label="Get it on Google Play \(opens in a new tab\)"/);
  assert.match(html, /aria-label="Download on the App Store \(opens in a new tab\)"/);
  assert.match(html, /src="\/badges\/google-play-en\.png"/);
  assert.match(html, /src="\/badges\/app-store-en\.svg"/);
  // A badge is drawn only for the link that is set.
  assert.equal(html.match(/class="ls-store-badge"/g)?.length, 3);
  assert.equal(html.match(/src="\/badges\/app-store-en\.svg"/g)?.length, 1);
});

test('services list: the filter links, one section per group, a chosen group alone', () => {
  const all = renderToStaticMarkup(<ServicesView locale="vi" data={services} group="" />);
  assert.equal(all.match(/<h1[ >]/g)?.length, 1);
  // Back sits above the title and, without history, goes to the home.
  assert.match(all, /<a class="[^"]*ls-back[^"]*" href="\/vi">.*Quay lại.*<h1/s);
  assert.match(all, /aria-current="true"[^>]*>Tất cả/);
  assert.match(all, /Gội thường/);
  // A row is one link (the name, a leader, the price and the time) plus a separate booking button named after the service.
  assert.match(
    all,
    /<a class="ls-svc-main" href="\/vi\/services\/GOI_THUONG"><span class="ls-svc-name" title="Gội thường">Gội thường<\/span><span class="ls-svc-dots" aria-hidden="true"><\/span>/,
  );
  assert.match(all, /aria-label="Đặt lịch: Gội thường"/);
  assert.match(all, /role="search"/);
  assert.match(all, /Đính đá \/ charm/);
  assert.match(all, /href="\/vi\/services\/GOI_THUONG"/);
  assert.match(all, /href="\/vi\/account\/book\?service=GOI_THUONG"/);
  assert.match(all, /30–45 phút/);
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
  const html = renderToStaticMarkup(
    <ServiceDetailView locale="vi" detail={detail} />,
    '/vi/services/DINH_DA',
  );
  assert.match(html, /<h1[^>]*>Đính đá \/ charm<\/h1>/);
  // Back sits above the title and, without history, goes to the service list.
  assert.match(html, /<a class="[^"]*ls-back[^"]*" href="\/vi\/services">.*Quay lại.*<h1/s);
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

test('header call to action: the same on every page, "My bookings" and the booking page included', () => {
  assert.match(
    renderToStaticMarkup(<PublicHeaderCta locale="vi" />),
    /href="\/vi\/account\/book"[^>]*>Đặt lịch</,
  );
  assert.match(
    renderToStaticMarkup(<PublicHeaderCta locale="en" />),
    /href="\/en\/account\/book"[^>]*>Book now</,
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
  // A stacked list on a phone and one row from a tablet up (site.css), not a column grid.
  assert.match(html, /<div class="ls-site-facts">/);
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
  assert.equal(chosen.match(/class="ls-pebble"/g)?.length, 2);
  assert.match(chosen, /Xem tất cả/);
  const all = home(full);
  assert.equal(all.match(/class="ls-pebble"/g)?.length, 2);
  assert.doesNotMatch(all, /ls-group-desc/);
  assert.match(all, /Bảng giá dịch vụ/);
});

test('home offer ribbon: the most recent running campaign after the services, nothing without one', () => {
  const campaign = {
    slug: 'ngay-hoi-thu',
    name: 'Ngày hội mùa thu',
    badge: 'Ưu đãi',
    headline: 'Giảm 20% mỹ phẩm chăm sóc da',
    message: 'Chỉ trong vài ngày.',
    ctaLabel: 'Mua ngay',
    bannerUrl: null,
    endsAt: '2026-10-31T16:59:59.000Z',
  };
  const html = home({
    ...full,
    campaigns: [campaign, { ...campaign, slug: 'cu', name: 'Cũ' }],
    onlineOpen: true,
  });
  assert.match(html, /<span class="ls-offer-badge">Ưu đãi<\/span>/);
  assert.match(html, /<h2 class="ls-offer-title">Giảm 20% mỹ phẩm chăm sóc da<\/h2>/);
  assert.match(html, /Chỉ trong vài ngày\./);
  assert.match(html, /Đến hết ngày 31\/10\/2026/);
  assert.match(
    html,
    /<a class="[^"]*ls-btn-offer" href="\/vi\/products\?campaign=ngay-hoi-thu">Mua ngay<\/a>/,
  );
  // While "Bán online" is off (or could not be read) the button never promises a purchase: it says "Xem ưu đãi" and leads to the same page.
  for (const closed of [{}, { onlineOpen: false }]) {
    const off = home({ ...full, campaigns: [campaign], ...closed });
    assert.doesNotMatch(off, /Mua ngay/);
    assert.match(
      off,
      /<a class="[^"]*ls-btn-offer" href="\/vi\/products\?campaign=ngay-hoi-thu">Xem ưu đãi<\/a>/,
    );
  }
  // One ribbon only, below the hero and the price list; no campaign (or none readable) draws nothing.
  assert.equal(html.match(/class="ls-offer-card"/g)?.length, 1);
  assert.ok(html.indexOf('ls-offer-card') > html.indexOf('id="groups-title"'));
  assert.doesNotMatch(home(full), /ls-offer/);
  assert.doesNotMatch(home({ ...full, campaigns: [] }), /ls-offer/);
  assert.doesNotMatch(home({ ...full, campaigns: null }), /ls-offer/);
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
