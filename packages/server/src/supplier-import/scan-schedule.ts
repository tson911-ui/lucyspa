import { isScanDue, type ScheduleCadence } from './resync.js';
import { FULL_SCAN_LIMIT, inUnit, type ScanDatabase } from './source-scan.js';

/**
 * Phase 9 P9-7: per-source scheduled scans (design section 10). The schedule only QUEUES a scan row (trigger SCHEDULE, no actor); the
 * same worker loop that runs manual scans runs it, with the same gates and the same one-scan-at-a-time rule per source.
 *
 * - A source is scheduled only when its cadence is DAILY or WEEKLY (the default MANUAL is never scheduled), it is enabled and READY
 *   with a confirmed permission that covers text or pictures, and it has been read successfully at least once. A schedule never makes
 *   the FIRST read of a source: that is a person's sample scan.
 * - Only inside the off-hours window (01:00-05:00 Vietnam time) and not sooner than the cadence after the latest scan of any kind, a
 *   failed one included, so a site that blocks us is not asked again before the next period.
 * - Nothing here fetches anything and nothing here changes a source.
 */
export async function queueScheduledScans(
  database: ScanDatabase,
  now: Date = new Date(),
): Promise<number> {
  const candidates = await database.$queryRaw<{ id: string }[]>`
    SELECT id FROM supplier_sources
     WHERE scan_cadence <> 'MANUAL' AND is_enabled AND status = 'READY' AND permission_confirmed_at IS NOT NULL
       AND (permits_text OR permits_images) AND kind <> 'FILE' AND base_url IS NOT NULL AND last_success_at IS NOT NULL
     ORDER BY id`;
  let queued = 0;
  for (const candidate of candidates) {
    const done = await inUnit(database, async (tx) => {
      // The source row is the claim: a second worker waits here and then sees the scan this one queued.
      const rows = await tx.$queryRaw<{ cadence: ScheduleCadence; ready: boolean }[]>`
          SELECT scan_cadence::text AS cadence,
                 (is_enabled AND status = 'READY' AND permission_confirmed_at IS NOT NULL AND (permits_text OR permits_images)
                  AND kind <> 'FILE' AND base_url IS NOT NULL AND last_success_at IS NOT NULL) AS ready
            FROM supplier_sources WHERE id = ${candidate.id}::uuid FOR UPDATE`;
      const source = rows[0];
      if (!source?.ready) return false;
      const running = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM import_scans WHERE source_id = ${candidate.id}::uuid AND status = 'RUNNING' LIMIT 1`;
      if (running.length > 0) return false;
      const latest = await tx.$queryRaw<{ started_at: Date }[]>`
          SELECT started_at FROM import_scans WHERE source_id = ${candidate.id}::uuid ORDER BY started_at DESC, id DESC LIMIT 1`;
      if (!isScanDue(source.cadence, latest[0]?.started_at ?? null, now)) return false;
      // A source that has had a full scan is scanned in full again (new products show up, the notice can say "15 mới"); until then the
      // schedule only re-reads the sample.
      const fullBefore = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM import_scans
         WHERE source_id = ${candidate.id}::uuid AND scope = 'FULL' AND status IN ('SUCCEEDED', 'PARTIAL') LIMIT 1`;
      const full = fullBefore.length > 0;
      await tx.importScan.create({
        data: {
          sourceId: candidate.id,
          trigger: 'SCHEDULE',
          actorUserId: null,
          scope: full ? 'FULL' : 'SAMPLE',
          sampleLimit: full ? FULL_SCAN_LIMIT : 20,
        },
        select: { id: true },
      });
      return true;
    });
    if (done) queued += 1;
  }
  return queued;
}
