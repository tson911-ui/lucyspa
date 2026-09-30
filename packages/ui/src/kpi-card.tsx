'use client';

import { formatValue, type Format, type SlotIndex } from './chart-core';
import { Sparkline } from './charts';
import { cx } from './cx';
import { IconButton } from './button';
import { DeltaLine, type StatLabels } from './stat';

export type KpiCardLabels = StatLabels;

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
  const hasSpark = Boolean(sparkline && sparkline.length >= 2);
  return (
    <article className={cx('ls-kpi', className)}>
      <div className="ls-kpi-head">
        <h3 className="ls-kpi-label">{label}</h3>
        {info ? <IconButton icon="info" label={info} /> : null}
      </div>
      <p className="ls-kpi-value">{formatValue(value, format)}</p>
      <DeltaLine
        value={value}
        previous={previous}
        format={format}
        goodDirection={goodDirection}
        labels={labels}
      />
      {asOf || hasSpark ? (
        <div className="ls-kpi-foot">
          {asOf ? <p className="ls-kpi-asof">{asOf}</p> : <span />}
          {hasSpark && sparkline ? <Sparkline values={sparkline} slot={sparklineSlot} /> : null}
        </div>
      ) : null}
    </article>
  );
}
