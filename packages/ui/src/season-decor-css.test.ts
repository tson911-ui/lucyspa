import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// season-decor.css (docs/UXUI_REDESIGN_DESIGN.md 20.2): tokens only, transform and opacity only, never interactive,
// quiet under reduced motion.
const css = readFileSync(new URL('./season-decor.css', import.meta.url), 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

function rules(source: string): Array<{ selector: string; body: string }> {
  return [...source.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim(),
    body: match[2]!,
  }));
}

test('no hex color, no gold, no px/rem/em length: colors and spacing come from tokens', () => {
  assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /gold|ivory/i);
  const withoutMedia = code.replace(/@media[^{]*\{/g, '');
  assert.doesNotMatch(withoutMedia, /(^|[\s(,+\-*/])-?\d*\.?\d+(px|rem|em)\b/);
});

test('keyframes animate only transform and opacity', () => {
  const frames = [...code.matchAll(/@keyframes ([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
  assert.ok(frames.length >= 4, 'fall, rise, spin and sway');
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

test('ornaments and particles never take pointer events and never overflow the band', () => {
  const byClass = (name: string) =>
    rules(code).filter(({ selector }) => selector.split(',').some((part) => part.trim() === name));
  for (const name of ['.ls-orn', '.ls-fx']) {
    assert.ok(
      byClass(name).some(({ body }) => /pointer-events:\s*none/.test(body)),
      `${name} has pointer-events: none`,
    );
  }
  assert.ok(byClass('.ls-fx').some(({ body }) => /overflow:\s*hidden/.test(body)));
  assert.ok(byClass('.ls-season-frame').some(({ body }) => /overflow:\s*hidden/.test(body)));
});

test('text sits in its own gutter: ornament columns are fixed and the body can shrink and wrap', () => {
  assert.match(
    code,
    /grid-template-columns:\s*var\(--ls-orn-w\) minmax\(0, 1fr\) var\(--ls-orn-w\)/,
  );
  const body = rules(code).find(({ selector }) => selector === '.ls-season-frame-body')!;
  assert.match(body.body, /min-width:\s*0/);
  assert.match(body.body, /overflow-wrap:\s*anywhere/);
  assert.match(body.body, /z-index:\s*1/);
});

test('particles pause with the tab and stop under reduced motion', () => {
  assert.match(code, /\.ls-fx\[data-paused='true'\][^{]*\{[^}]*animation-play-state:\s*paused/);
  assert.match(code, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
});

test('only season, spacing, text, radius, motion and control tokens are read', () => {
  const used = new Set([...code.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!));
  for (const name of used) {
    assert.match(
      name,
      /^--ls-(season-|space-|text-|radius-|dur-|control-h$|orn-w$|fx-)/,
      `${name} is not an allowed token`,
    );
  }
  assert.doesNotMatch(
    code,
    /--ls-season-(accent|line)/,
    'the kit reads frame and ornament tokens only',
  );
});
