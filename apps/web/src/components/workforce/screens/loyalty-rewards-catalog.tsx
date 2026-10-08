'use client';

import type { RewardCatalogItemResponse, RewardCatalogListResponse } from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  DataTable,
  ListSection,
  RowActions,
  Stack,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { rewardDictionary } from '../../../i18n/reward';
import { formatDateTime } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { expiryText, rewardName } from '../../../lib/workforce/reward';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  useResource,
  useSuccessToast,
} from '../ui';
import { RewardItemDrawer } from './loyalty-rewards-catalog-form';

const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * "Danh mục quà" (Phase 5 P5-9): the catalog of rewards the spa can grant. It ships empty. `MANAGE_REWARD_CATALOG` is global, so
 * an Owner or a manager who holds it sees this tab; the API authorizes every request again. An item is never deleted: switch it
 * off. Granting, using and revoking are on the "Cấp quà tặng" tab.
 */
export function LoyaltyRewardCatalog() {
  const { api, t, locale } = useWorkforce();
  const r = rewardDictionary(locale);
  const c = r.catalog;
  const notify = useSuccessToast();
  const list = useResource(
    () => api.get<RewardCatalogListResponse>('/api/v1/rewards/catalog'),
    [api],
  );
  // `undefined` = closed, `null` = a new item, an item = editing it.
  const [editing, setEditing] = useState<RewardCatalogItemResponse | null | undefined>(undefined);
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });

  if (list.error && !list.data) {
    return <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />;
  }
  if (!list.data) return <Loading t={t} />;
  const { items, serviceOptions, variantOptions, loyaltyLive } = list.data;

  const columns: DataTableColumn<RewardCatalogItemResponse>[] = [
    {
      key: 'name',
      header: c.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (item) => rewardName(item, locale),
    },
    { key: 'kind', header: c.kind, hideBelow: 'md', cell: (item) => r.kind[item.kind] },
    {
      key: 'service',
      header: c.service,
      hideBelow: 'lg',
      truncate: true,
      width: 'md',
      cell: (item) =>
        item.service
          ? rewardName(item.service, locale)
          : item.variant
            ? `${rewardName(item.variant, locale)} (${item.variant.sku})`
            : '—',
    },
    {
      key: 'expiry',
      header: c.expiry,
      hideBelow: 'lg',
      cell: (item) => expiryText(item.expiryDays, locale),
    },
    {
      key: 'status',
      header: c.status,
      cell: (item) => (
        <Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? c.on : c.off}</Badge>
      ),
    },
    {
      key: 'updated',
      header: c.updated,
      hideBelow: 'xl',
      cell: (item) => formatDateTime(item.updatedAt, ZONE, locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: rewardName(item, locale) })}
          items={[{ id: 'edit', label: c.edit, icon: 'edit', onSelect: () => setEditing(item) }]}
        />
      ),
    },
  ];

  const add = (
    <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
      {c.add}
    </Button>
  );
  return (
    <Stack gap="page">
      {!loyaltyLive ? <Notice tone="info">{r.notLive}</Notice> : null}
      <p className="ls-hint">{c.intro}</p>
      {items.length === 0 ? (
        <Card as="section" aria-label={c.emptyTitle}>
          <CardHeader title={c.emptyTitle} actions={add} />
          <Empty>{c.emptyBody}</Empty>
        </Card>
      ) : (
        <ListSection title={c.title} actions={add}>
          <DataTable
            mode="client"
            caption={fill(t.common.list.table, { list: c.title })}
            columns={columns}
            rows={items}
            rowKey={(item) => `${item.id}:${item.rowVersion}`}
            empty={<Empty>{c.emptyBody}</Empty>}
            paging={{
              ...paging,
              onPageChange: (page) => setPaging((state) => ({ ...state, page })),
              onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
              labels: paginationLabels(t, c.title),
            }}
          />
        </ListSection>
      )}
      {editing !== undefined ? (
        <RewardItemDrawer
          item={editing}
          services={serviceOptions}
          variants={variantOptions}
          onDone={() => {
            setEditing(undefined);
            notify(r.form.done);
            void list.reload();
          }}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </Stack>
  );
}
