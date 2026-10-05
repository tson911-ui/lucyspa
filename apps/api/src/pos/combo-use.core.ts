import type { ComboLookupResponse, ComboUsedBy, InvoiceResponse } from '@lucy-spa/contracts';
import { findMemberByPhone } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { IdentityValidationError, normalizePhone } from '../auth/identity.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { lockSaleInvoices, purchaseUsable } from './combo-consume.js';
import { initialPricing } from './invoice.calc.js';
import { databaseClock, draftAmounts, load, lockedInvoice, present } from './invoice.core.js';

/**
 * Phase 5 P5-8: the staff side of using a combo at a visit's invoice (design 9.4; PRD 17.4, 52). Three commands on a DRAFT visit
 * invoice, all needing `MANAGE_INVOICES` and `CONSUME_COMBO_SESSIONS` at the invoice's branch (any branch may use a combo: Owner
 * answer of 2026-10-05, provisional):
 *
 * - `lookupCombos`: by the combo OWNER's exact phone. It shows the minimum: the combo name, the sessions left and the owner's
 *   NAME MASKED; never a phone, an email, an id of the owner or a history. Not found and "nothing usable" look the same.
 * - `selectComboUse`: pay one service line with a session of a combo (owner or relative). The line becomes a 0 VND line of
 *   quantity 1. No session is taken here: it is taken at finalization, atomically, so a mistake on a draft is just cleared.
 * - `clearComboUse`: pay the line normally again.
 */

const MAX_NOTE = 120;

function assertCan(context: AdminContext, permission: string, branchId: string): void {
  if (!decide(context.actor.graph, permission, { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
}

/** "Nguyễn Thị Lan" -> "N••• T••• L•••": the first letter of every word, nothing else (PRD 52: no unnecessary exposure). */
export function maskName(fullName: string): string {
  const words = fullName
    .normalize('NFC')
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return '•••';
  return words.map((word) => `${Array.from(word)[0]}•••`).join(' ');
}

interface UsableCombo {
  purchaseId: string;
  nameVi: string;
  nameEn: string;
  service: { id: string; nameVi: string; nameEn: string };
  serviceId: string;
  totalSessions: number;
  /** Sessions with no active use (before this invoice's own choices are subtracted). */
  free: number;
}

/** The owner's combos that are usable now (sale invoice PAID in a usable episode, not revoked, not expired). */
async function usableCombos(context: AdminContext, ownerUserId: string): Promise<UsableCombo[]> {
  const purchases = await context.tx.comboPurchase.findMany({
    where: { ownerUserId, voidedAt: null },
    orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      nameVi: true,
      nameEn: true,
      serviceId: true,
      paidSeq: true,
      expiresAt: true,
      service: { select: { id: true, nameVi: true, nameEn: true } },
      reopenings: { select: { paidSeq: true } },
      invoiceLine: { select: { invoice: { select: { status: true, paidSeq: true } } } },
      sessions: {
        select: {
          consumptions: {
            select: { release: { select: { id: true } }, restoration: { select: { id: true } } },
          },
        },
      },
    },
  });
  return purchases.flatMap((purchase) => {
    const sale = purchase.invoiceLine.invoice;
    const usable =
      sale.status === 'PAID' &&
      (sale.paidSeq === purchase.paidSeq ||
        purchase.reopenings.some((reopening) => reopening.paidSeq === sale.paidSeq)) &&
      (purchase.expiresAt === null || purchase.expiresAt > context.now);
    if (!usable) return [];
    const free = purchase.sessions.filter(
      (session) =>
        !session.consumptions.some((use) => use.release === null && use.restoration === null),
    ).length;
    return [
      {
        purchaseId: purchase.id,
        nameVi: purchase.nameVi,
        nameEn: purchase.nameEn,
        service: purchase.service,
        serviceId: purchase.serviceId,
        totalSessions: purchase.sessions.length,
        free,
      },
    ];
  });
}

export async function lookupCombos(
  context: AdminContext,
  invoiceId: string,
  request: { phone: unknown },
): Promise<ComboLookupResponse> {
  const { tx } = context;
  const hint = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, branchId: true, kind: true, status: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  assertCan(context, 'MANAGE_INVOICES', hint.branchId);
  assertCan(context, 'CONSUME_COMBO_SESSIONS', hint.branchId);
  if (hint.kind !== 'VISIT' || hint.status !== 'DRAFT')
    throw new AuthError('INVOICE_STATE_INVALID');
  let phoneCanonical: string;
  try {
    phoneCanonical = normalizePhone(request.phone).phoneCanonical;
  } catch (error) {
    if (error instanceof IdentityValidationError) throw new AuthError('VALIDATION_FAILED', 'phone');
    throw error;
  }
  const owner = await findMemberByPhone(tx, phoneCanonical);
  if (!owner) return { owners: [] };

  const lines = await tx.invoiceLine.findMany({
    where: { invoiceId, kind: 'SERVICE' },
    select: {
      id: true,
      comboUsages: { select: { purchaseId: true } },
      serviceDetails: { select: { serviceId: true } },
    },
  });
  // A choice already made on this draft holds one session of its combo until it is cleared.
  const held = new Map<string, number>();
  for (const line of lines) {
    for (const usage of line.comboUsages) {
      held.set(usage.purchaseId, (held.get(usage.purchaseId) ?? 0) + 1);
    }
  }
  const combos = (await usableCombos(context, owner.id)).flatMap((combo) => {
    const left = combo.free - (held.get(combo.purchaseId) ?? 0);
    const lineIds = lines
      .filter(
        (line) =>
          line.comboUsages.length === 0 && line.serviceDetails[0]?.serviceId === combo.serviceId,
      )
      .map((line) => line.id);
    if (left <= 0 || lineIds.length === 0) return [];
    return [
      {
        purchaseId: combo.purchaseId,
        nameVi: combo.nameVi,
        nameEn: combo.nameEn,
        service: combo.service,
        sessionsLeft: left,
        totalSessions: combo.totalSessions,
        lineIds,
      },
    ];
  });
  return {
    owners: combos.length === 0 ? [] : [{ ownerNameMasked: maskName(owner.fullName), combos }],
  };
}

function usedByOf(value: unknown): ComboUsedBy {
  if (value !== 'OWNER' && value !== 'RELATIVE') throw new AuthError('VALIDATION_FAILED', 'usedBy');
  return value;
}

function noteOf(value: unknown, usedBy: ComboUsedBy): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', 'relationshipNote');
  const note = value.normalize('NFC').trim();
  if (note.length === 0) return null;
  // The relationship marker exists for a relative's use only (PRD 17.4).
  if (usedBy !== 'RELATIVE' || [...note].length > MAX_NOTE) {
    throw new AuthError('VALIDATION_FAILED', 'relationshipNote');
  }
  return note;
}

/** Writes the amounts of a draft after its lines changed: the same header refresh the price command does. */
async function refreshDraft(
  context: AdminContext,
  invoice: { id: string; payerUserId: string | null; rowVersion: number },
  now: Date,
): Promise<void> {
  const totals = await draftAmounts(context.tx, invoice, now);
  await context.tx.invoice.update({
    where: { id: invoice.id },
    data: {
      subtotalVnd: totals.subtotalVnd,
      discountTotalVnd: totals.discountTotalVnd,
      totalVnd: totals.totalVnd,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
}

export async function selectComboUse(
  context: AdminContext,
  invoiceId: string,
  lineId: string,
  input: {
    expectedVersion: number;
    purchaseId: string;
    usedBy: unknown;
    relationshipNote: unknown;
  },
): Promise<InvoiceResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'MANAGE_INVOICES');
  assertCan(context, 'CONSUME_COMBO_SESSIONS', hint.branchId);
  const { tx } = context;
  const invoice = await read();
  if (invoice.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
  if (invoice.status !== 'DRAFT' || invoice.kind !== 'VISIT') {
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  const usedBy = usedByOf(input.usedBy);
  const note = noteOf(input.relationshipNote, usedBy);
  const line = invoice.lines.find((candidate) => candidate.id === lineId);
  const detail = line?.serviceDetails[0];
  if (!line || !detail) throw new AuthError('NOT_FOUND');
  if ((await tx.loyaltyGoLive.count()) === 0) throw new AuthError('LOYALTY_NOT_LIVE');
  // One session pays one unit of the service (Owner answer, provisional): a line already set to more than one is refused.
  if (line.quantity !== null && line.quantity !== 1) throw new AuthError('COMBO_LINE_QUANTITY');

  const purchase = await tx.comboPurchase.findUnique({
    where: { id: input.purchaseId },
    select: { id: true, serviceId: true },
  });
  if (!purchase) throw new AuthError('COMBO_NOT_USABLE');
  if (purchase.serviceId !== detail.serviceId) throw new AuthError('COMBO_SERVICE_MISMATCH');
  const current = line.comboUsages[0];
  if (
    current &&
    current.purchaseId === purchase.id &&
    current.usedBy === usedBy &&
    current.relationshipNote === note
  ) {
    return present(context, invoice);
  }
  // The combo must be usable now; the sale invoice is read under a SHARE lock (design 12.2), then the free sessions are counted
  // with this draft's other choices subtracted, so two lines cannot hold the last session.
  await lockSaleInvoices(tx, [purchase.id]);
  if (!(await purchaseUsable(tx, purchase.id))) throw new AuthError('COMBO_NOT_USABLE');
  const [free] = await tx.$queryRaw<{ free: bigint }[]>`
    SELECT count(*) AS free FROM combo_sessions s
    WHERE s.purchase_id = ${purchase.id}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM combo_session_consumptions c
        WHERE c.session_id = s.id
          AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM combo_session_restorations o WHERE o.consumption_id = c.id))`;
  const heldElsewhere = invoice.lines.filter(
    (other) =>
      other.id !== line.id && other.comboUsages.some((usage) => usage.purchaseId === purchase.id),
  ).length;
  if (Number(free?.free ?? 0n) - heldElsewhere < 1) throw new AuthError('COMBO_NO_SESSION_LEFT');

  const now = await databaseClock(tx);
  if (current) {
    await tx.invoiceLineComboUsage.delete({ where: { invoiceLineId: line.id } });
  }
  await tx.invoiceLineComboUsage.create({
    data: {
      invoiceLineId: line.id,
      invoiceId,
      purchaseId: purchase.id,
      usedBy,
      relationshipNote: note,
      selectedByUserId: context.actor.userId,
    },
    select: { invoiceLineId: true },
  });
  await tx.invoiceLine.update({
    where: { id: line.id },
    data: {
      quantity: 1,
      unitPriceVnd: 0n,
      grossVnd: 0n,
      priceSetByUserId: context.actor.userId,
      priceSetAt: now,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await refreshDraft(context, invoice, now);
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'COMBO_USE_SELECTED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      after: { lineId: line.id, comboPurchaseId: purchase.id, usedBy, hasNote: note !== null },
    },
  );
  return load(context, invoiceId);
}

export async function clearComboUse(
  context: AdminContext,
  invoiceId: string,
  lineId: string,
  input: { expectedVersion: number },
): Promise<InvoiceResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'MANAGE_INVOICES');
  assertCan(context, 'CONSUME_COMBO_SESSIONS', hint.branchId);
  const { tx } = context;
  const invoice = await read();
  if (invoice.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
  if (invoice.status !== 'DRAFT' || invoice.kind !== 'VISIT') {
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  const line = invoice.lines.find((candidate) => candidate.id === lineId);
  const detail = line?.serviceDetails[0];
  if (!line || !detail) throw new AuthError('NOT_FOUND');
  const usage = line.comboUsages[0];
  if (!usage) return present(context, invoice);

  const now = await databaseClock(tx);
  await tx.invoiceLineComboUsage.delete({ where: { invoiceLineId: line.id } });
  // Back to the line's own initial pricing: the fixed price (min = max) or "not yet chosen".
  const pricing = initialPricing(
    detail.pricingUnit,
    detail.catalogPriceMinVnd,
    detail.catalogPriceMaxVnd,
  );
  await tx.invoiceLine.update({
    where: { id: line.id },
    data: {
      quantity: pricing.quantity,
      unitPriceVnd: pricing.unitPriceVnd,
      grossVnd:
        pricing.quantity === null || pricing.unitPriceVnd === null
          ? null
          : BigInt(pricing.quantity) * pricing.unitPriceVnd,
      priceSetByUserId: null,
      priceSetAt: null,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await refreshDraft(context, invoice, now);
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'COMBO_USE_CLEARED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      after: { lineId: line.id, comboPurchaseId: usage.purchaseId },
    },
  );
  return load(context, invoiceId);
}
