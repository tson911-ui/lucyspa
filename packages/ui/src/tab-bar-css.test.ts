import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Owner request 2026-10-06: only the current page's tab is active; "Đặt lịch ngay" is a distinct raised primary action.
const css = readFileSync(new URL('site.css', import.meta.url), 'utf8');

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} exists`);
  return match[1] ?? '';
};

test('tab bar: only the current tab takes the active style; the booking tab does not', () => {
  assert.match(
    rule(".ls-tab-bar a[aria-current='page']"),
    /color: var\(--ls-brand\);\s*font-weight: 600;/,
  );
  assert.doesNotMatch(
    css,
    /\.ls-tab-bar a\[aria-current='page'\],\s*\.ls-tab-bar a\[data-emphasis='true'\]/,
  );
  assert.match(rule(".ls-tab-bar a[data-emphasis='true']"), /color: var\(--ls-text\);/);
});

test('tab bar: the booking tab is a raised round brand button with its icon on it, a ring on the booking page', () => {
  const disc = rule(".ls-tab-bar a[data-emphasis='true'] svg");
  assert.match(disc, /border-radius: 50%;/);
  assert.match(disc, /background: var\(--ls-brand\);/);
  assert.match(disc, /color: var\(--ls-on-brand\);/);
  assert.match(disc, /margin-top: calc\(var\(--ls-space-5\) \* -1\);/);
  assert.match(
    rule(".ls-tab-bar a[data-emphasis='true'][aria-current='page'] svg"),
    /box-shadow:[^;]*var\(--ls-brand\)/,
  );
  // Gentle press on the disc only, from the shared token (1 = none under reduced motion).
  assert.match(
    rule(".ls-site .ls-tab-bar a[data-emphasis='true']:active svg"),
    /transform: scale\(var\(--ls-press-scale\)\);/,
  );
});

test('app shell below 1024 px: the scroller is the only scroll container and the tab bar is in the flow below it', () => {
  const bar = rule('.ls-tab-bar');
  // In the flow, opaque, the safe area as padding inside it; never fixed or sticky.
  assert.match(bar, /position: relative;/);
  assert.match(bar, /flex: none;/);
  assert.match(bar, /padding-block-end: var\(--ls-safe-bottom\);/);
  assert.match(bar, /background: var\(--ls-bg-surface\);/);
  assert.doesNotMatch(bar, /position: (?:fixed|sticky)|bottom:|translate|transform/);
  // The shell: a fixed-height column (vh, then svh, then dvh), the document never scrolls, the scroller scrolls.
  const flat = css.replace(/\s+/g, ' ');
  assert.ok(
    flat.includes(
      '@media (max-width: 1023.98px) { .ls-site { height: 100vh; height: 100svh; height: 100dvh; min-height: 0; overflow: hidden; }',
    ),
    'the shell is a fixed-height column',
  );
  assert.ok(
    flat.includes(
      '.ls-site-scroll { position: relative; display: flex; flex: 1; flex-direction: column; min-height: 0; overflow-x: hidden; overflow-y: auto;',
    ),
    'the scroller is the only scroll container',
  );
  assert.ok(flat.includes('html:has(.ls-site-scroll) { background: var(--ls-bg-surface); }'));
  // From 1024 px the wrapper changes nothing: the document scrolls as before.
  assert.ok(flat.includes('.ls-site-scroll { display: contents; }'));
  // No page reserve, no document scroll padding: nothing can be behind the bar.
  assert.ok(!flat.includes('html:has(.ls-tab-bar)'));
  assert.ok(!flat.includes('padding-block-end: calc(var(--ls-tab-bar-h)'));
  // The keyboard: the bar steps aside while a field has focus.
  assert.ok(
    flat.includes(
      '.ls-site:has(input:focus, textarea:focus, select:focus) .ls-tab-bar { display: none; }',
    ),
  );
});

test('the site frame puts everything but the tab bar in the one scroller and the scroll code follows it', () => {
  const frame = readFileSync(
    new URL('../../../apps/web/src/components/public/site-page-frame.tsx', import.meta.url),
    'utf8',
  );
  const scrollerAt = frame.indexOf('data-ls-scroll');
  assert.ok(scrollerAt > 0, 'the scroller is marked');
  assert.ok(frame.indexOf('<SiteScrollManager') > scrollerAt);
  assert.ok(
    frame.indexOf('<PublicTabBar') > frame.indexOf('</div>', scrollerAt),
    'the tab bar is outside it',
  );
  // No scroll reader of the customer pages looks at the window alone.
  for (const file of ['contact-fab.tsx', 'reveal.tsx', 'overlay.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /from '\.\/scroller'/, `${file} follows the scroller`);
  }
});

test('the header glass hides the text behind it', () => {
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  const mix = /--ls-header-glass-mix:\s*(\d+)%/.exec(tokens);
  assert.ok(mix && Number(mix[1]) >= 94, 'the header surface is at least 94 % opaque');
});

test('the page covers the whole screen (viewport-fit=cover) and can never be zoomed out, so the bar reaches the bottom edge and stays on screen', () => {
  const layout = readFileSync(
    new URL('../../../apps/web/src/app/[locale]/layout.tsx', import.meta.url),
    'utf8',
  );
  // Cover: the bar's opaque background reaches the screen edge (no strip of the browser's own below it).
  assert.match(layout, /viewportFit:\s*'cover'/);
  // A page wider than the screen makes the phone zoom out, which strands the fixed bar below the visible screen.
  assert.match(layout, /minimumScale:\s*1/);
  assert.match(rule('.ls-site'), /overflow-x:\s*clip;/);
  assert.match(
    rule('.ls-tab-bar'),
    /padding-inline: var\(--ls-safe-left\) var\(--ls-safe-right\);/,
  );
});

test('a "book" button in a page header is hidden below 1024 px, where the tab bar has "Đặt lịch ngay"', () => {
  assert.match(
    css,
    /@media \(max-width: 1023\.98px\) \{\s*\.ls-site \.ls-hide-on-tabbar,\s*\.ls-site \.ls-page-actions:has\(> \.ls-hide-on-tabbar:only-child\) \{\s*display: none;/,
  );
});
