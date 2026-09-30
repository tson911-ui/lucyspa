'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from './button';
import { cx } from './cx';
import {
  DEFAULT_MAX_RANGE_DAYS,
  PRESET_IDS,
  addMonths,
  calendarKeyTarget,
  compareDates,
  exceedsMax,
  formatDay,
  formatMonth,
  formatRange,
  formatWeekday,
  matchPreset,
  monthGrid,
  normalizeRange,
  presetRange,
  type DateRange,
  type PresetId,
} from './date-range-core';
import { fillTemplate } from './paging-core';
import { Drawer } from './overlay';
import { Popover } from './popover';
import { TABLET_QUERY } from './shell-core';
import { PHONE_QUERY, useMediaQuery } from './use-media-query';

export interface DateRangePickerLabels {
  /** Accessible name of the control and title of the dialog, e.g. "Date range". */
  title: string;
  /** Trigger text while no range is chosen. */
  placeholder: string;
  presets: Record<PresetId, string>;
  custom: string;
  apply: string;
  cancel: string;
  close: string;
  previousMonth: string;
  nextMonth: string;
  /** Shown after the first date is picked, e.g. "Pick the last day." */
  pickEnd: string;
  /** "Longest range: {days} days." */
  maxRange: string;
}

/**
 * Date range control (docs/UXUI_REDESIGN_DESIGN.md 14.4). Dates are branch business dates
 * (`YYYY-MM-DD`): the caller passes `today` in the branch time zone and the picker never reads the
 * clock or the browser zone. A preset applies at once; a custom range is two clicks (or keys) and Apply.
 * Popover with two months on desktop, a full-height sheet with one month on a phone.
 */
export function DateRangePicker({
  value,
  onChange,
  today,
  locale,
  labels,
  maxDays = DEFAULT_MAX_RANGE_DAYS,
  minDate,
  maxDate,
  weekStart = 1,
  className,
}: {
  value: DateRange | null;
  onChange: (range: DateRange) => void;
  /** The branch's current business date. */
  today: string;
  locale: 'vi' | 'en';
  labels: DateRangePickerLabels;
  maxDays?: number | undefined;
  minDate?: string | undefined;
  maxDate?: string | undefined;
  /** 1 = Monday (default), 0 = Sunday. */
  weekStart?: 0 | 1 | undefined;
  className?: string | undefined;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  // Two months need room for 40 px days: only from 1024 px up.
  const tablet = useMediaQuery(TABLET_QUERY);
  const narrow = phone || tablet;
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) anchorRef.current?.focus();
  }

  const panel = (
    <RangePanel
      key={open ? 'open' : 'closed'}
      value={value}
      today={today}
      locale={locale}
      labels={labels}
      maxDays={maxDays}
      minDate={minDate}
      maxDate={maxDate}
      weekStart={weekStart}
      months={narrow ? 1 : 2}
      onCancel={() => close()}
      onCommit={(range) => {
        onChange(range);
        close();
      }}
    />
  );

  return (
    <div className={cx('ls-daterange', className)}>
      <Button
        ref={anchorRef}
        variant="secondary"
        icon="calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ls-daterange-value">
          <span className="ls-visually-hidden">{labels.title}: </span>
          {value ? formatRange(value, locale) : labels.placeholder}
        </span>
      </Button>
      {phone ? (
        <Drawer
          open={open}
          onClose={() => close()}
          title={labels.title}
          closeLabel={labels.close}
          side="end"
          className="ls-daterange-sheet"
        >
          {panel}
        </Drawer>
      ) : (
        <Popover
          open={open}
          onClose={() => close(false)}
          anchorRef={anchorRef}
          align="start"
          id={panelId}
          role="dialog"
          className="ls-daterange-popover"
        >
          {panel}
        </Popover>
      )}
    </div>
  );
}

function RangePanel({
  value,
  today,
  locale,
  labels,
  maxDays,
  minDate,
  maxDate,
  weekStart,
  months,
  onCancel,
  onCommit,
}: {
  value: DateRange | null;
  today: string;
  locale: 'vi' | 'en';
  labels: DateRangePickerLabels;
  maxDays: number;
  minDate: string | undefined;
  maxDate: string | undefined;
  weekStart: 0 | 1;
  months: 1 | 2;
  onCancel: () => void;
  onCommit: (range: DateRange) => void;
}) {
  const [draft, setDraft] = useState<{ from: string; to: string | null } | null>(
    value ? { from: value.from, to: value.to } : null,
  );
  const [focused, setFocused] = useState(value?.to ?? value?.from ?? today);
  const [first, setFirst] = useState(
    () =>
      (months === 2 ? addMonths(value?.to ?? today, -1) : (value?.to ?? today)).slice(0, 7) + '-01',
  );
  const [hover, setHover] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const activePreset = matchPreset(value, today);
  const picking = draft !== null && draft.to === null;

  // Focus the day that would be picked next, once per opening (the panel remounts on each opening).
  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, []);

  function disabledDay(date: string): boolean {
    if (minDate && compareDates(date, minDate) < 0) return true;
    if (maxDate && compareDates(date, maxDate) > 0) return true;
    if (picking && draft) return exceedsMax(normalizeRange(draft.from, date), maxDays);
    return false;
  }

  function pick(date: string) {
    if (disabledDay(date)) return;
    setFocused(date);
    if (picking && draft) {
      const range = normalizeRange(draft.from, date);
      setDraft({ from: range.from, to: range.to });
    } else {
      setDraft({ from: date, to: null });
    }
  }

  function move(date: string) {
    // Keep the moved-to day inside the two visible months.
    setFocused(date);
    const monthOf = (day: string) => `${day.slice(0, 7)}-01`;
    const last = addMonths(first, months - 1);
    if (compareDates(monthOf(date), first) < 0) setFirst(monthOf(date));
    else if (compareDates(monthOf(date), last) > 0)
      setFirst(addMonths(monthOf(date), -(months - 1)));
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
    });
  }

  const preview = useMemo(() => {
    if (!draft) return null;
    if (draft.to) return { from: draft.from, to: draft.to };
    return hover ? normalizeRange(draft.from, hover) : { from: draft.from, to: draft.from };
  }, [draft, hover]);

  const complete = draft !== null && draft.to !== null;
  const shownMonths = Array.from({ length: months }, (_, index) => addMonths(first, index));
  const monthLabels = shownMonths.map((month) => formatMonth(month, locale));

  return (
    <div className="ls-daterange-panel">
      <div className="ls-daterange-presets" role="group" aria-label={labels.title}>
        {PRESET_IDS.map((id) => (
          <Button
            key={id}
            variant="ghost"
            aria-pressed={activePreset === id}
            onClick={() => onCommit(presetRange(id, today))}
          >
            {labels.presets[id]}
          </Button>
        ))}
        <Button
          variant="ghost"
          aria-pressed={value !== null && activePreset === null}
          onClick={() => gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()}
        >
          {labels.custom}
        </Button>
      </div>
      <div className="ls-daterange-calendars" ref={gridRef}>
        <div className="ls-daterange-nav">
          <IconButton
            icon="chevron-left"
            label={labels.previousMonth}
            onClick={() => setFirst(addMonths(first, -1))}
          />
          <p className="ls-daterange-months" aria-live="polite">
            {monthLabels.join(' – ')}
          </p>
          <IconButton
            icon="chevron-right"
            label={labels.nextMonth}
            onClick={() => setFirst(addMonths(first, 1))}
          />
        </div>
        <div className="ls-daterange-grids">
          {shownMonths.map((month, monthIndex) => (
            <table
              key={month}
              className="ls-calendar"
              role="grid"
              aria-label={monthLabels[monthIndex]}
            >
              <thead>
                <tr>
                  {Array.from({ length: 7 }, (_, index) => {
                    const weekday = (weekStart + index) % 7;
                    return (
                      <th key={weekday} scope="col" className="ls-calendar-weekday">
                        {formatWeekday(weekday, locale)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {monthGrid(month, weekStart).map((week) => (
                  <tr key={week[0]!.date}>
                    {week.map((day) => {
                      const inRange =
                        preview !== null &&
                        compareDates(day.date, preview.from) >= 0 &&
                        compareDates(day.date, preview.to) <= 0;
                      const isEdge =
                        preview !== null && (day.date === preview.from || day.date === preview.to);
                      const disabled = disabledDay(day.date);
                      return (
                        <td
                          key={day.date}
                          role="gridcell"
                          aria-selected={inRange && day.inMonth ? true : undefined}
                          className={cx(
                            'ls-calendar-cell',
                            day.inMonth && inRange && 'ls-calendar-in-range',
                            day.inMonth && isEdge && 'ls-calendar-edge',
                          )}
                        >
                          {day.inMonth ? (
                            <button
                              type="button"
                              className="ls-calendar-day"
                              data-date={day.date}
                              data-today={day.date === today ? 'true' : undefined}
                              tabIndex={day.date === focused ? 0 : -1}
                              aria-label={formatDay(day.date, locale, 'long')}
                              aria-current={day.date === today ? 'date' : undefined}
                              aria-disabled={disabled || undefined}
                              onClick={() => pick(day.date)}
                              onPointerEnter={() => setHover(day.date)}
                              onPointerLeave={() => setHover(null)}
                              onFocus={() => setFocused(day.date)}
                              onKeyDown={(event) => {
                                const target = calendarKeyTarget(event.key, day.date, weekStart);
                                if (target === null) return;
                                event.preventDefault();
                                move(target);
                              }}
                            >
                              {Number(day.date.slice(8, 10))}
                            </button>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </div>
      <div className="ls-daterange-foot">
        <p className="ls-daterange-summary" role="status">
          {picking
            ? labels.pickEnd
            : draft && draft.to
              ? formatRange({ from: draft.from, to: draft.to }, locale)
              : fillTemplate(labels.maxRange, { days: maxDays })}
        </p>
        <div className="ls-daterange-buttons">
          <Button variant="secondary" onClick={onCancel}>
            {labels.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!complete}
            onClick={() => {
              if (draft && draft.to) onCommit({ from: draft.from, to: draft.to });
            }}
          >
            {labels.apply}
          </Button>
        </div>
      </div>
    </div>
  );
}
