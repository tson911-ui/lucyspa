import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  SEASON_ORNAMENT_IDS,
  SEASON_PARTICLE_KINDS,
  SEASON_PRESETS,
  type SeasonPresetKey,
} from '@lucy-spa/contracts';

// Registry data the S2 decoration kit relies on (docs/UXUI_REDESIGN_S2_PLAN.md): which motif and which particles each
// preset has (Owner-approved table), and that every ornament color is visible on its own frame.
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

test('each preset has its own motif, and every motif id is used exactly once', () => {
  const ids = SEASON_PRESETS.map((preset) => preset.ornament.id);
  assert.deepEqual([...ids].sort(), [...SEASON_ORNAMENT_IDS].sort());
  assert.equal(new Set(ids).size, 10);
});

test('particles per preset follow the approved table (flag-day presets have none)', () => {
  const expected: Record<SeasonPresetKey, string> = {
    tet: 'petal',
    christmas: 'snow',
    valentine: 'heart',
    'womens-day': 'petal',
    'vn-womens-day': 'petal',
    'mid-autumn': 'lantern',
    'reunification-labour': 'none',
    'national-day': 'none',
    'vu-lan': 'lantern',
    celebration: 'confetti',
  };
  for (const preset of SEASON_PRESETS) {
    assert.equal(preset.ornament.particle, expected[preset.key], preset.key);
    assert.ok((SEASON_PARTICLE_KINDS as readonly string[]).includes(preset.ornament.particle));
  }
});

test('every ornament color is at least 3:1 against both frame stops, in light and dark', () => {
  for (const preset of SEASON_PRESETS) {
    for (const theme of ['light', 'dark'] as const) {
      const { frameFrom, frameTo } = preset[theme];
      for (const color of preset.ornament[theme]) {
        for (const stop of [frameFrom, frameTo]) {
          const value = ratio(color, stop);
          assert.ok(
            value >= 3,
            `${preset.key} ${theme}: ${color} on ${stop} = ${value.toFixed(2)}`,
          );
        }
      }
    }
  }
});

test('the temporary specimen route is never committed', () => {
  const route = new URL('../../../apps/web/src/app/[locale]/season-specimen', import.meta.url);
  assert.equal(existsSync(route), false, 'remove the season-specimen route before committing');
  assert.ok(readFileSync(new URL('./season-decor.css', import.meta.url), 'utf8').length > 0);
});
