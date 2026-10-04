'use client';

import type { ReferralListItemResponse, ReferralPageResponse } from '@lucy-spa/contracts';
import {
  DataTable,
  FacetedFilter,
  ListSection,
  ListToolbar,
  RowActions,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useMemo, useState } from 'react';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { fill } from '../../../i18n/workforce';
import { formatDateTime } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import { loyaltyBranches } from '../../../lib/workforce/loyalty';
import { LOYALTY_PAGE_SIZE } from '../../../lib/workforce/loyalty-list';
import { useBranches } from '../data';
import { PrefetchLink as Link } from '../link';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, ErrorState, useResource, useSuccessToast } from '../ui';
import { ChangeReferrerDialog } from './referral-dialogs';

/**
 * Every referral, newest first, 20 per page (Phase 5 P5-5; `VIEW_LOYALTY` at a branch). Who was referred, by whom, how it was
 * recorded and whether the referrer was rewarded. A row opens the referred customer's profile; the Owner can also change the
 * referrer of a row that was not rewarded yet. Read-only for everyone else.
 */
export function LoyaltyReferrals({
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
  const { account } = useAccount();
  const l = loyaltyDictionary(locale);
  const r = l.referral;
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const allowed = useMemo(() => loyaltyBranches(account, branches.data), [account, branches.data]);
  const branchId = allowed[0]?.id ?? '';
  const zone = branches.data?.get(branchId)?.timezone ?? 'UTC';
  const [changing, setChanging] = useState<string | null>(null);
  const list = useResource(
    () =>
      branchId
        ? api.get<ReferralPageResponse>(`/api/v1/referrals/branches/${branchId}`, {
            page,
            status: status || undefined,
          })
        : Promise.resolve(null),
    [api, branchId, page, status],
  );
  const rows = list.data?.items ?? [];
  const canChange = list.data?.can.change ?? false;
  const columns: DataTableColumn<ReferralListItemResponse>[] = [
    {
      key: 'referred',
      header: r.list.referred,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => (
        <Link className="ls-link" href={`${base}/loyalty/${row.referred.id}`}>
          {row.referred.displayName}
        </Link>
      ),
    },
    {
      key: 'referrer',
      header: r.list.referrer,
      truncate: true,
      width: 'md',
      cell: (row) => (
        <Link className="ls-link" href={`${base}/loyalty/${row.referrer.id}`}>
          {row.referrer.displayName}
        </Link>
      ),
    },
    {
      key: 'phone',
      header: l.lookup.phone,
      hideBelow: 'lg',
      cell: (row) => row.referrer.phoneMasked ?? '—',
    },
    {
      key: 'via',
      header: r.list.via,
      hideBelow: 'xl',
      truncate: true,
      width: 'md',
      cell: (row) => r.via[row.boundVia],
    },
    {
      key: 'bound',
      header: r.list.bound,
      hideBelow: 'md',
      cell: (row) => formatDateTime(row.boundAt, zone, locale),
    },
    {
      key: 'status',
      header: r.list.status,
      cell: (row) => (
        <Badge tone={row.awarded ? 'success' : 'neutral'}>
          {r.status[row.awarded ? 'REWARDED' : 'PENDING']}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.referred.displayName })}
          items={[
            {
              id: 'open',
              label: r.list.open,
              icon: 'eye',
              onSelect: () => navigate?.(`${base}/loyalty/${row.referred.id}`),
            },
            ...(canChange
              ? [
                  {
                    id: 'change',
                    label: r.list.change,
                    icon: 'edit' as const,
                    disabled: row.awarded !== null,
                    onSelect: () => setChanging(row.referred.id),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  if (branches.data && allowed.length === 0) return <Empty>{r.list.noBranch}</Empty>;
  return (
    <>
      <ListSection title={r.list.title} count={list.data?.total}>
        <p className="ls-hint">{r.intro}</p>
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={status ? 1 : 0}
          onReset={() => onStatus('')}
          reload={{ label: t.common.reload, onClick: () => void list.reload() }}
          filters={
            <FacetedFilter
              label={r.list.statusFilter}
              clearLabel={t.common.list.clearChoice}
              options={(['PENDING', 'REWARDED'] as const).map((value) => ({
                value,
                label: r.status[value],
              }))}
              selected={status ? [status] : []}
              onChange={([value]) => onStatus(value ?? '')}
            />
          }
        />
        <DataTable
          mode="server"
          caption={fill(t.common.list.table, { list: r.list.title })}
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
            list.data ? <Empty>{status ? r.list.noneFiltered : r.list.none}</Empty> : undefined
          }
          paging={{
            page,
            pageSize: LOYALTY_PAGE_SIZE,
            total: list.data?.total ?? rows.length,
            onPageChange: onPage,
            labels: paginationLabels(t, r.list.title),
          }}
        />
      </ListSection>
      {changing ? (
        <ChangeReferrerDialog
          userId={changing}
          onDone={() => {
            setChanging(null);
            notify(r.changeDialog.done);
            void list.reload();
          }}
          onClose={() => setChanging(null)}
        />
      ) : null}
    </>
  );
}
