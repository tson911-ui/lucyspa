import {
  PAY_REASON_MAX,
  type InvoiceEarningLine,
  type InvoiceEarningsResponse,
  type PayEarningItem,
  type SellerCorrectionRequest,
} from '@lucy-spa/contracts';
import { reconcileInvoiceEarnings } from '@lucy-spa/server';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { exactKeys, reason, uuid } from '../finance/finance.input.js';
import { officialEmployees } from './pay-rules.core.js';
import { holdsPayrollShopWide, shopToday } from './pay.access.js';

/**
 * Phase 7 P7-9 (design 5.3, closes OQ-P6-25): reading the earnings of one invoice and correcting who sold a product line after
 * finalization. Both need a payroll permission (`MANAGE_PAYROLL` to correct; `MANAGE_PAYROLL` or `APPROVE_PAYROLL` to read, both GLOBAL).
 * The correction never rewrites the invoice line: it records an audited override, and the engine then reverses the old seller's earning
 * and earns for the new one (both unclaimed rows, so a closed payroll period is untouched and the change reaches the next draft).
 */
type Tx = Prisma.TransactionClient;
const day = (value: Date): string => value.toISOString().slice(0, 10);
const GLOBAL = { kind: 'GLOBAL' } as const;

function requireRead(context: AdminContext): void {
  if (!holdsPayrollShopWide(context)) throw new AuthError('FORBIDDEN');
}

async function nameOf(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true },
  });
  return user ? { id: user.id, name: user.fullName } : null;
}

export async function invoiceEarnings(
  context: AdminContext,
  invoiceIdRaw: string,
): Promise<InvoiceEarningsResponse> {
  const { tx } = context;
  requireRead(context);
  const invoiceId = uuid(invoiceIdRaw, 'id');
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      code: true,
      status: true,
      orderReferral: { select: { employeeUserId: true } },
      lines: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          kind: true,
          nameVi: true,
          serviceDetails: { select: { employeeUserId: true } },
          productDetails: { select: { sellerUserId: true } },
          paySellerOverrides: {
            orderBy: { seq: 'desc' },
            take: 1,
            select: { employeeUserId: true },
          },
        },
      },
    },
  });
  if (!invoice) throw new AuthError('NOT_FOUND');
  const earnings = await tx.payEarning.findMany({
    where: { invoiceId },
    orderBy: { seq: 'asc' },
    select: {
      id: true,
      kind: true,
      employeeUserId: true,
      amountVnd: true,
      businessDate: true,
      baseVnd: true,
      quantity: true,
      reason: true,
      reversesId: true,
      runId: true,
      invoiceLineId: true,
      createdAt: true,
      employee: { select: { user: { select: { fullName: true } } } },
    },
  });
  const people = new Set<string>();
  const referral = invoice.orderReferral?.employeeUserId ?? null;
  if (referral) people.add(referral);
  for (const line of invoice.lines) {
    const service = line.serviceDetails[0]?.employeeUserId;
    const seller = line.productDetails[0]?.sellerUserId;
    const override = line.paySellerOverrides[0]?.employeeUserId;
    for (const id of [service, seller, override]) if (id) people.add(id);
  }
  const names = new Map<string, { id: string; name: string }>();
  for (const id of people) {
    const found = await nameOf(tx, id);
    if (found) names.set(id, found);
  }
  const lines: InvoiceEarningLine[] = invoice.lines.map((line) => {
    const override = line.paySellerOverrides[0]?.employeeUserId ?? null;
    const seller = line.productDetails[0]?.sellerUserId ?? null;
    const service = line.serviceDetails[0]?.employeeUserId ?? null;
    // An online line has no seller; the staff code on the order names who earns (P7-T16).
    const person = override ?? seller ?? service ?? (line.kind === 'PRODUCT' ? referral : null);
    return {
      lineId: line.id,
      kind: line.kind,
      name: line.nameVi,
      person: person ? (names.get(person) ?? null) : null,
      originalSeller:
        override && seller && override !== seller ? (names.get(seller) ?? null) : null,
    };
  });
  const items: PayEarningItem[] = earnings.map((row) => ({
    id: row.id,
    kind: row.kind,
    employee: { id: row.employeeUserId, name: row.employee.user.fullName },
    amountVnd: row.amountVnd.toString(),
    businessDate: day(row.businessDate),
    baseVnd: row.baseVnd?.toString() ?? null,
    quantity: row.quantity,
    reason: row.reason,
    reversesId: row.reversesId,
    claimed: row.runId !== null,
    invoiceLineId: row.invoiceLineId,
    createdAt: row.createdAt.toISOString(),
  }));
  return {
    invoiceId: invoice.id,
    invoiceCode: invoice.code,
    status: invoice.status,
    lines,
    items,
    canCorrectSeller: decide(context.actor.graph, 'MANAGE_PAYROLL', GLOBAL),
  };
}

const SELLER_KEYS = ['employeeUserId', 'reason'] as const;

export async function correctSeller(
  context: AdminContext,
  lineIdRaw: string,
  request: SellerCorrectionRequest,
): Promise<InvoiceEarningsResponse> {
  const { tx } = context;
  if (!decide(context.actor.graph, 'MANAGE_PAYROLL', GLOBAL)) throw new AuthError('FORBIDDEN');
  const lineId = uuid(lineIdRaw, 'id');
  const body = exactKeys(request, SELLER_KEYS, 'body');
  const employeeUserId = uuid(body['employeeUserId'], 'employeeUserId');
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX)!;
  const line = await tx.invoiceLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      invoiceId: true,
      kind: true,
      productDetails: { select: { sellerUserId: true } },
      invoice: { select: { status: true } },
    },
  });
  if (!line || line.kind !== 'PRODUCT') throw new AuthError('NOT_FOUND');
  if (line.invoice.status === 'DRAFT') throw new AuthError('CONFLICT');
  const official = await officialEmployees(tx, shopToday(context.now));
  if (!official.some((person) => person.id === employeeUserId)) {
    throw new AuthError('VALIDATION_FAILED', 'employeeUserId');
  }
  const latest = await tx.paySellerOverride.findFirst({
    where: { invoiceLineId: lineId },
    orderBy: { seq: 'desc' },
    select: { employeeUserId: true },
  });
  const current = latest?.employeeUserId ?? line.productDetails[0]?.sellerUserId ?? null;
  if (current === employeeUserId) throw new AuthError('CONFLICT');
  await tx.paySellerOverride.create({
    data: { invoiceLineId: lineId, employeeUserId, reason: why, actorUserId: context.actor.userId },
    select: { id: true },
  });
  const result = await reconcileInvoiceEarnings(tx, line.invoiceId);
  await appendAdminAudit(context, {
    action: 'PRODUCT_SELLER_CORRECTED',
    entityType: 'InvoiceLine',
    entityId: lineId,
    subjectUserId: employeeUserId,
    reason: why,
    classification: 'EMPLOYEE_PAY',
    before: { sellerUserId: current },
    after: { sellerUserId: employeeUserId, earningRowsWritten: result.written },
  });
  return invoiceEarnings(context, line.invoiceId);
}
