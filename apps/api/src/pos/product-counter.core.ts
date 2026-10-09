import type { PosProductOptionsResponse } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { FROM_FOLDED, searchTokens, TO_FOLDED, likeLiteral } from '../employees/employee-search.js';
import { databaseClock } from './invoice.core.js';

/**
 * Phase 6 P6-10: what the counter needs to add a product line (design 5.2-5.4). Read only. The search works on the words of the
 * product name, brand, variant label and SKU without diacritics, so "kem duong" finds "Kem dưỡng 50 ml". The price is the effective
 * price now (the finalization freezes it), the availability is the one at THIS branch, and nothing about cost, lots or suppliers is
 * read. Authority is `SELL_PRODUCTS` at the branch.
 */
const LIMIT = 20;
const MAX_TERMS = 6;
const MAX_QUERY = 80;

interface Row {
  variant_id: string;
  product_id: string;
  sku: string;
  name_vi: string;
  name_en: string;
  label_vi: string | null;
  label_en: string | null;
  list_price_vnd: bigint;
  effective_price_vnd: bigint;
  on_promotion: boolean;
  available: number;
  sell_on_order: boolean;
  lead_min: number;
  lead_max: number;
}

export async function productCounterOptions(
  context: AdminContext,
  branchId: string,
  query: { q?: string },
): Promise<PosProductOptionsResponse> {
  const { tx } = context;
  const q = query.q ?? '';
  if (typeof q !== 'string' || q.length > MAX_QUERY) throw new AuthError('VALIDATION_FAILED', 'q');
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw new AuthError('NOT_FOUND');
  if (!decide(context.actor.graph, 'SELL_PRODUCTS', { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
  const patterns = searchTokens(q)
    .slice(0, MAX_TERMS)
    .map((term) => `%${likeLiteral(term)}%`);
  const now = await databaseClock(tx);
  const rows = await tx.$queryRaw<Row[]>`
    SELECT v.id AS variant_id, p.id AS product_id, v.sku, p.name_vi, p.name_en, v.label_vi, v.label_en,
           pr.list_price_vnd, pr.effective_price_vnd, (pr.effective_price_vnd < pr.list_price_vnd) AS on_promotion,
           lucy_available_stock(${branchId}::uuid, v.id) AS available, v.sell_on_order,
           COALESCE(v.lead_time_days_min, st.lead_time_days_min)::int AS lead_min,
           GREATEST(COALESCE(v.lead_time_days_max, st.lead_time_days_max), COALESCE(v.lead_time_days_min, st.lead_time_days_min))::int AS lead_max
    FROM products p
    JOIN product_variants v ON v.product_id = p.id AND v.is_active
    LEFT JOIN brands b ON b.id = p.brand_id
    CROSS JOIN LATERAL lucy_variant_price_at(v.id, ${now}::timestamptz) pr
    CROSS JOIN product_settings st
    WHERE st.id = 1 AND p.status = 'PUBLISHED' AND pr.effective_price_vnd IS NOT NULL
      AND (cardinality(${patterns}::text[]) = 0 OR NOT EXISTS (
        SELECT 1 FROM unnest(${patterns}::text[]) AS t(pat)
        WHERE translate(lower(normalize(
                p.name_vi || ' ' || p.name_en || ' ' || COALESCE(b.name_vi, '') || ' ' || COALESCE(b.name_en, '') || ' '
                || COALESCE(v.label_vi, '') || ' ' || COALESCE(v.label_en, '') || ' ' || v.sku, NFC)),
              ${FROM_FOLDED}, ${TO_FOLDED}) NOT LIKE t.pat))
    ORDER BY (lucy_available_stock(${branchId}::uuid, v.id) > 0) DESC, p.name_vi, v.sort_order, v.id
    LIMIT ${LIMIT + 1}`;
  const sellers = await tx.$queryRaw<{ id: string; full_name: string }[]>`
    SELECT DISTINCT u.id, u.full_name
    FROM users u JOIN employee_branch_assignments a ON a.employee_user_id = u.id
    WHERE a.branch_id = ${branchId}::uuid AND a.revoked_at IS NULL AND u.kind = 'EMPLOYEE' AND u.status = 'ACTIVE'
    ORDER BY u.full_name, u.id`;
  const caller = context.actor.userId;
  return {
    products: rows.slice(0, LIMIT).map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      sku: row.sku,
      nameVi: row.name_vi,
      nameEn: row.name_en,
      variantLabelVi: row.label_vi,
      variantLabelEn: row.label_en,
      unitPriceVnd: row.effective_price_vnd.toString(),
      listPriceVnd: row.list_price_vnd.toString(),
      onPromotion: row.on_promotion,
      available: Math.max(0, row.available),
      sellOnOrder: row.sell_on_order,
      leadTimeDaysMin: row.lead_min,
      leadTimeDaysMax: row.lead_max,
    })),
    truncated: rows.length > LIMIT,
    sellers: sellers.map((seller) => ({ id: seller.id, displayName: seller.full_name })),
    defaultSellerId: sellers.some((seller) => seller.id === caller) ? caller : null,
  };
}
