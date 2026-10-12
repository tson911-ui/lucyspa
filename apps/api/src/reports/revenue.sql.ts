import { Prisma } from '@lucy-spa/database';

/**
 * Phase 8 P8-3 (docs/PHASE8_REPORTS.md 4.1, P8-T4): the ONE definition of revenue, as SQL. The dashboard, every revenue report and every
 * export read these facts, so a number can never differ between screens.
 *
 * A fact is one signed amount of VND at the grain (day, branch, flow, channel, method, side, kind, invoice line):
 *
 * - **PAYMENT** (+): an effective payment (SUCCEEDED, no `payment_corrections` row: a reversed payment was an erroneous record and is not
 *   revenue, like the 21:30 summary) on its `business_date` (set by a database trigger from the branch-local date). Its amount is split
 *   over the Spa/Beauty sides by `payment_side_allocations` (when they add up to the payment, else the whole amount is UNCLASSIFIED,
 *   never guessed), and each side over its invoice lines by the line's recorded net (`invoice_line_allocations.net_vnd`), with the largest
 *   remainder rule so the parts add up to the payment to the dong. An invoice with no recorded allocation at all (the first kind:
 *   services and combos only) is Spa, weighted by line gross; one with a product line but no allocation is UNCLASSIFIED. Tips are not in `payments.amount_vnd`; they are never revenue.
 * - **REFUND** (-): `product_refunds` (a failed-delivery refund is one of them: `settlement_id` is set; the settlement row is NOT
 *   subtracted again), on the branch-local day of `occurred_at`, to the side and kind of the refunded line.
 * - **EXCHANGE** (-): the money paid back on an exchange (`product_exchanges.refund_vnd`). What the customer pays MORE is an ordinary
 *   payment of the exchange invoice.
 * - **Online orders** are recognised when the order is closed with at least one delivered line, on the branch-local day of the last
 *   delivery. Until then the money is "đã thu, chưa giao" (see `heldSql`). A refund made before the recognition is moved to the
 *   recognition day; an order that was cancelled and never delivered is never revenue.
 *
 * Every instant is turned into a day by the branch's own time zone in SQL (no numeric offset anywhere).
 */

export interface FactScope {
  branchIds: readonly string[];
  /** Inclusive branch business dates, `YYYY-MM-DD`. */
  from: string;
  to: string;
}

const ids = (scope: FactScope) => scope.branchIds as string[];

/** The CTEs that build `pay_lines`, `ref_lines`, `exch_lines` (and `pay`, `ref`, `exch` for the control total). Ends WITHOUT a comma. */
export function factCtes(scope: FactScope): Prisma.Sql {
  const branches = ids(scope);
  return Prisma.sql`
    scope AS (
      SELECT b.id, b.timezone,
             ((${scope.from}::date)::timestamp AT TIME ZONE b.timezone) AS t_from,
             ((${scope.to}::date + 1)::timestamp AT TIME ZONE b.timezone) AS t_to
      FROM branches b WHERE b.id = ANY(${branches}::uuid[])
    ),
    online AS (
      SELECT o.invoice_id, o.branch_id,
             bool_and(l.status IN ('COMPLETED', 'CANCELLED')) AS closed,
             max(l.delivered_at) FILTER (WHERE l.status = 'COMPLETED') AS delivered_at
      FROM product_orders o
      JOIN product_order_lines l ON l.order_id = o.id
      WHERE o.channel = 'ONLINE' AND o.branch_id = ANY(${branches}::uuid[])
      GROUP BY o.invoice_id, o.branch_id
    ),
    rec AS (
      SELECT a.invoice_id, (a.delivered_at AT TIME ZONE s.timezone)::date AS rec_date
      FROM online a JOIN scope s ON s.id = a.branch_id
      WHERE a.closed AND a.delivered_at IS NOT NULL
    ),
    pay_a AS (
      SELECT p.id, p.invoice_id, p.branch_id, p.method::text AS method, p.amount_vnd,
             p.business_date AS day, 'COUNTER'::text AS channel,
             i.shipping_fee_vnd, i.total_vnd
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.branch_id = ANY(${branches}::uuid[])
        AND p.status = 'SUCCEEDED'
        AND p.business_date BETWEEN ${scope.from}::date AND ${scope.to}::date
        AND i.channel <> 'ONLINE'
        AND NOT EXISTS (SELECT 1 FROM payment_corrections c WHERE c.payment_id = p.id)
    ),
    pay_b AS (
      SELECT p.id, p.invoice_id, p.branch_id, p.method::text AS method, p.amount_vnd,
             r.rec_date AS day, 'ONLINE'::text AS channel,
             i.shipping_fee_vnd, i.total_vnd
      FROM rec r
      JOIN payments p ON p.invoice_id = r.invoice_id
      JOIN invoices i ON i.id = p.invoice_id
      WHERE r.rec_date BETWEEN ${scope.from}::date AND ${scope.to}::date
        AND p.status = 'SUCCEEDED'
        AND NOT EXISTS (SELECT 1 FROM payment_corrections c WHERE c.payment_id = p.id)
    ),
    pay AS (SELECT * FROM pay_a UNION ALL SELECT * FROM pay_b),
    lw_rec AS (
      SELECT ila.invoice_id, ila.invoice_line_id AS line_id, ila.side::text AS side,
             CASE il.kind WHEN 'SERVICE' THEN 'SERVICE' WHEN 'COMBO_PURCHASE' THEN 'COMBO' ELSE 'PRODUCT' END AS kind,
             ila.net_vnd AS w
      FROM invoice_line_allocations ila
      JOIN invoice_lines il ON il.id = ila.invoice_line_id
      WHERE ila.invoice_id IN (SELECT invoice_id FROM pay)
    ),
    alloc_inv AS (SELECT DISTINCT invoice_id FROM lw_rec),
    prod_inv AS (
      SELECT DISTINCT il.invoice_id
      FROM invoice_lines il
      WHERE il.invoice_id IN (SELECT invoice_id FROM pay) AND il.kind = 'PRODUCT'
    ),
    -- An invoice with no recorded allocation at all is one of the first kind (services and combos only, before the Spa/Beauty split):
    -- its lines are Spa, weighted by their gross. An invoice that has a product line but no allocation is NOT guessed (see pay_sides).
    lw_legacy AS (
      SELECT il.invoice_id, il.id AS line_id, 'SPA'::text AS side,
             CASE il.kind WHEN 'SERVICE' THEN 'SERVICE' WHEN 'COMBO_PURCHASE' THEN 'COMBO' ELSE 'PRODUCT' END AS kind,
             COALESCE(il.gross_vnd, 0) AS w
      FROM invoice_lines il
      LEFT JOIN alloc_inv ai ON ai.invoice_id = il.invoice_id
      LEFT JOIN prod_inv pi ON pi.invoice_id = il.invoice_id
      WHERE il.invoice_id IN (SELECT invoice_id FROM pay)
        AND il.kind <> 'PRODUCT' AND ai.invoice_id IS NULL AND pi.invoice_id IS NULL
    ),
    lw AS (SELECT * FROM lw_rec UNION ALL SELECT * FROM lw_legacy),
    psa AS (
      SELECT s.payment_id, s.side::text AS side, s.amount_vnd
      FROM payment_side_allocations s
      WHERE s.kind = 'PAYMENT' AND s.payment_id IN (SELECT id FROM pay)
    ),
    psa_ok AS (
      SELECT psa.payment_id
      FROM psa JOIN pay ON pay.id = psa.payment_id
      GROUP BY psa.payment_id, pay.amount_vnd
      HAVING sum(psa.amount_vnd) = pay.amount_vnd
    ),
    pay_flags AS (
      SELECT pay.id AS payment_id, pay.amount_vnd,
             (ok.payment_id IS NOT NULL) AS split_ok,
             (ai.invoice_id IS NOT NULL OR pi.invoice_id IS NOT NULL) AS needs_split
      FROM pay
      LEFT JOIN psa_ok ok ON ok.payment_id = pay.id
      LEFT JOIN alloc_inv ai ON ai.invoice_id = pay.invoice_id
      LEFT JOIN prod_inv pi ON pi.invoice_id = pay.invoice_id
    ),
    pay_sides AS (
      SELECT psa.payment_id, psa.side, psa.amount_vnd AS amt
      FROM psa JOIN pay_flags f ON f.payment_id = psa.payment_id WHERE f.split_ok
      UNION ALL
      SELECT f.payment_id, 'SPA'::text, f.amount_vnd FROM pay_flags f WHERE NOT f.split_ok AND NOT f.needs_split
      UNION ALL
      SELECT f.payment_id, 'UNCLASSIFIED'::text, f.amount_vnd FROM pay_flags f WHERE NOT f.split_ok AND f.needs_split
    ),
    parts AS (
      SELECT ps.payment_id, pay.branch_id, pay.day, pay.channel, pay.method, ps.side, ps.amt,
             lw.line_id, COALESCE(lw.kind, 'OTHER') AS kind,
             CASE WHEN sum(COALESCE(lw.w, 0)) OVER (PARTITION BY ps.payment_id, ps.side) = 0
                  THEN 1 ELSE COALESCE(lw.w, 0) END AS w
      FROM pay_sides ps
      JOIN pay ON pay.id = ps.payment_id
      LEFT JOIN lw ON lw.invoice_id = pay.invoice_id AND (ps.side = 'UNCLASSIFIED' OR lw.side = ps.side)
    ),
    shares AS (
      SELECT parts.*, sum(w) OVER (PARTITION BY payment_id, side) AS wsum FROM parts
    ),
    floors AS (
      SELECT shares.*, floor(amt::numeric * w / wsum) AS base,
             (amt::numeric * w / wsum) - floor(amt::numeric * w / wsum) AS frac
      FROM shares
    ),
    alloc AS (
      SELECT floors.*, amt - sum(base) OVER (PARTITION BY payment_id, side) AS rest,
             row_number() OVER (PARTITION BY payment_id, side ORDER BY frac DESC, line_id) AS rn
      FROM floors
    ),
    pay_lines AS (
      SELECT day, branch_id, 'PAYMENT'::text AS flow, channel, method, side, kind, line_id,
             (base + CASE WHEN rn <= rest THEN 1 ELSE 0 END)::bigint AS amount_vnd
      FROM alloc
    ),
    ref AS (
      SELECT r.id, r.branch_id, r.invoice_line_id AS line_id, i.channel::text AS channel,
             CASE r.method::text WHEN 'CASH' THEN 'CASH' ELSE 'TRANSFER' END AS method,
             r.amount_vnd,
             CASE WHEN i.channel = 'ONLINE'
                  THEN GREATEST((r.occurred_at AT TIME ZONE s.timezone)::date, rc.rec_date)
                  ELSE (r.occurred_at AT TIME ZONE s.timezone)::date END AS day
      FROM product_refunds r
      JOIN scope s ON s.id = r.branch_id
      JOIN invoices i ON i.id = r.invoice_id
      LEFT JOIN rec rc ON rc.invoice_id = r.invoice_id
      WHERE (i.channel <> 'ONLINE' AND r.occurred_at >= s.t_from AND r.occurred_at < s.t_to)
         OR (i.channel = 'ONLINE' AND rc.invoice_id IS NOT NULL)
    ),
    ref_in AS (SELECT * FROM ref WHERE day BETWEEN ${scope.from}::date AND ${scope.to}::date),
    ref_lines AS (
      SELECT ref_in.day, ref_in.branch_id, 'REFUND'::text AS flow, ref_in.channel, ref_in.method,
             COALESCE(ila.side::text, 'UNCLASSIFIED') AS side,
             CASE il.kind WHEN 'SERVICE' THEN 'SERVICE' WHEN 'COMBO_PURCHASE' THEN 'COMBO' ELSE 'PRODUCT' END AS kind,
             ref_in.line_id, -ref_in.amount_vnd AS amount_vnd
      FROM ref_in
      LEFT JOIN invoice_line_allocations ila ON ila.invoice_line_id = ref_in.line_id
      LEFT JOIN invoice_lines il ON il.id = ref_in.line_id
    ),
    exch AS (
      SELECT e.id, e.branch_id, e.invoice_line_id AS line_id, i.channel::text AS channel,
             CASE e.refund_method::text WHEN 'CASH' THEN 'CASH' ELSE 'TRANSFER' END AS method,
             e.refund_vnd AS amount_vnd,
             (e.occurred_at AT TIME ZONE s.timezone)::date AS day
      FROM product_exchanges e
      JOIN scope s ON s.id = e.branch_id
      JOIN invoices i ON i.id = e.invoice_id
      WHERE e.refund_vnd > 0 AND e.occurred_at >= s.t_from AND e.occurred_at < s.t_to
    ),
    exch_lines AS (
      SELECT exch.day, exch.branch_id, 'EXCHANGE'::text AS flow, exch.channel, exch.method,
             COALESCE(ila.side::text, 'UNCLASSIFIED') AS side,
             CASE il.kind WHEN 'SERVICE' THEN 'SERVICE' WHEN 'COMBO_PURCHASE' THEN 'COMBO' ELSE 'PRODUCT' END AS kind,
             exch.line_id, -exch.amount_vnd AS amount_vnd
      FROM exch
      LEFT JOIN invoice_line_allocations ila ON ila.invoice_line_id = exch.line_id
      LEFT JOIN invoice_lines il ON il.id = exch.line_id
    ),
    facts AS (
      SELECT * FROM pay_lines
      UNION ALL SELECT * FROM ref_lines
      UNION ALL SELECT * FROM exch_lines
    )`;
}

export interface FactRow {
  day: string;
  branchId: string;
  flow: 'PAYMENT' | 'REFUND' | 'EXCHANGE';
  channel: 'COUNTER' | 'ONLINE';
  method: 'CASH' | 'PAYOS' | 'TRANSFER';
  side: 'SPA' | 'BEAUTY' | 'UNCLASSIFIED';
  kind: 'SERVICE' | 'COMBO' | 'PRODUCT' | 'OTHER';
  amountVnd: bigint;
}

/** The statement that sums the facts to (day, branch, flow, channel, method, side, kind). Exported so the benchmark can EXPLAIN it. */
export const factsStatement = (scope: FactScope): Prisma.Sql => Prisma.sql`
    WITH ${factCtes(scope)}
    SELECT to_char(day, 'YYYY-MM-DD') AS day, branch_id::text AS branch_id, flow, channel, method, side, kind,
           sum(amount_vnd)::text AS amount
    FROM facts
    GROUP BY day, branch_id, flow, channel, method, side, kind
    ORDER BY day, branch_id`;

/** The facts of the period. */
export async function loadFacts(
  tx: Prisma.TransactionClient,
  scope: FactScope,
): Promise<FactRow[]> {
  if (scope.branchIds.length === 0) return [];
  const rows = await tx.$queryRaw<
    {
      day: string;
      branch_id: string;
      flow: FactRow['flow'];
      channel: FactRow['channel'];
      method: FactRow['method'];
      side: FactRow['side'];
      kind: FactRow['kind'];
      amount: string;
    }[]
  >(factsStatement(scope));
  return rows.map((row) => ({
    day: row.day,
    branchId: row.branch_id,
    flow: row.flow,
    channel: row.channel,
    method: row.method,
    side: row.side,
    kind: row.kind,
    amountVnd: BigInt(row.amount),
  }));
}

/**
 * The control total, computed WITHOUT the splitting: effective payments recognised in the period minus the refunds and exchange
 * differences of the period. It must equal the sum of the facts; if the splitting ever lost or invented a dong, the report is refused.
 */
export async function loadControlTotal(
  tx: Prisma.TransactionClient,
  scope: FactScope,
): Promise<{ netVnd: bigint; shippingVnd: bigint }> {
  if (scope.branchIds.length === 0) return { netVnd: 0n, shippingVnd: 0n };
  const [row] = await tx.$queryRaw<{ net: string; shipping: string }[]>(Prisma.sql`
    WITH ${factCtes(scope)}
    SELECT ((SELECT COALESCE(sum(amount_vnd), 0) FROM pay)
            - (SELECT COALESCE(sum(amount_vnd), 0) FROM ref_in)
            - (SELECT COALESCE(sum(amount_vnd), 0) FROM exch WHERE day BETWEEN ${scope.from}::date AND ${scope.to}::date))::text AS net,
           (SELECT COALESCE(sum(round(amount_vnd::numeric * shipping_fee_vnd / NULLIF(total_vnd, 0))), 0)
            FROM pay WHERE shipping_fee_vnd > 0)::text AS shipping`);
  return { netVnd: BigInt(row?.net ?? '0'), shippingVnd: BigInt(row?.shipping ?? '0') };
}

export interface BranchCount {
  branchId: string;
  count: number;
  totalVnd: bigint;
}

/** Invoices that became PAID in the period (by the branch-local day of `paid_at`): the figure the old widget showed. */
export async function loadPaidInvoices(
  tx: Prisma.TransactionClient,
  scope: FactScope,
): Promise<BranchCount[]> {
  if (scope.branchIds.length === 0) return [];
  const rows = await tx.$queryRaw<{ branch_id: string; n: number; total: string }[]>(Prisma.sql`
    SELECT i.branch_id::text AS branch_id, count(*)::int AS n, COALESCE(sum(i.total_vnd), 0)::text AS total
    FROM invoices i
    JOIN branches b ON b.id = i.branch_id
    WHERE i.branch_id = ANY(${ids(scope)}::uuid[])
      AND i.status = 'PAID'
      AND i.paid_at >= ((${scope.from}::date)::timestamp AT TIME ZONE b.timezone)
      AND i.paid_at < ((${scope.to}::date + 1)::timestamp AT TIME ZONE b.timezone)
    GROUP BY i.branch_id`);
  return rows.map((row) => ({
    branchId: row.branch_id,
    count: row.n,
    totalVnd: BigInt(row.total),
  }));
}

/** Completed lượt đến (visits) of the period, by the visit's own branch-local service date. */
export async function loadVisits(
  tx: Prisma.TransactionClient,
  scope: FactScope,
): Promise<Map<string, number>> {
  if (scope.branchIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ branch_id: string; n: number }[]>(Prisma.sql`
    SELECT v.branch_id::text AS branch_id, count(*)::int AS n
    FROM visits v
    WHERE v.branch_id = ANY(${ids(scope)}::uuid[])
      AND v.status = 'COMPLETED'
      AND v.service_date BETWEEN ${scope.from}::date AND ${scope.to}::date
    GROUP BY v.branch_id`);
  return new Map(rows.map((row) => [row.branch_id, row.n]));
}

/**
 * "Đã thu, chưa giao": effective payments of online orders that are not closed yet, minus the refunds already made on them. A point
 * in time (the report's snapshot), not a period figure.
 */
export async function loadOnlineHeld(
  tx: Prisma.TransactionClient,
  branchIds: readonly string[],
): Promise<bigint> {
  if (branchIds.length === 0) return 0n;
  const [row] = await tx.$queryRaw<{ held: string }[]>(Prisma.sql`
    WITH open_orders AS (
      SELECT o.invoice_id
      FROM product_orders o
      JOIN product_order_lines l ON l.order_id = o.id
      WHERE o.channel = 'ONLINE' AND o.branch_id = ANY(${branchIds as string[]}::uuid[])
      GROUP BY o.invoice_id
      HAVING NOT bool_and(l.status IN ('COMPLETED', 'CANCELLED'))
    )
    SELECT ((SELECT COALESCE(sum(p.amount_vnd), 0) FROM payments p
              WHERE p.invoice_id IN (SELECT invoice_id FROM open_orders) AND p.status = 'SUCCEEDED'
                AND NOT EXISTS (SELECT 1 FROM payment_corrections c WHERE c.payment_id = p.id))
            - (SELECT COALESCE(sum(r.amount_vnd), 0) FROM product_refunds r
                WHERE r.invoice_id IN (SELECT invoice_id FROM open_orders)))::text AS held`);
  return BigInt(row?.held ?? '0');
}
