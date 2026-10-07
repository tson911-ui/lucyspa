import type {
  InventoryContextResponse,
  InventoryOverviewResponse,
  InventoryVariantDetailResponse,
  InventoryVariantOptionsResponse,
  StockAdjustmentRequest,
  StockCountCreateRequest,
  StockCountLinesRequest,
  StockCountListResponse,
  StockCountResponse,
  StockReceiptVersionRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import {
  canManageProducts,
  canSeeCost,
  holdsAnywhere,
  holdsAt,
  requireBranch,
  workableBranches,
} from './inventory.access.js';
import * as input from './inventory.input.js';
import {
  branchToday,
  expiryWarningDays,
  isoDate,
  loadItems,
  loadVariantDetail,
} from './inventory.view.js';

/**
 * Phase 6 P6-4: stock levels, adjustments and physical counts (design 4.2, 4.4; PRD 27.5, 27.6).
 *
 * - Reading levels, lots, movements: `VIEW_INVENTORY` at the branch, never a cost (a lot's unit cost needs VIEW_PRODUCT_COST).
 * - An adjustment takes stock OUT of one chosen lot with a required reason; it never creates revenue. A lot is never edited: the
 *   movement is the record. A repeated request key returns the first result and writes nothing twice.
 * - A count lists variants; people enter what they counted; at approval, under the lot and level locks, the difference to the
 *   quantity on hand AT THAT MOMENT becomes COUNT_CORRECTION movements (never an overwrite): less stock is taken from the lots
 *   earliest-expiry first (no expiry last), more stock lands on one new lot named after the count with no expiry date (my reading:
 *   found stock has no known date). `ADJUST_STOCK` at the branch creates, edits, approves and cancels a count.
 * - Lock order: lots of a variant sorted by id, then its stock level, variants in id order: the order the movement trigger itself
 *   uses (lot, then level), so an adjustment and an approval wait for each other and never deadlock.
 */
type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------------------------------- reads

export async function inventoryContext(context: AdminContext): Promise<InventoryContextResponse> {
  const branches = await workableBranches(context);
  const manageProducts = canManageProducts(context);
  if (branches.length === 0 && !manageProducts) throw new AuthError('FORBIDDEN');
  return { branches, manageProducts, cost: canSeeCost(context) };
}

export async function overview(
  context: AdminContext,
  branchId: string,
): Promise<InventoryOverviewResponse> {
  const branch = await requireBranch(context, ['VIEW_INVENTORY'], branchId);
  const { tx } = context;
  const today = await branchToday(tx, branch.timezone);
  const warning = await expiryWarningDays(tx);
  return {
    branchId,
    expiryWarningDays: warning,
    items: await loadItems(tx, branch, today, warning, null),
  };
}

export async function variantDetail(
  context: AdminContext,
  branchId: string,
  variantId: string,
): Promise<InventoryVariantDetailResponse> {
  const branch = await requireBranch(context, ['VIEW_INVENTORY'], branchId);
  const detail = await loadVariantDetail(context, branch, variantId);
  if (!detail) throw new AuthError('NOT_FOUND');
  return detail;
}

export async function variantOptions(
  context: AdminContext,
): Promise<InventoryVariantOptionsResponse> {
  if (
    !(await holdsAnywhere(context, 'MANAGE_STOCK_RECEIPTS')) &&
    !(await holdsAnywhere(context, 'ADJUST_STOCK'))
  ) {
    throw new AuthError('FORBIDDEN');
  }
  const rows = await context.tx.productVariant.findMany({
    where: { isActive: true, product: { status: { not: 'INACTIVE' } } },
    orderBy: [{ product: { nameVi: 'asc' } }, { sortOrder: 'asc' }, { sku: 'asc' }],
    select: {
      id: true,
      sku: true,
      labelVi: true,
      labelEn: true,
      product: { select: { nameVi: true, nameEn: true } },
    },
  });
  return {
    variants: rows.map((row) => ({
      variantId: row.id,
      sku: row.sku,
      productNameVi: row.product.nameVi,
      productNameEn: row.product.nameEn,
      labelVi: row.labelVi,
      labelEn: row.labelEn,
    })),
  };
}

// ------------------------------------------------------------------------------------------- adjustments

export async function adjustStock(
  context: AdminContext,
  request: StockAdjustmentRequest,
): Promise<InventoryVariantDetailResponse> {
  const requestKey = input.uuid(request.requestKey, 'requestKey');
  const branchId = input.uuid(request.branchId, 'branchId');
  const variantId = input.uuid(request.variantId, 'variantId');
  const lotId = input.uuid(request.lotId, 'lotId');
  const quantity = input.quantity(request.quantity, 'quantity');
  const reason = input.adjustmentReason(request.reason);
  const note = input.optionalNote(request.note, 'note');
  const branch = await requireBranch(context, ['ADJUST_STOCK'], branchId);
  const { tx } = context;
  const key = `ADJ:${requestKey}`;
  const detail = async () => {
    const found = await loadVariantDetail(context, branch, variantId);
    if (!found) throw new AuthError('NOT_FOUND');
    return found;
  };

  // The same request again: the stored result, provided it is the same request. Looked up before AND after the lot lock, so two
  // copies of one request sent at once also end with one movement and the same answer.
  const replay = async (): Promise<InventoryVariantDetailResponse | null> => {
    const earlier = await tx.stockMovement.findUnique({
      where: { idempotencyKey: key },
      select: {
        branchId: true,
        variantId: true,
        lotId: true,
        quantityDelta: true,
        reason: true,
        actorUserId: true,
      },
    });
    if (!earlier) return null;
    if (
      earlier.branchId !== branchId ||
      earlier.variantId !== variantId ||
      earlier.lotId !== lotId ||
      earlier.quantityDelta !== -quantity ||
      earlier.reason !== reason ||
      earlier.actorUserId !== context.actor.userId
    ) {
      throw new AuthError('CONFLICT', 'requestKey');
    }
    return detail();
  };
  const first = await replay();
  if (first) return first;

  const locked = await tx.$queryRaw<{ quantity_on_hand: number }[]>`
    SELECT quantity_on_hand FROM inventory_lots
    WHERE id = ${lotId}::uuid AND branch_id = ${branchId}::uuid AND variant_id = ${variantId}::uuid
    FOR UPDATE`;
  if (locked.length === 0) throw new AuthError('NOT_FOUND');
  const second = await replay();
  if (second) return second;
  if (locked[0]!.quantity_on_hand < quantity)
    throw new AuthError('INVENTORY_INSUFFICIENT_STOCK', 'quantity');
  const held = await tx.$queryRaw<
    { on_hand: number; reserved: number }[]
  >`SELECT on_hand, reserved FROM stock_levels WHERE branch_id = ${branchId}::uuid AND variant_id = ${variantId}::uuid FOR UPDATE`;
  // Stock reserved by a finalized invoice (Phase 6 P6-8) cannot be taken out from under it (T13: reserved <= on hand).
  if (held[0] && held[0].on_hand - quantity < held[0].reserved) {
    throw new AuthError('INVENTORY_STOCK_RESERVED', 'quantity');
  }
  await tx.stockMovement.create({
    data: {
      branchId,
      variantId,
      lotId,
      kind: 'ADJUSTMENT',
      quantityDelta: -quantity,
      reason,
      note,
      idempotencyKey: key,
      actorUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'STOCK_ADJUSTED',
    entityType: 'ProductVariant',
    entityId: variantId,
    branchId,
    after: { lotId, quantity, reason },
  });
  return detail();
}

// ----------------------------------------------------------------------------------------------- counts

const countSelect = {
  id: true,
  code: true,
  branchId: true,
  status: true,
  notes: true,
  rowVersion: true,
  createdAt: true,
  approvedAt: true,
  cancelledAt: true,
  branch: { select: { name: true } },
  createdBy: { select: { fullName: true } },
  approvedBy: { select: { fullName: true } },
  lines: {
    select: {
      variantId: true,
      countedQuantity: true,
      systemQuantity: true,
      difference: true,
      variant: {
        select: {
          sku: true,
          labelVi: true,
          labelEn: true,
          product: { select: { nameVi: true, nameEn: true } },
        },
      },
    },
  },
} satisfies Prisma.StockCountSessionSelect;

async function presentCount(context: AdminContext, id: string): Promise<StockCountResponse> {
  const { tx } = context;
  const row = await tx.stockCountSession.findUnique({ where: { id }, select: countSelect });
  if (!row) throw new AuthError('NOT_FOUND');
  const live = new Map<string, number>();
  if (row.status === 'OPEN') {
    const levels = await tx.stockLevel.findMany({
      where: { branchId: row.branchId, variantId: { in: row.lines.map((line) => line.variantId) } },
      select: { variantId: true, onHand: true },
    });
    for (const level of levels) live.set(level.variantId, level.onHand);
  }
  const lines = row.lines
    .map((line) => ({
      variantId: line.variantId,
      sku: line.variant.sku,
      productNameVi: line.variant.product.nameVi,
      productNameEn: line.variant.product.nameEn,
      labelVi: line.variant.labelVi,
      labelEn: line.variant.labelEn,
      countedQuantity: line.countedQuantity,
      systemQuantity: line.systemQuantity,
      difference: line.difference,
      currentOnHand: row.status === 'OPEN' ? (live.get(line.variantId) ?? 0) : null,
    }))
    .sort(
      (a, b) => a.productNameVi.localeCompare(b.productNameVi, 'vi') || a.sku.localeCompare(b.sku),
    );
  return {
    id: row.id,
    code: row.code,
    branchId: row.branchId,
    branchName: row.branch.name,
    status: row.status,
    notes: row.notes,
    rowVersion: row.rowVersion,
    createdByName: row.createdBy.fullName,
    createdAt: row.createdAt.toISOString(),
    approvedByName: row.approvedBy?.fullName ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    lines,
    canAdjust: holdsAt(context, 'ADJUST_STOCK', row.branchId),
  };
}

export async function listCounts(
  context: AdminContext,
  branchId: string,
): Promise<StockCountListResponse> {
  await requireBranch(context, ['VIEW_INVENTORY', 'ADJUST_STOCK'], branchId);
  const rows = await context.tx.stockCountSession.findMany({
    where: { branchId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      code: true,
      status: true,
      createdAt: true,
      approvedAt: true,
      createdBy: { select: { fullName: true } },
      lines: { select: { difference: true } },
    },
  });
  return {
    branchId,
    canAdjust: holdsAt(context, 'ADJUST_STOCK', branchId),
    counts: rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      lineCount: row.lines.length,
      differenceUnits:
        row.status === 'APPROVED'
          ? row.lines.reduce((sum, line) => sum + Math.abs(line.difference ?? 0), 0)
          : null,
      createdByName: row.createdBy.fullName,
      createdAt: row.createdAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
    })),
  };
}

export async function getCount(context: AdminContext, id: string): Promise<StockCountResponse> {
  const hint = await context.tx.stockCountSession.findUnique({
    where: { id },
    select: { branchId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  await requireBranch(context, ['VIEW_INVENTORY', 'ADJUST_STOCK'], hint.branchId);
  return presentCount(context, id);
}

export async function createCount(
  context: AdminContext,
  request: StockCountCreateRequest,
): Promise<StockCountResponse> {
  const branchId = input.uuid(request.branchId, 'branchId');
  await requireBranch(context, ['ADJUST_STOCK'], branchId);
  const notes = input.optionalNote(request.notes, 'notes');
  const { tx } = context;
  let variantIds: string[];
  if (request.variantIds === null) {
    const stocked = await tx.stockLevel.findMany({
      where: { branchId, onHand: { gt: 0 } },
      select: { variantId: true },
    });
    variantIds = stocked.map((level) => level.variantId);
  } else {
    variantIds = [
      ...new Set(
        input
          .list(request.variantIds, 'variantIds', input.INVENTORY_LIMITS.maxLines)
          .map((value) => input.uuid(value, 'variantIds')),
      ),
    ];
    const existing = await tx.productVariant.count({ where: { id: { in: variantIds } } });
    if (existing !== variantIds.length) throw new AuthError('VALIDATION_FAILED', 'variantIds');
  }
  if (variantIds.length === 0) throw new AuthError('VALIDATION_FAILED', 'variantIds');
  if (variantIds.length > input.INVENTORY_LIMITS.maxLines) {
    throw new AuthError('VALIDATION_FAILED', 'variantIds');
  }
  const levels = await tx.stockLevel.findMany({
    where: { branchId, variantId: { in: variantIds } },
    select: { variantId: true, onHand: true },
  });
  const onHand = new Map(levels.map((level) => [level.variantId, level.onHand]));
  const [seq] = await tx.$queryRaw<
    { n: string }[]
  >`SELECT nextval('stock_count_code_seq')::text AS n`;
  const code = `KK${seq!.n.padStart(6, '0')}`;
  const created = await tx.stockCountSession.create({
    data: {
      code,
      branchId,
      notes,
      createdByUserId: context.actor.userId,
      lines: {
        create: variantIds.map((variantId) => ({
          variantId,
          countedQuantity: onHand.get(variantId) ?? 0,
        })),
      },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'STOCK_COUNT_CREATED',
    entityType: 'StockCountSession',
    entityId: created.id,
    branchId,
    after: { code, lineCount: variantIds.length },
  });
  return presentCount(context, created.id);
}

async function lockCount(context: AdminContext, id: string, expectedRowVersion: unknown) {
  const expected = input.rowVersion(expectedRowVersion);
  const { tx } = context;
  const hint = await tx.stockCountSession.findUnique({ where: { id }, select: { branchId: true } });
  if (!hint) throw new AuthError('NOT_FOUND');
  await requireBranch(context, ['ADJUST_STOCK'], hint.branchId);
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM stock_count_sessions WHERE id = ${id}::uuid FOR UPDATE`;
  if (locked.length === 0) throw new AuthError('NOT_FOUND');
  const session = await tx.stockCountSession.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      code: true,
      branchId: true,
      status: true,
      rowVersion: true,
      lines: { select: { id: true, variantId: true, countedQuantity: true } },
    },
  });
  if (session.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (session.status !== 'OPEN') throw new AuthError('INVENTORY_COUNT_NOT_OPEN');
  return session;
}

export async function setCountLines(
  context: AdminContext,
  id: string,
  request: StockCountLinesRequest,
): Promise<StockCountResponse> {
  const lineEntries = input
    .list(request.lines, 'lines', input.INVENTORY_LIMITS.maxLines)
    .map((entry) => {
      const record = input.record(entry, 'lines', ['variantId', 'countedQuantity']);
      return {
        variantId: input.uuid(record['variantId'], 'variantId'),
        countedQuantity: input.counted(record['countedQuantity'], 'countedQuantity'),
      };
    });
  const removeIds = [
    ...new Set(
      input
        .list(request.removeVariantIds, 'removeVariantIds', input.INVENTORY_LIMITS.maxLines)
        .map((value) => input.uuid(value, 'removeVariantIds')),
    ),
  ];
  const session = await lockCount(context, id, request.expectedRowVersion);
  const { tx } = context;
  const existing = new Map(session.lines.map((line) => [line.variantId, line]));
  const touched = new Set<string>();
  for (const entry of lineEntries) {
    if (touched.has(entry.variantId) || removeIds.includes(entry.variantId)) {
      throw new AuthError('VALIDATION_FAILED', 'lines');
    }
    touched.add(entry.variantId);
  }
  const added = lineEntries.filter((entry) => !existing.has(entry.variantId));
  if (added.length > 0) {
    const found = await tx.productVariant.count({
      where: { id: { in: added.map((e) => e.variantId) } },
    });
    if (found !== added.length) throw new AuthError('VALIDATION_FAILED', 'variantId');
  }
  for (const entry of lineEntries) {
    const line = existing.get(entry.variantId);
    if (line) {
      if (line.countedQuantity !== entry.countedQuantity) {
        await tx.stockCountLine.update({
          where: { id: line.id },
          data: { countedQuantity: entry.countedQuantity },
        });
      }
    } else {
      await tx.stockCountLine.create({
        data: { sessionId: id, variantId: entry.variantId, countedQuantity: entry.countedQuantity },
      });
    }
  }
  for (const variantId of removeIds) {
    const line = existing.get(variantId);
    if (line) await tx.stockCountLine.delete({ where: { id: line.id } });
  }
  await tx.stockCountSession.update({
    where: { id },
    data: { rowVersion: session.rowVersion + 1 },
  });
  return presentCount(context, id);
}

export async function approveCount(
  context: AdminContext,
  id: string,
  request: StockReceiptVersionRequest,
): Promise<StockCountResponse> {
  const session = await lockCount(context, id, request.expectedRowVersion);
  const { tx } = context;
  if (session.lines.length === 0) throw new AuthError('VALIDATION_FAILED', 'lines');
  const lines = [...session.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
  let corrected = 0;
  for (const line of lines) {
    // Lots first (sorted by id), then the level: the same order as the movement trigger and an adjustment.
    const lots = await tx.$queryRaw<
      { id: string; quantity_on_hand: number; expiry_date: Date | null }[]
    >`
      SELECT id, quantity_on_hand, expiry_date FROM inventory_lots
      WHERE branch_id = ${session.branchId}::uuid AND variant_id = ${line.variantId}::uuid
      ORDER BY id FOR UPDATE`;
    const level = await tx.$queryRaw<{ on_hand: number; reserved: number }[]>`
      SELECT on_hand, reserved FROM stock_levels
      WHERE branch_id = ${session.branchId}::uuid AND variant_id = ${line.variantId}::uuid FOR UPDATE`;
    const system = level[0]?.on_hand ?? 0;
    // A count cannot take stock below what finalized invoices have reserved (Phase 6 P6-8, T13); nothing is written.
    if (line.countedQuantity < (level[0]?.reserved ?? 0)) {
      throw new AuthError('INVENTORY_STOCK_RESERVED', 'countedQuantity');
    }
    const difference = line.countedQuantity - system;
    await tx.stockCountLine.update({
      where: { id: line.id },
      data: { systemQuantity: system, difference },
    });
    if (difference === 0) continue;
    corrected += 1;
    const base = {
      branchId: session.branchId,
      variantId: line.variantId,
      kind: 'ADJUSTMENT' as const,
      reason: 'COUNT_CORRECTION' as const,
      countLineId: line.id,
      actorUserId: context.actor.userId,
    };
    if (difference > 0) {
      const lot = await tx.inventoryLot.create({
        data: {
          branchId: session.branchId,
          variantId: line.variantId,
          lotCode: session.code,
          createdByUserId: context.actor.userId,
        },
        select: { id: true },
      });
      await tx.stockMovement.create({
        data: {
          ...base,
          lotId: lot.id,
          quantityDelta: difference,
          idempotencyKey: `COUNT:${line.id}:NEW`,
        },
        select: { id: true },
      });
      continue;
    }
    // Less stock than the system says: take it from the lots earliest expiry first, no expiry last.
    let remaining = -difference;
    const fefo = lots
      .filter((lot) => lot.quantity_on_hand > 0)
      .sort(
        (a, b) =>
          (a.expiry_date ? a.expiry_date.getTime() : Number.MAX_SAFE_INTEGER) -
            (b.expiry_date ? b.expiry_date.getTime() : Number.MAX_SAFE_INTEGER) ||
          a.id.localeCompare(b.id),
      );
    for (const lot of fefo) {
      if (remaining === 0) break;
      const take = Math.min(remaining, lot.quantity_on_hand);
      await tx.stockMovement.create({
        data: {
          ...base,
          lotId: lot.id,
          quantityDelta: -take,
          idempotencyKey: `COUNT:${line.id}:${lot.id}`,
        },
        select: { id: true },
      });
      remaining -= take;
    }
    if (remaining > 0) throw new AuthError('CONFLICT');
  }
  await tx.stockCountSession.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedByUserId: context.actor.userId,
      rowVersion: session.rowVersion + 1,
    },
  });
  await appendAdminAudit(context, {
    action: 'STOCK_COUNT_APPROVED',
    entityType: 'StockCountSession',
    entityId: id,
    branchId: session.branchId,
    after: { code: session.code, lineCount: lines.length, correctedLines: corrected },
  });
  return presentCount(context, id);
}

export async function cancelCount(
  context: AdminContext,
  id: string,
  request: StockReceiptVersionRequest,
): Promise<StockCountResponse> {
  const session = await lockCount(context, id, request.expectedRowVersion);
  await context.tx.stockCountSession.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      cancelledByUserId: context.actor.userId,
      rowVersion: session.rowVersion + 1,
    },
  });
  await appendAdminAudit(context, {
    action: 'STOCK_COUNT_CANCELLED',
    entityType: 'StockCountSession',
    entityId: id,
    branchId: session.branchId,
    after: { code: session.code },
  });
  return presentCount(context, id);
}

export { isoDate };
export type { Tx };
