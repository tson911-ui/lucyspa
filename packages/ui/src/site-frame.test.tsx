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
    /<span>Đính đá \/ charm<\/span><span class="ls-price">5\.000-30\.000 ₫\/ngón<\/span>/,
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
      /--ls-(dur-reveal|dur-zoom|ease-premium|reveal-shift|stagger|parallax-shift)/,
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
