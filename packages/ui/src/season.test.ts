import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  SEASON_GREETING_MAX_LENGTH,
  SEASON_PRESETS,
  SEASON_PRESET_KEYS,
  type SeasonAccentTokens,
  type SeasonPreset,
} from '@lucy-spa/contracts';
import { buildSeasonCss } from './season-css';

// Season layer (docs/UXUI_REDESIGN_DESIGN.md 20.1-20.3, 20.9; Owner decisions in 20.10). Registry data, generated CSS,
// neutral defaults, contrast for presets x themes, and the scoped yellow exception (Q-S1).
const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
const tokensCss = read('./tokens.css');
const seasonCss = read('./season.css');

function declarations(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.replace(/\s+/g, ' ').trim();
  }
  return tokens;
}

/** The declarations of the first rule whose selector list contains `selector`. */
function block(css: string, selector: RegExp): Record<string, string> {
  const match = selector.exec(css);
  assert.ok(match, `missing block ${selector}`);
  const open = css.indexOf('{', match.index);
  let depth = 1;
  let index = open + 1;
  while (depth > 0 && index < css.length) {
    const char = css[index++];
    if (char === '{') depth++;
    if (char === '}') depth--;
  }
  return declarations(css.slice(open + 1, index - 1));
}

const light = block(tokensCss, /^:root\s*\{/m);
const dark = block(tokensCss, /^:root\[data-theme=['"]dark['"]\]\s*\{/m);
const themes = { light, dark } as const;

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees, saturation and value (HSV), all from a 6-digit hex. */
function hsv(hex: string): { hue: number; saturation: number; value: number } {
  const [r, g, b] = rgb(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return { hue: (hue * 60 + 360) % 360, saturation: max === 0 ? 0 : delta / max, value: max };
}

/** Yellow/gold hue range; the check the Q-S1 exception is measured against. */
function isGoldHue(hex: string): boolean {
  const { hue, saturation, value } = hsv(hex);
  return hue >= 35 && hue <= 70 && saturation >= 0.35 && value >= 0.55;
}

const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const HEX = /^#[0-9a-f]{6}$/;
const tokenColor = (theme: Record<string, string>, name: string): string => {
  const value = theme[`--ls-${name}`];
  assert.match(value ?? '', HEX, `--ls-${name} must be a 6-digit hex`);
  return value!;
};
const accentValues = (tokens: SeasonAccentTokens): string[] => Object.values(tokens);
// The scoped yellow exception (Q-S1, extended 2026-10-02): ornaments of these four presets only.
const GOLD_ORNAMENT_PRESETS = ['tet', 'mid-autumn', 'reunification-labour', 'national-day'];
const FLAG_DAY_PRESETS = ['reunification-labour', 'national-day'];

test('the registry is exactly the eight approved presets, in order, with unique keys', () => {
  assert.deepEqual(
    SEASON_PRESETS.map((preset) => preset.key),
    [...SEASON_PRESET_KEYS],
  );
  assert.equal(new Set(SEASON_PRESET_KEYS).size, 8);
});

test('every preset has names, greetings up to 80 characters, hex colors and a valid suggested window', () => {
  for (const preset of SEASON_PRESETS) {
    for (const text of [preset.name.vi, preset.name.en, preset.greeting.vi, preset.greeting.en]) {
      assert.ok(text.trim().length > 0, `${preset.key}: empty text`);
    }
    for (const greeting of [preset.greeting.vi, preset.greeting.en]) {
      assert.ok(
        [...greeting].length <= SEASON_GREETING_MAX_LENGTH,
        `${preset.key}: greeting longer than ${SEASON_GREETING_MAX_LENGTH}`,
      );
      assert.doesNotMatch(greeting, /[<>]/, `${preset.key}: greeting is plain text`);
    }
    for (const value of [
      ...accentValues(preset.light),
      ...accentValues(preset.dark),
      ...preset.ornament.light,
      ...preset.ornament.dark,
    ]) {
      assert.match(value, HEX, `${preset.key}: ${value}`);
    }
    assert.match(preset.ornament.id, /^[a-z-]+$/);
    const window = preset.suggestedWindow;
    if (!window) continue;
    for (const { month, day } of [window.start, window.end]) {
      assert.ok(month >= 1 && month <= 12 && day >= 1 && day <= 31, `${preset.key}: date`);
    }
  }
});

test('lunar holidays have no suggested window; every solar holiday has one', () => {
  for (const preset of SEASON_PRESETS) {
    const lunar = preset.key === 'tet' || preset.key === 'mid-autumn';
    assert.equal(preset.suggestedWindow === null, lunar, preset.key);
  }
  const christmas = SEASON_PRESETS.find((preset) => preset.key === 'christmas')!;
  assert.deepEqual(christmas.suggestedWindow, {
    start: { month: 12, day: 15 },
    end: { month: 12, day: 26 },
  });
});

for (const [themeName, theme] of Object.entries(themes) as [
  'light' | 'dark',
  Record<string, string>,
][]) {
  test(`${themeName}: every preset passes the contrast rules on every surface (20.3)`, () => {
    const surfaces = ['bg-page', 'bg-surface', 'bg-raised', 'bg-sunken'].map((name) =>
      tokenColor(theme, name),
    );
    for (const preset of SEASON_PRESETS) {
      const tokens = preset[themeName];
      for (const surface of surfaces) {
        const value = ratio(tokens.accent, surface);
        assert.ok(value >= 4.5, `${preset.key} accent on ${surface} = ${value.toFixed(2)}`);
      }
      assert.ok(ratio(tokens.accent, tokens.accentSoft) >= 4.5, `${preset.key} accent on soft`);
      assert.ok(ratio(tokens.onAccent, tokens.accent) >= 4.5, `${preset.key} on-accent on accent`);
      for (const stop of [tokens.frameFrom, tokens.frameTo]) {
        const value = ratio(tokens.frameText, stop);
        assert.ok(value >= 4.5, `${preset.key} frame text on ${stop} = ${value.toFixed(2)}`);
      }
      // Accent as a UI boundary against the surfaces it borders.
      for (const surface of [surfaces[0]!, surfaces[1]!, surfaces[3]!]) {
        assert.ok(
          ratio(tokens.accent, surface) >= 3,
          `${preset.key} accent boundary on ${surface}`,
        );
      }
    }
  });
}

test('accent and frame colors are never yellow or gold; yellow ornaments exist only for Tet, Mid-Autumn, 30/4-1/5 and 2/9 (Q-S1)', () => {
  for (const preset of SEASON_PRESETS) {
    for (const value of [...accentValues(preset.light), ...accentValues(preset.dark)]) {
      assert.equal(isGoldHue(value), false, `${preset.key}: ${value} is a gold-hue accent token`);
    }
    const ornaments = [...preset.ornament.light, ...preset.ornament.dark];
    const gold = ornaments.filter(isGoldHue);
    if (GOLD_ORNAMENT_PRESETS.includes(preset.key)) {
      assert.ok(gold.length > 0, `${preset.key} keeps its warm ornament color in both themes`);
      assert.ok(isGoldHue(preset.ornament.light[0]) && isGoldHue(preset.ornament.dark[0]));
    } else {
      assert.deepEqual(gold, [], `${preset.key}: no gold-hue ornament allowed`);
    }
  }
});

test('flag-day presets: a brighter red banner with a solid yellow star, while accent and line stay rose apart from danger red (20.3)', () => {
  for (const key of FLAG_DAY_PRESETS) {
    const preset: SeasonPreset = SEASON_PRESETS.find((candidate) => candidate.key === key)!;
    for (const [themeName, theme] of Object.entries(themes)) {
      const tokens = preset[themeName as 'light' | 'dark'];
      // The accent (text, boundary, admin line) is never confusable with the danger status color.
      const danger = hsv(tokenColor(theme, 'danger')).hue;
      const accent = hsv(tokens.accent).hue;
      assert.ok(
        hueGap(accent, danger) >= 20,
        `${key} ${themeName}: accent hue ${accent} vs danger ${danger}`,
      );
      // The banner is decoration: red, and brighter than the brand red in light (the brand fill is #782b37).
      for (const stop of [tokens.frameFrom, tokens.frameTo]) {
        const { hue, saturation } = hsv(stop);
        assert.ok(
          hueGap(hue, 355) <= 12 && saturation >= 0.6,
          `${key} ${themeName}: ${stop} is red`,
        );
      }
      if (themeName === 'light') {
        assert.ok(
          luminance(tokens.frameFrom) > luminance(tokenColor(theme, 'brand-fill')),
          `${key}: the light banner is brighter than the brand red`,
        );
      }
    }
    // A solid yellow star: the first ornament color is yellow in both themes.
    assert.ok(isGoldHue(preset.ornament.light[0]) && isGoldHue(preset.ornament.dark[0]), key);
  }
});

test('season.css is generated from the registry (fails when stale; run pnpm season:css)', () => {
  const squash = (css: string): string => css.replace(/\s+/g, '');
  assert.equal(squash(seasonCss), squash(buildSeasonCss(SEASON_PRESETS)));
});

test('every preset has scopable light, dark-toggle and dark-system blocks, and the two dark blocks are identical', () => {
  for (const preset of SEASON_PRESETS) {
    const scope = `[data-season='${preset.key}']`;
    const escaped = scope.replace(/[[\]'.]/g, '\\$&');
    const lightBlock = block(seasonCss, new RegExp(`^${escaped}\\s*\\{`, 'm'));
    const darkToggle = block(
      seasonCss,
      new RegExp(`^:root\\[data-theme='dark'\\] ${escaped}`, 'm'),
    );
    const darkSystem = block(
      seasonCss,
      new RegExp(`^\\s*:root:not\\(\\[data-theme='light'\\]\\) ${escaped}`, 'm'),
    );
    assert.deepEqual(darkSystem, darkToggle, `${preset.key}: dark blocks differ`);
    assert.equal(lightBlock['--ls-season-accent'], preset.light.accent);
    assert.equal(darkToggle['--ls-season-accent'], preset.dark.accent);
    assert.equal(lightBlock['--ls-season-line'], 'var(--ls-season-accent)');
    assert.equal(
      '--ls-season-line' in darkToggle,
      false,
      `${preset.key}: the line follows the accent, so the dark block does not redeclare it`,
    );
    // The selector also attaches to the element that carries data-season itself (public <html>).
    assert.match(seasonCss, new RegExp(`:root\\[data-theme='dark'\\]${escaped}`));
    assert.match(seasonCss, new RegExp(`:root:not\\(\\[data-theme='light'\\]\\)${escaped}`));
  }
  assert.match(seasonCss, /\[data-season\]\[data-season-admin='off'\]/);
});

test('neutral defaults equal the brand, so nothing changes without data-season', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(light).filter(([name]) => name.startsWith('--ls-season-'))),
    {
      '--ls-season-accent': 'var(--ls-brand)',
      '--ls-season-accent-soft': 'var(--ls-brand-soft)',
      '--ls-season-on-accent': 'var(--ls-on-brand)',
      '--ls-season-frame-from': 'var(--ls-brand-fill)',
      '--ls-season-frame-to': 'var(--ls-brand-fill-hover)',
      '--ls-season-frame-text': 'var(--ls-on-brand)',
      '--ls-season-ornament-1': 'var(--ls-brand)',
      '--ls-season-ornament-2': 'var(--ls-brand-soft)',
      '--ls-season-ornament-3': 'var(--ls-brand-fill-hover)',
      '--ls-season-line': 'transparent',
      '--ls-season-line-w': '2px',
    },
  );
  // The dark blocks inherit those references (they resolve to the dark brand values), so they declare none.
  assert.deepEqual(
    Object.keys(dark).filter((name) => name.startsWith('--ls-season-')),
    [],
  );
  assert.ok(
    tokensCss.indexOf('--ls-season-accent:') < tokensCss.indexOf("[data-theme='dark']"),
    'defaults are declared before season.css overrides them',
  );
});

test('only the admin topbar reads a season token outside season components (20.5)', () => {
  const shell = read('./shell.css');
  const lineRule =
    /\.ls-topbar \{[^}]*box-shadow: 0 var\(--ls-season-line-w\) 0 0 var\(--ls-season-line\);/;
  assert.match(shell, lineRule);
  const stripped = shell.replace(lineRule, '');
  for (const name of ['./components.css', './base.css', './shell.css']) {
    const css = name === './shell.css' ? stripped : read(name);
    assert.doesNotMatch(css, /--ls-season-/, `${name} must not read season tokens`);
  }
});
