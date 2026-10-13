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
 *
 * Needs DATABASE_URL (and ANTHROPIC_API_KEY for --repair). Prints one summary line, `key=value` pairs, and exits 0.
 */
async function main() {
  const args = process.argv.slice(2);
  const repair = args.includes('--repair');
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg === undefined ? undefined : Number(limitArg.slice('--limit='.length));
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
        onProgress: (done, total) => {
          if (done % 25 === 0 || done === total) console.log(`... ${done}/${total}`);
        },
      },
    );
    const settings = await loadAiSettings(database);
    const micro = BigInt(report.repairCostMicroUsd);
    const vnd =
      settings.vndPerUsd === null ? 'unknown' : String(microUsdToVnd(micro, settings.vndPerUsd));
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
