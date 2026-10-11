import {
  PAY_REASON_MAX,
  type MyPayslipsResponse,
  type PayRunCloseRequest,
  type PayRunDetailResponse,
  type PayRunItemView,
  type PayslipListResponse,
  type PayslipPayRequest,
  type PayslipReverseRequest,
  type PayslipSummary,
  type PayslipView,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { fundBalance, lockFunds, openDay } from '../finance/cash-entries.core.js';
import { financeGoLive } from '../finance/cash.core.js';
import { exactKeys, reason, uuid } from '../finance/finance.input.js';
import { spendConfirmation, takeFreshConfirmation } from '../finance/finance.reauth.js';
import { settleRecoveries } from './pay-advances.core.js';
import { presentItem, runDetail } from './pay-runs.core.js';
import { holdsPayrollShopWide, shopToday } from './pay.access.js';

/**
 * Phase 7 P7-14 (design 4.3; P7-T3, P7-T10, P7-T12): closing a payroll run, its payslips, and marking them paid.
 *
 * - **Close** (`APPROVE_PAYROLL` + a fresh password, the version the person saw): refused while the draft is behind its sources, has no payment day,
 *   has a person whose base salary is unconfirmed or missing, or a negative net. It freezes the run, takes the earnings, tips and agreed
 *   collaborator work it shows (the database then refuses any change to them), makes one payslip per person with its own printed totals, and
 *   settles advances that are recovered in full. Nobody is paid.
 * - **Pay** (`APPROVE_PAYROLL` + a fresh password, not before the payment day): net pay and tips are two separate entries in a fund the payer
 *   chooses (a cash fund must hold the money); payslips can be paid one by one or all together; nothing happens twice.
 * - **Reverse** a mistaken paid mark (same authority and password, a reason): the book gets correcting entries and the payslip says it was
 *   reversed. The run is never reopened; the person is owed again and the correction is an adjustment in the next run.
 */
type Tx = Prisma.TransactionClient;
const GLOBAL = { kind: 'GLOBAL' } as const;
const day = (value: Date): string => value.toISOString().slice(0, 10);
const canApprove = (context: AdminContext): boolean =>
  decide(context.actor.graph, 'APPROVE_PAYROLL', GLOBAL);

const version = (value: unknown, field = 'expectedVersion'): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
};

// ------------------------------------------------------------------------------------------------ close
export async function closeRun(
  context: AdminContext,
  runIdRaw: string,
  request: PayRunCloseRequest,
  freshAuthSeconds: number,
): Promise<PayRunDetailResponse> {
  const { tx } = context;
  if (!canApprove(context)) throw new AuthError('FORBIDDEN');
  const runId = uuid(runIdRaw, 'id');
  const body = exactKeys(request, ['expectedVersion'], 'body');
  const expected = version(body['expectedVersion']);
  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);
  await tx.$queryRaw`SELECT id FROM pay_runs WHERE id = ${runId}::uuid FOR UPDATE`;
  const run = await tx.payRun.findUnique({ where: { id: runId } });
  if (!run) throw new AuthError('NOT_FOUND');
  if (run.status !== 'DRAFT') throw new AuthError('PAY_RUN_NOT_DRAFT');
  if (run.rowVersion !== expected) throw new AuthError('CONFLICT');
  const view = await runDetail(context, runId);
  if (view.stale) throw new AuthError('PAY_RUN_STALE');
  if (run.paymentDay === null) throw new AuthError('PAY_RUN_BLOCKED', 'paymentDay');
  if (view.lines.length === 0) throw new AuthError('PAY_RUN_BLOCKED', 'lines');
  if (view.warnings.unconfirmedBase > 0 || view.warnings.noBase > 0)
    throw new AuthError('PAY_RUN_BLOCKED', 'base');
  if (view.warnings.negativeNet > 0) throw new AuthError('PAY_RUN_BLOCKED', 'negative');
  const last = view.run.periodTo;

  await tx.payRun.update({
    where: { id: runId },
    data: {
      status: 'CLOSED',
      closedAt: context.now,
      closedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });

  // What the run takes, and the proof that it is exactly what the person saw.
  const taken = new Map<string, bigint>();
  const add = (employee: string, kind: string, amount: bigint) => {
    const key = `${employee}|${kind}`;
    taken.set(key, (taken.get(key) ?? 0n) + amount);
  };
  const earned = await tx.$queryRaw<{ employee: string; kind: string; amount: bigint }[]>`
    UPDATE pay_earnings SET run_id = ${runId}::uuid
    WHERE run_id IS NULL AND business_date <= ${last}::date
    RETURNING employee_user_id::text AS employee, kind::text AS kind, amount_vnd AS amount`;
  for (const row of earned)
    add(row.employee, row.kind === 'TOUR' ? 'TOUR' : 'COMMISSION', row.amount);
  const tipRows = await tx.$queryRaw<{ employee: string; amount: bigint }[]>`
    UPDATE tips SET run_id = ${runId}::uuid
    WHERE run_id IS NULL AND business_date <= ${last}::date
    RETURNING employee_user_id::text AS employee, amount_vnd AS amount`;
  for (const row of tipRows) add(row.employee, 'TIP', row.amount);
  const work = await tx.$queryRaw<{ employee: string; amount: bigint }[]>`
    UPDATE collaborator_work_occurrences SET pay_run_id = ${runId}::uuid, row_version = row_version + 1
    WHERE status = 'SCHEDULED' AND pay_run_id IS NULL AND work_date <= ${last}::date AND agreed_pay_vnd IS NOT NULL
    RETURNING employee_user_id::text AS employee, agreed_pay_vnd AS amount`;
  for (const row of work) add(row.employee, 'CTV_WORK', row.amount);
  const shown = new Map<string, bigint>();
  for (const line of view.lines) {
    for (const item of line.items) {
      if (['TOUR', 'COMMISSION', 'TIP', 'CTV_WORK'].includes(item.kind) && !item.voided) {
        const key = `${line.employee.id}|${item.kind}`;
        shown.set(key, (shown.get(key) ?? 0n) + BigInt(item.amountVnd));
      }
    }
  }
  for (const key of new Set([...taken.keys(), ...shown.keys()])) {
    if ((taken.get(key) ?? 0n) !== (shown.get(key) ?? 0n)) {
      // Something moved between the preview and the closing: nothing is taken, the person looks again.
      throw new AuthError('PAY_RUN_STALE');
    }
  }

  // One payslip per person, with its own printed totals.
  const lines = await tx.payRunLine.findMany({
    where: { runId },
    select: { id: true, employeeUserId: true },
  });
  for (const line of view.lines) {
    const row = lines.find((entry) => entry.id === line.id)!;
    await tx.payslip.create({
      data: {
        runId,
        lineId: row.id,
        employeeUserId: row.employeeUserId,
        netVnd: BigInt(line.netVnd),
        tipsVnd: BigInt(line.tipsVnd),
      },
      select: { id: true },
    });
  }
  await settleRecoveries(tx, context.now);
  await spendConfirmation(context, confirmedAt, 'PAYROLL_CLOSE', runId);
  await appendAdminAudit(context, {
    action: 'PAY_RUN_CLOSED',
    entityType: 'PayRun',
    entityId: runId,
    classification: 'EMPLOYEE_PAY',
    after: {
      month: view.run.month,
      payVnd: view.totals.payVnd,
      tipsVnd: view.totals.tipsVnd,
      people: view.totals.people,
    },
  });
  return runDetail(context, runId);
}

// ------------------------------------------------------------------------------------------------ reading payslips
const SLIP_SELECT = {
  id: true,
  runId: true,
  netVnd: true,
  tipsVnd: true,
  status: true,
  paidAt: true,
  rowVersion: true,
  employee: {
    select: { userId: true, employeeCodeCanonical: true, user: { select: { fullName: true } } },
  },
  run: { select: { periodMonth: true, paymentDay: true, status: true } },
} satisfies Prisma.PayslipSelect;
type SlipRow = Prisma.PayslipGetPayload<{ select: typeof SLIP_SELECT }>;

function summary(row: SlipRow): PayslipSummary {
  return {
    id: row.id,
    runId: row.runId,
    month: day(row.run.periodMonth).slice(0, 7),
    employee: {
      id: row.employee.userId,
      name: row.employee.user.fullName,
      code: row.employee.employeeCodeCanonical,
    },
    netVnd: row.netVnd.toString(),
    tipsVnd: row.tipsVnd.toString(),
    status: row.status,
    paymentDay: row.run.paymentDay ? day(row.run.paymentDay) : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    version: row.rowVersion,
  };
}

export async function listPayslips(
  context: AdminContext,
  runIdRaw: string,
): Promise<PayslipListResponse> {
  const { tx } = context;
  if (!holdsPayrollShopWide(context)) throw new AuthError('FORBIDDEN');
  const runId = uuid(runIdRaw, 'id');
  const view = await runDetail(context, runId);
  const rows = await tx.payslip.findMany({ where: { runId }, select: SLIP_SELECT });
  rows.sort(
    (a, b) =>
      a.employee.user.fullName.localeCompare(b.employee.user.fullName, 'vi') ||
      a.id.localeCompare(b.id),
  );
  let funds: PayslipListResponse['funds'] = [];
  if (canApprove(context) && view.run.status === 'CLOSED') {
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
  const payable = view.run.paymentDay !== null && shopToday(context.now) >= view.run.paymentDay;
  return {
    run: {
      ...view.run,
      periodFrom: view.run.periodFrom,
      periodTo: view.run.periodTo,
      closedAt: view.run.closedAt,
    },
    items: rows.map(summary),
    funds,
    canPay: canApprove(context),
    payable,
  };
}

async function viewOf(tx: Tx, id: string): Promise<PayslipView> {
  const row = await tx.payslip.findUnique({
    where: { id },
    select: {
      ...SLIP_SELECT,
      line: {
        select: {
          items: {
            where: { voidedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              kind: true,
              amountVnd: true,
              generated: true,
              quantity: true,
              lateVnd: true,
              flag: true,
              note: true,
              advanceId: true,
              reason: true,
              voidedAt: true,
              voidReason: true,
              createdAt: true,
              createdBy: { select: { id: true, fullName: true } },
            },
          },
        },
      },
      paidBy: { select: { id: true, fullName: true } },
      paidFund: { select: { id: true, name: true } },
      reversedAt: true,
      reversedBy: { select: { id: true, fullName: true } },
      reversalReason: true,
    },
  });
  if (!row) throw new AuthError('NOT_FOUND');
  const last = new Date(
    Date.UTC(row.run.periodMonth.getUTCFullYear(), row.run.periodMonth.getUTCMonth() + 1, 0),
  );
  const order = [
    'BASE_SALARY',
    'CTV_WORK',
    'TOUR',
    'COMMISSION',
    'BONUS',
    'ADJUSTMENT',
    'DEDUCTION',
    'ADVANCE_RECOVERY',
    'TIP',
  ];
  const items: PayRunItemView[] = row.line.items
    .map(presentItem)
    .sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) || a.createdAt.localeCompare(b.createdAt),
    );
  const person = (user: { id: string; fullName: string } | null) =>
    user ? { id: user.id, name: user.fullName } : null;
  return {
    ...summary(row),
    periodFrom: day(row.run.periodMonth),
    periodTo: day(last),
    items,
    paidBy: person(row.paidBy),
    paidFund: row.paidFund,
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    reversedBy: person(row.reversedBy),
    reversalReason: row.reversalReason,
  };
}

/** One payslip for the people who run payroll. */
export async function payslipOf(context: AdminContext, idRaw: string): Promise<PayslipView> {
  if (!holdsPayrollShopWide(context)) throw new AuthError('FORBIDDEN');
  return viewOf(context.tx, uuid(idRaw, 'id'));
}

/** The signed-in employee's own payslips: no permission is needed for one's own pay, and nobody else's is ever returned. */
export async function myPayslips(context: AdminContext): Promise<MyPayslipsResponse> {
  const rows = await context.tx.payslip.findMany({
    where: { employeeUserId: context.actor.userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 120,
    select: SLIP_SELECT,
  });
  return { items: rows.map(summary) };
}

export async function myPayslip(context: AdminContext, idRaw: string): Promise<PayslipView> {
  const id = uuid(idRaw, 'id');
  const owns = await context.tx.payslip.findFirst({
    where: { id, employeeUserId: context.actor.userId },
    select: { id: true },
  });
  if (!owns) throw new AuthError('NOT_FOUND');
  return viewOf(context.tx, id);
}

// ------------------------------------------------------------------------------------------------ paying
const PAY_KEYS = ['expectedVersion', 'fundId', 'payslipIds', 'clientRequestId'] as const;

export async function payPayslips(
  context: AdminContext,
  runIdRaw: string,
  request: PayslipPayRequest,
  freshAuthSeconds: number,
): Promise<PayslipListResponse> {
  const { tx } = context;
  if (!canApprove(context)) throw new AuthError('FORBIDDEN');
  const runId = uuid(runIdRaw, 'id');
  const body = exactKeys(request, PAY_KEYS, 'body');
  const expected = version(body['expectedVersion']);
  const fundId = uuid(body['fundId'], 'fundId');
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  const idsRaw = body['payslipIds'];
  let wanted: string[] | null = null;
  if (idsRaw !== null) {
    if (!Array.isArray(idsRaw) || idsRaw.length === 0 || idsRaw.length > 500)
      throw new AuthError('VALIDATION_FAILED', 'payslipIds');
    wanted = [...new Set(idsRaw.map((value) => uuid(value, 'payslipIds')))];
  }
  if (!(await financeGoLive(tx))) throw new AuthError('FINANCE_NOT_LIVE');
  const replayed = await tx.fundEntry.findFirst({
    where: { actorUserId: context.actor.userId, clientRequestId },
    select: { id: true },
  });
  if (replayed) {
    const mine = await tx.payslip.findFirst({
      where: { runId, OR: [{ netEntryId: replayed.id }, { tipsEntryId: replayed.id }] },
      select: { id: true },
    });
    if (!mine) throw new AuthError('CONFLICT');
    return listPayslips(context, runId);
  }
  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);
  await tx.$queryRaw`SELECT id FROM pay_runs WHERE id = ${runId}::uuid FOR UPDATE`;
  const run = await tx.payRun.findUnique({ where: { id: runId } });
  if (!run) throw new AuthError('NOT_FOUND');
  if (run.status !== 'CLOSED') throw new AuthError('PAY_RUN_NOT_CLOSED');
  if (run.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (run.paymentDay === null || shopToday(context.now) < day(run.paymentDay))
    throw new AuthError('PAY_RUN_NOT_YET');
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
  const pending = await tx.payslip.findMany({
    where: { runId, status: 'PENDING', ...(wanted ? { id: { in: wanted } } : {}) },
    orderBy: { id: 'asc' },
    select: { id: true, employeeUserId: true, netVnd: true, tipsVnd: true, rowVersion: true },
  });
  if (pending.length === 0 || (wanted !== null && pending.length !== wanted.length))
    throw new AuthError('CONFLICT');
  const total = pending.reduce((sum, slip) => sum + slip.netVnd + slip.tipsVnd, 0n);
  await lockFunds(tx, [fund.id], true);
  if (fund.kind === 'CASH' && total > 0n && (await fundBalance(tx, fund)) < total)
    throw new AuthError('CASH_INSUFFICIENT');

  const branchOf = async (employeeUserId: string) => {
    if (fund.branch) return fund.branch;
    const assignment = await tx.employeeBranchAssignment.findFirst({
      where: { employeeUserId, revokedAt: null, branch: { isActive: true } },
      orderBy: { id: 'asc' },
      select: { branch: { select: { id: true, timezone: true } } },
    });
    if (assignment) return assignment.branch;
    // The bank account is the shop's: when the person works at no active branch the entry is booked at the first active branch.
    const any = await tx.branch.findFirst({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, timezone: true },
    });
    if (!any) throw new AuthError('VALIDATION_FAILED', 'fundId');
    return any;
  };
  let first = true;
  for (const slip of pending) {
    const branch =
      slip.netVnd > 0n || slip.tipsVnd > 0n ? await branchOf(slip.employeeUserId) : null;
    const entry = async (category: 'SALARY_PAYOUT' | 'TIP_OUT', amount: bigint, leg: number) => {
      const created = await tx.fundEntry.create({
        data: {
          fundId: fund.id,
          branchId: branch!.id,
          businessDate: await openDay(tx, fund, branch!.timezone, context.now),
          direction: 'OUT',
          category,
          amountVnd: amount,
          sourceType: 'PAYSLIP',
          sourceId: slip.id,
          sourceLeg: leg,
          actorUserId: context.actor.userId,
          // The retry key sits on the first entry of the whole payment.
          ...(first ? { clientRequestId } : {}),
        },
        select: { id: true },
      });
      first = false;
      return created.id;
    };
    const netEntryId = slip.netVnd > 0n ? await entry('SALARY_PAYOUT', slip.netVnd, 0) : null;
    const tipsEntryId = slip.tipsVnd > 0n ? await entry('TIP_OUT', slip.tipsVnd, 1) : null;
    await tx.payslip.update({
      where: { id: slip.id },
      data: {
        status: 'PAID',
        paidAt: context.now,
        paidByUserId: context.actor.userId,
        paidFundId: netEntryId || tipsEntryId ? fund.id : null,
        netEntryId,
        tipsEntryId,
        rowVersion: { increment: 1 },
      },
      select: { id: true },
    });
  }
  const left = await tx.payslip.count({ where: { runId, status: 'PENDING' } });
  await tx.payRun.update({
    where: { id: runId },
    data: {
      rowVersion: { increment: 1 },
      ...(left === 0 ? { status: 'PAID', paidAt: context.now } : {}),
    },
    select: { id: true },
  });
  await spendConfirmation(context, confirmedAt, 'PAYROLL_PAY', runId);
  await appendAdminAudit(context, {
    action: 'PAYSLIPS_PAID',
    entityType: 'PayRun',
    entityId: runId,
    classification: 'FINANCIAL',
    after: { payslips: pending.length, totalVnd: total.toString(), fundId: fund.id },
  });
  return listPayslips(context, runId);
}

export async function reversePayslipPayment(
  context: AdminContext,
  payslipIdRaw: string,
  request: PayslipReverseRequest,
  freshAuthSeconds: number,
): Promise<PayslipView> {
  const { tx } = context;
  if (!canApprove(context)) throw new AuthError('FORBIDDEN');
  const id = uuid(payslipIdRaw, 'id');
  const body = exactKeys(request, ['expectedVersion', 'reason'], 'body');
  const expected = version(body['expectedVersion']);
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX)!;
  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);
  await tx.$queryRaw`SELECT id FROM payslips WHERE id = ${id}::uuid FOR UPDATE`;
  const slip = await tx.payslip.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      rowVersion: true,
      employeeUserId: true,
      netEntryId: true,
      tipsEntryId: true,
      paidFundId: true,
      run: { select: { id: true } },
    },
  });
  if (!slip) throw new AuthError('NOT_FOUND');
  if (slip.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (slip.status !== 'PAID') throw new AuthError('CONFLICT');
  const entries = await tx.fundEntry.findMany({
    where: {
      id: {
        in: [slip.netEntryId, slip.tipsEntryId].filter((value): value is string => value !== null),
      },
    },
    select: {
      id: true,
      fundId: true,
      branchId: true,
      amountVnd: true,
      fund: { select: { kind: true, branch: { select: { timezone: true } } } },
    },
  });
  if (entries.length > 0)
    await lockFunds(tx, [...new Set(entries.map((entry) => entry.fundId))], true);
  for (const entry of entries) {
    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: entry.branchId },
      select: { timezone: true },
    });
    await tx.fundEntry.create({
      data: {
        fundId: entry.fundId,
        branchId: entry.branchId,
        businessDate: await openDay(
          tx,
          { id: entry.fundId, kind: entry.fund.kind },
          branch.timezone,
          context.now,
        ),
        direction: 'IN',
        category: 'CORRECTION',
        amountVnd: entry.amountVnd,
        reversesEntryId: entry.id,
        reason: why,
        actorUserId: context.actor.userId,
      },
      select: { id: true },
    });
  }
  await tx.payslip.update({
    where: { id },
    data: {
      status: 'REVERSED',
      reversedAt: context.now,
      reversedByUserId: context.actor.userId,
      reversalReason: why,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await spendConfirmation(context, confirmedAt, 'PAYROLL_PAY', id);
  await appendAdminAudit(context, {
    action: 'PAYSLIP_PAYMENT_REVERSED',
    entityType: 'Payslip',
    entityId: id,
    subjectUserId: slip.employeeUserId,
    reason: why,
    classification: 'FINANCIAL',
  });
  return viewOf(tx, id);
}
