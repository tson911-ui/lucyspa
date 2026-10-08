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
  contactPhone: string;
  contactName: string | null;
  customer: { id: string; displayName: string } | null;
  createdAt: string;
  lines: ProductOrderLineResponse[];
  /** True when a ticket link for a customer without an account is active. */
  ticketLinkActive: boolean;
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

/** GET /api/v1/public/product-order-tickets/:token: the read-only ticket. No phone number, no address, no other order. */
export interface ProductOrderTicketPublicResponse {
  code: string;
  status: ProductOrderLineStatusName;
  branchName: string;
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
