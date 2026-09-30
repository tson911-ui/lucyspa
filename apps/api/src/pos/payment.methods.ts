import type { PaymentMethod } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';

/**
 * Per-method payment rules (Phase 4 Step 7). This table is the single place that says what a method may do,
 * so a future method (a CARD / POS terminal, PayOS in Step 8) is added by a rule, not by branching through
 * the commands.
 *
 * It is keyed by the database `PaymentMethod` enum on purpose: adding a value to the enum makes this file
 * stop compiling until the new method states its rules. The enum is CASH-only in this Step, so nothing else
 * can be accepted: no CARD value exists in the database, the contract or the UI, and the collect command
 * refuses every method that is not listed and `active`.
 *
 * Enabling CARD later is an additive change made together with the Step 8 per-method CHECK on `payments`
 * (the cash-only NOT NULLs and `payments_cash_succeeded` are relaxed there): add `CARD` to the enum, add its
 * rule here with `active: false`, ship the terminal handling, then flip `active`. The payment row already
 * separates the credited amount from what was handed over, and events/audit already carry the method.
 */
export interface PaymentMethodRule {
  /** Accepted by the collect command now. */
  readonly active: boolean;
  /** An erroneous record of this method may be reversed inside Lucy Spa (Q6). Provider money never is. */
  readonly reversible: boolean;
  /** The customer hands over an amount that may exceed the credited one (cash tender and change). */
  readonly tender: boolean;
}

export const PAYMENT_METHOD_RULES: Readonly<Record<PaymentMethod, PaymentMethodRule>> = {
  CASH: { active: true, reversible: true, tender: true },
};

/** The method a client named, only when it is a known method that is currently accepted. */
export function resolvePaymentMethod(value: unknown): PaymentMethod {
  if (typeof value !== 'string') throw new AuthError('PAYMENT_METHOD_UNAVAILABLE');
  const rule = Object.hasOwn(PAYMENT_METHOD_RULES, value)
    ? PAYMENT_METHOD_RULES[value as PaymentMethod]
    : undefined;
  if (!rule?.active) throw new AuthError('PAYMENT_METHOD_UNAVAILABLE');
  return value as PaymentMethod;
}
