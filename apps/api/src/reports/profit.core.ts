import {
  PROFIT_WITHOUT_COST_LIMIT,
  type ProfitProductRow,
  type ProfitReport,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { addDays, parseRange, type ReportRange } from './report.dates.js';
import type { ReportBranch, ReportContext } from './report.frame.js';
import { loadControlTotal } from './revenue.sql.js';

/**
 * Phase 8 P8-13 (docs/PHASE8_REPORTS.md 4.7): provisional profit, line by line (see `reports-profit.ts` for the definition). Whole shop only:
 * one pay run pays everybody, so there is no honest per-branch salary. Read-only; nothing is estimated and nothing is hidden.
 */
export interface ProfitQuery {
  from?: unknown;
  to?: unknown;
  restrictTo?: readonly ReportBranch[];
}

const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

/** The last day of the month that starts on `first`. */
function monthEnd(first: string): string {
  const [y, m] = first.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

/** The pay months that overlap the range: fully inside (counted) and partly inside (named, not counted). */
function monthsOf(range: ReportRange): { inside: string[]; partial: string[] } {
  const inside: string[] = [];
  const partial: string[] = [];
  let first = monthStart(range.from);
  while (first <= range.to) {
    const last = monthEnd(first);
    (first >= range.from && last <= range.to ? inside : partial).push(first);
    first = addDays(last, 1);
  }
  return { inside, partial };
}

const within = (column: string, range: ReportRange) => Prisma.sql`
  ${Prisma.raw(column)} >= ((${range.from}::date)::timestamp AT TIME ZONE b.timezone)
  AND ${Prisma.raw(column)} < ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)`;

export async function profitReport(
  context: ReportContext,
  query: ProfitQuery,
): Promise<ProfitReport> {
  const covered = query.restrictTo ?? context.scope(['VIEW_PROFIT']);
  if (covered.length !== context.allBranches.length) throw new AuthError('FORBIDDEN');
  const range = parseRange(query);
  const ids = covered.map((branch) => branch.id);
  const tx = context.tx;

  const { netVnd: revenue } = await loadControlTotal(tx, {
    branchIds: ids,
    from: range.from,
    to: range.to,
  });

  const [goods] = await tx.$queryRaw<
    { cogs: string; units: string; with_cost: string }[]
  >(Prisma.sql`
    SELECT COALESCE(sum((-m.quantity_delta)::bigint * l.unit_cost_vnd) FILTER (WHERE l.unit_cost_vnd IS NOT NULL), 0)::text AS cogs,
           COALESCE(sum(-m.quantity_delta), 0)::text AS units,
           COALESCE(sum(-m.quantity_delta) FILTER (WHERE l.unit_cost_vnd IS NOT NULL), 0)::text AS with_cost
    FROM stock_movements m
    JOIN inventory_lots l ON l.id = m.lot_id
    JOIN branches b ON b.id = m.branch_id
    WHERE m.branch_id = ANY(${ids}::uuid[])
      AND m.kind IN ('SALE', 'SALE_REVERSAL', 'REFUND_RETURN', 'EXCHANGE_RETURN')
      AND ${within('m.created_at', range)}`);
  const missing = await tx.$queryRaw<
    { variant_id: string; sku: string; name_vi: string; name_en: string; units: string }[]
  >(Prisma.sql`
    SELECT m.variant_id::text AS variant_id, v.sku,
           p.name_vi || COALESCE(' (' || v.label_vi || ')', '') AS name_vi,
           p.name_en || COALESCE(' (' || v.label_en || ')', '') AS name_en,
           sum(-m.quantity_delta)::text AS units
    FROM stock_movements m
    JOIN inventory_lots l ON l.id = m.lot_id AND l.unit_cost_vnd IS NULL
    JOIN branches b ON b.id = m.branch_id
    JOIN product_variants v ON v.id = m.variant_id
    JOIN products p ON p.id = v.product_id
    WHERE m.branch_id = ANY(${ids}::uuid[])
      AND m.kind IN ('SALE', 'SALE_REVERSAL', 'REFUND_RETURN', 'EXCHANGE_RETURN')
      AND ${within('m.created_at', range)}
    GROUP BY m.variant_id, v.sku, p.name_vi, p.name_en, v.label_vi, v.label_en
    HAVING sum(-m.quantity_delta) > 0
    ORDER BY sum(-m.quantity_delta) DESC, v.sku
    LIMIT ${PROFIT_WITHOUT_COST_LIMIT}`);

  const [earnings] = await tx.$queryRaw<{ tour: string; commission: string }[]>(Prisma.sql`
    SELECT COALESCE(sum(a.amount_vnd) FILTER (WHERE a.kind = 'TOUR'), 0)::text AS tour,
           COALESCE(sum(a.amount_vnd) FILTER (WHERE a.kind = 'PRODUCT_COMMISSION'), 0)::text AS commission
    FROM pay_earnings a
    WHERE a.branch_id = ANY(${ids}::uuid[]) AND a.business_date BETWEEN ${range.from}::date AND ${range.to}::date`);

  const months = monthsOf(range);
  const runs = months.inside.length
    ? await tx.$queryRaw<{ month: string; status: string; salaries: string }[]>(Prisma.sql`
        SELECT to_char(r.period_month, 'YYYY-MM-DD') AS month, r.status::text AS status,
               COALESCE((SELECT sum(i.amount_vnd) FROM pay_run_items i
                 WHERE i.run_id = r.id AND i.voided_at IS NULL
                   AND i.kind IN ('BASE_SALARY', 'CTV_WORK', 'BONUS', 'ADJUSTMENT', 'DEDUCTION')), 0)::text AS salaries
        FROM pay_runs r
        WHERE r.period_month = ANY(${months.inside}::date[])`)
    : [];
  const salaries = runs.reduce((total, run) => total + BigInt(run.salaries), 0n);

  const [expenses] = await tx.$queryRaw<{ total: string }[]>(Prisma.sql`
    SELECT COALESCE(sum(e.amount_vnd), 0)::text AS total
    FROM fund_entries e
    WHERE e.category = 'MANUAL_EXPENSE' AND e.branch_id = ANY(${ids}::uuid[])
      AND e.business_date BETWEEN ${range.from}::date AND ${range.to}::date
      AND NOT EXISTS (SELECT 1 FROM fund_entries c WHERE c.reverses_entry_id = e.id)`);
  const [live] = await tx.$queryRaw<{ n: string }[]>(
    Prisma.sql`SELECT count(*)::text AS n FROM finance_go_live`,
  );

  const cogs = BigInt(goods?.cogs ?? '0');
  const tour = BigInt(earnings?.tour ?? '0');
  const commission = BigInt(earnings?.commission ?? '0');
  const manual = BigInt(expenses?.total ?? '0');
  const units = Number(goods?.units ?? '0');
  const withCost = Number(goods?.with_cost ?? '0');
  return {
    generatedAt: context.now.toISOString(),
    period: { from: range.from, to: range.to, previous: null },
    branches: covered.map(({ id, code, name }) => ({ id, code, name })),
    started: Number(live?.n ?? '0') > 0,
    lines: {
      revenueVnd: revenue.toString(),
      costOfGoodsVnd: cogs.toString(),
      tourVnd: tour.toString(),
      commissionVnd: commission.toString(),
      salariesVnd: salaries.toString(),
      manualExpensesVnd: manual.toString(),
      profitVnd: (revenue - cogs - tour - commission - salaries - manual).toString(),
    },
    goods: {
      unitsSold: units,
      unitsWithCost: withCost,
      coverageBp: units <= 0 ? 10_000 : Math.round((withCost * 10_000) / units),
    },
    salaries: {
      monthsCounted: runs.length,
      monthsPartial: months.partial.length,
      monthsMissing: months.inside.length - runs.length,
      monthsDraft: runs.filter((run) => run.status === 'DRAFT').length,
    },
    withoutCost: missing.map((row): ProfitProductRow => ({
      variantId: row.variant_id,
      sku: row.sku,
      nameVi: row.name_vi,
      nameEn: row.name_en,
      unitsWithoutCost: Number(row.units),
    })),
  };
}
