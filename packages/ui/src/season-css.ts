import type { SeasonAccentTokens, SeasonPreset } from '@lucy-spa/contracts';

// Builds season.css from the contracts registry (docs/UXUI_REDESIGN_DESIGN.md 20.2). `pnpm season:css` writes the
// file; season-css.test.ts fails when the committed file is out of date. Selectors are scopable: a preset applies to
// any element carrying `data-season`, so `<html>` (public site) and a preview frame (admin) share one source. The app is
// light only (Owner, 2026-10-18): one palette per preset, no dark set.

export const SEASON_CSS_HEADER =
  '/* Generated from packages/contracts/src/season-registry.ts by `pnpm season:css`. Do not edit by hand. */';

/** `panelText` -> `--ls-art-panel-text`: the S6 art colors of a preset, one custom property each. */
export const artToken = (key: string): string =>
  `--ls-art-${key.replace(/[A-Z0-9]/g, (char) => `-${char.toLowerCase()}`)}`;

function accentLines(
  tokens: SeasonAccentTokens,
  ornament: readonly string[],
  art: Readonly<Record<string, string>> = {},
): string[] {
  return [
    `--ls-season-accent: ${tokens.accent};`,
    `--ls-season-accent-soft: ${tokens.accentSoft};`,
    `--ls-season-on-accent: ${tokens.onAccent};`,
    `--ls-season-frame-from: ${tokens.frameFrom};`,
    `--ls-season-frame-to: ${tokens.frameTo};`,
    `--ls-season-frame-text: ${tokens.frameText};`,
    ...ornament.map((value, index) => `--ls-season-ornament-${index + 1}: ${value};`),
    ...Object.entries(art).map(([key, value]) => `${artToken(key)}: ${value};`),
  ];
}

function rule(selectors: string[], lines: string[], indent = ''): string {
  const body = lines.map((line) => `${indent}  ${line}`).join('\n');
  return `${indent}${selectors.join(`,\n${indent}`)} {\n${body}\n${indent}}`;
}

export function buildSeasonCss(presets: readonly SeasonPreset[]): string {
  const blocks = presets.map((preset) => {
    const scope = `[data-season='${preset.key}']`;
    return [
      `/* ${preset.key}: ${preset.name.en} */`,
      rule(
        [scope],
        [
          ...accentLines(preset.light, preset.ornament.light, preset.art?.light),
          '--ls-season-line: var(--ls-season-accent);',
        ],
      ),
    ].join('\n');
  });
  const off = rule(
    ["[data-season-admin='off']", "[data-season][data-season-admin='off']"],
    ['--ls-season-line: transparent;'],
  );
  return [
    SEASON_CSS_HEADER,
    ...blocks,
    `/* Admin opt-out (apply_admin = false, wired in S5): no accent line. */\n${off}`,
    '',
  ].join('\n\n');
}
