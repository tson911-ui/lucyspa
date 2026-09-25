'use client';

import type {
  BranchHoursUpdateRequest,
  BranchOperatingDay,
  BranchResponse,
  BranchUpdateRequest,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { canAt, canGlobal } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
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

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Fills missing weekdays (pre-Phase 2 seed branches may have none) as closed. */
export function editableHours(hours: readonly BranchOperatingDay[]): BranchOperatingDay[] {
  return WEEKDAYS.map(
    (isoWeekday) =>
      hours.find((day) => day.isoWeekday === isoWeekday) ?? {
        isoWeekday,
        isClosed: true,
        opensAt: null,
        closesAt: null,
      },
  );
}

export function BranchDetailScreen({ id }: { id: string }) {
  const { api, t, base } = useWorkforce();
  const { account } = useAccount();
  const branch = useResource(() => api.get<BranchResponse>(`/api/v1/branches/${id}`), [api, id]);
  const manage = canAt(account, 'MANAGE_BRANCHES', id);
  const manageStatus = canGlobal(account, 'MANAGE_BRANCHES');

  return (
    <>
      <p>
        <Link href={`${base}/branches`}>← {t.common.back}</Link>
      </p>
      {branch.loading && !branch.data ? <Loading t={t} /> : null}
      {branch.error ? (
        <ErrorState error={branch.error} t={t} onRetry={() => void branch.reload()} />
      ) : null}
      {branch.data ? (
        <>
          <PageHeader
            title={branch.data.name}
            intro={`${branch.data.code} · ${branch.data.timezone}`}
          >
            <Badge tone={branch.data.isActive ? 'success' : 'neutral'}>
              {branch.data.isActive ? t.common.active : t.common.inactive}
            </Badge>
          </PageHeader>
          {!manage ? <Notice tone="info">{t.branches.readOnly}</Notice> : null}
          {manage ? <BranchDetails branch={branch.data} reload={branch.reload} /> : null}
          <BranchHours branch={branch.data} editable={manage} reload={branch.reload} />
          {manageStatus ? <BranchStatus branch={branch.data} reload={branch.reload} /> : null}
        </>
      ) : null}
    </>
  );
}

function BranchDetails({
  branch,
  reload,
}: {
  branch: BranchResponse;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [name, setName] = useState(branch.name);
  const [timezone, setTimezone] = useState(branch.timezone);
  const submit = useSubmit();
  useEffect(() => {
    setName(branch.name);
    setTimezone(branch.timezone);
  }, [branch.name, branch.timezone, branch.version]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const body: BranchUpdateRequest = {
      expectedVersion: branch.version,
      ...(name !== branch.name ? { name } : {}),
      ...(timezone !== branch.timezone ? { timezone } : {}),
    };
    const ok = await submit.run(
      () => runMutation(() => api.post(`/api/v1/branches/${branch.id}`, body), reload),
      t.common.saved,
    );
    if (ok) await reload();
  }

  return (
    <Section title={t.common.details}>
      <form className="wf-form" onSubmit={(event) => void save(event)}>
        <div className="wf-row">
          <Field id="bd-name" label={t.common.name} required>
            <input
              id="bd-name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            id="bd-timezone"
            label={t.branches.timezone}
            required
            hint={t.branches.timezoneLocked}
          >
            <input
              id="bd-timezone"
              required
              maxLength={64}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </Field>
        </div>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <SubmitButton
          pending={submit.pending}
          label={t.common.save}
          pendingLabel={t.common.saving}
          disabled={name === branch.name && timezone === branch.timezone}
        />
      </form>
    </Section>
  );
}

function BranchHours({
  branch,
  editable,
  reload,
}: {
  branch: BranchResponse;
  editable: boolean;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [days, setDays] = useState(() => editableHours(branch.hours));
  const submit = useSubmit();
  useEffect(() => setDays(editableHours(branch.hours)), [branch.hours, branch.version]);

  const update = (isoWeekday: number, patch: Partial<BranchOperatingDay>) =>
    setDays((current) =>
      current.map((day) => (day.isoWeekday === isoWeekday ? { ...day, ...patch } : day)),
    );

  async function save(event: FormEvent) {
    event.preventDefault();
    const body: BranchHoursUpdateRequest = {
      expectedVersion: branch.version,
      days: days.map((day) =>
        day.isClosed
          ? { isoWeekday: day.isoWeekday, isClosed: true, opensAt: null, closesAt: null }
          : day,
      ),
    };
    const ok = await submit.run(
      () => runMutation(() => api.post(`/api/v1/branches/${branch.id}/hours`, body), reload),
      t.common.saved,
    );
    if (ok) await reload();
  }

  return (
    <Section title={t.branches.hours}>
      {branch.hours.length === 0 ? <Notice tone="info">{t.branches.noHours}</Notice> : null}
      <form onSubmit={(event) => void save(event)}>
        <table className="wf-table">
          <thead>
            <tr>
              <th scope="col">{t.common.name}</th>
              <th scope="col">{t.branches.closed}</th>
              <th scope="col">{t.branches.opensAt}</th>
              <th scope="col">{t.branches.closesAt}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const label = t.branches.weekdays[day.isoWeekday] ?? String(day.isoWeekday);
              return (
                <tr key={day.isoWeekday}>
                  <th scope="row" data-label={t.common.name}>
                    {label}
                  </th>
                  <td data-label={t.branches.closed}>
                    <input
                      type="checkbox"
                      aria-label={`${label}: ${t.branches.closed}`}
                      checked={day.isClosed}
                      disabled={!editable}
                      onChange={(event) =>
                        update(day.isoWeekday, {
                          isClosed: event.target.checked,
                          opensAt: event.target.checked ? null : (day.opensAt ?? '09:00'),
                          closesAt: event.target.checked ? null : (day.closesAt ?? '21:00'),
                        })
                      }
                    />
                  </td>
                  <td data-label={t.branches.opensAt}>
                    <input
                      type="time"
                      aria-label={`${label}: ${t.branches.opensAt}`}
                      value={day.opensAt ?? ''}
                      disabled={!editable || day.isClosed}
                      required={!day.isClosed}
                      onChange={(event) => update(day.isoWeekday, { opensAt: event.target.value })}
                    />
                  </td>
                  <td data-label={t.branches.closesAt}>
                    <input
                      type="time"
                      aria-label={`${label}: ${t.branches.closesAt}`}
                      value={day.closesAt ?? ''}
                      disabled={!editable || day.isClosed}
                      required={!day.isClosed}
                      onChange={(event) => update(day.isoWeekday, { closesAt: event.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {editable ? (
          <>
            <FormFeedback error={submit.error} success={submit.success} t={t} />
            <SubmitButton
              pending={submit.pending}
              label={t.branches.saveHours}
              pendingLabel={t.common.saving}
            />
          </>
        ) : null}
      </form>
    </Section>
  );
}

function BranchStatus({ branch, reload }: { branch: BranchResponse; reload: () => Promise<void> }) {
  const { api, t } = useWorkforce();
  const [reason, setReason] = useState('');
  const submit = useSubmit();

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/branches/${branch.id}/status`, {
              expectedVersion: branch.version,
              isActive: !branch.isActive,
              reason,
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) {
      setReason('');
      await reload();
    }
  }

  return (
    <Section title={t.common.status}>
      <p className="wf-muted">{t.branches.statusNote}</p>
      <form className="wf-form" onSubmit={(event) => void save(event)}>
        <Field id="branch-status-reason" label={t.branches.statusReason} required>
          <input
            id="branch-status-reason"
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <SubmitButton
          pending={submit.pending}
          label={branch.isActive ? t.common.deactivate : t.common.activate}
          pendingLabel={t.common.saving}
          tone={branch.isActive ? 'danger' : 'primary'}
          disabled={reason.trim() === ''}
        />
      </form>
    </Section>
  );
}
