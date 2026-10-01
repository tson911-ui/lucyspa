// Summarizes the DOM audit results written by the machine-local capture script (.local/uxui-audit/results/*.json)
// and compares them with a saved baseline (docs/uxui-audit-baseline.json). Section 21.5 of docs/UXUI_REDESIGN_DESIGN.md.
//
//   node scripts/uxui-audit-summary.mjs                         table: findings per page and per type (all runs)
//   node scripts/uxui-audit-summary.mjs --write <file.json>     save counts as a baseline
//   node scripts/uxui-audit-summary.mjs --compare <file.json>   before/after per type and per page
//   node scripts/uxui-audit-summary.mjs --page <name> [--type <type>]   list the findings of one page
//
// A finding is one distinct (type, where, detail) entry of one run (page x width x scheme); `hits` adds the "(xN)" element counts.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const dir = resolve(flag('dir') ?? '.local/uxui-audit/results');
if (!existsSync(dir)) {
  console.error(`No results in ${dir}; run the capture script first.`);
  process.exit(2);
}

const hitsOf = (finding) =>
  Number(/\(x(\d+)\)/.exec(`${finding.where} ${finding.detail}`)?.[1] ?? 1);
const reports = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(resolve(dir, file), 'utf8')))
  .sort((a, b) => a.name.localeCompare(b.name));

/** { page: { run: { type: { rule, n, hits } } } } */
const counts = {};
for (const report of reports) {
  counts[report.name] = {};
  for (const [run, audit] of Object.entries(report.runs)) {
    const byType = {};
    for (const finding of audit?.findings ?? []) {
      const entry = (byType[finding.type] ??= { rule: finding.rule ?? '-', n: 0, hits: 0 });
      entry.n += 1;
      entry.hits += hitsOf(finding);
    }
    counts[report.name][run] = byType;
  }
}

const totals = (data) => {
  const out = {};
  for (const runs of Object.values(data)) {
    for (const byType of Object.values(runs)) {
      for (const [type, { rule, n, hits }] of Object.entries(byType)) {
        const entry = (out[type] ??= { rule, n: 0, hits: 0 });
        entry.n += n;
        entry.hits += hits;
      }
    }
  }
  return out;
};
const pageTotal = (runs) =>
  Object.values(runs).reduce(
    (sum, byType) => sum + Object.values(byType).reduce((s, e) => s + e.n, 0),
    0,
  );

if (flag('page')) {
  const page = flag('page');
  const type = flag('type');
  const report = reports.find((entry) => entry.name === page);
  if (!report) {
    console.error(`Unknown page ${page}`);
    process.exit(2);
  }
  for (const [run, audit] of Object.entries(report.runs)) {
    for (const finding of audit?.findings ?? []) {
      if (type && finding.type !== type) continue;
      console.log(
        `${page} [${run}] ${finding.rule ?? '-'} ${finding.type} ${finding.where} :: ${finding.detail}`,
      );
    }
  }
  process.exit(0);
}

if (flag('write')) {
  const file = resolve(flag('write'));
  const runsPerPage = Math.max(...Object.values(counts).map((runs) => Object.keys(runs).length));
  writeFileSync(
    file,
    `${JSON.stringify({ note: 'DOM audit baseline (scripts/uxui-page-audit.js); regenerate with scripts/uxui-audit-summary.mjs --write', runsPerPage, pages: counts, totals: totals(counts) }, null, 1)}\n`,
  );
  console.log(`baseline written: ${file} (${Object.keys(counts).length} pages)`);
  process.exit(0);
}

const now = totals(counts);
if (flag('compare')) {
  const baseline = JSON.parse(readFileSync(resolve(flag('compare')), 'utf8'));
  console.log(
    'type'.padEnd(26),
    'rule'.padEnd(5),
    'before'.padStart(7),
    'after'.padStart(7),
    'delta'.padStart(7),
    '  hits before -> after',
  );
  for (const type of [...new Set([...Object.keys(baseline.totals), ...Object.keys(now)])].sort()) {
    const before = baseline.totals[type] ?? { rule: now[type]?.rule ?? '-', n: 0, hits: 0 };
    const after = now[type] ?? { n: 0, hits: 0 };
    console.log(
      type.padEnd(26),
      String(before.rule).padEnd(5),
      String(before.n).padStart(7),
      String(after.n).padStart(7),
      String(after.n - before.n).padStart(7),
      `  ${before.hits} -> ${after.hits}`,
    );
  }
  console.log('\npage'.padEnd(24), 'before'.padStart(7), 'after'.padStart(7));
  for (const page of Object.keys(counts))
    console.log(
      page.padEnd(23),
      String(pageTotal(baseline.pages[page] ?? {})).padStart(7),
      String(pageTotal(counts[page])).padStart(7),
    );
  process.exit(0);
}

const types = Object.keys(now).sort();
console.log('type'.padEnd(26), 'rule'.padEnd(5), 'findings'.padStart(9), 'hits'.padStart(7));
for (const type of types)
  console.log(
    type.padEnd(26),
    String(now[type].rule).padEnd(5),
    String(now[type].n).padStart(9),
    String(now[type].hits).padStart(7),
  );
console.log('\npage'.padEnd(24), 'findings (all runs)');
for (const page of Object.keys(counts)) console.log(page.padEnd(23), pageTotal(counts[page]));
