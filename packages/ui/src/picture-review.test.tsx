import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';

// PictureReview in a real DOM (jsdom): the picture and the facts of its own product side by side, the badges and the buttons.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

test('PictureReview shows one picture beside the facts of its product, its badges and its actions', () => {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ui.PictureReview
        src="/thumb/a.webp"
        alt="Ảnh sản phẩm"
        facts={[
          { label: 'Sản phẩm', value: 'Kem dưỡng A' },
          { label: 'SKU', value: 'KD-1' },
          { label: 'Trang sản phẩm', value: <a href="https://shop.example/p/1">Mở</a> },
        ]}
        badges={<span>Trùng ảnh</span>}
        actions={<button type="button">Giữ ảnh</button>}
      />,
    ),
  );
  const image = container.querySelector('.ls-picture-review-image img');
  assert.equal(image?.getAttribute('src'), '/thumb/a.webp');
  assert.equal(image?.getAttribute('alt'), 'Ảnh sản phẩm');
  assert.equal(image?.getAttribute('loading'), 'lazy');
  const terms = [...container.querySelectorAll('dt')].map((node) => node.textContent);
  assert.deepEqual(terms, ['Sản phẩm', 'SKU', 'Trang sản phẩm']);
  assert.equal(container.querySelector('dd a')?.getAttribute('href'), 'https://shop.example/p/1');
  assert.ok(container.querySelector('.ls-media-badges'));
  assert.equal(
    container.querySelector('.ls-picture-review-actions button')?.textContent,
    'Giữ ảnh',
  );
  // Without badges or actions nothing empty is drawn.
  act(() =>
    root.render(<ui.PictureReview src="/t.webp" alt="" facts={[{ label: 'A', value: 'b' }]} />),
  );
  assert.equal(container.querySelector('.ls-media-badges'), null);
  assert.equal(container.querySelector('.ls-picture-review-actions'), null);
  act(() => root.unmount());
});

test('the picture sits beside the text on a wide screen and above it on a narrow one, on the spacing tokens only', () => {
  const css = readFileSync(new URL('./components.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('.ls-picture-review {'));
  assert.match(block, /grid-template-columns:\s*10rem minmax\(0, 1fr\)/);
  assert.match(
    block,
    /@media \(max-width: 479px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.doesNotMatch(block.slice(0, block.indexOf('@media')), /\b\d+px\b/);
});
