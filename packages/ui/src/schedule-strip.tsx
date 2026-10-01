import { cx } from './cx';

// A one-lane timeline of scheduled windows (docs/UXUI_REDESIGN_DESIGN.md 16.5: "the schedule list shows a
// timeline strip of upcoming/active/expired"). It is a picture of what the table beside it already says in
// text, so it is hidden from assistive technology.

export type ScheduleTone = 'success' | 'info' | 'neutral';

export interface ScheduleItem {
  id: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  tone: ScheduleTone;
  /** Shown on hover only. */
  label: string;
}

/** A window never draws thinner than this, so a short one stays visible. */
const MIN_WIDTH = 1.5;

export interface ScheduleLayout {
  segments: { id: string; left: number; width: number }[];
  /** Percent from the left edge. */
  now: number;
  min: number;
  max: number;
}

/** Positions (in percent of the track) of every window and of "now" across the whole covered range. */
export function scheduleLayout(items: readonly ScheduleItem[], now: number): ScheduleLayout {
  const times = [now, ...items.flatMap((item) => [item.start, item.end])];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(max - min, 1);
  const percent = (value: number) => ((value - min) / span) * 100;
  return {
    segments: items.map((item) => {
      const width = Math.min(Math.max(((item.end - item.start) / span) * 100, MIN_WIDTH), 100);
      return { id: item.id, left: Math.min(percent(item.start), 100 - width), width };
    }),
    now: percent(now),
    min,
    max,
  };
}

export function ScheduleStrip({
  items,
  now,
  startLabel,
  endLabel,
  nowLabel,
  caption,
}: {
  items: readonly ScheduleItem[];
  now: number;
  /** The date at the left end and the right end of the track, already formatted. */
  startLabel: string;
  endLabel: string;
  nowLabel: string;
  /** What the strip shows, in words, above the track. */
  caption?: string | undefined;
}) {
  const layout = scheduleLayout(items, now);
  return (
    <div className="ls-schedule" aria-hidden="true">
      {caption ? <span className="ls-schedule-axis">{caption}</span> : null}
      <div className="ls-schedule-track">
        {items.map((item, index) => {
          const segment = layout.segments[index];
          return segment ? (
            <span
              key={item.id}
              className={cx('ls-schedule-seg', `ls-schedule-seg-${item.tone}`)}
              style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
              title={item.label}
            />
          ) : null;
        })}
        <span className="ls-schedule-now" style={{ left: `${layout.now}%` }} title={nowLabel} />
      </div>
      <div className="ls-schedule-axis">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
