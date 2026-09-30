import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  addMonths,
  addYears,
  calendarKeyTarget,
  comparisonRange,
  diffDays,
  exceedsMax,
  formatDay,
  formatRange,
  isIsoDate,
  matchPreset,
  monthGrid,
  normalizeRange,
  presetRange,
  rangeDays,
} from './date-range-core';

const TODAY = '2026-09-30';

test('business dates are validated as real calendar dates', () => {
  assert.equal(isIsoDate('2026-09-30'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-9-3'), false);
  assert.equal(isIsoDate('not a date'), false);
});

test('date arithmetic crosses month and year ends and leap days', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(diffDays('2026-09-01', '2026-09-30'), 29);
  assert.equal(rangeDays({ from: '2026-09-01', to: '2026-09-30' }), 30);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-01', 'months move by the month start');
  assert.equal(addYears('2028-02-29', -1), '2027-02-28', '29 February falls back to 28 February');
  assert.equal(addYears('2026-09-30', -1), '2025-09-30');
});

test('presets are computed from the branch business date, not from a clock', () => {
  assert.deepEqual(presetRange('today', TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(presetRange('yesterday', TODAY), { from: '2026-09-29', to: '2026-09-29' });
  assert.deepEqual(presetRange('last7', TODAY), { from: '2026-09-24', to: TODAY });
  assert.deepEqual(presetRange('last30', TODAY), { from: '2026-09-01', to: TODAY });
  assert.deepEqual(presetRange('thisMonth', '2026-09-15'), {
    from: '2026-09-01',
    to: '2026-09-15',
  });
  assert.deepEqual(presetRange('lastMonth', '2026-03-10'), {
    from: '2026-02-01',
    to: '2026-02-28',
  });
  assert.deepEqual(presetRange('lastMonth', '2026-01-10'), {
    from: '2025-12-01',
    to: '2025-12-31',
  });
  assert.equal(rangeDays(presetRange('last7', TODAY)), 7);
  assert.equal(rangeDays(presetRange('last30', TODAY)), 30);
});

test('the active preset is recognised; anything else is custom', () => {
  assert.equal(matchPreset({ from: '2026-09-24', to: TODAY }, TODAY), 'last7');
  assert.equal(matchPreset({ from: '2026-09-23', to: TODAY }, TODAY), null);
  assert.equal(matchPreset(null, TODAY), null);
});

test('comparison range: same length right before, or the same dates one year earlier', () => {
  const range = { from: '2026-09-24', to: '2026-09-30' };
  assert.deepEqual(comparisonRange(range, 'previous'), { from: '2026-09-17', to: '2026-09-23' });
  assert.deepEqual(comparisonRange(range, 'lastYear'), { from: '2025-09-24', to: '2025-09-30' });
  assert.equal(comparisonRange(range, 'none'), null);
  const single = { from: TODAY, to: TODAY };
  assert.deepEqual(comparisonRange(single, 'previous'), { from: '2026-09-29', to: '2026-09-29' });
  const month = { from: '2026-03-01', to: '2026-03-31' };
  const before = comparisonRange(month, 'previous')!;
  assert.equal(rangeDays(before), rangeDays(month));
  assert.equal(before.to, '2026-02-28');
  const leap = comparisonRange({ from: '2028-02-01', to: '2028-02-29' }, 'lastYear')!;
  assert.deepEqual(leap, { from: '2027-02-01', to: '2027-02-28' });
});

test('ranges are ordered and limited to the maximum length', () => {
  assert.deepEqual(normalizeRange('2026-09-30', '2026-09-01'), {
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.equal(exceedsMax({ from: '2026-01-01', to: '2026-12-31' }, 366), false);
  assert.equal(exceedsMax({ from: '2026-01-01', to: '2027-01-02' }, 366), true);
});

test('month grid: full weeks starting on Monday, days outside the month flagged', () => {
  const weeks = monthGrid('2026-09-15', 1);
  assert.ok(weeks.every((week) => week.length === 7));
  assert.equal(weeks[0]![0]!.date, '2026-08-31', '1 September 2026 is a Tuesday');
  assert.equal(weeks[0]![0]!.inMonth, false);
  assert.equal(weeks[0]![1]!.date, '2026-09-01');
  assert.equal(weeks.at(-1)!.at(-1)!.date, '2026-10-04');
  assert.equal(weeks.flat().filter((day) => day.inMonth).length, 30);
  assert.equal(monthGrid('2026-09-15', 0)[0]![0]!.date, '2026-08-30', 'Sunday start');
});

test('calendar keys: arrows step a day or week, PageUp/PageDown a month, Home/End the week', () => {
  assert.equal(calendarKeyTarget('ArrowRight', '2026-09-30'), '2026-10-01');
  assert.equal(calendarKeyTarget('ArrowLeft', '2026-09-01'), '2026-08-31');
  assert.equal(calendarKeyTarget('ArrowDown', '2026-09-30'), '2026-10-07');
  assert.equal(calendarKeyTarget('ArrowUp', '2026-09-30'), '2026-09-23');
  assert.equal(
    calendarKeyTarget('PageDown', '2026-01-31'),
    '2026-02-28',
    'the day clamps to a shorter month',
  );
  assert.equal(calendarKeyTarget('PageUp', '2026-03-31'), '2026-02-28');
  assert.equal(calendarKeyTarget('Home', '2026-09-30'), '2026-09-28', 'Wednesday to Monday');
  assert.equal(calendarKeyTarget('End', '2026-09-30'), '2026-10-04');
  assert.equal(calendarKeyTarget('Enter', '2026-09-30'), null);
});

test('dates are shown from the calendar date, not shifted by a time zone', () => {
  assert.match(formatDay('2026-09-30', 'en'), /^30 Sep\w* 2026$/);
  assert.match(formatDay('2026-09-30', 'vi', 'long'), /Thứ Tư/);
  assert.match(formatRange({ from: '2026-09-30', to: '2026-09-30' }, 'en'), /^30 Sep\w* 2026$/);
  assert.match(
    formatRange({ from: '2026-09-24', to: '2026-09-30' }, 'en'),
    /^24 Sep\w* 2026 – 30 Sep\w* 2026$/,
  );
});
