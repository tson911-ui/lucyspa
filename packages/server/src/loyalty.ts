import {
  loyaltyPointsForPaidVnd,
  type LoyaltyLedgerKindName,
  type LoyaltyWalletName,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type DatabaseClient, type Prisma } from '@lucy-spa/database';
import { takeSharedAuthGraphLock } from './auth-lock.js';

/**
 * Phase 5 P5-3: points and tiers (design sections 3, 4 and 11-12). One append-only ledger per customer and
 * wallet; the balance cache is updated in the same transaction under the wallet row lock and always equals the
 * sum of the ledger (SQL re-checks it at commit). Nothing here ever edits or deletes a ledger entry: a
 * reversal, correction or adjustment is a new linked entry (PRD 18.4).
 */
export const LOYALTY_CONSUMER = 'loyalty';
export const LOYALTY_AGGREGATE = 'LoyaltyLedgerEntry';
export const LOYALTY_EVENT_TYPES = ['INVOICE_PAID', 'INVOICE_REOPENED', 'INVOICE_CANCELLED'];

/**
 * - `APPLIED`: a ledger entry was written (earn or reversal).
 * - `SKIPPED_GUEST`: the payer is a guest, nobody earns (P5-Q2).
 * - `SKIPPED_PRE_GO_LIVE`: loyalty is off, or the episode was paid before go-live (P5-Q1, no backfill).
 * - `SKIPPED_STALE`: the paid episode is no longer the invoice's current one (P5-T9).
 * - `SKIPPED_NOT_MEMBER`: the payer is not a customer account (never throws, so it never retries forever).
 * - `NOOP`: nothing to do (0 points, no earn entry to reverse, or the entry already exists).
 * - `NOT_CLAIMED`: already consumed by this consumer or locked by another worker; nothing changed.
 * - `IGNORED`: not an event this consumer handles; untouched.
 */
export type LoyaltyEventOutcome =
  | 'APPLIED'
  | 'SKIPPED_GUEST'
  | 'SKIPPED_PRE_GO_LIVE'
  | 'SKIPPED_STALE'
  | 'SKIPPED_NOT_MEMBER'
  | 'NOOP'
  | 'NOT_CLAIMED'
  | 'IGNORED';

export const earnKey = (wallet: LoyaltyWalletName, invoiceId: string, paidSeq: number): string =>
  `${wallet}_EARN:${invoiceId}:${paidSeq}`;
export const reversalKey = (earnEntryId: string): string => `EARN_REVERSAL:${earnEntryId}`;

export interface LedgerEffect {
  readonly userId: string;
  readonly wallet: LoyaltyWalletName;
  readonly kind: Exclude<LoyaltyLedgerKindName, 'REFERRAL_AWARD'>;
  /** Signed requested points, never 0. A negative request is clamped to the balance (P5-Q5, P5-T8). */
  readonly points: number;
  readonly idempotencyKey: string;
  readonly invoiceId?: string;
  readonly paidSeq?: number;
  readonly reversesEntryId?: string;
  readonly correctsEntryId?: string;
  readonly reason?: string;
  readonly actorUserId?: string;
  readonly branchId?: string | null;
}

export interface LedgerResult {
  readonly entryId: string;
  /** Signed points that changed the balance (0 when the whole request was a shortfall). */
  readonly applied: number;
  readonly shortfall: number;
  readonly balanceAfter: number;
  /** False when the idempotency key already existed: the stored result is returned, nothing is written. */
  readonly created: boolean;
  readonly existingKind: LoyaltyLedgerKindName | null;
  readonly existingUserId: string | null;
  readonly existingWallet: LoyaltyWalletName | null;
  readonly existingRequested: number | null;
}

const ledgerEvents: Record<LedgerEffect['kind'], string> = {
  EARN: 'LOYALTY_POINTS_EARNED',
  EARN_REVERSAL: 'LOYALTY_POINTS_REVERSED',
  MANUAL_ADJUSTMENT: 'LOYALTY_POINTS_ADJUSTED',
  MANUAL_CORRECTION: 'LOYALTY_POINTS_ADJUSTED',
};

/**
 * Writes one ledger entry and moves the balance, under the wallet row lock. The wallet is created lazily
 * (balance 0). A replay of the same `idempotencyKey` returns the stored entry and writes nothing. A negative
 * request is applied up to the balance; the remainder is recorded as the entry's shortfall and flagged for the
 * Owner (audit + `LOYALTY_SHORTFALL_FLAGGED`; the exceptions list reads the ledger). Lock order: the caller
 * holds the invoice (if any) before this takes the wallet row.
 */
export async function appendLedgerEntry(
  tx: Prisma.TransactionClient,
  effect: LedgerEffect,
): Promise<LedgerResult> {
  if (!Number.isSafeInteger(effect.points) || effect.points === 0) {
    throw new RangeError('A ledger entry moves a non-zero whole number of points');
  }
  await tx.$executeRaw`
    INSERT INTO loyalty_wallets (user_id, wallet)
    VALUES (${effect.userId}::uuid, ${effect.wallet}::"LoyaltyWallet")
    ON CONFLICT DO NOTHING`;
  const [wallet] = await tx.$queryRaw<{ balance_points: number }[]>`
    SELECT balance_points FROM loyalty_wallets
    WHERE user_id = ${effect.userId}::uuid AND wallet = ${effect.wallet}::"LoyaltyWallet"
    FOR UPDATE`;
  if (!wallet) throw new Error('Loyalty wallet missing after creation');

  const existing = await tx.loyaltyLedgerEntry.findUnique({
    where: { idempotencyKey: effect.idempotencyKey },
    select: {
      id: true,
      userId: true,
      wallet: true,
      kind: true,
      points: true,
      shortfallPoints: true,
    },
  });
  if (existing) {
    return {
      entryId: existing.id,
      applied: existing.points,
      shortfall: existing.shortfallPoints,
      balanceAfter: wallet.balance_points,
      created: false,
      existingKind: existing.kind,
      existingUserId: existing.userId,
      existingWallet: existing.wallet,
      // Signed request as first made: the applied points less the shortfall (-40 applied, 60 short = -100).
      existingRequested: existing.points - existing.shortfallPoints,
    };
  }

  const requestedDebit = effect.points < 0 ? -effect.points : 0;
  const appliedDebit = Math.min(requestedDebit, wallet.balance_points);
  const applied = effect.points > 0 ? effect.points : appliedDebit === 0 ? 0 : -appliedDebit;
  const shortfall = requestedDebit - appliedDebit;
  const entry = await tx.loyaltyLedgerEntry.create({
    data: {
      userId: effect.userId,
      wallet: effect.wallet,
      kind: effect.kind,
      points: applied,
      shortfallPoints: shortfall,
      idempotencyKey: effect.idempotencyKey,
      invoiceId: effect.invoiceId ?? null,
      paidSeq: effect.paidSeq ?? null,
      reversesEntryId: effect.reversesEntryId ?? null,
      correctsEntryId: effect.correctsEntryId ?? null,
      reason: effect.reason ?? null,
      actorUserId: effect.actorUserId ?? null,
    },
    select: { id: true },
  });
  if (applied !== 0) {
    await tx.$executeRaw`
      UPDATE loyalty_wallets
      SET balance_points = balance_points + ${applied}, row_version = row_version + 1
      WHERE user_id = ${effect.userId}::uuid AND wallet = ${effect.wallet}::"LoyaltyWallet"`;
  }
  const facts = {
    entryId: entry.id,
    userId: effect.userId,
    wallet: effect.wallet,
    points: applied,
    shortfallPoints: shortfall,
    ...(effect.invoiceId ? { invoiceId: effect.invoiceId, paidSeq: effect.paidSeq ?? null } : {}),
  };
  const branch = effect.branchId ? { branchId: effect.branchId } : {};
  await appendOutboxEvent(tx, {
    ...branch,
    aggregateType: LOYALTY_AGGREGATE,
    aggregateId: entry.id,
    eventType: ledgerEvents[effect.kind],
    schemaVersion: 1,
    payload: facts,
  });
  if (shortfall > 0) {
    await appendOutboxEvent(tx, {
      ...branch,
      aggregateType: LOYALTY_AGGREGATE,
      aggregateId: entry.id,
      eventType: 'LOYALTY_SHORTFALL_FLAGGED',
      schemaVersion: 1,
      payload: facts,
    });
    await tx.auditEvent.create({
      data: {
        action: 'LOYALTY_SHORTFALL_FLAGGED',
        actorKind: effect.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: effect.actorUserId ?? null,
        subjectUserId: effect.userId,
        entityType: LOYALTY_AGGREGATE,
        entityId: entry.id,
        branchId: effect.branchId ?? null,
        reason: effect.reason ?? null,
        dataClassification: 'FINANCIAL',
        after: {
          kind: effect.kind,
          wallet: effect.wallet,
          requestedPoints: requestedDebit,
          appliedPoints: appliedDebit,
          shortfallPoints: shortfall,
        },
      },
      select: { id: true },
    });
  }
  return {
    entryId: entry.id,
    applied,
    shortfall,
    balanceAfter: wallet.balance_points + applied,
    created: true,
    existingKind: null,
    existingUserId: null,
    existingWallet: null,
    existingRequested: null,
  };
}

// ------------------------------------------------------------------------------------ consumer

function field(payload: unknown, key: string): unknown {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LockedInvoice {
  id: string;
  status: string;
  paid_seq: number;
  payer_user_id: string | null;
  total_vnd: bigint;
  paid_at: Date | null;
  branch_id: string;
}

async function lockInvoiceShared(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<LockedInvoice | null> {
  const rows = await tx.$queryRaw<LockedInvoice[]>`
    SELECT i.id, i.status::text AS status, i.paid_seq, i.payer_user_id, i.total_vnd, i.paid_at, i.branch_id
    FROM invoices i WHERE i.id = ${invoiceId}::uuid FOR SHARE`;
  return rows[0] ?? null;
}

type Event = Prisma.OutboxEventGetPayload<object>;

/** `INVOICE_PAID`: write the earn entry for this paid episode, or record why not (design 4.1-4.4). */
async function earn(tx: Prisma.TransactionClient, event: Event): Promise<LoyaltyEventOutcome> {
  const invoiceId = field(event.payload, 'invoiceId');
  const paidSeq = field(event.payload, 'paidSeq');
  if (typeof invoiceId !== 'string' || !UUID.test(invoiceId) || !Number.isSafeInteger(paidSeq)) {
    throw new Error('Malformed INVOICE_PAID event');
  }
  const invoice = await lockInvoiceShared(tx, invoiceId);
  // Stale-episode guard (P5-T9): only the invoice's CURRENT paid episode can earn.
  if (!invoice || invoice.status !== 'PAID' || invoice.paid_seq !== paidSeq) return 'SKIPPED_STALE';
  if (invoice.payer_user_id === null) return 'SKIPPED_GUEST';
  const goLive = await tx.loyaltyGoLive.findFirst({ select: { goLiveAt: true } });
  if (!goLive || invoice.paid_at === null || invoice.paid_at < goLive.goLiveAt) {
    return 'SKIPPED_PRE_GO_LIVE';
  }
  const payer = await tx.user.findUnique({
    where: { id: invoice.payer_user_id },
    select: { kind: true },
  });
  if (payer?.kind !== 'CUSTOMER') return 'SKIPPED_NOT_MEMBER';
  const points = loyaltyPointsForPaidVnd(invoice.total_vnd);
  if (points === 0) return 'NOOP';
  const result = await appendLedgerEntry(tx, {
    userId: invoice.payer_user_id,
    wallet: 'SPA',
    kind: 'EARN',
    points,
    idempotencyKey: earnKey('SPA', invoiceId, paidSeq as number),
    invoiceId,
    paidSeq: paidSeq as number,
    branchId: invoice.branch_id,
  });
  return result.created ? 'APPLIED' : 'NOOP';
}

/** `INVOICE_REOPENED` / `INVOICE_CANCELLED`: reverse the earn entry of the voided episode (design 4.4). */
async function reverse(
  tx: Prisma.TransactionClient,
  event: Event,
  seqKey: 'paidSeq' | 'voidedPaidSeq',
): Promise<LoyaltyEventOutcome> {
  const invoiceId = field(event.payload, 'invoiceId');
  const paidSeq = field(event.payload, seqKey);
  if (typeof invoiceId !== 'string' || !UUID.test(invoiceId)) {
    throw new Error('Malformed invoice event');
  }
  // A cancellation that voids no paid episode (draft, unpaid) has nothing to reverse.
  if (paidSeq === null || paidSeq === undefined) return 'NOOP';
  if (!Number.isSafeInteger(paidSeq)) throw new Error('Malformed invoice event');
  const invoice = await lockInvoiceShared(tx, invoiceId);
  if (!invoice) return 'NOOP';
  const earned = await tx.loyaltyLedgerEntry.findMany({
    where: { kind: 'EARN', invoiceId, paidSeq: paidSeq as number },
    orderBy: { wallet: 'asc' },
    select: { id: true, userId: true, wallet: true, points: true },
  });
  let applied = false;
  for (const entry of earned) {
    const result = await appendLedgerEntry(tx, {
      userId: entry.userId,
      wallet: entry.wallet,
      kind: 'EARN_REVERSAL',
      points: -entry.points,
      idempotencyKey: reversalKey(entry.id),
      invoiceId,
      paidSeq: paidSeq as number,
      reversesEntryId: entry.id,
      branchId: invoice.branch_id,
    });
    applied ||= result.created;
  }
  return applied ? 'APPLIED' : 'NOOP';
}

/**
 * Handles ONE outbox event for the `loyalty` consumer (design 11.1). In a single transaction:
 *
 * 1. take the shared graph lock, then claim the event (`FOR UPDATE SKIP LOCKED`) if this consumer has no
 *    `outbox_consumptions` row for it, so two workers never process one event;
 * 2. re-read the authoritative invoice by id under a share lock (payloads carry ids only) and decide;
 * 3. write the ledger entry and balance (wallet row lock) and its outbox/audit facts;
 * 4. insert the consumption row LAST with the outcome.
 *
 * Any throw rolls everything back and the event stays pending for retry. Every skip is recorded as a
 * consumption outcome, so a go-live that is still OFF never builds a backlog and a skipped event is never
 * reprocessed (an episode paid before go-live is never backfilled, P5-Q1).
 */
export async function processLoyaltyEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<LoyaltyEventOutcome> {
  await takeSharedAuthGraphLock(tx);
  const claimed = await tx.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM outbox_events e
    WHERE e.id = ${eventId}::uuid
      AND NOT EXISTS (SELECT 1 FROM outbox_consumptions c
                      WHERE c.event_id = e.id AND c.consumer = ${LOYALTY_CONSUMER})
    FOR UPDATE OF e SKIP LOCKED`;
  if (claimed.length === 0) return 'NOT_CLAIMED';
  const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.aggregateType !== 'Invoice' || !LOYALTY_EVENT_TYPES.includes(event.eventType)) {
    return 'IGNORED';
  }
  if (event.schemaVersion !== 1) throw new Error('Unsupported invoice event version');
  const outcome =
    event.eventType === 'INVOICE_PAID'
      ? await earn(tx, event)
      : event.eventType === 'INVOICE_REOPENED'
        ? await reverse(tx, event, 'paidSeq')
        : await reverse(tx, event, 'voidedPaidSeq');
  await tx.outboxConsumption.create({
    data: { eventId: event.id, consumer: LOYALTY_CONSUMER, outcome },
  });
  return outcome;
}

const PAGE = 50;
/** A failing event waits this long before it is tried again, so it never starves the events behind it. */
export const LOYALTY_RETRY_AFTER_MS = 60_000;

/**
 * One pass over the invoice events the `loyalty` consumer has not handled yet (no `outbox_consumptions` row for
 * `loyalty`): at most 50, oldest first by `occurred_at, id` (ids are random UUIDs, so they carry no order). Each
 * event runs in its OWN transaction (ledger entry + balance + consumption row), so one failing event never blocks
 * or half-applies another; a failing event is parked for a minute. Independent of the Phase 3 relay and the
 * notification consumer: it never reads or writes `published_at`. Returns how many events were handled.
 */
export async function relayLoyaltyEvents(
  database: Pick<DatabaseClient, 'outboxEvent' | '$transaction'>,
  coolingDown: Map<string, number>,
  onOutcome: (outcome: string) => void,
  onFailure: (error: unknown) => void,
  now: number = Date.now(),
): Promise<number> {
  for (const [id, retryAt] of coolingDown) if (retryAt <= now) coolingDown.delete(id);
  const events = await database.outboxEvent.findMany({
    where: {
      aggregateType: 'Invoice',
      eventType: { in: LOYALTY_EVENT_TYPES },
      consumptions: { none: { consumer: LOYALTY_CONSUMER } },
      ...(coolingDown.size > 0 ? { id: { notIn: [...coolingDown.keys()] } } : {}),
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: PAGE,
    select: { id: true },
  });
  let handled = 0;
  for (const event of events) {
    try {
      onOutcome(
        await database.$transaction((tx) => processLoyaltyEvent(tx, event.id), { timeout: 30_000 }),
      );
      handled += 1;
    } catch (error) {
      coolingDown.set(event.id, now + LOYALTY_RETRY_AFTER_MS);
      onFailure(error);
    }
  }
  return handled;
}
