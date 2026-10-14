import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  PublicProductCard,
  PublicProductsResponse,
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
import { HomeProductRow } from './home-product-row';
import { homeFeaturedProducts } from '../../lib/public-site-core';
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
  chatEnabled: false,
  pages: [],
  seoDescription: null,
  englishApproved: false,
};

const unit = {
  description: null,
  priceMinVnd: '50000',
  priceMaxVnd: '50000',
  pricingUnit: 'PER_SERVICE' as const,
  estimatedMinMinutes: 30,
  estimatedMaxMinutes: 45,
  seoDescription: null,
  englishApproved: false,
  image: null,
};

const services: PublicServicesResponse = {
  groups: [
    {
      code: 'GOI',
      name: 'Gội đầu',
      image: null,
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
      image: null,
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
  // The tagline is plain text in the one h1 (the smoke check reads it), whole as the Owner wrote it.
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
  // No count beside a group name (Owner rule: counts live in the table line and in empty states only).
  assert.doesNotMatch(html, /\d dịch vụ/);
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
  assert.match(noServices, /ls-home-facts/);
  const noSite = home({ ...full, site: null });
  assert.doesNotMatch(noSite, /ls-home-facts/);
  assert.match(noSite, /<h1[^>]*>Lucy Spa<\/h1>/);
  assert.match(noSite, /Gội đầu/);
  assert.match(home({ ...full, services: { groups: [] } }), /Danh mục dịch vụ đang được cập nhật/);
});

test('home: the hero is the Owner picture under one flat scrim, else a flat band; the slider keeps its place in the intro', () => {
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
  assert.match(withImage, /data-media="photo"/);
  assert.match(withImage, /class="ls-home-hero-scrim"/);
  assert.doesNotMatch(withImage, /ls-home-hero-caption/);
  // Without a picture the hero is a flat band, and each frame says which of the shop's own photos belongs in it; none is made up.
  const flat = home(full);
  assert.match(flat, /data-media="flat"/);
  assert.doesNotMatch(flat, /ls-home-hero-scrim/);
  assert.match(flat, /Ảnh của tiệm: không gian thư giãn/);
  assert.match(flat, /Ảnh của tiệm: kỹ thuật viên đang làm dịch vụ/);
  assert.doesNotMatch(flat, /<img/);
  // The primary action keeps its place; the outline-white form is the secondary button's, drawn only over a photo (pages-v2.css).
  assert.equal(withImage.match(/ls-btn-primary/g)?.length, 1);
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
  // No contact column without the profile (the contact page link in the links column stays).
  assert.doesNotMatch(bare, />Liên hệ<\/h2>/);
  assert.match(bare, /href="\/vi\/contact">Liên hệ<\/a>/);
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
  // A card is one link (the name, stretched over the card) plus a separate booking button named after the service; the photo is a flat
  // placeholder. The title band and the chips row come before the first group, and the bands alternate from the base color.
  assert.match(
    all,
    /<h3 class="ls-svc-card-name"><a title="Gội thường" href="\/vi\/services\/GOI_THUONG">Gội thường<\/a><\/h3>/,
  );
  assert.match(all, /class="ls-image-frame ls-svc-media"/);
  assert.ok(all.indexOf('ls-svc-title') < all.indexOf('ls-svc-chips'));
  assert.ok(all.indexOf('ls-svc-chips') < all.indexOf('ls-svc-grid'));
  assert.deepEqual(
    [...all.matchAll(/ls-band--(base|alt)/g)].map((match) => match[1]),
    ['alt', 'base', 'alt'],
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
  // The empty and error states keep the title band and the page's one h1, and draw no chips or cards.
  for (const data of [null, { groups: [] }]) {
    const state = renderToStaticMarkup(<ServicesView locale="vi" data={data} group="" />);
    assert.equal(state.match(/<h1[ >]/g)?.length, 1);
    assert.doesNotMatch(state, /ls-svc-chips|ls-svc-grid/);
  }
});

const photo = {
  alt: 'Ảnh dịch vụ',
  width: 800,
  height: 600,
  sources: [
    { url: '/api/v1/public/media/0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c/md', width: 640 },
    { url: '/api/v1/public/media/0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c/lg', width: 1280 },
  ],
};

test('service detail (C11b): the Owner’s photo replaces the placeholder, and each optional band appears only with content', () => {
  const base: PublicServiceDetailResponse = {
    service: { ...services.groups[0]!.services[0]!, image: photo },
    content: { included: [], steps: [], faq: [] },
    group: { code: 'GOI', name: 'Gội đầu' },
    related: [],
  };
  const bare = renderToStaticMarkup(<ServiceDetailView locale="vi" detail={base} />);
  assert.match(bare, /<img[^>]*class="ls-slot-img"[^>]*alt="Ảnh dịch vụ"/);
  assert.match(bare, /srcSet="[^"]*\/md 640w, [^"]*\/lg 1280w"/);
  assert.doesNotMatch(bare, /Ảnh của tiệm/);
  assert.doesNotMatch(bare, /Dịch vụ bao gồm|Các bước thực hiện|Câu hỏi thường gặp/);
  assert.doesNotMatch(bare, /id="(included|steps|faq)-title"/);

  const full = renderToStaticMarkup(
    <ServiceDetailView
      locale="vi"
      detail={{
        ...base,
        service: { ...base.service, image: null },
        content: {
          included: ['Gội đầu thảo dược', 'Massage cổ vai'],
          steps: ['Rửa tóc', 'Xả sạch'],
          faq: [{ question: 'Có đau không?', answer: 'Không đau.' }],
        },
      }}
    />,
  );
  assert.match(full, /Ảnh của tiệm/, 'no photo: the flat placeholder with its caption');
  assert.match(full, /<h2[^>]*id="included-title"[^>]*>Dịch vụ bao gồm<\/h2>/);
  assert.match(
    full,
    /<li><span class="ls-svd-check"><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg><\/span><span>Gội đầu thảo dược<\/span><\/li>/s,
  );
  assert.match(full, /<h2[^>]*id="steps-title"[^>]*>Các bước thực hiện<\/h2>/);
  assert.match(full, /<ol class="ls-svd-steps"><li>Rửa tóc<\/li><li>Xả sạch<\/li><\/ol>/);
  assert.match(full, /<h2[^>]*id="faq-title"[^>]*>Câu hỏi thường gặp<\/h2>/);
  assert.match(full, /aria-expanded="false"[^>]*>.*Có đau không\?/s);
  // The bands keep alternating from the hero (alt): included base, steps alt, faq base, then the booking band alt.
  assert.deepEqual(
    [...full.matchAll(/ls-band--(base|alt)/g)].map((match) => match[1]),
    ['alt', 'base', 'alt', 'base', 'alt'],
  );
  // Only one language's content reaches the page: an English visitor gets the English headings.
  assert.match(
    renderToStaticMarkup(
      <ServiceDetailView
        locale="en"
        detail={{ ...base, content: { included: ['Towel'], steps: [], faq: [] } }}
      />,
    ),
    /What is included/,
  );
});

test('service cards and category tiles (C11b): a chosen photo is drawn, otherwise the flat placeholder', () => {
  const withPhoto = renderToStaticMarkup(
    <ServicesView
      locale="vi"
      data={{
        groups: [
          {
            ...services.groups[0]!,
            image: photo,
            services: [{ ...services.groups[0]!.services[0]!, image: photo }],
          },
        ],
      }}
      group=""
    />,
  );
  assert.match(withPhoto, /<img[^>]*src="\/api\/v1\/public\/media\/[^"]*\/md"[^>]*alt=""/);
  const without = renderToStaticMarkup(<ServicesView locale="vi" data={services} group="" />);
  assert.doesNotMatch(without, /<img/);
  assert.match(without, /ls-image-frame-fallback/);
});

test('service detail: facts, the per-nail note, the booking link and the group neighbours', () => {
  const detail: PublicServiceDetailResponse = {
    service: services.groups[1]!.services[0]!,
    content: { included: [], steps: [], faq: [] },
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
  // Split hero: the photo placeholder beside the copy; one primary in the hero and one in the booking band, the phone bar (hidden until the
  // page has measured) and the related services as a scroll row of cards. No FAQ, steps or "what is included" band while the Owner wrote none.
  assert.match(html, /class="ls-slot ls-svd-slot"/);
  assert.equal(html.match(/data-book-cta=/g)?.length, 2);
  assert.match(
    html,
    /class="ls-action-bar ls-svc-bar" data-shown="false" role="region" aria-label="Đặt lịch dịch vụ này"/,
  );
  assert.match(html, /<ul class="ls-snap-track" aria-label="Dịch vụ cùng nhóm"/);
  assert.match(html, /id="cta-title"/);
  assert.doesNotMatch(html, /FAQ|Câu hỏi|Bao gồm|Các bước/i);
  assert.deepEqual(
    [...html.matchAll(/ls-band--(base|alt)/g)].map((match) => match[1]),
    ['alt', 'base', 'alt'],
  );
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
    /href="\/vi\/account\/book"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*<\/svg>Đặt lịch</,
  );
  assert.match(
    renderToStaticMarkup(<PublicHeaderCta locale="en" />),
    /href="\/en\/account\/book"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*<\/svg>Book now</,
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
  // A stacked list on a phone and one row from a tablet up (pages-v2.css); each fact is a figure with a caption.
  assert.match(html, /<div class="ls-home-facts">/);
  assert.match(html, /<p class="ls-home-fact-figure">Miễn phí gửi xe<\/p>/);
  assert.doesNotMatch(html, /--ls-facts-cols/);
  // The whole strip off: no band at all.
  assert.doesNotMatch(home({ ...full, site: { ...site, facts: [] } }), /ls-home-facts/);
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
  assert.match(chosen, /<p class="ls-home-top-desc">Móng gọn gàng, sơn gel bền màu<\/p>/);
  assert.doesNotMatch(chosen, /Không còn/);
  // One column of top services and one category tile for each group, and a link to all the services.
  assert.equal(chosen.match(/class="ls-home-top-col"/g)?.length, 2);
  assert.equal(chosen.match(/class="ls-home-cat"/g)?.length, 2);
  assert.match(chosen, /Xem tất cả dịch vụ/);
  const all = home(full);
  assert.equal(all.match(/class="ls-home-top-col"/g)?.length, 2);
  assert.doesNotMatch(all, /ls-home-top-desc/);
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
  assert.ok(html.indexOf('ls-offer-card') > html.indexOf('id="intro-title"'));
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
  assert.equal(html.match(/class="ls-home-why-card"/g)?.length, 2);
  assert.ok(html.indexOf('intro-title') < html.indexOf('why-title'));
  assert.doesNotMatch(home(full), /why-title/);
});

const card = (code: string, patch: Partial<PublicProductCard> = {}): PublicProductCard => ({
  code,
  name: `Sản phẩm ${code}`,
  category: { code: 'skin', name: 'Chăm sóc da' },
  brand: null,
  image: null,
  price: { priceVnd: '300000', listPriceVnd: null, discountPercent: null },
  priceMaxVnd: '300000',
  isNew: false,
  featured: false,
  stock: { state: 'IN_STOCK', leadTimeDaysMin: null, leadTimeDaysMax: null },
  ...patch,
});

const catalog: PublicProductsResponse = {
  hero: null,
  commitment: null,
  categories: [
    { code: 'skin', name: 'Chăm sóc da', parentCode: null, image: null },
    { code: 'skin-face', name: 'Mặt', parentCode: 'skin', image: null },
  ],
  brands: [],
  items: [
    card('a', { featured: true, isNew: true }),
    card('b'),
    card('c', {
      featured: true,
      price: { priceVnd: '240000', listPriceVnd: '300000', discountPercent: 20 },
    }),
  ],
  page: 1,
  pageSize: 20,
  total: 3,
};

test('home product row (C11b): the page ships only a skeleton shell; the row’s code and cards load after the first paint', () => {
  const html = home({ ...full, products: catalog });
  assert.match(html, /<h2[^>]*id="products-title"[^>]*>Sản phẩm nổi bật<\/h2>/);
  assert.match(html, /href="\/vi\/products"/);
  // One quiet card for each marked product, hidden from assistive technology; none of the real card markup is in the first HTML.
  assert.match(html, /<div class="ls-pcard-lazy"><div class="ls-snap-row" aria-hidden="true">/);
  assert.equal(html.match(/ls-skel-name/g)?.length, 2);
  assert.doesNotMatch(html, /href="\/vi\/products\/a"|ls-badge-|aria-label="Sản phẩm trước"/);
});

test('home product row cards: only the Owner-marked products, labelled Mới and the sale percent once, never "Bán chạy"', () => {
  const cards = homeFeaturedProducts(catalog);
  assert.equal(cards.length, 2);
  const html = renderToStaticMarkup(
    <HomeProductRow locale="vi" cards={cards} label="Sản phẩm nổi bật" />,
  );
  assert.equal(html.match(/class="ls-pcard"/g)?.length, 2);
  assert.match(html, /href="\/vi\/products\/a"/);
  assert.doesNotMatch(html, /href="\/vi\/products\/b"/);
  // The labels come from real data: Mới (outline) from `isNew`, the percent (ink) from the promotion; the percent is drawn once.
  assert.match(html, /ls-badge-outline[^>]*>Mới</);
  assert.equal(html.match(/-20%|-20 %/g)?.length, 1);
  assert.match(html, /ls-badge-ink/);
  assert.doesNotMatch(html, /Bán chạy/);
  // The row is a labelled, focusable scroller with two arrow buttons (shown from 1024 px by the stylesheet).
  assert.match(html, /<ul class="ls-snap-track" aria-label="Sản phẩm nổi bật" tabindex="0">/);
  assert.match(html, /aria-label="Sản phẩm trước"/);
  assert.match(html, /aria-label="Sản phẩm tiếp theo"/);
});

test('home product row: no band when nothing is marked, when the catalog is empty or when it could not be read', () => {
  const none = { ...catalog, items: catalog.items.map((item) => ({ ...item, featured: false })) };
  for (const products of [none, { ...catalog, items: [] }, null]) {
    const html = home({ ...full, products });
    assert.doesNotMatch(html, /products-title|ls-snap-row/);
  }
  assert.doesNotMatch(home(full), /products-title|ls-snap-row/);
});

test('home category grid: a tile for each service group and each top-level cosmetics category, no counts', () => {
  const html = home({ ...full, products: catalog });
  assert.match(html, /<h2[^>]*id="categories-title"[^>]*>Chọn theo nhóm<\/h2>/);
  assert.match(html, /<a class="ls-home-cat" href="\/vi\/services\?group=GOI">/);
  // A sub-category is reached through its parent: only the parent has a tile.
  assert.match(html, /<a class="ls-home-cat" href="\/vi\/products\?category=skin">/);
  assert.doesNotMatch(html, /category=skin-face/);
  assert.equal(html.match(/class="ls-home-cat"/g)?.length, 3);
  assert.doesNotMatch(html, /\d+ (?:dịch vụ|sản phẩm)/);
  // Without products the services alone fill the grid; without anything at all there is no grid.
  assert.equal(home(full).match(/class="ls-home-cat"/g)?.length, 2);
  assert.doesNotMatch(home({ ...full, services: null }), /categories-title/);
});

test('home: no reviews band (Owner decision Q5) and bands alternate the two colors from the hero down', () => {
  const html = home({ ...full, products: catalog });
  assert.doesNotMatch(html, /Đánh giá|reviews/i);
  const tones = [...html.matchAll(/<section class="ls-band ls-band-page ls-band--(base|alt)/g)].map(
    (match) => match[1],
  );
  assert.ok(tones.length >= 3);
  // The hero is the alternate color, so the first band after it is the base color, then alternating.
  tones.forEach((tone, index) => assert.equal(tone, index % 2 === 0 ? 'base' : 'alt'));
});
