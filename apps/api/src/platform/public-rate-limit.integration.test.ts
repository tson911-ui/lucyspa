import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { PUBLIC_LIMITS, windowKey } from './public-rate-limit.core.js';
import { PublicRateLimitService } from './public-rate-limit.service.js';

// Real Redis, explicit opt-in like the other integration tests. Two service instances stand for two processes: they must
// draw on one budget, and the counters must expire by themselves.
test(
  'public rate limit in Redis: two processes share one budget; windows expire by themselves; an unreachable Redis lets requests through',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const redisUrl = process.env['REDIS_URL'];
    assert.ok(redisUrl, 'REDIS_URL required for explicit integration tests.');
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = (url: string) =>
      parseApiEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost/test',
        REDIS_URL: url,
        WEB_ORIGIN: 'http://localhost:3000',
        AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
        AUTH_CSRF_ACTIVE_VERSION: '1',
        AUTH_CSRF_KEYS: ring(),
        AUTH_THROTTLE_ACTIVE_VERSION: '1',
        AUTH_THROTTLE_KEYS: ring(),
      });
    const quiet = pino({ level: 'silent' });
    const first = new PublicRateLimitService(environment(redisUrl), quiet);
    const second = new PublicRateLimitService(environment(redisUrl), quiet);
    const client = { id: `it-${randomUUID().slice(0, 12)}`, known: true };
    const now = Date.now();
    const windowIndex = Math.floor(now / 60_000);
    const probe = new Redis(redisUrl);
    try {
      const { perClient } = PUBLIC_LIMITS.json;
      for (let hit = 1; hit <= perClient; hit += 1) {
        const service = hit % 2 === 0 ? first : second;
        assert.equal((await service.consume('json', client, now)).allowed, true, `hit ${hit}`);
      }
      const refused = await first.consume('json', client, now);
      assert.equal(refused.allowed, false, 'the budget is shared by both processes');
      assert.ok(refused.retryAfterSeconds >= 1 && refused.retryAfterSeconds <= 60);
      // The first hit set a lifetime; later hits did not push it out (EXPIRE ... NX).
      const key = windowKey('json', client.id, windowIndex);
      const ttl = await probe.ttl(key);
      assert.ok(ttl > 0 && ttl <= 120, `ttl ${ttl}`);
      assert.equal(Number(await probe.get(key)), perClient + 1);
    } finally {
      await probe.del(
        windowKey('json', client.id, windowIndex),
        windowKey('json', client.id, windowIndex + 1),
      );
      // (The shared `total` counter this test also raised expires by itself within two windows.)
      probe.disconnect();
      first.onModuleDestroy();
      second.onModuleDestroy();
    }

    const dead = new PublicRateLimitService(environment('redis://127.0.0.1:1'), quiet);
    try {
      assert.equal((await dead.consume('json', client)).allowed, true);
    } finally {
      dead.onModuleDestroy();
    }
  },
);
