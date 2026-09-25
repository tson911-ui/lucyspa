import type { DatabaseClient } from '@lucy-spa/database';
import {
  AuthCleanup,
  AuthDeliveryProcessor,
  AuthEmailDispatcher,
  authTransactionRunner,
  parseDeliveryKeyRing,
  parseMailEnvironment,
  SmtpAuthEmailTransport,
  type AuthEmailTransport,
  type createLogger,
  type MailConfig,
} from '@lucy-spa/server';

type Logger = ReturnType<typeof createLogger>;

export interface AuthJobsConfig {
  readonly mail: MailConfig;
  readonly deliveryKeys: ReadonlyMap<number, Buffer> | null;
  readonly dispatchIntervalMs: number;
  readonly dispatchBatchSize: number;
  readonly cleanupEnabled: boolean;
  readonly cleanupIntervalSeconds: number;
  readonly cleanupBatchSize: number;
  readonly cleanupMaxBatches: number;
}

function invalid(field: string): never {
  throw new Error(`Invalid worker configuration: ${field}`);
}

function integer(
  env: NodeJS.ProcessEnv,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const input = env[field];
  if (input === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(input)) return invalid(field);
  const value = Number(input);
  return value >= min && value <= max ? value : invalid(field);
}

/**
 * Worker email and cleanup configuration, validated before anything starts. SMTP
 * dispatch additionally needs the delivery key ring to decrypt envelopes. The cleanup
 * interval is capped at 12 hours so terminal intents/challenges always go within the
 * design's 24-hour deadline.
 */
export function parseAuthJobsEnvironment(
  env: NodeJS.ProcessEnv,
  nodeEnv: 'development' | 'test' | 'production',
): AuthJobsConfig {
  const mail = parseMailEnvironment(env, nodeEnv);
  const cleanup = env['AUTH_CLEANUP_ENABLED'] ?? 'true';
  if (cleanup !== 'true' && cleanup !== 'false') invalid('AUTH_CLEANUP_ENABLED');
  return {
    mail,
    deliveryKeys: mail.transport === 'smtp' ? parseDeliveryKeyRing(env).deliveryKeys : null,
    dispatchIntervalMs: integer(env, 'EMAIL_DISPATCH_INTERVAL_MS', 5_000, 1_000, 300_000),
    dispatchBatchSize: integer(env, 'EMAIL_DISPATCH_BATCH_SIZE', 25, 1, 200),
    cleanupEnabled: cleanup === 'true',
    cleanupIntervalSeconds: integer(env, 'AUTH_CLEANUP_INTERVAL_SECONDS', 900, 60, 43_200),
    cleanupBatchSize: integer(env, 'AUTH_CLEANUP_BATCH_SIZE', 500, 1, 5_000),
    cleanupMaxBatches: integer(env, 'AUTH_CLEANUP_MAX_BATCHES', 20, 1, 1_000),
  };
}

/** Runs `task` repeatedly with `intervalMs` between the end of one run and the next. */
function loop(intervalMs: number, task: () => Promise<void>): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();
  const tick = () => {
    current = task().finally(() => {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    });
  };
  timer = setTimeout(tick, 0);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}

/** Error class only: provider and database errors may carry recipients or parameters. */
function safeError(error: unknown): { errorName: string } {
  return { errorName: error instanceof Error ? error.name : 'UnknownError' };
}

/**
 * Starts the email dispatcher (when SMTP is configured) and the bounded cleanup loop.
 * Logs contain only counts and error class names, never addresses, codes or payloads.
 */
export function startAuthJobs(
  database: DatabaseClient,
  config: AuthJobsConfig,
  logger: Logger,
  transportOverride?: AuthEmailTransport,
): { stop(): Promise<void> } {
  const runner = authTransactionRunner(database);
  const loops: { stop(): Promise<void> }[] = [];
  let smtp: SmtpAuthEmailTransport | undefined;
  if (config.mail.transport === 'smtp' && config.deliveryKeys) {
    const transport = transportOverride ?? (smtp = new SmtpAuthEmailTransport(config.mail));
    const dispatcher = new AuthEmailDispatcher(
      database,
      new AuthDeliveryProcessor(runner, { deliveryKeys: config.deliveryKeys }, transport),
    );
    loops.push(
      loop(config.dispatchIntervalMs, async () => {
        try {
          const summary = await dispatcher.dispatchDue(config.dispatchBatchSize);
          if (summary.examined > 0) {
            logger.info({ outcomes: summary.outcomes }, 'Auth email dispatch cycle');
          }
        } catch (error) {
          logger.error(safeError(error), 'Auth email dispatch cycle failed');
        }
      }),
    );
    logger.info(
      { host: config.mail.host, port: config.mail.port, security: config.mail.security },
      'Auth email dispatch enabled',
    );
  } else {
    logger.warn('Auth email dispatch disabled (MAIL_TRANSPORT=disabled); codes are not sent');
  }
  if (config.cleanupEnabled) {
    const cleanup = new AuthCleanup(runner);
    loops.push(
      loop(config.cleanupIntervalSeconds * 1_000, async () => {
        try {
          const summary = await cleanup.run({
            batchSize: config.cleanupBatchSize,
            maxBatches: config.cleanupMaxBatches,
          });
          if (Object.values(summary).some((count) => count > 0)) {
            logger.info({ cleanup: summary }, 'Auth cleanup cycle');
          }
        } catch (error) {
          logger.error(safeError(error), 'Auth cleanup cycle failed');
        }
      }),
    );
  }
  return {
    async stop() {
      await Promise.all(loops.map((entry) => entry.stop()));
      smtp?.close();
    },
  };
}
