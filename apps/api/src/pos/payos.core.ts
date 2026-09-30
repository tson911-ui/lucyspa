import { randomInt } from 'node:crypto';
import type {
  InvoiceResponse,
  PaymentAnomalyListItem,
  PaymentAnomalyListResponse,
  PaymentResultResponse,
} from '@lucy-spa/contracts';
import {
  applyProviderRead,
  endPendingPayment,
  expireStalePending,
  lockInvoiceRow,
  PROVIDER_REQUEST_LIFETIME_MS,
  recordProviderAttempt,
  type ProviderPaymentRequest,
  type ProviderRead,
  type ReadOutcome,
  type SettlementActor,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import {
  anomalyResponse,
  anomalySelect,
  balanceOf,
  databaseClock,
  effectivePaid,
  load,
  lockedInvoice,
} from './invoice.core.js';
import { paymentResult } from './payment.core.js';

/**
 * Phase 4 Step 8: the staff-facing PayOS commands. The PayOS calls themselves happen OUTSIDE any database
 * transaction (a provider call must never hold the invoice lock), so each command is two short transactions
 * around the provider call and the service orchestrates them:
 *
 * - create : `reservePayosRequest` (locks, checks, inserts the PENDING payment) -> provider create ->
 *            `completePayosRequest` (attaches the link, or ends the request).
 * - cancel / refresh : `prepareProviderAction` -> provider cancel/read -> `finishProviderAction`.
 *
 * A crash between the two halves leaves a PENDING request the worker sweep settles from PostgreSQL and the
 * provider (design 16.2). Every command needs COLLECT_PAYMENTS at the invoice's own branch (Owner answer Q7
 * item 4). Nothing here can mark a transfer as received: only `applyProviderRead` (an authoritative provider
 * fact) or a verified notification can make a PayOS payment SUCCEEDED.
 */

const actorOf = (context: AdminContext): SettlementActor => ({
  kind: 'USER',
  userId: context.actor.userId,
  requestId: context.requestId,
});

/** A positive safe integer, time-ordered with a random tail; uniqueness is the database's (unique index). */
function newOrderCode(now: Date): number {
  return now.getTime() * 1000 + randomInt(0, 1000);
}

export type ReserveOutcome =
  | { kind: 'DONE'; result: PaymentResultResponse }
  | { kind: 'CREATED'; paymentId: string; orderCode: number; amountVnd: number; expiresAt: Date };

/**
 * First half of "create a PayOS request": authority, idempotency, the one-pending rule and the amount check,
 * then the PENDING payment row (expires 15 minutes after the database clock, Q7 item 2). The credited amount
 * may be part or all of the remaining balance (Q7 item 7) and never more.
 */
export async function reservePayosRequest(
  context: AdminContext,
  invoiceId: string,
  input: { amountVnd: bigint; idempotencyKey: string },
): Promise<ReserveOutcome> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'COLLECT_PAYMENTS');
  const { tx } = context;
  let invoice = await read();
  const prior = await tx.payment.findUnique({
    where: {
      collectedByUserId_idempotencyKey: {
        collectedByUserId: context.actor.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true, invoiceId: true, method: true, amountVnd: true },
  });
  if (prior) {
    if (
      prior.invoiceId !== invoiceId ||
      prior.method !== 'PAYOS' ||
      prior.amountVnd !== input.amountVnd
    ) {
      throw new AuthError('CONFLICT');
    }
    return { kind: 'DONE', result: await paymentResult(context, invoiceId, prior.id) };
  }
  if (invoice.status !== 'PENDING_PAYMENT') throw new AuthError('INVOICE_STATE_INVALID');
  if (input.amountVnd <= 0n) throw new AuthError('VALIDATION_FAILED', 'amountVnd');

  const now = await databaseClock(tx);
  // A request whose lifetime passed is over: end it so it does not block a new one (Q7 item 3).
  if ((await expireStalePending(tx, actorOf(context), invoice, now)) > 0) invoice = await read();
  if (invoice.payments.some((payment) => payment.status === 'PENDING')) {
    throw new AuthError('PAYMENT_PROVIDER_PENDING');
  }
  const balance = balanceOf(invoice);
  if (input.amountVnd > balance) throw new AuthError('PAYMENT_AMOUNT_INVALID');

  const orderCode = newOrderCode(now);
  const expiresAt = new Date(now.getTime() + PROVIDER_REQUEST_LIFETIME_MS);
  const payment = await tx.payment.create({
    data: {
      invoiceId,
      branchId: invoice.branchId,
      method: 'PAYOS',
      status: 'PENDING',
      amountDueVnd: balance,
      amountVnd: input.amountVnd,
      tenderedVnd: input.amountVnd,
      changeVnd: 0n,
      collectedByUserId: context.actor.userId,
      idempotencyKey: input.idempotencyKey,
      providerOrderCode: BigInt(orderCode),
      expiresAt,
    },
    select: { id: true, collectedAt: true },
  });
  await appendAdminAudit(
    { ...context, now: payment.collectedAt },
    {
      action: 'PAYMENT_PROVIDER_REQUESTED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: { status: invoice.status, paidVnd: effectivePaid(invoice).toString() },
      after: {
        paymentId: payment.id,
        method: 'PAYOS',
        orderCode: String(orderCode),
        amountDueVnd: balance.toString(),
        amountVnd: input.amountVnd.toString(),
        expiresAt: expiresAt.toISOString(),
        collectedByUserId: context.actor.userId,
      },
    },
  );
  return {
    kind: 'CREATED',
    paymentId: payment.id,
    orderCode,
    amountVnd: Number(input.amountVnd),
    expiresAt,
  };
}

export type CreateOutcome =
  | { kind: 'CREATED'; request: ProviderPaymentRequest }
  | { kind: 'REJECTED'; providerCode: string | null }
  | { kind: 'UNREACHABLE' };

/**
 * Second half: what PayOS answered. A created request gets its link details (once); a definitive refusal ends
 * the request FAILED (nothing was created at the provider); an unreachable provider leaves the request
 * PENDING without a link for the worker sweep to settle (the outcome is unknown, so nothing is assumed).
 */
export async function completePayosRequest(
  context: AdminContext,
  invoiceId: string,
  paymentId: string,
  outcome: CreateOutcome,
): Promise<{ result: PaymentResultResponse; failure: 'REJECTED' | 'UNREACHABLE' | null }> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'COLLECT_PAYMENTS');
  const { tx } = context;
  const invoice = await read();
  const payment = invoice.payments.find((entry) => entry.id === paymentId);
  if (!payment) throw new AuthError('NOT_FOUND');
  const actorUserId = context.actor.userId;
  if (outcome.kind === 'CREATED') {
    await recordProviderAttempt(tx, { paymentId, kind: 'CREATE', outcome: 'OK', actorUserId });
    if (payment.status === 'PENDING' && payment.checkoutUrl === null) {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          providerPaymentLinkId: outcome.request.paymentLinkId,
          checkoutUrl: outcome.request.checkoutUrl,
          qrCode: outcome.request.qrCode,
          rowVersion: { increment: 1 },
        },
        select: { id: true },
      });
    }
    return { result: await paymentResult(context, invoiceId, paymentId), failure: null };
  }
  if (outcome.kind === 'UNREACHABLE') {
    await recordProviderAttempt(tx, {
      paymentId,
      kind: 'CREATE',
      outcome: 'UNREACHABLE',
      actorUserId,
    });
    return { result: await paymentResult(context, invoiceId, paymentId), failure: 'UNREACHABLE' };
  }
  await recordProviderAttempt(tx, {
    paymentId,
    kind: 'CREATE',
    outcome: 'REJECTED',
    providerCode: outcome.providerCode,
    actorUserId,
  });
  if (payment.status === 'PENDING') {
    await endPendingPayment(
      tx,
      actorOf(context),
      { ...invoice, branchId: hint.branchId },
      {
        id: paymentId,
        amountVnd: payment.amountVnd,
        providerOrderCode: payment.providerOrderCode,
      },
      'FAILED',
    );
  }
  return { result: await paymentResult(context, invoiceId, paymentId), failure: 'REJECTED' };
}

export type PrepareOutcome =
  { kind: 'DONE'; result: PaymentResultResponse } | { kind: 'PROVIDER'; orderCode: bigint };

/** First half of cancel / refresh: authority and the request's current state (nothing changes). */
export async function prepareProviderAction(
  context: AdminContext,
  invoiceId: string,
  paymentId: string,
): Promise<PrepareOutcome> {
  const { row: read } = await lockedInvoice(context, invoiceId, 'COLLECT_PAYMENTS');
  const invoice = await read();
  const payment = invoice.payments.find((entry) => entry.id === paymentId);
  if (!payment) throw new AuthError('NOT_FOUND');
  if (payment.providerOrderCode === null) throw new AuthError('PAYMENT_REQUEST_STATE_INVALID');
  if (payment.status !== 'PENDING') {
    return { kind: 'DONE', result: await paymentResult(context, invoiceId, paymentId) };
  }
  return { kind: 'PROVIDER', orderCode: payment.providerOrderCode };
}

/**
 * Second half of cancel / refresh: apply what the provider said (`cancelCalled` = the read came from a
 * successful cancel call). The settlement core decides; this command never credits money by itself.
 */
export async function finishProviderAction(
  context: AdminContext,
  invoiceId: string,
  paymentId: string,
  read: ProviderRead,
  options: { cancelCalled: boolean },
): Promise<{ outcome: ReadOutcome; result: PaymentResultResponse }> {
  await lockedInvoice(context, invoiceId, 'COLLECT_PAYMENTS');
  const { tx } = context;
  if (options.cancelCalled) {
    await recordProviderAttempt(tx, {
      paymentId,
      kind: 'CANCEL',
      outcome: 'OK',
      actorUserId: context.actor.userId,
    });
  }
  const outcome = await applyProviderRead(tx, actorOf(context), paymentId, read, {
    reason: 'Cancelled by staff',
  });
  return { outcome, result: await paymentResult(context, invoiceId, paymentId) };
}

// ----------------------------------------------------------------------------- anomalies and notes

/** Open (or all) PayOS anomalies of a branch for management (CORRECT_PAYMENTS at that branch). */
export async function listAnomalies(
  context: AdminContext,
  branchId: string,
  status: 'OPEN' | 'REVIEWED' | undefined,
): Promise<PaymentAnomalyListResponse> {
  if (!decide(context.actor.graph, 'CORRECT_PAYMENTS', { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
  const rows = await context.tx.paymentAnomaly.findMany({
    where: { branchId, ...(status ? { status } : {}) },
    orderBy: [{ openedAt: 'desc' }, { id: 'asc' }],
    take: 200,
    select: {
      ...anomalySelect,
      invoice: { select: { id: true, code: true, status: true, totalVnd: true } },
    },
  });
  return {
    anomalies: rows.map((row): PaymentAnomalyListItem => ({
      ...anomalyResponse(row),
      invoice: {
        id: row.invoice.id,
        code: row.invoice.code,
        status: row.invoice.status,
        totalVnd: row.invoice.totalVnd.toString(),
      },
    })),
  };
}

/**
 * Management records that it looked at an anomaly (CORRECT_PAYMENTS, a note). This moves no money and changes
 * no invoice: the money was never applied, and dealing with it happens outside Lucy Spa (Q6, Q7).
 */
export async function reviewAnomaly(
  context: AdminContext,
  anomalyId: string,
  input: { note: string },
): Promise<PaymentAnomalyListItem> {
  const { tx } = context;
  const hint = await tx.paymentAnomaly.findUnique({
    where: { id: anomalyId },
    select: { branchId: true, invoiceId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  if (
    !decide(context.actor.graph, 'CORRECT_PAYMENTS', { kind: 'BRANCH', branchId: hint.branchId })
  ) {
    throw new AuthError('FORBIDDEN');
  }
  await lockInvoiceRow(tx, hint.invoiceId);
  const current = await tx.paymentAnomaly.findUniqueOrThrow({
    where: { id: anomalyId },
    select: { status: true, kind: true, orderCode: true, providerReference: true },
  });
  if (current.status !== 'OPEN') throw new AuthError('PAYMENT_ANOMALY_REVIEWED');
  const now = await databaseClock(tx);
  await tx.paymentAnomaly.update({
    where: { id: anomalyId },
    data: {
      status: 'REVIEWED',
      reviewedByUserId: context.actor.userId,
      reviewNote: input.note,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'PAYMENT_ANOMALY_REVIEWED',
      entityType: 'Invoice',
      entityId: hint.invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      reason: input.note,
      before: { status: 'OPEN' },
      after: {
        anomalyId,
        kind: current.kind,
        status: 'REVIEWED',
        orderCode: current.orderCode.toString(),
        providerReference: current.providerReference,
      },
    },
  );
  const row = await tx.paymentAnomaly.findUniqueOrThrow({
    where: { id: anomalyId },
    select: {
      ...anomalySelect,
      invoice: { select: { id: true, code: true, status: true, totalVnd: true } },
    },
  });
  return {
    ...anomalyResponse(row),
    invoice: {
      id: row.invoice.id,
      code: row.invoice.code,
      status: row.invoice.status,
      totalVnd: row.invoice.totalVnd.toString(),
    },
  };
}

/**
 * Q7 item 8: a wrong benefit on an invoice settled through PayOS has no in-system correction in V1; the only
 * handling is an audited management note (CORRECT_PAYMENTS). The note changes nothing else.
 */
export async function addManagementNote(
  context: AdminContext,
  invoiceId: string,
  input: { note: string },
): Promise<InvoiceResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'CORRECT_PAYMENTS');
  const { tx } = context;
  const invoice = await read();
  const settledByPayos = invoice.payments.some(
    (payment) => payment.method === 'PAYOS' && payment.status === 'SUCCEEDED',
  );
  if (!settledByPayos) throw new AuthError('INVOICE_NOTE_NOT_ALLOWED');
  const now = await databaseClock(tx);
  const note = await tx.invoiceManagementNote.create({
    data: {
      invoiceId,
      branchId: invoice.branchId,
      authorUserId: context.actor.userId,
      note: input.note,
    },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_MANAGEMENT_NOTE_ADDED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      reason: input.note,
      after: { noteId: note.id, invoiceStatus: invoice.status },
    },
  );
  return load(context, invoiceId);
}
