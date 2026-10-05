import type {
  ComboFrozenListResponse,
  ComboUsageItemResponse,
  ComboUsagePageResponse,
  ComboUsageStatus,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { hasFreshReauthentication } from '../auth/session.policy.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { maskPhone } from '../operations/operations.state.js';
import { normalizeReason } from '../operations/service-execution.service.js';

/**
 * Phase 5 P5-8: the history of combo use, its correction and the frozen combos (design 9.4-9.5; PRD 17.4-17.5).
 *
 * - History is APPEND-ONLY (database triggers): ordinary staff can neither delete nor edit it. Readable with
 *   `RESTORE_COMBO_SESSIONS` or `MANAGE_COMBOS` (both GLOBAL_ONLY, so a manager or the Owner).
 * - A mistaken use is corrected by an authorized manager (`RESTORE_COMBO_SESSIONS`: GLOBAL_ONLY, FINANCIAL, fresh
 *   re-authentication) with a reason, as ONE offset entry (`combo_session_restorations`, unique per use). The use stays as
 *   history; the session becomes free again; the 0 VND line of the invoice is not touched.
 * - Frozen combos (Owner decision of 2026-10-05, approved in own words): a combo whose sale was reversed while sessions were used keeps its
 *   used sessions as history and cannot be used again until the sale is paid again. `VIEW_LOYALTY_EXCEPTIONS` (Owner-level)
 *   lists them; no notification is sent (P5-Q9).
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
export const COMBO_USAGE_PAGE_SIZE = 20;

function pageOf(value: string | undefined): number {
  if (value === undefined) return 1;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
    throw new AuthError('VALIDATION_FAILED', 'page');
  }
  return page;
}

function canSeeUsage(context: AdminContext): boolean {
  return (
    decide(context.actor.graph, 'RESTORE_COMBO_SESSIONS', GLOBAL) ||
    decide(context.actor.graph, 'MANAGE_COMBOS', GLOBAL)
  );
}

const usageSelect = {
  id: true,
  consumedAt: true,
  usedBy: true,
  relationshipNote: true,
  session: {
    select: {
      sessionNo: true,
      kind: true,
      purchase: {
        select: {
          nameVi: true,
          nameEn: true,
          owner: { select: { id: true, fullName: true, phoneCanonical: true } },
        },
      },
    },
  },
  invoiceLine: {
    select: {
      nameVi: true,
      nameEn: true,
      invoice: { select: { code: true } },
    },
  },
  branch: { select: { name: true } },
  recipientParticipant: {
    select: { displayName: true, customer: { select: { fullName: true } } },
  },
  ktv: { select: { fullName: true } },
  performedBy: { select: { fullName: true } },
  release: { select: { releasedAt: true } },
  restoration: {
    select: { restoredAt: true, reason: true, restoredBy: { select: { fullName: true } } },
  },
} satisfies Prisma.ComboSessionConsumptionSelect;

type UsageRow = Prisma.ComboSessionConsumptionGetPayload<{ select: typeof usageSelect }>;

function statusOf(row: UsageRow): ComboUsageStatus {
  if (row.restoration) return 'RESTORED';
  if (row.release) return 'RELEASED';
  return 'ACTIVE';
}

function presentUsage(row: UsageRow): ComboUsageItemResponse {
  const owner = row.session.purchase.owner;
  return {
    consumptionId: row.id,
    usedAt: row.consumedAt.toISOString(),
    status: statusOf(row),
    owner: {
      id: owner.id,
      displayName: owner.fullName,
      phoneMasked: maskPhone(owner.phoneCanonical),
    },
    comboNameVi: row.session.purchase.nameVi,
    comboNameEn: row.session.purchase.nameEn,
    sessionNo: row.session.sessionNo,
    sessionKind: row.session.kind,
    usedBy: row.usedBy,
    relationshipNote: row.relationshipNote,
    serviceNameVi: row.invoiceLine.nameVi,
    serviceNameEn: row.invoiceLine.nameEn,
    recipientName: row.recipientParticipant
      ? (row.recipientParticipant.customer?.fullName ?? row.recipientParticipant.displayName)
      : null,
    technicianName: row.ktv?.fullName ?? null,
    performedByName: row.performedBy.fullName,
    invoiceCode: row.invoiceLine.invoice.code,
    branchName: row.branch.name,
    restoration: row.restoration
      ? {
          restoredAt: row.restoration.restoredAt.toISOString(),
          restoredByName: row.restoration.restoredBy.fullName,
          reason: row.restoration.reason,
        }
      : null,
    releasedAt: row.release ? row.release.releasedAt.toISOString() : null,
  };
}

/** The usage history, newest first, 20 per page. */
export async function listUsage(
  context: AdminContext,
  query: { page?: string },
): Promise<ComboUsagePageResponse> {
  if (!canSeeUsage(context)) throw new AuthError('FORBIDDEN');
  const page = pageOf(query.page);
  const { tx } = context;
  const [total, rows] = await Promise.all([
    tx.comboSessionConsumption.count(),
    tx.comboSessionConsumption.findMany({
      orderBy: [{ consumedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * COMBO_USAGE_PAGE_SIZE,
      take: COMBO_USAGE_PAGE_SIZE,
      select: usageSelect,
    }),
  ]);
  return {
    items: rows.map(presentUsage),
    page,
    pageSize: COMBO_USAGE_PAGE_SIZE,
    total,
    canRestore: decide(context.actor.graph, 'RESTORE_COMBO_SESSIONS', GLOBAL),
  };
}

/**
 * Restores a mistaken use: `RESTORE_COMBO_SESSIONS` (GLOBAL_ONLY, FINANCIAL), fresh re-authentication, a required reason. One
 * offset entry per use (unique); never for a use that was released with its cancelled invoice. Lock order (design 12.2): the
 * use invoice (SHARE, so it cannot be cancelled and release the use at the same moment) -> the session row.
 */
export async function restoreUsage(
  context: AdminContext,
  consumptionId: string,
  request: { reason: unknown },
  freshAuthSeconds: number,
): Promise<ComboUsageItemResponse> {
  if (!decide(context.actor.graph, 'RESTORE_COMBO_SESSIONS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
  if (!hasFreshReauthentication(context.actor.principal, context.now, freshAuthSeconds)) {
    throw new AuthError('REAUTHENTICATION_REQUIRED');
  }
  const reason = normalizeReason(request.reason);
  const { tx } = context;
  const found = await tx.comboSessionConsumption.findUnique({
    where: { id: consumptionId },
    select: {
      id: true,
      branchId: true,
      sessionId: true,
      invoiceLine: { select: { invoiceId: true } },
      session: {
        select: { purchaseId: true, sessionNo: true, purchase: { select: { ownerUserId: true } } },
      },
    },
  });
  if (!found) throw new AuthError('NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${found.invoiceLine.invoiceId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM combo_sessions WHERE id = ${found.sessionId}::uuid FOR UPDATE`;
  const current = await tx.comboSessionConsumption.findUniqueOrThrow({
    where: { id: consumptionId },
    select: { release: { select: { id: true } }, restoration: { select: { id: true } } },
  });
  if (current.release || current.restoration) throw new AuthError('COMBO_USE_NOT_RESTORABLE');
  const restoration = await tx.comboSessionRestoration.create({
    data: { consumptionId, restoredByUserId: context.actor.userId, reason },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'COMBO_SESSION_RESTORED',
    entityType: 'ComboSessionConsumption',
    entityId: consumptionId,
    subjectUserId: found.session.purchase.ownerUserId,
    branchId: found.branchId,
    classification: 'FINANCIAL',
    reason,
    after: {
      restorationId: restoration.id,
      comboPurchaseId: found.session.purchaseId,
      sessionNo: found.session.sessionNo,
    },
  });
  await appendOutboxEvent(tx, {
    branchId: found.branchId,
    aggregateType: 'ComboPurchase',
    aggregateId: found.session.purchaseId,
    eventType: 'COMBO_SESSION_RESTORED',
    schemaVersion: 1,
    payload: {
      comboPurchaseId: found.session.purchaseId,
      consumptionId,
      sessionNo: found.session.sessionNo,
    },
  });
  const row = await tx.comboSessionConsumption.findUniqueOrThrow({
    where: { id: consumptionId },
    select: usageSelect,
  });
  return presentUsage(row);
}

/**
 * The frozen combos: not revoked, at least one session in use, sessions still free, and the sale invoice is not paid now (its
 * payment was reversed and it waits, or it was cancelled). `VIEW_LOYALTY_EXCEPTIONS`, GLOBAL.
 */
export async function listFrozen(context: AdminContext): Promise<ComboFrozenListResponse> {
  if (!decide(context.actor.graph, 'VIEW_LOYALTY_EXCEPTIONS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
  const rows = await context.tx.comboPurchase.findMany({
    where: {
      voidedAt: null,
      invoiceLine: { invoice: { status: { in: ['PENDING_PAYMENT', 'CANCELLED'] } } },
      sessions: { some: { consumptions: { some: { release: null, restoration: null } } } },
    },
    orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      nameVi: true,
      nameEn: true,
      owner: { select: { id: true, fullName: true, phoneCanonical: true } },
      invoiceLine: { select: { invoice: { select: { code: true, status: true } } } },
      sessions: {
        select: {
          consumptions: {
            select: { release: { select: { id: true } }, restoration: { select: { id: true } } },
          },
        },
      },
    },
  });
  return {
    items: rows.flatMap((row) => {
      const used = row.sessions.filter((session) =>
        session.consumptions.some((use) => use.release === null && use.restoration === null),
      ).length;
      const left = row.sessions.length - used;
      const status = row.invoiceLine.invoice.status;
      if (left <= 0 || (status !== 'PENDING_PAYMENT' && status !== 'CANCELLED')) return [];
      return [
        {
          purchaseId: row.id,
          owner: {
            id: row.owner.id,
            displayName: row.owner.fullName,
            phoneMasked: maskPhone(row.owner.phoneCanonical),
          },
          comboNameVi: row.nameVi,
          comboNameEn: row.nameEn,
          sessionsUsed: used,
          sessionsLeft: left,
          saleInvoiceCode: row.invoiceLine.invoice.code,
          saleInvoiceStatus: status,
        },
      ];
    }),
  };
}
