import {
  ADVANCE_LIMIT_PERCENT,
  PAY_REASON_MAX,
  type AdvanceEligibleItem,
  type AdvanceFundOption,
  type SalaryAdvanceApproveRequest,
  type SalaryAdvanceCancelRequest,
  type SalaryAdvanceItem,
  type SalaryAdvancePayRequest,
  type SalaryAdvanceRequest,
  type SalaryAdvanceWriteOffRequest,
  type SalaryAdvancesResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { pickSalaryVersion } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { fundBalance, lockFunds, openDay } from '../finance/cash-entries.core.js';
import { financeGoLive } from '../finance/cash.core.js';
import { exactKeys, money, reason, uuid } from '../finance/finance.input.js';
import { spendConfirmation, takeFreshConfirmation } from '../finance/finance.reauth.js';
import { officialEmployees } from './pay-rules.core.js';
import { holdsPayrollShopWide, shopToday } from './pay.access.js';

/**
 * Phase 7 P7-13 (design 4.4; OQ-110; P7-T12): salary advances. Official employees with a CONFIRMED monthly salary only, at most half of it,
 * one open advance per person. A request needs MANAGE_PAYROLL, approving and paying need APPROVE_PAYROLL (all GLOBAL); paying needs a fresh
 * password and writes the fund outflow in the same transaction (the drawer cannot give what it does not hold); the payroll runs recover it
 * (ADVANCE_RECOVERY items, never more than the net pay available); the Owner may write off what is left with a reason and a fresh password.
 * Nothing is paid by itself and nothing is deleted.
 */
type Tx = Prisma.TransactionClient;
const GLOBAL = { kind: 'GLOBAL' } as const;
const day = (value: Date): string => value.toISOString().slice(0, 10);

const canRequest = (context: AdminContext): boolean =>
  decide(context.actor.graph, 'MANAGE_PAYROLL', GLOBAL);
const canApprove = (context: AdminContext): boolean =>
  decide(context.actor.graph, 'APPROVE_PAYROLL', GLOBAL);
const requireRead = (context: AdminContext): void => {
  if (!holdsPayrollShopWide(context)) throw new AuthError('FORBIDDEN');
};

/** What closed payroll runs have taken back from each advance, and what is still owed (only a PAID advance owes anything). */
export async function advanceBalances(
  tx: Tx,
  ids?: readonly string[],
): Promise<Map<string, { recovered: bigint; outstanding: bigint }>> {
  const rows = await tx.salaryAdvance.findMany({
    where: ids ? { id: { in: [...ids] } } : {},
    select: { id: true, amountVnd: true, status: true, writtenOffVnd: true },
  });
  const taken = await tx.$queryRaw<{ advance: string; recovered: bigint }[]>`
    SELECT i.advance_id::text AS advance, COALESCE(-SUM(i.amount_vnd), 0)::bigint AS recovered
    FROM pay_run_items i JOIN pay_runs r ON r.id = i.run_id
    WHERE i.advance_id IS NOT NULL AND i.voided_at IS NULL AND r.status IN ('CLOSED', 'PAID')
    GROUP BY i.advance_id`;
  const recoveredBy = new Map(taken.map((row) => [row.advance, row.recovered]));
  const result = new Map<string, { recovered: bigint; outstanding: bigint }>();
  for (const row of rows) {
    const recovered = recoveredBy.get(row.id) ?? 0n;
    const owed = row.status === 'PAID' ? row.amountVnd - recovered - (row.writtenOffVnd ?? 0n) : 0n;
    result.set(row.id, { recovered, outstanding: owed > 0n ? owed : 0n });
  }
  return result;
}

/**
 * Called when a payroll run is closed (P7-14): an advance that the closed runs have taken back in full is RECOVERED, and says when. Never
 * touches an advance that still owes something.
 */
export async function settleRecoveries(tx: Tx, now: Date): Promise<number> {
  const paid = await tx.salaryAdvance.findMany({
    where: { status: 'PAID' },
    select: { id: true, rowVersion: true },
  });
  const balances = await advanceBalances(
    tx,
    paid.map((row) => row.id),
  );
  let settled = 0;
  for (const row of paid) {
    if ((balances.get(row.id)?.outstanding ?? 1n) === 0n) {
      await tx.salaryAdvance.update({
        where: { id: row.id },
        data: { status: 'RECOVERED', recoveredAt: now, rowVersion: { increment: 1 } },
        select: { id: true },
      });
      settled += 1;
    }
  }
  return settled;
}

const SELECT = {
  id: true,
  amountVnd: true,
  status: true,
  reason: true,
  requestedAt: true,
  approvedAt: true,
  paidAt: true,
  writtenOffVnd: true,
  writeOffReason: true,
  cancelReason: true,
  rowVersion: true,
  employee: {
    select: { userId: true, employeeCodeCanonical: true, user: { select: { fullName: true } } },
  },
  requestedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  paidBy: { select: { id: true, fullName: true } },
  paidFund: { select: { id: true, name: true } },
} satisfies Prisma.SalaryAdvanceSelect;

const person = (user: { id: string; fullName: string } | null) =>
  user ? { id: user.id, name: user.fullName } : null;

export async function listAdvances(context: AdminContext): Promise<SalaryAdvancesResponse> {
  const { tx } = context;
  requireRead(context);
  const today = shopToday(context.now);
  const rows = await tx.salaryAdvance.findMany({
    orderBy: [{ seq: 'desc' }],
    take: 200,
    select: SELECT,
  });
  const balances = await advanceBalances(
    tx,
    rows.map((row) => row.id),
  );
  const items: SalaryAdvanceItem[] = rows.map((row) => ({
    id: row.id,
    employee: {
      id: row.employee.userId,
      name: row.employee.user.fullName,
      code: row.employee.employeeCodeCanonical,
    },
    amountVnd: row.amountVnd.toString(),
    status: row.status,
    reason: row.reason,
    requestedBy: person(row.requestedBy)!,
    requestedAt: row.requestedAt.toISOString(),
    approvedBy: person(row.approvedBy),
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    paidBy: person(row.paidBy),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paidFund: row.paidFund,
    recoveredVnd: (balances.get(row.id)?.recovered ?? 0n).toString(),
    writtenOffVnd: row.writtenOffVnd?.toString() ?? null,
    writeOffReason: row.writeOffReason,
    cancelReason: row.cancelReason,
    outstandingVnd: (balances.get(row.id)?.outstanding ?? 0n).toString(),
    version: row.rowVersion,
  }));
  const eligible = await eligibleEmployees(tx, today);
  const open = new Set(
    rows
      .filter((row) => ['REQUESTED', 'APPROVED', 'PAID'].includes(row.status))
      .map((row) => row.employee.userId),
  );
  let funds: AdvanceFundOption[] = [];
  if (canApprove(context)) {
    const list = await tx.cashFund.findMany({
      where: { isActive: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: { id: true, kind: true, name: true, openingBalanceVnd: true },
    });
    funds = [];
    for (const fund of list)
      funds.push({
        id: fund.id,
        kind: fund.kind,
        name: fund.name,
        balanceVnd: (await fundBalance(tx, fund)).toString(),
      });
  }
  return {
    items,
    eligible: eligible.filter((entry) => !open.has(entry.employee.id)),
    funds,
    canRequest: canRequest(context),
    canApprove: canApprove(context),
  };
}

/** Official employees today with a confirmed monthly salary, and half of it. */
async function eligibleEmployees(tx: Tx, today: string): Promise<AdvanceEligibleItem[]> {
  const official = await officialEmployees(tx, today);
  if (official.length === 0) return [];
  const [versions, profiles] = await Promise.all([
    tx.employeeSalaryVersion.findMany({
      where: { employeeUserId: { in: official.map((entry) => entry.id) } },
      select: { employeeUserId: true, amountVnd: true, effectiveFrom: true },
    }),
    tx.employeeProfile.findMany({
      where: { userId: { in: official.map((entry) => entry.id) } },
      select: { userId: true, employeeCodeCanonical: true },
    }),
  ]);
  const rows = versions.map((version) => ({
    employeeUserId: version.employeeUserId,
    amountVnd: version.amountVnd,
    effectiveFrom: day(version.effectiveFrom),
  }));
  const codes = new Map(profiles.map((entry) => [entry.userId, entry.employeeCodeCanonical]));
  const out: AdvanceEligibleItem[] = [];
  for (const entry of official) {
    const version = pickSalaryVersion(rows, entry.id, today);
    if (!version || version.amountVnd === null || version.amountVnd <= 0n) continue;
    out.push({
      employee: { id: entry.id, name: entry.name, code: codes.get(entry.id) ?? '' },
      limitVnd: ((version.amountVnd * BigInt(ADVANCE_LIMIT_PERCENT)) / 100n).toString(),
    });
  }
  return out;
}

async function view(context: AdminContext): Promise<SalaryAdvancesResponse> {
  return listAdvances(context);
}

const REQUEST_KEYS = ['employeeUserId', 'amountVnd', 'reason', 'clientRequestId'] as const;

export async function requestAdvance(
  context: AdminContext,
  request: SalaryAdvanceRequest,
): Promise<SalaryAdvancesResponse> {
  const { tx } = context;
  if (!canRequest(context)) throw new AuthError('FORBIDDEN');
  const body = exactKeys(request, REQUEST_KEYS, 'body');
  const employeeUserId = uuid(body['employeeUserId'], 'employeeUserId');
  const amount = money(body['amountVnd'], 'amountVnd', { positive: true });
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX)!;
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  if (!(await financeGoLive(tx))) throw new AuthError('FINANCE_NOT_LIVE');
  const prior = await tx.salaryAdvance.findFirst({
    where: { requestedByUserId: context.actor.userId, clientRequestId },
    select: { employeeUserId: true, amountVnd: true, reason: true },
  });
  if (prior) {
    if (
      prior.employeeUserId !== employeeUserId ||
      prior.amountVnd !== amount ||
      prior.reason !== why
    )
      throw new AuthError('CONFLICT');
    return view(context);
  }
  await tx.$queryRaw`SELECT user_id FROM employee_profiles WHERE user_id = ${employeeUserId}::uuid FOR UPDATE`;
  const eligible = (await eligibleEmployees(tx, shopToday(context.now))).find(
    (entry) => entry.employee.id === employeeUserId,
  );
  if (!eligible) throw new AuthError('ADVANCE_NOT_ELIGIBLE');
  if (
    await tx.salaryAdvance.findFirst({
      where: { employeeUserId, status: { in: ['REQUESTED', 'APPROVED', 'PAID'] } },
      select: { id: true },
    })
  ) {
    throw new AuthError('ADVANCE_OPEN_EXISTS');
  }
  if (amount > BigInt(eligible.limitVnd)) throw new AuthError('ADVANCE_LIMIT');
  const created = await tx.salaryAdvance.create({
    data: {
      employeeUserId,
      amountVnd: amount,
      reason: why,
      requestedByUserId: context.actor.userId,
      clientRequestId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'ADVANCE_REQUESTED',
    entityType: 'SalaryAdvance',
    entityId: created.id,
    subjectUserId: employeeUserId,
    reason: why,
    classification: 'EMPLOYEE_PAY',
    after: { amountVnd: amount.toString() },
  });
  return view(context);
}

async function lockAdvance(tx: Tx, idRaw: string, expectedVersion: unknown) {
  const id = uuid(idRaw, 'id');
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
  }
  await tx.$queryRaw`SELECT id FROM salary_advances WHERE id = ${id}::uuid FOR UPDATE`;
  const advance = await tx.salaryAdvance.findUnique({ where: { id } });
  if (!advance) throw new AuthError('NOT_FOUND');
  if (advance.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
  return advance;
}

export async function approveAdvance(
  context: AdminContext,
  idRaw: string,
  request: SalaryAdvanceApproveRequest,
): Promise<SalaryAdvancesResponse> {
  const { tx } = context;
  if (!canApprove(context)) throw new AuthError('FORBIDDEN');
  const body = exactKeys(request, ['expectedVersion'], 'body');
  const advance = await lockAdvance(tx, idRaw, body['expectedVersion']);
  if (advance.status !== 'REQUESTED') throw new AuthError('CONFLICT');
  await tx.salaryAdvance.update({
    where: { id: advance.id },
    data: {
      status: 'APPROVED',
      approvedAt: context.now,
      approvedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'ADVANCE_APPROVED',
    entityType: 'SalaryAdvance',
    entityId: advance.id,
    subjectUserId: advance.employeeUserId,
    classification: 'EMPLOYEE_PAY',
    after: { amountVnd: advance.amountVnd.toString() },
  });
  return view(context);
}

export async function cancelAdvance(
  context: AdminContext,
  idRaw: string,
  request: SalaryAdvanceCancelRequest,
): Promise<SalaryAdvancesResponse> {
  const { tx } = context;
  if (!canRequest(context) && !canApprove(context)) throw new AuthError('FORBIDDEN');
  const body = exactKeys(request, ['expectedVersion', 'reason'], 'body');
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX)!;
  const advance = await lockAdvance(tx, idRaw, body['expectedVersion']);
  if (advance.status !== 'REQUESTED' && advance.status !== 'APPROVED')
    throw new AuthError('CONFLICT');
  await tx.salaryAdvance.update({
    where: { id: advance.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: context.now,
      cancelledByUserId: context.actor.userId,
      cancelReason: why,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'ADVANCE_CANCELLED',
    entityType: 'SalaryAdvance',
    entityId: advance.id,
    subjectUserId: advance.employeeUserId,
    reason: why,
    classification: 'EMPLOYEE_PAY',
  });
  return view(context);
}

export async function payAdvance(
  context: AdminContext,
  idRaw: string,
  request: SalaryAdvancePayRequest,
  freshAuthSeconds: number,
): Promise<SalaryAdvancesResponse> {
  const { tx } = context;
  if (!canApprove(context)) throw new AuthError('FORBIDDEN');
  const body = exactKeys(request, ['expectedVersion', 'fundId', 'clientRequestId'], 'body');
  const fundId = uuid(body['fundId'], 'fundId');
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  if (!(await financeGoLive(tx))) throw new AuthError('FINANCE_NOT_LIVE');
  const advanceId = uuid(idRaw, 'id');
  // A retry of the same payment (same request id) returns the advance as it is.
  const replayed = await tx.fundEntry.findFirst({
    where: { actorUserId: context.actor.userId, clientRequestId },
    select: { id: true },
  });
  if (replayed) {
    const mine = await tx.salaryAdvance.findFirst({
      where: { id: advanceId, paidEntryId: replayed.id },
      select: { id: true },
    });
    if (!mine) throw new AuthError('CONFLICT');
    return view(context);
  }
  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);
  const advance = await lockAdvance(tx, idRaw, body['expectedVersion']);
  if (advance.status !== 'APPROVED') throw new AuthError('CONFLICT');
  const fund = await tx.cashFund.findUnique({
    where: { id: fundId },
    select: {
      id: true,
      kind: true,
      isActive: true,
      openingBalanceVnd: true,
      branch: { select: { id: true, timezone: true } },
    },
  });
  if (!fund || !fund.isActive) throw new AuthError('VALIDATION_FAILED', 'fundId');
  // The entry belongs to a branch: the cash fund's own, or (the bank) a branch the person works at.
  const assignment = fund.branch
    ? null
    : await tx.employeeBranchAssignment.findFirst({
        where: {
          employeeUserId: advance.employeeUserId,
          revokedAt: null,
          branch: { isActive: true },
        },
        orderBy: { id: 'asc' },
        select: { branch: { select: { id: true, timezone: true } } },
      });
  const branch = fund.branch ?? assignment?.branch ?? null;
  if (!branch) throw new AuthError('VALIDATION_FAILED', 'fundId');
  await lockFunds(tx, [fund.id], true);
  if (fund.kind === 'CASH' && (await fundBalance(tx, fund)) < advance.amountVnd)
    throw new AuthError('CASH_INSUFFICIENT');
  const entry = await tx.fundEntry.create({
    data: {
      fundId: fund.id,
      branchId: branch.id,
      businessDate: await openDay(tx, fund, branch.timezone, context.now),
      direction: 'OUT',
      category: 'ADVANCE',
      amountVnd: advance.amountVnd,
      sourceType: 'SALARY_ADVANCE',
      sourceId: advance.id,
      sourceLeg: 0,
      actorUserId: context.actor.userId,
      clientRequestId,
    },
    select: { id: true },
  });
  await tx.salaryAdvance.update({
    where: { id: advance.id },
    data: {
      status: 'PAID',
      paidAt: context.now,
      paidByUserId: context.actor.userId,
      paidFundId: fund.id,
      paidEntryId: entry.id,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await spendConfirmation(context, confirmedAt, 'ADVANCE_PAY', advance.id);
  await appendAdminAudit(context, {
    action: 'ADVANCE_PAID',
    entityType: 'SalaryAdvance',
    entityId: advance.id,
    subjectUserId: advance.employeeUserId,
    classification: 'FINANCIAL',
    after: { amountVnd: advance.amountVnd.toString(), fundId: fund.id },
  });
  return view(context);
}

export async function writeOffAdvance(
  context: AdminContext,
  idRaw: string,
  request: SalaryAdvanceWriteOffRequest,
  freshAuthSeconds: number,
): Promise<SalaryAdvancesResponse> {
  const { tx } = context;
  if (!canApprove(context)) throw new AuthError('FORBIDDEN');
  const body = exactKeys(request, ['expectedVersion', 'reason'], 'body');
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX)!;
  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);
  const advance = await lockAdvance(tx, idRaw, body['expectedVersion']);
  if (advance.status !== 'PAID') throw new AuthError('CONFLICT');
  const owed = (await advanceBalances(tx, [advance.id])).get(advance.id)?.outstanding ?? 0n;
  if (owed <= 0n) throw new AuthError('CONFLICT');
  await tx.salaryAdvance.update({
    where: { id: advance.id },
    data: {
      status: 'WRITTEN_OFF',
      writtenOffAt: context.now,
      writtenOffByUserId: context.actor.userId,
      writtenOffVnd: owed,
      writeOffReason: why,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await spendConfirmation(context, confirmedAt, 'ADVANCE_WRITE_OFF', advance.id);
  await appendAdminAudit(context, {
    action: 'ADVANCE_WRITTEN_OFF',
    entityType: 'SalaryAdvance',
    entityId: advance.id,
    subjectUserId: advance.employeeUserId,
    reason: why,
    classification: 'FINANCIAL',
    after: { writtenOffVnd: owed.toString() },
  });
  return view(context);
}
