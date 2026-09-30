import { randomUUID } from 'node:crypto';
import {
  appendOutboxEvent,
  type DatabaseClient,
  type PaymentAnomalyKind,
  type PaymentAttemptKind,
  type PaymentAttemptOutcome,
  type Prisma,
} from '@lucy-spa/database';
import {
  ProviderRejectedError,
  ProviderUnavailableError,
  type PaymentProvider,
  type ProviderPaymentSnapshot,
  type VerifiedProviderNotification,
} from './payment-provider.js';

/**
 * Phase 4 Step 8: how a PayOS payment reaches its final state. This is the ONLY place where a provider
 * payment becomes SUCCEEDED, and it does so only from an authentic provider fact (a verified notification or
 * an authoritative status read), never from a staff action. The API (webhook, on-demand status read, cancel)
 * and the worker (sweep) share it, so every path obeys the same rules (design 16.2, Owner answers Q7):
 *
 * - APPLIED: the provider confirmed exactly the requested amount, the invoice still awaits payment and the
 *   confirmed amount fits inside the remaining balance. A pending request becomes SUCCEEDED; a request that
 *   had already ended (expired / cancelled / failed) gets a NEW succeeded row that points at it (late
 *   confirmation, Q7 item 5). The payment that reaches the receivable settles the invoice.
 * - ANOMALY: the amount differs (Q7 item 6), the invoice is already paid/cancelled (Q7 item 5) or the amount no
 *   longer fits the balance. Nothing is credited; an open anomaly is flagged for management review.
 * - IGNORED: unknown order, or the order was already applied (replay).
 *
 * Lock order (design 14): the invoice row first, then its payments. Every timestamp is the database clock.
 * A provider payment is never reversed (Q6): there is no reversal path for it anywhere.
 */

export type SettlementActor =
  | { readonly kind: 'SYSTEM' }
  | { readonly kind: 'USER'; readonly userId: string; readonly requestId?: string | null };

export interface ProviderConfirmation {
  readonly orderCode: bigint;
  readonly amountVnd: bigint;
  readonly reference: string;
  readonly source: 'WEBHOOK' | 'STATUS_READ';
  readonly providerEventId: string | null;
}

export type SettlementResult =
  | {
      readonly outcome: 'APPLIED';
      readonly paymentId: string;
      readonly invoiceId: string;
      readonly completed: boolean;
      readonly late: boolean;
    }
  | {
      readonly outcome: 'IGNORED';
      readonly detail: 'UNKNOWN_ORDER' | 'ALREADY_APPLIED' | 'NOT_SUCCESS';
    }
  | {
      readonly outcome: 'ANOMALY';
      readonly kind: PaymentAnomalyKind;
      readonly anomalyId: string;
      readonly invoiceId: string;
      readonly paymentId: string;
    };

/** The lifetime of a PayOS request (Owner answer Q7 item 2). */
export const PROVIDER_REQUEST_LIFETIME_MS = 15 * 60_000;

export async function providerClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!clock) throw new Error('The database clock is unavailable.');
  return clock.now;
}

export async function lockInvoiceRow(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
}

/** Credited amount that still counts (the same function the database guards use). */
export async function effectivePaidVnd(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<bigint> {
  const [row] = await tx.$queryRaw<
    { paid: bigint }[]
  >`SELECT lucy_invoice_effective_paid(${invoiceId}::uuid)::bigint AS paid`;
  return row?.paid ?? 0n;
}

interface InvoiceFacts {
  readonly id: string;
  readonly branchId: string;
  readonly visitId: string;
  readonly status: 'DRAFT' | 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  readonly totalVnd: bigint;
  readonly paidSeq: number;
}

const invoiceFacts = {
  id: true,
  branchId: true,
  visitId: true,
  status: true,
  totalVnd: true,
  paidSeq: true,
} satisfies Prisma.InvoiceSelect;

const eventBase = (invoice: InvoiceFacts) => ({
  invoiceId: invoice.id,
  branchId: invoice.branchId,
  visitId: invoice.visitId,
});

async function audit(
  tx: Prisma.TransactionClient,
  actor: SettlementActor,
  at: Date,
  event: {
    action: string;
    invoice: InvoiceFacts;
    reason?: string;
    before?: Prisma.InputJsonObject;
    after?: Prisma.InputJsonObject;
  },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      action: event.action,
      actorKind: actor.kind,
      actorUserId: actor.kind === 'USER' ? actor.userId : null,
      entityType: 'Invoice',
      entityId: event.invoice.id,
      branchId: event.invoice.branchId,
      requestId: actor.kind === 'USER' ? (actor.requestId ?? null) : null,
      occurredAt: at,
      reason: event.reason ?? null,
      ...(event.before ? { before: event.before } : {}),
      ...(event.after ? { after: event.after } : {}),
      dataClassification: 'FINANCIAL',
    },
    select: { id: true },
  });
}

/** One row per request sent to (or read from) the provider. Never a payload, never a credential. */
export async function recordProviderAttempt(
  tx: Prisma.TransactionClient,
  input: {
    paymentId: string;
    kind: PaymentAttemptKind;
    outcome: PaymentAttemptOutcome;
    providerCode?: string | null;
    actorUserId?: string | null;
  },
): Promise<void> {
  await tx.paymentAttempt.create({
    data: {
      paymentId: input.paymentId,
      kind: input.kind,
      outcome: input.outcome,
      providerCode: input.providerCode ?? null,
      actorUserId: input.actorUserId ?? null,
    },
    select: { id: true },
  });
}

interface PendingPayment {
  readonly id: string;
  readonly amountVnd: bigint;
  readonly providerOrderCode: bigint | null;
}

/**
 * Ends a PENDING provider payment without money (`EXPIRED`, `CANCELLED` or `FAILED`). Call under the
 * invoice lock after re-reading the payment as still PENDING.
 */
export async function endPendingPayment(
  tx: Prisma.TransactionClient,
  actor: SettlementActor,
  invoice: InvoiceFacts,
  payment: PendingPayment,
  status: 'EXPIRED' | 'CANCELLED' | 'FAILED',
  options: { reason?: string; at?: Date } = {},
): Promise<void> {
  const at = options.at ?? (await providerClock(tx));
  await tx.payment.update({
    where: { id: payment.id },
    data: { status, rowVersion: { increment: 1 } },
    select: { id: true },
  });
  const action =
    status === 'EXPIRED'
      ? 'PAYMENT_PROVIDER_EXPIRED'
      : status === 'CANCELLED'
        ? 'PAYMENT_PROVIDER_CANCELLED'
        : 'PAYMENT_PROVIDER_FAILED';
  await audit(tx, actor, at, {
    action,
    invoice,
    ...(options.reason ? { reason: options.reason } : {}),
    before: { status: 'PENDING' },
    after: {
      paymentId: payment.id,
      method: 'PAYOS',
      status,
      amountVnd: payment.amountVnd.toString(),
      orderCode: payment.providerOrderCode?.toString() ?? null,
    },
  });
  if (status !== 'CANCELLED') {
    await appendOutboxEvent(tx, {
      branchId: invoice.branchId,
      aggregateType: 'Payment',
      aggregateId: payment.id,
      eventType: status === 'EXPIRED' ? 'PAYMENT_EXPIRED' : 'PAYMENT_FAILED',
      schemaVersion: 1,
      occurredAt: at,
      payload: {
        ...eventBase(invoice),
        paymentId: payment.id,
        method: 'PAYOS',
        amountVnd: payment.amountVnd.toString(),
      },
    });
  }
}

/**
 * Expires every provider request of the invoice whose lifetime has passed (Q7 item 2). The provider link
 * expires by itself at the same instant; a confirmation that still arrives is a late confirmation. Run under
 * the invoice lock. Returns the number of requests ended.
 */
export async function expireStalePending(
  tx: Prisma.TransactionClient,
  actor: SettlementActor,
  invoice: InvoiceFacts,
  now: Date,
): Promise<number> {
  const stale = await tx.payment.findMany({
    where: { invoiceId: invoice.id, status: 'PENDING', expiresAt: { lte: now } },
    select: { id: true, amountVnd: true, providerOrderCode: true },
  });
  for (const payment of stale) {
    await endPendingPayment(tx, actor, invoice, payment, 'EXPIRED', { at: now });
  }
  return stale.length;
}

async function flagAnomaly(
  tx: Prisma.TransactionClient,
  actor: SettlementActor,
  invoice: InvoiceFacts,
  payment: PendingPayment & { status: string },
  confirmation: ProviderConfirmation,
  kind: PaymentAnomalyKind,
  now: Date,
): Promise<SettlementResult> {
  const existing = await tx.paymentAnomaly.findUnique({
    where: {
      orderCode_providerReference: {
        orderCode: confirmation.orderCode,
        providerReference: confirmation.reference,
      },
    },
    select: { id: true, kind: true },
  });
  if (existing) {
    return {
      outcome: 'ANOMALY',
      kind: existing.kind,
      anomalyId: existing.id,
      invoiceId: invoice.id,
      paymentId: payment.id,
    };
  }
  const anomaly = await tx.paymentAnomaly.create({
    data: {
      kind,
      invoiceId: invoice.id,
      paymentId: payment.id,
      branchId: invoice.branchId,
      providerEventId: confirmation.providerEventId,
      orderCode: confirmation.orderCode,
      providerReference: confirmation.reference,
      expectedAmountVnd: payment.amountVnd,
      receivedAmountVnd: confirmation.amountVnd,
      invoiceStatus: invoice.status,
    },
    select: { id: true },
  });
  // The confirmed money was NOT applied, so the request that expected it can no longer complete.
  if (payment.status === 'PENDING') {
    await endPendingPayment(tx, actor, invoice, payment, 'FAILED', { at: now });
  }
  await audit(tx, actor, now, {
    action: 'PAYMENT_ANOMALY_FLAGGED',
    invoice,
    after: {
      anomalyId: anomaly.id,
      kind,
      paymentId: payment.id,
      orderCode: confirmation.orderCode.toString(),
      providerReference: confirmation.reference,
      expectedAmountVnd: payment.amountVnd.toString(),
      receivedAmountVnd: confirmation.amountVnd.toString(),
      invoiceStatus: invoice.status,
      source: confirmation.source,
    },
  });
  await appendOutboxEvent(tx, {
    branchId: invoice.branchId,
    aggregateType: 'Payment',
    aggregateId: payment.id,
    eventType: 'PAYMENT_ANOMALY_FLAGGED',
    schemaVersion: 1,
    occurredAt: now,
    payload: { ...eventBase(invoice), paymentId: payment.id, anomalyId: anomaly.id, kind },
  });
  return {
    outcome: 'ANOMALY',
    kind,
    anomalyId: anomaly.id,
    invoiceId: invoice.id,
    paymentId: payment.id,
  };
}

/**
 * Applies one authentic provider confirmation. See the module comment for the rules. Idempotent: a replay of
 * an applied order is IGNORED, a replay of a flagged confirmation returns the same anomaly.
 */
export async function applyProviderConfirmation(
  tx: Prisma.TransactionClient,
  actor: SettlementActor,
  confirmation: ProviderConfirmation,
): Promise<SettlementResult> {
  const original = await tx.payment.findFirst({
    where: { providerOrderCode: confirmation.orderCode, lateOfPaymentId: null },
    select: { id: true, invoiceId: true },
  });
  if (!original) return { outcome: 'IGNORED', detail: 'UNKNOWN_ORDER' };

  await lockInvoiceRow(tx, original.invoiceId);
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: original.invoiceId },
    select: invoiceFacts,
  });
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: original.id },
    select: {
      id: true,
      status: true,
      amountVnd: true,
      providerOrderCode: true,
      collectedByUserId: true,
      expiresAt: true,
    },
  });
  const applied = await tx.payment.findFirst({
    where: { providerOrderCode: confirmation.orderCode, status: 'SUCCEEDED' },
    select: { id: true },
  });
  if (applied) return { outcome: 'IGNORED', detail: 'ALREADY_APPLIED' };

  const now = await providerClock(tx);
  const paidBefore = await effectivePaidVnd(tx, invoice.id);
  const balance = invoice.status === 'PENDING_PAYMENT' ? invoice.totalVnd - paidBefore : 0n;
  // Q7 item 6: a different amount never marks anything paid. Q7 item 5: a fully paid (or cancelled) invoice
  // never auto-applies. The amount must also still fit the balance (another payment may have used it).
  const anomaly: PaymentAnomalyKind | null =
    confirmation.amountVnd !== payment.amountVnd
      ? 'AMOUNT_MISMATCH'
      : invoice.status !== 'PENDING_PAYMENT'
        ? 'INVOICE_NOT_PAYABLE'
        : confirmation.amountVnd > balance
          ? 'EXCEEDS_BALANCE'
          : null;
  if (anomaly) return flagAnomaly(tx, actor, invoice, payment, confirmation, anomaly, now);

  const late = payment.status !== 'PENDING';
  let paymentId: string;
  if (!late) {
    // The database guard stamps the collection time (the confirmation instant) and needs the reference.
    const confirmed = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        providerReference: confirmation.reference,
        rowVersion: { increment: 1 },
      },
      select: { id: true },
    });
    paymentId = confirmed.id;
  } else {
    // Q7 item 5: the request had ended but money arrived and a balance remains -> record it (a new row).
    const created = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        branchId: invoice.branchId,
        method: 'PAYOS',
        status: 'SUCCEEDED',
        amountDueVnd: balance,
        amountVnd: confirmation.amountVnd,
        tenderedVnd: confirmation.amountVnd,
        changeVnd: 0n,
        collectedByUserId: payment.collectedByUserId,
        idempotencyKey: randomUUID(),
        providerOrderCode: confirmation.orderCode,
        expiresAt: payment.expiresAt,
        providerReference: confirmation.reference,
        lateOfPaymentId: payment.id,
      },
      select: { id: true },
    });
    paymentId = created.id;
  }
  const confirmedRow = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { collectedAt: true },
  });
  const at = confirmedRow.collectedAt;
  const paidAfter = paidBefore + confirmation.amountVnd;
  const completes = paidAfter === invoice.totalVnd;
  if (completes) {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: at, paidSeq: { increment: 1 }, rowVersion: { increment: 1 } },
      select: { id: true },
    });
  }
  await audit(tx, actor, at, {
    action: 'PAYMENT_PROVIDER_CONFIRMED',
    invoice,
    before: { status: invoice.status, paidVnd: paidBefore.toString() },
    after: {
      paymentId,
      method: 'PAYOS',
      orderCode: confirmation.orderCode.toString(),
      providerReference: confirmation.reference,
      amountVnd: confirmation.amountVnd.toString(),
      amountDueVnd: balance.toString(),
      late,
      source: confirmation.source,
      paidVnd: paidAfter.toString(),
      balanceVnd: (invoice.totalVnd - paidAfter).toString(),
      status: completes ? 'PAID' : 'PENDING_PAYMENT',
    },
  });
  await appendOutboxEvent(tx, {
    branchId: invoice.branchId,
    aggregateType: 'Payment',
    aggregateId: paymentId,
    eventType: 'PAYMENT_SUCCEEDED',
    schemaVersion: 1,
    occurredAt: at,
    payload: {
      ...eventBase(invoice),
      paymentId,
      method: 'PAYOS',
      amountVnd: confirmation.amountVnd.toString(),
    },
  });
  if (completes) {
    const paidSeq = invoice.paidSeq + 1;
    await audit(tx, actor, at, {
      action: 'INVOICE_PAID',
      invoice,
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
      aggregateId: invoice.id,
      eventType: 'INVOICE_PAID',
      schemaVersion: 1,
      occurredAt: at,
      payload: {
        ...eventBase(invoice),
        paidSeq,
        totalVnd: invoice.totalVnd.toString(),
        settlement: 'PAYMENT',
      },
    });
  }
  return { outcome: 'APPLIED', paymentId, invoiceId: invoice.id, completed: completes, late };
}

export type NotificationResult =
  { readonly duplicate: true } | { readonly duplicate: false; readonly result: SettlementResult };

/**
 * One AUTHENTIC provider notification (the caller verified the signature): dedupe by the provider's
 * transaction, apply through the settlement rules and record the inbox row in the SAME transaction. A
 * concurrent duplicate that loses the race hits the unique dedupe key and rolls back harmlessly.
 */
export async function processProviderNotification(
  tx: Prisma.TransactionClient,
  notification: VerifiedProviderNotification,
): Promise<NotificationResult> {
  const dedupeKey = `PAYOS:${notification.orderCode}:${notification.reference}`;
  const seen = await tx.paymentProviderEvent.findUnique({
    where: { dedupeKey },
    select: { id: true },
  });
  if (seen) return { duplicate: true };
  const eventId = randomUUID();
  const orderCode = BigInt(notification.orderCode);
  const result: SettlementResult = notification.success
    ? await applyProviderConfirmation(
        tx,
        { kind: 'SYSTEM' },
        {
          orderCode,
          amountVnd: BigInt(notification.amountVnd),
          reference: notification.reference,
          source: 'WEBHOOK',
          providerEventId: eventId,
        },
      )
    : { outcome: 'IGNORED', detail: 'NOT_SUCCESS' };
  const detail =
    result.outcome === 'APPLIED'
      ? result.late
        ? 'APPLIED_LATE'
        : 'APPLIED'
      : result.outcome === 'ANOMALY'
        ? result.kind
        : result.detail;
  await tx.paymentProviderEvent.create({
    data: {
      id: eventId,
      dedupeKey,
      signatureValid: true,
      orderCode,
      amountVnd: BigInt(notification.amountVnd),
      providerReference: notification.reference,
      rawPayload: notification.payload,
      outcome: result.outcome,
      outcomeDetail: detail,
      paymentId:
        result.outcome === 'APPLIED' || result.outcome === 'ANOMALY' ? result.paymentId : null,
    },
    select: { id: true },
  });
  return { duplicate: false, result };
}

// ------------------------------------------------------------------ authoritative status reads

/** What an authoritative status read of one request found. */
export type ProviderRead =
  | { readonly kind: 'SNAPSHOT'; readonly snapshot: ProviderPaymentSnapshot }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'REJECTED'; readonly providerCode: string | null }
  | { readonly kind: 'UNAVAILABLE' };

/** Reads the provider's view of an order, translating the two failure kinds. Never touches the database. */
export async function readProvider(
  provider: PaymentProvider,
  orderCode: bigint,
): Promise<ProviderRead> {
  try {
    return { kind: 'SNAPSHOT', snapshot: await provider.getPaymentRequest(Number(orderCode)) };
  } catch (error) {
    if (error instanceof ProviderRejectedError) {
      return error.notFound
        ? { kind: 'NOT_FOUND' }
        : { kind: 'REJECTED', providerCode: error.providerCode };
    }
    if (error instanceof ProviderUnavailableError) return { kind: 'UNAVAILABLE' };
    throw error;
  }
}

export type ReadOutcome = 'APPLIED' | 'ANOMALY' | 'ENDED' | 'UNCHANGED' | 'UNAVAILABLE';

/**
 * Applies a status read to a still-PENDING request, under the invoice lock: PAID -> confirmation rules,
 * CANCELLED/EXPIRED/not found at the provider -> the request ends without money, still PENDING after its
 * lifetime -> EXPIRED locally (a later confirmation is then a late confirmation). Anything else changes nothing.
 */
export async function applyProviderRead(
  tx: Prisma.TransactionClient,
  actor: SettlementActor,
  paymentId: string,
  read: ProviderRead,
  options: { reason?: string } = {},
): Promise<ReadOutcome> {
  const hint = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { invoiceId: true },
  });
  if (!hint) return 'UNCHANGED';
  await lockInvoiceRow(tx, hint.invoiceId);
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: hint.invoiceId },
    select: invoiceFacts,
  });
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      amountVnd: true,
      providerOrderCode: true,
      expiresAt: true,
      collectedByUserId: true,
    },
  });
  const actorUserId = actor.kind === 'USER' ? actor.userId : null;
  if (read.kind === 'UNAVAILABLE') {
    await recordProviderAttempt(tx, {
      paymentId,
      kind: 'STATUS_READ',
      outcome: 'UNREACHABLE',
      actorUserId,
    });
    return 'UNAVAILABLE';
  }
  if (read.kind === 'REJECTED') {
    await recordProviderAttempt(tx, {
      paymentId,
      kind: 'STATUS_READ',
      outcome: 'REJECTED',
      providerCode: read.providerCode,
      actorUserId,
    });
    return 'UNCHANGED';
  }
  if (payment.status !== 'PENDING' || payment.providerOrderCode === null) return 'UNCHANGED';
  const now = await providerClock(tx);

  if (read.kind === 'NOT_FOUND') {
    await recordProviderAttempt(tx, {
      paymentId,
      kind: 'STATUS_READ',
      outcome: 'REJECTED',
      providerCode: 'NOT_FOUND',
      actorUserId,
    });
    await endPendingPayment(tx, actor, invoice, payment, 'FAILED', { at: now });
    return 'ENDED';
  }

  const { snapshot } = read;
  await recordProviderAttempt(tx, { paymentId, kind: 'STATUS_READ', outcome: 'OK', actorUserId });
  if (snapshot.status === 'PAID') {
    // Without the transfer reference there is nothing authentic to record yet; the webhook will carry it.
    if (!snapshot.reference || snapshot.amountPaidVnd <= 0) return 'UNCHANGED';
    const result = await applyProviderConfirmation(tx, actor, {
      orderCode: payment.providerOrderCode,
      amountVnd: BigInt(snapshot.amountPaidVnd),
      reference: snapshot.reference,
      source: 'STATUS_READ',
      providerEventId: null,
    });
    return result.outcome === 'APPLIED'
      ? 'APPLIED'
      : result.outcome === 'ANOMALY'
        ? 'ANOMALY'
        : 'UNCHANGED';
  }
  if (snapshot.status === 'CANCELLED' || snapshot.status === 'EXPIRED') {
    await endPendingPayment(tx, actor, invoice, payment, snapshot.status, {
      at: now,
      ...(options.reason ? { reason: options.reason } : {}),
    });
    return 'ENDED';
  }
  // Still pending at the provider: our own lifetime decides (the link expires at the same instant).
  if (payment.expiresAt && payment.expiresAt <= now) {
    await endPendingPayment(tx, actor, invoice, payment, 'EXPIRED', { at: now });
    return 'ENDED';
  }
  return 'UNCHANGED';
}

/** Requests whose outcome the worker must settle: past their lifetime, or without link details for a while. */
export const RECONCILE_LINKLESS_AFTER_MS = 60_000;
/** Pending requests are re-read this often even while the webhook is expected to arrive. */
export const RECONCILE_POLL_AFTER_MS = 90_000;

export interface ReconcileSummary {
  readonly examined: number;
  readonly applied: number;
  readonly ended: number;
  readonly anomalies: number;
  readonly unavailable: number;
}

/**
 * The worker sweep (design 16.2: a missed webhook is recovered by reconciliation). Database-authoritative:
 * it selects PENDING provider payments straight from PostgreSQL (never from Redis) and settles each in its own
 * transaction, so one failure never blocks another. A request that never received its link details (the API
 * crashed between insert and provider answer) is cancelled at the provider first and then ended.
 */
export async function reconcilePendingPayments(
  database: DatabaseClient,
  provider: PaymentProvider,
  options: { now?: Date; limit?: number } = {},
): Promise<ReconcileSummary> {
  const now = options.now ?? new Date();
  const pending = await database.payment.findMany({
    where: {
      status: 'PENDING',
      method: 'PAYOS',
      providerOrderCode: { not: null },
      OR: [
        { expiresAt: { lte: now } },
        { createdAt: { lte: new Date(now.getTime() - RECONCILE_POLL_AFTER_MS) } },
        {
          checkoutUrl: null,
          createdAt: { lte: new Date(now.getTime() - RECONCILE_LINKLESS_AFTER_MS) },
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 50,
    select: { id: true, providerOrderCode: true, checkoutUrl: true },
  });
  let applied = 0;
  let ended = 0;
  let anomalies = 0;
  let unavailable = 0;
  for (const payment of pending) {
    if (payment.providerOrderCode === null) continue;
    try {
      let read = await readProvider(provider, payment.providerOrderCode);
      if (
        payment.checkoutUrl === null &&
        read.kind === 'SNAPSHOT' &&
        read.snapshot.status === 'PENDING'
      ) {
        // A link nobody was ever shown: close it at the provider before we end the request locally.
        try {
          read = {
            kind: 'SNAPSHOT',
            snapshot: await provider.cancelPaymentRequest(
              Number(payment.providerOrderCode),
              'Request was never completed',
            ),
          };
        } catch {
          read = await readProvider(provider, payment.providerOrderCode);
        }
      }
      const outcome = await database.$transaction(
        (tx) => applyProviderRead(tx, { kind: 'SYSTEM' }, payment.id, read),
        { timeout: 30_000 },
      );
      if (outcome === 'APPLIED') applied++;
      else if (outcome === 'ENDED') ended++;
      else if (outcome === 'ANOMALY') anomalies++;
      else if (outcome === 'UNAVAILABLE') unavailable++;
    } catch {
      unavailable++;
    }
  }
  return { examined: pending.length, applied, ended, anomalies, unavailable };
}
