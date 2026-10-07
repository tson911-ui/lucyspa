import { redisConnectionOptions } from '@lucy-spa/server';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  PUBLIC_LIMITS,
  PUBLIC_WINDOW_SECONDS,
  windowKey,
  type ClientIdentity,
  type PublicBudget,
} from './public-rate-limit.core.js';
import { API_ENVIRONMENT, API_LOGGER, type ApiEnvironment } from './tokens.js';

/** A slow Redis must never slow a public page: past this the request is let through. */
const COMMAND_TIMEOUT_MS = 250;
const WARN_EVERY_MS = 60_000;

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the next window opens (only meaningful when `allowed` is false). */
  retryAfterSeconds: number;
}

/** What the guard needs from a counter store; Redis in production, a map in tests. */
export interface WindowCounter {
  /** Adds one to each key (creating it with a lifetime) and returns the new counts in order. */
  increment(keys: readonly string[], lifetimeSeconds: number): Promise<number[]>;
}

export class RedisWindowCounter implements WindowCounter {
  constructor(private readonly redis: Redis) {}

  async increment(keys: readonly string[], lifetimeSeconds: number): Promise<number[]> {
    const pipeline = this.redis.multi();
    for (const key of keys) {
      pipeline.incr(key);
      // NX: only the first hit of a window sets the lifetime, so later hits never push the expiry out.
      pipeline.expire(key, lifetimeSeconds, 'NX');
    }
    const results = await pipeline.exec();
    if (!results) throw new Error('Rate limit pipeline returned nothing');
    return keys.map((_key, index) => {
      const [error, value] = results[index * 2] ?? [new Error('missing'), null];
      if (error || typeof value !== 'number') throw error ?? new Error('Unexpected counter');
      return value;
    });
  }
}

/**
 * The shared counters behind the public routes. Redis holds them, so every API process (today one, later more) and any web
 * process in front of it draws on the same budget. It fails OPEN: a public read is never refused because Redis is down.
 */
@Injectable()
export class PublicRateLimitService implements OnModuleDestroy {
  private redis: Redis | null = null;
  private counter: WindowCounter | null = null;
  private connecting: Promise<void> | null = null;
  private lastWarningAt = 0;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(API_LOGGER) private readonly logger: Logger,
  ) {}

  /** Tests give their own counter; production connects lazily on the first public request. */
  useCounter(counter: WindowCounter): void {
    this.counter = counter;
  }

  private async ensureCounter(): Promise<WindowCounter> {
    if (!this.counter) {
      const redis = new Redis({
        ...redisConnectionOptions(this.environment.redisUrl, 'producer'),
        commandTimeout: COMMAND_TIMEOUT_MS,
        connectTimeout: 1_000,
        // Commands never wait in a queue behind a dead connection: they fail at once and the request is let through.
        enableOfflineQueue: false,
        lazyConnect: true,
      });
      // Provider messages can carry connection details: log only that it failed.
      redis.on('error', () => this.warn());
      this.redis = redis;
      this.counter = new RedisWindowCounter(redis);
      // The first request waits for the connection; if it fails, ioredis keeps retrying and later requests find it ready.
      this.connecting = redis.connect().catch(() => this.warn());
    }
    await this.connecting;
    return this.counter;
  }

  private warn(): void {
    const now = Date.now();
    if (now - this.lastWarningAt < WARN_EVERY_MS) return;
    this.lastWarningAt = now;
    this.logger.warn(
      { dependency: 'redis' },
      'Public rate limit unavailable; letting requests through',
    );
  }

  async consume(
    budget: PublicBudget,
    client: ClientIdentity,
    nowMs = Date.now(),
  ): Promise<RateDecision> {
    const limit = PUBLIC_LIMITS[budget];
    const windowMs = PUBLIC_WINDOW_SECONDS * 1_000;
    const windowIndex = Math.floor(nowMs / windowMs);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(((windowIndex + 1) * windowMs - nowMs) / 1_000),
    );
    // Clients with no readable outside address share one counter, so that counter gets the allowance of all of them.
    const perClientLimit = client.known ? limit.perClient : limit.total;
    try {
      const counter = await this.ensureCounter();
      const [mine, everyone] = await counter.increment(
        [windowKey(budget, client.id, windowIndex), windowKey(budget, 'total', windowIndex)],
        PUBLIC_WINDOW_SECONDS * 2,
      );
      const allowed = (mine ?? 0) <= perClientLimit && (everyone ?? 0) <= limit.total;
      return { allowed, retryAfterSeconds };
    } catch {
      this.warn();
      return { allowed: true, retryAfterSeconds };
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }
}
