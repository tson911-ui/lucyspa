import {
  LOYALTY_ADJUSTMENT_MAX_POINTS,
  loyaltyTierFor,
  type LoyaltyAdjustmentRequest,
  type LoyaltyAdjustmentResponse,
  type LoyaltyExceptionPageResponse,
  type LoyaltyGoLiveResponse,
  type LoyaltyLedgerEntryResponse,
  type LoyaltyLedgerPageResponse,
  type LoyaltyProfileResponse,
  type LoyaltyWalletName,
  type LoyaltyWalletResponse,
  type WalkInMemberLookupResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { appendLedgerEntry } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { hasFreshReauthentication } from '../auth/session.policy.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { normalizeReason } from '../operations/service-execution.service.js';
import { maskPhone } from '../operations/operations.state.js';
import { lookupMember, maskEmail } from '../walkin/walkin.core.js';

/**
 * Phase 5 P5-3: the admin side of loyalty points (design sections 3, 13, 14). Read access follows the branch
 * the staff member works at (`VIEW_LOYALTY`, exactly like the POS member lookup); adjustments, the exceptions
 * list and the go-live switch are organization-wide (`ADJUST_LOYALTY_POINTS`, `VIEW_LOYALTY_EXCEPTIONS`,
 * `ACTIVATE_LOYALTY` are GLOBAL_ONLY). Points are never edited or deleted: an adjustment is a new ledger entry.
 */
export const LOYALTY_PAGE_SIZE = 20;
const GLOBAL = { kind: 'GLOBAL' } as const;
const WALLETS: readonly LoyaltyWalletName[] = ['SPA', 'BEAUTY'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireView(context: AdminContext, branchId: string): void {
  if (!decide(context.actor.graph, 'VIEW_LOYALTY', { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
}

export function walletResponse(wallet: LoyaltyWalletName, balance: number): LoyaltyWalletResponse {
  const standing = loyaltyTierFor(balance);
  return {
    wallet,
    balancePoints: balance,
    tier: standing.tier,
    memberDiscountBp: standing.memberDiscountBp,
    nextTier: standing.next?.tier ?? null,
    pointsToNextTier: standing.next?.pointsToGo ?? null,
  };
}

export function pageOf(value: unknown): number {
  if (value === undefined) return 1;
  const page = typeof value === 'string' && /^[0-9]{1,6}$/.test(value) ? Number(value) : 0;
  if (page < 1) throw new AuthError('VALIDATION_FAILED', 'page');
  return page;
}

async function customerOrNotFound(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId, kind: 'CUSTOMER' },
    select: { id: true, fullName: true, phoneCanonical: true, emailCanonical: true },
  });
  if (!user) throw new AuthError('NOT_FOUND');
  return user;
}

async function goLiveOf(tx: Prisma.TransactionClient): Promise<LoyaltyGoLiveResponse> {
  const row = await tx.loyaltyGoLive.findFirst({
    select: { goLiveAt: true, activatedBy: { select: { fullName: true } } },
  });
  return {
    active: row !== null,
    goLiveAt: row ? row.goLiveAt.toISOString() : null,
    activatedByName: row?.activatedBy.fullName ?? null,
  };
}

const entrySelect = {
  id: true,
  wallet: true,
  kind: true,
  points: true,
  shortfallPoints: true,
  paidSeq: true,
  reason: true,
  correctsEntryId: true,
  reversesEntryId: true,
  createdAt: true,
  invoice: { select: { code: true } },
  actor: { select: { fullName: true } },
  correction: { select: { id: true } },
} satisfies Prisma.LoyaltyLedgerEntrySelect;
type EntryRow = Prisma.LoyaltyLedgerEntryGetPayload<{ select: typeof entrySelect }>;

function presentEntry(row: EntryRow): LoyaltyLedgerEntryResponse {
  return {
    id: row.id,
    wallet: row.wallet,
    kind: row.kind,
    points: row.points,
    shortfallPoints: row.shortfallPoints,
    invoiceCode: row.invoice?.code ?? null,
    paidSeq: row.paidSeq,
    reason: row.reason,
    actorName: row.actor?.fullName ?? null,
    correctsEntryId: row.correctsEntryId,
    reversesEntryId: row.reversesEntryId,
    corrected: row.correction !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------- reading

/** Exact phone or email match of an active member (`VIEW_LOYALTY` at the branch; masked, no enumeration). */
export function lookupCustomer(
  context: AdminContext,
  branchId: string,
  query: { phone?: string; email?: string },
): Promise<WalkInMemberLookupResponse> {
  requireView(context, branchId);
  return lookupMember(context.tx, query);
}

/** A customer's wallets and tiers (both wallets always shown; a customer with no entry has 0 and no tier). */
export async function getProfile(
  context: AdminContext,
  branchId: string,
  userId: string,
): Promise<LoyaltyProfileResponse> {
  requireView(context, branchId);
  const { tx } = context;
  const user = await customerOrNotFound(tx, userId);
  const accounts = await tx.loyaltyWalletAccount.findMany({
    where: { userId },
    select: { wallet: true, balancePoints: true },
  });
  const balances = new Map(accounts.map((row) => [row.wallet, row.balancePoints]));
  return {
    customer: {
      id: user.id,
      displayName: user.fullName,
      phoneMasked: maskPhone(user.phoneCanonical),
      emailMasked: maskEmail(user.emailCanonical),
    },
    goLive: await goLiveOf(tx),
    wallets: WALLETS.map((wallet) => walletResponse(wallet, balances.get(wallet) ?? 0)),
    can: { adjust: decide(context.actor.graph, 'ADJUST_LOYALTY_POINTS', GLOBAL) },
  };
}

/** The permanent ledger of a customer, newest first, 20 per page (read-only history). */
export async function listLedger(
  context: AdminContext,
  branchId: string,
  userId: string,
  query: { wallet?: string; page?: string },
): Promise<LoyaltyLedgerPageResponse> {
  requireView(context, branchId);
  const page = pageOf(query.page);
  if (query.wallet !== undefined && !WALLETS.includes(query.wallet as LoyaltyWalletName)) {
    throw new AuthError('VALIDATION_FAILED', 'wallet');
  }
  const { tx } = context;
  await customerOrNotFound(tx, userId);
  const where: Prisma.LoyaltyLedgerEntryWhereInput = {
    userId,
    ...(query.wallet ? { wallet: query.wallet as LoyaltyWalletName } : {}),
  };
  const [total, rows] = await Promise.all([
    tx.loyaltyLedgerEntry.count({ where }),
    tx.loyaltyLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * LOYALTY_PAGE_SIZE,
      take: LOYALTY_PAGE_SIZE,
      select: entrySelect,
    }),
  ]);
  return { items: rows.map(presentEntry), page, pageSize: LOYALTY_PAGE_SIZE, total };
}

/**
 * The P5-Q5 shortfall exceptions (OQ-3): every ledger entry that could not take its whole negative amount, newest
 * first. Derived from the permanent ledger, read-only, no notification (P5-Q9). `VIEW_LOYALTY_EXCEPTIONS`, GLOBAL.
 */
export async function listExceptions(
  context: AdminContext,
  query: { page?: string },
): Promise<LoyaltyExceptionPageResponse> {
  if (!decide(context.actor.graph, 'VIEW_LOYALTY_EXCEPTIONS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
  const page = pageOf(query.page);
  const where = { shortfallPoints: { gt: 0 } } as const;
  const { tx } = context;
  const [total, rows] = await Promise.all([
    tx.loyaltyLedgerEntry.count({ where }),
    tx.loyaltyLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * LOYALTY_PAGE_SIZE,
      take: LOYALTY_PAGE_SIZE,
      select: {
        id: true,
        wallet: true,
        kind: true,
        points: true,
        shortfallPoints: true,
        reason: true,
        createdAt: true,
        invoice: { select: { code: true } },
        account: {
          select: { user: { select: { id: true, fullName: true, phoneCanonical: true } } },
        },
      },
    }),
  ]);
  return {
    items: rows.map((row) => ({
      entryId: row.id,
      customer: {
        id: row.account.user.id,
        displayName: row.account.user.fullName,
        phoneMasked: maskPhone(row.account.user.phoneCanonical),
      },
      wallet: row.wallet,
      kind: row.kind,
      appliedPoints: Math.abs(row.points),
      shortfallPoints: row.shortfallPoints,
      invoiceCode: row.invoice?.code ?? null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    pageSize: LOYALTY_PAGE_SIZE,
    total,
  };
}

// ---------------------------------------------------------------------------------------- go-live

function requireOwnerSwitch(context: AdminContext): void {
  if (!decide(context.actor.graph, 'ACTIVATE_LOYALTY', GLOBAL)) throw new AuthError('FORBIDDEN');
}

export async function getGoLive(context: AdminContext): Promise<LoyaltyGoLiveResponse> {
  requireOwnerSwitch(context);
  return goLiveOf(context.tx);
}

/**
 * Switches loyalty on, once and for good (P5-T2): `ACTIVATE_LOYALTY` (only the virtual Owner holds it) and a
 * fresh password re-authentication. The instant comes from the database clock (no backdating, P5-Q1); the row is
 * immutable, so there is no way to switch it off again. Nothing is backfilled.
 */
export async function activateGoLive(
  context: AdminContext,
  freshAuthSeconds: number,
): Promise<LoyaltyGoLiveResponse> {
  requireOwnerSwitch(context);
  if (!hasFreshReauthentication(context.actor.principal, context.now, freshAuthSeconds)) {
    throw new AuthError('REAUTHENTICATION_REQUIRED');
  }
  const { tx } = context;
  // Serialize concurrent activations: the second one finds the row and is refused.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${0x4c4f5941}::integer, 1::integer)::text`;
  if ((await tx.loyaltyGoLive.count()) > 0) throw new AuthError('LOYALTY_ALREADY_LIVE');
  const row = await tx.loyaltyGoLive.create({
    data: { activatedByUserId: context.actor.userId },
    select: { goLiveAt: true },
  });
  await appendAdminAudit(context, {
    action: 'LOYALTY_GO_LIVE_ACTIVATED',
    entityType: 'LoyaltyGoLive',
    entityId: '1',
    classification: 'FINANCIAL',
    after: {
      goLiveAt: row.goLiveAt.toISOString(),
      reauthenticatedAt: context.actor.principal.reauthenticatedAt?.toISOString() ?? null,
    },
  });
  return goLiveOf(tx);
}

// ------------------------------------------------------------------------------------ adjustment

function adjustmentInput(input: LoyaltyAdjustmentRequest) {
  if (!WALLETS.includes(input.wallet)) throw new AuthError('VALIDATION_FAILED', 'wallet');
  if (
    !Number.isSafeInteger(input.points) ||
    input.points === 0 ||
    Math.abs(input.points) > LOYALTY_ADJUSTMENT_MAX_POINTS
  ) {
    throw new AuthError('VALIDATION_FAILED', 'points');
  }
  if (typeof input.clientRequestId !== 'string' || !UUID.test(input.clientRequestId)) {
    throw new AuthError('VALIDATION_FAILED', 'clientRequestId');
  }
  if (input.correctsEntryId !== undefined && !UUID.test(input.correctsEntryId)) {
    throw new AuthError('VALIDATION_FAILED', 'correctsEntryId');
  }
  return {
    wallet: input.wallet,
    points: input.points,
    reason: normalizeReason(input.reason),
    clientRequestId: input.clientRequestId.toLowerCase(),
    correctsEntryId: input.correctsEntryId?.toLowerCase(),
  };
}

/**
 * Manual points adjustment (PRD 18.4): amount, wallet, reason, actor and time, written as a NEW ledger entry
 * (optionally linked to the entry it offsets; one correction per entry). `ADJUST_LOYALTY_POINTS` (GLOBAL_ONLY,
 * FINANCIAL) and a fresh re-authentication. A deduction larger than the balance takes what the balance has, records
 * the shortfall and flags it (P5-T8). A replay of the same `clientRequestId` returns the stored result.
 */
export async function adjustPoints(
  context: AdminContext,
  userId: string,
  request: LoyaltyAdjustmentRequest,
  freshAuthSeconds: number,
): Promise<LoyaltyAdjustmentResponse> {
  if (!decide(context.actor.graph, 'ADJUST_LOYALTY_POINTS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
  if (!hasFreshReauthentication(context.actor.principal, context.now, freshAuthSeconds)) {
    throw new AuthError('REAUTHENTICATION_REQUIRED');
  }
  const input = adjustmentInput(request);
  const { tx } = context;
  await customerOrNotFound(tx, userId);
  if ((await tx.loyaltyGoLive.count()) === 0) throw new AuthError('LOYALTY_NOT_LIVE');
  if (input.correctsEntryId) {
    const target = await tx.loyaltyLedgerEntry.findUnique({
      where: { id: input.correctsEntryId },
      select: { userId: true, wallet: true, correction: { select: { id: true } } },
    });
    if (!target || target.userId !== userId || target.wallet !== input.wallet) {
      throw new AuthError('VALIDATION_FAILED', 'correctsEntryId');
    }
    if (target.correction) throw new AuthError('LOYALTY_ENTRY_ALREADY_CORRECTED');
  }
  const kind = input.correctsEntryId ? 'MANUAL_CORRECTION' : 'MANUAL_ADJUSTMENT';
  const result = await appendLedgerEntry(tx, {
    userId,
    wallet: input.wallet,
    kind,
    points: input.points,
    idempotencyKey: `MANUAL:${context.actor.userId}:${input.clientRequestId}`,
    reason: input.reason,
    actorUserId: context.actor.userId,
    ...(input.correctsEntryId ? { correctsEntryId: input.correctsEntryId } : {}),
  });
  if (!result.created) {
    // The same client request must mean the same adjustment; anything else is a conflict.
    if (
      result.existingUserId !== userId ||
      result.existingWallet !== input.wallet ||
      result.existingKind !== kind ||
      result.existingRequested !== input.points
    ) {
      throw new AuthError('CONFLICT');
    }
  } else {
    await appendAdminAudit(context, {
      action: 'LOYALTY_POINTS_ADJUSTED',
      entityType: 'LoyaltyLedgerEntry',
      entityId: result.entryId,
      subjectUserId: userId,
      classification: 'FINANCIAL',
      reason: input.reason,
      before: { wallet: input.wallet, balancePoints: result.balanceAfter - result.applied },
      after: {
        kind,
        wallet: input.wallet,
        requestedPoints: input.points,
        appliedPoints: result.applied,
        shortfallPoints: result.shortfall,
        balancePoints: result.balanceAfter,
        correctsEntryId: input.correctsEntryId ?? null,
        reauthenticatedAt: context.actor.principal.reauthenticatedAt?.toISOString() ?? null,
      },
    });
  }
  const entry = await tx.loyaltyLedgerEntry.findUniqueOrThrow({
    where: { id: result.entryId },
    select: entrySelect,
  });
  return {
    entry: presentEntry(entry),
    wallet: walletResponse(input.wallet, result.balanceAfter),
    replayed: !result.created,
  };
}
