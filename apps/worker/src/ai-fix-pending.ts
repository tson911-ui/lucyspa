import { createDatabaseClient } from '@lucy-spa/database';
import {
  ClaudeClient,
  fixPendingDrafts,
  loadAiSettings,
  microUsdToVnd,
  type PendingFixReport,
} from '@lucy-spa/server';

/**
 * Claude integration CI-F1 (Owner decision of 2026-10-13, item 5): the one-off command that brings the drafts already waiting for review
 * up to the same standard as new ones. Free fixes for every pending draft (no model, no cost); with `--repair`, also the one targeted
 * model call for each draft that still has a real problem, under the spending switches and caps. Safe to run again. A draft a person edited
 * is never touched, and nothing is published.
 *
 *   node apps/worker/dist/ai-fix-pending.js            free fixes only
 *   node apps/worker/dist/ai-fix-pending.js --repair   free fixes, then the repair calls (the only part that costs money)
 *   --limit=N                                          stop after N drafts
 *   --max-vnd=N                                        with --repair: stop before a call that could take the repair spending past N VND
 *
 * Besides the counts it prints the drafts left per error code before and after, and the estimated cost of the repair (the number of drafts
 * that need it times the average of the repair calls already in the ledger; 400 VND when there are none yet).
 *
 * Needs DATABASE_URL (and ANTHROPIC_API_KEY for --repair). Prints one summary line, `key=value` pairs, and exits 0.
 */
async function main() {
  const args = process.argv.slice(2);
  const repair = args.includes('--repair');
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg === undefined ? undefined : Number(limitArg.slice('--limit='.length));
  const capArg = args.find((arg) => arg.startsWith('--max-vnd='));
  const maxSpendVnd = capArg === undefined ? undefined : Number(capArg.slice('--max-vnd='.length));
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const database = createDatabaseClient(url);
  try {
    const key = process.env['ANTHROPIC_API_KEY']?.trim() || undefined;
    const client = new ClaudeClient({ apiKey: key });
    if (repair && !client.hasKey) {
      console.log('ANTHROPIC_API_KEY is not set: the repair calls are skipped, free fixes only.');
    }
    const report: PendingFixReport = await fixPendingDrafts(
      database,
      repair && client.hasKey ? client : null,
      {
        repair: repair && client.hasKey,
        ...(limit !== undefined && Number.isInteger(limit) && limit > 0 ? { limit } : {}),
        ...(maxSpendVnd !== undefined && Number.isFinite(maxSpendVnd) && maxSpendVnd >= 0
          ? { maxSpendVnd }
          : {}),
        onProgress: (done, total) => {
          if (done % 25 === 0 || done === total) console.log(`... ${done}/${total}`);
        },
      },
    );
    const settings = await loadAiSettings(database);
    const micro = BigInt(report.repairCostMicroUsd);
    const vnd =
      settings.vndPerUsd === null ? 'unknown' : String(microUsdToVnd(micro, settings.vndPerUsd));
    const average = await database.$queryRaw<{ micro: bigint | null; calls: bigint }[]>`
      SELECT avg(cost_micro_usd)::bigint AS micro, count(*) AS calls
        FROM ai_usage_ledger WHERE outcome IN ('REPAIRED', 'REPAIR_FAILED')`;
    const perCallMicro = average[0]?.micro ?? null;
    const estimate =
      settings.vndPerUsd === null
        ? 'unknown'
        : String(
            perCallMicro === null
              ? report.needRepair * 400
              : microUsdToVnd(perCallMicro * BigInt(report.needRepair), settings.vndPerUsd),
          );
    const byCode = (counts: Record<string, number>): string =>
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, n]) => `${code}:${n}`)
        .join(',') || '-';
    console.log(
      [
        `pending=${report.pending}`,
        `skippedEdited=${report.skippedEdited}`,
        `skippedBusy=${report.skippedBusy}`,
        `alreadyClean=${report.alreadyClean}`,
        `fixedFree=${report.fixedFree}`,
        `needRepair=${report.needRepair}`,
        `repairCalls=${report.repairCalls}`,
        `repaired=${report.repaired}`,
        `repairSkipped=${report.repairSkipped}`,
        `withNotes=${report.withNotes}`,
        `repairCostMicroUsd=${report.repairCostMicroUsd}`,
        `repairCostVnd=${vnd}`,
        `notesRefreshed=${report.notesRefreshed}`,
        `blankedDrafts=${report.blankedDrafts}`,
        `needRepairAfter=${report.needRepairAfter}`,
        `stoppedByBudget=${report.stoppedByBudget}`,
        `estimatedRepairVnd=${estimate}`,
        `codesBefore=${byCode(report.needRepairByCode)}`,
        `codesAfter=${byCode(report.remainingByCode)}`,
      ].join(' '),
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : 'Error');
  process.exit(1);
});
