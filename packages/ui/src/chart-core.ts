// DOM-free chart logic (docs/UXUI_REDESIGN_DESIGN.md 14.4): the shared data shape, value formats,
// series preparation, comparison alignment and small geometry helpers. The chart components only draw.

export type ChartLocale = 'vi' | 'en';
export type ValueFormat = 'vnd' | 'count' | 'percent' | 'duration';
export type SlotIndex = 1 | 2 | 3 | 4 | 5 | 6;

/** One categorical slot per series, in fixed order; a 7th is never generated (contract 6.5). */
export const MAX_SERIES = 6;
/** Charts draw at most this many points; longer series are bucketed by the data loader (14.4). */
export const MAX_POINTS = 400;

export interface ChartPoint {
  /** A business date (`YYYY-MM-DD`, read as a plain calendar date) or a category label. A `Date` is read in UTC. */
  x: Date | string;
  y: number;
}
export interface Series {
  id: string;
  label: string;
  /** Categorical slot (1-6). Defaults to the series position, so colors follow the entity when the caller sets it. */
  color?: SlotIndex | undefined;
  points: ChartPoint[];
}
export interface Comparison {
  current: Series[];
  /** Aligned with `current` by index (day 1..n), not by date. */
  previous?: Series[] | undefined;
}
export interface Format {
  valueFormat: ValueFormat;
  locale: ChartLocale;
}

const INTL_LOCALE: Record<ChartLocale, string> = { vi: 'vi-VN', en: 'en-US' };

export function intlLocale(locale: ChartLocale): string {
  return INTL_LOCALE[locale];
}

const formatterCache = new Map<string, Intl.NumberFormat>();
function numberFormat(key: string, locale: string, options: Intl.NumberFormatOptions) {
  const cacheKey = `${locale}|${key}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatterCache.set(cacheKey, formatter);
  }
  return formatter;
}

/**
 * Full value: VND with grouping and no decimals, counts as integers, percentages with one decimal
 * (the value is already a percentage, 12.5 = 12.5%), durations in minutes.
 */
export function formatValue(value: number, { valueFormat, locale }: Format): string {
  const tag = intlLocale(locale);
  switch (valueFormat) {
    case 'vnd':
      return numberFormat('vnd', tag, {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
      }).format(Math.round(value));
    case 'count':
      return numberFormat('count', tag, { maximumFractionDigits: 0 }).format(Math.round(value));
    case 'percent':
      return (
        numberFormat('percent', tag, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(value) + '%'
      );
    case 'duration':
      return numberFormat('duration', tag, {
        style: 'unit',
        unit: 'minute',
        unitDisplay: 'short',
        maximumFractionDigits: 0,
      }).format(Math.round(value));
  }
}

/** Short value for axis ticks: compact numbers without the currency sign, otherwise as `formatValue`. */
export function formatTick(value: number, format: Format): string {
  if (format.valueFormat === 'vnd') {
    return numberFormat('tick-vnd', intlLocale(format.locale), {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (format.valueFormat === 'percent') {
    return (
      numberFormat('tick-percent', intlLocale(format.locale), {
        maximumFractionDigits: 1,
      }).format(value) + '%'
    );
  }
  if (format.valueFormat === 'count') {
    return numberFormat('tick-count', intlLocale(format.locale), {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  return formatValue(value, format);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The identity of an x value: the string itself, or the UTC calendar date of a `Date`. */
export function xKey(x: Date | string): string {
  return typeof x === 'string' ? x : x.toISOString().slice(0, 10);
}

/** Axis label of an x value. Business dates never shift time zones: they are formatted as UTC calendar dates. */
export function formatX(x: Date | string, locale: ChartLocale, style: 'short' | 'long' = 'short') {
  const key = xKey(x);
  if (!ISO_DATE.test(key)) return key;
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: 'numeric', month: locale === 'vi' ? 'numeric' : 'short', timeZone: 'UTC' }
      : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(new Date(`${key}T00:00:00Z`));
}

export function slotColor(slot: SlotIndex | 'other'): string {
  return slot === 'other' ? 'var(--ls-chart-other)' : `var(--ls-chart-${slot})`;
}

export function clampSlot(value: number): SlotIndex {
  return Math.min(MAX_SERIES, Math.max(1, Math.round(value))) as SlotIndex;
}

export interface PreparedSeries {
  id: string;
  label: string;
  slot: SlotIndex;
  /** One value per x key; `null` where the series has no point. */
  values: (number | null)[];
}
export interface PreparedPrevious {
  seriesId: string;
  label: string;
  values: (number | null)[];
  /** The x of each previous point, shown in the tooltip and the table. */
  xs: (Date | string | null)[];
}
export interface Prepared {
  keys: string[];
  xs: (Date | string)[];
  series: PreparedSeries[];
  previous: PreparedPrevious[];
  /** True when series were dropped because only 6 slots exist. */
  truncated: boolean;
}

/** Ordered unique x values across series (first seen wins), each series mapped onto them. */
export function prepareChart(data: Comparison): Prepared {
  const truncated = data.current.length > MAX_SERIES;
  const current = data.current.slice(0, MAX_SERIES);
  const keys: string[] = [];
  const xs: (Date | string)[] = [];
  const seen = new Set<string>();
  for (const series of current) {
    for (const point of series.points.slice(0, MAX_POINTS)) {
      const key = xKey(point.x);
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
        xs.push(point.x);
      }
    }
  }
  if (keys.length > 1 && keys.every((key) => ISO_DATE.test(key))) {
    // Business dates always read left to right in time, whichever series listed them first.
    const order = keys.map((_, index) => index).sort((a, b) => (keys[a]! < keys[b]! ? -1 : 1));
    const sortedKeys = order.map((index) => keys[index]!);
    const sortedXs = order.map((index) => xs[index]!);
    keys.splice(0, keys.length, ...sortedKeys);
    xs.splice(0, xs.length, ...sortedXs);
  }
  const series = current.map<PreparedSeries>((item, index) => {
    const byKey = new Map(item.points.map((point) => [xKey(point.x), point.y]));
    return {
      id: item.id,
      label: item.label,
      slot: item.color ?? clampSlot(index + 1),
      values: keys.map((key) => byKey.get(key) ?? null),
    };
  });
  const previous = (data.previous ?? [])
    .slice(0, current.length)
    .map<PreparedPrevious>((item, index) => {
      const points = item.points.slice(0, keys.length);
      return {
        seriesId: current[index]!.id,
        label: item.label,
        values: keys.map((_, at) => points[at]?.y ?? null),
        xs: keys.map((_, at) => points[at]?.x ?? null),
      };
    });
  return { keys, xs, series, previous, truncated };
}

/** [min, max] over the given values, always containing zero when `zero` (bars always do). */
export function valueExtent(values: (number | null)[], zero = true): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Infinity) return [0, 1];
  if (zero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) max = min + 1;
  return [min, max];
}

/** Stacked totals per x key (negative values are not stacked with positive ones; the kit's data is non-negative). */
export function stackTotals(series: PreparedSeries[], count: number): number[] {
  return Array.from({ length: count }, (_, at) =>
    series.reduce((sum, item) => sum + (item.values[at] ?? 0), 0),
  );
}

/** Indexes that get an axis label so labels never overlap: every k-th, the last one dropped if it would crowd. */
export function labelIndexes(count: number, width: number, minGap: number): Set<number> {
  const out = new Set<number>();
  if (count <= 0) return out;
  const slot = width / Math.max(1, count);
  const step = Math.max(1, Math.ceil(minGap / Math.max(1, slot)));
  for (let index = 0; index < count; index += step) out.add(index);
  return out;
}

/** Index of the position closest to `px`; -1 for an empty list. */
export function nearestIndex(px: number, positions: number[]): number {
  let best = -1;
  let distance = Infinity;
  positions.forEach((position, index) => {
    const d = Math.abs(position - px);
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}

/** Next active index for a key on the plot; `null` when the key is not a chart key. */
export function plotKeyTarget(
  key: string,
  active: number | null,
  count: number,
): number | null | 'clear' {
  if (count <= 0) return null;
  if (key === 'Escape') return 'clear';
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown')
    return active === null ? 0 : Math.min(count - 1, active + 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp')
    return active === null ? count - 1 : Math.max(0, active - 1);
  return null;
}

/** Change from `previous` to `current` in percent; `null` when there is no base to compare with. */
export function deltaPercent(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous) || previous === 0)
    return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export function deltaDirection(percent: number): DeltaDirection {
  if (Math.abs(percent) < 0.05) return 'flat';
  return percent > 0 ? 'up' : 'down';
}

/** "+12.5%", "-3.0%", "0.0%". */
export function formatDelta(percent: number, locale: ChartLocale): string {
  const text = numberFormat('delta', intlLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(percent);
  return `${text}%`;
}

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color?: SlotIndex | undefined;
}
export interface PreparedSlice {
  id: string;
  label: string;
  value: number;
  slot: SlotIndex | 'other';
  share: number;
}

/**
 * At most 6 slices. Above that the 5 largest keep their slot and the rest fold into one neutral
 * "Other" slice; slices keep the caller's order. Non-positive values are dropped.
 */
export function prepareSlices(slices: DonutSlice[], otherLabel: string): PreparedSlice[] {
  const positive = slices.filter((slice) => Number.isFinite(slice.value) && slice.value > 0);
  let kept = positive;
  let other = 0;
  if (positive.length > MAX_SERIES) {
    const top = new Set(
      [...positive]
        .sort((a, b) => b.value - a.value)
        .slice(0, MAX_SERIES - 1)
        .map((slice) => slice.id),
    );
    kept = positive.filter((slice) => top.has(slice.id));
    other = positive
      .filter((slice) => !top.has(slice.id))
      .reduce((sum, slice) => sum + slice.value, 0);
  }
  const total = kept.reduce((sum, slice) => sum + slice.value, 0) + other;
  const out = kept.map<PreparedSlice>((slice, index) => ({
    id: slice.id,
    label: slice.label,
    value: slice.value,
    slot: slice.color ?? clampSlot(index + 1),
    share: total === 0 ? 0 : slice.value / total,
  }));
  if (other > 0) {
    out.push({ id: 'other', label: otherLabel, value: other, slot: 'other', share: other / total });
  }
  return out;
}

export interface TableLabels {
  /** Heading of the first column (the x values), e.g. "Date". */
  xHeader: string;
  /** Series label of the previous period, e.g. "Previous period". */
  previous: string;
  /** Empty cell text. */
  empty?: string | undefined;
}
export interface TableModel {
  headers: string[];
  rows: string[][];
}

/** The table twin of a line or bar chart: one row per x value, one column per series (and previous series). */
export function seriesTable(prepared: Prepared, format: Format, labels: TableLabels): TableModel {
  const dash = labels.empty ?? '\u2014';
  const cell = (value: number | null | undefined) =>
    value === null || value === undefined ? dash : formatValue(value, format);
  const headers = [
    labels.xHeader,
    ...prepared.series.map((item) => item.label),
    ...prepared.previous.map((item) => `${item.label} (${labels.previous})`),
  ];
  const rows = prepared.keys.map((_, at) => [
    formatX(prepared.xs[at]!, format.locale, 'long'),
    ...prepared.series.map((item) => cell(item.values[at])),
    ...prepared.previous.map((item) => cell(item.values[at])),
  ]);
  return { headers, rows };
}

export interface SliceTableLabels {
  nameHeader: string;
  valueHeader: string;
  shareHeader: string;
}

export function sliceTable(
  slices: PreparedSlice[],
  format: Format,
  labels: SliceTableLabels,
): TableModel {
  return {
    headers: [labels.nameHeader, labels.valueHeader, labels.shareHeader],
    rows: slices.map((slice) => [
      slice.label,
      formatValue(slice.value, format),
      formatValue(slice.share * 100, { valueFormat: 'percent', locale: format.locale }),
    ]),
  };
}

/** Sentence read out when a point becomes active with the keyboard: "1 Oct: Paid 1.200.000 ₫; Previous period 1.000.000 ₫". */
export function describePoint(
  prepared: Prepared,
  index: number,
  format: Format,
  previousLabel: string,
): string {
  const parts = prepared.series.map((item) => {
    const value = item.values[index];
    return value === null || value === undefined
      ? null
      : `${item.label} ${formatValue(value, format)}`;
  });
  prepared.previous.forEach((item) => {
    const value = item.values[index];
    if (value !== null && value !== undefined)
      parts.push(`${previousLabel} ${formatValue(value, format)}`);
  });
  return `${formatX(prepared.xs[index]!, format.locale, 'long')}: ${parts.filter(Boolean).join('; ')}`;
}

export interface DeltaWords {
  up: string;
  down: string;
  flat: string;
}
export interface TooltipRowData {
  label: string;
  value: string;
  slot: SlotIndex | 'other' | 'previous';
  delta?: string | undefined;
}

/** Signed change with words, so direction never rests on color or an arrow alone: "+12.5% up". */
export function deltaText(percent: number, locale: ChartLocale, words: DeltaWords): string {
  return `${formatDelta(percent, locale)} ${words[deltaDirection(percent)]}`;
}

/** Tooltip content for one x value: each series, then its previous-period value with the change. */
export function tooltipModel(
  prepared: Prepared,
  index: number,
  format: Format,
  labels: { previous: string } & DeltaWords,
): { title: string; rows: TooltipRowData[] } {
  const rows: TooltipRowData[] = [];
  prepared.series.forEach((item, at) => {
    const value = item.values[index];
    if (value === null || value === undefined) return;
    const before = prepared.previous[at]?.values[index];
    const change = deltaPercent(value, before);
    rows.push({
      label: item.label,
      value: formatValue(value, format),
      slot: item.slot,
      delta: change === null ? undefined : deltaText(change, format.locale, labels),
    });
  });
  prepared.previous.forEach((item) => {
    const value = item.values[index];
    const x = item.xs[index];
    if (value === null || value === undefined) return;
    rows.push({
      label:
        x === null || x === undefined
          ? labels.previous
          : `${labels.previous} (${formatX(x, format.locale)})`,
      value: formatValue(value, format),
      slot: 'previous',
    });
  });
  return { title: formatX(prepared.xs[index]!, format.locale, 'long'), rows };
}
