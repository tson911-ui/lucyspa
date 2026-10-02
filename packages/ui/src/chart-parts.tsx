'use client';

import { useLayoutEffect, useState, type ReactNode, type RefCallback } from 'react';
import { Button } from './button';
import { slotColor, type SlotIndex } from './chart-core';
import { cx } from './cx';
import { EmptyState, ErrorState, Skeleton } from './feedback';
import { SegmentedControl } from './segmented';
import type { ComparisonMode } from './date-range-core';

// Pieces shared by every chart (docs/UXUI_REDESIGN_DESIGN.md 14.4). Text always comes from props.

/**
 * Element width in px, kept up to date. `fallback` is used on the server and where nothing can be measured.
 * The ref is a callback ref held in state: a chart that is unmounted (the "Show as table" view) and mounted
 * again gets a new element, which is measured and observed afresh instead of leaving the observer on a
 * detached node that reads 0.
 */
export function useElementWidth(fallback = 640): [RefCallback<HTMLDivElement>, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!element) return undefined;
    const read = (value: number) => setWidth(value > 0 ? Math.round(value) : fallback);
    read(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => read(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, fallback]);
  return [setElement, width];
}

export interface ChartFrameLabels {
  loading: string;
  retry: string;
}

/**
 * Card around a chart: title, subtitle, actions, and the loading, empty and error states in the
 * chart's own footprint. The chart goes in `children` and is shown only when `state` is `ready`.
 */
export function ChartFrame({
  title,
  subtitle,
  actions,
  state = 'ready',
  emptyMessage,
  errorMessage,
  errorReference,
  referenceLabel,
  onRetry,
  labels,
  height = 240,
  headingLevel = 2,
  className,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
  state?: 'ready' | 'loading' | 'empty' | 'error' | undefined;
  emptyMessage?: string | undefined;
  errorMessage?: string | undefined;
  errorReference?: string | null | undefined;
  referenceLabel?: string | undefined;
  onRetry?: (() => void) | undefined;
  labels: ChartFrameLabels;
  /** Height reserved for the loading state so the card does not jump when data arrives. */
  height?: number | undefined;
  headingLevel?: 2 | 3 | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <section
      className={cx('ls-chart-frame', className)}
      aria-busy={state === 'loading' || undefined}
    >
      <header className="ls-chart-head">
        <div className="ls-chart-titles">
          <Heading className="ls-chart-title">{title}</Heading>
          {subtitle ? <p className="ls-chart-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="ls-chart-actions">{actions}</div> : null}
      </header>
      {state === 'loading' ? (
        <div className="ls-chart-state" style={{ minHeight: height }} role="status">
          <span className="ls-visually-hidden">{labels.loading}</span>
          <Skeleton height={`${height}px`} />
        </div>
      ) : state === 'empty' ? (
        <div className="ls-chart-state" style={{ minHeight: height }}>
          <EmptyState icon="info">{emptyMessage ?? ''}</EmptyState>
        </div>
      ) : state === 'error' ? (
        <div className="ls-chart-state" style={{ minHeight: height }}>
          <ErrorState
            message={errorMessage ?? ''}
            reference={errorReference}
            referenceLabel={referenceLabel}
            onRetry={onRetry}
            retryLabel={labels.retry}
          />
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export interface LegendItem {
  id: string;
  label: string;
  slot: SlotIndex | 'other' | 'previous';
  /** Extra text after the label, e.g. the share of a slice. */
  detail?: string | undefined;
}

/** Legend for two or more series: a swatch plus the name in the text color (color is never the only cue). */
export function ChartLegend({
  items,
  className,
}: {
  items: LegendItem[];
  className?: string | undefined;
}) {
  return (
    <ul className={cx('ls-chart-legend', className)}>
      {items.map((item) => (
        <li key={item.id} className="ls-chart-legend-item">
          <span
            className={cx(
              'ls-chart-swatch',
              item.slot === 'previous' && 'ls-chart-swatch-previous',
            )}
            style={item.slot === 'previous' ? undefined : { background: slotColor(item.slot) }}
            aria-hidden="true"
          />
          <span className="ls-chart-legend-label">{item.label}</span>
          {item.detail ? <span className="ls-chart-legend-detail">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  label: string;
  value: string;
  slot: SlotIndex | 'other' | 'previous';
  /** e.g. "+12.5% up" for the change against the previous period. */
  delta?: string | undefined;
}

/**
 * Hover and focus tooltip: a title (the x value) and one row per series with a swatch. Placed by the
 * chart at `x`/`top` inside its plot; on the far side of the plot it opens to the left of `x`.
 * Screen readers get the same text from the chart's live region, so it is `aria-hidden`.
 */
export function ChartTooltip({
  title,
  rows,
  x,
  top,
  flip,
}: {
  title: string;
  rows: TooltipRow[];
  x: number;
  top: number;
  flip: boolean;
}) {
  return (
    <div
      className="ls-chart-tooltip"
      data-flip={flip ? 'true' : undefined}
      style={{ left: x, top }}
      aria-hidden="true"
    >
      <p className="ls-chart-tooltip-title">{title}</p>
      <ul className="ls-chart-tooltip-rows">
        {rows.map((row, index) => (
          <li key={`${row.label}-${index}`} className="ls-chart-tooltip-row">
            <span
              className={cx(
                'ls-chart-swatch',
                row.slot === 'previous' && 'ls-chart-swatch-previous',
              )}
              style={row.slot === 'previous' ? undefined : { background: slotColor(row.slot) }}
            />
            <span className="ls-chart-tooltip-label">{row.label}</span>
            <span className="ls-chart-tooltip-value">{row.value}</span>
            {row.delta ? <span className="ls-chart-tooltip-delta">{row.delta}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ChartTableModel {
  caption: string;
  headers: string[];
  rows: string[][];
}

/** The data of a chart as a real table: the accessible twin behind "Show as table". */
export function ChartTable({
  model,
  className,
}: {
  model: ChartTableModel;
  className?: string | undefined;
}) {
  return (
    <div className={cx('ls-chart-table-wrap', className)}>
      <table className="ls-chart-table">
        <caption className="ls-visually-hidden">{model.caption}</caption>
        <thead>
          <tr>
            {model.headers.map((header, index) => (
              <th
                key={index}
                scope="col"
                className={index === 0 ? undefined : 'ls-chart-table-num'}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={index} className="ls-chart-table-num">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Legend plus the "Show as table" switch, above every chart. */
export function ChartTools({
  legend,
  table,
  onToggleTable,
  showTableLabel,
  showChartLabel,
}: {
  legend: LegendItem[] | null;
  table: boolean;
  onToggleTable: () => void;
  showTableLabel: string;
  showChartLabel: string;
}) {
  return (
    <div className="ls-chart-tools">
      {legend ? <ChartLegend items={legend} /> : <span />}
      <Button
        variant="ghost"
        icon={table ? 'bar-chart' : 'table'}
        aria-pressed={table}
        onClick={onToggleTable}
      >
        {table ? showChartLabel : showTableLabel}
      </Button>
    </div>
  );
}

export interface ComparisonToggleLabels {
  /** Accessible name of the group, e.g. "Compare with". */
  label: string;
  none: string;
  previous: string;
  lastYear: string;
}

/**
 * None | Previous period | Same period last year. It only reports the mode; the caller derives the
 * shifted range with `comparisonRange(range, mode)` and loads both.
 */
export function ComparisonToggle({
  value,
  onChange,
  labels,
  className,
}: {
  value: ComparisonMode;
  onChange: (mode: ComparisonMode) => void;
  labels: ComparisonToggleLabels;
  className?: string | undefined;
}) {
  return (
    <SegmentedControl<ComparisonMode>
      label={labels.label}
      value={value}
      onChange={onChange}
      className={cx('ls-comparison-toggle', className)}
      options={[
        { value: 'none', label: labels.none },
        { value: 'previous', label: labels.previous },
        { value: 'lastYear', label: labels.lastYear },
      ]}
    />
  );
}
