'use client';

import type { LoyaltyExceptionPageResponse, LoyaltyExceptionResponse } from '@lucy-spa/contracts';
import { DataTable, ListSection, RowActions, type DataTableColumn } from '@lucy-spa/ui';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { fill } from '../../../i18n/workforce';
import { formatDateTime } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { formatPoints } from '../../../lib/workforce/loyalty';
import { LOYALTY_PAGE_SIZE } from '../../../lib/workforce/loyalty-list';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import { Empty, ErrorState, useResource } from '../ui';

/**
 * The P5-Q5 shortfall list (OQ-3): every time a reversal or a deduction was larger than the balance, the balance
 * went to 0 and the missing points were recorded. Read-only and permission-gated (`VIEW_LOYALTY_EXCEPTIONS`,
 * organization-wide); nobody is notified (P5-Q9). Opening a row goes to that customer's points profile.
 */
export function LoyaltyExceptions({
  page,
  onPage,
}: {
  page: number;
  onPage: (page: number) => void;
}) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const l = loyaltyDictionary(locale);
  const x = l.exceptions;
  const list = useResource(
    () => api.get<LoyaltyExceptionPageResponse>('/api/v1/loyalty/exceptions', { page }),
    [api, page],
  );
  const rows = list.data?.items ?? [];
  const columns: DataTableColumn<LoyaltyExceptionResponse>[] = [
    {
      key: 'customer',
      header: l.columns.customer,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => (
        <Link className="ls-link" href={`${base}/loyalty/${row.customer.id}`}>
          {row.customer.displayName}
        </Link>
      ),
    },
    {
      key: 'phone',
      header: l.lookup.phone,
      hideBelow: 'lg',
      cell: (row) => row.customer.phoneMasked ?? '—',
    },
    { key: 'wallet', header: l.columns.wallet, cell: (row) => l.wallets[row.wallet] },
    { key: 'kind', header: l.columns.kind, hideBelow: 'md', cell: (row) => l.kinds[row.kind] },
    {
      key: 'source',
      header: l.columns.source,
      hideBelow: 'lg',
      cell: (row) => row.invoiceCode ?? '—',
    },
    {
      key: 'applied',
      header: l.columns.applied,
      numeric: true,
      cell: (row) => formatPoints(row.appliedPoints, locale),
    },
    {
      key: 'shortfall',
      header: l.columns.shortfall,
      numeric: true,
      cell: (row) => formatPoints(row.shortfallPoints, locale),
    },
    {
      key: 'when',
      header: l.columns.when,
      hideBelow: 'md',
      cell: (row) => formatDateTime(row.createdAt, 'Asia/Ho_Chi_Minh', locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.customer.displayName })}
          items={[
            {
              id: 'open',
              label: x.open,
              icon: 'eye',
              onSelect: () => navigate?.(`${base}/loyalty/${row.customer.id}`),
            },
          ]}
        />
      ),
    },
  ];
  return (
    <ListSection title={x.title} count={list.data?.total}>
      <p className="ls-hint">{x.intro}</p>
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: x.title })}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.entryId}
        loading={list.loading && !list.data}
        loadingLabel={t.common.loading}
        error={
          list.error ? (
            <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
          ) : undefined
        }
        empty={list.data ? <Empty>{x.none}</Empty> : undefined}
        paging={{
          page,
          pageSize: LOYALTY_PAGE_SIZE,
          total: list.data?.total ?? rows.length,
          onPageChange: onPage,
          labels: paginationLabels(t, x.title),
        }}
      />
    </ListSection>
  );
}
