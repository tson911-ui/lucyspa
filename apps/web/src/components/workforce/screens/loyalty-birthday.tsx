'use client';

import type {
  BirthdayRewardConfigResponse,
  BirthdayRewardVersionResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  ListSection,
  Stack,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { birthdayDictionary } from '../../../i18n/birthday';
import { fill } from '../../../i18n/workforce';
import {
  combineText,
  giftText,
  usageShortText,
  usageText,
  windowShortText,
  windowText,
} from '../../../lib/workforce/birthday';
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
import { BirthdayFormDrawer } from './loyalty-birthday-form';

/**
 * "Quà sinh nhật" (Phase 5 P5-6): the Owner's configuration of the birthday gift. It ships empty. Only the Owner holds
 * `MANAGE_BIRTHDAY_REWARDS`; the API authorizes every request again. Saving appends a version; the history below keeps every
 * version, and a finalized invoice always keeps the version it was computed under.
 */
export function LoyaltyBirthday() {
  const { api, t, locale } = useWorkforce();
  const b = birthdayDictionary(locale);
  const notify = useSuccessToast();
  const config = useResource(
    () => api.get<BirthdayRewardConfigResponse>('/api/v1/loyalty/birthday-reward'),
    [api],
  );
  const [editing, setEditing] = useState(false);
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });

  if (config.error && !config.data) {
    return <ErrorState error={config.error} t={t} onRetry={() => void config.reload()} />;
  }
  if (!config.data) return <Loading t={t} />;
  const { configured, current, versions, loyaltyLive } = config.data;
  const zone = 'Asia/Ho_Chi_Minh';

  const columns: DataTableColumn<BirthdayRewardVersionResponse>[] = [
    {
      key: 'version',
      header: b.history.version,
      mobileTitle: true,
      numeric: true,
      cell: (row) => row.versionNo,
    },
    {
      key: 'when',
      header: b.history.when,
      cell: (row) => formatDateTime(row.createdAt, zone, locale),
    },
    {
      key: 'by',
      header: b.history.by,
      hideBelow: 'lg',
      truncate: true,
      width: 'md',
      cell: (row) => row.createdByName,
    },
    {
      key: 'status',
      header: b.history.status,
      cell: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {row.isActive ? b.current.on : b.current.off}
        </Badge>
      ),
    },
    {
      key: 'gift',
      header: b.history.gift,
      numeric: true,
      cell: (row) => giftText(row, locale, true),
    },
    {
      key: 'window',
      header: b.history.window,
      hideBelow: 'lg',
      cell: (row) => windowShortText(row, locale),
    },
    {
      key: 'usage',
      header: b.history.usage,
      cell: (row) => usageShortText(row.usageLimit, locale),
    },
  ];

  return (
    <Stack gap="page">
      {!loyaltyLive ? <Notice tone="info">{b.notLive}</Notice> : null}
      <p className="ls-hint">{b.intro}</p>
      {configured && current ? (
        <Card as="section" aria-label={b.current.title}>
          <CardHeader
            title={b.current.title}
            actions={
              <Button variant="primary" icon="edit" onClick={() => setEditing(true)}>
                {b.current.edit}
              </Button>
            }
          />
          <DescriptionList
            columns={2}
            items={[
              {
                label: b.current.status,
                value: (
                  <Badge tone={current.isActive ? 'success' : 'neutral'}>
                    {current.isActive ? b.current.on : b.current.off}
                  </Badge>
                ),
              },
              { label: b.current.gift, value: giftText(current, locale) },
              {
                label: b.current.minSpend,
                value:
                  current.minSpendVnd === '0'
                    ? b.current.minSpendNone
                    : formatVnd(current.minSpendVnd, locale),
              },
              { label: b.current.window, value: windowText(current, locale) },
              { label: b.current.combine, value: combineText(current, locale) },
              { label: b.current.usage, value: usageText(current.usageLimit, locale) },
              {
                label: b.current.version,
                value: fill(b.current.versionValue, {
                  n: String(current.versionNo),
                  by: current.createdByName,
                }),
              },
            ]}
          />
        </Card>
      ) : (
        <Card as="section" aria-label={b.empty.title}>
          <CardHeader
            title={b.empty.title}
            actions={
              <Button variant="primary" icon="plus" onClick={() => setEditing(true)}>
                {b.empty.action}
              </Button>
            }
          />
          <Empty>{b.empty.body}</Empty>
        </Card>
      )}
      {configured ? (
        <ListSection title={b.history.title}>
          <DataTable
            mode="client"
            caption={fill(t.common.list.table, { list: b.history.title })}
            columns={columns}
            rows={versions}
            rowKey={(row) => row.id}
            empty={<Empty>{b.history.none}</Empty>}
            paging={{
              ...paging,
              onPageChange: (page) => setPaging((state) => ({ ...state, page })),
              onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
              labels: paginationLabels(t, b.history.title),
            }}
          />
        </ListSection>
      ) : null}
      {editing ? (
        <BirthdayFormDrawer
          current={current}
          onDone={() => {
            setEditing(false);
            notify(b.form.done);
            void config.reload();
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Stack>
  );
}
