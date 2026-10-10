'use client';

import type {
  SupplierApproveReadyResponse,
  SupplierCandidateDecideResponse,
  SupplierCandidateListResponse,
  SupplierCandidateRow,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  FacetedFilter,
  ListToolbar,
  MediaThumb,
  RowActions,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { supplierImportsDictionary } from '../../../i18n/supplier-imports';
import { fill } from '../../../i18n/workforce';
import { confirmError } from '../../../lib/workforce/form-labels';
import { formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import {
  IMPORT_FILTERS,
  IMPORT_LIST_DEFAULTS,
  IMPORT_PAGE_KEYS,
  IMPORT_WARNING_FILTERS,
  importErrorText,
  importListQuery,
  isImportConflict,
  isOpen,
  normalizeImportList,
  pictureUrl,
  sortWarnings,
  stateTone,
  warningText,
} from '../../../lib/workforce/supplier-imports';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
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
import { ReviewDrawer } from './supplier-import-review';
import { useUrlState } from '@lucy-spa/ui';

const BASE = '/api/v1/supplier-imports';
const SHOWN_WARNINGS = 1;

type Overlay =
  | { kind: 'reject' | 'ignore'; row: SupplierCandidateRow }
  | { kind: 'bulk'; rows: SupplierCandidateRow[]; total: number }
  | null;

/**
 * "Duyệt sản phẩm nhập" (Phase 9 P9-6): what the scans found, to be looked at before anything becomes a product. REVIEW_SUPPLIER_IMPORTS
 * (GLOBAL) opens it. The list is the server's page (20 a page) with a state filter and a warning filter in the address bar; one
 * candidate is reviewed in a drawer; "approve ready" acts only on candidates without any warning, after a preview of how many. Supplier
 * prices appear only when the server sent them (MANAGE_PRODUCT_PRICES).
 */
export function SupplierImportsScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = supplierImportsDictionary(locale);
  if (!canGlobal(account, 'REVIEW_SUPPLIER_IMPORTS')) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  return <ImportsPage />;
}

function ImportsPage() {
  const { api, t, locale } = useWorkforce();
  const text = supplierImportsDictionary(locale);
  const notify = useSuccessToast();
  const [list, updateList] = useUrlState(IMPORT_LIST_DEFAULTS, {
    normalize: normalizeImportList,
    resetOnChange: IMPORT_PAGE_KEYS,
  });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const loaded = useResource(
    () => api.get<SupplierCandidateListResponse>(`${BASE}/candidates`, importListQuery(list)),
    [api, list.filter, list.warning, list.page],
  );
  const data = loaded.data;
  const rows = data?.items ?? [];
  const active = (list.filter !== 'OPEN' ? 1 : 0) + (list.warning !== '' ? 1 : 0);
  const prices = data?.canSeePrices ?? false;

  const columns: DataTableColumn<SupplierCandidateRow>[] = [
    {
      key: 'image',
      header: text.columns.image,
      leading: true,
      cell: (row) => (
        <MediaThumb src={row.thumbImageId ? pictureUrl(row.id, row.thumbImageId, 'thumb') : null} />
      ),
    },
    {
      key: 'name',
      header: text.columns.name,
      mobileTitle: true,
      width: 'lg',
      cell: (row) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-truncate">
            <a
              className="ls-link"
              href={`?review=${row.id}`}
              title={row.nameVi}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                updateList({ review: row.id });
              }}
            >
              {row.nameVi}
            </a>
          </span>
          <span
            className="ls-cell-sub ls-cell-truncate"
            title={`${text.columns.sku}: ${row.sku ?? text.none}`}
          >
            {text.columns.sku}: {row.sku ?? text.none}
          </span>
        </span>
      ),
    },
    {
      key: 'brand',
      header: text.columns.brand,
      hideBelow: 'xl',
      truncate: true,
      width: 'md',
      cell: (row) => row.brand?.name ?? text.none,
    },
    {
      key: 'category',
      header: text.columns.category,
      hideBelow: 'wide',
      truncate: true,
      width: 'md',
      cell: (row) => row.category?.name ?? text.none,
    },
    {
      key: 'issues',
      header: text.columns.issues,
      hideBelow: 'lg',
      cell: (row) =>
        row.warnings.length === 0 ? (
          text.none
        ) : (
          <span className="ls-media-badges">
            {sortWarnings(row.warnings)
              .slice(0, SHOWN_WARNINGS)
              .map((code) => (
                <Badge key={code} tone="warning">
                  {warningText(code, locale)}
                </Badge>
              ))}
            {row.warnings.length > SHOWN_WARNINGS ? (
              <Badge tone="neutral">+{row.warnings.length - SHOWN_WARNINGS}</Badge>
            ) : null}
          </span>
        ),
    },
    ...(prices
      ? [
          {
            key: 'price',
            header: text.columns.price,
            numeric: true,
            hideBelow: 'wide' as const,
            cell: (row: SupplierCandidateRow) =>
              row.sourcePriceVnd === null || row.sourcePriceVnd === undefined
                ? text.none
                : formatVnd(String(row.sourcePriceVnd), locale),
          },
        ]
      : []),
    {
      key: 'state',
      header: text.columns.state,
      cell: (row) => <Badge tone={stateTone(row.state)}>{text.states[row.state]}</Badge>,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(text.actionsFor, { name: row.nameVi })}
          items={[
            {
              id: 'open',
              label: text.menu.open,
              icon: 'eye',
              onSelect: () => updateList({ review: row.id }),
            },
            ...(isOpen(row.state)
              ? [
                  {
                    id: 'ignore',
                    label: text.menu.ignore,
                    onSelect: () => setOverlay({ kind: 'ignore', row }),
                  },
                  {
                    id: 'reject',
                    label: text.menu.reject,
                    tone: 'danger' as const,
                    onSelect: () => setOverlay({ kind: 'reject', row }),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  /** Reads the first 20 ready candidates, then asks before approving them (the preview states the count). */
  async function startBulk() {
    if (reading) return;
    setReading(true);
    setNotice(null);
    try {
      const ready = await api.get<SupplierCandidateListResponse>(`${BASE}/candidates`, {
        state: 'READY_FOR_REVIEW',
        page: 1,
      });
      if (ready.items.length === 0) setNotice(text.bulk.none);
      else setOverlay({ kind: 'bulk', rows: ready.items, total: ready.readyCount });
    } catch (failure) {
      setNotice(importErrorText(failure, locale, (cause) => errorMessage(cause, t)));
    } finally {
      setReading(false);
    }
  }

  const describeError = (failure: unknown) => ({
    ...confirmError(t)(failure),
    message: importErrorText(failure, locale, (cause) => errorMessage(cause, t)),
  });

  const decideDialog = (kind: 'reject' | 'ignore', row: SupplierCandidateRow) => {
    const copy = text.dialogs[kind];
    return (
      <ConfirmDialog
        title={copy.title}
        description={fill(copy.body, { name: row.nameVi })}
        tone={kind === 'reject' ? 'danger' : 'neutral'}
        confirmLabel={copy.confirm}
        busyLabel={text.dialogs.busy}
        cancelLabel={text.dialogs.keep}
        referenceLabel={t.errors.reference}
        reasonField={{
          label: text.dialogs.note,
          required: false,
          requiredLabel: t.common.required,
          requiredMessage: t.common.form.reasonRequired,
        }}
        describeError={describeError}
        onCancel={() => setOverlay(null)}
        onConfirm={async (note) => {
          try {
            await api.post<SupplierCandidateDecideResponse>(
              `${BASE}/candidates/${row.id}/${kind}`,
              {
                expectedVersion: row.rowVersion,
                ...(note && note.trim() !== '' ? { note: note.trim() } : {}),
              },
            );
          } catch (failure) {
            if (isImportConflict(failure)) await loaded.reload();
            throw failure;
          }
          setOverlay(null);
          notify(copy.done);
          await loaded.reload();
        }}
      />
    );
  };

  return (
    <>
      <PageHeader title={text.title} intro={text.intro}>
        {(data?.readyCount ?? 0) > 0 ? (
          <Button
            variant="primary"
            icon="check"
            onClick={() => void startBulk()}
            disabled={reading}
          >
            {reading ? text.bulk.reading : text.approveReady}
          </Button>
        ) : null}
      </PageHeader>
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      {data ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, data.total)}
          onReset={() => updateList({ filter: 'OPEN', warning: '' })}
          reload={{ label: t.common.reload, onClick: () => void loaded.reload() }}
          filters={
            <>
              <FacetedFilter
                label={text.filters.state}
                clearLabel={t.common.list.clearChoice}
                options={IMPORT_FILTERS.map((value) => ({
                  value,
                  label: text.filterStates[value],
                }))}
                selected={[list.filter]}
                onChange={([value]) => updateList({ filter: value ?? 'OPEN' })}
              />
              <FacetedFilter
                label={text.filters.warning}
                clearLabel={t.common.list.clearChoice}
                options={IMPORT_WARNING_FILTERS.map((value) => ({
                  value,
                  label: warningText(value, locale),
                }))}
                selected={list.warning ? [list.warning] : []}
                onChange={([value]) => updateList({ warning: value ?? '' })}
              />
            </>
          }
        />
      ) : null}
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: text.title })}
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.id}:${row.rowVersion}`}
        loading={loaded.loading}
        loadingLabel={t.common.loading}
        error={
          loaded.error && !data ? (
            <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
          ) : undefined
        }
        empty={data ? <Empty>{active > 0 ? text.emptyFiltered : text.empty}</Empty> : undefined}
        paging={{
          page: list.page,
          pageSize: data?.pageSize ?? 20,
          total: data?.total ?? 0,
          onPageChange: (page) => updateList({ page }),
          labels: paginationLabels(t, text.title),
        }}
      />
      {list.review !== '' ? (
        <ReviewDrawer
          id={list.review}
          onClose={() => updateList({ review: '' })}
          onChanged={() => void loaded.reload()}
        />
      ) : null}
      {overlay?.kind === 'reject' ? decideDialog('reject', overlay.row) : null}
      {overlay?.kind === 'ignore' ? decideDialog('ignore', overlay.row) : null}
      {overlay?.kind === 'bulk' ? (
        <ConfirmDialog
          title={text.bulk.title}
          description={fill(text.bulk.body, { count: String(overlay.rows.length) })}
          tone="neutral"
          confirmLabel={fill(text.bulk.confirm, { count: String(overlay.rows.length) })}
          busyLabel={text.dialogs.busy}
          cancelLabel={text.dialogs.keep}
          referenceLabel={t.errors.reference}
          describeError={describeError}
          onCancel={() => setOverlay(null)}
          onConfirm={async () => {
            const result = await api.post<SupplierApproveReadyResponse>(`${BASE}/approve-ready`, {
              candidates: overlay.rows.map((row) => ({
                id: row.id,
                expectedVersion: row.rowVersion,
              })),
            });
            setOverlay(null);
            notify(
              `${fill(text.bulk.done, { approved: String(result.approved) })}${
                result.skipped.length > 0
                  ? ` ${fill(text.bulk.skipped, { skipped: String(result.skipped.length) })}`
                  : ''
              }`,
            );
            await loaded.reload();
          }}
        />
      ) : null}
    </>
  );
}
