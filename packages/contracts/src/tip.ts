/**
 * Phase 7 P7-17 (Owner decision of 2026-10-12, replaces OQ-P7-10a and the staff "record a tip" form): cash tips are NOT recorded in the system.
 * A tip exists only when the CUSTOMER adds it to a PayOS payment ("Thêm tip": preset amounts or a custom amount) and chooses which of the
 * KTVs who performed a service on the visit get how much. The choice is frozen with the request; the provider is asked for the invoice part
 * plus the tip; when the provider confirms that exact total the tip is recorded for each KTV in the same transaction (it enters the bank
 * fund as TIP_IN), it is paid with the payslip on the payroll payment day as its own line, and it stays outside revenue, loyalty points and
 * the commission base. Nobody can reassign it; the only correction is an Owner-only full reversal with a reason (audited).
 */

/** Preset tip amounts (VND). A default pending the Owner's confirmation; one constant so changing it is one line. */
export const TIP_PRESETS_VND = ['20000', '50000', '100000'] as const;
/** Every tip amount is a whole multiple of this and at least this much. */
export const TIP_STEP_VND = 1_000;
/** The most one payment can carry (the same ceiling as the database). */
export const TIP_MAX_VND = 10_000_000;

export interface TipPerson {
  id: string;
  name: string;
}

/** What the customer chose for one KTV. */
export interface TipChoice {
  employeeUserId: string;
  amountVnd: string;
}

export interface TipItem {
  id: string;
  employee: TipPerson;
  /** Signed: positive for a tip, negative for the reversal of one. */
  amountVnd: string;
  businessDate: string;
  reversesId: string | null;
  reason: string | null;
  /** The person who reversed it (a reversal) or who collected the payment (a tip). */
  recordedBy: TipPerson;
  recordedAt: string;
  /** A payroll run has taken the tip (it can no longer be reversed here). */
  claimed: boolean;
  /** The signed-in person may reverse it (Owner-level payroll approval; not reversed, not claimed). */
  canReverse: boolean;
}

export interface TipServedBy {
  employee: TipPerson;
  /** The tip of this person for this invoice net of reversals ("0" when none). */
  netVnd: string;
}

export interface InvoiceTipsResponse {
  invoiceId: string;
  invoiceCode: string;
  status: 'DRAFT' | 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  branch: { id: string; name: string };
  /** The KTVs who performed a service on the invoice: the only people a tip can be for. */
  served: TipServedBy[];
  items: TipItem[];
  /** May the customer be offered "Thêm tip" with the next PayOS payment of this invoice? */
  offer: {
    available: boolean;
    /** Why not, when not. */
    blockedBy: 'NOT_PAYABLE' | 'NOT_LIVE' | 'NO_SERVICE' | 'NO_PERMISSION' | null;
  };
}

export interface TipReverseRequest {
  reason: string;
  clientRequestId: string;
}
