'use client';

import type {
  OperationalActiveVisit,
  OperationalActiveVisitLine,
  OperationalBooking,
  OperationalQueueKtv,
  OperationalTodayResponse,
  OperationalWaitingEntry,
} from '@lucy-spa/contracts';
import {
  Badge as StatusBadge,
  Button,
  buttonClass,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  EmptyState,
  Grid,
  IconButton,
  ListSection,
  RowActions,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { memo } from 'react';
import { PrefetchLink as Link } from '../link';
import { fill } from '../../../i18n/workforce';
import { stateTone } from '../../../lib/workforce/booking-board';
import { canAt } from '../../../lib/workforce/permissions';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { useAccount, useWorkforce } from '../session';
import { Badge, Loading } from '../ui';
import { metaLine, minutes } from './pos-format';
import { useUrlPage } from './pos-url';
import type { BoardCommand } from './booking-board-dialogs';

// A branch clock: `time(iso)` and `time.range(start, end)` (Intl formatRange, wig :75).
export type Time = ((iso: string) => string) & {
  range: (startIso: string, endIso: string) => string;
};

/** One row of the open-visits table: a service line, or a visit that has no line left to show. */
export type ActiveRow = {
  key: string;
  visit: OperationalActiveVisit;
  line: OperationalActiveVisitLine | null;
};

/** Every open visit as its service lines, so the actions of a line sit on the line's own row. */
export function activeRows(visits: readonly OperationalActiveVisit[]): ActiveRow[] {
  return visits.flatMap((visit): ActiveRow[] =>
    visit.lines.length === 0
      ? [{ key: `${visit.id}:none`, visit, line: null }]
      : visit.lines.map((line) => ({ key: `${visit.id}:${line.id}`, visit, line })),
  );
}

/** Today's bookings: the arrival, no-show and priority decisions are in the row menu. */
// Memoised with stable handlers from the board (rbp booking-board.tsx:248, :303-345).
export const BookingsSection = memo(function BookingsSection({
  bookings,
  loading,
  empty,
  time,
  onCommand,
}: {
  bookings: OperationalBooking[];
  loading: boolean;
  empty: string | null;
  time: Time;
  onCommand: (command: BoardCommand) => void;
}) {
  const { t, locale } = useWorkforce();
  const b = t.bookingBoard;
  const paging = useUrlPage('bookingsPage');
  const columns: DataTableColumn<OperationalBooking>[] = [
    {
      key: 'time',
      header: b.time,
      mobileTitle: true,
      cell: (booking) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main">{time.range(booking.startsAt, booking.endsAt)}</span>
          <span className="ls-cell-sub" translate="no">
            {booking.code}
          </span>
        </span>
      ),
    },
    {
      key: 'customer',
      header: b.customer,
      wrap: true,
      width: 'md',
      cell: (booking) => (
        <span className="ls-cell-stack">
          {/* Names wrap by word, never cut (Owner answer 7). */}
          <span className="ls-pos-name">{booking.owner.displayName}</span>
          <span className="ls-cell-sub ls-hide-xl">{booking.owner.phoneMasked ?? ' '}</span>
        </span>
      ),
    },
    {
      key: 'services',
      header: b.serviceCol,
      hideBelow: 'md',
      // One line per service (service, guest, staff as a comma list): wrapped, never clamped, and the staff name always shows.
      cell: (booking) => (
        <span className="ls-cell-stack">
          {booking.lines.map((line) => (
            <span key={line.sequence} className="ls-pos-name">
              {metaLine(locale, [
                locale === 'vi' ? line.serviceNameVi : line.serviceNameEn,
                line.recipientName ?? b.self,
                line.employee.displayName,
              ])}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'state',
      header: b.state,
      cell: (booking) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main">
            <Badge tone={stateTone(booking.state)}>{b.states[booking.state]}</Badge>
            {booking.lines.some((line) => line.conflict) ? (
              <Badge tone="warning">{b.conflictShort}</Badge>
            ) : null}
          </span>
          {/* The arrival and its punctuality as one Intl list, not a bracket glued on in code. */}
          <span className="ls-cell-sub ls-hide-xl">
            {booking.visit
              ? metaLine(locale, [
                  fill(b.arrivedAt, { time: time(booking.visit.arrivedAt) }),
                  b.punctuality[booking.visit.punctuality],
                ])
              : booking.state === 'UPCOMING'
                ? fill(b.arrivalOpens, { time: time(booking.arrivalOpensAt) })
                : booking.state === 'LATE_HOLD' || booking.state === 'HOLD_EXPIRED'
                  ? fill(b.holdUntil, { time: time(booking.holdUntil) })
                  : ' '}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (booking) => {
        const items: MenuItem[] = [
          ...(booking.actions.advance && booking.visit
            ? [
                {
                  id: 'advance',
                  label: b.advanceOpen,
                  icon: 'arrow-up' as const,
                  onSelect: () =>
                    onCommand({
                      kind: 'advance',
                      visitId: booking.visit!.id,
                      code: booking.visit!.code,
                    }),
                },
              ]
            : []),
          ...(booking.actions.noShow
            ? [
                {
                  id: 'noShow',
                  label: b.noShowOpen,
                  icon: 'x-circle' as const,
                  tone: 'danger' as const,
                  onSelect: () => onCommand({ kind: 'noShow', booking }),
                },
              ]
            : []),
        ];
        const menu = (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: booking.code })}
            items={items}
          />
        );
        // Check-in is the front desk's main action, so it is a button on the row; the rest stay in the menu.
        return booking.actions.arrive ? (
          <div className="ls-row-actions">
            <Button
              className="ls-hide-xl"
              icon="check-circle"
              aria-label={`${b.arrive}: ${booking.code}`}
              onClick={() => onCommand({ kind: 'arrive', booking })}
            >
              {b.arriveShort}
            </Button>
            <IconButton
              className="ls-show-below-xl"
              variant="secondary"
              icon="check-circle"
              label={`${b.arrive}: ${booking.code}`}
              onClick={() => onCommand({ kind: 'arrive', booking })}
            />
            {menu}
          </div>
        ) : (
          menu
        );
      },
    },
  ];
  return (
    <ListSection title={b.bookings}>
      {empty && !loading && bookings.length === 0 ? (
        // An empty lane says so with an icon and one sentence (DESIGN 8.4); the header keeps the actions.
        <EmptyState icon="calendar">{empty}</EmptyState>
      ) : (
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: b.bookings })}
          columns={columns}
          rows={bookings}
          rowKey={(booking) => booking.id}
          loading={loading}
          loadingLabel={t.common.loading}
          paging={{
            ...paging,
            labels: paginationLabels(t, b.bookings),
          }}
        />
      )}
    </ListSection>
  );
});

/** Open visits (a service line per row): end a forgotten service, cancel an unstarted one, add a service. */
// Memoised with stable handlers from the board (rbp booking-board.tsx:248, :303-345).
export const ActiveSection = memo(function ActiveSection({
  board,
  loading,
  time,
  onResolve,
  onCancelLine,
  onAddService,
}: {
  board: OperationalTodayResponse | null;
  loading: boolean;
  time: Time;
  onResolve: (visit: OperationalActiveVisit, line: OperationalActiveVisitLine) => void;
  onCancelLine: (visit: OperationalActiveVisit, line: OperationalActiveVisitLine) => void;
  onAddService: (visit: OperationalActiveVisit) => void;
}) {
  const { t, locale } = useWorkforce();
  const b = t.bookingBoard;
  const paging = useUrlPage('activePage');
  const columns: DataTableColumn<ActiveRow>[] = [
    {
      key: 'visit',
      header: b.visitCol,
      mobileTitle: true,
      cell: (row) => <span translate="no">{row.visit.code}</span>,
    },
    {
      key: 'guest',
      header: b.guestCol,
      wrap: true,
      width: 'sm',
      hideBelow: 'lg',
      cell: (row) => (row.line ? (row.line.participantName ?? b.self) : '—'),
    },
    {
      key: 'service',
      header: b.serviceCol,
      wrap: true,
      width: 'sm',
      cell: (row) =>
        row.line ? (locale === 'vi' ? row.line.serviceNameVi : row.line.serviceNameEn) : '—',
    },
    {
      key: 'staff',
      header: b.activeStaff,
      wrap: true,
      // The staff name stays in view on a 1024 px counter screen (C74).
      hideBelow: 'lg',
      cell: (row) => (row.line ? (row.line.employee?.displayName ?? b.activeUnassigned) : '—'),
    },
    {
      key: 'status',
      header: b.state,
      cell: (row) =>
        row.line ? (
          <>
            <Badge tone={row.line.status === 'IN_PROGRESS' ? 'info' : 'neutral'}>
              {b.lineStatuses[row.line.status]}
            </Badge>
            {row.line.execution && row.line.execution.startedEarlyMinutes > 0 ? (
              <>
                {' '}
                <Badge tone="neutral">
                  {fill(b.startedEarly, { minutes: row.line.execution.startedEarlyMinutes })}
                </Badge>
              </>
            ) : null}
            {row.line.execution?.overdue ? (
              <>
                {' '}
                <StatusBadge tone="warning" icon="clock">
                  {b.overdue}
                </StatusBadge>
              </>
            ) : null}
          </>
        ) : (
          '—'
        ),
    },
    {
      key: 'timing',
      header: b.timing,
      hideBelow: 'xl',
      wrap: true,
      width: 'lg',
      cell: (row) =>
        row.line?.execution
          ? fill(b.runningSince, {
              start: time(row.line.execution.startedAt),
              end: time(row.line.execution.expectedEndAt),
            })
          : '—',
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => {
        const { visit, line } = row;
        const items: MenuItem[] = [
          ...(visit.actions.addService
            ? [
                {
                  id: 'add',
                  label: b.addServiceOpen,
                  icon: 'plus' as const,
                  onSelect: () => onAddService(visit),
                },
              ]
            : []),
          ...(line?.actions.resolve
            ? [
                {
                  id: 'resolve',
                  label: b.resolveEndOpen,
                  icon: 'clock' as const,
                  onSelect: () => onResolve(visit, line),
                },
              ]
            : []),
          ...(line?.actions.cancel
            ? [
                {
                  id: 'cancel',
                  label: b.cancelLineOpen,
                  icon: 'x-circle' as const,
                  tone: 'danger' as const,
                  onSelect: () => onCancelLine(visit, line),
                },
              ]
            : []),
        ];
        return (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: visit.code })}
            items={items}
          />
        );
      },
    },
  ];
  const rows = activeRows(board?.activeVisits ?? []);
  return (
    <ListSection title={b.active}>
      {board && rows.length === 0 ? (
        <EmptyState icon="users">{b.activeEmpty}</EmptyState>
      ) : (
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: b.active })}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          loading={loading}
          loadingLabel={t.common.loading}
          paging={{
            ...paging,
            labels: paginationLabels(t, b.active),
          }}
        />
      )}
    </ListSection>
  );
});

/**
 * The branch waiting pool (unassigned walk-in services: no KTV, no time). The order is advisory; staff assign
 * any entry that fits. "Assign staff" asks the server to place the participant's whole sequence now.
 */
// Memoised with stable handlers from the board (rbp booking-board.tsx:248, :303-345).
export const PoolSection = memo(function PoolSection({
  board,
  loading,
  busy,
  canChangeIntent,
  onAssign,
  onChangeIntent,
  onCommand,
  time,
}: {
  board: OperationalTodayResponse | null;
  loading: boolean;
  busy: string | null;
  canChangeIntent: boolean;
  onAssign: (entry: OperationalWaitingEntry) => void;
  onChangeIntent: (entry: OperationalWaitingEntry) => void;
  onCommand: (command: BoardCommand) => void;
  time: Time;
}) {
  const { t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const b = t.bookingBoard;
  const paging = useUrlPage('poolPage');
  const columns: DataTableColumn<OperationalWaitingEntry>[] = [
    {
      key: 'position',
      header: b.positionCol,
      numeric: true,
      cell: (entry) => entry.position,
    },
    {
      key: 'guest',
      header: b.guestCol,
      mobileTitle: true,
      wrap: true,
      width: 'sm',
      cell: (entry) => entry.participantName,
    },
    {
      key: 'kind',
      header: b.kindCol,
      hideBelow: 'xl',
      cell: (entry) => <Badge tone="neutral">{t.walkIn.kinds[entry.participantKind]}</Badge>,
    },
    {
      key: 'group',
      header: b.groupCol,
      cell: (entry) => <Badge tone="info">{b.groups[entry.group]}</Badge>,
    },
    {
      key: 'services',
      header: b.serviceCol,
      wrap: true,
      width: 'md',
      // One line per service; the duration through Intl ("45 phút"), not a hand-written "′" (wig walk-in.tsx:379 family).
      cell: (entry) => (
        <span className="ls-cell-stack">
          {entry.lines.map((line) => (
            <span key={line.id} className="ls-pos-name">
              {metaLine(locale, [
                locale === 'vi' ? line.serviceNameVi : line.serviceNameEn,
                minutes(locale, line.durationMinutes),
                line.requestedEmployee
                  ? fill(b.requested, { name: line.requestedEmployee.displayName })
                  : b.any,
              ])}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'arrived',
      header: b.arrivedCol,
      hideBelow: 'xl',
      // The visit code (not translated) above its arrival time, like the bookings' time column.
      cell: (entry) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main" translate="no">
            {entry.visitCode}
          </span>
          <span className="ls-cell-sub">{fill(b.arrivedAt, { time: time(entry.arrivedAt) })}</span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (entry) => {
        const items: MenuItem[] = [
          ...(entry.actions.assign
            ? [
                {
                  id: 'assign',
                  label: busy === entry.participantId ? b.assigning : b.assignNow,
                  icon: 'user-plus' as const,
                  disabled: busy !== null,
                  onSelect: () => onAssign(entry),
                },
              ]
            : []),
          ...(entry.actions.changeIntent && canChangeIntent
            ? [
                {
                  id: 'intent',
                  label: b.changeStaffOpen,
                  icon: 'swap' as const,
                  disabled: busy !== null,
                  onSelect: () => onChangeIntent(entry),
                },
              ]
            : []),
          ...(entry.actions.advance
            ? [
                {
                  id: 'advance',
                  label: b.advanceOpen,
                  icon: 'arrow-up' as const,
                  onSelect: () =>
                    onCommand({ kind: 'advance', visitId: entry.visitId, code: entry.visitCode }),
                },
              ]
            : []),
          ...(entry.actions.cancel
            ? [
                {
                  id: 'cancel',
                  label: b.cancelWalkInOpen,
                  icon: 'x-circle' as const,
                  tone: 'danger' as const,
                  onSelect: () =>
                    onCommand({
                      kind: 'cancelWalkIn',
                      visitId: entry.visitId,
                      code: entry.visitCode,
                    }),
                },
              ]
            : []),
        ];
        return (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: entry.participantName })}
            items={items}
          />
        );
      },
    },
  ];
  return (
    <ListSection title={b.pool}>
      {board && board.waitingPool.length === 0 ? (
        // The waiting lane's next step is to check a guest in (plan: "Tiếp nhận khách"), a secondary link: one primary per view.
        // Only for someone who may check guests in at this branch (the board itself needs only VIEW_BOOKINGS).
        <EmptyState
          icon="user-plus"
          action={
            account && board && canAt(account, 'MANAGE_BOOKINGS', board.branch.id) ? (
              <Link className={buttonClass('secondary')} href={`${base}/walk-in`}>
                <span className="ls-btn-label">{t.pos.awaitingAction}</span>
              </Link>
            ) : undefined
          }
        >
          {b.poolEmpty}
        </EmptyState>
      ) : (
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: b.pool })}
          columns={columns}
          rows={board?.waitingPool ?? []}
          rowKey={(entry) => entry.participantId}
          loading={loading}
          loadingLabel={t.common.loading}
          paging={{
            ...paging,
            labels: paginationLabels(t, b.pool),
          }}
        />
      )}
    </ListSection>
  );
});

/** The computed queue per staff member: equal-height cards in one grid. */
// Memoised with stable handlers from the board (rbp booking-board.tsx:248, :303-345).
export const QueueSection = memo(function QueueSection({
  board,
  time,
}: {
  board: OperationalTodayResponse | null;
  time: Time;
}) {
  const { t } = useWorkforce();
  const b = t.bookingBoard;
  return (
    <ListSection title={b.queue}>
      {/* While the board loads, a skeleton holds the place, so the cards do not pop in and shift the page (wig :566). */}
      {board ? null : <Loading t={t} />}
      {board && board.queue.length === 0 ? (
        <EmptyState icon="clock">{b.queueEmpty}</EmptyState>
      ) : null}
      {board && board.queue.length > 0 ? (
        <Grid min="md">
          {board.queue.map((ktv) => (
            <QueueCard key={ktv.employee.id} ktv={ktv} time={time} />
          ))}
        </Grid>
      ) : null}
    </ListSection>
  );
});

function QueueCard({ ktv, time }: { ktv: OperationalQueueKtv; time: Time }) {
  const { t, locale } = useWorkforce();
  const b = t.bookingBoard;
  const name = (vi: string, en: string) => (locale === 'vi' ? vi : en);
  const items = [
    ...(ktv.serving.length > 0
      ? [
          {
            label: b.serving,
            value: (
              <ul className="ls-list-plain">
                {ktv.serving.map((entry, index) => (
                  <li key={`${entry.participantName}-${index}`}>
                    {metaLine(locale, [
                      entry.participantName,
                      name(entry.serviceNameVi, entry.serviceNameEn),
                    ])}
                    {entry.startedEarlyMinutes > 0 ? (
                      <>
                        {' '}
                        <Badge tone="neutral">
                          {fill(b.startedEarly, { minutes: entry.startedEarlyMinutes })}
                        </Badge>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    {
      label: b.waiting,
      value:
        ktv.waiting.length === 0 ? (
          b.noWaiting
        ) : (
          <ol className="ls-list-plain">
            {ktv.waiting.map((entry) => (
              <li key={`${entry.visitId}-${entry.plannedStartAt}`}>
                {/* The position is the real queue order; the facts after it are one comma list. */}
                {entry.position}.{' '}
                {metaLine(locale, [
                  entry.participantName,
                  name(entry.serviceNameVi, entry.serviceNameEn),
                  time(entry.plannedStartAt),
                ])}{' '}
                <Badge tone="info">{b.groups[entry.group]}</Badge>
              </li>
            ))}
          </ol>
        ),
    },
    ...(ktv.reserved.length > 0
      ? [
          {
            label: b.reserved,
            value: (
              <ul className="ls-list-plain">
                {ktv.reserved.map((entry) => (
                  <li key={`${entry.bookingId}-${entry.startsAt}`}>
                    {metaLine(locale, [
                      time.range(entry.startsAt, entry.endsAt),
                      entry.bookingCode,
                      b.states[entry.state],
                    ])}
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
  ];
  return (
    <Card as="article" aria-label={ktv.employee.displayName} className="ls-pos-queue-card">
      <CardHeader
        title={ktv.employee.displayName}
        headingLevel={3}
        actions={
          <Badge tone={ktv.freeNow ? 'success' : 'neutral'}>{ktv.freeNow ? b.free : b.busy}</Badge>
        }
      />
      <DescriptionList items={items} />
    </Card>
  );
}
