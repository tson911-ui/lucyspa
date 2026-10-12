import type { ReportBranchRef, RefundReport, RefundRow, RevenueMethod } from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { parseRange, type ReportRange } from './report.dates.js';
import type { ReportBranch, ReportContext } from './report.frame.js';

/**
 * Phase 8 P8-3 (R10, docs/PHASE8_REPORTS.md 4.2): refunds and corrections of a period, newest first: product refunds (the refunds of a
 * failed delivery are flagged), the money paid back on exchanges, and cash payments that were reversed (an erroneous record, which is
 * why such a payment is not revenue). Read-only; the day is the branch-local day of the event.
 */

export const REFUND_PAGE_SIZE = 20;

export interface RefundQuery {
  from?: unknown;
  to?: unknown;
  branchId?: unknown;
  page?: unknown;
}

function parsePage(value: unknown): number {
  if (value === undefined || value === '') return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) {
    throw new AuthError('VALIDATION_FAILED', 'page');
  }
  return Number(value);
}

const eventsSql = (branchIds: readonly string[], range: ReportRange) => Prisma.sql`
  scope AS (
    SELECT b.id, b.code, b.name, b.timezone,
           ((${range.from}::date)::timestamp AT TIME ZONE b.timezone) AS t_from,
           ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone) AS t_to
    FROM branches b WHERE b.id = ANY(${branchIds as string[]}::uuid[])
  ),
  events AS (
    SELECT 'REFUND'::text AS kind, (r.occurred_at AT TIME ZONE s.timezone)::date AS day, r.occurred_at AS at,
           r.branch_id, i.code AS invoice_code, r.amount_vnd,
           CASE r.method::text WHEN 'CASH' THEN 'CASH' ELSE 'TRANSFER' END AS method,
           r.reason, r.code, (r.settlement_id IS NOT NULL) AS failed_delivery
    FROM product_refunds r
    JOIN scope s ON s.id = r.branch_id
    JOIN invoices i ON i.id = r.invoice_id
    WHERE r.occurred_at >= s.t_from AND r.occurred_at < s.t_to
    UNION ALL
    SELECT 'EXCHANGE', (e.occurred_at AT TIME ZONE s.timezone)::date, e.occurred_at,
           e.branch_id, i.code, e.refund_vnd,
           CASE e.refund_method::text WHEN 'CASH' THEN 'CASH' ELSE 'TRANSFER' END,
           e.reason, e.code, false
    FROM product_exchanges e
    JOIN scope s ON s.id = e.branch_id
    JOIN invoices i ON i.id = e.invoice_id
    WHERE e.refund_vnd > 0 AND e.occurred_at >= s.t_from AND e.occurred_at < s.t_to
    UNION ALL
    SELECT 'PAYMENT_REVERSAL', (pc.occurred_at AT TIME ZONE s.timezone)::date, pc.occurred_at,
           p.branch_id, i.code, p.amount_vnd, p.method::text, pc.reason, NULL, false
    FROM payment_corrections pc
    JOIN payments p ON p.id = pc.payment_id
    JOIN scope s ON s.id = p.branch_id
    JOIN invoices i ON i.id = p.invoice_id
    WHERE pc.occurred_at >= s.t_from AND pc.occurred_at < s.t_to
  )`;

interface EventRow {
  kind: RefundRow['kind'];
  day: string;
  branch_id: string;
  invoice_code: string;
  amount: string;
  method: RevenueMethod;
  reason: string;
  code: string | null;
  failed_delivery: boolean;
}

/** The rows of the list, newest first. `limit` null = all of them (the export, capped by the caller). */
export async function loadRefundRows(
  context: ReportContext,
  branches: readonly ReportBranch[],
  range: ReportRange,
  window: { limit: number; offset: number },
): Promise<RefundRow[]> {
  if (branches.length === 0) return [];
  const byId = new Map(branches.map((b) => [b.id, b]));
  const rows = await context.tx.$queryRaw<EventRow[]>(Prisma.sql`
    WITH ${eventsSql(
      branches.map((b) => b.id),
      range,
    )}
    SELECT kind, to_char(day, 'YYYY-MM-DD') AS day, branch_id::text AS branch_id, invoice_code,
           amount_vnd::text AS amount, method, reason, code, failed_delivery
    FROM events
    ORDER BY at DESC, kind, code NULLS LAST
    LIMIT ${window.limit} OFFSET ${window.offset}`);
  return rows.map((row) => {
    const branch = byId.get(row.branch_id)!;
    return {
      kind: row.kind,
      date: row.day,
      branch: { id: branch.id, code: branch.code, name: branch.name } satisfies ReportBranchRef,
      invoiceCode: row.invoice_code,
      amountVnd: row.amount,
      method: row.method,
      reason: row.reason,
      code: row.code,
      failedDelivery: row.failed_delivery,
    };
  });
}

/** R10: one page of the list with the totals of the whole filter. */
export async function refundReport(
  context: ReportContext,
  query: RefundQuery,
): Promise<RefundReport> {
  const covered = context.scope(['VIEW_REVENUE'], query.branchId);
  const range = parseRange(query);
  const page = parsePage(query.page);
  const branchIds = covered.map((b) => b.id);

  const [summary] = await context.tx.$queryRaw<
    { n: number; refunds: string; exchanges: string; reversals: string }[]
  >(Prisma.sql`
    WITH ${eventsSql(branchIds, range)}
    SELECT count(*)::int AS n,
           COALESCE(sum(amount_vnd) FILTER (WHERE kind = 'REFUND'), 0)::text AS refunds,
           COALESCE(sum(amount_vnd) FILTER (WHERE kind = 'EXCHANGE'), 0)::text AS exchanges,
           COALESCE(sum(amount_vnd) FILTER (WHERE kind = 'PAYMENT_REVERSAL'), 0)::text AS reversals
    FROM events`);
  const [anomalies] = await context.tx.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n
    FROM payment_anomalies a
    JOIN branches b ON b.id = a.branch_id
    WHERE a.branch_id = ANY(${branchIds}::uuid[])
      AND a.opened_at >= ((${range.from}::date)::timestamp AT TIME ZONE b.timezone)
      AND a.opened_at < ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)`);

  const rows = await loadRefundRows(context, covered, range, {
    limit: REFUND_PAGE_SIZE,
    offset: (page - 1) * REFUND_PAGE_SIZE,
  });
  return {
    generatedAt: context.now.toISOString(),
    period: { from: range.from, to: range.to, previous: null },
    branches: covered.map(({ id, code, name }) => ({ id, code, name })),
    page,
    pageSize: REFUND_PAGE_SIZE,
    total: summary?.n ?? 0,
    totals: {
      refundsVnd: summary?.refunds ?? '0',
      exchangesVnd: summary?.exchanges ?? '0',
      reversalsVnd: summary?.reversals ?? '0',
      paymentAnomalies: anomalies?.n ?? 0,
    },
    rows,
  };
}
