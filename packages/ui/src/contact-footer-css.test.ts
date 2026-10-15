import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Session 9 (Owner, 2026-10-15): the contact button is fixed to the corner of the screen, so the footer keeps room under its last row for it.
const pages = readFileSync(new URL('pages-v2.css', import.meta.url), 'utf8');
const site = readFileSync(new URL('site.css', import.meta.url), 'utf8');

test('the footer keeps bottom room for the fixed contact button: its 56 px plus 16 px above and below', () => {
  const rule = /\[data-ui='v2'\] \.ls-site-footer \{([^}]*)\}/.exec(pages)?.[1] ?? '';
  assert.match(
    rule,
    /padding-block-end:\s*calc\(var\(--ls-space-9\) \+ var\(--ls-space-2\) \+ var\(--ls-space-4\) \* 2\)/,
  );
  // The button is 3rem + 0.5rem tall (--ls-fab-size) and its stack rests 16 px above the container bottom, which is 16 px high below it too.
  const size = /--ls-fab-size:\s*calc\(var\(--ls-space-9\) \+ var\(--ls-space-2\)\)/.test(site);
  assert.ok(size, 'the footer padding matches the button size token');
});

test('the old slot between the last band and the footer is gone', () => {
  assert.doesNotMatch(site, /site-shell:has\(> \.ls-contact\)/);
  assert.doesNotMatch(pages, /ls-site-main > \.ls-band--alt:last-child\) > \.ls-contact/);
  assert.doesNotMatch(site, /\.ls-contact \{[^}]*position: sticky/);
});
