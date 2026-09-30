'use client';

import { Stat } from '@lucy-spa/ui';
import { fill } from '../../../i18n/workforce';
import { branchTime, stateTone } from '../../../lib/workforce/booking-board';
import {
  BOOKING_GROUPS,
  servingNow,
  summarizeBookings,
  waitingSummary,
  type BookingGroup,
} from '../../../lib/workforce/dashboard/today';
import type { WidgetProps } from '../../../lib/workforce/dashboard/widgets';
import { useWorkforce } from '../session';
import { Badge } from '../ui';
import { useTodayBoard } from './data';
import { WidgetFrame } from './widget-frame';

// Widgets that read the branch "today" board (`GET operations/branches/:id/today`). All three share one request.

const GROUP_TONE: Record<BookingGroup, Parameters<typeof stateTone>[0]> = {
  upcoming: 'UPCOMING',
  late: 'LATE_HOLD',
  arrived: 'ARRIVED',
  inService: 'IN_SERVICE',
  completed: 'COMPLETED',
  closed: 'CANCELLED',
};

/** Rows shown before "and N more". */
const ROWS = 5;

export function TodayBookingsWidget({ branchId, size, title }: WidgetProps) {
  const { t, locale } = useWorkforce();
  const today = useTodayBoard(branchId);
  const copy = t.dashboard.bookings;
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={today}
      isEmpty={(data) => data.bookings.length === 0}
      emptyText={copy.empty}
      link={{ path: '/booking-board', label: copy.open }}
    >
      {(data) => {
        const summary = summarizeBookings(data.bookings);
        return (
          <>
            <Stat
              label={copy.total}
              value={summary.total}
              format={{ valueFormat: 'count', locale }}
            />
            <ul className="ls-widget-list">
              {BOOKING_GROUPS.filter((group) => summary.counts[group] > 0).map((group) => (
                <li key={group} className="ls-widget-row">
                  <Badge tone={stateTone(GROUP_TONE[group])}>{copy.groups[group]}</Badge>
                  <span className="ls-widget-row-meta">{summary.counts[group]}</span>
                </li>
              ))}
            </ul>
            <p className="ls-stat-label">{copy.next}</p>
            {summary.next.length === 0 ? (
              <p className="ls-stat-note">{copy.noNext}</p>
            ) : (
              <ul className="ls-widget-list">
                {summary.next.map((booking) => (
                  <li key={booking.id} className="ls-widget-row">
                    <span className="ls-widget-row-main">
                      {branchTime(booking.startsAt, data.branch.timezone, locale)}
                      {' · '}
                      {booking.owner.displayName}
                    </span>
                    <span className="ls-widget-row-meta">{booking.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      }}
    </WidgetFrame>
  );
}

export function InServiceWidget({ branchId, size, title }: WidgetProps) {
  const { t, locale } = useWorkforce();
  const today = useTodayBoard(branchId);
  const copy = t.dashboard.serving;
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={today}
      isEmpty={(data) => servingNow(data).rows.length === 0}
      emptyText={copy.empty}
      link={{ path: '/booking-board', label: t.dashboard.bookings.open }}
    >
      {(data) => {
        const serving = servingNow(data);
        const shown = serving.rows.slice(0, ROWS);
        return (
          <>
            <Stat
              label={copy.count}
              value={serving.count}
              format={{ valueFormat: 'count', locale }}
            />
            <ul className="ls-widget-list">
              {shown.map((row) => (
                <li key={row.lineId} className="ls-widget-row">
                  <span className="ls-widget-row-main">
                    {row.participant ?? copy.guest}
                    {' · '}
                    {locale === 'vi' ? row.serviceNameVi : row.serviceNameEn}
                  </span>
                  {row.ktv ? (
                    <span className="ls-widget-row-meta">{fill(copy.by, { name: row.ktv })}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {serving.rows.length > shown.length ? (
              <p className="ls-stat-note">
                {fill(copy.more, { count: serving.rows.length - shown.length })}
              </p>
            ) : null}
          </>
        );
      }}
    </WidgetFrame>
  );
}

export function WaitingWidget({ branchId, size, title }: WidgetProps) {
  const { t, locale } = useWorkforce();
  const today = useTodayBoard(branchId);
  const copy = t.dashboard.waiting;
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={today}
      link={{ path: '/booking-board', label: t.dashboard.bookings.open }}
    >
      {(data) => {
        const waiting = waitingSummary(data);
        return (
          <Stat
            label={copy.count}
            value={waiting.count}
            format={{ valueFormat: 'count', locale }}
            note={
              waiting.count === 0 || waiting.longestMinutes === null
                ? copy.none
                : fill(copy.longest, { minutes: waiting.longestMinutes })
            }
          />
        );
      }}
    </WidgetFrame>
  );
}
