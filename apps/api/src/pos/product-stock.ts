import type { Prisma } from '@lucy-spa/database';
import { settleInvoiceStock } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 6 P6-8: what a product line needs from the catalog and the stock (design 4.5, 5.2; T12, T15). Pure database work with no
 * dependency on `invoice.core.ts` (which calls into this file at finalization and cancellation).
 *
 * - Price: the effective price of a variant at an instant is the SQL function `lucy_variant_price_at` (list price in force and the
 *   promotion running at that instant). A DRAFT line is repriced whenever the draft changes; finalization freezes it at the
 *   instant of finalization, which is the instant the database integrity check re-derives it from. Nobody can type a price.
 * - Stock: finalization reserves each line's quantity at the invoice branch under the stock level locks (sorted), refusing the
 *   whole finalization when anything is short; cancelling the unpaid invoice releases the reservations in the same transaction.
 *   Drafts reserve nothing (Q8). Consumption (the SALE movement) is `packages/server/src/stock-sales.ts` (P6-10).
 */

/** The largest quantity of one product line; availability is the real limit, this only rejects absurd input. */
export const MAX_PRODUCT_LINE_QUANTITY = 1000;

export interface EffectivePrice {
  listPriceVnd: bigint;
  effectivePriceVnd: bigint;
  promotionId: string | null;
  /** Wave 4 (P6-23): the campaign whose rule gave the price, when one did. */
  campaignId: string | null;
}

/** The effective price of a variant at `at`, or null when it has no list price yet (it cannot be sold). */
export async function effectivePriceAt(
  tx: Prisma.TransactionClient,
  variantId: string,
  at: Date,
): Promise<EffectivePrice | null> {
  const rows = await tx.$queryRaw<
    {
      list_price_vnd: bigint;
      effective_price_vnd: bigint;
      promotion_id: string | null;
      campaign_id: string | null;
    }[]
  >`SELECT p.list_price_vnd, p.effective_price_vnd, p.promotion_id,
           (SELECT m.campaign_id FROM lucy_variant_campaign_at(${variantId}::uuid, ${at}::timestamptz) m
            WHERE p.promotion_id IS NULL AND m.price_vnd = p.effective_price_vnd) AS campaign_id
    FROM lucy_variant_price_at(${variantId}::uuid, ${at}::timestamptz) p`;
  const row = rows[0];
  if (!row || row.list_price_vnd === null || row.effective_price_vnd === null) return null;
  return {
    listPriceVnd: row.list_price_vnd,
    effectivePriceVnd: row.effective_price_vnd,
    promotionId: row.promotion_id,
    campaignId: row.campaign_id,
  };
}

/**
 * Of the given users, those who may be the seller on an invoice of this branch: an ACTIVE employee with an active assignment to the
 * branch (design 5.3). The database guard re-verifies the same rule when a product detail is written or its seller changes.
 */
export async function eligibleSellers(
  tx: Prisma.TransactionClient,
  branchId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT u.id
    FROM users u
    JOIN employee_branch_assignments a ON a.employee_user_id = u.id
    WHERE u.id = ANY(${[...userIds]}::uuid[]) AND u.kind = 'EMPLOYEE' AND u.status = 'ACTIVE'
      AND a.branch_id = ${branchId}::uuid AND a.revoked_at IS NULL`;
  return new Set(rows.map((row) => row.id));
}

const productLineSelect = {
  id: true,
  sequence: true,
  quantity: true,
  unitPriceVnd: true,
  productDetails: {
    select: {
      variantId: true,
      sellerUserId: true,
      listPriceVnd: true,
      promotionId: true,
      fulfilmentMode: true,
    },
  },
} satisfies Prisma.InvoiceLineSelect;

type ProductLine = Prisma.InvoiceLineGetPayload<{ select: typeof productLineSelect }>;

async function productLines(tx: Prisma.TransactionClient, invoiceId: string) {
  const rows = await tx.invoiceLine.findMany({
    where: { invoiceId, kind: 'PRODUCT' },
    orderBy: { sequence: 'asc' },
    select: productLineSelect,
  });
  return rows.flatMap((row): { row: ProductLine; variantId: string; quantity: number }[] => {
    const detail = row.productDetails[0];
    if (!detail || row.quantity === null) throw new Error('Every product line has its detail.');
    return [{ row, variantId: detail.variantId, quantity: row.quantity }];
  });
}

/**
 * Reprices the product lines of a DRAFT at `now` (the draft's price is always the current effective price) and returns the lines
 * that changed. With `requireSellable`, also refuses a line whose product is no longer published, whose variant is inactive, that
 * has no price, or whose seller is no longer eligible (finalization): the share locks on the variant and product rows serialize
 * this against an administrator's edit. Lock order: after the programs, wallets and combo rows, before the stock levels.
 */
export async function repriceProductLines(
  tx: Prisma.TransactionClient,
  invoice: { id: string; branchId: string },
  now: Date,
  requireSellable: boolean,
): Promise<Map<string, { quantity: number; unitPriceVnd: bigint }>> {
  const lines = await productLines(tx, invoice.id);
  const result = new Map<string, { quantity: number; unitPriceVnd: bigint }>();
  if (lines.length === 0) return result;
  const variantIds = [...new Set(lines.map((line) => line.variantId))].sort();
  if (requireSellable) {
    await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ANY(${variantIds}::uuid[]) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM products WHERE id IN (SELECT product_id FROM product_variants WHERE id = ANY(${variantIds}::uuid[])) ORDER BY id FOR SHARE`;
  }
  const catalog = new Map(
    (
      await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, isActive: true, product: { select: { status: true } } },
      })
    ).map((variant) => [variant.id, variant]),
  );
  const sellers = requireSellable
    ? await eligibleSellers(tx, invoice.branchId, [
        ...new Set(
          lines.flatMap((line) => {
            const seller = line.row.productDetails[0]!.sellerUserId;
            return seller === null ? [] : [seller];
          }),
        ),
      ])
    : new Set<string>();
  for (const line of lines) {
    const detail = line.row.productDetails[0]!;
    const variant = catalog.get(line.variantId);
    const price = await effectivePriceAt(tx, line.variantId, now);
    if (
      !price ||
      (requireSellable && (!variant?.isActive || variant.product.status !== 'PUBLISHED'))
    ) {
      throw new AuthError('PRODUCT_NOT_SELLABLE', line.row.id);
    }
    // An online line has no seller (W4-2); the seller of a counter line must still be eligible.
    if (requireSellable && detail.sellerUserId !== null && !sellers.has(detail.sellerUserId)) {
      throw new AuthError('PRODUCT_SELLER_INVALID', line.row.id);
    }
    // The line is rewritten only when its price moved (a line change bumps its version by one, SQL guard); the detail records the
    // resolution instant either way: at finalization that instant is the one the integrity check re-derives the price from.
    if (line.row.unitPriceVnd !== price.effectivePriceVnd) {
      await tx.invoiceLine.update({
        where: { id: line.row.id },
        data: {
          unitPriceVnd: price.effectivePriceVnd,
          grossVnd: BigInt(line.quantity) * price.effectivePriceVnd,
          rowVersion: { increment: 1 },
        },
        select: { id: true },
      });
    }
    await tx.invoiceLineProduct.update({
      where: { invoiceLineId: line.row.id },
      data: {
        listPriceVnd: price.listPriceVnd,
        promotionId: price.promotionId,
        campaignId: price.campaignId,
        pricedAt: now,
      },
      select: { invoiceLineId: true },
    });
    result.set(line.row.id, { quantity: line.quantity, unitPriceVnd: price.effectivePriceVnd });
  }
  return result;
}

/**
 * Reserves the stock of every product line of the invoice being finalized (T15, Q8). Under the stock level locks, taken in
 * (branch, variant) order, each variant must have the SUM of its lines available (not expired, not reserved elsewhere); a variant
 * that has never been received has no level row and is out of stock. If any line is short nothing is written and the whole
 * finalization is refused with `PRODUCT_OUT_OF_STOCK` naming the lines. One reservation per line: a repeated call finds them.
 */
export async function reserveProductStock(
  tx: Prisma.TransactionClient,
  invoice: { id: string; branchId: string },
  actorUserId: string,
): Promise<number> {
  // Phase 6 P6-15 (T29): a PRE_ORDER line sells goods the shop does not hold; it reserves nothing now and is reserved on arrival.
  const lines = (await productLines(tx, invoice.id)).filter(
    (line) => line.row.productDetails[0]?.fulfilmentMode !== 'PRE_ORDER',
  );
  if (lines.length === 0) return 0;
  const totals = new Map<string, number>();
  for (const line of lines)
    totals.set(line.variantId, (totals.get(line.variantId) ?? 0) + line.quantity);
  const variantIds = [...totals.keys()].sort();
  const locked = await tx.$queryRaw<{ variant_id: string }[]>`
    SELECT variant_id FROM stock_levels
    WHERE branch_id = ${invoice.branchId}::uuid AND variant_id = ANY(${variantIds}::uuid[])
    ORDER BY variant_id FOR UPDATE`;
  const hasLevel = new Set(locked.map((row) => row.variant_id));
  const short = new Set<string>();
  for (const variantId of variantIds) {
    if (!hasLevel.has(variantId)) {
      short.add(variantId);
      continue;
    }
    const [available] = await tx.$queryRaw<
      { available: number }[]
    >`SELECT lucy_available_stock(${invoice.branchId}::uuid, ${variantId}::uuid) AS available`;
    if ((available?.available ?? 0) < totals.get(variantId)!) short.add(variantId);
  }
  if (short.size > 0) {
    throw new AuthError(
      'PRODUCT_OUT_OF_STOCK',
      lines
        .filter((line) => short.has(line.variantId))
        .map((line) => line.row.id)
        .join(','),
    );
  }
  for (const line of lines) {
    await tx.stockReservation.create({
      data: {
        invoiceLineId: line.row.id,
        invoiceId: invoice.id,
        branchId: invoice.branchId,
        variantId: line.variantId,
        quantity: line.quantity,
        createdByUserId: actorUserId,
      },
      select: { id: true },
    });
  }
  return lines.length;
}

/**
 * Gives back and releases the reservations of an invoice that has just been CANCELLED (the same transaction), once: the stock becomes
 * available again. The level rows are locked in (branch, variant) order, like the reservation. A cancelled draft holds none.
 */
export async function releaseProductStock(
  tx: Prisma.TransactionClient,
  invoice: { id: string; paidSeq: number },
  actorUserId: string,
  cause: 'INVOICE_CANCELLED_UNPAID' | 'ZERO_BALANCE_CORRECTION',
): Promise<number> {
  // Phase 6 P6-10 (T27): a sale the consumer has not yet reversed (the payment was reversed, or the zero-balance invoice was paid,
  // and the invoice is cancelled before the consumer saw it) is reversed here, in the cancelling transaction: a cancelled invoice
  // holds no live reservation at commit (P6-8 rule). The consumer then finds nothing left to do.
  const returned = await settleInvoiceStock(
    tx,
    { id: invoice.id, status: 'CANCELLED', paidSeq: invoice.paidSeq },
    { actorUserId, releaseCause: cause },
  );
  const open = await tx.stockReservation.findMany({
    where: { invoiceId: invoice.id, status: 'RESERVED', source: 'INVOICE_LINE' },
    orderBy: [{ branchId: 'asc' }, { variantId: 'asc' }, { invoiceLineId: 'asc' }],
    select: { id: true, branchId: true, variantId: true },
  });
  if (open.length === 0) return returned.released;
  const branchIds = [...new Set(open.map((row) => row.branchId))].sort();
  const variantIds = [...new Set(open.map((row) => row.variantId))].sort();
  await tx.$queryRaw`
    SELECT 1 FROM stock_levels
    WHERE branch_id = ANY(${branchIds}::uuid[]) AND variant_id = ANY(${variantIds}::uuid[])
    ORDER BY branch_id, variant_id FOR UPDATE`;
  for (const reservation of open) {
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: 'RELEASED', releasedByUserId: actorUserId, releaseCause: cause },
      select: { id: true },
    });
  }
  return open.length + returned.released;
}
