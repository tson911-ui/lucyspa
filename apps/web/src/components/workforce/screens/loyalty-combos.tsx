'use client';

import type { ComboListResponse, ComboResponse } from '@lucy-spa/contracts';
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
import { comboDictionary } from '../../../i18n/combo';
import { fill } from '../../../i18n/workforce';
import { comboName, sessionsText } from '../../../lib/workforce/combo';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
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
import { ComboFormDrawer } from './loyalty-combos-form';

/**
 * "Combo" (Phase 5 P5-7): the definitions of the service combos. It ships empty. `MANAGE_COMBOS` is global, so an Owner or a
 * manager who holds it sees this tab; the API authorizes every request again. Saving appends a version; a combo already sold
 * keeps the copy it was sold with. Using the sessions of a sold combo is a later step.
 */
export function LoyaltyCombos() {
  const { api, t, locale } = useWorkforce();
  const c = comboDictionary(locale);
  const notify = useSuccessToast();
  const list = useResource(() => api.get<ComboListResponse>('/api/v1/combos'), [api]);
  // `undefined` = closed, `null` = a new combo, a combo = editing it.
  const [editing, setEditing] = useState<ComboResponse | null | undefined>(undefined);
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });

  if (list.error && !list.data) {
    return <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />;
  }
  if (!list.data) return <Loading t={t} />;
  const { combos, serviceOptions, loyaltyLive } = list.data;
  const zone = 'Asia/Ho_Chi_Minh';

  const columns: DataTableColumn<ComboResponse>[] = [
    {
      key: 'name',
      header: c.list.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (combo) => comboName(combo.current, locale),
    },
    {
      key: 'service',
      header: c.list.service,
      hideBelow: 'md',
      truncate: true,
      width: 'md',
      cell: (combo) => comboName(combo.service, locale),
    },
    {
      key: 'sessions',
      header: c.list.sessions,
      cell: (combo) =>
        sessionsText(combo.current.paidSessions, combo.current.bonusSessions, locale),
    },
    {
      key: 'price',
      header: c.list.price,
      numeric: true,
      cell: (combo) => formatVnd(combo.current.priceVnd, locale),
    },
    {
      key: 'status',
      header: c.list.status,
      cell: (combo) => (
        <Badge tone={combo.current.active ? 'success' : 'neutral'}>
          {combo.current.active ? c.list.on : c.list.off}
        </Badge>
      ),
    },
    {
      key: 'version',
      header: c.list.version,
      numeric: true,
      hideBelow: 'xl',
      cell: (combo) => combo.current.versionNo,
    },
    {
      key: 'updated',
      header: c.list.updated,
      hideBelow: 'lg',
      cell: (combo) => formatDateTime(combo.current.createdAt, zone, locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (combo) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: comboName(combo.current, locale) })}
          items={[
            {
              id: 'edit',
              label: c.list.edit,
              icon: 'edit',
              onSelect: () => setEditing(combo),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="page">
      {!loyaltyLive ? <Notice tone="info">{c.notLive}</Notice> : null}
      <p className="ls-hint">{c.intro}</p>
      {combos.length === 0 ? (
        <Card as="section" aria-label={c.list.emptyTitle}>
          <CardHeader
            title={c.list.emptyTitle}
            actions={
              <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
                {c.list.add}
              </Button>
            }
          />
          <Empty>{c.list.emptyBody}</Empty>
        </Card>
      ) : (
        <ListSection
          title={c.list.title}
          actions={
            <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
              {c.list.add}
            </Button>
          }
        >
          <DataTable
            mode="client"
            caption={fill(t.common.list.table, { list: c.list.title })}
            columns={columns}
            rows={combos}
            rowKey={(combo) => `${combo.id}:${combo.current.versionNo}`}
            empty={<Empty>{c.list.emptyBody}</Empty>}
            paging={{
              ...paging,
              onPageChange: (page) => setPaging((state) => ({ ...state, page })),
              onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
              labels: paginationLabels(t, c.list.title),
            }}
          />
        </ListSection>
      )}
      {editing !== undefined ? (
        <ComboFormDrawer
          combo={editing}
          services={serviceOptions}
          onDone={() => {
            setEditing(undefined);
            notify(c.form.done);
            void list.reload();
          }}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </Stack>
  );
}
