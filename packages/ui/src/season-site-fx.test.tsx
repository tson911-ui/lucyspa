import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { ReactNode } from 'react';
import { installDom } from './dom-harness';

// The site-wide particle layer in a real DOM (docs/UXUI_REDESIGN_S6_PLAN.md section 3): after first paint only, the
// pool follows the density and the phone, nothing under reduced motion or `ls-fx=off`, paused in a hidden tab, never
// focusable, and the keep-out collector finds every line of text and control but not the decoration itself.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');
const { collectKeepouts } = await import('./season-site-fx');

function mount(node: ReactNode) {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
const settle = () => act(async () => new Promise((resolve) => window.setTimeout(resolve, 60)));
const particles = (container: HTMLElement) => container.querySelectorAll('.ls-fx-site-p').length;

function setReducedMotion(value: boolean) {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: value && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  return () => Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
}
const resetCookie = () => (window.document.cookie = 'ls-fx=; Max-Age=0; Path=/');

test('nothing is drawn on the server or on first paint; after mount the pool follows the density', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  assert.doesNotMatch(
    renderToStaticMarkup(<ui.SeasonSiteParticles kit="tet" />),
    /ls-fx-site-p/,
    'no particle in the server markup',
  );
  for (const [density, expected] of [
    ['low', 12],
    ['medium', 24],
    ['high', 40],
  ] as const) {
    const view = mount(<ui.SeasonSiteParticles kit="tet" density={density} />);
    assert.equal(particles(view.container), 0, 'not on the first paint');
    await settle();
    assert.equal(particles(view.container), expected, density);
    view.unmount();
  }
});

test('a phone gets the smaller pool', async () => {
  dom.setPhone(true);
  const view = mount(<ui.SeasonSiteParticles kit="christmas" density="high" />);
  await settle();
  assert.equal(particles(view.container), 20);
  view.unmount();
  dom.setPhone(false);
});

test('the layer is decorative: hidden from assistive technology, no focusable child, one glyph per particle', async () => {
  const view = mount(<ui.SeasonSiteParticles kit="tet" />);
  await settle();
  const layer = view.container.querySelector('.ls-fx-site')!;
  assert.equal(layer.getAttribute('aria-hidden'), 'true');
  assert.equal(layer.querySelectorAll('[tabindex], a, button, input').length, 0);
  assert.equal(layer.querySelectorAll('.ls-fx-site-glyph').length, 24);
  assert.ok(layer.querySelector('svg')?.getAttribute('focusable') === 'false');
  view.unmount();
});

test('Tet drifts mai and peach petals, Christmas drifts snowflakes', async () => {
  const tet = mount(<ui.SeasonSiteParticles kit="tet" />);
  await settle();
  const fills = new Set(
    [...tet.container.querySelectorAll('path[fill]')].map((p) => p.getAttribute('fill')),
  );
  assert.ok(fills.has('var(--ls-art-mai)') && fills.has('var(--ls-art-peach)'));
  tet.unmount();
  const xmas = mount(<ui.SeasonSiteParticles kit="christmas" />);
  await settle();
  assert.ok(xmas.container.querySelector('g[stroke="var(--ls-art-ice)"]'));
  xmas.unmount();
});

test('nothing under reduced motion, and nothing when the visitor turned effects off', async () => {
  const restore = setReducedMotion(true);
  const reduced = mount(<ui.SeasonSiteParticles kit="tet" />);
  await settle();
  assert.equal(reduced.container.querySelector('.ls-fx-site'), null);
  reduced.unmount();
  restore();

  window.document.cookie = 'ls-fx=off; Path=/';
  const off = mount(<ui.SeasonSiteParticles kit="tet" />);
  await settle();
  assert.equal(off.container.querySelector('.ls-fx-site'), null);
  off.unmount();
  resetCookie();
});

test('the layer pauses while the tab is hidden', async () => {
  Object.defineProperty(window.document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  const view = mount(<ui.SeasonSiteParticles kit="tet" />);
  await settle();
  assert.equal(view.container.querySelector('.ls-fx-site')?.getAttribute('data-paused'), 'true');
  view.unmount();
  Object.defineProperty(window.document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});

test('the page height sets how far a particle falls', async () => {
  const proto = window.HTMLElement.prototype as unknown as { getBoundingClientRect: () => unknown };
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1000,
    height: 2000,
    right: 1000,
    bottom: 2000,
  });
  const view = mount(
    <div>
      <ui.SeasonSiteParticles kit="tet" />
      <p>Nội dung</p>
    </div>,
  );
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 300)));
  const layer = view.container.querySelector<HTMLElement>('.ls-fx-site')!;
  assert.equal(layer.style.getPropertyValue('--ls-fx-dist'), '2048px');
  view.unmount();
  proto.getBoundingClientRect = original as () => unknown;
});

test('the keep-out collector finds text lines and controls, and ignores the decoration', () => {
  const page = window.document.createElement('div');
  page.innerHTML =
    '<div class="layer"><span>particle text must be ignored</span></div>' +
    '<h1>Một khoảng lặng</h1>' +
    '<p>Thả lỏng</p>' +
    '<a href="/x">Đặt lịch</a>' +
    '<svg aria-hidden="true"><text>art</text></svg>' +
    '<div aria-hidden="true">hidden decoration text</div>' +
    '<button>Tắt hiệu ứng</button>';
  window.document.body.appendChild(page);
  const layer = page.querySelector<HTMLElement>('.layer')!;
  const proto = window.Range.prototype as unknown as { getClientRects: () => unknown[] };
  const rangeOriginal = proto.getClientRects;
  const element = window.HTMLElement.prototype as unknown as {
    getBoundingClientRect: () => unknown;
  };
  const boxOriginal = element.getBoundingClientRect;
  let lines = 0;
  proto.getClientRects = () => [{ left: 10, top: 100 + 30 * lines++, width: 200, height: 24 }];
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 80, height: 40 });
  const rects = collectKeepouts(page, layer);
  proto.getClientRects = rangeOriginal as () => unknown[];
  element.getBoundingClientRect = boxOriginal as () => unknown;
  page.remove();
  // h1, p, the link text and the button text are lines; the link and the button are also boxes. The layer's own text,
  // the svg and the aria-hidden block are not counted.
  assert.equal(lines, 4, 'four text nodes measured');
  assert.equal(rects.length, 4 + 2, 'four lines plus the link and the button boxes');
  assert.ok(rects.some((rect) => rect.width === 200 && rect.height === 24));
});
