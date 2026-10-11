import type { DatabaseClient } from '@lucy-spa/database';
import {
  candidateInvoices,
  loadPayRules,
  reconcileInvoiceEarnings,
  type createLogger,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

/** A periodic pass looks this far back; every six hours it looks at everything since go-live. */
export const EARNINGS_WINDOW_MS = 3 * 86_400_000;
const SWEEP_EVERY_MS = 6 * 3_600_000;
const BATCH = 200;
const SEEN_MAX = 5000;

/**
 * Tour and product-commission earnings (Phase 7 P7-9): brings the earnings of every invoice that may have changed in line with its state
 * (paid, reopened, cancelled, refunded, exchanged, seller changed), one transaction per invoice, idempotently. Dormant until the Owner
 * has started the cash book and payroll; a fault never touches an invoice (it is only read). Nothing here pays anyone.
 */
export function startCompensation(database: DatabaseClient, logger: Logger) {
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Compensation job failed',
    );
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  let lastSweep = 0;
  // What each invoice looked like when it was last brought in line, so an unchanged invoice is not read again every few seconds.
  const seen = new Map<string, number>();
  const tick = () => {
    running = (async () => {
      try {
        const now = Date.now();
        const sweep = now - lastSweep >= SWEEP_EVERY_MS;
        const since = sweep ? null : new Date(now - EARNINGS_WINDOW_MS);
        const ids = await database.$transaction(
          (tx) => candidateInvoices(tx, { since, limit: BATCH }),
          {
            timeout: 30_000,
          },
        );
        const todo = sweep
          ? ids
          : ids.filter((item) => seen.get(item.id) !== item.touchedAt.getTime());
        if (todo.length > 0) {
          const rules = await database.$transaction((tx) => loadPayRules(tx), { timeout: 30_000 });
          for (const { id, touchedAt } of todo) {
            try {
              await database.$transaction((tx) => reconcileInvoiceEarnings(tx, id, rules), {
                timeout: 30_000,
              });
              seen.set(id, touchedAt.getTime());
            } catch (error) {
              failure(error);
            }
          }
        }
        if (seen.size > SEEN_MAX) seen.clear();
        if (sweep && ids.length < BATCH) lastSweep = now;
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
