import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CountUp } from './count-up';
import { Stat } from './stat';

// C17 (DESIGN.md 11.4): the pieces of the customer motion pass that can be checked without a browser. The gate, the off switch and the
// reduced-motion state of every page are checked in a real browser (`.local/g7/motion-check.mjs`, see the Step report).

const format = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

test('C17 counter: the final number is in the markup from the start, the counting layer is empty and hidden from readers', () => {
  const html = renderToStaticMarkup(<CountUp value={1250} format={format} />);
  assert.match(html, /<span class="ls-count-final">1\.250<\/span>/);
  assert.match(html, /<span class="ls-count-live" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(html, /data-counting/);
});

test('C17 counter: only a Stat that asks for it counts (staff screens never do)', () => {
  const plain = renderToStaticMarkup(
    <Stat label="Điểm" value={1250} format={{ valueFormat: 'count', locale: 'vi' }} />,
  );
  assert.doesNotMatch(plain, /ls-count/);
  const counting = renderToStaticMarkup(
    <Stat label="Điểm" value={1250} format={{ valueFormat: 'count', locale: 'vi' }} countUp />,
  );
  assert.match(counting, /ls-count-final">1\.250</);
});

test('C17 page change: the shared photo has its own class over the page duration, and reduced motion removes every tween', () => {
  const css = readFileSync(new URL('site.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /::view-transition-group\(\.ls-morph\) \{\s*animation-duration: var\(--ls-dur-slow\);/,
  );
  for (const part of ['group', 'old', 'new']) {
    for (const name of ['ls-page', '.ls-morph']) {
      assert.ok(
        css.includes(`html[data-ls-motion='reduced']::view-transition-${part}(${name})`),
        `${part} of ${name} is cancelled under the gate`,
      );
    }
  }
});

test('C17 motion code holds no literal duration or easing curve outside the tokens', () => {
  for (const file of ['count-up.tsx', 'step-slide.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    assert.doesNotMatch(source, /duration:\s*[\d.]+/, `${file}: duration from a token`);
    assert.match(source, /kit\.duration\('(?:reveal|base)'\)/);
  }
});
