import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ShortCache } from './short-cache.js';

test('a value is reused for the lifetime and read again after it', async () => {
  let clock = 1_000;
  let reads = 0;
  const cache = new ShortCache<number>(5_000, 10, () => clock);
  const load = async () => ++reads;
  assert.equal(await cache.get('a', load), 1);
  clock += 4_999;
  assert.equal(await cache.get('a', load), 1);
  clock += 1;
  assert.equal(await cache.get('a', load), 2);
  assert.equal(await cache.get('b', load), 3);
});

test('requests that arrive together share one read', async () => {
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const cache = new ShortCache<string>(5_000, 10);
  const load = async () => {
    reads += 1;
    await gate;
    return 'page';
  };
  const asked = Array.from({ length: 50 }, () => cache.get('same', load));
  release();
  assert.deepEqual(new Set(await Promise.all(asked)), new Set(['page']));
  assert.equal(reads, 1);
});

test('a failure is not remembered: the next request reads again', async () => {
  let reads = 0;
  const cache = new ShortCache<string>(5_000, 10);
  const load = async () => {
    reads += 1;
    if (reads === 1) throw new Error('database busy');
    return 'ok';
  };
  await assert.rejects(cache.get('k', load), /database busy/);
  assert.equal(await cache.get('k', load), 'ok');
  assert.equal(reads, 2);
});

test('the memory is capped: the oldest entry goes first', async () => {
  let reads = 0;
  const cache = new ShortCache<number>(60_000, 2);
  const load = async () => ++reads;
  await cache.get('a', load);
  await cache.get('b', load);
  await cache.get('c', load);
  assert.equal(reads, 3);
  await cache.get('b', load);
  await cache.get('c', load);
  assert.equal(reads, 3, 'b and c are still remembered');
  await cache.get('a', load);
  assert.equal(reads, 4, 'a was dropped');
});
