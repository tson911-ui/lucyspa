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
import { useMemo, useState } from 'react';
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
import { focusFirstInvalid } from './pos-dom';

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
  zone,
  onChanged,
}: {
  fund: CashFundItem;
  /** The fund's branch time zone (wig cash-closing.tsx:52). */
  zone: string;
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
          columns={historyColumns(c, locale, zone)}
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
          zone={zone}
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
  locale: ReturnType<typeof useWorkforce>['locale'],
  zone: string,
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
      // The reason of a difference is shown under it, not only in a tooltip (wig :175).
      cell: (row) => (
        <span className="ls-cell-stack">
          <span>
            {row.differenceVnd === '0' ? '—' : signedVnd(row.differenceVnd, locale)}
            {row.alert ? (
              <>
                {' '}
                <Badge tone="warning">{c.closing.alert}</Badge>
              </>
            ) : null}
          </span>
          {row.reason ? <span className="ls-cell-sub ls-pos-name">{row.reason}</span> : null}
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
      wrap: true,
      width: 'sm',
      // Who closed it, with when under the name (wig :207: not only in a tooltip).
      cell: (row) => (
        <span className="ls-cell-stack">
          <span>{row.closedBy.name}</span>
          <span className="ls-cell-sub">{formatDateTime(row.closedAt, zone, locale)}</span>
        </span>
      ),
    },
  ];
}

function CloseDrawer({
  fund,
  zone,
  defaultFloat,
  onDone,
  onClose,
}: {
  fund: CashFundItem;
  zone: string;
  defaultFloat: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const k = c.closing;
  // Read once per zone, not on every keystroke in the form (rbp :231).
  const today = useMemo(() => todayIn(zone), [zone]);
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
    checked && problems.includes(name) ? c.problems[name as keyof typeof c.problems] : undefined;
  const blocked = data && !data.closable ? k.blocked[data.blockedBy ?? 'UNPOSTED'] : null;
  const suggestion = suggestedWithdrawal(draft.counted, defaultFloat);

  async function submit() {
    setChecked(true);
    if (!data || !data.closable) return;
    const body = closeBody(expected, draft, command.requestId);
    // A refused close moves focus to the first field to fix (wig Forms: focus the first error on submit).
    if (!body) return focusFirstInvalid();
    await command.run<CashClosingResponse>(`/api/v1/cash/funds/${fund.id}/close`, body, onDone);
  }

  return (
    <>
      <FormDrawer
        title={k.title}
        labels={{ ...formOverlayLabels(t, k.submit), submitting: k.submitting }}
        busy={command.pending}
        // Any typed figure counts, the withdrawal too, so closing the drawer never drops it without asking (wig Forms).
        dirty={draft.counted !== null || draft.withdrawal !== null || draft.reason !== ''}
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
                onChange={(event) =>
                  setDraft((current) => ({ ...current, date: event.target.value }))
                }
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
                    locale={locale}
                    value={draft.counted}
                    onValueChange={(counted) => setDraft((current) => ({ ...current, counted }))}
                  />
                )}
              </Field>
              <Field
                label={k.withdrawal}
                hint={
                  // One dictionary text per case (wig :324), not two sentences glued in code.
                  suggestion > 0
                    ? fill(k.withdrawalHintSuggest, { amount: signedVnd(suggestion, locale) })
                    : k.withdrawalHint
                }
                error={invalid('withdrawal')}
                full
              >
                {(control) => (
                  <MoneyInput
                    {...control}
                    unit="₫"
                    locale={locale}
                    value={draft.withdrawal}
                    onValueChange={(withdrawal) =>
                      setDraft((current) => ({ ...current, withdrawal }))
                    }
                  />
                )}
              </Field>
            </FormGrid>
            {/* Always on the form (no jump under the withdrawal field when the first digit is typed) and a polite live region,
                so the difference and tomorrow's cash are read out as they change (wig :341). */}
            <div aria-live="polite" aria-atomic="true">
              <DescriptionList
                layout="totals"
                items={[
                  {
                    label: k.difference,
                    value:
                      draft.counted === null
                        ? '—'
                        : figures.difference === 0
                          ? k.differenceNone
                          : fill(
                              figures.difference < 0 ? k.differenceShortBy : k.differenceOverBy,
                              {
                                amount: signedVnd(Math.abs(figures.difference), locale),
                              },
                            ),
                  },
                  {
                    label: k.nextFloat,
                    value:
                      draft.counted === null
                        ? '—'
                        : signedVnd(Math.max(0, figures.nextFloat), locale),
                    strong: true,
                  },
                ]}
              />
            </div>
            {figures.needsReason ? (
              <FormGrid>
                <Field label={k.reason} hint={k.reasonHint} error={invalid('reason')} required full>
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={3}
                      maxLength={500}
                      value={draft.reason}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, reason: event.target.value }))
                      }
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
