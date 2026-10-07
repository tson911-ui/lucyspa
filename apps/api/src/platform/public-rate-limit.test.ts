import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { pino } from 'pino';
import { AuthError } from '../auth/auth.error.js';
import {
  budgetOf,
  clientIdentity,
  isPrivateAddress,
  PUBLIC_LIMITS,
  windowKey,
} from './public-rate-limit.core.js';
import { PublicRateLimitGuard } from './public-rate-limit.guard.js';
import { PublicRateLimitService, type WindowCounter } from './public-rate-limit.service.js';
import type { ApiEnvironment } from './tokens.js';

test('private, loopback and link-local addresses are proxy hops, never visitors', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '169.254.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.5',
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '1.2.3.4', '2001:db8::1', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('the client is the first outside address from the right of X-Forwarded-For', () => {
  const real = clientIdentity('203.0.113.9, 127.0.0.1');
  assert.ok(real?.known);
  // What the client wrote on the left cannot choose its own budget: nginx appended the real address to the right of it.
  const spoofed = clientIdentity('198.51.100.7, 203.0.113.9, 127.0.0.1');
  assert.deepEqual(spoofed, real);
  assert.notDeepEqual(clientIdentity('198.51.100.7, 127.0.0.1'), real);
  assert.deepEqual(clientIdentity('203.0.113.9:51234, ::ffff:127.0.0.1'), real);
  assert.deepEqual(clientIdentity(['203.0.113.9', '127.0.0.1']), real);
  // Junk and private entries are skipped; the digest never contains the address.
  assert.deepEqual(clientIdentity('not-an-ip, 203.0.113.9, 10.0.0.2, unknown'), real);
  assert.ok(!real?.id.includes('203'));
  assert.match(real?.id ?? '', /^[0-9a-f]{16}$/);
});

test('a request with no forwarded header is the website itself (not counted); only private hops share one budget', () => {
  assert.equal(clientIdentity(undefined), null);
  assert.equal(clientIdentity('   '), null);
  assert.deepEqual(clientIdentity('127.0.0.1'), { id: 'unknown', known: false });
  assert.deepEqual(clientIdentity('192.168.1.5, 127.0.0.1'), { id: 'unknown', known: false });
});

test('an IPv6 visitor is counted per /64: another address inside it is not a new visitor', () => {
  const a = clientIdentity('2001:db8:1:2:aaaa::1, 127.0.0.1');
  const b = clientIdentity('2001:db8:1:2:bbbb::9, 127.0.0.1');
  const other = clientIdentity('2001:db8:1:3::1, 127.0.0.1');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, other);
});

test('an IPv4 visitor written the IPv6 way is the same visitor, and IPv4-mapped visitors are not one shared budget', () => {
  const plain = clientIdentity('203.0.113.9, 127.0.0.1');
  assert.deepEqual(clientIdentity('::ffff:203.0.113.9, 127.0.0.1'), plain);
  assert.notDeepEqual(clientIdentity('::ffff:203.0.113.10, 127.0.0.1'), plain);
});

test('pictures draw on their own, larger budget', () => {
  assert.equal(budgetOf('/api/v1/public/media/abc/md'), 'media');
  assert.equal(budgetOf('/api/v1/public/products'), 'json');
  assert.equal(budgetOf('/api/v1/public/site'), 'json');
  assert.ok(PUBLIC_LIMITS.media.perClient > PUBLIC_LIMITS.json.perClient);
  assert.ok(PUBLIC_LIMITS.json.total > PUBLIC_LIMITS.json.perClient);
  assert.equal(windowKey('json', 'abc', 7), 'lucy:rl:public:json:abc:7');
});

class MapCounter implements WindowCounter {
  readonly counts = new Map<string, number>();
  readonly lifetimes: number[] = [];
  async increment(keys: readonly string[], lifetimeSeconds: number): Promise<number[]> {
    this.lifetimes.push(lifetimeSeconds);
    return keys.map((key) => {
      const next = (this.counts.get(key) ?? 0) + 1;
      this.counts.set(key, next);
      return next;
    });
  }
}

const quiet = pino({ level: 'silent' });
const service = (counter: WindowCounter) => {
  const limiter = new PublicRateLimitService({} as ApiEnvironment, quiet);
  limiter.useCounter(counter);
  return limiter;
};
const contextOf = (path: string, forwardedFor: string | undefined, headers: Map<string, string>) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        path,
        headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
      }),
      getResponse: () => ({ setHeader: (name: string, value: string) => headers.set(name, value) }),
    }),
  }) as unknown as ExecutionContext;

test('the guard lets a client through up to its budget, then answers 429 with Retry-After', async () => {
  const counter = new MapCounter();
  const guard = new PublicRateLimitGuard(service(counter));
  const headers = new Map<string, string>();
  const ask = (forwardedFor: string) =>
    guard.canActivate(contextOf('/api/v1/public/products', forwardedFor, headers));
  for (let hit = 0; hit < PUBLIC_LIMITS.json.perClient; hit += 1) {
    assert.equal(await ask('203.0.113.9, 127.0.0.1'), true);
  }
  await assert.rejects(
    ask('203.0.113.9, 127.0.0.1'),
    (error) => error instanceof AuthError && error.code === 'RATE_LIMITED',
  );
  const retry = Number(headers.get('retry-after'));
  assert.ok(retry >= 1 && retry <= 60, `retry-after ${retry}`);
  // Another visitor is unaffected; the pictures have their own budget.
  assert.equal(await ask('203.0.113.77, 127.0.0.1'), true);
  assert.equal(
    await guard.canActivate(
      contextOf('/api/v1/public/media/x/md', '203.0.113.9, 127.0.0.1', headers),
    ),
    true,
  );
  // Counters expire by themselves (two windows) so Redis never keeps old windows.
  assert.ok(counter.lifetimes.every((seconds) => seconds === 120));
});

test("the website's own server is never counted, however often it asks", async () => {
  const counter = new MapCounter();
  const guard = new PublicRateLimitGuard(service(counter));
  for (let hit = 0; hit < PUBLIC_LIMITS.json.total + 10; hit += 1) {
    assert.equal(
      await guard.canActivate(contextOf('/api/v1/public/products', undefined, new Map())),
      true,
    );
  }
  assert.equal(counter.counts.size, 0);
});

test('every outside client together is capped, and clients without a readable address share one budget', async () => {
  const counter = new MapCounter();
  const limiter = service(counter);
  const now = Date.UTC(2026, 9, 7, 12, 0, 10);
  const nobody = { id: 'unknown', known: false };
  for (let hit = 0; hit < PUBLIC_LIMITS.json.total; hit += 1) {
    assert.equal((await limiter.consume('json', nobody, now)).allowed, true);
  }
  const refused = await limiter.consume('json', nobody, now);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 50);
  // The next window starts clean.
  assert.equal((await limiter.consume('json', nobody, now + 60_000)).allowed, true);
});

test('Redis trouble lets the request through instead of failing a public page', async () => {
  const broken: WindowCounter = {
    increment: async () => {
      throw new Error('connection refused');
    },
  };
  const decision = await service(broken).consume('json', { id: 'abc', known: true });
  assert.equal(decision.allowed, true);
});
