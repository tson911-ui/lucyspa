import {
  onlineOrderState,
  trackingUrl,
  type OnlineOrderLineResponse,
  type OnlineOrderResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import type { OnlineOrderRow } from './online.checkout.js';

type Tx = Prisma.TransactionClient;

const day = (value: Date) => value.toISOString().slice(0, 10);
const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * The customer's view of one online order (Phase 6 Wave 4). Only what the customer may read: the lines, the amounts, the delivery
 * address they typed, the payment link while it is useful, the shipment (carrier and tracking code) and the refund amounts. What the shop
 * paid the carrier, who handled the order, the reasons staff wrote and the log of contacts never appear here.
 */
export async function presentOnlineOrder(
  tx: Tx,
  row: OnlineOrderRow,
  now: Date,
): Promise<OnlineOrderResponse> {
  const detail = row.onlineDetail!;
  const lines: OnlineOrderLineResponse[] = row.lines.map((line) => ({
    id: line.id,
    sequence: line.line.sequence,
    variantId: line.variantId,
    nameVi: line.line.nameVi,
    nameEn: line.line.nameEn,
    variantLabelVi: line.productLine.variantLabelVi,
    variantLabelEn: line.productLine.variantLabelEn,
    quantity: line.quantity,
    unitPriceVnd: (line.line.unitPriceVnd ?? 0n).toString(),
    lineTotalVnd: (line.line.grossVnd ?? 0n).toString(),
    mode: line.productLine.fulfilmentMode,
    status: line.status,
    expectedFrom: line.expectedFrom ? day(line.expectedFrom) : null,
    expectedTo: line.expectedTo ? day(line.expectedTo) : null,
    cancelCause: line.cancelCause,
    refundedVnd: line.refund ? line.refund.amountVnd.toString() : null,
  }));
  const invoice = row.invoice;
  const unpaid = invoice.status === 'PENDING_PAYMENT';
  const open = unpaid && detail.deadlineAt.getTime() > now.getTime();
  const payment =
    invoice.payments.find((entry) => entry.status === 'PENDING') ?? invoice.payments[0];
  // The last word about the delivery: a failed attempt, a customer who no longer wants the parcel or the parcel back at the shop.
  const lastEvent = await tx.onlineOrderLog.findFirst({
    where: {
      orderId: row.id,
      kind: {
        in: ['DELIVERY_FAILED', 'REDELIVERY', 'RETURN_STARTED', 'RETURNED_TO_SHOP', 'DELIVERED'],
      },
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { kind: true },
  });
  const deliveryFailed =
    lastEvent?.kind === 'DELIVERY_FAILED' ||
    lastEvent?.kind === 'RETURN_STARTED' ||
    lastEvent?.kind === 'RETURNED_TO_SHOP';
  const state = onlineOrderState({
    invoiceStatus: invoice.status,
    lines: lines.map((line) => ({ status: line.status, mode: line.mode })),
    deliveryFailed,
  });
  const live = row.lines.filter((line) => line.status !== 'CANCELLED');
  const parcelWithCustomer =
    invoice.status === 'PAID' &&
    live.length > 0 &&
    live.every((line) => line.status === 'SHIPPED') &&
    lastEvent?.kind !== 'RETURNED_TO_SHOP';
  const delivered = row.lines.find((line) => line.deliveredAt !== null)?.deliveredAt ?? null;
  const refundedTotal =
    (
      await tx.productRefund.aggregate({
        where: { invoiceId: row.invoiceId },
        _sum: { amountVnd: true },
      })
    )._sum.amountVnd ?? 0n;
  const fix = row.addressCorrections[0];
  const shipment = row.shipment;
  const code = shipment ? (shipment.corrections[0]?.trackingCode ?? shipment.trackingCode) : null;
  return {
    id: row.id,
    code: row.code,
    invoiceId: row.invoiceId,
    invoiceCode: invoice.code,
    state,
    placedAt: row.createdAt.toISOString(),
    deadlineAt: unpaid ? detail.deadlineAt.toISOString() : null,
    paidAt: iso(invoice.paidAt),
    subtotalVnd: invoice.subtotalVnd.toString(),
    discountVnd: invoice.discountTotalVnd.toString(),
    shippingFeeVnd: invoice.shippingFeeVnd.toString(),
    totalVnd: invoice.totalVnd.toString(),
    recipient: {
      name: fix?.recipientName ?? detail.recipientName,
      phone: fix?.recipientPhone ?? detail.recipientPhone,
      provinceName: fix?.provinceName ?? detail.provinceName,
      ward: fix?.ward ?? detail.ward,
      street: fix?.street ?? detail.street,
    },
    lines,
    hasPreOrder: lines.some((line) => line.mode === 'PRE_ORDER'),
    shipment:
      shipment && code
        ? {
            carrierName: shipment.carrierName,
            trackingCode: code,
            trackingUrl: trackingUrl(shipment.carrier.trackingUrlTemplate, code),
            shippedAt: shipment.shippedAt.toISOString(),
          }
        : null,
    deliveredAt: iso(delivered),
    refundedVnd: refundedTotal.toString(),
    returnWindows: delivered
      ? {
          personalPreferenceUntil: new Date(delivered.getTime() + 168 * 3_600_000).toISOString(),
          wrongOrDamagedUntil: new Date(delivered.getTime() + 48 * 3_600_000).toISOString(),
        }
      : null,
    payment: payment
      ? {
          paymentId: payment.id,
          status: payment.status,
          amountVnd: payment.amountVnd.toString(),
          checkoutUrl: payment.status === 'PENDING' ? payment.checkoutUrl : null,
          qrCode: payment.status === 'PENDING' ? payment.qrCode : null,
          expiresAt: iso(payment.expiresAt),
        }
      : null,
    can: { pay: open, cancel: unpaid, confirmReceived: parcelWithCustomer },
    policyVersion: detail.policyVersion,
  };
}
