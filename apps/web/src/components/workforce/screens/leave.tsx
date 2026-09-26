'use client';

import type {
  LeaveRequestCreateRequest,
  LeaveRequestListResponse,
  LeaveRequestResponse,
  LeaveStatus,
  LeaveType,
} from '@lucy-spa/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import { fill, type WorkforceDictionary } from '../../../i18n/workforce';
import type { Locale } from '../../../i18n/locales';
import { formatDate, inclusiveDays } from '../../../lib/workforce/format';
import { canAnywhere } from '../../../lib/workforce/permissions';
import { leaveActions, runMutation } from '../../../lib/workforce/workflows';
import { employeeLabel, useEmployeeNames } from '../data';
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
  type Tone,
} from '../ui';

export const LEAVE_TYPE_ORDER: LeaveType[] = [
  'ANNUAL',
  'SICK',
  'PERSONAL',
  'FAMILY_EVENT',
  'MATERNITY',
  'OTHER',
];
const STATUSES: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const STATUS_TONE: Record<LeaveStatus, Tone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  CANCELLED: 'neutral',
};

export function LeaveStatusBadge({ status, t }: { status: LeaveStatus; t: WorkforceDictionary }) {
  return <Badge tone={STATUS_TONE[status]}>{t.leave.statuses[status]}</Badge>;
}

export function LeaveScreen() {
  const { t } = useWorkforce();
  const { account } = useAccount();
  return (
    <>
      <PageHeader title={t.leave.title} intro={t.leave.wholeDays} />
      {account.kind === 'EMPLOYEE' ? (
        // Collaborators work by schedule and never use leave (Owner decision Q15).
        account.workforceTitle === 'COLLABORATOR' ? (
          <Notice tone="info">{t.leave.collaboratorNoLeave}</Notice>
        ) : (
          <OwnLeave />
        )
      ) : null}
      {canAnywhere(account, 'APPROVE_LEAVE') ? <LeaveDecisions /> : null}
    </>
  );
}

/** Localized leave-type options; stable codes are the submitted values. */
export function LeaveTypeOptions({ t }: { t: WorkforceDictionary }) {
  return (
    <>
      {LEAVE_TYPE_ORDER.map((type) => (
        <option key={type} value={type}>
          {t.leave.types[type]}
        </option>
      ))}
    </>
  );
}

function OwnLeave() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const own = useResource(
    () => api.get<LeaveRequestListResponse>('/api/v1/leave-requests/me'),
    [api],
  );
  const [form, setForm] = useState<LeaveRequestCreateRequest>({
    leaveType: 'ANNUAL',
    startDate: '',
    endDate: '',
    reason: '',
  });
  const create = useSubmit();
  const cancel = useSubmit();
  const days = inclusiveDays(form.startDate, form.endDate);
  const invalidRange = form.startDate !== '' && form.endDate !== '' && days === null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (invalidRange) return;
    const ok = await create.run(
      () => runMutation(() => api.post('/api/v1/leave-requests', form), own.reload),
      t.leave.submitted,
    );
    if (ok) {
      setForm({ leaveType: form.leaveType, startDate: '', endDate: '', reason: '' });
      await own.reload();
    }
  }

  return (
    <>
      <Section title={t.leave.newRequest}>
        <Notice tone="info">{t.leave.baseline}</Notice>
        <form className="wf-form" onSubmit={(event) => void submit(event)}>
          <Field id="leave-type" label={t.leave.type} required>
            <select
              id="leave-type"
              required
              value={form.leaveType}
              onChange={(event) => setForm({ ...form, leaveType: event.target.value as LeaveType })}
            >
              <LeaveTypeOptions t={t} />
            </select>
          </Field>
          <div className="wf-row">
            <Field id="leave-start" label={t.leave.startDate} required>
              <input
                id="leave-start"
                type="date"
                required
                value={form.startDate}
                onChange={(event) =>
                  setForm({
                    ...form,
                    startDate: event.target.value,
                    endDate: form.endDate === '' ? event.target.value : form.endDate,
                  })
                }
              />
            </Field>
            <Field id="leave-end" label={t.leave.endDate} required>
              <input
                id="leave-end"
                type="date"
                required
                min={form.startDate || undefined}
                value={form.endDate}
                aria-invalid={invalidRange}
                onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              />
            </Field>
          </div>
          {invalidRange ? <Notice tone="error">{t.leave.endBeforeStart}</Notice> : null}
          {days !== null ? (
            <p className="wf-muted">
              {t.leave.days}: {fill(t.leave.daysValue, { count: days })}
            </p>
          ) : null}
          <Field id="leave-reason" label={t.leave.reason} required>
            <textarea
              id="leave-reason"
              required
              maxLength={1000}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          </Field>
          <FormFeedback error={create.error} success={create.success} t={t} />
          <SubmitButton
            pending={create.pending}
            label={t.leave.submit}
            pendingLabel={t.common.saving}
            disabled={invalidRange || form.reason.trim() === ''}
          />
        </form>
      </Section>
      <Section title={t.leave.mine}>
        {own.loading ? <Loading t={t} /> : null}
        {own.error ? (
          <ErrorState error={own.error} t={t} onRetry={() => void own.reload()} />
        ) : null}
        <FormFeedback error={cancel.error} success={cancel.success} t={t} />
        {own.data && own.data.requests.length === 0 ? <Empty>{t.common.empty}</Empty> : null}
        {own.data && own.data.requests.length > 0 ? (
          <LeaveTable
            requests={own.data.requests}
            t={t}
            locale={locale}
            action={(request) => {
              const actions = leaveActions(request, account.id, false);
              if (actions.cancel) {
                return (
                  <button
                    type="button"
                    className="wf-button wf-button-quiet"
                    disabled={cancel.pending}
                    onClick={() =>
                      void cancel.run(async () => {
                        const outcome = await runMutation(
                          () =>
                            api.post(`/api/v1/leave-requests/${request.id}/cancel`, {
                              expectedVersion: request.version,
                            }),
                          own.reload,
                        );
                        if (outcome.ok) await own.reload();
                        return outcome;
                      }, t.leave.cancelled)
                    }
                  >
                    {t.leave.cancelRequest}
                  </button>
                );
              }
              return request.status === 'APPROVED' ? (
                <span className="wf-small wf-muted">{t.leave.approvedNote}</span>
              ) : null;
            }}
          />
        ) : null}
      </Section>
    </>
  );
}

export function LeaveTable({
  requests,
  t,
  locale,
  employee,
  action,
}: {
  requests: readonly LeaveRequestResponse[];
  t: WorkforceDictionary;
  locale: Locale;
  employee?: (id: string) => string;
  action?: (request: LeaveRequestResponse) => ReactNode;
}) {
  return (
    <table className="wf-table">
      <thead>
        <tr>
          {employee ? <th scope="col">{t.leave.employee}</th> : null}
          <th scope="col">{t.leave.type}</th>
          <th scope="col">{t.leave.startDate}</th>
          <th scope="col">{t.leave.endDate}</th>
          <th scope="col">{t.leave.days}</th>
          <th scope="col">{t.leave.reason}</th>
          <th scope="col">{t.common.status}</th>
          {action ? <th scope="col">{t.common.actions}</th> : null}
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <tr key={request.id}>
            {employee ? (
              <td data-label={t.leave.employee}>{employee(request.employeeId)}</td>
            ) : null}
            <td data-label={t.leave.type}>{t.leave.types[request.leaveType]}</td>
            <td data-label={t.leave.startDate}>{formatDate(request.startDate, locale)}</td>
            <td data-label={t.leave.endDate}>{formatDate(request.endDate, locale)}</td>
            <td data-label={t.leave.days}>{request.days}</td>
            <td data-label={t.leave.reason}>
              {request.reason}
              {request.decisionReason ? (
                <span className="wf-small wf-muted wf-block">
                  {t.leave.decisionReason}: {request.decisionReason}
                </span>
              ) : null}
            </td>
            <td data-label={t.common.status}>
              <LeaveStatusBadge status={request.status} t={t} />
            </td>
            {action ? <td data-label={t.common.actions}>{action(request)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeaveDecisions() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const names = useEmployeeNames(api, account);
  const [status, setStatus] = useState<LeaveStatus | ''>('PENDING');
  const [deciding, setDeciding] = useState<string | null>(null);
  const list = useResource(
    () =>
      api.get<LeaveRequestListResponse>('/api/v1/leave-requests', { status: status || undefined }),
    [api, status],
  );

  return (
    <Section title={t.leave.decisions}>
      <div className="wf-filters">
        <Field id="leave-status" label={t.leave.statusFilter}>
          <select
            id="leave-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as LeaveStatus | '')}
          >
            <option value="">{t.common.all}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t.leave.statuses[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {list.loading ? <Loading t={t} /> : null}
      {list.error ? (
        <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
      ) : null}
      {list.data && list.data.requests.length === 0 ? <Empty>{t.common.empty}</Empty> : null}
      {list.data && list.data.requests.length > 0 ? (
        <LeaveTable
          requests={list.data.requests}
          t={t}
          locale={locale}
          employee={(id) => employeeLabel(id, names.data, account, t)}
          action={(request) =>
            // Every listed request is inside the caller's APPROVE_LEAVE scope (server-filtered).
            leaveActions(request, account.id, true).decide ? (
              deciding === request.id ? (
                <DecisionForm
                  request={request}
                  reload={list.reload}
                  onDone={async () => {
                    setDeciding(null);
                    await list.reload();
                  }}
                  onCancel={() => setDeciding(null)}
                />
              ) : (
                <button type="button" className="wf-button" onClick={() => setDeciding(request.id)}>
                  {t.leave.approve} / {t.leave.reject}
                </button>
              )
            ) : null
          }
        />
      ) : null}
    </Section>
  );
}

/** Approve (optional note) or reject (reason required by the API); versioned. */
export function DecisionForm({
  request,
  reload,
  onDone,
  onCancel,
}: {
  request: LeaveRequestResponse;
  reload: () => Promise<void>;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { api, t } = useWorkforce();
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const id = `decide-${request.id}`;

  async function decide(kind: 'approve' | 'reject') {
    const trimmed = reason.trim();
    const body = { expectedVersion: request.version, ...(trimmed ? { reason: trimmed } : {}) };
    const ok = await submit.run(
      () =>
        runMutation(() => api.post(`/api/v1/leave-requests/${request.id}/${kind}`, body), reload),
      kind === 'approve' ? t.leave.approved : t.leave.rejected,
    );
    if (ok) await onDone();
  }

  return (
    <form
      className="wf-inline-form"
      aria-label={t.leave.decisions}
      onSubmit={(event) => {
        event.preventDefault();
        void decide('approve');
      }}
    >
      <Field id={`${id}-reason`} label={`${t.leave.rejectReason} / ${t.leave.approveReason}`}>
        <textarea
          id={`${id}-reason`}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <FormFeedback error={submit.error} success={null} t={t} />
      <div className="wf-form-actions">
        <SubmitButton
          pending={submit.pending}
          label={t.leave.approve}
          pendingLabel={t.common.saving}
        />
        <button
          type="button"
          className="wf-button wf-button-danger"
          disabled={submit.pending || reason.trim() === ''}
          title={t.leave.rejectReason}
          onClick={() => void decide('reject')}
        >
          {t.leave.reject}
        </button>
        <button type="button" className="wf-button wf-button-quiet" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
