'use client';

import type { StaffCodeItem, StaffCodesResponse } from '@lucy-spa/contracts';
import {
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  ListToolbar,
  RowActions,
  SearchInput,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { payDictionary } from '../../../i18n/pay';
import { fill } from '../../../i18n/workforce';
import { formatDate, zonedLocal } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { useUrlPaging } from '../../../lib/workforce/use-url-paging';
import { reasonProblem, type PayPageState } from '../../../lib/workforce/pay';
import { opensInput } from '../../../lib/workforce/opens-input';
import { useWorkforce } from '../session';
import { Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';
import { HistoryDrawer, usePayCommand } from './pay-command';

// Instants are shown as the shop's calendar day (an instant's UTC day is the previous day before 07:00 in Vietnam).
const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * "Mã nhân viên" (Phase 7 P7-11): the referral code of each official employee for online orders. A code exists only after the Owner
 * presses "Tạo mã"; "Đổi mã" switches the old one off for good and issues a new one. The API decides every permission again.
 */
export function PayCodes({
  state,
  update,
}: {
  state: PayPageState;
  update: (patch: Partial<PayPageState>) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const c = p.codes;
  const [bump, setBump] = useState(0);
  const data = useResource(
    () => api.get<StaffCodesResponse>('/api/v1/pay/referral-codes'),
    [api, bump],
  );
  const [resetting, setResetting] = useState<StaffCodeItem | null>(null);
  const [viewing, setViewing] = useState<StaffCodeItem | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const notify = useSuccessToast();
  const command = usePayCommand();
  const query = state.q.trim().toLocaleLowerCase(locale);
  const all = data.data?.items ?? [];
  const rows = query
    ? all.filter((item) => item.employee.name.toLocaleLowerCase(locale).includes(query))
    : all;
  const canManage = data.data?.canManage ?? false;

  async function create(item: StaffCodeItem) {
    setCreating(item.employee.id);
    setFailure(null);
    await command.run<StaffCodesResponse>(
      '/api/v1/pay/referral-codes',
      { employeeUserId: item.employee.id },
      () => {
        setCreating(null);
        notify(c.created);
        setBump((value) => value + 1);
      },
    );
    setCreating(null);
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      notify(c.copied);
    } catch {
      /* the code is on the screen; copying is a convenience */
    }
  }

  const columns: DataTableColumn<StaffCodeItem>[] = [
    {
      key: 'employee',
      header: c.columns.employee,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (item) => item.employee.name,
    },
    {
      key: 'code',
      header: c.columns.code,
      cell: (item) =>
        item.code ? <strong>{item.code}</strong> : <span className="ls-hint">{c.noCode}</span>,
    },
    {
      key: 'since',
      header: c.columns.since,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) =>
        item.createdAt ? formatDate(zonedLocal(item.createdAt, ZONE).slice(0, 10), locale) : '—',
    },
    {
      key: 'orders',
      header: c.columns.orders,
      numeric: true,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => (item.code ? item.orders : '—'),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: item.employee.name })}
          items={[
            ...(item.code
              ? [
                  {
                    id: 'copy',
                    label: c.copy,
                    icon: 'clipboard' as const,
                    onSelect: () => void copy(item.code!),
                  },
                ]
              : []),
            ...(canManage && !item.code
              ? [
                  {
                    id: 'create',
                    label: c.create,
                    icon: 'plus' as const,
                    disabled: creating !== null,
                    onSelect: () => void create(item),
                  },
                ]
              : []),
            ...(canManage && item.code
              ? [
                  {
                    id: 'reset',
                    label: opensInput(c.reset),
                    icon: 'refresh' as const,
                    onSelect: () => setResetting(item),
                  },
                ]
              : []),
            ...(item.history.length > 0
              ? [
                  {
                    id: 'history',
                    label: c.columns.history,
                    icon: 'clock' as const,
                    onSelect: () => setViewing(item),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  const paging1 = useUrlPaging('kp', t, c.title);
  return (
    <>
      {data.data && data.data.retired.length > 0 ? (
        <Notice tone="warning">
          {c.retiredTitle}:{' '}
          {data.data.retired.map((item) => `${item.employee.name} (${item.code})`).join(', ')}.{' '}
          {c.retiredNote}
        </Notice>
      ) : null}
      {/* The tab already names the list: no h2 repeating it (FR "a heading never repeats its control"). */}
      <div className="ls-list-section">
        <p className="ls-hint">{c.intro}</p>
        <ListToolbar
          labels={toolbarLabels(t)}
          reload={{ label: t.common.reload, onClick: () => void data.reload() }}
          resultCount={data.data ? fill(t.common.list.results, { count: rows.length }) : undefined}
          search={
            <SearchInput
              id="pay-codes-q"
              value={state.q}
              label={p.common.search}
              hint={p.common.searchName}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => update({ q })}
            />
          }
        />
        {command.error && creating === null ? <Notice tone="error">{command.error}</Notice> : null}
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: c.title })}
          columns={columns}
          rows={rows}
          rowKey={(item) => item.employee.id}
          loading={data.loading && !data.data}
          loadingLabel={t.common.loading}
          error={
            data.error ? (
              <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
            ) : undefined
          }
          empty={data.data ? <Empty>{query ? c.noneFiltered : c.none}</Empty> : undefined}
          paging={paging1}
        />
      </div>
      {resetting ? (
        <ResetDialog
          item={resetting}
          onDone={() => {
            setResetting(null);
            notify(c.resetDone);
            setBump((value) => value + 1);
          }}
          onClose={() => setResetting(null)}
        />
      ) : null}
      {viewing ? <CodeHistory item={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function ResetDialog({
  item,
  onDone,
  onClose,
}: {
  item: StaffCodeItem;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = payDictionary(locale).codes;
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const command = usePayCommand();
  const missing = checked && reasonProblem(reason);

  async function submit() {
    setChecked(true);
    if (reasonProblem(reason)) return;
    await command.run<StaffCodesResponse>(
      `/api/v1/pay/referral-codes/${item.employee.id}/reset`,
      { reason: reason.trim() },
      onDone,
    );
  }

  return (
    <FormDialog
      title={fill(c.resetTitle, { name: item.employee.name })}
      description={fill(c.resetDescription, { code: item.code ?? '' })}
      labels={{ ...formOverlayLabels(t, c.resetSubmit), submitting: c.resetSubmitting }}
      busy={command.pending}
      dirty={reason !== ''}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={c.resetReason}
          error={missing ? payDictionary(locale).common.fieldErrors.reasonRequired : undefined}
          required
          full
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              autoComplete="off"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function CodeHistory({ item, onClose }: { item: StaffCodeItem; onClose: () => void }) {
  const { t, locale } = useWorkforce();
  const c = payDictionary(locale).codes;
  const paging2 = useClientPaging(t, c.columns.history);
  return (
    <HistoryDrawer title={fill(c.historyTitle, { name: item.employee.name })} onClose={onClose}>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: c.columns.history })}
        columns={[
          {
            key: 'code',
            header: c.historyColumns.code,
            mobileTitle: true,
            cell: (row) => (
              <>
                <strong>{row.code}</strong>
                {row.deactivationReason ? (
                  <span className="ls-adminb-sub">{row.deactivationReason}</span>
                ) : null}
              </>
            ),
          },
          {
            key: 'created',
            header: c.historyColumns.created,
            hidePhone: true,
            cell: (row) => formatDate(zonedLocal(row.createdAt, ZONE).slice(0, 10), locale),
          },
          {
            key: 'stopped',
            header: c.historyColumns.stopped,
            cell: (row) =>
              row.deactivatedAt
                ? formatDate(zonedLocal(row.deactivatedAt, ZONE).slice(0, 10), locale)
                : '—',
          },
        ]}
        rows={item.history}
        rowKey={(row) => row.code}
        paging={paging2}
      />
    </HistoryDrawer>
  );
}
