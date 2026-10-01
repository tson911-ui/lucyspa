'use client';

import type { BranchCreateRequest, BranchListResponse, BranchSummary } from '@lucy-spa/contracts';
import {
  DataTable,
  DEFAULT_PAGE_SIZE,
  Field,
  FormDialog,
  FormGrid,
  RowActions,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSubmit,
} from '../ui';

/**
 * Branch list: `DataTable` (client paging, 20 per page), the name is the link to the detail page and
 * the row `⋮` menu repeats it. Creating a branch (4 fields) is a dialog opened from the page header.
 */
export function BranchesScreen() {
  const { api, t, base, navigate } = useWorkforce();
  const { account } = useAccount();
  const list = useResource(() => api.get<BranchListResponse>('/api/v1/branches'), [api]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const manage = canGlobal(account, 'MANAGE_BRANCHES');

  const columns: DataTableColumn<BranchSummary>[] = [
    { key: 'code', header: t.common.code, cell: (branch) => branch.code },
    {
      key: 'name',
      header: t.common.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (branch) => (
        <Link className="ls-link" href={`${base}/branches/${branch.id}`} title={branch.name}>
          {branch.name}
        </Link>
      ),
    },
    {
      key: 'timezone',
      header: t.branches.timezone,
      hideBelow: 'md',
      cell: (branch) => branch.timezone,
    },
    {
      key: 'status',
      header: t.common.status,
      cell: (branch) => (
        <Badge tone={branch.isActive ? 'success' : 'neutral'}>
          {branch.isActive ? t.common.active : t.common.inactive}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (branch) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: branch.name })}
          items={[
            {
              id: 'details',
              label: t.common.details,
              icon: 'eye',
              onSelect: () => navigate?.(`${base}/branches/${branch.id}`),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t.branches.title}>
        {manage ? (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t.branches.create}
          </Button>
        ) : null}
      </PageHeader>
      {created ? <Notice tone="success">{t.branches.created}</Notice> : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: t.branches.title })}
        columns={columns}
        rows={list.data?.branches ?? []}
        rowKey={(branch) => branch.id}
        loading={list.loading}
        loadingLabel={t.common.loading}
        error={
          list.error ? (
            <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
          ) : undefined
        }
        empty={list.data ? <Empty>{t.common.empty}</Empty> : undefined}
        paging={{
          page,
          pageSize,
          onPageChange: setPage,
          onPageSizeChange: (size) => {
            setPageSize(size);
            setPage(1);
          },
          labels: paginationLabels(t, t.branches.title),
        }}
      />
      {creating ? (
        <CreateBranch
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await list.reload();
            setCreating(false);
            setCreated(true);
          }}
        />
      ) : null}
    </>
  );
}

/** Short form (4 fields): a dialog, mounted only while open so it resets on close. */
function CreateBranch({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState({
    code: '',
    name: '',
    timezone: 'Asia/Ho_Chi_Minh',
    reason: '',
  });
  const submit = useSubmit();

  async function save() {
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
    if (ok) await onCreated();
  }

  return (
    <FormDialog
      title={t.branches.create}
      labels={formOverlayLabels(t, t.common.create)}
      busy={submit.pending}
      dirty={form.code !== '' || form.name !== '' || form.reason !== ''}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <Field label={t.common.code} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.common.name} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.branches.timezone} required hint={t.branches.timezoneHint} full>
          {(control) => (
            <TextInput
              {...control}
              maxLength={64}
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.common.reasonOptional} full>
          {(control) => (
            <TextInput
              {...control}
              maxLength={500}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
