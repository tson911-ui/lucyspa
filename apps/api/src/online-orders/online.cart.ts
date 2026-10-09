import type {
  OnlineCartAddRequest,
  OnlineCartLineResponse,
  OnlineCartProblem,
  OnlineCartResponse,
  OnlineCartSetRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { CustomerContext } from '../booking/customer-command.js';
import * as input from '../inventory/inventory.input.js';
import { effectivePriceAt } from '../pos/product-stock.js';
import { readOnlineSettings, type OnlineSettingsRow } from './online.settings.js';

/**
 * Phase 6 Wave 4 (P6-19; OQ-89, OQ-90, OQ-91): the cart of a signed-in member. One cart per account, kept in the database (both the
 * phone and the computer see it). A cart never keeps a price: every read and the checkout resolve the price of the day. Limits are the
 * settings' (default 20 lines, 10 of each). A variant sold online is shown with a buy button; one switched off is "Mua tại cửa hàng".
 *
 * How a line would be served is decided here for the view and again, under the stock locks, by the checkout: whole line in stock,
 * otherwise a pre-order when the variant is sold on order (never a split, OQ-84), otherwise out of stock (OQ-90).
 */

type Tx = Prisma.TransactionClient;

const variantSelect = {
  id: true,
  sku: true,
  labelVi: true,
  labelEn: true,
  isActive: true,
  sellOnline: true,
  sellOnOrder: true,
  leadTimeDaysMin: true,
  leadTimeDaysMax: true,
  product: {
    select: {
      id: true,
      code: true,
      status: true,
      nameVi: true,
      nameEn: true,
      images: {
        orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
        take: 1,
        select: { mediaAssetId: true },
      },
    },
  },
} satisfies Prisma.ProductVariantSelect;

export interface PlannedLine {
  variantId: string;
  quantity: number;
  unitPriceVnd: bigint;
  listPriceVnd: bigint;
  promotionId: string | null;
  campaignId: string | null;
  mode: 'IN_STOCK' | 'PRE_ORDER' | null;
  problem: OnlineCartProblem | null;
  expectedDaysMin: number | null;
  expectedDaysMax: number | null;
  variant: Prisma.ProductVariantGetPayload<{ select: typeof variantSelect }>;
}

/** The stock levels of the variants, locked in (variant) order at one branch; the checkout calls this BEFORE it reads availability. */
export async function lockLevels(
  tx: Tx,
  branchId: string,
  variantIds: readonly string[],
): Promise<void> {
  const sorted = [...new Set(variantIds)].sort();
  if (sorted.length === 0) return;
  await tx.$queryRaw`
    SELECT variant_id FROM stock_levels
    WHERE branch_id = ${branchId}::uuid AND variant_id = ANY(${sorted}::uuid[])
    ORDER BY variant_id FOR UPDATE`;
}

/**
 * Plans the lines: price of the day, the mode and the problem of each. Pass `lock: true` (the checkout) to take the level locks first so
 * the answer holds for the rest of the transaction.
 */
export async function planLines(
  tx: Tx,
  settings: OnlineSettingsRow,
  wanted: readonly { variantId: string; quantity: number }[],
  now: Date,
  options: { lock: boolean },
): Promise<PlannedLine[]> {
  if (wanted.length === 0) return [];
  const variantIds = wanted.map((line) => line.variantId);
  const rows = new Map(
    (
      await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: variantSelect,
      })
    ).map((row) => [row.id, row]),
  );
  const defaults = await tx.productSettings.findUniqueOrThrow({
    where: { id: 1 },
    select: { leadTimeDaysMin: true, leadTimeDaysMax: true },
  });
  const branchId = settings.fulfilmentBranchId;
  if (options.lock && branchId !== null) await lockLevels(tx, branchId, variantIds);
  const planned: PlannedLine[] = [];
  for (const line of wanted) {
    const variant = rows.get(line.variantId);
    if (!variant) throw new AuthError('NOT_FOUND', 'variantId');
    const price = await effectivePriceAt(tx, variant.id, now);
    const sellable = variant.isActive && variant.product.status === 'PUBLISHED' && price !== null;
    let problem: OnlineCartProblem | null = null;
    let mode: PlannedLine['mode'] = null;
    if (!sellable) problem = 'UNAVAILABLE';
    else if (!variant.sellOnline) problem = 'NOT_SOLD_ONLINE';
    else if (line.quantity > settings.maxLineQuantity) problem = 'OVER_LIMIT';
    else {
      let available = 0;
      if (branchId !== null) {
        const [row] = await tx.$queryRaw<{ available: number }[]>`
          SELECT lucy_available_stock(${branchId}::uuid, ${variant.id}::uuid) AS available`;
        available = row?.available ?? 0;
      }
      if (available >= line.quantity) mode = 'IN_STOCK';
      else if (variant.sellOnOrder) mode = 'PRE_ORDER';
      else problem = 'OUT_OF_STOCK';
    }
    const min = variant.leadTimeDaysMin ?? defaults.leadTimeDaysMin;
    const max = Math.max(variant.leadTimeDaysMax ?? defaults.leadTimeDaysMax, min);
    planned.push({
      variantId: variant.id,
      quantity: line.quantity,
      unitPriceVnd: price?.effectivePriceVnd ?? 0n,
      listPriceVnd: price?.listPriceVnd ?? 0n,
      promotionId: price?.promotionId ?? null,
      campaignId: price?.campaignId ?? null,
      mode,
      problem,
      expectedDaysMin: mode === 'PRE_ORDER' ? min : null,
      expectedDaysMax: mode === 'PRE_ORDER' ? max : null,
      variant,
    });
  }
  return planned;
}

function presentLine(line: PlannedLine): OnlineCartLineResponse {
  const { variant } = line;
  return {
    variantId: variant.id,
    productId: variant.product.id,
    productCode: variant.product.code,
    nameVi: variant.product.nameVi,
    nameEn: variant.product.nameEn,
    variantLabelVi: variant.labelVi,
    variantLabelEn: variant.labelEn,
    sku: variant.sku,
    imageMediaId: variant.product.images[0]?.mediaAssetId ?? null,
    quantity: line.quantity,
    unitPriceVnd: line.unitPriceVnd.toString(),
    listPriceVnd: line.listPriceVnd.toString(),
    onPromotion: line.promotionId !== null || line.campaignId !== null,
    lineTotalVnd: (line.unitPriceVnd * BigInt(line.quantity)).toString(),
    mode: line.mode,
    expectedDaysMin: line.expectedDaysMin,
    expectedDaysMax: line.expectedDaysMax,
    problem: line.problem,
  };
}

/** The unpaid online orders of an account (OQ-92): counted under the lock the customer command already holds on the user row. */
export async function countUnpaidOrders(tx: Tx, customerUserId: string): Promise<number> {
  return tx.invoice.count({
    where: { channel: 'ONLINE', status: 'PENDING_PAYMENT', payerUserId: customerUserId },
  });
}

async function cartOf(tx: Tx, customerUserId: string, create: boolean) {
  const existing = await tx.onlineCart.findUnique({
    where: { userId: customerUserId },
    select: { id: true, rowVersion: true },
  });
  if (existing || !create) return existing;
  return tx.onlineCart.create({
    data: { userId: customerUserId },
    select: { id: true, rowVersion: true },
  });
}

export async function cartLines(tx: Tx, customerUserId: string) {
  const cart = await cartOf(tx, customerUserId, false);
  if (!cart) return { cart: null, lines: [] as { variantId: string; quantity: number }[] };
  const lines = await tx.onlineCartLine.findMany({
    where: { cartId: cart.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { variantId: true, quantity: true },
  });
  return { cart, lines };
}

export async function getCart(context: CustomerContext): Promise<OnlineCartResponse> {
  const { tx, customerUserId, now } = context;
  const settings = await readOnlineSettings(tx);
  const { cart, lines } = await cartLines(tx, customerUserId);
  const planned = await planLines(tx, settings, lines, now, { lock: false });
  const presented = planned.map(presentLine);
  const ready =
    settings.enabled &&
    planned.length > 0 &&
    planned.length <= settings.maxCartLines &&
    planned.every((line) => line.problem === null);
  return {
    lines: presented,
    subtotalVnd: planned
      .reduce((sum, line) => sum + line.unitPriceVnd * BigInt(line.quantity), 0n)
      .toString(),
    hasPreOrder: planned.some((line) => line.mode === 'PRE_ORDER'),
    checkoutReady: ready,
    rowVersion: cart?.rowVersion ?? 0,
    unpaidOrders: await countUnpaidOrders(tx, customerUserId),
  };
}

function requireOpen(settings: OnlineSettingsRow): void {
  if (!settings.enabled || settings.fulfilmentBranchId === null) {
    throw new AuthError('ONLINE_SALES_CLOSED');
  }
}

async function requireSoldOnline(tx: Tx, variantId: string) {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, isActive: true, sellOnline: true, product: { select: { status: true } } },
  });
  if (!variant || !variant.isActive || variant.product.status !== 'PUBLISHED') {
    throw new AuthError('PRODUCT_NOT_SELLABLE', 'variantId');
  }
  if (!variant.sellOnline) throw new AuthError('PRODUCT_NOT_SOLD_ONLINE', 'variantId');
}

async function write(
  context: CustomerContext,
  variantId: string,
  quantity: number,
): Promise<OnlineCartResponse> {
  const { tx, customerUserId } = context;
  const settings = await readOnlineSettings(tx);
  if (quantity > 0) {
    requireOpen(settings);
    await requireSoldOnline(tx, variantId);
    if (quantity > settings.maxLineQuantity) throw new AuthError('CART_LIMIT', 'quantity');
  }
  const cart = await cartOf(tx, customerUserId, quantity > 0);
  if (cart) {
    const existing = await tx.onlineCartLine.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      select: { id: true },
    });
    if (quantity === 0) {
      if (existing)
        await tx.onlineCartLine.delete({ where: { id: existing.id }, select: { id: true } });
    } else if (existing) {
      await tx.onlineCartLine.update({
        where: { id: existing.id },
        data: { quantity, updatedAt: new Date() },
        select: { id: true },
      });
    } else {
      const count = await tx.onlineCartLine.count({ where: { cartId: cart.id } });
      if (count >= settings.maxCartLines) throw new AuthError('CART_LIMIT', 'variantId');
      await tx.onlineCartLine.create({
        data: { cartId: cart.id, variantId, quantity },
        select: { id: true },
      });
    }
    await tx.onlineCart.update({
      where: { id: cart.id },
      data: { rowVersion: { increment: 1 }, updatedAt: new Date() },
      select: { id: true },
    });
  }
  return getCart(context);
}

/** Adds units of a variant; the total of one line never exceeds the limit. */
export async function addToCart(
  context: CustomerContext,
  request: OnlineCartAddRequest,
): Promise<OnlineCartResponse> {
  const raw = input.record(request, 'cart', ['variantId', 'quantity']);
  const variantId = input.uuid(raw['variantId'], 'variantId');
  const quantity = input.quantity(raw['quantity'], 'quantity');
  const { tx, customerUserId } = context;
  const cart = await cartOf(tx, customerUserId, false);
  const existing = cart
    ? await tx.onlineCartLine.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
        select: { quantity: true },
      })
    : null;
  const settings = await readOnlineSettings(tx);
  const total = (existing?.quantity ?? 0) + quantity;
  if (total > settings.maxLineQuantity) throw new AuthError('CART_LIMIT', 'quantity');
  return write(context, variantId, total);
}

/** Sets the quantity of a line (0 removes it). */
export async function setCartLine(
  context: CustomerContext,
  request: OnlineCartSetRequest,
): Promise<OnlineCartResponse> {
  const raw = input.record(request, 'cart', ['variantId', 'quantity']);
  const variantId = input.uuid(raw['variantId'], 'variantId');
  const value = raw['quantity'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) {
    throw new AuthError('VALIDATION_FAILED', 'quantity');
  }
  return write(context, variantId, value);
}

/** Empties the cart (after a checkout, or by the customer). */
export async function clearCart(tx: Tx, customerUserId: string): Promise<void> {
  const cart = await cartOf(tx, customerUserId, false);
  if (!cart) return;
  await tx.onlineCartLine.deleteMany({ where: { cartId: cart.id } });
  await tx.onlineCart.update({
    where: { id: cart.id },
    data: { rowVersion: { increment: 1 }, updatedAt: new Date() },
    select: { id: true },
  });
}
