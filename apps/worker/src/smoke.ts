import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createLogger,
  parseWorkerEnvironment,
  QUEUE_PREFIX,
  redisConnectionOptions,
  SYSTEM_CHECK_QUEUE,
} from '@lucy-spa/server';
import { Queue, QueueEvents } from 'bullmq';

const logger = createLogger('worker-smoke', 'info');
async function smoke() {
  const config = parseWorkerEnvironment(process.env);
  const queue = new Queue(SYSTEM_CHECK_QUEUE, {
    connection: redisConnectionOptions(config.redisUrl, 'producer'),
    prefix: QUEUE_PREFIX,
  });
  const events = new QueueEvents(SYSTEM_CHECK_QUEUE, {
    connection: redisConnectionOptions(config.redisUrl, 'worker'),
    prefix: QUEUE_PREFIX,
  });
  queue.on('error', (err: Error) => logger.error({ err }, 'Queue connection error'));
  events.on('error', (err: Error) => logger.error({ err }, 'Queue events connection error'));
  const deadline = setTimeout(() => {
    logger.error('Smoke check timed out');
    process.exit(1);
  }, 20000);
  try {
    await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
    const nonce = randomUUID();
    const job = await queue.add(
      'ping',
      { nonce },
      {
        jobId: nonce,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { count: 100 },
      },
    );
    const result: unknown = await job.waitUntilFinished(events, 10000);
    assert.deepEqual(result, { status: 'ok', nonce });
    logger.info('BullMQ round-trip passed');
  } finally {
    await events.close();
    await queue.close();
    clearTimeout(deadline);
  }
}
smoke().catch((err: unknown) => {
  logger.error({ err }, 'BullMQ round-trip failed');
  process.exitCode = 1;
});
