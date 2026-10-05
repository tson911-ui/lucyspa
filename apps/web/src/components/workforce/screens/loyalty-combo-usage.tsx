'use client';

import type {
  ComboFrozenListResponse,
  ComboUsageItemResponse,
  ComboUsagePageResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  ListSection,
  RowActions,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import { fill } from '../../../i18n/workforce';
import {
  comboErrorText,
  comboName,
  usageSessionText,
  usedByLabel,
} from '../../../lib/workforce/combo';
import { confirmError } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { LOYALTY_PAGE_SIZE } from '../../../lib/workforce/loyalty-list';
import { posErrorMessage } from '../../../lib/workforce/pos';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { useReauthentication } from '../reauth-dialog';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, useResource, useSuccessToast } from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * The combo usage history (Phase 5 P5-8; PRD 17.4-17.5): who used which session of whose combo, when, which technician, owner
 * or relative, who recorded it. Append-only: this screen never edits or deletes. A manager who holds `RESTORE_COMBO_SESSIONS`
 * can restore a use made by mistake: a reason and their own password, one offset entry; the use stays listed as "Restored".
 */
export function LoyaltyComboUsage({
  page,
  onPage,
}: {
  page: number;
  onPage: (page: number) => void;
}) {
  const { api, t, locale, base } = useWorkforce();
  const c = comboDictionary(locale);
  const x = c.usage;
  const notify = useSuccessToast();
  const { confirm, dialog } = useReauthentication();
  const list = useResource(
    () => api.get<ComboUsagePageResponse>('/api/v1/combos/usage', { page }),
    [api, page],
  );
  const [restoring, setRestoring] = useState<ComboUsageItemResponse | null>(null);
  const rows = list.data?.items ?? [];
  const canRestore = list.data?.canRestore ?? false;

  const columns: DataTableColumn<ComboUsageItemResponse>[] = [
    {
      key: 'when',
      header: x.columns.when,
      mobileTitle: true,
      width: 'md',
      cell: (row) => formatDateTime(row.usedAt, ZONE, locale),
    },
    {
      key: 'owner',
      header: x.columns.owner,
      truncate: true,
      cell: (row) => (
        <Link className="ls-link" href={`${base}/loyalty/${row.owner.id}`}>
          {row.owner.displayName}
        </Link>
      ),
    },
    {
      key: 'combo',
      header: x.columns.combo,
      hideBelow: 'xl',
      truncate: true,
      cell: (row) => comboName({ nameVi: row.comboNameVi, nameEn: row.comboNameEn }, locale),
    },
    {
      key: 'session',
      header: x.columns.session,
      hideBelow: 'md',
      cell: (row) => usageSessionText(row, locale),
    },
    {
      key: 'who',
      header: x.columns.who,
      cell: (row) =>
        row.relationshipNote
          ? `${usedByLabel(row.usedBy, locale)} (${row.relationshipNote})`
          : usedByLabel(row.usedBy, locale),
    },
    {
      key: 'technician',
      header: x.columns.technician,
      hideBelow: 'xl',
      truncate: true,
      cell: (row) => row.technicianName ?? '—',
    },
    {
      key: 'status',
      header: x.columns.status,
      cell: (row) => (
        <Badge
          tone={
            row.status === 'ACTIVE' ? 'success' : row.status === 'RESTORED' ? 'warning' : 'neutral'
          }
        >
          {x.status[row.status]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.owner.displayName })}
          items={
            canRestore && row.status === 'ACTIVE'
              ? [
                  {
                    id: 'restore',
                    label: x.restore,
                    icon: 'swap' as const,
                    onSelect: () => setRestoring(row),
                  },
                ]
              : []
          }
        />
      ),
    },
  ];

  async function restore(item: ComboUsageItemResponse, reason: string) {
    await withReauthentication(
      () => api.post(`/api/v1/combos/usage/${item.consumptionId}/restore`, { reason }),
      confirm,
    );
    setRestoring(null);
    notify(x.restored);
    await list.reload();
  }

  return (
    <>
      <ListSection title={x.title} count={list.data?.total}>
        <p className="ls-hint">{x.intro}</p>
        <DataTable
          mode="server"
          caption={fill(t.common.list.table, { list: x.title })}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.consumptionId}
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
      {restoring ? (
        <ConfirmDialog
          title={x.restoreTitle}
          description={x.restoreBody}
          facts={[
            {
              label: x.columns.owner,
              value: restoring.owner.displayName,
            },
            { label: x.columns.session, value: usageSessionText(restoring, locale) },
            { label: x.columns.invoice, value: restoring.invoiceCode },
            { label: x.columns.recordedBy, value: restoring.performedByName },
            {
              label: x.columns.when,
              value: formatDateTime(restoring.usedAt, ZONE, locale),
            },
          ]}
          tone="danger"
          confirmLabel={x.restore}
          busyLabel={x.restoring}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          reasonField={{
            label: x.restoreReason,
            required: true,
            requiredLabel: t.common.required,
            requiredMessage: x.restoreNeedReason,
            hint: x.restoreReasonHint,
          }}
          describeError={(error) => ({
            ...confirmError(t)(error),
            message: comboErrorText(error, locale, (cause) => posErrorMessage(cause, t)),
          })}
          onCancel={() => setRestoring(null)}
          onConfirm={async (reason) => {
            const text = (reason ?? '').trim();
            if (!text) throw new Error(x.restoreNeedReason);
            await restore(restoring, text);
          }}
        />
      ) : null}
      {/* Last, so the password confirmation sits above the confirmation dialog that asked for it. */}
      {dialog}
    </>
  );
}

/**
 * The Owner's list of frozen combos (Phase 5 P5-8, Owner-approved): the payment for the purchase was reversed after
 * some sessions were used, so the unused sessions wait until the sale is paid again. Read-only; nobody is notified.
 */
export function FrozenCombos() {
  const { api, t, locale, base } = useWorkforce();
  const c = comboDictionary(locale);
  const f = c.frozen;
  const list = useResource(() => api.get<ComboFrozenListResponse>('/api/v1/combos/frozen'), [api]);
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const rows = list.data?.items ?? [];
  const columns: DataTableColumn<ComboFrozenListResponse['items'][number]>[] = [
    {
      key: 'owner',
      header: f.columns.owner,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => (
        <Link className="ls-link" href={`${base}/loyalty/${row.owner.id}`}>
          {row.owner.displayName}
        </Link>
      ),
    },
    {
      key: 'combo',
      header: f.columns.combo,
      hideBelow: 'md',
      truncate: true,
      cell: (row) => comboName({ nameVi: row.comboNameVi, nameEn: row.comboNameEn }, locale),
    },
    { key: 'used', header: f.columns.used, numeric: true, cell: (row) => row.sessionsUsed },
    { key: 'left', header: f.columns.left, numeric: true, cell: (row) => row.sessionsLeft },
    {
      key: 'invoice',
      header: f.columns.invoice,
      hideBelow: 'lg',
      cell: (row) => row.saleInvoiceCode,
    },
    {
      key: 'status',
      header: f.columns.status,
      cell: (row) => (
        <Badge tone={row.saleInvoiceStatus === 'CANCELLED' ? 'neutral' : 'warning'}>
          {f.status[row.saleInvoiceStatus]}
        </Badge>
      ),
    },
  ];
  return (
    <ListSection title={f.title} count={list.data ? rows.length : undefined}>
      <p className="ls-hint">{f.intro}</p>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: f.title })}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.purchaseId}
        loading={list.loading && !list.data}
        loadingLabel={t.common.loading}
        error={
          list.error ? (
            <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
          ) : undefined
        }
        empty={list.data ? <Empty>{f.none}</Empty> : undefined}
        paging={{
          ...paging,
          onPageChange: (page) => setPaging((state) => ({ ...state, page })),
          onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
          labels: paginationLabels(t, f.title),
        }}
      />
    </ListSection>
  );
}
