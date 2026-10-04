import type { DatabaseClient } from '@lucy-spa/database';
import { relayLoyaltyEvents, type createLogger } from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

/**
 * Loyalty points (Phase 5 P5-3): earns points when an invoice is paid and reverses them when the paid episode is
 * reopened or cancelled (`relayLoyaltyEvents`, one transaction per event). Dormant until the Owner switches
 * loyalty on, but it still records every event so a switch that stays OFF builds no backlog.
 */
export function startLoyaltyPoints(database: DatabaseClient, logger: Logger) {
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Loyalty points job failed',
    );
  const coolingDown = new Map<string, number>();
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  const tick = () => {
    running = (async () => {
      try {
        await relayLoyaltyEvents(database, coolingDown, () => undefined, failure);
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
