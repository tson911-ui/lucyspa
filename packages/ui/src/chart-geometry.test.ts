import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareChart, prepareSlices, type Series } from './chart-core';
import {
  barGeometry,
  barPath,
  donutGeometry,
  lineGeometry,
  plotBox,
  sparklinePath,
} from './chart-geometry';

const box = plotBox(400, 240, { top: 12, right: 16, bottom: 28, left: 56 });

function series(id: string, ys: (number | null)[]): Series {
  return {
    id,
    label: id,
    points: ys.flatMap((y, index) =>
      y === null ? [] : [{ x: `2026-09-${String(index + 1).padStart(2, '0')}`, y }],
    ),
  };
}

test('line: points are spread inside the plot, in order, and ticks start at zero', () => {
  const prepared = prepareChart({ current: [series('a', [10, 40, 25, 60])] });
  const geometry = lineGeometry(prepared, box);
  assert.equal(geometry.xs.length, 4);
  assert.ok(
    geometry.xs[0]! > 0 && geometry.xs.at(-1)! < box.innerWidth,
    'first and last are inset',
  );
  assert.deepEqual(
    [...geometry.xs].sort((a, b) => a - b),
    geometry.xs,
  );
  assert.equal(geometry.ticks[0]!.value, 0);
  assert.ok(geometry.ticks.every((tick) => tick.at >= 0 && tick.at <= box.innerHeight));
  const ys = geometry.series[0]!.ys as number[];
  assert.ok(ys[3]! < ys[0]!, 'a larger value is higher (smaller y)');
  assert.match(geometry.series[0]!.path, /^M/);
  assert.match(geometry.series[0]!.areaPath, /^M/);
});

test('line: a missing value breaks the line instead of drawing a zero', () => {
  const prepared = prepareChart({ current: [series('a', [10, null, 30]), series('b', [1, 2, 3])] });
  const geometry = lineGeometry(prepared, box);
  assert.equal(geometry.series[0]!.ys[1], null);
  assert.equal((geometry.series[0]!.path.match(/M/g) ?? []).length, 2, 'two segments');
});

test('line: the previous period shares the value scale with the current one', () => {
  const prepared = prepareChart({
    current: [series('a', [10, 20])],
    previous: [series('a', [100, 50])],
  });
  const geometry = lineGeometry(prepared, box);
  assert.ok(
    geometry.previous[0]!.ys[0]! < geometry.series[0]!.ys[0]!,
    'the larger previous value sits higher',
  );
});

test('bar path: only the data end is rounded, the baseline side stays square', () => {
  const up = barPath(10, 20, 30, 50, 4, 'up');
  assert.match(
    up,
    /^M10,70V24A4,4 0 0 1 14,20/,
    'starts square at the baseline and rounds at the top',
  );
  assert.doesNotMatch(up, /A4,4 0 0 [01] 10,70/);
  const right = barPath(0, 0, 50, 20, 4, 'right');
  assert.match(right, /^M0,0H46A4,4/);
  assert.equal((up.match(/A/g) ?? []).length, 2);
  const tiny = barPath(0, 0, 30, 2, 4, 'up');
  assert.match(tiny, /A2,2/, 'a short bar shrinks its radius instead of overshooting');
});

test('bars: one bar per series and x value; grouped bars share a band with a gap', () => {
  const prepared = prepareChart({ current: [series('a', [10, 20, 30]), series('b', [5, 15, 25])] });
  const geometry = barGeometry(prepared, box, 'vertical', 'grouped');
  assert.equal(geometry.bars.length, 6);
  assert.equal(geometry.bands.length, 3);
  assert.ok(geometry.bands[0]!.start >= 0);
  assert.ok(geometry.bands.at(-1)!.start + geometry.bands.at(-1)!.size <= box.innerWidth + 0.01);
  assert.equal(geometry.bars.filter((bar) => bar.seriesId === 'a').length, 3);
});

test('bars: stacked segments are one bar per series and total to the stack height', () => {
  const prepared = prepareChart({ current: [series('a', [10, 20]), series('b', [30, 0])] });
  const geometry = barGeometry(prepared, box, 'vertical', 'stacked');
  assert.equal(geometry.bars.length, 3, 'a zero segment is not drawn');
  const [a0, b0] = geometry.bars.filter((bar) => bar.keyIndex === 0);
  assert.equal(a0!.seriesId, 'a');
  assert.equal(b0!.seriesId, 'b');
  const top = geometry.ticks.at(-1)!;
  assert.ok(top.value >= 40, 'the axis reaches the tallest stack');
});

test('bars: a previous-period bar sits next to its current bar and is marked previous', () => {
  const prepared = prepareChart({
    current: [series('a', [10, 20])],
    previous: [series('a', [8, 30])],
  });
  const geometry = barGeometry(prepared, box, 'vertical', 'grouped');
  assert.equal(geometry.bars.filter((bar) => bar.previous).length, 2);
  assert.equal(geometry.bars.length, 4);
});

test('horizontal bars run along the value axis from the left edge', () => {
  const prepared = prepareChart({ current: [series('a', [10, 20])] });
  const geometry = barGeometry(prepared, box, 'horizontal', 'grouped');
  assert.equal(geometry.orientation, 'horizontal');
  assert.match(geometry.bars[0]!.path, /^M0,/, 'starts at the baseline x = 0');
  assert.ok(geometry.ticks.every((tick) => tick.at >= 0 && tick.at <= box.innerWidth + 0.01));
});

test('donut: one arc per slice, a hole for a donut and none for a pie', () => {
  const slices = prepareSlices(
    [
      { id: 'a', label: 'A', value: 1 },
      { id: 'b', label: 'B', value: 2 },
      { id: 'c', label: 'C', value: 3 },
    ],
    'Other',
  );
  const donut = donutGeometry(slices, 200, 0.62);
  assert.equal(donut.arcs.length, 3);
  assert.ok(donut.innerRadius > 0 && donut.innerRadius < donut.outerRadius);
  assert.ok(donut.arcs.every((arc) => arc.path.startsWith('M')));
  assert.equal(donutGeometry(slices, 200, 0).innerRadius, 0);
  const single = donutGeometry(
    prepareSlices([{ id: 'a', label: 'A', value: 1 }], 'Other'),
    200,
    0.62,
  );
  assert.equal(single.arcs.length, 1);
});

test('sparkline: a path inside the box, empty for no data', () => {
  assert.match(sparklinePath([1, 3, 2], 96, 32), /^M/);
  assert.equal(sparklinePath([], 96, 32), '');
  const flat = sparklinePath([5, 5, 5], 96, 32);
  assert.match(flat, /^M/, 'a flat series still draws');
});
