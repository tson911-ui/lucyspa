import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CACHED_READ_MS,
  cachedRead,
  clearCachedReads,
  invalidateCachedReads,
  peekCachedRead,
} from './fetch-cache';

test('reads with one key share one request while it is in flight, and reuse the answer for a short while', async () => {
  clearCachedReads();
  let calls = 0;
  const load = () => {
    calls += 1;
    return Promise.resolve({ n: calls });
  };
  const [a, b] = await Promise.all([
    cachedRead('/me/bookings', load),
    cachedRead('/me/bookings', load),
  ]);
  assert.equal(calls, 1, 'one request for two readers');
  assert.equal(a, b);
  assert.deepEqual(peekCachedRead('/me/bookings'), { n: 1 });
  await cachedRead('/me/bookings', load);
  assert.equal(calls, 1, 'a recent answer is reused');
  // After the short window the next read asks again.
  await cachedRead('/me/bookings', load, Date.now() + CACHED_READ_MS + 1);
  assert.equal(calls, 2);
});

test('a failed read is never kept; a write or a change of session forgets the reads it changes', async () => {
  clearCachedReads();
  let calls = 0;
  await assert.rejects(
    cachedRead('/me/invoices', () => {
      calls += 1;
      return Promise.reject(new Error('offline'));
    }),
  );
  await cachedRead('/me/invoices', () => {
    calls += 1;
    return Promise.resolve('ok');
  });
  assert.equal(calls, 2, 'the failure was not reused');
  await cachedRead('/me/bookings/1', () => Promise.resolve('one'));
  invalidateCachedReads('/me/bookings');
  assert.equal(peekCachedRead('/me/bookings/1'), undefined);
  assert.equal(peekCachedRead('/me/invoices'), 'ok');
  clearCachedReads();
  assert.equal(peekCachedRead('/me/invoices'), undefined);
});
