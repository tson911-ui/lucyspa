import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rules, selectors } from './css-rules-test-helper';

// pages-v2.css (DESIGN.md 9; redesign group 1, C10 home and C11 services): the customer pages in the v2 look. Same guards as
// components-v2.css and chrome-v2.css.
const css = readFileSync(new URL('pages-v2.css', import.meta.url), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const all = rules(stripped);
const body = (selector: string) =>
  all.find((rule) => rule.selector.replace(/\s+/g, ' ') === selector)?.body ?? '';

test('pages-v2.css: every selector sits under the v2 attribute, tokens only, no shadow, gradient or literal spacing', () => {
  assert.ok(all.length > 40, `rules found: ${all.length}`);
  const loose = all.flatMap((rule) =>
    selectors(rule.selector).filter(
      (part) =>
        !part.startsWith("[data-ui='v2']") &&
        !part.startsWith("html[data-ls-motion='reduced'] [data-ui='v2']") &&
        !part.startsWith("html[data-ls-fx='off'] [data-ui='v2']"),
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
  // The outline-white form is drawn only over a photo. Like every secondary button it never fills on hover (Owner exception to rule 4,
  // 2026-10-15): the white border goes from 70 % to full and the background stays clear.
  const outline = body("[data-ui='v2'] [data-media='photo'] .ls-btn-on-photo");
  assert.match(
    outline,
    /border-color:\s*color-mix\(in srgb, var\(--ls-on-photo\) 70%, transparent\)/,
  );
  assert.match(outline, /color:\s*var\(--ls-on-photo\)/);
  assert.doesNotMatch(outline, /background/);
  const hover = body(
    "[data-ui='v2'] [data-media='photo'] .ls-btn-on-photo:hover:not([aria-disabled='true']):not(:disabled)",
  );
  assert.match(hover, /border-color:\s*var\(--ls-on-photo\)/);
  assert.match(hover, /background:\s*transparent/);
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
  assert.match(skeleton, /background:\s*var\(--ls-bg-field\)/);
  assert.doesNotMatch(skeleton, /animation|gradient/);
});

test('C14 booking: one 720 px column with a sticky summary from 1024 px, a flat phone action bar, a folded phone summary', () => {
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*45rem\)\s*22rem/);
  assert.match(body("[data-ui='v2'] .ls-action-bar"), /border-radius:\s*0/);
  assert.match(body("[data-ui='v2'] .ls-action-bar"), /box-shadow:\s*none/);
  // A closed accordion panel is `hidden`; a display rule must not show it.
  assert.match(
    body("[data-ui='v2'] .ls-summary-fold .ls-accordion-panel:not([hidden])"),
    /display:\s*grid/,
  );
  assert.match(
    body("[data-ui='v2'] .ls-slot-grid .ls-choice"),
    /min-height:\s*var\(--ls-control-h\)/,
  );
});

test('C15 sign-in: the flat panel is a token (no gradient), the card is a hairline raised surface, 26 rem wide', () => {
  const panel = body("[data-ui='v2'] .ls-auth-panel");
  assert.match(panel, /background:\s*var\(--ls-auth-flat\)/);
  assert.match(panel, /color:\s*var\(--ls-on-auth-flat\)/);
  assert.match(body("[data-ui='v2'] .ls-auth-stack"), /max-width:\s*26rem/);
  const card = body("[data-ui='v2'] .ls-auth-panel .ls-member-card");
  assert.match(card, /border:\s*1px solid var\(--ls-border\)/);
  assert.match(card, /background:\s*var\(--ls-bg-raised\)/);
  assert.match(card, /box-shadow:\s*none/);
  // Staff sign-in is its own layout: nothing here may reach `.ls-auth`.
  assert.doesNotMatch(stripped, /\.ls-auth\b(?!-)/);
});

test('C15 member area: the tabs show from 768 px, the phone gets the list, a summary card is one link whose pill takes the hover', () => {
  assert.match(
    css,
    /@media \(min-width: 768px\) \{\s*\[data-ui='v2'\] \.ls-acct-tabs \{\s*display: flex;/,
  );
  assert.match(body("[data-ui='v2'] .ls-acct-tabs"), /display:\s*none/);
  assert.match(
    css,
    /@media \(min-width: 768px\) \{\s*\[data-ui='v2'\] \.ls-acct-list \{\s*display: none;/,
  );
  assert.match(
    body("[data-ui='v2'] .ls-acct-card:hover .ls-acct-card-cta"),
    /background:\s*var\(--ls-hover-bg\)/,
  );
  assert.doesNotMatch(body("[data-ui='v2'] .ls-acct-card"), /hover|transform/);
  assert.match(body("[data-ui='v2'] .ls-acct-content[data-narrow='true']"), /max-width:\s*45rem/);
});

test('C16 status pages: the direction C ring is gone and the title is the `title` size', () => {
  assert.match(body("[data-ui='v2'] .ls-public-centered::before"), /content:\s*none/);
  assert.match(
    body("[data-ui='v2'] .ls-public-centered .ls-h1-display"),
    /font-size:\s*var\(--ls-type-section\)/,
  );
});

test('C16 ticket: a 30 rem column, the header keeps only the wordmark and the page prints without the site chrome', () => {
  assert.match(body("[data-ui='v2'] .ls-ticket-page"), /max-width:\s*30rem/);
  assert.match(
    stripped,
    /:has\(\.ls-ticket-page\)\s+:is\(\.ls-site-lead > :not\(\.ls-site-brand\), \.ls-site-tools, \.ls-site-cta, \.ls-tab-bar\) \{\s*display: none;/,
  );
  assert.match(
    stripped,
    /@media print \{\s*\[data-ui='v2'\]:has\(\.ls-ticket-page\) :is\(\.ls-site-footer, \.ls-contact\)/,
  );
});

test('C16 info pages: a 680 px article, the table of contents only from 1024 px, the hover is the solid accent', () => {
  assert.match(body("[data-ui='v2'] .ls-info-article"), /max-width:\s*42\.5rem/);
  assert.match(body("[data-ui='v2'] .ls-info-toc"), /display:\s*none/);
  assert.match(
    stripped,
    /@media \(min-width: 1024px\) \{\s*\[data-ui='v2'\] \.ls-info-toc \{\s*position: sticky;/,
  );
  assert.match(body("[data-ui='v2'] .ls-info-toc a:hover"), /background:\s*var\(--ls-hover-bg\)/);
  assert.match(
    body("[data-ui='v2'] .ls-info-article img"),
    /border-radius:\s*var\(--ls-radius-lg\)/,
  );
  assert.match(
    stripped,
    /@media \(min-width: 768px\) \{\s*\[data-ui='v2'\] \.ls-info-split \{\s*grid-template-columns: repeat\(2/,
  );
});

test('C17 hero sequence: transform only, nothing hidden, from tokens, cancelled by the gate and the off switch', () => {
  const keyframes = stripped.match(/@keyframes ls-hero-(?:settle|rise) \{[\s\S]*?\n\}/g) ?? [];
  assert.equal(keyframes.length, 2);
  for (const frames of keyframes) {
    assert.doesNotMatch(frames, /opacity|filter|width|height|margin|top|left/);
    assert.match(frames, /transform:/);
  }
  assert.match(
    stripped,
    /@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-ui='v2'\] \.ls-home-hero-img \{\s*animation: ls-hero-settle var\(--ls-dur-hero\) var\(--ls-ease-premium\) both;/,
  );
  assert.match(
    body("[data-ui='v2'] .ls-home-hero-copy > *"),
    /animation: ls-hero-rise calc\(var\(--ls-dur-hero\) \* 0\.7\) var\(--ls-ease-premium\) both/,
  );
  // No literal duration anywhere in the sequence.
  assert.doesNotMatch(
    keyframes.join('') + body("[data-ui='v2'] .ls-home-hero-copy > *"),
    /\d(?:ms|s)\b/,
  );
  for (const mark of ["data-ls-motion='reduced'", "data-ls-fx='off'"]) {
    assert.ok(
      stripped.includes(`html[${mark}] [data-ui='v2'] .ls-home-hero-copy > *`),
      `${mark} cancels the hero sequence`,
    );
  }
});

test('C17 counter: the final number stays in the flow and the width never changes while it counts', () => {
  assert.match(body("[data-ui='v2'] .ls-count"), /font-variant-numeric:\s*tabular-nums/);
  assert.match(
    body("[data-ui='v2'] .ls-count[data-counting] .ls-count-final"),
    /color:\s*transparent/,
  );
  assert.match(body("[data-ui='v2'] .ls-count-live"), /position:\s*absolute/);
});

test('home brand band: the accent solid, white logos of one height, a slow endless track that pauses (its control shows on keyboard focus only), and a still row without motion', () => {
  const band = body("[data-ui='v2'] .ls-brand-band");
  assert.match(band, /background:\s*var\(--ls-brand-fill\)/);
  assert.match(band, /color:\s*var\(--ls-on-brand\)/);
  // The logos move inside their own window. The pause control (WCAG 2.2.2) is a checkbox that is visually hidden until a keyboard user
  // focuses it (Owner, 2026-10-18: no visible button for a pointer); a 44 px round button then.
  assert.match(body("[data-ui='v2'] .ls-brand-view"), /overflow:\s*hidden/);
  const pause = body("[data-ui='v2'] .ls-brand-pause");
  assert.match(pause, /inline-size:\s*var\(--ls-control-h\)/);
  assert.match(pause, /clip-path:\s*inset\(50%\)/);
  assert.match(body("[data-ui='v2'] .ls-brand-pause:focus-visible"), /clip-path:\s*none/);
  assert.match(
    css,
    /\.ls-brand-pause:checked::before \{\s*mask: url\("data:image\/svg\+xml[^"]*M8 5l11 7-11 7z/,
  );
  assert.match(
    css,
    /\.ls-brand-band:is\(:focus-within, :active, :has\(\.ls-brand-pause:checked\)\)\s+\.ls-brand-track \{\s*animation-play-state: paused;/,
  );
  // The pointer pause is for a mouse only: a tap on a touch screen would leave :hover stuck.
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\[data-ui='v2'\] \.ls-brand-band:hover \.ls-brand-track \{\s*animation-play-state: paused;/,
  );
  assert.match(
    body("[data-ui='v2'] .ls-brand-track"),
    /animation:\s*ls-brand-scroll calc\(var\(--ls-brand-seconds\) \* 1s\) linear infinite/,
  );
  assert.match(css, /@keyframes ls-brand-scroll \{\s*to \{\s*transform: translateX\(-50%\);/);
  const logo = body("[data-ui='v2'] .ls-brand-logo");
  assert.match(logo, /height:\s*var\(--ls-space-8\)/);
  assert.match(logo, /filter:\s*brightness\(0\) invert\(1\)/);
  assert.match(body("[data-ui='v2'] .ls-brand-link"), /min-height:\s*var\(--ls-control-h\)/);
  // Reduced motion and the off switch: no animation, the duplicate copy and the fillers are not drawn.
  assert.match(
    css,
    /html\[data-ls-fx='off'\] \[data-ui='v2'\] \.ls-brand-pause,\s*html\[data-ls-motion='reduced'\] \[data-ui='v2'\] \.ls-brand-pause \{\s*display: none;/,
  );
  assert.match(
    body(
      "html[data-ls-fx='off'] [data-ui='v2'] .ls-brand-track, html[data-ls-motion='reduced'] [data-ui='v2'] .ls-brand-track",
    ),
    /animation:\s*none/,
  );
  assert.match(
    css,
    /prefers-reduced-motion: reduce\) \{[\s\S]*?\[data-ui='v2'\] \.ls-brand-track \{[^}]*animation:\s*none/,
  );
  assert.match(
    css,
    /\.ls-brand-set\[aria-hidden='true'\],\s*\[data-ui='v2'\] \.ls-brand-item\[aria-hidden='true'\] \{\s*display: none;/,
  );
});
