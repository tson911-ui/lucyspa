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

test('tab bar: fixed to the bottom edge with the safe area as padding inside it, and the page reserves its height', () => {
  const bar = rule('.ls-tab-bar');
  assert.match(bar, /position: fixed;/);
  assert.match(bar, /bottom: 0;/);
  assert.match(bar, /padding-block-end: var\(--ls-safe-bottom\);/);
  assert.match(bar, /background: var\(--ls-bg-surface\);/);
  assert.doesNotMatch(bar, /position: sticky|margin-bottom|translate|transform/);
  // The page ends with the bar's height (plus the safe area) so the last content scrolls fully above it; the booking
  // pages, which have their own action bar and no tab bar, reserve nothing.
  assert.match(
    css,
    /@media \(max-width: 1023\.98px\) \{\s*\.ls-site \{\s*padding-block-end: calc\(var\(--ls-tab-bar-h\) \+ var\(--ls-safe-bottom\)\);/,
  );
  assert.match(css, /\.ls-site:has\(\.ls-booking-bar\) \{\s*padding-block-end: 0;/);
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
