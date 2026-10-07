// Load probe for the public pages and the public read-only API (Phase 6 P6-7). No dependency: Node's own fetch.
//
//   node scripts/load-public.mjs <url> [--concurrency 32] [--seconds 15] [--warmup 3] [--header "Name: value" ...]
//
// Prints one JSON line: requests per second, latency percentiles (ms) and the count of each HTTP status. A non-2xx answer is
// counted but not retried. Point it at a local or rehearsal stack only; it is a load generator, not a monitor.
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] : fallback;
};
const headers = {};
for (let index = args.indexOf('--header'); index >= 0; index = args.indexOf('--header')) {
  const [name, ...rest] = args.splice(index, 2)[1].split(':');
  headers[name.trim()] = rest.join(':').trim();
}
const concurrency = Number(flag('concurrency', '32'));
const seconds = Number(flag('seconds', '15'));
const warmup = Number(flag('warmup', '3'));
const [target] = args;
if (!target || !URL.canParse(target)) {
  console.error(
    'usage: node scripts/load-public.mjs <url> [--concurrency 32] [--seconds 15] [--warmup 3]',
  );
  process.exit(2);
}

const latencies = [];
const statuses = new Map();
let measuring = false;
let stop = false;

async function worker() {
  while (!stop) {
    const started = performance.now();
    let status = -1;
    try {
      const response = await fetch(target, { headers, redirect: 'manual' });
      await response.arrayBuffer();
      status = response.status;
    } catch {
      // a refused or reset connection stays -1
    }
    if (measuring) {
      latencies.push(performance.now() - started);
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    }
  }
}

const workers = Array.from({ length: concurrency }, worker);
await new Promise((done) => setTimeout(done, warmup * 1000));
measuring = true;
const from = performance.now();
await new Promise((done) => setTimeout(done, seconds * 1000));
measuring = false;
const elapsed = (performance.now() - from) / 1000;
stop = true;
await Promise.all(workers);

latencies.sort((a, b) => a - b);
const at = (p) =>
  Math.round(
    (latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0) * 10,
  ) / 10;
console.log(
  JSON.stringify({
    target,
    concurrency,
    requests: latencies.length,
    rps: Math.round(latencies.length / elapsed),
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    statuses: Object.fromEntries(statuses),
  }),
);
