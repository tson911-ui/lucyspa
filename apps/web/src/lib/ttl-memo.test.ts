import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { clearTtlMemo, ttlMemo } from './ttl-memo';

beforeEach(() => clearTtlMemo());

test('an answer, including "nothing", is remembered for the TTL and then read again', async () => {
  let clock = 0;
  let reads = 0;
  const load = async () => ({ value: reads++ === 0 ? 'season' : null, ok: true });
  const options = { ttlMs: 1_000, now: () => clock };
  assert.equal(await ttlMemo('season:vi', load, options), 'season');
  clock = 999;
  assert.equal(await ttlMemo('season:vi', load, options), 'season', 'still fresh');
  clock = 1_001;
  // The API now says "no season": that answer replaces the old one (Next's fetch cache would have kept the old 200).
  assert.equal(await ttlMemo('season:vi', load, options), null);
  clock = 1_500;
  assert.equal(await ttlMemo('season:vi', load, options), null, '"nothing" is remembered too');
  assert.equal(reads, 2);
});

test('a failure is remembered only briefly, so it is retried soon', async () => {
  let clock = 0;
  let reads = 0;
  const load = async () =>
    reads++ === 0 ? { value: null, ok: false } : { value: 'back', ok: true };
  const options = { ttlMs: 60_000, failureTtlMs: 5_000, now: () => clock };
  assert.equal(await ttlMemo('site:vi', load, options), null);
  clock = 4_000;
  assert.equal(await ttlMemo('site:vi', load, options), null);
  clock = 5_001;
  assert.equal(await ttlMemo('site:vi', load, options), 'back');
  assert.equal(reads, 2);
});

test('a loader that throws counts as a failure; a burst shares one read', async () => {
  let reads = 0;
  const slow = async () => {
    reads += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { value: 'x', ok: true };
  };
  const burst = await Promise.all([1, 2, 3, 4].map(() => ttlMemo('burst', slow)));
  assert.deepEqual(burst, ['x', 'x', 'x', 'x']);
  assert.equal(reads, 1);
  assert.equal(await ttlMemo('boom', async () => Promise.reject(new Error('down'))), null);
});

test('keys are independent', async () => {
  assert.equal(await ttlMemo('a', async () => ({ value: 1, ok: true })), 1);
  assert.equal(await ttlMemo('b', async () => ({ value: 2, ok: true })), 2);
  assert.equal(await ttlMemo('a', async () => ({ value: 9, ok: true })), 1);
});
