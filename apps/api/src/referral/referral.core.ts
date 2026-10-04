import type {
  CustomerReferralResponse,
  ReferralBindRequest,
  ReferralChangeRequest,
  ReferralLookupResponse,
  ReferralPageResponse,
  ReferralPartyResponse,
  ReferralResultResponse,
  ReferrerTotalsResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import {
  bindReferral,
  canBindReferrer,
  findMemberByPhone,
  REFERRAL_AGGREGATE,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { IdentityValidationError, normalizePhone } from '../auth/identity.js';
import { hasFreshReauthentication } from '../auth/session.policy.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { maskPhone } from '../operations/operations.state.js';
import { normalizeReason } from '../operations/service-execution.service.js';

/**
 * Phase 5 P5-5: referral, staff side (design 7 and the Owner decisions of 2026-10-04 in 2.5). A counter binding needs
 * `MANAGE_REFERRALS` at the branch; reading follows `VIEW_LOYALTY` at the branch; changing a referrer is the Owner's alone
 * (`CHANGE_REFERRER`, GLOBAL_ONLY, fresh re-authentication) and only before the reward, with a reason and an append-only history.
 */
export const REFERRAL_PAGE_SIZE = 20;
const GLOBAL = { kind: 'GLOBAL' } as const;
const PENDING_STATUS = 'PENDING';
const REWARDED_STATUS = 'REWARDED';

function referrerPhoneOf(input: unknown): string {
  try {
    return normalizePhone(input).phoneCanonical;
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      throw new AuthError('VALIDATION_FAILED', 'referrerPhone');
    }
    throw error;
  }
}

function pageOf(value: unknown): number {
  if (value === undefined) return 1;
  const page = typeof value === 'string' && /^[0-9]{1,6}$/.test(value) ? Number(value) : 0;
  if (page < 1) throw new AuthError('VALIDATION_FAILED', 'page');
  return page;
}

type Party = { id: string; fullName: string; phoneCanonical: string | null };
const partySelect = { id: true, fullName: true, phoneCanonical: true } as const;

function party(user: Party): ReferralPartyResponse {
  return { id: user.id, displayName: user.fullName, phoneMasked: maskPhone(user.phoneCanonical) };
}

const referralSelect = {
  id: true,
  boundVia: true,
  boundAt: true,
  awardedAt: true,
  referrer: { select: partySelect },
  boundBy: { select: { fullName: true } },
  awardedInvoice: { select: { code: true } },
  changes: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      reason: true,
      createdAt: true,
      oldReferrer: { select: partySelect },
      newReferrer: { select: partySelect },
      actor: { select: { fullName: true } },
    },
  },
} satisfies Prisma.ReferralSelect;
type ReferralRow = Prisma.ReferralGetPayload<{ select: typeof referralSelect }>;

function present(row: ReferralRow): CustomerReferralResponse {
  return {
    referrer: party(row.referrer),
    boundVia: row.boundVia,
    boundAt: row.boundAt.toISOString(),
    boundByName: row.boundBy?.fullName ?? null,
    awarded: row.awardedAt
      ? { at: row.awardedAt.toISOString(), invoiceCode: row.awardedInvoice?.code ?? null }
      : null,
    changes: row.changes.map((change) => ({
      id: change.id,
      oldReferrer: party(change.oldReferrer),
      newReferrer: party(change.newReferrer),
      reason: change.reason,
      actorName: change.actor.fullName,
      createdAt: change.createdAt.toISOString(),
    })),
  };
}

function requireBind(context: AdminContext, branchId: string): void {
  if (!decide(context.actor.graph, 'MANAGE_REFERRALS', { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
}

function requireView(context: AdminContext, branchId: string): void {
  if (!decide(context.actor.graph, 'VIEW_LOYALTY', { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
}

async function customerOrNotFound(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId, kind: 'CUSTOMER' },
    select: partySelect,
  });
  if (!user) throw new AuthError('NOT_FOUND');
  return user;
}

// ---------------------------------------------------------------------------- profile (used by the points profile)

/** What the customer's profile shows about referral: their referrer, their totals as a referrer, and what this viewer may do. */
export async function referralOfCustomer(
  context: AdminContext,
  branchId: string,
  userId: string,
): Promise<{
  referral: CustomerReferralResponse | null;
  asReferrer: ReferrerTotalsResponse;
  can: { bindReferrer: boolean; changeReferrer: boolean };
}> {
  const { tx } = context;
  const row = await tx.referral.findUnique({
    where: { referredUserId: userId },
    select: referralSelect,
  });
  const [referred, rewarded] = await Promise.all([
    tx.referral.count({ where: { referrerUserId: userId } }),
    tx.referral.count({ where: { referrerUserId: userId, awardedAt: { not: null } } }),
  ]);
  const mayBind = decide(context.actor.graph, 'MANAGE_REFERRALS', { kind: 'BRANCH', branchId });
  return {
    referral: row ? present(row) : null,
    asReferrer: { referred, rewarded },
    can: {
      bindReferrer: mayBind && row === null && (await canBindReferrer(tx, userId)),
      changeReferrer:
        row !== null &&
        row.awardedAt === null &&
        decide(context.actor.graph, 'CHANGE_REFERRER', GLOBAL),
    },
  };
}

// ---------------------------------------------------------------------------- counter

/** Exact phone of an existing member (any status), masked; `MANAGE_REFERRALS` at the branch. No listing, no partial match. */
export async function lookupReferrer(
  context: AdminContext,
  branchId: string,
  query: { phone?: string },
): Promise<ReferralLookupResponse> {
  requireBind(context, branchId);
  if (!query.phone) throw new AuthError('VALIDATION_FAILED', 'phone');
  let phoneCanonical: string;
  try {
    phoneCanonical = normalizePhone(query.phone).phoneCanonical;
  } catch (error) {
    if (error instanceof IdentityValidationError) throw new AuthError('VALIDATION_FAILED', 'phone');
    throw error;
  }
  const member = await findMemberByPhone(context.tx, phoneCanonical);
  return { members: member ? [party(member)] : [] };
}

/**
 * Records a customer's referrer at the counter (`MANAGE_REFERRALS` at the branch): an existing member by exact phone, never the
 * customer themselves, only while the customer is still brand-new (design 7.2, P5-T10). Replaying the same referrer returns the
 * stored binding; another referrer is refused (only the Owner changes it, `changeReferrer`). Works while go-live is OFF.
 */
export async function bindAtCounter(
  context: AdminContext,
  branchId: string,
  userId: string,
  request: ReferralBindRequest,
): Promise<ReferralResultResponse> {
  requireBind(context, branchId);
  const phone = referrerPhoneOf(request.referrerPhone);
  const { tx } = context;
  await customerOrNotFound(tx, userId);
  const referrer = await findMemberByPhone(tx, phone);
  if (!referrer) throw new AuthError('NOT_FOUND', 'referrerPhone');
  if (referrer.id === userId) throw new AuthError('REFERRAL_SELF', 'referrerPhone');
  const existing = await tx.referral.findUnique({
    where: { referredUserId: userId },
    select: { id: true, referrerUserId: true },
  });
  if (existing) {
    if (existing.referrerUserId !== referrer.id) throw new AuthError('REFERRAL_ALREADY_BOUND');
    return { referral: await load(tx, existing.id), replayed: true };
  }
  if (!(await canBindReferrer(tx, userId))) throw new AuthError('REFERRAL_NOT_NEW');
  const created = await bindReferral(tx, {
    referredUserId: userId,
    referrerUserId: referrer.id,
    via: 'COUNTER',
    actorUserId: context.actor.userId,
    branchId,
  });
  await appendAdminAudit(context, {
    action: 'REFERRAL_BOUND',
    entityType: 'Referral',
    entityId: created.id,
    subjectUserId: userId,
    branchId,
    after: { via: 'COUNTER', referrerUserId: referrer.id },
  });
  return { referral: await load(tx, created.id), replayed: false };
}

async function load(tx: Prisma.TransactionClient, id: string): Promise<CustomerReferralResponse> {
  return present(await tx.referral.findUniqueOrThrow({ where: { id }, select: referralSelect }));
}

// ---------------------------------------------------------------------------- Owner correction

/**
 * The Owner's correction of a referrer (Owner decision 2026-10-04, replacing the "permanent" rule of OQ-7): `CHANGE_REFERRER`
 * (only the virtual Owner holds it), a fresh password re-authentication and a written reason. Allowed only BEFORE the reward;
 * the history row (old, new, actor, reason, time) is written first and the database refuses a change without it. The referral
 * row is locked, so a concurrent award either happens first (the change is refused) or waits for the change.
 */
export async function changeReferrer(
  context: AdminContext,
  userId: string,
  request: ReferralChangeRequest,
  freshAuthSeconds: number,
): Promise<ReferralResultResponse> {
  if (!decide(context.actor.graph, 'CHANGE_REFERRER', GLOBAL)) throw new AuthError('FORBIDDEN');
  if (!hasFreshReauthentication(context.actor.principal, context.now, freshAuthSeconds)) {
    throw new AuthError('REAUTHENTICATION_REQUIRED');
  }
  const phone = referrerPhoneOf(request.referrerPhone);
  const reason = normalizeReason(request.reason);
  const { tx } = context;
  await customerOrNotFound(tx, userId);
  const locked = await tx.$queryRaw<
    { id: string; referrer_user_id: string; awarded_at: Date | null }[]
  >`
    SELECT id, referrer_user_id, awarded_at FROM referrals
    WHERE referred_user_id = ${userId}::uuid FOR UPDATE`;
  const current = locked[0];
  if (!current) throw new AuthError('NOT_FOUND');
  if (current.awarded_at !== null) throw new AuthError('REFERRAL_LOCKED');
  const next = await findMemberByPhone(tx, phone);
  if (!next) throw new AuthError('NOT_FOUND', 'referrerPhone');
  if (next.id === userId) throw new AuthError('REFERRAL_SELF', 'referrerPhone');
  if (next.id === current.referrer_user_id) {
    throw new AuthError('REFERRAL_SAME_REFERRER', 'referrerPhone');
  }
  await tx.referralChange.create({
    data: {
      referralId: current.id,
      oldReferrerUserId: current.referrer_user_id,
      newReferrerUserId: next.id,
      reason,
      actorUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await tx.referral.update({ where: { id: current.id }, data: { referrerUserId: next.id } });
  await appendOutboxEvent(tx, {
    aggregateType: REFERRAL_AGGREGATE,
    aggregateId: current.id,
    eventType: 'REFERRAL_CHANGED',
    schemaVersion: 1,
    payload: {
      referralId: current.id,
      referredUserId: userId,
      oldReferrerUserId: current.referrer_user_id,
      newReferrerUserId: next.id,
    },
  });
  await appendAdminAudit(context, {
    action: 'REFERRAL_CHANGED',
    entityType: 'Referral',
    entityId: current.id,
    subjectUserId: userId,
    classification: 'FINANCIAL',
    reason,
    before: { referrerUserId: current.referrer_user_id },
    after: {
      referrerUserId: next.id,
      reauthenticatedAt: context.actor.principal.reauthenticatedAt?.toISOString() ?? null,
    },
  });
  return { referral: await load(tx, current.id), replayed: false };
}

// ---------------------------------------------------------------------------- list

/** Every referral, newest first, 20 per page; `status` is PENDING (not rewarded yet) or REWARDED. `VIEW_LOYALTY` at the branch. */
export async function listReferrals(
  context: AdminContext,
  branchId: string,
  query: { page?: string; status?: string },
): Promise<ReferralPageResponse> {
  requireView(context, branchId);
  const page = pageOf(query.page);
  if (
    query.status !== undefined &&
    query.status !== '' &&
    query.status !== PENDING_STATUS &&
    query.status !== REWARDED_STATUS
  ) {
    throw new AuthError('VALIDATION_FAILED', 'status');
  }
  const where: Prisma.ReferralWhereInput =
    query.status === PENDING_STATUS
      ? { awardedAt: null }
      : query.status === REWARDED_STATUS
        ? { awardedAt: { not: null } }
        : {};
  const { tx } = context;
  const [total, rows] = await Promise.all([
    tx.referral.count({ where }),
    tx.referral.findMany({
      where,
      orderBy: [{ boundAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * REFERRAL_PAGE_SIZE,
      take: REFERRAL_PAGE_SIZE,
      select: {
        id: true,
        boundVia: true,
        boundAt: true,
        awardedAt: true,
        referred: { select: partySelect },
        referrer: { select: partySelect },
        awardedInvoice: { select: { code: true } },
        _count: { select: { changes: true } },
      },
    }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      referred: party(row.referred),
      referrer: party(row.referrer),
      boundVia: row.boundVia,
      boundAt: row.boundAt.toISOString(),
      awarded: row.awardedAt
        ? { at: row.awardedAt.toISOString(), invoiceCode: row.awardedInvoice?.code ?? null }
        : null,
      changed: row._count.changes > 0,
    })),
    page,
    pageSize: REFERRAL_PAGE_SIZE,
    total,
    can: { change: decide(context.actor.graph, 'CHANGE_REFERRER', GLOBAL) },
  };
}
