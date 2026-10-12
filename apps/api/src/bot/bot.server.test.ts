import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { RateWindow, authorized, createBotHandler } from './bot.server.js';
import { BotError } from './bot.service.js';

const KEY = 'k'.repeat(48);
const calls: string[] = [];
const data = {
  shop: (q: URLSearchParams) => {
    calls.push(`shop?${q.toString()}`);
    return { locale: 'vi', shop: { name: 'Lucy Spa' } };
  },
  services: () => ({ groups: [] }),
  promotions: () => ({ promotions: [] }),
  products: () => ({ products: { items: [] } }),
  availability: (q: URLSearchParams) => {
    if (q.get('date') === 'bad') throw new BotError(400, 'DATE');
    if (q.get('date') === 'boom') throw new Error('database password is hunter2');
    return { availability: { starts: ['09:00'] } };
  },
  knowledge: () => ({ shop: {} }),
  health: () => ({ ok: true, version: 'bot-v1' }),
};

let server: Server;
let base = '';
let clock = 1_000_000;
before(async () => {
  const handler = createBotHandler(data, KEY, { now: () => clock, limit: 5 });
  server = createServer((request, response) => void handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers: { authorization: `Bearer ${KEY}`, ...headers } });

test('the secret is compared as a whole: right key only, any other header shape is refused', () => {
  assert.equal(authorized(`Bearer ${KEY}`, KEY), true);
  for (const header of [
    undefined,
    '',
    KEY,
    `Bearer ${KEY}x`,
    `Bearer ${KEY.slice(1)}`,
    `bearer ${KEY}`,
    `Bearer  ${KEY}`,
    `Basic ${KEY}`,
  ]) {
    assert.equal(authorized(header, KEY), false, String(header));
  }
});

test('the rate window allows its limit, then tells how long to wait, then opens again', () => {
  const window = new RateWindow(2, 60_000);
  assert.equal(window.take(0), 0);
  assert.equal(window.take(1_000), 0);
  assert.equal(window.take(2_000), 58);
  assert.equal(window.take(59_999), 1);
  assert.equal(window.take(60_000), 0);
});

test('no key or a wrong key is the same 401 and reveals nothing, not even whether a path exists', async () => {
  const none = await fetch(`${base}/bot/v1/shop`);
  const wrong = await fetch(`${base}/bot/v1/shop`, { headers: { authorization: 'Bearer nope' } });
  const unknown = await fetch(`${base}/bot/v1/does-not-exist`);
  for (const response of [none, wrong, unknown]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.deepEqual(await response.json(), { error: 'UNAUTHORIZED' });
  }
  assert.equal(calls.length, 0, 'nothing was read for an unauthenticated caller');
});

test('only GET: every other method is refused after the key check; unknown paths are 404', async () => {
  clock = 2_000_000;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(`${base}/bot/v1/shop`, {
      method,
      headers: { authorization: `Bearer ${KEY}` },
    });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'GET');
  }
  assert.equal((await get('/bot/v1/nothing')).status, 404);
  assert.equal((await get('/admin')).status, 404);
  assert.equal(calls.length, 0);
});

test('answers: JSON, no browser caching of secrets, an ETag, a 304 for the same tag, and the cache serves repeated reads', async () => {
  clock = 3_000_000;
  const first = await get('/bot/v1/shop?locale=vi&b=2&a=1');
  assert.equal(first.status, 200);
  assert.match(first.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  const etag = first.headers.get('etag')!;
  assert.match(etag, /^"[0-9a-f]{40}"$/);
  assert.deepEqual(await first.json(), { locale: 'vi', shop: { name: 'Lucy Spa' } });
  const again = await get('/bot/v1/shop?a=1&b=2&locale=vi', { 'if-none-match': etag });
  assert.equal(again.status, 304);
  assert.equal(
    calls.filter((entry) => entry.startsWith('shop?')).length,
    1,
    'the second read came from the cache (same query in another order)',
  );
  // After the cache time the data is read again.
  clock += 61_000;
  assert.equal((await get('/bot/v1/shop?locale=vi&b=2&a=1')).status, 200);
  assert.equal(calls.filter((entry) => entry.startsWith('shop?')).length, 2);
});

test('errors: a named failure keeps its status, an unexpected one is a bare 500 that never repeats the message', async () => {
  clock = 4_000_000;
  const bad = await get('/bot/v1/availability?date=bad');
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'DATE' });
  clock = 5_000_000;
  const boom = await get('/bot/v1/availability?date=boom');
  assert.equal(boom.status, 500);
  const text = await boom.text();
  assert.deepEqual(JSON.parse(text), { error: 'INTERNAL' });
  assert.ok(!text.includes('hunter2'));
  assert.deepEqual(await (await get('/bot/v1/health')).json(), { ok: true, version: 'bot-v1' });
});

test('rate limit: past the limit a 429 with Retry-After, and the window opens again by itself', async () => {
  clock = 10_000_000;
  const statuses: number[] = [];
  for (let n = 0; n < 7; n += 1) statuses.push((await get('/bot/v1/health')).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
  const limited = await get('/bot/v1/health');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  // A wrong key does not use up the window of the right one.
  const before401 = await fetch(`${base}/bot/v1/health`, {
    headers: { authorization: 'Bearer nope' },
  });
  assert.equal(before401.status, 401);
  clock += 61_000;
  assert.equal((await get('/bot/v1/health')).status, 200);
});
