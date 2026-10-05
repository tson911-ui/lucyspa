import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awaitThrottleWindowRoom, msToWindowEnd } from './throttle-window.js';

const at = (minute: number, second: number) => Date.UTC(2026, 9, 6, 0, minute, second);

test('the end of the 15-minute window is the next hh:00, hh:15, hh:30 or hh:45', () => {
  assert.equal(msToWindowEnd(at(0, 0)), 900_000);
  assert.equal(msToWindowEnd(at(14, 59)), 1_000);
  assert.equal(msToWindowEnd(at(44, 58)), 2_000);
  assert.equal(msToWindowEnd(at(45, 0)), 900_000);
});

test('a test that starts close to a boundary waits for the next window, else it starts at once', async () => {
  const waits: number[] = [];
  const sleep = (ms: number) => {
    waits.push(ms);
    return Promise.resolve();
  };
  assert.equal(await awaitThrottleWindowRoom(45_000, () => at(7, 0), sleep), 0);
  assert.equal(await awaitThrottleWindowRoom(45_000, () => at(14, 14), sleep), 0);
  // 00:44:58 (the moment run 6 of the loop started the budget test): two seconds left, so it waits past 00:45:00.
  assert.equal(await awaitThrottleWindowRoom(45_000, () => at(44, 58), sleep), 3_000);
  assert.equal(await awaitThrottleWindowRoom(45_000, () => at(14, 30), sleep), 31_000);
  assert.deepEqual(waits, [3_000, 31_000]);
});
