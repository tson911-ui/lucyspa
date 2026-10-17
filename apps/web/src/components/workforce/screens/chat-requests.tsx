'use client';

import {
  CHAT_REQUEST_STATUSES,
  type ChatRequestList,
  type ChatRequestRow,
  type ChatRequestStatus,
} from '@lucy-spa/contracts';
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FacetedFilter,
  ListToolbar,
  RowActions,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { chatRequestsDictionary } from '../../../i18n/chat-requests';
import { fill } from '../../../i18n/workforce';
import {
  CHAT_REQUEST_LIST_DEFAULTS,
  CHAT_REQUEST_PAGE_KEYS,
  displayPhone,
  nextStatuses,
  normalizeChatRequestList,
  statusTone,
  telHref,
} from '../../../lib/workforce/chat-requests';
import { formatDateTime } from '../../../lib/workforce/format';
import { confirmError } from '../../../lib/workforce/form-labels';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, PageHeader, useResource, useSuccessToast } from '../ui';

const BASE = '/api/v1/chat-requests';
const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * "Yêu cầu gọi lại" (Claude integration Wave B): the callback requests visitors left in the website chat, 20 per page, newest first.
 * The staff call the visitor and mark the request called, then closed; a request only moves forward. Authority:
 * `MANAGE_CHAT_REQUESTS`, global (the server decides). Nothing here sends anything to the visitor.
 */
export function ChatRequestsScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = chatRequestsDictionary(locale);
  if (!canGlobal(account, 'MANAGE_CHAT_REQUESTS')) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty title={text.noAccessTitle}>{text.noAccess}</Empty>
      </>
    );
  }
  return <ChatRequestsPage />;
}

/** Stable options for the list's address-bar state (status filter and page). */
const CHAT_REQUEST_LIST_OPTIONS = {
  normalize: normalizeChatRequestList,
  resetOnChange: CHAT_REQUEST_PAGE_KEYS,
};

function ChatRequestsPage() {
  const { api, t, locale } = useWorkforce();
  const text = chatRequestsDictionary(locale);
  const [state, update] = useUrlState(CHAT_REQUEST_LIST_DEFAULTS, CHAT_REQUEST_LIST_OPTIONS);
  const list = useResource(
    () => api.get<ChatRequestList>(BASE, { status: state.status || undefined, page: state.page }),
    [api, state.status, state.page],
  );
  const data = list.data;
  const notify = useSuccessToast();
  const [failure, setFailure] = useState<string | null>(null);
  const [closing, setClosing] = useState<ChatRequestRow | null>(null);

  async function move(row: ChatRequestRow, status: 'CALLED' | 'CLOSED') {
    setFailure(null);
    try {
      await api.post(`${BASE}/${row.id}/status`, { expectedRowVersion: row.rowVersion, status });
      notify(status === 'CALLED' ? text.calledToast : text.closedToast);
    } catch (error) {
      setFailure(`${text.failed} (${errorMessage(error, t)})`);
    }
    await list.reload().catch(() => undefined);
  }

  const columns: DataTableColumn<ChatRequestRow>[] = [
    {
      key: 'customer',
      header: text.columns.customer,
      mobileTitle: true,
      wrap: true,
      width: 'md',
      cell: (row) => row.name ?? text.noName,
    },
    {
      key: 'phone',
      header: text.columns.phone,
      cell: (row) =>
        row.phone === null ? (
          <span>{text.purged}</span>
        ) : (
          <a className="ls-link" href={telHref(row.phone)}>
            {displayPhone(row.phone)}
          </a>
        ),
    },
    {
      key: 'status',
      header: text.columns.status,
      cell: (row) => <Badge tone={statusTone(row.status)}>{text.statuses[row.status]}</Badge>,
    },
    {
      key: 'note',
      header: text.columns.note,
      hideBelow: 'md',
      wrap: true,
      width: 'md',
      cell: (row) => row.note ?? text.noName,
    },
    {
      key: 'branch',
      header: text.columns.branch,
      hideBelow: 'lg',
      cell: (row) => row.preferredBranchName ?? text.noName,
    },
    {
      key: 'reason',
      header: text.columns.reason,
      hideBelow: 'lg',
      cell: (row) => text.reasons[row.reason],
    },
    {
      key: 'created',
      header: text.columns.created,
      cell: (row) => formatDateTime(row.createdAt, ZONE, locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => {
        const moves = nextStatuses(row.status);
        if (moves.length === 0) return null;
        return (
          <RowActions
            menuLabel={fill(text.menuLabel, { name: row.name ?? row.phone ?? '' })}
            items={moves.map((status) => ({
              id: status,
              label: status === 'CALLED' ? text.menu.called : text.menu.closed,
              icon: status === 'CALLED' ? 'phone' : 'check',
              // Closing only moves forward and starts the 90-day purge: it is confirmed first (wig chat-requests.tsx:151).
              onSelect: () => (status === 'CLOSED' ? setClosing(row) : void move(row, status)),
            }))}
          />
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title={text.title} intro={text.intro} />
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      {/* The page's one list: no "Danh sách yêu cầu" h2 (the table caption keeps the name); no bare number in the toolbar. */}
      <div className="ls-self-list">
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={state.status ? 1 : 0}
          onReset={() => update({ status: '' })}
          reload={{ label: t.common.reload, onClick: () => void list.reload() }}
          resultCount={data && data.total > 0 ? resultsText(t, data.total) : undefined}
          filters={
            <FacetedFilter
              label={text.filterStatus}
              clearLabel={t.common.list.clearChoice}
              options={CHAT_REQUEST_STATUSES.map((value: ChatRequestStatus) => ({
                value,
                // No count in a filter label (Owner count rule); the table's line carries the total.
                label: text.statuses[value],
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
          empty={
            data ? (
              <EmptyState
                icon="phone"
                title={state.status ? text.emptyFilteredTitle : text.emptyTitle}
                action={
                  state.status ? (
                    <Button variant="secondary" onClick={() => update({ status: '' })}>
                      {text.showAll}
                    </Button>
                  ) : undefined
                }
              >
                {state.status ? text.emptyFiltered : text.empty}
              </EmptyState>
            ) : undefined
          }
          paging={{
            page: state.page,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            onPageChange: (page) => update({ page }),
            labels: paginationLabels(t, text.table),
          }}
        />
      </div>
      {closing ? (
        <ConfirmDialog
          title={text.closeTitle}
          description={text.closeBody}
          tone="warning"
          confirmLabel={text.menu.closed}
          cancelLabel={text.closeKeep}
          describeError={confirmError(t)}
          onCancel={() => setClosing(null)}
          onConfirm={async () => {
            await api.post(`${BASE}/${closing.id}/status`, {
              expectedRowVersion: closing.rowVersion,
              status: 'CLOSED',
            });
            setClosing(null);
            notify(text.closedToast);
            await list.reload().catch(() => undefined);
          }}
        />
      ) : null}
    </>
  );
}
