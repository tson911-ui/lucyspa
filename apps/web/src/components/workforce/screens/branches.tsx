'use client';

import type { BranchCreateRequest, BranchListResponse } from '@lucy-spa/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { canGlobal } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  FormFeedback,
  Loading,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';

export function BranchesScreen() {
  const { api, t, base } = useWorkforce();
  const { account } = useAccount();
  const list = useResource(() => api.get<BranchListResponse>('/api/v1/branches'), [api]);

  return (
    <>
      <PageHeader title={t.branches.title} />
      {canGlobal(account, 'MANAGE_BRANCHES') ? <CreateBranch onCreated={list.reload} /> : null}
      <Section title={t.branches.title}>
        {list.loading ? <Loading t={t} /> : null}
        {list.error ? (
          <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
        ) : null}
        {list.data && list.data.branches.length === 0 ? <Empty>{t.common.empty}</Empty> : null}
        {list.data && list.data.branches.length > 0 ? (
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">{t.common.code}</th>
                <th scope="col">{t.common.name}</th>
                <th scope="col">{t.branches.timezone}</th>
                <th scope="col">{t.common.status}</th>
                <th scope="col">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.branches.map((branch) => (
                <tr key={branch.id}>
                  <td data-label={t.common.code}>{branch.code}</td>
                  <td data-label={t.common.name}>{branch.name}</td>
                  <td data-label={t.branches.timezone}>{branch.timezone}</td>
                  <td data-label={t.common.status}>
                    <Badge tone={branch.isActive ? 'success' : 'neutral'}>
                      {branch.isActive ? t.common.active : t.common.inactive}
                    </Badge>
                  </td>
                  <td data-label={t.common.actions}>
                    <Link href={`${base}/branches/${branch.id}`}>{t.common.details}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
    </>
  );
}

function CreateBranch({ onCreated }: { onCreated: () => Promise<void> }) {
  const { api, t } = useWorkforce();
  const empty = { code: '', name: '', timezone: 'Asia/Ho_Chi_Minh', reason: '' };
  const [form, setForm] = useState(empty);
  const submit = useSubmit();

  async function save(event: FormEvent) {
    event.preventDefault();
    const body: BranchCreateRequest = {
      code: form.code,
      name: form.name,
      timezone: form.timezone,
      ...(form.reason.trim() ? { reason: form.reason } : {}),
    };
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/branches', body), onCreated),
      t.branches.created,
    );
    if (ok) {
      setForm(empty);
      await onCreated();
    }
  }

  return (
    <Section title={t.branches.create}>
      <details className="wf-disclosure">
        <summary>{t.branches.create}</summary>
        <form className="wf-form" onSubmit={(event) => void save(event)}>
          <div className="wf-row">
            <Field id="branch-code" label={t.common.code} required>
              <input
                id="branch-code"
                required
                maxLength={64}
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </Field>
            <Field id="branch-name" label={t.common.name} required>
              <input
                id="branch-name"
                required
                maxLength={200}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
          </div>
          <Field
            id="branch-timezone"
            label={t.branches.timezone}
            required
            hint={t.branches.timezoneHint}
          >
            <input
              id="branch-timezone"
              required
              maxLength={64}
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            />
          </Field>
          <Field id="branch-reason" label={t.common.reasonOptional}>
            <input
              id="branch-reason"
              maxLength={500}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          </Field>
          <FormFeedback error={submit.error} success={submit.success} t={t} />
          <SubmitButton
            pending={submit.pending}
            label={t.common.create}
            pendingLabel={t.common.saving}
          />
        </form>
      </details>
    </Section>
  );
}
