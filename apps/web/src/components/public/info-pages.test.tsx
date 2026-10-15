import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicPageResponse, PublicSiteResponse } from '@lucy-spa/contracts';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { ReactElement } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { ContactView, mapEmbedUrl } from './contact-view';
import { InfoPageView } from './info-view';
import { PublicFooter } from './site-chrome';

function renderToStaticMarkup(node: ReactElement, path = '/vi/chinh-sach-doi-tra'): string {
  return render(
    <AppRouterContext.Provider value={{ push: () => undefined } as never}>
      <PathnameContext.Provider value={path}>{node}</PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

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
  messengerUrl: 'https://m.me/lucyspa',
  zaloUrl: 'https://zalo.me/0934936101',
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

const BODY = [
  'Phần mở đầu của chính sách.',
  '',
  '## Điều kiện đổi trả',
  '',
  'Giữ **hóa đơn** và sản phẩm *chưa mở*. Xem [dịch vụ](/{locale}/services), [Zalo](https://zalo.me/0934936101) hoặc [gọi](tel:+84934936101).',
  '',
  '### Ngoại lệ',
  '',
  '- Quà tặng',
  '- Hàng giảm giá',
  '',
  '## Hoàn tiền',
  '',
  '1. Mang hóa đơn',
  '2. Chờ 3 ngày',
  '',
  'Giá < 100.000 đ & "đặc biệt" vẫn là chữ.',
].join('\n');

const page = (patch: Partial<PublicPageResponse> = {}): PublicPageResponse => ({
  slug: 'chinh-sach-doi-tra',
  role: 'POLICY',
  title: 'Chính sách đổi trả',
  body: BODY,
  language: 'vi',
  seoTitle: null,
  seoDescription: null,
  updatedAt: '2026-10-14T03:00:00.000Z',
  ...patch,
});

test('an information page: one h1, the text before the first heading, h2 sections, h3, lists, and a table of contents', () => {
  const html = renderToStaticMarkup(<InfoPageView locale="vi" page={page()} />);
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.match(html, /<h1[^>]*>Chính sách đổi trả<\/h1>/);
  assert.equal(html.match(/<h2\b/g)?.length, 2, 'the two ## headings, nothing else');
  assert.match(html, /<section id="dieu-kien-doi-tra"/);
  assert.match(html, /<section id="hoan-tien"/);
  assert.match(html, /<h3 id="ngoai-le">Ngoại lệ<\/h3>/);
  assert.match(html, /<ul><li>Quà tặng<\/li><li>Hàng giảm giá<\/li><\/ul>/);
  assert.match(html, /<ol><li>Mang hóa đơn<\/li><li>Chờ 3 ngày<\/li><\/ol>/);
  assert.ok(html.indexOf('Phần mở đầu') < html.indexOf('Điều kiện đổi trả'));
  assert.match(html, /<strong>hóa đơn<\/strong>/);
  assert.match(html, /<em>chưa mở<\/em>/);
  // Two sections: the table of contents, in the visitor's language, linking to each.
  assert.match(html, /<nav aria-label="Trong trang này" class="ls-info-toc">/);
  assert.match(html, /href="#dieu-kien-doi-tra"/);
  assert.match(html, /href="#hoan-tien"/);
  assert.doesNotMatch(html, /lang="/, 'the page is in its own language');
});

test('a table in the text: a real table with column headings, the first cell a row heading, each value naming its column for a phone', () => {
  const html = renderToStaticMarkup(
    <InfoPageView
      locale="vi"
      page={page({
        body: [
          'Mở đầu.',
          '',
          '| Hạng | Điểm | Ưu đãi |',
          '| --- | --- | --- |',
          '| Silver | Từ 500 | Giảm **3%** |',
          '| Gold | Từ 1.000 | Giảm 4% |',
        ].join('\n'),
      })}
    />,
  );
  assert.match(html, /<div class="ls-info-table-wrap"><table class="ls-info-table">/);
  assert.match(
    html,
    /<thead><tr><th scope="col">Hạng<\/th><th scope="col">Điểm<\/th><th scope="col">Ưu đãi<\/th><\/tr><\/thead>/,
  );
  assert.match(
    html,
    /<tr><th scope="row">Silver<\/th><td data-label="Điểm">Từ 500<\/td><td data-label="Ưu đãi">Giảm <strong>3%<\/strong><\/td><\/tr>/,
  );
  assert.equal(html.match(/<tbody>/g)?.length, 1);
});

test('links: the language in /{locale}, a new tab said in words for another site, tel stays plain; markup is never HTML', () => {
  const vi = renderToStaticMarkup(<InfoPageView locale="vi" page={page()} />);
  assert.match(vi, /<a href="\/vi\/services">dịch vụ<\/a>/);
  assert.match(
    vi,
    /<a href="https:\/\/zalo\.me\/0934936101" target="_blank" rel="noopener noreferrer">Zalo<span class="ls-visually-hidden"> \(mở trong tab mới\)<\/span><\/a>/,
  );
  assert.match(vi, /<a href="tel:\+84934936101">gọi<\/a>/);
  const en = renderToStaticMarkup(
    <InfoPageView locale="en" page={page({ language: 'en' })} />,
    '/en/x',
  );
  assert.match(en, /<a href="\/en\/services">/);
  assert.match(en, /opens in a new tab/);
  // "<", "&" and quotes in the words are text, escaped by the renderer: nothing can become a tag.
  assert.match(vi, /Giá &lt; 100\.000 đ &amp; &quot;đặc biệt&quot; vẫn là chữ\./);
  assert.doesNotMatch(vi, /dangerouslySetInnerHTML|<script|javascript:/);
});

test('a page whose text broke the rules is never drawn half: a notice instead', () => {
  const html = renderToStaticMarkup(
    <InfoPageView locale="vi" page={page({ body: 'Có <script>alert(1)</script>' })} />,
  );
  assert.doesNotMatch(html, /<script|alert/);
  assert.match(html, /role="/);
});

test('Vietnamese text shown to an English visitor says so (lang) and a short page has no table of contents', () => {
  const html = renderToStaticMarkup(
    <InfoPageView locale="en" page={page({ language: 'vi', body: '## Một\n\nChỉ một mục.' })} />,
    '/en/x',
  );
  assert.match(html, /<article class="ls-info-article" lang="vi">/);
  assert.doesNotMatch(html, /ls-info-toc/);
});

test('the contact page: the embed of the address with a title, lazy loading and no key; the same place as a plain link', () => {
  const html = renderToStaticMarkup(<ContactView locale="vi" site={site} />, '/vi/contact');
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  const frame = /<iframe[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(frame, /title="Bản đồ đường đến Lucy Spa"/);
  assert.match(frame, /loading="lazy"/);
  assert.match(
    frame,
    /referrerPolicy="no-referrer-when-downgrade"|referrerpolicy="no-referrer-when-downgrade"/,
  );
  assert.match(
    frame,
    /src="https:\/\/www\.google\.com\/maps\?q=04%20Nguy%E1%BB%85n%20Quang%20B%C3%ADch%2C%20%C4%90%C3%A0%20N%E1%BA%B5ng&amp;hl=vi&amp;output=embed"/,
  );
  assert.doesNotMatch(frame, /key=/);
  assert.equal(mapEmbedUrl('A&B', 'en'), 'https://www.google.com/maps?q=A%26B&hl=en&output=embed');
  // The address, the fallback link to the same place, the hotline and the hours.
  assert.match(html, /04 Nguyễn Quang Bích, Đà Nẵng/);
  assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/);
  assert.match(html, /Mở trong Google Maps<span class="ls-visually-hidden"> \(mở trong tab mới\)/);
  assert.match(html, /<a href="tel:\+84934936101">0934 936 101<\/a>/);
  assert.match(html, /09:00/);
  assert.match(html, /Gọi ngay/);
  assert.match(html, /Nhắn Zalo/);
  assert.match(html, /Nhắn Messenger/);
  // The owner's own map link is the fallback when there is one.
  const own = renderToStaticMarkup(
    <ContactView locale="vi" site={{ ...site, mapUrl: 'https://maps.app.goo.gl/lucy' }} />,
    '/vi/contact',
  );
  assert.match(own, /href="https:\/\/maps\.app\.goo\.gl\/lucy"/);
});

test('the contact page leaves out the pills it has no link for, and says so when the profile could not be read', () => {
  const bare = renderToStaticMarkup(
    <ContactView locale="en" site={{ ...site, zaloUrl: null, messengerUrl: null }} />,
    '/en/contact',
  );
  assert.match(bare, /Call now/);
  assert.doesNotMatch(bare, /Message on Zalo|Message on Messenger/);
  const none = renderToStaticMarkup(<ContactView locale="vi" site={null} />, '/vi/contact');
  assert.doesNotMatch(none, /<iframe/);
  assert.match(none, /Chưa đọc được thông tin liên hệ/);
});

test('footer (session 7b, Owner 2026-10-15): the Chính sách column lists every published page, the legal line repeats terms and privacy under fixed labels', () => {
  const pages = [
    { slug: 'bao-hanh', title: 'Bảo hành', role: 'POLICY' as const },
    {
      slug: 'chinh-sach-bao-mat',
      title: 'Chính sách bảo mật thông tin cá nhân',
      role: 'PRIVACY' as const,
    },
    { slug: 'dieu-khoan-su-dung', title: 'Điều khoản sử dụng', role: 'TERMS' as const },
    { slug: 'doi-tra', title: 'Đổi trả', role: 'POLICY' as const },
  ];
  const html = renderToStaticMarkup(
    <PublicFooter locale="vi" site={{ ...site, pages }} year={2026} />,
    '/vi',
  );
  assert.match(html, /data-columns="3"/);
  assert.match(html, /<h2 class="ls-site-footer-title">Chính sách<\/h2>/);
  // The column holds all of them, terms and privacy too, in the order the API sent (by title).
  const column = html.slice(
    html.indexOf('data-column="policies"'),
    html.indexOf('</ul>', html.indexOf('data-column="policies"')),
  );
  assert.match(
    column,
    /href="\/vi\/bao-hanh">Bảo hành.*href="\/vi\/chinh-sach-bao-mat">Chính sách bảo mật thông tin cá nhân.*href="\/vi\/dieu-khoan-su-dung">Điều khoản sử dụng.*href="\/vi\/doi-tra">Đổi trả/,
  );
  // The legal line: terms first, then privacy, under the fixed labels (not the page titles).
  assert.match(
    html,
    /<nav class="ls-site-footer-legal" aria-label="Thông tin pháp lý"><ul><li><a href="\/vi\/dieu-khoan-su-dung">Điều khoản sử dụng<\/a><\/li><li><a href="\/vi\/chinh-sach-bao-mat">Chính sách bảo mật<\/a><\/li><\/ul><\/nav>/,
  );
  assert.ok(html.indexOf('© 2026 Lucy Spa') < html.indexOf('ls-site-footer-legal'));
  // None published: neither the column nor the line.
  const empty = renderToStaticMarkup(<PublicFooter locale="vi" site={site} year={2026} />, '/vi');
  assert.doesNotMatch(empty, /Chính sách|ls-site-footer-legal|data-column="policies"/);
  assert.match(empty, /data-columns="2"/);
  // Only the terms page: the line and the column; only a policy: the column without the line.
  const legalOnly = renderToStaticMarkup(
    <PublicFooter locale="en" site={{ ...site, pages: [pages[2]!] }} year={2026} />,
    '/en',
  );
  assert.match(legalOnly, /aria-label="Legal"/);
  assert.match(legalOnly, /data-column="policies"/);
  assert.match(legalOnly, />Terms of use<\/a>/);
  const policyOnly = renderToStaticMarkup(
    <PublicFooter locale="en" site={{ ...site, pages: [pages[0]!] }} year={2026} />,
    '/en',
  );
  assert.match(policyOnly, /data-column="policies"/);
  assert.match(policyOnly, />Policies<\/h2>/);
  assert.doesNotMatch(policyOnly, /ls-site-footer-legal/);
});
