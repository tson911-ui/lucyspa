import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import {
  addDays,
  bucketStart,
  bucketStarts,
  daysInclusive,
  defaultBucket,
  isBusinessDate,
  parseBucket,
  parseRange,
  previousRange,
} from './report.dates.js';

const code = (work: () => unknown): string | undefined => {
  try {
    work();
  } catch (error) {
    return error instanceof AuthError ? error.code : 'OTHER';
  }
  return undefined;
};

test('business dates are real calendar dates in YYYY-MM-DD', () => {
  for (const good of ['2026-10-12', '2024-02-29', '2026-12-31'])
    assert.equal(isBusinessDate(good), true, good);
  for (const bad of ['2026-02-29', '2026-13-01', '2026-1-1', '2026-10-12T00:00:00Z', '', 5, null])
    assert.equal(isBusinessDate(bad), false, String(bad));
});

test('days are counted on the calendar, across month, year and leap days', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(daysInclusive('2026-10-12', '2026-10-12'), 1);
  assert.equal(daysInclusive('2024-01-01', '2024-12-31'), 366);
});

test('a range is closed on both ends, ordered, and at most 366 days', () => {
  assert.deepEqual(parseRange({ from: '2026-10-01', to: '2026-10-07' }), {
    from: '2026-10-01',
    to: '2026-10-07',
    days: 7,
  });
  assert.equal(
    code(() => parseRange({ from: '2026-10-08', to: '2026-10-07' })),
    'REPORT_RANGE_INVALID',
  );
  assert.equal(
    code(() => parseRange({ from: '2026-01-01', to: '2027-01-02' })),
    'REPORT_RANGE_TOO_LONG',
  );
  assert.equal(
    code(() => parseRange({ from: '2024-01-01', to: '2024-12-31' })),
    undefined,
  );
  assert.equal(
    code(() => parseRange({ from: '2026-01-01' })),
    'VALIDATION_FAILED',
  );
  assert.equal(
    code(() => parseRange({ from: '2026-02-30', to: '2026-03-01' })),
    'VALIDATION_FAILED',
  );
});

test('the previous period has the same length and ends the day before', () => {
  assert.deepEqual(previousRange({ from: '2026-10-08', to: '2026-10-14', days: 7 }), {
    from: '2026-10-01',
    to: '2026-10-07',
    days: 7,
  });
  assert.deepEqual(previousRange({ from: '2026-03-01', to: '2026-03-31', days: 31 }), {
    from: '2026-01-29',
    to: '2026-02-28',
    days: 31,
  });
});

test('weeks start on Monday; quarters and years are calendar', () => {
  assert.equal(bucketStart('2026-10-12', 'week'), '2026-10-12'); // a Monday
  assert.equal(bucketStart('2026-10-18', 'week'), '2026-10-12'); // the Sunday of that week
  assert.equal(bucketStart('2026-10-19', 'week'), '2026-10-19');
  assert.equal(bucketStart('2026-01-01', 'week'), '2025-12-29');
  assert.equal(bucketStart('2026-08-31', 'month'), '2026-08-01');
  assert.equal(bucketStart('2026-08-31', 'quarter'), '2026-07-01');
  assert.equal(bucketStart('2026-11-05', 'quarter'), '2026-10-01');
  assert.equal(bucketStart('2026-11-05', 'year'), '2026-01-01');
});

test('every bucket of a range is listed once, in order, including empty ones', () => {
  assert.deepEqual(bucketStarts({ from: '2026-10-29', to: '2026-11-02', days: 5 }, 'day'), [
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
  ]);
  assert.deepEqual(bucketStarts({ from: '2026-10-14', to: '2026-11-03', days: 21 }, 'week'), [
    '2026-10-12',
    '2026-10-19',
    '2026-10-26',
    '2026-11-02',
  ]);
  assert.deepEqual(bucketStarts({ from: '2026-11-15', to: '2027-02-01', days: 79 }, 'month'), [
    '2026-11-01',
    '2026-12-01',
    '2027-01-01',
    '2027-02-01',
  ]);
  assert.deepEqual(bucketStarts({ from: '2026-05-01', to: '2027-02-01', days: 277 }, 'quarter'), [
    '2026-04-01',
    '2026-07-01',
    '2026-10-01',
    '2027-01-01',
  ]);
  assert.deepEqual(bucketStarts({ from: '2025-06-01', to: '2026-06-01', days: 366 }, 'year'), [
    '2025-01-01',
    '2026-01-01',
  ]);
});

test('the default bucket keeps a chart near fifty points; a requested bucket must be known', () => {
  assert.equal(defaultBucket(30), 'day');
  assert.equal(defaultBucket(90), 'week');
  assert.equal(defaultBucket(366), 'month');
  const range = { from: '2026-10-01', to: '2026-10-31', days: 31 };
  assert.equal(parseBucket(undefined, range), 'day');
  assert.equal(parseBucket('month', range), 'month');
  assert.equal(
    code(() => parseBucket('hour', range)),
    'VALIDATION_FAILED',
  );
});
