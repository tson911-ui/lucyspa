import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Session 9 (Owner, 2026-10-15): the contact button is fixed to the corner of the screen, so the footer keeps room under its last row for it.
const pages = readFileSync(new URL('pages-v2.css', import.meta.url), 'utf8');
const site = readFileSync(new URL('site.css', import.meta.url), 'utf8');

test('the footer keeps room for the fixed contact button: its base row is as tall as the button plus 16 px and its trailing corner is empty', () => {
  // The footer has no bottom padding of its own any more (Owner, 2026-10-18, compact footer): the base row is the room.
  const rule = /\[data-ui='v2'\] \.ls-site-footer \{([^}]*)\}/.exec(pages)?.[1] ?? '';
  assert.match(rule, /padding-block-end:\s*0/);
  const chrome = readFileSync(new URL('chrome-v2.css', import.meta.url), 'utf8');
  const base = [...chrome.matchAll(/\[data-ui='v2'\] \.ls-site-footer-base \{([^}]*)\}/g)]
    .map((match) => match[1])
    .join('\n');
  assert.match(base, /min-height:\s*calc\(var\(--ls-space-10\) \+ var\(--ls-space-2\)\)/);
  assert.match(base, /padding-inline-end:\s*calc\(var\(--ls-space-10\) \+ var\(--ls-space-2\)\)/);
  // The button is 3rem + 0.5rem tall (--ls-fab-size) and its stack rests 16 px above the container bottom: 56 + 16 = 72 = 4rem + 0.5rem.
  const size = /--ls-fab-size:\s*calc\(var\(--ls-space-9\) \+ var\(--ls-space-2\)\)/.test(site);
  assert.ok(size, 'the base row matches the button size token');
});

test('the old slot between the last band and the footer is gone', () => {
  assert.doesNotMatch(site, /site-shell:has\(> \.ls-contact\)/);
  assert.doesNotMatch(pages, /ls-site-main > \.ls-band--alt:last-child\) > \.ls-contact/);
  assert.doesNotMatch(site, /\.ls-contact \{[^}]*position: sticky/);
});
