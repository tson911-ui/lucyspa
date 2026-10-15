import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge, ImageFrame } from './index';

// Redesign group 1, C5: shop labels, the image frame and the surface rules of components-v2.css (DESIGN.md 8.3, 8.7, 8.9).
const css = readFileSync(new URL('components-v2.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');

test('Badge: the three shop labels are neutral (session 10, A3/B18), and a status tone shows its icon by default', () => {
  assert.match(
    renderToStaticMarkup(<Badge tone="accent">Bán chạy</Badge>),
    /ls-badge ls-badge-accent/,
  );
  assert.match(
    renderToStaticMarkup(<Badge tone="outline">Mới</Badge>),
    /ls-badge ls-badge-outline/,
  );
  assert.match(renderToStaticMarkup(<Badge tone="ink">-20 %</Badge>), /ls-badge ls-badge-ink/);
  for (const tone of ['accent', 'outline', 'ink', 'brand', 'neutral']) {
    assert.match(css, new RegExp(`\\.ls-badge-${tone} \\{`), tone);
  }
  // The brand colour is only for what can be clicked or is selected: the shop labels are grey.
  assert.match(
    css,
    /\.ls-badge-accent \{[^}]*color: var\(--ls-text\);[^}]*background: var\(--ls-gray-4\)/,
  );
  assert.match(
    css,
    /\.ls-badge-outline \{[^}]*border-color: var\(--ls-border-control\);[^}]*color: var\(--ls-text\)/,
  );
  for (const tone of ['accent', 'outline']) {
    const body = new RegExp(`\\.ls-badge-${tone} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    assert.doesNotMatch(body, /--ls-brand/, `${tone} label is not the brand colour`);
  }
  // A status tone renders its icon (16 px) beside the word; `icon={false}` hides it; a shop label has none.
  for (const tone of ['success', 'warning', 'danger', 'info'] as const) {
    const html = renderToStaticMarkup(<Badge tone={tone}>Trạng thái</Badge>);
    assert.match(html, /<svg[^>]*width="16"[^>]*height="16"/, tone);
    assert.doesNotMatch(
      renderToStaticMarkup(
        <Badge tone={tone} icon={false}>
          Trạng thái
        </Badge>,
      ),
      /<svg/,
      `${tone} without icon`,
    );
  }
  for (const tone of ['neutral', 'accent', 'outline', 'ink', 'brand'] as const) {
    assert.doesNotMatch(renderToStaticMarkup(<Badge tone={tone}>Nhãn</Badge>), /<svg/, tone);
  }
  assert.match(
    css,
    /\.ls-badge-ink \{[^}]*color: var\(--ls-bg-page\);[^}]*background: var\(--ls-text\)/,
  );
  assert.match(css, /\.ls-badge \{[^}]*min-height: var\(--ls-badge-h\);[^}]*white-space: nowrap/);
  assert.match(tokens, /--ls-badge-h: 24px;\s*--ls-badge-pad-x: var\(--ls-space-3\);/);
});

test('ImageFrame: a ratio, alt text, and a flat placeholder when there is no picture', () => {
  const picture = renderToStaticMarkup(
    <ImageFrame src="/a.jpg" alt="Phòng trị liệu" ratio="1/1" />,
  );
  assert.match(
    picture,
    /<span class="ls-image-frame" data-ratio="1\/1"><img [^>]*src="\/a\.jpg"[^>]*alt="Phòng trị liệu"/,
  );
  const missing = renderToStaticMarkup(<ImageFrame src={null} alt="Chưa có ảnh" />);
  assert.match(missing, /data-ratio="4\/3"/);
  assert.match(
    missing,
    /<span class="ls-image-frame-fallback" role="img" aria-label="Chưa có ảnh">/,
  );
  assert.doesNotMatch(missing, /<img/);
  // A decorative frame (empty alt) hides its placeholder from assistive technology.
  assert.match(
    renderToStaticMarkup(<ImageFrame src={undefined} alt="" />),
    /ls-image-frame-fallback" aria-hidden="true"/,
  );
});

test('v2 surfaces: a flat card, flush notice, pill tabs, flat placeholder, the photo dim token in dark only', () => {
  assert.match(
    css,
    /\.ls-card \{[^}]*border: 0;[^}]*border-radius: var\(--ls-radius-lg\);[^}]*background: var\(--ls-bg-surface\)/,
  );
  assert.match(css, /\.ls-card \{[^}]*padding: var\(--ls-space-6\)/);
  assert.match(
    css,
    /\.ls-notice-close \{[^}]*min-width: var\(--ls-control-h\);[^}]*min-height: var\(--ls-control-h\)/,
  );
  assert.match(
    css,
    /\.ls-tablist \{[^}]*border-radius: var\(--ls-radius-full\);[^}]*background: var\(--ls-bg-field\)/,
  );
  assert.match(
    css,
    /\.ls-image-frame \{[^}]*border-radius: var\(--ls-radius-lg\);[^}]*background: var\(--ls-bg-field\)/,
  );
  assert.match(
    css,
    /\.ls-image-frame img \{[^}]*object-fit: cover;[^}]*filter: var\(--ls-image-filter\)/,
  );
  assert.equal(
    tokens.match(/--ls-image-filter: none;/g)?.length,
    2,
    'light block and forced-light preview',
  );
  assert.equal(
    tokens.match(/--ls-image-filter: brightness\(0\.92\);/g)?.length,
    2,
    'both dark blocks',
  );
});
