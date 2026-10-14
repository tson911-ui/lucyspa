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
    selectors(rule.selector).filter((part) => !part.startsWith("[data-ui='v2']")),
  );
  assert.deepEqual(loose, [], 'a selector outside the v2 scope would change the staff screens');
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

test('menu: 14 / 500 ink links, the current page is accent text with a 2 px underline and no fill, the pill is drawn only on hover or focus', () => {
  const link = body("[data-ui='v2'] .ls-site-nav a");
  assert.match(link, /color:\s*var\(--ls-text\)/);
  assert.match(link, /font-size:\s*var\(--ls-type-label\)/);
  assert.match(link, /font-weight:\s*var\(--ls-weight-label\)/);
  const current = all.find((rule) =>
    rule.selector.startsWith("[data-ui='v2'] .ls-site-nav a[aria-current='page']"),
  )?.body;
  assert.ok(current);
  assert.match(current, /background:\s*transparent/);
  assert.match(current, /color:\s*var\(--ls-brand\)/);
  assert.match(current, /text-decoration-thickness:\s*2px/);
  assert.match(current, /text-underline-offset:\s*var\(--ls-space-2\)/);
  assert.match(body("[data-ui='v2'] .ls-site-nav > .ls-nav-pill"), /opacity:\s*0/);
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\[data-ui='v2'\] \.ls-site-nav:has\(> a:hover\) > \.ls-nav-pill \{\s*opacity: 1;/,
  );
  // The pill keeps its glide: the opacity transition is added to the translate and width ones, not instead of them.
  assert.match(
    body("[data-ui='v2'] .ls-site-nav > .ls-nav-pill"),
    /translate var\(--ls-dur-glide\)[\s\S]*width var\(--ls-dur-glide\)[\s\S]*opacity var\(--ls-dur-fast\)/,
  );
});

test('tools: bare ink circles, hover is the solid accent on a fine pointer only, the call to action shows from 640 px', () => {
  const tools = all.find((rule) => rule.selector.includes("[data-ui='v2'] .ls-theme-cycle"))?.body;
  assert.ok(tools);
  assert.match(tools, /background:\s*transparent/);
  assert.match(tools, /color:\s*var\(--ls-text\)/);
  const hover = css.match(
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\[data-ui='v2'\] \.ls-theme-cycle:hover,[\s\S]*?\}\s*\}/,
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
