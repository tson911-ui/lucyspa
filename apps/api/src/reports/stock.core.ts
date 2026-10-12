import {
  STOCK_DEFAULT_DAYS,
  STOCK_MAX_DAYS,
  STOCK_ROW_LIMIT,
  type BestSellerReport,
  type BestSellerRow,
  type ExpiryReport,
  type ExpiryRow,
  type LowStockReport,
  type LowStockRow,
  type ReceiptSupplierRow,
  type ReportBranchRef,
  type SlowMoverReport,
  type SlowMoverRow,
  type StockMovementReport,
  type StockMovementRow,
  type StockReceiptReport,
  type StockValueReport,
  type StockValueRow,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { parseRange, type ReportRange } from './report.dates.js';
import type { ReportBranch, ReportContext } from './report.frame.js';
import { factCtes } from './revenue.sql.js';

/**
 * Phase 8 P8-9 (docs/PHASE8_REPORTS.md 4.5): cosmetics and stock. Best sellers by units and by money (the money is the revenue facts, so it
 * is a part of the headline), the stock that is low, slow or about to expire, what the stock is worth at cost (with a coverage figure,
 * never a guess), what moved and why, and what was received from each supplier. Read-only; "as of now" reports use the snapshot's clock.
 */

export interface StockQuery {
  from?: unknown;
  to?: unknown;
  branchId?: unknown;
  days?: unknown;
  restrictTo?: readonly ReportBranch[];
}

function covered(
  context: ReportContext,
  query: StockQuery,
  requires: Parameters<ReportContext['scope']>[0],
): { branches: readonly ReportBranch[]; ids: string[]; refs: ReportBranchRef[] } {
  const branches = query.restrictTo ?? context.scope(requires, query.branchId);
  return {
    branches,
    ids: branches.map((b) => b.id),
    refs: branches.map(({ id, code, name }) => ({ id, code, name })),
  };
}

/** A column that needs VIEW_PRODUCT_COST is shown only when it holds at every covered branch. */
const holdsCost = (context: ReportContext, branches: readonly ReportBranch[]) =>
  branches.every((branch) => context.can('VIEW_PRODUCT_COST', branch.id));

export function parseDays(value: unknown): number {
  if (value === undefined || value === '') return STOCK_DEFAULT_DAYS;
  if (typeof value !== 'string' || !/^[1-9]\d{0,3}$/.test(value)) {
    throw new AuthError('VALIDATION_FAILED', 'days');
  }
  const days = Number(value);
  if (days > STOCK_MAX_DAYS) throw new AuthError('VALIDATION_FAILED', 'days');
  return days;
}

const bp = (part: bigint, whole: bigint): number =>
  whole <= 0n ? 0 : Number((part * 10000n * 2n + whole) / (whole * 2n));

const within = (column: string, range: ReportRange) => Prisma.sql`
  ${Prisma.raw(column)} >= ((${range.from}::date)::timestamp AT TIME ZONE b.timezone)
  AND ${Prisma.raw(column)} < ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)`;

interface ItemColumns {
  variant_id: string;
  sku: string;
  name_vi: string;
  name_en: string;
}

const item = (row: ItemColumns) => ({
  variantId: row.variant_id,
  sku: row.sku,
  nameVi: row.name_vi,
  nameEn: row.name_en,
});

const name = Prisma.raw(
  `p.name_vi || COALESCE(' (' || v.label_vi || ')', '') AS name_vi, p.name_en || COALESCE(' (' || v.label_en || ')', '') AS name_en`,
);

// -------------------------------------------------------------------------------------------------------- best sellers

export async function bestSellers(
  context: ReportContext,
  query: StockQuery,
): Promise<BestSellerReport> {
  const f = covered(context, query, ['VIEW_INVENTORY']);
  const range = parseRange(query);
  const scope = { branchIds: f.ids, from: range.from, to: range.to };
  const units = await context.tx.$queryRaw<
    (ItemColumns & { sold: string; returned: string })[]
  >(Prisma.sql`
    SELECT m.variant_id::text AS variant_id, v.sku, ${name},
           COALESCE(sum(-m.quantity_delta) FILTER (WHERE m.kind = 'SALE'), 0)::text AS sold,
           COALESCE(sum(m.quantity_delta) FILTER (WHERE m.kind IN ('SALE_REVERSAL', 'REFUND_RETURN', 'EXCHANGE_RETURN')), 0)::text AS returned
    FROM stock_movements m
    JOIN branches b ON b.id = m.branch_id
    JOIN product_variants v ON v.id = m.variant_id
    JOIN products p ON p.id = v.product_id
    WHERE m.branch_id = ANY(${f.ids}::uuid[])
      AND m.kind IN ('SALE', 'SALE_REVERSAL', 'REFUND_RETURN', 'EXCHANGE_RETURN')
      AND ${within('m.created_at', range)}
    GROUP BY m.variant_id, v.sku, p.name_vi, p.name_en, v.label_vi, v.label_en`);
  const money = await context.tx.$queryRaw<{ variant_id: string; net: string }[]>(Prisma.sql`
    WITH ${factCtes(scope)}
    SELECT ilp.variant_id::text AS variant_id, sum(x.amount_vnd)::text AS net
    FROM facts x JOIN invoice_line_products ilp ON ilp.invoice_line_id = x.line_id
    WHERE x.kind = 'PRODUCT' GROUP BY ilp.variant_id`);
  const netBy = new Map(money.map((row) => [row.variant_id, BigInt(row.net)]));
  const total = [...netBy.values()].reduce((a, b) => a + b, 0n);
  const rows: BestSellerRow[] = units
    .map((row) => {
      const sold = Number(row.sold);
      const returned = Number(row.returned);
      const value = netBy.get(row.variant_id) ?? 0n;
      return {
        ...item(row),
        unitsNet: sold - returned,
        unitsSold: sold,
        unitsReturned: returned,
        netVnd: value.toString(),
        shareBp: bp(value, total),
      };
    })
    .sort(
      (a, b) =>
        b.unitsNet - a.unitsNet ||
        Number(BigInt(b.netVnd) - BigInt(a.netVnd)) ||
        a.sku.localeCompare(b.sku),
    );
  return {
    generatedAt: context.now.toISOString(),
    branches: f.refs,
    period: { from: range.from, to: range.to },
    truncated: rows.length > STOCK_ROW_LIMIT,
    rows: rows.slice(0, STOCK_ROW_LIMIT),
  };
}

// ------------------------------------------------------------------------------------------------------------ low stock

export async function lowStock(context: ReportContext, query: StockQuery): Promise<LowStockReport> {
  const f = covered(context, query, ['VIEW_INVENTORY']);
  const rows = await context.tx.$queryRaw<
    (ItemColumns & { branch_id: string; on_hand: number; reserved: number; threshold: number })[]
  >(Prisma.sql`
    SELECT sl.branch_id::text AS branch_id, sl.variant_id::text AS variant_id, v.sku, ${name},
           sl.on_hand, sl.reserved, v.low_stock_threshold AS threshold
    FROM stock_levels sl
    JOIN product_variants v ON v.id = sl.variant_id
    JOIN products p ON p.id = v.product_id
    WHERE sl.branch_id = ANY(${f.ids}::uuid[]) AND v.is_active AND v.low_stock_threshold IS NOT NULL
      AND sl.on_hand <= v.low_stock_threshold
    ORDER BY (sl.on_hand - sl.reserved), v.sku
    LIMIT ${STOCK_ROW_LIMIT + 1}`);
  const byId = new Map(f.refs.map((b) => [b.id, b]));
  const mapped: LowStockRow[] = rows.map((row) => ({
    ...item(row),
    branch: byId.get(row.branch_id)!,
    onHand: row.on_hand,
    reserved: row.reserved,
    available: row.on_hand - row.reserved,
    threshold: row.threshold,
  }));
  return {
    generatedAt: context.now.toISOString(),
    branches: f.refs,
    truncated: mapped.length > STOCK_ROW_LIMIT,
    rows: mapped.slice(0, STOCK_ROW_LIMIT),
  };
}

// ------------------------------------------------------------------------------------------------------------ slow movers

export async function slowMovers(
  context: ReportContext,
  query: StockQuery,
): Promise<SlowMoverReport> {
  const f = covered(context, query, ['VIEW_INVENTORY']);
  const days = parseDays(query.days);
  const costColumn = holdsCost(context, f.branches);
  const rows = await context.tx.$queryRaw<
    (ItemColumns & {
      branch_id: string;
      on_hand: number;
      last_sold: string | null;
      since: number | null;
      cost: string | null;
    })[]
  >(Prisma.sql`
    WITH last_sale AS (
      SELECT m.branch_id, m.variant_id, max(m.created_at) AS at
      FROM stock_movements m
      WHERE m.branch_id = ANY(${f.ids}::uuid[]) AND m.kind = 'SALE'
      GROUP BY m.branch_id, m.variant_id
    ),
    cost AS (
      SELECT l.branch_id, l.variant_id, sum(l.quantity_on_hand * l.unit_cost_vnd) AS value
      FROM inventory_lots l
      WHERE l.branch_id = ANY(${f.ids}::uuid[]) AND l.quantity_on_hand > 0 AND l.unit_cost_vnd IS NOT NULL
      GROUP BY l.branch_id, l.variant_id
    )
    SELECT sl.branch_id::text AS branch_id, sl.variant_id::text AS variant_id, v.sku, ${name}, sl.on_hand,
           to_char((ls.at AT TIME ZONE b.timezone)::date, 'YYYY-MM-DD') AS last_sold,
           ((${context.now}::timestamptz AT TIME ZONE b.timezone)::date - (ls.at AT TIME ZONE b.timezone)::date)::int AS since,
           cost.value::text AS cost
    FROM stock_levels sl
    JOIN branches b ON b.id = sl.branch_id
    JOIN product_variants v ON v.id = sl.variant_id
    JOIN products p ON p.id = v.product_id
    LEFT JOIN last_sale ls ON ls.branch_id = sl.branch_id AND ls.variant_id = sl.variant_id
    LEFT JOIN cost ON cost.branch_id = sl.branch_id AND cost.variant_id = sl.variant_id
    WHERE sl.branch_id = ANY(${f.ids}::uuid[]) AND sl.on_hand > 0 AND v.is_active
      AND (ls.at IS NULL OR ls.at < ${context.now}::timestamptz - (${days} * interval '1 day'))
    ORDER BY ls.at NULLS FIRST, v.sku
    LIMIT ${STOCK_ROW_LIMIT + 1}`);
  const byId = new Map(f.refs.map((b) => [b.id, b]));
  const mapped: SlowMoverRow[] = rows.map((row) => ({
    ...item(row),
    branch: byId.get(row.branch_id)!,
    onHand: row.on_hand,
    lastSoldOn: row.last_sold,
    daysSinceSale: row.since,
    costValueVnd: costColumn ? row.cost : null,
  }));
  return {
    generatedAt: context.now.toISOString(),
    branches: f.refs,
    truncated: mapped.length > STOCK_ROW_LIMIT,
    days,
    costColumn,
    rows: mapped.slice(0, STOCK_ROW_LIMIT),
  };
}

// --------------------------------------------------------------------------------------------------------------- expiry

export async function expiringLots(
  context: ReportContext,
  query: StockQuery,
): Promise<ExpiryReport> {
  const f = covered(context, query, ['VIEW_INVENTORY']);
  const days = parseDays(query.days);
  const rows = await context.tx.$queryRaw<
    (ItemColumns & { branch_id: string; lot: string; expiry: string; left: number; qty: number })[]
  >(Prisma.sql`
    SELECT l.branch_id::text AS branch_id, l.variant_id::text AS variant_id, v.sku, ${name}, l.lot_code AS lot,
           to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry,
           (l.expiry_date - (${context.now}::timestamptz AT TIME ZONE b.timezone)::date)::int AS left,
           l.quantity_on_hand AS qty
    FROM inventory_lots l
    JOIN branches b ON b.id = l.branch_id
    JOIN product_variants v ON v.id = l.variant_id
    JOIN products p ON p.id = v.product_id
    WHERE l.branch_id = ANY(${f.ids}::uuid[]) AND l.quantity_on_hand > 0 AND l.expiry_date IS NOT NULL
      AND l.expiry_date <= (${context.now}::timestamptz AT TIME ZONE b.timezone)::date + ${days}::int
    ORDER BY l.expiry_date, v.sku
    LIMIT ${STOCK_ROW_LIMIT + 1}`);
  const byId = new Map(f.refs.map((b) => [b.id, b]));
  const mapped: ExpiryRow[] = rows.map((row) => ({
    ...item(row),
    branch: byId.get(row.branch_id)!,
    lotCode: row.lot,
    expiryDate: row.expiry,
    daysLeft: row.left,
    quantity: row.qty,
  }));
  return {
    generatedAt: context.now.toISOString(),
    branches: f.refs,
    truncated: mapped.length > STOCK_ROW_LIMIT,
    days,
    rows: mapped.slice(0, STOCK_ROW_LIMIT),
  };
}

// ----------------------------------------------------------------------------------------------------------------- value

export async function stockValue(
  context: ReportContext,
  query: StockQuery,
): Promise<StockValueReport> {
  const f = covered(context, query, ['VIEW_INVENTORY', 'VIEW_PRODUCT_COST']);
  const rows = await context.tx.$queryRaw<
    (ItemColumns & { branch_id: string; on_hand: number; with_cost: string; value: string })[]
  >(Prisma.sql`
    WITH lots AS (
      SELECT l.branch_id, l.variant_id,
             COALESCE(sum(l.quantity_on_hand) FILTER (WHERE l.unit_cost_vnd IS NOT NULL), 0) AS with_cost,
             COALESCE(sum(l.quantity_on_hand * l.unit_cost_vnd) FILTER (WHERE l.unit_cost_vnd IS NOT NULL), 0) AS value
      FROM inventory_lots l
      WHERE l.branch_id = ANY(${f.ids}::uuid[]) AND l.quantity_on_hand > 0
      GROUP BY l.branch_id, l.variant_id
    )
    SELECT sl.branch_id::text AS branch_id, sl.variant_id::text AS variant_id, v.sku, ${name}, sl.on_hand,
           COALESCE(lots.with_cost, 0)::text AS with_cost, COALESCE(lots.value, 0)::text AS value
    FROM stock_levels sl
    JOIN product_variants v ON v.id = sl.variant_id
    JOIN products p ON p.id = v.product_id
    LEFT JOIN lots ON lots.branch_id = sl.branch_id AND lots.variant_id = sl.variant_id
    WHERE sl.branch_id = ANY(${f.ids}::uuid[]) AND sl.on_hand > 0
    ORDER BY COALESCE(lots.value, 0) DESC, v.sku
    LIMIT ${STOCK_ROW_LIMIT + 1}`);
  const byId = new Map(f.refs.map((b) => [b.id, b]));
  const mapped: StockValueRow[] = rows.map((row) => ({
    ...item(row),
    branch: byId.get(row.branch_id)!,
    onHand: row.on_hand,
    unitsWithCost: Number(row.with_cost),
    valueVnd: row.value,
  }));
  const all = mapped.slice(0, STOCK_ROW_LIMIT);
  const onHand = all.reduce((a, r) => a + r.onHand, 0);
  const withCost = all.reduce((a, r) => a + r.unitsWithCost, 0);
  return {
    generatedAt: context.now.toISOString(),
    branches: f.refs,
    truncated: mapped.length > STOCK_ROW_LIMIT,
    rows: all,
    totals: {
      onHand,
      unitsWithCost: withCost,
      valueVnd: all.reduce((a, r) => a + BigInt(r.valueVnd), 0n).toString(),
      coverageBp: onHand === 0 ? 0 : Math.round((withCost * 10000) / onHand),
      variantsWithoutCost: all.filter((r) => r.unitsWithCost < r.onHand).length,
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ movements

export async function stockMovements(
  context: ReportContext,
  query: StockQuery,
): Promise<StockMovementReport> {
  const f = covered(context, query, ['VIEW_INVENTORY']);
  const range = parseRange(query);
  const rows = await context.tx.$queryRaw<
    {
      branch_id: string;
      kind: string;
      reason: string | null;
      entries: string;
      units_in: string;
      units_out: string;
    }[]
  >(Prisma.sql`
    SELECT m.branch_id::text AS branch_id, m.kind::text AS kind, m.reason::text AS reason, count(*)::text AS entries,
           COALESCE(sum(m.quantity_delta) FILTER (WHERE m.quantity_delta > 0), 0)::text AS units_in,
           COALESCE(-sum(m.quantity_delta) FILTER (WHERE m.quantity_delta < 0), 0)::text AS units_out
    FROM stock_movements m JOIN branches b ON b.id = m.branch_id
    WHERE m.branch_id = ANY(${f.ids}::uuid[]) AND ${within('m.created_at', range)}
    GROUP BY m.branch_id, m.kind, m.reason
    ORDER BY m.branch_id, m.kind, m.reason NULLS FIRST`);
  const byId = new Map(f.refs.map((b) => [b.id, b]));
  const mapped: StockMovementRow[] = rows.map((row) => ({
    branch: byId.get(row.branch_id)!,
    kind: row.kind,
    reason: row.reason,
    entries: Number(row.entries),
    unitsIn: Number(row.units_in),
    unitsOut: Number(row.units_out),
  }));
  return {
    generatedAt: context.now.toISOString(),
    branches: f.refs,
    period: { from: range.from, to: range.to },
    truncated: false,
    rows: mapped,
  };
}

// -------------------------------------------------------------------------------------------------------------- receipts

export async function stockReceipts(
  context: ReportContext,
  query: StockQuery,
): Promise<StockReceiptReport> {
  const f = covered(context, query, ['VIEW_INVENTORY']);
  const range = parseRange(query);
  const costColumn = holdsCost(context, f.branches);
  const rows = await context.tx.$queryRaw<
    {
      supplier_id: string | null;
      supplier: string | null;
      receipts: string;
      units: string;
      cost: string;
      no_cost: string;
    }[]
  >(Prisma.sql`
    SELECT r.supplier_id::text AS supplier_id, s.name AS supplier, count(DISTINCT r.id)::text AS receipts,
           COALESCE(sum(l.quantity), 0)::text AS units,
           COALESCE(sum(l.quantity * l.unit_cost_vnd) FILTER (WHERE l.unit_cost_vnd IS NOT NULL), 0)::text AS cost,
           (count(*) FILTER (WHERE l.unit_cost_vnd IS NULL))::text AS no_cost
    FROM stock_receipts r
    JOIN stock_receipt_lines l ON l.receipt_id = r.id
    LEFT JOIN suppliers s ON s.id = r.supplier_id
    WHERE r.branch_id = ANY(${f.ids}::uuid[]) AND r.status = 'CONFIRMED'
      AND r.receipt_date BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY r.supplier_id, s.name
    ORDER BY s.name NULLS LAST`);
  const mapped: ReceiptSupplierRow[] = rows.map((row) => ({
    supplierId: row.supplier_id,
    supplierName: row.supplier,
    receipts: Number(row.receipts),
    units: Number(row.units),
    costVnd: costColumn ? row.cost : null,
    linesWithoutCost: Number(row.no_cost),
  }));
  return {
    generatedAt: context.now.toISOString(),
    branches: f.refs,
    period: { from: range.from, to: range.to },
    truncated: false,
    costColumn,
    rows: mapped,
  };
}
