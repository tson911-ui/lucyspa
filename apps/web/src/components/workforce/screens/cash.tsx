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

const ZONE = 'Asia/Ho_Chi_Minh';

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
    if (!body) return;
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
              error={missing(draft.branches[entry.branch.id]) ? t.errors.validation : undefined}
              required
              full
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  unit="₫"
                  separator={locale === 'vi' ? '.' : ','}
                  value={draft.branches[entry.branch.id] ?? null}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      branches: { ...draft.branches, [entry.branch.id]: value },
                    })
                  }
                />
              )}
            </Field>
          ))}
          <Field
            label={g.bank}
            hint={g.hint}
            error={missing(draft.bank) ? t.errors.validation : undefined}
            required
            full
          >
            {(control) => (
              <MoneyInput
                {...control}
                unit="₫"
                separator={locale === 'vi' ? '.' : ','}
                value={draft.bank}
                onValueChange={(bank) => setDraft({ ...draft, bank })}
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
  const { locale } = useWorkforce();
  const c = cashDictionary(locale);
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
            panel: <CashReconcile branches={overview.branches} reloadToken={bump} />,
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
            { label: c.fund.balance, value: signedVnd(fund.balanceVnd, locale), strong: true },
            { label: c.fund.opening, value: signedVnd(fund.openingBalanceVnd, locale) },
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
                    value: (
                      <Badge tone="warning">
                        {fill(c.alert, {
                          n: overview.differenceAlerts,
                          amount: signedVnd(overview.alertThresholdVnd, locale),
                        })}
                      </Badge>
                    ),
                  },
                ]
              : []),
            {
              label: c.fund.since,
              value: overview.goLive ? formatDateTime(overview.goLive.at, ZONE, locale) : null,
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
