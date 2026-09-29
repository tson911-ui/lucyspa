import assert from 'node:assert/strict';
import { test } from 'node:test';
import { elapsedMinutes, reasonBody, resolveEndBody } from './visit-completion';

const base = {
  startedAt: '2026-09-30T02:00:00.000Z',
  expectedEndAt: '2026-09-30T03:00:00.000Z',
  now: '2026-09-30T04:00:00.000Z',
};

test('a reason is required, trimmed and bounded', () => {
  assert.equal(reasonBody('   '), null);
  assert.deepEqual(reasonBody('  quên kết thúc  '), { reason: 'quên kết thúc' });
  assert.equal(reasonBody('x'.repeat(501)), null);
  assert.deepEqual(reasonBody('x'.repeat(500)), { reason: 'x'.repeat(500) });
});

test('NOW omits the end time so the server clock decides', () => {
  assert.deepEqual(resolveEndBody({ ...base, reason: 'r', mode: 'NOW', minutes: '' }), {
    reason: 'r',
  });
  assert.equal(resolveEndBody({ ...base, reason: '', mode: 'NOW', minutes: '' }), null);
});

test('EXPECTED is only produced once the planned end has passed', () => {
  assert.deepEqual(resolveEndBody({ ...base, reason: 'r', mode: 'EXPECTED', minutes: '' }), {
    reason: 'r',
    endedAt: '2026-09-30T03:00:00.000Z',
  });
  assert.equal(
    resolveEndBody({
      ...base,
      now: '2026-09-30T02:30:00.000Z',
      reason: 'r',
      mode: 'EXPECTED',
      minutes: '',
    }),
    null,
  );
});

test('MINUTES stays between the start and the server time', () => {
  assert.deepEqual(resolveEndBody({ ...base, reason: 'r', mode: 'MINUTES', minutes: '90' }), {
    reason: 'r',
    endedAt: '2026-09-30T03:30:00.000Z',
  });
  assert.equal(resolveEndBody({ ...base, reason: 'r', mode: 'MINUTES', minutes: '121' }), null);
  for (const bad of ['0', '-5', '1.5', '', 'abc', '012'])
    assert.equal(resolveEndBody({ ...base, reason: 'r', mode: 'MINUTES', minutes: bad }), null);
});

test('elapsed minutes never go negative', () => {
  assert.equal(elapsedMinutes(base.startedAt, base.now), 120);
  assert.equal(elapsedMinutes(base.now, base.startedAt), 0);
});
