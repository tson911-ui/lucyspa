import type { DatabaseClient, Prisma } from '@lucy-spa/database';
import { takeSharedAuthGraphLock } from './auth-lock.js';

/**
 * Phase 6 P6-10 (design 4.5, 10.1-10.3; T15, T27): the sale of reserved stock.
 *
 * A reservation (P6-8) holds the quantity of a product line from finalization on, so the lag between a payment and the sale of the
 * stock can never oversell. This module aligns the reservations of ONE invoice with the invoice's authoritative state, under the
 * invoice lock the caller already holds:
 *
 * - PAID at episode N: every reservation is CONSUMED at episode N (RESERVED -> CONSUMED, then the SALE movements, first-expiry
 *   lot first, one movement per lot).
 * - PENDING_PAYMENT (or any other live state) after a sale: the sale is reversed (SALE_REVERSAL on exactly the lots the sale took
 *   from) and the reservation is RESERVED again.
 * - CANCELLED after a sale: the same reversal, and the reservation is RELEASED.
 *
 * Because it reads the state and not the event, it gives the same result whatever order the events are handled in and a replay
 * writes nothing. The `inventory` consumer calls it for INVOICE_PAID / INVOICE_REOPENED / INVOICE_CANCELLED; the cancel command
 * calls it too (the P6-8 commit-time rule "a cancelled invoice holds no live reservation" must hold at the cancel's commit, so a sale
 * that the consumer has not yet reversed is reversed by the cancel itself; the consumer then finds nothing left to do).
 *
 * Statement order is forced by `stock_levels_reserved` (reserved <= on_hand, immediate): consume = reservation first, movements
 * second; give back = movements first, reservation second. Lock order: lot rows (branch, variant, id), then level rows (branch,
 * variant), the order of the movement trigger, an adjustment and a count.
 */
export const INVENTORY_CONSUMER = 'inventory';
export const INVENTORY_EVENT_TYPES = ['INVOICE_PAID', 'INVOICE_REOPENED', 'INVOICE_CANCELLED'];

/**
 * - `APPLIED`: stock was consumed, given back or released for this invoice.
 * - `NOOP`: the invoice has nothing to align (no product line, or already aligned: a replay).
 * - `SKIPPED_STALE`: the event's paid episode is no longer the invoice's current one and nothing had to change.
 * - `NOT_CLAIMED`: already consumed by this consumer or locked by another worker; nothing changed.
 * - `IGNORED`: not an event this consumer handles; untouched.
 */
export type InventoryEventOutcome =
  'APPLIED' | 'NOOP' | 'SKIPPED_STALE' | 'NOT_CLAIMED' | 'IGNORED';

export const saleKey = (invoiceLineId: string, paidSeq: number, lotId: string): string =>
  `SALE:${invoiceLineId}:${paidSeq}:${lotId}`;
export const saleReversalKey = (invoiceLineId: string, paidSeq: number, lotId: string): string =>
  `SALE_REV:${invoiceLineId}:${paidSeq}:${lotId}`;

export interface StockInvoiceState {
  id: string;
  status: string;
  paidSeq: number;
}

export interface StockSettlement {
  consumed: number;
  givenBack: number;
  released: number;
}

export interface StockSettlementOptions {
  /** Who is recorded on the movements of a reversal and on a release; default = whoever reserved the line. */
  actorUserId?: string;
  /** The release cause when the invoice is CANCELLED (default `INVOICE_CANCELLED_UNPAID`). */
  releaseCause?: 'INVOICE_CANCELLED_UNPAID' | 'ZERO_BALANCE_CORRECTION';
}

interface ReservationRow {
  id: string;
  invoiceLineId: string;
  branchId: string;
  variantId: string;
  quantity: number;
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED';
  consumedPaidSeq: number | null;
  createdByUserId: string;
}

interface LotState {
  id: string;
  remaining: number;
  expiry: Date | null;
  expired: boolean;
}

const pairKey = (branchId: string, variantId: string) => `${branchId}:${variantId}`;

/** Locks the lot rows, then the level rows, of the given (branch, variant) pairs in sorted order. */
async function lockStock(
  tx: Prisma.TransactionClient,
  pairs: readonly { branchId: string; variantId: string }[],
): Promise<void> {
  const unique = [
    ...new Map(pairs.map((pair) => [pairKey(pair.branchId, pair.variantId), pair])).values(),
  ].sort((a, b) =>
    a.branchId < b.branchId
      ? -1
      : a.branchId > b.branchId
        ? 1
        : a.variantId < b.variantId
          ? -1
          : a.variantId > b.variantId
            ? 1
            : 0,
  );
  const branchIds = unique.map((pair) => pair.branchId);
  const variantIds = unique.map((pair) => pair.variantId);
  await tx.$queryRaw`
    SELECT l.id FROM inventory_lots l
    WHERE (l.branch_id, l.variant_id) IN (SELECT * FROM unnest(${branchIds}::uuid[], ${variantIds}::uuid[]))
    ORDER BY l.branch_id, l.variant_id, l.id FOR UPDATE`;
  await tx.$queryRaw`
    SELECT s.branch_id FROM stock_levels s
    WHERE (s.branch_id, s.variant_id) IN (SELECT * FROM unnest(${branchIds}::uuid[], ${variantIds}::uuid[]))
    ORDER BY s.branch_id, s.variant_id FOR UPDATE`;
}

/**
 * The lots with stock for each pair, in the order a sale takes them: lots still sellable first, earliest expiry first and no
 * expiry last (FEFO); then, only if those fall short because a lot expired after the reservation was made, the expired lots, the
 * latest expiry first (OQ-75). "Expired" is judged on the branch's own calendar date, as `lucy_available_stock` does.
 */
async function loadLots(
  tx: Prisma.TransactionClient,
  pairs: readonly { branchId: string; variantId: string }[],
): Promise<Map<string, LotState[]>> {
  const unique = [
    ...new Map(pairs.map((pair) => [pairKey(pair.branchId, pair.variantId), pair])).values(),
  ];
  const rows = await tx.$queryRaw<
    {
      id: string;
      branch_id: string;
      variant_id: string;
      quantity_on_hand: number;
      expiry_date: Date | null;
      expired: boolean;
    }[]
  >`
    SELECT l.id, l.branch_id, l.variant_id, l.quantity_on_hand, l.expiry_date,
           (l.expiry_date IS NOT NULL AND l.expiry_date < (clock_timestamp() AT TIME ZONE b.timezone)::date) AS expired
    FROM inventory_lots l JOIN branches b ON b.id = l.branch_id
    WHERE (l.branch_id, l.variant_id) IN (SELECT * FROM unnest(${unique.map((p) => p.branchId)}::uuid[], ${unique.map((p) => p.variantId)}::uuid[]))
      AND l.quantity_on_hand > 0`;
  const result = new Map<string, LotState[]>();
  for (const row of rows) {
    const key = pairKey(row.branch_id, row.variant_id);
    const list = result.get(key) ?? [];
    list.push({
      id: row.id,
      remaining: row.quantity_on_hand,
      expiry: row.expiry_date,
      expired: row.expired,
    });
    result.set(key, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => {
      if (a.expired !== b.expired) return a.expired ? 1 : -1;
      if (!a.expired) {
        // Sellable: earliest expiry first, no expiry last.
        if ((a.expiry === null) !== (b.expiry === null)) return a.expiry === null ? 1 : -1;
        if (a.expiry && b.expiry && a.expiry.getTime() !== b.expiry.getTime()) {
          return a.expiry.getTime() - b.expiry.getTime();
        }
      } else if (a.expiry && b.expiry && a.expiry.getTime() !== b.expiry.getTime()) {
        // Expired (last resort): the freshest first.
        return b.expiry.getTime() - a.expiry.getTime();
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  return result;
}

async function consume(
  tx: Prisma.TransactionClient,
  reservation: ReservationRow,
  paidSeq: number,
  lots: Map<string, LotState[]>,
): Promise<void> {
  const available = lots.get(pairKey(reservation.branchId, reservation.variantId)) ?? [];
  let needed = reservation.quantity;
  const takes: { lotId: string; quantity: number }[] = [];
  for (const lot of available) {
    if (needed === 0) break;
    const take = Math.min(lot.remaining, needed);
    if (take > 0) {
      takes.push({ lotId: lot.id, quantity: take });
      lot.remaining -= take;
      needed -= take;
    }
  }
  if (needed > 0) {
    // The reservation guarantees on_hand >= reserved, so the lots cannot fall short; if they do, nothing is written.
    throw new Error('The lots hold less than the reservation: stock invariant broken.');
  }
  // Reservation first (reserved falls), movements second (on_hand falls): `stock_levels_reserved` is immediate.
  await tx.stockReservation.update({
    where: { id: reservation.id },
    data: { status: 'CONSUMED', consumedPaidSeq: paidSeq },
    select: { id: true },
  });
  for (const take of takes) {
    await tx.stockMovement.create({
      data: {
        branchId: reservation.branchId,
        variantId: reservation.variantId,
        lotId: take.lotId,
        kind: 'SALE',
        quantityDelta: -take.quantity,
        invoiceLineId: reservation.invoiceLineId,
        paidSeq,
        idempotencyKey: saleKey(reservation.invoiceLineId, paidSeq, take.lotId),
        actorUserId: reservation.createdByUserId,
      },
      select: { id: true },
    });
  }
}

async function giveBack(
  tx: Prisma.TransactionClient,
  reservation: ReservationRow,
  target: { to: 'RESERVED' } | { to: 'RELEASED'; cause: string },
  actorUserId: string,
): Promise<void> {
  const seq = reservation.consumedPaidSeq;
  if (seq === null) throw new Error('A consumed reservation records its paid episode.');
  const taken = await tx.$queryRaw<{ lot_id: string; open: bigint }[]>`
    SELECT lot_id,
           (-sum(quantity_delta) FILTER (WHERE kind = 'SALE') - COALESCE(sum(quantity_delta) FILTER (WHERE kind = 'SALE_REVERSAL'), 0))::bigint AS open
    FROM stock_movements
    WHERE invoice_line_id = ${reservation.invoiceLineId}::uuid AND paid_seq = ${seq}
    GROUP BY lot_id ORDER BY lot_id`;
  // Movements first (on_hand rises), reservation second.
  for (const row of taken) {
    if (row.open <= 0n) continue;
    await tx.stockMovement.create({
      data: {
        branchId: reservation.branchId,
        variantId: reservation.variantId,
        lotId: row.lot_id,
        kind: 'SALE_REVERSAL',
        quantityDelta: Number(row.open),
        invoiceLineId: reservation.invoiceLineId,
        paidSeq: seq,
        idempotencyKey: saleReversalKey(reservation.invoiceLineId, seq, row.lot_id),
        actorUserId,
      },
      select: { id: true },
    });
  }
  await tx.stockReservation.update({
    where: { id: reservation.id },
    data:
      target.to === 'RESERVED'
        ? { status: 'RESERVED' }
        : { status: 'RELEASED', releasedByUserId: actorUserId, releaseCause: target.cause },
    select: { id: true },
  });
}

/**
 * Aligns the reservations of the invoice with its state (see the module comment). The caller holds the invoice row (a share lock
 * is enough to keep its status and paid episode still; the cancel command holds it for update) and has read `invoice` under it.
 */
export async function settleInvoiceStock(
  tx: Prisma.TransactionClient,
  invoice: StockInvoiceState,
  options: StockSettlementOptions = {},
): Promise<StockSettlement> {
  const reservations = (await tx.stockReservation.findMany({
    where: { invoiceId: invoice.id },
    orderBy: [{ branchId: 'asc' }, { variantId: 'asc' }, { invoiceLineId: 'asc' }],
    select: {
      id: true,
      invoiceLineId: true,
      branchId: true,
      variantId: true,
      quantity: true,
      status: true,
      consumedPaidSeq: true,
      createdByUserId: true,
    },
  })) as ReservationRow[];
  const paid = invoice.status === 'PAID';
  const cancelled = invoice.status === 'CANCELLED';
  const toGiveBack = reservations.filter(
    (reservation) =>
      reservation.status === 'CONSUMED' &&
      (!paid || reservation.consumedPaidSeq !== invoice.paidSeq),
  );
  const toConsume = paid
    ? reservations.filter(
        (reservation) => reservation.status === 'RESERVED' || toGiveBack.includes(reservation),
      )
    : [];
  const settlement: StockSettlement = { consumed: 0, givenBack: 0, released: 0 };
  if (toGiveBack.length === 0 && toConsume.length === 0) return settlement;
  await lockStock(tx, [...new Set([...toGiveBack, ...toConsume])]);
  // Every sale of an ended episode is reversed BEFORE the lots are read, so a new sale of the same unit (an earlier episode not
  // yet handled when the next one is paid) finds the returned stock.
  for (const reservation of toGiveBack) {
    await giveBack(
      tx,
      reservation,
      cancelled
        ? { to: 'RELEASED', cause: options.releaseCause ?? 'INVOICE_CANCELLED_UNPAID' }
        : { to: 'RESERVED' },
      options.actorUserId ?? reservation.createdByUserId,
    );
    if (cancelled) settlement.released += 1;
    else settlement.givenBack += 1;
  }
  if (toConsume.length > 0) {
    const lots = await loadLots(tx, toConsume);
    for (const reservation of toConsume) {
      await consume(tx, reservation, invoice.paidSeq, lots);
      settlement.consumed += 1;
    }
  }
  return settlement;
}

// ------------------------------------------------------------------------------------ consumer

function field(payload: unknown, key: string): unknown {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Handles ONE outbox event for the `inventory` consumer (design 10.1). In a single transaction: the shared graph lock, the claim
 * of the event (`FOR UPDATE SKIP LOCKED`, so two workers never process one), the invoice row under a share lock (its status and
 * paid episode cannot move while this runs), the alignment of its reservations, and the consumption row LAST with the outcome.
 * Any throw rolls everything back and the event stays pending for retry. Depends on no loyalty go-live (product sales do not).
 */
export async function processInventoryEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<InventoryEventOutcome> {
  await takeSharedAuthGraphLock(tx);
  const claimed = await tx.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM outbox_events e
    WHERE e.id = ${eventId}::uuid
      AND NOT EXISTS (SELECT 1 FROM outbox_consumptions c
                      WHERE c.event_id = e.id AND c.consumer = ${INVENTORY_CONSUMER})
    FOR UPDATE OF e SKIP LOCKED`;
  if (claimed.length === 0) return 'NOT_CLAIMED';
  const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.aggregateType !== 'Invoice' || !INVENTORY_EVENT_TYPES.includes(event.eventType)) {
    return 'IGNORED';
  }
  if (event.schemaVersion !== 1) throw new Error('Unsupported invoice event version');
  const invoiceId = field(event.payload, 'invoiceId');
  if (typeof invoiceId !== 'string' || !UUID.test(invoiceId)) {
    throw new Error('Malformed invoice event');
  }
  const eventSeq = field(
    event.payload,
    event.eventType === 'INVOICE_CANCELLED' ? 'voidedPaidSeq' : 'paidSeq',
  );
  // Lock order (design 10.2): the users rows come before the invoice and the stock. The movements of a sale name the user who
  // reserved the line as their actor, and the foreign key to that user takes a key-share lock that a command holding the same
  // user row for update would otherwise make this wait for while it waits for the lots (a real deadlock the race test found).
  const reservedBy = await tx.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT created_by_user_id AS id FROM stock_reservations WHERE invoice_id = ${invoiceId}::uuid`;
  if (reservedBy.length > 0) {
    await tx.$queryRaw`
      SELECT id FROM users WHERE id = ANY(${reservedBy.map((row) => row.id)}::uuid[]) ORDER BY id FOR KEY SHARE`;
  }
  const rows = await tx.$queryRaw<{ id: string; status: string; paid_seq: number }[]>`
    SELECT i.id, i.status::text AS status, i.paid_seq FROM invoices i WHERE i.id = ${invoiceId}::uuid FOR SHARE`;
  const invoice = rows[0];
  let outcome: InventoryEventOutcome = 'NOOP';
  if (invoice) {
    const settlement = await settleInvoiceStock(tx, {
      id: invoice.id,
      status: invoice.status,
      paidSeq: invoice.paid_seq,
    });
    if (settlement.consumed + settlement.givenBack + settlement.released > 0) {
      outcome = 'APPLIED';
    } else if (
      event.eventType === 'INVOICE_PAID' &&
      (invoice.status !== 'PAID' || invoice.paid_seq !== eventSeq)
    ) {
      outcome = 'SKIPPED_STALE';
    }
  }
  await tx.outboxConsumption.create({
    data: { eventId: event.id, consumer: INVENTORY_CONSUMER, outcome },
  });
  return outcome;
}

const PAGE = 50;
/** A failing event waits this long before it is tried again, so it never starves the events behind it. */
export const INVENTORY_RETRY_AFTER_MS = 60_000;

/**
 * One pass over the invoice events the `inventory` consumer has not handled yet: at most 50, oldest first by `occurred_at, id`.
 * Only events of an invoice that has a stock reservation are selected, so the service-only history (every paid service invoice
 * ever recorded) is never read as a backlog. Each event runs in its OWN transaction; a failing event is parked for a minute.
 * Independent of every other consumer: it never reads or writes `published_at`. Returns how many events were handled.
 */
export async function relayInventoryEvents(
  database: Pick<DatabaseClient, '$queryRaw' | '$transaction'>,
  coolingDown: Map<string, number>,
  onOutcome: (outcome: string) => void,
  onFailure: (error: unknown) => void,
  now: number = Date.now(),
): Promise<number> {
  for (const [id, retryAt] of coolingDown) if (retryAt <= now) coolingDown.delete(id);
  const parked = [...coolingDown.keys()];
  const events = await database.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM outbox_events e
    WHERE e.aggregate_type = 'Invoice' AND e.event_type = ANY(${INVENTORY_EVENT_TYPES}::text[])
      AND NOT EXISTS (SELECT 1 FROM outbox_consumptions c WHERE c.event_id = e.id AND c.consumer = ${INVENTORY_CONSUMER})
      AND EXISTS (SELECT 1 FROM stock_reservations r
                  WHERE r.invoice_id = CASE WHEN e.aggregate_type = 'Invoice' THEN e.aggregate_id::uuid END)
      AND e.id <> ALL(${parked}::uuid[])
    ORDER BY e.occurred_at ASC, e.id ASC
    LIMIT ${PAGE}`;
  let handled = 0;
  for (const event of events) {
    try {
      onOutcome(
        await database.$transaction((tx) => processInventoryEvent(tx, event.id), {
          timeout: 30_000,
        }),
      );
      handled += 1;
    } catch (error) {
      coolingDown.set(event.id, now + INVENTORY_RETRY_AFTER_MS);
      onFailure(error);
    }
  }
  return handled;
}
