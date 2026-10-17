'use client';

import type { BranchSummary, IncomePeriod, MyIncomeResponse } from '@lucy-spa/contracts';
import {
  Cluster,
  DataTable,
  DEFAULT_PAGE_SIZE,
  DateTextInput,
  DescriptionList,
  EmptyState,
  IconButton,
  ListSection,
  Select,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { fill } from '../../../i18n/workforce';
import { formatDate, formatVnd } from '../../../lib/workforce/format';
import { loadMyIncome, shiftAnchor } from '../../../lib/workforce/my-income';
import { normalizePage, normalizePageSize } from '../../../lib/workforce/list-view';
import { urlPaging } from '../../../lib/workforce/url-paging';
import { useBranches } from '../data';
import { useWorkforce } from '../session';
import { Empty, ErrorState, Loading, PageHeader, Section, useResource } from '../ui';

type IncomeItem = NonNullable<MyIncomeResponse['collaboratorWork']>['items'][number];

const PERIODS: IncomePeriod[] = ['DAY', 'WEEK', 'MONTH'];

const INCOME_DEFAULTS = { period: 'MONTH', date: '' };
const INCOME_OPTIONS = {
  normalize: (state: typeof INCOME_DEFAULTS) => ({
    period: (PERIODS as string[]).includes(state.period) ? state.period : 'MONTH',
    date: /^\d{4}-\d{2}-\d{2}$/.test(state.date) ? state.date : '',
  }),
};
/** The details table's pager, in the address bar too. */
const DETAILS_DEFAULTS = { detailsPage: 1, detailsSize: DEFAULT_PAGE_SIZE };
const DETAILS_OPTIONS = {
  normalize: (state: typeof DETAILS_DEFAULTS) => ({
    detailsPage: normalizePage(state.detailsPage),
    detailsSize: normalizePageSize(state.detailsSize),
  }),
};

/**
 * "Thu nhập của tôi / My Income" (follow-up Step 7): read-only, own data only. Collaborator
 * work pay by day / ISO week / month and the configured base salary for official employees;
 * sources that do not exist yet are named, never shown as 0. Not payroll.
 */
export function MyIncomeScreen() {
  const { api, t } = useWorkforce();
  const branches = useBranches(api);
  // Period and anchor day in the address bar (?period=WEEK&date=2026-10-12): Back/Forward and a shared link restore the view.
  const [url, update] = useUrlState(INCOME_DEFAULTS, INCOME_OPTIONS);
  const period = url.period as IncomePeriod;
  const date = url.date === '' ? null : url.date;
  const setPeriod = (value: IncomePeriod) => update({ period: value });
  const setDate = (value: string | null) => update({ date: value ?? '' });
  const income = useResource(() => loadMyIncome(api, period, date), [api, period, date]);
  const texts = t.myIncome;
  const anchor = date ?? income.data?.period.date ?? null;
  return (
    <>
      <PageHeader title={texts.title} intro={texts.intro} />
      <div role="toolbar" aria-label={texts.period}>
        <Cluster gap="inline" className="ls-toolbar-filters">
          <Select
            id="income-period"
            aria-label={texts.period}
            value={period}
            options={PERIODS.map((option) => ({ value: option, label: texts.periods[option] }))}
            onChange={(event) => setPeriod(event.target.value as IncomePeriod)}
          />
          <div className="ls-toolbar-group">
            <IconButton
              icon="chevron-left"
              label={texts.previous}
              disabled={!anchor}
              onClick={() => anchor && setDate(shiftAnchor(anchor, period, -1))}
            />
            <DateTextInput
              id="income-date"
              aria-label={texts.date}
              title={texts.date}
              value={anchor ?? ''}
              onChange={(event) => setDate(event.target.value === '' ? null : event.target.value)}
            />
            <IconButton
              icon="chevron-right"
              label={texts.next}
              disabled={!anchor}
              onClick={() => anchor && setDate(shiftAnchor(anchor, period, 1))}
            />
          </div>
        </Cluster>
      </div>
      {income.loading && !income.data ? <Loading t={t} /> : null}
      {income.error ? (
        <ErrorState error={income.error} t={t} onRetry={() => void income.reload()} />
      ) : null}
      {income.data ? <MyIncomeView income={income.data} branches={branches.data} /> : null}
    </>
  );
}

/** The loaded income (separated so it renders without a network in tests). */
export function MyIncomeView({
  income,
  branches,
}: {
  income: MyIncomeResponse;
  branches: ReadonlyMap<string, BranchSummary> | null;
}) {
  const { t, locale } = useWorkforce();
  const texts = t.myIncome;
  const work = t.collaboratorWork;
  const [pager, updatePager] = useUrlState(DETAILS_DEFAULTS, DETAILS_OPTIONS);
  const detailsPaging = urlPaging(
    pager.detailsPage,
    pager.detailsSize,
    ({ page, pageSize }) =>
      updatePager({
        ...(page !== undefined ? { detailsPage: page } : {}),
        ...(pageSize !== undefined ? { detailsSize: pageSize } : {}),
      }),
    t,
    texts.details,
  );
  const branchName = (id: string) => branches?.get(id)?.name ?? '—';
  const nothing =
    income.baseSalary === null &&
    income.collaboratorWork === null &&
    income.earnings === null &&
    income.unavailableSources.length === 0;
  const earned = (amount: string, count: number) => (
    <>
      <strong>{formatVnd(amount, locale)}</strong>
      {count > 0 ? ` (${fill(texts.earningsCount, { count })})` : null}
    </>
  );
  const items = income.collaboratorWork?.items ?? [];
  const byBranch = income.collaboratorWork?.byBranch ?? [];

  const itemColumns: DataTableColumn<IncomeItem>[] = [
    {
      key: 'date',
      header: work.workDate,
      mobileTitle: true,
      cell: (item) => formatDate(item.workDate, locale),
    },
    {
      key: 'branch',
      header: work.branch,
      wrap: true,
      cell: (item) => branchName(item.branchId),
    },
    { key: 'mode', header: work.mode, cell: (item) => work.modes[item.mode] },
    {
      key: 'time',
      header: work.time,
      numeric: true,
      cell: (item) => `${item.startTime}–${item.endTime}`,
    },
    {
      key: 'pay',
      header: work.pay,
      numeric: true,
      cell: (item) =>
        item.agreedPayVnd === null ? texts.unagreedValue : formatVnd(item.agreedPayVnd, locale),
    },
  ];
  type BranchRow = (typeof byBranch)[number];
  const branchColumns: DataTableColumn<BranchRow>[] = [
    {
      key: 'branch',
      header: work.branch,
      mobileTitle: true,
      wrap: true,
      cell: (row) => branchName(row.branchId),
    },
    { key: 'count', header: texts.count, numeric: true, cell: (row) => row.occurrenceCount },
    {
      key: 'total',
      header: texts.total,
      numeric: true,
      cell: (row) => formatVnd(row.totalAgreedPayVnd, locale),
    },
  ];

  return (
    <>
      <p className="ls-hint">
        {fill(texts.range, {
          from: formatDate(income.period.from, locale),
          to: formatDate(income.period.to, locale),
        })}
        {income.period.kind === 'WEEK' ? ` ${texts.weekNote}` : null}
      </p>
      {/* Empty states: a heading and one sentence; there is no action to take from here. */}
      {income.kind === 'OWNER' ? (
        <EmptyState icon="wallet" title={texts.ownerTitle}>
          {texts.ownerNote}
        </EmptyState>
      ) : null}
      {income.kind === 'EMPLOYEE' && nothing ? (
        <EmptyState icon="wallet" title={texts.emptyTitle}>
          {texts.empty}
        </EmptyState>
      ) : null}
      {income.baseSalary ? (
        <Section title={texts.baseSalary}>
          <p className="ls-stat-value">
            {income.baseSalary.amountVnd === null
              ? texts.baseSalaryNotSet
              : `${formatVnd(income.baseSalary.amountVnd, locale)} ${texts.perMonth}`}
          </p>
          <p className="ls-hint">{texts.baseSalaryNote}</p>
        </Section>
      ) : null}
      {income.earnings ? (
        <Section title={texts.earningsTitle}>
          <DescriptionList
            items={[
              {
                label: texts.earningsTour,
                value: earned(income.earnings.tourVnd, income.earnings.tourCount),
              },
              {
                label: texts.earningsCommission,
                value: earned(income.earnings.commissionVnd, income.earnings.commissionCount),
              },
              {
                label: texts.earningsTips,
                value: earned(income.earnings.tipsVnd, income.earnings.tipCount),
              },
            ]}
          />
          <p className="ls-hint">{texts.earningsNote}</p>
        </Section>
      ) : null}
      {income.collaboratorWork ? (
        <>
          <Section title={texts.ctvTitle}>
            <DescriptionList
              items={[
                {
                  label: texts.total,
                  value: (
                    <strong>{formatVnd(income.collaboratorWork.totalAgreedPayVnd, locale)}</strong>
                  ),
                },
                { label: texts.count, value: income.collaboratorWork.occurrenceCount },
                ...(income.collaboratorWork.unagreedCount > 0
                  ? [{ label: texts.unagreed, value: income.collaboratorWork.unagreedCount }]
                  : []),
              ]}
            />
            <p className="ls-hint">{texts.totalNote}</p>
            {items.length === 0 ? <Empty title={texts.noWorkTitle}>{texts.noWork}</Empty> : null}
          </Section>
          {byBranch.length > 1 ? (
            <ListSection title={texts.byBranch}>
              <DataTable
                mode="client"
                caption={fill(t.common.list.table, { list: texts.byBranch })}
                columns={branchColumns}
                rows={byBranch}
                rowKey={(row) => row.branchId}
                paging={{ off: 'One row per branch the collaborator worked at in the period.' }}
              />
            </ListSection>
          ) : null}
          {items.length > 0 ? (
            <ListSection title={texts.details}>
              <DataTable
                mode="client"
                caption={fill(t.common.list.table, { list: texts.details })}
                columns={itemColumns}
                rows={items}
                rowKey={(item) => item.id}
                paging={detailsPaging}
              />
            </ListSection>
          ) : null}
        </>
      ) : null}
      {income.unavailableSources.length > 0 ? (
        <Section title={texts.unavailableTitle}>
          <p className="ls-hint">{texts.unavailableNote}</p>
          <ul className="ls-list-plain">
            {income.unavailableSources.map((source) => (
              // An unknown source key shows its code rather than an empty item (wig my-income.tsx:249).
              <li key={source}>{texts.sources[source] ?? source}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
