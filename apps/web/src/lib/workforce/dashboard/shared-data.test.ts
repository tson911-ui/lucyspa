import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SharedResources, type Timers } from './shared-data';

/** A manual clock: `tick()` fires the interval as often as the elapsed time allows. */
function clock() {
  let now = 1_000;
  let handler: (() => void) | null = null;
  let every = 0;
  let nextFire = 0;
  const timers: Timers = {
    setInterval: (fn, ms) => {
      handler = fn;
      every = ms;
      nextFire = now + ms;
      return 1;
    },
    clearInterval: () => {
      handler = null;
    },
    now: () => now,
  };
  return {
    timers,
    active: () => handler !== null,
    advance(ms: number) {
      now += ms;
      while (handler && now >= nextFire) {
        nextFire += every;
        handler();
      }
    },
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('one request per key however many widgets subscribe', async () => {
  const c = clock();
  const store = new SharedResources({ refreshMs: 300_000, timers: c.timers });
  let calls = 0;
  const loader = () => {
    calls += 1;
    return Promise.resolve({ n: calls });
  };
  const a = store.subscribe('today:b1', loader, () => undefined);
  const b = store.subscribe('today:b1', loader, () => undefined);
  const other = store.subscribe('board:b1', loader, () => undefined);
  await settle();
  assert.equal(calls, 2, 'one for today:b1 and one for board:b1');
  assert.deepEqual(store.snapshot('today:b1').data, { n: 1 });
  assert.equal(store.snapshot('today:b1').loading, false);
  a();
  b();
  other();
  store.dispose();
});

test('refreshes every period passively and keeps showing the old data meanwhile', async () => {
  const c = clock();
  const store = new SharedResources({ refreshMs: 300_000, timers: c.timers });
  const seen: boolean[] = [];
  let release: (() => void) | null = null;
  let calls = 0;
  const loader = (passive: boolean) => {
    seen.push(passive);
    calls += 1;
    const value = calls;
    return calls === 1
      ? Promise.resolve(value)
      : new Promise<number>((resolve) => {
          release = () => resolve(value);
        });
  };
  const off = store.subscribe('k', loader, () => undefined);
  await settle();
  c.advance(299_000);
  assert.equal(calls, 1, 'not before the period is over');
  c.advance(2_000);
  assert.equal(calls, 2);
  assert.deepEqual(seen, [false, true]);
  assert.equal(store.snapshot<number>('k').data, 1, 'old data stays while refreshing');
  assert.equal(store.snapshot('k').loading, false, 'no skeleton for a background refresh');
  release!();
  await settle();
  assert.equal(store.snapshot<number>('k').data, 2);
  off();
  assert.equal(c.active(), false, 'the timer stops with the last subscriber');
});

test('focus reloads only what is older than one period', async () => {
  const c = clock();
  const store = new SharedResources({ refreshMs: 300_000, timers: c.timers });
  let calls = 0;
  const off = store.subscribe(
    'k',
    () => Promise.resolve(++calls),
    () => undefined,
  );
  await settle();
  c.advance(10_000);
  store.refreshStale();
  await settle();
  assert.equal(calls, 1);
  c.advance(295_000);
  // The interval fired at 300 s already; a focus right after finds fresh data.
  await settle();
  const after = calls;
  store.refreshStale();
  await settle();
  assert.equal(calls, after);
  off();
});

test('errors keep old data, retry reloads, and the latest load wins', async () => {
  const c = clock();
  const store = new SharedResources({ timers: c.timers });
  let fail = true;
  const off = store.subscribe(
    'k',
    () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve('ok')),
    () => undefined,
  );
  await settle();
  assert.equal(store.snapshot('k').data, null);
  assert.ok(store.snapshot('k').error instanceof Error);
  fail = false;
  await store.reload('k');
  assert.equal(store.snapshot('k').data, 'ok');
  assert.equal(store.snapshot('k').error, null);
  off();
});

test('snapshots are stable between changes and idle for unknown keys', async () => {
  const store = new SharedResources({ timers: clock().timers });
  assert.equal(store.snapshot('none'), store.snapshot('none'));
  assert.equal(store.snapshot('none').data, null);
  let notified = 0;
  const off = store.subscribe(
    'k',
    () => Promise.resolve(1),
    () => (notified += 1),
  );
  await settle();
  const first = store.snapshot('k');
  assert.equal(store.snapshot('k'), first);
  assert.ok(notified >= 2, 'notified on loading and on data');
  off();
});
