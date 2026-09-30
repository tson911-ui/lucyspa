import type { PaymentMethod } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';

/**
 * Per-method payment rules (Phase 4 Steps 7 and 8). This table is the single place that says what a method may
 * do, so a future method (a CARD / POS terminal) is added by a rule, not by branching through the commands.
 *
 * It is keyed by the database `PaymentMethod` enum on purpose: adding a value to the enum makes this file
 * stop compiling until the new method states its rules. `active` means the direct "record a payment" command
 * accepts the method: only CASH is (the cashier holds the money). PAYOS is a `provider` method: it is never
 * recorded directly, only requested through the PayOS commands and confirmed by PayOS, so staff can never mark
 * a transfer as received (Owner answer Q7 item 9). CARD does not exist in the enum, the contract or the UI.
 *
 * Enabling CARD later is an additive change: add `CARD` to the enum (with its per-method CHECK), add its rule
 * here with `active: false`, ship the terminal handling, then flip `active`.
 */
export interface PaymentMethodRule {
  /** Accepted by the direct record command (cash only). */
  readonly active: boolean;
  /** An erroneous record of this method may be reversed inside Lucy Spa (Q6). Provider money never is. */
  readonly reversible: boolean;
  /** The customer hands over an amount that may exceed the credited one (cash tender and change). */
  readonly tender: boolean;
  /** Money that exists only when an external provider confirms it. */
  readonly provider: boolean;
}

export const PAYMENT_METHOD_RULES: Readonly<Record<PaymentMethod, PaymentMethodRule>> = {
  CASH: { active: true, reversible: true, tender: true, provider: false },
  PAYOS: { active: false, reversible: false, tender: false, provider: true },
};

/** The method a client named for the direct record command, only when known and currently accepted there. */
export function resolvePaymentMethod(value: unknown): PaymentMethod {
  if (typeof value !== 'string') throw new AuthError('PAYMENT_METHOD_UNAVAILABLE');
  const rule = Object.hasOwn(PAYMENT_METHOD_RULES, value)
    ? PAYMENT_METHOD_RULES[value as PaymentMethod]
    : undefined;
  if (!rule?.active) throw new AuthError('PAYMENT_METHOD_UNAVAILABLE');
  return value as PaymentMethod;
}
