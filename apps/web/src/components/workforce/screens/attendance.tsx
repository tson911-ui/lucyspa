'use client';

import type {
  AttendanceCorrectionRequest,
  AttendanceListResponse,
  AttendanceRecordResponse,
  BranchSummary,
  EmployeeBranchAssignmentsResponse,
} from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  formatDate,
  formatTime,
  todayIn,
  zonedInstant,
  zonedLocal,
} from '../../../lib/workforce/format';
import { canAnywhere, canAt, canGlobal } from '../../../lib/workforce/permissions';
import {
  attendanceState,
  canCorrectAttendance,
  runMutation,
} from '../../../lib/workforce/workflows';
import { branchLabel, employeeLabel, useBranches, useEmployeeNames } from '../data';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  FormFeedback,
  Loading,
  Notice,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';

export function AttendanceScreen() {
  const { t } = useWorkforce();
  const { account } = useAccount();
  return (
    <>
      <PageHeader title={t.attendance.title} />
      {account.kind === 'EMPLOYEE' ? <SelfAttendance /> : null}
      {canAnywhere(account, 'VIEW_ATTENDANCE') ? <BranchAttendance /> : null}
    </>
  );
}

function SelfAttendance() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const own = useResource(async () => {
    const [assignments, attendance] = await Promise.all([
      api.get<EmployeeBranchAssignmentsResponse>(
        `/api/v1/employees/${account.id}/branch-assignments`,
      ),
      api.get<AttendanceListResponse>('/api/v1/attendance/me'),
    ]);
    return { assignments, records: attendance.records };
  }, [api, account.id]);
  const submit = useSubmit();

  async function act(work: () => Promise<unknown>, message: string) {
    await submit.run(async () => {
      const outcome = await runMutation(work, own.reload);
      if (outcome.ok) await own.reload();
      return outcome;
    }, message);
  }

  const active = (own.data?.assignments.active ?? [])
    .map((assignment) => branches.data?.get(assignment.branchId))
    .filter((branch): branch is BranchSummary => branch !== undefined);

  return (
    <Section title={t.attendance.self}>
      <p className="wf-muted">{t.attendance.selfIntro}</p>
      {own.loading || branches.loading ? <Loading t={t} /> : null}
      {own.error ? <ErrorState error={own.error} t={t} onRetry={() => void own.reload()} /> : null}
      <FormFeedback error={submit.error} success={submit.success} t={t} />
      {own.data && own.data.assignments.active.length === 0 ? (
        <Notice tone="info">{t.attendance.noBranch}</Notice>
      ) : null}
      <div className="wf-cards">
        {active.map((branch) => {
          const state = attendanceState(own.data?.records ?? [], branch.id, branch.timezone);
          return (
            <article className="wf-card" key={branch.id} aria-label={branch.name}>
              <h3>{branch.name}</h3>
              <p>
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
              </p>
              {state.kind === 'openPast' ? (
                <Notice tone="warning">
                  {fill(t.attendance.stateOpenPast, {
                    date: formatDate(state.record.businessDate, locale),
                  })}
                </Notice>
              ) : null}
              {state.kind === 'in' ? (
                <button
                  type="button"
                  className="wf-button wf-button-primary wf-button-large"
                  disabled={submit.pending}
                  onClick={() =>
                    void act(
                      () => api.post(`/api/v1/attendance/${state.record.id}/check-out`, {}),
                      t.attendance.checkedOut,
                    )
                  }
                >
                  {t.attendance.checkOut}
                </button>
              ) : state.kind === 'none' || state.kind === 'openPast' ? (
                <button
                  type="button"
                  className="wf-button wf-button-primary wf-button-large"
                  disabled={submit.pending}
                  onClick={() =>
                    void act(
                      () => api.post('/api/v1/attendance/check-in', { branchId: branch.id }),
                      t.attendance.checkedIn,
                    )
                  }
                >
                  {t.attendance.checkIn}
                </button>
              ) : null}
              <p className="wf-small wf-muted">
                {fill(t.attendance.timezoneNote, { timezone: branch.timezone })}
              </p>
            </article>
          );
        })}
      </div>
      <h3>{t.attendance.history}</h3>
      {own.data && own.data.records.length === 0 ? <Empty>{t.common.empty}</Empty> : null}
      {own.data && own.data.records.length > 0 ? (
        <AttendanceTable records={own.data.records} branches={branches.data} showEmployee={false} />
      ) : null}
    </Section>
  );
}

function AttendanceTable({
  records,
  branches,
  showEmployee,
  employee,
  action,
}: {
  records: readonly AttendanceRecordResponse[];
  branches: Map<string, BranchSummary> | null;
  showEmployee: boolean;
  employee?: (id: string) => string;
  action?: (record: AttendanceRecordResponse) => React.ReactNode;
}) {
  const { t, locale } = useWorkforce();
  return (
    <table className="wf-table">
      <thead>
        <tr>
          <th scope="col">{t.attendance.businessDate}</th>
          {showEmployee ? <th scope="col">{t.attendance.employee}</th> : null}
          <th scope="col">{t.common.branch}</th>
          <th scope="col">{t.attendance.checkInAt}</th>
          <th scope="col">{t.attendance.checkOutAt}</th>
          {action ? <th scope="col">{t.common.actions}</th> : null}
        </tr>
      </thead>
      <tbody>
        {records.map((record) => {
          const zone = branches?.get(record.branchId)?.timezone ?? 'UTC';
          return (
            <tr key={record.id}>
              <td data-label={t.attendance.businessDate}>
                {formatDate(record.businessDate, locale)}
              </td>
              {showEmployee ? (
                <td data-label={t.attendance.employee}>{employee?.(record.employeeId)}</td>
              ) : null}
              <td data-label={t.common.branch}>{branchLabel(record.branchId, branches, t)}</td>
              <td data-label={t.attendance.checkInAt}>
                {formatTime(record.checkInAt, zone, locale)}
              </td>
              <td data-label={t.attendance.checkOutAt}>
                {record.checkOutAt ? (
                  formatTime(record.checkOutAt, zone, locale)
                ) : (
                  <Badge tone="warning">{t.attendance.open}</Badge>
                )}
              </td>
              {action ? <td data-label={t.common.actions}>{action(record)}</td> : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BranchAttendance() {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const names = useEmployeeNames(api, account);
  const [filters, setFilters] = useState({ branchId: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [editing, setEditing] = useState<string | null>(null);
  const list = useResource(
    () =>
      api.get<AttendanceListResponse>('/api/v1/attendance', {
        branchId: applied.branchId || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
      }),
    [api, applied],
  );
  const viewable = [...(branches.data?.values() ?? [])].filter(
    (branch) =>
      canGlobal(account, 'VIEW_ATTENDANCE') || canAt(account, 'VIEW_ATTENDANCE', branch.id),
  );
  const canCorrect = (record: AttendanceRecordResponse) => canCorrectAttendance(account, record);

  return (
    <Section title={t.attendance.team}>
      <form
        className="wf-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(filters);
        }}
      >
        <Field id="att-branch" label={t.common.branch}>
          <select
            id="att-branch"
            value={filters.branchId}
            onChange={(event) => setFilters({ ...filters, branchId: event.target.value })}
          >
            <option value="">{t.common.all}</option>
            {viewable.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="att-from" label={t.common.from}>
          <input
            id="att-from"
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </Field>
        <Field id="att-to" label={t.common.to}>
          <input
            id="att-to"
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </Field>
        <button type="submit" className="wf-button">
          {t.common.apply}
        </button>
      </form>
      {list.loading ? <Loading t={t} /> : null}
      {list.error ? (
        <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
      ) : null}
      {list.data && list.data.records.length === 0 ? <Empty>{t.common.empty}</Empty> : null}
      {list.data && list.data.records.length > 0 ? (
        <AttendanceTable
          records={list.data.records}
          branches={branches.data}
          showEmployee
          employee={(id) => employeeLabel(id, names.data, account, t)}
          action={(record) =>
            canCorrect(record) ? (
              editing === record.id ? (
                <CorrectionForm
                  record={record}
                  branch={branches.data?.get(record.branchId)}
                  onDone={async () => {
                    setEditing(null);
                    await list.reload();
                  }}
                  onCancel={() => setEditing(null)}
                  reload={list.reload}
                />
              ) : (
                <button
                  type="button"
                  className="wf-button wf-button-quiet"
                  onClick={() => setEditing(record.id)}
                >
                  {t.attendance.correct}
                </button>
              )
            ) : null
          }
        />
      ) : null}
    </Section>
  );
}

/** Manager correction (for example a forgotten check-out); reason required, versioned. */
export function CorrectionForm({
  record,
  branch,
  onDone,
  onCancel,
  reload,
}: {
  record: AttendanceRecordResponse;
  branch: BranchSummary | undefined;
  onDone: () => Promise<void>;
  onCancel: () => void;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const zone = branch?.timezone ?? 'UTC';
  const [checkIn, setCheckIn] = useState(zonedLocal(record.checkInAt, zone));
  const [checkOut, setCheckOut] = useState(
    record.checkOutAt ? zonedLocal(record.checkOutAt, zone) : `${record.businessDate}T`,
  );
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const originalIn = zonedLocal(record.checkInAt, zone);
  const originalOut = record.checkOutAt ? zonedLocal(record.checkOutAt, zone) : '';

  async function save(event: FormEvent) {
    event.preventDefault();
    const body: AttendanceCorrectionRequest = { expectedVersion: record.version, reason };
    if (checkIn !== originalIn) {
      const instant = zonedInstant(checkIn, zone);
      if (instant) body.checkInAt = instant;
    }
    if (checkOut !== originalOut && checkOut.length === 16) {
      const instant = zonedInstant(checkOut, zone);
      if (instant) body.checkOutAt = instant;
    }
    const ok = await submit.run(
      () => runMutation(() => api.post(`/api/v1/attendance/${record.id}/correct`, body), reload),
      t.attendance.corrected,
    );
    if (ok) await onDone();
  }

  const id = `corr-${record.id}`;
  return (
    <form
      className="wf-inline-form"
      onSubmit={(event) => void save(event)}
      aria-label={t.attendance.correctionTitle}
    >
      <p className="wf-small wf-muted">{t.attendance.correctionHint}</p>
      <Field id={`${id}-in`} label={t.attendance.correctedCheckIn} required>
        <input
          id={`${id}-in`}
          type="datetime-local"
          required
          value={checkIn}
          max={`${todayIn(zone)}T23:59`}
          onChange={(event) => setCheckIn(event.target.value)}
        />
      </Field>
      <Field id={`${id}-out`} label={t.attendance.correctedCheckOut}>
        <input
          id={`${id}-out`}
          type="datetime-local"
          value={checkOut.length === 16 ? checkOut : ''}
          min={checkIn}
          onChange={(event) => setCheckOut(event.target.value)}
        />
      </Field>
      <Field id={`${id}-reason`} label={t.common.reason} required>
        <textarea
          id={`${id}-reason`}
          required
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <FormFeedback error={submit.error} success={null} t={t} />
      <div className="wf-form-actions">
        <SubmitButton
          pending={submit.pending}
          label={t.common.save}
          pendingLabel={t.common.saving}
          disabled={reason.trim().length === 0}
        />
        <button type="button" className="wf-button wf-button-quiet" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
