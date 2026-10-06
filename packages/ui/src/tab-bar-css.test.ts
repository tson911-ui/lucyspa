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
  assert.match(disc, /margin-top: calc\(var\(--ls-space-4\) \* -1\);/);
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

test('a "book" button in a page header is hidden below 1024 px, where the tab bar has "Đặt lịch ngay"', () => {
  assert.match(
    css,
    /@media \(max-width: 1023\.98px\) \{\s*\.ls-site \.ls-hide-on-tabbar,\s*\.ls-site \.ls-page-actions:has\(> \.ls-hide-on-tabbar:only-child\) \{\s*display: none;/,
  );
});
