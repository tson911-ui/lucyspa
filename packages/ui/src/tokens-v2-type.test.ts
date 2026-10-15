import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// DESIGN.md 6.3 (Be Vietnam Pro, three weights, the type roles) and H6 (rem, heading line height at least 1.2) against the CSS.
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const customer = readFileSync(new URL('./customer.css', import.meta.url), 'utf8');
const base = readFileSync(new URL('./base.css', import.meta.url), 'utf8');
const globals = readFileSync(
  new URL('../../../apps/web/src/app/globals.css', import.meta.url),
  'utf8',
);

function declarations(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    result[match[1]!] = match[2]!.replace(/\s+/g, ' ').trim();
  }
  return result;
}

const start = tokens.search(/^\[data-ui='v2'\]\s*\{/m);
assert.ok(start >= 0, 'v2 block');
const v2 = declarations(tokens.slice(start, tokens.indexOf('\n}\n', start)));

/** A length in px at a viewport width, from a `rem` value or a `clamp(min, a + b vw, max)`. */
function pxAt(value: string, viewport: number): number {
  const rem = (text: string) => parseFloat(text) * 16;
  const clamp = /^clamp\(([\d.]+)rem,\s*([\d.]+)rem \+ ([\d.]+)vw,\s*([\d.]+)rem\)$/.exec(value);
  if (!clamp) return rem(value);
  const preferred = rem(clamp[2]!) + (parseFloat(clamp[3]!) / 100) * viewport;
  return Math.min(Math.max(preferred, rem(clamp[1]!)), rem(clamp[4]!));
}

test('one family: Be Vietnam Pro, the heading face is the same family', () => {
  assert.match(v2['--ls-font-sans']!, /^var\(--font-be-vietnam-pro\)/);
  assert.equal(v2['--ls-font-display'], 'var(--ls-font-sans)');
  assert.doesNotMatch(v2['--ls-font-sans']!, /fraunces|nunito|playfair/i);
  assert.equal(v2['--ls-font-staff-title'], 'var(--ls-font-display)', 'shared titles follow it');
});

test('weights are 400, 500 and 600 only', () => {
  assert.equal(v2['--ls-weight-body'], '400');
  assert.equal(v2['--ls-weight-label'], '500');
  assert.equal(v2['--ls-weight-title'], '600');
});

test('roles: the sizes of DESIGN.md 6.3, in rem, with the 12 px floor', () => {
  assert.equal(pxAt(v2['--ls-type-title']!, 1440), 28);
  assert.equal(pxAt(v2['--ls-type-heading']!, 1440), 21);
  assert.equal(pxAt(v2['--ls-type-body']!, 1440), 17);
  assert.equal(pxAt(v2['--ls-type-label']!, 1440), 14);
  assert.equal(pxAt(v2['--ls-type-caption']!, 1440), 12);
  assert.equal(pxAt(v2['--ls-type-price']!, 1440), 21);
  for (const name of Object.keys(v2).filter((n) => n.startsWith('--ls-type-'))) {
    assert.ok(!/px\b/.test(v2[name]!), `${name} is in rem, never px`);
  }
});

test('display is 56 px (36 at 360 px) and title-xl is 40 px (32 at 360 px)', () => {
  assert.ok(Math.abs(pxAt(v2['--ls-type-display']!, 1440) - 56) < 0.1);
  assert.ok(Math.abs(pxAt(v2['--ls-type-display']!, 360) - 36) < 0.1);
  assert.ok(Math.abs(pxAt(v2['--ls-type-title-xl']!, 1440) - 40) < 0.1);
  assert.ok(Math.abs(pxAt(v2['--ls-type-title-xl']!, 360) - 32) < 0.1);
  assert.equal(pxAt(v2['--ls-type-display']!, 200), 36, 'never below 36');
  assert.equal(pxAt(v2['--ls-type-display']!, 4000), 56, 'never above 56');
});

test('headings never have a line height below 1.2 (stacked Vietnamese marks clip)', () => {
  // The names the pages read resolve to a role line height (or hold a number of their own); none may be tighter than 1.2.
  const resolve = (name: string): number => {
    const value = v2[name]!;
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    return reference ? resolve(reference[1]!) : parseFloat(value);
  };
  for (const role of [
    'display',
    'title-xl',
    'title',
    'heading',
    'hero',
    'page',
    'section',
    'sub',
    'card',
  ]) {
    assert.ok(resolve(`--ls-lh-${role}`) >= 1.2, `--ls-lh-${role} is at least 1.2`);
  }
  for (const role of ['display', 'title-xl', 'title', 'heading']) {
    assert.ok(parseFloat(v2[`--ls-lh-${role}`]!) >= 1.2, `--ls-lh-${role} is at least 1.2`);
  }
  assert.equal(v2['--ls-lh-body'], '1.6');
  assert.equal(v2['--ls-tracking-display'], '-0.01em');
});

test('the names the public pages read point at the roles (one scale)', () => {
  const expected: Record<string, string> = {
    '--ls-type-hero': 'var(--ls-type-display)',
    '--ls-type-page': 'var(--ls-type-title-xl)',
    '--ls-type-section': 'var(--ls-type-title)',
    '--ls-type-sub': 'var(--ls-type-heading)',
    '--ls-type-card': 'var(--ls-type-heading)',
    '--ls-type-lead': 'var(--ls-type-body)',
    '--ls-type-small': 'var(--ls-type-label)',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(v2[name], value, name);
});

test('v2 headings in base.css: 600, balanced, line height from the roles, zero specificity', () => {
  assert.match(
    base,
    /:where\(\[data-ui='v2'\]\) :is\(h1, h2, h3, h4, h5, h6\) \{[^}]*font-weight: var\(--ls-weight-title\)/,
  );
  assert.match(base, /:where\(\[data-ui='v2'\]\) h1 \{[^}]*line-height: var\(--ls-lh-title-xl\)/);
  assert.match(
    base,
    /\[data-ui='v2'\] \{[^}]*font-size: var\(--ls-type-body\)[^}]*line-height: var\(--ls-lh-body\)/,
  );
});

test('the legacy global h1 leaves the v2 frame alone', () => {
  assert.match(globals, /h1:where\(:not\(\[data-ui='v2'\] h1\)\) \{/);
});

test('the customer pages carry no italic and no negative tracking literal', () => {
  const body = customer.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(body, /font-style:\s*italic/);
  assert.doesNotMatch(body, /letter-spacing:\s*-[\d.]/);
});
