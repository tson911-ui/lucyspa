import type {
  ComboSaleOptionsResponse,
  ComboSaleRequest,
  InvoiceOpenedResponse,
} from '@lucy-spa/contracts';
import { generateInvoiceCode } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { CALCULATION_VERSION } from './invoice.calc.js';
import { load } from './invoice.core.js';

/**
 * Phase 5 P5-7: the combo sale at the POS counter (design 9.2; P5-Q8: counter only, members only; OQ-1: an invoice that is not
 * tied to a Visit). A sale is a DRAFT invoice of kind `COMBO_SALE` with ONE combo line; from there it follows the normal invoice
 * flow unchanged (vouchers, finalization with the best offer, cash / PayOS payment, cancellation). The combo is issued to the
 * buyer only when the invoice is PAID (the `loyalty` worker, design 12.1). Selling needs `MANAGE_INVOICES` and `SELL_COMBOS` at
 * the branch, and loyalty must be live (P5-T2; Owner answer of 2026-10-05).
 */

const day = (value: Date) => value.toISOString().slice(0, 10);

function assertCan(context: AdminContext, permission: string, branchId: string): void {
  if (!decide(context.actor.graph, permission, { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
}

/** The combos whose current version is active, for the counter's sale picker (`SELL_COMBOS` at the branch). */
export async function comboSaleOptions(
  context: AdminContext,
  branchId: string,
): Promise<ComboSaleOptionsResponse> {
  const { tx } = context;
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw new AuthError('NOT_FOUND');
  assertCan(context, 'SELL_COMBOS', branchId);
  const combos = await tx.combo.findMany({
    where: { service: { isActive: true } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      code: true,
      service: { select: { id: true, nameVi: true, nameEn: true } },
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
  });
  return {
    sellable: (await tx.loyaltyGoLive.count()) > 0,
    options: combos.flatMap((combo) => {
      const version = combo.versions[0];
      if (!version?.active) return [];
      return [
        {
          comboId: combo.id,
          versionId: version.id,
          code: combo.code,
          nameVi: version.nameVi,
          nameEn: version.nameEn,
          service: combo.service,
          paidSessions: version.paidSessions,
          bonusSessions: version.bonusSessions,
          totalSessions: version.paidSessions + version.bonusSessions,
          priceVnd: version.priceVnd.toString(),
        },
      ];
    }),
  };
}

/**
 * Creates the DRAFT invoice of a combo sale for an identified member (the buyer, who becomes the owner of the combo when the
 * invoice is paid). The line is an exact copy of the combo's CURRENT active version, priced exactly at the combo price,
 * quantity 1; the database guards re-verify every rule. Refused while loyalty is not live, for a combo that is not on sale, and
 * for anyone who is not an active member.
 */
export async function openComboSale(
  context: AdminContext,
  branchId: string,
  input: ComboSaleRequest,
): Promise<InvoiceOpenedResponse> {
  const { tx } = context;
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw new AuthError('NOT_FOUND');
  assertCan(context, 'MANAGE_INVOICES', branchId);
  assertCan(context, 'SELL_COMBOS', branchId);
  if ((await tx.loyaltyGoLive.count()) === 0) throw new AuthError('LOYALTY_NOT_LIVE');
  const payer = await tx.user.findFirst({
    where: { id: input.payerUserId, kind: 'CUSTOMER', status: 'ACTIVE' },
    select: { id: true },
  });
  if (!payer) throw new AuthError('VALIDATION_FAILED', 'payerUserId');

  // Lock order (design 12.2): a combo row is taken after the invoice rows; here the invoice does not exist yet, so the share lock
  // only serializes this sale against an Owner save of a new version of the same combo.
  const existing = await tx.combo.findUnique({
    where: { id: input.comboId },
    select: { id: true },
  });
  if (!existing) throw new AuthError('COMBO_NOT_SELLABLE');
  await tx.$queryRaw`SELECT id FROM combos WHERE id = ${input.comboId}::uuid FOR SHARE`;
  const combo = await tx.combo.findUniqueOrThrow({
    where: { id: input.comboId },
    select: {
      id: true,
      code: true,
      service: { select: { id: true, categoryId: true, isActive: true } },
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
  });
  const version = combo.versions[0];
  if (!version || !version.active || !combo.service.isActive) {
    throw new AuthError('COMBO_NOT_SELLABLE');
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

  const price = version.priceVnd;
  const invoice = await tx.invoice.create({
    data: {
      code,
      kind: 'COMBO_SALE',
      branchId,
      payerUserId: payer.id,
      businessDate: clock.day,
      calculationVersion: CALCULATION_VERSION,
      subtotalVnd: price,
      discountTotalVnd: 0n,
      totalVnd: price,
      createdByUserId: context.actor.userId,
      createdAt: clock.created,
    },
    select: { id: true },
  });
  const line = await tx.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      sequence: 1,
      kind: 'COMBO_PURCHASE',
      itemCode: combo.code,
      nameVi: version.nameVi,
      nameEn: version.nameEn,
      quantity: 1,
      unitPriceVnd: price,
      grossVnd: price,
    },
    select: { id: true },
  });
  await tx.invoiceLineCombo.create({
    data: {
      invoiceLineId: line.id,
      invoiceId: invoice.id,
      comboId: combo.id,
      versionId: version.id,
      serviceId: combo.service.id,
      serviceCategoryId: combo.service.categoryId,
      nameVi: version.nameVi,
      nameEn: version.nameEn,
      paidSessions: version.paidSessions,
      bonusSessions: version.bonusSessions,
      priceVnd: price,
      expiryMode: version.expiryMode,
      expiryDays: version.expiryDays,
    },
    select: { invoiceLineId: true },
  });
  await appendAdminAudit(context, {
    action: 'INVOICE_CREATED',
    entityType: 'Invoice',
    entityId: invoice.id,
    subjectUserId: payer.id,
    branchId,
    classification: 'FINANCIAL',
    after: {
      code,
      kind: 'COMBO_SALE',
      payerUserId: payer.id,
      comboId: combo.id,
      comboVersionId: version.id,
      comboVersionNo: version.version,
      priceVnd: price.toString(),
      calculationVersion: CALCULATION_VERSION,
    },
  });
  return { invoice: await load(context, invoice.id), created: true };
}
