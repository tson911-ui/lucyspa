'use client';

import type { BranchSummary, IncomePeriod, MyIncomeResponse } from '@lucy-spa/contracts';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { formatDate, formatVnd } from '../../../lib/workforce/format';
import { loadMyIncome, shiftAnchor } from '../../../lib/workforce/my-income';
import { useBranches } from '../data';
import { useWorkforce } from '../session';
import { Empty, ErrorState, Field, Loading, PageHeader, Section, useResource } from '../ui';

const PERIODS: IncomePeriod[] = ['DAY', 'WEEK', 'MONTH'];

/**
 * "Thu nhập của tôi / My Income" (follow-up Step 7): read-only, own data only. Collaborator
 * work pay by day / ISO week / month and the configured base salary for official employees;
 * sources that do not exist yet are named, never shown as 0. Not payroll.
 */
export function MyIncomeScreen() {
  const { api, t } = useWorkforce();
  const branches = useBranches(api);
  const [period, setPeriod] = useState<IncomePeriod>('MONTH');
  const [date, setDate] = useState<string | null>(null);
  const income = useResource(() => loadMyIncome(api, period, date), [api, period, date]);
  const texts = t.myIncome;
  const anchor = date ?? income.data?.period.date ?? null;
  return (
    <>
      <PageHeader title={texts.title} intro={texts.intro} />
      <div className="wf-filters" role="group" aria-label={texts.title}>
        {PERIODS.map((option) => (
          <button
            key={option}
            type="button"
            className={`wf-button ${option === period ? 'wf-button-primary' : 'wf-button-quiet'}`}
            aria-pressed={option === period}
            onClick={() => setPeriod(option)}
          >
            {texts.periods[option]}
          </button>
        ))}
        <Field id="income-date" label={texts.date}>
          <input
            id="income-date"
            type="date"
            value={anchor ?? ''}
            onChange={(event) => setDate(event.target.value === '' ? null : event.target.value)}
          />
        </Field>
        <button
          type="button"
          className="wf-button wf-button-quiet"
          disabled={!anchor}
          onClick={() => anchor && setDate(shiftAnchor(anchor, period, -1))}
        >
          {texts.previous}
        </button>
        <button
          type="button"
          className="wf-button wf-button-quiet"
          disabled={!anchor}
          onClick={() => anchor && setDate(shiftAnchor(anchor, period, 1))}
        >
          {texts.next}
        </button>
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
  const branchName = (id: string) => branches?.get(id)?.name ?? '—';
  const nothing =
    income.baseSalary === null &&
    income.collaboratorWork === null &&
    income.unavailableSources.length === 0;
  return (
    <>
      <p className="wf-muted">
        {fill(texts.range, {
          from: formatDate(income.period.from, locale),
          to: formatDate(income.period.to, locale),
        })}
        {income.period.kind === 'WEEK' ? <span className="wf-hint"> {texts.weekNote}</span> : null}
      </p>
      {income.kind === 'OWNER' ? <Empty>{texts.ownerNote}</Empty> : null}
      {income.kind === 'EMPLOYEE' && nothing ? <Empty>{texts.empty}</Empty> : null}
      {income.baseSalary ? (
        <Section title={texts.baseSalary}>
          <p>
            <strong>
              {income.baseSalary.amountVnd === null
                ? texts.baseSalaryNotSet
                : `${formatVnd(income.baseSalary.amountVnd, locale)} ${texts.perMonth}`}
            </strong>
          </p>
          <p className="wf-hint">{texts.baseSalaryNote}</p>
        </Section>
      ) : null}
      {income.collaboratorWork ? (
        <Section title={texts.ctvTitle}>
          <dl className="wf-facts">
            <dt>{texts.total}</dt>
            <dd>
              <strong>{formatVnd(income.collaboratorWork.totalAgreedPayVnd, locale)}</strong>
            </dd>
            <dt>{texts.count}</dt>
            <dd>{income.collaboratorWork.occurrenceCount}</dd>
            {income.collaboratorWork.unagreedCount > 0 ? (
              <>
                <dt>{texts.unagreed}</dt>
                <dd>{income.collaboratorWork.unagreedCount}</dd>
              </>
            ) : null}
          </dl>
          <p className="wf-hint">{texts.totalNote}</p>
          {income.collaboratorWork.items.length === 0 ? <Empty>{texts.noWork}</Empty> : null}
          {income.collaboratorWork.byBranch.length > 1 ? (
            <>
              <h3>{texts.byBranch}</h3>
              <ul className="wf-plain-list">
                {income.collaboratorWork.byBranch.map((row) => (
                  <li key={row.branchId}>
                    {branchName(row.branchId)}: {formatVnd(row.totalAgreedPayVnd, locale)} ·{' '}
                    {row.occurrenceCount} {texts.count.toLowerCase()}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {income.collaboratorWork.items.length > 0 ? (
            <>
              <h3>{texts.details}</h3>
              <table className="wf-table">
                <thead>
                  <tr>
                    <th scope="col">{work.workDate}</th>
                    <th scope="col">{work.branch}</th>
                    <th scope="col">{work.mode}</th>
                    <th scope="col">{work.time}</th>
                    <th scope="col">{work.pay}</th>
                  </tr>
                </thead>
                <tbody>
                  {income.collaboratorWork.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label={work.workDate}>{formatDate(item.workDate, locale)}</td>
                      <td data-label={work.branch}>{branchName(item.branchId)}</td>
                      <td data-label={work.mode}>{work.modes[item.mode]}</td>
                      <td data-label={work.time}>
                        {item.startTime}–{item.endTime}
                      </td>
                      <td data-label={work.pay}>
                        {item.agreedPayVnd === null
                          ? texts.unagreedValue
                          : formatVnd(item.agreedPayVnd, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </Section>
      ) : null}
      {income.unavailableSources.length > 0 ? (
        <Section title={texts.unavailableTitle}>
          <p className="wf-hint">{texts.unavailableNote}</p>
          <ul className="wf-plain-list">
            {income.unavailableSources.map((source) => (
              <li key={source}>{texts.sources[source]}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
