import { createDatabaseClient } from '@lucy-spa/database';
import {
  createLogger,
  parseWorkerEnvironment,
  QUEUE_PREFIX,
  redisConnectionOptions,
  SYSTEM_CHECK_QUEUE,
} from '@lucy-spa/server';
import { Worker } from 'bullmq';
import { parseAuthJobsEnvironment, startAuthJobs } from './auth-jobs.js';
import { processSystemCheck } from './processor.js';

const bootstrapLogger = createLogger('worker', 'info');

async function bootstrap() {
  const config = parseWorkerEnvironment(process.env);
  // Validated before any connection: invalid email/cleanup configuration fails closed.
  const authJobsConfig = parseAuthJobsEnvironment(process.env, config.nodeEnv);
  const logger = createLogger('worker', config.logLevel);
  const database = createDatabaseClient(config.databaseUrl);
  let worker: Worker | undefined;
  let authJobs: { stop(): Promise<void> } | undefined;
  try {
    await database.$queryRaw`SELECT 1`;
    worker = new Worker(SYSTEM_CHECK_QUEUE, async (job) => processSystemCheck(job), {
      connection: redisConnectionOptions(config.redisUrl, 'worker'),
      prefix: QUEUE_PREFIX,
      concurrency: 1,
    });
    worker.on('error', (err: Error) => logger.error({ err }, 'Worker infrastructure error'));
    worker.on('failed', (job, err) =>
      logger.error({ jobId: job?.id, err }, 'Technical job failed'),
    );
    worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Technical job completed'));
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        worker.waitUntilReady(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Worker startup timeout')), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    authJobs = startAuthJobs(database, authJobsConfig, logger);
    logger.info({ queue: SYSTEM_CHECK_QUEUE }, 'Worker ready');
  } catch (error) {
    await authJobs?.stop();
    await worker?.close(true);
    await database.$disconnect();
    throw error;
  }
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    try {
      await authJobs?.stop();
      await worker?.close();
      await database.$disconnect();
      logger.info('Worker stopped');
    } catch (err) {
      logger.error({ err }, 'Worker shutdown failed');
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

bootstrap().catch((err: unknown) => {
  bootstrapLogger.fatal({ err }, 'Worker startup failed; check environment and infrastructure');
  process.exitCode = 1;
});
