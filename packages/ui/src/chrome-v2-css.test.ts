import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rules, selectors } from './css-rules-test-helper';

// chrome-v2.css (DESIGN.md 6.5, 8.5, D2; redesign group 1, C8 and C9): the customer site chrome in the v2 look. Same guards as components-v2.css.
const css = readFileSync(new URL('chrome-v2.css', import.meta.url), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const all = rules(stripped);
const body = (selector: string) => all.find((rule) => rule.selector === selector)?.body ?? '';

test('chrome-v2.css: every selector sits under the v2 attribute, tokens only, no shadow, gradient or literal spacing', () => {
  assert.ok(all.length > 10, `rules found: ${all.length}`);
  const loose = all.flatMap((rule) =>
    selectors(rule.selector).filter(
      (part) => !part.startsWith("[data-ui='v2']") && !part.startsWith("html:has([data-ui='v2']"),
    ),
  );
  assert.deepEqual(loose, [], 'a selector outside the v2 scope would change the staff screens');
  // The only non-prefixed selector is the document background behind the phone shell, and it needs a v2 frame inside it.
  assert.doesNotMatch(stripped, /#[0-9a-f]{3,8}\b/i, 'no hex color');
  assert.doesNotMatch(stripped, /\b(?:rgb|rgba|hsl|hsla)\(/i, 'no color function');
  assert.doesNotMatch(stripped, /gradient\(/, 'no gradient');
  assert.doesNotMatch(stripped, /!important/, 'no !important');
  for (const rule of all) {
    for (const match of rule.body.matchAll(/box-shadow:\s*([^;]+);/g)) {
      assert.equal(match[1]!.trim(), 'none', `${rule.selector}: box-shadow`);
    }
    for (const match of rule.body.matchAll(
      /(?:^|[\s;])(margin|padding|gap|row-gap|column-gap)[\w-]*:\s*([^;]+);/g,
    )) {
      const value = match[2]!.replace(/var\([^)]*\)/g, 'var');
      assert.doesNotMatch(value, /(?:^|[\s(,+\-*/])-?\d*\.?\d+(?:px|rem|em)\b/, rule.selector);
    }
  }
});

test('header: the 96 % blur surface and a hairline, no shadow, no fade, opaque without blur, under reduced transparency and in forced colors', () => {
  const surface = body("[data-ui='v2'] .ls-site-header::before");
  assert.match(surface, /background:\s*var\(--ls-bg-page\)/);
  assert.match(surface, /border-bottom:\s*1px solid var\(--ls-border\)/);
  assert.match(surface, /box-shadow:\s*none/);
  assert.match(surface, /transition:\s*translate var\(--ls-dur-header\)/, 'only the shrink moves');
  assert.doesNotMatch(surface, /opacity/);
  assert.match(
    css,
    /@supports \(backdrop-filter: blur\(1px\)\)[^{]*\{\s*\[data-ui='v2'\] \.ls-site-header::before \{\s*background: color-mix\(in srgb, var\(--ls-bg-page\) var\(--ls-header-glass-mix\), transparent\)/,
  );
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*backdrop-filter: none/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*background: Canvas/);
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /--ls-header-glass-mix:\s*96%/);
  assert.match(tokens, /--ls-header-blur:\s*16px/);
});

test('menu: 14 / 500 ink links, the current page is accent text with a 2 px underline and no fill, hover and focus fill the link itself at once', () => {
  const link = body("[data-ui='v2'] .ls-site-nav a");
  assert.match(link, /color:\s*var\(--ls-text\)/);
  assert.match(link, /font-size:\s*var\(--ls-type-label\)/);
  assert.match(link, /font-weight:\s*var\(--ls-weight-label\)/);
  assert.match(link, /transition:\s*none/, 'no travel and no fade: the fill is instant');
  const current = body("[data-ui='v2'] .ls-site-nav a[aria-current='page']");
  assert.match(current, /background:\s*transparent/);
  assert.match(current, /color:\s*var\(--ls-brand\)/);
  assert.match(current, /text-decoration-thickness:\s*2px/);
  assert.match(current, /text-underline-offset:\s*var\(--ls-space-2\)/);
  const hover = body("[data-ui='v2'] .ls-site-nav a:hover");
  assert.match(hover, /background:\s*var\(--ls-hover-bg\)/);
  assert.match(hover, /color:\s*var\(--ls-hover-text\)/);
  // The sliding highlight is gone from the stylesheet.
  assert.doesNotMatch(css, /ls-nav-pill|data-under|data-pill/);
});

test('tools: bare ink circles, hover is the solid accent on a fine pointer only, the call to action shows from 640 px', () => {
  const tools = all.find((rule) => rule.selector.includes("[data-ui='v2'] .ls-site-tool"))?.body;
  assert.ok(tools);
  assert.match(tools, /background:\s*transparent/);
  assert.match(tools, /color:\s*var\(--ls-text\)/);
  const hover = css.match(
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\[data-ui='v2'\] \.ls-site-tool:hover,[\s\S]*?\}\s*\}/,
  );
  assert.ok(hover);
  assert.match(hover[0], /background:\s*var\(--ls-hover-bg\)/);
  assert.match(hover[0], /color:\s*var\(--ls-hover-text\)/);
  assert.match(
    css,
    /@media \(min-width: 640px\) \{\s*\[data-ui='v2'\] \.ls-site-cta \{\s*display: block;/,
  );
  assert.match(css, /--ls-tool-zoom:\s*1/);
});

test('footer: the alternate band under a hairline, two columns on a phone and twelve from 1024 px, 14 / 600 titles, a 12 px legal line', () => {
  const footer = body("[data-ui='v2'] .ls-site-footer");
  assert.match(footer, /background:\s*var\(--ls-bg-sunken\)/);
  assert.match(footer, /border-top:\s*1px solid var\(--ls-border\)/);
  assert.match(footer, /margin-top:\s*0/);
  assert.match(
    body("[data-ui='v2'] .ls-site-footer-grid"),
    /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /@media \(min-width: 1024px\) \{\s*\[data-ui='v2'\] \.ls-site-footer-grid \{\s*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/,
  );
  const title = all.find((rule) => rule.selector.includes('.ls-site-footer-title'))?.body ?? '';
  assert.match(title, /font-size:\s*var\(--ls-type-label\)/);
  assert.match(title, /font-weight:\s*var\(--ls-weight-title\)/);
  assert.match(
    body("[data-ui='v2'] .ls-site-footer-base"),
    /font-size:\s*var\(--ls-type-caption\)/,
  );
  const direction = readFileSync(new URL('customer.css', import.meta.url), 'utf8');
  assert.doesNotMatch(direction, /\.ls-site-footer::before/, 'no wave on the footer');
  assert.doesNotMatch(direction, /background:\s*var\(--ls-c-footer-bg\)/, 'no brand-red footer');
});

test('footer icons: a 32 px gap leaves 12 px between their 48 px targets (at least 8)', () => {
  const site = readFileSync(new URL('site.css', import.meta.url), 'utf8');
  assert.match(site, /\.ls-footer-icons \{[^}]*gap:\s*var\(--ls-space-7\)/);
});

test('tab bar, contact button and popup: no shadow, a hairline, a flat accent disc, the dialog radius', () => {
  const bar = body("[data-ui='v2'] .ls-tab-bar");
  assert.doesNotMatch(
    bar,
    /border/,
    'the bar box is exactly its tabs; the hairline is a pseudo-element above it',
  );
  assert.match(body("[data-ui='v2'] .ls-tab-bar::before"), /top:\s*-1px/);
  assert.match(bar, /background:\s*var\(--ls-bg-page\)/);
  assert.match(css, /outline: 2px solid var\(--ls-brand\)/);
  assert.match(body("[data-ui='v2'] .ls-contact-toggle"), /box-shadow:\s*none/);
  assert.match(body("[data-ui='v2'] .ls-promo"), /background:\s*var\(--ls-bg-raised\)/);
  const radius = all.find((rule) => rule.selector.includes('.ls-promo-dialog'))?.body ?? '';
  assert.match(radius, /border-radius:\s*var\(--ls-radius-lg\)/);
});
