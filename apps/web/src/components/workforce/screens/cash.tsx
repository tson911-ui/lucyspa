'use client';

import type { CashFundItem, CashGoLiveRequest, CashOverviewResponse } from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  DescriptionList,
  Field,
  FormDrawer,
  FormGrid,
  MoneyInput,
  Select,
  Tabs,
  useUrlState,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { cashDictionary } from '../../../i18n/cash';
import { fill } from '../../../i18n/workforce';
import {
  CASH_PAGE_DEFAULTS,
  CASH_RESET_KEYS,
  fundCan,
  goLiveBody,
  normalizeCashPage,
  signedVnd,
  vndNumber,
  type CashPageState,
  type GoLiveDraft,
} from '../../../lib/workforce/cash';
import { formatDate, formatDateTime } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { useWorkforce } from '../session';
import { useBranches } from '../data';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import { CashBook, EntryDialog, TransferDialog, useCommand } from './cash-book';
import { CashClosing } from './cash-closing';
import { CashReconcile } from './cash-reconcile';
import { focusFirstInvalid } from './pos-dom';

/**
 * "Sổ quỹ" (Phase 7 P7-6): each branch's cash and the shop's bank account. Before the Owner starts the book the page explains it and
 * offers the Owner the counted opening balances; after that it shows one fund at a time (its balance, then the book, the daily closing
 * and the reconciliation as tabs). The API decides every permission again; this screen only hides what a person cannot do.
 */
export function CashScreen() {
  const { api, t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const overview = useResource(() => api.get<CashOverviewResponse>('/api/v1/cash/overview'), [api]);
  if (overview.error && !overview.data) {
    return (
      <>
        <PageHeader title={c.title} intro={c.intro} />
        <ErrorState error={overview.error} t={t} onRetry={() => void overview.reload()} />
      </>
    );
  }
  if (!overview.data) return <Loading t={t} page />;
  return <CashView overview={overview.data} reload={() => overview.reload()} />;
}

export function CashView({
  overview,
  reload,
}: {
  overview: CashOverviewResponse;
  reload: () => Promise<void>;
}) {
  const { locale } = useWorkforce();
  const c = cashDictionary(locale);
  if (overview.goLive === null) {
    return (
      <>
        <PageHeader title={c.title} intro={c.intro} />
        <NotLive overview={overview} onStarted={reload} />
      </>
    );
  }
  return <LiveCash overview={overview} reload={reload} />;
}

function NotLive({
  overview,
  onStarted,
}: {
  overview: CashOverviewResponse;
  onStarted: () => Promise<void>;
}) {
  const { locale } = useWorkforce();
  const c = cashDictionary(locale);
  const [starting, setStarting] = useState(false);
  const notify = useSuccessToast();
  return (
    <>
      <Card as="section" aria-label={c.notLive.title}>
        <CardHeader
          title={c.notLive.title}
          actions={
            overview.canGoLive ? (
              <Button variant="primary" onClick={() => setStarting(true)}>
                {c.notLive.start}
              </Button>
            ) : undefined
          }
        />
        <Notice tone="info">{overview.canGoLive ? c.notLive.body : c.notLive.waiting}</Notice>
      </Card>
      {starting ? (
        <GoLiveDrawer
          overview={overview}
          onDone={() => {
            setStarting(false);
            notify(c.goLive.done);
            void onStarted();
          }}
          onClose={() => setStarting(false)}
        />
      ) : null}
    </>
  );
}

function GoLiveDrawer({
  overview,
  onDone,
  onClose,
}: {
  overview: CashOverviewResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const g = cashDictionary(locale).goLive;
  const [draft, setDraft] = useState<GoLiveDraft>({ branches: {}, bank: null });
  const [checked, setChecked] = useState(false);
  const command = useCommand();
  const ids = overview.branches.map((entry) => entry.branch.id);
  const missing = (value: number | null | undefined) => checked && (value ?? null) === null;

  async function submit() {
    setChecked(true);
    const body = goLiveBody(draft, ids);
    // A refused start moves focus to the first opening balance still missing (wig Forms: focus the first error on submit).
    if (!body) return focusFirstInvalid();
    await command.run<CashOverviewResponse>(
      '/api/v1/cash/go-live',
      body satisfies CashGoLiveRequest,
      onDone,
    );
  }

  return (
    <>
      <FormDrawer
        title={g.title}
        labels={{ ...formOverlayLabels(t, g.submit), submitting: g.submitting }}
        busy={command.pending}
        dirty={draft.bank !== null || Object.values(draft.branches).some((value) => value !== null)}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <p className="ls-hint">{g.description}</p>
        <FormGrid>
          {overview.branches.map((entry) => (
            <Field
              key={entry.branch.id}
              label={fill(g.branch, { name: entry.branch.name })}
              hint={g.hint}
              error={
                missing(draft.branches[entry.branch.id])
                  ? cashDictionary(locale).problems.opening
                  : undefined
              }
              required
              full
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  unit="₫"
                  locale={locale}
                  value={draft.branches[entry.branch.id] ?? null}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      branches: { ...current.branches, [entry.branch.id]: value },
                    }))
                  }
                />
              )}
            </Field>
          ))}
          <Field
            label={g.bank}
            hint={g.hint}
            error={missing(draft.bank) ? cashDictionary(locale).problems.opening : undefined}
            required
            full
          >
            {(control) => (
              <MoneyInput
                {...control}
                unit="₫"
                locale={locale}
                value={draft.bank}
                onValueChange={(bank) => setDraft((current) => ({ ...current, bank }))}
              />
            )}
          </Field>
        </FormGrid>
      </FormDrawer>
      {command.dialog}
    </>
  );
}

function LiveCash({
  overview,
  reload,
}: {
  overview: CashOverviewResponse;
  reload: () => Promise<void>;
}) {
  const { api, locale } = useWorkforce();
  const c = cashDictionary(locale);
  // Times and business days in the fund's branch time zone, from the branch list (wig :48); the shared bank fund uses the first
  // branch the person works with. Until the list answers, the device's zone (the counter stands in the branch).
  const branchList = useBranches(api);
  const [state, update] = useUrlState(CASH_PAGE_DEFAULTS, {
    normalize: normalizeCashPage,
    resetOnChange: CASH_RESET_KEYS,
  });
  const [dialog, setDialog] = useState<'entry' | 'transfer' | null>(null);
  const [bump, setBump] = useState(0);
  const notify = useSuccessToast();
  const funds = overview.funds;
  const fund: CashFundItem | undefined = funds.find((item) => item.id === state.fund) ?? funds[0];
  if (!fund) {
    return (
      <>
        <PageHeader title={c.title} intro={c.intro} />
        <Empty>{c.noAccess}</Empty>
      </>
    );
  }
  const zoneBranch = fund.branch?.id ?? overview.branches[0]?.branch.id ?? '';
  const zone =
    branchList.data?.get(zoneBranch)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const can = fundCan(fund, overview.branches);
  const changed = () => {
    setBump((value) => value + 1);
    void reload();
  };
  const tabs = [
    {
      id: 'book',
      label: c.tabs.book,
      panel: (
        <CashBook
          fund={fund}
          zone={zone}
          branches={overview.branches}
          state={state}
          update={(patch: Partial<CashPageState>) => update(patch)}
          reloadToken={bump}
          onTransfer={() => setDialog('transfer')}
          onChanged={changed}
        />
      ),
    },
    ...(fund.kind === 'CASH'
      ? [
          {
            id: 'closing',
            label: c.tabs.closing,
            panel: (
              <CashClosing
                zone={zone}
                fund={fund}
                page={state.page}
                onPage={(page) => update({ page })}
                defaultFloat={vndNumber(overview.defaultNextFloatVnd)}
                canClose={can.record}
                reloadToken={bump}
                onChanged={changed}
              />
            ),
          },
          {
            id: 'reconcile',
            label: c.tabs.reconcile,
            panel: <CashReconcile branches={overview.branches} reloadToken={bump} zone={zone} />,
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader title={c.title} intro={c.intro}>
        {can.record || can.deposit ? (
          <Button variant="primary" onClick={() => setDialog('entry')}>
            {c.actions.record}
          </Button>
        ) : null}
      </PageHeader>
      <Card as="section" aria-label={fund.name}>
        <CardHeader
          title={funds.length > 1 ? c.fund.summary : fund.name}
          actions={
            funds.length > 1 ? (
              <Select
                aria-label={c.fund.label}
                value={fund.id}
                options={funds.map((item) => ({ value: item.id, label: item.name }))}
                onChange={(event) =>
                  update({
                    fund: event.target.value,
                    tab: 'book',
                    category: '',
                    direction: '',
                    from: '',
                    to: '',
                  })
                }
              />
            ) : (
              <Badge tone="neutral">{fund.kind === 'CASH' ? c.fund.cash : c.fund.bank}</Badge>
            )
          }
        />
        <DescriptionList
          columns={2}
          items={[
            // Balances keep tabular figures (wig cash.tsx:331). The balance is emphasised by its own markup: the kit's `strong`
            // flag styles only a totals list, so it was a no-op here (wig anti-pattern, kit misuse).
            {
              label: c.fund.balance,
              value: (
                <strong className="ls-pos-figure">{signedVnd(fund.balanceVnd, locale)}</strong>
              ),
            },
            {
              label: c.fund.opening,
              value: (
                <span className="ls-pos-figure">{signedVnd(fund.openingBalanceVnd, locale)}</span>
              ),
            },
            ...(fund.kind === 'CASH'
              ? [
                  {
                    label: c.fund.lastClosed,
                    value: fund.lastClosedDate
                      ? formatDate(fund.lastClosedDate, locale)
                      : c.fund.never,
                  },
                ]
              : []),
            ...(overview.differenceAlerts > 0
              ? [
                  {
                    label: c.alertLabel,
                    // A badge is one short word that never wraps (DESIGN 8.7); the sentence follows as plain text.
                    value: (
                      <span className="ls-cell-stack">
                        <span>
                          <Badge tone="warning">{c.alertShort}</Badge>
                        </span>
                        <span>
                          {fill(c.alert, {
                            n: overview.differenceAlerts,
                            amount: signedVnd(overview.alertThresholdVnd, locale),
                          })}
                        </span>
                      </span>
                    ),
                  },
                ]
              : []),
            {
              label: c.fund.since,
              value: overview.goLive ? formatDateTime(overview.goLive.at, zone, locale) : null,
            },
          ]}
        />
      </Card>
      <Tabs
        label={c.tabsLabel}
        value={tabs.some((tab) => tab.id === state.tab) ? state.tab : 'book'}
        onChange={(id) => update({ tab: id, page: 1 })}
        tabs={tabs}
      />
      {dialog === 'entry' ? (
        <EntryDialog
          fund={fund}
          branches={overview.branches}
          onDone={() => {
            setDialog(null);
            notify(c.entry.done);
            changed();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'transfer' ? (
        <TransferDialog
          fund={fund}
          funds={funds}
          branches={overview.branches}
          onDone={() => {
            setDialog(null);
            notify(c.transfer.done);
            changed();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
