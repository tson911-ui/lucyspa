import type {
  InventoryItem,
  InventoryLotResponse,
  InventoryMovementResponse,
  InventoryVariantDetailResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import type { AdminContext } from '../authorization/admin-command.js';
import { canSeeCost, holdsAt, type BranchRef } from './inventory.access.js';

/**
 * Phase 6 P6-4: what the inventory screens read. "Today" is always the BRANCH-LOCAL calendar day (a lot is sellable through its
 * expiry date and expired from the next day); "available" is the database's one definition, `lucy_available_stock`. A unit cost is
 * read and returned only for a caller who holds VIEW_PRODUCT_COST.
 */
type Tx = Prisma.TransactionClient;

export const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  const moved = new Date(`${day}T00:00:00.000Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return isoDate(moved);
}

/** The branch-local calendar date now, from the database clock. */
export async function branchToday(tx: Tx, timezone: string): Promise<string> {
  const [row] = await tx.$queryRaw<
    { today: string }[]
  >`SELECT to_char((clock_timestamp() AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS today`;
  return row!.today;
}

export async function expiryWarningDays(tx: Tx): Promise<number> {
  const settings = await tx.productSettings.findUniqueOrThrow({
    where: { id: 1 },
    select: { expiryWarningDays: true },
  });
  return settings.expiryWarningDays;
}

interface ItemRow {
  variantId: string;
  sku: string;
  productId: string;
  productNameVi: string;
  productNameEn: string;
  labelVi: string | null;
  labelEn: string | null;
  variantActive: boolean;
  threshold: number | null;
  coverMediaId: string | null;
  onHand: number;
  reserved: number;
  available: number;
  lotCount: number;
  expiredQuantity: number;
  nextExpiry: string | null;
}

/**
 * The stock of a branch, one row per variant: every active variant of a product that is not discontinued, plus any variant that
 * still has stock. `variantId` narrows it to one variant.
 */
export async function loadItems(
  tx: Tx,
  branch: BranchRef,
  today: string,
  warningDays: number,
  variantId: string | null,
): Promise<InventoryItem[]> {
  const rows = await tx.$queryRaw<ItemRow[]>`
    SELECT v.id::text AS "variantId", v.sku, p.id::text AS "productId",
           p.name_vi AS "productNameVi", p.name_en AS "productNameEn",
           v.label_vi AS "labelVi", v.label_en AS "labelEn", v.is_active AS "variantActive",
           v.low_stock_threshold AS "threshold",
           (SELECT i.media_asset_id::text FROM product_images i WHERE i.product_id = p.id
             ORDER BY i.sort_order, i.created_at, i.id LIMIT 1) AS "coverMediaId",
           COALESCE(s.on_hand, 0)::int AS "onHand",
           COALESCE(s.reserved, 0)::int AS "reserved",
           lucy_available_stock(${branch.id}::uuid, v.id)::int AS "available",
           COALESCE(l.lot_count, 0)::int AS "lotCount",
           COALESCE(l.expired_qty, 0)::int AS "expiredQuantity",
           to_char(l.next_expiry, 'YYYY-MM-DD') AS "nextExpiry"
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN stock_levels s ON s.branch_id = ${branch.id}::uuid AND s.variant_id = v.id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE x.quantity_on_hand > 0) AS lot_count,
             sum(x.quantity_on_hand) FILTER (WHERE x.expiry_date < ${today}::date) AS expired_qty,
             min(x.expiry_date) FILTER (WHERE x.quantity_on_hand > 0) AS next_expiry
      FROM inventory_lots x
      WHERE x.branch_id = ${branch.id}::uuid AND x.variant_id = v.id
    ) l ON true
    WHERE (${variantId}::uuid IS NULL OR v.id = ${variantId}::uuid)
      AND ((v.is_active AND p.status <> 'INACTIVE') OR COALESCE(s.on_hand, 0) > 0)
    ORDER BY p.name_vi, v.sort_order, v.sku`;
  const horizon = addDays(today, warningDays);
  return rows.map((row) => ({
    variantId: row.variantId,
    sku: row.sku,
    productId: row.productId,
    productNameVi: row.productNameVi,
    productNameEn: row.productNameEn,
    labelVi: row.labelVi,
    labelEn: row.labelEn,
    coverMediaId: row.coverMediaId,
    variantActive: row.variantActive,
    onHand: row.onHand,
    reserved: row.reserved,
    available: row.available,
    expiredQuantity: row.expiredQuantity,
    lowStockThreshold: row.threshold,
    lowStock: row.threshold !== null && row.onHand <= row.threshold,
    lotCount: row.lotCount,
    nextExpiry: row.nextExpiry,
    expiryAlert: row.nextExpiry !== null && row.nextExpiry <= horizon,
  }));
}

/** One variant's stock, lots and newest movements at a branch. */
export async function loadVariantDetail(
  context: AdminContext,
  branch: BranchRef,
  variantId: string,
): Promise<InventoryVariantDetailResponse | null> {
  const { tx } = context;
  const today = await branchToday(tx, branch.timezone);
  const warning = await expiryWarningDays(tx);
  const [item] = await loadItems(tx, branch, today, warning, variantId);
  if (!item) return null;
  const cost = canSeeCost(context);
  const lotRows = await tx.inventoryLot.findMany({
    where: { branchId: branch.id, variantId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      lotCode: true,
      expiryDate: true,
      quantityOnHand: true,
      createdAt: true,
      ...(cost ? { unitCostVnd: true } : {}),
      sourceReceiptLine: { select: { receipt: { select: { code: true } } } },
      movements: { where: { quantityDelta: { gt: 0 } }, select: { quantityDelta: true } },
    },
  });
  const lots: InventoryLotResponse[] = lotRows
    .map((lot) => {
      const expiry = lot.expiryDate ? isoDate(lot.expiryDate) : null;
      const response: InventoryLotResponse = {
        id: lot.id,
        lotCode: lot.lotCode,
        expiryDate: expiry,
        quantityOnHand: lot.quantityOnHand,
        receivedQuantity: lot.movements.reduce((sum, move) => sum + move.quantityDelta, 0),
        expired: expiry !== null && expiry < today,
        receiptCode: lot.sourceReceiptLine?.receipt.code ?? null,
        createdAt: lot.createdAt.toISOString(),
      };
      if (cost) {
        const unit = Reflect.get(lot, 'unitCostVnd') as bigint | null | undefined;
        response.unitCostVnd = unit === undefined || unit === null ? null : unit.toString();
      }
      return response;
    })
    // Lots with stock first (earliest expiry first, no expiry last), then the emptied ones.
    .sort(
      (a, b) =>
        Number(b.quantityOnHand > 0) - Number(a.quantityOnHand > 0) ||
        (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const movementRows = await tx.stockMovement.findMany({
    where: { branchId: branch.id, variantId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: {
      id: true,
      kind: true,
      quantityDelta: true,
      reason: true,
      note: true,
      createdAt: true,
      lot: { select: { lotCode: true } },
      actor: { select: { fullName: true } },
      receiptLine: { select: { receipt: { select: { code: true } } } },
      countLine: { select: { session: { select: { code: true } } } },
    },
  });
  const movements: InventoryMovementResponse[] = movementRows.map((move) => ({
    id: move.id,
    kind: move.kind,
    quantityDelta: move.quantityDelta,
    reason: move.reason,
    note: move.note,
    lotCode: move.lot.lotCode,
    actorName: move.actor.fullName,
    createdAt: move.createdAt.toISOString(),
    receiptCode: move.receiptLine?.receipt.code ?? null,
    countCode: move.countLine?.session.code ?? null,
  }));
  return {
    branchId: branch.id,
    branchName: branch.name,
    item,
    expiryWarningDays: warning,
    lots,
    movements,
    canAdjust: holdsAt(context, 'ADJUST_STOCK', branch.id),
  };
}
