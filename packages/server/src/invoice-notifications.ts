import {
  parseNotificationParams,
  type NotificationParams,
  type NotificationType,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type DatabaseClient, type Prisma } from '@lucy-spa/database';
import { takeSharedAuthGraphLock } from './auth-lock.js';
import { holdsPermissionAt, resolvePermissionHolders } from './notification-routing.js';

/**
 * Phase 4 Step 10 (Owner answers Q8, design 17.1): in-app notifications for invoice, payment and
 * revenue events. Financial events never use `published_at`; this consumer records its own handling in
 * `outbox_consumptions` (design 15.2).
 */
export const NOTIFICATION_CONSUMER = 'notifications';
export const REVENUE_SUMMARY_DUE_EVENT = 'REVENUE_SUMMARY_DUE';
/** Branch-local time of the daily revenue summary (Q8 item 5). */
export const REVENUE_SUMMARY_LOCAL_TIME = '21:30';

const HANDLED = {
  Invoice: ['INVOICE_PAID', 'INVOICE_CANCELLED'],
  Payment: ['PAYMENT_SUCCEEDED', 'PAYMENT_REVERSED', 'PAYMENT_ANOMALY_FLAGGED'],
  Branch: [REVENUE_SUMMARY_DUE_EVENT],
} as const;
export const FINANCIAL_NOTIFICATION_AGGREGATES = Object.keys(HANDLED) as (keyof typeof HANDLED)[];
export const FINANCIAL_NOTIFICATION_EVENT_TYPES = Object.values(HANDLED).flat() as string[];

/**
 * - `PUBLISHED`: recipients were persisted; consumed.
 * - `SKIPPED`: the event no longer applies or concerns nobody (draft, cash, guest payer, stale paid
 *   episode); consumed, no rows.
 * - `UNROUTABLE`: an exception/summary had no eligible holder; consumed, no rows. Worth logging.
 * - `NOT_CLAIMED`: already consumed by this consumer or locked by another worker; nothing changed.
 * - `IGNORED`: not an event this consumer handles; untouched.
 */
export type FinancialEventOutcome =
  'PUBLISHED' | 'SKIPPED' | 'UNROUTABLE' | 'NOT_CLAIMED' | 'IGNORED';

interface Delivery {
  readonly type: NotificationType;
  readonly recipients: readonly string[];
  readonly entityType: 'Invoice' | 'Branch';
  readonly entityId: string;
  readonly contextCode: string;
  readonly params: NotificationParams | null;
}
type Handled =
  | { readonly outcome: 'SKIPPED' }
  | { readonly outcome: 'UNROUTABLE' }
  | { readonly outcome: 'DELIVER'; readonly deliveries: readonly Delivery[] };
const SKIP: Handled = { outcome: 'SKIPPED' };

type Event = Prisma.OutboxEventGetPayload<object>;

function field(payload: unknown, key: string): unknown {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}
function requiredText(event: Event, key: string): string {
  const value = field(event.payload, key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Financial event ${event.eventType} has no ${key}`);
  }
  return value;
}

/** A customer account that can receive the payer notification (guest payers have no account). */
async function payerRecipient(tx: Prisma.TransactionClient, payerUserId: string | null) {
  if (!payerUserId) return null;
  const payer = await tx.user.findUnique({
    where: { id: payerUserId },
    select: { kind: true, status: true },
  });
  return payer?.kind === 'CUSTOMER' && payer.status === 'ACTIVE' ? payerUserId : null;
}

const invoiceSelect = {
  id: true,
  code: true,
  branchId: true,
  status: true,
  paidSeq: true,
  totalVnd: true,
  payerUserId: true,
  cancelledFromStatus: true,
} satisfies Prisma.InvoiceSelect;

async function loadInvoice(tx: Prisma.TransactionClient, event: Event, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: invoiceSelect });
  if (!invoice || invoice.branchId !== event.branchId) {
    throw new Error(`Financial event ${event.eventType} does not match its invoice`);
  }
  return invoice;
}

const union = (...lists: (readonly string[])[]) => [...new Set(lists.flat())].sort();

async function onInvoicePaid(tx: Prisma.TransactionClient, event: Event): Promise<Handled> {
  const invoice = await loadInvoice(tx, event, event.aggregateId);
  const paidSeq = field(event.payload, 'paidSeq');
  // Only the paid episode this event announces: a later reversal (or a newer episode) supersedes it.
  if (invoice.status !== 'PAID' || invoice.paidSeq !== paidSeq) return SKIP;
  // Phase 6 P6-14: an exchange that costs the customer nothing is settled at once; "paid in full (0 VND)" would only confuse.
  if (
    invoice.totalVnd === 0n &&
    (await tx.productExchange.count({ where: { exchangeInvoiceId: invoice.id } })) > 0
  ) {
    return SKIP;
  }
  const payer = await payerRecipient(tx, invoice.payerUserId);
  if (!payer) return SKIP;
  return {
    outcome: 'DELIVER',
    deliveries: [
      {
        type: 'INVOICE_PAID',
        recipients: [payer],
        entityType: 'Invoice',
        entityId: invoice.id,
        contextCode: invoice.code,
        params: parseNotificationParams('INVOICE_PAID', {
          amountVnd: invoice.totalVnd.toString(),
        }),
      },
    ],
  };
}

async function onInvoiceCancelled(tx: Prisma.TransactionClient, event: Event): Promise<Handled> {
  const invoice = await loadInvoice(tx, event, event.aggregateId);
  const cancelledFrom = field(event.payload, 'cancelledFrom');
  // Nothing for a draft (Q8 item 2); the reason is never part of a notification.
  if (
    invoice.status !== 'CANCELLED' ||
    (cancelledFrom !== 'PENDING_PAYMENT' && cancelledFrom !== 'PAID')
  ) {
    return SKIP;
  }
  const deliveries: Delivery[] = [];
  const payer = await payerRecipient(tx, invoice.payerUserId);
  if (payer) {
    deliveries.push({
      type: 'INVOICE_CANCELLED',
      recipients: [payer],
      entityType: 'Invoice',
      entityId: invoice.id,
      contextCode: invoice.code,
      params: null,
    });
  }
  const managers = await resolvePermissionHolders(tx, {
    branchId: invoice.branchId,
    permission: 'CORRECT_PAYMENTS',
  });
  if (managers.length > 0) {
    deliveries.push({
      type: 'INVOICE_CANCELLED_ALERT',
      recipients: managers,
      entityType: 'Invoice',
      entityId: invoice.id,
      contextCode: invoice.code,
      params: parseNotificationParams('INVOICE_CANCELLED_ALERT', {
        cancelledFrom,
        amountVnd: invoice.totalVnd.toString(),
      }),
    });
  }
  return deliveries.length > 0 ? { outcome: 'DELIVER', deliveries } : { outcome: 'UNROUTABLE' };
}

const paymentSelect = {
  id: true,
  method: true,
  status: true,
  amountVnd: true,
  collectedByUserId: true,
  invoice: { select: { id: true, code: true, branchId: true } },
} satisfies Prisma.PaymentSelect;

async function loadPayment(tx: Prisma.TransactionClient, event: Event, paymentId: string) {
  const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: paymentSelect });
  if (!payment || payment.invoice.branchId !== event.branchId) {
    throw new Error(`Financial event ${event.eventType} does not match its payment`);
  }
  return payment;
}

/** The staff member who created the PayOS request, while they still may collect at that branch. */
async function requestCreator(
  tx: Prisma.TransactionClient,
  payment: { collectedByUserId: string; invoice: { branchId: string } },
) {
  return (await holdsPermissionAt(
    tx,
    payment.collectedByUserId,
    'COLLECT_PAYMENTS',
    payment.invoice.branchId,
  ))
    ? [payment.collectedByUserId]
    : [];
}

async function onPaymentSucceeded(tx: Prisma.TransactionClient, event: Event): Promise<Handled> {
  const payment = await loadPayment(tx, event, event.aggregateId);
  // Cash is recorded by the person standing at the counter: only a PayOS request is announced (Q8 item 3).
  if (payment.method !== 'PAYOS' || payment.status !== 'SUCCEEDED') return SKIP;
  const recipients = await requestCreator(tx, payment);
  if (recipients.length === 0) return SKIP;
  return {
    outcome: 'DELIVER',
    deliveries: [
      {
        type: 'PAYOS_PAYMENT_SUCCEEDED',
        recipients,
        entityType: 'Invoice',
        entityId: payment.invoice.id,
        contextCode: payment.invoice.code,
        params: parseNotificationParams('PAYOS_PAYMENT_SUCCEEDED', {
          amountVnd: payment.amountVnd.toString(),
        }),
      },
    ],
  };
}

async function onAnomaly(tx: Prisma.TransactionClient, event: Event): Promise<Handled> {
  const anomalyId = requiredText(event, 'anomalyId');
  const anomaly = await tx.paymentAnomaly.findUnique({
    where: { id: anomalyId },
    select: {
      kind: true,
      branchId: true,
      paymentId: true,
      expectedAmountVnd: true,
      receivedAmountVnd: true,
      invoice: { select: { id: true, code: true } },
    },
  });
  if (!anomaly || anomaly.branchId !== event.branchId || !anomaly.paymentId) {
    throw new Error('Financial event PAYMENT_ANOMALY_FLAGGED does not match its anomaly');
  }
  const payment = await loadPayment(tx, event, anomaly.paymentId);
  const managers = await resolvePermissionHolders(tx, {
    branchId: anomaly.branchId,
    permission: 'CORRECT_PAYMENTS',
  });
  // One row per person per event: a creator who is also a holder is told once.
  const recipients = union(await requestCreator(tx, payment), managers);
  if (recipients.length === 0) return { outcome: 'UNROUTABLE' };
  return {
    outcome: 'DELIVER',
    deliveries: [
      {
        type: 'PAYOS_PAYMENT_ANOMALY',
        recipients,
        entityType: 'Invoice',
        entityId: anomaly.invoice.id,
        contextCode: anomaly.invoice.code,
        params: parseNotificationParams('PAYOS_PAYMENT_ANOMALY', {
          anomaly: anomaly.kind,
          expectedAmountVnd: anomaly.expectedAmountVnd?.toString() ?? null,
          receivedAmountVnd: anomaly.receivedAmountVnd.toString(),
        }),
      },
    ],
  };
}

async function onPaymentReversed(tx: Prisma.TransactionClient, event: Event): Promise<Handled> {
  const payment = await loadPayment(tx, event, event.aggregateId);
  const correction = await tx.paymentCorrection.findUnique({
    where: { paymentId: payment.id },
    select: { id: true },
  });
  if (!correction) throw new Error('Financial event PAYMENT_REVERSED has no correction');
  const managers = await resolvePermissionHolders(tx, {
    branchId: payment.invoice.branchId,
    permission: 'CORRECT_PAYMENTS',
  });
  if (managers.length === 0) return { outcome: 'UNROUTABLE' };
  return {
    outcome: 'DELIVER',
    deliveries: [
      {
        type: 'PAYMENT_REVERSED',
        recipients: managers,
        entityType: 'Invoice',
        entityId: payment.invoice.id,
        contextCode: payment.invoice.code,
        params: parseNotificationParams('PAYMENT_REVERSED', {
          method: payment.method,
          amountVnd: payment.amountVnd.toString(),
        }),
      },
    ],
  };
}

/**
 * The summary figures of one branch business date, up to the branch-local dispatch instant (21:30), so a
 * retried event always yields the same numbers however late it runs. "Collected" counts effective
 * payments (SUCCEEDED and not reversed) by their collection instant; paid invoices by their paid
 * instant; pending-payment is the branch's finalized-but-unpaid invoices at dispatch.
 */
async function revenueFigures(
  tx: Prisma.TransactionClient,
  branchId: string,
  businessDate: string,
) {
  const [window] = await tx.$queryRaw<{ from: Date; until: Date }[]>`
    SELECT (${businessDate}::date)::timestamp AT TIME ZONE b.timezone AS "from",
           ((${businessDate}::date)::timestamp + time '21:30') AT TIME ZONE b.timezone AS "until"
    FROM branches b WHERE b.id = ${branchId}::uuid`;
  if (!window) throw new Error('Revenue summary branch does not exist');
  const [money] = await tx.$queryRaw<{ total: string; cash: string; payos: string }[]>`
    SELECT COALESCE(SUM(p.amount_vnd), 0)::text AS total,
           COALESCE(SUM(p.amount_vnd) FILTER (WHERE p.method = 'CASH'), 0)::text AS cash,
           COALESCE(SUM(p.amount_vnd) FILTER (WHERE p.method = 'PAYOS'), 0)::text AS payos
    FROM payments p
    WHERE p.branch_id = ${branchId}::uuid AND p.status = 'SUCCEEDED'
      AND NOT EXISTS (SELECT 1 FROM payment_corrections c WHERE c.payment_id = p.id)
      AND p.collected_at >= ${window.from} AND p.collected_at <= ${window.until}`;
  const [counts] = await tx.$queryRaw<{ paid: number; pending: number }[]>`
    SELECT count(*) FILTER (WHERE i.status = 'PAID' AND i.paid_at >= ${window.from}
                              AND i.paid_at <= ${window.until})::int AS paid,
           count(*) FILTER (WHERE i.status = 'PENDING_PAYMENT')::int AS pending
    FROM invoices i WHERE i.branch_id = ${branchId}::uuid`;
  return {
    businessDate,
    totalVnd: money!.total,
    cashVnd: money!.cash,
    payosVnd: money!.payos,
    paidInvoiceCount: counts!.paid,
    pendingPaymentCount: counts!.pending,
  };
}

async function onRevenueSummary(tx: Prisma.TransactionClient, event: Event): Promise<Handled> {
  const businessDate = requiredText(event, 'businessDate');
  const branch = await tx.branch.findUnique({
    where: { id: event.aggregateId },
    select: { id: true, isActive: true },
  });
  if (!branch || branch.id !== event.branchId) {
    throw new Error('Financial event REVENUE_SUMMARY_DUE does not match its branch');
  }
  if (!branch.isActive) return SKIP;
  // Totals reach VIEW_REVENUE holders only (Q8 item 6).
  const holders = await resolvePermissionHolders(tx, {
    branchId: branch.id,
    permission: 'VIEW_REVENUE',
  });
  if (holders.length === 0) return { outcome: 'UNROUTABLE' };
  return {
    outcome: 'DELIVER',
    deliveries: [
      {
        type: 'REVENUE_DAILY_SUMMARY',
        recipients: holders,
        entityType: 'Branch',
        entityId: branch.id,
        contextCode: businessDate,
        params: parseNotificationParams(
          'REVENUE_DAILY_SUMMARY',
          await revenueFigures(tx, branch.id, businessDate),
        ),
      },
    ],
  };
}

const HANDLERS: Record<string, (tx: Prisma.TransactionClient, event: Event) => Promise<Handled>> = {
  INVOICE_PAID: onInvoicePaid,
  INVOICE_CANCELLED: onInvoiceCancelled,
  PAYMENT_SUCCEEDED: onPaymentSucceeded,
  PAYMENT_REVERSED: onPaymentReversed,
  PAYMENT_ANOMALY_FLAGGED: onAnomaly,
  [REVENUE_SUMMARY_DUE_EVENT]: onRevenueSummary,
};

/**
 * Consumes ONE financial outbox event inside the caller's transaction:
 *
 * 1. shared authorization-graph lock, then claim the event with `FOR UPDATE SKIP LOCKED` while this
 *    consumer has no consumption row for it (`published_at` is never used);
 * 2. validate the event and re-read the authoritative rows by id (payloads carry ids only);
 * 3. resolve recipients through the permission engine (payer / request creator / permission holders at
 *    the invoice's branch, never role names) and insert the inbox rows (`skipDuplicates`, so
 *    `unique(source_event_id, recipient_user_id)` makes a re-run harmless and never resets read state);
 * 4. insert the consumption row LAST.
 *
 * Any throw rolls everything back and the event stays pending for retry. A second consumer would have
 * its own consumption row and never affects this one.
 */
export async function processFinancialNotificationEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<FinancialEventOutcome> {
  await takeSharedAuthGraphLock(tx);
  const claimed = await tx.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM outbox_events e
    WHERE e.id = ${eventId}::uuid
      AND NOT EXISTS (SELECT 1 FROM outbox_consumptions c
                      WHERE c.event_id = e.id AND c.consumer = ${NOTIFICATION_CONSUMER})
    FOR UPDATE OF e SKIP LOCKED`;
  if (claimed.length === 0) return 'NOT_CLAIMED';
  const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
  const handler = HANDLERS[event.eventType];
  const aggregates: readonly string[] = FINANCIAL_NOTIFICATION_AGGREGATES;
  if (!handler || !aggregates.includes(event.aggregateType) || event.branchId === null) {
    return 'IGNORED';
  }
  if (event.schemaVersion !== 1) throw new Error('Unsupported financial event version');

  const handled = await handler(tx, event);
  if (handled.outcome === 'DELIVER') {
    for (const delivery of handled.deliveries) {
      await tx.notification.createMany({
        skipDuplicates: true,
        data: delivery.recipients.map((recipientUserId) => ({
          recipientUserId,
          sourceEventId: event.id,
          branchId: event.branchId,
          type: delivery.type,
          entityType: delivery.entityType,
          entityId: delivery.entityId,
          contextCode: delivery.contextCode,
          actionAt: event.occurredAt,
          ...(delivery.params === null
            ? {}
            : { params: delivery.params as unknown as Prisma.InputJsonObject }),
        })),
      });
    }
  }
  const outcome = handled.outcome === 'DELIVER' ? 'PUBLISHED' : handled.outcome;
  await tx.outboxConsumption.create({
    data: { eventId: event.id, consumer: NOTIFICATION_CONSUMER, outcome },
  });
  return outcome;
}

/**
 * Appends the day's REVENUE_SUMMARY_DUE event for every active branch whose local time has reached 21:30 and
 * that has none yet for its local date. Idempotent (a partial unique index backs the check), so a worker
 * restart or a second worker never produces a second summary. A day whose 21:30 passed while nothing ran is
 * still caught up until local midnight. Returns the number of events appended.
 */
export async function scheduleRevenueSummaries(
  database: DatabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const due = await database.$queryRaw<{ id: string; businessDate: string }[]>`
    SELECT b.id::text AS id, to_char(${now}::timestamptz AT TIME ZONE b.timezone, 'YYYY-MM-DD') AS "businessDate"
    FROM branches b
    WHERE b.is_active
      AND (${now}::timestamptz AT TIME ZONE b.timezone)::time >= ${REVENUE_SUMMARY_LOCAL_TIME}::time
      AND NOT EXISTS (
        SELECT 1 FROM outbox_events e
        WHERE e.event_type = ${REVENUE_SUMMARY_DUE_EVENT} AND e.aggregate_id = b.id::text
          AND e.payload ->> 'businessDate' = to_char(${now}::timestamptz AT TIME ZONE b.timezone, 'YYYY-MM-DD'))`;
  let appended = 0;
  for (const branch of due) {
    try {
      await database.$transaction((tx) =>
        appendOutboxEvent(tx, {
          branchId: branch.id,
          aggregateType: 'Branch',
          aggregateId: branch.id,
          eventType: REVENUE_SUMMARY_DUE_EVENT,
          schemaVersion: 1,
          payload: { businessDate: branch.businessDate },
        }),
      );
      appended += 1;
    } catch (error) {
      // A concurrent scheduler won the unique index: harmless. Anything else is real.
      const code =
        typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
      if (code !== 'P2002') throw error;
    }
  }
  return appended;
}
