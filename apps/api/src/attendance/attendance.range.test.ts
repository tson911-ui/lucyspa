import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import { attendanceRange } from './attendance.service.js';

const day = (date: Date) => date.toISOString().slice(0, 10);

function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// Step 10A release-gate regression, with a fixed clock.
test('default window includes a branch-local date one day ahead of the UTC date', () => {
  // UTC date D = 2026-09-25, while Kiritimati (UTC+14) is already on D + 1.
  const now = new Date('2026-09-25T11:13:00.000Z');
  assert.equal(localDate(now, 'Pacific/Kiritimati'), '2026-09-26');
  const { from, to } = attendanceRange({}, now);
  assert.deepEqual([day(from), day(to)], ['2026-08-27', '2026-09-26']);
  for (const zone of ['Pacific/Kiritimati', 'Asia/Ho_Chi_Minh', 'UTC', 'Pacific/Pago_Pago']) {
    const businessDate = localDate(now, zone);
    assert.ok(businessDate >= day(from) && businessDate <= day(to), zone);
  }
  // Just after UTC midnight and just before it: the bound follows the UTC date only.
  assert.equal(day(attendanceRange({}, new Date('2026-09-25T00:00:30Z')).to), '2026-09-26');
  assert.equal(day(attendanceRange({}, new Date('2026-09-25T23:59:30Z')).to), '2026-09-26');
});

test('explicit dates and range limits are unchanged', () => {
  const now = new Date('2026-09-25T11:13:00.000Z');
  const exact = attendanceRange({ from: '2026-09-01', to: '2026-09-10' }, now);
  assert.deepEqual([day(exact.from), day(exact.to)], ['2026-09-01', '2026-09-10']);
  const untilTo = attendanceRange({ to: '2026-09-10' }, now);
  assert.deepEqual([day(untilTo.from), day(untilTo.to)], ['2026-08-11', '2026-09-10']);
  const fromOnly = attendanceRange({ from: '2026-09-01' }, now);
  assert.deepEqual([day(fromOnly.from), day(fromOnly.to)], ['2026-09-01', '2026-09-26']);
  const invalid = (query: Parameters<typeof attendanceRange>[0]) =>
    assert.throws(
      () => attendanceRange(query, now),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'VALIDATION_FAILED' && error.field === 'from',
    );
  invalid({ from: '2026-09-10', to: '2026-09-01' });
  invalid({ from: '2026-01-01', to: '2026-12-31' });
  invalid({ from: '2026-06-01' }); // more than 93 days before the default upper bound
  assert.doesNotThrow(() => attendanceRange({ from: '2026-06-26' }, now)); // exactly 93 days
});
