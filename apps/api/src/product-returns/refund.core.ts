import {
  PRODUCT_REFUND_REASON_MAX,
  PRODUCT_REFUND_REFERENCE,
  productRefundAmount,
  productRefundLineState,
  type ProductRefundMethodName,
  type ProductRefundResponse,
  type ProductRefundRestockName,
  type ProductRefundSummaryResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { hasFreshReauthentication } from '../auth/session.policy.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../inventory/inventory.input.js';
import * as parse from './return.input.js';
import { holdsGraphAt } from './return.access.js';

/**
 * Phase 6 P6-13: refunds per product line (design 8.2-8.4, 10.2, 10.3; Q3, Q4, Q5, OQ-19 option A, OQ-23, T21, T22, OQ-80, OQ-81, OQ-83;
 * PRD 28.6). A refund gives back some units of ONE product line of a paid counter invoice after a return case for that line was accepted
 * as a refund. Cash or a manual bank transfer only: nothing here calls PayOS, whatever the original payment was; the customer's bank
 * account is never stored, only the transfer reference. Only `REFUND_PRODUCTS` at the invoice's branch, with a recent password
 * confirmation (the same freshness window as a payment reversal). The refund record is immutable; a typed reference is corrected by a
 * new linked record.
 *
 * What a refund moves, and what it does not:
 *   - money: nothing moves in the system (the person hands over cash or sends a transfer by hand); the record is the hook the Phase 7 cash
 *     drawer will read. Payments stay as they are, the invoice stays PAID, and a payment reversal or a cancellation is refused from now on.
 *   - stock: goods the refunding person records as sellable go back into a NEW lot named after the return case, keeping the expiry of the
 *     lot they were sold from; goods recorded as not sellable move no stock (no phantom stock).
 *   - points: asynchronously, the `loyalty` consumer writes ONE linked negative Beauty entry per refund (design 8.4, option A); the earn
 *     entry stays, the Spa wallet and referral points are never touched, and a money refund is never blocked by the points.
 *   - vouchers and birthday gifts used on the invoice are NOT given back (OQ-81): nothing here reads or writes them.
 *
 * Lock order (design 10.2): the invoice row, then the case row (the line row and the stock rows are locked by the database guards, in
 * that order). Every command decides its authority inside its transaction, at the invoice's branch.
 */
type Tx = Prisma.TransactionClient;

const REFUND_KEYS = [
  'quantity',
  'method',
  'bankReference',
  'restock',
  'reason',
  'clientRequestId',
] as const;
const CORRECTION_KEYS = ['bankReference', 'reason'] as const;
const METHODS = ['CASH', 'BANK_TRANSFER_MANUAL'] as const;
const RESTOCKS = ['SELLABLE', 'NOT_SELLABLE'] as const;

const pick = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value as T;
};

/** The reference of a bank transfer: letters, digits and . _ / - only. Anything that looks like free text is refused (OQ-83). */
function bankReference(value: unknown): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', 'bankReference');
  const text = value.normalize('NFC').trim();
  if (!PRODUCT_REFUND_REFERENCE.test(text))
    throw new AuthError('VALIDATION_FAILED', 'bankReference');
  return text;
}

/** Cash has no reference: absent or blank is none, anything else is refused. */
function noReference(value: unknown): null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  throw new AuthError('VALIDATION_FAILED', 'bankReference');
}

const holdsRefund = (context: AdminContext, branchId: string): boolean =>
  holdsGraphAt(context.actor.graph, 'REFUND_PRODUCTS', branchId);

function requireRefund(context: AdminContext, branchId: string): void {
  if (!holdsRefund(context, branchId)) throw new AuthError('FORBIDDEN');
}

async function lockInvoice(tx: Tx, invoiceId: string, exclusive: boolean): Promise<void> {
  if (exclusive)
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR SHARE`;
}

async function lockCase(tx: Tx, caseId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM product_return_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
}

// ------------------------------------------------------------------------------------------------- reading

/** The refunds of a case with what they did to the line, the lots and the points. REFUND_PRODUCTS at the case's branch. */
export async function refundSummary(
  context: AdminContext,
  caseId: string,
): Promise<ProductRefundSummaryResponse> {
  const { tx } = context;
  const kase = await tx.productReturnCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      code: true,
      branchId: true,
      invoiceId: true,
      invoiceLineId: true,
      quantity: true,
      status: true,
      decidedOutcome: true,
      invoice: { select: { code: true, status: true } },
      line: { select: { quantity: true } },
    },
  });
  if (!kase) throw new AuthError('NOT_FOUND');
  requireRefund(context, kase.branchId);

  const allocation = await tx.invoiceLineAllocation.findUnique({
    where: { invoiceLineId: kase.invoiceLineId },
    select: { netVnd: true },
  });
  const sold = kase.line.quantity ?? kase.quantity;
  const onLine = await tx.productRefund.aggregate({
    where: { invoiceLineId: kase.invoiceLineId },
    _sum: { quantity: true, amountVnd: true },
  });
  const lineRefunded = onLine._sum.quantity ?? 0;
  const inCase = await tx.productRefund.aggregate({
    where: { returnCaseId: caseId },
    _sum: { quantity: true },
  });
  const caseRefunded = inCase._sum.quantity ?? 0;
  const remaining = Math.max(0, kase.quantity - caseRefunded);

  const rows = await tx.productRefund.findMany({
    where: { returnCaseId: caseId },
    orderBy: [{ caseOrdinal: 'asc' }],
    select: {
      id: true,
      code: true,
      quantity: true,
      amountVnd: true,
      method: true,
      bankReference: true,
      reason: true,
      restock: true,
      occurredAt: true,
      actor: { select: { fullName: true } },
      corrections: {
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          bankReference: true,
          reason: true,
          occurredAt: true,
          actor: { select: { fullName: true } },
        },
      },
      lots: { orderBy: [{ lotCode: 'asc' }], select: { lotCode: true } },
      ledgerEntries: { select: { points: true, shortfallPoints: true } },
    },
  });
  const refunds: ProductRefundResponse[] = rows.map((row) => {
    const last = row.corrections.at(-1);
    const entry = row.ledgerEntries[0];
    return {
      id: row.id,
      code: row.code,
      quantity: row.quantity,
      amountVnd: row.amountVnd.toString(),
      method: row.method,
      bankReference: last?.bankReference ?? row.bankReference,
      firstBankReference: last ? row.bankReference : null,
      reason: row.reason,
      restock: row.restock,
      actorName: row.actor.fullName,
      occurredAt: row.occurredAt.toISOString(),
      lotCodes: row.lots.map((lot) => lot.lotCode),
      beautyPointsTakenBack: entry ? -entry.points : null,
      beautyPointsShortfall: entry?.shortfallPoints ?? 0,
      corrections: row.corrections.map((correction) => ({
        id: correction.id,
        bankReference: correction.bankReference,
        reason: correction.reason,
        actorName: correction.actor.fullName,
        occurredAt: correction.occurredAt.toISOString(),
      })),
    };
  });

  const accepted = kase.status === 'ACCEPTED' && kase.decidedOutcome === 'REFUND';
  const paid = kase.invoice.status === 'PAID';
  const netPaid = allocation !== null && allocation.netVnd > 0n;
  const blocked: ProductRefundSummaryResponse['blocked'] = !accepted
    ? 'NOT_ACCEPTED_AS_REFUND'
    : !paid
      ? 'INVOICE_NOT_PAID'
      : !netPaid
        ? 'NOTHING_PAID'
        : remaining === 0 || lineRefunded >= sold
          ? 'NOTHING_LEFT'
          : null;
  return {
    caseId: kase.id,
    caseCode: kase.code,
    invoiceCode: kase.invoice.code,
    lineNetVnd: allocation ? allocation.netVnd.toString() : null,
    soldQuantity: sold,
    lineRefundedQuantity: lineRefunded,
    lineRefundedVnd: (onLine._sum.amountVnd ?? 0n).toString(),
    lineState: productRefundLineState(lineRefunded, sold),
    caseQuantity: kase.quantity,
    caseRefundedQuantity: caseRefunded,
    caseRemainingQuantity: remaining,
    refundable: blocked === null,
    blocked,
    refunds,
    can: {
      refund: blocked === null,
      correctReference: refunds.some((refund) => refund.method === 'BANK_TRANSFER_MANUAL'),
    },
  };
}

// ----------------------------------------------------------------------------------------------- commands

interface StockSegment {
  lotId: string;
  expiryDate: Date | null;
  unitCostVnd: bigint | null;
  quantity: number;
}

/**
 * Lays the units of this refund over the lots the line was sold from: the sale took its units lot by lot (first-expiry lot first); the
 * units already refunded (sellable or not) are the first ones, so the units of this refund are the next `quantity`, and each keeps the
 * expiry of the lot it came out of.
 */
async function soldSegments(
  tx: Tx,
  line: { invoiceLineId: string; paidSeq: number; soldQuantity: number },
  unitsBefore: number,
  quantity: number,
): Promise<StockSegment[]> {
  const reservation = await tx.stockReservation.findUnique({
    where: { invoiceLineId: line.invoiceLineId },
    select: { status: true, consumedPaidSeq: true },
  });
  if (reservation?.status !== 'CONSUMED' || reservation.consumedPaidSeq !== line.paidSeq) {
    throw new AuthError('REFUND_STOCK_PENDING');
  }
  const sales = await tx.stockMovement.findMany({
    where: { invoiceLineId: line.invoiceLineId, paidSeq: line.paidSeq, kind: 'SALE' },
    // The order the sale took the lots in (first-expiry lot first), made stable by the movement's own order.
    orderBy: [
      { lot: { expiryDate: { sort: 'asc', nulls: 'last' } } },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: {
      lotId: true,
      quantityDelta: true,
      lot: { select: { expiryDate: true, unitCostVnd: true } },
    },
  });
  const soldUnits = sales.reduce((sum, sale) => sum + -sale.quantityDelta, 0);
  if (soldUnits !== line.soldQuantity) throw new AuthError('REFUND_STOCK_PENDING');
  const segments: StockSegment[] = [];
  let position = 0;
  const from = unitsBefore;
  const to = unitsBefore + quantity;
  for (const sale of sales) {
    const start = position;
    const end = position + -sale.quantityDelta;
    position = end;
    const overlap = Math.min(end, to) - Math.max(start, from);
    if (overlap > 0) {
      segments.push({
        lotId: sale.lotId,
        expiryDate: sale.lot.expiryDate,
        unitCostVnd: sale.lot.unitCostVnd,
        quantity: overlap,
      });
    }
  }
  return segments;
}

export async function makeRefund(
  context: AdminContext,
  caseId: string,
  request: Record<string, unknown>,
  freshAuthSeconds: number,
): Promise<ProductRefundSummaryResponse> {
  const body = input.record(request, 'body', REFUND_KEYS);
  const quantity = input.quantity(body['quantity'], 'quantity');
  const method = pick<ProductRefundMethodName>(body['method'], METHODS, 'method');
  const restock = pick<ProductRefundRestockName>(body['restock'], RESTOCKS, 'restock');
  const reason = parse.requiredNote(body['reason'], 'reason', PRODUCT_REFUND_REASON_MAX);
  const clientRequestId = input.uuid(body['clientRequestId'], 'clientRequestId');
  const reference =
    method === 'BANK_TRANSFER_MANUAL'
      ? bankReference(body['bankReference'])
      : noReference(body['bankReference']);

  const { tx } = context;
  const hint = await tx.productReturnCase.findUnique({
    where: { id: caseId },
    select: { branchId: true, invoiceId: true, invoiceLineId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  requireRefund(context, hint.branchId);

  // A repeat of the same request returns the refund it already made (no password needed to read it back).
  const replay = async (): Promise<ProductRefundSummaryResponse | null> => {
    const prior = await tx.productRefund.findUnique({
      where: {
        actorUserId_clientRequestId: { actorUserId: context.actor.userId, clientRequestId },
      },
      select: {
        returnCaseId: true,
        quantity: true,
        method: true,
        restock: true,
        reason: true,
        bankReference: true,
      },
    });
    if (!prior) return null;
    if (
      prior.returnCaseId !== caseId ||
      prior.quantity !== quantity ||
      prior.method !== method ||
      prior.restock !== restock ||
      prior.reason !== reason ||
      prior.bankReference !== reference
    ) {
      throw new AuthError('CONFLICT');
    }
    return refundSummary(context, caseId);
  };
  const early = await replay();
  if (early) return early;
  if (!hasFreshReauthentication(context.actor.principal, context.now, freshAuthSeconds)) {
    throw new AuthError('REAUTHENTICATION_REQUIRED');
  }

  await lockInvoice(tx, hint.invoiceId, true);
  await lockCase(tx, caseId);
  const settled = await replay();
  if (settled) return settled;

  const kase = await tx.productReturnCase.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      code: true,
      quantity: true,
      status: true,
      decidedOutcome: true,
      invoice: {
        select: { code: true, status: true, channel: true, paidSeq: true, branchId: true },
      },
      line: { select: { quantity: true } },
      productLine: { select: { variantId: true } },
    },
  });
  if (kase.status !== 'ACCEPTED' || kase.decidedOutcome !== 'REFUND') {
    throw new AuthError('REFUND_CASE_NOT_READY');
  }
  if (kase.invoice.status !== 'PAID' || kase.invoice.channel !== 'COUNTER') {
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  const sold = kase.line.quantity;
  const allocation = await tx.invoiceLineAllocation.findUnique({
    where: { invoiceLineId: hint.invoiceLineId },
    select: { netVnd: true, side: true },
  });
  if (
    sold === null ||
    allocation === null ||
    allocation.side !== 'BEAUTY' ||
    allocation.netVnd <= 0n
  ) {
    throw new AuthError('REFUND_NOTHING_PAID');
  }
  const onLine = await tx.productRefund.aggregate({
    where: { invoiceLineId: hint.invoiceLineId },
    _sum: { quantity: true, amountVnd: true },
  });
  const unitsBefore = onLine._sum.quantity ?? 0;
  const amountBefore = onLine._sum.amountVnd ?? 0n;
  const inCase = await tx.productRefund.aggregate({
    where: { returnCaseId: caseId },
    _sum: { quantity: true },
    _count: { _all: true },
  });
  if (quantity + (inCase._sum.quantity ?? 0) > kase.quantity || quantity + unitsBefore > sold) {
    throw new AuthError('REFUND_QUANTITY_EXCEEDED', 'quantity');
  }
  const amount = productRefundAmount(allocation.netVnd, sold, unitsBefore, quantity);
  if (amount <= 0n) throw new AuthError('REFUND_NOTHING_PAID');
  const onInvoice = await tx.productRefund.aggregate({
    where: { invoiceId: hint.invoiceId },
    _sum: { amountVnd: true },
  });
  const segments =
    restock === 'SELLABLE'
      ? await soldSegments(
          tx,
          { invoiceLineId: hint.invoiceLineId, paidSeq: kase.invoice.paidSeq, soldQuantity: sold },
          unitsBefore,
          quantity,
        )
      : [];

  const [sequence] = await tx.$queryRaw<
    { n: string }[]
  >`SELECT nextval('product_refund_code_seq')::text AS n`;
  const code = `HT${sequence!.n.padStart(6, '0')}`;
  const caseOrdinal = (inCase._count._all ?? 0) + 1;
  const refund = await tx.productRefund.create({
    data: {
      code,
      branchId: hint.branchId,
      invoiceId: hint.invoiceId,
      invoiceLineId: hint.invoiceLineId,
      returnCaseId: caseId,
      paidSeq: kase.invoice.paidSeq,
      caseOrdinal,
      quantity,
      amountVnd: amount,
      lineUnitsAfter: unitsBefore + quantity,
      lineAmountAfterVnd: amountBefore + amount,
      invoiceRefundedAfterVnd: (onInvoice._sum.amountVnd ?? 0n) + amount,
      method,
      bankReference: reference,
      reason,
      restock,
      actorUserId: context.actor.userId,
      reauthenticatedAt: context.actor.principal.reauthenticatedAt ?? context.now,
      clientRequestId,
    },
    select: { id: true, occurredAt: true },
  });

  // Sellable goods go back into new lots named after the return, one per lot the units were sold from.
  const base = `${kase.code}-${caseOrdinal}`;
  for (const [index, segment] of segments.entries()) {
    const lot = await tx.inventoryLot.create({
      data: {
        branchId: hint.branchId,
        variantId: kase.productLine.variantId,
        lotCode: segments.length === 1 ? base : `${base}/${index + 1}`,
        expiryDate: segment.expiryDate,
        unitCostVnd: segment.unitCostVnd,
        sourceRefundId: refund.id,
        createdByUserId: context.actor.userId,
      },
      select: { id: true },
    });
    await tx.stockMovement.create({
      data: {
        branchId: hint.branchId,
        variantId: kase.productLine.variantId,
        lotId: lot.id,
        kind: 'REFUND_RETURN',
        quantityDelta: segment.quantity,
        productRefundId: refund.id,
        idempotencyKey: `REFUND_RETURN:${refund.id}:${index + 1}`,
        actorUserId: context.actor.userId,
      },
      select: { id: true },
    });
  }

  // The reference is not copied into the audit log; the log says only that one was recorded.
  await appendAdminAudit(context, {
    action: 'PRODUCT_REFUNDED',
    entityType: 'ProductRefund',
    entityId: refund.id,
    branchId: hint.branchId,
    classification: 'FINANCIAL',
    reason,
    after: {
      code,
      caseCode: kase.code,
      invoiceCode: kase.invoice.code,
      invoiceLineId: hint.invoiceLineId,
      quantity,
      amountVnd: amount.toString(),
      method,
      bankReferenceRecorded: reference !== null,
      restock,
      lots: segments.length,
      reauthenticatedAt: context.actor.principal.reauthenticatedAt?.toISOString() ?? null,
    },
  });
  // Ids only. The Beauty points follow from the `loyalty` consumer (design 8.4, 10.1).
  await appendOutboxEvent(tx, {
    branchId: hint.branchId,
    aggregateType: 'ProductRefund',
    aggregateId: refund.id,
    eventType: 'PRODUCT_REFUNDED',
    schemaVersion: 1,
    occurredAt: refund.occurredAt,
    payload: { refundId: refund.id, invoiceId: hint.invoiceId, branchId: hint.branchId },
  });
  return refundSummary(context, caseId);
}

/**
 * Corrects the transfer reference typed for a bank transfer refund: a new linked record, the refund never changes. REFUND_PRODUCTS at the
 * branch; no money moves, so no password is asked.
 */
export async function correctReference(
  context: AdminContext,
  caseId: string,
  refundId: string,
  request: Record<string, unknown>,
): Promise<ProductRefundSummaryResponse> {
  const body = input.record(request, 'body', CORRECTION_KEYS);
  const reference = bankReference(body['bankReference']);
  const reason = parse.requiredNote(body['reason'], 'reason', PRODUCT_REFUND_REASON_MAX);
  const { tx } = context;
  const refund = await tx.productRefund.findFirst({
    where: { id: refundId, returnCaseId: caseId },
    select: { id: true, code: true, branchId: true, invoiceId: true, method: true },
  });
  if (!refund) throw new AuthError('NOT_FOUND');
  requireRefund(context, refund.branchId);
  if (refund.method !== 'BANK_TRANSFER_MANUAL')
    throw new AuthError('VALIDATION_FAILED', 'bankReference');
  await lockInvoice(tx, refund.invoiceId, false);
  await tx.productRefundCorrection.create({
    data: { refundId, bankReference: reference, reason, actorUserId: context.actor.userId },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_REFUND_REFERENCE_CORRECTED',
    entityType: 'ProductRefund',
    entityId: refundId,
    branchId: refund.branchId,
    classification: 'FINANCIAL',
    reason,
    after: { code: refund.code },
  });
  return refundSummary(context, caseId);
}
