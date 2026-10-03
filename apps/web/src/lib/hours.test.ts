import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hoursLines, hoursRange, weekdayRuns, weekdaysLabel } from './hours';

test('weekday runs split on gaps', () => {
  assert.deepEqual(weekdayRuns([1, 2, 3, 5]), [[1, 2, 3], [5]]);
  assert.deepEqual(weekdayRuns([7, 1, 2]), [[1, 2], [7]]);
  assert.deepEqual(weekdayRuns([]), []);
});

test('weekday labels: every day, a range, a pair, a single day, separate days', () => {
  assert.equal(weekdaysLabel([1, 2, 3, 4, 5, 6, 7], 'vi'), 'Mỗi ngày');
  assert.equal(weekdaysLabel([1, 2, 3, 4, 5, 6, 7], 'en'), 'Every day');
  assert.equal(weekdaysLabel([1, 2, 3, 4, 5], 'vi'), 'Thứ Hai – Thứ Sáu');
  assert.equal(weekdaysLabel([6, 7], 'vi'), 'Thứ Bảy, Chủ nhật');
  assert.equal(weekdaysLabel([7], 'en'), 'Sunday');
  assert.equal(weekdaysLabel([1, 3], 'en'), 'Monday, Wednesday');
  assert.equal(weekdaysLabel([1, 2, 3, 5, 6, 7], 'vi'), 'Thứ Hai – Thứ Tư, Thứ Sáu – Chủ nhật');
});

test('hours lines carry the range or the closed label', () => {
  const groups = [
    { weekdays: [1, 2, 3, 4, 5, 6], closed: false, opensAt: '09:00', closesAt: '21:00' },
    { weekdays: [7], closed: true, opensAt: null, closesAt: null },
  ];
  assert.deepEqual(hoursLines(groups, 'vi', 'Đóng cửa'), [
    { label: 'Thứ Hai – Thứ Bảy', value: '09:00 – 21:00' },
    { label: 'Chủ nhật', value: 'Đóng cửa' },
  ]);
  assert.equal(hoursRange(groups[1]!, 'Closed'), 'Closed');
});
