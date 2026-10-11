'use client';

import type {
  SalariesResponse,
  SalaryHistoryResponse,
  SalaryItem,
  SalaryVersionResponse,
} from '@lucy-spa/contracts';
import {
  DataTable,
  DateTextInput,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  ListToolbar,
  MoneyInput,
  RowActions,
  SearchInput,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { payDictionary } from '../../../i18n/pay';
import { fill } from '../../../i18n/workforce';
import { formatDate, formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import {
  salaryBody,
  salaryProblems,
  startWindow,
  type PayPageState,
  type SalaryDraft,
} from '../../../lib/workforce/pay';
import { useWorkforce } from '../session';
import { Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';
import { HistoryDrawer, usePayCommand } from './pay-command';

/**
 * "Lương cơ bản" (Phase 7 P7-11): the monthly base salary of every official employee and its history. A salary is entered as a new
 * dated line, never edited; until the Owner enters the first line the number on the profile is shown as "not confirmed". The API
 * decides every permission again; this screen only hides what a person cannot do.
 */
export function PaySalaries({
  state,
  update,
}: {
  state: PayPageState;
  update: (patch: Partial<PayPageState>) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const s = p.salaries;
  const [bump, setBump] = useState(0);
  const data = useResource(() => api.get<SalariesResponse>('/api/v1/pay/salaries'), [api, bump]);
  const [setting, setSetting] = useState<SalaryItem | null>(null);
  const [viewing, setViewing] = useState<SalaryItem | null>(null);
  const notify = useSuccessToast();
  const query = state.q.trim().toLocaleLowerCase(locale);
  const all = data.data?.items ?? [];
  const rows = query
    ? all.filter((item) =>
        `${item.employee.name} ${item.employee.code}`.toLocaleLowerCase(locale).includes(query),
      )
    : all;
  const canManage = data.data?.canManage ?? false;
  const columns: DataTableColumn<SalaryItem>[] = [
    {
      key: 'employee',
      header: s.columns.employee,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (item) => (
        <>
          {item.employee.name}
          <span className="ls-hint"> · {item.employee.code}</span>
        </>
      ),
    },
    {
      key: 'current',
      header: s.columns.current,
      numeric: true,
      cell: (item) =>
        item.confirmed && item.current?.amountVnd ? (
          <>
            {formatVnd(item.current.amountVnd, locale)}{' '}
            <span className="ls-hint">{s.perMonth}</span>
          </>
        ) : (
          <>
            <span className="ls-hint">{s.notConfirmed}</span>
            {item.profileSalaryVnd ? (
              <span className="ls-hint">
                {' '}
                {fill(s.onProfile, { amount: formatVnd(item.profileSalaryVnd, locale) })}
              </span>
            ) : null}
          </>
        ),
    },
    {
      key: 'since',
      header: s.columns.since,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => (item.current ? formatDate(item.current.effectiveFrom, locale) : '—'),
    },
    {
      key: 'versions',
      header: s.columns.versions,
      numeric: true,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => item.versions,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: item.employee.name })}
          items={[
            ...(canManage
              ? [
                  {
                    id: 'set',
                    label: s.set,
                    icon: 'plus' as const,
                    onSelect: () => setSetting(item),
                  },
                ]
              : []),
            {
              id: 'history',
              label: p.common.history,
              icon: 'clock' as const,
              onSelect: () => setViewing(item),
            },
          ]}
        />
      ),
    },
  ];
  const unconfirmed = all.some((item) => !item.confirmed);
  const paging1 = useClientPaging(t, s.title);
  return (
    <>
      <ListSection title={s.title}>
        {unconfirmed && data.data ? <p className="ls-hint">{s.unconfirmedNote}</p> : null}
        <ListToolbar
          labels={toolbarLabels(t)}
          reload={{ label: t.common.reload, onClick: () => void data.reload() }}
          resultCount={data.data ? fill(t.common.list.results, { count: rows.length }) : undefined}
          search={
            <SearchInput
              id="pay-salary-q"
              value={state.q}
              label={p.common.search}
              placeholder={p.common.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => update({ q })}
            />
          }
        />
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: s.title })}
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
          empty={data.data ? <Empty>{query ? s.noneFiltered : s.none}</Empty> : undefined}
          paging={paging1}
        />
      </ListSection>
      {setting && data.data ? (
        <SalaryDialog
          item={setting}
          today={data.data.today}
          onDone={() => {
            setSetting(null);
            notify(s.done);
            setBump((value) => value + 1);
          }}
          onClose={() => setSetting(null)}
        />
      ) : null}
      {viewing ? <SalaryHistory item={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function SalaryDialog({
  item,
  today,
  onDone,
  onClose,
}: {
  item: SalaryItem;
  today: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const s = p.salaries;
  const window = startWindow(today, false);
  const [draft, setDraft] = useState<SalaryDraft>({ amount: null, from: today, reason: '' });
  const [checked, setChecked] = useState(false);
  const command = usePayCommand();
  const problems = salaryProblems(draft, today);
  const invalid = (name: string) =>
    checked && problems.includes(name) ? t.errors.validation : undefined;

  async function submit() {
    setChecked(true);
    const body = salaryBody(item.employee.id, draft, today);
    if (!body) return;
    await command.run<SalaryVersionResponse>('/api/v1/pay/salaries', body, onDone);
  }

  return (
    <FormDialog
      title={s.setTitle}
      description={fill(s.setDescription, { name: item.employee.name })}
      labels={{ ...formOverlayLabels(t, s.submit), submitting: s.submitting }}
      busy={command.pending}
      dirty={draft.amount !== null || draft.reason !== ''}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={s.amount} error={invalid('amount')} required full>
          {(control) => (
            <MoneyInput
              {...control}
              unit="₫"
              separator={locale === 'vi' ? '.' : ','}
              value={draft.amount}
              onValueChange={(amount) => setDraft({ ...draft, amount })}
            />
          )}
        </Field>
        <Field label={p.common.from} hint={p.common.fromHint} error={invalid('from')} required full>
          {(control) => (
            <DateTextInput
              {...control}
              min={window.min}
              max={window.max}
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          )}
        </Field>
        <Field label={p.common.reason} hint={p.common.reasonHint} error={invalid('reason')} full>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function SalaryHistory({ item, onClose }: { item: SalaryItem; onClose: () => void }) {
  const { api, t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const history = useResource(
    () => api.get<SalaryHistoryResponse>(`/api/v1/pay/salaries/${item.employee.id}/history`),
    [api, item.employee.id],
  );
  const rows = history.data?.items ?? [];
  const paging2 = useClientPaging(t, p.common.history);
  return (
    <HistoryDrawer
      title={fill(p.salaries.historyTitle, { name: item.employee.name })}
      onClose={onClose}
    >
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: p.common.history })}
        columns={[
          {
            key: 'from',
            header: p.common.from,
            mobileTitle: true,
            cell: (row) => (
              <>
                {formatDate(row.effectiveFrom, locale)}
                {row.reason ? <span className="ls-hint"> · {row.reason}</span> : null}
              </>
            ),
          },
          {
            key: 'amount',
            header: p.common.amount,
            numeric: true,
            cell: (row) =>
              row.amountVnd === null ? p.salaries.noSalary : formatVnd(row.amountVnd, locale),
          },
          {
            key: 'by',
            header: p.common.by,
            truncate: true,
            hidePhone: true,
            cell: (row) => row.recordedBy.name,
          },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        loading={history.loading && !history.data}
        loadingLabel={t.common.loading}
        error={
          history.error ? (
            <ErrorState error={history.error} t={t} onRetry={() => void history.reload()} />
          ) : undefined
        }
        empty={history.data ? <Empty>{p.common.historyEmpty}</Empty> : undefined}
        paging={paging2}
      />
      <p className="ls-hint">{p.common.appendOnly}</p>
    </HistoryDrawer>
  );
}
