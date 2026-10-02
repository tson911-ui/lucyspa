import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// season-art.css (docs/UXUI_REDESIGN_S6_PLAN.md section 3): tokens only, transform and opacity only, never
// interactive, particles behind the content, quiet under reduced motion.
const css = readFileSync(new URL('./season-art.css', import.meta.url), 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

function rules(source: string): Array<{ selector: string; body: string }> {
  return [...source.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim().replace(/\s+/g, ' '),
    body: match[2]!,
  }));
}
const ruleFor = (selector: string) =>
  rules(code).filter((rule) => rule.selector.split(/,\s*/).some((part) => part === selector));

test('no hex color, no gold, no px/rem/em length: colors and spacing come from tokens', () => {
  assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /gold|ivory/i);
  const withoutMedia = code.replace(/@media[^{]*\{/g, '');
  assert.doesNotMatch(withoutMedia, /(^|[\s(,+\-*/])-?\d*\.?\d+(px|rem|em)\b/);
});

test('keyframes animate only transform and opacity', () => {
  const frames = [...code.matchAll(/@keyframes ([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
  assert.equal(
    frames.length,
    2,
    'a fall and a rise animation (the spin is shared with season-decor.css)',
  );
  for (const [, name, body] of frames) {
    for (const { body: declarations } of rules(body!)) {
      for (const property of declarations.matchAll(/([\w-]+)\s*:/g)) {
        assert.ok(
          ['transform', 'opacity'].includes(property[1]!),
          `${name} animates ${property[1]}`,
        );
      }
    }
  }
});

test('drawings and particles never take pointer events', () => {
  for (const selector of ['.ls-art', '.ls-art-row', '.ls-fx-site', '.ls-art-logo-art']) {
    assert.ok(
      ruleFor(selector).some(({ body }) => /pointer-events:\s*none/.test(body)),
      `${selector} has pointer-events: none`,
    );
  }
});

test('particles sit behind the content and are masked, the content sits above them', () => {
  const layer = ruleFor('.ls-fx-site').find(({ body }) => /z-index/.test(body))!;
  assert.match(layer.body, /z-index:\s*0/);
  assert.match(layer.body, /position:\s*absolute/);
  assert.match(layer.body, /inset:\s*0/);
  assert.match(layer.body, /mask-size:\s*100% 100%/);
  const content = ruleFor('.ls-site-page > :not(.ls-fx-site)')[0]!;
  assert.match(content.body, /z-index:\s*1/);
  assert.match(content.body, /position:\s*relative/);
  assert.match(ruleFor('.ls-site-page')[0]!.body, /isolation:\s*isolate/);
});

test('particles pause with the tab and stop under reduced motion', () => {
  assert.match(
    code,
    /\.ls-fx-site\[data-paused='true'\][^{]*\{[^}]*animation-play-state:\s*paused/,
  );
  assert.match(code, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
});

test('the soft tint is two radial washes on the page wrapper, not on body (admin is untouched)', () => {
  const wrapper = ruleFor('.ls-site-page')[0]!;
  assert.equal((wrapper.body.match(/radial-gradient\(/g) ?? []).length, 2);
  assert.match(wrapper.body, /--ls-art-tint-1/);
  assert.match(wrapper.body, /--ls-art-tint-2/);
  assert.doesNotMatch(code, /(^|\n)\s*(body|html)\b/);
});

test('the footer greeting is text on a panel: panel text on the panel color', () => {
  const plaque = ruleFor('.ls-art-plaque')[0]!;
  assert.match(plaque.body, /color:\s*var\(--ls-art-panel-text\)/);
  const card = ruleFor(".ls-art-plaque[data-plaque='card']")[0]!;
  assert.match(card.body, /background:\s*var\(--ls-art-panel\)/);
});

test('the phone block drops pieces and shrinks art but never text', () => {
  const phone = code.slice(code.indexOf('@media (max-width: 760px)'));
  assert.match(phone, /\.ls-art-hide-narrow/);
  assert.match(phone, /\.ls-art-lights-wide/);
  assert.match(phone, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  // The only text size it changes is the footer plaque line (one step down); nothing else resizes text.
  assert.doesNotMatch(phone.replace(/[^{}]*plaque-line[^{}]*{[^}]*}/g, ''), /font-size/);
  // The only text size it changes is the plaque line (one step down); controls keep their height.
  assert.doesNotMatch(phone, /min-height|--ls-control-h/);
});

test('the strip keeps the effects switch inside it at the trailing edge, 40/44 px control height', () => {
  assert.match(ruleFor('.ls-art-strip-tools')[0]!.body, /justify-self:\s*end/);
  assert.match(ruleFor('.ls-art-fx-switch')[0]!.body, /min-height:\s*var\(--ls-control-h\)/);
  assert.match(ruleFor('.ls-art-strip')[0]!.body, /min-height:\s*var\(--ls-control-h\)/);
});

test('only season, art, spacing, text, radius, motion, control, border and display-font tokens are read', () => {
  const used = new Set([...code.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!));
  for (const name of used) {
    assert.match(
      name,
      /^--(ls-(season-|art-|space-|text-|radius-|dur-|fx-)|ls-control-h$|ls-border$|lucy-font-display$)/,
      `${name} is not an allowed token`,
    );
  }
  assert.doesNotMatch(code, /--ls-season-(accent|line)/, 'the kit reads frame tokens only');
});

test('Christmas keeps its snow out of the header art band: the layer is clipped by the header row height', () => {
  const clip = ruleFor("[data-clear-top='true']".replace(/^/, '.ls-fx-site'))[0]!;
  assert.match(clip.body, /clip-path:\s*inset\(var\(--ls-art-header-h\) 0 0 0\)/);
});
