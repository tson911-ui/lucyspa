import type { DatabaseClient } from '@lucy-spa/database';
import {
  LocalDiskMediaStorage,
  parseMediaStorageDirectory,
  processNextScan,
  queueScheduledScans,
  type createLogger,
  type MediaStorage,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

const QUEUE_CHECK_MS = 5 * 60_000;

/**
 * Supplier sample scans (Phase 9 P9-4): runs the manual scans the API queued, one at a time. This is, with Test Source, the only place
 * that talks to a supplier's site. Pictures are written under `MEDIA_STORAGE_DIR`, the same folder the API serves them from; when the
 * variable is missing in production the worker still starts (nothing else depends on it) and a scan reports that pictures could not be
 * stored instead of skipping them silently.
 */
export function startSourceScans(
  database: DatabaseClient,
  nodeEnv: 'development' | 'test' | 'production',
  logger: Logger,
) {
  let storage: MediaStorage | null = null;
  try {
    storage = new LocalDiskMediaStorage(parseMediaStorageDirectory(process.env, nodeEnv));
  } catch {
    logger.warn(
      'MEDIA_STORAGE_DIR is not usable: supplier pictures cannot be stored by this worker',
    );
  }
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Source scan job failed',
    );
  let stopped = false;
  let lastQueueCheck = 0;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  const tick = () => {
    running = (async () => {
      try {
        // The schedule is looked at every 5 minutes; it only queues scan rows (nothing is fetched here).
        if (Date.now() - lastQueueCheck >= QUEUE_CHECK_MS) {
          lastQueueCheck = Date.now();
          try {
            const queued = await queueScheduledScans(database);
            if (queued > 0) logger.info({ queued }, 'Scheduled source scans queued');
          } catch (error) {
            failure(error);
          }
        }
        const outcome = await processNextScan(database, { storage });
        if (outcome !== null) logger.info({ outcome }, 'Source scan finished');
      } catch (error) {
        failure(error);
      }
    })().finally(() => {
      if (!stopped) timer = setTimeout(tick, 3000);
    });
  };
  timer = setTimeout(tick, 0);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
