'use client';

import type {
  CashBranchAccess,
  CashReconciliationResponse,
  CashReconciliationRow,
} from '@lucy-spa/contracts';
import {
  DataTable,
  DateTextInput,
  ListSection,
  ListToolbar,
  Select,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { cashDictionary } from '../../../i18n/cash';
import { fill } from '../../../i18n/workforce';
import { signedVnd } from '../../../lib/workforce/cash';
import { todayIn } from '../../../lib/workforce/format';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, useResource } from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Invoices against the book (Phase 7 P7-6, design 7.5): for a branch and a period, every kind of money source recorded since go-live
 * with the entries the book made from it. The two sides are equal by construction; the screen proves it and names what is missing.
 */
export function CashReconcile({
  branches,
  reloadToken,
}: {
  branches: readonly CashBranchAccess[];
  reloadToken: number;
}) {
  const { api, t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const r = c.reconcile;
  const viewable = branches.filter((entry) => entry.view || entry.manage);
  const today = todayIn(ZONE);
  const [branchId, setBranchId] = useState(viewable[0]?.branch.id ?? '');
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const ready = branchId !== '' && from !== '' && to !== '' && from <= to;
  const result = useResource(
    () =>
      ready
        ? api.get<CashReconciliationResponse>('/api/v1/cash/reconciliation', {
            branchId,
            from,
            to,
          })
        : Promise.resolve(null),
    [api, branchId, from, to, ready, reloadToken],
  );
  const data = result.data;
  const columns: DataTableColumn<CashReconciliationRow>[] = [
    {
      key: 'source',
      header: r.columns.source,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => r.sources[row.key],
    },
    {
      key: 'sourceCount',
      header: r.columns.sourceCount,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => String(row.sourceCount),
    },
    {
      key: 'sourceAmount',
      header: r.columns.sourceAmount,
      numeric: true,
      cell: (row) => signedVnd(row.sourceVnd, locale),
    },
    {
      key: 'bookCount',
      header: r.columns.bookCount,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => String(row.bookCount),
    },
    {
      key: 'bookAmount',
      header: r.columns.bookAmount,
      numeric: true,
      cell: (row) => signedVnd(row.bookVnd, locale),
    },
    {
      key: 'delta',
      header: r.columns.delta,
      numeric: true,
      cell: (row) =>
        row.deltaVnd === '0' ? (
          '—'
        ) : (
          <Badge tone="warning">{signedVnd(row.deltaVnd, locale)}</Badge>
        ),
    },
    {
      key: 'unposted',
      header: r.columns.unposted,
      numeric: true,
      hideBelow: 'md',
      cell: (row) =>
        row.unposted === 0 ? '—' : <Badge tone="warning">{String(row.unposted)}</Badge>,
    },
  ];
  return (
    <ListSection title={r.title}>
      <p className="ls-hint">{r.intro}</p>
      <ListToolbar
        labels={toolbarLabels(t)}
        reload={{ label: t.common.reload, onClick: () => void result.reload() }}
        filters={
          <>
            {viewable.length > 1 ? (
              <Select
                aria-label={r.branch}
                value={branchId}
                options={viewable.map((entry) => ({
                  value: entry.branch.id,
                  label: entry.branch.name,
                }))}
                onChange={(event) => setBranchId(event.target.value)}
              />
            ) : null}
            <DateTextInput
              aria-label={r.from}
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
            <DateTextInput
              aria-label={r.to}
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </>
        }
      />
      {data ? (
        <Notice tone={data.balanced ? 'success' : 'warning'}>
          {data.balanced ? r.balanced : fill(r.unbalanced, { n: data.unposted })}
        </Notice>
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: r.title })}
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(row) => row.key}
        loading={result.loading && !result.data}
        loadingLabel={t.common.loading}
        error={
          result.error ? (
            <ErrorState error={result.error} t={t} onRetry={() => void result.reload()} />
          ) : undefined
        }
        empty={data ? <Empty>{r.none}</Empty> : undefined}
        paging={{ off: 'seven fixed rows, one per kind of money source' }}
      />
    </ListSection>
  );
}
