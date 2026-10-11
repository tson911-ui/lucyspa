import {
  CASH_REASON_MAX,
  TIP_MAX_VND,
  TIP_STEP_VND,
  type InvoiceTipsResponse,
  type TipChoice,
  type TipItem,
  type TipReverseRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { fundBalance, lockFunds, openDay } from '../finance/cash-entries.core.js';
import { financeGoLive } from '../finance/cash.core.js';
import { exactKeys, money, reason, uuid } from '../finance/finance.input.js';
import { canApprovePayroll, holdsPayrollShopWide } from './pay.access.js';

/**
 * Phase 7 P7-17 (Owner decision of 2026-10-12; replaces P7-10's staff-recorded tips and the 7-day window): cash tips are NOT recorded. A tip
 * exists only when the CUSTOMER adds it to a PayOS payment and chooses which of the KTVs who performed a service on the invoice get how much
 * (see `pledgeTips` below and `recordPledgedTips` in `packages/server`: the tip is written by the settlement when the provider confirms the
 * invoice part plus the tip). It is a SEPARATE record: not revenue, no loyalty points, outside the commission base; it enters the bank fund
 * as TIP_IN and is paid out WITH THE PAYSLIP on the payroll payment day. Nobody can reassign or edit it; the only correction is the full
 * reversal below (Owner-level payroll approval, a reason, audited) while no payroll run has taken the tip.
 */
type Tx = Prisma.TransactionClient;
const day = (value: Date): string => value.toISOString().slice(0, 10);

const TIP_SELECT = {
  id: true,
  employeeUserId: true,
  amountVnd: true,
  businessDate: true,
  reversesId: true,
  reason: true,
  runId: true,
  recordedAt: true,
  employee: { select: { user: { select: { fullName: true } } } },
  recordedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.TipSelect;

const canCollectAt = (context: AdminContext, branchId: string): boolean =>
  decide(context.actor.graph, 'COLLECT_PAYMENTS', { kind: 'BRANCH', branchId });

function canSee(context: AdminContext, branchId: string): boolean {
  return (
    canCollectAt(context, branchId) ||
    decide(context.actor.graph, 'VIEW_INVOICES', { kind: 'BRANCH', branchId }) ||
    holdsPayrollShopWide(context)
  );
}

async function loadInvoice(tx: Tx, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      code: true,
      status: true,
      branchId: true,
      branch: { select: { id: true, name: true } },
      lines: {
        where: { kind: 'SERVICE' },
        select: { serviceDetails: { select: { employeeUserId: true } } },
      },
    },
  });
  if (!invoice) throw new AuthError('NOT_FOUND');
  return invoice;
}

const servedOf = (invoice: Awaited<ReturnType<typeof loadInvoice>>): string[] => [
  ...new Set(
    invoice.lines.flatMap((line) => line.serviceDetails.map((detail) => detail.employeeUserId)),
  ),
];

/** The cash book is live and has its bank fund (the only fund a customer's tip can enter). */
async function bookReady(tx: Tx): Promise<boolean> {
  if (!(await financeGoLive(tx))) return false;
  return (await tx.cashFund.findFirst({ where: { kind: 'BANK' }, select: { id: true } })) !== null;
}

async function view(context: AdminContext, invoiceId: string): Promise<InvoiceTipsResponse> {
  const { tx } = context;
  const invoice = await loadInvoice(tx, invoiceId);
  if (!canSee(context, invoice.branchId)) throw new AuthError('FORBIDDEN');
  const tips = await tx.tip.findMany({
    where: { invoiceId },
    orderBy: { seq: 'asc' },
    select: TIP_SELECT,
  });
  const reversed = new Set(
    tips.filter((tip) => tip.reversesId !== null).map((tip) => tip.reversesId),
  );
  const ktvIds = servedOf(invoice);
  const people = await tx.employeeProfile.findMany({
    where: { userId: { in: ktvIds } },
    select: { userId: true, user: { select: { fullName: true } } },
  });
  const net = new Map<string, bigint>();
  for (const tip of tips)
    net.set(tip.employeeUserId, (net.get(tip.employeeUserId) ?? 0n) + tip.amountVnd);
  const mayCorrect = canApprovePayroll(context);
  const blockedBy: InvoiceTipsResponse['offer']['blockedBy'] = !canCollectAt(
    context,
    invoice.branchId,
  )
    ? 'NO_PERMISSION'
    : invoice.status !== 'PENDING_PAYMENT'
      ? 'NOT_PAYABLE'
      : ktvIds.length === 0
        ? 'NO_SERVICE'
        : !(await bookReady(tx))
          ? 'NOT_LIVE'
          : null;
  const items: TipItem[] = tips.map((tip) => ({
    id: tip.id,
    employee: { id: tip.employeeUserId, name: tip.employee.user.fullName },
    amountVnd: tip.amountVnd.toString(),
    businessDate: day(tip.businessDate),
    reversesId: tip.reversesId,
    reason: tip.reason,
    recordedBy: { id: tip.recordedBy.id, name: tip.recordedBy.fullName },
    recordedAt: tip.recordedAt.toISOString(),
    claimed: tip.runId !== null,
    canReverse:
      mayCorrect && tip.reversesId === null && !reversed.has(tip.id) && tip.runId === null,
  }));
  return {
    invoiceId: invoice.id,
    invoiceCode: invoice.code,
    status: invoice.status,
    branch: invoice.branch,
    served: people
      .map((person) => ({
        employee: { id: person.userId, name: person.user.fullName },
        netVnd: (net.get(person.userId) ?? 0n).toString(),
      }))
      .sort(
        (a, b) =>
          a.employee.name.localeCompare(b.employee.name, 'vi') ||
          a.employee.id.localeCompare(b.employee.id),
      ),
    items,
    offer: { available: blockedBy === null, blockedBy },
  };
}

export function invoiceTips(
  context: AdminContext,
  invoiceIdRaw: string,
): Promise<InvoiceTipsResponse> {
  return view(context, uuid(invoiceIdRaw, 'id'));
}

// ------------------------------------------------------------------------------------------- the customer's choice

/** The tips a customer chose, checked for shape: a list of {employeeUserId, amountVnd}, each a positive multiple of 1,000, one per person. */
export function parseTipChoices(raw: unknown): TipChoice[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw new AuthError('VALIDATION_FAILED', 'tips');
  const seen = new Set<string>();
  const choices: TipChoice[] = [];
  let total = 0n;
  for (const entry of raw as unknown[]) {
    const body = exactKeys(entry, ['employeeUserId', 'amountVnd'] as const, 'tips');
    const employeeUserId = uuid(body['employeeUserId'], 'tips.employeeUserId');
    const amount = money(body['amountVnd'], 'tips.amountVnd', { positive: true });
    if (amount % BigInt(TIP_STEP_VND) !== 0n)
      throw new AuthError('VALIDATION_FAILED', 'tips.amountVnd');
    if (seen.has(employeeUserId)) throw new AuthError('VALIDATION_FAILED', 'tips.employeeUserId');
    seen.add(employeeUserId);
    total += amount;
    choices.push({ employeeUserId, amountVnd: amount.toString() });
  }
  if (total > BigInt(TIP_MAX_VND)) throw new AuthError('VALIDATION_FAILED', 'tips.amountVnd');
  return choices.sort((a, b) => a.employeeUserId.localeCompare(b.employeeUserId));
}

/**
 * Checks the customer's choice against the invoice and the book (called by the PayOS command under the invoice lock): every tip is for a KTV
 * who performed a service on the invoice, and the cash book is live with its bank fund. Throws, and writes nothing, otherwise.
 */
export async function checkTipChoices(
  tx: Tx,
  invoiceId: string,
  choices: readonly TipChoice[],
): Promise<void> {
  if (choices.length === 0) return;
  const invoice = await loadInvoice(tx, invoiceId);
  if (!(await bookReady(tx))) throw new AuthError('FINANCE_NOT_LIVE');
  const served = new Set(servedOf(invoice));
  if (served.size === 0) throw new AuthError('TIP_NOT_ALLOWED');
  for (const choice of choices) {
    if (!served.has(choice.employeeUserId))
      throw new AuthError('VALIDATION_FAILED', 'tips.employeeUserId');
  }
}

/** The pledges of a payment as {employeeUserId, amountVnd}: the same choice, in a stable order, for an idempotent replay. */
export async function pledgesOf(tx: Tx, paymentId: string): Promise<TipChoice[]> {
  const rows = await tx.paymentTipPledge.findMany({
    where: { paymentId },
    orderBy: { employeeUserId: 'asc' },
    select: { employeeUserId: true, amountVnd: true },
  });
  return rows.map((row) => ({
    employeeUserId: row.employeeUserId,
    amountVnd: row.amountVnd.toString(),
  }));
}

export const sameChoice = (a: readonly TipChoice[], b: readonly TipChoice[]): boolean =>
  a.length === b.length &&
  a.every(
    (entry, index) =>
      entry.employeeUserId === b[index]?.employeeUserId && entry.amountVnd === b[index]?.amountVnd,
  );

// ------------------------------------------------------------------------------------------- the Owner's correction

const REVERSE_KEYS = ['reason', 'clientRequestId'] as const;

/**
 * Reverses a tip IN FULL (never reassigns, never edits): `APPROVE_PAYROLL` (shop-wide), a reason and an audit event; a negative record and a
 * reversing book entry. Not possible once a payroll run has taken the tip (a tip already on a closed payslip is corrected by a deduction in
 * the next payroll draft).
 */
export async function reverseTip(
  context: AdminContext,
  tipIdRaw: string,
  request: TipReverseRequest,
): Promise<InvoiceTipsResponse> {
  const { tx } = context;
  const tipId = uuid(tipIdRaw, 'id');
  const body = exactKeys(request, REVERSE_KEYS, 'body');
  const why = reason(body['reason'], 'reason', CASH_REASON_MAX)!;
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  if (!canApprovePayroll(context)) throw new AuthError('FORBIDDEN');
  const tip = await tx.tip.findUnique({
    where: { id: tipId },
    select: {
      id: true,
      branchId: true,
      invoiceId: true,
      employeeUserId: true,
      amountVnd: true,
      method: true,
      reversesId: true,
      runId: true,
      fundEntryId: true,
      paymentId: true,
    },
  });
  if (!tip) throw new AuthError('NOT_FOUND');
  if (!(await financeGoLive(tx))) throw new AuthError('FINANCE_NOT_LIVE');
  const prior = await tx.tip.findFirst({
    where: { recordedByUserId: context.actor.userId, clientRequestId },
    select: { reversesId: true, reason: true },
  });
  if (prior) {
    if (prior.reversesId !== tipId || prior.reason !== why) throw new AuthError('CONFLICT');
    return view(context, tip.invoiceId);
  }
  if (
    tip.reversesId !== null ||
    (await tx.tip.findFirst({ where: { reversesId: tipId }, select: { id: true } }))
  ) {
    throw new AuthError('CONFLICT');
  }
  if (tip.runId !== null) throw new AuthError('TIP_CLAIMED');
  const original = await tx.fundEntry.findUniqueOrThrow({
    where: { id: tip.fundEntryId },
    select: {
      id: true,
      fundId: true,
      amountVnd: true,
      fund: { select: { id: true, kind: true, openingBalanceVnd: true } },
    },
  });
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${tip.invoiceId}::uuid FOR UPDATE`;
  await lockFunds(tx, [original.fundId], true);
  if (
    original.fund.kind === 'CASH' &&
    (await fundBalance(tx, original.fund)) < original.amountVnd
  ) {
    throw new AuthError('CASH_INSUFFICIENT');
  }
  const branch = await tx.branch.findUniqueOrThrow({
    where: { id: tip.branchId },
    select: { timezone: true },
  });
  const businessDate = await openDay(tx, original.fund, branch.timezone, context.now);
  const correction = await tx.fundEntry.create({
    data: {
      fundId: original.fundId,
      branchId: tip.branchId,
      businessDate,
      direction: 'OUT',
      category: 'CORRECTION',
      amountVnd: original.amountVnd,
      reversesEntryId: original.id,
      reason: why,
      actorUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await tx.tip.create({
    data: {
      branchId: tip.branchId,
      invoiceId: tip.invoiceId,
      employeeUserId: tip.employeeUserId,
      amountVnd: -tip.amountVnd,
      method: tip.method,
      businessDate,
      reversesId: tipId,
      reason: why,
      recordedByUserId: context.actor.userId,
      clientRequestId,
      fundEntryId: correction.id,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'TIP_REVERSED',
    entityType: 'Tip',
    entityId: tipId,
    subjectUserId: tip.employeeUserId,
    branchId: tip.branchId,
    reason: why,
    classification: 'FINANCIAL',
    before: { amountVnd: tip.amountVnd.toString(), paymentId: tip.paymentId },
  });
  return view(context, tip.invoiceId);
}
