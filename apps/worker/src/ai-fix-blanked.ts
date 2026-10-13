import { createDatabaseClient } from '@lucy-spa/database';
import { fixBlankedFields } from '@lucy-spa/server';

/**
 * Claude integration (Owner decision 2026-10-13, item 6): restores fields that an applied draft left empty, with no model and no cost.
 * See `packages/server/src/ai/rewrite-blanks.ts`.
 *
 *   node apps/worker/dist/ai-fix-blanked.js            dry run: only prints the counts
 *   node apps/worker/dist/ai-fix-blanked.js --apply    writes (one transaction and one audit event per product)
 *   --limit=N                                          with --apply: at most N products
 *
 * Needs DATABASE_URL. Prints one summary line of `key=value` pairs and exits 0. Safe to run again.
 */
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg === undefined ? undefined : Number(limitArg.slice('--limit='.length));
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const database = createDatabaseClient(url);
  try {
    const report = await fixBlankedFields(database, {
      apply,
      ...(limit !== undefined && Number.isInteger(limit) && limit > 0 ? { limit } : {}),
    });
    const fields =
      Object.entries(report.blankByField)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([field, n]) => `${field}:${n}`)
        .join(',') || '-';
    console.log(
      [
        `mode=${apply ? 'apply' : 'dry-run'}`,
        `appliedItems=${report.appliedItems}`,
        `productsWithBlank=${report.productsWithBlank}`,
        `fromBefore=${report.fromBefore}`,
        `fromName=${report.fromName}`,
        `unrestorable=${report.unrestorable}`,
        `skippedEdited=${report.skippedEdited}`,
        `skippedManual=${report.skippedManual}`,
        `skippedChanged=${report.skippedChanged}`,
        `restoredProducts=${report.restoredProducts}`,
        `restoredFields=${report.restoredFields}`,
        `fields=${fields}`,
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
