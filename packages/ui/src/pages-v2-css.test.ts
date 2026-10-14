import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rules, selectors } from './css-rules-test-helper';

// pages-v2.css (DESIGN.md 9; redesign group 1, C10 home and C11 services): the customer pages in the v2 look. Same guards as
// components-v2.css and chrome-v2.css.
const css = readFileSync(new URL('pages-v2.css', import.meta.url), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const all = rules(stripped);
const body = (selector: string) => all.find((rule) => rule.selector === selector)?.body ?? '';

test('pages-v2.css: every selector sits under the v2 attribute, tokens only, no shadow, gradient or literal spacing', () => {
  assert.ok(all.length > 40, `rules found: ${all.length}`);
  const loose = all.flatMap((rule) =>
    selectors(rule.selector).filter(
      (part) =>
        !part.startsWith("[data-ui='v2']") &&
        !part.startsWith("html[data-ls-motion='reduced'] [data-ui='v2']"),
    ),
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

test('home hero: about 80 % of the screen and never under 35 rem, one flat scrim over the photo, white text and the outline-white secondary', () => {
  const hero = body("[data-ui='v2'] .ls-home-hero");
  assert.match(hero, /min-height:\s*min\(max\(35rem, 80svh\), 52rem\)/);
  const scrim = body("[data-ui='v2'] .ls-home-hero-scrim");
  assert.match(scrim, /background:\s*var\(--ls-scrim\)/);
  assert.match(
    body("[data-ui='v2'] .ls-home-hero[data-media='photo'] :is(.ls-site-display, .ls-lead)"),
    /color:\s*var\(--ls-on-photo\)/,
  );
  // The outline-white form is drawn only over a photo, and stays below the kit's hover rule so hover is still the solid accent.
  const outline = body("[data-ui='v2'] [data-media='photo'] .ls-btn-on-photo");
  assert.match(outline, /border-color:\s*var\(--ls-on-photo\)/);
  assert.match(outline, /color:\s*var\(--ls-on-photo\)/);
  assert.doesNotMatch(outline, /background/);
});

test('home: the product row scrolls inside itself with snap, the arrows appear from 1024 px, motion switches the smooth scroll off', () => {
  const track = body("[data-ui='v2'] .ls-snap-track");
  assert.match(track, /overflow-x:\s*auto/);
  assert.match(track, /scroll-snap-type:\s*x mandatory/);
  assert.match(track, /scroll-behavior:\s*smooth/);
  assert.match(
    css,
    /html\[data-ls-motion='reduced'\] \[data-ui='v2'\] \.ls-snap-track \{\s*scroll-behavior: auto/,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-ui='v2'\] \.ls-snap-track \{\s*scroll-behavior: auto/,
  );
  assert.match(body("[data-ui='v2'] .ls-snap-arrows"), /display:\s*none/);
  assert.match(
    css,
    /@media \(min-width: 1024px\) \{\s*\[data-ui='v2'\] \.ls-snap-arrows \{\s*display: flex/,
  );
});

test('home: product media is 1:1 on the step the band is not, 18 px clipped; the card zooms 1.02 on a fine pointer only', () => {
  const media = body("[data-ui='v2'] .ls-pcard-media");
  assert.match(media, /aspect-ratio:\s*1;/);
  assert.match(media, /border-radius:\s*var\(--ls-radius-lg\)/);
  assert.match(media, /background:\s*var\(--ls-bg-surface\)/);
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\[data-ui='v2'\] \.ls-pcard:hover \.ls-pcard-media img \{\s*scale: 1\.02;/,
  );
});

test('home: a category tile hovers to the solid accent (rule 4) on a fine pointer; a service row hovers to a neutral step', () => {
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\[data-ui='v2'\] \.ls-home-cat:hover \{\s*background: var\(--ls-hover-bg\);\s*color: var\(--ls-hover-text\);/,
  );
  assert.match(
    css,
    /\[data-ui='v2'\] \.ls-home-top-row:hover \{\s*background: var\(--ls-bg-field\);/,
  );
});

test('home offer: one flat accent block, and the button is the inverse of it with a darker hover that keeps an outline', () => {
  const card = body("[data-ui='v2'] .ls-offer-card");
  assert.match(card, /background:\s*var\(--ls-brand-fill\)/);
  assert.match(card, /color:\s*var\(--ls-on-brand\)/);
  assert.match(card, /box-shadow:\s*none/);
  const button = body("[data-ui='v2'] .ls-offer-card .ls-btn-offer");
  assert.match(button, /background:\s*var\(--ls-on-brand\)/);
  assert.match(button, /color:\s*var\(--ls-brand-fill\)/);
  assert.match(
    css,
    /\.ls-btn-offer:hover:not\(\[aria-disabled='true'\]\):not\(:disabled\) \{\s*border-color: var\(--ls-on-brand\);\s*background: var\(--ls-brand-fill-hover\);/,
  );
});

test('services list: the chips row sticks under the compact header, cards are 1 / 2 / 3 / 4 columns, the name link is a 44 px target', () => {
  const chips = body("[data-ui='v2'] .ls-svc-chips");
  assert.match(chips, /position:\s*sticky/);
  assert.match(chips, /top:\s*var\(--ls-site-header-h-compact\)/);
  assert.match(chips, /background:\s*var\(--ls-band-base\)/);
  for (const [width, columns] of [
    [640, 2],
    [1024, 3],
    [1280, 4],
  ] as const) {
    assert.match(
      css,
      new RegExp(
        `@media \\(min-width: ${width}px\\) \\{\\s*\\[data-ui='v2'\\] \\.ls-svc-grid \\{\\s*grid-template-columns: repeat\\(${columns}, minmax\\(0, 1fr\\)\\)`,
      ),
    );
  }
  assert.match(body("[data-ui='v2'] .ls-svc-card-name a"), /min-height:\s*2\.6em/);
  assert.match(body("[data-ui='v2'] .ls-svc-card-name a::after"), /inset:\s*0/);
  // The booking pill keeps its own target above the stretched name link.
  assert.match(body("[data-ui='v2'] .ls-svc-card-book"), /z-index:\s*1/);
});

test('service detail: the phone bar is drawn only below 1024 px and only when the client says so; the booking band is for larger screens', () => {
  assert.match(body("[data-ui='v2'] .ls-svc-bar"), /display:\s*none/);
  assert.match(
    css,
    /@media \(max-width: 1023\.98px\) \{\s*\[data-ui='v2'\] \.ls-svc-bar\[data-shown='true'\] \{\s*display: flex;/,
  );
  assert.match(
    css,
    /@media \(max-width: 1023\.98px\) \{\s*\[data-ui='v2'\] \.ls-svd-cta \{\s*display: none;/,
  );
  const shown =
    all.find((rule) => rule.selector === "[data-ui='v2'] .ls-svc-bar[data-shown='true']")?.body ??
    '';
  assert.match(shown, /box-shadow:\s*none/);
  assert.match(shown, /border-radius:\s*0/);
});

test('C11b: a category tile with a photo is the picture under one flat scrim with the name in white, hover tints the scrim', () => {
  const tile = body("[data-ui='v2'] .ls-home-cat[data-media='photo']");
  assert.match(tile, /position:\s*relative/);
  assert.match(tile, /color:\s*var\(--ls-on-photo\)/);
  assert.match(body("[data-ui='v2'] .ls-home-cat-img"), /object-fit:\s*cover/);
  assert.match(
    body("[data-ui='v2'] .ls-home-cat[data-media='photo']::after"),
    /background:\s*var\(--ls-scrim\)/,
  );
  assert.match(
    body("[data-ui='v2'] .ls-home-cat[data-media='photo']:hover::after"),
    /background:\s*var\(--ls-hover-bg\)/,
  );
  // The name stays above the picture and the scrim.
  assert.match(
    body("[data-ui='v2'] .ls-home-cat[data-media='photo'] .ls-home-cat-name"),
    /z-index:\s*1/,
  );
});

test('C11b: the optional service bands are one text column, the steps are numbered by a counter, the row skeleton is flat', () => {
  assert.match(body("[data-ui='v2'] .ls-svd-block"), /max-width:\s*44rem/);
  assert.match(body("[data-ui='v2'] .ls-svd-steps"), /counter-reset:\s*svd-step/);
  assert.match(body("[data-ui='v2'] .ls-svd-steps li::before"), /counter-increment:\s*svd-step/);
  const skeleton = body("[data-ui='v2'] .ls-skel");
  assert.match(skeleton, /background:\s*var\(--ls-bg-surface\)/);
  assert.doesNotMatch(skeleton, /animation|gradient/);
});
