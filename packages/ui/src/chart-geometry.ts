// Chart geometry on top of d3-scale and d3-shape (docs/UXUI_REDESIGN_DESIGN.md 14.4, approval Q-D1).
// Pure functions from prepared data and a box size to numbers and SVG path strings, so the layout is
// testable without a DOM. The components only draw what these return.
import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import { arc, area, line, pie } from 'd3-shape';
import { type Prepared, type PreparedSlice, stackTotals, valueExtent } from './chart-core';

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface PlotBox {
  width: number;
  height: number;
  margin: Margin;
  innerWidth: number;
  innerHeight: number;
}

export function plotBox(width: number, height: number, margin: Margin): PlotBox {
  return {
    width,
    height,
    margin,
    innerWidth: Math.max(1, width - margin.left - margin.right),
    innerHeight: Math.max(1, height - margin.top - margin.bottom),
  };
}

export interface Tick {
  value: number;
  /** Position along the value axis (px inside the plot). */
  at: number;
}

const TICK_COUNT = 4;

function allValues(prepared: Prepared): (number | null)[] {
  return [
    ...prepared.series.flatMap((s) => s.values),
    ...prepared.previous.flatMap((p) => p.values),
  ];
}

// ---- line and area -------------------------------------------------------------------------

export interface LineGeometry {
  box: PlotBox;
  /** x of each key (px inside the plot). */
  xs: number[];
  ticks: Tick[];
  baseline: number;
  series: { id: string; path: string; areaPath: string; ys: (number | null)[] }[];
  previous: { seriesId: string; path: string; ys: (number | null)[] }[];
}

export function lineGeometry(prepared: Prepared, box: PlotBox, zero = true): LineGeometry {
  const indexes = prepared.keys.map((_, index) => index);
  const x = scalePoint<number>().domain(indexes).range([0, box.innerWidth]).padding(0.5);
  const [min, max] = valueExtent(allValues(prepared), zero);
  const y = scaleLinear().domain([min, max]).nice(TICK_COUNT).range([box.innerHeight, 0]);
  const at = (index: number) => x(index) ?? 0;
  const baselineValue = Math.max(y.domain()[0]!, Math.min(0, y.domain()[1]!));
  const pathOf = line<number | null>()
    .defined((value) => value !== null)
    .x((_, index) => at(index))
    .y((value) => y(value as number));
  const areaOf = area<number | null>()
    .defined((value) => value !== null)
    .x((_, index) => at(index))
    .y0(() => y(baselineValue))
    .y1((value) => y(value as number));
  return {
    box,
    xs: indexes.map(at),
    ticks: y.ticks(TICK_COUNT).map((value) => ({ value, at: y(value) })),
    baseline: y(baselineValue),
    series: prepared.series.map((item) => ({
      id: item.id,
      path: pathOf(item.values) ?? '',
      areaPath: areaOf(item.values) ?? '',
      ys: item.values.map((value) => (value === null ? null : y(value))),
    })),
    previous: prepared.previous.map((item) => ({
      seriesId: item.seriesId,
      path: pathOf(item.values) ?? '',
      ys: item.values.map((value) => (value === null ? null : y(value))),
    })),
  };
}

// ---- bars ----------------------------------------------------------------------------------

export type BarOrientation = 'vertical' | 'horizontal';
export type BarMode = 'grouped' | 'stacked';
/** Side of a bar that is its data end (the only rounded one). */
export type BarEnd = 'up' | 'down' | 'left' | 'right';

export const BAR_RADIUS = 4;
/** Surface-colored gap between neighbouring bars and stacked segments (contract 14.4). */
export const BAR_GAP = 2;

/** Path of a bar with the 4 px rounding only at its data end; the baseline side stays square. */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  end: BarEnd,
): string {
  const vertical = end === 'up' || end === 'down';
  const r = Math.max(0, Math.min(radius, vertical ? w / 2 : h / 2, vertical ? h : w));
  const f = (n: number) => Number(n.toFixed(2));
  switch (end) {
    case 'up':
      return `M${f(x)},${f(y + h)}V${f(y + r)}A${r},${r} 0 0 1 ${f(x + r)},${f(y)}H${f(x + w - r)}A${r},${r} 0 0 1 ${f(x + w)},${f(y + r)}V${f(y + h)}Z`;
    case 'down':
      return `M${f(x)},${f(y)}V${f(y + h - r)}A${r},${r} 0 0 0 ${f(x + r)},${f(y + h)}H${f(x + w - r)}A${r},${r} 0 0 0 ${f(x + w)},${f(y + h - r)}V${f(y)}Z`;
    case 'right':
      return `M${f(x)},${f(y)}H${f(x + w - r)}A${r},${r} 0 0 1 ${f(x + w)},${f(y + r)}V${f(y + h - r)}A${r},${r} 0 0 1 ${f(x + w - r)},${f(y + h)}H${f(x)}Z`;
    case 'left':
      return `M${f(x + w)},${f(y)}H${f(x + r)}A${r},${r} 0 0 0 ${f(x)},${f(y + r)}V${f(y + h - r)}A${r},${r} 0 0 0 ${f(x + r)},${f(y + h)}H${f(x + w)}Z`;
  }
}

export interface Bar {
  seriesId: string;
  slot: number;
  keyIndex: number;
  value: number;
  /** A previous-period bar: drawn as a dashed neutral outline, never filled. */
  previous: boolean;
  path: string;
}
export interface BarGeometry {
  box: PlotBox;
  orientation: BarOrientation;
  /** Start and size of each category band along the category axis (px inside the plot). */
  bands: { start: number; size: number }[];
  /** Center of each band. */
  centers: number[];
  ticks: Tick[];
  bars: Bar[];
}

export function barGeometry(
  prepared: Prepared,
  box: PlotBox,
  orientation: BarOrientation,
  mode: BarMode,
): BarGeometry {
  const vertical = orientation === 'vertical';
  const categoryLength = vertical ? box.innerWidth : box.innerHeight;
  const valueLength = vertical ? box.innerHeight : box.innerWidth;
  const indexes = prepared.keys.map((_, index) => index);
  const band = scaleBand<number>()
    .domain(indexes)
    .range([0, categoryLength])
    .paddingInner(0.3)
    .paddingOuter(0.15);
  const stacked = mode === 'stacked';
  const values = stacked ? stackTotals(prepared.series, prepared.keys.length) : allValues(prepared);
  const [, max] = valueExtent(values, true);
  const scale = scaleLinear()
    .domain([0, max])
    .nice(TICK_COUNT)
    .range(vertical ? [valueLength, 0] : [0, valueLength]);
  const baseline = scale(0);

  const bars: Bar[] = [];
  const groups = stacked
    ? 1
    : prepared.series.length + (prepared.previous.length > 0 ? prepared.previous.length : 0);

  const push = (
    start: number,
    size: number,
    from: number,
    to: number,
    meta: Omit<Bar, 'path'>,
    round: boolean,
  ) => {
    const lo = Math.min(from, to);
    const length = Math.max(0, Math.abs(to - from));
    if (length === 0 || size <= 0) return;
    const end: BarEnd = vertical ? (to <= from ? 'up' : 'down') : to >= from ? 'right' : 'left';
    const x = vertical ? start : lo;
    const y = vertical ? lo : start;
    const w = vertical ? size : length;
    const h = vertical ? length : size;
    bars.push({
      ...meta,
      path: round ? barPath(x, y, w, h, BAR_RADIUS, end) : rectPath(x, y, w, h),
    });
  };

  indexes.forEach((keyIndex) => {
    const start = band(keyIndex) ?? 0;
    const size = band.bandwidth();
    if (stacked) {
      let running = 0;
      const last = prepared.series.reduce(
        (found, item, at) => ((item.values[keyIndex] ?? 0) > 0 ? at : found),
        -1,
      );
      prepared.series.forEach((item, at) => {
        const value = item.values[keyIndex] ?? 0;
        if (value <= 0) return;
        const from = scale(running);
        running += value;
        // Segments meet at a surface-colored stroke (drawn by the component); only the top one is rounded.
        push(
          start,
          size,
          from,
          scale(running),
          { seriesId: item.id, slot: item.slot, keyIndex, value, previous: false },
          at === last,
        );
      });
      return;
    }
    const each = size / Math.max(1, groups);
    let slotIndex = 0;
    prepared.series.forEach((item) => {
      const value = item.values[keyIndex];
      const offset = start + each * slotIndex;
      slotIndex += 1;
      if (value === null || value === undefined) return;
      push(
        offset,
        Math.max(1, each - BAR_GAP),
        baseline,
        scale(value),
        { seriesId: item.id, slot: item.slot, keyIndex, value, previous: false },
        true,
      );
    });
    prepared.previous.forEach((item, at) => {
      const value = item.values[keyIndex];
      const offset = start + each * slotIndex;
      slotIndex += 1;
      if (value === null || value === undefined) return;
      push(
        offset,
        Math.max(1, each - BAR_GAP),
        baseline,
        scale(value),
        {
          seriesId: item.seriesId,
          slot: prepared.series[at]?.slot ?? 1,
          keyIndex,
          value,
          previous: true,
        },
        true,
      );
    });
  });

  return {
    box,
    orientation,
    bands: indexes.map((index) => ({ start: band(index) ?? 0, size: band.bandwidth() })),
    centers: indexes.map((index) => (band(index) ?? 0) + band.bandwidth() / 2),
    ticks: scale.ticks(TICK_COUNT).map((value) => ({ value, at: scale(value) })),
    bars,
  };
}

function rectPath(x: number, y: number, w: number, h: number): string {
  const f = (n: number) => Number(n.toFixed(2));
  return `M${f(x)},${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
}

// ---- donut ---------------------------------------------------------------------------------

export interface DonutArc {
  id: string;
  path: string;
  /** Where the slice's tooltip anchors (relative to the donut center). */
  centroid: [number, number];
}
export interface DonutGeometry {
  size: number;
  outerRadius: number;
  innerRadius: number;
  arcs: DonutArc[];
}

/** `innerRatio` 0 gives a pie. The slices keep their order; a 2 px-ish gap separates neighbours. */
export function donutGeometry(
  slices: PreparedSlice[],
  size: number,
  innerRatio: number,
): DonutGeometry {
  const outerRadius = Math.max(1, size / 2 - 2);
  const innerRadius = outerRadius * Math.min(0.9, Math.max(0, innerRatio));
  const angles = pie<PreparedSlice>()
    .sort(null)
    .value((slice) => slice.value)(slices);
  const shape = arc<{ startAngle: number; endAngle: number; padAngle: number }>()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius)
    .cornerRadius(slices.length > 1 ? 3 : 0)
    .padAngle(slices.length > 1 ? 2 / outerRadius : 0);
  return {
    size,
    outerRadius,
    innerRadius,
    arcs: angles.map((angle, index) => {
      const withPad = {
        startAngle: angle.startAngle,
        endAngle: angle.endAngle,
        padAngle: slices.length > 1 ? 2 / outerRadius : 0,
      };
      return {
        id: slices[index]!.id,
        path: shape(withPad) ?? '',
        centroid: shape.centroid(withPad) as [number, number],
      };
    }),
  };
}

// ---- sparkline -----------------------------------------------------------------------------

/** Path of a sparkline in a `width` x `height` box with a small inset so the 2 px line is not clipped. */
export function sparklinePath(values: number[], width: number, height: number, inset = 2): string {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return '';
  const [min, max] = valueExtent(finite, false);
  const x = scaleLinear()
    .domain([0, Math.max(1, values.length - 1)])
    .range([inset, width - inset]);
  const y = scaleLinear()
    .domain([min, max])
    .range([height - inset, inset]);
  return (
    line<number>()
      .defined((value) => Number.isFinite(value))
      .x((_, index) => x(index))
      .y((value) => y(value))(values) ?? ''
  );
}
