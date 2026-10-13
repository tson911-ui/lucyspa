import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_RATE, ChatLimiter, type CounterStore } from './chat-limits.js';

class MapStore implements CounterStore {
  readonly counts = new Map<string, number>();
  readonly lifetimes = new Map<string, number>();
  down = false;

  async increment(key: string, lifetimeSeconds: number): Promise<number> {
    if (this.down) throw new Error('redis down');
    if (!this.counts.has(key)) this.lifetimes.set(key, lifetimeSeconds);
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

const NOW = new Date('2026-11-05T05:00:00Z');
const visitor = (id = 'addr1', session = 's1') => ({ addressId: id, sessionId: session });

test('eight messages a minute per address, then a wait that ends with the minute', async () => {
  const limiter = new ChatLimiter(new MapStore());
  for (let n = 0; n < CHAT_RATE.perAddressMinute; n += 1) {
    assert.deepEqual(
      await limiter.admitMessage({ visitor: visitor('a', `s${n}`), dailyCap: 300, now: NOW }),
      {
        kind: 'ADMITTED',
      },
    );
  }
  const over = await limiter.admitMessage({ visitor: visitor('a', 'sx'), dailyCap: 300, now: NOW });
  assert.equal(over.kind, 'RATE');
  assert.ok(over.kind === 'RATE' && over.retryAfterSeconds >= 1 && over.retryAfterSeconds <= 60);
  // Another address is not affected, and the next minute starts afresh.
  assert.equal(
    (await limiter.admitMessage({ visitor: visitor('b'), dailyCap: 300, now: NOW })).kind,
    'ADMITTED',
  );
  assert.equal(
    (
      await limiter.admitMessage({
        visitor: visitor('a', 'sy'),
        dailyCap: 300,
        now: new Date(NOW.getTime() + 60_000),
      })
    ).kind,
    'ADMITTED',
  );
});

test('forty an hour per address and thirty a day per session', async () => {
  const limiter = new ChatLimiter(new MapStore());
  // Spread over six minutes so the minute limit never trips: the hour limit does.
  let hourWall = false;
  for (let n = 0; n < 41; n += 1) {
    const now = new Date(NOW.getTime() + Math.floor(n / 8) * 60_000);
    const result = await limiter.admitMessage({
      visitor: visitor('h', `hs${n}`),
      dailyCap: 300,
      now,
    });
    if (n < 40) assert.equal(result.kind, 'ADMITTED', String(n));
    else hourWall = result.kind === 'RATE';
  }
  assert.equal(hourWall, true);
  const store = new MapStore();
  const second = new ChatLimiter(store);
  let wall: unknown = null;
  for (let n = 0; n < 31; n += 1) {
    // A new address each time: only the session is the same.
    const result = await second.admitMessage({
      visitor: visitor(`addr${n}`, 'same-session'),
      dailyCap: 300,
      now: NOW,
    });
    if (n < 30) assert.equal(result.kind, 'ADMITTED', String(n));
    else wall = result;
  }
  assert.equal((wall as { kind: string }).kind, 'RATE');
  assert.ok((wall as { retryAfterSeconds: number }).retryAfterSeconds > 60);
});

test('the shop daily cap: past it every visitor is sent to the callback form; zero means always; a new shop day starts over', async () => {
  const limiter = new ChatLimiter(new MapStore());
  for (let n = 0; n < 3; n += 1) {
    assert.equal(
      (await limiter.admitMessage({ visitor: visitor(`a${n}`, `s${n}`), dailyCap: 3, now: NOW }))
        .kind,
      'ADMITTED',
    );
  }
  assert.deepEqual(
    await limiter.admitMessage({ visitor: visitor('a9', 's9'), dailyCap: 3, now: NOW }),
    { kind: 'CAP' },
  );
  assert.deepEqual(
    await limiter.admitMessage({ visitor: visitor('z', 'sz'), dailyCap: 0, now: NOW }),
    { kind: 'CAP' },
  );
  // 17:00 UTC is midnight in Vietnam: the day count restarts.
  const tomorrow = new Date('2026-11-05T17:05:00Z');
  assert.equal(
    (await limiter.admitMessage({ visitor: visitor('t', 'st'), dailyCap: 3, now: tomorrow })).kind,
    'ADMITTED',
  );
});

test('the counters being down turns the bot off (closed), never lets messages through', async () => {
  const store = new MapStore();
  store.down = true;
  const limiter = new ChatLimiter(store);
  assert.deepEqual(await limiter.admitMessage({ visitor: visitor(), dailyCap: 300, now: NOW }), {
    kind: 'UNAVAILABLE',
  });
});

test('callback requests: five an hour and twelve a day per address, and a dead counter never blocks the form', async () => {
  const store = new MapStore();
  const limiter = new ChatLimiter(store);
  for (let n = 0; n < CHAT_RATE.callbackPerAddressHour; n += 1) {
    assert.equal((await limiter.admitCallback({ addressId: 'c', now: NOW })).kind, 'ADMITTED');
  }
  const over = await limiter.admitCallback({ addressId: 'c', now: NOW });
  assert.equal(over.kind, 'RATE');
  // Across hours the day limit applies.
  let last = 'ADMITTED';
  for (let hour = 1; hour < 6; hour += 1) {
    for (let n = 0; n < 5; n += 1) {
      last = (
        await limiter.admitCallback({
          addressId: 'd',
          now: new Date(NOW.getTime() + hour * 3_600_000),
        })
      ).kind;
    }
  }
  assert.equal(last, 'RATE');
  store.down = true;
  assert.equal((await limiter.admitCallback({ addressId: 'e', now: NOW })).kind, 'ADMITTED');
});

test('counter keys name no raw address or message and expire on their own', async () => {
  const store = new MapStore();
  await new ChatLimiter(store).admitMessage({
    visitor: visitor('abc123', 'sess-1'),
    dailyCap: 300,
    now: NOW,
  });
  for (const [key, lifetime] of store.lifetimes) {
    assert.match(key, /^lucy:chat:/);
    assert.ok(lifetime > 0 && lifetime <= 86_400 + 3_600, `${key} ${lifetime}`);
  }
});
