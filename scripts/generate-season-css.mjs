// Generates packages/ui/src/season.css from the contracts registry (docs/UXUI_REDESIGN_DESIGN.md 20.2).
//   pnpm season:css           write the file
//   pnpm season:css --check   fail when the committed file is out of date
// Needs the contracts package built (`pnpm build:server`); runs through tsx for the TypeScript builder.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { SEASON_PRESETS } from '../packages/contracts/dist/index.js';
import { buildSeasonCss } from '../packages/ui/src/season-css.ts';

const target = fileURLToPath(new URL('../packages/ui/src/season.css', import.meta.url));
const config = (await prettier.resolveConfig(target)) ?? {};
const css = await prettier.format(buildSeasonCss(SEASON_PRESETS), { ...config, filepath: target });

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // A missing file is stale.
  }
  if (current !== css) {
    console.error('packages/ui/src/season.css is out of date. Run: pnpm season:css');
    process.exit(1);
  }
  console.log('season.css is up to date');
} else {
  writeFileSync(target, css);
  console.log(`wrote ${target}`);
}
