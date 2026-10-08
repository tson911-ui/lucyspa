import type { Prisma } from '@lucy-spa/database';

/**
 * Phase 6 P6-15 (design 18.3 P6-T30, 18.5): the waiting queue of pre-order lines and the allocation of arriving goods.
 *
 * A pre-order line is paid before its goods are in the shop. Per (branch, variant) the PAID or ORDERED lines wait in the order of
 * their paid time (oldest first, the id breaks a tie). When goods become free (a confirmed receipt, or a manual re-run), every
 * waiting line whose WHOLE quantity the free stock covers gets a reservation of source ORDER_LINE and becomes ARRIVED, oldest
 * first. A line the free stock does not cover is skipped, not split (OQ-84), and the lines behind it are still looked at: the free
 * stock is not left idle behind a large older line (a reading of T30, pending the Owner's review). Free stock is
 * `lucy_available_stock` (lots that are not expired minus every open reservation), so the goods held for a line are never sold to
 * anybody else, and a counter sale of the last unit and an allocation can never both take it (both reserve under the level lock).
 *
 * Lock order (design 10.2), so that this cannot deadlock with a payment, a cancellation or a counter sale: the invoices of the
 * waiting lines (share, in id order), then the waiting order lines (update, in id order), then the stock level rows (in
 * (branch, variant) order). A caller that also writes stock movements (a receipt) calls `lockWaitingOrderLines` BEFORE it writes
 * the first movement, because the movement locks the level rows.
 */

export interface AllocatedLine {
  orderLineId: string;
  orderId: string;
  invoiceId: string;
  invoiceLineId: string;
  variantId: string;
  quantity: number;
}

export interface AllocationInput {
  branchId: string;
  variantIds: readonly string[];
  /** Whoever caused the arrival: recorded on the reservation and on the order line. */
  actorUserId: string;
  /** The receipt whose confirmation brought the goods, when there is one. */
  receiptId?: string;
}

const uniqueSorted = (ids: readonly string[]) => [...new Set(ids)].sort();

/** The reservation key of an order line: one per line, whatever happens (the database holds one reservation per invoice line). */
export const allocationKey = (orderLineId: string): string => `ALLOC:${orderLineId}`;

/** Locks the invoices and the order lines that wait for the given variants at the branch (step 1 and 2 of the lock order). */
export async function lockWaitingOrderLines(
  tx: Prisma.TransactionClient,
  branchId: string,
  variantIds: readonly string[],
): Promise<void> {
  const variants = uniqueSorted(variantIds);
  if (variants.length === 0) return;
  const invoices = await tx.$queryRaw<{ invoice_id: string }[]>`
    SELECT DISTINCT o.invoice_id FROM product_order_lines o
    WHERE o.branch_id = ${branchId}::uuid AND o.variant_id = ANY(${variants}::uuid[]) AND o.status IN ('PAID', 'ORDERED')
    ORDER BY o.invoice_id`;
  if (invoices.length > 0) {
    const ids = invoices.map((row) => row.invoice_id);
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`;
  }
  await tx.$queryRaw`
    SELECT o.id FROM product_order_lines o
    WHERE o.branch_id = ${branchId}::uuid AND o.variant_id = ANY(${variants}::uuid[]) AND o.status IN ('PAID', 'ORDERED')
    ORDER BY o.id FOR UPDATE`;
}

/**
 * Reserves the free stock of the given variants for the waiting lines, oldest first, and moves those lines to ARRIVED. The caller
 * has called `lockWaitingOrderLines` first and holds nothing of the stock yet, or only what that order allows. Returns the lines
 * that arrived (for the notices that go with them).
 */
export async function allocateWaitingLines(
  tx: Prisma.TransactionClient,
  input: AllocationInput,
): Promise<AllocatedLine[]> {
  const variants = uniqueSorted(input.variantIds);
  const allocated: AllocatedLine[] = [];
  if (variants.length === 0) return allocated;
  // Stock level rows, in variant order. A variant that has never been received has none and nothing to give.
  const levels = await tx.$queryRaw<{ variant_id: string }[]>`
    SELECT variant_id FROM stock_levels
    WHERE branch_id = ${input.branchId}::uuid AND variant_id = ANY(${variants}::uuid[])
    ORDER BY variant_id FOR UPDATE`;
  const withStock = new Set(levels.map((row) => row.variant_id));
  for (const variantId of variants) {
    if (!withStock.has(variantId)) continue;
    const waiting = await tx.$queryRaw<
      {
        id: string;
        order_id: string;
        invoice_id: string;
        invoice_line_id: string;
        quantity: number;
      }[]
    >`
      SELECT o.id, o.order_id, o.invoice_id, o.invoice_line_id, o.quantity
      FROM product_order_lines o
      WHERE o.branch_id = ${input.branchId}::uuid AND o.variant_id = ${variantId}::uuid AND o.status IN ('PAID', 'ORDERED')
      ORDER BY o.paid_at, o.id`;
    if (waiting.length === 0) continue;
    const [row] = await tx.$queryRaw<{ available: number }[]>`
      SELECT lucy_available_stock(${input.branchId}::uuid, ${variantId}::uuid) AS available`;
    let free = row?.available ?? 0;
    for (const line of waiting) {
      if (line.quantity > free) continue;
      await tx.stockReservation.create({
        data: {
          invoiceLineId: line.invoice_line_id,
          invoiceId: line.invoice_id,
          branchId: input.branchId,
          variantId,
          quantity: line.quantity,
          source: 'ORDER_LINE',
          createdByUserId: input.actorUserId,
        },
        select: { id: true },
      });
      await tx.productOrderLine.update({
        where: { id: line.id },
        data: {
          status: 'ARRIVED',
          arrivedByUserId: input.actorUserId,
          arrivalReceiptId: input.receiptId ?? null,
        },
        select: { id: true },
      });
      free -= line.quantity;
      allocated.push({
        orderLineId: line.id,
        orderId: line.order_id,
        invoiceId: line.invoice_id,
        invoiceLineId: line.invoice_line_id,
        variantId,
        quantity: line.quantity,
      });
    }
  }
  return allocated;
}
