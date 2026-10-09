import {
  onlineOrderState,
  ONLINE_FAIL_REASONS,
  ONLINE_QUEUE_PAGE_SIZE,
  ONLINE_QUEUE_TABS,
  provinceByCode,
  trackingUrl,
  type OnlineAddressCorrectRequest,
  type OnlineDeliveredRequest,
  type OnlineFailReason,
  type OnlineLogKind,
  type OnlineLogRequest,
  type OnlineQueueResponse,
  type OnlineQueueRow,
  type OnlineQueueTab,
  type OnlineReturnedRequest,
  type OnlineShipmentCorrectRequest,
  type OnlineShipRequest,
  type OnlineStaffLine,
  type OnlineStaffOrderResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { ORDER_SHIPPED_EVENT } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import type { CustomerContext } from '../booking/customer-command.js';
import * as input from '../inventory/inventory.input.js';
import { maskPhone } from '../operations/operations.state.js';
import { canManageOrdersAt, holdsAt } from '../product-orders/order.access.js';
import { branchToday } from '../product-orders/order.queue.js';
import * as parse from '../product-returns/return.input.js';
import { cancelCausesOnline } from './online.cancel.js';
import { tellMember } from './online.notice.js';
import { stateToOrderState } from './online.orders.js';
import { money, parseAddress } from './online.input.js';
import { readOnlineSettings } from './online.settings.js';

/**
 * Phase 6 Wave 4 (P6-20; design 2.38; T39, T41, OQ-90, OQ-94 to OQ-96): packing and shipping an online order, and everything that is said
 * about its delivery afterwards. An online order is ONE parcel: it ships when every line that is not cancelled is ready, all its lines
 * together, with the carrier, the tracking code and the cost the shop pays the carrier (internal). The goods leave the stock when the
 * lines ship (the `inventory` consumer, event `INVOICE_ORDER_SHIPPED`), the line is COMPLETED by the delivery, and the window of a return
 * counts from it (OQ-40).
 *
 * Lock order (design 10.2): the invoice row, then the order lines (id order); the stock is the consumer's. A cancellation, a refund and a
 * shipment of the same order all take the invoice first, so whichever commits first decides and the other finds the lines changed.
 */
type Tx = Prisma.TransactionClient;

const unique = (ids: readonly string[]) => [...new Set(ids)].sort();
const NOTE_MAX = 500;
const TRACKING = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,79}$/;

export function trackingCodeOf(value: unknown, field = 'trackingCode'): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (!TRACKING.test(text)) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

// ------------------------------------------------------------------------------------------- authority

export const canWorkOnline = (context: AdminContext, branchId: string) =>
  canManageOrdersAt(context.actor.graph, branchId);
export const canRefundOnline = (context: AdminContext, branchId: string) =>
  holdsAt(context.actor.graph, 'REFUND_PRODUCTS', branchId);

function requireWork(context: AdminContext, branchId: string): void {
  if (!canWorkOnline(context, branchId)) throw new AuthError('FORBIDDEN');
}
function requireSee(context: AdminContext, branchId: string): { work: boolean; refund: boolean } {
  const work = canWorkOnline(context, branchId);
  const refund = canRefundOnline(context, branchId);
  if (!work && !refund) throw new AuthError('FORBIDDEN');
  return { work, refund };
}

// --------------------------------------------------------------------------------------------- reading

const orderSelect = {
  id: true,
  code: true,
  invoiceId: true,
  branchId: true,
  channel: true,
  createdAt: true,
  customer: { select: { id: true, fullName: true } },
  invoice: {
    select: {
      code: true,
      status: true,
      paidSeq: true,
      paidAt: true,
      subtotalVnd: true,
      discountTotalVnd: true,
      shippingFeeVnd: true,
      totalVnd: true,
      payments: {
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        select: {
          id: true,
          status: true,
          amountVnd: true,
          checkoutUrl: true,
          qrCode: true,
          expiresAt: true,
        },
      },
    },
  },
  onlineDetail: true,
  addressCorrections: {
    orderBy: [{ occurredAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  shipment: {
    select: {
      id: true,
      carrierId: true,
      carrierName: true,
      trackingCode: true,
      carrierFeeOutVnd: true,
      shippedAt: true,
      shippedByUserId: true,
      carrier: { select: { trackingUrlTemplate: true } },
      corrections: {
        orderBy: [{ occurredAt: 'asc' as const }, { id: 'asc' as const }],
        select: {
          trackingCode: true,
          carrierFeeOutVnd: true,
          reason: true,
          actorUserId: true,
          occurredAt: true,
        },
      },
    },
  },
  lines: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      invoiceLineId: true,
      variantId: true,
      quantity: true,
      status: true,
      expectedFrom: true,
      expectedTo: true,
      cancelCause: true,
      rowVersion: true,
      shippedAt: true,
      deliveredAt: true,
      deliveredByKind: true,
      line: {
        select: { sequence: true, nameVi: true, nameEn: true, unitPriceVnd: true, grossVnd: true },
      },
      productLine: {
        select: { sku: true, variantLabelVi: true, variantLabelEn: true, fulfilmentMode: true },
      },
      refund: { select: { amountVnd: true } },
    },
  },
} satisfies Prisma.ProductOrderSelect;

export type OnlineStaffRow = Prisma.ProductOrderGetPayload<{ select: typeof orderSelect }>;

/** The address as the order stands now: the last correction, else what the customer typed. */
export function effectiveAddress(row: Pick<OnlineStaffRow, 'onlineDetail' | 'addressCorrections'>) {
  const detail = row.onlineDetail!;
  const fix = row.addressCorrections[0];
  return {
    name: fix?.recipientName ?? detail.recipientName,
    phone: fix?.recipientPhone ?? detail.recipientPhone,
    provinceCode: fix?.provinceCode ?? detail.provinceCode,
    provinceName: fix?.provinceName ?? detail.provinceName,
    ward: fix?.ward ?? detail.ward,
    street: fix?.street ?? detail.street,
    corrected: fix !== undefined,
  };
}

/** The tracking code and the cost as they stand now: the last correction, else the first record. */
export function effectiveShipment(shipment: {
  trackingCode: string;
  carrierFeeOutVnd: bigint;
  corrections: readonly { trackingCode: string; carrierFeeOutVnd: bigint }[];
}) {
  const last = shipment.corrections.at(-1);
  return {
    trackingCode: last?.trackingCode ?? shipment.trackingCode,
    carrierFeeOutVnd: last?.carrierFeeOutVnd ?? shipment.carrierFeeOutVnd,
  };
}

/** True while the last word about the delivery is a failed attempt, a customer who no longer wants the parcel, or the parcel back. */
export function deliveryFailedBy(kinds: readonly string[]): boolean {
  const last = [...kinds]
    .reverse()
    .find((kind) =>
      ['DELIVERY_FAILED', 'REDELIVERY', 'RETURN_STARTED', 'RETURNED_TO_SHOP', 'DELIVERED'].includes(
        kind,
      ),
    );
  return last === 'DELIVERY_FAILED' || last === 'RETURN_STARTED' || last === 'RETURNED_TO_SHOP';
}

async function logsOf(tx: Tx, orderId: string) {
  return tx.onlineOrderLog.findMany({
    where: { orderId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      kind: true,
      reasonCode: true,
      note: true,
      actorKind: true,
      actorUserId: true,
      occurredAt: true,
    },
  });
}

async function namesOf(tx: Tx, userIds: readonly (string | null)[]) {
  const ids = unique(userIds.filter((id): id is string => id !== null));
  if (ids.length === 0) return new Map<string, string>();
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((user) => [user.id, user.fullName]));
}

export async function onlineStaffOrder(
  context: AdminContext,
  orderId: string,
): Promise<OnlineStaffOrderResponse> {
  const { tx } = context;
  const row = await tx.productOrder.findUnique({ where: { id: orderId }, select: orderSelect });
  if (!row || row.channel !== 'ONLINE' || !row.onlineDetail) throw new AuthError('NOT_FOUND');
  const { work, refund } = requireSee(context, row.branchId);
  const logs = await logsOf(tx, row.id);
  const names = await namesOf(tx, [
    ...logs.map((log) => log.actorUserId),
    row.shipment?.shippedByUserId ?? null,
    ...(row.shipment?.corrections.map((fix) => fix.actorUserId) ?? []),
  ]);
  const deliveryFailed = deliveryFailedBy(logs.map((log) => log.kind));
  const returnStarted = logs.some((log) => log.kind === 'RETURN_STARTED');
  const returnedToShop = logs.some((log) => log.kind === 'RETURNED_TO_SHOP');
  const today = await branchToday(tx, row.branchId);
  const allocations = await tx.invoiceLineAllocation.findMany({
    where: { invoiceLineId: { in: row.lines.map((line) => line.invoiceLineId) } },
    select: { invoiceLineId: true, netVnd: true },
  });
  const net = new Map(allocations.map((entry) => [entry.invoiceLineId, entry.netVnd]));
  const paid = row.invoice.status === 'PAID';
  const lines: OnlineStaffLine[] = row.lines.map((line) => {
    const mode = line.productLine.fulfilmentMode;
    const expectedTo = line.expectedTo ? line.expectedTo.toISOString().slice(0, 10) : null;
    return {
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
      mode,
      status: line.status,
      expectedFrom: line.expectedFrom ? line.expectedFrom.toISOString().slice(0, 10) : null,
      expectedTo,
      cancelCause: line.cancelCause,
      refundedVnd: refund && line.refund ? line.refund.amountVnd.toString() : null,
      rowVersion: line.rowVersion,
      sku: line.productLine.sku,
      ready:
        (mode === 'IN_STOCK' && line.status === 'PAID') ||
        (mode === 'PRE_ORDER' && line.status === 'ARRIVED'),
      cancelCauses:
        refund && paid ? cancelCausesOnline({ status: line.status, mode, expectedTo }, today) : [],
      refundShareVnd: (net.get(line.invoiceLineId) ?? 0n).toString(),
    };
  });
  const live = lines.filter((line) => line.status !== 'CANCELLED');
  const shippedLines = live.filter((line) => line.status === 'SHIPPED');
  const allReady = live.length > 0 && live.every((line) => line.ready);
  const delivered = row.lines.find((line) => line.deliveredAt !== null);
  const shipment = row.shipment;
  const eff = shipment ? effectiveShipment(shipment) : null;
  const address = effectiveAddress(row);
  const state = onlineOrderState({
    invoiceStatus: row.invoice.status,
    lines: lines.map((line) => ({ status: line.status, mode: line.mode })),
    deliveryFailed,
  });
  const settlement = await settlementOf(tx, row.id, refund);
  return {
    id: row.id,
    code: row.code,
    invoiceId: row.invoiceId,
    invoiceCode: row.invoice.code,
    branchId: row.branchId,
    state,
    placedAt: row.createdAt.toISOString(),
    paidAt: row.invoice.paidAt ? row.invoice.paidAt.toISOString() : null,
    deadlineAt:
      row.invoice.status === 'PENDING_PAYMENT' ? row.onlineDetail.deadlineAt.toISOString() : null,
    subtotalVnd: row.invoice.subtotalVnd.toString(),
    discountVnd: row.invoice.discountTotalVnd.toString(),
    shippingFeeVnd: row.invoice.shippingFeeVnd.toString(),
    totalVnd: row.invoice.totalVnd.toString(),
    recipient: {
      name: address.name,
      phone: address.phone,
      provinceCode: address.provinceCode,
      provinceName: address.provinceName,
      ward: address.ward,
      street: address.street,
      corrected: address.corrected,
    },
    customer: row.customer ? { id: row.customer.id, displayName: row.customer.fullName } : null,
    lines,
    hasPreOrder: lines.some((line) => line.mode === 'PRE_ORDER'),
    shipment:
      shipment && eff
        ? {
            id: shipment.id,
            carrierId: shipment.carrierId,
            carrierName: shipment.carrierName,
            trackingCode: eff.trackingCode,
            trackingUrl: trackingUrl(shipment.carrier.trackingUrlTemplate, eff.trackingCode),
            shippedAt: shipment.shippedAt.toISOString(),
            shippedByName: names.get(shipment.shippedByUserId) ?? '',
            carrierFeeOutVnd: refund ? eff.carrierFeeOutVnd.toString() : null,
            corrections: shipment.corrections.map((fix) => ({
              trackingCode: fix.trackingCode,
              carrierFeeOutVnd: refund ? fix.carrierFeeOutVnd.toString() : null,
              reason: fix.reason,
              actorName: names.get(fix.actorUserId) ?? '',
              occurredAt: fix.occurredAt.toISOString(),
            })),
          }
        : null,
    deliveredAt: delivered?.deliveredAt ? delivered.deliveredAt.toISOString() : null,
    deliveredBy:
      delivered?.deliveredByKind === 'STAFF' || delivered?.deliveredByKind === 'CUSTOMER'
        ? delivered.deliveredByKind
        : null,
    logs: logs.map((log) => ({
      id: log.id,
      kind: log.kind as OnlineLogKind,
      reasonCode: log.reasonCode as OnlineFailReason | null,
      note: log.note,
      actorKind: log.actorKind as 'STAFF' | 'CUSTOMER' | 'SYSTEM',
      actorName: log.actorUserId ? (names.get(log.actorUserId) ?? null) : null,
      occurredAt: log.occurredAt.toISOString(),
    })),
    payment:
      row.invoice.payments.length === 0
        ? null
        : {
            paymentId: row.invoice.payments[0]!.id,
            status: row.invoice.payments[0]!.status,
            amountVnd: row.invoice.payments[0]!.amountVnd.toString(),
            checkoutUrl: null,
            qrCode: null,
            expiresAt: row.invoice.payments[0]!.expiresAt
              ? row.invoice.payments[0]!.expiresAt!.toISOString()
              : null,
          },
    settlement,
    deliveryFailed,
    returnStarted,
    returnedToShop,
    policyVersion: row.onlineDetail.policyVersion,
    returns: await returnsOf(tx, row.invoiceId, refund),
    carriers:
      work && paid && shippedLines.length === 0 && allReady
        ? await tx.shippingCarrier.findMany({
            where: { isActive: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true },
          })
        : [],
    can: {
      ship: work && paid && shippedLines.length === 0 && allReady,
      markDelivered: work && shippedLines.length > 0 && !returnedToShop,
      log: work && paid,
      correctShipment: work && shipment !== null,
      correctAddress: work && paid && live.some((line) => line.status !== 'COMPLETED'),
      markReturned: work && shippedLines.length > 0 && returnStarted && !returnedToShop,
      refund: refund && paid,
      settleFailedDelivery:
        refund && shippedLines.length > 0 && returnedToShop && settlement === null,
      recordReturnCost: refund && paid,
    },
  };
}

async function returnsOf(
  tx: Tx,
  invoiceId: string,
  refund: boolean,
): Promise<OnlineStaffOrderResponse['returns']> {
  const cases = await tx.productReturnCase.findMany({
    where: { invoiceId },
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, status: true, reason: true, quantity: true },
  });
  if (cases.length === 0) return [];
  const costs = refund
    ? await tx.onlineReturnCost.groupBy({
        by: ['caseId'],
        where: { caseId: { in: cases.map((entry) => entry.id) } },
        _sum: { costVnd: true },
      })
    : [];
  const sum = new Map(costs.map((entry) => [entry.caseId, entry._sum.costVnd ?? 0n]));
  return cases.map((entry) => ({
    id: entry.id,
    code: entry.code,
    status: entry.status,
    reason: entry.reason,
    quantity: entry.quantity,
    returnCostVnd: refund ? (sum.get(entry.id) ?? 0n).toString() : null,
  }));
}

/** The settlement of a failed delivery (P6-21), for the people who may refund; null until one exists. */
async function settlementOf(
  tx: Tx,
  orderId: string,
  refund: boolean,
): Promise<OnlineStaffOrderResponse['settlement']> {
  if (!refund) return null;
  const row = await tx.onlineFailedDeliverySettlement.findUnique({ where: { orderId } });
  if (!row) return null;
  const actor = await tx.user.findUnique({
    where: { id: row.actorUserId },
    select: { fullName: true },
  });
  return {
    goodsPaidVnd: row.goodsPaidVnd.toString(),
    carrierFeeOutVnd: row.carrierFeeOutVnd.toString(),
    carrierFeeBackVnd: row.carrierFeeBackVnd.toString(),
    refundVnd: row.refundVnd.toString(),
    reason: row.reason,
    settledByName: actor?.fullName ?? '',
    settledAt: row.occurredAt.toISOString(),
    returnedToStock: row.restock,
  };
}

// ----------------------------------------------------------------------------------------------- queue

const QUEUE_FILTER: Record<OnlineQueueTab, string> = {
  TO_SHIP: 'TO_SHIP',
  WAITING_GOODS: 'WAITING_GOODS',
  SHIPPED: 'SHIPPED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
};

export async function listOnlineQueue(
  context: AdminContext,
  query: { branchId: string; tab?: unknown; q?: unknown; page?: unknown },
): Promise<OnlineQueueResponse> {
  const { tx } = context;
  const branch = await tx.branch.findUnique({
    where: { id: query.branchId },
    select: { id: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  requireSee(context, query.branchId);
  const tab = query.tab === undefined ? 'TO_SHIP' : query.tab;
  if (typeof tab !== 'string' || !(ONLINE_QUEUE_TABS as readonly string[]).includes(tab)) {
    throw new AuthError('VALIDATION_FAILED', 'tab');
  }
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
  if (query.q !== undefined && typeof query.q !== 'string')
    throw new AuthError('VALIDATION_FAILED', 'q');
  const page =
    query.page === undefined ? 1 : typeof query.page === 'number' ? query.page : Number.NaN;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
    throw new AuthError('VALIDATION_FAILED', 'page');
  }
  const digits = q.replace(/\D/g, '');
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const search = q === '' ? false : true;
  const counts = await tx.$queryRaw<{ queue_state: string; n: number }[]>`
    SELECT s.queue_state, count(*)::int AS n FROM online_order_states s
    WHERE s.branch_id = ${query.branchId}::uuid AND s.queue_state <> 'UNPAID'
    GROUP BY s.queue_state`;
  const countOf = (name: string) => counts.find((entry) => entry.queue_state === name)?.n ?? 0;
  const ids = await tx.$queryRaw<{ order_id: string; total: number }[]>`
    SELECT s.order_id, count(*) OVER ()::int AS total
    FROM online_order_states s
      JOIN online_order_details d ON d.order_id = s.order_id
      JOIN product_orders p ON p.id = s.order_id
    WHERE s.branch_id = ${query.branchId}::uuid AND s.queue_state = ${QUEUE_FILTER[tab as OnlineQueueTab]}
      AND (${search}::boolean = false
           OR s.code ILIKE ${like}
           OR d.recipient_name ILIKE ${like}
           OR (${digits.length >= 3}::boolean AND d.recipient_phone LIKE ${`%${digits}%`}))
    ORDER BY CASE WHEN s.queue_state IN ('DONE', 'CANCELLED') THEN NULL ELSE s.ready_at END ASC NULLS LAST,
             p.created_at DESC, s.order_id ASC
    LIMIT ${ONLINE_QUEUE_PAGE_SIZE} OFFSET ${(page - 1) * ONLINE_QUEUE_PAGE_SIZE}`;
  const rows = ids.length
    ? await tx.productOrder.findMany({
        where: { id: { in: ids.map((entry) => entry.order_id) } },
        select: orderSelect,
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const settings = await readOnlineSettings(tx);
  const today = await branchToday(tx, query.branchId);
  const stateRows = ids.length
    ? await tx.$queryRaw<
        { order_id: string; queue_state: string; ready_at: Date | null; shipped_at: Date | null }[]
      >`
      SELECT order_id, queue_state, ready_at, shipped_at FROM online_order_states
      WHERE order_id = ANY(${ids.map((entry) => entry.order_id)}::uuid[])`
    : [];
  const stateOf = new Map(stateRows.map((entry) => [entry.order_id, entry]));
  const presented: OnlineQueueRow[] = [];
  for (const { order_id: id } of ids) {
    const row = byId.get(id);
    const meta = stateOf.get(id);
    if (!row || !meta) continue;
    const address = effectiveAddress(row);
    const live = row.lines.filter((line) => line.status !== 'CANCELLED');
    const readyAt = meta.ready_at;
    const late =
      meta.queue_state === 'TO_SHIP' && readyAt !== null
        ? workingDaysBetween(readyAt, today) > settings.shipWithinWorkingDays
        : false;
    const shippedAt = meta.shipped_at;
    presented.push({
      orderId: row.id,
      code: row.code,
      invoiceCode: row.invoice.code,
      state: stateToOrderState(meta.queue_state),
      placedAt: row.createdAt.toISOString(),
      paidAt: row.invoice.paidAt ? row.invoice.paidAt.toISOString() : null,
      recipientName: address.name,
      recipientPhoneMasked: maskPhone(address.phone) ?? '•••',
      provinceName: address.provinceName,
      lineCount: row.lines.length,
      quantity: live.reduce((sum, line) => sum + line.quantity, 0),
      totalVnd: row.invoice.totalVnd.toString(),
      hasPreOrder: row.lines.some((line) => line.productLine.fulfilmentMode === 'PRE_ORDER'),
      readyAt: readyAt ? readyAt.toISOString() : null,
      shippedAt: shippedAt ? shippedAt.toISOString() : null,
      carrierName: row.shipment?.carrierName ?? null,
      trackingCode: row.shipment ? effectiveShipment(row.shipment).trackingCode : null,
      late,
      overdueDelivery:
        meta.queue_state === 'SHIPPED' &&
        shippedAt !== null &&
        context.now.getTime() - shippedAt.getTime() > 7 * 86_400_000,
    });
  }
  return {
    tab: tab as OnlineQueueTab,
    rows: presented,
    total: ids[0]?.total ?? 0,
    page,
    pageSize: ONLINE_QUEUE_PAGE_SIZE,
    counts: Object.fromEntries(
      ONLINE_QUEUE_TABS.map((name) => [name, countOf(QUEUE_FILTER[name])]),
    ) as Record<OnlineQueueTab, number>,
  };
}

/** Monday to Friday between a time (its UTC day is close enough for a count of days) and a branch-local day, the start day excluded. */
export function workingDaysBetween(from: Date, today: string): number {
  const start = new Date(from.getTime());
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(`${today}T00:00:00.000Z`);
  let count = 0;
  for (
    let cursor = new Date(start.getTime() + 86_400_000);
    cursor <= end;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

// ----------------------------------------------------------------------------------------- the commands

interface Locked {
  order: {
    id: string;
    code: string;
    branchId: string;
    invoiceId: string;
    customerUserId: string | null;
  };
  invoice: { status: string; paidSeq: number; code: string };
  lines: {
    id: string;
    status: string;
    rowVersion: number;
    shippedAt: Date | null;
    quantity: number;
    invoiceLineId: string;
    mode: 'IN_STOCK' | 'PRE_ORDER';
  }[];
}

/** The invoice (share or update) and then the order lines (update, id order) of an ONLINE order. */
export async function lockOrder(
  tx: Tx,
  orderId: string,
  invoiceMode: 'SHARE' | 'UPDATE' = 'SHARE',
): Promise<Locked> {
  const hint = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { invoiceId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  if (invoiceMode === 'UPDATE') {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${hint.invoiceId}::uuid FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${hint.invoiceId}::uuid FOR SHARE`;
  }
  await tx.$queryRaw`SELECT id FROM product_order_lines WHERE order_id = ${orderId}::uuid ORDER BY id FOR UPDATE`;
  const order = await tx.productOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, code: true, branchId: true, invoiceId: true, customerUserId: true },
  });
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: order.invoiceId },
    select: { status: true, paidSeq: true, code: true },
  });
  const lines = await tx.productOrderLine.findMany({
    where: { orderId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      status: true,
      rowVersion: true,
      shippedAt: true,
      quantity: true,
      invoiceLineId: true,
      productLine: { select: { fulfilmentMode: true } },
    },
  });
  return {
    order,
    invoice,
    lines: lines.map((line) => ({
      id: line.id,
      status: line.status,
      rowVersion: line.rowVersion,
      shippedAt: line.shippedAt,
      quantity: line.quantity,
      invoiceLineId: line.invoiceLineId,
      mode: line.productLine.fulfilmentMode,
    })),
  };
}

async function writeLog(
  tx: Tx,
  orderId: string,
  entry: {
    kind: OnlineLogKind;
    reasonCode?: OnlineFailReason | null;
    note?: string | null;
    actor: { kind: 'STAFF' | 'CUSTOMER'; userId: string } | { kind: 'SYSTEM' };
  },
) {
  await tx.onlineOrderLog.create({
    data: {
      orderId,
      kind: entry.kind,
      reasonCode: entry.reasonCode ?? null,
      note: entry.note ?? null,
      actorKind: entry.actor.kind,
      actorUserId: entry.actor.kind === 'SYSTEM' ? null : entry.actor.userId,
    },
    select: { id: true },
  });
}

const SHIP_KEYS = ['lines', 'carrierId', 'trackingCode', 'carrierFeeVnd'] as const;

/** Ships the parcel: see the module comment. */
export async function shipOrder(
  context: AdminContext,
  orderId: string,
  request: OnlineShipRequest,
): Promise<OnlineStaffOrderResponse> {
  const body = input.record(request, 'body', SHIP_KEYS);
  const wanted = new Map<string, number>();
  for (const [index, entry] of input.list(body['lines'], 'lines', 200).entries()) {
    const line = input.record(entry, `lines.${index}`, ['id', 'rowVersion']);
    const id = input.uuid(line['id'], `lines.${index}.id`);
    if (wanted.has(id)) throw new AuthError('VALIDATION_FAILED', 'lines');
    wanted.set(id, input.rowVersion(line['rowVersion']));
  }
  if (wanted.size === 0) throw new AuthError('VALIDATION_FAILED', 'lines');
  const carrierId = input.uuid(body['carrierId'], 'carrierId');
  const trackingCode = trackingCodeOf(body['trackingCode']);
  const fee = money(body['carrierFeeVnd'], 'carrierFeeVnd');
  const { tx } = context;
  const hint = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { branchId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  requireWork(context, hint.branchId);
  const locked = await lockOrder(tx, orderId);
  if (locked.invoice.status !== 'PAID') throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  const live = locked.lines.filter((line) => line.status !== 'CANCELLED');
  if (live.some((line) => line.status === 'SHIPPED' || line.status === 'COMPLETED')) {
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  }
  if (live.length !== wanted.size || live.some((line) => wanted.get(line.id) !== line.rowVersion)) {
    throw new AuthError('CONFLICT');
  }
  const waiting = live.filter(
    (line) =>
      !(
        (line.mode === 'IN_STOCK' && line.status === 'PAID') ||
        (line.mode === 'PRE_ORDER' && line.status === 'ARRIVED')
      ),
  );
  if (waiting.length > 0) {
    throw new AuthError('ONLINE_ORDER_NOT_READY', waiting.map((line) => line.id).join(','));
  }
  const carrier = await tx.shippingCarrier.findUnique({
    where: { id: carrierId },
    select: { id: true, name: true, isActive: true },
  });
  if (!carrier || !carrier.isActive) throw new AuthError('VALIDATION_FAILED', 'carrierId');
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  const shippedAt = clock!.now;
  await tx.onlineShipment.create({
    data: {
      orderId,
      carrierId: carrier.id,
      carrierName: carrier.name,
      trackingCode,
      carrierFeeOutVnd: fee,
      shippedAt,
      shippedByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  for (const line of live) {
    await tx.productOrderLine.update({
      where: { id: line.id },
      data: { status: 'SHIPPED', shippedByUserId: context.actor.userId },
      select: { id: true },
    });
  }
  await appendOutboxEvent(tx, {
    branchId: locked.order.branchId,
    aggregateType: 'Invoice',
    aggregateId: locked.order.invoiceId,
    eventType: ORDER_SHIPPED_EVENT,
    schemaVersion: 1,
    payload: { invoiceId: locked.order.invoiceId, paidSeq: locked.invoice.paidSeq },
  });
  await appendAdminAudit(context, {
    action: 'ONLINE_ORDER_SHIPPED',
    entityType: 'ProductOrder',
    entityId: orderId,
    subjectUserId: locked.order.customerUserId,
    branchId: locked.order.branchId,
    classification: 'FINANCIAL',
    after: {
      orderCode: locked.order.code,
      carrier: carrier.name,
      trackingCode,
      carrierFeeOutVnd: fee.toString(),
      lineIds: live.map((line) => line.id),
    },
  });
  if (locked.order.customerUserId) {
    await tellMember(tx, {
      type: 'ONLINE_ORDER_SHIPPED',
      userId: locked.order.customerUserId,
      branchId: locked.order.branchId,
      invoiceId: locked.order.invoiceId,
      orderCode: locked.order.code,
      eventKey: `shipped:${orderId}`,
    });
  }
  return onlineStaffOrder(context, orderId);
}

/** A mistyped tracking code or cost is corrected by a new record with a reason; the cost needs the permission to refund. */
export async function correctShipment(
  context: AdminContext,
  orderId: string,
  request: OnlineShipmentCorrectRequest,
): Promise<OnlineStaffOrderResponse> {
  const body = input.record(request, 'body', ['trackingCode', 'carrierFeeVnd', 'reason']);
  const reason = parse.requiredNote(body['reason'], 'reason', NOTE_MAX);
  const { tx } = context;
  const hint = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { branchId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  requireWork(context, hint.branchId);
  const locked = await lockOrder(tx, orderId);
  const shipment = await tx.onlineShipment.findUnique({
    where: { orderId },
    select: {
      id: true,
      trackingCode: true,
      carrierFeeOutVnd: true,
      corrections: { orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 1 },
    },
  });
  if (!shipment) throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  const current = shipment.corrections[0] ?? shipment;
  const code =
    body['trackingCode'] === undefined
      ? current.trackingCode
      : trackingCodeOf(body['trackingCode']);
  const fee =
    body['carrierFeeVnd'] === undefined
      ? current.carrierFeeOutVnd
      : money(body['carrierFeeVnd'], 'carrierFeeVnd');
  if (fee !== current.carrierFeeOutVnd) requireRefundOnline(context, hint.branchId);
  if (code === current.trackingCode && fee === current.carrierFeeOutVnd) {
    throw new AuthError('VALIDATION_FAILED', 'trackingCode');
  }
  await tx.onlineShipmentCorrection.create({
    data: {
      shipmentId: shipment.id,
      trackingCode: code,
      carrierFeeOutVnd: fee,
      reason,
      actorUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'ONLINE_SHIPMENT_CORRECTED',
    entityType: 'ProductOrder',
    entityId: orderId,
    branchId: locked.order.branchId,
    classification: 'FINANCIAL',
    reason,
    before: {
      trackingCode: current.trackingCode,
      carrierFeeOutVnd: current.carrierFeeOutVnd.toString(),
    },
    after: { trackingCode: code, carrierFeeOutVnd: fee.toString() },
  });
  return onlineStaffOrder(context, orderId);
}

export function requireRefundOnline(context: AdminContext, branchId: string): void {
  if (!canRefundOnline(context, branchId)) throw new AuthError('FORBIDDEN');
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Staff marks the parcel delivered (OQ-96), on the day the carrier delivered (the branch's day, not in the future; absent = now). The
 * lines become COMPLETED; the window of a return counts from this time. A repeat finds the lines delivered and answers with the order.
 */
export async function markDelivered(
  context: AdminContext,
  orderId: string,
  request: OnlineDeliveredRequest,
): Promise<OnlineStaffOrderResponse> {
  const body = input.record(request, 'body', ['deliveredOn']);
  const deliveredOn =
    body['deliveredOn'] === undefined || body['deliveredOn'] === null
      ? null
      : input.date(body['deliveredOn'], 'deliveredOn');
  const { tx } = context;
  const hint = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { branchId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  requireWork(context, hint.branchId);
  const locked = await lockOrder(tx, orderId);
  const live = locked.lines.filter((line) => line.status !== 'CANCELLED');
  if (live.length > 0 && live.every((line) => line.status === 'COMPLETED')) {
    return onlineStaffOrder(context, orderId);
  }
  const shipped = live.filter((line) => line.status === 'SHIPPED');
  if (locked.invoice.status !== 'PAID' || shipped.length === 0 || shipped.length !== live.length) {
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  }
  const logs = await logsOf(tx, orderId);
  if (logs.some((log) => log.kind === 'RETURNED_TO_SHOP'))
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  const at = await deliveryTime(tx, locked.order.branchId, deliveredOn, shipped[0]!.shippedAt!);
  await deliver(tx, locked, shipped, at, { kind: 'STAFF', userId: context.actor.userId });
  await appendAdminAudit(context, {
    action: 'ONLINE_ORDER_DELIVERED',
    entityType: 'ProductOrder',
    entityId: orderId,
    subjectUserId: locked.order.customerUserId,
    branchId: locked.order.branchId,
    classification: 'STANDARD',
    after: { orderCode: locked.order.code, deliveredAt: at.toISOString(), by: 'STAFF' },
  });
  return onlineStaffOrder(context, orderId);
}

/** The delivery time: now, or the given branch-local day at noon (never in the future and never before the shipping). */
async function deliveryTime(
  tx: Tx,
  branchId: string,
  deliveredOn: string | null,
  shippedAt: Date,
): Promise<Date> {
  const [row] = await tx.$queryRaw<{ at: Date }[]>`
    SELECT GREATEST(${shippedAt}::timestamptz,
      CASE WHEN ${deliveredOn}::text IS NULL THEN clock_timestamp()
           ELSE LEAST(clock_timestamp(),
             ((${deliveredOn}::date + time '12:00') AT TIME ZONE (SELECT timezone FROM branches WHERE id = ${branchId}::uuid))) END
    )::timestamptz(3) AS at`;
  if (!row) throw new AuthError('SERVICE_UNAVAILABLE');
  if (deliveredOn !== null && !DAY.test(deliveredOn))
    throw new AuthError('VALIDATION_FAILED', 'deliveredOn');
  const today = await branchToday(tx, branchId);
  if (deliveredOn !== null && deliveredOn > today)
    throw new AuthError('VALIDATION_FAILED', 'deliveredOn');
  return row.at;
}

async function deliver(
  tx: Tx,
  locked: Locked,
  shipped: readonly { id: string }[],
  at: Date,
  by: { kind: 'STAFF' | 'CUSTOMER'; userId: string },
): Promise<void> {
  for (const line of shipped) {
    await tx.productOrderLine.update({
      where: { id: line.id },
      data: {
        status: 'COMPLETED',
        deliveredAt: at,
        deliveredByUserId: by.userId,
        deliveredByKind: by.kind,
      },
      select: { id: true },
    });
  }
  await writeLog(tx, locked.order.id, { kind: 'DELIVERED', actor: by });
  if (locked.order.customerUserId) {
    await tellMember(tx, {
      type: 'ONLINE_ORDER_DELIVERED',
      userId: locked.order.customerUserId,
      branchId: locked.order.branchId,
      invoiceId: locked.order.invoiceId,
      orderCode: locked.order.code,
      eventKey: `delivered:${locked.order.id}`,
    });
  }
}

/** The member presses "Tôi đã nhận hàng" (OQ-96): whoever marks the delivery first counts. */
export async function confirmReceived(context: CustomerContext, orderId: string): Promise<void> {
  const { tx, customerUserId } = context;
  const order = await tx.productOrder.findFirst({
    where: { id: orderId, customerUserId, channel: 'ONLINE' },
    select: { id: true },
  });
  if (!order) throw new AuthError('NOT_FOUND');
  const locked = await lockOrder(tx, orderId);
  const live = locked.lines.filter((line) => line.status !== 'CANCELLED');
  if (live.length > 0 && live.every((line) => line.status === 'COMPLETED')) return;
  const shipped = live.filter((line) => line.status === 'SHIPPED');
  if (locked.invoice.status !== 'PAID' || shipped.length === 0 || shipped.length !== live.length) {
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  }
  const logs = await logsOf(tx, orderId);
  if (logs.some((log) => log.kind === 'RETURNED_TO_SHOP'))
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  const at = await deliveryTime(tx, locked.order.branchId, null, shipped[0]!.shippedAt!);
  await deliver(tx, locked, shipped, at, { kind: 'CUSTOMER', userId: customerUserId });
  await tx.auditEvent.create({
    data: {
      action: 'ONLINE_ORDER_DELIVERED',
      actorKind: 'USER',
      actorUserId: customerUserId,
      subjectUserId: customerUserId,
      entityType: 'ProductOrder',
      entityId: orderId,
      branchId: locked.order.branchId,
      requestId: context.requestId,
      occurredAt: at,
      after: { orderCode: locked.order.code, deliveredAt: at.toISOString(), by: 'CUSTOMER' },
      dataClassification: 'STANDARD',
    },
    select: { id: true },
  });
}

const LOG_KINDS = ['DELIVERY_FAILED', 'CONTACTED', 'REDELIVERY', 'RETURN_STARTED', 'NOTE'] as const;

/** A line of the delivery's history by staff: a failed attempt, a contact, a new attempt, the customer no longer wanting the parcel. */
export async function addLog(
  context: AdminContext,
  orderId: string,
  request: OnlineLogRequest,
): Promise<OnlineStaffOrderResponse> {
  const body = input.record(request, 'body', ['kind', 'reasonCode', 'note']);
  const kind = body['kind'];
  if (typeof kind !== 'string' || !(LOG_KINDS as readonly string[]).includes(kind)) {
    throw new AuthError('VALIDATION_FAILED', 'kind');
  }
  const note = parse.optionalNote(body['note'], 'note', NOTE_MAX);
  let reasonCode: OnlineFailReason | null = null;
  if (kind === 'DELIVERY_FAILED') {
    const raw = body['reasonCode'];
    if (typeof raw !== 'string' || !(ONLINE_FAIL_REASONS as readonly string[]).includes(raw)) {
      throw new AuthError('VALIDATION_FAILED', 'reasonCode');
    }
    reasonCode = raw as OnlineFailReason;
  } else if (body['reasonCode'] !== undefined && body['reasonCode'] !== null) {
    throw new AuthError('VALIDATION_FAILED', 'reasonCode');
  }
  if (kind !== 'REDELIVERY' && note === null) throw new AuthError('VALIDATION_FAILED', 'note');
  const { tx } = context;
  const hint = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { branchId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  requireWork(context, hint.branchId);
  const locked = await lockOrder(tx, orderId);
  if (locked.invoice.status !== 'PAID') throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  const logs = await logsOf(tx, orderId);
  const shipped = locked.lines.some((line) => line.status === 'SHIPPED');
  const needsParcel =
    kind === 'DELIVERY_FAILED' || kind === 'REDELIVERY' || kind === 'RETURN_STARTED';
  if (needsParcel && !shipped) throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  if (logs.some((log) => log.kind === 'RETURNED_TO_SHOP'))
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  await writeLog(tx, orderId, {
    kind: kind as OnlineLogKind,
    reasonCode,
    note,
    actor: { kind: 'STAFF', userId: context.actor.userId },
  });
  // The note is what staff said to the customer or what the carrier answered: it stays in the log, never in the audit trail or a notice.
  await appendAdminAudit(context, {
    action: 'ONLINE_ORDER_LOGGED',
    entityType: 'ProductOrder',
    entityId: orderId,
    subjectUserId: locked.order.customerUserId,
    branchId: locked.order.branchId,
    classification: 'STANDARD',
    after: { orderCode: locked.order.code, kind, reasonCode },
  });
  if (kind === 'DELIVERY_FAILED' && locked.order.customerUserId) {
    await tellMember(tx, {
      type: 'ONLINE_ORDER_DELIVERY_FAILED',
      userId: locked.order.customerUserId,
      branchId: locked.order.branchId,
      invoiceId: locked.order.invoiceId,
      orderCode: locked.order.code,
      eventKey: `failed:${orderId}:${logs.filter((log) => log.kind === 'DELIVERY_FAILED').length + 1}`,
    });
  }
  return onlineStaffOrder(context, orderId);
}

/** The parcel is back at the shop (OQ-98 step 2): only now may the failed delivery be settled. The customer said they no longer want it first. */
export async function markReturnedToShop(
  context: AdminContext,
  orderId: string,
  request: OnlineReturnedRequest,
): Promise<OnlineStaffOrderResponse> {
  const body = input.record(request, 'body', ['note']);
  const note = parse.requiredNote(body['note'], 'note', NOTE_MAX);
  const { tx } = context;
  const hint = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { branchId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  requireWork(context, hint.branchId);
  const locked = await lockOrder(tx, orderId);
  const logs = await logsOf(tx, orderId);
  const shipped = locked.lines.some((line) => line.status === 'SHIPPED');
  if (
    locked.invoice.status !== 'PAID' ||
    !shipped ||
    !logs.some((log) => log.kind === 'RETURN_STARTED') ||
    logs.some((log) => log.kind === 'RETURNED_TO_SHOP')
  ) {
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  }
  await writeLog(tx, orderId, {
    kind: 'RETURNED_TO_SHOP',
    note,
    actor: { kind: 'STAFF', userId: context.actor.userId },
  });
  await appendAdminAudit(context, {
    action: 'ONLINE_ORDER_RETURNED_TO_SHOP',
    entityType: 'ProductOrder',
    entityId: orderId,
    subjectUserId: locked.order.customerUserId,
    branchId: locked.order.branchId,
    classification: 'STANDARD',
    after: { orderCode: locked.order.code },
  });
  return onlineStaffOrder(context, orderId);
}

/** A wrong address found by the carrier is corrected by a new record (the customer typed the first one; it stays in the history). */
export async function correctAddress(
  context: AdminContext,
  orderId: string,
  request: OnlineAddressCorrectRequest,
): Promise<OnlineStaffOrderResponse> {
  const body = input.record(request, 'body', [
    'recipientName',
    'recipientPhone',
    'provinceCode',
    'ward',
    'street',
    'reason',
  ]);
  const reason = parse.requiredNote(body['reason'], 'reason', NOTE_MAX);
  const address = parseAddress(
    {
      recipientName: body['recipientName'] as string,
      recipientPhone: body['recipientPhone'] as string,
      provinceCode: body['provinceCode'] as string,
      ward: body['ward'] as string,
      street: body['street'] as string,
    },
    'address',
  );
  const { tx } = context;
  const hint = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { branchId: true, channel: true },
  });
  if (!hint || hint.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  requireWork(context, hint.branchId);
  const locked = await lockOrder(tx, orderId);
  const live = locked.lines.filter((line) => line.status !== 'CANCELLED');
  if (
    locked.invoice.status !== 'PAID' ||
    live.length === 0 ||
    live.every((line) => line.status === 'COMPLETED')
  ) {
    throw new AuthError('ONLINE_ORDER_STATE_INVALID');
  }
  await tx.onlineAddressCorrection.create({
    data: {
      orderId,
      recipientName: address.recipientName,
      recipientPhone: address.recipientPhone,
      provinceCode: address.provinceCode,
      provinceName: provinceByCode(address.provinceCode)!.nameVi,
      ward: address.ward,
      street: address.street,
      reason,
      actorUserId: context.actor.userId,
    },
    select: { id: true },
  });
  // The audit trail says THAT the address changed, never what it is (personal data).
  await appendAdminAudit(context, {
    action: 'ONLINE_ADDRESS_CORRECTED',
    entityType: 'ProductOrder',
    entityId: orderId,
    subjectUserId: locked.order.customerUserId,
    branchId: locked.order.branchId,
    classification: 'STANDARD',
    reason,
    after: { orderCode: locked.order.code },
  });
  return onlineStaffOrder(context, orderId);
}
