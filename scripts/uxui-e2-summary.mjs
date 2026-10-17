// E2 summary (session 10): reads .local/s10/e2/<phase>/<area>/*.json written by scripts/uxui-capture.py and prints
//   - per area: failures per metric (all modes), pages with failures, unmeasured/truncated pages;
//   - per page (with --pages): failures per metric and mode plus the first examples.
// node scripts/uxui-e2-summary.mjs <phase> [--pages] [--json out.json] [--compare <phase>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const phase = args[0];
const perPage = args.includes('--pages');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const compare = args.includes('--compare') ? args[args.indexOf('--compare') + 1] : null;
const root = '.local/s10/e2';

const luminance = (c) =>
  c
    .map((x) => {
      const v = x / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function load(ph) {
  const areas = {};
  for (const area of ['customer', 'staff']) {
    const dir = join(root, ph, area);
    if (!existsSync(dir)) continue;
    const pages = {};
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      pages[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    }
    areas[area] = pages;
  }
  return areas;
}
const staffArea = (() => {
  try {
    const list = JSON.parse(readFileSync('scripts/uxui-staff-pages.json', 'utf8')).pages;
    return Object.fromEntries(list.map((p) => [p.name, p.area]));
  } catch {
    return {};
  }
})();

function summarize(areas) {
  const out = {};
  for (const [area, pages] of Object.entries(areas)) {
    for (const [name, r] of Object.entries(pages)) {
      const key = area === 'customer' ? 'customer' : (staffArea[name] ?? 'admin');
      const s = (out[key] ||= {
        pages: 0,
        failingPages: 0,
        metrics: {},
        unmeasured: [],
        truncated: [],
        contrastUnmeasured: 0,
      });
      s.pages++;
      if (r.skipped) {
        s.unmeasured.push(`${name}: ${r.skipped}`);
        continue;
      }
      let failing = false;
      for (const [mode, m] of Object.entries(r.modes || {})) {
        if (m.error) {
          s.unmeasured.push(`${name} ${mode}: ${m.error}`);
          continue;
        }
        s.contrastUnmeasured += (m.report?.contrastUnmeasured || []).length;
        if (m.truncated && m.truncated.length)
          s.truncated.push(`${name} ${mode}: ${m.truncated.join('; ')}`);
        // secondary-filled: only a hover background that stands out from the page (contrast >= 2:1) is a fill; the A4 hover tint
        // (burgundy 3 / grey 3) is not. Recomputed here so every phase, older ones included, uses the same definition.
        if (m.metrics?.['secondary-filled']) {
          const page = mode.startsWith('dark') ? [0, 0, 0] : [255, 255, 255];
          const kept = m.metrics['secondary-filled'].filter((item) => {
            const rgb = String(item).match(/hover bg rgba?\((\d+), (\d+), (\d+)/);
            return !rgb || contrast([+rgb[1], +rgb[2], +rgb[3]], page) >= 2;
          });
          m.metrics['secondary-filled'] = kept;
          m.summary['secondary-filled'] = kept.length;
        }
        for (const [k, v] of Object.entries(m.summary || {})) {
          s.metrics[k] = (s.metrics[k] || 0) + v;
          if (v) failing = true;
        }
      }
      if (failing) s.failingPages++;
    }
  }
  return out;
}

const now = load(phase);
const sum = summarize(now);
const before = compare ? summarize(load(compare)) : null;
const metrics = [
  'overflow-x',
  'overlap',
  'sticky-cover',
  'double-border',
  'card-heights',
  'grid-misaligned',
  'clipped-text',
  'font-size',
  'font-weight',
  'contrast',
  'hit-target',
  'hover-missing',
  'pressed-missing',
  'secondary-filled',
  'pink-dark',
  'brand-text',
  'non-radix',
  'shadow-gradient',
  'transition-all',
  'console-errors',
  // Added at Step 4 for the Owner's answers 1 and 2 (no baseline value: the baseline script did not measure them).
  'focus-ring',
  'filled-per-view',
];
for (const [area, s] of Object.entries(sum)) {
  console.log(
    `\n## ${area}: ${s.pages} pages, ${s.failingPages} with failures, ${s.unmeasured.length} unmeasured, ${s.truncated.length} truncated`,
  );
  console.log(`| metric | ${compare ? compare + ' | ' : ''}${phase} |`);
  console.log(`| --- | ${compare ? '---: | ' : ''}---: |`);
  for (const k of metrics) {
    const b = before?.[area]?.metrics[k] ?? 0;
    console.log(`| ${k} | ${compare ? b + ' | ' : ''}${s.metrics[k] || 0} |`);
  }
  console.log();
  console.log(
    `- contrast pairs over a gradient or an image (not measurable; never counted as a pass): ${s.contrastUnmeasured}`,
  );
  for (const u of s.unmeasured) console.log(`- unmeasured: ${u}`);
  for (const t of s.truncated.slice(0, 10)) console.log(`- truncated: ${t}`);
}
if (perPage) {
  for (const [area, pages] of Object.entries(now)) {
    for (const [name, r] of Object.entries(pages)) {
      if (r.skipped) continue;
      console.log(`\n### ${area}/${name}`);
      const byMetric = {};
      for (const [mode, m] of Object.entries(r.modes || {})) {
        for (const [k, v] of Object.entries(m.summary || {}))
          (byMetric[k] ||= []).push(`${mode}:${v}`);
      }
      for (const [k, list] of Object.entries(byMetric)) {
        const first = Object.values(r.modes).find((m) => m.metrics?.[k]?.length)?.metrics[k][0];
        console.log(`- ${k} [${list.join(' ')}] e.g. ${JSON.stringify(first ?? '').slice(0, 160)}`);
      }
    }
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(sum, null, 1));
