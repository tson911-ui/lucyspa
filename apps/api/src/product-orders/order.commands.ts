import {
  PRODUCT_REFUND_REASON_MAX,
  productRefundAmount,
  type ProductHandoverToName,
  type ProductOrderAllocateResponse,
  type ProductOrderCancelCauseName,
  type ProductOrderDetailResponse,
  type ProductOrderMarkOrderedResponse,
  type ProductRefundMethodName,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import {
  allocateWaitingLines,
  lockWaitingOrderLines,
  ORDER_HANDED_OVER_EVENT,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../inventory/inventory.input.js';
import {
  bankReference,
  lineClaims,
  lockInvoice,
  noReference,
  openExchangeOnLine,
  pick,
  takeFreshConfirmation,
} from '../product-returns/refund.core.js';
import { tellOwnerAboutRefund } from '../product-returns/refund.notice.js';
import * as parse from '../product-returns/return.input.js';
import { cancelCausesOnline } from '../online-orders/online.cancel.js';
import { tellMember } from '../online-orders/online.notice.js';
import { requireManageOrders, requireRefund } from './order.access.js';
import { tellMembersGoodsArrived } from './order.notice.js';
import { branchToday, cancelCausesFor, orderDetail } from './order.queue.js';

/**
 * Phase 6 P6-17 (design 18.3, 18.4, 10.2; T31, T32, OQ-32, OQ-34, OQ-85): the commands that move an order line after it is paid.
 *
 * Lock order (design 10.2), always: the invoice row (share, update for a refund), then the order line rows (id order), then the stock
 * rows (the level, then its lots). A payment, a reversal or a cancellation of the same invoice takes the invoice first too, and the
 * guards of an order line read the invoice, so a command that took the line first would deadlock with them.
 */
type Tx = Prisma.TransactionClient;

const MARK_KEYS = ['lines', 'note'] as const;
const HAND_KEYS = [
  'expectedVersion',
  'to',
  'representativeName',
  'orderCode',
  'phoneLast4',
  'note',
] as const;
const CANCEL_KEYS = [
  'expectedVersion',
  'cause',
  'note',
  'method',
  'bankReference',
  'clientRequestId',
  'amountVnd',
] as const;
const DECLINE_KEYS = ['expectedVersion', 'note'] as const;
const ALLOCATE_KEYS = ['branchId', 'variantId'] as const;
const NOTE_MAX = 500;
const CAUSES = [
  'SUPPLIER_CANNOT_DELIVER',
  'CUSTOMER_CANCELLED_BEFORE_ORDERING',
  'CUSTOMER_CHANGED_MIND',
  'LATE_OVER_7_DAYS',
] as const;
const HANDOVER_TO = ['CUSTOMER', 'REPRESENTATIVE'] as const;
const METHODS = ['CASH', 'BANK_TRANSFER_MANUAL'] as const;

const unique = (ids: readonly string[]) => [...new Set(ids)].sort();

/** The optional amount of a refund: whole VND as a string, allowed only when the customer changed their mind (null = the whole share). */
function partialAmount(value: unknown, cause: string): bigint | null {
  if (value === undefined || value === null) return null;
  if (
    cause !== 'CUSTOMER_CHANGED_MIND' ||
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,14}$/.test(value)
  ) {
    throw new AuthError('VALIDATION_FAILED', 'amountVnd');
  }
  return BigInt(value);
}

/** The invoices (share) and then the lines (update) of the given order lines, in id order. Returns the lines as they now are. */
async function lockLines(
  tx: Tx,
  lineIds: readonly string[],
  invoiceMode: 'SHARE' | 'UPDATE' = 'SHARE',
) {
  const hints = await tx.productOrderLine.findMany({
    where: { id: { in: [...lineIds] } },
    select: { id: true, invoiceId: true, branchId: true },
  });
  if (hints.length !== new Set(lineIds).size) throw new AuthError('NOT_FOUND');
  const invoices = unique(hints.map((hint) => hint.invoiceId));
  if (invoiceMode === 'UPDATE') {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ANY(${invoices}::uuid[]) ORDER BY id FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ANY(${invoices}::uuid[]) ORDER BY id FOR SHARE`;
  }
  const ids = unique(lineIds);
  await tx.$queryRaw`SELECT id FROM product_order_lines WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  return tx.productOrderLine.findMany({
    where: { id: { in: ids } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      orderId: true,
      invoiceId: true,
      invoiceLineId: true,
      branchId: true,
      variantId: true,
      quantity: true,
      status: true,
      expectedTo: true,
      rowVersion: true,
      order: { select: { code: true, contactPhone: true, channel: true } },
      productLine: { select: { fulfilmentMode: true } },
    },
  });
}

// ------------------------------------------------------------------------------------------- mark ordered

/** The shop ordered these paid lines from the supplier (T32): PAID to ORDERED, one audit record, nothing else moves. */
export async function markOrdered(
  context: AdminContext,
  request: Record<string, unknown>,
): Promise<ProductOrderMarkOrderedResponse> {
  const body = input.record(request, 'body', MARK_KEYS);
  const rawLines = input.list(body['lines'], 'lines', 200);
  if (rawLines.length === 0) throw new AuthError('VALIDATION_FAILED', 'lines');
  const wanted = new Map<string, number>();
  for (const [index, entry] of rawLines.entries()) {
    const line = input.record(entry, `lines.${index}`, ['id', 'rowVersion']);
    const id = input.uuid(line['id'], `lines.${index}.id`);
    if (wanted.has(id)) throw new AuthError('VALIDATION_FAILED', 'lines');
    wanted.set(id, input.rowVersion(line['rowVersion']));
  }
  const note = parse.optionalNote(body['note'], 'note', NOTE_MAX);
  const { tx } = context;
  const hints = await tx.productOrderLine.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: { branchId: true },
  });
  if (hints.length !== wanted.size) throw new AuthError('NOT_FOUND');
  for (const branchId of new Set(hints.map((hint) => hint.branchId))) {
    requireManageOrders(context, branchId);
  }
  const lines = await lockLines(tx, [...wanted.keys()]);
  for (const line of lines) {
    if (line.rowVersion !== wanted.get(line.id)) throw new AuthError('CONFLICT');
    if (line.status !== 'PAID') throw new AuthError('ORDER_LINE_STATE_INVALID');
    // An in-stock line of an online order is packed from the shelf: there is no supplier to order it from.
    if (line.productLine.fulfilmentMode !== 'PRE_ORDER')
      throw new AuthError('ORDER_LINE_STATE_INVALID');
  }
  for (const line of lines) {
    await tx.productOrderLine.update({
      where: { id: line.id },
      data: { status: 'ORDERED', orderedByUserId: context.actor.userId, orderedNote: note },
      select: { id: true },
    });
  }
  await appendAdminAudit(context, {
    action: 'PRODUCT_ORDER_LINES_ORDERED',
    entityType: 'ProductOrder',
    entityId: lines[0]!.orderId,
    branchId: lines[0]!.branchId,
    classification: 'STANDARD',
    after: {
      lineIds: lines.map((line) => line.id),
      orderCodes: unique(lines.map((l) => l.order.code)),
    },
  });
  return { ordered: lines.length };
}

// -------------------------------------------------------------------------------------------- hand over

const lastFour = (phone: string) => phone.replace(/\D/g, '').slice(-4);

/**
 * The goods of an ARRIVED line leave the shop (OQ-85): to the customer, or to whoever says the order code and the last four digits of the
 * phone number. The server compares what was said with the order and records only that it matched (never the digits). The stock sale is
 * written by the `inventory` consumer from the event (T31); the line becomes COMPLETED when it has.
 */
export async function handOver(
  context: AdminContext,
  lineId: string,
  request: Record<string, unknown>,
): Promise<ProductOrderDetailResponse> {
  const body = input.record(request, 'body', HAND_KEYS);
  const expectedVersion = input.rowVersion(body['expectedVersion']);
  const to = pick<ProductHandoverToName>(body['to'], HANDOVER_TO, 'to');
  const name = parse.optionalNote(body['representativeName'], 'representativeName', 120);
  if (to === 'REPRESENTATIVE' && (name === null || name.includes('\n'))) {
    throw new AuthError('VALIDATION_FAILED', 'representativeName');
  }
  if (to === 'CUSTOMER' && name !== null)
    throw new AuthError('VALIDATION_FAILED', 'representativeName');
  const orderCode = input.line(body['orderCode'], 'orderCode', 40).toUpperCase();
  const phoneLast4 = input.line(body['phoneLast4'], 'phoneLast4', 8);
  if (!/^[0-9]{4}$/.test(phoneLast4)) throw new AuthError('VALIDATION_FAILED', 'phoneLast4');
  const note = parse.optionalNote(body['note'], 'note', NOTE_MAX);
  const { tx } = context;
  const hint = await tx.productOrderLine.findUnique({
    where: { id: lineId },
    select: { branchId: true, orderId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  requireManageOrders(context, hint.branchId);
  const [line] = await lockLines(tx, [lineId]);
  if (!line) throw new AuthError('NOT_FOUND');
  if (line.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
  if (line.status !== 'ARRIVED') throw new AuthError('ORDER_LINE_STATE_INVALID');
  // The goods of an online order are shipped, never handed over at the counter.
  if (line.order.channel !== 'COUNTER') throw new AuthError('ORDER_LINE_STATE_INVALID');
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: line.invoiceId },
    select: { status: true, paidSeq: true },
  });
  if (invoice.status !== 'PAID') throw new AuthError('INVOICE_STATE_INVALID');
  // What the person said must match the order; the answer never says which part was wrong, and nothing said is stored.
  if (
    orderCode !== line.order.code.toUpperCase() ||
    phoneLast4 !== lastFour(line.order.contactPhone)
  ) {
    throw new AuthError('ORDER_HANDOVER_PROOF_INVALID');
  }
  await tx.productOrderLine.update({
    where: { id: lineId },
    data: {
      status: 'HANDED_OVER',
      handedOverByUserId: context.actor.userId,
      handedOverTo: to,
      handedOverToName: name,
      handedOverNote: note,
    },
    select: { id: true },
  });
  await appendOutboxEvent(tx, {
    branchId: line.branchId,
    aggregateType: 'Invoice',
    aggregateId: line.invoiceId,
    eventType: ORDER_HANDED_OVER_EVENT,
    schemaVersion: 1,
    payload: { invoiceId: line.invoiceId, orderLineId: lineId, paidSeq: invoice.paidSeq },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_ORDER_LINE_HANDED_OVER',
    entityType: 'ProductOrder',
    entityId: line.orderId,
    branchId: line.branchId,
    classification: 'STANDARD',
    after: { lineId, orderCode: line.order.code, to, proofChecked: true },
  });
  return orderDetail(context, line.orderId);
}

// ----------------------------------------------------------------------------------------- cancel + refund

/**
 * A paid line is cancelled with a cause (OQ-32) and its whole net share is given back by cash or a manual transfer: the supplier cannot
 * deliver, the customer cancels before the supplier order, the customer changes their mind after it (the Owner or a manager decides case
 * by case, 2026-10-09: the whole share, or a part of it given in `amountVnd`; to decline, see `declineCancel`), or the goods are more
 * than 7 days late. Every cause but the change of mind refunds the whole share. The goods
 * held for the line are released in the same transaction. The refund is the same immutable record as every refund: one fresh password
 * confirmation used once, the Owner told in-app, the Beauty points taken back by the `loyalty` consumer. A line nothing was paid for
 * needs no refund and no password.
 */
export async function cancelLine<T = ProductOrderDetailResponse>(
  context: AdminContext,
  lineId: string,
  request: Record<string, unknown>,
  freshAuthSeconds: number,
  owners: readonly string[],
  /** What the command answers with once it is done: the counter order page, or (Wave 4) the page of an online order. */
  render: (orderId: string) => Promise<T> = (orderId) =>
    orderDetail(context, orderId) as Promise<T>,
): Promise<T> {
  const body = input.record(request, 'body', CANCEL_KEYS);
  const expectedVersion = input.rowVersion(body['expectedVersion']);
  const cause = pick<Exclude<ProductOrderCancelCauseName, 'INVOICE_CANCELLED'>>(
    body['cause'],
    CAUSES,
    'cause',
  );
  const note = parse.requiredNote(body['note'], 'note', PRODUCT_REFUND_REASON_MAX);
  const method = pick<ProductRefundMethodName>(body['method'], METHODS, 'method');
  const clientRequestId = input.uuid(body['clientRequestId'], 'clientRequestId');
  const requestedAmount = partialAmount(body['amountVnd'], cause);
  const reference =
    method === 'BANK_TRANSFER_MANUAL'
      ? bankReference(body['bankReference'])
      : noReference(body['bankReference']);
  const { tx } = context;
  const hint = await tx.productOrderLine.findUnique({
    where: { id: lineId },
    select: {
      branchId: true,
      orderId: true,
      invoiceId: true,
      invoiceLineId: true,
      variantId: true,
      status: true,
      order: { select: { channel: true } },
      productLine: { select: { fulfilmentMode: true } },
    },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  requireRefund(context, hint.branchId);

  const allocation = await tx.invoiceLineAllocation.findUnique({
    where: { invoiceLineId: hint.invoiceLineId },
    select: { netVnd: true, side: true },
  });
  const net = allocation?.side === 'BEAUTY' ? allocation.netVnd : 0n;
  // A part of the share is for the cause 'changed their mind' only and never more than the whole share (nothing is refunded for a
  // line nothing was paid for).
  if (requestedAmount !== null && requestedAmount > net) {
    throw new AuthError('VALIDATION_FAILED', 'amountVnd');
  }

  // A repeat of the same request returns what it already did (no password needed to read it back).
  const replay = async (): Promise<T | null> => {
    const prior = await tx.productRefund.findUnique({
      where: {
        actorUserId_clientRequestId: { actorUserId: context.actor.userId, clientRequestId },
      },
      select: {
        orderLineId: true,
        method: true,
        reason: true,
        bankReference: true,
        amountVnd: true,
      },
    });
    if (!prior) return null;
    if (
      prior.orderLineId !== lineId ||
      prior.method !== method ||
      prior.reason !== note ||
      prior.bankReference !== reference ||
      prior.amountVnd !== (requestedAmount ?? net)
    ) {
      throw new AuthError('CONFLICT');
    }
    return render(hint.orderId);
  };
  const early = await replay();
  if (early) return early;
  // The password is checked before any lock; it is spent only when a refund is written.
  const confirmedAt = net > 0n ? await takeFreshConfirmation(context, freshAuthSeconds) : null;

  // The goods held for an ARRIVED line are given to the next waiting line when this one is cancelled, so the waiting lines of the variant
  // are locked FIRST (invoice, then line, in id order), before this line's own invoice and the stock (design 10.2).
  // Wave 4: the in-stock line of an online order holds its goods from checkout (an invoice-line reservation); they go back when it is
  // cancelled, exactly like the goods of an arrived pre-order line.
  const holdsGoods =
    hint.status === 'ARRIVED' ||
    (hint.status === 'PAID' &&
      hint.order.channel === 'ONLINE' &&
      hint.productLine.fulfilmentMode === 'IN_STOCK');
  if (holdsGoods) await lockWaitingOrderLines(tx, hint.branchId, [hint.variantId]);
  await lockInvoice(tx, hint.invoiceId, true);
  const [line] = await lockLines(tx, [lineId], 'UPDATE');
  if (!line) throw new AuthError('NOT_FOUND');
  const settled = await replay();
  if (settled) return settled;
  if (line.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
  // The line arrived between the read and the lock: the waiting lines were not locked in the right order, so ask to try again.
  if (line.status === 'ARRIVED' && !holdsGoods) throw new AuthError('CONFLICT');
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: line.invoiceId },
    select: {
      code: true,
      status: true,
      channel: true,
      paidSeq: true,
      lines: { where: { id: line.invoiceLineId }, select: { quantity: true } },
    },
  });
  if (invoice.status !== 'PAID') throw new AuthError('INVOICE_STATE_INVALID');
  const today = await branchToday(tx, line.branchId);
  const expectedTo = line.expectedTo ? line.expectedTo.toISOString().slice(0, 10) : null;
  const causes =
    invoice.channel === 'ONLINE'
      ? cancelCausesOnline(
          { status: line.status, mode: line.productLine.fulfilmentMode, expectedTo },
          today,
        )
      : cancelCausesFor({ status: line.status, expectedTo }, today);
  if (!causes.includes(cause)) {
    throw new AuthError('ORDER_CANCEL_CAUSE_INVALID', 'cause');
  }
  if (await openExchangeOnLine(tx, line.invoiceLineId)) throw new AuthError('EXCHANGE_IN_PROGRESS');
  const claims = await lineClaims(tx, line.invoiceLineId);
  if (claims.units !== 0) throw new AuthError('ORDER_LINE_STATE_INVALID');

  // The goods held for an arrived line (or for an in-stock online line) go back to the shelf (the level first, then the reservation).
  const arrived = holdsGoods;
  if (arrived) {
    await tx.$queryRaw`
      SELECT 1 FROM stock_levels WHERE branch_id = ${line.branchId}::uuid AND variant_id = ${line.variantId}::uuid FOR UPDATE`;
  }
  await tx.productOrderLine.update({
    where: { id: lineId },
    data: {
      status: 'CANCELLED',
      cancelCause: cause,
      cancelNote: note,
      cancelledByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  if (arrived) {
    await tx.stockReservation.update({
      where: { invoiceLineId: line.invoiceLineId },
      data: {
        status: 'RELEASED',
        releasedByUserId: context.actor.userId,
        releaseCause: 'ORDER_LINE_CANCELLED',
      },
      select: { id: true },
    });
  }
  // ...and go to the next waiting line at once, oldest paid first (T28), and the member whose goods arrived is told.
  const given = arrived
    ? await allocateWaitingLines(tx, {
        branchId: line.branchId,
        variantIds: [line.variantId],
        actorUserId: context.actor.userId,
      })
    : [];
  await tellMembersGoodsArrived(tx, given);

  let refundCode: string | null = null;
  if (net > 0n && confirmedAt) {
    const sold = invoice.lines[0]?.quantity ?? line.quantity;
    // The whole share, or - for a change of mind only - the part the Owner or the manager decided (1 to the whole share).
    const share = productRefundAmount(net, sold, 0, line.quantity);
    const amount = requestedAmount ?? share;
    const onInvoice = await tx.productRefund.aggregate({
      where: { invoiceId: line.invoiceId },
      _sum: { amountVnd: true },
    });
    const [sequence] = await tx.$queryRaw<
      { n: string }[]
    >`SELECT nextval('product_refund_code_seq')::text AS n`;
    refundCode = `HT${sequence!.n.padStart(6, '0')}`;
    const refund = await tx.productRefund.create({
      data: {
        code: refundCode,
        branchId: line.branchId,
        invoiceId: line.invoiceId,
        invoiceLineId: line.invoiceLineId,
        orderLineId: lineId,
        paidSeq: invoice.paidSeq,
        quantity: line.quantity,
        amountVnd: amount,
        lineUnitsAfter: line.quantity,
        lineAmountAfterVnd: amount,
        invoiceRefundedAfterVnd: (onInvoice._sum.amountVnd ?? 0n) + amount,
        method,
        bankReference: reference,
        reason: note,
        restock: 'NOT_SELLABLE',
        actorUserId: context.actor.userId,
        reauthenticatedAt: confirmedAt,
        clientRequestId,
      },
      select: { id: true, occurredAt: true },
    });
    await tx.refundReauthenticationUse.create({
      data: {
        actorUserId: context.actor.userId,
        reauthenticatedAt: confirmedAt,
        productRefundId: refund.id,
      },
      select: { actorUserId: true },
    });
    await appendAdminAudit(context, {
      action: 'PRODUCT_REFUNDED',
      entityType: 'ProductRefund',
      entityId: refund.id,
      branchId: line.branchId,
      classification: 'FINANCIAL',
      reason: note,
      after: {
        code: refundCode,
        orderCode: line.order.code,
        invoiceCode: invoice.code,
        invoiceLineId: line.invoiceLineId,
        quantity: line.quantity,
        amountVnd: amount.toString(),
        shareVnd: share.toString(),
        partial: amount < share,
        method,
        bankReferenceRecorded: reference !== null,
        restock: 'NOT_SELLABLE',
        cause,
        reauthenticatedAt: confirmedAt.toISOString(),
      },
    });
    const variant = await tx.invoiceLineProduct.findUniqueOrThrow({
      where: { invoiceLineId: line.invoiceLineId },
      select: { sku: true },
    });
    const refunder = await tx.user.findUniqueOrThrow({
      where: { id: context.actor.userId },
      select: { fullName: true },
    });
    await tellOwnerAboutRefund(tx, {
      branchId: line.branchId,
      caseId: line.orderId,
      caseCode: line.order.code,
      entityType: 'ProductOrder',
      recipients: owners,
      source: 'ORDER_CANCEL',
      invoiceCode: invoice.code,
      sku: variant.sku,
      quantity: line.quantity,
      amountVnd: amount,
      method,
      refundedByName: refunder.fullName,
    });
    await appendOutboxEvent(tx, {
      branchId: line.branchId,
      aggregateType: 'ProductRefund',
      aggregateId: refund.id,
      eventType: 'PRODUCT_REFUNDED',
      schemaVersion: 1,
      occurredAt: refund.occurredAt,
      payload: { refundId: refund.id, invoiceId: line.invoiceId, branchId: line.branchId },
    });
  }
  // Wave 4 (OQ-101): the member of an online order is told in the app, with the amount when money goes back.
  if (invoice.channel === 'ONLINE') {
    const customer = await tx.productOrder.findUniqueOrThrow({
      where: { id: line.orderId },
      select: { customerUserId: true },
    });
    if (customer.customerUserId) {
      const refunded = refundCode !== null;
      await tellMember(tx, {
        type: refunded ? 'ONLINE_ORDER_REFUNDED' : 'ONLINE_ORDER_CANCELLED',
        userId: customer.customerUserId,
        branchId: line.branchId,
        invoiceId: line.invoiceId,
        orderCode: line.order.code,
        eventKey: `cancelled:${lineId}`,
        ...(refunded
          ? {
              params: {
                amountVnd: (
                  requestedAmount ??
                  productRefundAmount(
                    net,
                    invoice.lines[0]?.quantity ?? line.quantity,
                    0,
                    line.quantity,
                  )
                ).toString(),
              },
            }
          : {}),
      });
    }
  }
  await appendAdminAudit(context, {
    action: 'PRODUCT_ORDER_LINE_CANCELLED',
    entityType: 'ProductOrder',
    entityId: line.orderId,
    branchId: line.branchId,
    classification: 'FINANCIAL',
    reason: note,
    after: {
      lineId,
      orderCode: line.order.code,
      cause,
      from: line.status,
      refundCode,
      goodsReleased: arrived,
      goodsGivenToLines: given.map((entry) => entry.orderLineId),
    },
  });
  return render(line.orderId);
}

// ---------------------------------------------------------------------------------- decline a change of mind

/**
 * The Owner or a manager declines a customer's request to cancel after the supplier order (OQ-32, the Owner on 2026-10-09: "full
 * refund, partial or decline, with a written reason"). Nothing moves: no money, no stock, no status; the line stays and the customer can
 * still collect the goods. The decision and its reason are kept in the audit log. It is possible only where the change of mind is a
 * cause that could be used (the line is ORDERED or ARRIVED) and the invoice is paid.
 */
export async function declineCancel(
  context: AdminContext,
  lineId: string,
  request: Record<string, unknown>,
): Promise<ProductOrderDetailResponse> {
  const body = input.record(request, 'body', DECLINE_KEYS);
  const expectedVersion = input.rowVersion(body['expectedVersion']);
  const note = parse.requiredNote(body['note'], 'note', PRODUCT_REFUND_REASON_MAX);
  const { tx } = context;
  const hint = await tx.productOrderLine.findUnique({
    where: { id: lineId },
    select: { branchId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  requireRefund(context, hint.branchId);
  const [line] = await lockLines(tx, [lineId]);
  if (!line) throw new AuthError('NOT_FOUND');
  if (line.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
  if (line.status !== 'ORDERED' && line.status !== 'ARRIVED') {
    throw new AuthError('ORDER_CANCEL_CAUSE_INVALID', 'cause');
  }
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: line.invoiceId },
    select: { status: true, channel: true },
  });
  if (invoice.status !== 'PAID' || invoice.channel !== 'COUNTER') {
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  await appendAdminAudit(context, {
    action: 'PRODUCT_ORDER_CANCEL_DECLINED',
    entityType: 'ProductOrder',
    entityId: line.orderId,
    branchId: line.branchId,
    classification: 'FINANCIAL',
    reason: note,
    after: {
      lineId,
      orderCode: line.order.code,
      status: line.status,
      cause: 'CUSTOMER_CHANGED_MIND',
    },
  });
  return orderDetail(context, line.orderId);
}

// -------------------------------------------------------------------------------------- correct a reference

/** A mistyped bank reference of a cancellation refund is corrected by a new linked record; the refund itself never changes. */
export async function correctReference(
  context: AdminContext,
  lineId: string,
  request: Record<string, unknown>,
): Promise<ProductOrderDetailResponse> {
  const body = input.record(request, 'body', ['bankReference', 'reason']);
  const reference = bankReference(body['bankReference']);
  const reason = parse.requiredNote(body['reason'], 'reason', PRODUCT_REFUND_REASON_MAX);
  const { tx } = context;
  const refund = await tx.productRefund.findUnique({
    where: { orderLineId: lineId },
    select: {
      id: true,
      code: true,
      branchId: true,
      invoiceId: true,
      method: true,
      orderLine: { select: { orderId: true } },
    },
  });
  if (!refund?.orderLine) throw new AuthError('NOT_FOUND');
  requireRefund(context, refund.branchId);
  if (refund.method !== 'BANK_TRANSFER_MANUAL') {
    throw new AuthError('VALIDATION_FAILED', 'bankReference');
  }
  await lockInvoice(tx, refund.invoiceId, false);
  await tx.productRefundCorrection.create({
    data: {
      refundId: refund.id,
      bankReference: reference,
      reason,
      actorUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_REFUND_REFERENCE_CORRECTED',
    entityType: 'ProductRefund',
    entityId: refund.id,
    branchId: refund.branchId,
    classification: 'FINANCIAL',
    reason,
    after: { code: refund.code },
  });
  return orderDetail(context, refund.orderLine.orderId);
}

// ---------------------------------------------------------------------------------------------- allocate

/** Gives free stock to the waiting lines now (the same function the receipt and the sweep use), and tells the members whose goods arrived. */
export async function allocateNow(
  context: AdminContext,
  request: Record<string, unknown>,
): Promise<ProductOrderAllocateResponse> {
  const body = input.record(request, 'body', ALLOCATE_KEYS);
  const branchId = input.uuid(body['branchId'], 'branchId');
  const variantId = input.optionalUuid(body['variantId'], 'variantId');
  const { tx } = context;
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw new AuthError('NOT_FOUND');
  requireManageOrders(context, branchId);
  const variants =
    variantId !== null
      ? [variantId]
      : (
          await tx.productOrderLine.findMany({
            where: { branchId, status: { in: ['PAID', 'ORDERED'] } },
            distinct: ['variantId'],
            select: { variantId: true },
          })
        ).map((row) => row.variantId);
  await lockWaitingOrderLines(tx, branchId, variants);
  const arrived = await allocateWaitingLines(tx, {
    branchId,
    variantIds: variants,
    actorUserId: context.actor.userId,
  });
  await tellMembersGoodsArrived(tx, arrived);
  if (arrived.length > 0) {
    await appendAdminAudit(context, {
      action: 'PRODUCT_ORDER_LINES_ALLOCATED',
      entityType: 'Branch',
      entityId: branchId,
      branchId,
      classification: 'STANDARD',
      after: { lineIds: arrived.map((line) => line.orderLineId) },
    });
  }
  return { allocated: arrived.length };
}
