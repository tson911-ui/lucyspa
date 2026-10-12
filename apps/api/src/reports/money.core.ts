import {
  MONEY_ROW_LIMIT,
  PAYROLL_KINDS,
  type AdvanceRow,
  type AdvancesReport,
  type CashCategoryRow,
  type CashDailyReport,
  type CashDayRow,
  type CashDifferenceRow,
  type CashDifferencesReport,
  type CashFundRow,
  type CashFundsReport,
  type LabourCostReport,
  type PayrollKind,
  type PayrollMonthRow,
  type PayrollMonthlyReport,
  type ReportBranchRef,
  type TipRow,
  type TipsReport,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { alertThreshold } from '../finance/cash.core.js';
import { addDays, parseRange } from './report.dates.js';
import type { ReportBranch, ReportContext } from './report.frame.js';
import { loadFacts } from './revenue.sql.js';

/**
 * Phase 8 P8-12 (docs/PHASE8_REPORTS.md 4.6): cash, tips and payroll. Read-only views of the Phase 7 books; the arithmetic is the books' own
 * (a closed day shows what its closing stored, an open day the entries so far; a pay month is the sum of its unvoided items). Nothing is
 * estimated, and before the Owner started the cash book (`finance_go_live`) the reports say so instead of showing zeros.
 */
export interface MoneyQuery {
  from?: unknown;
  to?: unknown;
  branchId?: unknown;
  restrictTo?: readonly ReportBranch[];
}

const SIGNED = Prisma.raw(`CASE WHEN e.direction = 'IN' THEN e.amount_vnd ELSE -e.amount_vnd END`);

async function goLive(
  context: ReportContext,
): Promise<{ started: boolean; startedAt: string | null }> {
  const rows = await context.tx.$queryRaw<{ at: Date }[]>(
    Prisma.sql`SELECT at FROM finance_go_live WHERE id = 1`,
  );
  const at = rows[0]?.at;
  return { started: at !== undefined, startedAt: at ? at.toISOString() : null };
}

const refs = (branches: readonly ReportBranch[]): ReportBranchRef[] =>
  branches.map(({ id, code, name }) => ({ id, code, name }));

/** Pay data of the whole shop (one pay run per month): the person must hold the permissions at every active branch. */
function shopWide(
  context: ReportContext,
  requires: Parameters<ReportContext['scope']>[0],
  query: MoneyQuery,
): readonly ReportBranch[] {
  const covered = query.restrictTo ?? context.scope(requires);
  if (covered.length !== context.allBranches.length) throw new AuthError('FORBIDDEN');
  return covered;
}

const toBigint = (value: string | bigint | null): bigint => BigInt(value ?? 0);

// ------------------------------------------------------------------------------------------------------------- K1 daily cash

export async function cashDaily(
  context: ReportContext,
  query: MoneyQuery,
): Promise<CashDailyReport> {
  const covered = query.restrictTo ?? context.scope(['VIEW_CASH'], query.branchId);
  const range = parseRange(query);
  const live = await goLive(context);
  const empty: CashDailyReport = {
    generatedAt: context.now.toISOString(),
    branches: refs(covered),
    ...live,
    period: { from: range.from, to: range.to, previous: null },
    rows: [],
    byCategory: [],
    totals: { cashInVnd: '0', cashOutVnd: '0', differenceVnd: '0', closedDays: 0, openDays: 0 },
    truncated: false,
  };
  if (!live.started) return empty;
  const ids = covered.map((b) => b.id);
  const rows = await context.tx.$queryRaw<
    {
      branch_id: string;
      day: string;
      closed: boolean;
      opening: string;
      cash_in: string;
      cash_out: string;
      expected: string | null;
      counted: string | null;
      difference: string | null;
      reason: string | null;
      withdrawal: string | null;
    }[]
  >(Prisma.sql`
    WITH funds AS (
      SELECT f.id, f.branch_id, f.opening_balance_vnd FROM cash_funds f
      WHERE f.kind = 'CASH' AND f.branch_id = ANY(${ids}::uuid[])
    ),
    days AS (
      SELECT e.fund_id, e.business_date AS d FROM fund_entries e JOIN funds f ON f.id = e.fund_id
      WHERE e.business_date BETWEEN ${range.from}::date AND ${range.to}::date
      UNION
      SELECT c.fund_id, c.business_date FROM cash_day_closings c JOIN funds f ON f.id = c.fund_id
      WHERE c.business_date BETWEEN ${range.from}::date AND ${range.to}::date
    ),
    sums AS (
      SELECT e.fund_id, e.business_date AS d,
             COALESCE(sum(e.amount_vnd) FILTER (WHERE e.direction = 'IN'), 0) AS cash_in,
             COALESCE(sum(e.amount_vnd) FILTER (WHERE e.direction = 'OUT'), 0) AS cash_out
      FROM fund_entries e JOIN funds f ON f.id = e.fund_id
      WHERE e.business_date BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY e.fund_id, e.business_date
    )
    SELECT f.branch_id::text AS branch_id, to_char(days.d, 'YYYY-MM-DD') AS day, (c.id IS NOT NULL) AS closed,
           COALESCE(c.opening_float_vnd, f.opening_balance_vnd + (
             SELECT COALESCE(sum(${SIGNED}), 0) FROM fund_entries e WHERE e.fund_id = f.id AND e.business_date < days.d
           ))::text AS opening,
           COALESCE(c.cash_in_vnd, s.cash_in, 0)::text AS cash_in, COALESCE(c.cash_out_vnd, s.cash_out, 0)::text AS cash_out,
           c.expected_vnd::text AS expected, c.counted_vnd::text AS counted, c.difference_vnd::text AS difference,
           c.reason, c.withdrawal_vnd::text AS withdrawal
    FROM days
    JOIN funds f ON f.id = days.fund_id
    LEFT JOIN cash_day_closings c ON c.fund_id = days.fund_id AND c.business_date = days.d
    LEFT JOIN sums s ON s.fund_id = days.fund_id AND s.d = days.d
    ORDER BY days.d DESC, f.branch_id
    LIMIT ${MONEY_ROW_LIMIT + 1}`);
  const byId = new Map(refs(covered).map((b) => [b.id, b]));
  const mapped: CashDayRow[] = rows.map((row) => {
    const opening = toBigint(row.opening);
    const cashIn = toBigint(row.cash_in);
    const cashOut = toBigint(row.cash_out);
    return {
      branch: byId.get(row.branch_id)!,
      date: row.day,
      closed: row.closed,
      openingFloatVnd: opening.toString(),
      cashInVnd: cashIn.toString(),
      cashOutVnd: cashOut.toString(),
      expectedVnd: (row.expected === null
        ? opening + cashIn - cashOut
        : toBigint(row.expected)
      ).toString(),
      countedVnd: row.counted,
      differenceVnd: row.difference,
      reason: row.reason,
      withdrawalVnd: row.withdrawal,
    };
  });
  const kept = mapped.slice(0, MONEY_ROW_LIMIT);
  const categories = await context.tx.$queryRaw<
    { category: string; in_vnd: string; out_vnd: string }[]
  >(Prisma.sql`
    SELECT e.category::text AS category,
           COALESCE(sum(e.amount_vnd) FILTER (WHERE e.direction = 'IN'), 0)::text AS in_vnd,
           COALESCE(sum(e.amount_vnd) FILTER (WHERE e.direction = 'OUT'), 0)::text AS out_vnd
    FROM fund_entries e JOIN cash_funds f ON f.id = e.fund_id AND f.kind = 'CASH'
    WHERE f.branch_id = ANY(${ids}::uuid[]) AND e.business_date BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY e.category ORDER BY e.category`);
  const sum = (pick: (row: CashDayRow) => string | null) =>
    kept.reduce((total, row) => total + toBigint(pick(row)), 0n).toString();
  return {
    ...empty,
    rows: kept,
    truncated: mapped.length > MONEY_ROW_LIMIT,
    byCategory: categories.map((row): CashCategoryRow => ({
      category: row.category,
      inVnd: row.in_vnd,
      outVnd: row.out_vnd,
    })),
    totals: {
      cashInVnd: sum((row) => row.cashInVnd),
      cashOutVnd: sum((row) => row.cashOutVnd),
      differenceVnd: sum((row) => row.differenceVnd),
      closedDays: kept.filter((row) => row.closed).length,
      openDays: kept.filter((row) => !row.closed).length,
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- K2 fund balances

export async function cashFunds(
  context: ReportContext,
  query: MoneyQuery,
): Promise<CashFundsReport> {
  const covered = query.restrictTo ?? context.scope(['VIEW_CASH'], query.branchId);
  const range = parseRange(query);
  const live = await goLive(context);
  // The shared bank fund is shown only to a person who may read the cash at every active branch (and did not narrow the view).
  const bankIncluded =
    query.branchId === undefined &&
    query.restrictTo === undefined &&
    context.allBranches.length > 0 &&
    context.allBranches.every((branch) => context.can('VIEW_CASH', branch.id));
  const base: CashFundsReport = {
    generatedAt: context.now.toISOString(),
    branches: refs(covered),
    ...live,
    period: { from: range.from, to: range.to, previous: null },
    rows: [],
    bankIncluded,
  };
  if (!live.started) return base;
  const ids = covered.map((b) => b.id);
  const rows = await context.tx.$queryRaw<
    {
      id: string;
      kind: 'CASH' | 'BANK';
      branch_id: string | null;
      name: string;
      opening: string;
      in_vnd: string;
      out_vnd: string;
      balance: string;
      last_closed: string | null;
    }[]
  >(Prisma.sql`
    SELECT f.id::text AS id, f.kind::text AS kind, f.branch_id::text AS branch_id, f.name, f.opening_balance_vnd::text AS opening,
           COALESCE(sum(e.amount_vnd) FILTER (WHERE e.direction = 'IN' AND e.business_date BETWEEN ${range.from}::date AND ${range.to}::date), 0)::text AS in_vnd,
           COALESCE(sum(e.amount_vnd) FILTER (WHERE e.direction = 'OUT' AND e.business_date BETWEEN ${range.from}::date AND ${range.to}::date), 0)::text AS out_vnd,
           (f.opening_balance_vnd + COALESCE(sum(${SIGNED}) FILTER (WHERE e.business_date <= ${range.to}::date), 0))::text AS balance,
           (SELECT to_char(max(c.business_date), 'YYYY-MM-DD') FROM cash_day_closings c
             WHERE c.fund_id = f.id AND c.business_date <= ${range.to}::date) AS last_closed
    FROM cash_funds f LEFT JOIN fund_entries e ON e.fund_id = f.id
    WHERE f.is_active AND ((f.kind = 'CASH' AND f.branch_id = ANY(${ids}::uuid[])) OR (f.kind = 'BANK' AND ${bankIncluded}::boolean))
    GROUP BY f.id
    ORDER BY f.kind, f.name, f.id`);
  const byId = new Map(refs(covered).map((b) => [b.id, b]));
  return {
    ...base,
    rows: rows.map((row): CashFundRow => ({
      fundId: row.id,
      kind: row.kind,
      branch: row.branch_id === null ? null : (byId.get(row.branch_id) ?? null),
      name: row.name,
      openingBalanceVnd: row.opening,
      inVnd: row.in_vnd,
      outVnd: row.out_vnd,
      balanceVnd: row.balance,
      lastClosedDate: row.kind === 'CASH' ? row.last_closed : null,
    })),
  };
}

// ----------------------------------------------------------------------------------------------------------- K3 differences

export async function cashDifferences(
  context: ReportContext,
  query: MoneyQuery,
): Promise<CashDifferencesReport> {
  const covered = query.restrictTo ?? context.scope(['VIEW_CASH'], query.branchId);
  const range = parseRange(query);
  const live = await goLive(context);
  const threshold = await alertThreshold(context.tx);
  const base: CashDifferencesReport = {
    generatedAt: context.now.toISOString(),
    branches: refs(covered),
    ...live,
    period: { from: range.from, to: range.to, previous: null },
    alertThresholdVnd: threshold.toString(),
    rows: [],
    totals: { differenceVnd: '0', days: 0, alerts: 0 },
    truncated: false,
  };
  if (!live.started) return base;
  const ids = covered.map((b) => b.id);
  const rows = await context.tx.$queryRaw<
    {
      branch_id: string;
      day: string;
      expected: string;
      counted: string;
      difference: string;
      reason: string | null;
      closed_by: string | null;
    }[]
  >(Prisma.sql`
    SELECT c.branch_id::text AS branch_id, to_char(c.business_date, 'YYYY-MM-DD') AS day, c.expected_vnd::text AS expected,
           c.counted_vnd::text AS counted, c.difference_vnd::text AS difference, c.reason, u.full_name AS closed_by
    FROM cash_day_closings c
    JOIN cash_funds f ON f.id = c.fund_id AND f.kind = 'CASH'
    LEFT JOIN users u ON u.id = c.closed_by_user_id
    WHERE c.branch_id = ANY(${ids}::uuid[]) AND c.business_date BETWEEN ${range.from}::date AND ${range.to}::date
      AND c.difference_vnd <> 0
    ORDER BY c.business_date DESC, c.branch_id
    LIMIT ${MONEY_ROW_LIMIT + 1}`);
  const [total] = await context.tx.$queryRaw<
    { sum: string; n: string; alerts: string }[]
  >(Prisma.sql`
    SELECT COALESCE(sum(c.difference_vnd), 0)::text AS sum, count(*)::text AS n,
           (count(*) FILTER (WHERE abs(c.difference_vnd) >= ${threshold}))::text AS alerts
    FROM cash_day_closings c JOIN cash_funds f ON f.id = c.fund_id AND f.kind = 'CASH'
    WHERE c.branch_id = ANY(${ids}::uuid[]) AND c.business_date BETWEEN ${range.from}::date AND ${range.to}::date
      AND c.difference_vnd <> 0`);
  const byId = new Map(refs(covered).map((b) => [b.id, b]));
  const mapped: CashDifferenceRow[] = rows.map((row) => ({
    branch: byId.get(row.branch_id)!,
    date: row.day,
    expectedVnd: row.expected,
    countedVnd: row.counted,
    differenceVnd: row.difference,
    reason: row.reason,
    closedByName: row.closed_by,
    alert: BigInt(row.difference) >= threshold || -BigInt(row.difference) >= threshold,
  }));
  return {
    ...base,
    rows: mapped.slice(0, MONEY_ROW_LIMIT),
    truncated: mapped.length > MONEY_ROW_LIMIT,
    totals: {
      differenceVnd: total?.sum ?? '0',
      days: Number(total?.n ?? '0'),
      alerts: Number(total?.alerts ?? '0'),
    },
  };
}

// --------------------------------------------------------------------------------------------------------------------- T1 tips

export async function tipsReport(context: ReportContext, query: MoneyQuery): Promise<TipsReport> {
  const covered = query.restrictTo ?? context.scope(['VIEW_EMPLOYEE_PAY'], query.branchId);
  const range = parseRange(query);
  const live = await goLive(context);
  const ids = covered.map((b) => b.id);
  const rows = await context.tx.$queryRaw<
    {
      user_id: string;
      name: string;
      code: string | null;
      cash: string;
      transfer: string;
      in_run: string;
      entries: string;
    }[]
  >(Prisma.sql`
    WITH signed AS (
      SELECT t.employee_user_id, t.method, t.run_id,
             t.amount_vnd AS amount
      FROM tips t
      WHERE t.branch_id = ANY(${ids}::uuid[]) AND t.business_date BETWEEN ${range.from}::date AND ${range.to}::date
    )
    SELECT s.employee_user_id::text AS user_id, u.full_name AS name, ep.employee_code_canonical AS code,
           COALESCE(sum(s.amount) FILTER (WHERE s.method = 'CASH'), 0)::text AS cash,
           COALESCE(sum(s.amount) FILTER (WHERE s.method = 'TRANSFER'), 0)::text AS transfer,
           COALESCE(sum(s.amount) FILTER (WHERE s.run_id IS NOT NULL), 0)::text AS in_run,
           count(*)::text AS entries
    FROM signed s
    JOIN users u ON u.id = s.employee_user_id
    LEFT JOIN employee_profiles ep ON ep.user_id = u.id
    GROUP BY s.employee_user_id, u.full_name, ep.employee_code_canonical
    ORDER BY u.full_name, s.employee_user_id
    LIMIT ${MONEY_ROW_LIMIT + 1}`);
  const mapped: TipRow[] = rows.map((row) => {
    const cash = toBigint(row.cash);
    const transfer = toBigint(row.transfer);
    const inRun = toBigint(row.in_run);
    return {
      userId: row.user_id,
      name: row.name,
      employeeCode: row.code,
      cashVnd: cash.toString(),
      transferVnd: transfer.toString(),
      totalVnd: (cash + transfer).toString(),
      inRunVnd: inRun.toString(),
      owedVnd: (cash + transfer - inRun).toString(),
      entries: Number(row.entries),
    };
  });
  const kept = mapped.slice(0, MONEY_ROW_LIMIT);
  const sum = (pick: (row: TipRow) => string) =>
    kept.reduce((total, row) => total + BigInt(pick(row)), 0n).toString();
  return {
    generatedAt: context.now.toISOString(),
    branches: refs(covered),
    ...live,
    period: { from: range.from, to: range.to, previous: null },
    rows: kept,
    truncated: mapped.length > MONEY_ROW_LIMIT,
    totals: {
      cashVnd: sum((row) => row.cashVnd),
      transferVnd: sum((row) => row.transferVnd),
      totalVnd: sum((row) => row.totalVnd),
      owedVnd: sum((row) => row.owedVnd),
    },
  };
}

// -------------------------------------------------------------------------------------------------------------- P1 payroll months

const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

async function runRows(context: ReportContext, from: string, to: string) {
  return context.tx.$queryRaw<
    {
      id: string;
      month: string;
      status: 'DRAFT' | 'CLOSED' | 'PAID';
      pay_day: string | null;
      people: string;
    }[]
  >(Prisma.sql`
    SELECT r.id::text AS id, to_char(r.period_month, 'YYYY-MM-DD') AS month, r.status::text AS status,
           to_char(r.payment_day, 'YYYY-MM-DD') AS pay_day,
           (SELECT count(*) FROM pay_run_lines l WHERE l.run_id = r.id)::text AS people
    FROM pay_runs r
    WHERE r.period_month BETWEEN ${monthStart(from)}::date AND ${monthStart(to)}::date
    ORDER BY r.period_month DESC`);
}

async function runKinds(context: ReportContext, runIds: readonly string[]) {
  if (runIds.length === 0) return new Map<string, Map<string, bigint>>();
  const rows = await context.tx.$queryRaw<
    { run_id: string; kind: string; amount: string }[]
  >(Prisma.sql`
    SELECT i.run_id::text AS run_id, i.kind::text AS kind, sum(i.amount_vnd)::text AS amount
    FROM pay_run_items i
    WHERE i.run_id = ANY(${runIds}::uuid[]) AND i.voided_at IS NULL
    GROUP BY i.run_id, i.kind`);
  const byRun = new Map<string, Map<string, bigint>>();
  for (const row of rows) {
    const kinds = byRun.get(row.run_id) ?? new Map<string, bigint>();
    kinds.set(row.kind, BigInt(row.amount));
    byRun.set(row.run_id, kinds);
  }
  return byRun;
}

export async function payrollMonthly(
  context: ReportContext,
  query: MoneyQuery,
): Promise<PayrollMonthlyReport> {
  const covered = shopWide(context, ['VIEW_EMPLOYEE_PAY'], query);
  const range = parseRange(query);
  const live = await goLive(context);
  const base: PayrollMonthlyReport = {
    generatedAt: context.now.toISOString(),
    branches: refs(covered),
    ...live,
    period: { from: range.from, to: range.to, previous: null },
    rows: [],
    totals: { netVnd: '0', tipsVnd: '0' },
  };
  if (!live.started) return base;
  const runs = await runRows(context, range.from, range.to);
  const kinds = await runKinds(
    context,
    runs.map((run) => run.id),
  );
  const rows: PayrollMonthRow[] = runs.map((run) => {
    const mine = kinds.get(run.id) ?? new Map<string, bigint>();
    const byKind = Object.fromEntries(
      PAYROLL_KINDS.map((kind) => [kind, (mine.get(kind) ?? 0n).toString()]),
    ) as Record<PayrollKind, string>;
    const net = PAYROLL_KINDS.reduce((total, kind) => total + (mine.get(kind) ?? 0n), 0n);
    return {
      month: run.month,
      status: run.status,
      paymentDay: run.pay_day,
      people: Number(run.people),
      byKind,
      netVnd: net.toString(),
      tipsVnd: (mine.get('TIP') ?? 0n).toString(),
    };
  });
  const sum = (pick: (row: PayrollMonthRow) => string) =>
    rows.reduce((total, row) => total + BigInt(pick(row)), 0n).toString();
  return {
    ...base,
    rows,
    totals: { netVnd: sum((row) => row.netVnd), tipsVnd: sum((row) => row.tipsVnd) },
  };
}

// ------------------------------------------------------------------------------------------------- P2 labour cost against revenue

const lastOfMonth = (monthFirst: string): string => {
  const [y, m] = monthFirst.split('-').map(Number) as [number, number];
  return addDays(
    `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`,
    -1,
  );
};

export async function labourCost(
  context: ReportContext,
  query: MoneyQuery,
): Promise<LabourCostReport> {
  const covered = shopWide(context, ['VIEW_EMPLOYEE_PAY', 'VIEW_REVENUE'], query);
  const range = parseRange(query);
  const live = await goLive(context);
  const base: LabourCostReport = {
    generatedAt: context.now.toISOString(),
    branches: refs(covered),
    ...live,
    period: { from: range.from, to: range.to, previous: null },
    rows: [],
  };
  if (!live.started) return base;
  const runs = await runRows(context, range.from, range.to);
  const kinds = await runKinds(
    context,
    runs.map((run) => run.id),
  );
  // Revenue of every pay month in ONE pass of the revenue facts (the very module of the Doanh thu report), then added up per month.
  const net = new Map<string, bigint>();
  if (runs.length > 0) {
    const first = runs.map((run) => run.month).sort()[0]!;
    const last = lastOfMonth(
      runs
        .map((run) => run.month)
        .sort()
        .at(-1)!,
    );
    const facts = await loadFacts(context.tx, {
      branchIds: covered.map((branch) => branch.id),
      from: first,
      to: last,
    });
    for (const fact of facts) {
      const key = monthStart(fact.day);
      net.set(key, (net.get(key) ?? 0n) + fact.amountVnd);
    }
  }
  const rows: LabourCostReport['rows'] = runs.map((run) => {
    const mine = kinds.get(run.id) ?? new Map<string, bigint>();
    const labour = [...mine.values()].reduce((total, value) => total + value, 0n);
    const revenue = net.get(run.month) ?? 0n;
    return {
      month: run.month,
      status: run.status,
      labourVnd: labour.toString(),
      revenueVnd: revenue.toString(),
      shareBp: revenue <= 0n ? null : Number((labour * 10000n * 2n + revenue) / (revenue * 2n)),
    };
  });
  return { ...base, rows };
}

// --------------------------------------------------------------------------------------------------------------- P3 advances

export async function advancesReport(
  context: ReportContext,
  query: MoneyQuery,
): Promise<AdvancesReport> {
  const covered = shopWide(context, ['VIEW_EMPLOYEE_PAY'], query);
  const live = await goLive(context);
  const base: AdvancesReport = {
    generatedAt: context.now.toISOString(),
    branches: refs(covered),
    ...live,
    rows: [],
    totals: { outstandingVnd: '0', pendingVnd: '0' },
  };
  if (!live.started) return base;
  const rows = await context.tx.$queryRaw<
    {
      user_id: string;
      name: string;
      code: string | null;
      paid: string;
      recovered: string;
      pending_count: string;
      pending: string;
    }[]
  >(Prisma.sql`
    SELECT a.employee_user_id::text AS user_id, u.full_name AS name, ep.employee_code_canonical AS code,
           COALESCE(sum(a.amount_vnd) FILTER (WHERE a.status = 'PAID'), 0)::text AS paid,
           COALESCE(sum(r.recovered) FILTER (WHERE a.status = 'PAID'), 0)::text AS recovered,
           (count(*) FILTER (WHERE a.status IN ('REQUESTED', 'APPROVED')))::text AS pending_count,
           COALESCE(sum(a.amount_vnd) FILTER (WHERE a.status IN ('REQUESTED', 'APPROVED')), 0)::text AS pending
    FROM salary_advances a
    CROSS JOIN LATERAL (
      SELECT COALESCE(-sum(i.amount_vnd), 0) AS recovered FROM pay_run_items i
      WHERE i.advance_id = a.id AND i.voided_at IS NULL AND i.kind = 'ADVANCE_RECOVERY'
    ) r
    JOIN users u ON u.id = a.employee_user_id
    LEFT JOIN employee_profiles ep ON ep.user_id = u.id
    WHERE a.status IN ('PAID', 'REQUESTED', 'APPROVED')
    GROUP BY a.employee_user_id, u.full_name, ep.employee_code_canonical
    ORDER BY u.full_name, a.employee_user_id`);
  const mapped: AdvanceRow[] = rows
    .map((row) => {
      const paid = toBigint(row.paid);
      const recovered = toBigint(row.recovered);
      return {
        userId: row.user_id,
        name: row.name,
        employeeCode: row.code,
        paidVnd: paid.toString(),
        recoveredVnd: recovered.toString(),
        outstandingVnd: (paid - recovered).toString(),
        pendingCount: Number(row.pending_count),
        pendingVnd: row.pending,
      };
    })
    .filter((row) => BigInt(row.outstandingVnd) > 0n || row.pendingCount > 0);
  const sum = (pick: (row: AdvanceRow) => string) =>
    mapped.reduce((total, row) => total + BigInt(pick(row)), 0n).toString();
  return {
    ...base,
    rows: mapped,
    totals: {
      outstandingVnd: sum((row) => row.outstandingVnd),
      pendingVnd: sum((row) => row.pendingVnd),
    },
  };
}
