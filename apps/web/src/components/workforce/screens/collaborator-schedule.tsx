'use client';

import type {
  BranchSummary,
  CollaboratorWorkMode,
  CollaboratorWorkOccurrence,
} from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
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
import { formatDate } from '../../../lib/workforce/format';
import { canAnywhere, canAt } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
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
  const [range, setRange] = useState(() => scheduleRange(today));
  const [branchId, setBranchId] = useState('');
  const list = useResource(
    () =>
      collaboratorWorkCommands.list(api, {
        from: range.from,
        to: range.to,
        ...(branchId ? { branchId } : {}),
      }),
    [api, range.from, range.to, branchId],
  );
  return (
    <>
      <PageHeader title={texts.title} intro={texts.intro} />
      {canAnywhere(account, 'MANAGE_WORK_SCHEDULE') ? (
        <CreateWork branches={branches.data} today={today} onDone={list.reload} />
      ) : null}
      <Section title={texts.title}>
        <div className="wf-filters">
          <Field id="work-from" label={texts.from}>
            <input
              id="work-from"
              type="date"
              value={range.from}
              onChange={(event) =>
                setRange((current) => ({ ...current, from: event.target.value }))
              }
            />
          </Field>
          <Field id="work-to" label={texts.to}>
            <input
              id="work-to"
              type="date"
              value={range.to}
              onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
            />
          </Field>
          <Field id="work-branch" label={texts.branch}>
            <select
              id="work-branch"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              <option value="">{texts.allBranches}</option>
              {[...(branches.data?.values() ?? [])].map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
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
      </Section>
    </>
  );
}

/** The occurrences table (renders without a network in tests). */
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
  const { t, locale } = useWorkforce();
  const { account } = useAccount();
  const texts = t.collaboratorWork;
  if (items.length === 0) return <Empty>{texts.empty}</Empty>;
  return (
    <table className="wf-table">
      <thead>
        <tr>
          <th scope="col">{texts.collaborator}</th>
          <th scope="col">{texts.workDate}</th>
          <th scope="col">{texts.branch}</th>
          <th scope="col">{texts.mode}</th>
          <th scope="col">{texts.time}</th>
          <th scope="col">{texts.pay}</th>
          <th scope="col">{texts.status}</th>
          <th scope="col" />
        </tr>
      </thead>
      <tbody>
        {items.map((row) => (
          <tr key={row.id}>
            <td data-label={texts.collaborator}>
              {row.employeeName} <span className="wf-muted wf-small">({row.employeeCode})</span>
            </td>
            <td data-label={texts.workDate}>{formatDate(row.workDate, locale)}</td>
            <td data-label={texts.branch}>{branches?.get(row.branchId)?.name ?? '—'}</td>
            <td data-label={texts.mode}>{texts.modes[row.mode]}</td>
            <td data-label={texts.time}>
              {row.startTime}–{row.endTime}
            </td>
            <td data-label={texts.pay}>{payLabel(row, t, locale)}</td>
            <td data-label={texts.status}>
              <Badge tone={row.status === 'SCHEDULED' ? 'success' : 'neutral'}>
                {texts.statuses[row.status]}
              </Badge>
              {row.cancelReason ? (
                <span className="wf-muted wf-small"> {row.cancelReason}</span>
              ) : null}
            </td>
            <td>
              {row.status === 'SCHEDULED' &&
              canAt(account, 'MANAGE_WORK_SCHEDULE', row.branchId) ? (
                <WorkActions row={row} branches={branches} today={today} onDone={onChanged} />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModeChoice({
  name,
  mode,
  onChange,
}: {
  name: string;
  mode: CollaboratorWorkMode;
  onChange: (mode: CollaboratorWorkMode) => void;
}) {
  const { t } = useWorkforce();
  const texts = t.collaboratorWork;
  return (
    <fieldset className="wf-choices">
      <legend>{texts.mode}</legend>
      {(['SHIFT', 'FULL_DAY'] as const).map((option) => (
        <label key={option}>
          <input
            type="radio"
            name={name}
            value={option}
            checked={mode === option}
            onChange={() => onChange(option)}
          />
          <span>
            <strong>{texts.modes[option]}</strong>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Times for SHIFT; for FULL_DAY the branch window of that date (snapshotted on save). */
function WorkTimes({
  prefix,
  form,
  set,
  window,
}: {
  prefix: string;
  form: WorkForm;
  set: (key: keyof WorkForm, value: string) => void;
  window: { startTime: string; endTime: string } | null | undefined;
}) {
  const { t } = useWorkforce();
  const texts = t.collaboratorWork;
  if (form.mode === 'FULL_DAY') {
    if (window === undefined) return null;
    return window === null ? (
      <Notice tone="warning">{texts.closed}</Notice>
    ) : (
      <p className="wf-hint">
        {fill(texts.fullDayWindow, { start: window.startTime, end: window.endTime })}
      </p>
    );
  }
  return (
    <div className="wf-row">
      <Field id={`${prefix}-start`} label={texts.start} required>
        <input
          id={`${prefix}-start`}
          type="time"
          required
          value={form.startTime}
          onChange={(event) => set('startTime', event.target.value)}
        />
      </Field>
      <Field id={`${prefix}-end`} label={texts.end} required>
        <input
          id={`${prefix}-end`}
          type="time"
          required
          value={form.endTime}
          onChange={(event) => set('endTime', event.target.value)}
        />
      </Field>
    </div>
  );
}

/** Agreed pay: only with MANAGE_EMPLOYEE_PAY at the branch; whole VND, entered by hand. */
function PayField({
  prefix,
  form,
  set,
}: {
  prefix: string;
  form: WorkForm;
  set: (key: keyof WorkForm, value: string) => void;
}) {
  const { t } = useWorkforce();
  const { account } = useAccount();
  const texts = t.collaboratorWork;
  if (form.branchId === '' || !canAt(account, 'MANAGE_EMPLOYEE_PAY', form.branchId)) {
    return form.branchId === '' ? null : <p className="wf-hint">{texts.payNoPermission}</p>;
  }
  return (
    <Field id={`${prefix}-pay`} label={texts.pay} hint={texts.payHint}>
      <input
        id={`${prefix}-pay`}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={18}
        aria-describedby={`${prefix}-pay-hint`}
        value={form.agreedPayVnd}
        onChange={(event) => set('agreedPayVnd', event.target.value)}
      />
    </Field>
  );
}

function CreateWork({
  branches,
  today,
  onDone,
}: {
  branches: Branches;
  today: string;
  onDone: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const texts = t.collaboratorWork;
  const [form, setForm] = useState<WorkForm>(EMPTY_WORK_FORM);
  const [shown, setShown] = useState(false);
  const submit = useSubmit();
  const set = (key: keyof WorkForm, value: string) => {
    setShown(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const ready = form.branchId !== '' && isCalendarDate(form.workDate);
  const options = useResource(
    async () =>
      ready ? collaboratorWorkCommands.options(api, form.branchId, form.workDate) : null,
    [api, ready, form.branchId, form.workDate],
  );
  const past = isCalendarDate(form.workDate) && form.workDate < today;
  const problem = workFormProblem(form, past);
  const schedulable = [...(branches?.values() ?? [])].filter((branch) =>
    canAt(account, 'MANAGE_WORK_SCHEDULE', branch.id),
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (problem !== null) {
      setShown(true);
      return;
    }
    const ok = await submit.run(
      () => runMutation(() => collaboratorWorkCommands.create(api, createRequest(form)), onDone),
      texts.created,
    );
    if (ok) {
      setForm({ ...EMPTY_WORK_FORM, branchId: form.branchId, workDate: form.workDate });
      await onDone();
    }
  }

  return (
    <Section title={texts.create}>
      <form className="wf-form wf-member-form" onSubmit={(event) => void save(event)}>
        <div className="wf-row">
          <Field id="new-work-branch" label={texts.branch} required>
            <select
              id="new-work-branch"
              required
              value={form.branchId}
              onChange={(event) => {
                set('branchId', event.target.value);
                set('employeeId', '');
              }}
            >
              <option value="" disabled>
                —
              </option>
              {schedulable.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="new-work-date"
            label={texts.workDate}
            required
            {...(past ? { hint: texts.reasonHint } : {})}
          >
            <input
              id="new-work-date"
              type="date"
              required
              value={form.workDate}
              onChange={(event) => {
                set('workDate', event.target.value);
                set('employeeId', '');
              }}
            />
          </Field>
        </div>
        {!ready ? <p className="wf-hint">{texts.pickBranchDate}</p> : null}
        {ready && options.data && options.data.collaborators.length === 0 ? (
          <Notice tone="info">{texts.noCollaborators}</Notice>
        ) : null}
        {ready && options.data && options.data.collaborators.length > 0 ? (
          <Field id="new-work-collaborator" label={texts.collaborator} required>
            <select
              id="new-work-collaborator"
              required
              value={form.employeeId}
              onChange={(event) => set('employeeId', event.target.value)}
            >
              <option value="" disabled>
                —
              </option>
              {options.data.collaborators.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName} ({person.employeeCode})
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <ModeChoice name="new-work-mode" mode={form.mode} onChange={(mode) => set('mode', mode)} />
        <WorkTimes
          prefix="new-work"
          form={form}
          set={set}
          window={ready ? (options.data?.window ?? undefined) : undefined}
        />
        <PayField prefix="new-work" form={form} set={set} />
        <div className="wf-row">
          <Field id="new-work-note" label={texts.note}>
            <input
              id="new-work-note"
              maxLength={500}
              value={form.note}
              onChange={(event) => set('note', event.target.value)}
            />
          </Field>
          <Field id="new-work-reason" label={texts.reason} required={past} hint={texts.reasonHint}>
            <input
              id="new-work-reason"
              maxLength={500}
              aria-describedby="new-work-reason-hint"
              value={form.reason}
              onChange={(event) => set('reason', event.target.value)}
            />
          </Field>
        </div>
        {shown && problem !== null ? <Notice tone="error">{texts.problems[problem]}</Notice> : null}
        {submit.error ? <Notice tone="error">{workErrorMessage(submit.error, t)}</Notice> : null}
        {submit.success ? <Notice tone="success">{submit.success}</Notice> : null}
        <SubmitButton
          pending={submit.pending}
          label={texts.submit}
          pendingLabel={t.common.saving}
        />
      </form>
    </Section>
  );
}

function WorkActions({
  row,
  branches,
  today,
  onDone,
}: {
  row: CollaboratorWorkOccurrence;
  branches: Branches;
  today: string;
  onDone: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const texts = t.collaboratorWork;
  const [form, setForm] = useState<WorkForm>(() => workFormOf(row));
  const [cancelReason, setCancelReason] = useState('');
  const [shown, setShown] = useState(false);
  const submit = useSubmit();
  const set = (key: keyof WorkForm, value: string) => {
    setShown(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const past = row.workDate < today || (isCalendarDate(form.workDate) && form.workDate < today);
  const problem = workFormProblem(form, past);
  const prefix = `edit-${row.id}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (problem !== null) {
      setShown(true);
      return;
    }
    const ok = await submit.run(
      () =>
        runMutation(
          () => collaboratorWorkCommands.update(api, row.id, updateRequest(row, form)),
          onDone,
        ),
      texts.updated,
    );
    if (ok) await onDone();
  }

  async function cancel() {
    if (cancelReason.trim() === '') return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            collaboratorWorkCommands.cancel(api, row.id, {
              expectedVersion: row.version,
              reason: cancelReason.trim(),
            }),
          onDone,
        ),
      texts.cancelled,
    );
    if (ok) await onDone();
  }

  return (
    <details className="wf-disclosure">
      <summary>{texts.edit}</summary>
      <form className="wf-form wf-member-form" onSubmit={(event) => void save(event)}>
        <div className="wf-row">
          <Field id={`${prefix}-branch`} label={texts.branch} required>
            <select
              id={`${prefix}-branch`}
              value={form.branchId}
              onChange={(event) => set('branchId', event.target.value)}
            >
              {[...(branches?.values() ?? [])]
                .filter((branch) => canAt(account, 'MANAGE_WORK_SCHEDULE', branch.id))
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field id={`${prefix}-date`} label={texts.workDate} required>
            <input
              id={`${prefix}-date`}
              type="date"
              required
              value={form.workDate}
              onChange={(event) => set('workDate', event.target.value)}
            />
          </Field>
        </div>
        <ModeChoice
          name={`${prefix}-mode`}
          mode={form.mode}
          onChange={(mode) => set('mode', mode)}
        />
        <WorkTimes prefix={prefix} form={form} set={set} window={undefined} />
        {'agreedPayVnd' in row ? <PayField prefix={prefix} form={form} set={set} /> : null}
        <Field id={`${prefix}-reason`} label={texts.reason} required={past} hint={texts.reasonHint}>
          <input
            id={`${prefix}-reason`}
            maxLength={500}
            value={form.reason}
            onChange={(event) => set('reason', event.target.value)}
          />
        </Field>
        {shown && problem !== null ? <Notice tone="error">{texts.problems[problem]}</Notice> : null}
        {submit.error ? <Notice tone="error">{workErrorMessage(submit.error, t)}</Notice> : null}
        {submit.success ? <Notice tone="success">{submit.success}</Notice> : null}
        <SubmitButton
          pending={submit.pending}
          label={texts.saveChanges}
          pendingLabel={t.common.saving}
        />
      </form>
      <div className="wf-form wf-member-form">
        <Field id={`${prefix}-cancel-reason`} label={texts.cancelReason} required>
          <input
            id={`${prefix}-cancel-reason`}
            maxLength={500}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
          />
        </Field>
        <button
          type="button"
          className="wf-button wf-button-danger"
          disabled={submit.pending || cancelReason.trim() === ''}
          onClick={() => void cancel()}
        >
          {texts.cancel}
        </button>
      </div>
    </details>
  );
}
