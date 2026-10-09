'use client';

import type { BranchSummary, CollaboratorWorkOccurrence } from '@lucy-spa/contracts';
import {
  Button,
  ConfirmDialog,
  DataTable,
  DateTextInput,
  Field as KitField,
  FormDrawer,
  FormGrid,
  ListToolbar,
  RadioGroup,
  RowActions,
  Select,
  TextInput,
  TimeInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  collaboratorWorkCommands,
  createRequest,
  EMPTY_WORK_FORM,
  payLabel,
  scheduleRange,
  updateRequest,
  workErrorMessage,
  workFormOf,
  workFormProblem,
  type WorkForm,
} from '../../../lib/workforce/collaborator-work';
import { businessToday, isCalendarDate } from '../../../lib/workforce/employee-create';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDate } from '../../../lib/workforce/format';
import { resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { canAnywhere, canAt } from '../../../lib/workforce/permissions';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { runMutation } from '../../../lib/workforce/workflows';
import { useBranches } from '../data';
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
  VisuallyHidden,
} from '../ui';

type Branches = ReadonlyMap<string, BranchSummary> | null;

/**
 * "Lịch làm CTV / Collaborator schedule" (follow-up Step 6). Functional management view:
 * list by period and branch, schedule, edit and cancel. Pay fields appear only with the
 * pay permission at the branch; the API re-checks every rule.
 */
export function CollaboratorScheduleScreen() {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const texts = t.collaboratorWork;
  const today = businessToday([...(branches.data?.keys() ?? [])], branches.data ?? null);
  const defaults = scheduleRange(today);
  const [range, setRange] = useState(defaults);
  const [branchId, setBranchId] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useResource(
    () =>
      collaboratorWorkCommands.list(api, {
        from: range.from,
        to: range.to,
        ...(branchId ? { branchId } : {}),
      }),
    [api, range.from, range.to, branchId],
  );
  const activeFilters =
    (branchId ? 1 : 0) +
    (range.from !== defaults.from ? 1 : 0) +
    (range.to !== defaults.to ? 1 : 0);
  return (
    <>
      <PageHeader title={texts.title} intro={texts.intro}>
        {canAnywhere(account, 'MANAGE_WORK_SCHEDULE') ? (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {texts.create}
          </Button>
        ) : null}
      </PageHeader>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={activeFilters}
        resultCount={list.data ? resultsText(t, list.data.items.length) : undefined}
        onReset={() => (setRange(defaults), setBranchId(''))}
        reload={{ label: t.common.reload, onClick: () => void list.reload(), busy: list.loading }}
        search={
          <Select
            id="work-branch"
            aria-label={texts.branch}
            value={branchId}
            options={[
              { value: '', label: texts.allBranches },
              ...[...(branches.data?.values() ?? [])].map((branch) => ({
                value: branch.id,
                label: branch.name,
              })),
            ]}
            onChange={(event) => setBranchId(event.target.value)}
          />
        }
        filters={
          <>
            <DateTextInput
              id="work-from"
              aria-label={texts.from}
              title={texts.from}
              value={range.from}
              onChange={(event) =>
                setRange((current) => ({ ...current, from: event.target.value }))
              }
            />
            <DateTextInput
              id="work-to"
              aria-label={texts.to}
              title={texts.to}
              value={range.to}
              onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
            />
          </>
        }
      />
      {list.loading && !list.data ? <Loading t={t} /> : null}
      {list.error ? (
        <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
      ) : null}
      {list.data ? (
        <ScheduleTable
          items={list.data.items}
          branches={branches.data}
          today={today}
          onChanged={list.reload}
        />
      ) : null}
      {creating ? (
        <WorkDrawer
          row={null}
          branches={branches.data}
          today={today}
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await list.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** The occurrences table with its row menu, edit drawer and cancel dialog (renders without a network in tests). */
export function ScheduleTable({
  items,
  branches,
  today,
  onChanged,
}: {
  items: CollaboratorWorkOccurrence[];
  branches: Branches;
  today: string;
  onChanged: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const texts = t.collaboratorWork;
  const paging = useClientPaging(t, texts.title);
  const [editing, setEditing] = useState<CollaboratorWorkOccurrence | null>(null);
  const [cancelling, setCancelling] = useState<CollaboratorWorkOccurrence | null>(null);
  const [cancelled, setCancelled] = useState(false);
  if (items.length === 0) return <Empty>{texts.empty}</Empty>;

  const columns: DataTableColumn<CollaboratorWorkOccurrence>[] = [
    {
      key: 'collaborator',
      header: texts.collaborator,
      mobileTitle: true,
      width: 'sm',
      cell: (row) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-title" title={row.employeeName}>
            {row.employeeName}
          </span>
          <span className="ls-cell-sub">{row.employeeCode}</span>
        </span>
      ),
    },
    {
      key: 'date',
      header: texts.workDate,
      cell: (row) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main">{formatDate(row.workDate, locale)}</span>
          <span className="ls-cell-sub">
            {row.startTime}–{row.endTime}
          </span>
        </span>
      ),
    },
    { key: 'mode', header: texts.mode, hideBelow: 'xl', cell: (row) => texts.modes[row.mode] },
    {
      key: 'branch',
      header: texts.branch,
      hideBelow: 'xl',
      truncate: true,
      width: 'sm',
      cell: (row) => branches?.get(row.branchId)?.name ?? '—',
    },
    { key: 'pay', header: texts.payShort, numeric: true, cell: (row) => payLabel(row, t, locale) },
    {
      key: 'status',
      header: texts.status,
      // The cancellation reason is the badge's tooltip and read by screen readers; it adds no second line to the row.
      cell: (row) => (
        <Badge tone={row.status === 'SCHEDULED' ? 'success' : 'neutral'}>
          <span title={row.cancelReason ?? undefined}>
            {texts.statuses[row.status]}
            {row.cancelReason ? <VisuallyHidden>: {row.cancelReason}</VisuallyHidden> : null}
          </span>
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) =>
        row.status === 'SCHEDULED' && canAt(account, 'MANAGE_WORK_SCHEDULE', row.branchId) ? (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: row.employeeName })}
            items={[
              {
                id: 'edit',
                label: texts.edit,
                icon: 'edit',
                onSelect: () => setEditing(row),
              },
              {
                id: 'cancel',
                label: texts.cancel,
                icon: 'x-circle',
                tone: 'danger',
                onSelect: () => setCancelling(row),
              },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <>
      {cancelled ? <Notice tone="success">{texts.cancelled}</Notice> : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: texts.title })}
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        paging={paging}
      />
      {editing ? (
        <WorkDrawer
          row={editing}
          branches={branches}
          today={today}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}
      {cancelling ? (
        <ConfirmDialog
          title={texts.cancelTitle}
          description={texts.cancelBody}
          confirmLabel={texts.cancel}
          cancelLabel={texts.keep}
          facts={[
            { label: texts.collaborator, value: cancelling.employeeName },
            {
              label: texts.workDate,
              value: `${formatDate(cancelling.workDate, locale)} · ${cancelling.startTime}–${cancelling.endTime}`,
            },
          ]}
          reasonField={{
            label: texts.cancelReason,
            required: true,
            requiredLabel: t.common.required,
            requiredMessage: t.common.form.reasonRequired,
          }}
          describeError={confirmError(t)}
          onCancel={() => setCancelling(null)}
          onConfirm={async (reason) => {
            const outcome = await runMutation(
              () =>
                collaboratorWorkCommands.cancel(api, cancelling.id, {
                  expectedVersion: cancelling.version,
                  reason: (reason ?? '').trim(),
                }),
              onChanged,
            );
            if (!outcome.ok) throw outcome.error;
            setCancelling(null);
            notify(texts.cancelled, () => setCancelled(true));
            await onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Schedule (row `null`) or edit one occurrence. About ten fields, so a drawer: branch and date, the
 * collaborator (new occurrences only), SHIFT or FULL_DAY, the hours (for FULL_DAY the branch window of
 * that date, snapshotted on save), the agreed pay (only with the pay permission at the branch), note
 * and reason.
 */
export function WorkDrawer({
  row,
  branches,
  today,
  onClose,
  onDone,
}: {
  row: CollaboratorWorkOccurrence | null;
  branches: Branches;
  today: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const texts = t.collaboratorWork;
  const creating = row === null;
  const [form, setForm] = useState<WorkForm>(() => (row ? workFormOf(row) : EMPTY_WORK_FORM));
  const [initial] = useState(form);
  const [shown, setShown] = useState(false);
  const submit = useSubmit();
  const set = (key: keyof WorkForm, value: string) => {
    setShown(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const ready = creating && form.branchId !== '' && isCalendarDate(form.workDate);
  const options = useResource(
    async () =>
      ready ? collaboratorWorkCommands.options(api, form.branchId, form.workDate) : null,
    [api, ready, form.branchId, form.workDate],
  );
  const past =
    (row !== null && row.workDate < today) ||
    (isCalendarDate(form.workDate) && form.workDate < today);
  const problem = workFormProblem(form, past);
  const schedulable = [...(branches?.values() ?? [])].filter((branch) =>
    canAt(account, 'MANAGE_WORK_SCHEDULE', branch.id),
  );
  const window = ready ? (options.data?.window ?? undefined) : undefined;
  const showPay = row === null ? form.branchId !== '' : 'agreedPayVnd' in row;
  const canPay = form.branchId !== '' && canAt(account, 'MANAGE_EMPLOYEE_PAY', form.branchId);
  const dirty = (Object.keys(form) as (keyof WorkForm)[]).some((key) => form[key] !== initial[key]);

  async function save() {
    if (problem !== null) {
      setShown(true);
      return;
    }
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            row
              ? collaboratorWorkCommands.update(api, row.id, updateRequest(row, form))
              : collaboratorWorkCommands.create(api, createRequest(form)),
          onDone,
        ),
      creating ? texts.created : texts.updated,
    );
    if (ok) await onDone();
  }

  return (
    <FormDrawer
      title={creating ? texts.create : texts.editTitle}
      labels={formOverlayLabels(t, creating ? texts.submit : texts.saveChanges)}
      busy={submit.pending}
      dirty={dirty}
      error={
        shown && problem !== null ? (
          <Notice tone="error">{texts.problems[problem]}</Notice>
        ) : submit.error ? (
          <Notice tone="error">{workErrorMessage(submit.error, t)}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <KitField label={texts.branch} required requiredLabel={t.common.required}>
          {(control) => (
            <Select
              {...control}
              value={form.branchId}
              placeholder="—"
              options={schedulable.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(event) => {
                set('branchId', event.target.value);
                if (creating) set('employeeId', '');
              }}
            />
          )}
        </KitField>
        <KitField
          label={texts.workDate}
          required
          requiredLabel={t.common.required}
          {...(past ? { hint: texts.reasonHint } : {})}
        >
          {(control) => (
            <DateTextInput
              {...control}
              value={form.workDate}
              onChange={(event) => {
                set('workDate', event.target.value);
                if (creating) set('employeeId', '');
              }}
            />
          )}
        </KitField>
        {creating && !ready ? (
          <p className="ls-hint ls-field-full">{texts.pickBranchDate}</p>
        ) : null}
        {ready && options.data && options.data.collaborators.length === 0 ? (
          <div className="ls-field-full">
            <Notice tone="info">{texts.noCollaborators}</Notice>
          </div>
        ) : null}
        {ready && options.data && options.data.collaborators.length > 0 ? (
          <KitField label={texts.collaborator} required requiredLabel={t.common.required} full>
            {(control) => (
              <Select
                {...control}
                value={form.employeeId}
                placeholder="—"
                options={options.data!.collaborators.map((person) => ({
                  value: person.id,
                  label: `${person.fullName} (${person.employeeCode})`,
                }))}
                onChange={(event) => set('employeeId', event.target.value)}
              />
            )}
          </KitField>
        ) : null}
        <div className="ls-field-full">
          <RadioGroup
            legend={texts.mode}
            name={`work-mode-${row?.id ?? 'new'}`}
            layout="inline"
            value={form.mode}
            options={(['SHIFT', 'FULL_DAY'] as const).map((option) => ({
              value: option,
              label: texts.modes[option],
            }))}
            onValueChange={(mode) => set('mode', mode)}
          />
        </div>
        {form.mode === 'SHIFT' ? (
          <>
            <KitField label={texts.start} required requiredLabel={t.common.required}>
              {(control) => (
                <TimeInput
                  {...control}
                  value={form.startTime}
                  onChange={(event) => set('startTime', event.target.value)}
                />
              )}
            </KitField>
            <KitField label={texts.end} required requiredLabel={t.common.required}>
              {(control) => (
                <TimeInput
                  {...control}
                  value={form.endTime}
                  onChange={(event) => set('endTime', event.target.value)}
                />
              )}
            </KitField>
          </>
        ) : window === null ? (
          <div className="ls-field-full">
            <Notice tone="warning">{texts.closed}</Notice>
          </div>
        ) : window ? (
          <p className="ls-hint ls-field-full">
            {fill(texts.fullDayWindow, { start: window.startTime, end: window.endTime })}
          </p>
        ) : null}
        {showPay && form.branchId !== '' && !canPay ? (
          <p className="ls-hint ls-field-full">{texts.payNoPermission}</p>
        ) : null}
        {showPay && canPay ? (
          <KitField label={texts.pay} hint={texts.payHint} full>
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={18}
                value={form.agreedPayVnd}
                onChange={(event) => set('agreedPayVnd', event.target.value)}
              />
            )}
          </KitField>
        ) : null}
        {creating ? (
          <KitField label={texts.note} full>
            {(control) => (
              <TextInput
                {...control}
                maxLength={500}
                value={form.note}
                onChange={(event) => set('note', event.target.value)}
              />
            )}
          </KitField>
        ) : null}
        <KitField
          label={texts.reason}
          hint={texts.reasonHint}
          full
          {...(past ? { required: true, requiredLabel: t.common.required } : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              maxLength={500}
              value={form.reason}
              onChange={(event) => set('reason', event.target.value)}
            />
          )}
        </KitField>
      </FormGrid>
    </FormDrawer>
  );
}
