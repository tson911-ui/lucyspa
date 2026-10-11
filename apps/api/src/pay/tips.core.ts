import {
  CASH_REASON_MAX,
  TIP_METHODS,
  TIP_WINDOW_DAYS,
  type InvoiceTipsResponse,
  type TipItem,
  type TipMethodName,
  type TipRequest,
  type TipReverseRequest,
} from '@lucy-spa/contracts';
import { ensureCashFund } from '@lucy-spa/server';
import type { Prisma } from '@lucy-spa/database';
import { randomUUID } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { fundBalance, lockFunds, openDay } from '../finance/cash-entries.core.js';
import { financeGoLive } from '../finance/cash.core.js';
import { exactKeys, money, reason, uuid } from '../finance/finance.input.js';
import { holdsPayrollShopWide } from './pay.access.js';

/**
 * Phase 7 P7-10 (design 6; P7-T7; Owner answer 5): customers' tips. A tip is a SEPARATE record (never part of the invoice or its payment,
 * not revenue, no loyalty points, outside the commission base), recorded after the invoice is PAID, within `TIP_WINDOW_DAYS`, by someone who
 * may collect payments at the invoice's branch, for a KTV who performed a service on that invoice. It enters the cash book in the same
 * transaction (cash: the branch's cash fund; a transfer the shop recorded: the bank fund). It is paid out WITH THE PAYSLIP (P7-12..P7-14),
 * never at the daily closing. A mistake is reversed in full by a negative record and a reversing book entry while no payroll run has
 * taken the tip. Nothing is written before the Owner has started the cash book and payroll.
 */
type Tx = Prisma.TransactionClient;
const day = (value: Date): string => value.toISOString().slice(0, 10);
const WINDOW_MS = TIP_WINDOW_DAYS * 86_400_000;
const METHODS = new Set<string>(TIP_METHODS);

const TIP_SELECT = {
  id: true,
  employeeUserId: true,
  amountVnd: true,
  method: true,
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
      paidAt: true,
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

async function view(context: AdminContext, invoiceId: string): Promise<InvoiceTipsResponse> {
  const { tx } = context;
  const invoice = await loadInvoice(tx, invoiceId);
  if (!canSee(context, invoice.branchId)) throw new AuthError('FORBIDDEN');
  const live = await financeGoLive(tx);
  const tips = await tx.tip.findMany({
    where: { invoiceId },
    orderBy: { seq: 'asc' },
    select: TIP_SELECT,
  });
  const reversed = new Set(
    tips.filter((tip) => tip.reversesId !== null).map((tip) => tip.reversesId),
  );
  const ktvIds = [
    ...new Set(
      invoice.lines.flatMap((line) => line.serviceDetails.map((detail) => detail.employeeUserId)),
    ),
  ];
  const people = await tx.employeeProfile.findMany({
    where: { userId: { in: ktvIds } },
    select: { userId: true, user: { select: { fullName: true } } },
  });
  const net = new Map<string, bigint>();
  for (const tip of tips)
    net.set(tip.employeeUserId, (net.get(tip.employeeUserId) ?? 0n) + tip.amountVnd);
  const windowEnd = invoice.paidAt ? new Date(invoice.paidAt.getTime() + WINDOW_MS) : null;
  const mayCollect = canCollectAt(context, invoice.branchId);
  const blockedBy: InvoiceTipsResponse['blockedBy'] = !mayCollect
    ? 'NO_PERMISSION'
    : invoice.status !== 'PAID'
      ? 'NOT_PAID'
      : ktvIds.length === 0
        ? 'NO_SERVICE'
        : !live
          ? 'NOT_LIVE'
          : windowEnd !== null && context.now > windowEnd
            ? 'WINDOW_CLOSED'
            : null;
  const items: TipItem[] = tips.map((tip) => ({
    id: tip.id,
    employee: { id: tip.employeeUserId, name: tip.employee.user.fullName },
    amountVnd: tip.amountVnd.toString(),
    method: tip.method,
    businessDate: day(tip.businessDate),
    reversesId: tip.reversesId,
    reason: tip.reason,
    recordedBy: { id: tip.recordedBy.id, name: tip.recordedBy.fullName },
    recordedAt: tip.recordedAt.toISOString(),
    claimed: tip.runId !== null,
    canReverse:
      mayCollect && tip.reversesId === null && !reversed.has(tip.id) && tip.runId === null,
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
    canRecord: blockedBy === null,
    blockedBy,
    windowEndsAt: windowEnd ? windowEnd.toISOString() : null,
  };
}

export function invoiceTips(
  context: AdminContext,
  invoiceIdRaw: string,
): Promise<InvoiceTipsResponse> {
  return view(context, uuid(invoiceIdRaw, 'id'));
}

const TIP_KEYS = ['invoiceId', 'employeeUserId', 'amountVnd', 'method', 'clientRequestId'] as const;

export async function recordTip(
  context: AdminContext,
  request: TipRequest,
): Promise<InvoiceTipsResponse> {
  const { tx } = context;
  const body = exactKeys(request, TIP_KEYS, 'body');
  const invoiceId = uuid(body['invoiceId'], 'invoiceId');
  const employeeUserId = uuid(body['employeeUserId'], 'employeeUserId');
  const amount = money(body['amountVnd'], 'amountVnd', { positive: true });
  const method = body['method'];
  if (typeof method !== 'string' || !METHODS.has(method))
    throw new AuthError('VALIDATION_FAILED', 'method');
  const methodName = method as TipMethodName;
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  const early = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { branchId: true },
  });
  if (!early) throw new AuthError('NOT_FOUND');
  if (!canCollectAt(context, early.branchId)) throw new AuthError('FORBIDDEN');
  if (!(await financeGoLive(tx))) throw new AuthError('FINANCE_NOT_LIVE');

  const replay = async (): Promise<InvoiceTipsResponse | null> => {
    const prior = await tx.tip.findFirst({
      where: { recordedByUserId: context.actor.userId, clientRequestId },
      select: {
        invoiceId: true,
        employeeUserId: true,
        amountVnd: true,
        method: true,
        reversesId: true,
      },
    });
    if (!prior) return null;
    if (
      prior.invoiceId !== invoiceId ||
      prior.employeeUserId !== employeeUserId ||
      prior.amountVnd !== amount ||
      prior.method !== methodName ||
      prior.reversesId !== null
    ) {
      throw new AuthError('CONFLICT');
    }
    return view(context, invoiceId);
  };
  const first = await replay();
  if (first) return first;

  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  const settled = await replay();
  if (settled) return settled;
  const invoice = await loadInvoice(tx, invoiceId);
  if (invoice.status !== 'PAID' || invoice.paidAt === null) throw new AuthError('CONFLICT');
  if (context.now.getTime() > invoice.paidAt.getTime() + WINDOW_MS)
    throw new AuthError('TIP_WINDOW_CLOSED');
  const served = new Set(
    invoice.lines.flatMap((line) => line.serviceDetails.map((detail) => detail.employeeUserId)),
  );
  if (!served.has(employeeUserId)) throw new AuthError('VALIDATION_FAILED', 'employeeUserId');
  const net = await tx.tip.aggregate({
    where: { invoiceId, employeeUserId },
    _sum: { amountVnd: true },
  });
  if ((net._sum.amountVnd ?? 0n) !== 0n) throw new AuthError('TIP_EXISTS');

  const fund =
    methodName === 'CASH'
      ? await ensureCashFund(tx, invoice.branchId)
      : ((await tx.cashFund.findFirst({ where: { kind: 'BANK' }, select: { id: true } }))?.id ??
        null);
  if (fund === null) throw new AuthError('FINANCE_NOT_LIVE');
  await lockFunds(tx, [fund], false);
  const fundRow = await tx.cashFund.findUniqueOrThrow({
    where: { id: fund },
    select: { id: true, kind: true },
  });
  const branch = await tx.branch.findUniqueOrThrow({
    where: { id: invoice.branchId },
    select: { timezone: true },
  });
  const businessDate = await openDay(tx, fundRow, branch.timezone, context.now);
  const tipId = randomUUID();
  const entry = await tx.fundEntry.create({
    data: {
      fundId: fund,
      branchId: invoice.branchId,
      businessDate,
      direction: 'IN',
      category: 'TIP_IN',
      amountVnd: amount,
      sourceType: 'TIP',
      sourceId: tipId,
      sourceLeg: 0,
      actorUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await tx.tip.create({
    data: {
      id: tipId,
      branchId: invoice.branchId,
      invoiceId,
      employeeUserId,
      amountVnd: amount,
      method: methodName,
      businessDate,
      recordedByUserId: context.actor.userId,
      clientRequestId,
      fundEntryId: entry.id,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'TIP_RECORDED',
    entityType: 'Tip',
    entityId: tipId,
    subjectUserId: employeeUserId,
    branchId: invoice.branchId,
    classification: 'FINANCIAL',
    after: { invoiceId, amountVnd: amount.toString(), method: methodName },
  });
  return view(context, invoiceId);
}

const REVERSE_KEYS = ['reason', 'clientRequestId'] as const;

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
      businessDate: true,
    },
  });
  if (!tip) throw new AuthError('NOT_FOUND');
  if (!canCollectAt(context, tip.branchId)) throw new AuthError('FORBIDDEN');
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
    before: { amountVnd: tip.amountVnd.toString(), method: tip.method },
  });
  return view(context, tip.invoiceId);
}
