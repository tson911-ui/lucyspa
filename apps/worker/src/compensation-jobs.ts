import type { DatabaseClient } from '@lucy-spa/database';
import {
  candidateInvoices,
  loadPayRules,
  payRulesStamp,
  reconcileInvoiceEarnings,
  type CandidateCursor,
  type createLogger,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

/** A periodic pass looks this far back; every six hours (and whenever the rules change) it looks at everything since go-live. */
export const EARNINGS_WINDOW_MS = 3 * 86_400_000;
const SWEEP_EVERY_MS = 6 * 3_600_000;
const PAGE = 200;
const SEEN_MAX = 5000;

/**
 * Tour and product-commission earnings (Phase 7 P7-9): brings the earnings of every invoice that may have changed in line with its state
 * (paid, reopened, cancelled, refunded, exchanged, seller changed), one transaction per invoice, idempotently. Dormant until the Owner
 * has started the cash book and payroll; a fault never touches an invoice (it is only read). Nothing here pays anyone.
 *
 * A pass walks the candidates page by page (newest first), so a long backlog is worked through however long it is. An invoice that was
 * brought in line and has not changed since is not read again, unless the rules changed (a rule entered after a sale reaches it).
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
  let stamp: string | null = null;
  const seen = new Map<string, number>();

  async function pass(since: Date | null, everything: boolean): Promise<boolean> {
    let after: CandidateCursor | null = null;
    for (;;) {
      if (stopped) return false;
      const page = await database.$transaction(
        (tx) => candidateInvoices(tx, { since, limit: PAGE, after }),
        { timeout: 30_000 },
      );
      const todo = everything
        ? page
        : page.filter((item) => seen.get(item.id) !== item.touchedAt.getTime());
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
      if (page.length < PAGE) return true;
      const last = page[page.length - 1]!;
      after = { touchedAt: last.touchedAt, id: last.id };
    }
  }

  const tick = () => {
    running = (async () => {
      try {
        const now = Date.now();
        const current = await database.$transaction((tx) => payRulesStamp(tx), {
          timeout: 30_000,
        });
        const rulesChanged = stamp !== null && current !== stamp;
        stamp = current;
        if (rulesChanged) {
          seen.clear();
          lastSweep = 0;
        }
        const sweep = now - lastSweep >= SWEEP_EVERY_MS;
        const done = await pass(sweep ? null : new Date(now - EARNINGS_WINDOW_MS), sweep);
        if (sweep && done) lastSweep = now;
        if (seen.size > SEEN_MAX) seen.clear();
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
