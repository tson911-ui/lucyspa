'use client';

import type {
  LeaveRequestCreateRequest,
  LeaveRequestListResponse,
  LeaveRequestResponse,
  LeaveStatus,
  LeaveType,
} from '@lucy-spa/contracts';
import {
  Button,
  ConfirmDialog,
  DataTable,
  DEFAULT_PAGE_SIZE,
  DateTextInput,
  DescriptionList,
  Field as KitField,
  FormDialog,
  FormGrid,
  focusFirstInvalid,
  ListSection,
  ListToolbar,
  RowActions,
  Select,
  Textarea,
  useUrlState,
  type DataTablePaging,
  type DataTableColumn,
  type MenuItem,
  type SelectOption,
} from '@lucy-spa/ui';
import { useState, type ReactNode } from 'react';
import { fill, type WorkforceDictionary } from '../../../i18n/workforce';
import type { Locale } from '../../../i18n/locales';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDate, inclusiveDays } from '../../../lib/workforce/format';
import {
  normalizePage,
  normalizePageSize,
  resultsText,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
import { canAnywhere } from '../../../lib/workforce/permissions';
import { urlPaging } from '../../../lib/workforce/url-paging';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { errorMessage, leaveActions, runMutation } from '../../../lib/workforce/workflows';
import { opensInput } from '../../../lib/workforce/opens-input';
import { employeeLabel, useEmployeeNames } from '../data';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSubmit,
  useSuccessToast,
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

/**
 * Address-bar state (session 10: Back/Forward and a shared link restore the view): the approval list's status filter ("ALL" for
 * every status, since the default is "PENDING") and pager, and the pager of one's own requests.
 */
const LEAVE_DEFAULTS = {
  status: 'PENDING',
  page: 1,
  size: DEFAULT_PAGE_SIZE,
  minePage: 1,
  mineSize: DEFAULT_PAGE_SIZE,
};
const LEAVE_OPTIONS = {
  normalize: (state: typeof LEAVE_DEFAULTS) => ({
    status:
      state.status === 'ALL' || (STATUSES as string[]).includes(state.status)
        ? state.status
        : 'PENDING',
    page: normalizePage(state.page),
    size: normalizePageSize(state.size),
    minePage: normalizePage(state.minePage),
    mineSize: normalizePageSize(state.mineSize),
  }),
  resetOnChange: ['page', 'minePage'],
};
type LeaveUrl = typeof LEAVE_DEFAULTS;
type LeaveUpdate = (patch: Partial<LeaveUrl>) => void;

export function LeaveScreen() {
  const { t } = useWorkforce();
  const { account } = useAccount();
  const [creating, setCreating] = useState(false);
  const [url, update] = useUrlState(LEAVE_DEFAULTS, LEAVE_OPTIONS);
  // Collaborators work by schedule and never use leave (Owner decision Q15).
  const collaborator = account.workforceTitle === 'COLLABORATOR';
  const ownLeave = account.kind === 'EMPLOYEE' && !collaborator;
  return (
    <>
      <PageHeader title={t.leave.title} intro={t.leave.wholeDays}>
        {ownLeave ? (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {opensInput(t.leave.newRequest)}
          </Button>
        ) : null}
      </PageHeader>
      {account.kind === 'EMPLOYEE' ? (
        collaborator ? (
          <Notice tone="info">{t.leave.collaboratorNoLeave}</Notice>
        ) : (
          <OwnLeave
            creating={creating}
            onClose={() => setCreating(false)}
            url={url}
            update={update}
          />
        )
      ) : null}
      {canAnywhere(account, 'APPROVE_LEAVE') ? (
        <LeaveDecisions titled={account.kind === 'EMPLOYEE'} url={url} update={update} />
      ) : null}
    </>
  );
}

/** Localized leave-type options; stable codes are the submitted values. */
export function leaveTypeOptions(t: WorkforceDictionary): SelectOption[] {
  return LEAVE_TYPE_ORDER.map((type) => ({ value: type, label: t.leave.types[type] }));
}

function OwnLeave({
  creating,
  onClose,
  url,
  update,
}: {
  creating: boolean;
  onClose: () => void;
  url: LeaveUrl;
  update: LeaveUpdate;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const own = useResource(
    () => api.get<LeaveRequestListResponse>('/api/v1/leave-requests/me'),
    [api],
  );
  const [cancelling, setCancelling] = useState<LeaveRequestResponse | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const requests = own.data?.requests ?? [];

  return (
    <>
      <Notice tone="info">{t.leave.baseline}</Notice>
      <ListSection title={t.leave.mine}>
        {own.loading && !own.data ? <Loading t={t} /> : null}
        {own.error ? (
          <ErrorState error={own.error} t={t} onRetry={() => void own.reload()} />
        ) : null}
        {cancelled ? <Notice tone="success">{t.leave.cancelled}</Notice> : null}
        {own.data && requests.length === 0 ? (
          <Empty title={t.leave.mineEmptyTitle}>{t.leave.mineEmpty}</Empty>
        ) : null}
        {requests.length > 0 ? (
          <>
            <LeaveTable
              requests={requests}
              t={t}
              locale={locale}
              list={t.leave.mine}
              paging={urlPaging(
                url.minePage,
                url.mineSize,
                ({ page, pageSize }) =>
                  update({
                    ...(page !== undefined ? { minePage: page } : {}),
                    ...(pageSize !== undefined ? { mineSize: pageSize } : {}),
                  }),
                t,
                t.leave.mine,
              )}
              menu={(request) =>
                leaveActions(request, account.id, false).cancel
                  ? [
                      {
                        id: 'cancel',
                        label: t.leave.cancelRequest,
                        icon: 'x-circle',
                        tone: 'danger',
                        onSelect: () => setCancelling(request),
                      },
                    ]
                  : []
              }
            />
            {requests.some((request) => request.status === 'APPROVED') ? (
              <p className="ls-hint">{t.leave.approvedNote}</p>
            ) : null}
          </>
        ) : null}
      </ListSection>
      {creating ? <LeaveRequestDialog reload={own.reload} onClose={onClose} /> : null}
      {cancelling ? (
        <ConfirmDialog
          title={t.leave.cancelTitle}
          description={t.leave.cancelBody}
          tone="warning"
          confirmLabel={t.leave.cancelRequest}
          cancelLabel={t.leave.keepRequest}
          facts={[
            {
              label: t.leave.period,
              value: `${formatDate(cancelling.startDate, locale)} – ${formatDate(cancelling.endDate, locale)}`,
            },
          ]}
          describeError={confirmError(t)}
          onCancel={() => setCancelling(null)}
          onConfirm={async () => {
            const outcome = await runMutation(
              () =>
                api.post(`/api/v1/leave-requests/${cancelling.id}/cancel`, {
                  expectedVersion: cancelling.version,
                }),
              own.reload,
            );
            if (!outcome.ok) throw outcome.error;
            setCancelling(null);
            notify(t.leave.cancelled, () => setCancelled(true));
            await own.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** "Tạo đơn nghỉ phép": type, whole-day range and reason; the API decides everything else. */
function LeaveRequestDialog({
  reload,
  onClose,
}: {
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState<LeaveRequestCreateRequest>({
    leaveType: 'ANNUAL',
    startDate: '',
    endDate: '',
    reason: '',
  });
  const create = useSubmit();
  const days = inclusiveDays(form.startDate, form.endDate);
  const invalidRange = form.startDate !== '' && form.endDate !== '' && days === null;
  // Submit stays enabled (wig leave.tsx:226): a missing field is said at the field after a submit, and the first one takes focus.
  const [checked, setChecked] = useState(false);
  const missing = {
    startDate: checked && form.startDate === '',
    endDate: checked && form.endDate === '',
    reason: checked && form.reason.trim() === '',
  };

  async function submit() {
    if (form.startDate === '' || form.endDate === '' || form.reason.trim() === '') {
      setChecked(true);
      window.setTimeout(() => focusFirstInvalid(document), 0);
      return;
    }
    if (invalidRange) return;
    const ok = await create.run(
      () => runMutation(() => api.post('/api/v1/leave-requests', form), reload),
      t.leave.submitted,
    );
    if (ok) {
      onClose();
      await reload();
    }
  }

  return (
    <FormDialog
      title={t.leave.newRequest}
      labels={formOverlayLabels(t, t.leave.submit)}
      busy={create.pending}
      dirty={form.startDate !== '' || form.endDate !== '' || form.reason !== ''}
      error={
        create.error ? <Notice tone="error">{errorMessage(create.error, t)}</Notice> : undefined
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={2}>
        <KitField label={t.leave.type} required requiredLabel={t.common.required} full>
          {(control) => (
            <Select
              {...control}
              value={form.leaveType}
              options={leaveTypeOptions(t)}
              onChange={(event) => setForm({ ...form, leaveType: event.target.value as LeaveType })}
            />
          )}
        </KitField>
        <KitField
          label={t.leave.startDate}
          required
          requiredLabel={t.common.required}
          {...(missing.startDate ? { error: t.common.form.fieldRequired } : {})}
        >
          {(control) => (
            <DateTextInput
              {...control}
              name="startDate"
              value={form.startDate}
              onChange={(event) =>
                setForm({
                  ...form,
                  startDate: event.target.value,
                  endDate: form.endDate === '' ? event.target.value : form.endDate,
                })
              }
            />
          )}
        </KitField>
        <KitField
          label={t.leave.endDate}
          required
          requiredLabel={t.common.required}
          {...(invalidRange
            ? { error: t.leave.endBeforeStart }
            : missing.endDate
              ? { error: t.common.form.fieldRequired }
              : days !== null
                ? { hint: `${t.leave.days}: ${fill(t.leave.daysValue, { count: days })}` }
                : {})}
        >
          {(control) => (
            <DateTextInput
              {...control}
              name="endDate"
              min={form.startDate || undefined}
              value={form.endDate}
              invalid={invalidRange}
              onChange={(event) => setForm({ ...form, endDate: event.target.value })}
            />
          )}
        </KitField>
        <KitField
          label={t.leave.reason}
          required
          requiredLabel={t.common.required}
          full
          {...(missing.reason ? { error: t.common.form.reasonRequired } : {})}
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              maxLength={1000}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          )}
        </KitField>
      </FormGrid>
    </FormDialog>
  );
}

export function LeaveTable({
  requests,
  t,
  locale,
  list,
  employee,
  menu,
  paging: urlPager,
}: {
  requests: readonly LeaveRequestResponse[];
  t: WorkforceDictionary;
  locale: Locale;
  /** Visible name of the list (accessible name of the table and its pager). */
  list?: string;
  employee?: (id: string) => string;
  /** Row menu items for one request; an empty list shows no menu. */
  menu?: (request: LeaveRequestResponse) => MenuItem[];
  /** The pager kept in the address bar by the leave page; a table shown elsewhere pages in memory. */
  paging?: DataTablePaging | undefined;
}) {
  const name = list ?? t.leave.title;
  const localPaging = useClientPaging(t, name);
  const paging = urlPager ?? localPaging;
  const columns: DataTableColumn<LeaveRequestResponse>[] = [
    ...(employee
      ? [
          {
            key: 'employee',
            header: t.leave.employee,
            mobileTitle: true,
            wrap: true,
            cell: (request: LeaveRequestResponse) => employee(request.employeeId),
          },
        ]
      : []),
    {
      key: 'type',
      header: t.leave.type,
      // The approval list drops the type on a tablet (the decision dialog shows it); my own list keeps it.
      ...(employee ? { hideBelow: 'lg' as const } : { mobileTitle: true }),
      cell: (request) => t.leave.types[request.leaveType],
    },
    {
      key: 'period',
      header: t.leave.period,
      cell: (request) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main">
            {formatDate(request.startDate, locale)} – {formatDate(request.endDate, locale)}
          </span>
          <span className="ls-cell-sub">{fill(t.leave.daysValue, { count: request.days })}</span>
        </span>
      ),
    },
    {
      key: 'reason',
      header: t.leave.reason,
      hideBelow: 'lg',
      wrap: true,
      width: 'lg',
      // The decision's reason is a second muted line, not joined with a middle dot.
      cell: (request) =>
        request.decisionReason ? (
          <span className="ls-cell-stack">
            <span className="ls-cell-main">{request.reason}</span>
            <span className="ls-cell-sub">
              {t.leave.decisionReason}: {request.decisionReason}
            </span>
          </span>
        ) : (
          request.reason
        ),
    },
    {
      key: 'status',
      header: t.common.status,
      cell: (request) => <LeaveStatusBadge status={request.status} t={t} />,
    },
    ...(menu
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (request: LeaveRequestResponse) => {
              const items = menu(request);
              return items.length > 0 ? (
                <RowActions
                  menuLabel={fill(t.common.list.actionsFor, {
                    name: employee
                      ? employee(request.employeeId)
                      : `${formatDate(request.startDate, locale)}`,
                  })}
                  items={items}
                />
              ) : null;
            },
          },
        ]
      : []),
  ];
  return (
    <DataTable
      mode="client"
      caption={fill(t.common.list.table, { list: name })}
      columns={columns}
      rows={requests}
      rowKey={(request) => request.id}
      paging={paging}
    />
  );
}

type Decision = { request: LeaveRequestResponse; kind: 'approve' | 'reject' };

/** The approval list's heading is left out when it is the page's only section (it would only repeat the h1). */
function SectionFrame({
  titled,
  title,
  children,
}: {
  titled: boolean;
  title: string;
  children: ReactNode;
}) {
  return titled ? (
    <ListSection title={title}>{children}</ListSection>
  ) : (
    <div className="ls-self-list">{children}</div>
  );
}

function LeaveDecisions({
  titled,
  url,
  update,
}: {
  titled: boolean;
  url: LeaveUrl;
  update: LeaveUpdate;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const names = useEmployeeNames(api, account);
  // '' (every status) is "ALL" in the address bar, because the default filter is "PENDING".
  const status = (url.status === 'ALL' ? '' : url.status) as LeaveStatus | '';
  const setStatus = (value: LeaveStatus | '') => update({ status: value === '' ? 'ALL' : value });
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const list = useResource(
    () =>
      api.get<LeaveRequestListResponse>('/api/v1/leave-requests', { status: status || undefined }),
    [api, status],
  );
  const requests = list.data?.requests ?? [];
  const nameOf = (id: string) => employeeLabel(id, names.data, account, t);

  return (
    <SectionFrame titled={titled} title={t.leave.decisions}>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={status === 'PENDING' ? 0 : 1}
        resultCount={list.data ? resultsText(t, requests.length) : undefined}
        onReset={() => setStatus('PENDING')}
        reload={{ label: t.common.reload, onClick: () => void list.reload(), busy: list.loading }}
        search={
          <Select
            id="leave-status"
            aria-label={t.leave.statusFilter}
            value={status}
            options={[
              { value: '', label: t.common.all },
              ...STATUSES.map((value) => ({ value, label: t.leave.statuses[value] })),
            ]}
            onChange={(event) => setStatus(event.target.value as LeaveStatus | '')}
          />
        }
      />
      {list.loading && !list.data ? <Loading t={t} /> : null}
      {list.error ? (
        <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
      ) : null}
      {list.data && requests.length === 0 ? (
        status === 'PENDING' ? (
          <Empty title={t.leave.decisionsEmptyTitle}>{t.leave.decisionsEmpty}</Empty>
        ) : (
          <Empty
            title={t.leave.decisionsEmptyFilteredTitle}
            action={
              <Button variant="secondary" onClick={() => setStatus('PENDING')}>
                {t.leave.showPending}
              </Button>
            }
          >
            {t.leave.decisionsEmptyFiltered}
          </Empty>
        )
      ) : null}
      {requests.length > 0 ? (
        <LeaveTable
          requests={requests}
          t={t}
          locale={locale}
          list={t.leave.decisions}
          paging={urlPaging(
            url.page,
            url.size,
            ({ page, pageSize }) =>
              update({
                ...(page !== undefined ? { page } : {}),
                ...(pageSize !== undefined ? { size: pageSize } : {}),
              }),
            t,
            t.leave.decisions,
          )}
          employee={nameOf}
          menu={(request) =>
            // Every listed request is inside the caller's APPROVE_LEAVE scope (server-filtered).
            leaveActions(request, account.id, true).decide
              ? [
                  {
                    id: 'approve',
                    label: opensInput(t.leave.approve),
                    icon: 'check-circle',
                    onSelect: () => setDeciding({ request, kind: 'approve' }),
                  },
                  {
                    id: 'reject',
                    label: opensInput(t.leave.reject),
                    icon: 'x-circle',
                    tone: 'danger',
                    onSelect: () => setDeciding({ request, kind: 'reject' }),
                  },
                ]
              : []
          }
        />
      ) : null}
      {deciding ? (
        <DecisionDialog
          request={deciding.request}
          kind={deciding.kind}
          employee={nameOf(deciding.request.employeeId)}
          reload={list.reload}
          onDone={async () => {
            setDeciding(null);
            await list.reload();
          }}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </SectionFrame>
  );
}

/** Approve (optional note) or reject (reason required by the API); versioned. */
export function DecisionDialog({
  request,
  kind,
  employee,
  reload,
  onDone,
  onClose,
}: {
  request: LeaveRequestResponse;
  kind: 'approve' | 'reject';
  employee: string;
  reload: () => Promise<void>;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const reject = kind === 'reject';

  const [checked, setChecked] = useState(false);
  const reasonMissing = reject && checked && reason.trim() === '';

  async function decide() {
    // A rejection needs a reason: said at the field on submit (the button is never disabled to signal it, wig leave.tsx:524).
    if (reject && reason.trim() === '') {
      setChecked(true);
      window.setTimeout(() => focusFirstInvalid(document), 0);
      return;
    }
    const trimmed = reason.trim();
    const body = { expectedVersion: request.version, ...(trimmed ? { reason: trimmed } : {}) };
    const ok = await submit.run(
      () =>
        runMutation(() => api.post(`/api/v1/leave-requests/${request.id}/${kind}`, body), reload),
      reject ? t.leave.rejected : t.leave.approved,
    );
    if (ok) await onDone();
  }

  return (
    <FormDialog
      title={reject ? t.leave.rejectTitle : t.leave.approveTitle}
      description={`${employee}, ${formatDate(request.startDate, locale)} – ${formatDate(request.endDate, locale)}`}
      labels={formOverlayLabels(t, reject ? t.leave.reject : t.leave.approve)}
      busy={submit.pending}
      dirty={reason !== ''}
      error={
        submit.error ? <Notice tone="error">{errorMessage(submit.error, t)}</Notice> : undefined
      }
      onClose={onClose}
      onSubmit={decide}
    >
      <FormGrid>
        <DescriptionList
          items={[
            { label: t.leave.type, value: t.leave.types[request.leaveType] },
            { label: t.leave.days, value: fill(t.leave.daysValue, { count: request.days }) },
            { label: t.leave.reason, value: request.reason },
          ]}
        />
        <KitField
          label={reject ? t.leave.rejectReason : t.leave.approveReason}
          {...(reject ? { required: true, requiredLabel: t.common.required } : {})}
          {...(reasonMissing ? { error: t.common.form.reasonRequired } : {})}
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </KitField>
      </FormGrid>
    </FormDialog>
  );
}
