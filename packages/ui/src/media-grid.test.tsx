import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';

// Media grid in a real DOM (jsdom): one list item per image, a real button, text title, equal rows.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

test('MediaGrid lists tiles; each tile is a labelled button with a decorative lazy thumbnail', () => {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const opened: string[] = [];
  act(() =>
    root.render(
      <ui.MediaGrid label="Ảnh">
        {['a.png', 'b.png'].map((name) => (
          <ui.MediaTile
            key={name}
            src={`/thumb/${name}`}
            title={name}
            meta="1,2 MB · 1920 × 800"
            actionLabel={`Mở ${name}`}
            onSelect={() => opened.push(name)}
            badge={name === 'b.png' ? <ui.Badge tone="warning">Thiếu mô tả</ui.Badge> : undefined}
          />
        ))}
      </ui.MediaGrid>,
    ),
  );
  const list = container.querySelector('ul.ls-media-grid');
  assert.equal(list?.getAttribute('aria-label'), 'Ảnh');
  assert.equal(container.querySelectorAll('li.ls-media-item').length, 2);
  // The name is the only button of a tile (its pseudo-element stretches over the tile); the tile is not a button.
  assert.equal(container.querySelectorAll('div.ls-media-tile').length, 2);
  assert.equal(container.querySelectorAll('button').length, 2);
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button.ls-media-title')];
  assert.deepEqual(
    buttons.map((button) => [button.type, button.getAttribute('aria-label')]),
    [
      ['button', 'Mở a.png'],
      ['button', 'Mở b.png'],
    ],
  );
  const image = container.querySelector('img');
  assert.equal(image?.getAttribute('alt'), '', 'decorative: the title is the text');
  assert.equal(image?.getAttribute('loading'), 'lazy');
  assert.equal(
    container.querySelectorAll('.ls-media-badges').length,
    2,
    'the badge row is always there',
  );
  assert.equal(buttons[0]?.getAttribute('title'), 'a.png');
  assert.equal(buttons[0]?.textContent, 'a.png', 'the visible name is inside the accessible name');
  act(() => {
    buttons[1]!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  assert.deepEqual(opened, ['b.png']);
  act(() => root.unmount());
  container.remove();
});

test('media grid styles: tokens only, one border per tile, fixed rows, one-line title and meta', () => {
  const css = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  const block = (selector: string) => {
    const match = new RegExp(`(?:^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(
      css,
    );
    assert.ok(match, selector);
    return match[1] ?? '';
  };
  assert.match(block('.ls-media-grid'), /gap:\s*var\(--ls-space-4\)/);
  assert.match(block('.ls-media-tile'), /grid-template-rows:/);
  assert.match(block('.ls-media-title'), /min-height:\s*var\(--ls-control-h\)/);
  assert.match(css, /\.ls-media-title::after\s*\{[^}]*inset:\s*0/);
  assert.match(block('.ls-media-tile'), /padding:\s*var\(--ls-space-2\)/);
  assert.match(block('.ls-media-title'), /white-space:\s*nowrap/);
  assert.match(block('.ls-media-meta'), /white-space:\s*nowrap/);
  assert.doesNotMatch(
    [block('.ls-media-grid'), block('.ls-media-tile'), block('.ls-media-thumb')].join('\n'),
    /(?:gap|padding|margin)[^;]*\d(?:px|rem)/,
    'no px/rem spacing literal',
  );
});
