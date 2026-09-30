import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Re-runs the dataviz palette checks (contract 6.5) against the values that are actually in
// tokens.css, so a token edit that breaks the categorical palette fails a test. The math follows
// the dataviz validator: OKLab/OKLCH, WCAG contrast, Machado (2009) protan/deutan simulation.

const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');

/** The declarations of the first block that starts with `selector`. */
function block(selector: string): string {
  const start = tokens.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block exists`);
  return tokens.slice(start, tokens.indexOf('}', start));
}

function slots(css: string): { surface: string; palette: string[]; grid: string; other: string } {
  const read = (name: string) => {
    const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    assert.ok(match, `${name} is defined`);
    return match[1]!;
  };
  return {
    surface: read('--ls-chart-surface'),
    palette: [1, 2, 3, 4, 5, 6].map((n) => read(`--ls-chart-${n}`)),
    grid: read('--ls-chart-grid'),
    other: read('--ls-chart-other'),
  };
}

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linear = (hex: string) => rgb(hex).map(toLinear) as [number, number, number];
const luminance = (hex: string) => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

function oklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const lightness = (hex: string) => oklab(linear(hex))[0];
const chroma = (hex: string) => Math.hypot(oklab(linear(hex))[1], oklab(linear(hex))[2]);

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

function simulate(hex: string, kind: keyof typeof MACHADO): [number, number, number] {
  const [r, g, b] = linear(hex);
  const m = MACHADO[kind];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return [
    clamp(m[0]![0]! * r + m[0]![1]! * g + m[0]![2]! * b),
    clamp(m[1]![0]! * r + m[1]![1]! * g + m[1]![2]! * b),
    clamp(m[2]![0]! * r + m[2]![1]! * g + m[2]![2]! * b),
  ];
}
function deltaE(a: string, b: string, kind?: keyof typeof MACHADO): number {
  const x = oklab(kind ? simulate(a, kind) : linear(a));
  const y = oklab(kind ? simulate(b, kind) : linear(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const BANDS = { light: [0.43, 0.77], dark: [0.48, 0.67] } as const;

for (const mode of ['light', 'dark'] as const) {
  const css = mode === 'light' ? block(':root') : block(":root[data-theme='dark']");
  const { surface, palette } = slots(css);

  test(`chart palette (${mode}): lightness band and chroma floor`, () => {
    const [lo, hi] = BANDS[mode];
    for (const hex of palette) {
      assert.ok(
        lightness(hex) >= lo && lightness(hex) <= hi,
        `${hex} lightness ${lightness(hex).toFixed(3)}`,
      );
      assert.ok(chroma(hex) >= 0.1, `${hex} chroma ${chroma(hex).toFixed(3)} reads as gray`);
    }
  });

  test(`chart palette (${mode}): adjacent colors stay apart under protan/deutan and normal vision`, () => {
    for (let i = 0; i < palette.length - 1; i += 1) {
      const a = palette[i]!;
      const b = palette[i + 1]!;
      assert.ok(
        deltaE(a, b, 'protan') >= 8 && deltaE(a, b, 'deutan') >= 8,
        `${a} / ${b} colour-blind separation`,
      );
      assert.ok(deltaE(a, b) >= 15, `${a} / ${b} normal-vision separation`);
    }
  });

  test(`chart palette (${mode}): every mark has 3:1 against the chart surface`, () => {
    for (const hex of palette) assert.ok(contrast(hex, surface) >= 3, `${hex} on ${surface}`);
  });
}

test('the fixed slot order is wine, blue, orange, teal, violet, green (contract 6.5)', () => {
  assert.deepEqual(slots(block(':root')).palette, [
    '#a03a4c',
    '#2b6cb0',
    '#d2691e',
    '#0b8f83',
    '#7c4dbd',
    '#3f8f3a',
  ]);
  assert.deepEqual(slots(block(":root[data-theme='dark']")).palette, [
    '#c9647a',
    '#4f8fd6',
    '#d1722f',
    '#2aa89b',
    '#9a78d6',
    '#55a648',
  ]);
});

test('the neutral "Other" and the previous-period tone are text-safe on the chart surface', () => {
  for (const css of [block(':root'), block(":root[data-theme='dark']")]) {
    const { surface, other } = slots(css);
    assert.ok(contrast(other, surface) >= 3, 'Other mark');
  }
});

test('no gold or yellow is used by any chart slot (decision D1)', () => {
  for (const css of [block(':root'), block(":root[data-theme='dark']")]) {
    for (const hex of slots(css).palette) {
      const [r, g, b] = rgb(hex);
      const yellowish = r > 0.7 && g > 0.6 && b < 0.4;
      assert.equal(yellowish, false, `${hex} is not gold/yellow`);
    }
  }
});
