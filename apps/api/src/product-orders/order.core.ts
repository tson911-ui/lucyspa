import type {
  PreOrderContactRequest,
  ProductOrderLineResponse,
  ProductOrderResponse,
} from '@lucy-spa/contracts';
import { productOrderStatus } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { IdentityValidationError, normalizePhone } from '../auth/identity.js';
import { maskPhone } from '../operations/operations.state.js';

/**
 * Phase 6 P6-15/P6-16 (design 18.3, 18.4; T28-T32; OQ-29, OQ-34): the goods record of a counter pre-order.
 *
 * The invoice stays the money record. When an invoice with at least one PRE_ORDER product line is finalized, the same transaction
 * writes one order (the contact phone is mandatory) and one order line per such line, all AWAITING_PAYMENT. The database moves them
 * with the invoice (PAID when it is paid, back when a payment is reversed before anything was ordered, CANCELLED with an unpaid
 * invoice) and keeps every other rule (SQL guards of migration 20261116000001); this file only decides what the API accepts.
 */

/** The order code the customer and the staff quote: `DT` + six digits (the exchange sequence already uses `DH`). */
export const PRODUCT_ORDER_CODE = /^DT[0-9]{6,}$/;

/** What the invoice presenter and the order screens select, in one place. */
export const productOrderSelect = {
  id: true,
  code: true,
  invoiceId: true,
  branchId: true,
  contactPhone: true,
  contactName: true,
  createdAt: true,
  invoice: { select: { code: true } },
  customer: { select: { id: true, fullName: true } },
  tickets: { where: { revokedAt: null }, select: { id: true } },
  lines: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      invoiceLineId: true,
      variantId: true,
      quantity: true,
      status: true,
      paidAt: true,
      expectedFrom: true,
      expectedTo: true,
      orderedAt: true,
      arrivedAt: true,
      handedOverAt: true,
      handedOverTo: true,
      handedOverToName: true,
      completedAt: true,
      cancelledAt: true,
      cancelCause: true,
      rowVersion: true,
      line: {
        select: {
          nameVi: true,
          nameEn: true,
          productRefunds: { select: { id: true }, take: 1 },
        },
      },
      productLine: { select: { sku: true, variantLabelVi: true, variantLabelEn: true } },
    },
  },
} satisfies Prisma.ProductOrderSelect;

export type ProductOrderRow = Prisma.ProductOrderGetPayload<{ select: typeof productOrderSelect }>;

const day = (value: Date) => value.toISOString().slice(0, 10);
const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function presentProductOrderLine(
  row: ProductOrderRow['lines'][number],
): ProductOrderLineResponse {
  return {
    id: row.id,
    invoiceLineId: row.invoiceLineId,
    variantId: row.variantId,
    sku: row.productLine.sku,
    nameVi: row.line.nameVi,
    nameEn: row.line.nameEn,
    variantLabelVi: row.productLine.variantLabelVi,
    variantLabelEn: row.productLine.variantLabelEn,
    quantity: row.quantity,
    status: row.status,
    paidAt: iso(row.paidAt),
    expectedFrom: row.expectedFrom ? day(row.expectedFrom) : null,
    expectedTo: row.expectedTo ? day(row.expectedTo) : null,
    orderedAt: iso(row.orderedAt),
    arrivedAt: iso(row.arrivedAt),
    handedOverAt: iso(row.handedOverAt),
    handedOverTo: row.handedOverTo,
    handedOverToName: row.handedOverToName,
    completedAt: iso(row.completedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelCause: row.cancelCause,
    refunded: row.line.productRefunds.length > 0,
    rowVersion: row.rowVersion,
  };
}

/**
 * The staff view of an order. The phone number is shown in full to those who sell or work the orders (they call the customer when the
 * goods arrive, OQ-34) and masked for everyone else who can open the invoice (a reading pending the Owner, like the payer's phone).
 */
export function presentProductOrder(
  row: ProductOrderRow,
  options: { showContact: boolean } = { showContact: true },
): ProductOrderResponse {
  const lines = row.lines.map(presentProductOrderLine);
  return {
    id: row.id,
    code: row.code,
    invoiceId: row.invoiceId,
    invoiceCode: row.invoice.code,
    branchId: row.branchId,
    status: productOrderStatus(lines),
    contactPhone: options.showContact ? row.contactPhone : (maskPhone(row.contactPhone) ?? '•••'),
    contactMasked: !options.showContact,
    contactName: options.showContact ? row.contactName : null,
    customer: row.customer ? { id: row.customer.id, displayName: row.customer.fullName } : null,
    createdAt: row.createdAt.toISOString(),
    lines,
    ticketLinkActive: row.tickets.length > 0,
  };
}

/** Reads the phone and the optional name of the contact; the phone is stored in its canonical +84 form. */
export function parseContact(contact: PreOrderContactRequest | undefined): {
  phone: string;
  name: string | null;
} {
  if (!contact || typeof contact.phone !== 'string' || contact.phone.trim() === '') {
    throw new AuthError('PRE_ORDER_CONTACT_REQUIRED', 'preOrderContact.phone');
  }
  let phone: string;
  try {
    phone = normalizePhone(contact.phone.trim()).phoneCanonical;
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      throw new AuthError('VALIDATION_FAILED', 'preOrderContact.phone');
    }
    throw error;
  }
  let name: string | null = null;
  if (contact.name !== undefined && contact.name !== null) {
    if (typeof contact.name !== 'string')
      throw new AuthError('VALIDATION_FAILED', 'preOrderContact.name');
    const trimmed = contact.name.trim().replace(/\s+/g, ' ');
    if (trimmed.length > 120) throw new AuthError('VALIDATION_FAILED', 'preOrderContact.name');
    name = trimmed === '' ? null : trimmed;
  }
  return { phone, name };
}

/**
 * Called by the finalization of an invoice, while it is still a DRAFT and after its in-stock lines were reserved. With no pre-order
 * line it does nothing (and refuses a contact nobody needs). Otherwise: the contact must be valid; a variant must still be sold on
 * order; and a pre-order is for goods the stock does not already cover (T29: the cashier does not turn an available product into a
 * pre-order; the line ids that the stock covers are named in `PRODUCT_PRE_ORDER_NOT_NEEDED`).
 */
export async function createProductOrderForFinalization(
  context: AdminContext,
  invoice: { id: string; branchId: string; payerUserId: string | null },
  contact: PreOrderContactRequest | undefined,
): Promise<{ id: string; code: string } | null> {
  const { tx } = context;
  const details = await tx.invoiceLineProduct.findMany({
    where: { invoiceId: invoice.id, fulfilmentMode: 'PRE_ORDER' },
    select: {
      invoiceLineId: true,
      variantId: true,
      line: { select: { quantity: true, sequence: true } },
      variant: { select: { sellOnOrder: true } },
    },
    orderBy: { line: { sequence: 'asc' } },
  });
  if (details.length === 0) {
    if (contact !== undefined) throw new AuthError('VALIDATION_FAILED', 'preOrderContact');
    return null;
  }
  const parsed = parseContact(contact);
  const lines = details.map((detail) => {
    if (detail.line.quantity === null) throw new AuthError('INVOICE_NOT_READY');
    return { ...detail, quantity: detail.line.quantity };
  });
  if (lines.some((line) => !line.variant.sellOnOrder)) {
    throw new AuthError(
      'PRODUCT_PRE_ORDER_NOT_ALLOWED',
      lines.find((line) => !line.variant.sellOnOrder)!.invoiceLineId,
    );
  }
  // The stock a new sale can take now, after the in-stock lines of this very invoice reserved theirs.
  const wanted = new Map<string, number>();
  for (const line of lines)
    wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.quantity);
  const covered = new Set<string>();
  for (const [variantId, quantity] of wanted) {
    const [row] = await tx.$queryRaw<{ available: number }[]>`
      SELECT lucy_available_stock(${invoice.branchId}::uuid, ${variantId}::uuid) AS available`;
    if ((row?.available ?? 0) >= quantity) covered.add(variantId);
  }
  if (covered.size > 0) {
    throw new AuthError(
      'PRODUCT_PRE_ORDER_NOT_NEEDED',
      lines
        .filter((line) => covered.has(line.variantId))
        .map((line) => line.invoiceLineId)
        .join(','),
    );
  }
  const [seq] = await tx.$queryRaw<
    { n: string }[]
  >`SELECT nextval('product_order_code_seq')::text AS n`;
  if (!seq) throw new AuthError('SERVICE_UNAVAILABLE');
  const code = `DT${seq.n.padStart(6, '0')}`;
  const order = await tx.productOrder.create({
    data: {
      code,
      invoiceId: invoice.id,
      branchId: invoice.branchId,
      customerUserId: invoice.payerUserId,
      contactPhone: parsed.phone,
      contactName: parsed.name,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  for (const line of lines) {
    await tx.productOrderLine.create({
      data: {
        orderId: order.id,
        invoiceId: invoice.id,
        invoiceLineId: line.invoiceLineId,
        branchId: invoice.branchId,
        variantId: line.variantId,
        quantity: line.quantity,
      },
      select: { id: true },
    });
  }
  // The phone number is personal data: the audit record names the order and its lines, never the number.
  await appendAdminAudit(context, {
    action: 'PRODUCT_ORDER_CREATED',
    entityType: 'ProductOrder',
    entityId: order.id,
    subjectUserId: invoice.payerUserId,
    branchId: invoice.branchId,
    classification: 'FINANCIAL',
    after: {
      code,
      invoiceId: invoice.id,
      lines: lines.map((line) => ({
        invoiceLineId: line.invoiceLineId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    },
  });
  return { id: order.id, code };
}
