import {
  SALES_ROW_LIMIT,
  type CampaignRow,
  type ComboReport,
  type ComboRow,
  type DiscountReport,
  type DiscountRow,
  type OnlineOrderReport,
  type OnlineOrderRow,
  type OnlineOrderReportState,
  type ProductGrouping,
  type ProductRevenueReport,
  type ProductRevenueRow,
  type ReportBranchRef,
  type ReportPeriod,
  type ServiceRevenueReport,
  type ServiceRevenueRow,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { parseRange, type ReportRange } from './report.dates.js';
import type { ReportBranch, ReportContext } from './report.frame.js';
import { loadOnlineHeld, factCtes } from './revenue.sql.js';

/**
 * Phase 8 P8-7 (docs/PHASE8_REPORTS.md 4.2, R5-R9): what was sold, by service, product, combo, discount and online order. The money of a
 * service, a product or a combo is the revenue FACTS of the revenue report grouped by invoice line, so it is always a part of the
 * headline. Quantities count the invoices that became PAID in the period (by the branch-local day of `paid_at`). Read-only.
 */

export interface SalesQuery {
  from?: unknown;
  to?: unknown;
  branchId?: unknown;
  /** Set by an export: the branches where the person may both see the report and take it out. */
  restrictTo?: readonly ReportBranch[];
}

interface Frame {
  covered: readonly ReportBranch[];
  range: ReportRange;
  ids: string[];
  scope: { branchIds: string[]; from: string; to: string };
  period: ReportPeriod;
  refs: ReportBranchRef[];
}

function frame(context: ReportContext, query: SalesQuery): Frame {
  const covered = query.restrictTo ?? context.scope(['VIEW_REVENUE'], query.branchId);
  const range = parseRange(query);
  const ids = covered.map((branch) => branch.id);
  return {
    covered,
    range,
    ids,
    scope: { branchIds: ids, from: range.from, to: range.to },
    period: { from: range.from, to: range.to, previous: null },
    refs: covered.map(({ id, code, name }) => ({ id, code, name })),
  };
}

const bp = (part: bigint, whole: bigint): number =>
  whole <= 0n ? 0 : Number((part * 10000n * 2n + whole) / (whole * 2n));

/** `paid_at` of invoice alias `i` lies in the branch-local days of the range (branch alias `b`). */
const paidIn = (range: ReportRange) => Prisma.sql`
  i.status = 'PAID'
  AND i.paid_at >= ((${range.from}::date)::timestamp AT TIME ZONE b.timezone)
  AND i.paid_at < ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)`;

// ------------------------------------------------------------------------------------------------------------ R5 services

export async function serviceRevenue(
  context: ReportContext,
  query: SalesQuery,
): Promise<ServiceRevenueReport> {
  const f = frame(context, query);
  const net = await context.tx.$queryRaw<{ service_id: string | null; net: string }[]>(Prisma.sql`
    WITH ${factCtes(f.scope)}
    SELECT ils.service_id::text AS service_id, sum(x.amount_vnd)::text AS net
    FROM facts x
    LEFT JOIN invoice_line_services ils ON ils.invoice_line_id = x.line_id
    WHERE x.kind = 'SERVICE'
    GROUP BY ils.service_id`);
  const quantity = await context.tx.$queryRaw<{ service_id: string; qty: string }[]>(Prisma.sql`
    SELECT ils.service_id::text AS service_id, sum(COALESCE(il.quantity, 1))::text AS qty
    FROM invoices i
    JOIN branches b ON b.id = i.branch_id
    JOIN invoice_lines il ON il.invoice_id = i.id AND il.kind = 'SERVICE'
    JOIN invoice_line_services ils ON ils.invoice_line_id = il.id
    WHERE i.branch_id = ANY(${f.ids}::uuid[]) AND ${paidIn(f.range)}
    GROUP BY ils.service_id`);
  const qty = new Map(quantity.map((row) => [row.service_id, Number(row.qty)]));
  const ids = [...new Set([...net.map((r) => r.service_id), ...qty.keys()])].filter(
    (id): id is string => id !== null,
  );
  const services = ids.length
    ? await context.tx.service.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          code: true,
          nameVi: true,
          nameEn: true,
          category: { select: { nameVi: true, nameEn: true } },
        },
      })
    : [];
  const byId = new Map(services.map((service) => [service.id, service]));
  const money = new Map<string | null, bigint>();
  for (const row of net) money.set(row.service_id, BigInt(row.net));
  for (const id of ids) if (!money.has(id)) money.set(id, 0n);
  const total = [...money.values()].reduce((a, b) => a + b, 0n);
  const rows: ServiceRevenueRow[] = [...money.entries()]
    .map(([id, value]): ServiceRevenueRow => {
      const service = id === null ? undefined : byId.get(id);
      return {
        serviceId: id,
        code: service?.code ?? null,
        nameVi: service?.nameVi ?? 'Khác',
        nameEn: service?.nameEn ?? 'Other',
        categoryNameVi: service?.category.nameVi ?? null,
        categoryNameEn: service?.category.nameEn ?? null,
        quantity: id === null ? 0 : (qty.get(id) ?? 0),
        netVnd: value.toString(),
        shareBp: bp(value, total),
      };
    })
    .sort(
      (a, b) =>
        Number(BigInt(b.netVnd) - BigInt(a.netVnd)) || a.nameVi.localeCompare(b.nameVi, 'vi'),
    );
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    truncated: rows.length > SALES_ROW_LIMIT,
    rows: rows.slice(0, SALES_ROW_LIMIT),
    totals: {
      netVnd: total.toString(),
      quantity: rows.reduce((acc, row) => acc + row.quantity, 0),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ R6 products

export function parseGrouping(value: unknown): ProductGrouping {
  if (value === undefined || value === '') return 'variant';
  if (value === 'variant' || value === 'brand' || value === 'category') return value;
  throw new AuthError('VALIDATION_FAILED', 'by');
}

export async function productRevenue(
  context: ReportContext,
  query: SalesQuery & { by?: unknown },
): Promise<ProductRevenueReport> {
  const f = frame(context, query);
  const by = parseGrouping(query.by);
  const column = Prisma.raw(
    by === 'variant' ? 'ilp.variant_id' : by === 'brand' ? 'ilp.brand_id' : 'ilp.category_id',
  );
  const net = await context.tx.$queryRaw<
    {
      key: string | null;
      net: string;
      sku: string | null;
      name_vi: string | null;
      name_en: string | null;
      label_vi: string | null;
      label_en: string | null;
      brand_id: string | null;
      category_id: string | null;
    }[]
  >(Prisma.sql`
    WITH ${factCtes(f.scope)}
    SELECT ${column}::text AS key, sum(x.amount_vnd)::text AS net,
           max(ilp.sku) AS sku, max(ilp.product_name_vi) AS name_vi, max(ilp.product_name_en) AS name_en,
           max(ilp.variant_label_vi) AS label_vi, max(ilp.variant_label_en) AS label_en,
           max(ilp.brand_id::text) AS brand_id, max(ilp.category_id::text) AS category_id
    FROM facts x
    LEFT JOIN invoice_line_products ilp ON ilp.invoice_line_id = x.line_id
    WHERE x.kind = 'PRODUCT'
    GROUP BY ${column}`);
  const sold = await context.tx.$queryRaw<{ key: string | null; qty: string }[]>(Prisma.sql`
    SELECT ${column}::text AS key, sum(COALESCE(il.quantity, 1))::text AS qty
    FROM invoices i
    JOIN branches b ON b.id = i.branch_id
    JOIN invoice_lines il ON il.invoice_id = i.id AND il.kind = 'PRODUCT'
    JOIN invoice_line_products ilp ON ilp.invoice_line_id = il.id
    WHERE i.branch_id = ANY(${f.ids}::uuid[]) AND ${paidIn(f.range)}
    GROUP BY ${column}`);
  const refunded = await context.tx.$queryRaw<{ key: string | null; qty: string }[]>(Prisma.sql`
    SELECT ${column}::text AS key, sum(r.quantity)::text AS qty
    FROM product_refunds r
    JOIN branches b ON b.id = r.branch_id
    JOIN invoice_line_products ilp ON ilp.invoice_line_id = r.invoice_line_id
    WHERE r.branch_id = ANY(${f.ids}::uuid[])
      AND r.occurred_at >= ((${f.range.from}::date)::timestamp AT TIME ZONE b.timezone)
      AND r.occurred_at < ((${f.range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)
    GROUP BY ${column}`);
  const soldBy = new Map(sold.map((row) => [row.key, Number(row.qty)]));
  const refundedBy = new Map(refunded.map((row) => [row.key, Number(row.qty)]));
  const keys = new Set<string | null>([
    ...net.map((r) => r.key),
    ...soldBy.keys(),
    ...refundedBy.keys(),
  ]);
  const money = new Map(net.map((row) => [row.key, row]));
  const brandIds = new Set<string>();
  const categoryIds = new Set<string>();
  for (const row of net) {
    if (row.brand_id) brandIds.add(row.brand_id);
    if (row.category_id) categoryIds.add(row.category_id);
    if (by === 'brand' && row.key) brandIds.add(row.key);
    if (by === 'category' && row.key) categoryIds.add(row.key);
  }
  const [brands, categories] = await Promise.all([
    brandIds.size
      ? context.tx.brand.findMany({
          where: { id: { in: [...brandIds] } },
          select: { id: true, nameVi: true, nameEn: true },
        })
      : [],
    categoryIds.size
      ? context.tx.productCategory.findMany({
          where: { id: { in: [...categoryIds] } },
          select: { id: true, nameVi: true, nameEn: true },
        })
      : [],
  ]);
  const brandName = new Map(brands.map((b) => [b.id, b]));
  const categoryName = new Map(categories.map((c) => [c.id, c]));
  const total = [...money.values()].reduce((acc, row) => acc + BigInt(row.net), 0n);
  const rows: ProductRevenueRow[] = [...keys].map((key) => {
    const row = money.get(key);
    const value = BigInt(row?.net ?? '0');
    const brand =
      by === 'brand' && key
        ? brandName.get(key)
        : row?.brand_id
          ? brandName.get(row.brand_id)
          : undefined;
    const category =
      by === 'category' && key
        ? categoryName.get(key)
        : row?.category_id
          ? categoryName.get(row.category_id)
          : undefined;
    const variantVi = row?.label_vi ? ` (${row.label_vi})` : '';
    const variantEn = row?.label_en ? ` (${row.label_en})` : '';
    const nameVi =
      by === 'variant'
        ? `${row?.name_vi ?? 'Khác'}${variantVi}`
        : by === 'brand'
          ? (brand?.nameVi ?? 'Không rõ thương hiệu')
          : (category?.nameVi ?? 'Không rõ nhóm');
    const nameEn =
      by === 'variant'
        ? `${row?.name_en ?? 'Other'}${variantEn}`
        : by === 'brand'
          ? (brand?.nameEn ?? 'No brand')
          : (category?.nameEn ?? 'No category');
    return {
      key,
      sku: by === 'variant' ? (row?.sku ?? null) : null,
      nameVi,
      nameEn,
      brandNameVi: by === 'category' ? null : (brand?.nameVi ?? null),
      brandNameEn: by === 'category' ? null : (brand?.nameEn ?? null),
      categoryNameVi: by === 'brand' ? null : (category?.nameVi ?? null),
      categoryNameEn: by === 'brand' ? null : (category?.nameEn ?? null),
      unitsSold: soldBy.get(key) ?? 0,
      unitsRefunded: refundedBy.get(key) ?? 0,
      netVnd: value.toString(),
      shareBp: bp(value, total),
    };
  });
  rows.sort(
    (a, b) => Number(BigInt(b.netVnd) - BigInt(a.netVnd)) || a.nameVi.localeCompare(b.nameVi, 'vi'),
  );
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    truncated: rows.length > SALES_ROW_LIMIT,
    by,
    rows: rows.slice(0, SALES_ROW_LIMIT),
    totals: {
      netVnd: total.toString(),
      unitsSold: rows.reduce((acc, row) => acc + row.unitsSold, 0),
      unitsRefunded: rows.reduce((acc, row) => acc + row.unitsRefunded, 0),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- R7 combos

export async function comboReport(context: ReportContext, query: SalesQuery): Promise<ComboReport> {
  const f = frame(context, query);
  const revenue = await context.tx.$queryRaw<{ combo_id: string | null; net: string }[]>(Prisma.sql`
    WITH ${factCtes(f.scope)}
    SELECT ilc.combo_id::text AS combo_id, sum(x.amount_vnd)::text AS net
    FROM facts x
    LEFT JOIN invoice_line_combos ilc ON ilc.invoice_line_id = x.line_id
    WHERE x.kind = 'COMBO'
    GROUP BY ilc.combo_id`);
  const sold = await context.tx.$queryRaw<
    {
      combo_id: string;
      n: string;
      voided: string;
      price: string;
      sessions: string;
      name_vi: string;
      name_en: string;
    }[]
  >(Prisma.sql`
    SELECT cp.combo_id::text AS combo_id, count(*)::text AS n,
           (count(*) FILTER (WHERE cp.voided_at IS NOT NULL))::text AS voided,
           COALESCE(sum(cp.price_vnd), 0)::text AS price,
           COALESCE(sum(cp.paid_sessions + cp.bonus_sessions), 0)::text AS sessions,
           max(cp.name_vi) AS name_vi, max(cp.name_en) AS name_en
    FROM combo_purchases cp
    JOIN invoice_lines il ON il.id = cp.invoice_line_id
    JOIN invoices i ON i.id = il.invoice_id
    JOIN branches b ON b.id = i.branch_id
    WHERE i.branch_id = ANY(${f.ids}::uuid[])
      AND cp.issued_at >= ((${f.range.from}::date)::timestamp AT TIME ZONE b.timezone)
      AND cp.issued_at < ((${f.range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)
    GROUP BY cp.combo_id`);
  const used = await context.tx.$queryRaw<{ combo_id: string; n: string }[]>(Prisma.sql`
    SELECT cp.combo_id::text AS combo_id, count(*)::text AS n
    FROM combo_session_consumptions cc
    JOIN combo_sessions s ON s.id = cc.session_id
    JOIN combo_purchases cp ON cp.id = s.purchase_id
    JOIN branches b ON b.id = cc.branch_id
    WHERE cc.branch_id = ANY(${f.ids}::uuid[])
      AND cc.consumed_at >= ((${f.range.from}::date)::timestamp AT TIME ZONE b.timezone)
      AND cc.consumed_at < ((${f.range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)
      AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = cc.id)
      AND NOT EXISTS (SELECT 1 FROM combo_session_restorations r WHERE r.consumption_id = cc.id)
    GROUP BY cp.combo_id`);
  const left = await context.tx.$queryRaw<
    { combo_id: string; remaining: string; expired: string; name_vi: string; name_en: string }[]
  >(Prisma.sql`
    WITH ps AS (
      SELECT cp.id, cp.combo_id, cp.expires_at, max(cp.name_vi) AS name_vi, max(cp.name_en) AS name_en,
             count(s.id) AS total,
             count(s.id) FILTER (WHERE EXISTS (
               SELECT 1 FROM combo_session_consumptions cc
               WHERE cc.session_id = s.id
                 AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = cc.id)
                 AND NOT EXISTS (SELECT 1 FROM combo_session_restorations r WHERE r.consumption_id = cc.id))) AS used
      FROM combo_purchases cp
      JOIN invoice_lines il ON il.id = cp.invoice_line_id
      JOIN invoices i ON i.id = il.invoice_id
      JOIN combo_sessions s ON s.purchase_id = cp.id
      WHERE cp.voided_at IS NULL AND i.branch_id = ANY(${f.ids}::uuid[])
      GROUP BY cp.id, cp.combo_id, cp.expires_at
    )
    SELECT combo_id::text AS combo_id,
           COALESCE(sum(CASE WHEN expires_at IS NOT NULL AND expires_at <= ${context.now} THEN 0 ELSE total - used END), 0)::text AS remaining,
           COALESCE(sum(CASE WHEN expires_at IS NOT NULL AND expires_at <= ${context.now} THEN total - used ELSE 0 END), 0)::text AS expired,
           max(name_vi) AS name_vi, max(name_en) AS name_en
    FROM ps GROUP BY combo_id`);
  const ids = new Set<string>([
    ...sold.map((r) => r.combo_id),
    ...used.map((r) => r.combo_id),
    ...left.map((r) => r.combo_id),
    ...revenue.map((r) => r.combo_id).filter((id): id is string => id !== null),
  ]);
  const soldBy = new Map(sold.map((r) => [r.combo_id, r]));
  const usedBy = new Map(used.map((r) => [r.combo_id, Number(r.n)]));
  const leftBy = new Map(left.map((r) => [r.combo_id, r]));
  const revenueBy = new Map(revenue.map((r) => [r.combo_id, BigInt(r.net)]));
  const rows: ComboRow[] = [...ids].map((id) => {
    const s = soldBy.get(id);
    const l = leftBy.get(id);
    return {
      comboId: id,
      nameVi: s?.name_vi ?? l?.name_vi ?? 'Gói liệu trình',
      nameEn: s?.name_en ?? l?.name_en ?? 'Combo package',
      sold: s ? Number(s.n) : 0,
      voided: s ? Number(s.voided) : 0,
      soldPriceVnd: s?.price ?? '0',
      revenueVnd: (revenueBy.get(id) ?? 0n).toString(),
      sessionsSold: s ? Number(s.sessions) : 0,
      sessionsUsed: usedBy.get(id) ?? 0,
      sessionsRemaining: l ? Number(l.remaining) : 0,
      sessionsExpired: l ? Number(l.expired) : 0,
    };
  });
  rows.sort(
    (a, b) =>
      Number(BigInt(b.revenueVnd) - BigInt(a.revenueVnd)) || a.nameVi.localeCompare(b.nameVi, 'vi'),
  );
  const totalRevenue = [...revenueBy.values()].reduce((a, b) => a + b, 0n);
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    truncated: rows.length > SALES_ROW_LIMIT,
    rows: rows.slice(0, SALES_ROW_LIMIT),
    totals: {
      sold: rows.reduce((acc, row) => acc + row.sold, 0),
      revenueVnd: totalRevenue.toString(),
      sessionsUsed: rows.reduce((acc, row) => acc + row.sessionsUsed, 0),
      sessionsRemaining: rows.reduce((acc, row) => acc + row.sessionsRemaining, 0),
      sessionsExpired: rows.reduce((acc, row) => acc + row.sessionsExpired, 0),
    },
  };
}

// ---------------------------------------------------------------------------------------------- R8 discounts and campaigns

export async function discountReport(
  context: ReportContext,
  query: SalesQuery,
): Promise<DiscountReport> {
  const f = frame(context, query);
  const programs = await context.tx.$queryRaw<
    {
      discount_id: string;
      voucher: boolean;
      code: string;
      name_vi: string;
      name_en: string;
      n: string;
      amount: string;
    }[]
  >(Prisma.sql`
    SELECT d.id::text AS discount_id, (a.voucher_id IS NOT NULL) AS voucher, d.code, d.name_vi, d.name_en,
           count(DISTINCT a.invoice_id)::text AS n, COALESCE(sum(a.computed_amount_vnd), 0)::text AS amount
    FROM (
      SELECT invoice_id, discount_id, voucher_id, computed_amount_vnd FROM invoice_discount_applications
      UNION ALL
      SELECT invoice_id, discount_id, voucher_id, computed_amount_vnd FROM invoice_beauty_applications
    ) a
    JOIN invoices i ON i.id = a.invoice_id
    JOIN branches b ON b.id = i.branch_id
    JOIN discounts d ON d.id = a.discount_id
    WHERE i.branch_id = ANY(${f.ids}::uuid[]) AND ${paidIn(f.range)}
    GROUP BY d.id, (a.voucher_id IS NOT NULL), d.code, d.name_vi, d.name_en`);
  const member = await context.tx.$queryRaw<{ n: string; amount: string }[]>(Prisma.sql`
    SELECT count(*)::text AS n, COALESCE(sum(s.member_amount_vnd), 0)::text AS amount
    FROM invoice_loyalty_snapshots s
    JOIN invoices i ON i.id = s.invoice_id
    JOIN branches b ON b.id = i.branch_id
    WHERE s.winner_source = 'MEMBER_TIER' AND s.member_amount_vnd > 0
      AND i.branch_id = ANY(${f.ids}::uuid[]) AND ${paidIn(f.range)}`);
  const birthday = await context.tx.$queryRaw<{ n: string; amount: string }[]>(Prisma.sql`
    SELECT count(*)::text AS n, COALESCE(sum(r.amount_vnd), 0)::text AS amount
    FROM birthday_redemptions r
    JOIN invoices i ON i.id = r.invoice_id
    JOIN branches b ON b.id = i.branch_id
    WHERE NOT EXISTS (SELECT 1 FROM birthday_redemption_releases x WHERE x.redemption_id = r.id)
      AND i.branch_id = ANY(${f.ids}::uuid[]) AND ${paidIn(f.range)}`);
  const [invoices] = await context.tx.$queryRaw<
    { paid: string; discounted: string; discount: string; subtotal: string }[]
  >(Prisma.sql`
    SELECT count(*)::text AS paid,
           (count(*) FILTER (WHERE i.discount_total_vnd > 0))::text AS discounted,
           COALESCE(sum(i.discount_total_vnd), 0)::text AS discount,
           COALESCE(sum(i.subtotal_vnd), 0)::text AS subtotal
    FROM invoices i JOIN branches b ON b.id = i.branch_id
    WHERE i.branch_id = ANY(${f.ids}::uuid[]) AND ${paidIn(f.range)}`);
  const campaigns = await context.tx.$queryRaw<
    { campaign_id: string; name_vi: string; name_en: string; units: string; net: string }[]
  >(Prisma.sql`
    WITH ${factCtes(f.scope)}
    SELECT pc.id::text AS campaign_id, pc.name_vi, pc.name_en,
           (SELECT COALESCE(sum(COALESCE(il2.quantity, 1)), 0)
              FROM invoice_line_products p2
              JOIN invoice_lines il2 ON il2.id = p2.invoice_line_id
              JOIN invoices i2 ON i2.id = il2.invoice_id
              JOIN branches b ON b.id = i2.branch_id
              WHERE p2.campaign_id = pc.id AND i2.branch_id = ANY(${f.ids}::uuid[]) AND ${paidInAlias(f.range, 'i2')})::text AS units,
           sum(x.amount_vnd)::text AS net
    FROM facts x
    JOIN invoice_line_products ilp ON ilp.invoice_line_id = x.line_id
    JOIN product_campaigns pc ON pc.id = ilp.campaign_id
    WHERE x.kind = 'PRODUCT'
    GROUP BY pc.id, pc.name_vi, pc.name_en`);

  const rows: DiscountRow[] = programs.map((row) => ({
    type: row.voucher ? 'VOUCHER' : 'PROGRAM',
    discountId: row.discount_id,
    code: row.code,
    nameVi: row.name_vi,
    nameEn: row.name_en,
    invoices: Number(row.n),
    amountVnd: row.amount,
  }));
  const memberRow = member[0];
  if (memberRow && Number(memberRow.n) > 0) {
    rows.push({
      type: 'MEMBER',
      discountId: null,
      code: null,
      nameVi: 'Ưu đãi hạng thành viên',
      nameEn: 'Member tier discount',
      invoices: Number(memberRow.n),
      amountVnd: memberRow.amount,
    });
  }
  const birthdayRow = birthday[0];
  if (birthdayRow && Number(birthdayRow.n) > 0) {
    rows.push({
      type: 'BIRTHDAY',
      discountId: null,
      code: null,
      nameVi: 'Ưu đãi sinh nhật',
      nameEn: 'Birthday reward',
      invoices: Number(birthdayRow.n),
      amountVnd: birthdayRow.amount,
    });
  }
  const headerDiscount = BigInt(invoices?.discount ?? '0');
  const explained = rows.reduce((acc, row) => acc + BigInt(row.amountVnd), 0n);
  // Money the invoices took off that no discount record explains is shown, never hidden (for example a discount header of the first kind).
  if (explained !== headerDiscount) {
    rows.push({
      type: 'OTHER',
      discountId: null,
      code: null,
      nameVi: 'Khác (chưa rõ nguồn)',
      nameEn: 'Other (source not recorded)',
      invoices: 0,
      amountVnd: (headerDiscount - explained).toString(),
    });
  }
  rows.sort(
    (a, b) =>
      Number(BigInt(b.amountVnd) - BigInt(a.amountVnd)) || a.nameVi.localeCompare(b.nameVi, 'vi'),
  );
  const campaignRows: CampaignRow[] = campaigns
    .map((row) => ({
      campaignId: row.campaign_id,
      nameVi: row.name_vi,
      nameEn: row.name_en,
      units: Number(row.units),
      netVnd: row.net,
    }))
    .sort((a, b) => Number(BigInt(b.netVnd) - BigInt(a.netVnd)));
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    truncated: false,
    rows,
    campaigns: campaignRows,
    totals: {
      discountVnd: headerDiscount.toString(),
      discountedInvoices: Number(invoices?.discounted ?? '0'),
      paidInvoices: Number(invoices?.paid ?? '0'),
      // The rows explain the money by who gave it; any difference with the invoices' own discount total is shown by the caller as is.
      discountShareBp: bp(headerDiscount, BigInt(invoices?.subtotal ?? '0')),
    },
  };
}

const paidInAlias = (range: ReportRange, alias: string) => Prisma.sql`
  ${Prisma.raw(alias)}.status = 'PAID'
  AND ${Prisma.raw(alias)}.paid_at >= ((${range.from}::date)::timestamp AT TIME ZONE b.timezone)
  AND ${Prisma.raw(alias)}.paid_at < ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)`;

// ------------------------------------------------------------------------------------------------------ R9 online orders

export const ONLINE_PAGE_SIZE = 20;

function parsePage(value: unknown): number {
  if (value === undefined || value === '') return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value))
    throw new AuthError('VALIDATION_FAILED', 'page');
  return Number(value);
}

const ordersSql = (ids: string[], range: ReportRange) => Prisma.sql`
  orders AS (
    SELECT po.id, po.code AS order_code, i.code AS invoice_code, po.branch_id, i.business_date AS day, i.total_vnd,
           po.contact_name, po.contact_phone, po.invoice_id,
           CASE WHEN ol.all_cancelled THEN 'CANCELLED'
                WHEN ol.closed AND ol.delivered_at IS NOT NULL THEN 'DELIVERED'
                ELSE 'AWAITING_DELIVERY' END AS state,
           (ol.delivered_at AT TIME ZONE b.timezone)::date AS delivered_on,
           COALESCE((SELECT sum(p.amount_vnd) FROM payments p
                      WHERE p.invoice_id = po.invoice_id AND p.status = 'SUCCEEDED'
                        AND NOT EXISTS (SELECT 1 FROM payment_corrections c WHERE c.payment_id = p.id)), 0) AS collected,
           COALESCE((SELECT sum(r.amount_vnd) FROM product_refunds r WHERE r.invoice_id = po.invoice_id), 0) AS refunded,
           COALESCE((SELECT sum(r.amount_vnd) FROM product_refunds r WHERE r.invoice_id = po.invoice_id AND r.settlement_id IS NOT NULL), 0) AS failed_refunds,
           ref.code AS staff_code
    FROM product_orders po
    JOIN invoices i ON i.id = po.invoice_id
    JOIN branches b ON b.id = po.branch_id
    JOIN LATERAL (
      SELECT bool_and(l.status IN ('COMPLETED', 'CANCELLED')) AS closed,
             bool_and(l.status = 'CANCELLED') AS all_cancelled,
             max(l.delivered_at) FILTER (WHERE l.status = 'COMPLETED') AS delivered_at
      FROM product_order_lines l WHERE l.order_id = po.id
    ) ol ON true
    LEFT JOIN order_referrals ref ON ref.invoice_id = po.invoice_id
    WHERE po.channel = 'ONLINE' AND po.branch_id = ANY(${ids}::uuid[])
      AND i.business_date BETWEEN ${range.from}::date AND ${range.to}::date
  )`;

export async function onlineOrderReport(
  context: ReportContext,
  query: SalesQuery & { page?: unknown },
): Promise<OnlineOrderReport> {
  const f = frame(context, query);
  const page = parsePage(query.page);
  const [summary] = await context.tx.$queryRaw<
    {
      orders: string;
      delivered: string;
      awaiting: string;
      cancelled: string;
      collected: string;
      refunded: string;
      failed: string;
      staff_orders: string;
      staff_collected: string;
    }[]
  >(Prisma.sql`
    WITH ${ordersSql(f.ids, f.range)}
    SELECT count(*)::text AS orders,
           (count(*) FILTER (WHERE state = 'DELIVERED'))::text AS delivered,
           (count(*) FILTER (WHERE state = 'AWAITING_DELIVERY'))::text AS awaiting,
           (count(*) FILTER (WHERE state = 'CANCELLED'))::text AS cancelled,
           COALESCE(sum(collected), 0)::text AS collected,
           COALESCE(sum(refunded), 0)::text AS refunded,
           COALESCE(sum(failed_refunds), 0)::text AS failed,
           (count(*) FILTER (WHERE staff_code IS NOT NULL))::text AS staff_orders,
           COALESCE(sum(collected) FILTER (WHERE staff_code IS NOT NULL), 0)::text AS staff_collected
    FROM orders`);
  const rows = await context.tx.$queryRaw<
    {
      order_code: string;
      invoice_code: string;
      branch_id: string;
      day: string;
      state: OnlineOrderReportState;
      contact_name: string | null;
      contact_phone: string;
      total: string;
      collected: string;
      refunded: string;
      delivered_on: string | null;
      staff_code: string | null;
    }[]
  >(Prisma.sql`
    WITH ${ordersSql(f.ids, f.range)}
    SELECT order_code, invoice_code, branch_id::text AS branch_id, to_char(day, 'YYYY-MM-DD') AS day, state,
           contact_name, contact_phone, total_vnd::text AS total, collected::text AS collected, refunded::text AS refunded,
           to_char(delivered_on, 'YYYY-MM-DD') AS delivered_on, staff_code
    FROM orders
    ORDER BY day DESC, order_code DESC
    LIMIT ${ONLINE_PAGE_SIZE} OFFSET ${(page - 1) * ONLINE_PAGE_SIZE}`);
  const byId = new Map(f.refs.map((branch) => [branch.id, branch]));
  const held = await loadOnlineHeld(context.tx, f.ids);
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    summary: {
      orders: Number(summary?.orders ?? '0'),
      delivered: Number(summary?.delivered ?? '0'),
      awaitingDelivery: Number(summary?.awaiting ?? '0'),
      cancelled: Number(summary?.cancelled ?? '0'),
      heldVnd: held.toString(),
      collectedVnd: summary?.collected ?? '0',
      refundedVnd: summary?.refunded ?? '0',
      failedDeliveryRefundsVnd: summary?.failed ?? '0',
      staffCodeOrders: Number(summary?.staff_orders ?? '0'),
      staffCodeCollectedVnd: summary?.staff_collected ?? '0',
    },
    page,
    pageSize: ONLINE_PAGE_SIZE,
    total: Number(summary?.orders ?? '0'),
    rows: rows.map((row): OnlineOrderRow => ({
      orderCode: row.order_code,
      invoiceCode: row.invoice_code,
      branch: byId.get(row.branch_id)!,
      date: row.day,
      state: row.state,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      totalVnd: row.total,
      collectedVnd: row.collected,
      refundedVnd: row.refunded,
      deliveredOn: row.delivered_on,
      staffCode: row.staff_code,
    })),
  };
}

/** All rows of the online orders for an export (the page window removed), at most `limit`. */
export async function loadOnlineOrderRows(
  context: ReportContext,
  branches: readonly ReportBranch[],
  range: ReportRange,
  limit: number,
): Promise<OnlineOrderRow[]> {
  const ids = branches.map((b) => b.id);
  const byId = new Map(branches.map((b) => [b.id, { id: b.id, code: b.code, name: b.name }]));
  const rows = await context.tx.$queryRaw<
    {
      order_code: string;
      invoice_code: string;
      branch_id: string;
      day: string;
      state: OnlineOrderReportState;
      contact_name: string | null;
      contact_phone: string;
      total: string;
      collected: string;
      refunded: string;
      delivered_on: string | null;
      staff_code: string | null;
    }[]
  >(Prisma.sql`
    WITH ${ordersSql(ids, range)}
    SELECT order_code, invoice_code, branch_id::text AS branch_id, to_char(day, 'YYYY-MM-DD') AS day, state,
           contact_name, contact_phone, total_vnd::text AS total, collected::text AS collected, refunded::text AS refunded,
           to_char(delivered_on, 'YYYY-MM-DD') AS delivered_on, staff_code
    FROM orders ORDER BY day DESC, order_code DESC LIMIT ${limit}`);
  return rows.map((row) => ({
    orderCode: row.order_code,
    invoiceCode: row.invoice_code,
    branch: byId.get(row.branch_id)!,
    date: row.day,
    state: row.state,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    totalVnd: row.total,
    collectedVnd: row.collected,
    refundedVnd: row.refunded,
    deliveredOn: row.delivered_on,
    staffCode: row.staff_code,
  }));
}
