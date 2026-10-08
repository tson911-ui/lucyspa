import type {
  CustomerInvoiceDetail,
  CustomerInvoiceListResponse,
  CustomerInvoiceSummary,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { balanceOf, effectivePaid } from './invoice.core.js';

/**
 * Phase 4 Step 9 — the customer's own invoice history (design contract section 10). The session's customer is the
 * only identity: every query is filtered by `payer_user_id = <session customer>`, so a foreign, guest-payer, draft
 * or missing invoice is the same `NOT_FOUND`. Only a finalized document is visible (`finalized_at` is set for every
 * invoice except a DRAFT and a draft that was cancelled, a database invariant). Reads only: nothing is written.
 *
 * The selects list exactly what the customer view needs; staff identities, cancel reasons, price ranges, anomalies,
 * management notes, provider references, the discount candidate list and pending/failed payment requests are never
 * loaded.
 */

export const CUSTOMER_INVOICE_PAGE_SIZE = 20;

const day = (value: Date) => value.toISOString().slice(0, 10);

const summarySelect = {
  id: true,
  code: true,
  kind: true,
  status: true,
  businessDate: true,
  totalVnd: true,
  finalizedAt: true,
  paidAt: true,
  cancelledAt: true,
  branch: { select: { id: true, name: true, timezone: true } },
  payments: {
    where: { status: 'SUCCEEDED' },
    select: { amountVnd: true, status: true, correction: { select: { id: true } } },
  },
} satisfies Prisma.InvoiceSelect;

const detailSelect = {
  ...summarySelect,
  subtotalVnd: true,
  discountTotalVnd: true,
  visit: { select: { serviceDate: true } },
  payments: {
    where: { status: 'SUCCEEDED' },
    orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      method: true,
      status: true,
      amountVnd: true,
      collectedAt: true,
      correction: { select: { id: true } },
    },
  },
  // Phase 6 P6-14: the invoice of an exchange has no program, only the credit of what was paid for the returned goods.
  exchangeFor: { select: { appliedCreditVnd: true } },
  discountApplication: {
    select: {
      computedAmountVnd: true,
      version: { select: { discount: { select: { nameVi: true, nameEn: true } } } },
      voucher: { select: { code: true } },
    },
  },
  // Phase 6 P6-9: the Beauty side's program (a version 3 invoice); the customer's product view itself is P6-10 (T26).
  beautyApplication: {
    select: {
      computedAmountVnd: true,
      version: { select: { discount: { select: { nameVi: true, nameEn: true } } } },
      voucher: { select: { code: true } },
    },
  },
  lines: {
    orderBy: { sequence: 'asc' },
    select: {
      sequence: true,
      nameVi: true,
      nameEn: true,
      quantity: true,
      unitPriceVnd: true,
      grossVnd: true,
      comboDetails: { select: { invoiceLineId: true } },
      // Phase 6 P6-10 (T26): only the fact that the line is a product; the seller, SKU, cost, lots and every internal id are never selected.
      productDetails: { select: { invoiceLineId: true } },
      serviceDetails: {
        select: {
          pricingUnit: true,
          participant: { select: { customerUserId: true, displayName: true } },
        },
      },
    },
  },
} satisfies Prisma.InvoiceSelect;

type SummaryRow = Prisma.InvoiceGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.InvoiceGetPayload<{ select: typeof detailSelect }>;

/** Only the customer's own finalized invoices; the caller adds nothing that comes from the browser. */
function visible(customerUserId: string): Prisma.InvoiceWhereInput {
  return { payerUserId: customerUserId, finalizedAt: { not: null } };
}

function summary(row: SummaryRow): CustomerInvoiceSummary {
  if (row.status === 'DRAFT' || row.finalizedAt === null) {
    // Unreachable through `visible`; a defensive stop rather than exposing a draft.
    throw new AuthError('NOT_FOUND');
  }
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    status: row.status,
    branch: row.branch,
    businessDate: day(row.businessDate),
    finalizedAt: row.finalizedAt.toISOString(),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    totalVnd: row.totalVnd.toString(),
    paidVnd: effectivePaid(row).toString(),
    balanceVnd: balanceOf(row).toString(),
  };
}

function detail(row: DetailRow, customerUserId: string): CustomerInvoiceDetail {
  const application = row.discountApplication ?? row.beautyApplication;
  return {
    ...summary(row),
    // A combo sale has no visit: its date is the business date of the sale.
    visitDate: day(row.visit ? row.visit.serviceDate : row.businessDate),
    subtotalVnd: row.subtotalVnd.toString(),
    discountTotalVnd: row.discountTotalVnd.toString(),
    discount: application
      ? {
          nameVi: application.version.discount.nameVi,
          nameEn: application.version.discount.nameEn,
          voucherCode: application.voucher?.code ?? null,
          amountVnd: application.computedAmountVnd.toString(),
        }
      : row.exchangeFor
        ? {
            nameVi: 'đã trả cho hàng cũ, đổi hàng',
            nameEn: 'paid for the old goods, exchange',
            voucherCode: null,
            amountVnd: row.exchangeFor.appliedCreditVnd.toString(),
          }
        : null,
    // Phase 6 P6-10 (T26): which lines are products, only for an invoice that has any (the shape of every other invoice is unchanged).
    ...(row.lines.some((line) => line.productDetails.length > 0)
      ? {
          productSequences: row.lines
            .filter((line) => line.productDetails.length > 0)
            .map((line) => line.sequence),
        }
      : {}),
    lines: row.lines.map((line) => {
      const service = line.serviceDetails[0];
      if (line.quantity === null || line.unitPriceVnd === null || line.grossVnd === null) {
        // A finalized invoice has every line priced (database invariant).
        throw new Error('A finalized invoice line is complete.');
      }
      const product = line.productDetails[0];
      if (!service && product) {
        // A product the payer bought (T26): always for the signed-in member (only the payer sees this invoice). The name already
        // carries the variant label (the catalog copy taken at finalization); nothing of the seller, SKU, cost, lots or stock.
        return {
          sequence: line.sequence,
          nameVi: line.nameVi,
          nameEn: line.nameEn,
          quantity: line.quantity,
          unitPriceVnd: line.unitPriceVnd.toString(),
          grossVnd: line.grossVnd.toString(),
          pricingUnit: 'PER_SERVICE' as const,
          forSelf: true,
          recipientName: null,
        };
      }
      if (!service && line.comboDetails.length > 0) {
        // The combo the payer bought: always for the signed-in member; no seller, cost or SKU.
        return {
          sequence: line.sequence,
          nameVi: line.nameVi,
          nameEn: line.nameEn,
          quantity: line.quantity,
          unitPriceVnd: line.unitPriceVnd.toString(),
          grossVnd: line.grossVnd.toString(),
          pricingUnit: 'PER_SERVICE' as const,
          forSelf: true,
          recipientName: null,
        };
      }
      if (!service) {
        // A finalized invoice line has a service or a combo detail (database invariants).
        throw new Error('A finalized invoice line is complete.');
      }
      const forSelf = service.participant.customerUserId === customerUserId;
      return {
        sequence: line.sequence,
        nameVi: line.nameVi,
        nameEn: line.nameEn,
        quantity: line.quantity,
        unitPriceVnd: line.unitPriceVnd.toString(),
        grossVnd: line.grossVnd.toString(),
        pricingUnit: service.pricingUnit,
        forSelf,
        // Free-text name only; another member's account name is never read.
        recipientName: forSelf ? null : service.participant.displayName,
      };
    }),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amountVnd: payment.amountVnd.toString(),
      paidAt: payment.collectedAt.toISOString(),
      reversed: payment.correction !== null,
    })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Newest first (finalization time, then id); `cursor` is the id of the last invoice of the previous page. */
export async function customerInvoiceList(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  cursor: string | undefined,
  pageSize = CUSTOMER_INVOICE_PAGE_SIZE,
): Promise<CustomerInvoiceListResponse> {
  let after: Prisma.InvoiceWhereInput = {};
  if (cursor !== undefined) {
    const anchor = UUID.test(cursor)
      ? await tx.invoice.findFirst({
          where: { id: cursor.toLowerCase(), ...visible(customerUserId) },
          select: { id: true, finalizedAt: true },
        })
      : null;
    if (!anchor?.finalizedAt) throw new AuthError('VALIDATION_FAILED', 'cursor');
    after = {
      OR: [
        { finalizedAt: { lt: anchor.finalizedAt } },
        { finalizedAt: anchor.finalizedAt, id: { lt: anchor.id } },
      ],
    };
  }
  const rows = await tx.invoice.findMany({
    where: { AND: [visible(customerUserId), after] },
    orderBy: [{ finalizedAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
    select: summarySelect,
  });
  const page = rows.slice(0, pageSize);
  return {
    invoices: page.map(summary),
    nextCursor: rows.length > page.length ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function customerInvoiceDetail(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  invoiceId: string,
): Promise<CustomerInvoiceDetail> {
  const row = await tx.invoice.findFirst({
    where: { id: invoiceId, ...visible(customerUserId) },
    select: detailSelect,
  });
  if (!row) throw new AuthError('NOT_FOUND');
  return detail(row, customerUserId);
}
