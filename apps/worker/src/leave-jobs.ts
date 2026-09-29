import type { DatabaseClient } from '@lucy-spa/database';
import {
  type createLogger,
  LEAVE_AGGREGATE,
  LEAVE_EVENT_TYPES,
  processLeaveEvent,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

const PAGE = 50;

/**
 * One pass over pending Leave events: at most 50, in id order after the cursor. Each event runs in
 * its OWN transaction (consume + notifications + mark), so one failing event never blocks or
 * half-applies another. Returns the next cursor (wrapping to the start once a short page is read,
 * so a poisoned older event is retried but cannot starve newer ones).
 */
export async function relayLeaveEvents(
  database: DatabaseClient,
  cursor: string | undefined,
  onOutcome: (outcome: string) => void,
  onFailure: (error: unknown) => void,
): Promise<string | undefined> {
  const events = await database.outboxEvent.findMany({
    where: {
      publishedAt: null,
      aggregateType: LEAVE_AGGREGATE,
      eventType: { in: [...LEAVE_EVENT_TYPES] },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take: PAGE,
    select: { id: true },
  });
  for (const event of events) {
    try {
      onOutcome(
        await database.$transaction((tx) => processLeaveEvent(tx, event.id), { timeout: 30_000 }),
      );
    } catch (error) {
      onFailure(error);
    }
  }
  return events.length < PAGE ? undefined : events.at(-1)?.id;
}

/**
 * In-app Leave notifications only (no BullMQ, email or delivery table). Independent of the Phase 3
 * booking relay: it claims only Leave events on the LeaveRequest aggregate.
 */
export function startLeaveNotifications(database: DatabaseClient, logger: Logger) {
  const failure = (error: unknown) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Leave notification job failed',
    );
  const outcome = (value: string) => {
    if (value === 'UNROUTABLE') logger.warn('Leave request had no reachable recipient');
  };
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  let cursor: string | undefined;
  const tick = () => {
    running = (async () => {
      try {
        cursor = await relayLeaveEvents(database, cursor, outcome, failure);
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
