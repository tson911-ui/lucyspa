import type { DatabaseClient } from '@lucy-spa/database';
import { postCashSources, type createLogger } from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

/** A periodic pass looks this far back (the daily sweep and the closing's preflight look at everything since go-live). */
export const POSTING_WINDOW_MS = 3 * 86_400_000;
const SWEEP_EVERY_MS = 6 * 3_600_000;

/**
 * The cash book poster (Phase 7 P7-3, P7-T8): writes the money the rest of the system recorded (payments, cash reversals, product refunds,
 * exchange refunds) into the funds' book, once each. Dormant until the Owner starts the cash book (`finance_go_live` empty = nothing is
 * posted). A fault never touches a payment: the sources are read, never changed. Every few seconds it looks at the last three days; every
 * six hours it looks at everything since go-live, so nothing a pass missed stays missing.
 */
export function startCashPosting(database: DatabaseClient, logger: Logger) {
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Cash posting job failed',
    );
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  let lastSweep = 0;
  const tick = () => {
    running = (async () => {
      try {
        const now = Date.now();
        const sweep = now - lastSweep >= SWEEP_EVERY_MS;
        const since = sweep ? null : new Date(now - POSTING_WINDOW_MS);
        await database.$transaction((tx) => postCashSources(tx, { since }), { timeout: 30_000 });
        if (sweep) lastSweep = now;
      } catch (error) {
        failure(error);
      }
    })().finally(() => {
      if (!stopped) timer = setTimeout(tick, 4000);
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
