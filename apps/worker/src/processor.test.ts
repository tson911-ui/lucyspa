import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnrecoverableError } from 'bullmq';
import { processSystemCheck } from './processor.js';

test('worker fails unregistered jobs instead of acknowledging business work', () => {
  assert.throws(() => processSystemCheck({ name: 'email', data: {} }), UnrecoverableError);
  assert.throws(
    () => processSystemCheck({ name: 'ping', data: { nonce: 'bad' } }),
    UnrecoverableError,
  );
});
