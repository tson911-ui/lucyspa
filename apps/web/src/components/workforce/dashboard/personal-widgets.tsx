'use client';

import type {
  AttendanceListResponse,
  EmployeeBranchAssignmentsResponse,
  LeaveRequestListResponse,
  NotificationPage,
} from '@lucy-spa/contracts';
import { Icon, Stat, VisuallyHidden } from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { fill } from '../../../i18n/workforce';
import type { WidgetProps } from '../../../lib/workforce/dashboard/widgets';
import { formatTime } from '../../../lib/workforce/format';
import { NAV_ICONS } from '../../../lib/workforce/nav-groups';
import { navigationFor, type NavItem, type NavKey } from '../../../lib/workforce/permissions';
import { notificationHref, notificationMessage } from '../../../lib/notifications';
import { attendanceState } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import { Badge } from '../ui';
import { combine, loaded, useBranchMap, useShared } from './data';
import { WidgetFrame } from './widget-frame';

/** Latest notifications shown. */
const LATEST = 5;

export function PendingLeaveWidget({ size, title }: WidgetProps) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const pending = useShared(`leave-pending:${account.id}`, async (passive) => {
    const scoped = await api.get<LeaveRequestListResponse>(
      '/api/v1/leave-requests',
      { status: 'PENDING' },
      { passive },
    );
    // Your own requests are not decisions you make.
    return scoped.requests.filter((request) => request.employeeId !== account.id).length;
  });
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={pending}
      link={{ path: '/leave', label: t.dashboard.goLeave }}
    >
      {(count) => (
        <Stat
          label={t.dashboard.pendingLeaveCount}
          value={count}
          format={{ valueFormat: 'count', locale }}
        />
      )}
    </WidgetFrame>
  );
}

export function MyAttendanceWidget({ size, title }: WidgetProps) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranchMap();
  const mine = useShared(`attendance-me:${account.id}`, async (passive) => {
    const [assignments, attendance] = await Promise.all([
      api.get<EmployeeBranchAssignmentsResponse>(
        `/api/v1/employees/${account.id}/branch-assignments`,
        {},
        { passive },
      ),
      api.get<AttendanceListResponse>('/api/v1/attendance/me', {}, { passive }),
    ]);
    return { assignments, attendance };
  });
  const both = combine(mine, branches);
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={both}
      isEmpty={({ a }) => a.assignments.active.length === 0}
      emptyText={t.dashboard.noBranches}
      link={{ path: '/attendance', label: t.dashboard.goAttendance }}
    >
      {({ a, b }) => (
        <ul className="ls-widget-list">
          {a.assignments.active.map((assignment) => {
            const branch = b.get(assignment.branchId);
            if (!branch) return null;
            const state = attendanceState(a.attendance.records, branch.id, branch.timezone);
            return (
              <li key={assignment.id} className="ls-widget-row">
                <span className="ls-widget-row-main">{branch.name}</span>
                {state.kind === 'in' ? (
                  <Badge tone="success">
                    {fill(t.attendance.stateIn, {
                      time: formatTime(state.record.checkInAt, branch.timezone, locale),
                    })}
                  </Badge>
                ) : state.kind === 'out' ? (
                  <Badge tone="neutral">
                    {fill(t.attendance.stateOut, {
                      in: formatTime(state.record.checkInAt, branch.timezone, locale),
                      out: formatTime(state.record.checkOutAt!, branch.timezone, locale),
                    })}
                  </Badge>
                ) : (
                  <Badge tone="warning">{t.attendance.stateNone}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}

export function MyLeaveWidget({ size, title }: WidgetProps) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const mine = useShared(`leave-me:${account.id}`, async (passive) => {
    const response = await api.get<LeaveRequestListResponse>(
      '/api/v1/leave-requests/me',
      { status: 'PENDING' },
      { passive },
    );
    return response.requests.length;
  });
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={mine}
      link={{ path: '/leave', label: t.dashboard.goLeave }}
    >
      {(count) => (
        <Stat
          label={t.dashboard.myLeaveCount}
          value={count}
          format={{ valueFormat: 'count', locale }}
        />
      )}
    </WidgetFrame>
  );
}

export function NotificationsWidget({ size, title }: WidgetProps) {
  const { api, t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const copy = t.dashboard.notificationsList;
  const inbox = useShared(`notifications:${account.id}`, (passive) =>
    api.get<NotificationPage>('/api/v1/notifications', {}, { passive }),
  );
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={inbox}
      isEmpty={(page) => page.items.length === 0}
      emptyText={copy.empty}
      link={{ path: '/notifications', label: copy.open }}
    >
      {(page) => (
        <>
          <Stat
            label={copy.unread}
            value={page.unreadCount}
            format={{ valueFormat: 'count', locale }}
          />
          <ul className="ls-widget-list">
            {page.items.slice(0, LATEST).map((item) => {
              const href = notificationHref(item, account, base);
              const message = notificationMessage(item, locale);
              return (
                // Unread = a dot and the 600 weight, the word for screen readers only (no blue pill per line, C5).
                <li
                  key={item.id}
                  className="ls-dash-note"
                  data-unread={item.readAt === null || undefined}
                >
                  {item.readAt === null ? <span className="ls-dash-note-dot" aria-hidden /> : null}
                  {href ? (
                    <Link className="ls-dash-note-link" href={href}>
                      {message}
                      {item.readAt === null ? <VisuallyHidden>{copy.new}</VisuallyHidden> : null}
                    </Link>
                  ) : (
                    <span className="ls-dash-note-text">
                      {message}
                      {item.readAt === null ? <VisuallyHidden>{copy.new}</VisuallyHidden> : null}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </WidgetFrame>
  );
}

/**
 * The everyday tasks, most used first (Owner answer 5, session 10: "Lối tắt" stays as a compact list of the tasks people
 * open most, not a copy of the whole sidebar). Only the pages the sidebar offers this account are listed.
 */
const SHORTCUT_ORDER: readonly NavKey[] = [
  'pos',
  'bookingBoard',
  'walkIn',
  'myServices',
  'attendance',
  'leave',
  'loyalty',
  'productOrders',
  'onlineOrders',
  'cash',
  'inventory',
  'reportsRevenue',
  'collaboratorSchedule',
  'myIncome',
  'myPayslips',
  'myAccount',
];
/** At most this many shortcuts; the sidebar holds the rest. */
const SHORTCUT_LIMIT = 8;

/** The shortcuts of an account: the sidebar's pages (permission-filtered) in the most-used order. */
export function shortcutsFor(items: readonly NavItem[]): NavItem[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  return SHORTCUT_ORDER.flatMap((key) => byKey.get(key) ?? []).slice(0, SHORTCUT_LIMIT);
}

export function QuickLinksWidget({ size, title }: WidgetProps) {
  const { t, base } = useWorkforce();
  const { account } = useAccount();
  const items = shortcutsFor(navigationFor(account));
  return (
    <WidgetFrame
      title={title}
      size={size}
      resource={loaded(items)}
      isEmpty={(list) => list.length === 0}
    >
      {(list) => (
        <ul className="ls-dash-shortcuts">
          {list.map((item) => (
            <li key={item.key}>
              <Link className="ls-dash-shortcut" href={`${base}${item.path}`}>
                <Icon name={NAV_ICONS[item.key]} size={20} />
                <span>{t.nav[item.key]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
