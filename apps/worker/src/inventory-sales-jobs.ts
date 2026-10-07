import type { DatabaseClient } from '@lucy-spa/database';
import { relayInventoryEvents, type createLogger } from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

/**
 * Stock sales (Phase 6 P6-10, design 4.5): turns the reservations of a paid invoice into sales, gives them back when the paid
 * episode is reversed and releases them when the invoice is cancelled (`relayInventoryEvents`, one transaction per event, only for
 * invoices that hold a reservation). Its own loop: independent of the alert loop, the loyalty consumer and every other relay.
 */
export function startInventorySales(database: DatabaseClient, logger: Logger) {
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Inventory sales job failed',
    );
  const coolingDown = new Map<string, number>();
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  const tick = () => {
    running = (async () => {
      try {
        await relayInventoryEvents(database, coolingDown, () => undefined, failure);
      } catch (error) {
        failure(error);
      }
    })().finally(() => {
      if (!stopped) timer = setTimeout(tick, 2000);
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
