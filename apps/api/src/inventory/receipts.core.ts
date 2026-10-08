import type {
  StockReceiptCancelRequest,
  StockReceiptCreateRequest,
  StockReceiptEditRequest,
  StockReceiptLineRequest,
  StockReceiptListItem,
  StockReceiptListResponse,
  StockReceiptResponse,
  StockReceiptVersionRequest,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { allocateWaitingLines, lockWaitingOrderLines } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { canSeeCost, requireBranch, requireCost } from './inventory.access.js';
import * as input from './inventory.input.js';
import { branchToday, isoDate } from './inventory.view.js';
import { tellMembersGoodsArrived } from '../product-orders/order.notice.js';

/**
 * Phase 6 P6-4: stock receipts (design 4.3, PRD 27.1). `MANAGE_STOCK_RECEIPTS` at the receipt's branch for every command. A receipt
 * is a DRAFT (header and lines may change, or it is cancelled with a reason) and then CONFIRMED, after which it is immutable: a
 * mistake is fixed with an adjustment, never an edit. Confirming one receipt creates one lot and one RECEIPT movement per line and
 * writes the `STOCK_RECEIPT_CONFIRMED` event (ids and quantities only, no cost) in the same transaction.
 *
 * - A unit cost is entered and seen only with VIEW_PRODUCT_COST (the key is absent otherwise; sending one is a 403 and writes nothing).
 *   An edit by someone without that permission keeps the cost of the same line and variant.
 * - Lock order: the receipt row, then (lines sorted by variant) the new lot and the stock level that the movement trigger moves.
 * - The database decides the time; the confirmation is checked again at commit (a confirmed receipt has a movement per line).
 */
type Tx = Prisma.TransactionClient;

interface ParsedLine {
  variantId: string;
  quantity: number;
  /** `undefined`: no cost key was sent. */
  unitCost: bigint | null | undefined;
  lotCode: string | null;
  expiryDate: string | null;
}

const LINE_KEYS = ['variantId', 'quantity', 'unitCostVnd', 'lotCode', 'expiryDate'] as const;
const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);

async function nextCode(tx: Tx): Promise<string> {
  const [row] = await tx.$queryRaw<
    { n: string }[]
  >`SELECT nextval('stock_receipt_code_seq')::text AS n`;
  return `PN${row!.n.padStart(6, '0')}`;
}

async function checkSupplier(tx: Tx, supplierId: string | null) {
  if (supplierId === null) return;
  const supplier = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { isActive: true },
  });
  if (!supplier) throw new AuthError('VALIDATION_FAILED', 'supplierId');
  if (!supplier.isActive) throw new AuthError('VALIDATION_FAILED', 'supplierId');
}

/** The lines of a request, validated: shape, numbers, dates, cost authority and that every variant can take stock. */
async function parseLines(
  context: AdminContext,
  value: unknown,
  today: string,
): Promise<ParsedLine[]> {
  const entries = input.list(value, 'lines', input.INVENTORY_LIMITS.maxLines);
  if (entries.length === 0) throw new AuthError('VALIDATION_FAILED', 'lines');
  const lines = entries.map((entry): ParsedLine => {
    const record = input.record(entry, 'lines', LINE_KEYS);
    const expiry = input.optionalDate(record['expiryDate'], 'expiryDate');
    if (expiry !== null && expiry < today) throw new AuthError('VALIDATION_FAILED', 'expiryDate');
    return {
      variantId: input.uuid(record['variantId'], 'variantId'),
      quantity: input.quantity(record['quantity'], 'quantity'),
      unitCost: 'unitCostVnd' in record ? input.unitCost(record['unitCostVnd']) : undefined,
      lotCode: input.optionalLine(record['lotCode'], 'lotCode', input.INVENTORY_LIMITS.lotCodeMax),
      expiryDate: expiry,
    };
  });
  // A cost may only come from someone who may see it, before anything is written.
  if (lines.some((line) => line.unitCost !== undefined)) requireCost(context);
  const ids = [...new Set(lines.map((line) => line.variantId))];
  const variants = await context.tx.productVariant.findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true, product: { select: { status: true } } },
  });
  if (variants.length !== ids.length) throw new AuthError('VALIDATION_FAILED', 'variantId');
  for (const variant of variants) {
    if (!variant.isActive || variant.product.status === 'INACTIVE') {
      throw new AuthError('INVENTORY_VARIANT_UNAVAILABLE', 'variantId');
    }
  }
  return lines;
}

// -------------------------------------------------------------------------------------------------- reads

const receiptSelect = (cost: boolean) =>
  ({
    id: true,
    code: true,
    branchId: true,
    receiptDate: true,
    notes: true,
    status: true,
    rowVersion: true,
    createdAt: true,
    confirmedAt: true,
    cancelledAt: true,
    cancelReason: true,
    branch: { select: { name: true } },
    supplier: { select: { id: true, name: true } },
    createdBy: { select: { fullName: true } },
    confirmedBy: { select: { fullName: true } },
    cancelledBy: { select: { fullName: true } },
    lines: {
      orderBy: { lineNo: 'asc' },
      select: {
        lineNo: true,
        quantity: true,
        lotCode: true,
        expiryDate: true,
        ...(cost ? { unitCostVnd: true } : {}),
        variant: {
          select: {
            id: true,
            sku: true,
            labelVi: true,
            labelEn: true,
            product: { select: { nameVi: true, nameEn: true } },
          },
        },
      },
    },
  }) satisfies Prisma.StockReceiptSelect;

async function present(context: AdminContext, id: string): Promise<StockReceiptResponse> {
  const cost = canSeeCost(context);
  const row = await context.tx.stockReceipt.findUnique({
    where: { id },
    select: receiptSelect(cost),
  });
  if (!row) throw new AuthError('NOT_FOUND');
  return {
    id: row.id,
    code: row.code,
    branchId: row.branchId,
    branchName: row.branch.name,
    supplierId: row.supplier?.id ?? null,
    supplierName: row.supplier?.name ?? null,
    receiptDate: isoDate(row.receiptDate),
    notes: row.notes,
    status: row.status,
    rowVersion: row.rowVersion,
    createdByName: row.createdBy.fullName,
    createdAt: row.createdAt.toISOString(),
    confirmedByName: row.confirmedBy?.fullName ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledByName: row.cancelledBy?.fullName ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    cost,
    lines: row.lines.map((line) => ({
      lineNo: line.lineNo,
      variantId: line.variant.id,
      sku: line.variant.sku,
      productNameVi: line.variant.product.nameVi,
      productNameEn: line.variant.product.nameEn,
      labelVi: line.variant.labelVi,
      labelEn: line.variant.labelEn,
      quantity: line.quantity,
      lotCode: line.lotCode,
      expiryDate: line.expiryDate ? isoDate(line.expiryDate) : null,
      ...(cost
        ? {
            unitCostVnd: (() => {
              const unit = Reflect.get(line, 'unitCostVnd') as bigint | null | undefined;
              return unit === undefined || unit === null ? null : unit.toString();
            })(),
          }
        : {}),
    })),
  };
}

export async function listReceipts(
  context: AdminContext,
  branchId: string,
): Promise<StockReceiptListResponse> {
  await requireBranch(context, ['MANAGE_STOCK_RECEIPTS'], branchId);
  const cost = canSeeCost(context);
  const rows = await context.tx.stockReceipt.findMany({
    where: { branchId },
    orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 500,
    select: {
      id: true,
      code: true,
      receiptDate: true,
      status: true,
      createdAt: true,
      confirmedAt: true,
      supplier: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      lines: { select: { quantity: true, ...(cost ? { unitCostVnd: true } : {}) } },
    },
  });
  const receipts = rows.map((row): StockReceiptListItem => {
    const item: StockReceiptListItem = {
      id: row.id,
      code: row.code,
      receiptDate: isoDate(row.receiptDate),
      status: row.status,
      supplierName: row.supplier?.name ?? null,
      lineCount: row.lines.length,
      totalQuantity: row.lines.reduce((sum, line) => sum + line.quantity, 0),
      createdByName: row.createdBy.fullName,
      createdAt: row.createdAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
    };
    if (cost) {
      item.totalCostVnd = row.lines
        .reduce((sum, line) => {
          const unit = Reflect.get(line, 'unitCostVnd') as bigint | null | undefined;
          return sum + (unit ?? 0n) * BigInt(line.quantity);
        }, 0n)
        .toString();
    }
    return item;
  });
  return { branchId, receipts };
}

export async function getReceipt(context: AdminContext, id: string): Promise<StockReceiptResponse> {
  const row = await context.tx.stockReceipt.findUnique({
    where: { id },
    select: { branchId: true },
  });
  if (!row) throw new AuthError('NOT_FOUND');
  await requireBranch(context, ['MANAGE_STOCK_RECEIPTS'], row.branchId);
  return present(context, id);
}

// ------------------------------------------------------------------------------------------------ commands

export async function createReceipt(
  context: AdminContext,
  request: StockReceiptCreateRequest,
): Promise<StockReceiptResponse> {
  const branchId = input.uuid(request.branchId, 'branchId');
  const branch = await requireBranch(context, ['MANAGE_STOCK_RECEIPTS'], branchId);
  const supplierId = input.optionalUuid(request.supplierId, 'supplierId');
  const receiptDate = input.date(request.receiptDate, 'receiptDate');
  const notes = input.optionalNote(request.notes, 'notes');
  const { tx } = context;
  const today = await branchToday(tx, branch.timezone);
  const lines = await parseLines(context, request.lines, today);
  await checkSupplier(tx, supplierId);
  const code = await nextCode(tx);
  const created = await tx.stockReceipt.create({
    data: {
      code,
      branchId,
      supplierId,
      receiptDate: dateOf(receiptDate),
      notes,
      createdByUserId: context.actor.userId,
      lines: {
        create: lines.map((line, index) => ({
          lineNo: index + 1,
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostVnd: line.unitCost ?? null,
          lotCode: line.lotCode,
          expiryDate: line.expiryDate ? dateOf(line.expiryDate) : null,
        })),
      },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'STOCK_RECEIPT_CREATED',
    entityType: 'StockReceipt',
    entityId: created.id,
    branchId,
    classification: 'FINANCIAL',
    after: { code, lineCount: lines.length },
  });
  return present(context, created.id);
}

/** Locks a receipt and checks branch authority, the expected version and (when asked) that it is still a draft. */
async function lockReceipt(
  context: AdminContext,
  id: string,
  expectedRowVersion: unknown,
  requireDraft: boolean,
) {
  const expected = input.rowVersion(expectedRowVersion);
  const { tx } = context;
  const hint = await tx.stockReceipt.findUnique({ where: { id }, select: { branchId: true } });
  if (!hint) throw new AuthError('NOT_FOUND');
  const branch = await requireBranch(context, ['MANAGE_STOCK_RECEIPTS'], hint.branchId);
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM stock_receipts WHERE id = ${id}::uuid FOR UPDATE`;
  if (locked.length === 0) throw new AuthError('NOT_FOUND');
  const receipt = await tx.stockReceipt.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      code: true,
      branchId: true,
      status: true,
      rowVersion: true,
      lines: {
        orderBy: { lineNo: 'asc' },
        select: {
          id: true,
          lineNo: true,
          variantId: true,
          quantity: true,
          unitCostVnd: true,
          lotCode: true,
          expiryDate: true,
        },
      },
    },
  });
  if (receipt.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (requireDraft && receipt.status !== 'DRAFT')
    throw new AuthError('INVENTORY_RECEIPT_NOT_DRAFT');
  return { receipt, branch };
}

export async function editReceipt(
  context: AdminContext,
  id: string,
  request: StockReceiptEditRequest,
): Promise<StockReceiptResponse> {
  const supplierId = input.optionalUuid(request.supplierId, 'supplierId');
  const receiptDate = input.date(request.receiptDate, 'receiptDate');
  const notes = input.optionalNote(request.notes, 'notes');
  const { receipt, branch } = await lockReceipt(context, id, request.expectedRowVersion, true);
  const { tx } = context;
  const lines = await parseLines(context, request.lines, await branchToday(tx, branch.timezone));
  await checkSupplier(tx, supplierId);
  // A line without a cost key keeps the cost of the same line number and variant (a caller who cannot see cost never loses it).
  const previous = new Map(
    receipt.lines.map((line) => [`${line.lineNo}:${line.variantId}`, line.unitCostVnd]),
  );
  await tx.stockReceiptLine.deleteMany({ where: { receiptId: id } });
  await tx.stockReceiptLine.createMany({
    data: lines.map((line, index) => ({
      receiptId: id,
      lineNo: index + 1,
      variantId: line.variantId,
      quantity: line.quantity,
      unitCostVnd:
        line.unitCost !== undefined
          ? line.unitCost
          : (previous.get(`${index + 1}:${line.variantId}`) ?? null),
      lotCode: line.lotCode,
      expiryDate: line.expiryDate ? dateOf(line.expiryDate) : null,
    })),
  });
  await tx.stockReceipt.update({
    where: { id },
    data: {
      supplierId,
      receiptDate: dateOf(receiptDate),
      notes,
      rowVersion: receipt.rowVersion + 1,
    },
  });
  await appendAdminAudit(context, {
    action: 'STOCK_RECEIPT_UPDATED',
    entityType: 'StockReceipt',
    entityId: id,
    branchId: receipt.branchId,
    classification: 'FINANCIAL',
    after: { code: receipt.code, lineCount: lines.length },
  });
  return present(context, id);
}

export async function confirmReceipt(
  context: AdminContext,
  id: string,
  request: StockReceiptVersionRequest,
): Promise<StockReceiptResponse> {
  const { receipt, branch } = await lockReceipt(context, id, request.expectedRowVersion, true);
  const { tx } = context;
  if (receipt.lines.length === 0) throw new AuthError('VALIDATION_FAILED', 'lines');
  // The variants must still take stock and no lot may already be past its date (T14: expired stock is never received as sellable).
  const today = await branchToday(tx, branch.timezone);
  const variants = await tx.productVariant.findMany({
    where: { id: { in: [...new Set(receipt.lines.map((line) => line.variantId))] } },
    select: { id: true, isActive: true, product: { select: { status: true } } },
  });
  for (const variant of variants) {
    if (!variant.isActive || variant.product.status === 'INACTIVE') {
      throw new AuthError('INVENTORY_VARIANT_UNAVAILABLE', 'variantId');
    }
  }
  for (const line of receipt.lines) {
    if (line.expiryDate && isoDate(line.expiryDate) < today) {
      throw new AuthError('VALIDATION_FAILED', 'expiryDate');
    }
  }
  await tx.stockReceipt.update({
    where: { id },
    data: {
      status: 'CONFIRMED',
      confirmedByUserId: context.actor.userId,
      rowVersion: receipt.rowVersion + 1,
    },
  });
  // Lines sorted by variant, so two receipts confirmed together lock the stock levels in the same order.
  const ordered = [...receipt.lines].sort(
    (a, b) => a.variantId.localeCompare(b.variantId) || a.lineNo - b.lineNo,
  );
  // Phase 6 P6-17 (design 10.2): the pre-order lines that wait for these variants are locked (invoice, then line) BEFORE the first
  // movement locks a stock level, so a receipt cannot meet a payment or a cancellation of the same invoice in the opposite order.
  const receivedVariants = ordered.map((line) => line.variantId);
  await lockWaitingOrderLines(tx, receipt.branchId, receivedVariants);
  for (const line of ordered) {
    const lot = await tx.inventoryLot.create({
      data: {
        branchId: receipt.branchId,
        variantId: line.variantId,
        lotCode: line.lotCode ?? `${receipt.code}-${line.lineNo}`,
        expiryDate: line.expiryDate,
        unitCostVnd: line.unitCostVnd,
        sourceReceiptLineId: line.id,
        createdByUserId: context.actor.userId,
      },
      select: { id: true },
    });
    await tx.stockMovement.create({
      data: {
        branchId: receipt.branchId,
        variantId: line.variantId,
        lotId: lot.id,
        kind: 'RECEIPT',
        quantityDelta: line.quantity,
        receiptLineId: line.id,
        idempotencyKey: `RECEIPT:${line.id}`,
        actorUserId: context.actor.userId,
      },
      select: { id: true },
    });
  }
  // The arrival is given to the waiting pre-orders in the same transaction, oldest paid first (T28), and the members are told.
  const arrived = await allocateWaitingLines(tx, {
    branchId: receipt.branchId,
    variantIds: receivedVariants,
    actorUserId: context.actor.userId,
    receiptId: id,
  });
  await tellMembersGoodsArrived(tx, arrived);
  // Ids and quantities only: no unit cost, no names.
  await appendOutboxEvent(tx, {
    branchId: receipt.branchId,
    aggregateType: 'StockReceipt',
    aggregateId: id,
    eventType: 'STOCK_RECEIPT_CONFIRMED',
    schemaVersion: 1,
    payload: {
      receiptId: id,
      code: receipt.code,
      lines: ordered.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
    },
  });
  await appendAdminAudit(context, {
    action: 'STOCK_RECEIPT_CONFIRMED',
    entityType: 'StockReceipt',
    entityId: id,
    branchId: receipt.branchId,
    classification: 'FINANCIAL',
    after: {
      code: receipt.code,
      lineCount: receipt.lines.length,
      totalQuantity: receipt.lines.reduce((sum, line) => sum + line.quantity, 0),
    },
  });
  return present(context, id);
}

export async function cancelReceipt(
  context: AdminContext,
  id: string,
  request: StockReceiptCancelRequest,
): Promise<StockReceiptResponse> {
  const reason = input.line(request.reason, 'reason', input.INVENTORY_LIMITS.noteMax);
  const { receipt } = await lockReceipt(context, id, request.expectedRowVersion, true);
  await context.tx.stockReceipt.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      cancelledByUserId: context.actor.userId,
      cancelReason: reason,
      rowVersion: receipt.rowVersion + 1,
    },
  });
  await appendAdminAudit(context, {
    action: 'STOCK_RECEIPT_CANCELLED',
    entityType: 'StockReceipt',
    entityId: id,
    branchId: receipt.branchId,
    classification: 'FINANCIAL',
    reason,
    after: { code: receipt.code },
  });
  return present(context, id);
}

export type { StockReceiptLineRequest };
