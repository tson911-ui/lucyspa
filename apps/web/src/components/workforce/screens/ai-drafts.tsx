'use client';

import {
  AI_DRAFT_STATUSES,
  AI_RUN_LIMITS,
  type AiApproveAllPreview,
  type AiApproveAllResponse,
  type AiDraftList,
  type AiRunList,
  type AiDraftRow,
  type AiDraftStatus,
} from '@lucy-spa/contracts';
import {
  CheckField,
  ConfirmDialog,
  DataTable,
  FacetedFilter,
  ListSection,
  ListToolbar,
  RowActions,
  SelectionBar,
  VisuallyHidden,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
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
import { confirmError } from '../../../lib/workforce/form-labels';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { errorMessage } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import { useAccount, useWorkforce } from '../session';
import { RunsPanel, StartRunDialog } from './ai-runs';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';

const BASE = '/api/v1/ai/product-drafts';
const RUNS = '/api/v1/ai/product-runs';
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
  const { account } = useAccount();
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
  const runs = useResource(() => api.get<AiRunList>(RUNS), [api]);
  const notify = useSuccessToast();
  const [starting, setStarting] = useState(false);
  // The drafts ticked for approval (id -> the row version they were listed with), kept while the page or the filter changes.
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectFailure, setSelectFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const runData = runs.data;
  const singles = runData?.singleApplied ?? 0;
  const mayApprove = canGlobal(account, 'MANAGE_PRODUCTS');
  // Selecting many at once opens after three drafts were approved one by one (the Owner's rule); the server checks it again.
  const canSelect = runData !== null && singles >= 3 && mayApprove;
  const pending = data?.counts.byStatus.DRAFT_READY ?? 0;
  const reloadAll = async () => {
    await Promise.all([list.reload(), runs.reload()]);
  };
  const working =
    data !== null && data.counts.byStatus.QUEUED + data.counts.byStatus.GENERATING > 0;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void Promise.all([list.reload(), runs.reload()]), POLL_MS);
    return () => clearInterval(timer);
  }, [working, list, runs]);

  const pick = (row: AiDraftRow, on: boolean) =>
    setPicked((current) => {
      const next = new Map(current);
      if (on) next.set(row.id, row.rowVersion);
      else next.delete(row.id);
      return next;
    });

  async function selectAll() {
    setSelectingAll(true);
    setSelectFailure(null);
    try {
      const all = await api.get<AiApproveAllPreview>(`${BASE}/approve-all`);
      setPicked(new Map(all.items.map((item) => [item.id, item.rowVersion])));
    } catch {
      setSelectFailure(text.select.loadFailed);
    } finally {
      setSelectingAll(false);
    }
  }

  /** One confirm, sent in batches the server accepts (each batch is audited per product and once in all). */
  async function approveSelected() {
    const items = [...picked].map(([id, rowVersion]) => ({ id, rowVersion }));
    let applied = 0;
    let skipped = 0;
    setProgress({ done: 0, total: items.length });
    try {
      for (let from = 0; from < items.length; from += AI_RUN_LIMITS.approveBatchMax) {
        const batch = items.slice(from, from + AI_RUN_LIMITS.approveBatchMax);
        const result = await api.post<AiApproveAllResponse>(`${BASE}/approve-all`, {
          items: batch,
        });
        applied += result.applied;
        skipped += result.skipped.length;
        setProgress({ done: Math.min(from + batch.length, items.length), total: items.length });
      }
    } catch (error) {
      // What was approved stays approved; the rest is shown as it is now, with the reason.
      setSelectFailure(errorMessage(error, t));
    }
    setProgress(null);
    setConfirming(false);
    setPicked(new Map());
    notify(
      fill(text.select.done, { applied: String(applied) }) +
        (skipped > 0 ? fill(text.select.doneSkipped, { skipped: String(skipped) }) : ''),
    );
    await reloadAll();
  }

  const columns: DataTableColumn<AiDraftRow>[] = [
    ...(canSelect
      ? [
          {
            key: 'pick',
            header: text.select.column,
            select: true,
            cell: (row: AiDraftRow) =>
              row.status === 'DRAFT_READY' ? (
                <CheckField
                  label={
                    <VisuallyHidden>
                      {fill(text.select.pickRow, { name: row.productName })}
                    </VisuallyHidden>
                  }
                  checked={picked.has(row.id)}
                  onChange={(event) => pick(row, event.target.checked)}
                />
              ) : null,
          } satisfies DataTableColumn<AiDraftRow>,
        ]
      : []),
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
          row.warnings > 0 ? fill(text.notesCell.notes, { count: String(row.warnings) }) : null,
          row.autoFixes > 0 ? fill(text.notesCell.fixed, { count: String(row.autoFixes) }) : null,
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
    // A table with a selection column has no actions column (the product name opens the draft).
    ...(canSelect
      ? []
      : [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (row: AiDraftRow) => (
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
        ]),
  ];

  return (
    <>
      <PageHeader title={text.title} intro={text.intro}>
        <Button
          variant="primary"
          icon="sparkles"
          onClick={() => setStarting(true)}
          disabled={!runData}
        >
          {text.runs.start}
        </Button>
      </PageHeader>
      {runData ? <RunsPanel data={runData} onChanged={reloadAll} /> : null}
      <ListSection title={text.table}>
        {canSelect && picked.size > 0 ? (
          <SelectionBar
            label={text.select.actions}
            summary={fill(text.select.summary, { count: String(picked.size) })}
          >
            {picked.size < pending ? (
              <Button variant="ghost" disabled={selectingAll} onClick={() => void selectAll()}>
                {selectingAll
                  ? text.select.selectingAll
                  : fill(text.select.selectAll, { count: String(pending) })}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setPicked(new Map())}>
              {text.select.clear}
            </Button>
            <Button variant="primary" icon="check" onClick={() => setConfirming(true)}>
              {fill(text.select.approve, { count: String(picked.size) })}
            </Button>
          </SelectionBar>
        ) : (
          <ListToolbar
            labels={toolbarLabels(t)}
            activeFilters={state.status ? 1 : 0}
            onReset={() => update({ status: '' })}
            reload={{ label: t.common.reload, onClick: () => void list.reload() }}
            resultCount={data ? String(data.total) : undefined}
            {...(canSelect && pending > 0
              ? {
                  actions: (
                    <Button
                      variant="secondary"
                      icon="check"
                      disabled={selectingAll}
                      onClick={() => void selectAll()}
                    >
                      {selectingAll ? text.select.selectingAll : text.select.selectAllShort}
                    </Button>
                  ),
                }
              : {})}
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
        )}
        {selectFailure ? <Notice tone="error">{selectFailure}</Notice> : null}
        {runData && !canSelect && pending > 0 && mayApprove && singles < 3 ? (
          <Notice tone="info">{fill(text.select.needSingles, { done: String(singles) })}</Notice>
        ) : null}
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
      {starting && runData ? (
        <StartRunDialog
          data={runData}
          onClose={() => setStarting(false)}
          onStarted={async () => {
            setStarting(false);
            notify(text.runs.started);
            await reloadAll();
          }}
        />
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={fill(text.select.confirmTitle, { count: String(picked.size) })}
          description={
            progress
              ? fill(text.select.progress, {
                  done: String(progress.done),
                  total: String(progress.total),
                })
              : fill(text.select.confirmBody, { count: String(picked.size) })
          }
          facts={[{ label: text.select.confirmFacts.products, value: String(picked.size) }]}
          tone="warning"
          confirmLabel={fill(text.select.confirm, { count: String(picked.size) })}
          busyLabel={
            progress
              ? fill(text.select.progress, {
                  done: String(progress.done),
                  total: String(progress.total),
                })
              : t.common.saving
          }
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onConfirm={approveSelected}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
