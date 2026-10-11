import { Prisma } from '@lucy-spa/database';

/**
 * Phase 7 P7-3 (design PHASE7_PAYROLL_FUNDS.md 7.2-7.3, P7-T8): posting the money the rest of the system already recorded into the book
 * of the shop's funds.
 *
 * The book is fed by SOURCE ROWS, not by events: every payment, cash reversal, product refund and exchange refund already exists as its own
 * authoritative row, and not all of them publish an event. A pass reads the sources recorded since the Owner's go-live and writes one
 * entry per (source, leg); `UNIQUE(source_type, source_id, source_leg)` makes it idempotent, so running it twice, in two workers, or from
 * the closing's preflight is harmless. Nothing is posted before the go-live instant and nothing is posted while go-live is empty.
 *
 * | source (type)                          | fund                       | entry                                |
 * | -------------------------------------- | -------------------------- | ------------------------------------ |
 * | PAYMENT cash, SUCCEEDED                | cash of the payment branch | IN  SALE_CASH     (credited amount)  |
 * | PAYMENT PayOS, SUCCEEDED               | the bank                   | IN  SALE_BANK                        |
 * | PAYMENT_CORRECTION (cash reversal)     | cash of the payment branch | OUT PAYMENT_REVERSAL                 |
 * | PRODUCT_REFUND, cash / bank transfer   | by method                  | OUT PRODUCT_REFUND (FAILED_DELIVERY_REFUND when it belongs to a settlement) |
 * | PRODUCT_EXCHANGE handed back           | by method                  | OUT EXCHANGE_DIFFERENCE              |
 *
 * (What the customer pays MORE on an exchange is a payment of the exchange invoice and is posted as such.) A day that is already closed
 * is locked: such an entry is dated the day after the last closing of its fund, with its original source time kept.
 * Every pass first takes a shared lock on the funds, so it waits for a closing that is running and a closing never misses an entry.
 */
export const POSTING_SOURCE_TYPES = [
  'PAYMENT',
  'PAYMENT_CORRECTION',
  'PRODUCT_REFUND',
  'PRODUCT_EXCHANGE',
] as const;
export type PostingSourceType = (typeof POSTING_SOURCE_TYPES)[number];

export interface PostingResult {
  /** False while the Owner has not started the cash book: nothing was posted. */
  live: boolean;
  posted: Record<PostingSourceType, number>;
}

const none = (): PostingResult['posted'] => ({
  PAYMENT: 0,
  PAYMENT_CORRECTION: 0,
  PRODUCT_REFUND: 0,
  PRODUCT_EXCHANGE: 0,
});

/** The first open day of a fund: the day after its last closing, else the source's own day. */
const dated = (sourceDate: Prisma.Sql, fund: string) =>
  Prisma.sql`GREATEST(${sourceDate}, COALESCE((SELECT max(c.business_date) + 1 FROM cash_day_closings c WHERE c.fund_id = ${Prisma.raw(fund)}.id), ${sourceDate}))`;

/**
 * One idempotent pass. `since` limits how far back a periodic pass looks (the go-live instant is the floor); the closing's preflight and
 * the daily sweep pass `null` to look at everything since go-live.
 */
export async function postCashSources(
  tx: Prisma.TransactionClient,
  options: { since?: Date | null; limit?: number; fundId?: string | null } = {},
): Promise<PostingResult> {
  const live = await tx.financeGoLive.findUnique({ where: { id: 1 }, select: { at: true } });
  if (!live) return { live: false, posted: none() };
  const floor = options.since && options.since > live.at ? options.since : live.at;
  const limit = options.limit ?? 500;
  // A closing posts only the fund it is closing (and locks only that one); the worker posts every fund.
  const only = options.fundId ?? null;

  // Wait for a running closing (it holds the fund row FOR UPDATE), then keep the funds stable for this pass.
  if (only) {
    await tx.$queryRaw`SELECT id FROM cash_funds WHERE id = ${only}::uuid FOR SHARE`;
  } else {
    await tx.$queryRaw`SELECT id FROM cash_funds ORDER BY id FOR SHARE`;
  }
  // A branch added after go-live gets its cash fund with an opening balance of 0 the first time it is needed.
  if (!only) {
    await tx.$executeRaw`
    INSERT INTO cash_funds (kind, branch_id, name, opening_balance_vnd, opening_at, opening_by_user_id)
    SELECT 'CASH', b.id, 'Quỹ tiền mặt ' || b.name, 0, clock_timestamp(), g.set_by_user_id
    FROM branches b CROSS JOIN finance_go_live g
    WHERE b.is_active AND NOT EXISTS (SELECT 1 FROM cash_funds f WHERE f.kind = 'CASH' AND f.branch_id = b.id)
    ON CONFLICT (branch_id) WHERE kind = 'CASH' DO NOTHING`;
    await tx.$queryRaw`SELECT id FROM cash_funds ORDER BY id FOR SHARE`;
  }

  const posted = none();

  // Payments (cash to the branch's cash fund, PayOS to the bank).
  posted.PAYMENT = await tx.$executeRaw`
    INSERT INTO fund_entries (fund_id, branch_id, business_date, direction, category, amount_vnd, source_type, source_id, source_leg, source_occurred_at)
    SELECT f.id, p.branch_id, ${dated(Prisma.sql`p.business_date`, 'f')}, 'IN',
           CASE p.method WHEN 'CASH' THEN 'SALE_CASH' ELSE 'SALE_BANK' END::"FundEntryCategory",
           p.amount_vnd, 'PAYMENT', p.id, 0, p.collected_at
    FROM payments p
    JOIN cash_funds f ON (p.method = 'CASH' AND f.kind = 'CASH' AND f.branch_id = p.branch_id) OR (p.method <> 'CASH' AND f.kind = 'BANK')
    WHERE p.status = 'SUCCEEDED' AND p.collected_at >= ${floor}
      AND (${only}::uuid IS NULL OR f.id = ${only}::uuid)
      AND NOT EXISTS (SELECT 1 FROM fund_entries e WHERE e.source_type = 'PAYMENT' AND e.source_id = p.id AND e.source_leg = 0)
    ORDER BY p.collected_at, p.id
    LIMIT ${limit}
    ON CONFLICT (source_type, source_id, source_leg) WHERE source_type IS NOT NULL DO NOTHING`;

  // Cash reversals.
  posted.PAYMENT_CORRECTION = await tx.$executeRaw`
    INSERT INTO fund_entries (fund_id, branch_id, business_date, direction, category, amount_vnd, source_type, source_id, source_leg, source_occurred_at)
    SELECT f.id, p.branch_id, ${dated(Prisma.sql`lucy_branch_local_date(p.branch_id, pc.occurred_at)`, 'f')}, 'OUT', 'PAYMENT_REVERSAL',
           p.amount_vnd, 'PAYMENT_CORRECTION', pc.id, 0, pc.occurred_at
    FROM payment_corrections pc
    JOIN payments p ON p.id = pc.payment_id AND p.method = 'CASH'
    JOIN cash_funds f ON f.kind = 'CASH' AND f.branch_id = p.branch_id
    WHERE pc.occurred_at >= ${floor}
      AND (${only}::uuid IS NULL OR f.id = ${only}::uuid)
      AND NOT EXISTS (SELECT 1 FROM fund_entries e WHERE e.source_type = 'PAYMENT_CORRECTION' AND e.source_id = pc.id AND e.source_leg = 0)
    ORDER BY pc.occurred_at, pc.id
    LIMIT ${limit}
    ON CONFLICT (source_type, source_id, source_leg) WHERE source_type IS NOT NULL DO NOTHING`;

  // Product refunds (also the refunds of a failed delivery and of a cancelled pre-order line).
  posted.PRODUCT_REFUND = await tx.$executeRaw`
    INSERT INTO fund_entries (fund_id, branch_id, business_date, direction, category, amount_vnd, source_type, source_id, source_leg, source_occurred_at)
    SELECT f.id, r.branch_id, ${dated(Prisma.sql`lucy_branch_local_date(r.branch_id, r.occurred_at)`, 'f')}, 'OUT',
           CASE WHEN r.settlement_id IS NULL THEN 'PRODUCT_REFUND' ELSE 'FAILED_DELIVERY_REFUND' END::"FundEntryCategory",
           r.amount_vnd, 'PRODUCT_REFUND', r.id, 0, r.occurred_at
    FROM product_refunds r
    JOIN cash_funds f ON (r.method = 'CASH' AND f.kind = 'CASH' AND f.branch_id = r.branch_id) OR (r.method <> 'CASH' AND f.kind = 'BANK')
    WHERE r.amount_vnd > 0 AND r.occurred_at >= ${floor}
      AND (${only}::uuid IS NULL OR f.id = ${only}::uuid)
      AND NOT EXISTS (SELECT 1 FROM fund_entries e WHERE e.source_type = 'PRODUCT_REFUND' AND e.source_id = r.id AND e.source_leg = 0)
    ORDER BY r.occurred_at, r.id
    LIMIT ${limit}
    ON CONFLICT (source_type, source_id, source_leg) WHERE source_type IS NOT NULL DO NOTHING`;

  // The part of an exchange the shop hands back.
  posted.PRODUCT_EXCHANGE = await tx.$executeRaw`
    INSERT INTO fund_entries (fund_id, branch_id, business_date, direction, category, amount_vnd, source_type, source_id, source_leg, source_occurred_at)
    SELECT f.id, x.branch_id, ${dated(Prisma.sql`lucy_branch_local_date(x.branch_id, x.occurred_at)`, 'f')}, 'OUT', 'EXCHANGE_DIFFERENCE',
           x.refund_vnd, 'PRODUCT_EXCHANGE', x.id, 0, x.occurred_at
    FROM product_exchanges x
    JOIN cash_funds f ON (x.refund_method = 'CASH' AND f.kind = 'CASH' AND f.branch_id = x.branch_id) OR (x.refund_method <> 'CASH' AND f.kind = 'BANK')
    WHERE x.refund_vnd > 0 AND x.refund_method IS NOT NULL AND x.occurred_at >= ${floor}
      AND (${only}::uuid IS NULL OR f.id = ${only}::uuid)
      AND NOT EXISTS (SELECT 1 FROM fund_entries e WHERE e.source_type = 'PRODUCT_EXCHANGE' AND e.source_id = x.id AND e.source_leg = 0)
    ORDER BY x.occurred_at, x.id
    LIMIT ${limit}
    ON CONFLICT (source_type, source_id, source_leg) WHERE source_type IS NOT NULL DO NOTHING`;

  return { live: true, posted };
}

/** The cash fund of a branch, created with an opening balance of 0 when it does not exist yet (only after the Owner started the book). */
export async function ensureCashFund(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<string | null> {
  if (!(await tx.financeGoLive.findUnique({ where: { id: 1 }, select: { id: true } }))) return null;
  await tx.$executeRaw`
    INSERT INTO cash_funds (kind, branch_id, name, opening_balance_vnd, opening_at, opening_by_user_id)
    SELECT 'CASH', b.id, 'Quỹ tiền mặt ' || b.name, 0, clock_timestamp(), g.set_by_user_id
    FROM branches b CROSS JOIN finance_go_live g
    WHERE b.id = ${branchId}::uuid AND b.is_active
    ON CONFLICT (branch_id) WHERE kind = 'CASH' DO NOTHING`;
  const fund = await tx.cashFund.findFirst({
    where: { kind: 'CASH', branchId },
    select: { id: true },
  });
  return fund?.id ?? null;
}

export interface UnpostedSummary {
  /** Source rows of the branch (dated on or before `upToDate`) that have no entry yet, by source type. */
  items: Record<PostingSourceType, number>;
  total: number;
}

/**
 * What the book is still missing (design 7.3: the closing never trusts the poster). `scope` CASH counts only the sources that move the
 * branch's CASH fund; ALL also counts the ones that move the bank. Reads the whole history since go-live.
 */
export async function countUnposted(
  tx: Prisma.TransactionClient,
  options: { branchId: string; upToDate: string; scope: 'CASH' | 'ALL' },
): Promise<UnpostedSummary> {
  const live = await tx.financeGoLive.findUnique({ where: { id: 1 }, select: { at: true } });
  const items = none();
  if (!live) return { items, total: 0 };
  const cashOnly = options.scope === 'CASH';
  const [payments, corrections, refunds, exchanges] = await Promise.all([
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM payments p
      WHERE p.status = 'SUCCEEDED' AND p.branch_id = ${options.branchId}::uuid AND p.collected_at >= ${live.at}
        AND p.business_date <= ${options.upToDate}::date
        AND (${!cashOnly} OR p.method = 'CASH')
        AND NOT EXISTS (SELECT 1 FROM fund_entries e WHERE e.source_type = 'PAYMENT' AND e.source_id = p.id AND e.source_leg = 0)`,
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM payment_corrections pc JOIN payments p ON p.id = pc.payment_id AND p.method = 'CASH'
      WHERE p.branch_id = ${options.branchId}::uuid AND pc.occurred_at >= ${live.at}
        AND lucy_branch_local_date(p.branch_id, pc.occurred_at) <= ${options.upToDate}::date
        AND NOT EXISTS (SELECT 1 FROM fund_entries e WHERE e.source_type = 'PAYMENT_CORRECTION' AND e.source_id = pc.id AND e.source_leg = 0)`,
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM product_refunds r
      WHERE r.amount_vnd > 0 AND r.branch_id = ${options.branchId}::uuid AND r.occurred_at >= ${live.at}
        AND lucy_branch_local_date(r.branch_id, r.occurred_at) <= ${options.upToDate}::date
        AND (${!cashOnly} OR r.method = 'CASH')
        AND NOT EXISTS (SELECT 1 FROM fund_entries e WHERE e.source_type = 'PRODUCT_REFUND' AND e.source_id = r.id AND e.source_leg = 0)`,
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM product_exchanges x
      WHERE x.refund_vnd > 0 AND x.refund_method IS NOT NULL AND x.branch_id = ${options.branchId}::uuid AND x.occurred_at >= ${live.at}
        AND lucy_branch_local_date(x.branch_id, x.occurred_at) <= ${options.upToDate}::date
        AND (${!cashOnly} OR x.refund_method = 'CASH')
        AND NOT EXISTS (SELECT 1 FROM fund_entries e WHERE e.source_type = 'PRODUCT_EXCHANGE' AND e.source_id = x.id AND e.source_leg = 0)`,
  ]);
  items.PAYMENT = Number(payments[0]?.n ?? 0n);
  items.PAYMENT_CORRECTION = Number(corrections[0]?.n ?? 0n);
  items.PRODUCT_REFUND = Number(refunds[0]?.n ?? 0n);
  items.PRODUCT_EXCHANGE = Number(exchanges[0]?.n ?? 0n);
  const total =
    items.PAYMENT + items.PAYMENT_CORRECTION + items.PRODUCT_REFUND + items.PRODUCT_EXCHANGE;
  return { items, total };
}
