'use client';

import { useState } from 'react';
import { Button } from './button';
import { formatValue, type Format, type SlotIndex } from './chart-core';
import { Sparkline } from './charts';
import { cx } from './cx';
import { Icon } from './icons';
import { Tooltip } from './tooltip';
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
  /** Explanation next to the label: a toggletip (hover or focus shows it; a press, on touch too, keeps it open and reads it out). */
  info?: string | undefined;
  labels: KpiCardLabels;
  className?: string | undefined;
}) {
  const hasSpark = Boolean(sparkline && sparkline.length >= 2);
  return (
    <article className={cx('ls-kpi', className)}>
      <div className="ls-kpi-head">
        <h3 className="ls-kpi-label">{label}</h3>
        {info ? <KpiInfo text={info} /> : null}
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

/**
 * The info button as a toggletip (WIG: an explanation a tap cannot open is lost on touch): hover and keyboard focus show it as before;
 * a press opens it until the next press, Escape or leaving the button, and the text is read out once through a polite status.
 */
function KpiInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ls-kpi-info">
      <Tooltip content={text} describes={false} open={open}>
        <Button
          variant="ghost"
          className="ls-btn-icon"
          aria-label={text}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <Icon name="info" />
        </Button>
      </Tooltip>
      <span className="ls-visually-hidden" role="status">
        {open ? text : ''}
      </span>
    </span>
  );
}
