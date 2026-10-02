'use client';

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefCallback,
} from 'react';
import {
  type Comparison,
  type DeltaWords,
  type DonutSlice,
  type Format,
  type Prepared,
  type SlotIndex,
  describePoint,
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
  tooltipModel,
} from './chart-core';
import {
  type BarMode,
  type BarOrientation,
  type Margin,
  barGeometry,
  donutGeometry,
  lineGeometry,
  plotBox,
  sparklinePath,
} from './chart-geometry';
import {
  ChartLegend,
  ChartTable,
  ChartTools,
  ChartTooltip,
  useElementWidth,
  type LegendItem,
} from './chart-parts';
import { cx } from './cx';

// Chart kit (docs/UXUI_REDESIGN_DESIGN.md 14.4): hand-drawn SVG on d3-scale/d3-shape geometry. Colors come
// from the `--ls-chart-*` tokens via the `ls-chart-s{slot}` classes, text from the text tokens.

export interface ChartLabels extends DeltaWords {
  /** Heading of the first table column (the x values), e.g. "Date". */
  xHeader: string;
  /** Name of the previous-period series, e.g. "Previous period". */
  previous: string;
  showTable: string;
  showChart: string;
  /** Keyboard help read with the chart's name, e.g. "Use the arrow keys to move between points." */
  plotHint: string;
}

interface CommonProps {
  /** Accessible name, table caption. */
  title: string;
  format: Format;
  labels: ChartLabels;
  height?: number | undefined;
  className?: string | undefined;
}

const LINE_MARGIN: Margin = { top: 12, right: 16, bottom: 28, left: 56 };
const MIN_LABEL_GAP = 64;
/** Markers on every point up to this many points; beyond it only the active point gets one. */
const MARKER_LIMIT = 14;

/** Pointer and keyboard tracking of the active x position, shared by line and bar charts. */
function usePlotInteraction(
  positions: number[],
  offset: number,
  axis: 'x' | 'y',
  describe: (index: number) => string,
) {
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const byKeyboard = useRef(false);
  const count = positions.length;
  return {
    active,
    announcement,
    clear: () => setActive(null),
    handlers: {
      onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        byKeyboard.current = false;
        const rect = event.currentTarget.getBoundingClientRect();
        const px = (axis === 'x' ? event.clientX - rect.left : event.clientY - rect.top) - offset;
        const index = nearestIndex(px, positions);
        setActive(index < 0 ? null : index);
      },
      onPointerLeave() {
        if (!byKeyboard.current) setActive(null);
      },
      onBlur() {
        byKeyboard.current = false;
        setActive(null);
      },
      onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        const target = plotKeyTarget(event.key, active, count);
        if (target === null) return;
        event.preventDefault();
        byKeyboard.current = true;
        if (target === 'clear') {
          setActive(null);
          return;
        }
        setActive(target);
        setAnnouncement(describe(target));
      },
    },
  };
}

function legendFor(prepared: Prepared, previousLabel: string): LegendItem[] | null {
  const hasPrevious = prepared.previous.length > 0;
  if (prepared.series.length < 2 && !hasPrevious) return null;
  const items: LegendItem[] = prepared.series.map((item) => ({
    id: item.id,
    label: item.label,
    slot: item.slot,
  }));
  if (hasPrevious) items.push({ id: 'previous', label: previousLabel, slot: 'previous' });
  return items;
}

/** Six hatch patterns, one per slot, shown only where color is unavailable (forced colors, print). */
function TextureDefs({ uid }: { uid: string }) {
  const angles = [45, 135, 0, 90, 45, 135];
  return (
    <defs>
      {angles.map((angle, index) => (
        <pattern
          key={index}
          id={`${uid}-t${index + 1}`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${angle})`}
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            className="ls-chart-texture-line"
            strokeWidth={index > 3 ? 3 : 1.5}
          />
        </pattern>
      ))}
    </defs>
  );
}

function useUid(): string {
  return useId().replace(/:/g, '');
}

function Plot({
  title,
  hint,
  height,
  plotRef,
  handlers,
  announcement,
  children,
}: {
  title: string;
  hint: string;
  height: number;
  plotRef: RefCallback<HTMLDivElement>;
  handlers: ReturnType<typeof usePlotInteraction>['handlers'];
  announcement: string;
  children: ReactNode;
}) {
  return (
    <div
      ref={plotRef}
      className="ls-chart-plot"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={`${title}. ${hint}`}
      {...handlers}
    >
      {children}
      <div className="ls-visually-hidden" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

// ---- LineChart -------------------------------------------------------------------------------

export interface LineChartProps extends CommonProps {
  data: Comparison;
  /** Fill under each line (a light tint of the series color). */
  area?: boolean | undefined;
  /** Start the value axis at zero (default). Turn off only for values that never approach zero. */
  zeroBaseline?: boolean | undefined;
}

/** Multi-series line chart; the previous period is drawn dashed in a neutral tone. */
export function LineChart({
  title,
  data,
  format,
  labels,
  height = 240,
  area = false,
  zeroBaseline = true,
  className,
}: LineChartProps) {
  const prepared = useMemo(() => prepareChart(data), [data]);
  const [plotRef, width] = useElementWidth();
  const [table, setTable] = useState(false);
  const box = plotBox(width, height, LINE_MARGIN);
  const geometry = useMemo(
    () => lineGeometry(prepared, box, zeroBaseline),
    [prepared, width, height, zeroBaseline],
  );
  const interaction = usePlotInteraction(geometry.xs, LINE_MARGIN.left, 'x', (index) =>
    describePoint(prepared, index, format, labels.previous),
  );
  const uid = useUid();
  const { active } = interaction;
  const showLabels = labelIndexes(prepared.keys.length, box.innerWidth, MIN_LABEL_GAP);
  const tooltip = active === null ? null : tooltipModel(prepared, active, format, labels);

  return (
    <div className={cx('ls-chart', className)}>
      <ChartTools
        legend={legendFor(prepared, labels.previous)}
        table={table}
        onToggleTable={() => setTable((value) => !value)}
        showTableLabel={labels.showTable}
        showChartLabel={labels.showChart}
      />
      {table ? (
        <ChartTable model={{ caption: title, ...seriesTable(prepared, format, labels) }} />
      ) : (
        <Plot
          title={title}
          hint={labels.plotHint}
          height={height}
          plotRef={plotRef}
          handlers={interaction.handlers}
          announcement={interaction.announcement}
        >
          <svg
            className="ls-chart-svg"
            width={width}
            height={height}
            aria-hidden="true"
            focusable="false"
          >
            <TextureDefs uid={uid} />
            <g transform={`translate(${LINE_MARGIN.left},${LINE_MARGIN.top})`}>
              {geometry.ticks.map((tick) => (
                <g key={tick.value}>
                  <line
                    className="ls-chart-grid"
                    x1={0}
                    x2={box.innerWidth}
                    y1={tick.at}
                    y2={tick.at}
                  />
                  <text className="ls-chart-tick" x={-8} y={tick.at} dy="0.32em" textAnchor="end">
                    {formatTick(tick.value, format)}
                  </text>
                </g>
              ))}
              {prepared.xs.map((x, index) =>
                showLabels.has(index) ? (
                  <text
                    key={index}
                    className="ls-chart-tick"
                    x={geometry.xs[index]}
                    y={box.innerHeight + 20}
                    textAnchor="middle"
                  >
                    {formatX(x, format.locale)}
                  </text>
                ) : null,
              )}
              {active === null ? null : (
                <line
                  className="ls-chart-crosshair"
                  x1={geometry.xs[active]}
                  x2={geometry.xs[active]}
                  y1={0}
                  y2={box.innerHeight}
                />
              )}
              {area
                ? prepared.series.map((item, at) => (
                    <path
                      key={item.id}
                      className={`ls-chart-area ls-chart-s${item.slot}`}
                      d={geometry.series[at]!.areaPath}
                    />
                  ))
                : null}
              {geometry.previous.map((item) => (
                <path
                  key={`previous-${item.seriesId}`}
                  className="ls-chart-line ls-chart-line-previous"
                  d={item.path}
                />
              ))}
              {prepared.series.map((item, at) => (
                <path
                  key={item.id}
                  className={`ls-chart-line ls-chart-s${item.slot}`}
                  d={geometry.series[at]!.path}
                />
              ))}
              {prepared.series.map((item, at) =>
                geometry.series[at]!.ys.map((y, index) =>
                  y === null || (prepared.keys.length > MARKER_LIMIT && index !== active) ? null : (
                    <circle
                      key={`${item.id}-${index}`}
                      className={`ls-chart-marker ls-chart-s${item.slot}`}
                      cx={geometry.xs[index]}
                      cy={y}
                      r={index === active ? 5 : 4}
                    />
                  ),
                ),
              )}
            </g>
          </svg>
          {tooltip ? (
            <ChartTooltip
              title={tooltip.title}
              rows={tooltip.rows}
              x={LINE_MARGIN.left + (geometry.xs[active!] ?? 0)}
              top={LINE_MARGIN.top}
              flip={(geometry.xs[active!] ?? 0) > box.innerWidth / 2}
            />
          ) : null}
        </Plot>
      )}
    </div>
  );
}

// ---- BarChart --------------------------------------------------------------------------------

export interface BarChartProps extends CommonProps {
  data: Comparison;
  orientation?: BarOrientation | undefined;
  /** `stacked` ignores the previous period (segments cannot carry a second, dashed bar). */
  mode?: BarMode | undefined;
}

const BAR_MARGIN: Margin = { top: 12, right: 16, bottom: 28, left: 56 };
const CATEGORY_CHAR_PX = 7;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Vertical or horizontal bars, grouped or stacked, with the 4 px rounded data end. */
export function BarChart({
  title,
  data,
  format,
  labels,
  height = 240,
  orientation = 'vertical',
  mode = 'grouped',
  className,
}: BarChartProps) {
  const effective = mode === 'stacked' ? { ...data, previous: undefined } : data;
  const prepared = useMemo(() => prepareChart(effective), [data, mode]);
  const [plotRef, width] = useElementWidth();
  const [table, setTable] = useState(false);
  const horizontal = orientation === 'horizontal';
  const categoryLabels = prepared.xs.map((x) => formatX(x, format.locale));
  const margin: Margin = horizontal
    ? {
        ...BAR_MARGIN,
        left: Math.min(
          176,
          Math.max(
            72,
            Math.max(0, ...categoryLabels.map((label) => label.length)) * CATEGORY_CHAR_PX + 16,
          ),
        ),
      }
    : BAR_MARGIN;
  const chartHeight = horizontal
    ? Math.max(
        height,
        prepared.keys.length *
          (mode === 'stacked'
            ? 36
            : 28 * Math.max(1, prepared.series.length + prepared.previous.length)) +
          margin.top +
          margin.bottom,
      )
    : height;
  const box = plotBox(width, chartHeight, margin);
  const geometry = useMemo(
    () => barGeometry(prepared, box, orientation, mode),
    [prepared, width, chartHeight, orientation, mode],
  );
  const interaction = usePlotInteraction(
    geometry.centers,
    horizontal ? margin.top : margin.left,
    horizontal ? 'y' : 'x',
    (index) => describePoint(prepared, index, format, labels.previous),
  );
  const uid = useUid();
  const { active } = interaction;
  const showLabels = horizontal
    ? new Set(prepared.keys.map((_, index) => index))
    : labelIndexes(prepared.keys.length, box.innerWidth, MIN_LABEL_GAP);
  const tooltip = active === null ? null : tooltipModel(prepared, active, format, labels);
  const anchor = active === null ? 0 : (geometry.centers[active] ?? 0);

  return (
    <div className={cx('ls-chart', className)}>
      <ChartTools
        legend={legendFor(prepared, labels.previous)}
        table={table}
        onToggleTable={() => setTable((value) => !value)}
        showTableLabel={labels.showTable}
        showChartLabel={labels.showChart}
      />
      {table ? (
        <ChartTable model={{ caption: title, ...seriesTable(prepared, format, labels) }} />
      ) : (
        <Plot
          title={title}
          hint={labels.plotHint}
          height={chartHeight}
          plotRef={plotRef}
          handlers={interaction.handlers}
          announcement={interaction.announcement}
        >
          <svg
            className="ls-chart-svg"
            width={width}
            height={chartHeight}
            aria-hidden="true"
            focusable="false"
          >
            <TextureDefs uid={uid} />
            <g transform={`translate(${margin.left},${margin.top})`}>
              {geometry.ticks.map((tick) =>
                horizontal ? (
                  <g key={tick.value}>
                    <line
                      className="ls-chart-grid"
                      x1={tick.at}
                      x2={tick.at}
                      y1={0}
                      y2={box.innerHeight}
                    />
                    <text
                      className="ls-chart-tick"
                      x={tick.at}
                      y={box.innerHeight + 20}
                      textAnchor="middle"
                    >
                      {formatTick(tick.value, format)}
                    </text>
                  </g>
                ) : (
                  <g key={tick.value}>
                    <line
                      className="ls-chart-grid"
                      x1={0}
                      x2={box.innerWidth}
                      y1={tick.at}
                      y2={tick.at}
                    />
                    <text className="ls-chart-tick" x={-8} y={tick.at} dy="0.32em" textAnchor="end">
                      {formatTick(tick.value, format)}
                    </text>
                  </g>
                ),
              )}
              {active === null ? null : horizontal ? (
                <rect
                  className="ls-chart-band-active"
                  x={0}
                  y={geometry.bands[active]!.start}
                  width={box.innerWidth}
                  height={geometry.bands[active]!.size}
                />
              ) : (
                <rect
                  className="ls-chart-band-active"
                  x={geometry.bands[active]!.start}
                  y={0}
                  width={geometry.bands[active]!.size}
                  height={box.innerHeight}
                />
              )}
              {categoryLabels.map((label, index) =>
                showLabels.has(index) ? (
                  <text
                    key={index}
                    className="ls-chart-tick"
                    x={horizontal ? -8 : geometry.centers[index]}
                    y={horizontal ? geometry.centers[index] : box.innerHeight + 20}
                    dy={horizontal ? '0.32em' : undefined}
                    textAnchor={horizontal ? 'end' : 'middle'}
                  >
                    {horizontal
                      ? truncate(label, Math.floor((margin.left - 12) / CATEGORY_CHAR_PX))
                      : label}
                    {horizontal ? <title>{label}</title> : null}
                  </text>
                ) : null,
              )}
              {geometry.bars.map((bar, index) => (
                <g key={index}>
                  <path
                    className={cx(
                      'ls-chart-bar',
                      bar.previous ? 'ls-chart-bar-previous' : `ls-chart-s${bar.slot}`,
                      mode === 'stacked' && 'ls-chart-bar-stacked',
                    )}
                    d={bar.path}
                  />
                  {bar.previous ? null : (
                    <path
                      className="ls-chart-texture"
                      d={bar.path}
                      fill={`url(#${uid}-t${bar.slot})`}
                    />
                  )}
                </g>
              ))}
            </g>
          </svg>
          {tooltip ? (
            <ChartTooltip
              title={tooltip.title}
              rows={tooltip.rows}
              x={horizontal ? margin.left + box.innerWidth / 2 : margin.left + anchor}
              top={horizontal ? margin.top + anchor : margin.top}
              flip={horizontal ? false : anchor > box.innerWidth / 2}
            />
          ) : null}
        </Plot>
      )}
    </div>
  );
}

// ---- DonutChart ------------------------------------------------------------------------------

export interface DonutLabels {
  /** Name of the folded slice, e.g. "Other". */
  other: string;
  /** Text under the total in the middle, e.g. "Total". */
  total: string;
  showTable: string;
  showChart: string;
  plotHint: string;
  nameHeader: string;
  valueHeader: string;
  shareHeader: string;
}

export interface DonutChartProps {
  title: string;
  slices: DonutSlice[];
  format: Format;
  labels: DonutLabels;
  /** Diameter in px. */
  size?: number | undefined;
  /** Hole size as a share of the radius; 0 makes it a pie. */
  innerRadius?: number | undefined;
  className?: string | undefined;
}

/** Donut (or pie with `innerRadius={0}`): at most 6 slices, the rest folded into a neutral "Other". */
export function DonutChart({
  title,
  slices,
  format,
  labels,
  size = 200,
  innerRadius = 0.62,
  className,
}: DonutChartProps) {
  const prepared = useMemo(() => prepareSlices(slices, labels.other), [slices, labels.other]);
  const [table, setTable] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const geometry = useMemo(
    () => donutGeometry(prepared, size, innerRadius),
    [prepared, size, innerRadius],
  );
  const uid = useUid();
  const total = prepared.reduce((sum, slice) => sum + slice.value, 0);
  const percent = (share: number) =>
    formatValue(share * 100, { valueFormat: 'percent', locale: format.locale });
  const legend: LegendItem[] | null =
    prepared.length < 2
      ? null
      : prepared.map((slice) => ({
          id: slice.id,
          label: slice.label,
          slot: slice.slot,
          detail: `${formatValue(slice.value, format)} · ${percent(slice.share)}`,
        }));
  const describe = (index: number) => {
    const slice = prepared[index]!;
    return `${slice.label}: ${formatValue(slice.value, format)}, ${percent(slice.share)}`;
  };
  const slice = active === null ? null : prepared[active]!;
  const arcAt = active === null ? null : geometry.arcs[active]!;

  return (
    <div className={cx('ls-chart', className)}>
      <ChartTools
        legend={null}
        table={table}
        onToggleTable={() => setTable((value) => !value)}
        showTableLabel={labels.showTable}
        showChartLabel={labels.showChart}
      />
      {table ? (
        <ChartTable model={{ caption: title, ...sliceTable(prepared, format, labels) }} />
      ) : (
        <div className="ls-chart-donut">
          <div
            className="ls-chart-plot ls-chart-plot-donut"
            style={{ width: size, height: size }}
            tabIndex={0}
            role="group"
            aria-label={`${title}. ${labels.plotHint}`}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              const target = plotKeyTarget(event.key, active, prepared.length);
              if (target === null) return;
              event.preventDefault();
              if (target === 'clear') {
                setActive(null);
                return;
              }
              setActive(target);
              setAnnouncement(describe(target));
            }}
          >
            <svg
              className="ls-chart-svg"
              width={size}
              height={size}
              aria-hidden="true"
              focusable="false"
            >
              <TextureDefs uid={uid} />
              <g transform={`translate(${size / 2},${size / 2})`}>
                {geometry.arcs.map((arc, index) => {
                  const item = prepared[index]!;
                  return (
                    <g key={arc.id} onPointerEnter={() => setActive(index)}>
                      <path
                        className={cx(
                          'ls-chart-slice',
                          `ls-chart-s${item.slot === 'other' ? 'other' : item.slot}`,
                          active === index && 'ls-chart-slice-active',
                        )}
                        d={arc.path}
                      />
                      <path
                        className="ls-chart-texture"
                        d={arc.path}
                        fill={`url(#${uid}-t${item.slot === 'other' ? 6 : item.slot})`}
                      />
                    </g>
                  );
                })}
                {geometry.innerRadius > 0 ? (
                  <g>
                    <text className="ls-chart-center-value" y={-2} textAnchor="middle">
                      {formatValue(total, format)}
                    </text>
                    <text className="ls-chart-center-label" y={18} textAnchor="middle">
                      {labels.total}
                    </text>
                  </g>
                ) : null}
              </g>
            </svg>
            {slice && arcAt ? (
              <ChartTooltip
                title={slice.label}
                rows={[
                  {
                    label: percent(slice.share),
                    value: formatValue(slice.value, format),
                    slot: slice.slot,
                  },
                ]}
                x={size / 2 + arcAt.centroid[0]}
                top={size / 2 + arcAt.centroid[1]}
                flip={arcAt.centroid[0] > 0}
              />
            ) : null}
            <div className="ls-visually-hidden" aria-live="polite">
              {announcement}
            </div>
          </div>
          {legend ? <ChartLegend items={legend} className="ls-chart-legend-stacked" /> : null}
        </div>
      )}
    </div>
  );
}

// ---- Sparkline -------------------------------------------------------------------------------

/** A tiny trend line without axes. Decorative unless `label` is given. */
export function Sparkline({
  values,
  label,
  slot = 1,
  width = 96,
  height = 32,
  className,
}: {
  values: number[];
  label?: string | undefined;
  slot?: SlotIndex | undefined;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}) {
  const path = values.length >= 2 ? sparklinePath(values, width, height) : '';
  return (
    <svg
      className={cx('ls-sparkline', `ls-chart-s${slot}`, className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {path ? <path className="ls-sparkline-line" d={path} /> : null}
    </svg>
  );
}
