import type {
  InvoiceDiscountResponse,
  InvoiceLineResponse,
  InvoiceManagementNoteResponse,
  InvoicePaymentAnomaly,
  InvoiceOpenedResponse,
  InvoicePaymentResponse,
  InvoicePersonSummary,
  InvoiceResponse,
  InvoiceStatusName,
  PosBoardResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, generateInvoiceCode, type Prisma } from '@lucy-spa/database';
import { expireStalePending } from '@lucy-spa/server';
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
import {
  candidatesJson,
  evaluateInvoice,
  previewDiscount,
  snapshotCandidatesJson,
  storedDiscount,
  type InvoiceEvaluation,
} from './discount.eval.js';
import { PAYMENT_METHOD_RULES } from './payment.methods.js';

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

export const anomalySelect = {
  id: true,
  kind: true,
  status: true,
  paymentId: true,
  orderCode: true,
  providerReference: true,
  expectedAmountVnd: true,
  receivedAmountVnd: true,
  invoiceStatus: true,
  openedAt: true,
  reviewedAt: true,
  reviewNote: true,
  reviewedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.PaymentAnomalySelect;

export function anomalyResponse(
  anomaly: Prisma.PaymentAnomalyGetPayload<{ select: typeof anomalySelect }>,
): InvoicePaymentAnomaly {
  return {
    id: anomaly.id,
    kind: anomaly.kind,
    status: anomaly.status,
    paymentId: anomaly.paymentId,
    orderCode: anomaly.orderCode.toString(),
    providerReference: anomaly.providerReference,
    expectedAmountVnd:
      anomaly.expectedAmountVnd === null ? null : anomaly.expectedAmountVnd.toString(),
    receivedAmountVnd: anomaly.receivedAmountVnd.toString(),
    invoiceStatus: anomaly.invoiceStatus,
    openedAt: anomaly.openedAt.toISOString(),
    reviewedBy: anomaly.reviewedBy
      ? { id: anomaly.reviewedBy.id, displayName: anomaly.reviewedBy.fullName }
      : null,
    reviewedAt: anomaly.reviewedAt ? anomaly.reviewedAt.toISOString() : null,
    reviewNote: anomaly.reviewNote,
  };
}

export const invoiceSelect = {
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
    orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      method: true,
      status: true,
      amountDueVnd: true,
      amountVnd: true,
      tenderedVnd: true,
      changeVnd: true,
      collectedAt: true,
      businessDate: true,
      providerOrderCode: true,
      checkoutUrl: true,
      qrCode: true,
      expiresAt: true,
      providerReference: true,
      lateOfPaymentId: true,
      collectedBy: { select: { id: true, fullName: true } },
      correction: {
        select: {
          id: true,
          reason: true,
          occurredAt: true,
          actorUserId: true,
          actor: { select: { id: true, fullName: true } },
        },
      },
    },
  },
  paymentAnomalies: {
    orderBy: [{ openedAt: 'desc' }, { id: 'asc' }],
    select: anomalySelect,
  },
  managementNotes: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      note: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
    },
  },
  voucherEntries: {
    where: { removedAt: null },
    orderBy: [{ suppliedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      suppliedAt: true,
      voucher: {
        select: {
          id: true,
          code: true,
          discount: { select: { nameVi: true, nameEn: true } },
        },
      },
    },
  },
  discountApplication: {
    select: {
      voucherId: true,
      discountId: true,
      candidates: true,
      selectionReason: true,
      appliedAt: true,
    },
  },
  discountRedemption: {
    select: { id: true, discountId: true, release: { select: { id: true } } },
  },
  loyaltySnapshot: {
    select: { candidates: true, winnerSource: true, selectionReason: true, createdAt: true },
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

export type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

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

export function effectivePaid(row: {
  payments: readonly { status: string; amountVnd: bigint; correction: unknown }[];
}): bigint {
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

/** The invoice's payments as the actor may see them (`reversible` follows CORRECT_PAYMENTS at the branch). */
export function presentPayments(context: AdminContext, row: InvoiceRow): InvoicePaymentResponse[] {
  const correct = decide(context.actor.graph, 'CORRECT_PAYMENTS', {
    kind: 'BRANCH',
    branchId: row.branchId,
  });
  const collect = decide(context.actor.graph, 'COLLECT_PAYMENTS', {
    kind: 'BRANCH',
    branchId: row.branchId,
  });
  return row.payments.map((payment): InvoicePaymentResponse => {
    const effective = payment.status === 'SUCCEEDED' && payment.correction === null;
    const pending = payment.status === 'PENDING';
    return {
      id: payment.id,
      method: payment.method,
      status: payment.status,
      amountDueVnd: payment.amountDueVnd.toString(),
      amountVnd: payment.amountVnd.toString(),
      tenderedVnd: payment.tenderedVnd.toString(),
      changeVnd: payment.changeVnd.toString(),
      collectedBy: { id: payment.collectedBy.id, displayName: payment.collectedBy.fullName },
      collectedAt: payment.collectedAt.toISOString(),
      businessDate: day(payment.businessDate),
      effective,
      correction: payment.correction
        ? {
            reason: payment.correction.reason,
            actor: {
              id: payment.correction.actor.id,
              displayName: payment.correction.actor.fullName,
            },
            occurredAt: payment.correction.occurredAt.toISOString(),
          }
        : null,
      reversible:
        correct &&
        effective &&
        PAYMENT_METHOD_RULES[payment.method].reversible &&
        (row.status === 'PENDING_PAYMENT' || row.status === 'PAID'),
      provider:
        payment.providerOrderCode !== null && payment.expiresAt
          ? {
              orderCode: payment.providerOrderCode.toString(),
              // The payment instrument is shown only to someone who may collect, and only while it can be paid.
              checkoutUrl: collect && pending ? payment.checkoutUrl : null,
              qrCode: collect && pending ? payment.qrCode : null,
              expiresAt: payment.expiresAt.toISOString(),
              reference: payment.providerReference,
              late: payment.lateOfPaymentId !== null,
            }
          : null,
      cancellable: collect && pending && payment.providerOrderCode !== null,
    };
  });
}

/** Part of the balance held by live (unexpired) PayOS requests; cash can only collect the rest meanwhile. */
export function pendingProviderVnd(
  payments: readonly { status: string; amountVnd: bigint; expiresAt: Date | null }[],
  now: Date,
): bigint {
  return payments
    .filter(
      (payment) => payment.status === 'PENDING' && payment.expiresAt && payment.expiresAt > now,
    )
    .reduce((sum, payment) => sum + payment.amountVnd, 0n);
}

function presentAnomalies(context: AdminContext, row: InvoiceRow): InvoicePaymentAnomaly[] {
  if (
    !decide(context.actor.graph, 'CORRECT_PAYMENTS', { kind: 'BRANCH', branchId: row.branchId })
  ) {
    return [];
  }
  return row.paymentAnomalies.map(anomalyResponse);
}

function presentNotes(context: AdminContext, row: InvoiceRow): InvoiceManagementNoteResponse[] {
  if (
    !decide(context.actor.graph, 'CORRECT_PAYMENTS', { kind: 'BRANCH', branchId: row.branchId })
  ) {
    return [];
  }
  return row.managementNotes.map((note) => ({
    id: note.id,
    note: note.note,
    author: { id: note.author.id, displayName: note.author.fullName },
    createdAt: note.createdAt.toISOString(),
  }));
}

/** Remaining amount to collect: only a PENDING_PAYMENT invoice has one. */
export function balanceOf(row: {
  status: InvoiceStatusName;
  totalVnd: bigint;
  payments: readonly { status: string; amountVnd: bigint; correction: unknown }[];
}): bigint {
  return row.status === 'PENDING_PAYMENT' ? row.totalVnd - effectivePaid(row) : 0n;
}

/**
 * The response for one invoice. A DRAFT shows the LIVE evaluation (the totals finalization would produce now);
 * a finalized invoice shows its frozen amounts and stored application. Nothing here is client input.
 */
export async function present(context: AdminContext, row: InvoiceRow): Promise<InvoiceResponse> {
  const entries = row.voucherEntries.map((entry) => ({
    id: entry.id,
    voucherId: entry.voucher.id,
    code: entry.voucher.code,
    nameVi: entry.voucher.discount.nameVi,
    nameEn: entry.voucher.discount.nameEn,
    suppliedAt: entry.suppliedAt.toISOString(),
  }));
  let evaluation: InvoiceEvaluation | null = null;
  let discount: InvoiceDiscountResponse;
  if (row.status === 'DRAFT') {
    evaluation = await evaluateInvoice(
      context.tx,
      { id: row.id, payerUserId: row.payerUserId },
      context.now,
      { lockPrograms: false },
    );
    discount = previewDiscount(evaluation, entries);
  } else if (row.discountApplication || row.loyaltySnapshot) {
    discount = storedDiscount(row.discountApplication, row.loyaltySnapshot, entries);
  } else {
    discount = {
      preview: false,
      candidates: [],
      winner: null,
      winnerSource: null,
      member: null,
      selectionReason: null,
      vouchers: entries,
      appliedAt: null,
    };
  }
  const discountTotalVnd = evaluation ? evaluation.result.discountTotalVnd : row.discountTotalVnd;
  const totalVnd = evaluation ? row.subtotalVnd - discountTotalVnd : row.totalVnd;
  const apply = decide(context.actor.graph, 'APPLY_DISCOUNTS', {
    kind: 'BRANCH',
    branchId: row.branchId,
  });
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
  const collect = decide(context.actor.graph, 'COLLECT_PAYMENTS', {
    kind: 'BRANCH',
    branchId: row.branchId,
  });
  const paidVnd = effectivePaid(row);
  const payments = presentPayments(context, row);
  const heldByProvider = pendingProviderVnd(row.payments, context.now);
  const anyPending = row.payments.some((payment) => payment.status === 'PENDING');
  const correct = decide(context.actor.graph, 'CORRECT_PAYMENTS', {
    kind: 'BRANCH',
    branchId: row.branchId,
  });
  const cancellable =
    draft ||
    (row.status === 'PENDING_PAYMENT' && effectivePaid(row) === 0n && !anyPending) ||
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
    discountTotalVnd: discountTotalVnd.toString(),
    totalVnd: totalVnd.toString(),
    createdAt: row.createdAt.toISOString(),
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paidSeq: row.paidSeq,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledFromStatus: row.cancelledFromStatus,
    cancelReason: row.cancelReason,
    version: row.rowVersion,
    lines,
    discount,
    payments,
    paidVnd: paidVnd.toString(),
    balanceVnd: balanceOf(row).toString(),
    pendingProviderVnd: heldByProvider.toString(),
    anomalies: presentAnomalies(context, row),
    managementNotes: presentNotes(context, row),
    readiness: { ready: unpricedLines === 0 && lines.length > 0, unpricedLines },
    actions: {
      editPrices: manage && draft,
      setPayer: manage && draft,
      finalize: manage && draft && unpricedLines === 0 && lines.length > 0,
      applyVouchers: apply && draft,
      collectPayment: collect && row.status === 'PENDING_PAYMENT',
      collectPayos: collect && row.status === 'PENDING_PAYMENT',
      manageAnomalies: correct,
      addManagementNote:
        correct &&
        row.payments.some(
          (payment) =>
            payment.method === 'PAYOS' &&
            payment.status === 'SUCCEEDED' &&
            payment.correction === null,
        ),
      cancel: cancelPermitted && cancellable,
      cancelNeedsReauth: !draft,
    },
  };
}

export async function load(context: AdminContext, invoiceId: string): Promise<InvoiceResponse> {
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

export async function databaseClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  return clock.now;
}

/**
 * The header amounts of a DRAFT as the engine computes them NOW (subtotal of the priced lines, the winning
 * benefit, total). Refreshed with every draft mutation; finalization recomputes them under the program locks.
 */
async function draftAmounts(
  tx: Prisma.TransactionClient,
  invoice: { id: string; payerUserId: string | null },
  now: Date,
) {
  const { result } = await evaluateInvoice(tx, invoice, now, { lockPrograms: false });
  return {
    subtotalVnd: result.subtotalVnd,
    discountTotalVnd: result.discountTotalVnd,
    totalVnd: result.totalVnd,
  };
}

/** Locks the invoice, re-reads it under the lock and checks the caller's version. */
export async function lockedInvoice(
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

export const eventBase = (row: { id: string; branchId: string; visitId: string }) => ({
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
      serviceCategoryId: true,
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
        // Phase 4 Step 6: the historical category, copied snapshot-to-snapshot (never the live service).
        serviceCategoryId: line.serviceCategoryId,
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
  const totals = await draftAmounts(tx, invoice, now);
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotalVnd: totals.subtotalVnd,
      discountTotalVnd: totals.discountTotalVnd,
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
        discountTotalVnd: totals.discountTotalVnd.toString(),
        totalVnd: totals.totalVnd.toString(),
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
  // A per-customer-limited benefit depends on the payer (OP-3): the header follows the new payer.
  const amounts = await draftAmounts(tx, { id: invoiceId, payerUserId: input.payerUserId }, now);
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      payerUserId: input.payerUserId,
      discountTotalVnd: amounts.discountTotalVnd,
      totalVnd: amounts.totalVnd,
      rowVersion: { increment: 1 },
    },
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
      before: {
        payerUserId: invoice.payerUserId,
        payerKind: kind(invoice.payerUserId),
        discountTotalVnd: invoice.discountTotalVnd.toString(),
      },
      after: {
        payerUserId: input.payerUserId,
        payerKind: kind(input.payerUserId),
        discountTotalVnd: amounts.discountTotalVnd.toString(),
      },
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
 *   must be priced with a quantity, else 409 INVOICE_NOT_READY. Step 6: under the invoice lock and every
 *   candidate program's row lock the engine runs a final time at the database clock, the ONE winning benefit
 *   (if any) is written as the immutable application plus its redemption, and the discount total is the
 *   applied amount; the Step 4 guards then freeze payer, lines, prices, amounts and version.
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
  const priced = calculateTotals(
    invoice.lines.map((line) => ({ quantity: line.quantity, unitPriceVnd: line.unitPriceVnd })),
    0n,
  );
  if (invoice.lines.length === 0 || priced.unpricedLines > 0)
    throw new AuthError('INVOICE_NOT_READY');

  const now = await databaseClock(tx);
  const { result } = await evaluateInvoice(
    tx,
    { id: invoiceId, payerUserId: invoice.payerUserId },
    now,
    { lockPrograms: true },
  );
  const winner = result.winner;
  const totals = calculateTotals(
    invoice.lines.map((line) => ({ quantity: line.quantity, unitPriceVnd: line.unitPriceVnd })),
    result.discountTotalVnd,
  );
  const zeroBalance = totals.totalVnd === 0n;
  if (winner) {
    const version = winner.program.version;
    await tx.invoiceDiscountApplication.create({
      data: {
        invoiceId,
        discountId: winner.program.id,
        versionId: version.id,
        voucherId: winner.voucher?.id ?? null,
        kind: version.kind,
        percentBp: version.percentBp,
        fixedAmountVnd: version.fixedAmountVnd,
        eligibleSubtotalVnd: winner.eligibleSubtotalVnd,
        computedAmountVnd: winner.amountVnd,
        candidates: candidatesJson(result),
        selectionReason: result.selectionReason ?? 'ONLY_ELIGIBLE',
        finalizedByUserId: context.actor.userId,
        appliedAt: now,
      },
      select: { id: true },
    });
    await tx.discountRedemption.create({
      data: {
        invoiceId,
        discountId: winner.program.id,
        versionId: version.id,
        voucherId: winner.voucher?.id ?? null,
        payerUserId: invoice.payerUserId,
        redeemedAt: now,
      },
      select: { id: true },
    });
  }
  const member = result.member;
  if (member && invoice.payerUserId !== null) {
    // P5-T3: the payer's Spa tier is read at finalization (under the wallet share lock) and frozen here with the candidates
    // and the winner; the invoice is never recomputed from a later balance.
    await tx.invoiceLoyaltySnapshot.create({
      data: {
        invoiceId,
        payerUserId: invoice.payerUserId,
        wallet: 'SPA',
        balanceBefore: member.member.balanceBefore,
        tier: member.member.tier,
        tierTableVersion: member.member.tierTableVersion,
        memberDiscountBp: member.member.discountBp,
        calculationVersion: CALCULATION_VERSION,
        eligibleSpaVnd: member.eligibleSubtotalVnd,
        memberAmountVnd: result.winnerSource === 'MEMBER_TIER' ? member.amountVnd : 0n,
        candidates: snapshotCandidatesJson(result),
        winnerSource: result.winnerSource,
        selectionReason: result.selectionReason,
        createdAt: now,
      },
      select: { id: true },
    });
  }
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
      discountTotalVnd: totals.discountTotalVnd.toString(),
      totalVnd: totals.totalVnd.toString(),
      calculationVersion: CALCULATION_VERSION,
      benefit: winner
        ? {
            discountId: winner.program.id,
            discountCode: winner.program.code,
            versionNo: winner.program.version.versionNo,
            voucherCode: winner.voucher?.code ?? null,
            eligibleSubtotalVnd: winner.eligibleSubtotalVnd.toString(),
            amountVnd: winner.amountVnd.toString(),
            selectionReason: result.selectionReason,
          }
        : null,
      memberDiscount: result.member
        ? {
            tier: result.member.member.tier,
            balanceBefore: result.member.member.balanceBefore,
            discountBp: result.member.member.discountBp,
            eligibleSubtotalVnd: result.member.eligibleSubtotalVnd.toString(),
            amountVnd: result.member.amountVnd.toString(),
            won: result.winnerSource === 'MEMBER_TIER',
          }
        : null,
      winnerSource: result.winnerSource,
      selectionReason: result.selectionReason,
      candidates: candidatesJson(result),
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
      discountTotalVnd: totals.discountTotalVnd.toString(),
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
 * The invoice keeps every fact; a new invoice may be created for the visit afterwards. Step 6: the
 * redemption the finalization consumed (if any) is RELEASED by an append-only release row in the same
 * transaction (cause by path), after the invoice update and under the program row lock; the redemption row
 * itself stays. Repeating a cancellation the same actor already made returns the current state quietly (no
 * second release, audit or event).
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
    // A PayOS request whose lifetime passed ends first; a live one must be cancelled before the invoice is.
    const stale = await expireStalePending(
      tx,
      { kind: 'USER', userId: context.actor.userId, requestId: context.requestId },
      invoice,
      await databaseClock(tx),
    );
    const live = stale === 0 ? invoice.payments : (await read()).payments;
    if (live.some((payment) => payment.status === 'PENDING')) {
      throw new AuthError('PAYMENT_PROVIDER_PENDING');
    }
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
  const redemption = invoice.discountRedemption;
  let releasedRedemptionId: string | null = null;
  if (redemption && !redemption.release) {
    // Lock order: invoice (held) -> the redemption's program row, as finalization; capacity returns once.
    await tx.$queryRaw`SELECT id FROM discounts WHERE id = ${redemption.discountId}::uuid FOR UPDATE`;
    const cause =
      path === 'ZERO_BALANCE_CORRECTION' ? 'ZERO_BALANCE_CORRECTION' : 'INVOICE_CANCELLED_UNPAID';
    const release = await tx.discountRedemptionRelease.create({
      data: {
        redemptionId: redemption.id,
        releasedByUserId: context.actor.userId,
        cause,
        reason: input.reason,
        releasedAt: now,
      },
      select: { id: true },
    });
    releasedRedemptionId = redemption.id;
    await appendAdminAudit(
      { ...context, now },
      {
        action: 'DISCOUNT_REDEMPTION_RELEASED',
        entityType: 'Invoice',
        entityId: invoiceId,
        branchId: hint.branchId,
        classification: 'FINANCIAL',
        reason: input.reason,
        after: {
          redemptionId: redemption.id,
          releaseId: release.id,
          discountId: redemption.discountId,
          cause,
        },
      },
    );
  }
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
        redemptionReleased: releasedRedemptionId,
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
      redemptionReleased: releasedRedemptionId !== null,
    },
  });
  return load(context, invoiceId);
}

// ----------------------------------------------------------------- vouchers (DRAFT only, Step 6)

const VOUCHER_CODE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;

/** Voucher codes are stored canonical: NFC, trimmed, upper-case (the Step 4 CHECK is the backstop). */
export function canonicalVoucherCode(value: unknown): string {
  if (typeof value !== 'string') throw new AuthError('VOUCHER_INVALID');
  const code = value.normalize('NFC').trim().toUpperCase();
  if (!VOUCHER_CODE.test(code)) throw new AuthError('VOUCHER_INVALID');
  return code;
}

/**
 * Supplies a voucher code to a DRAFT (`APPLY_DISCOUNTS` at the invoice's branch). The code must belong to an
 * active voucher of an active, non-terminated program whose current version is inside its validity window;
 * otherwise ONE stable error (`VOUCHER_INVALID`, no hint which rule failed and nothing changes). Supplying is
 * NOT a guarantee of eligibility: the engine re-evaluates on every recalculation and at finalization. A repeat
 * of an already supplied code is a quiet no-op. Nothing about a percentage or amount can be typed here.
 */
export async function supplyVoucher(
  context: AdminContext,
  invoiceId: string,
  input: { expectedVersion: number; code: unknown },
): Promise<InvoiceResponse> {
  const code = canonicalVoucherCode(input.code);
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'APPLY_DISCOUNTS');
  const { tx } = context;
  const invoice = await read();
  if (invoice.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
  if (invoice.status !== 'DRAFT') throw new AuthError('INVOICE_STATE_INVALID');
  const now = await databaseClock(tx);
  const voucher = await tx.voucher.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      isActive: true,
      discount: {
        select: {
          id: true,
          code: true,
          isActive: true,
          terminatedAt: true,
          versions: {
            orderBy: { versionNo: 'desc' },
            take: 1,
            select: { validFrom: true, validUntil: true },
          },
        },
      },
    },
  });
  const version = voucher?.discount.versions[0];
  if (
    !voucher ||
    !version ||
    !voucher.isActive ||
    !voucher.discount.isActive ||
    voucher.discount.terminatedAt !== null ||
    now < version.validFrom ||
    now >= version.validUntil
  ) {
    throw new AuthError('VOUCHER_INVALID');
  }
  if (invoice.voucherEntries.some((entry) => entry.voucher.id === voucher.id)) {
    return present(context, invoice);
  }
  await tx.invoiceVoucherEntry.create({
    data: {
      invoiceId,
      voucherId: voucher.id,
      suppliedByUserId: context.actor.userId,
      suppliedAt: now,
    },
    select: { id: true },
  });
  const amounts = await draftAmounts(tx, invoice, now);
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      discountTotalVnd: amounts.discountTotalVnd,
      totalVnd: amounts.totalVnd,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_VOUCHER_SUPPLIED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: { discountTotalVnd: invoice.discountTotalVnd.toString() },
      after: {
        voucherId: voucher.id,
        voucherCode: voucher.code,
        discountCode: voucher.discount.code,
        discountTotalVnd: amounts.discountTotalVnd.toString(),
      },
    },
  );
  return load(context, invoiceId);
}

/**
 * Withdraws a supplied code from a DRAFT (`APPLY_DISCOUNTS`). It removes only that candidate: an automatic
 * code-less promotion can never be removed by staff (PRD 16.1). The entry keeps its history (one removal
 * transition); a repeat of an applied removal carries a stale version and is a 409 CONFLICT.
 */
export async function removeVoucher(
  context: AdminContext,
  invoiceId: string,
  entryId: string,
  input: { expectedVersion: number },
): Promise<InvoiceResponse> {
  const { hint, row: read } = await lockedInvoice(context, invoiceId, 'APPLY_DISCOUNTS');
  const { tx } = context;
  const invoice = await read();
  if (invoice.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
  if (invoice.status !== 'DRAFT') throw new AuthError('INVOICE_STATE_INVALID');
  const entry = invoice.voucherEntries.find((candidate) => candidate.id === entryId);
  if (!entry) throw new AuthError('NOT_FOUND');
  const now = await databaseClock(tx);
  await tx.invoiceVoucherEntry.update({
    where: { id: entryId },
    data: { removedAt: now, removedByUserId: context.actor.userId },
    select: { id: true },
  });
  const amounts = await draftAmounts(tx, invoice, now);
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      discountTotalVnd: amounts.discountTotalVnd,
      totalVnd: amounts.totalVnd,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(
    { ...context, now },
    {
      action: 'INVOICE_VOUCHER_REMOVED',
      entityType: 'Invoice',
      entityId: invoiceId,
      branchId: hint.branchId,
      classification: 'FINANCIAL',
      before: {
        voucherId: entry.voucher.id,
        voucherCode: entry.voucher.code,
        discountTotalVnd: invoice.discountTotalVnd.toString(),
      },
      after: { discountTotalVnd: amounts.discountTotalVnd.toString() },
    },
  );
  return load(context, invoiceId);
}
