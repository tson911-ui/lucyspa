import type { DatabaseClient } from '@lucy-spa/database';
import {
  pendingLowStockAlerts,
  processLowStockAlert,
  runExpiryScan,
  runOnlineOrderScan,
  runOrderScan,
  type createLogger,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

/**
 * One pass over the pending low-stock alert rows (at most 50): each runs in its OWN transaction, so one failing alert never blocks or
 * half-applies another; a failed one stays pending and is retried on the next pass.
 */
export async function relayLowStockAlerts(
  database: DatabaseClient,
  onOutcome: (outcome: string) => void,
  onFailure: (error: unknown) => void,
): Promise<number> {
  const pending = await pendingLowStockAlerts(database, 50);
  for (const alert of pending) {
    try {
      onOutcome(
        await database.$transaction((tx) => processLowStockAlert(tx, alert.id), {
          timeout: 30_000,
        }),
      );
    } catch (error) {
      onFailure(error);
    }
  }
  return pending.length;
}

/**
 * In-app stock alerts (design 4.6, P6-T16): the low-stock alerts written by the movement trigger, and the daily branch-local
 * expiry scan, plus the daily branch-local scan of the pre-orders (P6-17: late lines and goods nobody collected). One loop, no BullMQ, email or delivery table; independent of every other relay (it never reads `published_at`).
 */
export function startInventoryAlerts(database: DatabaseClient, logger: Logger) {
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Inventory alert job failed',
    );
  const outcome = (value: string) => {
    if (value === 'UNROUTABLE') logger.warn('A stock alert had no eligible recipient');
  };
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  const tick = () => {
    running = (async () => {
      try {
        await runExpiryScan(database);
        await runOrderScan(database);
        await runOnlineOrderScan(database);
        await relayLowStockAlerts(database, outcome, failure);
      } catch (error) {
        failure(error);
      }
    })().finally(() => {
      if (!stopped) timer = setTimeout(tick, 5000);
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
