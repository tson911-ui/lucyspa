/**
 * Phase 6 P6-15/P6-16/P6-17 (Wave 3b): counter pre-orders (design 18; T28-T33, OQ-29 to OQ-37, OQ-84 to OQ-87).
 *
 * Most Lucy Beauty goods are not in stock. A counter pre-order is a sale of goods the shop does not hold yet: the customer pays in full,
 * the shop orders the goods from the supplier, they arrive in about 3 to 5 days, and the customer collects them. The invoice stays the
 * money record; the PRODUCT ORDER is the goods record (one per invoice that has a pre-order line, one order line per such line).
 * The expected arrival range is "dự kiến, không phải cam kết" (an estimate, never a promise).
 */

export type ProductLineModeName = 'IN_STOCK' | 'PRE_ORDER';

export type ProductOrderLineStatusName =
  'AWAITING_PAYMENT' | 'PAID' | 'ORDERED' | 'ARRIVED' | 'HANDED_OVER' | 'COMPLETED' | 'CANCELLED';

/** OQ-32. `INVOICE_CANCELLED` is the system cause (an unpaid invoice cancelled). */
export type ProductOrderCancelCauseName =
  | 'INVOICE_CANCELLED'
  | 'SUPPLIER_CANNOT_DELIVER'
  | 'CUSTOMER_CANCELLED_BEFORE_ORDERING'
  | 'CUSTOMER_CHANGED_MIND'
  | 'LATE_OVER_7_DAYS';

export type ProductHandoverToName = 'CUSTOMER' | 'REPRESENTATIVE';

/** The order the lines are shown and worked in: the least advanced line decides the status of the order (T32). */
export const PRODUCT_ORDER_STATUS_RANK: readonly ProductOrderLineStatusName[] = [
  'AWAITING_PAYMENT',
  'PAID',
  'ORDERED',
  'ARRIVED',
  'HANDED_OVER',
  'COMPLETED',
];

/**
 * The status of a whole order from its lines (T32): the least advanced line among those still in play; when every line is cancelled
 * the order is cancelled, and a cancelled line never holds the others back.
 */
export function productOrderStatus(
  lines: readonly { status: ProductOrderLineStatusName }[],
): ProductOrderLineStatusName {
  const live = lines.filter((line) => line.status !== 'CANCELLED');
  if (live.length === 0) return 'CANCELLED';
  let least: ProductOrderLineStatusName = 'COMPLETED';
  for (const line of live) {
    if (PRODUCT_ORDER_STATUS_RANK.indexOf(line.status) < PRODUCT_ORDER_STATUS_RANK.indexOf(least)) {
      least = line.status;
    }
  }
  return least;
}

/**
 * The secret link of a customer without an account stops working this many days after the order was closed, that is after the last of
 * its lines was handed over or cancelled (the Owner, 2026-10-09). Read as 30 x 24 hours from that instant.
 */
export const PRODUCT_ORDER_TICKET_DAYS_AFTER_CLOSE = 30;

/**
 * When the link of an order expires: null while any line is still open (awaiting payment, paid, ordered or arrived), otherwise the
 * latest hand-over or cancellation time plus 30 days. A cancelled line counts at its cancellation time (also an unpaid invoice that
 * was cancelled), any other finished line at its hand-over time.
 */
export function productOrderTicketExpiresAt(
  lines: readonly {
    status: ProductOrderLineStatusName;
    handedOverAt: Date | string | null;
    cancelledAt: Date | string | null;
  }[],
): Date | null {
  if (lines.length === 0) return null;
  let latest = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    let at: Date | string | null;
    if (line.status === 'CANCELLED') at = line.cancelledAt;
    else if (line.status === 'HANDED_OVER' || line.status === 'COMPLETED') at = line.handedOverAt;
    else return null;
    if (at === null) return null;
    latest = Math.max(latest, new Date(at).getTime());
  }
  return new Date(latest + PRODUCT_ORDER_TICKET_DAYS_AFTER_CLOSE * 24 * 60 * 60 * 1000);
}

/** The contact asked at the counter when the invoice has a pre-order line (OQ-34: a phone number is mandatory). */
export interface PreOrderContactRequest {
  /** Any common Vietnamese format; stored as +84... */
  phone: string;
  name?: string | null;
}

export interface ProductOrderLineResponse {
  id: string;
  invoiceLineId: string;
  variantId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  quantity: number;
  status: ProductOrderLineStatusName;
  paidAt: string | null;
  /** The branch-local calendar dates (YYYY-MM-DD) of the expected arrival range; set when the invoice is paid. */
  expectedFrom: string | null;
  expectedTo: string | null;
  orderedAt: string | null;
  arrivedAt: string | null;
  handedOverAt: string | null;
  handedOverTo: ProductHandoverToName | null;
  handedOverToName: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelCause: ProductOrderCancelCauseName | null;
  /** The customer's money is returned by the refund Step; this only says whether a refund exists for the cancelled line. */
  refunded: boolean;
  rowVersion: number;
}

/** The staff view of the order of an invoice. */
export interface ProductOrderResponse {
  id: string;
  code: string;
  invoiceId: string;
  invoiceCode: string;
  branchId: string;
  status: ProductOrderLineStatusName;
  /** In full for those who sell or work the orders; masked (`•••••••567`) for everyone else who can open the invoice. */
  contactPhone: string;
  contactMasked: boolean;
  contactName: string | null;
  customer: { id: string; displayName: string } | null;
  createdAt: string;
  lines: ProductOrderLineResponse[];
  /** True when a ticket link for a customer without an account is active (made, not revoked and not expired). */
  ticketLinkActive: boolean;
  /** When the order was closed the link expires then (30 days after the last hand-over or cancellation); null while it is open. */
  ticketExpiresAt: string | null;
}

/** What a member sees of the order of their own invoice (the digital "phiếu hẹn nhận hàng"). Never the seller or the staff. */
export interface CustomerProductOrderResponse {
  code: string;
  status: ProductOrderLineStatusName;
  lines: {
    /** The `sequence` of the invoice line, as the customer's invoice lists it. */
    sequence: number;
    status: ProductOrderLineStatusName;
    quantity: number;
    expectedFrom: string | null;
    expectedTo: string | null;
    arrivedAt: string | null;
    handedOverAt: string | null;
    cancelledAt: string | null;
  }[];
}

/**
 * POST /api/v1/pos/product-orders/:id/ticket-link (SELL_PRODUCTS or MANAGE_PRODUCT_ORDERS at the order's branch): a new secret link
 * for a customer without an account (OQ-P6-42, approved 2026-10-07). The token is shown ONCE, here; only its hash is stored, and any
 * earlier link of the order stops working. The system sends nothing: staff pass the link or the QR code on by hand.
 */
export interface ProductOrderTicketLinkResponse {
  /** The path the customer opens, relative to the website origin: /{locale}/ticket/{token}. */
  token: string;
  createdAt: string;
}

// ------------------------------------------------------------------------------------------------- the queue (P6-17)

/** Who may do what with the order of the screen (the API decides again on every command). */
export interface ProductOrderLineActions {
  /** PAID: mark it ordered from the supplier (MANAGE_PRODUCT_ORDERS). */
  markOrdered: boolean;
  /** ARRIVED: hand the goods over (MANAGE_PRODUCT_ORDERS). */
  handOver: boolean;
  /** The causes a person with REFUND_PRODUCTS may cancel it with now (empty when nothing can be cancelled). */
  cancelCauses: ProductOrderCancelCauseName[];
  /** What a cancellation gives back: the net share of the whole line (0 when nothing was paid for it). */
  refundVnd: string;
  /** A refund by manual transfer exists: a mistyped reference can be corrected by a new linked record (REFUND_PRODUCTS). */
  correctReference: boolean;
}

/** The refund of a cancelled line, shown to those who may refund (the money and the transfer reference are theirs to see). */
export interface ProductOrderRefundInfo {
  code: string;
  amountVnd: string;
  method: 'CASH' | 'BANK_TRANSFER_MANUAL';
  /** The reference as last corrected; null for cash. */
  bankReference: string | null;
  corrections: number;
  refundedAt: string;
}

export interface ProductOrderDetailLine extends ProductOrderLineResponse {
  actions: ProductOrderLineActions;
  refund: ProductOrderRefundInfo | null;
  /** When the goods arrived more than 7 days ago and have not been collected: staff call the customer (OQ-34). */
  heldTooLong: boolean;
  /** Past the expected date and the goods have not arrived (OQ-86). */
  late: boolean;
}

/** GET /api/v1/product-orders/:id (SELL_PRODUCTS, MANAGE_PRODUCT_ORDERS or REFUND_PRODUCTS at the branch). */
export interface ProductOrderDetailResponse extends Omit<ProductOrderResponse, 'lines'> {
  lines: ProductOrderDetailLine[];
  invoiceStatus: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  can: { work: boolean; refund: boolean; ticketLink: boolean };
}

export type ProductOrderQueueTab = 'TO_ORDER' | 'ORDERED' | 'ARRIVED' | 'DONE' | 'CANCELLED';
export const PRODUCT_ORDER_QUEUE_PAGE_SIZE = 20;

export interface ProductOrderQueueRow {
  lineId: string;
  orderId: string;
  orderCode: string;
  invoiceId: string;
  invoiceCode: string;
  customerName: string | null;
  contactPhone: string;
  contactName: string | null;
  variantId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  quantity: number;
  status: ProductOrderLineStatusName;
  paidAt: string | null;
  expectedFrom: string | null;
  expectedTo: string | null;
  orderedAt: string | null;
  arrivedAt: string | null;
  late: boolean;
  heldTooLong: boolean;
  supplier: { id: string; name: string } | null;
  rowVersion: number;
}

/** GET /api/v1/product-orders?branchId&tab&q&page (MANAGE_PRODUCT_ORDERS at the branch): 20 lines a page, oldest paid first. */
export interface ProductOrderQueueResponse {
  tab: ProductOrderQueueTab;
  rows: ProductOrderQueueRow[];
  total: number;
  page: number;
  pageSize: number;
  /** One number per tab, so the tabs can say how much waits (shown in the table's own line, never next to a heading). */
  counts: Record<ProductOrderQueueTab, number>;
}

/** One variant the shop has to order: the paid lines that wait for it, with the supplier it is usually ordered from (OQ-87). */
export interface ProductOrderToOrderGroup {
  variantId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  supplier: { id: string; name: string } | null;
  totalQuantity: number;
  lines: {
    lineId: string;
    orderCode: string;
    quantity: number;
    paidAt: string;
    expectedFrom: string | null;
    expectedTo: string | null;
    rowVersion: number;
  }[];
}

/** GET /api/v1/product-orders/to-order?branchId (MANAGE_PRODUCT_ORDERS): grouped by supplier (those without one last), then by product. */
export interface ProductOrderToOrderResponse {
  groups: ProductOrderToOrderGroup[];
}

/** POST /api/v1/product-orders/mark-ordered: the lines of one group (or one line) the shop has just ordered from the supplier. */
export interface ProductOrderMarkOrderedRequest {
  lines: { id: string; rowVersion: number }[];
  note?: string | null;
}

/**
 * POST /api/v1/product-orders/lines/:id/hand-over (MANAGE_PRODUCT_ORDERS): the goods of an ARRIVED line leave the shop. The person
 * collecting says the order code and the last four digits of the phone number (OQ-85); the server compares them with the order and
 * keeps neither the digits nor the answer. A representative is named. The stock leaves through the stock-sale consumer (T31).
 */
export interface ProductOrderHandOverRequest {
  expectedVersion: number;
  to: ProductHandoverToName;
  representativeName?: string | null;
  orderCode: string;
  phoneLast4: string;
  note?: string | null;
}

/**
 * POST /api/v1/product-orders/lines/:id/cancel (REFUND_PRODUCTS, a fresh password when money is given back): cancels a paid line with a
 * cause (OQ-32) and refunds its whole net share by cash or manual transfer; the goods held for it are released. When the customer
 * changed their mind after the supplier order the Owner or a manager decides case by case (the Owner, 2026-10-09; OQ-32): the refund
 * may be a part of the share (`amountVnd`, 1 to the whole share; left out = the whole share). Every other cause refunds the whole share
 * and refuses an amount.
 */
export interface ProductOrderCancelRequest {
  expectedVersion: number;
  cause: Exclude<ProductOrderCancelCauseName, 'INVOICE_CANCELLED'>;
  note: string;
  method: 'CASH' | 'BANK_TRANSFER_MANUAL';
  bankReference: string | null;
  clientRequestId: string;
  /** Integer VND as a string; only with the cause CUSTOMER_CHANGED_MIND. */
  amountVnd?: string;
}

/**
 * POST /api/v1/product-orders/lines/:id/decline (REFUND_PRODUCTS): the Owner or a manager declines the customer's request to cancel after
 * the supplier order. Nothing moves: the line stays as it is and the customer can still collect the goods. The decision and its written
 * reason are recorded in the audit log. Allowed while the line is ORDERED or ARRIVED and the customer may change their mind.
 */
export interface ProductOrderDeclineRequest {
  expectedVersion: number;
  note: string;
}

/** POST /api/v1/product-orders/lines/:id/reference-correction (REFUND_PRODUCTS): a new linked record; the refund itself never changes. */
export interface ProductOrderCorrectReferenceRequest {
  bankReference: string;
  reason: string;
}

/** GET /api/v1/product-orders/context: the branches the caller may work the orders in and what they may do there. */
export interface ProductOrderContextResponse {
  branches: {
    id: string;
    code: string;
    name: string;
    /** MANAGE_PRODUCT_ORDERS: the queue, mark ordered, hand over, allocate. */
    work: boolean;
    /** REFUND_PRODUCTS: cancel a line and refund it. */
    refund: boolean;
  }[];
}

export interface ProductOrderMarkOrderedResponse {
  ordered: number;
}

/** POST /api/v1/product-orders/allocate (MANAGE_PRODUCT_ORDERS): give free stock to the waiting lines now. */
export interface ProductOrderAllocateRequest {
  branchId: string;
  variantId?: string;
}
export interface ProductOrderAllocateResponse {
  allocated: number;
}

/** GET /api/v1/public/product-order-tickets/:token: the read-only ticket. No phone number, no address, no other order. */
export interface ProductOrderTicketPublicResponse {
  code: string;
  status: ProductOrderLineStatusName;
  branchName: string;
  /** The IANA zone of the branch: the day of payment is read in it. */
  branchTimezone: string;
  paidAt: string | null;
  totalVnd: string;
  lines: {
    nameVi: string;
    nameEn: string;
    variantLabelVi: string | null;
    variantLabelEn: string | null;
    quantity: number;
    unitPriceVnd: string;
    grossVnd: string;
    status: ProductOrderLineStatusName;
    expectedFrom: string | null;
    expectedTo: string | null;
  }[];
}
