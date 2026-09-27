import type { DatabaseClient, Prisma } from '@lucy-spa/database';
import { createLogger, QUEUE_PREFIX, redisConnectionOptions, takeSharedAuthGraphLock } from '@lucy-spa/server';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { consumeBookingNotification } from './notification-delivery.js';
import { ensureWarningSchedules, processServiceWarning, type WarningTimer } from './service-warnings.js';

export const BOOKING_EVENTS_QUEUE = 'booking-events';
const EVENTS = ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
  'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'WALK_IN_CREATED', 'VISIT_LINE_SCHEDULED', 'SERVICE_STARTED', 'SERVICE_ENDED'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ScheduleWarning = (timer: WarningTimer) => Promise<void>;
type Logger = ReturnType<typeof createLogger>;

async function eventTimers(tx: Prisma.TransactionClient, event: { aggregateType: string; aggregateId: string; payload: Prisma.JsonValue }) {
  let visitId: string | undefined;
  if (event.aggregateType === 'Visit') visitId = event.aggregateId;
  if (event.aggregateType === 'Booking') {
    const visit = await tx.visit.findUnique({ where: { bookingId: event.aggregateId }, select: { id: true } });
    visitId = visit?.id;
  }
  if (event.aggregateType === 'ServiceExecution') {
    const execution = await tx.serviceExecution.findUnique({ where: { id: event.aggregateId }, select: { visitServiceLineId: true } });
    return execution ? ensureWarningSchedules(tx, execution.visitServiceLineId) : [];
  }
  if (!visitId) return [];
  const lines = await tx.visitServiceLine.findMany({ where: { visitId, status: { in: ['PLANNED', 'IN_PROGRESS'] } }, select: { id: true } });
  const timers: WarningTimer[] = [];
  for (const line of lines) timers.push(...await ensureWarningSchedules(tx, line.id));
  return timers;
}

/** One locked outbox row per transaction. Auth-email and unrelated domain events are untouched. */
export async function relayBookingEvent(database: DatabaseClient, id: string, schedule: ScheduleWarning) {
  return database.$transaction(async (tx) => {
    await takeSharedAuthGraphLock(tx);
    const claimed = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM outbox_events WHERE id = ${id}::uuid AND published_at IS NULL FOR UPDATE SKIP LOCKED`;
    if (!claimed.length) return false;
    const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id } });
    if (!EVENTS.includes(event.eventType) || !['Booking', 'Visit', 'ServiceExecution'].includes(event.aggregateType)) return false;
    if (event.schemaVersion !== 1) throw new Error('Unsupported booking event version');
    await consumeBookingNotification(tx, event);
    for (const timer of await eventTimers(tx, event)) await schedule(timer);
    await tx.outboxEvent.update({ where: { id }, data: { publishedAt: new Date() } });
    return true;
  });
}

/** Keyset pages include all still-live arrived work, including old unfinished executions. */
export async function recoverWarningPage(
  database: DatabaseClient, cursor: string | undefined, schedule: ScheduleWarning,
  onFailure: (error: unknown) => void, size = 100,
): Promise<string | undefined> {
  const lines = await database.visitServiceLine.findMany({
    where: {
      ...(cursor ? { id: { gt: cursor } } : {}), visit: { status: { in: ['OPEN', 'IN_SERVICE'] } },
      OR: [
        { status: 'PLANNED', startOverdueWarnedAt: null },
        { status: 'IN_PROGRESS', execution: { status: 'IN_PROGRESS', endedAt: null,
          OR: [{ preEndWarnedAt: null }, { endOverdueWarnedAt: null }] } },
      ],
    }, select: { id: true }, orderBy: { id: 'asc' }, take: Math.min(100, Math.max(1, size)),
  });
  for (const line of lines) {
    try {
      const timers = await database.$transaction((tx) => ensureWarningSchedules(tx, line.id));
      for (const timer of timers) {
        // The same authoritative guard handles due warnings even while Redis is unavailable.
        const outcome = await processServiceWarning(database, timer.id);
        if (outcome === 'early') await schedule(timer);
      }
    } catch (error) { onFailure(error); }
  }
  return lines.length < Math.min(100, Math.max(1, size)) ? undefined : lines.at(-1)?.id;
}

function loop(ms: number, work: () => Promise<void>) {
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout;
  const tick = () => {
    running = work().finally(() => { if (!stopped) timer = setTimeout(tick, ms); });
  };
  timer = setTimeout(tick, 0);
  return { async stop() { stopped = true; clearTimeout(timer); await running; } };
}

export function startBookingJobs(database: DatabaseClient, redisUrl: string, logger: Logger) {
  const safeFailure = (error: unknown) => logger.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Booking notification job failed');
  const queue = new Queue(BOOKING_EVENTS_QUEUE, { connection: redisConnectionOptions(redisUrl, 'producer'), prefix: QUEUE_PREFIX });
  queue.on('error', safeFailure);
  const schedule: ScheduleWarning = async (timer) => {
    await queue.add('service-warning', { scheduleId: timer.id }, {
      // BullMQ custom IDs cannot contain colons. The PostgreSQL timer has a unique semantic key.
      jobId: `warning-${timer.id}`, delay: Math.max(0, timer.dueAt.getTime() - Date.now()),
      attempts: 10, backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true, removeOnFail: { age: 3600, count: 1000 },
    });
  };
  const worker = new Worker(BOOKING_EVENTS_QUEUE, async (job) => {
    const data = job.data as { scheduleId?: unknown };
    if (job.name !== 'service-warning' || typeof data?.scheduleId !== 'string' || !UUID.test(data.scheduleId)) {
      throw new UnrecoverableError('Invalid service warning job');
    }
    if (await processServiceWarning(database, data.scheduleId) === 'early') throw new Error('Warning not due');
  }, { connection: redisConnectionOptions(redisUrl, 'worker'), prefix: QUEUE_PREFIX, concurrency: 4 });
  worker.on('error', safeFailure);
  worker.on('failed', (_job, error) => safeFailure(error));
  let recoveryCursor: string | undefined;
  let outboxCursor: string | undefined;
  const relay = loop(2000, async () => {
    try {
      const events = await database.outboxEvent.findMany({
        where: { publishedAt: null, eventType: { in: EVENTS }, aggregateType: { in: ['Booking', 'Visit', 'ServiceExecution'] },
          ...(outboxCursor ? { id: { gt: outboxCursor } } : {}) },
        orderBy: { id: 'asc' }, take: 50, select: { id: true },
      });
      for (const event of events) {
        try { await relayBookingEvent(database, event.id, schedule); } catch (error) { safeFailure(error); }
      }
      outboxCursor = events.length < 50 ? undefined : events.at(-1)?.id;
    } catch (error) { safeFailure(error); }
  });
  const recovery = loop(60_000, async () => {
    try { recoveryCursor = await recoverWarningPage(database, recoveryCursor, schedule, safeFailure); }
    catch (error) { safeFailure(error); }
  });
  return { async stop() {
    await Promise.all([relay.stop(), recovery.stop()]);
    await worker.close();
    await queue.close();
  } };
}
