'use client';

import type {
  TourRuleHistoryResponse,
  TourRuleResponse,
  TourRuleServiceItem,
  TourRulesResponse,
} from '@lucy-spa/contracts';
import {
  DataTable,
  DateTextInput,
  FacetedFilter,
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
  startWindow,
  tourBody,
  tourProblems,
  type PayPageState,
  type TourDraft,
} from '../../../lib/workforce/pay';
import { useWorkforce } from '../session';
import { Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';
import { HistoryDrawer, usePayCommand } from './pay-command';

/**
 * "Tiền tour" (Phase 7 P7-11): the amount paid to the KTV for each performed service. A service with no rule earns nothing and is
 * listed as such; a rule is a new dated line, never an edit, and a value of 0 says clearly that nothing is paid.
 */
export function PayTour({
  state,
  update,
}: {
  state: PayPageState;
  update: (patch: Partial<PayPageState>) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const c = p.tour;
  const [bump, setBump] = useState(0);
  const data = useResource(() => api.get<TourRulesResponse>('/api/v1/pay/tour-rules'), [api, bump]);
  const [setting, setSetting] = useState<TourRuleServiceItem | null>(null);
  const [viewing, setViewing] = useState<TourRuleServiceItem | null>(null);
  const notify = useSuccessToast();
  const query = state.q.trim().toLocaleLowerCase(locale);
  const onlyMissing = state.missing === '1';
  const all = data.data?.items ?? [];
  const name = (item: TourRuleServiceItem) =>
    locale === 'vi' ? item.service.nameVi : item.service.nameEn;
  const rows = all.filter(
    (item) =>
      (!onlyMissing || item.current === null) &&
      (!query || `${name(item)} ${item.service.code}`.toLocaleLowerCase(locale).includes(query)),
  );
  const canManage = data.data?.canManage ?? false;
  const columns: DataTableColumn<TourRuleServiceItem>[] = [
    {
      key: 'service',
      header: c.columns.service,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (item) => name(item),
    },
    {
      key: 'current',
      header: c.columns.current,
      numeric: true,
      cell: (item) =>
        item.current ? (
          item.current.amountVnd === '0' ? (
            <span className="ls-hint">{p.commission.zero}</span>
          ) : (
            formatVnd(item.current.amountVnd, locale)
          )
        ) : (
          <span className="ls-hint">{c.missingBadge}</span>
        ),
    },
    {
      key: 'since',
      header: c.columns.since,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => (item.current ? formatDate(item.current.effectiveFrom, locale) : '—'),
    },
    {
      key: 'upcoming',
      header: c.columns.upcoming,
      hideBelow: 'lg',
      hidePhone: true,
      cell: (item) =>
        item.upcoming
          ? fill(c.upcomingValue, {
              amount: formatVnd(item.upcoming.amountVnd, locale),
              date: formatDate(item.upcoming.effectiveFrom, locale),
            })
          : '—',
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: name(item) })}
          items={[
            ...(canManage
              ? [
                  {
                    id: 'set',
                    label: c.set,
                    icon: 'plus' as const,
                    onSelect: () => setSetting(item),
                  },
                ]
              : []),
            ...(item.versions > 0
              ? [
                  {
                    id: 'history',
                    label: p.common.history,
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
  const missing = all.filter((item) => item.current === null).length;
  const paging1 = useClientPaging(t, c.title);
  return (
    <>
      <ListSection title={c.title}>
        {missing > 0 && data.data ? <p className="ls-hint">{c.missingNote}</p> : null}
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={onlyMissing ? 1 : 0}
          onReset={() => update({ missing: '' })}
          reload={{ label: t.common.reload, onClick: () => void data.reload() }}
          resultCount={data.data ? fill(t.common.list.results, { count: rows.length }) : undefined}
          search={
            <SearchInput
              id="pay-tour-q"
              value={state.q}
              label={p.common.search}
              placeholder={p.common.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => update({ q })}
            />
          }
          filters={
            <FacetedFilter
              label={p.common.onlyMissing}
              clearLabel={t.common.list.clearChoice}
              options={[{ value: '1', label: p.common.onlyMissing }]}
              selected={onlyMissing ? ['1'] : []}
              onChange={([value]) => update({ missing: value ?? '' })}
            />
          }
        />
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: c.title })}
          columns={columns}
          rows={rows}
          rowKey={(item) => item.service.id}
          loading={data.loading && !data.data}
          loadingLabel={t.common.loading}
          error={
            data.error ? (
              <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
            ) : undefined
          }
          empty={
            data.data ? <Empty>{query || onlyMissing ? c.noneFiltered : c.none}</Empty> : undefined
          }
          paging={paging1}
        />
      </ListSection>
      {setting && data.data ? (
        <TourDialog
          item={setting}
          today={data.data.today}
          onDone={() => {
            setSetting(null);
            notify(c.done);
            setBump((value) => value + 1);
          }}
          onClose={() => setSetting(null)}
        />
      ) : null}
      {viewing ? <TourHistory item={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function TourDialog({
  item,
  today,
  onDone,
  onClose,
}: {
  item: TourRuleServiceItem;
  today: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const c = p.tour;
  const window = startWindow(today, true);
  const [draft, setDraft] = useState<TourDraft>({ amount: null, from: today, reason: '' });
  const [checked, setChecked] = useState(false);
  const command = usePayCommand();
  const problems = tourProblems(draft, today);
  const invalid = (name: string) =>
    checked && problems.includes(name) ? t.errors.validation : undefined;
  const serviceName = locale === 'vi' ? item.service.nameVi : item.service.nameEn;

  async function submit() {
    setChecked(true);
    const body = tourBody(item.service.id, draft, today);
    if (!body) return;
    await command.run<TourRuleResponse>('/api/v1/pay/tour-rules', body, onDone);
  }

  return (
    <FormDialog
      title={c.setTitle}
      description={fill(c.setDescription, { name: serviceName })}
      labels={{ ...formOverlayLabels(t, c.submit), submitting: c.submitting }}
      busy={command.pending}
      dirty={draft.amount !== null || draft.reason !== ''}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={c.amount} hint={c.amountHint} error={invalid('amount')} required full>
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

function TourHistory({ item, onClose }: { item: TourRuleServiceItem; onClose: () => void }) {
  const { api, t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const history = useResource(
    () => api.get<TourRuleHistoryResponse>(`/api/v1/pay/tour-rules/${item.service.id}/history`),
    [api, item.service.id],
  );
  const rows = history.data?.items ?? [];
  const serviceName = locale === 'vi' ? item.service.nameVi : item.service.nameEn;
  const paging2 = useClientPaging(t, p.common.history);
  return (
    <HistoryDrawer title={fill(p.tour.historyTitle, { name: serviceName })} onClose={onClose}>
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
              row.amountVnd === '0' ? p.commission.zero : formatVnd(row.amountVnd, locale),
          },
          {
            key: 'by',
            header: p.common.by,
            truncate: true,
            hidePhone: true,
            cell: (row) => row.createdBy.name,
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
