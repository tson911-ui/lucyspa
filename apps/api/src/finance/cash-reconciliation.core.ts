import {
  CASH_RECONCILIATION_KEYS,
  type CashReconciliationKey,
  type CashReconciliationResponse,
  type CashReconciliationRow,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { canViewAt } from './cash.access.js';
import { financeGoLive } from './cash.core.js';
import { uuid } from './finance.input.js';

/**
 * Phase 7 P7-5 (design 7.5): the reconciliation of one branch. For every kind of money source (a payment, a cash reversal, a refund, an
 * exchange refund) it adds up the SOURCE rows recorded since go-live in the period and the book entries made from those same rows. By
 * construction the two are equal; the screen exists to prove it and to show what is still missing ("unposted") or different.
 * Read-only: nothing is posted here.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
};

interface Source {
  key: CashReconciliationKey;
  /** FROM + WHERE over the source rows `s` of the branch, since go-live, in the period. */
  from: (branchId: string, goLive: Date, from: string, to: string) => Prisma.Sql;
  type: string;
}

const periodOf = (date: Prisma.Sql, from: string, to: string) =>
  Prisma.sql`${date} >= ${from}::date AND ${date} <= ${to}::date`;

const SOURCES: Source[] = [
  {
    key: 'PAYMENT_CASH',
    type: 'PAYMENT',
    from: (
      b,
      g,
      f,
      t,
    ) => Prisma.sql`payments s WHERE s.branch_id = ${b}::uuid AND s.method = 'CASH' AND s.status = 'SUCCEEDED'
      AND s.collected_at >= ${g} AND ${periodOf(Prisma.sql`s.business_date`, f, t)}`,
  },
  {
    key: 'PAYMENT_BANK',
    type: 'PAYMENT',
    from: (
      b,
      g,
      f,
      t,
    ) => Prisma.sql`payments s WHERE s.branch_id = ${b}::uuid AND s.method <> 'CASH' AND s.status = 'SUCCEEDED'
      AND s.collected_at >= ${g} AND ${periodOf(Prisma.sql`s.business_date`, f, t)}`,
  },
  {
    key: 'PAYMENT_REVERSAL',
    type: 'PAYMENT_CORRECTION',
    from: (
      b,
      g,
      f,
      t,
    ) => Prisma.sql`(SELECT pc.id, p.amount_vnd, pc.occurred_at, p.branch_id FROM payment_corrections pc
        JOIN payments p ON p.id = pc.payment_id AND p.method = 'CASH') s
      WHERE s.branch_id = ${b}::uuid AND s.occurred_at >= ${g}
        AND ${periodOf(Prisma.sql`lucy_branch_local_date(s.branch_id, s.occurred_at)`, f, t)}`,
  },
  {
    key: 'REFUND_CASH',
    type: 'PRODUCT_REFUND',
    from: (
      b,
      g,
      f,
      t,
    ) => Prisma.sql`product_refunds s WHERE s.branch_id = ${b}::uuid AND s.method = 'CASH' AND s.amount_vnd > 0
      AND s.occurred_at >= ${g} AND ${periodOf(Prisma.sql`lucy_branch_local_date(s.branch_id, s.occurred_at)`, f, t)}`,
  },
  {
    key: 'REFUND_BANK',
    type: 'PRODUCT_REFUND',
    from: (
      b,
      g,
      f,
      t,
    ) => Prisma.sql`product_refunds s WHERE s.branch_id = ${b}::uuid AND s.method <> 'CASH' AND s.amount_vnd > 0
      AND s.occurred_at >= ${g} AND ${periodOf(Prisma.sql`lucy_branch_local_date(s.branch_id, s.occurred_at)`, f, t)}`,
  },
  {
    key: 'EXCHANGE_CASH',
    type: 'PRODUCT_EXCHANGE',
    from: (
      b,
      g,
      f,
      t,
    ) => Prisma.sql`(SELECT x.id, x.refund_vnd AS amount_vnd, x.occurred_at, x.branch_id FROM product_exchanges x
        WHERE x.refund_vnd > 0 AND x.refund_method = 'CASH') s
      WHERE s.branch_id = ${b}::uuid AND s.occurred_at >= ${g}
        AND ${periodOf(Prisma.sql`lucy_branch_local_date(s.branch_id, s.occurred_at)`, f, t)}`,
  },
  {
    key: 'EXCHANGE_BANK',
    type: 'PRODUCT_EXCHANGE',
    from: (
      b,
      g,
      f,
      t,
    ) => Prisma.sql`(SELECT x.id, x.refund_vnd AS amount_vnd, x.occurred_at, x.branch_id FROM product_exchanges x
        WHERE x.refund_vnd > 0 AND x.refund_method = 'BANK_TRANSFER_MANUAL') s
      WHERE s.branch_id = ${b}::uuid AND s.occurred_at >= ${g}
        AND ${periodOf(Prisma.sql`lucy_branch_local_date(s.branch_id, s.occurred_at)`, f, t)}`,
  },
];

export async function reconcile(
  context: AdminContext,
  query: { branchId?: unknown; from?: unknown; to?: unknown },
): Promise<CashReconciliationResponse> {
  const { tx } = context;
  const branchId = uuid(query.branchId, 'branchId');
  const from = day(query.from, 'from');
  const to = day(query.to, 'to');
  if (from > to) throw new AuthError('VALIDATION_FAILED', 'to');
  if (!canViewAt(context, branchId)) throw new AuthError('FORBIDDEN');
  const branch = await tx.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  const live = await financeGoLive(tx);
  if (!live) throw new AuthError('FINANCE_NOT_LIVE');

  const rows: CashReconciliationRow[] = [];
  for (const source of SOURCES) {
    const where = source.from(branchId, live.at, from, to);
    const [totals, booked] = await Promise.all([
      tx.$queryRaw<{ n: bigint; v: bigint; missing: bigint }[]>`
        SELECT count(*)::bigint AS n, COALESCE(SUM(s.amount_vnd), 0)::bigint AS v,
               count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM fund_entries e
                 WHERE e.source_type = ${source.type} AND e.source_id = s.id AND e.source_leg = 0))::bigint AS missing
        FROM ${where}`,
      tx.$queryRaw<{ n: bigint; v: bigint }[]>`
        SELECT count(e.id)::bigint AS n, COALESCE(SUM(e.amount_vnd), 0)::bigint AS v
        FROM fund_entries e
        WHERE e.source_type = ${source.type} AND e.source_leg = 0
          AND e.source_id IN (SELECT s.id FROM ${where})`,
    ]);
    const sourceVnd = totals[0]?.v ?? 0n;
    const bookVnd = booked[0]?.v ?? 0n;
    rows.push({
      key: source.key,
      sourceCount: Number(totals[0]?.n ?? 0n),
      sourceVnd: sourceVnd.toString(),
      bookCount: Number(booked[0]?.n ?? 0n),
      bookVnd: bookVnd.toString(),
      deltaVnd: (sourceVnd - bookVnd).toString(),
      unposted: Number(totals[0]?.missing ?? 0n),
    });
  }
  const unposted = rows.reduce((sum, row) => sum + row.unposted, 0);
  return {
    branch,
    from,
    to,
    goLiveAt: live.at.toISOString(),
    rows,
    unposted,
    balanced: unposted === 0 && rows.every((row) => row.deltaVnd === '0'),
  };
}

export const RECONCILIATION_KEYS: readonly CashReconciliationKey[] = CASH_RECONCILIATION_KEYS;
