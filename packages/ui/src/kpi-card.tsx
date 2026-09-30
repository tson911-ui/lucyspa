'use client';

import {
  deltaDirection,
  deltaPercent,
  deltaText,
  formatValue,
  type DeltaWords,
  type Format,
  type SlotIndex,
} from './chart-core';
import { Sparkline } from './charts';
import { cx } from './cx';
import { IconButton } from './button';
import { Icon } from './icons';

export interface KpiCardLabels extends DeltaWords {
  /** What the change is measured against, e.g. "vs previous period". */
  comparedTo: string;
}

/**
 * One headline number: label, value, the change against the previous period (arrow, signed percent
 * and words, never color alone), an optional sparkline, an "as of" time and an info tooltip.
 *
 * The change is blue or orange (the kit's diverging pair), not green or red, unless the metric has an
 * unambiguous good direction and the screen passes `goodDirection`.
 */
export function KpiCard({
  label,
  value,
  format,
  previous,
  goodDirection,
  sparkline,
  sparklineSlot = 1,
  asOf,
  info,
  labels,
  className,
}: {
  label: string;
  value: number;
  format: Format;
  /** The value of the previous period; the change is hidden when it is missing or zero. */
  previous?: number | null | undefined;
  goodDirection?: 'up' | 'down' | undefined;
  sparkline?: number[] | undefined;
  sparklineSlot?: SlotIndex | undefined;
  /** Already formatted, e.g. "As of 14:05". */
  asOf?: string | undefined;
  /** Explanation shown in a tooltip next to the label. */
  info?: string | undefined;
  labels: KpiCardLabels;
  className?: string | undefined;
}) {
  const change = deltaPercent(value, previous);
  const direction = change === null ? null : deltaDirection(change);
  const tone =
    direction === null || direction === 'flat'
      ? 'neutral'
      : goodDirection
        ? direction === goodDirection
          ? 'good'
          : 'bad'
        : direction;
  const hasSpark = Boolean(sparkline && sparkline.length >= 2);
  return (
    <article className={cx('ls-kpi', className)}>
      <div className="ls-kpi-head">
        <h3 className="ls-kpi-label">{label}</h3>
        {info ? <IconButton icon="info" label={info} /> : null}
      </div>
      <p className="ls-kpi-value">{formatValue(value, format)}</p>
      {change === null || direction === null ? null : (
        <p className="ls-kpi-delta" data-tone={tone}>
          <Icon
            name={direction === 'up' ? 'arrow-up' : direction === 'down' ? 'arrow-down' : 'minus'}
            size={16}
          />
          <span>{deltaText(change, format.locale, labels)}</span>
          <span className="ls-kpi-compared">{labels.comparedTo}</span>
        </p>
      )}
      {asOf || hasSpark ? (
        <div className="ls-kpi-foot">
          {asOf ? <p className="ls-kpi-asof">{asOf}</p> : <span />}
          {hasSpark && sparkline ? <Sparkline values={sparkline} slot={sparklineSlot} /> : null}
        </div>
      ) : null}
    </article>
  );
}
