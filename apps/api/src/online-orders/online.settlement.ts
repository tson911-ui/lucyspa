import {
  failedDeliveryRefund,
  PRODUCT_REFUND_REASON_MAX,
  type ProductRefundMethodName,
  type ProductRefundRestockName,
  type OnlineStaffOrderResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { randomUUID } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../inventory/inventory.input.js';
import { splitProRata } from '../pos/split.js';
import {
  bankReference,
  lockInvoice,
  noReference,
  pick,
  soldSegments,
  takeFreshConfirmation,
} from '../product-returns/refund.core.js';
import { tellOwnerAboutRefund } from '../product-returns/refund.notice.js';
import * as parse from '../product-returns/return.input.js';
import {
  effectiveShipment,
  lockOrder,
  onlineStaffOrder,
  requireRefundOnline,
} from './online.fulfilment.js';
import { tellMember } from './online.notice.js';
import { money } from './online.input.js';

/**
 * Phase 6 Wave 4 (P6-21; OQ-98 as approved by the Owner on 2026-10-09; design 2.38): the settlement of a FAILED DELIVERY.
 *
 * The carrier could not deliver, the shop tried again, the customer no longer wants the parcel and the parcel is BACK at the shop (staff
 * with MANAGE_PRODUCT_ORDERS logged all of it). Only now may a person who may refund (REFUND_PRODUCTS at the branch) enter the settlement:
 * the cost the shop paid for the way back, a reason, and whether the returned goods can be sold again. The refund is ONE formula:
 *
 *     refund = max(0, goods paid - carrier cost out - carrier cost back)      never more than the goods paid
 *
 * where "goods paid" is the net amount the customer really paid for the lines of the parcel (after every discount, from the recorded
 * allocation, never typed) and "cost out" is the cost on record of the way there. The refund is split over the lines in proportion to their
 * net amounts (the one proportional-split primitive), each part written as the usual immutable refund record (cash or a manual transfer,
 * the Owner told, the Beauty points taken back by the same consumer); ONE password confirmation, used once, covers the whole refund (the
 * settlement is one refund). A refund of 0 moves no money and asks no password. The lines end CANCELLED (cause DELIVERY_FAILED); the goods
 * that were sold when the parcel left go back into stock as a new lot named after the order ONLY when the person says they can be sold again
 * and a refund exists to name the lot after (otherwise they enter stock through the stock count). Nothing here changes a figure the Owner
 * did not approve: a deduction for anything other than the two carrier costs is not possible.
 *
 * Lock order (design 10.2): the invoice row, then the order lines, then the stock (by the database guards of the movements).
 */
const KEYS = [
  'lines',
  'carrierFeeBackVnd',
  'reason',
  'restock',
  'method',
  'bankReference',
  'clientRequestId',
] as const;
const RESTOCKS = ['SELLABLE', 'NOT_SELLABLE'] as const;
const METHODS = ['CASH', 'BANK_TRANSFER_MANUAL'] as const;

type Tx = Prisma.TransactionClient;

export async function settleFailedDelivery(
  context: AdminContext,
  orderId: string,
  request: Record<string, unknown>,
  freshAuthSeconds: number,
  owners: readonly string[],
): Promise<OnlineStaffOrderResponse> {
  const body = input.record(request, 'body', KEYS);
  const wanted = new Map<string, number>();
  for (const [index, entry] of input.list(body['lines'], 'lines', 200).entries()) {
    const line = input.record(entry, `lines.${index}`, ['id', 'rowVersion']);
    const id = input.uuid(line['id'], `lines.${index}.id`);
    if (wanted.has(id)) throw new AuthError('VALIDATION_FAILED', 'lines');
    wanted.set(id, input.rowVersion(line['rowVersion']));
  }
  if (wanted.size === 0) throw new AuthError('VALIDATION_FAILED', 'lines');
  const back = money(body['carrierFeeBackVnd'], 'carrierFeeBackVnd');
  const reason = parse.requiredNote(body['reason'], 'reason', PRODUCT_REFUND_REASON_MAX);
  const restock = pick<ProductRefundRestockName>(body['restock'], RESTOCKS, 'restock');
  const clientRequestId = input.uuid(body['clientRequestId'], 'clientRequestId');
  const { tx } = context;
  const hint = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { branchId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  requireRefundOnline(context, hint.branchId);
  // The method is asked only when money goes back; it is read after the amount is known.
  const methodRaw = body['method'];

  const replay = async (): Promise<OnlineStaffOrderResponse | null> => {
    const prior = await tx.onlineFailedDeliverySettlement.findUnique({
      where: {
        actorUserId_clientRequestId: { actorUserId: context.actor.userId, clientRequestId },
      },
      select: {
        orderId: true,
        carrierFeeBackVnd: true,
        reason: true,
        restock: true,
        method: true,
      },
    });
    if (!prior) return null;
    if (
      prior.orderId !== orderId ||
      prior.carrierFeeBackVnd !== back ||
      prior.reason !== reason ||
      prior.restock !== restock
    ) {
      throw new AuthError('CONFLICT');
    }
    return onlineStaffOrder(context, orderId);
  };
  const early = await replay();
  if (early) return early;

  // What would be refunded, read before the locks only to know whether a password is needed (it is read again under the locks).
  const preview = await goodsAndCost(tx, orderId, [...wanted.keys()]);
  const previewRefund = failedDeliveryRefund(preview.goods, preview.feeOut, back);
  const confirmedAt =
    previewRefund > 0n ? await takeFreshConfirmation(context, freshAuthSeconds) : null;

  await lockInvoice(
    tx,
    (
      await tx.productOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: { invoiceId: true },
      })
    ).invoiceId,
    true,
  );
  const locked = await lockOrder(tx, orderId, 'UPDATE');
  const settled = await replay();
  if (settled) return settled;
  if (locked.invoice.status !== 'PAID') throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  if (
    await tx.onlineFailedDeliverySettlement.findUnique({ where: { orderId }, select: { id: true } })
  ) {
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  }
  const live = locked.lines.filter((line) => line.status !== 'CANCELLED');
  if (
    live.length === 0 ||
    live.some((line) => line.status !== 'SHIPPED') ||
    live.length !== wanted.size ||
    live.some((line) => wanted.get(line.id) !== line.rowVersion)
  ) {
    throw new AuthError(
      live.some((line) => line.status !== 'SHIPPED') ? 'ONLINE_ORDER_STATE_INVALID' : 'CONFLICT',
    );
  }
  const returned = await tx.onlineOrderLog.findFirst({
    where: { orderId, kind: 'RETURNED_TO_SHOP' },
    select: { id: true },
  });
  if (!returned) throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  const figures = await goodsAndCost(
    tx,
    orderId,
    live.map((line) => line.id),
  );
  const refund = failedDeliveryRefund(figures.goods, figures.feeOut, back);
  if (refund > 0n !== (confirmedAt !== null)) throw new AuthError('CONFLICT');
  // Goods that are back but earn no refund have no refund to name a lot after: they enter stock through the stock count.
  if (refund === 0n && restock === 'SELLABLE') throw new AuthError('VALIDATION_FAILED', 'restock');
  const method: ProductRefundMethodName | null =
    refund > 0n ? pick<ProductRefundMethodName>(methodRaw, METHODS, 'method') : null;
  if (refund === 0n && methodRaw !== undefined && methodRaw !== null) {
    throw new AuthError('VALIDATION_FAILED', 'method');
  }
  const reference =
    method === 'BANK_TRANSFER_MANUAL'
      ? bankReference(body['bankReference'])
      : noReference(body['bankReference']);

  const settlement = await tx.onlineFailedDeliverySettlement.create({
    data: {
      orderId,
      goodsPaidVnd: figures.goods,
      carrierFeeOutVnd: figures.feeOut,
      carrierFeeBackVnd: back,
      refundVnd: refund,
      restock,
      method,
      bankReference: reference,
      reason,
      actorUserId: context.actor.userId,
      reauthenticatedAt: confirmedAt,
      clientRequestId,
    },
    select: { id: true },
  });
  if (confirmedAt) {
    await tx.refundReauthenticationUse.create({
      data: {
        actorUserId: context.actor.userId,
        reauthenticatedAt: confirmedAt,
        settlementId: settlement.id,
      },
      select: { actorUserId: true },
    });
  }

  const nets = figures.perLine.map((line) => line.net);
  const shares = splitProRata(refund, nets);
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: locked.order.invoiceId },
    select: { code: true, paidSeq: true },
  });
  let refunded =
    (
      await tx.productRefund.aggregate({
        where: { invoiceId: locked.order.invoiceId },
        _sum: { amountVnd: true },
      })
    )._sum.amountVnd ?? 0n;
  const refunder = await tx.user.findUniqueOrThrow({
    where: { id: context.actor.userId },
    select: { fullName: true },
  });
  const refundIds: string[] = [];
  for (const [index, line] of figures.perLine.entries()) {
    await tx.productOrderLine.update({
      where: { id: line.id },
      data: {
        status: 'CANCELLED',
        cancelCause: 'DELIVERY_FAILED',
        cancelNote: reason,
        cancelledByUserId: context.actor.userId,
      },
      select: { id: true },
    });
    const amount = shares[index]!;
    if (amount === 0n || method === null) continue;
    const [sequence] = await tx.$queryRaw<
      { n: string }[]
    >`SELECT nextval('product_refund_code_seq')::text AS n`;
    const code = `HT${sequence!.n.padStart(6, '0')}`;
    refunded += amount;
    const row = await tx.productRefund.create({
      data: {
        code,
        branchId: locked.order.branchId,
        invoiceId: locked.order.invoiceId,
        invoiceLineId: line.invoiceLineId,
        orderLineId: line.id,
        settlementId: settlement.id,
        paidSeq: invoice.paidSeq,
        quantity: line.quantity,
        amountVnd: amount,
        lineUnitsAfter: line.quantity,
        lineAmountAfterVnd: amount,
        invoiceRefundedAfterVnd: refunded,
        method,
        bankReference: reference,
        reason,
        restock,
        actorUserId: context.actor.userId,
        reauthenticatedAt: confirmedAt!,
        clientRequestId: randomUUID(),
      },
      select: { id: true, occurredAt: true },
    });
    refundIds.push(row.id);
    if (restock === 'SELLABLE') {
      const segments = await soldSegments(
        tx,
        {
          invoiceLineId: line.invoiceLineId,
          paidSeq: invoice.paidSeq,
          soldQuantity: line.quantity,
        },
        0,
        line.quantity,
      );
      const base = `${locked.order.code}-${index + 1}`;
      for (const [part, segment] of segments.entries()) {
        const lot = await tx.inventoryLot.create({
          data: {
            branchId: locked.order.branchId,
            variantId: line.variantId,
            lotCode: segments.length === 1 ? base : `${base}/${part + 1}`,
            expiryDate: segment.expiryDate,
            unitCostVnd: segment.unitCostVnd,
            sourceRefundId: row.id,
            createdByUserId: context.actor.userId,
          },
          select: { id: true },
        });
        await tx.stockMovement.create({
          data: {
            branchId: locked.order.branchId,
            variantId: line.variantId,
            lotId: lot.id,
            kind: 'REFUND_RETURN',
            quantityDelta: segment.quantity,
            productRefundId: row.id,
            idempotencyKey: `REFUND_RETURN:${row.id}:${part + 1}`,
            actorUserId: context.actor.userId,
          },
          select: { id: true },
        });
      }
    }
    await appendAdminAudit(context, {
      action: 'PRODUCT_REFUNDED',
      entityType: 'ProductRefund',
      entityId: row.id,
      branchId: locked.order.branchId,
      classification: 'FINANCIAL',
      reason,
      after: {
        code,
        orderCode: locked.order.code,
        invoiceCode: invoice.code,
        invoiceLineId: line.invoiceLineId,
        quantity: line.quantity,
        amountVnd: amount.toString(),
        method,
        bankReferenceRecorded: reference !== null,
        restock,
        cause: 'DELIVERY_FAILED',
        reauthenticatedAt: confirmedAt!.toISOString(),
      },
    });
    await tellOwnerAboutRefund(tx, {
      branchId: locked.order.branchId,
      caseId: orderId,
      caseCode: locked.order.code,
      entityType: 'ProductOrder',
      recipients: owners,
      source: 'DELIVERY_FAILED',
      invoiceCode: invoice.code,
      sku: line.sku,
      quantity: line.quantity,
      amountVnd: amount,
      method,
      refundedByName: refunder.fullName,
    });
    await appendOutboxEvent(tx, {
      branchId: locked.order.branchId,
      aggregateType: 'ProductRefund',
      aggregateId: row.id,
      eventType: 'PRODUCT_REFUNDED',
      schemaVersion: 1,
      occurredAt: row.occurredAt,
      payload: {
        refundId: row.id,
        invoiceId: locked.order.invoiceId,
        branchId: locked.order.branchId,
      },
    });
  }
  await appendAdminAudit(context, {
    action: 'ONLINE_FAILED_DELIVERY_SETTLED',
    entityType: 'ProductOrder',
    entityId: orderId,
    subjectUserId: locked.order.customerUserId,
    branchId: locked.order.branchId,
    classification: 'FINANCIAL',
    reason,
    after: {
      orderCode: locked.order.code,
      goodsPaidVnd: figures.goods.toString(),
      carrierFeeOutVnd: figures.feeOut.toString(),
      carrierFeeBackVnd: back.toString(),
      refundVnd: refund.toString(),
      restock,
      refunds: refundIds.length,
    },
  });
  if (locked.order.customerUserId) {
    await tellMember(tx, {
      type: refund > 0n ? 'ONLINE_ORDER_REFUNDED' : 'ONLINE_ORDER_CANCELLED',
      userId: locked.order.customerUserId,
      branchId: locked.order.branchId,
      invoiceId: locked.order.invoiceId,
      orderCode: locked.order.code,
      eventKey: `settled:${orderId}`,
      ...(refund > 0n ? { params: { amountVnd: refund.toString() } } : {}),
    });
  }
  return onlineStaffOrder(context, orderId);
}

/** The net amounts of the lines (from the recorded allocation) and the cost on record of the way there. */
async function goodsAndCost(tx: Tx, orderId: string, lineIds: readonly string[]) {
  const rows = await tx.productOrderLine.findMany({
    where: { orderId, id: { in: [...lineIds] } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      invoiceLineId: true,
      variantId: true,
      quantity: true,
      productLine: { select: { sku: true } },
    },
  });
  if (rows.length !== lineIds.length) throw new AuthError('NOT_FOUND');
  const allocations = await tx.invoiceLineAllocation.findMany({
    where: { invoiceLineId: { in: rows.map((row) => row.invoiceLineId) } },
    select: { invoiceLineId: true, netVnd: true, side: true },
  });
  const net = new Map(
    allocations
      .filter((entry) => entry.side === 'BEAUTY')
      .map((entry) => [entry.invoiceLineId, entry.netVnd]),
  );
  const perLine = rows.map((row) => ({
    id: row.id,
    invoiceLineId: row.invoiceLineId,
    variantId: row.variantId,
    quantity: row.quantity,
    sku: row.productLine.sku,
    net: net.get(row.invoiceLineId) ?? 0n,
  }));
  const shipment = await tx.onlineShipment.findUnique({
    where: { orderId },
    select: {
      carrierFeeOutVnd: true,
      shippedAt: true,
      carrierId: true,
      carrierName: true,
      trackingCode: true,
      id: true,
      shippedByUserId: true,
      createdAt: true,
      carrier: { select: { trackingUrlTemplate: true } },
      corrections: {
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: {
          trackingCode: true,
          carrierFeeOutVnd: true,
          reason: true,
          actorUserId: true,
          occurredAt: true,
        },
      },
    },
  });
  if (!shipment) throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  return {
    perLine,
    goods: perLine.reduce((sum, line) => sum + line.net, 0n),
    feeOut: effectiveShipment(shipment).carrierFeeOutVnd,
  };
}
