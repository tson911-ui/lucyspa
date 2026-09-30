import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_SERIES,
  deltaDirection,
  deltaPercent,
  deltaText,
  describePoint,
  formatDelta,
  formatTick,
  formatValue,
  formatX,
  labelIndexes,
  nearestIndex,
  plotKeyTarget,
  prepareChart,
  prepareSlices,
  seriesTable,
  sliceTable,
  slotColor,
  tooltipModel,
  valueExtent,
  xKey,
  type Comparison,
  type Series,
} from './chart-core';

const plain = (text: string) => text.replace(new RegExp('[\u00a0\u202f]', 'g'), ' ');
const vi = (valueFormat: 'vnd' | 'count' | 'percent' | 'duration') => ({
  valueFormat,
  locale: 'vi' as const,
});
const en = (valueFormat: 'vnd' | 'count' | 'percent' | 'duration') => ({
  valueFormat,
  locale: 'en' as const,
});
const words = { up: 'tăng', down: 'giảm', flat: 'không đổi', previous: 'Kỳ trước' };

function series(id: string, label: string, ys: number[], start = 1): Series {
  return {
    id,
    label,
    points: ys.map((y, index) => ({ x: `2026-09-${String(start + index).padStart(2, '0')}`, y })),
  };
}

test('VND has grouping and no decimals; counts are integers; percent has one decimal; duration is minutes', () => {
  assert.equal(plain(formatValue(1234567, vi('vnd'))), '1.234.567 ₫');
  assert.equal(plain(formatValue(1234567.6, en('vnd'))), '₫1,234,568');
  assert.equal(formatValue(1234.4, vi('count')), '1.234');
  assert.equal(formatValue(12.5, vi('percent')), '12,5%');
  assert.equal(formatValue(12.5, en('percent')), '12.5%');
  assert.equal(plain(formatValue(45, vi('duration'))), '45 phút');
  assert.equal(plain(formatValue(45, en('duration'))), '45 min');
});

test('axis ticks are compact for money and counts', () => {
  assert.ok(formatTick(1_200_000, vi('vnd')).length <= 8);
  assert.doesNotMatch(formatTick(1_200_000, vi('vnd')), /₫/);
  assert.equal(formatTick(5, en('count')), '5');
});

test('business dates format as calendar dates and never shift with the time zone', () => {
  assert.equal(formatX('2026-09-30', 'vi'), '30/9');
  assert.equal(formatX('2026-09-30', 'en'), 'Sep 30');
  assert.equal(formatX('2026-01-01', 'en', 'long'), 'January 1, 2026');
  assert.equal(formatX('Massage', 'vi'), 'Massage');
  assert.equal(xKey(new Date('2026-09-30T23:59:59Z')), '2026-09-30');
});

test('series slots follow the position unless the caller fixes them; colors are token variables', () => {
  const prepared = prepareChart({
    current: [series('a', 'A', [1]), { ...series('b', 'B', [2]), color: 5 }, series('c', 'C', [3])],
  });
  assert.deepEqual(
    prepared.series.map((item) => item.slot),
    [1, 5, 3],
  );
  assert.equal(slotColor(4), 'var(--ls-chart-4)');
  assert.equal(slotColor('other'), 'var(--ls-chart-other)');
});

test('a 7th series is never generated: only 6 slots are drawn', () => {
  const many = Array.from({ length: 8 }, (_, index) => series(`s${index}`, `S${index}`, [index]));
  const prepared = prepareChart({ current: many });
  assert.equal(prepared.series.length, MAX_SERIES);
  assert.equal(prepared.truncated, true);
});

test('series with different x values share one ordered x axis; gaps are null', () => {
  const prepared = prepareChart({
    current: [series('a', 'A', [1, 2], 1), series('b', 'B', [5, 6], 2)],
  });
  assert.deepEqual(prepared.keys, ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.deepEqual(prepared.series[0]!.values, [1, 2, null]);
  assert.deepEqual(prepared.series[1]!.values, [null, 5, 6]);
});

test('the previous period is aligned by index (day 1..n), not by date', () => {
  const data: Comparison = {
    current: [series('a', 'A', [10, 20, 30], 10)],
    previous: [series('a', 'A', [8, 16, 24], 1)],
  };
  const prepared = prepareChart(data);
  assert.deepEqual(prepared.previous[0]!.values, [8, 16, 24]);
  assert.deepEqual(prepared.previous[0]!.xs, ['2026-09-01', '2026-09-02', '2026-09-03']);
  const tooltip = tooltipModel(prepared, 1, vi('count'), words);
  assert.equal(tooltip.rows[0]!.value, '20');
  assert.equal(tooltip.rows[0]!.delta, '+25,0% tăng');
  assert.equal(tooltip.rows[1]!.value, '16');
  assert.equal(tooltip.rows[1]!.slot, 'previous');
  assert.match(tooltip.rows[1]!.label, /Kỳ trước \(2\/9\)/);
});

test('a previous series shorter than the current one leaves null cells', () => {
  const prepared = prepareChart({
    current: [series('a', 'A', [1, 2, 3])],
    previous: [series('a', 'A', [1])],
  });
  assert.deepEqual(prepared.previous[0]!.values, [1, null, null]);
});

test('change against the previous period: signed percent with words, no base gives null', () => {
  assert.equal(deltaPercent(110, 100), 10);
  assert.equal(deltaPercent(50, 100), -50);
  assert.equal(deltaPercent(5, 0), null);
  assert.equal(deltaPercent(5, null), null);
  assert.equal(deltaDirection(0.01), 'flat');
  assert.equal(deltaDirection(3), 'up');
  assert.equal(deltaDirection(-3), 'down');
  assert.equal(formatDelta(12.34, 'vi'), '+12,3%');
  assert.equal(formatDelta(-3, 'en'), '-3.0%');
  assert.equal(deltaText(-3, 'en', { up: 'up', down: 'down', flat: 'flat' }), '-3.0% down');
});

test('value extent always contains zero when asked and never collapses', () => {
  assert.deepEqual(valueExtent([5, 9, null], true), [0, 9]);
  assert.deepEqual(valueExtent([5, 9], false), [5, 9]);
  assert.deepEqual(valueExtent([], true), [0, 1]);
  assert.deepEqual(valueExtent([3, 3], false), [3, 4]);
});

test('donut: at most 6 slices, the rest fold into one neutral Other', () => {
  const few = prepareSlices(
    [
      { id: 'a', label: 'A', value: 30 },
      { id: 'b', label: 'B', value: 10 },
      { id: 'z', label: 'Zero', value: 0 },
    ],
    'Khác',
  );
  assert.deepEqual(
    few.map((slice) => slice.id),
    ['a', 'b'],
    'zero slices are dropped',
  );
  assert.equal(Math.round(few[0]!.share * 100), 75);

  const many = prepareSlices(
    Array.from({ length: 9 }, (_, index) => ({
      id: `s${index}`,
      label: `S${index}`,
      value: index + 1,
    })),
    'Khác',
  );
  assert.equal(many.length, 6);
  const other = many.at(-1)!;
  assert.equal(other.id, 'other');
  assert.equal(other.slot, 'other');
  assert.equal(other.label, 'Khác');
  assert.equal(other.value, 1 + 2 + 3 + 4, 'the four smallest are folded');
  assert.ok(Math.abs(many.reduce((sum, slice) => sum + slice.share, 0) - 1) < 1e-9);
});

test('axis labels are thinned so they cannot overlap', () => {
  assert.equal(labelIndexes(7, 700, 64).size, 7);
  const thin = labelIndexes(60, 400, 64);
  const positions = [...thin].map((index) => (index * 400) / 60);
  for (let i = 1; i < positions.length; i += 1) assert.ok(positions[i]! - positions[i - 1]! >= 60);
  assert.equal(labelIndexes(0, 400, 64).size, 0);
});

test('pointer position maps to the nearest point; keys move along the points', () => {
  assert.equal(nearestIndex(48, [10, 50, 90]), 1);
  assert.equal(nearestIndex(5, []), -1);
  assert.equal(plotKeyTarget('ArrowRight', null, 5), 0);
  assert.equal(plotKeyTarget('ArrowLeft', null, 5), 4);
  assert.equal(plotKeyTarget('ArrowRight', 4, 5), 4);
  assert.equal(plotKeyTarget('ArrowLeft', 0, 5), 0);
  assert.equal(plotKeyTarget('Home', 3, 5), 0);
  assert.equal(plotKeyTarget('End', 0, 5), 4);
  assert.equal(plotKeyTarget('Escape', 2, 5), 'clear');
  assert.equal(plotKeyTarget('a', 2, 5), null);
  assert.equal(plotKeyTarget('ArrowRight', null, 0), null);
});

test('the table twin has one row per x value and a column per series and previous series', () => {
  const prepared = prepareChart({
    current: [series('a', 'Hóa đơn', [1000, 2000]), series('b', 'Lượt khách', [3])],
    previous: [series('a', 'Hóa đơn', [500, 1000])],
  });
  const table = seriesTable(prepared, vi('vnd'), { xHeader: 'Ngày', previous: 'kỳ trước' });
  assert.deepEqual(table.headers, ['Ngày', 'Hóa đơn', 'Lượt khách', 'Hóa đơn (kỳ trước)']);
  assert.equal(table.rows.length, 2);
  assert.equal(plain(table.rows[0]![1]!), '1.000 ₫');
  assert.equal(table.rows[1]![2], '—', 'a missing value is an em dash');
  assert.equal(table.rows[0]![0], '1 tháng 9, 2026', 'long date');
});

test('slice table lists name, value and share', () => {
  const slices = prepareSlices(
    [
      { id: 'a', label: 'Massage', value: 3 },
      { id: 'b', label: 'Gội đầu', value: 1 },
    ],
    'Khác',
  );
  const table = sliceTable(slices, vi('count'), {
    nameHeader: 'Dịch vụ',
    valueHeader: 'Số lượt',
    shareHeader: 'Tỷ lệ',
  });
  assert.deepEqual(table.rows[0], ['Massage', '3', '75,0%']);
});

test('the keyboard announcement names the date and each value', () => {
  const prepared = prepareChart({
    current: [series('a', 'Hóa đơn', [1000])],
    previous: [series('a', 'Hóa đơn', [800])],
  });
  const text = plain(describePoint(prepared, 0, vi('vnd'), 'Kỳ trước'));
  assert.match(text, /Hóa đơn 1\.000 ₫; Kỳ trước 800 ₫$/);
});
