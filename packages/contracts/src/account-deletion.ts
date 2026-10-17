import type { CustomerBookingSummary } from './index.js';

/**
 * Session 10 A2: a customer deletes their own account ("Xóa tài khoản"). The session is the only identity: no customer id is sent.
 *
 * GET  /api/v1/me/account-deletion → 200 AccountDeletionCheckResponse: what stops the deletion now and what will be lost.
 * POST /api/v1/me/account-deletion  AccountDeletionRequest → 204, the session cookie cleared. The current password is checked again;
 *   401 AUTHENTICATION_FAILED for a wrong password (the reauthentication budgets apply, 429 RATE_LIMITED when spent);
 *   409 ACCOUNT_DELETION_BLOCKED when a blocker appeared meanwhile (read the check again). Every session of the account ends.
 */

/** A combo with prepaid sessions still usable (Owner answer 3: deletion waits until they are used or refunded). */
export interface AccountDeletionCombo {
  id: string;
  nameVi: string;
  nameEn: string;
  serviceNameVi: string;
  serviceNameEn: string;
  sessionsLeft: number;
  expiresAt: string | null;
}

/**
 * An order that is not finished (reading, pending Owner confirmation):
 * - `ONLINE_UNPAID`: an online order still waiting for its payment (cancel it, or let its payment time run out);
 * - `ONLINE_IN_PROGRESS`: a paid online order not yet delivered or cancelled (wait for the delivery);
 * - `COUNTER_PREORDER`: goods ordered at the shop and not yet collected.
 */
export type AccountDeletionOrderKind = 'ONLINE_UNPAID' | 'ONLINE_IN_PROGRESS' | 'COUNTER_PREORDER';

export interface AccountDeletionOrder {
  id: string;
  code: string;
  kind: AccountDeletionOrderKind;
  placedAt: string;
}

export interface AccountDeletionCheckResponse {
  /** True when no blocker is present; the POST checks again under a lock. */
  canDelete: boolean;
  blockers: {
    combos: AccountDeletionCombo[];
    orders: AccountDeletionOrder[];
    /** A booking checked in or in service, or a visit still open: the person is at the spa now. */
    atSpa: boolean;
    /** Product return requests still open on the account's invoices. */
    openReturns: number;
  };
  /** What deleting gives up. */
  losses: {
    /** Point balances; null while the membership programme is not live. */
    points: { spa: number; beauty: number } | null;
    /** Bookings that the deletion cancels (through the normal cancellation, so the spa sees them cancelled). */
    upcomingBookings: CustomerBookingSummary[];
  };
}

export interface AccountDeletionRequest {
  currentPassword: string;
}
