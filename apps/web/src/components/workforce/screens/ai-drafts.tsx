'use client';

import {
  AI_DRAFT_STATUSES,
  AI_RUN_LIMITS,
  type AiApproveAllPreview,
  type AiApproveAllResponse,
  type AiApproveAllSkipReason,
  type AiDraftList,
  type AiRunList,
  type AiDraftRow,
  type AiDraftStatus,
} from '@lucy-spa/contracts';
import {
  CheckField,
  ConfirmDialog,
  DataTable,
  EmptyState,
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
  skipReasonsLine,
  statusTone,
} from '../../../lib/workforce/ai-drafts';
import { confirmError } from '../../../lib/workforce/form-labels';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { errorMessage } from '../../../lib/workforce/workflows';
import { opensInput } from '../../../lib/workforce/opens-input';
import { PrefetchLink as Link } from '../link';
import { useAccount, useWorkforce } from '../session';
import { RunsPanel, StartRunDialog } from './ai-runs';
import { metaLine } from './pos-format';
import { RouterMenuLink } from './products-links';
import { Badge, Button, ErrorState, Notice, PageHeader, useResource, useSuccessToast } from '../ui';

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
        <Notice tone="info">{text.noAccess}</Notice>
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
  const [selectNote, setSelectNote] = useState<string | null>(null);
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
  // The reload functions are stable (useCallback in useResource): the timer is set once while drafts are being written, not torn
  // down on every render (rbp ai-drafts.tsx:121-125, rerender-dependencies).
  const reloadList = list.reload;
  const reloadRuns = runs.reload;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void Promise.all([reloadList(), reloadRuns()]), POLL_MS);
    return () => clearInterval(timer);
  }, [working, reloadList, reloadRuns]);

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
    setSelectNote(null);
    try {
      const all = await api.get<AiApproveAllPreview>(`${BASE}/approve-all`);
      setPicked(new Map(all.items.map((item) => [item.id, item.rowVersion])));
      // What the server will not take, said up front (it decides again at the confirm).
      const left = skipReasonsLine(text.select, { STALE: all.changed, EMPTY_FIELD: all.blocked });
      if (left !== null) {
        setSelectNote(
          fill(text.select.notPicked, { count: String(all.changed + all.blocked), reasons: left }),
        );
      }
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
    const reasons: Partial<Record<AiApproveAllSkipReason, number>> = {};
    setProgress({ done: 0, total: items.length });
    try {
      for (let from = 0; from < items.length; from += AI_RUN_LIMITS.approveBatchMax) {
        const batch = items.slice(from, from + AI_RUN_LIMITS.approveBatchMax);
        const result = await api.post<AiApproveAllResponse>(`${BASE}/approve-all`, {
          items: batch,
        });
        applied += result.applied;
        skipped += result.skipped.length;
        for (const entry of result.skipped)
          reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1;
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
        (skipped > 0
          ? fill(text.select.doneSkipped, {
              skipped: String(skipped),
              reasons: skipReasonsLine(text.select, reasons) ?? '',
            })
          : ''),
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
      wrap: true,
      width: 'md',
      cell: (row) => (
        <Link className="ls-link" href={draftHref(base, row.id)}>
          {row.productName}
        </Link>
      ),
    },
    {
      key: 'code',
      header: text.columns.code,
      hideBelow: 'lg',
      cell: (row) => <span translate="no">{row.productCode}</span>,
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
      wrap: true,
      width: 'md',
      cell: (row) => {
        const reason =
          row.errorCode && (row.status === 'FAILED' || row.status === 'NEEDS_ATTENTION')
            ? text.errors[
                errorKey(row.errorCode, Object.keys(text.errors)) as keyof typeof text.errors
              ]
            : null;
        const line = metaLine(locale, [
          reason,
          row.warnings > 0 ? fill(text.notesCell.notes, { count: String(row.warnings) }) : null,
          row.autoFixes > 0 ? fill(text.notesCell.fixed, { count: String(row.autoFixes) }) : null,
          row.edited ? text.notesCell.edited : null,
        ]);
        return line === '' ? text.notesCell.none : line;
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
                LinkComponent={RouterMenuLink}
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
          {opensInput(text.runs.start)}
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
            {/* One filled button per view: the header's "Chạy viết lại" is the primary, so the bulk approve is the outline. */}
            <Button variant="secondary" icon="check" onClick={() => setConfirming(true)}>
              {fill(text.select.approve, { count: String(picked.size) })}
            </Button>
          </SelectionBar>
        ) : (
          <ListToolbar
            labels={toolbarLabels(t)}
            activeFilters={state.status ? 1 : 0}
            onReset={() => update({ status: '' })}
            reload={{ label: t.common.reload, onClick: () => void list.reload() }}
            resultCount={data ? resultsText(t, data.total) : undefined}
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
        {selectNote ? <Notice tone="info">{selectNote}</Notice> : null}
        {runData && !canSelect && pending > 0 && mayApprove && singles < 3 ? (
          <Notice tone="info">{fill(text.select.needSingles, { done: String(singles) })}</Notice>
        ) : null}
        <DataTable
          drillDown
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
              state.status ? (
                <EmptyState
                  icon="search"
                  title={text.emptyFilteredTitle}
                  action={
                    <Button variant="secondary" onClick={() => update({ status: '' })}>
                      {t.common.list.reset}
                    </Button>
                  }
                >
                  {text.emptyFiltered}
                </EmptyState>
              ) : (
                <EmptyState
                  icon="sparkles"
                  title={text.emptyTitle}
                  action={
                    runData ? (
                      <Button variant="secondary" icon="sparkles" onClick={() => setStarting(true)}>
                        {opensInput(text.runs.start)}
                      </Button>
                    ) : undefined
                  }
                >
                  {text.empty}
                </EmptyState>
              )
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
              : text.select.approving
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
