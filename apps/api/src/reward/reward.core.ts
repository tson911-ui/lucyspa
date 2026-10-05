import type {
  RewardEntitlementPageResponse,
  RewardEntitlementResponse,
  RewardEntitlementStatus,
  RewardIssueOptionsResponse,
  RewardIssueRequest,
  RewardLookupResponse,
  RewardReasonRequest,
  RewardUseRequest,
} from '@lucy-spa/contracts';
import { REWARD_MAX_QUANTITY } from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { findMemberByPhone } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { IdentityValidationError, normalizePhone } from '../auth/identity.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { maskPhone } from '../operations/operations.state.js';
import { normalizeReason } from '../operations/service-execution.service.js';
import { requireManageCatalog } from './reward-catalog.core.js';

/**
 * Phase 5 P5-9: customers' reward entitlements (design 10, PRD 21). Staff holding `ISSUE_REWARDS` AT A BRANCH grant an active
 * catalog item to a member (a reason is required), mark one unit at a time as used, and revoke the rest of a grant (a reason is
 * required). A mistaken use is corrected only by a manager holding `MANAGE_REWARD_CATALOG` (global), as one offset row with a
 * reason. Nothing is ever deleted or edited: uses, restorations and the revocation stay as history (database triggers).
 *
 * Rewards are a separate domain from points: no command here touches a wallet or the ledger, and there is no exchange of points
 * for a reward anywhere. Every command that writes needs the loyalty go-live switch ON (the database refuses a grant or a use
 * otherwise). A reward may be used at any branch the staff member holds `ISSUE_REWARDS` at; the branch is recorded.
 */

export const REWARD_PAGE_SIZE = 20;

function requireIssue(context: AdminContext, branchId: string): void {
  if (!decide(context.actor.graph, 'ISSUE_REWARDS', { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
}

async function requireLive(tx: Prisma.TransactionClient): Promise<void> {
  if ((await tx.loyaltyGoLive.count()) === 0) throw new AuthError('LOYALTY_NOT_LIVE');
}

function pageOf(value: unknown): number {
  if (value === undefined) return 1;
  const page = typeof value === 'string' && /^[0-9]{1,6}$/.test(value) ? Number(value) : 0;
  if (page < 1) throw new AuthError('VALIDATION_FAILED', 'page');
  return page;
}

const entitlementSelect = {
  id: true,
  ownerUserId: true,
  quantityIssued: true,
  issuedAt: true,
  expiresAt: true,
  reason: true,
  voidedAt: true,
  voidReason: true,
  issuedBy: { select: { fullName: true } },
  voidedBy: { select: { fullName: true } },
  catalogItem: {
    select: {
      id: true,
      kind: true,
      nameVi: true,
      nameEn: true,
      service: { select: { nameVi: true, nameEn: true } },
    },
  },
  manualUses: {
    orderBy: [{ usedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      usedAt: true,
      note: true,
      branch: { select: { id: true, name: true } },
      usedBy: { select: { fullName: true } },
      restoration: {
        select: { restoredAt: true, reason: true, restoredBy: { select: { fullName: true } } },
      },
    },
  },
  redemptions: { select: { release: { select: { id: true } } } },
} satisfies Prisma.RewardEntitlementSelect;

type EntitlementRow = Prisma.RewardEntitlementGetPayload<{ select: typeof entitlementSelect }>;

/** Units in use now: invoice redemptions not released plus manual uses not restored (the same rule as the database guards). */
function unitsInUse(row: EntitlementRow): number {
  return (
    row.manualUses.filter((use) => use.restoration === null).length +
    row.redemptions.filter((redemption) => redemption.release === null).length
  );
}

function statusOf(row: EntitlementRow, now: Date): RewardEntitlementStatus {
  if (row.voidedAt) return 'VOIDED';
  if (row.quantityIssued - unitsInUse(row) <= 0) return 'USED_UP';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

function presentEntitlement(
  row: EntitlementRow,
  now: Date,
  allow: { issue: boolean; manage: boolean },
): RewardEntitlementResponse {
  const status = statusOf(row, now);
  const used = unitsInUse(row);
  return {
    id: row.id,
    item: {
      id: row.catalogItem.id,
      kind: row.catalogItem.kind,
      nameVi: row.catalogItem.nameVi,
      nameEn: row.catalogItem.nameEn,
      service: row.catalogItem.service,
    },
    status,
    quantityIssued: row.quantityIssued,
    quantityUsed: used,
    quantityLeft: row.quantityIssued - used,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    issuedByName: row.issuedBy?.fullName ?? null,
    reason: row.reason,
    void: row.voidedAt
      ? {
          at: row.voidedAt.toISOString(),
          byName: row.voidedBy?.fullName ?? '',
          reason: row.voidReason ?? '',
        }
      : null,
    uses: row.manualUses.map((use) => ({
      id: use.id,
      usedAt: use.usedAt.toISOString(),
      branchName: use.branch.name,
      usedByName: use.usedBy.fullName,
      note: use.note,
      restoration: use.restoration
        ? {
            restoredAt: use.restoration.restoredAt.toISOString(),
            restoredByName: use.restoration.restoredBy.fullName,
            reason: use.restoration.reason,
          }
        : null,
    })),
    can: {
      use: allow.issue && status === 'ACTIVE',
      revoke: allow.issue && row.voidedAt === null,
      restore:
        allow.manage && row.voidedAt === null && row.manualUses.some((u) => u.restoration === null),
    },
  };
}

function allowances(context: AdminContext, branchId: string) {
  return {
    issue: decide(context.actor.graph, 'ISSUE_REWARDS', { kind: 'BRANCH', branchId }),
    manage: decide(context.actor.graph, 'MANAGE_REWARD_CATALOG', { kind: 'GLOBAL' }),
  };
}

async function loadEntitlement(
  context: AdminContext,
  id: string,
  branchId: string,
): Promise<RewardEntitlementResponse> {
  const row = await context.tx.rewardEntitlement.findUniqueOrThrow({
    where: { id },
    select: entitlementSelect,
  });
  return presentEntitlement(row, context.now, allowances(context, branchId));
}

/** Locks the entitlement row (design 12.2: the customer rows first, then the reward rows). */
async function lockEntitlement(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM reward_entitlements WHERE id = ${id}::uuid FOR UPDATE`;
}

/** The owner of an entitlement, for the command's customer lock; null when it does not exist. */
export async function ownerOfEntitlement(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<string | null> {
  const row = await tx.rewardEntitlement.findUnique({
    where: { id },
    select: { ownerUserId: true },
  });
  return row?.ownerUserId ?? null;
}

/** The owner of the entitlement a use belongs to. */
export async function ownerOfUse(tx: Prisma.TransactionClient, id: string): Promise<string | null> {
  const row = await tx.rewardManualUse.findUnique({
    where: { id },
    select: { entitlement: { select: { ownerUserId: true } } },
  });
  return row?.entitlement.ownerUserId ?? null;
}

// ------------------------------------------------------------------------------------------------------------ reading

/** The active items staff can grant (name, kind, service, expiry rule), and whether go-live is ON. */
export async function issueOptions(
  context: AdminContext,
  branchId: string,
): Promise<RewardIssueOptionsResponse> {
  requireIssue(context, branchId);
  const { tx } = context;
  const [items, live] = await Promise.all([
    tx.rewardCatalogItem.findMany({
      where: { active: true },
      orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        kind: true,
        nameVi: true,
        nameEn: true,
        expiryMode: true,
        expiryDays: true,
        service: { select: { nameVi: true, nameEn: true } },
      },
    }),
    tx.loyaltyGoLive.count(),
  ]);
  return {
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      service: item.service,
      expiryDays: item.expiryMode === 'DAYS_AFTER_ISSUE' ? item.expiryDays : null,
    })),
    loyaltyLive: live > 0,
  };
}

/** Exact phone of an existing member (masked); `ISSUE_REWARDS` at the branch. No listing, no partial match. */
export async function lookupMember(
  context: AdminContext,
  branchId: string,
  query: { phone?: string },
): Promise<RewardLookupResponse> {
  requireIssue(context, branchId);
  if (!query.phone) throw new AuthError('VALIDATION_FAILED', 'phone');
  let phoneCanonical: string;
  try {
    phoneCanonical = normalizePhone(query.phone).phoneCanonical;
  } catch (error) {
    if (error instanceof IdentityValidationError) throw new AuthError('VALIDATION_FAILED', 'phone');
    throw error;
  }
  const member = await findMemberByPhone(context.tx, phoneCanonical);
  return {
    members: member
      ? [
          {
            id: member.id,
            displayName: member.fullName,
            phoneMasked: maskPhone(member.phoneCanonical),
          },
        ]
      : [],
  };
}

async function customerOrNotFound(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId, kind: 'CUSTOMER' },
    select: { id: true, fullName: true, phoneCanonical: true },
  });
  if (!user) throw new AuthError('NOT_FOUND');
  return user;
}

/** A customer's entitlements with their full history, newest first, 20 per page. `ISSUE_REWARDS` at the branch. */
export async function listEntitlements(
  context: AdminContext,
  branchId: string,
  userId: string,
  query: { page?: string },
): Promise<RewardEntitlementPageResponse> {
  requireIssue(context, branchId);
  const page = pageOf(query.page);
  const { tx } = context;
  const customer = await customerOrNotFound(tx, userId);
  const [total, rows, live] = await Promise.all([
    tx.rewardEntitlement.count({ where: { ownerUserId: userId } }),
    tx.rewardEntitlement.findMany({
      where: { ownerUserId: userId },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * REWARD_PAGE_SIZE,
      take: REWARD_PAGE_SIZE,
      select: entitlementSelect,
    }),
    tx.loyaltyGoLive.count(),
  ]);
  const allow = allowances(context, branchId);
  return {
    customer: {
      id: customer.id,
      displayName: customer.fullName,
      phoneMasked: maskPhone(customer.phoneCanonical),
    },
    items: rows.map((row) => presentEntitlement(row, context.now, allow)),
    page,
    pageSize: REWARD_PAGE_SIZE,
    total,
    canIssue: allow.issue,
    loyaltyLive: live > 0,
  };
}

// ------------------------------------------------------------------------------------------------------------ writing

function quantityOf(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > REWARD_MAX_QUANTITY
  ) {
    throw new AuthError('VALIDATION_FAILED', 'quantity');
  }
  return value;
}

/**
 * Grants an active catalog item to a member: a quantity, a reason (both required) and the acting staff member and branch are
 * recorded. An item with an expiry rule fixes the entitlement's expiry at this moment (the database does it). Needs go-live ON.
 */
export async function issueReward(
  context: AdminContext,
  branchId: string,
  userId: string,
  request: RewardIssueRequest,
): Promise<RewardEntitlementResponse> {
  requireIssue(context, branchId);
  const quantity = quantityOf(request.quantity);
  const reason = normalizeReason(request.reason);
  const { tx } = context;
  await requireLive(tx);
  await customerOrNotFound(tx, userId);
  const item = await tx.rewardCatalogItem.findUnique({
    where: { id: request.catalogItemId },
    select: { id: true, code: true, active: true },
  });
  if (!item) throw new AuthError('NOT_FOUND', 'catalogItemId');
  if (!item.active) throw new AuthError('REWARD_ITEM_INACTIVE');
  const created = await tx.rewardEntitlement.create({
    data: {
      ownerUserId: userId,
      catalogItemId: item.id,
      sourceKind: 'MANUAL',
      quantityIssued: quantity,
      issuedByUserId: context.actor.userId,
      reason,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'REWARD_ISSUED',
    entityType: 'RewardEntitlement',
    entityId: created.id,
    subjectUserId: userId,
    branchId,
    reason,
    after: { catalogItemId: item.id, itemCode: item.code, quantity },
  });
  await appendOutboxEvent(tx, {
    branchId,
    aggregateType: 'RewardEntitlement',
    aggregateId: created.id,
    eventType: 'REWARD_ISSUED',
    schemaVersion: 1,
    payload: { entitlementId: created.id, catalogItemId: item.id, quantity },
  });
  return loadEntitlement(context, created.id, branchId);
}

function noteOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', 'note');
  const note = value.normalize('NFC').trim();
  if (note.length === 0) return null;
  if ([...note].length > 500) throw new AuthError('VALIDATION_FAILED', 'note');
  return note;
}

/**
 * Marks ONE unit as used, with an optional note, at the branch where the staff member acts. The entitlement row is locked, so two
 * staff members using the last unit at the same moment get one success and one `REWARD_NOTHING_LEFT`. Needs go-live ON. No
 * invoice, no points and no money are involved (Owner decision of 2026-10-05, provisional: a free service is marked by hand).
 */
export async function useReward(
  context: AdminContext,
  branchId: string,
  entitlementId: string,
  request: RewardUseRequest,
): Promise<RewardEntitlementResponse> {
  requireIssue(context, branchId);
  const note = noteOf(request.note);
  const { tx } = context;
  await requireLive(tx);
  if (
    !(await tx.rewardEntitlement.findUnique({ where: { id: entitlementId }, select: { id: true } }))
  ) {
    throw new AuthError('NOT_FOUND');
  }
  await lockEntitlement(tx, entitlementId);
  const row = await tx.rewardEntitlement.findUniqueOrThrow({
    where: { id: entitlementId },
    select: entitlementSelect,
  });
  const status = statusOf(row, context.now);
  if (status === 'VOIDED' || status === 'EXPIRED') throw new AuthError('REWARD_NOT_USABLE');
  if (status === 'USED_UP') throw new AuthError('REWARD_NOTHING_LEFT');
  const use = await tx.rewardManualUse.create({
    data: { entitlementId, branchId, usedByUserId: context.actor.userId, note },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'REWARD_USED',
    entityType: 'RewardEntitlement',
    entityId: entitlementId,
    subjectUserId: row.ownerUserId,
    branchId,
    reason: note,
    after: { useId: use.id, catalogItemId: row.catalogItem.id },
  });
  await appendOutboxEvent(tx, {
    branchId,
    aggregateType: 'RewardEntitlement',
    aggregateId: entitlementId,
    eventType: 'REWARD_REDEEMED',
    schemaVersion: 1,
    payload: { entitlementId, useId: use.id },
  });
  return loadEntitlement(context, entitlementId, branchId);
}

/**
 * Revokes the rest of a grant: a reason is required; nothing is deleted. Units already used stay as history. Needs go-live ON
 * and `ISSUE_REWARDS` at the branch. Revoking twice is `REWARD_ALREADY_VOIDED`.
 */
export async function revokeReward(
  context: AdminContext,
  branchId: string,
  entitlementId: string,
  request: RewardReasonRequest,
): Promise<RewardEntitlementResponse> {
  requireIssue(context, branchId);
  const reason = normalizeReason(request.reason);
  const { tx } = context;
  await requireLive(tx);
  if (
    !(await tx.rewardEntitlement.findUnique({ where: { id: entitlementId }, select: { id: true } }))
  ) {
    throw new AuthError('NOT_FOUND');
  }
  await lockEntitlement(tx, entitlementId);
  const row = await tx.rewardEntitlement.findUniqueOrThrow({
    where: { id: entitlementId },
    select: entitlementSelect,
  });
  if (row.voidedAt) throw new AuthError('REWARD_ALREADY_VOIDED');
  await tx.rewardEntitlement.update({
    where: { id: entitlementId },
    data: { voidedAt: context.now, voidedByUserId: context.actor.userId, voidReason: reason },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'REWARD_VOIDED',
    entityType: 'RewardEntitlement',
    entityId: entitlementId,
    subjectUserId: row.ownerUserId,
    branchId,
    reason,
    after: { quantityIssued: row.quantityIssued, unitsUsed: unitsInUse(row) },
  });
  await appendOutboxEvent(tx, {
    branchId,
    aggregateType: 'RewardEntitlement',
    aggregateId: entitlementId,
    eventType: 'REWARD_VOIDED',
    schemaVersion: 1,
    payload: { entitlementId },
  });
  return loadEntitlement(context, entitlementId, branchId);
}

/**
 * Corrects a mistaken use (Owner decision of 2026-10-05, provisional): only a manager holding `MANAGE_REWARD_CATALOG` (global),
 * with a reason, as ONE offset row per use. The use stays as history and the unit becomes available again. Refused for a revoked
 * grant and for a use already restored.
 */
export async function restoreUse(
  context: AdminContext,
  useId: string,
  request: RewardReasonRequest,
): Promise<RewardEntitlementResponse> {
  requireManageCatalog(context);
  const reason = normalizeReason(request.reason);
  const { tx } = context;
  await requireLive(tx);
  const found = await tx.rewardManualUse.findUnique({
    where: { id: useId },
    select: { id: true, entitlementId: true, branchId: true },
  });
  if (!found) throw new AuthError('NOT_FOUND');
  await lockEntitlement(tx, found.entitlementId);
  const current = await tx.rewardManualUse.findUniqueOrThrow({
    where: { id: useId },
    select: {
      restoration: { select: { id: true } },
      entitlement: { select: { voidedAt: true, ownerUserId: true } },
    },
  });
  if (current.restoration || current.entitlement.voidedAt) {
    throw new AuthError('REWARD_USE_NOT_RESTORABLE');
  }
  const restoration = await tx.rewardManualUseRestoration.create({
    data: { useId, restoredByUserId: context.actor.userId, reason },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'REWARD_USE_RESTORED',
    entityType: 'RewardEntitlement',
    entityId: found.entitlementId,
    subjectUserId: current.entitlement.ownerUserId,
    branchId: found.branchId,
    reason,
    after: { useId, restorationId: restoration.id },
  });
  await appendOutboxEvent(tx, {
    branchId: found.branchId,
    aggregateType: 'RewardEntitlement',
    aggregateId: found.entitlementId,
    eventType: 'REWARD_USE_RESTORED',
    schemaVersion: 1,
    payload: { entitlementId: found.entitlementId, useId },
  });
  return loadEntitlement(context, found.entitlementId, found.branchId);
}
