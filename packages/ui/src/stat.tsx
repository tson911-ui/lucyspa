import {
  deltaDirection,
  deltaPercent,
  deltaText,
  formatValue,
  type DeltaWords,
  type Format,
} from './chart-core';
import { cx } from './cx';
import { Icon } from './icons';

export interface StatLabels extends DeltaWords {
  /** What the change is measured against, e.g. "vs previous period". */
  comparedTo: string;
}

/**
 * The change against a previous value: arrow, signed percent and words (never color alone). Shared by
 * `Stat` and `KpiCard`. Renders nothing when there is nothing to compare with.
 */
export function DeltaLine({
  value,
  previous,
  format,
  goodDirection,
  labels,
}: {
  value: number;
  previous?: number | null | undefined;
  format: Format;
  goodDirection?: 'up' | 'down' | undefined;
  labels: StatLabels;
}) {
  const change = deltaPercent(value, previous);
  const direction = change === null ? null : deltaDirection(change);
  if (change === null || direction === null) return null;
  const tone =
    direction === 'flat'
      ? 'neutral'
      : goodDirection
        ? direction === goodDirection
          ? 'good'
          : 'bad'
        : direction;
  return (
    <p className="ls-kpi-delta" data-tone={tone}>
      <Icon
        name={direction === 'up' ? 'arrow-up' : direction === 'down' ? 'arrow-down' : 'minus'}
        size={16}
      />
      <span>{deltaText(change, format.locale, labels)}</span>
      <span className="ls-kpi-compared">{labels.comparedTo}</span>
    </p>
  );
}

/**
 * Label, value and an optional change, without a surface: it sits inside a `Card` (a `KpiCard` is a
 * card of its own and is for a page's headline number).
 */
export function Stat({
  label,
  value,
  format,
  previous,
  goodDirection,
  labels,
  note,
  className,
}: {
  label: string;
  value: number;
  format: Format;
  /** The value to compare with; the change is hidden when it is missing or zero. */
  previous?: number | null | undefined;
  goodDirection?: 'up' | 'down' | undefined;
  /** Required only with `previous`. */
  labels?: StatLabels | undefined;
  /** One short line under the value, e.g. "Longest wait 12 min". */
  note?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cx('ls-stat', className)}>
      <p className="ls-stat-label">{label}</p>
      <p className="ls-stat-value">{formatValue(value, format)}</p>
      {labels && previous !== undefined ? (
        <DeltaLine
          value={value}
          previous={previous}
          format={format}
          goodDirection={goodDirection}
          labels={labels}
        />
      ) : null}
      {note ? <p className="ls-stat-note">{note}</p> : null}
    </div>
  );
}
