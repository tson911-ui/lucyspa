import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { SEASON_ORNAMENT_IDS, SEASON_PRESETS } from '@lucy-spa/contracts';
import type { ReactNode } from 'react';
import { installDom } from './dom-harness';

// The seasonal decoration kit (docs/UXUI_REDESIGN_DESIGN.md 20.2, Q-S5) in a real DOM: ornaments are decorative
// inline SVG; particles render only after mount, at most 24 (12 on a phone), never under reduced motion or
// `ls-fx=off`, pause with the tab and are never focusable; the switch is a real button.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToStaticMarkup, renderToString } = await import('react-dom/server');
const ui = await import('./index');

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
const lanes = (container: HTMLElement) => container.querySelectorAll('.ls-fx-particle').length;

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

function setCookie(value: string) {
  window.document.cookie = value;
}

const resetCookie = () => setCookie('ls-fx=; Max-Age=0; Path=/');

test('every ornament is decorative inline SVG: hidden from assistive tech, no image, script, link or color literal', () => {
  for (const id of SEASON_ORNAMENT_IDS) {
    for (const count of [1, 3] as const) {
      const html = renderToStaticMarkup(<ui.SeasonOrnament id={id} count={count} />);
      assert.match(html, /^<svg /);
      assert.match(html, /aria-hidden="true"/);
      assert.match(html, /focusable="false"/);
      assert.match(html, new RegExp(`viewBox="0 0 ${64 * count} 64"`));
      assert.match(html, /class="ls-(o|ol)[123]/, `${id}: colors come from ornament classes`);
      assert.doesNotMatch(html, /<(image|script|title|desc|a|use|foreignObject)\b/i, id);
      assert.doesNotMatch(html, /href=|url\(|https?:|#[0-9a-f]{3,8}\b|\bfill="|\bstroke="/i, id);
      assert.doesNotMatch(html, /tabindex/i);
    }
  }
});

test('every registry preset renders its motif', () => {
  for (const preset of SEASON_PRESETS) {
    const html = renderToStaticMarkup(<ui.SeasonOrnament id={preset.ornament.id} />);
    assert.ok(html.length > 200, `${preset.key} motif is not empty`);
  }
});

test('SeasonFrame scopes a preview with data-season, reserves gutters for both ornaments, and keeps text in the body', () => {
  const scoped = renderToStaticMarkup(
    <ui.SeasonFrame presetKey="tet" ornamentId="mai-blossom">
      <p>Nội dung</p>
    </ui.SeasonFrame>,
  );
  assert.match(scoped, /data-season="tet"/);
  assert.equal(scoped.match(/<svg /g)?.length, 2, 'one ornament at each end');
  assert.match(scoped, /ls-season-orn-start/);
  assert.match(scoped, /ls-season-orn-end/);
  assert.match(scoped, /<div class="ls-season-frame-body"><p>Nội dung<\/p><\/div>/);
  const inherited = renderToStaticMarkup(
    <ui.SeasonFrame ornamentId="lantern">
      <p>x</p>
    </ui.SeasonFrame>,
  );
  assert.doesNotMatch(
    inherited,
    /data-season/,
    'without a preset the frame inherits the page season',
  );
});

test('GreetingStrip shows the longest approved greeting as plain text', () => {
  const longest = [
    ...SEASON_PRESETS.flatMap((preset) => [preset.greeting.vi, preset.greeting.en]),
  ].sort((a, b) => b.length - a.length)[0]!;
  assert.ok([...longest].length <= 80);
  const html = renderToStaticMarkup(<ui.GreetingStrip greeting={longest} ornamentId="hearts" />);
  assert.match(html, /ls-season-frame-strip/);
  assert.match(html, /<p class="ls-season-greeting">/);
  assert.ok(html.includes(longest.replace(/'/g, '&#x27;')) || html.includes(longest));
});

test('particles render nothing on the server and on first paint', () => {
  assert.equal(renderToString(<ui.SeasonParticles kind="petal" />), '');
});

test('after mount a petal banner has 24 particles, hidden from assistive tech, none focusable', async () => {
  resetCookie();
  const view = mount(<ui.SeasonParticles kind="petal" />);
  assert.equal(lanes(view.container), 0, 'nothing before the first paint');
  await settle();
  const layer = view.container.querySelector('.ls-fx')!;
  assert.ok(layer);
  assert.equal(layer.getAttribute('aria-hidden'), 'true');
  assert.equal(layer.getAttribute('data-direction'), 'fall');
  assert.equal(lanes(view.container), 24);
  assert.equal(layer.querySelectorAll('a, button, input, select, textarea, [tabindex]').length, 0);
  assert.equal(layer.querySelectorAll('.ls-fx-petal').length, 24);
  view.unmount();
});

test('lanterns and hearts rise; snow falls; each kind draws its own glyph', async () => {
  for (const [kind, direction] of [
    ['lantern', 'rise'],
    ['heart', 'rise'],
    ['snow', 'fall'],
  ] as const) {
    const view = mount(<ui.SeasonParticles kind={kind} />);
    await settle();
    assert.equal(view.container.querySelector('.ls-fx')!.getAttribute('data-direction'), direction);
    assert.equal(view.container.querySelectorAll(`.ls-fx-${kind}`).length, 24, kind);
    view.unmount();
  }
});

test('a phone gets 12; a preset with no particles gets none', async () => {
  dom.setPhone(true);
  const phone = mount(<ui.SeasonParticles kind="petal" />);
  await settle();
  assert.equal(lanes(phone.container), 12);
  phone.unmount();
  dom.setPhone(false);
  const none = mount(<ui.SeasonParticles kind="none" />);
  await settle();
  assert.equal(none.container.querySelector('.ls-fx'), null);
  none.unmount();
});

test('under reduced motion nothing renders, and there is no switch to show', async () => {
  const restore = setReducedMotion(true);
  const view = mount(
    <>
      <ui.SeasonParticles kind="petal" />
      <ui.SeasonFxToggle labels={{ turnOff: 'Tắt hiệu ứng', turnOn: 'Bật hiệu ứng' }} />
    </>,
  );
  await settle();
  assert.equal(view.container.querySelector('.ls-fx'), null);
  assert.equal(view.container.querySelector('button'), null);
  view.unmount();
  restore();
});

test('ls-fx=off renders nothing; the switch is a real button that writes the cookie and brings them back', async () => {
  resetCookie();
  const view = mount(
    <>
      <ui.SeasonParticles kind="petal" />
      <ui.SeasonFxToggle labels={{ turnOff: 'Tắt hiệu ứng', turnOn: 'Bật hiệu ứng' }} />
    </>,
  );
  await settle();
  const button = view.container.querySelector('button')!;
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.textContent, 'Tắt hiệu ứng');
  assert.equal(lanes(view.container), 24);

  act(() => button.click());
  assert.match(window.document.cookie, /ls-fx=off/);
  assert.equal(lanes(view.container), 0, 'effects gone at once');
  assert.equal(view.container.querySelector('button')!.textContent, 'Bật hiệu ứng');

  act(() => view.container.querySelector('button')!.click());
  assert.doesNotMatch(window.document.cookie, /ls-fx=off/);
  assert.equal(lanes(view.container), 24, 'and back on');
  view.unmount();
  resetCookie();
});

test('a visitor who already chose off sees no particles', async () => {
  setCookie('ls-fx=off; Path=/');
  const view = mount(<ui.SeasonParticles kind="petal" />);
  await settle();
  assert.equal(view.container.querySelector('.ls-fx'), null);
  view.unmount();
  resetCookie();
});

test('a hidden tab pauses the particles and a visible tab resumes them', async () => {
  const view = mount(<ui.SeasonParticles kind="petal" />);
  await settle();
  const layer = () => view.container.querySelector('.ls-fx')!;
  assert.equal(layer().getAttribute('data-paused'), null);
  Object.defineProperty(window.document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  act(() => {
    window.document.dispatchEvent(new window.Event('visibilitychange'));
  });
  assert.equal(layer().getAttribute('data-paused'), 'true');
  Object.defineProperty(window.document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  act(() => {
    window.document.dispatchEvent(new window.Event('visibilitychange'));
  });
  assert.equal(layer().getAttribute('data-paused'), null);
  view.unmount();
});

test('particles stay inside a frame: the frame renders them in its own band, after the content', async () => {
  const view = mount(
    <ui.SeasonFrame
      presetKey="mid-autumn"
      ornamentId="lantern"
      effects={<ui.SeasonParticles kind="lantern" />}
    >
      <p>Trung thu vui vẻ!</p>
    </ui.SeasonFrame>,
  );
  await settle();
  const frame = view.container.querySelector('.ls-season-frame')!;
  assert.equal(frame.getAttribute('data-season'), 'mid-autumn');
  assert.ok(frame.querySelector(':scope > .ls-fx'), 'the layer is a direct child of the frame');
  assert.ok(frame.querySelector('.ls-season-frame-body')!.textContent!.includes('Trung thu'));
  view.unmount();
});
