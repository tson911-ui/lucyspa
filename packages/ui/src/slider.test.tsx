import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { ReactNode } from 'react';
import { installDom } from './dom-harness';
import type { SliderLabels, SliderSlide } from './index';
import { isAutoplaying, stepIndex, swipeDelta } from './slider-core';

// The homepage slider in a real DOM (jsdom): one slide shows no controls; several get previous/next, dots, a
// Pause button, swipe and autoplay that stops for hover, focus, touch, the Pause button and reduced motion.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

const labels: SliderLabels = {
  region: 'Ưu đãi nổi bật',
  previous: 'Slide trước',
  next: 'Slide sau',
  pause: 'Tạm dừng',
  play: 'Phát tiếp',
  slide: 'Slide {position} / {count}',
  goTo: 'Đến slide {position}',
};

const slide = (n: number, patch: Partial<SliderSlide> = {}): SliderSlide => ({
  id: `s${n}`,
  title: `Tiêu đề ${n}`,
  subtitle: n === 1 ? 'Phụ đề 1' : null,
  image: {
    src: `/api/v1/public/media/${n}/lg`,
    srcSet: `/api/v1/public/media/${n}/md 960w, /api/v1/public/media/${n}/lg 1920w`,
    alt: `Ảnh ${n}`,
    width: 1920,
    height: 800,
  },
  mobileImage: null,
  cta: n === 1 ? { label: 'Đặt lịch', href: '/vi/account/book' } : null,
  ...patch,
});

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

const wait = (ms: number) =>
  act(async () => new Promise((resolve) => window.setTimeout(resolve, ms)));
const current = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.ls-slider-slide')).findIndex(
    (node) => !node.hasAttribute('inert'),
  );
const button = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const click = (target: Element | null) => {
  assert.ok(target, 'control exists');
  act(() => (target as HTMLElement).click());
};
const fire = (target: Element, type: string, init: Record<string, unknown> = {}) =>
  act(() => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, init);
    target.dispatchEvent(event);
  });

test('slider core: stepping wraps, swipes need a clear horizontal move, autoplay has five reasons to stop', () => {
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(0, 0, 1), 0);
  assert.equal(swipeDelta(-80, 5), 1, 'finger moved left: next');
  assert.equal(swipeDelta(80, 5), -1, 'finger moved right: previous');
  assert.equal(swipeDelta(-20, 0), 0, 'too short');
  assert.equal(swipeDelta(-60, 80), 0, 'mostly vertical: the page is scrolling');
  const base = {
    count: 3,
    reducedMotion: false,
    userPaused: false,
    hovering: false,
    focused: false,
    touching: false,
  };
  assert.equal(isAutoplaying(base), true);
  for (const patch of [
    { count: 1 },
    { reducedMotion: true },
    { userPaused: true },
    { hovering: true },
    { focused: true },
    { touching: true },
  ]) {
    assert.equal(isAutoplaying({ ...base, ...patch }), false, JSON.stringify(patch));
  }
});

test('Slider: a single slide is a named picture with no controls and an eager image', () => {
  const { container, unmount } = mount(<ui.Slider slides={[slide(1)]} labels={labels} />);
  const region = container.querySelector('section');
  assert.equal(region?.getAttribute('aria-roledescription'), 'carousel');
  assert.equal(region?.getAttribute('aria-label'), labels.region);
  assert.equal(container.querySelectorAll('button').length, 0, 'no controls for one slide');
  const img = container.querySelector('img');
  assert.equal(img?.getAttribute('alt'), 'Ảnh 1');
  assert.equal(img?.getAttribute('loading'), 'eager');
  assert.equal(img?.getAttribute('width'), '1920');
  assert.equal(img?.getAttribute('height'), '800');
  assert.ok(img?.getAttribute('srcset')?.includes('960w'));
  assert.equal(container.querySelector('h2')?.textContent, 'Tiêu đề 1');
  assert.equal(container.querySelector('a')?.getAttribute('href'), '/vi/account/book');
  unmount();
});

test('Slider: nothing at all when there are no slides', () => {
  const { container, unmount } = mount(<ui.Slider slides={[]} labels={labels} />);
  assert.equal(container.innerHTML, '');
  unmount();
});

test('Slider: previous, next and dots move between slides; off-screen slides are inert and hidden from readers', () => {
  const slides = [slide(1), slide(2), slide(3)];
  const { container, unmount } = mount(
    <ui.Slider slides={slides} labels={labels} autoplayMs={60_000} />,
  );
  const groups = Array.from(container.querySelectorAll('[role="group"]'));
  assert.equal(groups.length, 3);
  assert.equal(groups[1]?.getAttribute('aria-label'), 'Slide 2 / 3');
  assert.equal(current(container), 0);
  assert.equal(groups[1]?.getAttribute('aria-hidden'), 'true');
  assert.equal(groups[0]?.getAttribute('aria-hidden'), null);
  const images = Array.from(container.querySelectorAll('img'));
  assert.deepEqual(
    images.map((img) => img.getAttribute('loading')),
    ['eager', 'lazy', 'lazy'],
    'the first image is eager, the rest lazy',
  );

  click(button(container, labels.next));
  assert.equal(current(container), 1);
  click(button(container, labels.next));
  click(button(container, labels.next));
  assert.equal(current(container), 0, 'wraps to the first slide');
  click(button(container, labels.previous));
  assert.equal(current(container), 2, 'wraps to the last slide');
  click(button(container, 'Đến slide 2'));
  assert.equal(current(container), 1);
  const dots = Array.from(container.querySelectorAll('.ls-slider-dot'));
  assert.deepEqual(
    dots.map((dot) => dot.getAttribute('aria-current')),
    [null, 'true', null],
  );
  assert.equal(
    container
      .querySelector('.ls-slider-track')
      ?.getAttribute('style')
      ?.includes('translateX(-100%)'),
    true,
  );
  unmount();
});

test('Slider: the phone image becomes a picture source; any phone image selects the portrait frame', () => {
  const phone = slide(1).image;
  const withPhone = slide(1, {
    mobileImage: { ...phone, src: '/m/1', srcSet: undefined, width: 1080, height: 1350 },
  });
  const { container, unmount } = mount(
    <ui.Slider slides={[withPhone, slide(2)]} labels={labels} autoplayMs={60_000} />,
  );
  const sources = container.querySelectorAll('picture source');
  assert.equal(sources.length, 1, 'only the slide that has a phone image gets a source');
  assert.equal(sources[0]?.getAttribute('media'), '(max-width: 639px)');
  assert.equal(sources[0]?.getAttribute('srcset'), '/m/1');
  assert.ok(container.querySelector('.ls-slider')?.classList.contains('ls-slider-tall'));
  unmount();
  const plain = mount(
    <ui.Slider slides={[slide(1), slide(2)]} labels={labels} autoplayMs={60_000} />,
  );
  assert.equal(plain.container.querySelector('.ls-slider-tall'), null);
  plain.unmount();
});

test('Slider: swiping left or right changes the slide; a vertical scroll does not', () => {
  const { container, unmount } = mount(
    <ui.Slider slides={[slide(1), slide(2), slide(3)]} labels={labels} autoplayMs={60_000} />,
  );
  const viewport = container.querySelector('.ls-slider-viewport')!;
  const swipe = (from: [number, number], to: [number, number]) => {
    fire(viewport, 'touchstart', { touches: [{ clientX: from[0], clientY: from[1] }] });
    fire(viewport, 'touchend', { changedTouches: [{ clientX: to[0], clientY: to[1] }] });
  };
  swipe([300, 100], [100, 110]);
  assert.equal(current(container), 1, 'left = next');
  swipe([100, 100], [300, 90]);
  assert.equal(current(container), 0, 'right = previous');
  swipe([100, 100], [110, 300]);
  assert.equal(current(container), 0, 'vertical = scroll, no change');
  swipe([100, 100], [90, 100]);
  assert.equal(current(container), 0, 'too short');
  unmount();
});

test('Slider: autoplay advances, and stops for Pause, hover, keyboard focus and touch', async () => {
  const { container, unmount } = mount(
    <ui.Slider slides={[slide(1), slide(2), slide(3)]} labels={labels} autoplayMs={40} />,
  );
  const viewport = container.querySelector('.ls-slider-viewport')!;
  assert.equal(viewport.getAttribute('aria-live'), 'off', 'moving by itself: nothing is announced');
  await wait(70);
  assert.ok(current(container) >= 1, 'it moved on by itself');

  // Pause button: visible, named, stops the movement and says so with the live region.
  click(button(container, labels.pause));
  assert.ok(button(container, labels.play), 'the button now offers to play again');
  assert.equal(viewport.getAttribute('aria-live'), 'polite');
  const paused = current(container);
  await wait(120);
  assert.equal(current(container), paused);
  click(button(container, labels.play));
  assert.equal(viewport.getAttribute('aria-live'), 'off');
  await wait(90);
  assert.notEqual(current(container), paused, 'play resumes');

  // Hover pauses, leaving resumes.
  const section = container.querySelector('section')!;
  fire(section, 'mouseover', { relatedTarget: null });
  const hovered = current(container);
  await wait(120);
  assert.equal(current(container), hovered, 'hover pauses');
  fire(section, 'mouseout', { relatedTarget: null });
  await wait(90);
  assert.notEqual(current(container), hovered, 'leaving resumes');

  // Keyboard focus inside pauses until it leaves.
  const next = button(container, labels.next)!;
  act(() => next.focus());
  const focused = current(container);
  await wait(120);
  assert.equal(current(container), focused, 'focus pauses');
  act(() => next.blur());
  await wait(90);
  assert.notEqual(current(container), focused, 'blur resumes');

  // A finger on the slider pauses it.
  fire(viewport, 'touchstart', { touches: [{ clientX: 100, clientY: 100 }] });
  const touched = current(container);
  await wait(120);
  assert.equal(current(container), touched, 'touch pauses');
  fire(viewport, 'touchcancel');
  unmount();
});

test('Slider: under reduced motion nothing moves by itself and there is no Pause button', async () => {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  try {
    const { container, unmount } = mount(
      <ui.Slider slides={[slide(1), slide(2)]} labels={labels} autoplayMs={30} />,
    );
    await wait(120);
    assert.equal(current(container), 0, 'no autoplay');
    assert.equal(button(container, labels.pause), null);
    assert.equal(button(container, labels.play), null);
    assert.ok(button(container, labels.next), 'manual controls remain');
    assert.equal(
      container.querySelector('.ls-slider-viewport')?.getAttribute('aria-live'),
      'polite',
    );
    unmount();
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
  }
});
