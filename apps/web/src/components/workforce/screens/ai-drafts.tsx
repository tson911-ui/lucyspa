'use client';

import {
  AI_DRAFT_STATUSES,
  type AiDraftList,
  type AiDraftRow,
  type AiDraftStatus,
} from '@lucy-spa/contracts';
import {
  DataTable,
  FacetedFilter,
  ListSection,
  ListToolbar,
  RowActions,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect } from 'react';
import { aiDraftsDictionary } from '../../../i18n/ai-drafts';
import { fill } from '../../../i18n/workforce';
import {
  AI_DRAFT_LIST_DEFAULTS,
  AI_DRAFT_PAGE_KEYS,
  draftHref,
  errorKey,
  normalizeAiDraftList,
  statusTone,
} from '../../../lib/workforce/ai-drafts';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { PrefetchLink as Link } from '../link';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, ErrorState, PageHeader, useResource } from '../ui';

const BASE = '/api/v1/ai/product-drafts';
const POLL_MS = 5000;
const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * "Viết lại nội dung" (Claude integration CI-R2): the drafts the AI wrote for product text, 20 per page, filtered by status. A draft
 * opens on its own page (old text beside the draft, editable). While drafts are still being written the list asks again every few
 * seconds. Authority: `USE_AI_CONTENT`, global; applying a draft needs `MANAGE_PRODUCTS` as well (checked by the server).
 */
export function AiDraftsScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = aiDraftsDictionary(locale);
  if (!canGlobal(account, 'USE_AI_CONTENT')) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  return <AiDraftsPage />;
}

function AiDraftsPage() {
  const { api, t, locale, base } = useWorkforce();
  const text = aiDraftsDictionary(locale);
  const [state, update] = useUrlState(AI_DRAFT_LIST_DEFAULTS, {
    normalize: normalizeAiDraftList,
    resetOnChange: AI_DRAFT_PAGE_KEYS,
  });
  const list = useResource(
    () =>
      api.get<AiDraftList>(BASE, {
        status: state.status || undefined,
        page: state.page,
      }),
    [api, state.status, state.page],
  );
  const data = list.data;
  const working =
    data !== null && data.counts.byStatus.QUEUED + data.counts.byStatus.GENERATING > 0;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void list.reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [working, list]);

  const columns: DataTableColumn<AiDraftRow>[] = [
    {
      key: 'product',
      header: text.columns.product,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => (
        <Link className="ls-link" href={draftHref(base, row.id)} title={row.productName}>
          {row.productName}
        </Link>
      ),
    },
    {
      key: 'code',
      header: text.columns.code,
      hideBelow: 'lg',
      cell: (row) => row.productCode,
    },
    {
      key: 'status',
      header: text.columns.status,
      cell: (row) => <Badge tone={statusTone(row.status)}>{text.statuses[row.status]}</Badge>,
    },
    {
      key: 'notes',
      header: text.columns.notes,
      hideBelow: 'md',
      truncate: true,
      width: 'md',
      cell: (row) => {
        const reason =
          row.errorCode && (row.status === 'FAILED' || row.status === 'NEEDS_ATTENTION')
            ? text.errors[
                errorKey(row.errorCode, Object.keys(text.errors)) as keyof typeof text.errors
              ]
            : null;
        const parts = [
          reason,
          row.blockingWarnings > 0
            ? fill(text.notesCell.blocking, { count: String(row.blockingWarnings) })
            : null,
          row.warnings - row.blockingWarnings > 0
            ? fill(text.notesCell.notes, { count: String(row.warnings - row.blockingWarnings) })
            : null,
          row.edited ? text.notesCell.edited : null,
        ].filter((part): part is string => part !== null);
        const line = parts.length === 0 ? text.notesCell.none : parts.join(' · ');
        return <span title={line}>{line}</span>;
      },
    },
    {
      key: 'updated',
      header: text.columns.updated,
      hideBelow: 'lg',
      cell: (row) => formatDateTime(row.updatedAt, ZONE, locale),
    },
    {
      key: 'cost',
      header: text.columns.cost,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => (row.costVnd === null ? '—' : formatVnd(row.costVnd, locale)),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.productName })}
          items={[
            {
              id: 'open',
              label: text.menu.open,
              icon: 'eye',
              href: draftHref(base, row.id),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={text.title} intro={text.intro} />
      <ListSection title={text.table}>
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={state.status ? 1 : 0}
          onReset={() => update({ status: '' })}
          reload={{ label: t.common.reload, onClick: () => void list.reload() }}
          resultCount={data ? String(data.total) : undefined}
          filters={
            <FacetedFilter
              label={text.filterStatus}
              clearLabel={t.common.list.clearChoice}
              options={AI_DRAFT_STATUSES.map((value: AiDraftStatus) => ({
                value,
                label: `${text.statuses[value]} (${data?.counts.byStatus[value] ?? 0})`,
              }))}
              selected={state.status ? [state.status] : []}
              onChange={([value]) => update({ status: value ?? '' })}
            />
          }
        />
        <DataTable
          mode="server"
          caption={fill(t.common.list.table, { list: text.table })}
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={list.loading && !data}
          loadingLabel={t.common.loading}
          error={
            list.error && !data ? (
              <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
            ) : undefined
          }
          empty={data ? <Empty>{state.status ? text.emptyFiltered : text.empty}</Empty> : undefined}
          paging={{
            page: state.page,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            onPageChange: (page) => update({ page }),
            labels: paginationLabels(t, text.table),
          }}
        />
      </ListSection>
    </>
  );
}
