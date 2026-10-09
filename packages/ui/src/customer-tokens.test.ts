import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The customer site's direction-C tokens (docs/CUSTOMER_SITE_C.md): both dark blocks agree, and every text pair the pages draw clears WCAG 2.x AA.
const css = readFileSync(new URL('./customer-tokens.css', import.meta.url), 'utf8');
const base = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function declarations(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.replace(/\s+/g, ' ').trim();
  }
  return tokens;
}

function block(source: string, selector: RegExp): Record<string, string> {
  const match = selector.exec(source);
  assert.ok(match, `missing block ${selector}`);
  let depth = 1;
  let index = match.index + match[0].length;
  const start = index;
  while (depth > 0 && index < source.length) {
    const char = source[index++];
    if (char === '{') depth++;
    if (char === '}') depth--;
  }
  return declarations(source.slice(start, index - 1));
}

const light = block(css, /^\.ls-site\s*\{/m);
const darkAttribute = block(
  css,
  /^:root\[data-theme=['"]dark['"]\]\s*\.ls-site,\s*\[data-preview-theme=['"]dark['"]\]\s*\.ls-site\s*\{/m,
);
const darkSystem = block(css, /:root:not\(\[data-theme=['"]light['"]\]\)\s*\.ls-site\s*\{/m);
// The brand colours come from tokens.css (the customer site keeps them).
const brandLight = block(base, /^:root\s*\{/m)['--ls-brand']!;
const brandDark = block(
  base,
  /^:root\[data-theme=['"]dark['"]\],\s*\[data-preview-theme=['"]dark['"]\]\s*\{/m,
)['--ls-brand']!;

function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const hex = (theme: Record<string, string>, name: string): string => {
  const value = theme[`--ls-${name}`];
  assert.match(value ?? '', /^#[0-9a-f]{6}$/, `--ls-${name} must be a 6-digit hex`);
  return value!;
};

test('the two dark blocks of the customer tokens are identical', () => {
  assert.deepEqual(darkSystem, darkAttribute);
  assert.ok(Object.keys(darkAttribute).length >= 20);
});

test('the dark blocks only override tokens the light block defines', () => {
  for (const name of Object.keys(darkAttribute)) {
    assert.ok(name in light, `${name} has a light value`);
  }
});

const themes = {
  light: { tokens: { ...light }, brand: brandLight },
  dark: { tokens: { ...light, ...darkAttribute }, brand: brandDark },
} as const;

for (const [themeName, { tokens, brand }] of Object.entries(themes)) {
  test(`${themeName}: text and the brand clear 4.5:1 on every surface of the customer pages`, () => {
    const surfaces = ['bg-page', 'bg-surface', 'c-rose', 'c-blush', 'c-sand', 'bg-sunken'];
    for (const surface of surfaces) {
      for (const text of ['text', 'text-muted', 'text-subtle']) {
        assert.ok(
          ratio(hex(tokens, text), hex(tokens, surface)) >= 4.5,
          `${text} on ${surface} ${ratio(hex(tokens, text), hex(tokens, surface)).toFixed(2)}`,
        );
      }
      assert.ok(
        ratio(brand, hex(tokens, surface)) >= 4.5,
        `brand on ${surface} ${ratio(brand, hex(tokens, surface)).toFixed(2)}`,
      );
    }
  });

  test(`${themeName}: the sage card, the footer, the offer ribbon and the photo frames are readable`, () => {
    assert.ok(ratio(hex(tokens, 'c-sage-ink'), hex(tokens, 'c-sage')) >= 4.5, 'sage ink on sage');
    assert.ok(
      ratio(hex(tokens, 'c-footer-text'), hex(tokens, 'c-footer-bg')) >= 4.5,
      'footer text',
    );
    assert.ok(
      ratio(hex(tokens, 'c-footer-muted'), hex(tokens, 'c-footer-bg')) >= 4.5,
      'footer muted text',
    );
    for (const stop of ['c-offer-from', 'c-offer-via', 'c-offer-to']) {
      assert.ok(
        ratio(hex(tokens, 'c-offer-text'), hex(tokens, stop)) >= 4.5,
        `offer text on ${stop}`,
      );
      assert.ok(
        ratio(hex(tokens, 'c-offer-text'), hex(tokens, stop)) >= 4.5,
        `offer muted text on ${stop}`,
      );
    }
    for (const stop of ['c-slot-from', 'c-slot-to']) {
      assert.ok(
        ratio(hex(tokens, 'c-slot-ink'), hex(tokens, stop)) >= 4.5,
        `photo caption on ${stop}`,
      );
    }
  });
}

test('no gold or yellow in the customer tokens (only the holiday layer may have it)', () => {
  assert.doesNotMatch(css, /gold|yellow|amber|ivory/i);
});
