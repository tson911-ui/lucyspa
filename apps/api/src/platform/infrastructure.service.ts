import { createDatabaseClient, type DatabaseClient } from '@lucy-spa/database';
import { redisConnectionOptions } from '@lucy-spa/server';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { API_ENVIRONMENT, API_LOGGER, type ApiEnvironment } from './tokens.js';

const HEALTH_TIMEOUT_MS = 3_000;

// Bounds the HTTP probe; database and Redis connection/command timeouts also
// bound the underlying operation so a failed probe cannot build an endless queue.
async function withDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Infrastructure probe timed out')),
          HEALTH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class InfrastructureService implements OnModuleInit, OnModuleDestroy {
  private readonly database: DatabaseClient;
  private readonly redis: Redis;

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(API_LOGGER) private readonly logger: Logger,
  ) {
    this.database = createDatabaseClient(environment.databaseUrl);
    this.redis = new Redis({
      ...redisConnectionOptions(environment.redisUrl, 'producer'),
      lazyConnect: true,
      enableOfflineQueue: false,
      commandTimeout: HEALTH_TIMEOUT_MS,
      connectTimeout: HEALTH_TIMEOUT_MS,
    });
    // Do not log Redis errors verbatim: provider messages can include connection details.
    this.redis.on('error', () =>
      this.logger.warn({ dependency: 'redis' }, 'Redis connection error'),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await withDeadline(Promise.all([this.database.$connect(), this.redis.connect()]));
      this.logger.info('API infrastructure connected');
    } catch {
      await this.onModuleDestroy();
      throw new Error('API infrastructure could not initialize');
    }
  }

  async pingDatabase(): Promise<void> {
    await withDeadline(this.database.$queryRaw`SELECT 1`);
  }

  async pingRedis(): Promise<void> {
    const result = await withDeadline(this.redis.ping());
    if (result !== 'PONG') {
      throw new Error('Redis probe failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
    await this.database.$disconnect();
  }
}
