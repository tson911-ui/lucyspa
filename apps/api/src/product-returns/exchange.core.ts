import {
  exchangeAmounts,
  PRODUCT_REFUND_REASON_MAX,
  productRefundAmount,
  type ProductExchangeBlocked,
  type ProductExchangeOption,
  type ProductExchangeOptionsResponse,
  type ProductExchangePreviewResponse,
  type ProductExchangeResponse,
  type ProductExchangeStatus,
  type ProductExchangeSummaryResponse,
  type ProductRefundMethodName,
  type ProductRefundRestockName,
} from '@lucy-spa/contracts';
import { generateInvoiceCode, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { FROM_FOLDED, likeLiteral, searchTokens, TO_FOLDED } from '../employees/employee-search.js';
import * as input from '../inventory/inventory.input.js';
import { CALCULATION_VERSION } from '../pos/invoice.calc.js';
import { balanceOf, databaseClock, finalizeInvoiceCore } from '../pos/invoice.core.js';
import {
  effectivePriceAt,
  eligibleSellers,
  MAX_PRODUCT_LINE_QUANTITY,
} from '../pos/product-stock.js';
import {
  bankReference,
  lineClaims,
  lockCase,
  lockInvoice,
  noReference,
  openExchangeOnLine,
  pick,
  requireRefund,
  soldSegments,
  takeFreshConfirmation,
} from './refund.core.js';
import { noticeName, tellOwnerAboutRefund } from './refund.notice.js';
import * as parse from './return.input.js';

/**
 * Phase 6 P6-14: exchanges of a returned product line (design 8.5; OQ-24, OQ-82, PRD 28.5). An exchange follows a return case accepted
 * as an EXCHANGE: the customer gives back the units of the case and takes the same number of units of ONE replacement item that is in
 * stock now. Only `REFUND_PRODUCTS` at the invoice's branch, with a password confirmation used once (the pool of the refunds).
 *
 * The replacement leaves the shop on a NEW invoice made here (a normal product sale invoice at the counter, same payer, whose only
 * benefit is the exchange credit: what the customer paid for the returned units). So everything that already works for an invoice works
 * for the exchange: the stock is reserved when it is made and sold when it is paid, a difference to pay is an ordinary payment (cash or
 * PayOS), the Beauty points are earned on what is actually paid, and nothing is edited or deleted.
 *
 *   - The customer pays more: the invoice stays PENDING_PAYMENT; once it is paid, `completeExchange` takes the returned goods in.
 *   - Nothing to pay (equal, cheaper, or the same item): the invoice is settled at once and the returned goods are taken in in the same
 *     step. A cheaper replacement hands the difference back by cash or manual transfer (the refund rules: the transfer reference only,
 *     the Owner is told in-app).
 *   - Returned goods: sellable ones go into a NEW lot named after the case keeping the expiry of the lot they were sold from, the rest
 *     moves no stock (no phantom stock).
 *
 * Lock order (design 10.2): the original invoice row, the case row, then the stock levels of both items in (branch, variant) order, then
 * the new invoice (which nobody else can see yet). The completion locks the original invoice, the case, then the exchange invoice
 * (shared). One exchange per line is open at a time; a refund or another exchange on the line waits for it to be completed or cancelled.
 */
type Tx = Prisma.TransactionClient;

const EXCHANGE_KEYS = [
  'variantId',
  'expectedPayableVnd',
  'expectedRefundVnd',
  'restock',
  'refundMethod',
  'bankReference',
  'sellerUserId',
  'reason',
  'clientRequestId',
] as const;
const COMPLETE_KEYS = ['restock'] as const;
const CORRECTION_KEYS = ['bankReference', 'reason'] as const;
const METHODS = ['CASH', 'BANK_TRANSFER_MANUAL'] as const;
const RESTOCKS = ['SELLABLE', 'NOT_SELLABLE'] as const;
const MONEY = /^(?:0|[1-9][0-9]{0,17})$/;
const LIST_LIMIT = 20;
const MAX_QUERY = 80;
const MAX_TERMS = 6;

function money(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !MONEY.test(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return BigInt(value);
}

const caseSelect = {
  id: true,
  code: true,
  branchId: true,
  invoiceId: true,
  invoiceLineId: true,
  quantity: true,
  status: true,
  decidedOutcome: true,
  invoice: {
    select: { code: true, status: true, channel: true, paidSeq: true, payerUserId: true },
  },
  line: { select: { quantity: true } },
  productLine: { select: { variantId: true, sku: true, sellerUserId: true } },
} satisfies Prisma.ProductReturnCaseSelect;

const exchangeSelect = {
  id: true,
  code: true,
  quantity: true,
  rule: true,
  creditVnd: true,
  replacementUnitPriceVnd: true,
  replacementGrossVnd: true,
  appliedCreditVnd: true,
  payableVnd: true,
  refundVnd: true,
  refundMethod: true,
  refundBankReference: true,
  reason: true,
  occurredAt: true,
  lineUnitsAfter: true,
  paidSeq: true,
  invoiceLineId: true,
  branchId: true,
  exchangeInvoiceId: true,
  actor: { select: { fullName: true } },
  replacementVariant: {
    select: {
      id: true,
      sku: true,
      labelVi: true,
      labelEn: true,
      product: { select: { nameVi: true, nameEn: true } },
    },
  },
  exchangeInvoice: {
    select: {
      id: true,
      code: true,
      status: true,
      totalVnd: true,
      payments: {
        select: { status: true, amountVnd: true, correction: { select: { id: true } } },
      },
    },
  },
  corrections: {
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      bankReference: true,
      reason: true,
      occurredAt: true,
      actor: { select: { fullName: true } },
    },
  },
  completion: {
    select: { restock: true, occurredAt: true, actor: { select: { fullName: true } } },
  },
  lots: { orderBy: [{ lotCode: 'asc' }], select: { lotCode: true } },
} satisfies Prisma.ProductExchangeSelect;

type ExchangeRow = Prisma.ProductExchangeGetPayload<{ select: typeof exchangeSelect }>;

function statusOf(row: ExchangeRow): ProductExchangeStatus {
  if (row.exchangeInvoice.status === 'CANCELLED') return 'CANCELLED';
  if (row.completion) return 'COMPLETED';
  return row.exchangeInvoice.status === 'PAID' ? 'AWAITING_COMPLETION' : 'AWAITING_PAYMENT';
}

async function present(tx: Tx, row: ExchangeRow): Promise<ProductExchangeResponse> {
  const last = row.corrections.at(-1);
  const earned = await tx.loyaltyLedgerEntry.findFirst({
    where: { invoiceId: row.exchangeInvoiceId, kind: 'EARN', wallet: 'BEAUTY' },
    select: { points: true },
  });
  const invoice = row.exchangeInvoice;
  return {
    id: row.id,
    code: row.code,
    status: statusOf(row),
    rule: row.rule,
    quantity: row.quantity,
    replacement: {
      variantId: row.replacementVariant.id,
      sku: row.replacementVariant.sku,
      nameVi: row.replacementVariant.product.nameVi,
      nameEn: row.replacementVariant.product.nameEn,
      variantLabelVi: row.replacementVariant.labelVi,
      variantLabelEn: row.replacementVariant.labelEn,
      unitPriceVnd: row.replacementUnitPriceVnd.toString(),
    },
    creditVnd: row.creditVnd.toString(),
    replacementGrossVnd: row.replacementGrossVnd.toString(),
    appliedCreditVnd: row.appliedCreditVnd.toString(),
    payableVnd: row.payableVnd.toString(),
    refundVnd: row.refundVnd.toString(),
    refund:
      row.refundMethod === null
        ? null
        : {
            method: row.refundMethod,
            bankReference: last?.bankReference ?? row.refundBankReference,
            firstBankReference: last ? row.refundBankReference : null,
            corrections: row.corrections.map((correction) => ({
              id: correction.id,
              bankReference: correction.bankReference,
              reason: correction.reason,
              actorName: correction.actor.fullName,
              occurredAt: correction.occurredAt.toISOString(),
            })),
          },
    invoice: {
      id: invoice.id,
      code: invoice.code,
      status: invoice.status as 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED',
      totalVnd: invoice.totalVnd.toString(),
      balanceVnd: balanceOf({
        status: invoice.status,
        totalVnd: invoice.totalVnd,
        payments: invoice.payments,
      }).toString(),
    },
    reason: row.reason,
    actorName: row.actor.fullName,
    occurredAt: row.occurredAt.toISOString(),
    completion: row.completion
      ? {
          restock: row.completion.restock,
          actorName: row.completion.actor.fullName,
          occurredAt: row.completion.occurredAt.toISOString(),
          lotCodes: row.lots.map((lot) => lot.lotCode),
        }
      : null,
    beautyPointsEarned: earned ? earned.points : null,
  };
}

async function loadCase(tx: Tx, caseId: string) {
  const kase = await tx.productReturnCase.findUnique({ where: { id: caseId }, select: caseSelect });
  if (!kase) throw new AuthError('NOT_FOUND');
  return kase;
}
type CaseRow = Awaited<ReturnType<typeof loadCase>>;

async function lineNet(tx: Tx, lineId: string) {
  return tx.invoiceLineAllocation.findUnique({
    where: { invoiceLineId: lineId },
    select: { netVnd: true, side: true },
  });
}

// ------------------------------------------------------------------------------------------------- reading

/** The exchanges of a case, what an exchange could take today, and what the person may do. REFUND_PRODUCTS at the case's branch. */
export async function exchangeSummary(
  context: AdminContext,
  caseId: string,
): Promise<ProductExchangeSummaryResponse> {
  const { tx } = context;
  const kase = await loadCase(tx, caseId);
  requireRefund(context, kase.branchId);
  const allocation = await lineNet(tx, kase.invoiceLineId);
  const sold = kase.line.quantity;
  const claims = await lineClaims(tx, kase.invoiceLineId);
  const rows = await tx.productExchange.findMany({
    where: { returnCaseId: caseId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: exchangeSelect,
  });
  const exchanges: ProductExchangeResponse[] = [];
  for (const row of rows) exchanges.push(await present(tx, row));
  const active = exchanges.find((exchange) => exchange.status !== 'CANCELLED') ?? null;
  const canCredit =
    sold !== null &&
    allocation !== null &&
    allocation.side === 'BEAUTY' &&
    claims.units + kase.quantity <= sold;
  const creditVnd = canCredit
    ? productRefundAmount(allocation.netVnd, sold, claims.units, kase.quantity)
    : null;
  const accepted = kase.status === 'ACCEPTED' && kase.decidedOutcome === 'EXCHANGE';
  const open = await openExchangeOnLine(tx, kase.invoiceLineId);
  const blocked: ProductExchangeBlocked = !accepted
    ? 'NOT_ACCEPTED_AS_EXCHANGE'
    : kase.invoice.status !== 'PAID'
      ? 'INVOICE_NOT_PAID'
      : active && active.status === 'COMPLETED'
        ? 'ALREADY_EXCHANGED'
        : active || open
          ? 'OPEN_EXCHANGE'
          : creditVnd === null
            ? 'LINE_IN_USE'
            : creditVnd <= 0n
              ? 'NOTHING_PAID_NO_CREDIT'
              : null;
  return {
    caseId: kase.id,
    caseCode: kase.code,
    invoiceCode: kase.invoice.code,
    caseQuantity: kase.quantity,
    creditVnd: creditVnd === null ? null : creditVnd.toString(),
    exchangeable: blocked === null,
    blocked,
    exchanges,
    can: {
      exchange: blocked === null,
      complete: exchanges.some((exchange) => exchange.status === 'AWAITING_COMPLETION'),
      correctReference: exchanges.some(
        (exchange) => exchange.refund?.method === 'BANK_TRANSFER_MANUAL',
      ),
    },
  };
}

interface OptionRow {
  variant_id: string;
  product_id: string;
  sku: string;
  name_vi: string;
  name_en: string;
  label_vi: string | null;
  label_en: string | null;
  list_price_vnd: bigint;
  effective_price_vnd: bigint;
  on_promotion: boolean;
  available: number;
}

/** Sellable items of the branch with the price of today and what is available now; `only` narrows to one variant. */
async function findOptions(
  tx: Tx,
  branchId: string,
  now: Date,
  q: string,
  only: string | null,
): Promise<OptionRow[]> {
  const patterns = searchTokens(q)
    .slice(0, MAX_TERMS)
    .map((term) => `%${likeLiteral(term)}%`);
  return tx.$queryRaw<OptionRow[]>`
    SELECT v.id AS variant_id, p.id AS product_id, v.sku, p.name_vi, p.name_en, v.label_vi, v.label_en,
           pr.list_price_vnd, pr.effective_price_vnd, (pr.effective_price_vnd < pr.list_price_vnd) AS on_promotion,
           lucy_available_stock(${branchId}::uuid, v.id) AS available
    FROM products p
    JOIN product_variants v ON v.product_id = p.id AND v.is_active
    LEFT JOIN brands b ON b.id = p.brand_id
    CROSS JOIN LATERAL lucy_variant_price_at(v.id, ${now}::timestamptz) pr
    WHERE p.status = 'PUBLISHED' AND pr.effective_price_vnd IS NOT NULL
      AND (${only}::uuid IS NULL OR v.id = ${only}::uuid)
      AND (cardinality(${patterns}::text[]) = 0 OR NOT EXISTS (
        SELECT 1 FROM unnest(${patterns}::text[]) AS t(pat)
        WHERE translate(lower(normalize(
                p.name_vi || ' ' || p.name_en || ' ' || COALESCE(b.name_vi, '') || ' ' || COALESCE(b.name_en, '') || ' '
                || COALESCE(v.label_vi, '') || ' ' || COALESCE(v.label_en, '') || ' ' || v.sku, NFC)),
              ${FROM_FOLDED}, ${TO_FOLDED}) NOT LIKE t.pat))
    ORDER BY (lucy_available_stock(${branchId}::uuid, v.id) > 0) DESC, p.name_vi, v.sort_order, v.id
    LIMIT ${LIST_LIMIT + 1}`;
}

const optionOf = (row: OptionRow, returnedVariantId: string): ProductExchangeOption => ({
  variantId: row.variant_id,
  productId: row.product_id,
  sku: row.sku,
  nameVi: row.name_vi,
  nameEn: row.name_en,
  variantLabelVi: row.label_vi,
  variantLabelEn: row.label_en,
  listPriceVnd: row.list_price_vnd.toString(),
  unitPriceVnd: row.effective_price_vnd.toString(),
  onPromotion: row.on_promotion,
  available: row.available,
  sameItem: row.variant_id === returnedVariantId,
});

async function branchSellers(tx: Tx, branchId: string) {
  return tx.$queryRaw<{ id: string; full_name: string }[]>`
    SELECT DISTINCT u.id, u.full_name
    FROM users u JOIN employee_branch_assignments a ON a.employee_user_id = u.id
    WHERE a.branch_id = ${branchId}::uuid AND a.revoked_at IS NULL AND u.kind = 'EMPLOYEE' AND u.status = 'ACTIVE'
    ORDER BY u.full_name, u.id`;
}

/** Items that can be the replacement, searched by name, brand, label or SKU without diacritics (REFUND_PRODUCTS). */
export async function exchangeOptions(
  context: AdminContext,
  caseId: string,
  query: { q?: unknown },
): Promise<ProductExchangeOptionsResponse> {
  const { tx } = context;
  const q = query.q ?? '';
  if (typeof q !== 'string' || q.length > MAX_QUERY) throw new AuthError('VALIDATION_FAILED', 'q');
  const kase = await loadCase(tx, caseId);
  requireRefund(context, kase.branchId);
  const now = await databaseClock(tx);
  const rows = await findOptions(tx, kase.branchId, now, q, null);
  const sellers = await branchSellers(tx, kase.branchId);
  const ids = new Set(sellers.map((seller) => seller.id));
  const defaultSellerUserId =
    kase.productLine.sellerUserId !== null && ids.has(kase.productLine.sellerUserId)
      ? kase.productLine.sellerUserId
      : ids.has(context.actor.userId)
        ? context.actor.userId
        : null;
  return {
    quantity: kase.quantity,
    options: rows.slice(0, LIST_LIMIT).map((row) => optionOf(row, kase.productLine.variantId)),
    truncated: rows.length > LIST_LIMIT,
    sellers: sellers.map((seller) => ({ userId: seller.id, displayName: seller.full_name })),
    defaultSellerUserId,
  };
}

/** What an exchange for the given replacement would be worth today (REFUND_PRODUCTS). Nothing is written. */
export async function exchangePreview(
  context: AdminContext,
  caseId: string,
  variantIdValue: unknown,
): Promise<ProductExchangePreviewResponse> {
  const variantId = input.uuid(variantIdValue, 'variantId');
  const { tx } = context;
  const kase = await loadCase(tx, caseId);
  requireRefund(context, kase.branchId);
  const ready = await readiness(tx, kase);
  const now = await databaseClock(tx);
  const [row] = await findOptions(tx, kase.branchId, now, '', variantId);
  if (!row) throw new AuthError('PRODUCT_NOT_SELLABLE', 'variantId');
  const option = optionOf(row, kase.productLine.variantId);
  const amounts = exchangeAmounts({
    creditVnd: ready.creditVnd,
    replacementGrossVnd: BigInt(kase.quantity) * row.effective_price_vnd,
    sameItem: option.sameItem,
  });
  return {
    caseId: kase.id,
    caseCode: kase.code,
    quantity: kase.quantity,
    option,
    rule: amounts.rule,
    creditVnd: amounts.creditVnd.toString(),
    replacementGrossVnd: amounts.replacementGrossVnd.toString(),
    appliedCreditVnd: amounts.appliedCreditVnd.toString(),
    payableVnd: amounts.payableVnd.toString(),
    refundVnd: amounts.refundVnd.toString(),
    inStock: row.available >= kase.quantity,
  };
}

/** The rules every new exchange needs, checked on the case as read (and again under the locks by the command). */
async function readiness(
  tx: Tx,
  kase: CaseRow,
): Promise<{ creditVnd: bigint; net: bigint; sold: number }> {
  if (kase.status !== 'ACCEPTED' || kase.decidedOutcome !== 'EXCHANGE') {
    throw new AuthError('EXCHANGE_CASE_NOT_READY');
  }
  if (kase.invoice.status !== 'PAID' || kase.invoice.channel !== 'COUNTER') {
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  const active = await tx.productExchange.findFirst({
    where: { returnCaseId: kase.id, exchangeInvoice: { status: { not: 'CANCELLED' } } },
    select: { completion: { select: { exchangeId: true } } },
  });
  if (active)
    throw new AuthError(active.completion ? 'EXCHANGE_ALREADY_DONE' : 'EXCHANGE_IN_PROGRESS');
  if (await openExchangeOnLine(tx, kase.invoiceLineId)) throw new AuthError('EXCHANGE_IN_PROGRESS');
  const sold = kase.line.quantity;
  const allocation = await lineNet(tx, kase.invoiceLineId);
  if (sold === null || allocation === null || allocation.side !== 'BEAUTY') {
    throw new AuthError('EXCHANGE_NOTHING_PAID');
  }
  const claims = await lineClaims(tx, kase.invoiceLineId);
  if (claims.units + kase.quantity > sold)
    throw new AuthError('REFUND_QUANTITY_EXCEEDED', 'quantity');
  const creditVnd = productRefundAmount(allocation.netVnd, sold, claims.units, kase.quantity);
  if (creditVnd <= 0n) throw new AuthError('EXCHANGE_NOTHING_PAID');
  return { creditVnd, net: allocation.netVnd, sold };
}

// ----------------------------------------------------------------------------------------------- commands

/** The goods the customer gave back are taken in: a completion record and, for sellable goods, new lots named after the case. */
async function takeInGoods(
  context: AdminContext,
  exchange: {
    id: string;
    branchId: string;
    invoiceLineId: string;
    paidSeq: number;
    quantity: number;
    lineUnitsAfter: number;
  },
  kase: { code: string; line: { quantity: number | null }; productLine: { variantId: string } },
  restock: ProductRefundRestockName,
): Promise<number> {
  const { tx } = context;
  const sold = kase.line.quantity;
  if (sold === null) throw new AuthError('EXCHANGE_NOTHING_PAID');
  // Sellable goods need the sale recorded in stock (to know which lot they came out of); not sellable never waits.
  let segments: Awaited<ReturnType<typeof soldSegments>> = [];
  if (restock === 'SELLABLE') {
    try {
      segments = await soldSegments(
        tx,
        { invoiceLineId: exchange.invoiceLineId, paidSeq: exchange.paidSeq, soldQuantity: sold },
        exchange.lineUnitsAfter - exchange.quantity,
        exchange.quantity,
      );
    } catch (error) {
      if (error instanceof AuthError && error.code === 'REFUND_STOCK_PENDING') {
        throw new AuthError('EXCHANGE_STOCK_PENDING');
      }
      throw error;
    }
  }
  await tx.productExchangeCompletion.create({
    data: { exchangeId: exchange.id, restock, actorUserId: context.actor.userId },
    select: { exchangeId: true },
  });
  const base = `${kase.code}-E`;
  for (const [index, segment] of segments.entries()) {
    const lot = await tx.inventoryLot.create({
      data: {
        branchId: exchange.branchId,
        variantId: kase.productLine.variantId,
        lotCode: segments.length === 1 ? base : `${base}/${index + 1}`,
        expiryDate: segment.expiryDate,
        unitCostVnd: segment.unitCostVnd,
        sourceExchangeId: exchange.id,
        createdByUserId: context.actor.userId,
      },
      select: { id: true },
    });
    await tx.stockMovement.create({
      data: {
        branchId: exchange.branchId,
        variantId: kase.productLine.variantId,
        lotId: lot.id,
        kind: 'EXCHANGE_RETURN',
        quantityDelta: segment.quantity,
        productExchangeId: exchange.id,
        idempotencyKey: `EXCHANGE_RETURN:${exchange.id}:${index + 1}`,
        actorUserId: context.actor.userId,
      },
      select: { id: true },
    });
  }
  return segments.length;
}

interface DraftInput {
  branchId: string;
  payerUserId: string | null;
  originalCode: string;
  variantId: string;
  quantity: number;
  sellerUserId: string;
}

/** The new DRAFT invoice of the exchange with its one replacement line (priced again, and frozen, when it is finalized). */
async function createExchangeDraft(
  context: AdminContext,
  draft: DraftInput,
): Promise<{ invoiceId: string; version: number }> {
  const { tx } = context;
  await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${draft.variantId}::uuid FOR SHARE`;
  const variant = await tx.productVariant.findUnique({
    where: { id: draft.variantId },
    select: {
      id: true,
      sku: true,
      labelVi: true,
      labelEn: true,
      isActive: true,
      product: {
        select: {
          id: true,
          status: true,
          brandId: true,
          categoryId: true,
          nameVi: true,
          nameEn: true,
        },
      },
    },
  });
  if (!variant || !variant.isActive || variant.product.status !== 'PUBLISHED') {
    throw new AuthError('PRODUCT_NOT_SELLABLE', 'variantId');
  }
  const [clock] = await tx.$queryRaw<{ created: Date; day: Date }[]>`
    SELECT now() AS created, lucy_branch_local_date(${draft.branchId}::uuid, now()) AS day`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  const now = await databaseClock(tx);
  const price = await effectivePriceAt(tx, variant.id, now);
  if (!price) throw new AuthError('PRODUCT_NOT_SELLABLE', 'variantId');
  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateInvoiceCode(clock.day.toISOString().slice(0, 10));
    if (!(await tx.invoice.findUnique({ where: { code: candidate }, select: { id: true } }))) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new AuthError('SERVICE_UNAVAILABLE');
  const invoice = await tx.invoice.create({
    data: {
      code,
      kind: 'PRODUCT_SALE',
      branchId: draft.branchId,
      payerUserId: draft.payerUserId,
      businessDate: clock.day,
      calculationVersion: CALCULATION_VERSION,
      subtotalVnd: 0n,
      discountTotalVnd: 0n,
      totalVnd: 0n,
      createdByUserId: context.actor.userId,
      createdAt: clock.created,
    },
    select: { id: true, rowVersion: true },
  });
  const suffixVi = variant.labelVi ? ` - ${variant.labelVi}` : '';
  const suffixEn = variant.labelEn ? ` - ${variant.labelEn}` : '';
  const line = await tx.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      sequence: 1,
      kind: 'PRODUCT',
      itemCode: variant.sku,
      nameVi: `${variant.product.nameVi}${suffixVi}`,
      nameEn: `${variant.product.nameEn}${suffixEn}`,
      quantity: draft.quantity,
      unitPriceVnd: price.effectivePriceVnd,
      grossVnd: BigInt(draft.quantity) * price.effectivePriceVnd,
    },
    select: { id: true },
  });
  await tx.invoiceLineProduct.create({
    data: {
      invoiceLineId: line.id,
      invoiceId: invoice.id,
      productId: variant.product.id,
      variantId: variant.id,
      sku: variant.sku,
      brandId: variant.product.brandId,
      categoryId: variant.product.categoryId,
      productNameVi: variant.product.nameVi,
      productNameEn: variant.product.nameEn,
      variantLabelVi: variant.labelVi,
      variantLabelEn: variant.labelEn,
      sellerUserId: draft.sellerUserId,
      listPriceVnd: price.listPriceVnd,
      promotionId: price.promotionId,
      campaignId: price.campaignId,
      pricedAt: now,
    },
    select: { invoiceLineId: true },
  });
  await appendAdminAudit(context, {
    action: 'INVOICE_CREATED',
    entityType: 'Invoice',
    entityId: invoice.id,
    subjectUserId: draft.payerUserId,
    branchId: draft.branchId,
    classification: 'FINANCIAL',
    after: {
      code,
      kind: 'PRODUCT_SALE',
      payerUserId: draft.payerUserId,
      calculationVersion: CALCULATION_VERSION,
      exchangeFor: draft.originalCode,
    },
  });
  return { invoiceId: invoice.id, version: invoice.rowVersion };
}

export async function makeExchange(
  context: AdminContext,
  caseId: string,
  request: Record<string, unknown>,
  freshAuthSeconds: number,
  owners: readonly string[],
): Promise<ProductExchangeSummaryResponse> {
  const body = input.record(request, 'body', EXCHANGE_KEYS);
  const variantId = input.uuid(body['variantId'], 'variantId');
  const expectedPayable = money(body['expectedPayableVnd'], 'expectedPayableVnd');
  const expectedRefund = money(body['expectedRefundVnd'], 'expectedRefundVnd');
  const reason = parse.requiredNote(body['reason'], 'reason', PRODUCT_REFUND_REASON_MAX);
  const clientRequestId = input.uuid(body['clientRequestId'], 'clientRequestId');
  const requestedSeller = input.optionalUuid(body['sellerUserId'], 'sellerUserId');
  // What the request must carry follows from the figures the person was shown: a difference to pay takes the goods in later (the
  // restock decision comes with the completion); nothing to pay takes them in now; money handed back needs its method.
  const mustRestockNow = expectedPayable === 0n;
  const restock =
    body['restock'] === null || body['restock'] === undefined
      ? null
      : pick<ProductRefundRestockName>(body['restock'], RESTOCKS, 'restock');
  if (mustRestockNow !== (restock !== null)) throw new AuthError('VALIDATION_FAILED', 'restock');
  const refundMethod =
    body['refundMethod'] === null || body['refundMethod'] === undefined
      ? null
      : pick<ProductRefundMethodName>(body['refundMethod'], METHODS, 'refundMethod');
  if (expectedRefund > 0n !== (refundMethod !== null)) {
    throw new AuthError('VALIDATION_FAILED', 'refundMethod');
  }
  if (expectedPayable > 0n && expectedRefund > 0n)
    throw new AuthError('VALIDATION_FAILED', 'expectedRefundVnd');
  const reference =
    refundMethod === 'BANK_TRANSFER_MANUAL'
      ? bankReference(body['bankReference'])
      : noReference(body['bankReference']);

  const { tx } = context;
  const hint = await tx.productReturnCase.findUnique({
    where: { id: caseId },
    select: { branchId: true, invoiceId: true, invoiceLineId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  requireRefund(context, hint.branchId);

  // A repeat of the same request returns the exchange it already made (no password needed to read it back).
  const replay = async (): Promise<ProductExchangeSummaryResponse | null> => {
    const prior = await tx.productExchange.findUnique({
      where: {
        actorUserId_clientRequestId: { actorUserId: context.actor.userId, clientRequestId },
      },
      select: {
        returnCaseId: true,
        replacementVariantId: true,
        refundMethod: true,
        refundBankReference: true,
        reason: true,
        completion: { select: { restock: true } },
        payableVnd: true,
      },
    });
    if (!prior) return null;
    if (
      prior.returnCaseId !== caseId ||
      prior.replacementVariantId !== variantId ||
      prior.refundMethod !== refundMethod ||
      prior.refundBankReference !== reference ||
      prior.reason !== reason ||
      prior.payableVnd !== expectedPayable ||
      (prior.completion?.restock ?? null) !== restock
    ) {
      throw new AuthError('CONFLICT');
    }
    return exchangeSummary(context, caseId);
  };
  const early = await replay();
  if (early) return early;
  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);

  await lockInvoice(tx, hint.invoiceId, true);
  await lockCase(tx, caseId);
  const settled = await replay();
  if (settled) return settled;

  const kase = await loadCase(tx, caseId);
  const ready = await readiness(tx, kase);
  const claims = await lineClaims(tx, kase.invoiceLineId);
  const sameItem = variantId === kase.productLine.variantId;

  // The stock rows of both items, in (branch, variant) order, before anything else touches them (design 10.2): the replacement is
  // reserved below and the returned goods may come back into the other item's stock.
  const levelIds = [...new Set([variantId, kase.productLine.variantId])].sort();
  await tx.$queryRaw`
    SELECT variant_id FROM stock_levels
    WHERE branch_id = ${kase.branchId}::uuid AND variant_id = ANY(${levelIds}::uuid[])
    ORDER BY variant_id FOR UPDATE`;

  // The seller recorded on the replacement line: the one named, else the seller of the returned line, else the person making it.
  const candidates = [requestedSeller, kase.productLine.sellerUserId, context.actor.userId].filter(
    (id): id is string => id !== null,
  );
  const eligible = await eligibleSellers(tx, kase.branchId, candidates);
  const sellerUserId = candidates.find((id) => eligible.has(id));
  if (!sellerUserId) throw new AuthError('PRODUCT_SELLER_REQUIRED');
  if (requestedSeller !== null && sellerUserId !== requestedSeller) {
    throw new AuthError('PRODUCT_SELLER_INVALID', 'sellerUserId');
  }

  if (kase.quantity > MAX_PRODUCT_LINE_QUANTITY)
    throw new AuthError('VALIDATION_FAILED', 'quantity');
  const draft = await createExchangeDraft(context, {
    branchId: kase.branchId,
    payerUserId: kase.invoice.payerUserId,
    originalCode: kase.invoice.code,
    variantId,
    quantity: kase.quantity,
    sellerUserId,
  });
  // Finalization prices the line at this very instant, reserves the stock (all or nothing) and, with nothing to pay, settles the invoice.
  await finalizeInvoiceCore(
    context,
    draft.invoiceId,
    { expectedVersion: draft.version },
    { permission: 'REFUND_PRODUCTS', exchange: { creditVnd: ready.creditVnd, sameItem } },
  );
  const swap = await tx.invoice.findUniqueOrThrow({
    where: { id: draft.invoiceId },
    select: {
      code: true,
      subtotalVnd: true,
      discountTotalVnd: true,
      totalVnd: true,
      lines: { select: { unitPriceVnd: true } },
    },
  });
  const unitPrice = swap.lines[0]?.unitPriceVnd;
  if (unitPrice === null || unitPrice === undefined) throw new AuthError('SERVICE_UNAVAILABLE');
  const amounts = exchangeAmounts({
    creditVnd: ready.creditVnd,
    replacementGrossVnd: swap.subtotalVnd,
    sameItem,
  });
  if (amounts.appliedCreditVnd !== swap.discountTotalVnd || amounts.payableVnd !== swap.totalVnd) {
    throw new AuthError('SERVICE_UNAVAILABLE');
  }
  // The figures the person saw must still be the figures (a price or a promotion may have moved, or another sale taken the credit).
  if (amounts.payableVnd !== expectedPayable || amounts.refundVnd !== expectedRefund) {
    throw new AuthError('EXCHANGE_FIGURES_CHANGED');
  }

  const [sequence] = await tx.$queryRaw<
    { n: string }[]
  >`SELECT nextval('product_exchange_code_seq')::text AS n`;
  const code = `DH${sequence!.n.padStart(6, '0')}`;
  const exchange = await tx.productExchange.create({
    data: {
      code,
      branchId: kase.branchId,
      invoiceId: kase.invoiceId,
      invoiceLineId: kase.invoiceLineId,
      returnCaseId: caseId,
      paidSeq: kase.invoice.paidSeq,
      quantity: kase.quantity,
      lineUnitsAfter: claims.units + kase.quantity,
      lineAmountAfterVnd: claims.vnd + ready.creditVnd,
      creditVnd: ready.creditVnd,
      rule: amounts.rule,
      replacementVariantId: variantId,
      replacementUnitPriceVnd: unitPrice,
      replacementGrossVnd: amounts.replacementGrossVnd,
      appliedCreditVnd: amounts.appliedCreditVnd,
      payableVnd: amounts.payableVnd,
      refundVnd: amounts.refundVnd,
      refundMethod,
      refundBankReference: reference,
      exchangeInvoiceId: draft.invoiceId,
      reason,
      actorUserId: context.actor.userId,
      reauthenticatedAt: confirmedAt,
      clientRequestId,
    },
    select: { id: true, lineUnitsAfter: true, quantity: true },
  });
  // The confirmation is spent by this exchange (the same pool as the refunds: the database refuses a second use).
  await tx.refundReauthenticationUse.create({
    data: {
      actorUserId: context.actor.userId,
      reauthenticatedAt: confirmedAt,
      productExchangeId: exchange.id,
    },
    select: { actorUserId: true },
  });

  let lots = 0;
  if (restock !== null) {
    lots = await takeInGoods(
      context,
      {
        id: exchange.id,
        branchId: kase.branchId,
        invoiceLineId: kase.invoiceLineId,
        paidSeq: kase.invoice.paidSeq,
        quantity: exchange.quantity,
        lineUnitsAfter: exchange.lineUnitsAfter,
      },
      kase,
      restock,
    );
  }

  // The reference is not copied into the audit log; the log says only that one was recorded.
  await appendAdminAudit(context, {
    action: 'PRODUCT_EXCHANGE_CREATED',
    entityType: 'ProductExchange',
    entityId: exchange.id,
    branchId: kase.branchId,
    classification: 'FINANCIAL',
    reason,
    after: {
      code,
      caseCode: kase.code,
      invoiceCode: kase.invoice.code,
      exchangeInvoiceCode: swap.code,
      rule: amounts.rule,
      quantity: kase.quantity,
      replacementVariantId: variantId,
      creditVnd: amounts.creditVnd.toString(),
      replacementGrossVnd: amounts.replacementGrossVnd.toString(),
      appliedCreditVnd: amounts.appliedCreditVnd.toString(),
      payableVnd: amounts.payableVnd.toString(),
      refundVnd: amounts.refundVnd.toString(),
      refundMethod,
      bankReferenceRecorded: reference !== null,
      completedNow: restock !== null,
      restock,
      lots,
      reauthenticatedAt: confirmedAt.toISOString(),
    },
  });
  if (restock !== null) {
    await appendAdminAudit(context, {
      action: 'PRODUCT_EXCHANGE_COMPLETED',
      entityType: 'ProductExchange',
      entityId: exchange.id,
      branchId: kase.branchId,
      classification: 'FINANCIAL',
      after: { code, restock, lots },
    });
  }
  // Money handed back is a refund: the Owner is told in the same transaction (the recipients were locked by the caller).
  if (amounts.refundVnd > 0n && refundMethod !== null) {
    const person = await tx.user.findUniqueOrThrow({
      where: { id: context.actor.userId },
      select: { fullName: true },
    });
    await tellOwnerAboutRefund(tx, {
      branchId: kase.branchId,
      caseId,
      caseCode: kase.code,
      recipients: owners,
      source: 'EXCHANGE',
      invoiceCode: kase.invoice.code,
      sku: kase.productLine.sku,
      quantity: kase.quantity,
      amountVnd: amounts.refundVnd,
      method: refundMethod,
      refundedByName: noticeName(person.fullName),
    });
  }
  return exchangeSummary(context, caseId);
}

/**
 * Takes the returned goods in once the exchange invoice is paid (an exchange with nothing to pay is completed when it is made).
 * REFUND_PRODUCTS at the branch; no password (the approval and any money handed back were confirmed when the exchange was made).
 * A repeat with the same decision returns the completed exchange; another decision is a conflict.
 */
export async function completeExchange(
  context: AdminContext,
  caseId: string,
  exchangeId: string,
  request: Record<string, unknown>,
): Promise<ProductExchangeSummaryResponse> {
  const body = input.record(request, 'body', COMPLETE_KEYS);
  const restock = pick<ProductRefundRestockName>(body['restock'], RESTOCKS, 'restock');
  const { tx } = context;
  const hint = await tx.productReturnCase.findUnique({
    where: { id: caseId },
    select: { branchId: true, invoiceId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  requireRefund(context, hint.branchId);
  await lockInvoice(tx, hint.invoiceId, true);
  await lockCase(tx, caseId);
  const exchange = await tx.productExchange.findFirst({
    where: { id: exchangeId, returnCaseId: caseId },
    select: {
      id: true,
      branchId: true,
      invoiceLineId: true,
      paidSeq: true,
      quantity: true,
      lineUnitsAfter: true,
      exchangeInvoiceId: true,
      completion: { select: { restock: true } },
    },
  });
  if (!exchange) throw new AuthError('NOT_FOUND');
  if (exchange.completion) {
    if (exchange.completion.restock !== restock) throw new AuthError('CONFLICT');
    return exchangeSummary(context, caseId);
  }
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${exchange.exchangeInvoiceId}::uuid FOR SHARE`;
  const swap = await tx.invoice.findUniqueOrThrow({
    where: { id: exchange.exchangeInvoiceId },
    select: { status: true },
  });
  if (swap.status === 'CANCELLED') throw new AuthError('INVOICE_STATE_INVALID');
  if (swap.status !== 'PAID') throw new AuthError('EXCHANGE_NOT_PAID');
  const kase = await loadCase(tx, caseId);
  if (kase.invoice.status !== 'PAID' || kase.invoice.paidSeq !== exchange.paidSeq) {
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  const lots = await takeInGoods(context, exchange, kase, restock);
  await appendAdminAudit(context, {
    action: 'PRODUCT_EXCHANGE_COMPLETED',
    entityType: 'ProductExchange',
    entityId: exchange.id,
    branchId: exchange.branchId,
    classification: 'FINANCIAL',
    after: { restock, lots },
  });
  return exchangeSummary(context, caseId);
}

/**
 * Corrects the transfer reference typed for the money an exchange handed back: a new linked record, the exchange never changes.
 * REFUND_PRODUCTS at the branch; no money moves, so no password is asked.
 */
export async function correctExchangeReference(
  context: AdminContext,
  caseId: string,
  exchangeId: string,
  request: Record<string, unknown>,
): Promise<ProductExchangeSummaryResponse> {
  const body = input.record(request, 'body', CORRECTION_KEYS);
  const reference = bankReference(body['bankReference']);
  const reason = parse.requiredNote(body['reason'], 'reason', PRODUCT_REFUND_REASON_MAX);
  const { tx } = context;
  const exchange = await tx.productExchange.findFirst({
    where: { id: exchangeId, returnCaseId: caseId },
    select: { id: true, code: true, branchId: true, invoiceId: true, refundMethod: true },
  });
  if (!exchange) throw new AuthError('NOT_FOUND');
  requireRefund(context, exchange.branchId);
  if (exchange.refundMethod !== 'BANK_TRANSFER_MANUAL') {
    throw new AuthError('VALIDATION_FAILED', 'bankReference');
  }
  await lockInvoice(tx, exchange.invoiceId, false);
  await tx.productExchangeCorrection.create({
    data: { exchangeId, bankReference: reference, reason, actorUserId: context.actor.userId },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_EXCHANGE_REFERENCE_CORRECTED',
    entityType: 'ProductExchange',
    entityId: exchangeId,
    branchId: exchange.branchId,
    classification: 'FINANCIAL',
    reason,
    after: { code: exchange.code },
  });
  return exchangeSummary(context, caseId);
}
