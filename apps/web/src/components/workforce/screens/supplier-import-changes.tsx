'use client';

import type {
  SourceChangeKind,
  SupplierChangeAcknowledgeResponse,
  SupplierChangeListResponse,
  SupplierChangeRow,
} from '@lucy-spa/contracts';
import {
  DataTable,
  FacetedFilter,
  ListToolbar,
  RowActions,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { supplierImportsDictionary } from '../../../i18n/supplier-imports';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  CHANGE_KIND_FILTERS,
  changeListQuery,
  changeSummary,
  changeTone,
  importErrorText,
  type ImportListState,
} from '../../../lib/workforce/supplier-imports';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';

const BASE = '/api/v1/supplier-imports';
const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * The "Thay đổi" tab (Phase 9 P9-7): what the scans saw differently at the source, newest first, 20 a page. A note changes nothing in
 * Lucy Spa; a reviewer reads it and marks it as seen (one row, or the whole page). The source price inside a price note is only
 * present when the server sent it (MANAGE_PRODUCT_PRICES).
 */
export function ChangesPanel({
  list,
  updateList,
}: {
  list: ImportListState;
  updateList: (patch: Partial<ImportListState>) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const text = supplierImportsDictionary(locale);
  const copy = text.changes;
  const notify = useSuccessToast();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const loaded = useResource(
    () => api.get<SupplierChangeListResponse>(`${BASE}/changes`, changeListQuery(list)),
    [api, list.seen, list.kind, list.page],
  );
  const data = loaded.data;
  const rows = data?.items ?? [];
  const active = (list.seen !== 'OPEN' ? 1 : 0) + (list.kind !== '' ? 1 : 0);
  const money = (vnd: number | null) => (vnd === null ? '—' : formatVnd(String(vnd), locale));

  async function acknowledge(ids: string[]) {
    if (working || ids.length === 0) return;
    setWorking(true);
    setError(null);
    try {
      const result = await api.post<SupplierChangeAcknowledgeResponse>(
        `${BASE}/changes/acknowledge`,
        {
          ids,
        },
      );
      notify(fill(copy.done, { count: String(result.acknowledged) }));
      await loaded.reload();
    } catch (failure) {
      setError(importErrorText(failure, locale, (cause) => errorMessage(cause, t)));
    } finally {
      setWorking(false);
    }
  }

  const columns: DataTableColumn<SupplierChangeRow>[] = [
    {
      key: 'product',
      header: copy.columns.product,
      mobileTitle: true,
      width: 'lg',
      cell: (row) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-truncate" title={row.productName}>
            {row.productName}
          </span>
          <span className="ls-cell-sub ls-cell-truncate">
            {text.columns.sku}: {row.productSku ?? text.none}
          </span>
        </span>
      ),
    },
    {
      key: 'kind',
      header: copy.columns.kind,
      cell: (row) => <Badge tone={changeTone(row.kind)}>{copy.kinds[row.kind]}</Badge>,
    },
    {
      key: 'detail',
      header: copy.columns.detail,
      wrap: true,
      width: 'lg',
      hideBelow: 'lg',
      cell: (row) => {
        const summary = changeSummary(row, locale, money);
        return (
          <span className="ls-cell-stack">
            <span>{summary.headline}</span>
            {summary.sub ? <span>{summary.sub}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'source',
      header: copy.columns.source,
      hideBelow: 'wide',
      truncate: true,
      width: 'md',
      cell: (row) => row.source.name,
    },
    {
      key: 'when',
      header: copy.columns.when,
      hideBelow: 'xl',
      cell: (row) => formatDateTime(row.detectedAt, ZONE, locale),
    },
    {
      key: 'state',
      header: copy.columns.state,
      cell: (row) =>
        row.acknowledgedAt ? (
          <Badge tone="neutral">{copy.seen}</Badge>
        ) : (
          <Badge tone="warning">{copy.open}</Badge>
        ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(copy.actionsFor, { name: row.productName })}
          items={[
            ...(row.acknowledgedAt
              ? []
              : [
                  {
                    id: 'seen',
                    label: copy.menu.markSeen,
                    icon: 'check' as const,
                    onSelect: () => void acknowledge([row.id]),
                  },
                ]),
            ...(row.candidate
              ? [
                  {
                    id: 'product',
                    label: copy.menu.openProduct,
                    icon: 'eye' as const,
                    onSelect: () =>
                      updateList({ tab: 'candidates', review: row.candidate?.id ?? '' }),
                  },
                ]
              : []),
            { id: 'source', label: copy.menu.openSource, href: row.productUrl },
          ]}
        />
      ),
    },
  ];

  const openOnPage = rows.filter((row) => !row.acknowledgedAt).map((row) => row.id);
  return (
    <>
      <p className="ls-hint">{copy.intro}</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, data.total)}
          onReset={() => updateList({ seen: 'OPEN', kind: '' })}
          reload={{ label: t.common.reload, onClick: () => void loaded.reload() }}
          filters={
            <>
              <FacetedFilter
                label={copy.filters.seen}
                clearLabel={t.common.list.clearChoice}
                options={(['OPEN', 'DONE'] as const).map((value) => ({
                  value,
                  label: copy.seenStates[value],
                }))}
                selected={[list.seen]}
                onChange={([value]) => updateList({ seen: value ?? 'OPEN' })}
              />
              <FacetedFilter
                label={copy.filters.kind}
                clearLabel={t.common.list.clearChoice}
                options={CHANGE_KIND_FILTERS.map((value: SourceChangeKind) => ({
                  value,
                  label: copy.kinds[value],
                }))}
                selected={list.kind ? [list.kind] : []}
                onChange={([value]) => updateList({ kind: value ?? '' })}
              />
            </>
          }
          actions={
            openOnPage.length > 0 ? (
              <Button
                variant="secondary"
                icon="check"
                disabled={working}
                onClick={() => void acknowledge(openOnPage)}
              >
                {copy.markPage}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: text.tabs.changes })}
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.id}:${row.acknowledgedAt ?? ''}`}
        loading={loaded.loading}
        loadingLabel={t.common.loading}
        error={
          loaded.error && !data ? (
            <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
          ) : undefined
        }
        empty={
          data ? (
            <Empty>
              {active > 0 ? copy.emptyFiltered : list.seen === 'DONE' ? copy.emptyDone : copy.empty}
            </Empty>
          ) : undefined
        }
        paging={{
          page: list.page,
          pageSize: data?.pageSize ?? 20,
          total: data?.total ?? 0,
          onPageChange: (page) => updateList({ page }),
          labels: paginationLabels(t, text.tabs.changes),
        }}
      />
    </>
  );
}
