import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDom } from './dom-harness';
import { motionAllowed, staggerIndex, startsVisible } from './reveal-core';

// Public site frame (Part 2, P2-1): menu, tab bar, footer, steps, price list, choice card, header sentinel and the
// reveal; the tokens and stylesheet rules that keep customer-side motion out of the admin.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

const css = readFileSync(new URL('site.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');

test('SiteNav marks the current page and names the landmark', () => {
  const html = renderToStaticMarkup(
    <ui.SiteNav
      label="Menu chính"
      items={[
        { key: 'home', label: 'Trang chủ', href: '/vi', current: true },
        { key: 'services', label: 'Dịch vụ', href: '/vi/services', current: false },
      ]}
    />,
  );
  assert.match(html, /<nav aria-label="Menu chính" class="ls-site-nav">/);
  assert.match(html, /<a href="\/vi" aria-current="page">Trang chủ<\/a>/);
  assert.match(html, /<a href="\/vi\/services">Dịch vụ<\/a>/);
});

test('the menu pill slides to the new current entry on a route change and jumps for everything else', () => {
  const server = renderToStaticMarkup(
    <ui.SiteNav
      label="Menu"
      items={[{ key: 'home', label: 'Trang chủ', href: '/vi', current: true }]}
    />,
  );
  assert.match(server, /<span class="ls-nav-pill" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(server, /data-pill/, 'nothing is placed on the server');

  const proto = window.HTMLElement.prototype;
  const geometry = new Map<string, { left: number; width: number }>([
    ['/vi', { left: 8, width: 96 }],
    ['/vi/services', { left: 112, width: 80 }],
  ]);
  const define = (name: string, read: (element: HTMLElement) => number) =>
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: HTMLElement) {
        return read(this);
      },
    });
  const box = (element: HTMLElement) => geometry.get(element.getAttribute('href') ?? '');
  define('offsetLeft', (element) => box(element)?.left ?? 0);
  define('offsetWidth', (element) => box(element)?.width ?? 0);
  define('offsetTop', () => 4);
  define('offsetHeight', () => 40);

  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const render = (current: string) =>
    act(() =>
      root.render(
        <ui.SiteNav
          label="Menu"
          items={[
            { key: 'home', label: 'Trang chủ', href: '/vi', current: current === 'home' },
            {
              key: 'services',
              label: 'Dịch vụ',
              href: '/vi/services',
              current: current === 'services',
            },
            { key: 'other', label: 'Khác', href: '/vi/other', current: current === 'other' },
          ]}
        />,
      ),
    );
  const nav = () => container.querySelector('nav') as HTMLElement;

  render('home');
  assert.equal(nav().dataset['pill'], 'still', 'first placement never slides');
  assert.equal(nav().style.getPropertyValue('--ls-pill-x'), '8px');
  assert.equal(nav().style.getPropertyValue('--ls-pill-w'), '96px');
  render('services');
  assert.equal(nav().dataset['pill'], 'slide', 'a route change slides');
  assert.equal(nav().style.getPropertyValue('--ls-pill-x'), '112px');
  assert.equal(nav().style.getPropertyValue('--ls-pill-w'), '80px');
  render('other');
  assert.equal(
    nav().dataset['pill'],
    'none',
    'a current entry that is not laid out hides the pill',
  );
  render('home');
  assert.equal(
    nav().dataset['pill'],
    'still',
    'it comes back in place, not sliding from a stale spot',
  );
  act(() => root.unmount());
  for (const name of ['offsetLeft', 'offsetWidth', 'offsetTop', 'offsetHeight']) {
    Reflect.deleteProperty(proto, name);
  }

  assert.match(css, /\.ls-site-nav \{[^}]*position: relative;/);
  assert.match(css, /\.ls-subnav \{[^}]*position: relative;/);
  assert.match(
    css,
    /\[data-pill='slide'\] > \.ls-nav-pill \{\s*transition:\s*translate var\(--ls-dur-glide\) var\(--ls-ease-premium\)/,
  );
  // A route change never fades the page in from nothing: the page paints at once, and the change is a view-transition
  // cross-fade (the tab bar and the contact button are named so they stay above it, the header needs no name).
  assert.doesNotMatch(css, /ls-route-in|\.ls-route-fade\[data-enter/);
  assert.match(css, /\.ls-site \.ls-route-fade \{[^}]*animation: none;/);
  assert.match(css, /\.ls-site \.ls-tab-bar \{\s*view-transition-name: ls-tab-bar;/);
  assert.match(
    css,
    /::view-transition-group\(ls-page\) \{\s*animation-name: none;\s*animation-duration: var\(--ls-dur-base\);/,
  );
  assert.match(css, /::view-transition \{\s*pointer-events: none;/);
});

test('an open dialog hides the phone tab bar (the seasonal frame would otherwise stack it over the dialog buttons)', () => {
  assert.match(css, /\.ls-site:has\(\.ls-backdrop\) \.ls-tab-bar \{\s*visibility: hidden;/);
});

test('RouteEnter never animates the first page of a tab, and does on every later route when motion is allowed', () => {
  assert.doesNotMatch(
    renderToStaticMarkup(
      <ui.RouteEnter>
        <p>x</p>
      </ui.RouteEnter>,
    ),
    /data-enter/,
  );
  class Observer {
    observe() {}
    disconnect() {}
  }
  (window as unknown as Record<string, unknown>).IntersectionObserver = Observer;
  (globalThis as Record<string, unknown>).IntersectionObserver = Observer;
  const mount = () => {
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ui.RouteEnter>
          <p>x</p>
        </ui.RouteEnter>,
      ),
    );
    return { container, root };
  };
  const first = mount();
  assert.equal(first.container.querySelector('.ls-route-fade')?.getAttribute('data-enter'), null);
  act(() => first.root.unmount());
  const later = mount();
  assert.equal(
    later.container.querySelector('.ls-route-fade')?.getAttribute('data-enter'),
    'route',
  );
  act(() => later.root.unmount());
  Reflect.deleteProperty(window, 'IntersectionObserver');
  Reflect.deleteProperty(globalThis, 'IntersectionObserver');
});

test('SiteSubNav is a named landmark of route links whose strip scrolls, never the page', () => {
  const html = renderToStaticMarkup(
    <ui.SiteSubNav
      label="Khu vực thành viên"
      items={[
        { key: 'overview', label: 'Tổng quan', href: '/vi/account', current: false },
        { key: 'bookings', label: 'Lịch hẹn', href: '/vi/account/bookings', current: true },
      ]}
    />,
  );
  assert.match(html, /<nav aria-label="Khu vực thành viên" class="ls-subnav">/);
  assert.match(html, /<a href="\/vi\/account\/bookings" aria-current="page">Lịch hẹn<\/a>/);
  assert.match(css, /\.ls-subnav \{[^}]*overflow-x: auto;/);
  assert.match(css, /\.ls-subnav a \{[^}]*flex: none;[^}]*white-space: nowrap;/);
});

test('TabBar shows at most five destinations and marks the current one', () => {
  const items = ['home', 'services', 'book', 'bookings', 'account', 'extra'].map((key, index) => ({
    key,
    label: `Mục ${key}`,
    href: `/vi/${key}`,
    icon: 'home' as const,
    current: index === 2,
  }));
  const html = renderToStaticMarkup(<ui.TabBar label="Menu điện thoại" items={items} />);
  assert.equal(html.match(/<a /g)?.length, 5);
  assert.doesNotMatch(html, /Mục extra/);
  assert.match(html, /aria-current="page"[^>]*><svg[\s\S]*?<span>Mục book<\/span>/);
});

test('Steps marks the current step, the finished ones and offers a short label for phones', () => {
  const html = renderToStaticMarkup(
    <ui.Steps
      label="Các bước đặt lịch"
      current="people"
      steps={[
        { key: 'services', label: 'Chọn dịch vụ', shortLabel: 'Dịch vụ' },
        { key: 'people', label: 'Khách', shortLabel: 'Khách' },
        { key: 'time', label: 'Nhân viên và giờ', shortLabel: 'Giờ' },
        { key: 'review', label: 'Xác nhận', shortLabel: 'Xác nhận' },
      ]}
    />,
  );
  assert.match(html, /<ol class="ls-steps" aria-label="Các bước đặt lịch">/);
  assert.equal(html.match(/aria-current="step"/g)?.length, 1);
  assert.equal(html.match(/data-done="true"/g)?.length, 1);
  assert.match(html, /1\. Chọn dịch vụ/);
  assert.match(html, /class="ls-steps-short">Giờ</);
});

test('SiteFooter renders the logo alone by default, and the Owner blocks under it in order', () => {
  const columns = [{ key: 'contact', title: 'Liên hệ', items: ['04 Nguyễn Quang Bích, Đà Nẵng'] }];
  const plain = renderToStaticMarkup(
    <ui.SiteFooter brand={<span>Lucy Spa</span>} columns={columns} base="© 2026 Lucy Spa" />,
  );
  assert.match(plain, /<footer class="ls-site-footer">/);
  assert.match(plain, /<h2 class="ls-site-footer-title">Liên hệ<\/h2>/);
  assert.match(plain, /© 2026 Lucy Spa/);
  // No blocks: the brand column is the logo and nothing else (no tagline, no empty wrapper).
  assert.doesNotMatch(plain, /ls-site-footer-blocks/);
  assert.match(plain, /<div class="ls-site-footer-brand"><span>Lucy Spa<\/span><\/div>/);
  const withBlocks = renderToStaticMarkup(
    <ui.SiteFooter
      brand={<span>Lucy Spa</span>}
      blocks={[
        { key: 'a', node: <p>Một</p> },
        { key: 'b', node: <p>Hai</p> },
      ]}
      columns={columns}
      base="x"
    />,
  );
  assert.match(
    withBlocks,
    /<div class="ls-site-footer-blocks"><div class="ls-site-footer-block"><p>Một<\/p><\/div><div class="ls-site-footer-block"><p>Hai<\/p><\/div><\/div>/,
  );
});

test('footer blocks: social icons are round new-tab links named for the network, drawn in currentColor', () => {
  const html = renderToStaticMarkup(
    <ui.SocialLinks
      label="Mạng xã hội"
      items={[
        {
          key: 'facebook',
          label: 'Facebook (mở trong tab mới)',
          href: 'https://facebook.com/lucyspa',
          icon: 'facebook',
        },
        { key: 'zalo', label: 'Zalo (mở trong tab mới)', href: 'https://zalo.me/x', icon: 'zalo' },
      ]}
    />,
  );
  assert.match(html, /<ul class="ls-social" aria-label="Mạng xã hội">/);
  assert.equal(html.match(/<li>/g)?.length, 2);
  assert.equal(html.match(/target="_blank"/g)?.length, 2);
  assert.equal(html.match(/rel="noopener noreferrer"/g)?.length, 2);
  assert.match(html, /aria-label="Facebook \(mở trong tab mới\)"/);
  // The glyph is decorative (the link has the name) and follows the theme: no hex colour anywhere.
  assert.match(html, /<svg[^>]*fill="currentColor"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
});

test('footer blocks: store badges are the official files, unaltered, each a named new-tab link', () => {
  const html = renderToStaticMarkup(
    <ui.StoreBadges
      items={[
        {
          key: 'google-play',
          label: 'Tải trên Google Play (mở trong tab mới)',
          href: 'https://play.google.com/store/apps/details?id=vn.lucyspa',
          src: '/badges/google-play-vi.png',
          width: 646,
          height: 250,
          fileScale: 250 / 192,
        },
        {
          key: 'app-store',
          label: 'Tải về trên App Store (mở trong tab mới)',
          href: 'https://apps.apple.com/vn/app/lucy/id1',
          src: '/badges/app-store-vi.svg',
          width: 120,
          height: 40,
        },
      ]}
    />,
  );
  assert.equal(html.match(/class="ls-store-badge"/g)?.length, 2);
  assert.equal(html.match(/target="_blank"/g)?.length, 2);
  assert.match(html, /aria-label="Tải trên Google Play \(mở trong tab mới\)"/);
  // The link carries the name; the picture is decorative, and nothing filters or recolours it.
  assert.equal(html.match(/<img[^>]*alt=""/g)?.length, 2);
  assert.match(html, /--ls-badge-file-scale:1\.30/);
  assert.match(html, /--ls-badge-file-scale:1(;|")/);
  assert.doesNotMatch(html, /filter/);
});

test('footer blocks: a titled link list is a named navigation, a picture link opens only what leaves the site in a new tab', () => {
  const titled = renderToStaticMarkup(
    <ui.FooterLinkList title="Khám phá" items={[<span key="a">Dịch vụ</span>]} />,
  );
  assert.match(titled, /<nav aria-label="Khám phá" class="ls-footer-links">/);
  assert.match(titled, /<p class="ls-footer-links-title" aria-hidden="true">Khám phá<\/p>/);
  assert.match(titled, /<ul class="ls-site-footer-list"><li><span>Dịch vụ<\/span><\/li><\/ul>/);
  const untitled = renderToStaticMarkup(
    <ui.FooterLinkList items={[<span key="a">Trang chủ</span>]} />,
  );
  assert.doesNotMatch(untitled, /<nav/);
  const external = renderToStaticMarkup(
    <ui.FooterPicture href="https://example.com/x" label="Đối tác (mở trong tab mới)">
      <span>ảnh</span>
    </ui.FooterPicture>,
  );
  assert.match(
    external,
    /<a href="https:\/\/example.com\/x" target="_blank" rel="noopener noreferrer" aria-label="Đối tác \(mở trong tab mới\)">/,
  );
  const internal = renderToStaticMarkup(
    <ui.FooterPicture href="/vi/services" label="Dịch vụ">
      <span>ảnh</span>
    </ui.FooterPicture>,
  );
  assert.match(internal, /<a href="\/vi\/services" aria-label="Dịch vụ">/);
  assert.doesNotMatch(internal, /target=/);
  const bare = renderToStaticMarkup(
    <ui.FooterPicture>
      <span>ảnh</span>
    </ui.FooterPicture>,
  );
  assert.doesNotMatch(bare, /<a /);
  assert.match(
    renderToStaticMarkup(<ui.FooterText>{'Một\nHai'}</ui.FooterText>),
    /class="ls-footer-text"/,
  );
});

test('footer blocks: styles use tokens, only the logo is brand-coloured, and the new controls share the one motion', () => {
  assert.match(css, /\.ls-site-footer-logo \{[^}]*color: var\(--ls-brand\);/);
  assert.doesNotMatch(
    css,
    /\.ls-site-footer-brand a \{/,
    'links inside blocks are not brand-coloured',
  );
  assert.match(
    css,
    /\.ls-social-btn \{[^}]*width: var\(--ls-control-h\);[^}]*border-radius: var\(--ls-radius-full\);/,
  );
  assert.match(
    css,
    /\.ls-store-badge img \{[^}]*height: calc\(var\(--ls-store-badge-h\) \* var\(--ls-badge-file-scale\)\);/,
  );
  assert.match(css, /\.ls-store-badge \{[^}]*min-height: var\(--ls-control-h\);/);
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /--ls-store-badge-h: 2\.5rem;/);
  // The shared hover and press block lists them (so reduced motion zeroes them with every other control).
  assert.match(css, /\.ls-site \.ls-social-btn,\s*\.ls-site \.ls-store-badge \{\s*transition:/);
  assert.match(
    css,
    /\.ls-site \.ls-social-btn:hover,\s*\.ls-site \.ls-store-badge:hover \{\s*transform:/,
  );
  assert.match(
    css,
    /\.ls-site \.ls-social-btn:active,\s*\.ls-site \.ls-store-badge:active \{\s*transform: scale\(var\(--ls-press-scale\)\);/,
  );
});

test('Band and PublicPage give one landmark and one h1', () => {
  const html = renderToStaticMarkup(
    <ui.PublicPage title="Dịch vụ" lead="Giá niêm yết">
      <ui.Band tone="surface" labelledBy="x">
        <h2 id="x">Nhóm</h2>
      </ui.Band>
    </ui.PublicPage>,
  );
  assert.equal(html.match(/<main /g)?.length, 1);
  assert.equal(html.match(/<h1 /g)?.length, 1);
  assert.match(html, /<main id="main-content" tabindex="-1"/);
  assert.match(html, /<section class="ls-band ls-band-surface" aria-labelledby="x">/);
});

test('PublicPage draws its Back row above the title', () => {
  const html = renderToStaticMarkup(
    <ui.PublicPage title="Dịch vụ" back={<div className="ls-back-row">Quay lại</div>}>
      <p>x</p>
    </ui.PublicPage>,
  );
  assert.ok(html.indexOf('ls-back-row') > -1 && html.indexOf('ls-back-row') < html.indexOf('<h1 '));
});

test('ChoiceCard is a real checkbox or radio inside a label and reports changes', async () => {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const seen: boolean[] = [];
  act(() =>
    root.render(
      <ui.ChoiceCard
        title="Gội đầu dưỡng sinh"
        meta="80-90 phút"
        price="150.000 ₫"
        checked={false}
        onChange={(value) => seen.push(value)}
      />,
    ),
  );
  const input = container.querySelector('input') as HTMLInputElement;
  assert.equal(input.type, 'checkbox');
  assert.equal(container.querySelector('label')?.contains(input), true);
  assert.equal(container.querySelector('label')?.getAttribute('data-checked'), null);
  act(() => input.click());
  assert.deepEqual(seen, [true]);
  act(() =>
    root.render(
      <ui.ChoiceCard type="radio" name="slot" title="09:00" checked onChange={() => {}} />,
    ),
  );
  assert.equal((container.querySelector('input') as HTMLInputElement).type, 'radio');
  assert.equal(container.querySelector('label')?.getAttribute('data-checked'), 'true');
  act(() => root.unmount());
});

test('reveal gate: reduced motion, data saver, low memory and a missing observer show content at once', () => {
  const base = {
    reducedMotion: false,
    saveData: false,
    deviceMemory: undefined,
    hasObserver: true,
  };
  assert.equal(motionAllowed(base), true);
  assert.equal(motionAllowed({ ...base, deviceMemory: 8 }), true);
  assert.equal(motionAllowed({ ...base, reducedMotion: true }), false);
  assert.equal(motionAllowed({ ...base, saveData: true }), false);
  assert.equal(motionAllowed({ ...base, deviceMemory: 2 }), false);
  assert.equal(motionAllowed({ ...base, hasObserver: false }), false);
  assert.equal(staggerIndex(0), 0);
  assert.equal(staggerIndex(99), 5);
  assert.equal(staggerIndex(-3), 0);
  assert.equal(startsVisible({ top: 100, bottom: 400 }, 800), true);
  assert.equal(startsVisible({ top: 900, bottom: 1200 }, 800), false);
  // A navigation from a scrolled page: the block is at 300 + 1500 px of the old scroll now, and 300 px once at the top.
  assert.equal(startsVisible({ top: -1200, bottom: -900 }, 800, 1500), true);
  assert.equal(startsVisible({ top: 1700, bottom: 2000 }, 800, 1500), false);
});

test('TabBar marks the call-to-action tab; ThemeCycle cycles Light, Dark, Auto like the staff toggle', () => {
  const html = renderToStaticMarkup(
    <ui.TabBar
      label="Menu điện thoại"
      items={[
        { key: 'home', label: 'Trang chủ', href: '/vi', icon: 'home', current: false },
        {
          key: 'book',
          label: 'Đặt lịch ngay',
          href: '/vi/account/book',
          icon: 'calendar-check',
          current: false,
          emphasis: true,
        },
      ]}
    />,
  );
  assert.match(html, /href="\/vi\/account\/book" data-emphasis="true"/);
  assert.equal(html.match(/data-emphasis/g)?.length, 1);
  assert.match(css, /\.ls-tab-bar a\[data-emphasis='true'\]/);

  const labels = {
    group: 'Giao diện',
    light: 'Sáng',
    dark: 'Tối',
    auto: 'Theo giờ',
    switchTo: 'Chuyển sang {name}',
  };
  window.document.cookie = 'ls-theme=; Max-Age=0; Path=/';
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ui.ThemeCycle labels={labels} />));
  const button = container.querySelector('button') as HTMLButtonElement;
  const root_ = () => window.document.documentElement;
  // No choice stored = Auto (by the clock). A press goes to Light, then Dark, then back to Auto.
  assert.equal(button.dataset['preference'], 'auto');
  assert.equal(button.getAttribute('aria-label'), 'Giao diện: Theo giờ. Chuyển sang Sáng');
  assert.ok(
    container.querySelector('svg path[d*="M12 7"]') || button.querySelector('svg'),
    'the clock is drawn in Auto',
  );
  act(() => button.click());
  assert.equal(button.dataset['preference'], 'light');
  assert.equal(root_().getAttribute('data-theme'), 'light');
  assert.match(window.document.cookie, /ls-theme=light/);
  assert.equal(button.getAttribute('aria-label'), 'Giao diện: Sáng. Chuyển sang Tối');
  assert.ok(container.querySelector('svg path[d^="M12 8a4 4"]'), 'the sun is drawn in Light');
  act(() => button.click());
  assert.equal(button.dataset['preference'], 'dark');
  assert.equal(root_().getAttribute('data-theme'), 'dark');
  assert.match(window.document.cookie, /ls-theme=dark/);
  assert.equal(button.getAttribute('aria-label'), 'Giao diện: Tối. Chuyển sang Theo giờ');
  assert.ok(container.querySelector('svg path[d^="M20 14.5"]'), 'the moon is drawn in Dark');
  act(() => button.click());
  assert.equal(button.dataset['preference'], 'auto');
  assert.doesNotMatch(window.document.cookie, /ls-theme=(light|dark)/);
  assert.equal(button.getAttribute('aria-label'), 'Giao diện: Theo giờ. Chuyển sang Sáng');
  act(() => root.unmount());
});

test('MotionGate marks the document full only where scroll effects are allowed, and cleans up', async () => {
  const globals = globalThis as Record<string, unknown>;
  const win = window as unknown as Record<string, unknown>;
  const mount = () => {
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ui.MotionGate />));
    return root;
  };
  const mark = () => window.document.documentElement.dataset['lsMotion'];
  // No observer in this window: reduced.
  let root = mount();
  assert.equal(mark(), 'reduced');
  act(() => root.unmount());
  assert.equal(mark(), undefined);
  // Observer present, nothing against it: full.
  class Observer {
    observe() {}
    disconnect() {}
  }
  win.IntersectionObserver = Observer;
  globals.IntersectionObserver = Observer;
  root = mount();
  assert.equal(mark(), 'full');
  act(() => root.unmount());
  // Data saver: reduced.
  Object.defineProperty(globalThis.navigator, 'connection', {
    configurable: true,
    value: { saveData: true },
  });
  root = mount();
  assert.equal(mark(), 'reduced');
  act(() => root.unmount());
  Object.defineProperty(globalThis.navigator, 'connection', {
    configurable: true,
    value: undefined,
  });
});

test('Reveal is visible in the server markup and starts hidden only below the fold, then the GSAP wrapper shows it', async () => {
  const server = renderToStaticMarkup(
    <ui.Reveal index={2}>
      <p>Nội dung</p>
    </ui.Reveal>,
  );
  assert.doesNotMatch(server, /data-reveal/);

  class FakeObserver {
    observe() {}
    disconnect() {}
  }
  const globals = window as unknown as Record<string, unknown>;
  globals.IntersectionObserver = FakeObserver;
  (globalThis as Record<string, unknown>).IntersectionObserver = FakeObserver;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  const calls = {
    loads: 0,
    triggers: [] as Record<string, unknown>[],
    tweens: [] as unknown[][],
    reverted: 0,
  };
  const modules = {
    gsap: {
      context: (build: () => void) => {
        build();
        return {
          revert: () => {
            calls.reverted += 1;
          },
        };
      },
      fromTo: (...args: unknown[]) => calls.tweens.push(args),
    },
    ScrollTrigger: { create: (options: Record<string, unknown>) => calls.triggers.push(options) },
  };
  const { configureMotion } = await import('./motion');
  const install = (load?: () => Promise<never>) =>
    configureMotion({
      load:
        load ??
        (async () => {
          calls.loads += 1;
          return modules as never;
        }),
      afterFirstPaint: (callback) => callback(),
    });
  install();
  const proto = window.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  const settle = () => act(async () => void (await Promise.resolve()));
  const mountAt = async (top: number) => {
    proto.getBoundingClientRect = () => ({ top, bottom: top + 200 }) as DOMRect;
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ui.Reveal index={3}>
          <p>Nội dung</p>
        </ui.Reveal>,
      ),
    );
    await settle();
    return { container, root, element: container.querySelector('.ls-reveal') as HTMLElement };
  };

  // On screen at mount: never hidden, GSAP is not even loaded.
  const above = await mountAt(100);
  assert.equal(above.element.getAttribute('data-reveal'), null);
  assert.equal(calls.loads, 0);
  act(() => above.root.unmount());

  // Below the fold: hidden until the trigger fires, then the tween runs from the tokens (jsdom has none: 0), staggered by position.
  const below = await mountAt(1500);
  assert.equal(below.element.getAttribute('data-reveal'), 'hidden');
  assert.equal(calls.loads, 1);
  const trigger = calls.triggers[calls.triggers.length - 1];
  assert.ok(trigger);
  assert.equal(trigger['once'], true);
  assert.equal(trigger['start'], 'top 85%');
  assert.equal(trigger['trigger'], below.element);
  assert.equal(calls.tweens.length, 0, 'nothing animates before the trigger');
  act(() => (trigger['onEnter'] as () => void)());
  assert.equal(below.element.getAttribute('data-reveal'), null);
  const [target, from, to] = calls.tweens[0] ?? [];
  assert.equal(target, below.element);
  assert.deepEqual(from, { opacity: 0, y: 0 });
  assert.equal((to as Record<string, unknown>)['ease'], 'power3.out');
  assert.equal((to as Record<string, unknown>)['clearProps'], 'opacity,transform');
  act(() => below.root.unmount());
  assert.equal(calls.reverted, 1, 'unmount reverts the context');

  // Scrolled past while GSAP was loading: shown, no fade.
  const late = await mountAt(1500);
  proto.getBoundingClientRect = () => ({ top: -400, bottom: -200 }) as DOMRect;
  const tweens = calls.tweens.length;
  act(() => (calls.triggers[calls.triggers.length - 1]?.['onEnter'] as () => void)());
  assert.equal(late.element.getAttribute('data-reveal'), null);
  assert.equal(calls.tweens.length, tweens);
  act(() => late.root.unmount());

  // The off switch (`ls-fx=off`): the block is shown, GSAP never loads, no tween.
  const loadsBefore = calls.loads;
  window.document.cookie = 'ls-fx=off; Path=/';
  const off = await mountAt(1500);
  assert.equal(off.element.getAttribute('data-reveal'), null);
  assert.equal(calls.loads, loadsBefore);
  act(() => off.root.unmount());
  window.document.cookie = 'ls-fx=; Max-Age=0; Path=/';

  // Motion turned off while the page is open: the context is reverted and the block is shown.
  const live = await mountAt(1500);
  assert.equal(live.element.getAttribute('data-reveal'), 'hidden');
  const revertedBefore = calls.reverted;
  window.document.documentElement.dataset['lsMotion'] = 'reduced';
  await settle();
  assert.equal(live.element.getAttribute('data-reveal'), null);
  assert.equal(calls.reverted, revertedBefore + 1);
  act(() => live.root.unmount());
  delete window.document.documentElement.dataset['lsMotion'];

  // GSAP cannot load (offline): the block is shown, nothing throws.
  install(async () => {
    throw new Error('chunk lost');
  });
  const failed = await mountAt(1500);
  await settle();
  assert.equal(failed.element.getAttribute('data-reveal'), null);
  act(() => failed.root.unmount());
  configureMotion();
  proto.getBoundingClientRect = original;
});

test('site.css: tokens only, no color or duration literals, reveal reads the motion tokens', () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\b(?:rgb|rgba|hsl|hsla)\(/i);
  assert.doesNotMatch(css, /\b\d*\.?\d+m?s\b(?!\))/, 'a literal duration');
  assert.doesNotMatch(
    css,
    /data-reveal='shown'/,
    'the tween belongs to the GSAP wrapper, not to a CSS transition',
  );
  assert.match(
    css,
    /html\[data-ls-motion='reduced'\] \.ls-site \.ls-reveal\[data-reveal='hidden'\]/,
  );
  assert.match(css, /--ls-reveal-shift/);
  assert.match(css, /\.ls-site \.ls-reveal\[data-reveal='hidden'\]/);
});

test('the motion tokens exist and are zero under reduced motion', () => {
  for (const name of [
    '--ls-dur-reveal',
    '--ls-dur-zoom',
    '--ls-dur-slide',
    '--ls-ease-premium',
    '--ls-reveal-shift',
    '--ls-stagger',
    '--ls-parallax-shift',
    '--ls-text-3xl',
    '--ls-text-display',
    '--ls-font-display',
  ]) {
    assert.match(tokens, new RegExp(`${name}\\s*:`), name);
  }
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(tokens);
  assert.ok(reduced);
  for (const name of [
    '--ls-dur-reveal',
    '--ls-dur-zoom',
    '--ls-dur-slide',
    '--ls-stagger',
    '--ls-reveal-shift',
    '--ls-parallax-shift',
  ]) {
    assert.match(reduced[1] ?? '', new RegExp(`${name}:\\s*0(ms|px)`), `${name} is 0`);
  }
});

test('the staff stylesheets read the shared motion tokens, never the hero-only ones', () => {
  for (const name of ['components.css', 'shell.css', 'base.css']) {
    const text = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /--ls-(dur-reveal|dur-zoom|stagger|parallax-shift)/, name);
  }
});

test('site.css does not redefine a class another stylesheet owns (a clash silently restyles the admin or the site)', () => {
  const owned = (name: string) =>
    new Set(
      [
        ...readFileSync(new URL(name, import.meta.url), 'utf8').matchAll(/^\.(ls-[a-z0-9-]+)/gm),
      ].map((match) => match[1]),
    );
  const mine = owned('site.css');
  // The seasonal page wrapper is the season layer's own class; site.css only adjusts its header and footer rules.
  mine.delete('ls-site-page');
  for (const other of [
    'components.css',
    'shell.css',
    'base.css',
    'season-decor.css',
    'season-art.css',
  ]) {
    const theirs = owned(other);
    assert.deepEqual(
      [...mine].filter((name) => theirs.has(name)),
      [],
      `classes also defined in ${other}`,
    );
  }
});

test('the menu pill follows the mouse and the keyboard focus and goes back; touch never moves it', () => {
  const proto = window.HTMLElement.prototype;
  const geometry = new Map<string, { left: number; width: number }>([
    ['/vi', { left: 8, width: 96 }],
    ['/vi/services', { left: 112, width: 80 }],
  ]);
  const define = (name: string, read: (element: HTMLElement) => number) =>
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: HTMLElement) {
        return read(this);
      },
    });
  const box = (element: HTMLElement) => geometry.get(element.getAttribute('href') ?? '');
  define('offsetLeft', (element) => box(element)?.left ?? 0);
  define('offsetWidth', (element) => box(element)?.width ?? 0);
  define('offsetTop', () => 4);
  define('offsetHeight', () => 40);
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ui.SiteNav
        label="Menu"
        items={[
          { key: 'home', label: 'Trang chủ', href: '/vi', current: true },
          { key: 'services', label: 'Dịch vụ', href: '/vi/services', current: false },
        ]}
      />,
    ),
  );
  const nav = container.querySelector('nav') as HTMLElement;
  const [home, services] = Array.from(nav.querySelectorAll('a')) as HTMLElement[];
  const pointer = (type: string, target: Element, pointerType: string) =>
    act(() => {
      const event = new window.Event(type, { bubbles: true });
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      target.dispatchEvent(event);
    });
  assert.equal(home?.hasAttribute('data-under'), true, 'the current entry starts under the pill');

  pointer('pointerover', services as Element, 'touch');
  assert.equal(nav.style.getPropertyValue('--ls-pill-x'), '8px', 'touch does not move it');

  pointer('pointerover', services as Element, 'mouse');
  assert.equal(nav.style.getPropertyValue('--ls-pill-x'), '112px');
  assert.equal(nav.dataset['pill'], 'slide', 'it glides to the hovered entry');
  assert.equal(services?.hasAttribute('data-under'), true);
  assert.equal(home?.hasAttribute('data-under'), false, 'the text colour follows the pill');

  pointer('pointerleave', nav, 'mouse');
  assert.equal(nav.style.getPropertyValue('--ls-pill-x'), '8px', 'and back to the current entry');
  assert.equal(home?.hasAttribute('data-under'), true);

  act(() => root.unmount());
  for (const name of ['offsetLeft', 'offsetWidth', 'offsetTop', 'offsetHeight']) {
    Reflect.deleteProperty(proto, name);
  }
});

test('header tooltips open below the button and give way to the open account menu', () => {
  assert.match(
    css,
    /\.ls-site-header \.ls-tooltip \{\s*bottom: auto;\s*top: calc\(100% \+ var\(--ls-space-2\)\);/,
  );
  assert.match(
    css,
    /\.ls-site-header \.ls-tooltip-wrap:has\(\[aria-expanded='true'\]\) > \.ls-tooltip \{\s*display: none;/,
  );
});

test('ListRow and IconPicker: a text row with a menu slot, a radio group of icons', () => {
  const row = renderToStaticMarkup(
    <ui.ListRow
      icon={<ui.Icon name="leaf" />}
      title="Dụng cụ sạch"
      meta="EN: Clean tools"
      actions={<i />}
    />,
  );
  assert.match(row, /ls-list-row ls-list-row-icon/);
  assert.match(row, /<span class="ls-list-row-title" title="Dụng cụ sạch">Dụng cụ sạch<\/span>/);
  assert.match(row, /ls-media-row-actions/);
  const picker = renderToStaticMarkup(
    <ui.IconPicker
      label="Biểu tượng"
      value="heart"
      onChange={() => undefined}
      options={[
        { value: 'leaf', label: 'Chiếc lá', icon: 'leaf' },
        { value: 'heart', label: 'Trái tim', icon: 'heart' },
      ]}
    />,
  );
  assert.match(picker, /<span class="ls-label" id="([^"]+)-label">Biểu tượng<\/span>/);
  assert.match(picker, /role="radiogroup" aria-labelledby="[^"]+-label"/);
  assert.equal(picker.match(/type="radio"/g)?.length, 2);
  assert.match(
    picker,
    /aria-label="Trái tim"[^>]*checked=""|checked=""[^>]*aria-label="Trái tim"|value="heart"[^>]*checked/,
  );
  assert.match(picker, /aria-label="Chiếc lá"/);
});

test('the serif wordmark is the public logo; the staff wordmark keeps the sans face', () => {
  const serif = renderToStaticMarkup(<ui.BrandWordmark serif />);
  assert.match(serif, /font-family:var\(--ls-font-display\)/);
  assert.match(renderToStaticMarkup(<ui.BrandWordmark />), /font-family:var\(--ls-font-sans\)/);
});

test('every public control shares one hover and press style: smooth colours, a slight lift and zoom, a dip on press', () => {
  const block = css.slice(css.indexOf('controls (M9)'));
  // The one shared list: buttons (CTAs, outline, ghost, icon, slider arrows), header tools, pills, menu entries, tab bar.
  for (const selector of [
    '.ls-site .ls-btn',
    '.ls-site .ls-theme-cycle',
    '.ls-site .ls-site-tool',
    '.ls-site .ls-pills a',
    '.ls-site .ls-site-nav a',
    '.ls-site .ls-subnav a',
    '.ls-site .ls-tab-bar a',
  ]) {
    assert.ok(
      block.includes(`${selector},`) || block.includes(`${selector} {`),
      `${selector} is in the shared style`,
    );
  }
  assert.match(
    block,
    /transform var\(--ls-dur-base\) var\(--ls-ease-premium\),\s*background-color/,
  );
  assert.match(
    block,
    /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*transform: translateY\(calc\(var\(--ls-ctl-lift\) \* -1\)\) scale\(var\(--ls-ctl-zoom\)\);/,
  );
  assert.match(block, /:active \{\s*transform: scale\(var\(--ls-press-scale\)\);/);
  // A text link keeps no transform (the stretched card link would lose its click area); colours only.
  assert.doesNotMatch(block.slice(block.indexOf('.ls-site .ls-site-link')), /^[^}]*transform/);
  // No literal distances: the tokens carry them, and reduced motion zeroes them.
  assert.doesNotMatch(block, /translateY\(-?\d|scale\(1\.\d/);
  assert.match(tokens, /--ls-ctl-lift: 2px;\s*--ls-ctl-zoom: 1\.03;/);
  const reduced = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /--ls-ctl-lift: 0px;\s*--ls-ctl-zoom: 1;/);
});

test('the rhythm is stepped on the 4 px grid by width, never fluid; the site container is narrower than the staff area', () => {
  assert.doesNotMatch(tokens, /--ls-(?:band-pad|page-top|head-gap): clamp/);
  assert.match(
    tokens,
    /--ls-band-pad: 3rem;[\s\S]*--ls-band-pad: 4rem;[\s\S]*--ls-band-pad: 5rem;/,
  );
  assert.match(
    tokens,
    /--ls-page-top: 2\.5rem;[\s\S]*--ls-page-top: 3rem;[\s\S]*--ls-page-top: 4rem;/,
  );
  assert.match(css, /\.ls-band \{\s*padding-block: var\(--ls-band-pad\);/);
  assert.match(css, /\.ls-container \{[^}]*max-width: var\(--ls-site-max\);/);
  assert.match(tokens, /--ls-site-max: 73rem;/);
});

test('phones: per-nail booking rows put the price under the name; a section title carries no count', () => {
  assert.match(
    css,
    /@media \(max-width: 479px\) \{\s*\.ls-choice:has\(> \.ls-choice-extra\) \.ls-choice-price \{\s*grid-column: 2 \/ -1;\s*grid-row: 2;/,
  );
  assert.doesNotMatch(css, /ls-list-section-count/);
});

test('public form fields are boxed at the 8 px radius (v2), only the search field is a pill, the member card keeps its width', () => {
  const v2 = readFileSync(new URL('components-v2.css', import.meta.url), 'utf8');
  assert.match(v2, /\[data-ui='v2'\] \.ls-input \{[^}]*border-radius: var\(--ls-radius-sm\);/);
  assert.match(
    v2,
    /\[data-ui='v2'\] \.ls-search \.ls-input \{[^}]*border-radius: var\(--ls-radius-full\);/,
  );
});

test('SiteHeader: every page gets the same bar (one sentinel, the logo and menu grouped, no overlay switch)', () => {
  const html = renderToStaticMarkup(
    <ui.SiteHeader brand="Lucy Spa" nav={<nav>Menu</nav>} tools="tools" cta="cta" />,
  );
  assert.doesNotMatch(html, /data-overlay/);
  assert.match(html, /<div class="ls-site-sentinel" aria-hidden="true"><\/div>/);
  assert.match(html, /<header class="ls-site-header">/);
  assert.match(
    html,
    /<div class="ls-site-lead"><div class="ls-site-brand">Lucy Spa<\/div><nav>Menu<\/nav><\/div><div class="ls-site-tools">tools<\/div><div class="ls-site-cta">cta<\/div>/,
  );
});

test('header: clear at the top; shrinking frosted glass after about 48 px; the box and the page never move', () => {
  // The sentinel (1 px wide, no scroll listener) is the scroll threshold, from a token.
  assert.match(css, /\.ls-site-sentinel \{[^}]*height: var\(--ls-header-shrink-at\);/);
  // The header box keeps one height; it ignores the pointer, its row takes it back.
  assert.match(
    css,
    /\.ls-site-header \{[^}]*height: var\(--ls-site-header-h\);[^}]*pointer-events: none;/,
  );
  assert.match(css, /\.ls-site-header-row \{[^}]*pointer-events: auto;/);
  // At the top nothing is drawn; the surface is a pseudo-element (a filter or transform on the header itself would
  // capture the fixed bell and account panels) that fades in and slides up by the shrink distance.
  assert.match(css, /\.ls-site-header::before \{[^}]*opacity: 0;/);
  assert.match(
    css,
    /\.ls-site-header\[data-scrolled='true'\]::before \{\s*opacity: 1;\s*translate: 0 calc\(var\(--ls-header-shrink\) \* -1\);/,
  );
  assert.doesNotMatch(css, /\.ls-site-header \{[^}]*(backdrop-filter|transform|translate|filter):/);
  // Frosted where the browser can blur; solid where it cannot.
  assert.match(css, /\.ls-site-header::before \{[^}]*background: var\(--ls-bg-surface\);/);
  assert.match(
    css,
    /@supports \(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\) \{\s*\.ls-site-header::before \{\s*background: color-mix\(in srgb, var\(--ls-bg-surface\) var\(--ls-header-glass-mix\), transparent\);[\s\S]*?backdrop-filter: blur\(var\(--ls-header-blur\)\);/,
  );
  assert.match(css, /\.ls-site-header-row \{[^}]*transition: translate var\(--ls-dur-header\)/);
  assert.doesNotMatch(
    css,
    /\.ls-site-header[^{]*\{[^}]*transition:[^;]*\b(height|padding|min-height|width)\b/,
  );
  assert.doesNotMatch(css, /data-overlay/);
  // The seasonal wordmark accent would be clipped by the compact bar: it fades out with the shrink.
  assert.match(css, /\.ls-site-header\[data-scrolled='true'\] \.ls-art-logo-art \{\s*opacity: 0;/);
  // All of it rides the motion tokens, which are 0 under reduced motion (it just switches).
  const reduced =
    /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(tokens)?.[1] ?? '';
  for (const name of [
    '--ls-dur-header',
    '--ls-dur-glide',
    '--ls-dur-pop',
    '--ls-dur-wiggle',
    '--ls-dur-sheen',
  ]) {
    assert.match(reduced, new RegExp(`${name}: 0ms`));
  }
  for (const name of ['--ls-pop-shift', '--ls-arrow-nudge']) {
    assert.match(reduced, new RegExp(`${name}: 0px`));
  }
  assert.match(reduced, /--ls-pop-scale: 1;/);
  assert.match(reduced, /--ls-tool-zoom: 1;/);
  assert.match(reduced, /--ls-wiggle-angle: 0deg;/);
});

test('header motion: panels grow from the trigger, the bell rings once, the booking button sweeps, tools scale, arrows nudge', () => {
  assert.match(
    css,
    /\.ls-site \.ls-popover \{\s*animation: ls-site-pop-in var\(--ls-dur-pop\) var\(--ls-ease-premium\) both;/,
  );
  assert.match(
    css,
    /\.ls-site \.ls-popover\[data-state='closed'\] \{\s*animation: ls-site-pop-out var\(--ls-dur-pop\)/,
  );
  assert.match(
    css,
    /\.ls-site-bell\[data-ring='true'\] > \.ls-tooltip-wrap > \.ls-btn-icon svg \{[^}]*animation: ls-bell-ring var\(--ls-dur-wiggle\)[^}]* 1;/,
  );
  assert.match(css, /transform: scale\(var\(--ls-tool-zoom\)\);/);
  assert.match(css, /translate: var\(--ls-arrow-nudge\) 0;/);
});
