/**
 * Phase 6 P6-14: exchanges of a returned product line (design 8.5; OQ-24, OQ-82, PRD 28.5). An exchange follows a return case accepted
 * as an EXCHANGE: the customer gives back the units of the case and takes the same number of units of ONE replacement item that is in
 * stock now (pre-orders come in Wave 3b). Only holders of `REFUND_PRODUCTS` at the invoice's branch make one, with a password
 * confirmation used once.
 *
 * The money follows the Owner's rule (2026-10-08): the difference is the replacement's price on the day of the exchange minus what the
 * customer actually paid for the returned units.
 *   - more expensive: the customer pays the difference as an ordinary payment (cash or PayOS) of the exchange invoice;
 *   - cheaper: the spa hands the difference back by cash or manual transfer (the refund rules: the transfer reference only, the
 *     Owner is told in-app);
 *   - Beauty points: the original points stay; points are earned only on the difference actually paid (the exchange invoice earns like
 *     any invoice); an equal or cheaper replacement earns nothing and takes nothing away.
 * An exchange is an immutable record; nothing is edited or deleted, and what happens next is appended as new records.
 */

export type ProductExchangeRule = 'SAME_ITEM' | 'PRICE_DIFFERENCE';
export type ProductExchangeStatus =
  'AWAITING_PAYMENT' | 'AWAITING_COMPLETION' | 'COMPLETED' | 'CANCELLED';

export interface ProductExchangeAmounts {
  rule: ProductExchangeRule;
  /** What the customer actually paid for the returned units (the line's net share, cumulative rounding as a refund). */
  creditVnd: bigint;
  /** The replacement's price on the day of the exchange times the units. */
  replacementGrossVnd: bigint;
  /** What the exchange invoice takes off the replacement (never more than the replacement's price). */
  appliedCreditVnd: bigint;
  /** The customer pays this much more (zero when the replacement is not dearer). */
  payableVnd: bigint;
  /** The spa hands this much back (zero unless the replacement is cheaper). */
  refundVnd: bigint;
}

/**
 * The price difference of an exchange (OQ-82), one rule in one place; the API, the database check and the screen all use it.
 *   - `PRICE_DIFFERENCE` (the replacement is another item): difference = replacement price − what the customer paid for the returned
 *     units. Positive: the customer pays it. Negative: the spa hands it back.
 *   - `SAME_ITEM` (a faulty item swapped for the same item): the OQ-82 text says an exchange of the same kind has no difference, so the
 *     replacement is given against the returned units at no charge and nothing is handed back, whatever the prices are today.
 * The Owner's wording of 2026-10-08 gives the general rule only; the same-item reading is a proposal pending the Owner (P14-2).
 */
export function exchangeAmounts(input: {
  creditVnd: bigint;
  replacementGrossVnd: bigint;
  sameItem: boolean;
}): ProductExchangeAmounts {
  const { creditVnd, replacementGrossVnd } = input;
  if (creditVnd < 0n || replacementGrossVnd < 0n) throw new RangeError('Amounts are not negative');
  if (input.sameItem) {
    return {
      rule: 'SAME_ITEM',
      creditVnd,
      replacementGrossVnd,
      appliedCreditVnd: replacementGrossVnd,
      payableVnd: 0n,
      refundVnd: 0n,
    };
  }
  const applied = creditVnd < replacementGrossVnd ? creditVnd : replacementGrossVnd;
  return {
    rule: 'PRICE_DIFFERENCE',
    creditVnd,
    replacementGrossVnd,
    appliedCreditVnd: applied,
    payableVnd: replacementGrossVnd - applied,
    refundVnd: creditVnd - applied,
  };
}

/** Why an exchange cannot be made now (a stable code the screen words). */
export type ProductExchangeBlocked =
  | 'NOT_ACCEPTED_AS_EXCHANGE'
  | 'INVOICE_NOT_PAID'
  | 'NOTHING_PAID_NO_CREDIT'
  | 'ALREADY_EXCHANGED'
  | 'OPEN_EXCHANGE'
  | 'LINE_IN_USE'
  | null;

/** One item that can be the replacement, with the price the exchange would use today. */
export interface ProductExchangeOption {
  variantId: string;
  productId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  listPriceVnd: string;
  unitPriceVnd: string;
  onPromotion: boolean;
  /** Units that can be handed over now (on hand, not expired, not held for another invoice). */
  available: number;
  /** True for the item that was returned. */
  sameItem: boolean;
}

/** GET /api/v1/product-returns/cases/:id/exchanges/options?q= (REFUND_PRODUCTS at the case's branch). */
export interface ProductExchangeOptionsResponse {
  quantity: number;
  options: ProductExchangeOption[];
  /** True when more matches exist than are shown: narrow the search. */
  truncated: boolean;
  /** Active employees of the branch who may be recorded as the seller of the replacement line. */
  sellers: { userId: string; displayName: string }[];
  defaultSellerUserId: string | null;
}

/** GET /api/v1/product-returns/cases/:id/exchanges/preview?variantId= */
export interface ProductExchangePreviewResponse {
  caseId: string;
  caseCode: string;
  quantity: number;
  option: ProductExchangeOption;
  rule: ProductExchangeRule;
  creditVnd: string;
  replacementGrossVnd: string;
  appliedCreditVnd: string;
  payableVnd: string;
  refundVnd: string;
  /** True when the replacement can be reserved now (enough available units). */
  inStock: boolean;
}

export interface ProductExchangeResponse {
  id: string;
  code: string;
  status: ProductExchangeStatus;
  rule: ProductExchangeRule;
  quantity: number;
  replacement: {
    variantId: string;
    sku: string;
    nameVi: string;
    nameEn: string;
    variantLabelVi: string | null;
    variantLabelEn: string | null;
    unitPriceVnd: string;
  };
  creditVnd: string;
  replacementGrossVnd: string;
  appliedCreditVnd: string;
  payableVnd: string;
  refundVnd: string;
  /** The money handed back when the replacement is cheaper (null when nothing is handed back). */
  refund: {
    method: 'CASH' | 'BANK_TRANSFER_MANUAL';
    /** The reference now in force (the last correction, or the one typed first); null for cash. */
    bankReference: string | null;
    firstBankReference: string | null;
    corrections: {
      id: string;
      bankReference: string;
      reason: string;
      actorName: string;
      occurredAt: string;
    }[];
  } | null;
  /** The invoice that carries the replacement (a normal invoice: payments, PayOS, stock sale all work on it). */
  invoice: {
    id: string;
    code: string;
    status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
    totalVnd: string;
    balanceVnd: string;
  };
  reason: string;
  actorName: string;
  occurredAt: string;
  /** Set once the returned goods are taken in (at once when nothing is due, otherwise after the payment). */
  completion: {
    restock: 'SELLABLE' | 'NOT_SELLABLE';
    actorName: string;
    occurredAt: string;
    lotCodes: string[];
  } | null;
  /** Beauty points the payer earned on the exchange invoice (null while not recorded yet or the payer earned none). */
  beautyPointsEarned: number | null;
}

/** GET /api/v1/product-returns/cases/:id/exchanges (REFUND_PRODUCTS at the case's branch). */
export interface ProductExchangeSummaryResponse {
  caseId: string;
  caseCode: string;
  invoiceCode: string;
  caseQuantity: number;
  /** What the customer paid for the units of this case (cumulative rule at the position the exchange would take). */
  creditVnd: string | null;
  exchangeable: boolean;
  blocked: ProductExchangeBlocked;
  exchanges: ProductExchangeResponse[];
  can: { exchange: boolean; complete: boolean; correctReference: boolean };
}

/** POST /api/v1/product-returns/cases/:id/exchanges */
export interface ProductExchangeRequest {
  variantId: string;
  /** The figures the screen showed; if today's price or the credit moved, the API refuses with EXCHANGE_FIGURES_CHANGED. */
  expectedPayableVnd: string;
  expectedRefundVnd: string;
  /** Needed when nothing is to be paid (the returned goods are taken in at once); absent when the customer pays a difference. */
  restock: 'SELLABLE' | 'NOT_SELLABLE' | null;
  /** Needed when the spa hands money back; absent otherwise. */
  refundMethod: 'CASH' | 'BANK_TRANSFER_MANUAL' | null;
  /** The bank's transfer reference when the refund is a transfer. Never an account number. */
  bankReference: string | null;
  /** The seller recorded on the replacement line; default = the seller of the returned line, else the person making the exchange. */
  sellerUserId: string | null;
  reason: string;
  clientRequestId: string;
}

/** POST /api/v1/product-returns/cases/:id/exchanges/:exchangeId/completion */
export interface ProductExchangeCompleteRequest {
  restock: 'SELLABLE' | 'NOT_SELLABLE';
}

/** POST /api/v1/product-returns/cases/:id/exchanges/:exchangeId/corrections */
export interface ProductExchangeCorrectionRequest {
  bankReference: string;
  reason: string;
}
