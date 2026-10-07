'use client';

import type { ProductImportDetailResponse, ProductImportRowResponse } from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  CheckField,
  ConfirmDialog,
  DataTable,
  Dialog,
  DescriptionList,
  FacetedFilter,
  FormDialog,
  ListSection,
  ListToolbar,
  RowActions,
  SearchInput,
  Stack,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { importDictionary } from '../../../i18n/imports';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import {
  applyRequest,
  columnLabel,
  applySummary,
  filterImportRows,
  IMPORT_FILTERS,
  IMPORT_ROWS_DEFAULTS,
  IMPORT_ROWS_PAGE_KEYS,
  importErrorText,
  isImportConflict,
  normalizeImportRows,
  outcomeTone,
  rowNotes,
  rowOutcome,
  statusTone,
} from '../../../lib/workforce/imports';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { errorMessage } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Section,
  useResource,
  useSuccessToast,
} from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';

export function ImportScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const job = useResource(
    () => api.get<ProductImportDetailResponse>(`/api/v1/product-imports/${encodeURIComponent(id)}`),
    [api, id],
  );
  if (job.error && !job.data) {
    return <ErrorState error={job.error} t={t} onRetry={() => void job.reload()} />;
  }
  if (!job.data) return <Loading t={t} page />;
  return <ImportView job={job.data} reload={job.reload} />;
}

type Overlay = 'apply' | 'cancel' | null;

/**
 * One import. While it is PREVIEWED the page's one primary action is "Nhập vào hệ thống" (the confirmation) and the information
 * card has the menu with "Hủy lần nhập"; an applied or cancelled import is read-only history. Every row of the file is listed with
 * its result and its problems in words, so the person sees exactly what would happen before confirming.
 */
export function ImportView({
  job,
  reload,
}: {
  job: ProductImportDetailResponse;
  reload: () => Promise<void>;
}) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const text = importDictionary(locale);
  const d = text.detail;
  const notify = useSuccessToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const previewed = job.status === 'PREVIEWED';
  const summary = applySummary(job);
  const describeError = (error: unknown) => ({
    message: importErrorText(error, locale, (cause) => errorMessage(cause, t)),
    reference: error instanceof ApiError ? error.requestId : null,
  });

  return (
    <>
      <PageHeader
        title={job.filename}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: text.title, href: `${base}/import` }, { label: job.filename }]}
          />
        }
      >
        {previewed && job.canApply ? (
          <Button variant="primary" onClick={() => setOverlay('apply')}>
            {d.apply}
          </Button>
        ) : null}
      </PageHeader>
      <Stack gap="page">
        {job.status === 'APPLIED' ? (
          <Notice tone="success">
            {fill(d.applied, {
              time: job.appliedAt ? formatDateTime(job.appliedAt, ZONE, locale) : text.none,
            })}
          </Notice>
        ) : null}
        {job.status === 'CANCELLED' ? <Notice tone="info">{d.cancelled}</Notice> : null}
        {previewed && !job.canApply ? (
          <Notice tone="warning">{job.validCount === 0 ? d.allInvalid : d.nothing}</Notice>
        ) : null}
        <Section
          title={d.summary}
          actions={
            previewed ? (
              <RowActions
                menuLabel={d.moreActions}
                items={[
                  {
                    id: 'cancel',
                    label: d.cancel,
                    tone: 'danger',
                    onSelect: () => setOverlay('cancel'),
                  },
                ]}
              />
            ) : undefined
          }
        >
          <Stack gap="block">
            {job.warnings.length > 0 ? (
              <Notice tone="warning">
                <ul className="ls-list-plain">
                  {job.warnings.map((issue, index) => (
                    <li key={`${issue.code}:${index}`}>
                      {fill(text.issues[issue.code], issue.params ?? {})}
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <DescriptionList
              columns={2}
              items={[
                { label: d.fields.file, value: job.filename },
                { label: d.fields.kind, value: text.kinds[job.kind] },
                ...(job.branchName ? [{ label: d.fields.branch, value: job.branchName }] : []),
                {
                  label: d.fields.status,
                  value: <Badge tone={statusTone(job.status)}>{text.statuses[job.status]}</Badge>,
                },
                {
                  label: d.fields.createdBy,
                  value: `${job.createdByName} · ${formatDateTime(job.createdAt, ZONE, locale)}`,
                },
                ...(job.appliedAt
                  ? [
                      {
                        label: d.fields.appliedBy,
                        value: `${job.appliedByName ?? text.none} · ${formatDateTime(job.appliedAt, ZONE, locale)}`,
                      },
                    ]
                  : []),
                { label: d.stats.rows, value: job.rowCount },
                { label: d.stats.valid, value: job.validCount },
                { label: d.stats.invalid, value: job.invalidCount },
                ...(job.kind === 'CATALOG'
                  ? [
                      { label: d.stats.create, value: job.createCount },
                      { label: d.stats.update, value: job.updateCount },
                      { label: d.stats.unchanged, value: job.unchangedCount },
                    ]
                  : []),
              ]}
            />
          </Stack>
        </Section>
        <ImportRows job={job} />
      </Stack>
      {overlay === 'apply' ? (
        <ApplyDialog
          job={job}
          summary={summary}
          onClose={() => setOverlay(null)}
          onApplied={async () => {
            await reload();
            setOverlay(null);
            notify(d.applyDone);
          }}
          onConflict={reload}
        />
      ) : null}
      {overlay === 'cancel' ? (
        <ConfirmDialog
          title={d.cancelTitle}
          description={d.cancelBody}
          facts={[{ label: d.fields.file, value: job.filename }]}
          tone="warning"
          confirmLabel={d.cancel}
          busyLabel={text.working}
          cancelLabel={d.keep}
          referenceLabel={t.errors.reference}
          describeError={describeError}
          onCancel={() => setOverlay(null)}
          onConfirm={async () => {
            try {
              await api.post(`/api/v1/product-imports/${job.id}/cancel`, {
                expectedRowVersion: job.rowVersion,
              });
            } catch (error) {
              if (isImportConflict(error)) await reload();
              throw error;
            }
            await reload();
            setOverlay(null);
            notify(d.cancelDone);
            navigate?.(`${base}/import`);
          }}
        />
      ) : null}
    </>
  );
}

/** The confirmation: what enters, what is skipped, and (only when rows have errors) the explicit "skip them" tick. */
function ApplyDialog({
  job,
  summary,
  onClose,
  onApplied,
  onConflict,
}: {
  job: ProductImportDetailResponse;
  summary: ReturnType<typeof applySummary>;
  onClose: () => void;
  onApplied: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = importDictionary(locale);
  const d = text.detail;
  const [skip, setSkip] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const needsSkip = summary.skipped > 0;

  async function submit() {
    setChecked(true);
    if (pending || (needsSkip && !skip)) return;
    setPending(true);
    setFailure(null);
    try {
      await api.post(`/api/v1/product-imports/${job.id}/apply`, applyRequest(job, needsSkip));
      await onApplied();
    } catch (error) {
      if (isImportConflict(error)) await onConflict().catch(() => undefined);
      setFailure(importErrorText(error, locale, (cause) => errorMessage(cause, t)));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={fill(d.applyTitle, { count: summary.entering })}
      description={d.applyBody[job.kind]}
      labels={{ ...formOverlayLabels(t, d.applyConfirm), submitting: text.working }}
      busy={pending}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="block">
        <DescriptionList
          columns={1}
          items={[
            ...(job.kind === 'CATALOG'
              ? [
                  { label: d.applyFacts.create, value: summary.create },
                  { label: d.applyFacts.update, value: summary.update },
                ]
              : [{ label: d.stats.rows, value: summary.entering }]),
            ...(needsSkip ? [{ label: d.applyFacts.skipped, value: summary.skipped }] : []),
          ]}
        />
        {needsSkip ? (
          <CheckField
            label={fill(d.skipInvalid, { count: summary.skipped })}
            checked={skip}
            onChange={(event) => setSkip(event.target.checked)}
            {...(checked && !skip ? { error: d.skipRequired } : {})}
          />
        ) : null}
      </Stack>
    </FormDialog>
  );
}

/** Every row of the file: filter and search in the browser, 20 per page, the problems in words. */
function ImportRows({ job }: { job: ProductImportDetailResponse }) {
  const { t, locale } = useWorkforce();
  const text = importDictionary(locale);
  const d = text.detail;
  const [list, updateList] = useUrlState(IMPORT_ROWS_DEFAULTS, {
    normalize: normalizeImportRows,
    resetOnChange: IMPORT_ROWS_PAGE_KEYS,
  });
  const opening = job.kind === 'OPENING_STOCK';
  const [viewing, setViewing] = useState<ProductImportRowResponse | null>(null);
  const rows = filterImportRows(job.rows, list.filter, list.q);
  const active = (list.q ? 1 : 0) + (list.filter !== 'all' ? 1 : 0);

  const columns: DataTableColumn<ProductImportRowResponse>[] = [
    { key: 'row', header: d.columns.row, numeric: true, cell: (row) => row.rowNo },
    { key: 'sku', header: d.columns.sku, mobileTitle: true, cell: (row) => row.sku || text.none },
    {
      key: 'name',
      header: d.columns.name,
      truncate: true,
      width: 'md',
      hideBelow: 'md',
      cell: (row) => row.title ?? text.none,
    },
    ...(opening
      ? [
          {
            key: 'quantity',
            header: d.columns.quantity,
            numeric: true,
            cell: (row: ProductImportRowResponse) => row.cells['quantity'] || text.none,
          },
          {
            key: 'lot',
            header: d.columns.lot,
            hideBelow: 'lg' as const,
            cell: (row: ProductImportRowResponse) =>
              [row.cells['lot_code'], row.cells['expiry_date']].filter(Boolean).join(' · ') ||
              text.none,
          },
        ]
      : []),
    {
      key: 'result',
      header: d.columns.result,
      cell: (row) => {
        const outcome = rowOutcome(row);
        return <Badge tone={outcomeTone(outcome)}>{d.results[outcome]}</Badge>;
      },
    },
    {
      key: 'notes',
      header: d.columns.notes,
      wrap: true,
      width: 'lg',
      cell: (row) => {
        const notes = rowNotes(row, job.kind, locale).map((note) => note.text);
        const first = notes[0];
        if (first === undefined) return text.none;
        // The first note only; every note is in the row's details (the cell is two lines at most, so a row keeps one height).
        return notes.length > 1
          ? `${first} ${fill(d.moreNotes, { count: notes.length - 1 })}`
          : first;
      },
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.sku || String(row.rowNo) })}
          items={[
            { id: 'view', label: d.viewRow, icon: 'eye' as const, onSelect: () => setViewing(row) },
          ]}
        />
      ),
    },
  ];

  return (
    <ListSection title={d.rows}>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={active}
        resultCount={resultsText(t, rows.length)}
        onReset={() => updateList({ q: '', filter: 'all' })}
        search={
          <SearchInput
            id="import-q"
            value={list.q}
            label={d.search}
            placeholder={d.search}
            clearLabel={t.common.list.clearSearch}
            onSearch={(q) => updateList({ q }, { replace: true })}
          />
        }
        filters={
          <FacetedFilter
            label={d.filter}
            clearLabel={t.common.list.clearChoice}
            options={IMPORT_FILTERS.filter((value) => value !== 'all').map((value) => ({
              value,
              label: d.filters[value],
            }))}
            selected={list.filter === 'all' ? [] : [list.filter]}
            onChange={([value]) => updateList({ filter: value ?? 'all' })}
          />
        }
      />
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: d.rowsTable })}
        columns={columns}
        rows={rows}
        rowKey={(row) => String(row.rowNo)}
        empty={<Empty>{d.noMatch}</Empty>}
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, d.rowsTable),
        }}
      />
      {viewing ? (
        <RowDialog row={viewing} kind={job.kind} onClose={() => setViewing(null)} />
      ) : null}
    </ListSection>
  );
}

/** One row in full: its result, every note in words and the cells as the file had them. */
function RowDialog({
  row,
  kind,
  onClose,
}: {
  row: ProductImportRowResponse;
  kind: ProductImportDetailResponse['kind'];
  onClose: () => void;
}) {
  const { locale } = useWorkforce();
  const text = importDictionary(locale);
  const d = text.detail;
  const notes = rowNotes(row, kind, locale);
  const outcome = rowOutcome(row);
  const cells = Object.entries(row.cells).filter(([, value]) => value !== '');
  return (
    <Dialog
      title={fill(d.rowTitle, { row: row.rowNo })}
      closeLabel={d.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {d.close}
        </Button>
      }
    >
      <Stack gap="block">
        <DescriptionList
          columns={2}
          items={[
            { label: d.columns.sku, value: row.sku || text.none },
            { label: d.columns.name, value: row.title ?? text.none },
            {
              label: d.columns.result,
              value: <Badge tone={outcomeTone(outcome)}>{d.results[outcome]}</Badge>,
            },
          ]}
        />
        <DescriptionList
          columns={1}
          items={[
            ...(notes.length > 0
              ? [
                  {
                    label: d.rowNotes,
                    value: (
                      <ul className="ls-list-plain">
                        {notes.map((note, index) => (
                          <li key={index}>{note.text}</li>
                        ))}
                      </ul>
                    ),
                  },
                ]
              : []),
            ...(cells.length > 0
              ? [
                  {
                    label: d.rowData,
                    value: (
                      <DescriptionList
                        columns={2}
                        items={cells.map(([key, value]) => ({
                          label: columnLabel(kind, key, locale),
                          value,
                        }))}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Stack>
    </Dialog>
  );
}
