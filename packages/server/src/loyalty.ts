import {
  loyaltyPointsForPaidVnd,
  REFERRAL_AWARD_POINTS,
  type LoyaltyLedgerKindName,
  type LoyaltyWalletName,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type DatabaseClient, type Prisma } from '@lucy-spa/database';
import { takeSharedAuthGraphLock } from './auth-lock.js';
import { referralAwardCandidates, type ReferralAwardCandidate } from './referral.js';

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

export const referralAwardKey = (referralId: string, wallet: LoyaltyWalletName): string =>
  `REFERRAL_AWARD:${referralId}:${wallet}`;

export interface LedgerEffect {
  readonly userId: string;
  readonly wallet: LoyaltyWalletName;
  readonly kind: LoyaltyLedgerKindName;
  /** A referral award names its referral (and carries no invoice: the referral row holds the award facts). */
  readonly referralId?: string;
  /** Signed requested points, never 0. A negative request is clamped to the balance (P5-Q5, reversals only) unless `refuseBeyondBalance`. */
  readonly points: number;
  readonly idempotencyKey: string;
  readonly invoiceId?: string;
  readonly paidSeq?: number;
  readonly reversesEntryId?: string;
  readonly correctsEntryId?: string;
  readonly reason?: string;
  readonly actorUserId?: string;
  readonly branchId?: string | null;
  /**
   * A manual deduction (Owner decision on P5-T8: hard block). When the request is larger than the balance nothing is
   * written and `LoyaltyBalanceError` is thrown; reversals leave this off and keep the P5-Q5 clamp.
   */
  readonly refuseBeyondBalance?: boolean;
}

/** A manual deduction larger than the current balance: refused, nothing written, no exception row. */
export class LoyaltyBalanceError extends Error {
  constructor(readonly balance: number) {
    super('The balance is smaller than the deduction');
    this.name = 'LoyaltyBalanceError';
  }
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

const ledgerEvents: Record<LoyaltyLedgerKindName, string> = {
  EARN: 'LOYALTY_POINTS_EARNED',
  EARN_REVERSAL: 'LOYALTY_POINTS_REVERSED',
  REFERRAL_AWARD: 'REFERRAL_AWARDED',
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
  if (effect.refuseBeyondBalance && requestedDebit > wallet.balance_points) {
    throw new LoyaltyBalanceError(wallet.balance_points);
  }
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
      referralId: effect.referralId ?? null,
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
    ...(effect.referralId ? { referralId: effect.referralId } : {}),
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
  /**
   * Phase 6 P6-8: what the Spa wallet earns on = the invoice total without its PRODUCT lines and shipping fee. Until the Beauty side
   * has its own discount (P6-9, P6-11) a product line has none, so this is total - product gross - fee; for every invoice without a
   * product line it is exactly the total, as before.
   */
  spa_net_vnd: bigint;
  paid_at: Date | null;
  branch_id: string;
  /** Null for a combo sale (no visit). */
  visit_id: string | null;
  kind: 'VISIT' | 'COMBO_SALE' | 'PRODUCT_SALE';
  cancelled_by_user_id: string | null;
}

async function lockInvoiceShared(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<LockedInvoice | null> {
  const rows = await tx.$queryRaw<LockedInvoice[]>`
    SELECT i.id, i.status::text AS status, i.paid_seq, i.payer_user_id, i.total_vnd,
           (i.total_vnd - i.shipping_fee_vnd - COALESCE((
             SELECT sum(l.gross_vnd) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'PRODUCT'), 0))::bigint AS spa_net_vnd,
           i.paid_at, i.branch_id,
           i.visit_id, i.kind::text AS kind, i.cancelled_by_user_id
    FROM invoices i WHERE i.id = ${invoiceId}::uuid FOR SHARE`;
  return rows[0] ?? null;
}

/**
 * Issues the combo of a PAID combo sale to its buyer, one session row per session (P5-T11, design 9.3). The unique key
 * `(invoice line, paid episode)` makes a replay create nothing. The purchase copies the combo LINE that was sold, never the live
 * definition. The caller already holds the invoice (shared) and has checked that this is the invoice's current paid episode
 * and that loyalty is live. Returns whether a combo was issued now.
 */
async function issueCombo(
  tx: Prisma.TransactionClient,
  invoice: LockedInvoice,
  paidSeq: number,
): Promise<boolean> {
  const line = await tx.invoiceLine.findFirst({
    where: { invoiceId: invoice.id, kind: 'COMBO_PURCHASE' },
    select: { id: true, comboDetails: true },
  });
  const detail = line?.comboDetails[0];
  if (!line || !detail || invoice.payer_user_id === null) return false;
  const existing = await tx.comboPurchase.findUnique({
    where: { invoiceLineId_paidSeq: { invoiceLineId: line.id, paidSeq } },
    select: { id: true },
  });
  if (existing) return false;
  // Owner answer of 2026-10-05 (provisional): a combo frozen by the reversal of its sale while sessions were in use comes back as
  // the SAME combo when the sale is paid again; no second combo is issued (the number of sessions never exceeds what was sold).
  const frozen = await tx.comboPurchase.findFirst({
    where: {
      invoiceLineId: line.id,
      paidSeq: { lt: paidSeq },
      voidedAt: null,
      sessions: { some: { consumptions: { some: { release: null, restoration: null } } } },
    },
    orderBy: { paidSeq: 'desc' },
    select: { id: true, paidSeq: true, reopenings: { select: { paidSeq: true } } },
  });
  if (frozen) {
    if (frozen.reopenings.some((reopening) => reopening.paidSeq === paidSeq)) return false;
    await tx.comboPurchaseReopening.create({
      data: { purchaseId: frozen.id, paidSeq },
      select: { id: true },
    });
    await appendOutboxEvent(tx, {
      branchId: invoice.branch_id,
      aggregateType: 'ComboPurchase',
      aggregateId: frozen.id,
      eventType: 'COMBO_REOPENED',
      schemaVersion: 1,
      payload: { comboPurchaseId: frozen.id, invoiceId: invoice.id, paidSeq },
    });
    await tx.auditEvent.create({
      data: {
        action: 'COMBO_REOPENED',
        actorKind: 'SYSTEM',
        subjectUserId: invoice.payer_user_id,
        entityType: 'ComboPurchase',
        entityId: frozen.id,
        branchId: invoice.branch_id,
        dataClassification: 'FINANCIAL',
        after: { invoiceId: invoice.id, paidSeq, issuedInEpisode: frozen.paidSeq },
      },
      select: { id: true },
    });
    return true;
  }
  const sessions = [
    ...Array.from({ length: detail.paidSessions }, (_, index) => ({
      sessionNo: index + 1,
      kind: 'PAID' as const,
    })),
    ...Array.from({ length: detail.bonusSessions }, (_, index) => ({
      sessionNo: detail.paidSessions + index + 1,
      kind: 'BONUS' as const,
    })),
  ];
  const purchase = await tx.comboPurchase.create({
    data: {
      comboId: detail.comboId,
      versionId: detail.versionId,
      ownerUserId: invoice.payer_user_id,
      invoiceLineId: line.id,
      paidSeq,
      serviceId: detail.serviceId,
      nameVi: detail.nameVi,
      nameEn: detail.nameEn,
      paidSessions: detail.paidSessions,
      bonusSessions: detail.bonusSessions,
      priceVnd: detail.priceVnd,
      expiryMode: detail.expiryMode,
      sessions: { create: sessions },
    },
    select: { id: true },
  });
  await appendOutboxEvent(tx, {
    branchId: invoice.branch_id,
    aggregateType: 'ComboPurchase',
    aggregateId: purchase.id,
    eventType: 'COMBO_ISSUED',
    schemaVersion: 1,
    payload: {
      comboPurchaseId: purchase.id,
      invoiceId: invoice.id,
      paidSeq,
      paidSessions: detail.paidSessions,
      bonusSessions: detail.bonusSessions,
    },
  });
  await tx.auditEvent.create({
    data: {
      action: 'COMBO_ISSUED',
      actorKind: 'SYSTEM',
      subjectUserId: invoice.payer_user_id,
      entityType: 'ComboPurchase',
      entityId: purchase.id,
      branchId: invoice.branch_id,
      dataClassification: 'FINANCIAL',
      after: {
        invoiceId: invoice.id,
        paidSeq,
        comboId: detail.comboId,
        versionId: detail.versionId,
        paidSessions: detail.paidSessions,
        bonusSessions: detail.bonusSessions,
        priceVnd: detail.priceVnd.toString(),
      },
    },
    select: { id: true },
  });
  return true;
}

/**
 * The paid episode that issued a combo has ended (the payment was reversed or the invoice cancelled): the combo is taken back
 * while none of its sessions is in use (Owner answer of 2026-10-05). The purchase and its sessions stay as history
 * (`voided_at`, never deleted); paying the invoice again issues a NEW purchase under the next paid episode. A combo with a
 * session in use is NOT revoked: it is FROZEN (the sale invoice is no longer paid, so the database refuses to use it), listed
 * for the Owner, and re-opened as the same combo when the sale is paid again (P5-8, Owner answer provisional).
 * Returns whether a combo was revoked now.
 */
async function revokeCombo(
  tx: Prisma.TransactionClient,
  invoice: LockedInvoice,
  paidSeq: number,
  voidedBy: string | null,
  reason: string,
): Promise<boolean> {
  const purchases = await tx.comboPurchase.findMany({
    where: { invoiceLine: { invoiceId: invoice.id }, paidSeq, voidedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true, reopenings: { select: { paidSeq: true } } },
  });
  let revoked = false;
  for (const purchase of purchases) {
    if (voidedBy === null) throw new Error('A revoked combo records who ended its paid episode');
    // Reopened by a later payment of the sale and usable now: never revoked (the reversal event came late).
    if (
      invoice.status === 'PAID' &&
      purchase.reopenings.some((reopening) => reopening.paidSeq === invoice.paid_seq)
    ) {
      continue;
    }
    const inUse = await tx.comboSessionConsumption.count({
      where: {
        session: { purchaseId: purchase.id },
        release: null,
        restoration: null,
      },
    });
    if (inUse > 0) {
      await tx.auditEvent.create({
        data: {
          action: 'COMBO_REVOKE_BLOCKED_IN_USE',
          actorKind: 'SYSTEM',
          entityType: 'ComboPurchase',
          entityId: purchase.id,
          branchId: invoice.branch_id,
          dataClassification: 'FINANCIAL',
          after: { invoiceId: invoice.id, endedPaidSeq: paidSeq, sessionsInUse: inUse },
        },
        select: { id: true },
      });
      continue;
    }
    await tx.comboPurchase.update({
      where: { id: purchase.id },
      data: { voidedAt: new Date(), voidedByUserId: voidedBy, voidReason: reason },
      select: { id: true },
    });
    await appendOutboxEvent(tx, {
      branchId: invoice.branch_id,
      aggregateType: 'ComboPurchase',
      aggregateId: purchase.id,
      eventType: 'COMBO_REVOKED',
      schemaVersion: 1,
      payload: { comboPurchaseId: purchase.id, invoiceId: invoice.id, endedPaidSeq: paidSeq },
    });
    await tx.auditEvent.create({
      data: {
        action: 'COMBO_REVOKED',
        actorKind: 'SYSTEM',
        subjectUserId: invoice.payer_user_id,
        entityType: 'ComboPurchase',
        entityId: purchase.id,
        branchId: invoice.branch_id,
        dataClassification: 'FINANCIAL',
        reason,
        after: { invoiceId: invoice.id, endedPaidSeq: paidSeq },
      },
      select: { id: true },
    });
    revoked = true;
  }
  return revoked;
}

type Event = Prisma.OutboxEventGetPayload<object>;

/**
 * Locks the wallets this event will write in the design's fixed order (user id, then wallet), so two consumers working on
 * invoices of linked customers never wait on each other in a cycle (design 12.2). Created lazily; only called when go-live is ON.
 */
async function lockWalletsSorted(
  tx: Prisma.TransactionClient,
  keys: readonly { userId: string; wallet: LoyaltyWalletName }[],
): Promise<void> {
  const unique = [
    ...new Map(keys.map((key) => [`${key.userId}:${key.wallet}`, key])).values(),
  ].sort((a, b) =>
    a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : a.wallet < b.wallet ? -1 : 1,
  );
  for (const key of unique) {
    await tx.$executeRaw`
      INSERT INTO loyalty_wallets (user_id, wallet)
      VALUES (${key.userId}::uuid, ${key.wallet}::"LoyaltyWallet")
      ON CONFLICT DO NOTHING`;
    await tx.$queryRaw`
      SELECT 1 FROM loyalty_wallets
      WHERE user_id = ${key.userId}::uuid AND wallet = ${key.wallet}::"LoyaltyWallet" FOR UPDATE`;
  }
}

/**
 * Pays the referrer of a first paid visit: +10 Spa AND +10 Beauty in one transaction, then stamps the referral (design 7.5,
 * Owner decisions 2026-10-04). Never reversed by a later refund, reopen or cancellation; the unique ledger keys and the
 * single stamp make a replay create nothing. Returns how many referrals were rewarded.
 */
async function grantReferralAwards(
  tx: Prisma.TransactionClient,
  invoice: LockedInvoice,
  paidSeq: number,
  candidates: readonly ReferralAwardCandidate[],
): Promise<number> {
  let granted = 0;
  for (const candidate of candidates) {
    let created = false;
    for (const wallet of ['SPA', 'BEAUTY'] as const) {
      const result = await appendLedgerEntry(tx, {
        userId: candidate.referrerUserId,
        wallet,
        kind: 'REFERRAL_AWARD',
        points: REFERRAL_AWARD_POINTS,
        idempotencyKey: referralAwardKey(candidate.referralId, wallet),
        referralId: candidate.referralId,
        branchId: invoice.branch_id,
      });
      created ||= result.created;
    }
    if (!created) continue;
    await tx.$executeRaw`
      UPDATE referrals
      SET awarded_at = clock_timestamp(), awarded_invoice_id = ${invoice.id}::uuid, awarded_paid_seq = ${paidSeq}
      WHERE id = ${candidate.referralId}::uuid AND awarded_at IS NULL`;
    await tx.auditEvent.create({
      data: {
        action: 'REFERRAL_AWARDED',
        actorKind: 'SYSTEM',
        subjectUserId: candidate.referrerUserId,
        entityType: 'Referral',
        entityId: candidate.referralId,
        branchId: invoice.branch_id,
        dataClassification: 'FINANCIAL',
        after: {
          referredUserId: candidate.referredUserId,
          invoiceId: invoice.id,
          paidSeq,
          spaPoints: REFERRAL_AWARD_POINTS,
          beautyPoints: REFERRAL_AWARD_POINTS,
        },
      },
      select: { id: true },
    });
    granted += 1;
  }
  return granted;
}

/**
 * `INVOICE_PAID`: write the earn entry for this paid episode (design 4.1-4.4) and, when real money paid a first visit, the
 * referral award (design 7.5). One outcome is recorded for the event: `APPLIED` if anything was written, else the earn outcome.
 */
async function paid(tx: Prisma.TransactionClient, event: Event): Promise<LoyaltyEventOutcome> {
  const invoiceId = field(event.payload, 'invoiceId');
  const paidSeq = field(event.payload, 'paidSeq');
  if (typeof invoiceId !== 'string' || !UUID.test(invoiceId) || !Number.isSafeInteger(paidSeq)) {
    throw new Error('Malformed INVOICE_PAID event');
  }
  const invoice = await lockInvoiceShared(tx, invoiceId);
  // Stale-episode guard (P5-T9): only the invoice's CURRENT paid episode can earn or reward.
  if (!invoice || invoice.status !== 'PAID' || invoice.paid_seq !== paidSeq) return 'SKIPPED_STALE';
  const goLive = await tx.loyaltyGoLive.findFirst({ select: { goLiveAt: true } });
  const live = goLive !== null && invoice.paid_at !== null && invoice.paid_at >= goLive.goLiveAt;
  // A 0đ invoice (zero-balance settlement) never rewards a referral; real money must have been paid (Owner, OQ-4).
  // The referral reward is about a first VISIT: buying a combo (an invoice with no visit) never triggers it.
  const awards =
    live &&
    invoice.visit_id !== null &&
    field(event.payload, 'settlement') === 'PAYMENT' &&
    invoice.spa_net_vnd > 0n
      ? await referralAwardCandidates(tx, { visitId: invoice.visit_id, paidAt: invoice.paid_at! })
      : [];
  let outcome: LoyaltyEventOutcome;
  let points = 0;
  if (invoice.payer_user_id === null) {
    outcome = 'SKIPPED_GUEST';
  } else if (!live) {
    outcome = 'SKIPPED_PRE_GO_LIVE';
  } else {
    const payer = await tx.user.findUnique({
      where: { id: invoice.payer_user_id },
      select: { kind: true },
    });
    if (payer?.kind !== 'CUSTOMER') {
      outcome = 'SKIPPED_NOT_MEMBER';
    } else {
      points = loyaltyPointsForPaidVnd(invoice.spa_net_vnd);
      outcome = points === 0 ? 'NOOP' : 'APPLIED';
    }
  }
  if (live) {
    await lockWalletsSorted(tx, [
      ...awards.flatMap((award) => [
        { userId: award.referrerUserId, wallet: 'SPA' as const },
        { userId: award.referrerUserId, wallet: 'BEAUTY' as const },
      ]),
      ...(points > 0 ? [{ userId: invoice.payer_user_id!, wallet: 'SPA' as const }] : []),
    ]);
  }
  if (points > 0) {
    const result = await appendLedgerEntry(tx, {
      userId: invoice.payer_user_id!,
      wallet: 'SPA',
      kind: 'EARN',
      points,
      idempotencyKey: earnKey('SPA', invoiceId, paidSeq as number),
      invoiceId,
      paidSeq: paidSeq as number,
      branchId: invoice.branch_id,
    });
    outcome = result.created ? 'APPLIED' : 'NOOP';
  }
  const rewarded = await grantReferralAwards(tx, invoice, paidSeq as number, awards);
  // The combo of a paid combo sale is issued whatever the earn outcome was (0 points, a replay): its own unique key guards it.
  const issued =
    live && invoice.kind === 'COMBO_SALE' && outcome !== 'SKIPPED_NOT_MEMBER'
      ? await issueCombo(tx, invoice, paidSeq as number)
      : false;
  return rewarded > 0 || issued ? 'APPLIED' : outcome;
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
  if (invoice.kind === 'COMBO_SALE') {
    // Who ended the paid episode: the person who reversed the payment, or who cancelled the invoice.
    let endedBy = invoice.cancelled_by_user_id;
    const reversedPaymentId = field(event.payload, 'reversedPaymentId');
    if (endedBy === null && typeof reversedPaymentId === 'string' && UUID.test(reversedPaymentId)) {
      const correction = await tx.paymentCorrection.findUnique({
        where: { paymentId: reversedPaymentId },
        select: { actorUserId: true },
      });
      endedBy = correction?.actorUserId ?? null;
    }
    const revoked = await revokeCombo(
      tx,
      invoice,
      paidSeq as number,
      endedBy,
      seqKey === 'paidSeq'
        ? 'Thanh toán đã bị đảo, combo chưa dùng buổi nào được thu hồi'
        : 'Hóa đơn đã bị hủy, combo chưa dùng buổi nào được thu hồi',
    );
    applied ||= revoked;
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
      ? await paid(tx, event)
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
