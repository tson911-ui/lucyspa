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
  Button,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  Grid,
  IconButton,
  ListSection,
  RowActions,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { stateTone } from '../../../lib/workforce/booking-board';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { useWorkforce } from '../session';
import { Badge, Empty } from '../ui';
import type { BoardCommand } from './booking-board-dialogs';

type Time = (iso: string) => string;

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
export function BookingsSection({
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
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const columns: DataTableColumn<OperationalBooking>[] = [
    {
      key: 'time',
      header: b.time,
      mobileTitle: true,
      cell: (booking) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main">
            {time(booking.startsAt)}–{time(booking.endsAt)}
          </span>
          <span className="ls-cell-sub">{booking.code}</span>
        </span>
      ),
    },
    {
      key: 'customer',
      header: b.customer,
      truncate: true,
      width: 'md',
      cell: (booking) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-title" title={booking.owner.displayName}>
            {booking.owner.displayName}
          </span>
          <span className="ls-cell-sub ls-hide-xl">{booking.owner.phoneMasked ?? ' '}</span>
        </span>
      ),
    },
    {
      key: 'services',
      header: b.serviceCol,
      hideBelow: 'md',
      cell: (booking) => {
        const text = booking.lines
          .map(
            (line) =>
              `${locale === 'vi' ? line.serviceNameVi : line.serviceNameEn} · ${line.recipientName ?? b.self} · ${line.employee.displayName}`,
          )
          .join('; ');
        return (
          <span className="ls-cell-clamp" title={text}>
            {text}
          </span>
        );
      },
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
          <span className="ls-cell-sub ls-hide-xl">
            {booking.visit
              ? `${fill(b.arrivedAt, { time: time(booking.visit.arrivedAt) })} (${b.punctuality[booking.visit.punctuality]})`
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
                  label: b.advance,
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
                  label: b.noShow,
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
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: b.bookings })}
        columns={columns}
        rows={bookings}
        rowKey={(booking) => booking.id}
        loading={loading}
        loadingLabel={t.common.loading}
        empty={empty ? <Empty>{empty}</Empty> : undefined}
        paging={{
          ...paging,
          onPageChange: (page) => setPaging((current) => ({ ...current, page })),
          onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
          labels: paginationLabels(t, b.bookings),
        }}
      />
    </ListSection>
  );
}

/** Open visits (a service line per row): end a forgotten service, cancel an unstarted one, add a service. */
export function ActiveSection({
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
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const columns: DataTableColumn<ActiveRow>[] = [
    { key: 'visit', header: b.visitCol, mobileTitle: true, cell: (row) => row.visit.code },
    {
      key: 'guest',
      header: b.guestCol,
      truncate: true,
      width: 'sm',
      hideBelow: 'lg',
      cell: (row) => (row.line ? (row.line.participantName ?? b.self) : '—'),
    },
    {
      key: 'service',
      header: b.serviceCol,
      truncate: true,
      width: 'sm',
      cell: (row) =>
        row.line ? (locale === 'vi' ? row.line.serviceNameVi : row.line.serviceNameEn) : '—',
    },
    {
      key: 'staff',
      header: b.activeStaff,
      truncate: true,
      hideBelow: 'xl',
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
                <Badge tone="warning">{b.overdue}</Badge>
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
      truncate: true,
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
                  label: b.addService,
                  icon: 'plus' as const,
                  onSelect: () => onAddService(visit),
                },
              ]
            : []),
          ...(line?.actions.resolve
            ? [
                {
                  id: 'resolve',
                  label: b.resolveEnd,
                  icon: 'clock' as const,
                  onSelect: () => onResolve(visit, line),
                },
              ]
            : []),
          ...(line?.actions.cancel
            ? [
                {
                  id: 'cancel',
                  label: b.cancelLine,
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
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: b.active })}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        loading={loading}
        loadingLabel={t.common.loading}
        empty={board ? <Empty>{b.activeEmpty}</Empty> : undefined}
        paging={{
          ...paging,
          onPageChange: (page) => setPaging((current) => ({ ...current, page })),
          onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
          labels: paginationLabels(t, b.active),
        }}
      />
    </ListSection>
  );
}

/**
 * The branch waiting pool (unassigned walk-in services: no KTV, no time). The order is advisory; staff assign
 * any entry that fits. "Assign staff" asks the server to place the participant's whole sequence now.
 */
export function PoolSection({
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
  const { t, locale } = useWorkforce();
  const b = t.bookingBoard;
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
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
      truncate: true,
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
      cell: (entry) =>
        entry.lines
          .map(
            (line) =>
              `${locale === 'vi' ? line.serviceNameVi : line.serviceNameEn} · ${line.durationMinutes}′ · ${
                line.requestedEmployee
                  ? fill(b.requested, { name: line.requestedEmployee.displayName })
                  : b.any
              }`,
          )
          .join('; '),
    },
    {
      key: 'arrived',
      header: b.arrivedCol,
      hideBelow: 'xl',
      cell: (entry) =>
        `${entry.visitCode} · ${fill(b.arrivedShort, { time: time(entry.arrivedAt) })}`,
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
                  label: b.changeStaff,
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
                  label: b.advance,
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
                  label: b.cancelWalkIn,
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
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: b.pool })}
        columns={columns}
        rows={board?.waitingPool ?? []}
        rowKey={(entry) => entry.participantId}
        loading={loading}
        loadingLabel={t.common.loading}
        empty={board ? <Empty>{b.poolEmpty}</Empty> : undefined}
        paging={{
          ...paging,
          onPageChange: (page) => setPaging((current) => ({ ...current, page })),
          onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
          labels: paginationLabels(t, b.pool),
        }}
      />
    </ListSection>
  );
}

/** The computed queue per staff member: equal-height cards in one grid. */
export function QueueSection({
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
      {board && board.queue.length === 0 ? <Empty>{b.queueEmpty}</Empty> : null}
      {board && board.queue.length > 0 ? (
        <Grid min="md">
          {board.queue.map((ktv) => (
            <QueueCard key={ktv.employee.id} ktv={ktv} time={time} />
          ))}
        </Grid>
      ) : null}
    </ListSection>
  );
}

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
                    {entry.participantName} ({name(entry.serviceNameVi, entry.serviceNameEn)})
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
                {entry.position}. {entry.participantName} ·{' '}
                {name(entry.serviceNameVi, entry.serviceNameEn)} · {time(entry.plannedStartAt)}{' '}
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
                    {time(entry.startsAt)}–{time(entry.endsAt)} · {entry.bookingCode} ·{' '}
                    {b.states[entry.state]}
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
  ];
  return (
    <Card as="article" aria-label={ktv.employee.displayName}>
      <CardHeader
        title={ktv.employee.displayName}
        headingLevel={3}
        clamp
        actions={
          <Badge tone={ktv.freeNow ? 'success' : 'neutral'}>{ktv.freeNow ? b.free : b.busy}</Badge>
        }
      />
      <DescriptionList items={items} />
    </Card>
  );
}
