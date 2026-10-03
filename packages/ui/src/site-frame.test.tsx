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
    /\[data-pill='slide'\] > \.ls-nav-pill \{\s*transition:\s*translate var\(--ls-dur-slide\) var\(--ls-ease-premium\)/,
  );
  assert.match(css, /\.ls-route-fade\[data-enter='route'\] \{[^}]*animation: ls-route-in/);
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

test('PriceList keeps a long price on the row as its own cell', () => {
  const html = renderToStaticMarkup(
    <ui.PriceList items={[{ key: 'a', name: 'Đính đá / charm', price: '5.000-30.000 ₫/ngón' }]} />,
  );
  assert.match(
    html,
    /<span title="Đính đá \/ charm">Đính đá \/ charm<\/span><span class="ls-price">5\.000-30\.000 ₫\/ngón<\/span>/,
  );
});

test('SiteFooter renders the brand, the columns and the base line', () => {
  const html = renderToStaticMarkup(
    <ui.SiteFooter
      brand={<span>Lucy Spa</span>}
      tagline="Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc"
      columns={[{ key: 'contact', title: 'Liên hệ', items: ['04 Nguyễn Quang Bích, Đà Nẵng'] }]}
      base="© 2026 Lucy Spa"
    />,
  );
  assert.match(html, /<footer class="ls-site-footer">/);
  assert.match(html, /<h2 class="ls-site-footer-title">Liên hệ<\/h2>/);
  assert.match(html, /Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc/);
  assert.match(html, /© 2026 Lucy Spa/);
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

test('the hero photo motion: settle and zoom on tokens, parallax only where it is allowed and supported', () => {
  assert.match(
    css,
    /\.ls-photo \.ls-hero-image \{[^}]*animation: ls-settle var\(--ls-dur-reveal\)/,
  );
  assert.match(css, /transition: scale var\(--ls-dur-zoom\) var\(--ls-ease-premium\)/);
  assert.match(css, /scale: 1\.03/);
  const parallax = /@supports \(animation-timeline: view\(\)\) \{([\s\S]*?)\n\}\n/.exec(css);
  assert.ok(parallax, 'parallax sits inside @supports');
  const inner = parallax[1] ?? '';
  assert.match(inner, /min-width: 1024px/);
  assert.match(inner, /hover: hover/);
  assert.match(inner, /pointer: fine/);
  assert.match(inner, /prefers-reduced-motion: no-preference/);
  assert.match(inner, /html\[data-ls-motion='full'\]/);
  assert.match(inner, /animation-timeline: view\(\)/);
  assert.match(css, /@keyframes ls-parallax \{[^}]*var\(--ls-parallax-shift\)/);
  // Only compositor properties move: scale, translate and opacity (no layout property is animated).
  for (const frames of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}\n/g)) {
    assert.doesNotMatch(
      frames[2] ?? '',
      /\b(?:top|left|right|bottom|width|height|margin|padding)\s*:/,
      `${frames[1]} animates a layout property`,
    );
  }
});

test('Reveal is visible in the server markup and starts hidden only below the fold', async () => {
  const server = renderToStaticMarkup(
    <ui.Reveal index={2}>
      <p>Nội dung</p>
    </ui.Reveal>,
  );
  assert.doesNotMatch(server, /data-reveal/);
  assert.match(server, /--ls-reveal-index:2/);

  const observers: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];
  class FakeObserver {
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ callback, disconnected: false });
    }
    observe() {}
    disconnect() {
      const last = observers[observers.length - 1];
      if (last) last.disconnected = true;
    }
  }
  const globals = window as unknown as Record<string, unknown>;
  globals.IntersectionObserver = FakeObserver;
  (globalThis as Record<string, unknown>).IntersectionObserver = FakeObserver;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  const proto = window.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  const mountAt = (top: number) => {
    proto.getBoundingClientRect = () => ({ top, bottom: top + 200 }) as DOMRect;
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ui.Reveal>
          <p>Nội dung</p>
        </ui.Reveal>,
      ),
    );
    return { container, root };
  };

  const above = mountAt(100);
  assert.equal(above.container.querySelector('.ls-reveal')?.getAttribute('data-reveal'), null);
  act(() => above.root.unmount());

  const below = mountAt(1500);
  const element = below.container.querySelector('.ls-reveal') as HTMLElement;
  assert.equal(element.getAttribute('data-reveal'), 'hidden');
  const observer = observers[observers.length - 1];
  assert.ok(observer);
  act(() =>
    observer.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  assert.equal(element.getAttribute('data-reveal'), 'shown');
  assert.equal(observer.disconnected, true);
  act(() => below.root.unmount());
  proto.getBoundingClientRect = original;
});

test('site.css: tokens only, no color or duration literals, reveal reads the motion tokens', () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\b(?:rgb|rgba|hsl|hsla)\(/i);
  assert.doesNotMatch(css, /\b\d*\.?\d+m?s\b(?!\))/, 'a literal duration');
  assert.match(css, /transition:[^;]*var\(--ls-dur-reveal\) var\(--ls-ease-premium\)/);
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

test('the staff stylesheets never read the customer-side motion tokens', () => {
  for (const name of ['components.css', 'shell.css', 'base.css']) {
    const text = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(
      text,
      /--ls-(dur-reveal|dur-zoom|dur-slide|ease-premium|reveal-shift|stagger|parallax-shift)/,
      name,
    );
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

test('hovering the current menu entry turns its pill solid (the locked hover fill), light and dark', () => {
  // The pill carries the current entry's highlight; the hover text colour must never sit on the pale pill.
  assert.match(
    css,
    /\.ls-site-nav:has\(> a\[aria-current='page'\]:hover\) > \.ls-nav-pill,\s*\.ls-subnav:has\(> a\[aria-current='page'\]:hover\) > \.ls-nav-pill \{\s*background: var\(--ls-hover-bg\);/,
  );
  assert.match(
    css,
    /\.ls-site-nav a\[aria-current='page'\]:hover \{\s*background: var\(--ls-hover-bg\);\s*color: var\(--ls-hover-text\);/,
  );
  assert.match(tokens, /--ls-hover-bg: #782b37;[\s\S]*--ls-hover-text: #ffffff;/);
  assert.match(tokens, /--ls-hover-bg: #e08a9a;\s*--ls-hover-text: #2a0f16;/);
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

test('clickable cards share one gentle motion: lift, slight zoom, deeper shadow, a dip on press; none under reduced motion', () => {
  for (const selector of [
    '.ls-site-card',
    '.ls-service-card',
    '.ls-choice:not(.ls-choice-disabled)',
  ]) {
    assert.ok(css.includes(`${selector}:hover`), `${selector} hover`);
    assert.ok(css.includes(`${selector}:active`), `${selector} press`);
  }
  assert.match(
    css,
    /transform: translateY\(calc\(var\(--ls-card-lift\) \* -1\)\) scale\(var\(--ls-card-zoom\)\);[\s\S]*?box-shadow: var\(--ls-shadow-lg\);/,
  );
  assert.match(css, /transform: scale\(var\(--ls-press-scale\)\);/);
  const reduced = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /--ls-card-lift: 0px;\s*--ls-card-zoom: 1;/);
});

test('the three-column footer and the featured group cards keep to the reference layout', () => {
  assert.match(
    css,
    /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);\s*gap: var\(--ls-space-6\);/,
  );
  // Cards of a row are one size: the grid stretches them, "Xem tất cả" sits at the bottom of each, names stop at two lines.
  assert.doesNotMatch(css, /\.ls-site-grid-groups \{\s*align-items: start;/);
  assert.match(
    css,
    /\.ls-site-card \.ls-site-link \{\s*align-self: flex-start;\s*margin-top: auto;/,
  );
  assert.match(css, /\.ls-price-list li > span:first-child \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(
    css,
    /\.ls-group-card \.ls-site-link::after \{\s*content: '';\s*position: absolute;\s*inset: 0;/,
  );
  // Prices are a muted, regular-weight, right-aligned column that never wraps.
  assert.match(
    css,
    /\.ls-price \{[^}]*font-weight: 400;[^}]*text-align: end;[^}]*white-space: nowrap;/,
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
    /@media \(hover: hover\) \{[\s\S]*transform: translateY\(calc\(var\(--ls-ctl-lift\) \* -1\)\) scale\(var\(--ls-ctl-zoom\)\);/,
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

test('the facts strip is one row that never wraps; phones scroll it, tablets and up shrink the items', () => {
  assert.match(
    css,
    /\.ls-site-facts \{\s*display: flex;\s*align-items: center;\s*justify-content: space-between;[^}]*overflow-x: auto;/,
  );
  assert.doesNotMatch(css, /\.ls-site-facts \{[^}]*flex-wrap: wrap/);
  assert.doesNotMatch(css, /--ls-facts-cols|\.ls-section-head-center/);
  assert.match(css, /\.ls-site-fact \{\s*display: flex;\s*flex: none;[^}]*white-space: nowrap;/);
  assert.match(css, /@media \(min-width: 768px\) \{[^{]*\.ls-site-fact \{\s*flex: 0 1 auto;/);
});

test('the facts strip never shrinks the hours or the hotline, and keeps a minimum width for the rest', () => {
  assert.match(
    css,
    /\.ls-site-fact\[data-fact='hours'\],\s*\.ls-site-fact\[data-fact='hotline'\] \{\s*flex-shrink: 0;/,
  );
  assert.match(
    css,
    /\.ls-site-fact \{\s*flex: 0 1 auto;\s*min-width: calc\(var\(--ls-space-9\) \* 2\.5\);/,
  );
});

test('the public type scale: one set of tokens, every heading and body role reads them, none sets its own size', () => {
  for (const role of ['hero', 'page', 'section', 'sub', 'card', 'price', 'lead', 'body', 'small']) {
    assert.match(tokens, new RegExp(`--ls-type-${role}: `), `--ls-type-${role} is defined`);
  }
  assert.match(tokens, /--ls-type-hero: clamp\(2rem, 1\.5rem \+ 2vw, 3rem\);/);
  assert.match(tokens, /--ls-type-section: clamp\(1\.5rem, 1\.25rem \+ 1\.2vw, 1\.875rem\);/);
  assert.match(tokens, /--ls-type-card: 1\.125rem;/);
  assert.match(tokens, /--ls-weight-title: 500;/);
  const rule = (selector: string) => {
    // Every rule that ends with this selector (a selector list's last entry included), their bodies joined.
    const matches = [
      ...css.matchAll(
        new RegExp(
          `(?:^|\\n)${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')} \\{([^}]*)\\}`,
          'g',
        ),
      ),
    ];
    assert.ok(matches.length > 0, `${selector} exists`);
    return matches.map((match) => match[1] ?? '').join('\n');
  };
  assert.match(
    rule('.ls-site-display'),
    /font-size: var\(--ls-type-hero\);\s*line-height: var\(--ls-lh-hero\);/,
  );
  assert.match(rule('.ls-h1-display'), /font-size: var\(--ls-type-page\);/);
  assert.match(rule('.ls-site-h2'), /font-size: var\(--ls-type-section\);/);
  assert.match(rule('.ls-site-h2-sub'), /font-size: var\(--ls-type-sub\);/);
  assert.match(rule('.ls-site-h3'), /font-size: var\(--ls-type-card\);/);
  assert.match(
    rule('.ls-member-title'),
    /font-size: var\(--ls-type-sub\);\s*font-weight: var\(--ls-weight-title\);/,
  );
  // Titles are medium, never bold (the Owner found them heavy), and sit in the display face everywhere on the site.
  assert.doesNotMatch(rule('.ls-site-h3'), /font-weight: 600/);
  assert.match(
    css,
    /\.ls-site \.ls-page-title,\s*\.ls-site \.ls-list-section-title,\s*\.ls-site \.ls-form-section-title,\s*\.ls-site \.ls-card-title \{\s*font-family: var\(--ls-font-display\);\s*font-weight: var\(--ls-weight-title\);/,
  );
  // The booking form's own titles (step title, form section title) are in the same face and scale as every other title.
  assert.match(css, /\.ls-booking-step-title \{[^}]*font-family: var\(--ls-font-display\);/);
  assert.match(
    css,
    /\.ls-site \.ls-card-title,\s*\.ls-site \.ls-form-section-title \{\s*font-size: var\(--ls-type-card\);/,
  );
  assert.match(css, /\.ls-site \.ls-page-title \{\s*font-size: var\(--ls-type-page\);/);
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

test('service cards: five shared rows, a name that stops at two lines and a title link that stays a full-size target', () => {
  assert.match(css, /\.ls-service-name \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(
    css,
    /\.ls-service-card h3 a \{\s*display: flex;\s*align-items: center;\s*min-height: var\(--ls-control-h\);/,
  );
  assert.match(
    css,
    /@supports \(grid-template-rows: subgrid\) \{\s*\.ls-service-grid > \.ls-reveal \{\s*display: grid;\s*grid-row: span 5;\s*grid-template-rows: subgrid;/,
  );
  assert.match(css, /\.ls-service-card > \.ls-btn \{\s*grid-row: 5;/);
  // The reveal wrapper's flex fallback is declared BEFORE the subgrid rules, or it would win at equal specificity.
  assert.ok(
    css.indexOf('.ls-service-grid > .ls-reveal {\n  display: flex;') <
      css.indexOf('grid-row: span 5;'),
  );
  // Group and why-us cards share three rows (head, list or text, link).
  assert.match(
    css,
    /@supports \(grid-template-rows: subgrid\) \{\s*\.ls-site-grid-groups > \.ls-reveal \{\s*display: grid;\s*grid-row: span 3;/,
  );
});

test('public form fields are pills like the buttons; a multi-line field keeps a soft rectangle', () => {
  assert.match(css, /\.ls-site \.ls-input \{\s*border-radius: var\(--ls-radius-full\);/);
  assert.match(css, /\.ls-site \.ls-textarea \{\s*border-radius: var\(--ls-radius-lg\);/);
  assert.match(css, /\.ls-member-card \{[^}]*width: min\(100%, 28rem\);/);
});
