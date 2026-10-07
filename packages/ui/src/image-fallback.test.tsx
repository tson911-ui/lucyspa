import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';

// A picture that cannot be loaded is replaced by a neutral placeholder (no broken-image icon), in a real DOM (jsdom).
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

const mount = (node: React.ReactElement) => {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
};
const fail = (image: Element) => act(() => void image.dispatchEvent(new window.Event('error')));

test('MediaThumb: a picture that fails to load becomes the placeholder icon, in the same square', () => {
  const { container } = mount(<ui.MediaThumb src="/thumb/gone.webp" />);
  const frame = container.querySelector('span.ls-thumb');
  assert.ok(frame, 'the square');
  assert.ok(frame?.querySelector('img'), 'the picture first');
  fail(frame.querySelector('img') as Element);
  assert.equal(frame.querySelector('img'), null, 'no broken image left');
  assert.ok(frame.querySelector('svg'), 'the muted placeholder icon holds the square');
  // A thumbnail with no picture at all looks the same.
  const none = mount(<ui.MediaThumb src={null} />).container.querySelector('span.ls-thumb');
  assert.equal(none?.innerHTML, frame.innerHTML);
});

test('MediaTile and MediaRow: a failed picture leaves a decorative placeholder, the title button stays', () => {
  const tile = mount(
    <ui.MediaGrid label="Ảnh">
      <ui.MediaTile
        src="/thumb/a"
        title="a.png"
        meta="1 MB"
        actionLabel="Mở a"
        onSelect={() => {}}
      />
    </ui.MediaGrid>,
  ).container;
  fail(tile.querySelector('.ls-media-thumb img') as Element);
  assert.equal(tile.querySelector('.ls-media-thumb img'), null);
  assert.equal(
    tile.querySelector('.ls-media-thumb .ls-img-fallback')?.getAttribute('aria-hidden'),
    'true',
  );
  assert.equal(tile.querySelectorAll('button.ls-media-title').length, 1);
  const row = mount(
    <ui.MediaRow src="/thumb/b" title="b.png" meta="2" actionLabel="Mở b" onSelect={() => {}} />,
  ).container;
  fail(row.querySelector('.ls-media-row-thumb img') as Element);
  assert.equal(row.querySelector('.ls-media-row-thumb img'), null);
  assert.ok(row.querySelector('.ls-media-row-thumb .ls-img-fallback svg'));
});

test('a different picture is tried again; a picture that had already failed before the page woke up is caught too', () => {
  const { container, root } = mount(<ui.MediaThumb src="/thumb/one" />);
  fail(container.querySelector('img') as Element);
  assert.equal(container.querySelector('img'), null);
  act(() => root.render(<ui.MediaThumb src="/thumb/two" />));
  assert.ok(container.querySelector('img'), 'a new src starts fresh');

  // jsdom has no network: describe an image the browser already gave up on (complete, zero width).
  const proto = window.HTMLImageElement.prototype;
  const complete = Object.getOwnPropertyDescriptor(proto, 'complete');
  const width = Object.getOwnPropertyDescriptor(proto, 'naturalWidth');
  const describe = (done: boolean, naturalWidth: number) => {
    Object.defineProperty(proto, 'complete', { configurable: true, get: () => done });
    Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => naturalWidth });
  };
  try {
    describe(true, 0);
    const broken = mount(<ui.MediaThumb src="/thumb/dead" />).container;
    assert.equal(broken.querySelector('img'), null, 'already failed: placeholder at once');
    describe(true, 640);
    const fine = mount(<ui.MediaThumb src="/thumb/ok" />).container;
    assert.ok(fine.querySelector('img'), 'a loaded picture stays');
    describe(false, 0);
    const loading = mount(<ui.MediaThumb src="/thumb/slow" />).container;
    assert.ok(loading.querySelector('img'), 'a picture still loading stays');
  } finally {
    if (complete) Object.defineProperty(proto, 'complete', complete);
    if (width) Object.defineProperty(proto, 'naturalWidth', width);
  }
});
