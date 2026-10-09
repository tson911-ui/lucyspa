import {
  PRODUCT_ORDER_QUEUE_PAGE_SIZE,
  productOrderStatus,
  type ProductOrderCancelCauseName,
  type ProductOrderContextResponse,
  type ProductOrderDetailLine,
  type ProductOrderDetailResponse,
  type ProductOrderLineStatusName,
  type ProductOrderQueueRow,
  type ProductOrderQueueResponse,
  type ProductOrderQueueTab,
  type ProductOrderToOrderResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { maskPhone } from '../operations/operations.state.js';
import {
  canLinkTicketAt,
  canManageOrdersAt,
  canViewOrderAt,
  holdsAt,
  requireManageOrders,
} from './order.access.js';
import { presentProductOrderLine, productOrderSelect, ticketExpiry } from './order.core.js';

/**
 * Phase 6 P6-17 (design 18.3, 18.4; T32, OQ-86, OQ-87): the screens of the people who work the orders. Reads only. A line is "late" when
 * its goods have not arrived and the branch-local date is past its expected range (OQ-86); "held too long" when its goods arrived more
 * than 7 days ago and nobody collected them (OQ-34: staff call, nothing is cancelled by itself).
 */
const DAY_MS = 86_400_000;
export const HELD_TOO_LONG_DAYS = 7;
/** A line may be cancelled for lateness only once this many days have passed after its expected date (OQ-32). */
export const LATE_CANCEL_DAYS = 7;

const isoDay = (value: Date) => value.toISOString().slice(0, 10);

/** Today's date at the branch, from the database clock, as `YYYY-MM-DD`. */
export async function branchToday(tx: Prisma.TransactionClient, branchId: string): Promise<string> {
  const [row] = await tx.$queryRaw<{ d: string }[]>`
    SELECT to_char(lucy_branch_local_date(${branchId}::uuid, clock_timestamp()), 'YYYY-MM-DD') AS d`;
  if (!row) throw new AuthError('NOT_FOUND');
  return row.d;
}

/** Whole days from one `YYYY-MM-DD` date to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export const isLate = (
  line: { status: string; expectedTo: string | null },
  today: string,
): boolean =>
  (line.status === 'PAID' || line.status === 'ORDERED') &&
  line.expectedTo !== null &&
  daysBetween(line.expectedTo, today) > 0;

export const isHeldTooLong = (line: { status: string; arrivedAt: Date | null }, now: Date) =>
  line.status === 'ARRIVED' &&
  line.arrivedAt !== null &&
  now.getTime() - line.arrivedAt.getTime() > HELD_TOO_LONG_DAYS * DAY_MS;

/** The causes a person may cancel a line with right now (the database enforces the same table, OQ-32). */
export function cancelCausesFor(
  line: { status: string; expectedTo: string | null },
  today: string,
): ProductOrderCancelCauseName[] {
  const lateEnough =
    line.expectedTo !== null && daysBetween(line.expectedTo, today) > LATE_CANCEL_DAYS;
  switch (line.status) {
    case 'PAID':
      return [
        'CUSTOMER_CANCELLED_BEFORE_ORDERING',
        'SUPPLIER_CANNOT_DELIVER',
        ...(lateEnough ? (['LATE_OVER_7_DAYS'] as const) : []),
      ];
    case 'ORDERED':
      return [
        'SUPPLIER_CANNOT_DELIVER',
        'CUSTOMER_CHANGED_MIND',
        ...(lateEnough ? (['LATE_OVER_7_DAYS'] as const) : []),
      ];
    case 'ARRIVED':
      return ['CUSTOMER_CHANGED_MIND'];
    default:
      return [];
  }
}

/** The branches the person may work the orders in (the queue) or refund in (cancel a line). */
export async function orderContext(context: AdminContext): Promise<ProductOrderContextResponse> {
  const branches = await context.tx.branch.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true },
  });
  const graph = context.actor.graph;
  return {
    branches: branches
      .map((branch) => ({
        ...branch,
        work: canManageOrdersAt(graph, branch.id),
        refund: holdsAt(graph, 'REFUND_PRODUCTS', branch.id),
      }))
      .filter((branch) => branch.work || branch.refund),
  };
}

// ------------------------------------------------------------------------------------------------- one order

export async function orderDetail(
  context: AdminContext,
  orderId: string,
): Promise<ProductOrderDetailResponse> {
  const { tx } = context;
  const row = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: {
      ...productOrderSelect,
      channel: true,
      invoice: { select: { code: true, status: true } },
    },
  });
  // An online order is worked on its own screen (P6-20): the counter screens never show it.
  if (!row || row.channel === 'ONLINE') throw new AuthError('NOT_FOUND');
  const graph = context.actor.graph;
  if (!canViewOrderAt(graph, row.branchId)) throw new AuthError('FORBIDDEN');
  const work = canManageOrdersAt(graph, row.branchId);
  const refund = holdsAt(graph, 'REFUND_PRODUCTS', row.branchId);
  const link = canLinkTicketAt(graph, row.branchId);
  const showContact = work || link || refund;
  const expiry = ticketExpiry(row, context.now);
  const today = await branchToday(tx, row.branchId);
  const allocations = await tx.invoiceLineAllocation.findMany({
    where: { invoiceLineId: { in: row.lines.map((line) => line.invoiceLineId) } },
    select: { invoiceLineId: true, netVnd: true },
  });
  const net = new Map(
    allocations.map((allocation) => [allocation.invoiceLineId, allocation.netVnd]),
  );
  const paid = row.invoice.status === 'PAID';
  // The money of a refund and its transfer reference are for those who may refund.
  const refunds = refund
    ? await tx.productRefund.findMany({
        where: { orderLineId: { in: row.lines.map((line) => line.id) } },
        select: {
          orderLineId: true,
          code: true,
          amountVnd: true,
          method: true,
          bankReference: true,
          occurredAt: true,
          corrections: {
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            select: { bankReference: true },
          },
        },
      })
    : [];
  const refundOf = new Map(refunds.map((entry) => [entry.orderLineId, entry]));
  const lines: ProductOrderDetailLine[] = row.lines.map((line) => {
    const base = presentProductOrderLine(line);
    const arrivedAt = line.arrivedAt;
    return {
      ...base,
      late: isLate(base, today),
      heldTooLong: isHeldTooLong({ status: line.status, arrivedAt }, context.now),
      actions: {
        markOrdered: work && line.status === 'PAID',
        handOver: work && line.status === 'ARRIVED',
        cancelCauses: refund && paid ? cancelCausesFor(base, today) : [],
        refundVnd: (net.get(line.invoiceLineId) ?? 0n).toString(),
        correctReference: refund && refundOf.get(line.id)?.method === 'BANK_TRANSFER_MANUAL',
      },
      refund: ((entry) =>
        entry
          ? {
              code: entry.code,
              amountVnd: entry.amountVnd.toString(),
              method: entry.method,
              bankReference: entry.corrections[0]?.bankReference ?? entry.bankReference,
              corrections: entry.corrections.length,
              refundedAt: entry.occurredAt.toISOString(),
            }
          : null)(refundOf.get(line.id)),
    };
  });
  return {
    id: row.id,
    code: row.code,
    invoiceId: row.invoiceId,
    invoiceCode: row.invoice.code,
    invoiceStatus: row.invoice.status as ProductOrderDetailResponse['invoiceStatus'],
    branchId: row.branchId,
    status: productOrderStatus(lines),
    contactPhone: showContact ? row.contactPhone : (maskPhone(row.contactPhone) ?? '•••'),
    contactMasked: !showContact,
    contactName: showContact ? row.contactName : null,
    customer: row.customer ? { id: row.customer.id, displayName: row.customer.fullName } : null,
    createdAt: row.createdAt.toISOString(),
    lines,
    ticketLinkActive: expiry.linkActive,
    ticketExpiresAt: expiry.expiresAt,
    can: { work, refund, ticketLink: link },
  };
}

// ------------------------------------------------------------------------------------------------- the queue

/**
 * Phase 6 Wave 4: the queue is about the goods of PRE-ORDER lines. The lines of an online order that are simply in stock are shipped
 * from the online orders screen; the lines of an online order that wait for the supplier ARE in the "cần đặt" and "đã đặt" lists
 * (the supplier does not care about the channel), but they are collected or shipped on the online screen, so the tabs of goods that
 * arrived and of finished work show the counter only.
 */
const preOrderOnly = (tab: ProductOrderQueueTab): Prisma.ProductOrderLineWhereInput => ({
  productLine: { fulfilmentMode: 'PRE_ORDER' },
  ...(tab === 'TO_ORDER' || tab === 'ORDERED' ? {} : { order: { channel: 'COUNTER' } }),
});

const TAB_STATUSES: Record<ProductOrderQueueTab, ProductOrderLineStatusName[]> = {
  TO_ORDER: ['PAID'],
  ORDERED: ['ORDERED'],
  ARRIVED: ['ARRIVED'],
  DONE: ['HANDED_OVER', 'COMPLETED'],
  CANCELLED: ['CANCELLED'],
};
export const QUEUE_TABS = Object.keys(TAB_STATUSES) as ProductOrderQueueTab[];

const queueSelect = {
  id: true,
  orderId: true,
  invoiceId: true,
  variantId: true,
  quantity: true,
  status: true,
  paidAt: true,
  expectedFrom: true,
  expectedTo: true,
  orderedAt: true,
  arrivedAt: true,
  rowVersion: true,
  order: {
    select: {
      code: true,
      channel: true,
      contactPhone: true,
      contactName: true,
      customer: { select: { fullName: true } },
      invoice: { select: { code: true } },
    },
  },
  line: { select: { nameVi: true, nameEn: true } },
  productLine: { select: { sku: true, variantLabelVi: true, variantLabelEn: true } },
  variant: { select: { usualSupplier: { select: { id: true, name: true } } } },
} satisfies Prisma.ProductOrderLineSelect;

type QueueRow = Prisma.ProductOrderLineGetPayload<{ select: typeof queueSelect }>;

function presentQueueRow(row: QueueRow, today: string, now: Date): ProductOrderQueueRow {
  const expectedFrom = row.expectedFrom ? isoDay(row.expectedFrom) : null;
  const expectedTo = row.expectedTo ? isoDay(row.expectedTo) : null;
  return {
    lineId: row.id,
    orderId: row.orderId,
    orderCode: row.order.code,
    channel: row.order.channel,
    invoiceId: row.invoiceId,
    invoiceCode: row.order.invoice.code,
    customerName: row.order.customer?.fullName ?? null,
    contactPhone: row.order.contactPhone,
    contactName: row.order.contactName,
    variantId: row.variantId,
    sku: row.productLine.sku,
    nameVi: row.line.nameVi,
    nameEn: row.line.nameEn,
    variantLabelVi: row.productLine.variantLabelVi,
    variantLabelEn: row.productLine.variantLabelEn,
    quantity: row.quantity,
    status: row.status,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    expectedFrom,
    expectedTo,
    orderedAt: row.orderedAt ? row.orderedAt.toISOString() : null,
    arrivedAt: row.arrivedAt ? row.arrivedAt.toISOString() : null,
    late: isLate({ status: row.status, expectedTo }, today),
    heldTooLong: isHeldTooLong(row, now),
    supplier: row.variant.usualSupplier,
    rowVersion: row.rowVersion,
  };
}

/** The lines of one branch by tab, oldest paid first; the search reads the order code, the invoice code, the phone and the product. */
export async function listQueue(
  context: AdminContext,
  query: { branchId: string; tab?: unknown; q?: unknown; page?: unknown },
): Promise<ProductOrderQueueResponse> {
  const { tx } = context;
  const branch = await tx.branch.findUnique({
    where: { id: query.branchId },
    select: { id: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  requireManageOrders(context, query.branchId);
  const tab = query.tab === undefined ? 'TO_ORDER' : query.tab;
  if (typeof tab !== 'string' || !(QUEUE_TABS as string[]).includes(tab)) {
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
  const search: Prisma.ProductOrderLineWhereInput =
    q === ''
      ? {}
      : {
          OR: [
            { order: { code: { contains: q, mode: 'insensitive' } } },
            { order: { invoice: { code: { contains: q, mode: 'insensitive' } } } },
            ...(digits.length >= 3 ? [{ order: { contactPhone: { contains: digits } } }] : []),
            { order: { contactName: { contains: q, mode: 'insensitive' } } },
            { productLine: { sku: { contains: q, mode: 'insensitive' } } },
            { line: { nameVi: { contains: q, mode: 'insensitive' } } },
          ],
        };
  const where: Prisma.ProductOrderLineWhereInput = {
    branchId: query.branchId,
    status: { in: TAB_STATUSES[tab as ProductOrderQueueTab] },
    ...preOrderOnly(tab as ProductOrderQueueTab),
    ...search,
  };
  const [total, rows, grouped, today] = await Promise.all([
    tx.productOrderLine.count({ where }),
    tx.productOrderLine.findMany({
      where,
      orderBy:
        tab === 'DONE' || tab === 'CANCELLED'
          ? [{ updatedAt: 'desc' }, { id: 'asc' }]
          : [{ paidAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * PRODUCT_ORDER_QUEUE_PAGE_SIZE,
      take: PRODUCT_ORDER_QUEUE_PAGE_SIZE,
      select: queueSelect,
    }),
    Promise.all(
      QUEUE_TABS.map((name) =>
        tx.productOrderLine.count({
          where: {
            branchId: query.branchId,
            status: { in: TAB_STATUSES[name] },
            ...preOrderOnly(name),
          },
        }),
      ),
    ),
    branchToday(tx, query.branchId),
  ]);
  const counts = Object.fromEntries(
    QUEUE_TABS.map((name, index) => [name, grouped[index]!]),
  ) as Record<ProductOrderQueueTab, number>;
  return {
    tab: tab as ProductOrderQueueTab,
    rows: rows.map((row) => presentQueueRow(row, today, context.now)),
    total,
    page,
    pageSize: PRODUCT_ORDER_QUEUE_PAGE_SIZE,
    counts,
  };
}

/** The paid lines that still have to be ordered, grouped by variant under its usual supplier (those without one last). */
export async function toOrder(
  context: AdminContext,
  branchId: string,
): Promise<ProductOrderToOrderResponse> {
  const { tx } = context;
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw new AuthError('NOT_FOUND');
  requireManageOrders(context, branchId);
  const rows = await tx.productOrderLine.findMany({
    where: { branchId, status: 'PAID', productLine: { fulfilmentMode: 'PRE_ORDER' } },
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    select: queueSelect,
  });
  const groups = new Map<string, ProductOrderToOrderResponse['groups'][number]>();
  for (const row of rows) {
    const existing = groups.get(row.variantId);
    const line = {
      lineId: row.id,
      orderCode: row.order.code,
      quantity: row.quantity,
      paidAt: (row.paidAt ?? row.orderedAt ?? context.now).toISOString(),
      expectedFrom: row.expectedFrom ? isoDay(row.expectedFrom) : null,
      expectedTo: row.expectedTo ? isoDay(row.expectedTo) : null,
      rowVersion: row.rowVersion,
    };
    if (existing) {
      existing.totalQuantity += row.quantity;
      existing.lines.push(line);
    } else {
      groups.set(row.variantId, {
        variantId: row.variantId,
        sku: row.productLine.sku,
        nameVi: row.line.nameVi,
        nameEn: row.line.nameEn,
        variantLabelVi: row.productLine.variantLabelVi,
        variantLabelEn: row.productLine.variantLabelEn,
        supplier: row.variant.usualSupplier,
        totalQuantity: row.quantity,
        lines: [line],
      });
    }
  }
  return {
    groups: [...groups.values()].sort(
      (a, b) =>
        Number(a.supplier === null) - Number(b.supplier === null) ||
        (a.supplier?.name ?? '').localeCompare(b.supplier?.name ?? '', 'vi') ||
        a.nameVi.localeCompare(b.nameVi, 'vi') ||
        a.variantId.localeCompare(b.variantId),
    ),
  };
}
