import type { DatabaseClient } from '@lucy-spa/database';
import { processNextSourceTest, type createLogger } from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

/**
 * Test Source (Phase 9 P9-3): runs the queued tests of supplier sources, one at a time. This is the only place that talks to a
 * supplier's site; the API only queues a test and records a person's confirmation. One loop, no BullMQ: a test is a database row
 * with a lease, and an idle pass costs one cheap query every few seconds.
 */
export function startSourceTests(database: DatabaseClient, logger: Logger) {
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Source test job failed',
    );
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  const tick = () => {
    running = (async () => {
      try {
        const outcome = await processNextSourceTest(database);
        if (outcome !== null) logger.info({ outcome }, 'Source test finished');
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
