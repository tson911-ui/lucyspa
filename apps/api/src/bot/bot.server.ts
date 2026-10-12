import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Logger } from 'pino';
import { API_ENVIRONMENT, API_LOGGER, type ApiEnvironment } from '../platform/tokens.js';
import { BotDataService, BotError } from './bot.service.js';

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const CACHE_MS = 60_000;
const LIVE_CACHE_MS = 15_000;
const CACHE_ENTRIES = 200;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** The Bearer secret, compared in constant time (both sides are hashed first so their lengths never differ). */
export function authorized(header: string | undefined, key: string): boolean {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  if (!match) return false;
  return timingSafeEqual(digest(match[1]!), digest(key));
}

/** Sixty requests a minute in all (one key, one caller): a fixed window that resets by itself. */
export class RateWindow {
  private count = 0;
  private resetAt = 0;

  constructor(
    private readonly limit = RATE_LIMIT,
    private readonly windowMs = RATE_WINDOW_MS,
  ) {}

  /** Returns 0 when the request may go on, otherwise the seconds to wait. */
  take(now: number): number {
    if (now >= this.resetAt) {
      this.count = 0;
      this.resetAt = now + this.windowMs;
    }
    if (this.count >= this.limit) return Math.max(1, Math.ceil((this.resetAt - now) / 1000));
    this.count += 1;
    return 0;
  }
}

type Route = (query: URLSearchParams) => Promise<unknown> | unknown;

/**
 * Claude integration Wave A (CI-B1): the bot data listener (design 6.2). It runs inside the API process on its own host and port
 * (`BOT_DATA_HOST`, `BOT_DATA_PORT`, loopback by default), so nginx and the web proxy, which forward to the API's own port only, can never
 * reach it. Layers: the separate listener; a Bearer secret (`BOT_DATA_KEY`) compared in constant time; GET only; sixty requests a
 * minute; an allow-list for every answer (`bot.serializers.ts`). No key means no listener. A failure here never touches the API.
 */
/** What the handler reads: one function per route (the service in production, a fake in tests). */
export interface BotData {
  shop: (query: URLSearchParams) => unknown;
  services: (query: URLSearchParams) => unknown;
  promotions: (query: URLSearchParams) => unknown;
  products: (query: URLSearchParams) => unknown;
  availability: (query: URLSearchParams) => unknown;
  knowledge: (query: URLSearchParams) => unknown;
  health: () => unknown;
}

export function createBotHandler(
  data: BotData,
  key: string,
  options: { now?: () => number; limit?: number; logger?: Pick<Logger, 'debug' | 'error'> } = {},
) {
  const clock = options.now ?? Date.now;
  const window = new RateWindow(options.limit ?? RATE_LIMIT);
  const cache = new Map<string, { until: number; body: string; etag: string }>();
  const routes: Record<string, { run: Route; ttl: number }> = {
    '/bot/v1/shop': { run: (q) => data.shop(q), ttl: CACHE_MS },
    '/bot/v1/services': { run: (q) => data.services(q), ttl: CACHE_MS },
    '/bot/v1/promotions': { run: (q) => data.promotions(q), ttl: CACHE_MS },
    '/bot/v1/products': { run: (q) => data.products(q), ttl: CACHE_MS },
    '/bot/v1/availability': { run: (q) => data.availability(q), ttl: LIVE_CACHE_MS },
    '/bot/v1/knowledge': { run: (q) => data.knowledge(q), ttl: CACHE_MS },
    '/bot/v1/health': { run: () => data.health(), ttl: 0 },
  };

  const send = (
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    });
    response.end(status === 304 ? undefined : text);
  };

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      // The secret first: an unauthenticated caller learns nothing, not even which paths exist.
      if (!authorized(request.headers['authorization'], key)) {
        return send(response, 401, { error: 'UNAUTHORIZED' }, { 'www-authenticate': 'Bearer' });
      }
      if (request.method !== 'GET')
        return send(response, 405, { error: 'METHOD' }, { allow: 'GET' });
      const wait = window.take(clock());
      if (wait > 0)
        return send(response, 429, { error: 'RATE_LIMITED' }, { 'retry-after': String(wait) });
      const url = new URL(request.url ?? '/', 'http://bot.local');
      const route = routes[url.pathname];
      if (!route) return send(response, 404, { error: 'NOT_FOUND' });
      const params = new URLSearchParams([...url.searchParams.entries()].sort());
      const cacheKey = `${url.pathname}?${params.toString()}`;
      const hit = route.ttl > 0 ? cache.get(cacheKey) : undefined;
      let entry = hit && hit.until > clock() ? hit : undefined;
      if (!entry) {
        const body = JSON.stringify(await route.run(params));
        entry = {
          until: clock() + route.ttl,
          body,
          etag: `"${createHash('sha1').update(body).digest('hex')}"`,
        };
        if (route.ttl > 0) {
          if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
          cache.set(cacheKey, entry);
        }
      }
      if (request.headers['if-none-match'] === entry.etag) {
        return send(response, 304, '', { etag: entry.etag });
      }
      return send(response, 200, entry.body, {
        etag: entry.etag,
        'cache-control': 'private, max-age=60',
      });
    } catch (error) {
      if (error instanceof BotError) return send(response, error.status, { error: error.code });
      // Never print the error itself: it can carry database text.
      options.logger?.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Bot data request failed',
      );
      return send(response, 500, { error: 'INTERNAL' });
    }
  };
}

@Injectable()
export class BotDataServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private server: Server | undefined;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(API_LOGGER) private readonly logger: Logger,
    @Inject(BotDataService) private readonly data: BotDataService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const config = this.environment.botData;
    if (config === null) return;
    // One handler per server (its rate window and cache live in it).
    const handler = createBotHandler(this.data, config.key, { logger: this.logger });
    const server = createServer((request, response) => void handler(request, response));
    server.keepAliveTimeout = 5_000;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      this.server = server;
      this.logger.info({ host: config.host, port: config.port }, 'Bot data listener started');
    } catch {
      // The API keeps running without the bot listener (for example the port is taken); the log says which one.
      this.logger.error(
        { host: config.host, port: config.port },
        'Bot data listener could not start',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
