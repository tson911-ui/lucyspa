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
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useId, useMemo } from 'react';
import { cashDictionary } from '../../../i18n/cash';
import { fill } from '../../../i18n/workforce';
import { signedVnd } from '../../../lib/workforce/cash';
import { todayIn } from '../../../lib/workforce/format';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, useResource } from '../ui';

// The reconciliation's branch and period in the address, like the rest of the cash page (wig :47). Module constant.
const RECONCILE_DEFAULTS: { rbranch: string; rfrom: string; rto: string } = {
  rbranch: '',
  rfrom: '',
  rto: '',
};

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Invoices against the book (Phase 7 P7-6, design 7.5): for a branch and a period, every kind of money source recorded since go-live
 * with the entries the book made from it. The two sides are equal by construction; the screen proves it and names what is missing.
 */
export function CashReconcile({
  branches,
  reloadToken,
  zone,
}: {
  branches: readonly CashBranchAccess[];
  reloadToken: number;
  /** The branch time zone of the page's fund (wig cash-reconcile.tsx:25). */
  zone: string;
}) {
  const { api, t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const r = c.reconcile;
  const viewable = branches.filter((entry) => entry.view || entry.manage);
  // Read once per zone (rbp :45).
  const today = useMemo(() => todayIn(zone), [zone]);
  const [view, setView] = useUrlState(RECONCILE_DEFAULTS);
  const branchId = viewable.some((entry) => entry.branch.id === view.rbranch)
    ? view.rbranch
    : (viewable[0]?.branch.id ?? '');
  const from = view.rfrom || addDays(today, -6);
  const to = view.rto || today;
  // A period that ends before it starts is said at the dates, not left as an empty table (wig :49).
  const backwards = from !== '' && to !== '' && from > to;
  const rangeId = useId();
  const ready = branchId !== '' && from !== '' && to !== '' && !backwards;
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
      wrap: true,
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
                onChange={(event) => setView({ rbranch: event.target.value })}
              />
            ) : null}
            {/* A backwards period marks both dates and points them at the sentence that says why (wig Forms: errors at the
                field). */}
            <DateTextInput
              aria-label={r.from}
              value={from}
              max={to}
              invalid={backwards}
              aria-describedby={backwards ? rangeId : undefined}
              onChange={(event) => setView({ rfrom: event.target.value })}
            />
            <DateTextInput
              aria-label={r.to}
              value={to}
              min={from}
              invalid={backwards}
              aria-describedby={backwards ? rangeId : undefined}
              onChange={(event) => setView({ rto: event.target.value })}
            />
          </>
        }
      />
      {backwards ? (
        <div id={rangeId}>
          <Notice tone="error">{c.problems.range}</Notice>
        </div>
      ) : null}
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
