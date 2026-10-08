/**
 * Phase 6 P6-13: refunds per product line (design 8.2-8.4; Q3, Q4, Q5, OQ-19 option A, OQ-23, T21, T22, OQ-80, OQ-81, OQ-83; PRD 28.6).
 * A refund gives back some units of ONE product line of a paid counter invoice, after a return case for that line was accepted as a
 * refund. Only holders of `REFUND_PRODUCTS` at the invoice's branch make one, and only with a recent password confirmation. Cash or a
 * manual bank transfer only: there is no PayOS call, and the customer's bank account is never stored, only the transfer reference.
 * A refund is an immutable record; a typed transfer reference is corrected by a new linked record. Services and combos have no refund.
 */

export type ProductRefundMethodName = 'CASH' | 'BANK_TRANSFER_MANUAL';
export type ProductRefundRestockName = 'SELLABLE' | 'NOT_SELLABLE';
/** Q5: the invoice stays PAID; a line is not refunded, partly refunded, or refunded when every unit is. */
export type ProductRefundLineState = 'NOT_REFUNDED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

/** The bank's reference of a transfer: letters, digits and . _ / - only, 4 to 64 characters (never an account number: OQ-83). */
export const PRODUCT_REFUND_REFERENCE = /^[A-Za-z0-9._/-]{4,64}$/;
export const PRODUCT_REFUND_REASON_MAX = 500;

/**
 * The money of refunding the units `(unitsBefore, unitsBefore + quantity]` of a line (design 6.4 item 4): cumulative rounding, half up
 * to 1 VND, so the refunds of all `totalUnits` units add up to the line's net amount exactly and the last unit takes the remainder.
 * The API and the database use this very rule; the screen uses it to show the amount before the person confirms.
 */
export function productRefundAmount(
  netVnd: bigint,
  totalUnits: number,
  unitsBefore: number,
  quantity: number,
): bigint {
  if (!Number.isInteger(totalUnits) || totalUnits < 1)
    throw new RangeError('The line has no units');
  if (
    !Number.isInteger(unitsBefore) ||
    !Number.isInteger(quantity) ||
    unitsBefore < 0 ||
    quantity < 1
  ) {
    throw new RangeError('A refund is for a whole number of units');
  }
  if (unitsBefore + quantity > totalUnits) throw new RangeError('More units than the line has');
  const n = BigInt(totalUnits);
  const cumulative = (units: number): bigint => (2n * netVnd * BigInt(units) + n) / (2n * n);
  return cumulative(unitsBefore + quantity) - cumulative(unitsBefore);
}

export const productRefundLineState = (
  refundedUnits: number,
  soldUnits: number,
): ProductRefundLineState =>
  refundedUnits <= 0
    ? 'NOT_REFUNDED'
    : refundedUnits >= soldUnits
      ? 'REFUNDED'
      : 'PARTIALLY_REFUNDED';

export interface ProductRefundCorrectionResponse {
  id: string;
  bankReference: string;
  reason: string;
  actorName: string;
  occurredAt: string;
}

export interface ProductRefundResponse {
  id: string;
  code: string;
  quantity: number;
  /** Integer VND as a decimal string. */
  amountVnd: string;
  method: ProductRefundMethodName;
  /** The reference now in force (the last correction, or the one typed first); null for cash. */
  bankReference: string | null;
  /** The reference as first typed when a correction replaced it. */
  firstBankReference: string | null;
  reason: string;
  restock: ProductRefundRestockName;
  actorName: string;
  occurredAt: string;
  /** The lots the returned goods went into (a sellable refund only). Never a quantity on hand, never a cost. */
  lotCodes: string[];
  /**
   * The Beauty points this refund took back (positive number), or null while the points are not recorded yet (they follow in a moment)
   * or the payer earned none. `beautyPointsShortfall` is the part the balance could not absorb (P5-Q5); the money refund is never blocked.
   */
  beautyPointsTakenBack: number | null;
  beautyPointsShortfall: number;
  corrections: ProductRefundCorrectionResponse[];
}

/** GET /api/v1/product-returns/cases/:id/refunds (REFUND_PRODUCTS at the case's branch). */
export interface ProductRefundSummaryResponse {
  caseId: string;
  caseCode: string;
  invoiceCode: string;
  /** The line's net amount after its discounts, as paid (integer VND string); null when the line has no recorded net. */
  lineNetVnd: string | null;
  soldQuantity: number;
  /** Units already refunded on the whole line (every case). */
  lineRefundedQuantity: number;
  lineRefundedVnd: string;
  /** Units claimed on the line by refunds AND exchanges (P6-14): the units before the next refund, and what the amount shown is cut from. */
  lineClaimedQuantity: number;
  lineState: ProductRefundLineState;
  /** Units the case accepted and units of it still to refund. */
  caseQuantity: number;
  caseRefundedQuantity: number;
  caseRemainingQuantity: number;
  /** The invoice is still paid, the case accepted as a refund, and a unit is left: a refund can be made now. */
  refundable: boolean;
  /** Why not, when it cannot: a stable code the screen words. */
  blocked:
    | 'NOT_ACCEPTED_AS_REFUND'
    | 'INVOICE_NOT_PAID'
    | 'NOTHING_LEFT'
    | 'NOTHING_PAID'
    | 'OPEN_EXCHANGE'
    | null;
  refunds: ProductRefundResponse[];
  can: { refund: boolean; correctReference: boolean };
}

/** POST /api/v1/product-returns/cases/:id/refunds */
export interface ProductRefundRequest {
  quantity: number;
  method: ProductRefundMethodName;
  /** The bank's transfer reference (required for BANK_TRANSFER_MANUAL, null for CASH). Never an account number. */
  bankReference: string | null;
  /** The refunding person decides whether the returned goods can be sold again (OQ-80). */
  restock: ProductRefundRestockName;
  /** Why (required); it stays on the refund and in the audit log. */
  reason: string;
  /** A UUID made by the screen: a repeat of the same request returns the refund it already made. */
  clientRequestId: string;
}

/** POST /api/v1/product-returns/cases/:id/refunds/:refundId/corrections */
export interface ProductRefundCorrectionRequest {
  bankReference: string;
  reason: string;
}
