import type { DatabaseClient } from '@lucy-spa/database';
import {
  createPayosProvider,
  reconcilePendingPayments,
  type createLogger,
  type PaymentProvider,
  type PayosConfig,
  type ReconcileSummary,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

const SWEEP_INTERVAL_MS = 30_000;

/**
 * One reconciliation pass over pending PayOS payments (design 16.2, Owner answers Q7 items 2 and 5): requests
 * past their 15-minute lifetime end as EXPIRED, cancelled/expired-at-provider requests end locally, a request
 * that PayOS reports PAID (a missed webhook) is applied through the same settlement rules as the webhook, and a
 * request that never received its link is closed at the provider and ended. PostgreSQL is the source of truth:
 * candidates are selected from the database, never from Redis, and each payment settles in its own transaction.
 */
export function reconcilePayos(
  database: DatabaseClient,
  provider: PaymentProvider,
): Promise<ReconcileSummary> {
  return reconcilePendingPayments(database, provider);
}

/**
 * Starts the sweep when PayOS credentials are configured; without them there can be no PayOS payment and the
 * job is inert. Never logs credentials, payloads or amounts.
 */
export function startPayosReconciliation(
  database: DatabaseClient,
  config: PayosConfig | null,
  logger: Logger,
  provider: PaymentProvider | null = config ? createPayosProvider(config) : null,
) {
  if (!provider) {
    logger.info('PayOS is not configured; payment reconciliation is disabled');
    return { async stop() {} };
  }
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  const tick = () => {
    running = (async () => {
      try {
        const summary = await reconcilePayos(database, provider);
        if (summary.examined > 0)
          logger.info({ ...summary }, 'PayOS reconciliation pass completed');
      } catch (error) {
        logger.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'PayOS reconciliation pass failed',
        );
      }
    })().finally(() => {
      if (!stopped) timer = setTimeout(tick, SWEEP_INTERVAL_MS);
    });
  };
  timer = setTimeout(tick, 5_000);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
