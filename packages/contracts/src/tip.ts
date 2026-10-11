/**
 * Phase 7 P7-10 (docs/PHASE7_PAYROLL_FUNDS.md section 6; Owner answer 5, 2026-10-11): a customer's tip is a record SEPARATE from the invoice
 * and its payment: it is not revenue, earns no loyalty points and is outside the commission base. It is recorded after the invoice is
 * PAID by someone who may collect payments at the branch, for a KTV who served on it, and it enters the cash book as money in (cash at
 * the counter, or a transfer the shop recorded). It is paid out WITH THE PAYSLIP on the payroll payment day (never at the daily closing)
 * and shown as its own line. A mistake is reversed in full by a negative record while no payroll run has taken the tip.
 */
export const TIP_METHODS = ['CASH', 'TRANSFER'] as const;
export type TipMethodName = (typeof TIP_METHODS)[number];

/** A tip may be recorded this many days after the invoice was paid (a short correction window, not an open-ended one). */
export const TIP_WINDOW_DAYS = 7;

export interface TipPerson {
  id: string;
  name: string;
}

export interface TipItem {
  id: string;
  employee: TipPerson;
  /** Signed: positive for a tip, negative for the reversal of one. */
  amountVnd: string;
  method: TipMethodName;
  businessDate: string;
  reversesId: string | null;
  reason: string | null;
  recordedBy: TipPerson;
  recordedAt: string;
  /** A payroll run has taken the tip (it can no longer be reversed here). */
  claimed: boolean;
  /** The signed-in person may reverse it (a tip that is not reversed, not claimed, and they may collect payments there). */
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
  /** May the signed-in person record a tip now? */
  canRecord: boolean;
  /** Why not, when not. */
  blockedBy: 'NOT_PAID' | 'WINDOW_CLOSED' | 'NOT_LIVE' | 'NO_SERVICE' | 'NO_PERMISSION' | null;
  /** The last instant a tip can be recorded (ISO), or null when the invoice is not paid. */
  windowEndsAt: string | null;
}

export interface TipRequest {
  invoiceId: string;
  employeeUserId: string;
  amountVnd: string;
  method: TipMethodName;
  clientRequestId: string;
}

export interface TipReverseRequest {
  reason: string;
  clientRequestId: string;
}
