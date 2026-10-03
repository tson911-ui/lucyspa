// Static ratchet for the legacy UI patterns that Steps 7.5-10 retire (docs/UXUI_REDESIGN_DESIGN.md section 21.5).
// Each counter is pinned in ui-ratchet-baseline.json. A counter may only go down: going up fails the test (a new
// legacy pattern was added), going down also fails until the baseline is lowered (run with UPDATE_RATCHET=1, which
// refuses to raise a value), so every improvement is locked in. The closing Step of each migration group sets its counters to 0.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const webSrc = join(here, '..');
const repo = join(here, '..', '..', '..', '..');
const baselinePath = join(here, 'ui-ratchet-baseline.json');

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, accept));
    else if (accept(path)) out.push(path);
  }
  return out;
}

const screens = walk(
  webSrc,
  (file) =>
    /\.tsx$/.test(file) && !/\.test\.tsx$/.test(file) && !file.includes(`${join(webSrc, 'test')}`),
);
const source = new Map(screens.map((file) => [file, readFileSync(file, 'utf8')]));

function countIn(files: Iterable<string>, pattern: RegExp): Map<string, number> {
  const result = new Map<string, number>();
  for (const file of files) {
    const hits = (source.get(file) ?? readFileSync(file, 'utf8')).match(pattern)?.length ?? 0;
    if (hits) result.set(relative(repo, file).replaceAll('\\', '/'), hits);
  }
  return result;
}

const SPACING =
  /^\s*(margin|padding|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block)(-(start|end))?)?\s*:([^;]*);/;
const LITERAL = /(^|[\s(,+\-*/])-?\d*\.?\d+(px|rem|em)\b/;

/** Spacing declarations that use a px/rem/em literal instead of a --ls-space-* token (var(...) arguments are ignored). */
function spacingLiterals(relativePath: string): Map<string, number> {
  const file = join(repo, relativePath);
  if (!existsSync(file)) return new Map();
  let hits = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = SPACING.exec(line);
    if (!match) continue;
    const value = (match[6] ?? '').replace(/var\([^)]*\)/g, 'var');
    if (LITERAL.test(value)) hits += 1;
  }
  return hits ? new Map([[relativePath, hits]]) : new Map();
}

const metrics: Record<string, Map<string, number>> = {
  rawTables: countIn(screens, /<table\b/g),
  wfClassUses: countIn(screens, /\bwf-[a-z0-9-]+/g),
  detailsDisclosures: countIn(screens, /<details\b/g),
  nativeFieldsets: countIn(screens, /<fieldset\b/g),
  nativeCheckboxes: countIn(screens, /type=["']checkbox["']/g),
  // Solid danger is allowed only inside a confirmation dialog (confirm-delete.tsx is one).
  solidDangerButtons: countIn(
    screens.filter((file) => !/confirm-delete\.tsx$/.test(file)),
    /variant=["']danger["']|wf-button-danger/g,
  ),
  workforceCssSpacingLiterals: spacingLiterals('apps/web/src/app/workforce.css'),
  seasonDecorCssSpacingLiterals: spacingLiterals('packages/ui/src/season-decor.css'),
  seasonArtCssSpacingLiterals: spacingLiterals('packages/ui/src/season-art.css'),
  componentsCssSpacingLiterals: spacingLiterals('packages/ui/src/components.css'),
  shellCssSpacingLiterals: spacingLiterals('packages/ui/src/shell.css'),
  siteCssSpacingLiterals: spacingLiterals('packages/ui/src/site.css'),
};
const total = (map: Map<string, number>) =>
  [...map.values()].reduce((sum, value) => sum + value, 0);
const current = Object.fromEntries(
  Object.entries(metrics).map(([name, map]) => [name, total(map)]),
);

test('legacy UI pattern counters only go down (ui-ratchet-baseline.json)', () => {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>;
  const problems: string[] = [];
  const lowered: Record<string, number> = { ...baseline };
  for (const [name, value] of Object.entries(current)) {
    const pinned = baseline[name];
    if (pinned === undefined) {
      problems.push(`${name}: no baseline (current ${value}); add it to ui-ratchet-baseline.json`);
    } else if (value > pinned) {
      const files = [...(metrics[name] ?? [])].map(([file, n]) => `${file}:${n}`).join(', ');
      problems.push(
        `${name}: ${value} > baseline ${pinned}. A retired pattern was added back (${files}). Use the kit component instead.`,
      );
    } else if (value < pinned) {
      lowered[name] = value;
      problems.push(
        `${name}: ${value} < baseline ${pinned}. Good: lower it in ui-ratchet-baseline.json (UPDATE_RATCHET=1) in the same Step.`,
      );
    }
  }
  if (
    process.env.UPDATE_RATCHET === '1' &&
    problems.every((problem) => problem.includes('Good: lower it'))
  ) {
    writeFileSync(baselinePath, `${JSON.stringify(lowered, null, 2)}\n`);
    return;
  }
  assert.deepEqual(problems, []);
});
