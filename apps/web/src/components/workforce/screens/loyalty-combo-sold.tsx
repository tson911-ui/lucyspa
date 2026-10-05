'use client';

import {
  COMBO_SOLD_STATUSES,
  type ComboSoldCustomerPageResponse,
  type ComboSoldItemResponse,
  type ComboSoldPageResponse,
  type ComboSoldStatus,
  type CustomerGiftPageResponse,
  type CustomerGiftResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  DataTable,
  FacetedFilter,
  Grid,
  ListSection,
  ListToolbar,
  RowActions,
  Stat,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { comboSoldDictionary } from '../../../i18n/combo-sold';
import type { Locale } from '../../../i18n/locales';
import { rewardDictionary } from '../../../i18n/reward';
import { fill, getWorkforceDictionary } from '../../../i18n/workforce';
import { formatDay } from '../../../lib/customer/loyalty';
import { formatVnd } from '../../../lib/workforce/format';
import { comboName } from '../../../lib/workforce/combo';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import { LOYALTY_PAGE_SIZE } from '../../../lib/workforce/loyalty-list';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, useResource } from '../ui';

type Tone = 'success' | 'info' | 'warning' | 'neutral' | 'error';

export function soldTone(status: ComboSoldStatus): Tone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'FROZEN':
      return 'warning';
    case 'REVOKED':
      return 'error';
    default:
      return 'neutral';
  }
}

/** When a frozen or revoked combo stopped counting ("Khóa 06/10/2026"); a dash for the others. */
export function soldEvent(item: ComboSoldItemResponse, locale: Locale): string {
  const s = comboSoldDictionary(locale);
  return item.event
    ? fill(s.event[item.event.kind], { date: formatDay(item.event.at, locale) })
    : s.noDetail;
}

/** Why: the payment was reversed or the invoice cancelled; a dash for the others. */
export function soldReason(item: ComboSoldItemResponse, locale: Locale): string {
  const s = comboSoldDictionary(locale);
  return item.event ? s.cause[item.event.cause] : s.noDetail;
}

/** A value that may be cut by the column (one line, ellipsis); the full text is its title (the kit's clamp pattern). */
function Clamped({ text }: { text: string }) {
  return (
    <span className="ls-cell-title" title={text}>
      {text}
    </span>
  );
}

function soldColumns(
  locale: Locale,
  withBuyer: boolean,
  open: ((row: ComboSoldItemResponse) => void) | null,
  rowName: (row: ComboSoldItemResponse) => string,
): DataTableColumn<ComboSoldItemResponse>[] {
  const s = comboSoldDictionary(locale);
  const t = getWorkforceDictionary(locale);
  const name = (row: ComboSoldItemResponse) =>
    comboName({ nameVi: row.comboNameVi, nameEn: row.comboNameEn }, locale);
  const buyer: DataTableColumn<ComboSoldItemResponse>[] = withBuyer
    ? [
        {
          key: 'buyer',
          header: s.columns.buyer,
          mobileTitle: true,
          cell: (row) => (
            <span className="ls-cell-stack">
              <span className="ls-cell-main" title={row.buyer.displayName}>
                {row.buyer.displayName}
              </span>
              <span className="ls-cell-sub">{row.buyer.phoneMasked ?? '—'}</span>
            </span>
          ),
        },
      ]
    : [];
  return [
    ...buyer,
    {
      key: 'combo',
      header: s.columns.combo,
      mobileTitle: !withBuyer,
      cell: (row) => (
        <span className="ls-cell-stack">
          {withBuyer ? (
            <Clamped text={name(row)} />
          ) : (
            <span className="ls-cell-main" title={name(row)}>
              {name(row)}
            </span>
          )}
          {withBuyer ? (
            <>
              <span className="ls-cell-sub">{formatDay(row.soldAt, locale)}</span>
              <span className="ls-cell-sub">{row.branchName}</span>
            </>
          ) : (
            <span className="ls-cell-sub">
              {formatDay(row.soldAt, locale)} · {row.branchName}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'sessions',
      header: s.columns.sessions,
      cell: (row) => (
        <span className="ls-cell-stack">
          <span>{fill(s.paidLeft, { left: row.paidLeft, total: row.paidSessions })}</span>
          <span className="ls-cell-sub">
            {row.bonusSessions > 0
              ? fill(s.bonusLeft, { left: row.bonusLeft, total: row.bonusSessions })
              : s.noBonus}
          </span>
          {row.valueVnd !== null && (
            <span className="ls-cell-sub">
              {fill(s.value.row, { amount: formatVnd(row.valueVnd, locale) })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: s.columns.status,
      cell: (row) => (
        <span className="ls-cell-stack">
          <span>
            <Badge tone={soldTone(row.status)}>{s.status[row.status]}</Badge>
          </span>
          <span className="ls-cell-sub">{row.event ? soldEvent(row, locale) : '\u00a0'}</span>
          <span className="ls-cell-sub">{row.event ? soldReason(row, locale) : '\u00a0'}</span>
        </span>
      ),
    },
    ...(open
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true as const,
            cell: (row: ComboSoldItemResponse) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: rowName(row) })}
                items={[
                  {
                    id: 'open',
                    label: s.openCustomer,
                    icon: 'eye' as const,
                    onSelect: () => open(row),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];
}

/**
 * "Combo đã bán" (Phase 5 P5-10b): every combo that was sold, in every state, with the sessions usable now at the top. For the
 * Owner or a manager (`RESTORE_COMBO_SESSIONS` or `MANAGE_COMBOS`). Read only. The unused prepaid money (per combo and in total) is shown to the Owner only.
 */
export function LoyaltyComboSold({
  page,
  status,
  onPage,
  onStatus,
}: {
  page: number;
  status: string;
  onPage: (page: number) => void;
  onStatus: (status: string) => void;
}) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const s = comboSoldDictionary(locale);
  const list = useResource(
    () =>
      api.get<ComboSoldPageResponse>('/api/v1/combos/sold', { page, status: status || undefined }),
    [api, page, status],
  );
  const rows = list.data?.items ?? [];
  const totals = list.data?.totals;
  return (
    <>
      <p className="ls-hint">{s.intro}</p>
      <Grid min="sm" gap="page">
        <Card as="section" aria-label={s.totals.paid}>
          <Stat
            label={s.totals.paid}
            value={totals?.paidLeft ?? 0}
            format={{ valueFormat: 'count', locale }}
            note={s.totals.note}
          />
        </Card>
        <Card as="section" aria-label={s.totals.bonus}>
          <Stat
            label={s.totals.bonus}
            value={totals?.bonusLeft ?? 0}
            format={{ valueFormat: 'count', locale }}
            note={s.totals.note}
          />
        </Card>
        <Card as="section" aria-label={s.totals.frozen}>
          <Stat
            label={s.totals.frozen}
            value={(totals?.frozenPaidLeft ?? 0) + (totals?.frozenBonusLeft ?? 0)}
            format={{ valueFormat: 'count', locale }}
            note={fill(s.totals.frozenNote, {
              paid: totals?.frozenPaidLeft ?? 0,
              bonus: totals?.frozenBonusLeft ?? 0,
            })}
          />
        </Card>
      </Grid>
      {totals?.value ? (
        <Grid min="md" gap="page">
          <Card as="section" aria-label={s.value.active}>
            <Stat
              label={s.value.active}
              value={Number(totals.value.activeVnd)}
              format={{ valueFormat: 'vnd', locale }}
              note={s.value.activeNote}
            />
          </Card>
          {/* Frozen and revoked money are counted apart from the usable total, so they share one card: two cards, never an orphan at any width. */}
          <Card as="section" aria-label={s.value.apart}>
            <Grid min="sm" gap="page">
              <Stat
                label={s.value.frozen}
                value={Number(totals.value.frozenVnd)}
                format={{ valueFormat: 'vnd', locale }}
                note={s.value.apartNote}
              />
              <Stat
                label={s.value.revoked}
                value={Number(totals.value.revokedVnd)}
                format={{ valueFormat: 'vnd', locale }}
                note={s.value.apartNote}
              />
            </Grid>
          </Card>
        </Grid>
      ) : null}
      <ListSection title={s.title} count={list.data?.total}>
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={status ? 1 : 0}
          onReset={() => onStatus('')}
          reload={{ label: t.common.reload, onClick: () => void list.reload() }}
          filters={
            <FacetedFilter
              label={s.statusFilter}
              clearLabel={t.common.list.clearChoice}
              options={COMBO_SOLD_STATUSES.map((value) => ({ value, label: s.status[value] }))}
              selected={status ? [status] : []}
              onChange={([value]) => onStatus(value ?? '')}
            />
          }
        />
        <DataTable
          mode="server"
          caption={fill(t.common.list.table, { list: s.title })}
          columns={soldColumns(
            locale,
            true,
            (row) => navigate?.(`${base}/loyalty/${row.buyer.id}`),
            (row) => row.buyer.displayName,
          )}
          rows={rows}
          rowKey={(row) => row.purchaseId}
          loading={list.loading && !list.data}
          loadingLabel={t.common.loading}
          error={
            list.error ? (
              <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
            ) : undefined
          }
          empty={list.data ? <Empty>{status ? s.noneFiltered : s.none}</Empty> : undefined}
          paging={{
            page,
            pageSize: LOYALTY_PAGE_SIZE,
            total: list.data?.total ?? rows.length,
            onPageChange: onPage,
            labels: paginationLabels(t, s.title),
          }}
        />
      </ListSection>
    </>
  );
}

/** A customer's combos on the staff profile: every state, read only (`VIEW_LOYALTY` at the branch). */
export function ProfileCombos({ branchId, userId }: { branchId: string; userId: string }) {
  const { api, t, locale } = useWorkforce();
  const s = comboSoldDictionary(locale);
  const [page, setPage] = useState(1);
  const list = useResource(
    () =>
      api.get<ComboSoldCustomerPageResponse>(
        `/api/v1/loyalty/branches/${branchId}/customers/${userId}/combos`,
        { page },
      ),
    [api, branchId, userId, page],
  );
  const rows = list.data?.items ?? [];
  return (
    <ListSection title={s.profile.combosTitle} count={list.data?.total}>
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: s.profile.combosTitle })}
        columns={soldColumns(locale, false, null, (row) =>
          comboName({ nameVi: row.comboNameVi, nameEn: row.comboNameEn }, locale),
        )}
        rows={rows}
        rowKey={(row) => row.purchaseId}
        loading={list.loading && !list.data}
        loadingLabel={t.common.loading}
        error={
          list.error ? (
            <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
          ) : undefined
        }
        empty={list.data ? <Empty>{s.profile.combosNone}</Empty> : undefined}
        paging={{
          page,
          pageSize: LOYALTY_PAGE_SIZE,
          total: list.data?.total ?? rows.length,
          onPageChange: setPage,
          labels: paginationLabels(t, s.profile.combosTitle),
        }}
      />
    </ListSection>
  );
}

/** A customer's gifts on the staff profile: status, units left and expiry; the grant reason and staff names stay in the gift desk. */
export function ProfileGifts({ branchId, userId }: { branchId: string; userId: string }) {
  const { api, t, locale } = useWorkforce();
  const s = comboSoldDictionary(locale);
  const r = rewardDictionary(locale);
  const [page, setPage] = useState(1);
  const list = useResource(
    () =>
      api.get<CustomerGiftPageResponse>(
        `/api/v1/loyalty/branches/${branchId}/customers/${userId}/gifts`,
        { page },
      ),
    [api, branchId, userId, page],
  );
  const rows = list.data?.items ?? [];
  const columns: DataTableColumn<CustomerGiftResponse>[] = [
    {
      key: 'gift',
      header: s.profile.gift,
      mobileTitle: true,
      truncate: true,
      cell: (row) => (locale === 'vi' ? row.nameVi : row.nameEn),
    },
    {
      key: 'kind',
      header: s.profile.kind,
      hideBelow: 'md',
      cell: (row) => r.kind[row.kind],
    },
    {
      key: 'left',
      header: s.profile.quantity,
      numeric: true,
      cell: (row) => fill(s.left, { left: row.quantityLeft, total: row.quantityIssued }),
    },
    {
      key: 'status',
      header: s.profile.status,
      cell: (row) => (
        <Badge tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}>{r.status[row.status]}</Badge>
      ),
    },
    {
      key: 'expires',
      header: s.profile.expires,
      numeric: true,
      cell: (row) => (row.expiresAt ? formatDay(row.expiresAt, locale) : s.noExpiry),
    },
  ];
  return (
    <ListSection title={s.profile.giftsTitle} count={list.data?.total}>
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: s.profile.giftsTitle })}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={list.loading && !list.data}
        loadingLabel={t.common.loading}
        error={
          list.error ? (
            <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
          ) : undefined
        }
        empty={
          list.data ? (
            <Empty>{list.data.live ? s.profile.giftsNone : s.profile.giftsNotLive}</Empty>
          ) : undefined
        }
        paging={{
          page,
          pageSize: LOYALTY_PAGE_SIZE,
          total: list.data?.total ?? rows.length,
          onPageChange: setPage,
          labels: paginationLabels(t, s.profile.giftsTitle),
        }}
      />
    </ListSection>
  );
}
