import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Session 9 (2026-10-15) small guards that do not belong to one file's existing tests.
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const components = read('components-v2.css');
const chrome = read('chrome-v2.css');
const tokens = read('tokens.css');

test('a danger action carries an icon (never color alone) and a busy button keeps AA text on the pressed fill', () => {
  assert.match(
    components,
    /:is\(\.ls-btn-danger, \.ls-btn-danger-outline\):not\(:has\(> svg\)\)::before \{[^}]*mask: url\("data:image\/svg\+xml/,
  );
  assert.match(
    components,
    /\.ls-btn\[aria-busy='true'\]:not\(\.ls-btn-primary\) \{\s*color: var\(--ls-text-muted\);\s*background: var\(--ls-bg-pressed\);/,
  );
});

test('the header and the footer wordmark share one color token', () => {
  assert.match(
    chrome,
    /\[data-ui='v2'\] :is\(\.ls-site-brand a, \.ls-site-footer-logo\) \{\s*color: var\(--ls-wordmark\);/,
  );
});

test('the season defaults follow the v2 accent inside the frame, and never override a season preset on <html>', () => {
  const block = /:root:not\(\[data-season\]\) \[data-ui='v2'\] \{([^}]*)\}/.exec(tokens)?.[1] ?? '';
  assert.match(block, /--ls-season-accent: var\(--ls-brand\)/);
  assert.match(block, /--ls-season-frame-from: var\(--ls-brand-fill\)/);
  assert.match(block, /--ls-season-frame-to: var\(--ls-brand-fill-hover\)/);
});
