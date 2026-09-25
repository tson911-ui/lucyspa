'use client';

import type {
  AttendanceListResponse,
  EmployeeBranchAssignmentsResponse,
  LeaveRequestListResponse,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { fill } from '../../../i18n/workforce';
import { formatTime } from '../../../lib/workforce/format';
import { canAnywhere, navigationFor } from '../../../lib/workforce/permissions';
import { attendanceState } from '../../../lib/workforce/workflows';
import { branchLabel, useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, ErrorState, Loading, PageHeader, Section, useResource } from '../ui';

/**
 * Lightweight Phase 2 home: identity, own branches, today's attendance per branch, own
 * pending leave and, for approvers, the number of pending requests in scope. No
 * analytics that the backend does not provide.
 */
export function DashboardScreen() {
  const { api, t, base, locale } = useWorkforce();
  const { account } = useAccount();
  const employee = account.kind === 'EMPLOYEE';
  const approver = canAnywhere(account, 'APPROVE_LEAVE');
  const branches = useBranches(api);
  const mine = useResource(async () => {
    if (!employee) return null;
    const [assignments, attendance, leave] = await Promise.all([
      api.get<EmployeeBranchAssignmentsResponse>(
        `/api/v1/employees/${account.id}/branch-assignments`,
      ),
      api.get<AttendanceListResponse>('/api/v1/attendance/me', {}),
      api.get<LeaveRequestListResponse>('/api/v1/leave-requests/me', { status: 'PENDING' }),
    ]);
    return { assignments, attendance, leave };
  }, [api, employee, account.id]);
  const pending = useResource(async () => {
    if (!approver) return null;
    const scoped = await api.get<LeaveRequestListResponse>('/api/v1/leave-requests', {
      status: 'PENDING',
    });
    return scoped.requests.filter((request) => request.employeeId !== account.id).length;
  }, [api, approver, account.id]);
  const management = navigationFor(account).filter((item) => item.group === 'management');

  return (
    <>
      <PageHeader
        title={fill(t.dashboard.greeting, { name: account.displayName })}
        intro={t.dashboard.intro}
      />
      {!employee ? <p className="wf-muted">{t.dashboard.ownerNote}</p> : null}
      {employee ? (
        <div className="wf-grid">
          <Section title={t.dashboard.todayAttendance}>
            {mine.loading || branches.loading ? <Loading t={t} /> : null}
            {mine.error ? (
              <ErrorState error={mine.error} t={t} onRetry={() => void mine.reload()} />
            ) : null}
            {mine.data && mine.data.assignments.active.length === 0 ? (
              <p>{t.dashboard.noBranches}</p>
            ) : null}
            <ul className="wf-plain-list">
              {mine.data?.assignments.active.map((assignment) => {
                const branch = branches.data?.get(assignment.branchId);
                if (!branch) return null;
                const state = attendanceState(
                  mine.data!.attendance.records,
                  branch.id,
                  branch.timezone,
                );
                return (
                  <li key={assignment.id}>
                    <strong>{branch.name}</strong>{' '}
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
            <Link className="wf-button wf-button-primary" href={`${base}/attendance`}>
              {t.dashboard.goAttendance}
            </Link>
          </Section>
          <Section title={t.dashboard.myLeave}>
            {mine.data ? (
              <p>{fill(t.dashboard.pendingMine, { count: mine.data.leave.requests.length })}</p>
            ) : null}
            <Link className="wf-button" href={`${base}/leave`}>
              {t.dashboard.goLeave}
            </Link>
          </Section>
          <Section title={t.dashboard.myBranches}>
            {mine.data?.assignments.active.length ? (
              <ul className="wf-plain-list">
                {mine.data.assignments.active.map((assignment) => (
                  <li key={assignment.id}>{branchLabel(assignment.branchId, branches.data, t)}</li>
                ))}
              </ul>
            ) : (
              <p className="wf-muted">{t.dashboard.noBranches}</p>
            )}
          </Section>
        </div>
      ) : null}
      {approver && pending.data !== null ? (
        <Section title={t.leave.decisions}>
          <p>{fill(t.dashboard.pendingDecisions, { count: pending.data })}</p>
          <Link className="wf-button" href={`${base}/leave`}>
            {t.dashboard.goLeave}
          </Link>
        </Section>
      ) : null}
      {management.length > 0 ? (
        <Section title={t.dashboard.management}>
          <ul className="wf-link-grid">
            {management.map((item) => (
              <li key={item.key}>
                <Link href={`${base}${item.path}`}>{t.nav[item.key]}</Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
