'use client';

import type {
  CashClosingItem,
  CashClosingListResponse,
  CashClosingPreviewResponse,
  CashClosingResponse,
  CashFundItem,
} from '@lucy-spa/contracts';
import {
  DataTable,
  DateTextInput,
  DescriptionList,
  Field,
  FormDrawer,
  FormGrid,
  ListSection,
  ListToolbar,
  MoneyInput,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { cashDictionary } from '../../../i18n/cash';
import { fill } from '../../../i18n/workforce';
import {
  closeBody,
  closeProblems,
  closingFigures,
  defaultCloseDate,
  signedVnd,
  suggestedWithdrawal,
  vndNumber,
  type CloseDraft,
} from '../../../lib/workforce/cash';
import { formatDate, formatDateTime, todayIn } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
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
import { useCommand } from './cash-book';

const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * The daily closing of one cash fund (Phase 7 P7-6, design 7.4): the history of closed days, and the closing itself in a drawer that
 * shows what the book says for the day, takes the counted cash and the Owner's withdrawal, and says at once what the difference is and
 * what is left for tomorrow. A difference needs a reason; it is never taken out of pay. The bank fund is not closed daily.
 */
export function CashClosing({
  fund,
  page,
  onPage,
  defaultFloat,
  canClose,
  reloadToken,
  onChanged,
}: {
  fund: CashFundItem;
  page: number;
  onPage: (page: number) => void;
  defaultFloat: number;
  canClose: boolean;
  reloadToken: number;
  onChanged: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const k = c.closing;
  const notify = useSuccessToast();
  const [closing, setClosing] = useState(false);
  const list = useResource(
    () =>
      fund.kind === 'CASH'
        ? api.get<CashClosingListResponse>(`/api/v1/cash/funds/${fund.id}/closings`, { page })
        : Promise.resolve(null),
    [api, fund.id, page, reloadToken],
  );
  if (fund.kind !== 'CASH') return <Empty>{k.noBank}</Empty>;
  const rows = list.data?.items ?? [];
  return (
    <>
      <ListSection title={k.history}>
        <p className="ls-hint">{k.intro}</p>
        <ListToolbar
          labels={toolbarLabels(t)}
          reload={{ label: t.common.reload, onClick: () => void list.reload() }}
          actions={
            canClose ? (
              <Button variant="secondary" onClick={() => setClosing(true)}>
                {k.start}
              </Button>
            ) : undefined
          }
        />
        <DataTable
          mode="server"
          caption={fill(t.common.list.table, { list: k.history })}
          columns={historyColumns(c, t, locale)}
          rows={rows}
          rowKey={(row) => row.id}
          loading={list.loading && !list.data}
          loadingLabel={t.common.loading}
          error={
            list.error ? (
              <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
            ) : undefined
          }
          empty={list.data ? <Empty>{k.historyNone}</Empty> : undefined}
          paging={{
            page,
            pageSize: list.data?.pageSize ?? 20,
            total: list.data?.total ?? rows.length,
            onPageChange: onPage,
            labels: paginationLabels(t, k.history),
          }}
        />
      </ListSection>
      {closing ? (
        <CloseDrawer
          fund={fund}
          defaultFloat={defaultFloat}
          onDone={() => {
            setClosing(false);
            notify(k.done);
            onChanged();
          }}
          onClose={() => setClosing(false)}
        />
      ) : null}
    </>
  );
}

function historyColumns(
  c: ReturnType<typeof cashDictionary>,
  t: ReturnType<typeof useWorkforce>['t'],
  locale: ReturnType<typeof useWorkforce>['locale'],
): DataTableColumn<CashClosingItem>[] {
  const k = c.closing.columns;
  return [
    {
      key: 'date',
      header: k.date,
      mobileTitle: true,
      cell: (row) => formatDate(row.businessDate, locale),
    },
    {
      key: 'expected',
      header: k.expected,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => signedVnd(row.expectedVnd, locale),
    },
    {
      key: 'counted',
      header: k.counted,
      numeric: true,
      cell: (row) => signedVnd(row.countedVnd, locale),
    },
    {
      key: 'difference',
      header: k.difference,
      numeric: true,
      cell: (row) => (
        <span title={row.reason ?? undefined}>
          {row.differenceVnd === '0' ? '—' : signedVnd(row.differenceVnd, locale)}
          {row.alert ? (
            <>
              {' '}
              <Badge tone="warning">{c.closing.alert}</Badge>
            </>
          ) : null}
        </span>
      ),
    },
    {
      key: 'withdrawal',
      header: k.withdrawal,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => (row.withdrawalVnd === '0' ? '—' : signedVnd(row.withdrawalVnd, locale)),
    },
    {
      key: 'nextFloat',
      header: k.nextFloat,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => signedVnd(row.nextFloatVnd, locale),
    },
    {
      key: 'by',
      header: k.by,
      hideBelow: 'xl',
      truncate: true,
      width: 'sm',
      cell: (row) => (
        <span title={formatDateTime(row.closedAt, ZONE, locale)}>{row.closedBy.name}</span>
      ),
    },
    { key: 'actions', header: t.common.actions, actions: true, cell: () => null },
  ];
}

function CloseDrawer({
  fund,
  defaultFloat,
  onDone,
  onClose,
}: {
  fund: CashFundItem;
  defaultFloat: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const k = c.closing;
  const today = todayIn(ZONE);
  const [draft, setDraft] = useState<CloseDraft>({
    date: defaultCloseDate(fund.lastClosedDate, today),
    counted: null,
    withdrawal: null,
    reason: '',
  });
  const [checked, setChecked] = useState(false);
  const command = useCommand();
  const preview = useResource(
    () =>
      api.post<CashClosingPreviewResponse>(`/api/v1/cash/funds/${fund.id}/closing-preview`, {
        date: draft.date,
      }),
    [api, fund.id, draft.date],
  );
  const data = preview.data;
  const expected = data ? vndNumber(data.expectedVnd) : 0;
  const figures = closingFigures(expected, draft);
  const problems = closeProblems(expected, draft);
  const invalid = (name: string) =>
    checked && problems.includes(name) ? t.errors.validation : undefined;
  const blocked = data && !data.closable ? k.blocked[data.blockedBy ?? 'UNPOSTED'] : null;
  const suggestion = suggestedWithdrawal(draft.counted, defaultFloat);

  async function submit() {
    setChecked(true);
    if (!data || !data.closable) return;
    const body = closeBody(expected, draft, command.requestId);
    if (!body) return;
    await command.run<CashClosingResponse>(`/api/v1/cash/funds/${fund.id}/close`, body, onDone);
  }

  return (
    <>
      <FormDrawer
        title={k.title}
        labels={{ ...formOverlayLabels(t, k.submit), submitting: k.submitting }}
        busy={command.pending}
        dirty={draft.counted !== null || draft.reason !== ''}
        submitDisabled={!data || !data.closable}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <p className="ls-hint">{fund.name}</p>
        <FormGrid>
          <Field label={k.date} error={invalid('date')} required full>
            {(control) => (
              <DateTextInput
                {...control}
                value={draft.date}
                max={today}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
        {preview.error && !data ? (
          <ErrorState error={preview.error} t={t} onRetry={() => void preview.reload()} />
        ) : !data ? (
          <Loading t={t} />
        ) : (
          <>
            {blocked ? <Notice tone="warning">{blocked}</Notice> : null}
            <DescriptionList
              layout="totals"
              items={[
                { label: k.opening, value: signedVnd(data.openingFloatVnd, locale) },
                { label: k.cashIn, value: signedVnd(data.cashInVnd, locale) },
                { label: k.cashOut, value: signedVnd(data.cashOutVnd, locale) },
                { label: k.expected, value: signedVnd(data.expectedVnd, locale), strong: true },
              ]}
            />
            <FormGrid>
              <Field
                label={k.counted}
                hint={k.countedHint}
                error={invalid('counted')}
                required
                full
              >
                {(control) => (
                  <MoneyInput
                    {...control}
                    unit="₫"
                    separator={locale === 'vi' ? '.' : ','}
                    value={draft.counted}
                    onValueChange={(counted) => setDraft({ ...draft, counted })}
                  />
                )}
              </Field>
              <Field
                label={k.withdrawal}
                hint={
                  suggestion > 0
                    ? `${k.withdrawalHint} ${fill(k.suggest, { amount: signedVnd(suggestion, locale) })}`
                    : k.withdrawalHint
                }
                error={invalid('withdrawal')}
                full
              >
                {(control) => (
                  <MoneyInput
                    {...control}
                    unit="₫"
                    separator={locale === 'vi' ? '.' : ','}
                    value={draft.withdrawal}
                    onValueChange={(withdrawal) => setDraft({ ...draft, withdrawal })}
                  />
                )}
              </Field>
            </FormGrid>
            {draft.counted !== null ? (
              <DescriptionList
                layout="totals"
                items={[
                  {
                    label: k.difference,
                    value:
                      figures.difference === 0
                        ? k.differenceNone
                        : `${figures.difference < 0 ? k.differenceShort : k.differenceOver}: ${signedVnd(Math.abs(figures.difference), locale)}`,
                  },
                  {
                    label: k.nextFloat,
                    value: signedVnd(Math.max(0, figures.nextFloat), locale),
                    strong: true,
                  },
                ]}
              />
            ) : null}
            {figures.needsReason ? (
              <FormGrid>
                <Field label={k.reason} hint={k.reasonHint} error={invalid('reason')} required full>
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
            ) : null}
          </>
        )}
      </FormDrawer>
      {command.dialog}
    </>
  );
}
