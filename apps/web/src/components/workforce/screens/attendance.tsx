'use client';

import type {
  AttendanceCorrectionRequest,
  AttendanceListResponse,
  AttendanceRecordResponse,
  BranchSummary,
  EmployeeBranchAssignmentsResponse,
} from '@lucy-spa/contracts';
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  DEFAULT_PAGE_SIZE,
  DateTextInput,
  Field as KitField,
  FormDialog,
  FormGrid,
  focusFirstInvalid,
  Grid,
  ListSection,
  ListToolbar,
  RowActions,
  Select,
  Textarea,
  TextInput,
  useUrlState,
  type DataTablePaging,
  type UrlStateChange,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState, type ReactNode } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  formatDate,
  formatTime,
  todayIn,
  zonedInstant,
  zonedLocal,
} from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  normalizePage,
  normalizePageSize,
  resultsText,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
import { canAnywhere, canAt, canGlobal } from '../../../lib/workforce/permissions';
import { urlPaging } from '../../../lib/workforce/url-paging';
import {
  attendanceState,
  canCorrectAttendance,
  errorMessage,
  runMutation,
} from '../../../lib/workforce/workflows';
import { opensInput } from '../../../lib/workforce/opens-input';
import { branchLabel, employeeLabel, useBranches, useEmployeeNames } from '../data';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  FormFeedback,
  Loading,
  Notice,
  PageHeader,
  useResource,
  type Resource,
  useSubmit,
} from '../ui';

/** An ISO date from the address bar, or '' (a malformed value is dropped, never sent to the API). */
const isoDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '');

/**
 * Address-bar state of the page (session 10: Back/Forward and a shared link restore the view): the branch list's filters and
 * pager, and the pager of one's own history. A filter change returns the branch list to page 1.
 */
const ATTENDANCE_DEFAULTS = {
  branch: '',
  from: '',
  to: '',
  page: 1,
  size: DEFAULT_PAGE_SIZE,
  minePage: 1,
  mineSize: DEFAULT_PAGE_SIZE,
};
const ATTENDANCE_OPTIONS = {
  normalize: (state: typeof ATTENDANCE_DEFAULTS) => ({
    branch: state.branch,
    from: isoDate(state.from),
    to: isoDate(state.to),
    page: normalizePage(state.page),
    size: normalizePageSize(state.size),
    minePage: normalizePage(state.minePage),
    mineSize: normalizePageSize(state.mineSize),
  }),
  resetOnChange: ['page', 'minePage'],
};
type AttendanceUrl = typeof ATTENDANCE_DEFAULTS;
type AttendanceUpdate = (patch: Partial<AttendanceUrl>, change?: UrlStateChange) => void;

export function AttendanceScreen() {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  // One branch list for both sections (rbp: it was fetched twice).
  const branches = useBranches(api);
  const [url, update] = useUrlState(ATTENDANCE_DEFAULTS, ATTENDANCE_OPTIONS);
  return (
    <>
      <PageHeader title={t.attendance.title} />
      {account.kind === 'EMPLOYEE' ? (
        <SelfAttendance branches={branches} url={url} update={update} />
      ) : null}
      {canAnywhere(account, 'VIEW_ATTENDANCE') ? (
        <BranchAttendance
          titled={account.kind === 'EMPLOYEE'}
          branches={branches}
          url={url}
          update={update}
        />
      ) : null}
    </>
  );
}

function SelfAttendance({
  branches,
  url,
  update,
}: {
  branches: Resource<Map<string, BranchSummary>>;
  url: AttendanceUrl;
  update: AttendanceUpdate;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
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

  // The branch whose check-in/out is running shows the busy state (wig attendance.tsx:152/:167).
  const [busyBranch, setBusyBranch] = useState<string | null>(null);

  async function act(work: () => Promise<unknown>, message: string, branchId: string) {
    setBusyBranch(branchId);
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
    <>
      <ListSection title={t.attendance.self}>
        <p className="ls-hint">{t.attendance.selfIntro}</p>
        {account.attendanceRequired === false ? (
          <Notice tone="info">
            {locale === 'vi'
              ? 'Vị trí tổ chức hiện tại của bạn không yêu cầu chấm công. Lịch sử chấm công vẫn được giữ nguyên.'
              : 'Your current organizational position is exempt from attendance. Attendance history is retained.'}
          </Notice>
        ) : null}
        {own.loading || branches.loading ? <Loading t={t} /> : null}
        {own.error ? (
          <ErrorState error={own.error} t={t} onRetry={() => void own.reload()} />
        ) : null}
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        {own.data && own.data.assignments.active.length === 0 ? (
          <Notice tone="info">{t.attendance.noBranch}</Notice>
        ) : null}
        {active.length > 0 ? (
          <Grid min="md" gap="block">
            {active.map((branch) => {
              const state = attendanceState(own.data?.records ?? [], branch.id, branch.timezone);
              return (
                <Card as="article" key={branch.id} aria-label={branch.name}>
                  <CardHeader title={branch.name} headingLevel={3} />
                  <div>
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
                  </div>
                  {state.kind === 'openPast' ? (
                    <Notice tone="warning">
                      {fill(t.attendance.stateOpenPast, {
                        date: formatDate(state.record.businessDate, locale),
                      })}
                    </Notice>
                  ) : null}
                  {account.attendanceRequired === false ? null : state.kind === 'in' ? (
                    <Button
                      variant="primary"
                      size="lg"
                      fullWidth
                      loading={submit.pending && busyBranch === branch.id}
                      disabled={submit.pending}
                      onClick={() =>
                        void act(
                          () => api.post(`/api/v1/attendance/${state.record.id}/check-out`, {}),
                          t.attendance.checkedOut,
                          branch.id,
                        )
                      }
                    >
                      {t.attendance.checkOut}
                    </Button>
                  ) : state.kind === 'none' || state.kind === 'openPast' ? (
                    <Button
                      variant="primary"
                      size="lg"
                      fullWidth
                      loading={submit.pending && busyBranch === branch.id}
                      disabled={submit.pending}
                      onClick={() =>
                        void act(
                          () => api.post('/api/v1/attendance/check-in', { branchId: branch.id }),
                          t.attendance.checkedIn,
                          branch.id,
                        )
                      }
                    >
                      {t.attendance.checkIn}
                    </Button>
                  ) : null}
                  <p className="ls-hint">
                    {fill(t.attendance.timezoneNote, { timezone: branch.timezone })}
                  </p>
                </Card>
              );
            })}
          </Grid>
        ) : null}
      </ListSection>
      <ListSection title={t.attendance.history}>
        {own.data && own.data.records.length === 0 ? (
          <Empty title={t.attendance.historyEmptyTitle}>{t.attendance.historyEmpty}</Empty>
        ) : null}
        {own.data && own.data.records.length > 0 ? (
          <AttendanceTable
            records={own.data.records}
            branches={branches.data}
            list={t.attendance.history}
            paging={urlPaging(
              url.minePage,
              url.mineSize,
              ({ page, pageSize }) =>
                update({
                  ...(page !== undefined ? { minePage: page } : {}),
                  ...(pageSize !== undefined ? { mineSize: pageSize } : {}),
                }),
              t,
              t.attendance.history,
            )}
          />
        ) : null}
      </ListSection>
    </>
  );
}

function AttendanceTable({
  records,
  branches,
  list,
  paging,
  employee,
  onCorrect,
}: {
  records: readonly AttendanceRecordResponse[];
  branches: Map<string, BranchSummary> | null;
  /** Visible name of the list (the table's accessible name and the pager's). */
  list: string;
  /** The pager, kept in the address bar by the screen. */
  paging: DataTablePaging;
  /** Present on the branch view: adds the employee column. */
  employee?: (id: string) => string;
  /** Present when the viewer may correct: adds the row menu. */
  onCorrect?: (record: AttendanceRecordResponse) => void;
}) {
  const { t, locale } = useWorkforce();
  const { account } = useAccount();
  const columns: DataTableColumn<AttendanceRecordResponse>[] = [
    {
      key: 'date',
      header: t.attendance.businessDate,
      mobileTitle: true,
      cell: (record) => formatDate(record.businessDate, locale),
    },
    ...(employee
      ? [
          {
            key: 'employee',
            header: t.attendance.employee,
            wrap: true,
            cell: (record: AttendanceRecordResponse) => employee(record.employeeId),
          },
        ]
      : []),
    {
      key: 'branch',
      header: t.common.branch,
      hideBelow: 'lg',
      wrap: true,
      cell: (record) => branchLabel(record.branchId, branches, t),
    },
    {
      key: 'in',
      header: t.attendance.checkInAt,
      numeric: true,
      cell: (record) =>
        formatTime(record.checkInAt, branches?.get(record.branchId)?.timezone ?? 'UTC', locale),
    },
    {
      key: 'out',
      header: t.attendance.checkOutAt,
      numeric: true,
      cell: (record) =>
        record.checkOutAt ? (
          formatTime(record.checkOutAt, branches?.get(record.branchId)?.timezone ?? 'UTC', locale)
        ) : (
          <Badge tone="warning">{t.attendance.open}</Badge>
        ),
    },
    ...(onCorrect
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (record: AttendanceRecordResponse) =>
              canCorrectAttendance(account, record) ? (
                <RowActions
                  menuLabel={fill(t.common.list.actionsFor, {
                    name: formatDate(record.businessDate, locale),
                  })}
                  items={[
                    {
                      id: 'correct',
                      label: opensInput(t.attendance.correct),
                      icon: 'edit',
                      onSelect: () => onCorrect(record),
                    },
                  ]}
                />
              ) : null,
          },
        ]
      : []),
  ];
  return (
    <DataTable
      mode="client"
      caption={fill(t.common.list.table, { list })}
      columns={columns}
      rows={records}
      rowKey={(record) => record.id}
      paging={paging}
    />
  );
}

/** A heading that only repeats the page's h1 is left out when the branch list is the page's only section. */
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

function BranchAttendance({
  titled,
  branches,
  url,
  update,
}: {
  titled: boolean;
  branches: Resource<Map<string, BranchSummary>>;
  url: AttendanceUrl;
  update: AttendanceUpdate;
}) {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const names = useEmployeeNames(api, account);
  const filters = { branchId: url.branch, from: url.from, to: url.to };
  const [editing, setEditing] = useState<string | null>(null);
  const list = useResource(
    () =>
      api.get<AttendanceListResponse>('/api/v1/attendance', {
        branchId: url.branch || undefined,
        from: url.from || undefined,
        to: url.to || undefined,
      }),
    [api, url.branch, url.from, url.to],
  );
  const viewable = [...(branches.data?.values() ?? [])].filter(
    (branch) =>
      canGlobal(account, 'VIEW_ATTENDANCE') || canAt(account, 'VIEW_ATTENDANCE', branch.id),
  );
  const canCorrect = (record: AttendanceRecordResponse) => canCorrectAttendance(account, record);
  const records = list.data?.records ?? [];
  const target = editing ? (records.find((record) => record.id === editing) ?? null) : null;
  const activeFilters = [filters.branchId, filters.from, filters.to].filter(Boolean).length;

  return (
    <SectionFrame titled={titled} title={t.attendance.team}>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={activeFilters}
        resultCount={list.data ? resultsText(t, records.length) : undefined}
        onReset={() => update({ branch: '', from: '', to: '' })}
        reload={{ label: t.common.reload, onClick: () => void list.reload(), busy: list.loading }}
        search={
          <Select
            id="att-branch"
            aria-label={t.common.branch}
            value={filters.branchId}
            options={[
              { value: '', label: t.common.all },
              ...viewable.map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
            onChange={(event) => update({ branch: event.target.value })}
          />
        }
        filters={
          <>
            <DateTextInput
              id="att-from"
              aria-label={t.common.from}
              title={t.common.from}
              value={filters.from}
              onChange={(event) => update({ from: event.target.value })}
            />
            <DateTextInput
              id="att-to"
              aria-label={t.common.to}
              title={t.common.to}
              value={filters.to}
              onChange={(event) => update({ to: event.target.value })}
            />
          </>
        }
      />
      {list.loading && !list.data ? <Loading t={t} /> : null}
      {list.error ? (
        <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
      ) : null}
      {list.data && records.length === 0 ? (
        activeFilters > 0 ? (
          <Empty
            title={t.attendance.teamEmptyFilteredTitle}
            action={
              <Button variant="secondary" onClick={() => update({ branch: '', from: '', to: '' })}>
                {t.attendance.showAll}
              </Button>
            }
          >
            {t.attendance.teamEmptyFiltered}
          </Empty>
        ) : (
          <Empty title={t.attendance.teamEmptyTitle}>{t.attendance.teamEmpty}</Empty>
        )
      ) : null}
      {records.length > 0 ? (
        <AttendanceTable
          records={records}
          branches={branches.data}
          list={t.attendance.team}
          paging={urlPaging(
            url.page,
            url.size,
            ({ page, pageSize }) =>
              update({
                ...(page !== undefined ? { page } : {}),
                ...(pageSize !== undefined ? { size: pageSize } : {}),
              }),
            t,
            t.attendance.team,
          )}
          employee={(id) => employeeLabel(id, names.data, account, t)}
          {...(records.some(canCorrect) ? { onCorrect: (record) => setEditing(record.id) } : {})}
        />
      ) : null}
      {target ? (
        <CorrectionDialog
          record={target}
          branch={branches.data?.get(target.branchId)}
          onDone={async () => {
            setEditing(null);
            await list.reload();
          }}
          onClose={() => setEditing(null)}
          reload={list.reload}
        />
      ) : null}
    </SectionFrame>
  );
}

/** Manager correction (for example a forgotten check-out); reason required, versioned. */
export function CorrectionDialog({
  record,
  branch,
  onDone,
  onClose,
  reload,
}: {
  record: AttendanceRecordResponse;
  branch: BranchSummary | undefined;
  onDone: () => Promise<void>;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const zone = branch?.timezone ?? 'UTC';
  const originalIn = zonedLocal(record.checkInAt, zone);
  const originalOut = record.checkOutAt ? zonedLocal(record.checkOutAt, zone) : '';
  const [checkIn, setCheckIn] = useState(originalIn);
  const [checkOut, setCheckOut] = useState(
    record.checkOutAt ? zonedLocal(record.checkOutAt, zone) : `${record.businessDate}T`,
  );
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const submit = useSubmit();

  async function save() {
    // The reason is required: said at the field on submit, not by a disabled button (wig attendance.tsx:447).
    if (reason.trim().length === 0) {
      setChecked(true);
      window.setTimeout(() => focusFirstInvalid(document), 0);
      return;
    }
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

  return (
    <FormDialog
      title={t.attendance.correctionTitle}
      description={t.attendance.correctionHint}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={reason !== '' || checkIn !== originalIn || checkOut !== originalOut}
      error={
        submit.error ? <Notice tone="error">{errorMessage(submit.error, t)}</Notice> : undefined
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <KitField label={t.attendance.correctedCheckIn} required requiredLabel={t.common.required}>
          {(control) => (
            <TextInput
              {...control}
              name="checkIn"
              type="datetime-local"
              value={checkIn}
              max={`${todayIn(zone)}T23:59`}
              onChange={(event) => setCheckIn(event.target.value)}
            />
          )}
        </KitField>
        <KitField label={t.attendance.correctedCheckOut}>
          {(control) => (
            <TextInput
              {...control}
              name="checkOut"
              type="datetime-local"
              value={checkOut.length === 16 ? checkOut : ''}
              min={checkIn}
              onChange={(event) => setCheckOut(event.target.value)}
            />
          )}
        </KitField>
        <KitField
          label={t.common.reason}
          required
          requiredLabel={t.common.required}
          {...(checked && reason.trim().length === 0
            ? { error: t.common.form.reasonRequired }
            : {})}
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </KitField>
      </FormGrid>
    </FormDialog>
  );
}
