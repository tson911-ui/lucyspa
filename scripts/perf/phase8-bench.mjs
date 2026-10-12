// Phase 8 (P8-T5): benchmark of the report queries on the synthetic fixture (scripts/perf/phase8-fixture.sql).
//   eval "$(node scripts/scratch-db-env.mjs lucy_spa_p8_perf_scratch)" && pnpm --filter @lucy-spa/api build && node scripts/perf/phase8-bench.mjs [explain]
// Targets (design P8-T5): dashboard widget p95 <= 800 ms, any report over 366 days p95 <= 2 s. Runs each case in the same frame the API uses
// (REPEATABLE READ, READ ONLY, statement timeout). Refuses to run anywhere but a database named *perf_scratch*.
import { createDatabaseClient } from '../../packages/database/dist/index.js';
import { revenueReport } from '../../apps/api/dist/reports/revenue.core.js';
import { refundReport } from '../../apps/api/dist/reports/refunds.core.js';
import { factsStatement } from '../../apps/api/dist/reports/revenue.sql.js';
import { Prisma } from '../../packages/database/dist/index.js';

const url = process.env.DATABASE_URL ?? '';
if (!/\/lucy_spa_[a-z0-9_]*perf_scratch[a-z0-9_]*$/.test(url)) {
  console.error('refusing: DATABASE_URL must name a *perf_scratch* database');
  process.exit(2);
}
const client = createDatabaseClient(url);
const RUNS = Number(process.env.RUNS ?? 12);
const LAST = '2026-10-12';

const addDays = (date, n) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

async function inFrame(work, timeoutMs = 60_000) {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${timeoutMs}`);
      await tx.$executeRawUnsafe('SET LOCAL jit = off');
      await tx.$executeRawUnsafe(`SET LOCAL work_mem = '${process.env.WORK_MEM ?? '64MB'}'`);
      const branches = await tx.branch.findMany({
        where: { isActive: true, code: { startsWith: 'P8F' } },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, timezone: true },
      });
      const context = {
        tx,
        now: new Date(),
        actor: null,
        allBranches: branches,
        can: () => true,
        scope: (_requires, branchId) =>
          branchId ? branches.filter((b) => b.id === branchId) : branches,
      };
      return work(context, branches, tx);
    },
    { timeout: timeoutMs + 10_000 },
  );
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

async function measure(name, target, run) {
  await run(); // warm-up (plans, cache)
  const times = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    await run();
    times.push(performance.now() - started);
  }
  const p95 = percentile(times, 95);
  const ok = p95 <= target;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} p50 ${percentile(times, 50).toFixed(0).padStart(5)} ms  p95 ${p95.toFixed(0).padStart(5)} ms  max ${Math.max(
      ...times,
    )
      .toFixed(0)
      .padStart(5)} ms  (target ${target} ms)`,
  );
  return ok;
}

let allOk = true;
const cases = [
  ['revenue 1 day (dashboard widget)', 800, 1, 'none'],
  ['revenue 7 days', 800, 7, 'none'],
  ['revenue 30 days + previous period', 2000, 30, 'previous'],
  ['revenue 90 days', 2000, 90, 'none'],
  ['revenue 366 days', 2000, 366, 'none'],
  ['revenue 366 days + previous period', 4000, 366, 'previous'],
];
for (const [name, target, days, compare] of cases) {
  const from = addDays(LAST, -(days - 1));
  const ok = await measure(name, target, () =>
    inFrame((context) => revenueReport(context, { from, to: LAST, compare })),
  );
  allOk &&= ok;
}
allOk &&= await measure('refunds list 366 days', 2000, () =>
  inFrame((context) => refundReport(context, { from: addDays(LAST, -365), to: LAST, page: '1' })),
);

if (process.argv.includes('explain')) {
  const scope = {
    branchIds: [],
    from: addDays(LAST, -(Number(process.env.DAYS ?? 366) - 1)),
    to: LAST,
  };
  await inFrame(async (context, branches, tx) => {
    scope.branchIds = branches.map((b) => b.id);
    const plan = await tx.$queryRaw(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${factsStatement(scope)}`,
    );
    console.log(plan.map((row) => row['QUERY PLAN']).join('\n'));
  });
}

await client.$disconnect();
process.exit(allOk ? 0 : 1);
