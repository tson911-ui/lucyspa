import type {
  InvoiceOpenedResponse,
  InvoiceProductLineAddRequest,
  InvoiceProductLineRemoveRequest,
  InvoiceProductLineUpdateRequest,
  InvoiceResponse,
  ProductSaleRequest,
} from '@lucy-spa/contracts';
import { generateInvoiceCode } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { CALCULATION_VERSION, grossOf } from './invoice.calc.js';
import { databaseClock, draftAmounts, load, lockedInvoice } from './invoice.core.js';
import {
  effectivePriceAt,
  eligibleSellers,
  MAX_PRODUCT_LINE_QUANTITY,
  repriceProductLines,
} from './product-stock.js';

/**
 * Phase 6 P6-8: product lines at the counter (design 5; T20). A product-only sale is a DRAFT invoice of kind `PRODUCT_SALE`
 * (no visit; a member or a guest pays); a VISIT draft may also take product lines beside its services. Everything here is a
 * DRAFT edit: the price is resolved by the server (never typed), the seller is required, nothing is reserved yet (drafts reserve
 * nothing, Q8). Finalization and cancellation are the existing commands (`invoice.core.ts`), which reserve and release the stock.
 * Authority is `SELL_PRODUCTS` at the invoice's own branch, decided again inside the transaction.
 */

const day = (value: Date) => value.toISOString().slice(0, 10);

function assertCan(context: AdminContext, permission: string, branchId: string): void {
  if (!decide(context.actor.graph, permission, { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
}

function checkQuantity(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_PRODUCT_LINE_QUANTITY
  ) {
    throw new AuthError('VALIDATION_FAILED', 'quantity');
  }
  return value;
}

/** Creates the DRAFT of a product-only sale. A product sale never depends on loyalty being live. */
export async function openProductSale(
  context: AdminContext,
  branchId: string,
  input: ProductSaleRequest,
): Promise<InvoiceOpenedResponse> {
  const { tx } = context;
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw new AuthError('NOT_FOUND');
  assertCan(context, 'SELL_PRODUCTS', branchId);
  const payerUserId = input.payerUserId ?? null;
  if (payerUserId !== null) {
    const payer = await tx.user.findFirst({
      where: { id: payerUserId, kind: 'CUSTOMER', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!payer) throw new AuthError('VALIDATION_FAILED', 'payerUserId');
  }
  const [clock] = await tx.$queryRaw<{ created: Date; day: Date }[]>`
    SELECT now() AS created, lucy_branch_local_date(${branchId}::uuid, now()) AS day`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateInvoiceCode(day(clock.day));
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
      branchId,
      payerUserId,
      businessDate: clock.day,
      calculationVersion: CALCULATION_VERSION,
      subtotalVnd: 0n,
      discountTotalVnd: 0n,
      totalVnd: 0n,
      createdByUserId: context.actor.userId,
      createdAt: clock.created,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'INVOICE_CREATED',
    entityType: 'Invoice',
    entityId: invoice.id,
    subjectUserId: payerUserId,
    branchId,
    classification: 'FINANCIAL',
    after: {
      code,
      kind: 'PRODUCT_SALE',
      payerUserId,
      calculationVersion: CALCULATION_VERSION,
    },
  });
  return { invoice: await load(context, invoice.id), created: true };
}

/** What every edit of a draft needs: the locked invoice, a matching version and a draft that takes product lines. */
async function lockedDraft(context: AdminContext, invoiceId: string, expectedVersion: number) {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'SELL_PRODUCTS');
  const invoice = await read();
  if (invoice.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
  if (invoice.status !== 'DRAFT' || invoice.kind === 'COMBO_SALE') {
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  return { hint, invoice };
}

/** Writes the header amounts after a product line changed and bumps the invoice version. */
async function refreshHeader(
  context: AdminContext,
  invoice: { id: string; payerUserId: string | null },
  now: Date,
) {
  const amounts = await draftAmounts(context.tx, invoice, now);
  await context.tx.invoice.update({
    where: { id: invoice.id },
    data: {
      subtotalVnd: amounts.subtotalVnd,
      discountTotalVnd: amounts.discountTotalVnd,
      totalVnd: amounts.totalVnd,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  return amounts;
}

/**
 * The seller of a new line: the one named, else the caller when the caller is an active employee of the branch. An Owner (or any
 * caller without a branch assignment) must name the seller: there is no silent default for them.
 */
async function chooseSeller(
  context: AdminContext,
  branchId: string,
  requested: string | undefined,
): Promise<string> {
  const candidate = requested ?? context.actor.userId;
  const eligible = await eligibleSellers(context.tx, branchId, [candidate]);
  if (eligible.has(candidate)) return candidate;
  throw new AuthError(
    requested === undefined ? 'PRODUCT_SELLER_REQUIRED' : 'PRODUCT_SELLER_INVALID',
  );
}

/**
 * Adds `quantity` of a variant to a DRAFT. The price is the variant's effective price now; a line with the same variant and the
 * same seller grows instead of repeating (a second seller makes a second line, PRD §25). No stock is checked or held here.
 */
export async function addProductLine(
  context: AdminContext,
  invoiceId: string,
  input: InvoiceProductLineAddRequest,
): Promise<InvoiceResponse> {
  const quantity = checkQuantity(input.quantity);
  const { hint, invoice } = await lockedDraft(context, invoiceId, input.expectedVersion);
  const { tx } = context;
  await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${input.variantId}::uuid FOR SHARE`;
  const variant = await tx.productVariant.findUnique({
    where: { id: input.variantId },
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
  const now = await databaseClock(tx);
  const price = await effectivePriceAt(tx, variant.id, now);
  if (!price) throw new AuthError('PRODUCT_NOT_SELLABLE', 'variantId');
  const sellerUserId = await chooseSeller(context, hint.branchId, input.sellerUserId);

  const same = invoice.lines.find(
    (line) =>
      line.kind === 'PRODUCT' &&
      line.productDetails[0]?.variantId === variant.id &&
      line.productDetails[0].sellerUserId === sellerUserId,
  );
  let lineId: string;
  let finalQuantity = quantity;
  if (same) {
    finalQuantity = (same.quantity ?? 0) + quantity;
    checkQuantity(finalQuantity);
    await tx.invoiceLine.update({
      where: { id: same.id },
      data: {
        quantity: finalQuantity,
        grossVnd: grossOf(finalQuantity, same.unitPriceVnd),
        rowVersion: { increment: 1 },
      },
      select: { id: true },
    });
    lineId = same.id;
  } else {
    const suffixVi = variant.labelVi ? ` - ${variant.labelVi}` : '';
    const suffixEn = variant.labelEn ? ` - ${variant.labelEn}` : '';
    const sequence = invoice.lines.reduce((max, line) => Math.max(max, line.sequence), 0) + 1;
    const created = await tx.invoiceLine.create({
      data: {
        invoiceId,
        sequence,
        kind: 'PRODUCT',
        itemCode: variant.sku,
        nameVi: `${variant.product.nameVi}${suffixVi}`,
        nameEn: `${variant.product.nameEn}${suffixEn}`,
        quantity,
        unitPriceVnd: price.effectivePriceVnd,
        grossVnd: grossOf(quantity, price.effectivePriceVnd),
      },
      select: { id: true },
    });
    await tx.invoiceLineProduct.create({
      data: {
        invoiceLineId: created.id,
        invoiceId,
        productId: variant.product.id,
        variantId: variant.id,
        sku: variant.sku,
        brandId: variant.product.brandId,
        categoryId: variant.product.categoryId,
        productNameVi: variant.product.nameVi,
        productNameEn: variant.product.nameEn,
        variantLabelVi: variant.labelVi,
        variantLabelEn: variant.labelEn,
        sellerUserId,
        listPriceVnd: price.listPriceVnd,
        promotionId: price.promotionId,
        pricedAt: now,
      },
      select: { invoiceLineId: true },
    });
    lineId = created.id;
  }
  // Every draft change re-resolves the price of all product lines (a promotion may have started or ended meanwhile).
  await repriceProductLines(tx, invoice, now, false);
  const amounts = await refreshHeader(context, invoice, now);
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_PRODUCT_LINE_ADDED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      after: {
        lineId,
        variantId: variant.id,
        sku: variant.sku,
        quantityAdded: quantity,
        quantity: finalQuantity,
        merged: same !== undefined,
        sellerUserId,
        subtotalVnd: amounts.subtotalVnd.toString(),
        discountTotalVnd: amounts.discountTotalVnd.toString(),
        totalVnd: amounts.totalVnd.toString(),
      },
    },
  );
  return load(context, invoiceId);
}

/** Changes the quantity and/or the seller of one product line of a DRAFT. */
export async function updateProductLine(
  context: AdminContext,
  invoiceId: string,
  lineId: string,
  input: InvoiceProductLineUpdateRequest,
): Promise<InvoiceResponse> {
  if (input.quantity === undefined && input.sellerUserId === undefined) {
    throw new AuthError('VALIDATION_FAILED', 'quantity');
  }
  const quantity = input.quantity === undefined ? undefined : checkQuantity(input.quantity);
  const { hint, invoice } = await lockedDraft(context, invoiceId, input.expectedVersion);
  const { tx } = context;
  const line = invoice.lines.find((candidate) => candidate.id === lineId);
  const detail = line?.productDetails[0];
  if (!line || line.kind !== 'PRODUCT' || !detail) throw new AuthError('NOT_FOUND');
  const newQuantity = quantity ?? line.quantity ?? 0;
  const newSeller = input.sellerUserId ?? detail.sellerUserId;
  if (newQuantity === line.quantity && newSeller === detail.sellerUserId) {
    return load(context, invoiceId);
  }
  if (newSeller !== detail.sellerUserId) {
    const eligible = await eligibleSellers(tx, hint.branchId, [newSeller]);
    if (!eligible.has(newSeller)) throw new AuthError('PRODUCT_SELLER_INVALID', 'sellerUserId');
  }
  const now = await databaseClock(tx);
  if (newQuantity !== line.quantity) {
    await tx.invoiceLine.update({
      where: { id: line.id },
      data: {
        quantity: newQuantity,
        grossVnd: grossOf(newQuantity, line.unitPriceVnd),
        rowVersion: { increment: 1 },
      },
      select: { id: true },
    });
  }
  if (newSeller !== detail.sellerUserId) {
    await tx.invoiceLineProduct.update({
      where: { invoiceLineId: line.id },
      data: { sellerUserId: newSeller },
      select: { invoiceLineId: true },
    });
  }
  await repriceProductLines(tx, invoice, now, false);
  const amounts = await refreshHeader(context, invoice, now);
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_PRODUCT_LINE_UPDATED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: { lineId, quantity: line.quantity, sellerUserId: detail.sellerUserId },
      after: {
        lineId,
        quantity: newQuantity,
        sellerUserId: newSeller,
        subtotalVnd: amounts.subtotalVnd.toString(),
        totalVnd: amounts.totalVnd.toString(),
      },
    },
  );
  return load(context, invoiceId);
}

/**
 * Removes a product line of a DRAFT. A draft is a working copy: the line and its detail are deleted (the database allows this for
 * PRODUCT lines of a draft only) and the audit log keeps what was removed.
 */
export async function removeProductLine(
  context: AdminContext,
  invoiceId: string,
  lineId: string,
  input: InvoiceProductLineRemoveRequest,
): Promise<InvoiceResponse> {
  const { hint, invoice } = await lockedDraft(context, invoiceId, input.expectedVersion);
  const { tx } = context;
  const line = invoice.lines.find((candidate) => candidate.id === lineId);
  const detail = line?.productDetails[0];
  if (!line || line.kind !== 'PRODUCT' || !detail) throw new AuthError('NOT_FOUND');
  const now = await databaseClock(tx);
  await tx.invoiceLineProduct.delete({
    where: { invoiceLineId: line.id },
    select: { invoiceLineId: true },
  });
  await tx.invoiceLine.delete({ where: { id: line.id }, select: { id: true } });
  await repriceProductLines(tx, invoice, now, false);
  const amounts = await refreshHeader(context, invoice, now);
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_PRODUCT_LINE_REMOVED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: {
        lineId,
        variantId: detail.variantId,
        sku: detail.sku,
        quantity: line.quantity,
        unitPriceVnd: line.unitPriceVnd === null ? null : line.unitPriceVnd.toString(),
        sellerUserId: detail.sellerUserId,
      },
      after: {
        subtotalVnd: amounts.subtotalVnd.toString(),
        totalVnd: amounts.totalVnd.toString(),
      },
    },
  );
  return load(context, invoiceId);
}
