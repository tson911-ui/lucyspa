import { appendOutboxEvent, type DatabaseClient, type Prisma } from '@lucy-spa/database';
import {
  expireStalePending,
  lockInvoiceRow,
  providerClock,
  effectivePaidVnd,
  applyProviderRead,
  readProvider,
  type SettlementActor,
} from './payment-settlement.js';
import type { PaymentProvider } from './payment-provider.js';

/**
 * Phase 6 Wave 4 (P6-19; design 2.38; OQ-39, OQ-92, W4-3, W4-4): the cancellation of an UNPAID online order, shared by the customer's own
 * "Hủy đơn" (the API) and the automatic cancel after the deadline (the worker).
 *
 * The automatic cancel has no human: it is recorded with the order's own customer as the user (the columns need one; no system user is
 * invented, the Owner declined one in 3b), an explicit reason and an audit event whose actor kind is SYSTEM. It never cancels an order that
 * has a live PayOS request, a payment, or a deadline that has not passed; before it cancels, the worker reads the provider for every request
 * that is still unsettled, so a customer who paid at the last moment is credited, not cancelled.
 */

/** The reason written on the invoice by the automatic cancel (Vietnamese, as the other invoice reasons are). */
export const ONLINE_TIMEOUT_REASON = 'Quá hạn thanh toán đơn online';
export const ONLINE_CUSTOMER_REASON = 'Khách tự hủy đơn online chưa thanh toán';
/** The time the system waits after the deadline before it cancels (a payment confirmed at the last second still lands). */
export const ONLINE_CANCEL_GRACE_MS = 2 * 60_000;

export type OnlineCancelWho =
  | { readonly kind: 'TIMEOUT'; readonly graceMs?: number }
  | { readonly kind: 'CUSTOMER'; readonly userId: string; readonly requestId?: string | null };

export type OnlineCancelOutcome =
  /** The order is cancelled by this call. */
  | 'CANCELLED'
  /** Not an unpaid online order of this customer (already paid, cancelled, a counter invoice, someone else's). */
  | 'NOT_APPLICABLE'
  /** A PayOS request is still live (or money is credited): nothing is cancelled. */
  | 'PAYMENT_PENDING'
  /** The automatic cancel found the deadline (plus the grace) still ahead. */
  | 'NOT_OVERDUE';

const invoiceSelect = {
  id: true,
  code: true,
  branchId: true,
  visitId: true,
  status: true,
  channel: true,
  payerUserId: true,
  totalVnd: true,
  paidSeq: true,
} satisfies Prisma.InvoiceSelect;

/**
 * Cancels the unpaid online invoice in one transaction, under the invoice lock (the same lock the PayOS webhook takes, so a payment and
 * this cancel are serialized: whichever commits first decides, and a confirmation that arrives after the cancel becomes an anomaly for
 * management, never a silent double state).
 */
export async function cancelUnpaidOnlineInvoice(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  who: OnlineCancelWho,
): Promise<OnlineCancelOutcome> {
  // Lock order of every command of a signed-in member: the user row, then the invoice. The cancellation writes the member as the user
  // of the cancel and of the releases, so it takes the member's row first as well (the member's own commands already hold it).
  const hint = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { payerUserId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE' || hint.payerUserId === null) return 'NOT_APPLICABLE';
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${hint.payerUserId}::uuid FOR UPDATE`;
  await lockInvoiceRow(tx, invoiceId);
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: invoiceSelect });
  if (!invoice || invoice.channel !== 'ONLINE' || invoice.status !== 'PENDING_PAYMENT') {
    return 'NOT_APPLICABLE';
  }
  if (invoice.payerUserId === null) return 'NOT_APPLICABLE';
  if (who.kind === 'CUSTOMER' && invoice.payerUserId !== who.userId) return 'NOT_APPLICABLE';
  const now = await providerClock(tx);
  if (who.kind === 'TIMEOUT') {
    const detail = await tx.onlineOrderDetail.findFirst({
      where: { order: { invoiceId } },
      select: { deadlineAt: true },
    });
    const grace = who.graceMs ?? ONLINE_CANCEL_GRACE_MS;
    if (!detail || detail.deadlineAt.getTime() + grace > now.getTime()) return 'NOT_OVERDUE';
  }
  const actor: SettlementActor =
    who.kind === 'CUSTOMER'
      ? { kind: 'USER', userId: who.userId, requestId: who.requestId ?? null }
      : { kind: 'SYSTEM' };
  await expireStalePending(tx, actor, invoice, now);
  const live = await tx.payment.count({ where: { invoiceId, status: 'PENDING' } });
  if (live > 0) return 'PAYMENT_PENDING';
  if ((await effectivePaidVnd(tx, invoiceId)) !== 0n) return 'NOT_APPLICABLE';

  const reason = who.kind === 'TIMEOUT' ? ONLINE_TIMEOUT_REASON : ONLINE_CUSTOMER_REASON;
  const recordedUser = invoice.payerUserId;
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledByUserId: recordedUser,
      cancelledFromStatus: 'PENDING_PAYMENT',
      cancelReason: reason,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });

  // The program or voucher redemption the finalization consumed returns (append-only release), under the program row lock.
  const redemptions = await tx.discountRedemption.findMany({
    where: { invoiceId, release: null },
    orderBy: [{ discountId: 'asc' }, { id: 'asc' }],
    select: { id: true, discountId: true },
  });
  let releasedRedemptions = 0;
  for (const redemption of redemptions) {
    await tx.$queryRaw`SELECT id FROM discounts WHERE id = ${redemption.discountId}::uuid FOR UPDATE`;
    await tx.discountRedemptionRelease.create({
      data: {
        redemptionId: redemption.id,
        releasedByUserId: recordedUser,
        cause: 'INVOICE_CANCELLED_UNPAID',
        reason,
        releasedAt: now,
      },
      select: { id: true },
    });
    releasedRedemptions += 1;
  }

  // The stock held for the product lines goes back to the shelf: the level rows are locked in (branch, variant) order.
  const open = await tx.stockReservation.findMany({
    where: { invoiceId, status: 'RESERVED', source: 'INVOICE_LINE' },
    orderBy: [{ branchId: 'asc' }, { variantId: 'asc' }, { invoiceLineId: 'asc' }],
    select: { id: true, branchId: true, variantId: true },
  });
  if (open.length > 0) {
    const branchIds = [...new Set(open.map((row) => row.branchId))].sort();
    const variantIds = [...new Set(open.map((row) => row.variantId))].sort();
    await tx.$queryRaw`
      SELECT 1 FROM stock_levels
      WHERE branch_id = ANY(${branchIds}::uuid[]) AND variant_id = ANY(${variantIds}::uuid[])
      ORDER BY branch_id, variant_id FOR UPDATE`;
    for (const reservation of open) {
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'RELEASED',
          releasedByUserId: recordedUser,
          releaseCause: 'INVOICE_CANCELLED_UNPAID',
        },
        select: { id: true },
      });
    }
  }

  await tx.auditEvent.create({
    data: {
      action: 'INVOICE_CANCELLED',
      actorKind: who.kind === 'CUSTOMER' ? 'USER' : 'SYSTEM',
      actorUserId: who.kind === 'CUSTOMER' ? who.userId : null,
      subjectUserId: recordedUser,
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: invoice.branchId,
      requestId: who.kind === 'CUSTOMER' ? (who.requestId ?? null) : null,
      occurredAt: now,
      reason,
      before: { status: 'PENDING_PAYMENT', totalVnd: invoice.totalVnd.toString() },
      after: {
        status: 'CANCELLED',
        cancelledFrom: 'PENDING_PAYMENT',
        cancellationPath: 'ONLINE_UNPAID',
        automatic: who.kind === 'TIMEOUT',
        redemptionsReleased: releasedRedemptions,
        stockReservationsReleased: open.length,
      },
      dataClassification: 'FINANCIAL',
    },
    select: { id: true },
  });
  await appendOutboxEvent(tx, {
    branchId: invoice.branchId,
    aggregateType: 'Invoice',
    aggregateId: invoiceId,
    eventType: 'INVOICE_CANCELLED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      invoiceId,
      branchId: invoice.branchId,
      visitId: invoice.visitId,
      cancelledFrom: 'PENDING_PAYMENT',
      zeroBalanceCorrection: false,
      voidedPaidSeq: null,
      redemptionReleased: releasedRedemptions > 0,
      routine: true,
    },
  });
  return 'CANCELLED';
}

export interface OnlineTimeoutSummary {
  readonly examined: number;
  readonly cancelled: number;
  readonly credited: number;
  readonly skipped: number;
}

/**
 * The worker sweep of the unpaid online orders whose deadline (plus the grace) has passed. Database-authoritative: the candidates are
 * selected straight from PostgreSQL. For each one, FIRST every provider request that is still unsettled is read from PayOS and applied
 * (outside any transaction for the provider call; the application is its own short transaction), so a payment that was made but whose
 * webhook was missed is credited; only then is the order cancelled, in its own transaction. One failure never blocks another.
 */
export async function cancelOverdueOnlineOrders(
  database: DatabaseClient,
  provider: PaymentProvider | null,
  options: { limit?: number; graceMs?: number } = {},
): Promise<OnlineTimeoutSummary> {
  const grace = options.graceMs ?? ONLINE_CANCEL_GRACE_MS;
  const candidates = await database.$queryRaw<{ invoice_id: string }[]>`
    SELECT o.invoice_id
    FROM online_order_details d
      JOIN product_orders o ON o.id = d.order_id
      JOIN invoices i ON i.id = o.invoice_id
    WHERE i.status = 'PENDING_PAYMENT' AND i.channel = 'ONLINE'
      AND d.deadline_at + (${grace}::int * interval '1 millisecond') <= clock_timestamp()
    ORDER BY d.deadline_at ASC, o.id ASC
    LIMIT ${options.limit ?? 50}`;
  let cancelled = 0;
  let credited = 0;
  let skipped = 0;
  for (const { invoice_id: invoiceId } of candidates) {
    try {
      if (provider) {
        const pending = await database.payment.findMany({
          where: {
            invoiceId,
            status: 'PENDING',
            method: 'PAYOS',
            providerOrderCode: { not: null },
          },
          select: { id: true, providerOrderCode: true },
        });
        let providerDown = false;
        for (const payment of pending) {
          if (payment.providerOrderCode === null) continue;
          const read = await readProvider(provider, payment.providerOrderCode);
          const outcome = await database.$transaction(
            (tx) => applyProviderRead(tx, { kind: 'SYSTEM' }, payment.id, read),
            { timeout: 30_000 },
          );
          if (outcome === 'APPLIED') credited += 1;
          if (outcome === 'UNAVAILABLE') providerDown = true;
        }
        // The provider could not say whether the customer paid: nothing is cancelled on a guess; the next pass tries again.
        if (providerDown) {
          skipped += 1;
          continue;
        }
      }
      const outcome = await database.$transaction(
        (tx) => cancelUnpaidOnlineInvoice(tx, invoiceId, { kind: 'TIMEOUT', graceMs: grace }),
        { timeout: 30_000 },
      );
      if (outcome === 'CANCELLED') cancelled += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { examined: candidates.length, cancelled, credited, skipped };
}
