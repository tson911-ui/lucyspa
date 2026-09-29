import type {
  InvoiceLineResponse,
  InvoiceOpenedResponse,
  InvoicePersonSummary,
  InvoiceResponse,
  InvoiceStatusName,
  PosBoardResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, generateInvoiceCode, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { hasFreshReauthentication } from '../auth/session.policy.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { maskPhone } from '../operations/operations.state.js';
import { maskEmail } from '../walkin/walkin.core.js';
import {
  CALCULATION_VERSION,
  calculateTotals,
  checkPrice,
  checkQuantity,
  grossOf,
  initialPricing,
  parseVnd,
} from './invoice.calc.js';

/**
 * Phase 4 Step 5 — Invoice / POS ("Hóa đơn"). Commands run in the admin frame (actor and session locked,
 * authority decided at transaction time for the RECORD's own branch, never a client branch). The Step 4
 * database guards remain the backstop of every rule here; nothing weakens them.
 *
 * Lock order (extends the design's): visit (creation only) -> invoice row -> its lines/payments.
 * Every business timestamp is the database clock sampled after the locks; the client supplies none.
 */

const userSummary = {
  id: true,
  fullName: true,
  phoneCanonical: true,
  emailCanonical: true,
} satisfies Prisma.UserSelect;

const invoiceSelect = {
  id: true,
  code: true,
  status: true,
  branchId: true,
  visitId: true,
  payerUserId: true,
  businessDate: true,
  calculationVersion: true,
  subtotalVnd: true,
  discountTotalVnd: true,
  totalVnd: true,
  createdAt: true,
  finalizedAt: true,
  finalizedByUserId: true,
  paidAt: true,
  paidSeq: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancelledFromStatus: true,
  cancelReason: true,
  rowVersion: true,
  branch: { select: { id: true, name: true, timezone: true } },
  visit: {
    select: {
      id: true,
      code: true,
      serviceDate: true,
      completedAt: true,
      owner: { select: userSummary },
    },
  },
  payer: { select: userSummary },
  payments: {
    select: { id: true, amountVnd: true, status: true, correction: { select: { id: true } } },
  },
  lines: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      itemCode: true,
      nameVi: true,
      nameEn: true,
      quantity: true,
      unitPriceVnd: true,
      grossVnd: true,
      priceSetAt: true,
      serviceDetails: {
        select: {
          visitServiceLineId: true,
          pricingUnit: true,
          catalogPriceMinVnd: true,
          catalogPriceMaxVnd: true,
          quantityLimit: true,
          addedOnBehalf: true,
          participant: {
            select: {
              id: true,
              kind: true,
              displayName: true,
              customer: { select: { fullName: true } },
            },
          },
          employee: { select: { userId: true, user: { select: { fullName: true } } } },
        },
      },
    },
  },
} satisfies Prisma.InvoiceSelect;

type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

/** Authority is decided inside the transaction, for the invoice's or visit's own branch. */
function assertCan(context: AdminContext, permission: string, branchId: string): void {
  if (!decide(context.actor.graph, permission, { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
}

function person(user: Prisma.UserGetPayload<{ select: typeof userSummary }> | null) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.fullName,
    phoneMasked: maskPhone(user.phoneCanonical),
    emailMasked: maskEmail(user.emailCanonical),
  } satisfies InvoicePersonSummary;
}

const day = (value: Date) => value.toISOString().slice(0, 10);

function effectivePaid(row: InvoiceRow): bigint {
  return row.payments
    .filter((payment) => payment.status === 'SUCCEEDED' && payment.correction === null)
    .reduce((sum, payment) => sum + payment.amountVnd, 0n);
}

/** Only a zero-balance PAID invoice with no payment row at all can be cancelled from PAID (OP-7). */
function zeroBalanceCancellable(row: InvoiceRow): boolean {
  return (
    row.status === 'PAID' && row.totalVnd === 0n && row.paidSeq === 1 && row.payments.length === 0
  );
}

function present(context: AdminContext, row: InvoiceRow): InvoiceResponse {
  const manage = decide(context.actor.graph, 'MANAGE_INVOICES', {
    kind: 'BRANCH',
    branchId: row.branchId,
  });
  const cancelPermitted = decide(context.actor.graph, 'CANCEL_INVOICES', {
    kind: 'BRANCH',
    branchId: row.branchId,
  });
  const lines = row.lines.map((line): InvoiceLineResponse => {
    const detail = line.serviceDetails[0];
    if (!detail) throw new Error('Every invoice line has its service detail.');
    const ranged = detail.catalogPriceMinVnd !== detail.catalogPriceMaxVnd;
    return {
      id: line.id,
      sequence: line.sequence,
      visitServiceLineId: detail.visitServiceLineId,
      participant: {
        id: detail.participant.id,
        kind: detail.participant.kind,
        displayName: detail.participant.customer?.fullName ?? detail.participant.displayName,
      },
      employee: { id: detail.employee.userId, displayName: detail.employee.user.fullName },
      itemCode: line.itemCode,
      nameVi: line.nameVi,
      nameEn: line.nameEn,
      pricingUnit: detail.pricingUnit,
      priceMinVnd: detail.catalogPriceMinVnd.toString(),
      priceMaxVnd: detail.catalogPriceMaxVnd.toString(),
      quantityLimit: detail.quantityLimit,
      quantity: line.quantity,
      unitPriceVnd: line.unitPriceVnd === null ? null : line.unitPriceVnd.toString(),
      grossVnd: line.grossVnd === null ? null : line.grossVnd.toString(),
      priceSetAt: line.priceSetAt ? line.priceSetAt.toISOString() : null,
      addedOnBehalf: detail.addedOnBehalf,
      priceEditable: ranged || detail.quantityLimit > 1,
    };
  });
  const unpricedLines = lines.filter((line) => line.grossVnd === null).length;
  const draft = row.status === 'DRAFT';
  const cancellable =
    draft ||
    (row.status === 'PENDING_PAYMENT' && effectivePaid(row) === 0n) ||
    zeroBalanceCancellable(row);
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    branch: row.branch,
    visit: {
      id: row.visit.id,
      code: row.visit.code,
      serviceDate: day(row.visit.serviceDate),
      completedAt: row.visit.completedAt ? row.visit.completedAt.toISOString() : null,
    },
    payer: person(row.payer),
    defaultPayer: person(row.visit.owner),
    businessDate: day(row.businessDate),
    calculationVersion: row.calculationVersion,
    subtotalVnd: row.subtotalVnd.toString(),
    discountTotalVnd: row.discountTotalVnd.toString(),
    totalVnd: row.totalVnd.toString(),
    createdAt: row.createdAt.toISOString(),
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paidSeq: row.paidSeq,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledFromStatus: row.cancelledFromStatus,
    cancelReason: row.cancelReason,
    version: row.rowVersion,
    lines,
    readiness: { ready: unpricedLines === 0 && lines.length > 0, unpricedLines },
    actions: {
      editPrices: manage && draft,
      setPayer: manage && draft,
      finalize: manage && draft && unpricedLines === 0 && lines.length > 0,
      cancel: cancelPermitted && cancellable,
      cancelNeedsReauth: !draft,
    },
  };
}

async function load(context: AdminContext, invoiceId: string): Promise<InvoiceResponse> {
  const row = await context.tx.invoice.findUnique({
    where: { id: invoiceId },
    select: invoiceSelect,
  });
  if (!row) throw new AuthError('NOT_FOUND');
  return present(context, row);
}

async function lockInvoice(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
}

async function databaseClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  return clock.now;
}

/** Locks the invoice, re-reads it under the lock and checks the caller's version. */
async function lockedInvoice(
  context: AdminContext,
  invoiceId: string,
  permission: string,
): Promise<{ hint: { id: string; branchId: string }; row: () => Promise<InvoiceRow> }> {
  const { tx } = context;
  const hint = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, branchId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  assertCan(context, permission, hint.branchId);
  await lockInvoice(tx, invoiceId);
  return {
    hint,
    row: () => tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: invoiceSelect }),
  };
}

const eventBase = (row: { id: string; branchId: string; visitId: string }) => ({
  invoiceId: row.id,
  branchId: row.branchId,
  visitId: row.visitId,
});

// ------------------------------------------------------------------------------------- reading

/** GET invoice (VIEW_INVOICES at the invoice's branch). */
export async function getInvoice(
  context: AdminContext,
  invoiceId: string,
): Promise<InvoiceResponse> {
  const hint = await context.tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { branchId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  assertCan(context, 'VIEW_INVOICES', hint.branchId);
  return load(context, invoiceId);
}

const WINDOW_DAYS = 6;

function shiftDay(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * POS board (VIEW_INVOICES at the branch): completed visits still without an active invoice and the
 * invoices of a trailing 7-day window ending at the branch-local `date`. Older unbilled visits (for
 * example those completed before Phase 4) are not listed; nothing is created for them.
 */
export async function posBoard(
  context: AdminContext,
  branchId: string,
  date: string | null,
): Promise<PosBoardResponse> {
  const { tx } = context;
  const branch = await tx.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, timezone: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  assertCan(context, 'VIEW_INVOICES', branchId);
  const [today] = await tx.$queryRaw<
    { day: Date }[]
  >`SELECT lucy_branch_local_date(${branchId}::uuid, now()) AS day`;
  const end = date ?? day(today!.day);
  const start = shiftDay(end, -WINDOW_DAYS);
  const visits = await tx.visit.findMany({
    where: {
      branchId,
      status: 'COMPLETED',
      serviceDate: { gte: new Date(start), lte: new Date(end) },
      invoices: { none: { status: { not: 'CANCELLED' } } },
    },
    orderBy: [{ completedAt: 'desc' }, { id: 'asc' }],
    take: 100,
    select: {
      id: true,
      code: true,
      serviceDate: true,
      completedAt: true,
      participants: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { displayName: true, customer: { select: { fullName: true } } },
      },
      lines: { where: { status: 'DONE' }, select: { id: true } },
    },
  });
  const invoices = await tx.invoice.findMany({
    where: { branchId, businessDate: { gte: new Date(start), lte: new Date(end) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 200,
    select: {
      id: true,
      code: true,
      status: true,
      totalVnd: true,
      businessDate: true,
      createdAt: true,
      visit: { select: { id: true, code: true } },
      payer: { select: { fullName: true } },
    },
  });
  return {
    branch,
    date: end,
    windowStart: start,
    awaiting: visits.map((visit) => ({
      visitId: visit.id,
      visitCode: visit.code,
      serviceDate: day(visit.serviceDate),
      completedAt: visit.completedAt ? visit.completedAt.toISOString() : null,
      participants: visit.participants.map(
        (participant) => participant.customer?.fullName ?? participant.displayName ?? '',
      ),
      performedServices: visit.lines.length,
    })),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      code: invoice.code,
      status: invoice.status as InvoiceStatusName,
      visitId: invoice.visit.id,
      visitCode: invoice.visit.code,
      payerName: invoice.payer ? invoice.payer.fullName : null,
      totalVnd: invoice.totalVnd.toString(),
      businessDate: day(invoice.businessDate),
      createdAt: invoice.createdAt.toISOString(),
    })),
    canManage: decide(context.actor.graph, 'MANAGE_INVOICES', { kind: 'BRANCH', branchId }),
  };
}

// ----------------------------------------------------------------------------------- creation

/**
 * Opens the ACTIVE invoice of a COMPLETED visit, creating a DRAFT when there is none (lazy and
 * idempotent: "one Visit -> one active Invoice"). Never inside the END transaction; the visit is never
 * mutated or reopened.
 *
 * - Authority: `MANAGE_INVOICES` at the visit's own branch.
 * - Serialization: the visit row is locked `FOR UPDATE` (a completed visit has no other writer, so
 *   this only serializes concurrent creations: the second waits, then finds the first's invoice and
 *   returns it). The Step 4 partial unique index is the backstop.
 * - Content: exactly the visit's DONE service lines (cancelled lines never), each an invoice line plus
 *   the exact snapshot detail (historical price range, quantity limit, unit, KTV, participant). A
 *   PER_SERVICE quantity is 1 and an exact price is set now; variable prices and PER_NAIL quantities
 *   stay unset until an authorized actor selects them.
 * - Payer: the visit's booking owner when there is one, otherwise a guest payer (NULL).
 */
export async function openInvoice(
  context: AdminContext,
  visitId: string,
): Promise<InvoiceOpenedResponse> {
  const { tx } = context;
  const hint = await tx.visit.findUnique({
    where: { id: visitId },
    select: { id: true, branchId: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  assertCan(context, 'MANAGE_INVOICES', hint.branchId);
  await tx.$queryRaw`SELECT id FROM visits WHERE id = ${visitId}::uuid FOR UPDATE`;
  const visit = await tx.visit.findUniqueOrThrow({
    where: { id: visitId },
    select: {
      id: true,
      code: true,
      branchId: true,
      status: true,
      ownerUserId: true,
      owner: { select: { kind: true } },
    },
  });
  const existing = await tx.invoice.findFirst({
    where: { visitId, status: { not: 'CANCELLED' } },
    select: { id: true },
  });
  if (existing) return { invoice: await load(context, existing.id), created: false };
  if (visit.status !== 'COMPLETED') throw new AuthError('INVOICE_VISIT_NOT_COMPLETED');

  const performed = await tx.visitServiceLine.findMany({
    where: { visitId, status: 'DONE' },
    select: {
      id: true,
      sequence: true,
      serviceId: true,
      participantId: true,
      employeeUserId: true,
      serviceCode: true,
      serviceNameVi: true,
      serviceNameEn: true,
      catalogPriceMinVnd: true,
      catalogPriceMaxVnd: true,
      catalogPricingUnit: true,
      maxQuantitySnapshot: true,
      addedOnBehalf: true,
      participant: { select: { createdAt: true } },
    },
  });
  if (performed.length === 0) throw new AuthError('INVOICE_VISIT_NOT_COMPLETED');
  performed.sort(
    (a, b) =>
      a.participant.createdAt.getTime() - b.participant.createdAt.getTime() ||
      (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0) ||
      a.sequence - b.sequence,
  );
  const drafts = performed.map((line) => ({
    line,
    ...initialPricing(line.catalogPricingUnit, line.catalogPriceMinVnd, line.catalogPriceMaxVnd),
  }));
  const totals = calculateTotals(drafts);

  // The business date and the creation instant come from the database clock so that the Step 4
  // guard (branch-local date of created_at) and the code date agree.
  const [clock] = await tx.$queryRaw<{ created: Date; day: Date }[]>`
    SELECT now() AS created, lucy_branch_local_date(${visit.branchId}::uuid, now()) AS day`;
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

  const payerUserId = visit.owner?.kind === 'CUSTOMER' ? visit.ownerUserId : null;
  const invoice = await tx.invoice.create({
    data: {
      code,
      branchId: visit.branchId,
      visitId,
      payerUserId,
      businessDate: clock.day,
      calculationVersion: CALCULATION_VERSION,
      subtotalVnd: totals.subtotalVnd,
      discountTotalVnd: totals.discountTotalVnd,
      totalVnd: totals.totalVnd,
      createdByUserId: context.actor.userId,
      createdAt: clock.created,
    },
    select: { id: true },
  });
  for (const [index, draft] of drafts.entries()) {
    const line = draft.line;
    const gross = grossOf(draft.quantity, draft.unitPriceVnd);
    const created = await tx.invoiceLine.create({
      data: {
        invoiceId: invoice.id,
        sequence: index + 1,
        itemCode: line.serviceCode,
        nameVi: line.serviceNameVi,
        nameEn: line.serviceNameEn,
        quantity: draft.quantity,
        unitPriceVnd: draft.unitPriceVnd,
        grossVnd: gross,
      },
      select: { id: true },
    });
    if (!line.employeeUserId) throw new Error('A performed line always has its KTV.');
    await tx.invoiceLineService.create({
      data: {
        invoiceLineId: created.id,
        invoiceId: invoice.id,
        visitServiceLineId: line.id,
        serviceId: line.serviceId,
        participantId: line.participantId,
        employeeUserId: line.employeeUserId,
        pricingUnit: line.catalogPricingUnit,
        catalogPriceMinVnd: line.catalogPriceMinVnd,
        catalogPriceMaxVnd: line.catalogPriceMaxVnd,
        quantityLimit: line.maxQuantitySnapshot,
        addedOnBehalf: line.addedOnBehalf,
      },
    });
  }
  await appendAdminAudit(context, {
    action: 'INVOICE_CREATED',
    entityType: 'Invoice',
    entityId: invoice.id,
    branchId: visit.branchId,
    classification: 'FINANCIAL',
    after: {
      code,
      visitId,
      visitCode: visit.code,
      payerUserId,
      lineCount: drafts.length,
      autoPricedLines: drafts.filter((draft) => draft.unitPriceVnd !== null).length,
      subtotalVnd: totals.subtotalVnd.toString(),
      calculationVersion: CALCULATION_VERSION,
    },
  });
  return { invoice: await load(context, invoice.id), created: true };
}

// --------------------------------------------------------------------- draft edits (DRAFT only)

/**
 * Chooses the concrete price and/or the financial quantity of ONE line of a DRAFT invoice.
 *
 * - Authority: `MANAGE_INVOICES` at the invoice's branch (design 11.1: it covers price/quantity selection).
 * - The price must lie inside the HISTORICAL range snapshotted on the visit line; the quantity is a
 *   positive integer within the snapshotted limit (PER_SERVICE is exactly 1). The live catalog is never read.
 * - `expectedVersion` is the invoice version; the invoice row is locked first. A stale version is a
 *   409 CONFLICT and nothing is written. Repeating the same choice changes nothing and audits nothing.
 * - The line gross and the header subtotal/total are recomputed on the server (never client input).
 */
export async function setLinePrice(
  context: AdminContext,
  invoiceId: string,
  lineId: string,
  input: { expectedVersion: number; unitPriceVnd: unknown; quantity: unknown },
): Promise<InvoiceResponse> {
  if (input.unitPriceVnd === undefined && input.quantity === undefined) {
    throw new AuthError('VALIDATION_FAILED', 'unitPriceVnd');
  }
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'MANAGE_INVOICES');
  const { tx } = context;
  const invoice = await read();
  if (invoice.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
  if (invoice.status !== 'DRAFT') throw new AuthError('INVOICE_STATE_INVALID');
  const line = invoice.lines.find((candidate) => candidate.id === lineId);
  const detail = line?.serviceDetails[0];
  if (!line || !detail) throw new AuthError('NOT_FOUND');

  const unitPriceVnd =
    input.unitPriceVnd === undefined
      ? line.unitPriceVnd
      : checkPrice(
          parseVnd(input.unitPriceVnd, 'unitPriceVnd'),
          detail.catalogPriceMinVnd,
          detail.catalogPriceMaxVnd,
        );
  const quantity =
    input.quantity === undefined
      ? line.quantity
      : checkQuantity(input.quantity, detail.quantityLimit);
  if (unitPriceVnd === line.unitPriceVnd && quantity === line.quantity)
    return present(context, invoice);

  const now = await databaseClock(tx);
  const gross = grossOf(quantity, unitPriceVnd);
  await tx.invoiceLine.update({
    where: { id: line.id },
    data: {
      quantity,
      unitPriceVnd,
      grossVnd: gross,
      priceSetByUserId: context.actor.userId,
      priceSetAt: now,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  const lines = await tx.invoiceLine.findMany({
    where: { invoiceId },
    select: { quantity: true, unitPriceVnd: true },
  });
  const totals = calculateTotals(lines, invoice.discountTotalVnd);
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotalVnd: totals.subtotalVnd,
      totalVnd: totals.totalVnd,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  const facts = (q: number | null, price: bigint | null) => ({
    quantity: q,
    unitPriceVnd: price === null ? null : price.toString(),
    grossVnd: grossOf(q, price)?.toString() ?? null,
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_PRICE_SET',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: {
        lineId: line.id,
        visitServiceLineId: detail.visitServiceLineId,
        ...facts(line.quantity, line.unitPriceVnd),
        subtotalVnd: invoice.subtotalVnd.toString(),
      },
      after: {
        lineId: line.id,
        visitServiceLineId: detail.visitServiceLineId,
        ...facts(quantity, unitPriceVnd),
        subtotalVnd: totals.subtotalVnd.toString(),
        priceRangeMinVnd: detail.catalogPriceMinVnd.toString(),
        priceRangeMaxVnd: detail.catalogPriceMaxVnd.toString(),
        quantityLimit: detail.quantityLimit,
      },
    },
  );
  return load(context, invoiceId);
}

/**
 * Sets or clears the payer of a DRAFT invoice. `payerUserId` is an existing active MEMBER found by
 * the exact phone/email lookup, or null for a guest payer. No account is ever created and no identity is
 * inferred from guest details. `MANAGE_INVOICES`; the payer is frozen at finalization (Step 4 guard).
 */
export async function setPayer(
  context: AdminContext,
  invoiceId: string,
  input: { expectedVersion: number; payerUserId: string | null },
): Promise<InvoiceResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'MANAGE_INVOICES');
  const { tx } = context;
  const invoice = await read();
  if (invoice.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
  if (invoice.status !== 'DRAFT') throw new AuthError('INVOICE_STATE_INVALID');
  if (input.payerUserId !== null) {
    const member = await tx.user.findFirst({
      where: { id: input.payerUserId, kind: 'CUSTOMER', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!member) throw new AuthError('VALIDATION_FAILED', 'payerUserId');
  }
  if (input.payerUserId === invoice.payerUserId) return present(context, invoice);
  const now = await databaseClock(tx);
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { payerUserId: input.payerUserId, rowVersion: { increment: 1 } },
    select: { id: true },
  });
  const kind = (id: string | null) => (id === null ? 'GUEST' : 'MEMBER');
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_PAYER_SET',
      entityType: 'Invoice',
      entityId: invoiceId,
      subjectUserId: input.payerUserId ?? invoice.payerUserId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: { payerUserId: invoice.payerUserId, payerKind: kind(invoice.payerUserId) },
      after: { payerUserId: input.payerUserId, payerKind: kind(input.payerUserId) },
    },
  );
  return load(context, invoiceId);
}

// ------------------------------------------------------------------------------ finalization

/**
 * Finalizes a DRAFT: `DRAFT -> PENDING_PAYMENT`, or directly `PAID` when the calculated receivable is
 * exactly 0 (OP-2: no Payment row, `paid_seq = 1`, `paid_at = finalized_at`). `MANAGE_INVOICES`.
 *
 * - The server recomputes the totals from the stored lines (a client never supplies any); every line
 *   must be priced with a quantity, else 409 INVOICE_NOT_READY. Step 5 has no benefit, so the discount
 *   total is 0; the Step 4 guards then freeze payer, lines, prices, amounts and version.
 * - Events: `INVOICE_FINALIZED`, then `INVOICE_PAID` (settlement ZERO_BALANCE) for a zero balance, in the
 *   same transaction; financial events never use `published_at` as consumption state.
 * - Replay: repeating the finalization the same actor just made (version = expected + 1, already
 *   finalized) returns the current state quietly, with no second audit or event.
 */
export async function finalizeInvoice(
  context: AdminContext,
  invoiceId: string,
  input: { expectedVersion: number },
): Promise<InvoiceResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'MANAGE_INVOICES');
  const { tx } = context;
  const invoice = await read();
  if (
    (invoice.status === 'PENDING_PAYMENT' || invoice.status === 'PAID') &&
    invoice.finalizedByUserId === context.actor.userId &&
    invoice.rowVersion === input.expectedVersion + 1
  ) {
    return present(context, invoice);
  }
  if (invoice.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
  if (invoice.status !== 'DRAFT') throw new AuthError('INVOICE_STATE_INVALID');
  const totals = calculateTotals(
    invoice.lines.map((line) => ({ quantity: line.quantity, unitPriceVnd: line.unitPriceVnd })),
    0n,
  );
  if (invoice.lines.length === 0 || totals.unpricedLines > 0)
    throw new AuthError('INVOICE_NOT_READY');

  const now = await databaseClock(tx);
  const zeroBalance = totals.totalVnd === 0n;
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      status: zeroBalance ? 'PAID' : 'PENDING_PAYMENT',
      calculationVersion: CALCULATION_VERSION,
      subtotalVnd: totals.subtotalVnd,
      discountTotalVnd: totals.discountTotalVnd,
      totalVnd: totals.totalVnd,
      finalizedAt: now,
      finalizedByUserId: context.actor.userId,
      ...(zeroBalance ? { paidAt: now, paidSeq: 1 } : {}),
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  const locked = { ...context, now };
  await appendAdminAudit(locked, {
    action: 'INVOICE_FINALIZED',
    entityType: 'Invoice',
    entityId: invoiceId,
    branchId: hint.branchId,
    classification: 'FINANCIAL',
    before: { status: 'DRAFT', version: invoice.rowVersion },
    after: {
      status: zeroBalance ? 'PAID' : 'PENDING_PAYMENT',
      subtotalVnd: totals.subtotalVnd.toString(),
      discountTotalVnd: '0',
      totalVnd: totals.totalVnd.toString(),
      calculationVersion: CALCULATION_VERSION,
      benefit: null,
      candidates: [],
      zeroBalance,
      payerUserId: invoice.payerUserId,
      lines: invoice.lines.map((line) => ({
        lineId: line.id,
        quantity: line.quantity,
        unitPriceVnd: line.unitPriceVnd === null ? null : line.unitPriceVnd.toString(),
        grossVnd: line.grossVnd === null ? null : line.grossVnd.toString(),
      })),
    },
  });
  await appendOutboxEvent(tx, {
    branchId: invoice.branchId,
    aggregateType: 'Invoice',
    aggregateId: invoiceId,
    eventType: 'INVOICE_FINALIZED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      ...eventBase(invoice),
      totalVnd: totals.totalVnd.toString(),
      calculationVersion: CALCULATION_VERSION,
    },
  });
  if (zeroBalance) {
    await appendAdminAudit(locked, {
      action: 'INVOICE_PAID',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: { status: 'DRAFT' },
      after: { status: 'PAID', paidSeq: 1, settlement: 'ZERO_BALANCE', totalVnd: '0' },
    });
    await appendOutboxEvent(tx, {
      branchId: invoice.branchId,
      aggregateType: 'Invoice',
      aggregateId: invoiceId,
      eventType: 'INVOICE_PAID',
      schemaVersion: 1,
      occurredAt: now,
      payload: {
        ...eventBase(invoice),
        paidSeq: 1,
        totalVnd: '0',
        settlement: 'ZERO_BALANCE',
      },
    });
  }
  return load(context, invoiceId);
}

// ---------------------------------------------------------------------------- cancellation

/**
 * Cancels an invoice (never deletes; nothing is rewritten). `CANCEL_INVOICES` at the invoice's branch and
 * a required reason. Paths (design 5.5):
 * - `DRAFT`: no re-authentication;
 * - `PENDING_PAYMENT` with no effective payment: fresh password re-authentication (a payment reversal, if
 *   one ever exists, is Step 7 and must come first);
 * - `PAID` ONLY as the OP-7 zero-balance correction (`total = 0`, no Payment row at all): fresh
 *   re-authentication. A `PAID` invoice with a payment is refused here (Step 7, Q6).
 * The invoice keeps every fact; a new invoice may be created for the visit afterwards. No redemption
 * exists before Step 6, so nothing is released. Repeating a cancellation the same actor already made
 * returns the current state quietly (no second audit or event).
 */
export async function cancelInvoice(
  context: AdminContext,
  invoiceId: string,
  input: { expectedVersion: number; reason: string },
  freshAuthSeconds: number,
): Promise<InvoiceResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'CANCEL_INVOICES');
  const { tx } = context;
  const invoice = await read();
  if (invoice.status === 'CANCELLED') {
    if (invoice.cancelledByUserId === context.actor.userId) return present(context, invoice);
    throw new AuthError('INVOICE_STATE_INVALID');
  }
  if (invoice.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');

  let path: 'DRAFT' | 'UNPAID_FINALIZED' | 'ZERO_BALANCE_CORRECTION';
  if (invoice.status === 'DRAFT') {
    path = 'DRAFT';
  } else if (invoice.status === 'PENDING_PAYMENT') {
    if (effectivePaid(invoice) !== 0n) throw new AuthError('INVOICE_CANCEL_NOT_ALLOWED');
    path = 'UNPAID_FINALIZED';
  } else if (zeroBalanceCancellable(invoice)) {
    path = 'ZERO_BALANCE_CORRECTION';
  } else {
    throw new AuthError('INVOICE_CANCEL_NOT_ALLOWED');
  }
  if (
    path !== 'DRAFT' &&
    !hasFreshReauthentication(context.actor.principal, context.now, freshAuthSeconds)
  ) {
    throw new AuthError('REAUTHENTICATION_REQUIRED');
  }

  const now = await databaseClock(tx);
  const cancelledFrom = invoice.status as InvoiceStatusName;
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledByUserId: context.actor.userId,
      cancelledFromStatus: cancelledFrom,
      cancelReason: input.reason,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  const voidedPaidSeq = path === 'ZERO_BALANCE_CORRECTION' ? invoice.paidSeq : null;
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_CANCELLED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      reason: input.reason,
      before: { status: cancelledFrom, totalVnd: invoice.totalVnd.toString() },
      after: {
        status: 'CANCELLED',
        cancelledFrom,
        cancellationPath: path,
        voidedPaidSeq,
        redemptionReleased: null,
        reauthenticatedAt:
          path === 'DRAFT'
            ? null
            : (context.actor.principal.reauthenticatedAt?.toISOString() ?? null),
      },
    },
  );
  await appendOutboxEvent(tx, {
    branchId: invoice.branchId,
    aggregateType: 'Invoice',
    aggregateId: invoiceId,
    eventType: 'INVOICE_CANCELLED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      ...eventBase(invoice),
      cancelledFrom,
      zeroBalanceCorrection: path === 'ZERO_BALANCE_CORRECTION',
      voidedPaidSeq,
      redemptionReleased: false,
    },
  });
  return load(context, invoiceId);
}
