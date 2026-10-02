import type { SeasonAccentTokens, SeasonPreset } from '@lucy-spa/contracts';

// Builds season.css from the contracts registry (docs/UXUI_REDESIGN_DESIGN.md 20.2). `pnpm season:css` writes the
// file; season-css.test.ts fails when the committed file is out of date. Selectors are scopable: a preset applies to
// any element carrying `data-season`, so `<html>` (public site) and a preview frame (admin) share one source. Dark
// values are declared twice, like tokens.css: the explicit toggle and the system preference.

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
    const dark = accentLines(preset.dark, preset.ornament.dark, preset.art?.dark);
    return [
      `/* ${preset.key}: ${preset.name.en} */`,
      // The line follows the accent on the same element, so the dark block recolors it without redeclaring it.
      rule(
        [scope],
        [
          ...accentLines(preset.light, preset.ornament.light, preset.art?.light),
          '--ls-season-line: var(--ls-season-accent);',
        ],
      ),
      rule([`:root[data-theme='dark'] ${scope}`, `:root[data-theme='dark']${scope}`], dark),
      '@media (prefers-color-scheme: dark) {',
      rule(
        [`:root:not([data-theme='light']) ${scope}`, `:root:not([data-theme='light'])${scope}`],
        dark,
        '  ',
      ),
      '}',
    ].join('\n');
  });
  // Forced themes for the admin preview (`data-preview-theme` on the frame or an ancestor, tokens.css). They come last
  // and are as specific as the page-theme rules above, so a forced theme wins over the page theme either way.
  const forced = presets.flatMap((preset) => {
    const scope = `[data-season='${preset.key}']`;
    return (['light', 'dark'] as const).map((theme) =>
      rule(
        [
          `:root [data-preview-theme='${theme}'] ${scope}`,
          `:root [data-preview-theme='${theme}']${scope}`,
        ],
        accentLines(preset[theme], preset.ornament[theme], preset.art?.[theme]),
      ),
    );
  });
  const off = rule(
    ["[data-season-admin='off']", "[data-season][data-season-admin='off']"],
    ['--ls-season-line: transparent;'],
  );
  return [
    SEASON_CSS_HEADER,
    ...blocks,
    `/* Forced light and dark for the admin preview frames. */\n${forced.join('\n')}`,
    `/* Admin opt-out (apply_admin = false, wired in S5): no accent line. */\n${off}`,
    '',
  ].join('\n\n');
}
