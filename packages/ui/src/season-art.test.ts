import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SEASON_PRESETS, ZODIAC_KEYS, type SeasonPreset } from '@lucy-spa/contracts';
import { artToken, buildSeasonCss } from './season-css';
import { ZODIAC_ART } from './season-art-tet';
import { SEASON_ART_KITS, hasZodiacArt, isSeasonArtKit } from './season-scene';

// The site-wide art palettes (docs/UXUI_REDESIGN_S6_PLAN.md sections 3 and 4): each kit's colors come from the
// registry as `--ls-art-*` tokens, every color the art reads exists, yellow stays inside the Q-S1 presets, and text on
// a panel is readable in light and dark.
const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
const withArt = SEASON_PRESETS.filter(
  (preset): preset is SeasonPreset & Required<Pick<SeasonPreset, 'art'>> => Boolean(preset.art),
);
const seasonCss = read('./season.css');

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
function isGoldHue(hex: string): boolean {
  const [r, g, b] = channels(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return false;
  const sector =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  const hue = (sector * 60 + 360) % 360;
  return hue >= 35 && hue <= 70 && delta / max >= 0.35 && max >= 0.55;
}

const ALL_KITS = [
  'tet',
  'christmas',
  'valentine',
  'womens-day',
  'vn-womens-day',
  'mid-autumn',
  'reunification-labour',
  'national-day',
  'vu-lan',
  'celebration',
];

test('all ten kits have site art; the registry and the scene agree on the kits', () => {
  assert.deepEqual(
    withArt.map((preset) => preset.key),
    ALL_KITS,
  );
  assert.deepEqual([...SEASON_ART_KITS], ALL_KITS);
  assert.equal(isSeasonArtKit('tet'), true);
  assert.equal(isSeasonArtKit('vu-lan'), true);
  assert.equal(isSeasonArtKit('not-a-kit'), false);
  assert.equal(isSeasonArtKit(null), false);
});

test('light and dark define the same names, all 6-digit hex', () => {
  for (const preset of withArt) {
    assert.deepEqual(
      Object.keys(preset.art.light).sort(),
      Object.keys(preset.art.dark).sort(),
      preset.key,
    );
    for (const value of [...Object.values(preset.art.light), ...Object.values(preset.art.dark)]) {
      assert.match(value, /^#[0-9a-f]{6}$/i, `${preset.key}: ${value}`);
    }
  }
});

test('every color the art reads is defined by its kit, and none is left unused', () => {
  const sources: Record<string, string[]> = {
    tet: ['./season-art-tet.tsx', './season-scene.tsx'],
    christmas: ['./season-art-christmas.tsx', './season-scene.tsx'],
    celebration: ['./season-art-celebration.tsx', './season-scene.tsx'],
    valentine: ['./season-art-valentine.tsx', './season-art-shapes.tsx', './season-scene.tsx'],
    'womens-day': ['./season-art-women.tsx', './season-art-shapes.tsx', './season-scene.tsx'],
    'vn-womens-day': ['./season-art-women.tsx', './season-art-shapes.tsx', './season-scene.tsx'],
    'mid-autumn': ['./season-art-autumn.tsx', './season-art-shapes.tsx', './season-scene.tsx'],
    'reunification-labour': [
      './season-art-national.tsx',
      './season-art-shapes.tsx',
      './season-scene.tsx',
    ],
    'national-day': ['./season-art-national.tsx', './season-art-shapes.tsx', './season-scene.tsx'],
    'vu-lan': ['./season-art-vulan.tsx', './season-art-shapes.tsx', './season-scene.tsx'],
  };
  for (const preset of withArt) {
    const text = sources[preset.key]!.map(read).join('\n');
    const defined = new Set(Object.keys(preset.art.light));
    const used = new Set<string>();
    for (const match of text.matchAll(/\bart\('(\w+)'\)/g)) used.add(match[1]!);
    for (const match of text.matchAll(/var\(--ls-art-([\w-]+)\)/g)) {
      used.add(match[1]!.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase()));
    }
    // Colors are also passed by name to helpers (`color="bulb1"`, `body="pink"`): a quoted palette key counts.
    for (const name of defined) if (new RegExp(`['"]${name}['"]`).test(text)) used.add(name);
    const ownTokens = [...used].filter((name) => !defined.has(name));
    // The scene file is shared by all kits: names that only another kit defines are fine there.
    const others = withArt.filter((candidate) => candidate.key !== preset.key);
    // `--ls-art-u` is the 4 px unit of the stylesheet, not a color.
    const reallyMissing = ownTokens.filter(
      (name) => !others.some((other) => name in other.art.light) && name !== 'u',
    );
    assert.deepEqual(reallyMissing, [], `${preset.key}: art colors with no token`);
    const unused = [...defined].filter(
      (name) => !used.has(name) && !['panel', 'panelText', 'tint1', 'tint2'].includes(name),
    );
    assert.deepEqual(unused, [], `${preset.key}: palette entries nothing reads`);
  }
});

test('yellow art exists only in the four Q-S1 presets; every other kit, Vu Lan and Celebration included, has none', () => {
  const yellowKits = ['tet', 'mid-autumn', 'reunification-labour', 'national-day'];
  for (const key of yellowKits) {
    const preset = withArt.find((candidate) => candidate.key === key)!;
    assert.ok(Object.values(preset.art.light).some(isGoldHue), `${key} light keeps its yellow`);
    assert.ok(Object.values(preset.art.dark).some(isGoldHue), `${key} dark keeps its yellow`);
  }
  for (const key of ALL_KITS.filter((kit) => !yellowKits.includes(kit))) {
    const preset = withArt.find((candidate) => candidate.key === key)!;
    for (const theme of ['light', 'dark'] as const) {
      assert.deepEqual(
        Object.entries(preset.art[theme]).filter(([, value]) => isGoldHue(value)),
        [],
        `${key} ${theme}: no yellow-hue art color`,
      );
    }
  }
});

test('text on a panel is readable: panel text on panel is at least 4.5:1 in light and dark', () => {
  for (const preset of withArt) {
    for (const theme of ['light', 'dark'] as const) {
      const { panel, panelText } = preset.art[theme] as Record<string, string>;
      const value = ratio(panelText!, panel!);
      assert.ok(value >= 4.5, `${preset.key} ${theme}: ${value.toFixed(2)}`);
    }
  }
});

test('the generated season.css carries every art token in light, dark, the dark preference and the forced preview', () => {
  const squash = (css: string): string => css.replace(/\s+/g, '');
  assert.equal(squash(seasonCss), squash(buildSeasonCss(SEASON_PRESETS)), 'run pnpm season:css');
  for (const preset of withArt) {
    for (const theme of ['light', 'dark'] as const) {
      for (const [key, value] of Object.entries(preset.art[theme])) {
        const line = `${artToken(key)}: ${value};`;
        const count = seasonCss.split(line).length - 1;
        // Light: scope + forced light; dark: toggle + preference + forced dark.
        assert.ok(count >= (theme === 'light' ? 2 : 3), `${preset.key} ${theme} ${line} x${count}`);
      }
    }
  }
  assert.equal(artToken('panelText'), '--ls-art-panel-text');
  assert.equal(artToken('tint1'), '--ls-art-tint-1');
});

test('zodiac art exists only for the goat; every other animal draws nothing, never a wrong one', () => {
  assert.deepEqual(Object.keys(ZODIAC_ART), ['mui']);
  for (const key of ZODIAC_KEYS) assert.equal(hasZodiacArt(key), key === 'mui', key);
  assert.equal(hasZodiacArt(null), false);
  assert.equal(hasZodiacArt('toString'), false, 'prototype names are not animals');
});

test('the Tet zodiac art follows the Tet style rule: red khan, li xi, blossoms, coins, yellow', () => {
  const source = read('./season-art-tet.tsx');
  const goat = source.slice(
    source.indexOf('export function ZodiacGoat'),
    source.indexOf('export const ZODIAC_ART'),
  );
  for (const part of [
    "art('red')",
    '<Envelope',
    '<Blossom kind="peach"',
    '<Blossom kind="mai"',
    '<Coin',
    "art('yellow')",
  ]) {
    assert.ok(goat.includes(part), `the goat needs ${part}`);
  }
});

test('the registry footer lines fit a plaque (short) in both languages', () => {
  for (const preset of withArt) {
    for (const locale of ['vi', 'en'] as const) {
      assert.ok(preset.art.footer.line[locale].length <= 40, `${preset.key} ${locale} line`);
      if (preset.art.footer.sub) assert.ok(preset.art.footer.sub[locale].length <= 60);
    }
  }
});

test('the plaque line avoids letters the Windows display font (Georgia italic) cannot stack: no circumflex with a tone mark', () => {
  // a, e or o with a circumflex (U+0302) and then an acute or grave tone (U+0301, U+0300), in decomposed form, draw
  // their accent detached in Georgia on Windows; the sub line uses the body font and is free of this rule.
  const stacked = /[aeoAEO]̂[̀́]/;
  for (const preset of withArt) {
    for (const locale of ['vi', 'en'] as const) {
      const line = preset.art.footer.line[locale].normalize('NFD');
      assert.doesNotMatch(line, stacked, `${preset.key} ${locale}: ${line}`);
    }
  }
});
