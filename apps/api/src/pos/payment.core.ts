import type { PaymentResultResponse } from '@lucy-spa/contracts';
import { appendOutboxEvent, type PaymentMethod } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { hasFreshReauthentication } from '../auth/session.policy.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import {
  balanceOf,
  effectivePaid,
  eventBase,
  invoiceSelect,
  lockedInvoice,
  pendingProviderVnd,
  presentPayments,
  type InvoiceRow,
} from './invoice.core.js';
import { assertNoExchangeHold } from './exchange-guard.js';
import { PAYMENT_METHOD_RULES } from './payment.methods.js';

/**
 * Phase 4 Step 7: recording cash (including split payments) and reversing an erroneous cash payment.
 * Commands run in the admin frame: authority is decided at transaction time for the INVOICE's own branch,
 * the invoice row is locked first (design 14: invoice -> payments), and every business timestamp is the
 * database clock (the Step 4 payment guard overwrites `collected_at`; a client supplies none). The Step 4
 * guards and the deferred reconciliation trigger stay the backstop of every rule here.
 *
 * Money: integer VND as bigint. Invoice-level rules (design 9): `0 <= effective paid <= total`, the invoice
 * is PAID exactly when the effective payments cover it, decided inside the transaction of the payment that
 * completes it (or of the reversal that leaves it short).
 */

/** The payment and the invoice's money state, and nothing else (reading the invoice is VIEW_INVOICES). */
async function result(
  context: AdminContext,
  invoiceId: string,
  paymentId: string,
): Promise<PaymentResultResponse> {
  const row = await context.tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: invoiceSelect,
  });
  const payment = presentPayments(context, row).find((entry) => entry.id === paymentId);
  if (!payment) throw new AuthError('NOT_FOUND');
  return {
    payment,
    invoice: {
      id: row.id,
      code: row.code,
      status: row.status,
      totalVnd: row.totalVnd.toString(),
      paidVnd: effectivePaid(row).toString(),
      balanceVnd: balanceOf(row).toString(),
      paidSeq: row.paidSeq,
      version: row.rowVersion,
    },
  };
}

export { result as paymentResult };

export interface RecordPaymentInput {
  method: PaymentMethod;
  amountVnd: bigint;
  tenderedVnd: bigint;
  idempotencyKey: string;
}

/**
 * Records one payment against a finalized, unpaid invoice (`COLLECT_PAYMENTS` at the invoice's branch; no
 * re-authentication for ordinary collection, OP-6). `amountVnd` is credited toward the invoice and may be
 * less than the balance (a split payment); `tenderedVnd` is what was handed over. The amount due recorded on
 * the payment is the invoice balance the server computes under the lock, and change is derived here, never
 * sent by the client. The payment that brings the effective total to the receivable also marks the invoice
 * PAID (a new paid episode) in the same transaction.
 *
 * Idempotency: the client UUID is unique per collector. A replay of the same request returns the stored
 * state (no second payment, credit, audit or event), even after the invoice became PAID; the same key with
 * different content is a conflict.
 */
export async function recordPayment(
  context: AdminContext,
  invoiceId: string,
  input: RecordPaymentInput,
): Promise<PaymentResultResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'COLLECT_PAYMENTS');
  const { tx } = context;
  const invoice = await read();
  const rule = PAYMENT_METHOD_RULES[input.method];
  if (!rule.active) throw new AuthError('PAYMENT_METHOD_UNAVAILABLE');

  const prior = await tx.payment.findUnique({
    where: {
      collectedByUserId_idempotencyKey: {
        collectedByUserId: context.actor.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true, invoiceId: true, method: true, amountVnd: true, tenderedVnd: true },
  });
  if (prior) {
    if (
      prior.invoiceId !== invoiceId ||
      prior.method !== input.method ||
      prior.amountVnd !== input.amountVnd ||
      prior.tenderedVnd !== input.tenderedVnd
    ) {
      throw new AuthError('CONFLICT');
    }
    return result(context, invoiceId, prior.id);
  }

  if (invoice.status !== 'PENDING_PAYMENT') throw new AuthError('INVOICE_STATE_INVALID');
  if (input.amountVnd <= 0n) throw new AuthError('VALIDATION_FAILED', 'amountVnd');
  const paidBefore = effectivePaid(invoice);
  const balance = invoice.totalVnd - paidBefore;
  // No overpayment: the credit never exceeds the balance the server sees now (a stale screen is refused).
  if (input.amountVnd > balance) throw new AuthError('PAYMENT_AMOUNT_INVALID');
  // A live PayOS request holds part of the balance (Q7 items 3 and 7): cash may take only the rest until that
  // request is cancelled or ends, so the same money is never collected twice.
  if (input.amountVnd > balance - pendingProviderVnd(invoice.payments, context.now)) {
    throw new AuthError('PAYMENT_PROVIDER_PENDING');
  }
  if (rule.tender ? input.tenderedVnd < input.amountVnd : input.tenderedVnd !== input.amountVnd) {
    throw new AuthError('VALIDATION_FAILED', 'tenderedVnd');
  }
  const change = input.tenderedVnd - input.amountVnd;
  const completes = input.amountVnd === balance;

  const payment = await tx.payment.create({
    data: {
      invoiceId,
      branchId: invoice.branchId,
      method: input.method,
      status: 'SUCCEEDED',
      amountDueVnd: balance,
      amountVnd: input.amountVnd,
      tenderedVnd: input.tenderedVnd,
      changeVnd: change,
      collectedByUserId: context.actor.userId,
      idempotencyKey: input.idempotencyKey,
    },
    select: { id: true, collectedAt: true },
  });
  // The database clock the guard stamped on the payment is the business time of everything below.
  const now = payment.collectedAt;
  const locked = { ...context, now };
  if (completes) {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'PAID',
        paidAt: now,
        paidSeq: { increment: 1 },
        rowVersion: { increment: 1 },
      },
      select: { id: true },
    });
  }
  const paidAfter = paidBefore + input.amountVnd;
  await appendAdminAudit(locked, {
    action: 'PAYMENT_RECORDED',
    entityType: 'Invoice',
    entityId: invoiceId,
    branchId: hint.branchId,
    classification: 'FINANCIAL',
    before: { status: invoice.status, paidVnd: paidBefore.toString() },
    after: {
      paymentId: payment.id,
      method: input.method,
      amountDueVnd: balance.toString(),
      amountVnd: input.amountVnd.toString(),
      tenderedVnd: input.tenderedVnd.toString(),
      changeVnd: change.toString(),
      collectedByUserId: context.actor.userId,
      paidVnd: paidAfter.toString(),
      balanceVnd: (invoice.totalVnd - paidAfter).toString(),
      status: completes ? 'PAID' : 'PENDING_PAYMENT',
    },
  });
  await appendOutboxEvent(tx, {
    branchId: invoice.branchId,
    aggregateType: 'Payment',
    aggregateId: payment.id,
    eventType: 'PAYMENT_SUCCEEDED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      ...eventBase(invoice),
      paymentId: payment.id,
      method: input.method,
      amountVnd: input.amountVnd.toString(),
    },
  });
  if (completes) {
    const paidSeq = invoice.paidSeq + 1;
    await appendAdminAudit(locked, {
      action: 'INVOICE_PAID',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: { status: 'PENDING_PAYMENT' },
      after: {
        status: 'PAID',
        paidSeq,
        settlement: 'PAYMENT',
        totalVnd: invoice.totalVnd.toString(),
      },
    });
    await appendOutboxEvent(tx, {
      branchId: invoice.branchId,
      aggregateType: 'Invoice',
      aggregateId: invoiceId,
      eventType: 'INVOICE_PAID',
      schemaVersion: 1,
      occurredAt: now,
      payload: {
        ...eventBase(invoice),
        paidSeq,
        totalVnd: invoice.totalVnd.toString(),
        settlement: 'PAYMENT',
      },
    });
  }
  return result(context, invoiceId, payment.id);
}

/**
 * Reverses an erroneous cash payment: `CORRECT_PAYMENTS` at the invoice's branch, a required reason and
 * FRESH password re-authentication (every time). The payment row is never edited: an append-only correction
 * is inserted and the payment stops being effective. If the remaining effective payments no longer cover
 * the receivable, the invoice returns to PENDING_PAYMENT in the same transaction (its paid episode counter
 * is kept; the next completing payment starts a new one). This is a correction, not a refund: it moves no
 * money and no service is refunded. A method whose rule is not reversible (provider-confirmed money) is
 * refused. A zero-balance invoice has no payment, so there is nothing to reverse on it.
 *
 * Idempotency: `payment_corrections.payment_id` is unique. Repeating a reversal the same actor already made
 * returns the current state quietly (no second correction, audit or event); another actor gets
 * `PAYMENT_STATE_INVALID`.
 */
export async function reversePayment(
  context: AdminContext,
  invoiceId: string,
  paymentId: string,
  input: { reason: string },
  freshAuthSeconds: number,
): Promise<PaymentResultResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'CORRECT_PAYMENTS');
  const { tx } = context;
  const invoice: InvoiceRow = await read();
  const payment = invoice.payments.find((entry) => entry.id === paymentId);
  if (!payment) throw new AuthError('NOT_FOUND');
  if (payment.correction) {
    if (payment.correction.actorUserId === context.actor.userId) {
      return result(context, invoiceId, paymentId);
    }
    throw new AuthError('PAYMENT_STATE_INVALID');
  }
  if (payment.status !== 'SUCCEEDED' || !PAYMENT_METHOD_RULES[payment.method].reversible) {
    throw new AuthError('PAYMENT_STATE_INVALID');
  }
  if (invoice.status !== 'PENDING_PAYMENT' && invoice.status !== 'PAID') {
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  // Phase 6 P6-13 (T22): an invoice with a refund keeps its payments and stays paid, so a correction can never double an effect.
  if ((await tx.productRefund.count({ where: { invoiceId } })) > 0) {
    throw new AuthError('INVOICE_HAS_REFUND');
  }
  // Phase 6 P6-14 (T22 extended): the original invoice of an exchange, and the invoice of a completed exchange, keep their payments.
  await assertNoExchangeHold(tx, invoiceId);
  if (!hasFreshReauthentication(context.actor.principal, context.now, freshAuthSeconds)) {
    throw new AuthError('REAUTHENTICATION_REQUIRED');
  }

  const correction = await tx.paymentCorrection.create({
    data: {
      paymentId,
      kind: 'REVERSAL',
      reason: input.reason,
      actorUserId: context.actor.userId,
    },
    select: { id: true, occurredAt: true },
  });
  const now = correction.occurredAt;
  const locked = { ...context, now };
  const paidBefore = effectivePaid(invoice);
  const paidAfter = paidBefore - payment.amountVnd;
  const reopens = invoice.status === 'PAID';
  if (reopens) {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PENDING_PAYMENT', paidAt: null, rowVersion: { increment: 1 } },
      select: { id: true },
    });
  }
  await appendAdminAudit(locked, {
    action: 'PAYMENT_REVERSED',
    entityType: 'Invoice',
    entityId: invoiceId,
    branchId: hint.branchId,
    classification: 'FINANCIAL',
    reason: input.reason,
    before: { status: invoice.status, paidVnd: paidBefore.toString() },
    after: {
      paymentId,
      correctionId: correction.id,
      method: payment.method,
      amountVnd: payment.amountVnd.toString(),
      collectedByUserId: payment.collectedBy.id,
      paidVnd: paidAfter.toString(),
      balanceVnd: (invoice.totalVnd - paidAfter).toString(),
      status: 'PENDING_PAYMENT',
      reauthenticatedAt: context.actor.principal.reauthenticatedAt?.toISOString() ?? null,
    },
  });
  await appendOutboxEvent(tx, {
    branchId: invoice.branchId,
    aggregateType: 'Payment',
    aggregateId: paymentId,
    eventType: 'PAYMENT_REVERSED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      ...eventBase(invoice),
      paymentId,
      correctionId: correction.id,
      method: payment.method,
      amountVnd: payment.amountVnd.toString(),
    },
  });
  if (reopens) {
    await appendAdminAudit(locked, {
      action: 'INVOICE_REOPENED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      reason: input.reason,
      before: { status: 'PAID', paidSeq: invoice.paidSeq },
      after: { status: 'PENDING_PAYMENT', reversedPaidSeq: invoice.paidSeq },
    });
    await appendOutboxEvent(tx, {
      branchId: invoice.branchId,
      aggregateType: 'Invoice',
      aggregateId: invoiceId,
      eventType: 'INVOICE_REOPENED',
      schemaVersion: 1,
      occurredAt: now,
      payload: { ...eventBase(invoice), paidSeq: invoice.paidSeq, reversedPaymentId: paymentId },
    });
  }
  return result(context, invoiceId, paymentId);
}
