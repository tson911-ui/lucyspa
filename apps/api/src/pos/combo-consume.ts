import type { ComboUsedBy, ComboUseState } from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 5 P5-8, the part that runs INSIDE the invoice commands (design 12.1: combo-session redemption and release are
 * synchronous, atomic with finalize / cancel). A leaf module: it knows tables, not the invoice response, so `invoice.core` can
 * call it without a cycle.
 *
 * Lock order (design 12.2): the use invoice (held by the caller) -> the sale invoices of the combos used (SHARE, sorted by id) ->
 * the sessions of those combos (sorted by id). The database guards take the same locks in the same order.
 *
 * Provisional Owner answers of 2026-10-05 built in here (design 2.5): PAID sessions first (the lowest session number free,
 * PAID rows carry the lower numbers), any branch may use a combo, a combo frozen by the reversal of its sale is not usable.
 */

export function sessionStateOf(consumption: {
  release: { id: string } | null;
  restoration: { id: string } | null;
}): ComboUseState {
  if (consumption.restoration) return 'RESTORED';
  if (consumption.release) return 'RELEASED';
  return 'USED';
}

/** A BONUS session never counts as a tour for the technician (Owner, 2026-10-05); Phase 7 reads this, nothing else uses it. */
export function countsAsTour(kind: 'PAID' | 'BONUS'): boolean {
  return kind !== 'BONUS';
}

export interface ConsumedSession {
  consumptionId: string;
  purchaseId: string;
  sessionId: string;
  sessionNo: number;
  kind: 'PAID' | 'BONUS';
  usedBy: ComboUsedBy;
  invoiceLineId: string;
}

/** Locks the sale invoices of the purchases (SHARE, sorted by id): a reversal of a sale and a use of its combo are serialized. */
export async function lockSaleInvoices(
  tx: Prisma.TransactionClient,
  purchaseIds: readonly string[],
): Promise<void> {
  if (purchaseIds.length === 0) return;
  await tx.$queryRaw`
    SELECT i.id FROM invoices i
    WHERE i.id IN (
      SELECT l.invoice_id FROM invoice_lines l JOIN combo_purchases p ON p.invoice_line_id = l.id
      WHERE p.id = ANY(${[...purchaseIds]}::uuid[]))
    ORDER BY i.id FOR SHARE`;
}

export async function lockSessions(
  tx: Prisma.TransactionClient,
  purchaseIds: readonly string[],
): Promise<void> {
  if (purchaseIds.length === 0) return;
  await tx.$queryRaw`
    SELECT s.id FROM combo_sessions s WHERE s.purchase_id = ANY(${[...purchaseIds]}::uuid[]) ORDER BY s.id FOR UPDATE`;
}

/** The database's own usability rule (sale invoice PAID in a usable episode, not revoked). Call after `lockSaleInvoices`. */
export async function purchaseUsable(
  tx: Prisma.TransactionClient,
  purchaseId: string,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ usable: boolean }[]>`
    SELECT lucy_combo_purchase_usable(${purchaseId}::uuid) AS usable`;
  return row?.usable === true;
}

/**
 * Takes one session for every line of the DRAFT `invoiceId` that the staff chose to pay with a combo. The caller holds the
 * invoice row (FOR UPDATE) and has already evaluated the discounts; the invoice is still a DRAFT, which the consumption guard
 * requires. The lowest free session number of the chosen combo is taken (PAID before BONUS; after a restoration the restored
 * session is the lowest free again). Throws `LOYALTY_NOT_LIVE`, `COMBO_NOT_USABLE` or `COMBO_NO_SESSION_LEFT` with nothing written.
 */
export async function consumeSelectedSessions(
  tx: Prisma.TransactionClient,
  invoice: { id: string; branchId: string },
  actorUserId: string,
): Promise<ConsumedSession[]> {
  const usages = await tx.invoiceLineComboUsage.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { line: { sequence: 'asc' } },
    select: {
      invoiceLineId: true,
      purchaseId: true,
      usedBy: true,
      relationshipNote: true,
      line: {
        select: {
          serviceDetails: { select: { participantId: true, employeeUserId: true } },
        },
      },
    },
  });
  if (usages.length === 0) return [];
  if ((await tx.loyaltyGoLive.count()) === 0) throw new AuthError('LOYALTY_NOT_LIVE');
  const purchaseIds = [...new Set(usages.map((usage) => usage.purchaseId))].sort();
  await lockSaleInvoices(tx, purchaseIds);
  for (const purchaseId of purchaseIds) {
    if (!(await purchaseUsable(tx, purchaseId))) throw new AuthError('COMBO_NOT_USABLE');
  }
  await lockSessions(tx, purchaseIds);

  const taken = new Set<string>();
  const consumed: ConsumedSession[] = [];
  for (const usage of usages) {
    const detail = usage.line.serviceDetails[0];
    if (!detail) throw new Error('A line paid with a combo is a service line.');
    const taken_ = [...taken];
    const [session] = await tx.$queryRaw<
      { id: string; session_no: number; kind: 'PAID' | 'BONUS' }[]
    >`
      SELECT s.id, s.session_no, s.kind::text AS kind FROM combo_sessions s
      WHERE s.purchase_id = ${usage.purchaseId}::uuid
        AND s.id <> ALL(${taken_}::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM combo_session_consumptions c
          WHERE c.session_id = s.id
            AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM combo_session_restorations o WHERE o.consumption_id = c.id))
      ORDER BY s.session_no LIMIT 1`;
    if (!session) throw new AuthError('COMBO_NO_SESSION_LEFT');
    taken.add(session.id);
    const created = await tx.comboSessionConsumption.create({
      data: {
        sessionId: session.id,
        invoiceLineId: usage.invoiceLineId,
        branchId: invoice.branchId,
        usedBy: usage.usedBy,
        relationshipNote: usage.relationshipNote,
        // The recipient and the technician are those of the line, never client input.
        recipientParticipantId: detail.participantId,
        ktvUserId: detail.employeeUserId,
        performedByUserId: actorUserId,
      },
      select: { id: true },
    });
    const facts = {
      comboPurchaseId: usage.purchaseId,
      invoiceId: invoice.id,
      invoiceLineId: usage.invoiceLineId,
      sessionNo: session.session_no,
      sessionKind: session.kind,
      usedBy: usage.usedBy,
      countsAsTour: countsAsTour(session.kind),
    };
    await appendOutboxEvent(tx, {
      branchId: invoice.branchId,
      aggregateType: 'ComboPurchase',
      aggregateId: usage.purchaseId,
      eventType: 'COMBO_SESSION_CONSUMED',
      schemaVersion: 1,
      payload: { ...facts, consumptionId: created.id },
    });
    consumed.push({
      consumptionId: created.id,
      purchaseId: usage.purchaseId,
      sessionId: session.id,
      sessionNo: session.session_no,
      kind: session.kind,
      usedBy: usage.usedBy,
      invoiceLineId: usage.invoiceLineId,
    });
  }
  return consumed;
}

/**
 * The invoice is CANCELLED: every session it consumed returns, by an append-only release row (never an edit, never twice). A
 * consumption that a manager already restored has nothing to release. Returns the consumptions released.
 */
export async function releaseConsumedSessions(
  tx: Prisma.TransactionClient,
  invoice: { id: string; branchId: string },
  actorUserId: string,
  cause: 'INVOICE_CANCELLED_UNPAID' | 'ZERO_BALANCE_CORRECTION',
  reason: string,
  now: Date,
): Promise<string[]> {
  const active = await tx.comboSessionConsumption.findMany({
    where: { invoiceLine: { invoiceId: invoice.id }, release: null, restoration: null },
    orderBy: { id: 'asc' },
    select: { id: true, session: { select: { purchaseId: true, sessionNo: true } } },
  });
  const released: string[] = [];
  for (const consumption of active) {
    await tx.comboSessionRelease.create({
      data: {
        consumptionId: consumption.id,
        releasedByUserId: actorUserId,
        cause,
        reason,
        releasedAt: now,
      },
      select: { id: true },
    });
    await appendOutboxEvent(tx, {
      branchId: invoice.branchId,
      aggregateType: 'ComboPurchase',
      aggregateId: consumption.session.purchaseId,
      eventType: 'COMBO_SESSION_RELEASED',
      schemaVersion: 1,
      payload: {
        comboPurchaseId: consumption.session.purchaseId,
        consumptionId: consumption.id,
        invoiceId: invoice.id,
        sessionNo: consumption.session.sessionNo,
        cause,
      },
    });
    released.push(consumption.id);
  }
  return released;
}
