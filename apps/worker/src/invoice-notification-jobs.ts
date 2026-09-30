import type { DatabaseClient } from '@lucy-spa/database';
import {
  FINANCIAL_NOTIFICATION_AGGREGATES,
  FINANCIAL_NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_CONSUMER,
  processFinancialNotificationEvent,
  scheduleRevenueSummaries,
  type createLogger,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

const PAGE = 50;

/**
 * One pass over the financial events this consumer has not handled yet (no `outbox_consumptions` row for
 * `notifications`): at most 50, in id order after the cursor. Each event runs in its OWN transaction
 * (recipients + inbox rows + consumption row), so one failing event never blocks or half-applies another.
 * Returns the next cursor (wrapping to the start once a short page is read, so a poisoned older event is
 * retried but cannot starve newer ones). Independent of the Phase 3 relay and the Leave consumer: it never
 * reads or writes `published_at`.
 */
export async function relayFinancialNotifications(
  database: DatabaseClient,
  cursor: string | undefined,
  onOutcome: (outcome: string) => void,
  onFailure: (error: unknown) => void,
): Promise<string | undefined> {
  const events = await database.outboxEvent.findMany({
    where: {
      aggregateType: { in: [...FINANCIAL_NOTIFICATION_AGGREGATES] },
      eventType: { in: FINANCIAL_NOTIFICATION_EVENT_TYPES },
      consumptions: { none: { consumer: NOTIFICATION_CONSUMER } },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take: PAGE,
    select: { id: true },
  });
  for (const event of events) {
    try {
      onOutcome(
        await database.$transaction((tx) => processFinancialNotificationEvent(tx, event.id), {
          timeout: 30_000,
        }),
      );
    } catch (error) {
      onFailure(error);
    }
  }
  return events.length < PAGE ? undefined : events.at(-1)?.id;
}

/**
 * In-app invoice / revenue notifications (Owner answers Q8): schedules the 21:30 branch-local revenue
 * summary events, then consumes pending financial events. No BullMQ, email or delivery table.
 */
export function startInvoiceNotifications(database: DatabaseClient, logger: Logger) {
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Invoice notification job failed',
    );
  const outcome = (value: string) => {
    if (value === 'UNROUTABLE') logger.warn('Financial notification had no eligible recipient');
  };
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  let cursor: string | undefined;
  const tick = () => {
    running = (async () => {
      try {
        await scheduleRevenueSummaries(database);
        cursor = await relayFinancialNotifications(database, cursor, outcome, failure);
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
