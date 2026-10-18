import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Chrome and Edge keep a media-less rel="icon" (e.g. /favicon.ico with sizes="any") and ignore the dark PNG, so the tab
// showed the light icon in dark mode (production 2026-10-17). Checked in real Chrome and Edge through chrome://favicon2.
const layout = readFileSync(new URL('./[locale]/layout.tsx', import.meta.url), 'utf8');
const icons = [...layout.matchAll(/<link\s[^>]*?rel="icon"[^>]*?\/>/gs)].map((match) => match[0]);

test('every tab icon declares its colour scheme in media, dark first, light last', () => {
  assert.equal(icons.length, 2);
  assert.match(icons[0] ?? '', /favicon-dark-32\.png[\s\S]*media="\(prefers-color-scheme: dark\)"/);
  assert.match(
    icons[1] ?? '',
    /favicon-light-32\.png[\s\S]*media="\(prefers-color-scheme: light\)"/,
  );
});

test('no script swaps the tab icon and no media-less icon link is declared', () => {
  assert.doesNotMatch(layout, /favicon-theme|FaviconTheme|lucy-favicon/);
  assert.doesNotMatch(
    layout,
    /rel="icon"[^>]*href="\/favicon\.ico"|href="\/favicon\.ico"[^>]*rel="icon"/s,
  );
});
