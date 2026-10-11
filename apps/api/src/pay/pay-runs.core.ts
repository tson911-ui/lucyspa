import {
  PAY_MANUAL_ITEM_KINDS,
  PAY_PAYMENT_DAY_MAX_DAYS,
  PAY_REASON_MAX,
  type PayLineWarningName,
  type PayManualItemKindName,
  type PayRunCreateRequest,
  type PayRunDetailResponse,
  type PayRunItemKindName,
  type PayRunItemRequest,
  type PayRunItemVoidRequest,
  type PayRunItemView,
  type PayRunLineView,
  type PayRunListResponse,
  type PayRunPaymentDayRequest,
  type PayRunRefreshRequest,
  type PayRunSummary,
} from '@lucy-spa/contracts';
import { Prisma as PrismaRuntime, type Prisma } from '@lucy-spa/database';
import { pickSalaryVersion, type SalaryVersionRow } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { financeGoLive } from '../finance/cash.core.js';
import { exactKeys, reason, uuid } from '../finance/finance.input.js';
import { advanceBalances } from './pay-advances.core.js';
import { officialEmployees } from './pay-rules.core.js';
import { addDays, canManagePayroll, holdsPayrollShopWide, shopToday } from './pay.access.js';

/**
 * Phase 7 P7-12 (design 4.3; P7-T3, P7-T11, P7-T14; Owner answers 5 and 10): the monthly payroll run, as a draft. One run per calendar month
 * for the whole shop. The draft is built from the sources and rebuilt on refresh: base salary in force on the LAST day of the month for
 * whoever is an official employee then, the tour and the commission earned and not yet in a closed run (late items from earlier months are
 * included and marked), collaborator work agreed for the month, and the tips owed (shown apart; never part of the net). Manual items
 * (bonus, adjustment, deduction) are typed with a reason and survive a refresh; a mistaken one is voided with a reason, never edited.
 * Attendance and leave are context only: nothing is deducted automatically (PRD §61). Nothing here pays anyone and nothing is created
 * until a person with MANAGE_PAYROLL presses the button; the Owner's approval (closing) and the paying come with P7-14.
 */
type Tx = Prisma.TransactionClient;
const day = (value: Date): string => value.toISOString().slice(0, 10);
const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const requireRead = (context: AdminContext): void => {
  if (!holdsPayrollShopWide(context)) throw new AuthError('FORBIDDEN');
};
const requireManage = (context: AdminContext): void => {
  if (!canManagePayroll(context)) throw new AuthError('FORBIDDEN');
};

function monthStart(value: unknown, field: string): string {
  if (typeof value !== 'string' || !MONTH.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  return `${value}-01`;
}

function lastDayOf(first: string): string {
  const date = asDate(first);
  return day(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

// ------------------------------------------------------------------------------------------------ generation
interface Generated {
  employeeUserId: string;
  kind: PayRunItemKindName;
  amountVnd: bigint;
  quantity: number | null;
  lateVnd: bigint;
  flag: 'UNCONFIRMED_BASE' | 'NO_BASE' | 'UNAGREED' | null;
  note: string | null;
  advanceId?: string | null;
}

/** Everything the draft is made of, read from the sources (writes nothing). */
async function generate(tx: Tx, first: string, runId: string | null = null): Promise<Generated[]> {
  const last = lastDayOf(first);
  const out: Generated[] = [];

  // Base salary: official on the last day, the salary version in force that day.
  const official = await officialEmployees(tx, last);
  const ids = official.map((person) => person.id);
  const [versions, profiles] = await Promise.all([
    tx.employeeSalaryVersion.findMany({
      where: { employeeUserId: { in: ids } },
      select: { employeeUserId: true, amountVnd: true, effectiveFrom: true },
    }),
    tx.employeeProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, baseSalaryVnd: true },
    }),
  ]);
  const rows: SalaryVersionRow[] = versions.map((version) => ({
    employeeUserId: version.employeeUserId,
    amountVnd: version.amountVnd,
    effectiveFrom: day(version.effectiveFrom),
  }));
  const profile = new Map(profiles.map((row) => [row.userId, row.baseSalaryVnd]));
  for (const person of official) {
    const version = pickSalaryVersion(rows, person.id, last);
    if (version) {
      // "No salary from that date" is an explicit decision: no item.
      if (version.amountVnd !== null) {
        out.push({
          employeeUserId: person.id,
          kind: 'BASE_SALARY',
          amountVnd: version.amountVnd,
          quantity: null,
          lateVnd: 0n,
          flag: null,
          note: null,
        });
      }
      continue;
    }
    const old = profile.get(person.id) ?? null;
    out.push({
      employeeUserId: person.id,
      kind: 'BASE_SALARY',
      amountVnd: old ?? 0n,
      quantity: null,
      lateVnd: 0n,
      flag: old === null ? 'NO_BASE' : 'UNCONFIRMED_BASE',
      note: null,
    });
  }

  // Tour and commission earned and not yet in a run (reversals are rows too, so a refund already reduces the sum).
  const earned = await tx.$queryRaw<
    { employee: string; kind: string; total: bigint; late: bigint; standing: bigint }[]
  >`
    SELECT e.employee_user_id::text AS employee, e.kind::text AS kind,
           SUM(e.amount_vnd)::bigint AS total,
           SUM(CASE WHEN e.business_date < ${first}::date THEN e.amount_vnd ELSE 0 END)::bigint AS late,
           COUNT(*) FILTER (WHERE e.reverses_id IS NULL
             AND e.amount_vnd + COALESCE((SELECT SUM(r.amount_vnd) FROM pay_earnings r WHERE r.reverses_id = e.id), 0) > 0)::bigint AS standing
    FROM pay_earnings e
    WHERE e.run_id IS NULL AND e.business_date <= ${last}::date
    GROUP BY e.employee_user_id, e.kind`;
  for (const row of earned) {
    if (row.total === 0n) continue;
    out.push({
      employeeUserId: row.employee,
      kind: row.kind === 'TOUR' ? 'TOUR' : 'COMMISSION',
      amountVnd: row.total,
      quantity: Number(row.standing),
      lateVnd: row.late,
      flag: null,
      note: null,
    });
  }

  // Collaborator work agreed for the month; work without an agreed amount is counted, never added as 0.
  const work = await tx.$queryRaw<
    { employee: string; total: bigint; count: bigint; unagreed: bigint }[]
  >`
    SELECT o.employee_user_id::text AS employee, COALESCE(SUM(o.agreed_pay_vnd), 0)::bigint AS total,
           COUNT(*)::bigint AS count, COUNT(*) FILTER (WHERE o.agreed_pay_vnd IS NULL)::bigint AS unagreed
    FROM collaborator_work_occurrences o
    WHERE o.status = 'SCHEDULED' AND o.work_date BETWEEN ${first}::date AND ${last}::date
    GROUP BY o.employee_user_id`;
  for (const row of work) {
    out.push({
      employeeUserId: row.employee,
      kind: 'CTV_WORK',
      amountVnd: row.total,
      quantity: Number(row.count),
      lateVnd: 0n,
      flag: row.unagreed > 0n ? 'UNAGREED' : null,
      note: row.unagreed > 0n ? String(row.unagreed) : null,
    });
  }

  // Tips owed (net of reversals); shown on their own line of the payslip.
  const tips = await tx.$queryRaw<
    { employee: string; total: bigint; late: bigint; standing: bigint }[]
  >`
    SELECT t.employee_user_id::text AS employee, SUM(t.amount_vnd)::bigint AS total,
           SUM(CASE WHEN t.business_date < ${first}::date THEN t.amount_vnd ELSE 0 END)::bigint AS late,
           COUNT(*) FILTER (WHERE t.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM tips r WHERE r.reverses_id = t.id))::bigint AS standing
    FROM tips t
    WHERE t.run_id IS NULL AND t.business_date <= ${last}::date
    GROUP BY t.employee_user_id`;
  for (const row of tips) {
    if (row.total <= 0n) continue;
    out.push({
      employeeUserId: row.employee,
      kind: 'TIP',
      amountVnd: row.total,
      quantity: Number(row.standing),
      lateVnd: row.late,
      flag: null,
      note: null,
    });
  }

  // Suggested recovery of paid advances: what is still owed, never more than the net pay available (the rest waits for the next run).
  const owing = await tx.salaryAdvance.findMany({
    where: { status: 'PAID' },
    orderBy: { seq: 'asc' },
    select: { id: true, employeeUserId: true },
  });
  if (owing.length > 0) {
    const balances = await advanceBalances(
      tx,
      owing.map((row) => row.id),
    );
    const net = new Map<string, bigint>();
    for (const item of out) {
      if (item.kind !== 'TIP') {
        net.set(item.employeeUserId, (net.get(item.employeeUserId) ?? 0n) + item.amountVnd);
      }
    }
    if (runId) {
      const manual = await tx.payRunItem.findMany({
        where: { runId, generated: false, voidedAt: null },
        select: { amountVnd: true, line: { select: { employeeUserId: true } } },
      });
      for (const item of manual) {
        const who = item.line.employeeUserId;
        net.set(who, (net.get(who) ?? 0n) + item.amountVnd);
      }
    }
    for (const row of owing) {
      const outstanding = balances.get(row.id)?.outstanding ?? 0n;
      const available = net.get(row.employeeUserId) ?? 0n;
      const take = outstanding < available ? outstanding : available;
      if (outstanding <= 0n || take <= 0n) continue;
      out.push({
        employeeUserId: row.employeeUserId,
        kind: 'ADVANCE_RECOVERY',
        amountVnd: -take,
        quantity: null,
        lateVnd: 0n,
        flag: null,
        note: null,
        advanceId: row.id,
      });
      net.set(row.employeeUserId, available - take);
    }
  }
  return out;
}

const signature = (item: Generated): string =>
  [
    item.employeeUserId,
    item.kind,
    item.amountVnd,
    item.quantity ?? '',
    item.lateVnd,
    item.flag ?? '',
    item.note ?? '',
    item.advanceId ?? '',
  ].join('|');

/** Writes the generated items of a DRAFT run again from the sources; manual items and the lines they sit on are kept. */
async function rebuild(context: AdminContext, runId: string, first: string): Promise<void> {
  const { tx } = context;
  const items = await generate(tx, first, runId);
  await tx.payRunItem.deleteMany({ where: { runId, generated: true } });
  const lines = new Map(
    (
      await tx.payRunLine.findMany({ where: { runId }, select: { id: true, employeeUserId: true } })
    ).map((line) => [line.employeeUserId, line.id]),
  );
  for (const employeeUserId of new Set(items.map((item) => item.employeeUserId))) {
    if (!lines.has(employeeUserId)) {
      const line = await tx.payRunLine.create({
        data: { runId, employeeUserId },
        select: { id: true },
      });
      lines.set(employeeUserId, line.id);
    }
  }
  if (items.length > 0) {
    await tx.payRunItem.createMany({
      data: items.map((item) => ({
        runId,
        lineId: lines.get(item.employeeUserId)!,
        kind: item.kind,
        amountVnd: item.amountVnd,
        generated: true,
        quantity: item.quantity,
        lateVnd: item.lateVnd,
        flag: item.flag,
        note: item.note,
        advanceId: item.advanceId ?? null,
        createdByUserId: context.actor.userId,
      })),
    });
  }
  // A person with nothing left in the run (no generated item, no manual item) is dropped from it.
  const empty = await tx.payRunLine.findMany({
    where: { runId, items: { none: {} } },
    select: { id: true },
  });
  if (empty.length > 0)
    await tx.payRunLine.deleteMany({ where: { id: { in: empty.map((line) => line.id) } } });
}

// ------------------------------------------------------------------------------------------------ reading
const ITEM_SELECT = {
  id: true,
  lineId: true,
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
} satisfies Prisma.PayRunItemSelect;

function totalsOf(items: readonly { kind: string; amountVnd: bigint; voided: boolean }[]): {
  net: bigint;
  tips: bigint;
} {
  let net = 0n;
  let tips = 0n;
  for (const item of items) {
    if (item.voided) continue;
    if (item.kind === 'TIP') tips += item.amountVnd;
    else net += item.amountVnd;
  }
  return { net, tips };
}

async function summaries(
  tx: Tx,
  runs: readonly { id: string }[],
): Promise<Map<string, { people: number; net: bigint; tips: bigint }>> {
  const result = new Map<string, { people: number; net: bigint; tips: bigint }>();
  if (runs.length === 0) return result;
  const rows = await tx.$queryRaw<{ run: string; people: bigint; net: bigint; tips: bigint }[]>`
    SELECT r.id::text AS run,
           (SELECT count(*) FROM pay_run_lines l WHERE l.run_id = r.id)::bigint AS people,
           COALESCE((SELECT SUM(i.amount_vnd) FROM pay_run_items i WHERE i.run_id = r.id AND i.voided_at IS NULL AND i.kind <> 'TIP'), 0)::bigint AS net,
           COALESCE((SELECT SUM(i.amount_vnd) FROM pay_run_items i WHERE i.run_id = r.id AND i.voided_at IS NULL AND i.kind = 'TIP'), 0)::bigint AS tips
    FROM pay_runs r WHERE r.id IN (${PrismaRuntime.join(runs.map((run) => PrismaRuntime.sql`${run.id}::uuid`))})`;
  for (const row of rows)
    result.set(row.run, { people: Number(row.people), net: row.net, tips: row.tips });
  return result;
}

function summaryOf(
  run: {
    id: string;
    periodMonth: Date;
    status: 'DRAFT' | 'CLOSED' | 'PAID';
    paymentDay: Date | null;
    rowVersion: number;
  },
  total: { people: number; net: bigint; tips: bigint } | undefined,
): PayRunSummary {
  return {
    id: run.id,
    month: day(run.periodMonth).slice(0, 7),
    status: run.status,
    paymentDay: run.paymentDay ? day(run.paymentDay) : null,
    version: run.rowVersion,
    people: total?.people ?? 0,
    payVnd: (total?.net ?? 0n).toString(),
    tipsVnd: (total?.tips ?? 0n).toString(),
  };
}

export async function listRuns(context: AdminContext): Promise<PayRunListResponse> {
  const { tx } = context;
  requireRead(context);
  const today = shopToday(context.now);
  const [runs, live] = await Promise.all([
    tx.payRun.findMany({ orderBy: { periodMonth: 'desc' }, take: 120 }),
    financeGoLive(tx),
  ]);
  const totals = await summaries(tx, runs);
  const firstMonth = live ? shopToday(live.at).slice(0, 7) : null;
  const taken = new Set(runs.map((run) => day(run.periodMonth).slice(0, 7)));
  let suggestedMonth: string | null = null;
  if (firstMonth) {
    let cursor = firstMonth;
    const current = today.slice(0, 7);
    while (cursor <= current) {
      if (!taken.has(cursor)) {
        suggestedMonth = cursor;
        break;
      }
      const next = new Date(Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)), 1));
      cursor = day(next).slice(0, 7);
    }
  }
  return {
    today,
    items: runs.map((run) => summaryOf(run, totals.get(run.id))),
    canManage: canManagePayroll(context),
    firstMonth,
    suggestedMonth,
  };
}

export async function runDetail(
  context: AdminContext,
  runIdRaw: string,
): Promise<PayRunDetailResponse> {
  const { tx } = context;
  requireRead(context);
  const runId = uuid(runIdRaw, 'id');
  const run = await tx.payRun.findUnique({
    where: { id: runId },
    include: { createdBy: { select: { id: true, fullName: true } } },
  });
  if (!run) throw new AuthError('NOT_FOUND');
  const first = day(run.periodMonth);
  const last = lastDayOf(first);
  const [lines, items] = await Promise.all([
    tx.payRunLine.findMany({
      where: { runId },
      select: {
        id: true,
        employeeUserId: true,
        employee: {
          select: {
            employeeCodeCanonical: true,
            user: { select: { fullName: true } },
            classificationChanges: {
              where: { effectiveDate: { lte: asDate(last) } },
              orderBy: { effectiveDate: 'desc' },
              take: 1,
              select: { classification: true },
            },
          },
        },
      },
    }),
    tx.payRunItem.findMany({
      where: { runId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ITEM_SELECT,
    }),
  ]);
  const ids = lines.map((line) => line.employeeUserId);
  const context_ = await attendanceContext(tx, ids, first, last);
  const byLine = new Map<string, typeof items>();
  for (const item of items) byLine.set(item.lineId, [...(byLine.get(item.lineId) ?? []), item]);
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
  const views: PayRunLineView[] = lines.map((line) => {
    const mine = (byLine.get(line.id) ?? []).sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const totals = totalsOf(
      mine.map((item) => ({
        kind: item.kind,
        amountVnd: item.amountVnd,
        voided: item.voidedAt !== null,
      })),
    );
    const warnings: PayLineWarningName[] = [];
    for (const item of mine) {
      if (item.voidedAt) continue;
      if (item.flag === 'UNCONFIRMED_BASE') warnings.push('UNCONFIRMED_BASE');
      if (item.flag === 'NO_BASE') warnings.push('NO_BASE');
      if (item.flag === 'UNAGREED') warnings.push('CTV_UNAGREED');
    }
    if (totals.net < 0n) warnings.push('NEGATIVE_NET');
    return {
      id: line.id,
      employee: {
        id: line.employeeUserId,
        name: line.employee.user.fullName,
        code: line.employee.employeeCodeCanonical,
      },
      classification: line.employee.classificationChanges[0]?.classification ?? null,
      items: mine.map(presentItem),
      netVnd: totals.net.toString(),
      tipsVnd: totals.tips.toString(),
      warnings,
      context: context_.get(line.employeeUserId) ?? { attendanceDays: 0, leaveDays: 0 },
    };
  });
  views.sort(
    (a, b) =>
      a.employee.name.localeCompare(b.employee.name, 'vi') ||
      a.employee.id.localeCompare(b.employee.id),
  );
  const total = totalsOf(
    items.map((item) => ({
      kind: item.kind,
      amountVnd: item.amountVnd,
      voided: item.voidedAt !== null,
    })),
  );
  const byKind: Record<string, string> = {};
  for (const item of items) {
    if (item.voidedAt) continue;
    byKind[item.kind] = (BigInt(byKind[item.kind] ?? '0') + item.amountVnd).toString();
  }
  let stale = false;
  if (run.status === 'DRAFT') {
    const fresh = (await generate(tx, first, runId)).map(signature).sort();
    const stored = items
      .filter((item) => item.generated)
      .map((item) => {
        const line = lines.find((candidate) => candidate.id === item.lineId)!;
        return signature({
          employeeUserId: line.employeeUserId,
          kind: item.kind,
          amountVnd: item.amountVnd,
          quantity: item.quantity,
          lateVnd: item.lateVnd,
          flag: item.flag as Generated['flag'],
          note: item.note,
          advanceId: item.advanceId,
        });
      })
      .sort();
    stale = fresh.length !== stored.length || fresh.some((value, index) => value !== stored[index]);
  }
  const [differences] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM cash_day_closings WHERE business_date BETWEEN ${first}::date AND ${last}::date AND difference_vnd <> 0`;
  const warnings = {
    unconfirmedBase: views.filter((line) => line.warnings.includes('UNCONFIRMED_BASE')).length,
    noBase: views.filter((line) => line.warnings.includes('NO_BASE')).length,
    ctvUnagreed: views.filter((line) => line.warnings.includes('CTV_UNAGREED')).length,
    negativeNet: views.filter((line) => line.warnings.includes('NEGATIVE_NET')).length,
    noPaymentDay: run.paymentDay === null,
    cashDifferences: Number(differences?.n ?? 0n),
  };
  return {
    run: {
      ...summaryOf(run, { people: views.length, net: total.net, tips: total.tips }),
      periodFrom: first,
      periodTo: last,
      refreshedAt: run.refreshedAt ? run.refreshedAt.toISOString() : null,
      createdBy: { id: run.createdBy.id, name: run.createdBy.fullName },
      closedAt: run.closedAt ? run.closedAt.toISOString() : null,
    },
    lines: views,
    totals: {
      payVnd: total.net.toString(),
      tipsVnd: total.tips.toString(),
      people: views.length,
      byKind,
    },
    warnings,
    stale,
    canManage: canManagePayroll(context),
  };
}

function presentItem(item: {
  id: string;
  kind: PayRunItemKindName;
  amountVnd: bigint;
  generated: boolean;
  quantity: number | null;
  lateVnd: bigint;
  flag: string | null;
  note: string | null;
  advanceId: string | null;
  reason: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  createdBy: { id: string; fullName: string } | null;
}): PayRunItemView {
  return {
    id: item.id,
    kind: item.kind,
    amountVnd: item.amountVnd.toString(),
    generated: item.generated,
    quantity: item.quantity,
    lateVnd: item.lateVnd.toString(),
    flag: item.flag as PayRunItemView['flag'],
    note: item.note,
    advanceId: item.advanceId,
    reason: item.reason,
    voided: item.voidedAt !== null,
    voidReason: item.voidReason,
    createdBy:
      item.generated || !item.createdBy
        ? null
        : { id: item.createdBy.id, name: item.createdBy.fullName },
    createdAt: item.createdAt.toISOString(),
  };
}

/** Days with a check-in and days of approved leave inside the month, per person: context for the person who decides, never a deduction. */
async function attendanceContext(
  tx: Tx,
  ids: readonly string[],
  first: string,
  last: string,
): Promise<Map<string, { attendanceDays: number; leaveDays: number }>> {
  const result = new Map<string, { attendanceDays: number; leaveDays: number }>();
  if (ids.length === 0) return result;
  const [attendance, leave] = await Promise.all([
    tx.$queryRaw<{ employee: string; days: bigint }[]>`
      SELECT employee_user_id::text AS employee, COUNT(DISTINCT business_date)::bigint AS days
      FROM attendance_records
      WHERE business_date BETWEEN ${first}::date AND ${last}::date
      GROUP BY employee_user_id`,
    tx.$queryRaw<{ employee: string; days: bigint }[]>`
      SELECT employee_user_id::text AS employee,
             SUM(LEAST(end_date, ${last}::date) - GREATEST(start_date, ${first}::date) + 1)::bigint AS days
      FROM leave_requests
      WHERE status = 'APPROVED' AND start_date <= ${last}::date AND end_date >= ${first}::date
      GROUP BY employee_user_id`,
  ]);
  for (const id of ids) result.set(id, { attendanceDays: 0, leaveDays: 0 });
  for (const row of attendance) {
    const entry = result.get(row.employee);
    if (entry) entry.attendanceDays = Number(row.days);
  }
  for (const row of leave) {
    const entry = result.get(row.employee);
    if (entry) entry.leaveDays = Number(row.days);
  }
  return result;
}

// ------------------------------------------------------------------------------------------------ commands
async function lockDraft(tx: Tx, runId: string, expectedVersion?: number) {
  await tx.$queryRaw`SELECT id FROM pay_runs WHERE id = ${runId}::uuid FOR UPDATE`;
  const run = await tx.payRun.findUnique({ where: { id: runId } });
  if (!run) throw new AuthError('NOT_FOUND');
  if (run.status !== 'DRAFT') throw new AuthError('PAY_RUN_NOT_DRAFT');
  if (expectedVersion !== undefined && run.rowVersion !== expectedVersion)
    throw new AuthError('CONFLICT');
  return run;
}

const version = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
  }
  return value;
};

export async function createRun(
  context: AdminContext,
  request: PayRunCreateRequest,
): Promise<PayRunDetailResponse> {
  const { tx } = context;
  requireManage(context);
  const body = exactKeys(request, ['month'], 'body');
  const first = monthStart(body['month'], 'month');
  const live = await financeGoLive(tx);
  if (!live) throw new AuthError('FINANCE_NOT_LIVE');
  const today = shopToday(context.now);
  if (first.slice(0, 7) < shopToday(live.at).slice(0, 7) || first > today) {
    throw new AuthError('VALIDATION_FAILED', 'month');
  }
  if (await tx.payRun.findUnique({ where: { periodMonth: asDate(first) }, select: { id: true } })) {
    throw new AuthError('PAY_RUN_EXISTS');
  }
  const run = await tx.payRun.create({
    data: { periodMonth: asDate(first), createdByUserId: context.actor.userId },
    select: { id: true },
  });
  await rebuild(context, run.id, first);
  await tx.payRun.update({
    where: { id: run.id },
    data: {
      rowVersion: { increment: 1 },
      refreshedAt: context.now,
      refreshedByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PAY_RUN_CREATED',
    entityType: 'PayRun',
    entityId: run.id,
    classification: 'EMPLOYEE_PAY',
    after: { month: first.slice(0, 7) },
  });
  return runDetail(context, run.id);
}

export async function refreshRun(
  context: AdminContext,
  runIdRaw: string,
  request: PayRunRefreshRequest,
): Promise<PayRunDetailResponse> {
  const { tx } = context;
  requireManage(context);
  const runId = uuid(runIdRaw, 'id');
  const body = exactKeys(request, ['expectedVersion'], 'body');
  const run = await lockDraft(tx, runId, version(body['expectedVersion']));
  await rebuild(context, runId, day(run.periodMonth));
  await tx.payRun.update({
    where: { id: runId },
    data: {
      rowVersion: { increment: 1 },
      refreshedAt: context.now,
      refreshedByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PAY_RUN_REFRESHED',
    entityType: 'PayRun',
    entityId: runId,
    classification: 'EMPLOYEE_PAY',
    after: { month: day(run.periodMonth).slice(0, 7) },
  });
  return runDetail(context, runId);
}

export async function setPaymentDay(
  context: AdminContext,
  runIdRaw: string,
  request: PayRunPaymentDayRequest,
): Promise<PayRunDetailResponse> {
  const { tx } = context;
  requireManage(context);
  const runId = uuid(runIdRaw, 'id');
  const body = exactKeys(request, ['expectedVersion', 'paymentDay'], 'body');
  const expected = version(body['expectedVersion']);
  const value = body['paymentDay'];
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    day(asDate(value)) !== value
  ) {
    throw new AuthError('VALIDATION_FAILED', 'paymentDay');
  }
  const run = await lockDraft(tx, runId, expected);
  const first = day(run.periodMonth);
  if (value < first || value > addDays(lastDayOf(first), PAY_PAYMENT_DAY_MAX_DAYS)) {
    throw new AuthError('VALIDATION_FAILED', 'paymentDay');
  }
  await tx.payRun.update({
    where: { id: runId },
    data: { paymentDay: asDate(value), rowVersion: { increment: 1 } },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PAY_RUN_PAYMENT_DAY_SET',
    entityType: 'PayRun',
    entityId: runId,
    classification: 'EMPLOYEE_PAY',
    before: { paymentDay: run.paymentDay ? day(run.paymentDay) : null },
    after: { paymentDay: value },
  });
  return runDetail(context, runId);
}

const ITEM_KEYS = ['employeeUserId', 'kind', 'amountVnd', 'reason', 'clientRequestId'] as const;
const SIGNED = /^-?[1-9]\d{0,14}$/;

export async function addItem(
  context: AdminContext,
  runIdRaw: string,
  request: PayRunItemRequest,
): Promise<PayRunDetailResponse> {
  const { tx } = context;
  requireManage(context);
  const runId = uuid(runIdRaw, 'id');
  const body = exactKeys(request, ITEM_KEYS, 'body');
  const employeeUserId = uuid(body['employeeUserId'], 'employeeUserId');
  const kind = body['kind'];
  if (typeof kind !== 'string' || !(PAY_MANUAL_ITEM_KINDS as readonly string[]).includes(kind)) {
    throw new AuthError('VALIDATION_FAILED', 'kind');
  }
  const manual = kind as PayManualItemKindName;
  const text = body['amountVnd'];
  if (typeof text !== 'string' || !SIGNED.test(text))
    throw new AuthError('VALIDATION_FAILED', 'amountVnd');
  let amount = BigInt(text);
  if (manual !== 'ADJUSTMENT' && amount < 0n) throw new AuthError('VALIDATION_FAILED', 'amountVnd');
  if (amount > 10_000_000_000n || amount < -10_000_000_000n)
    throw new AuthError('VALIDATION_FAILED', 'amountVnd');
  if (manual === 'DEDUCTION') amount = -amount;
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX)!;
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  const prior = await tx.payRunItem.findFirst({
    where: { createdByUserId: context.actor.userId, clientRequestId },
    select: {
      runId: true,
      kind: true,
      amountVnd: true,
      reason: true,
      line: { select: { employeeUserId: true } },
    },
  });
  if (prior) {
    if (
      prior.runId !== runId ||
      prior.kind !== manual ||
      prior.amountVnd !== amount ||
      prior.reason !== why ||
      prior.line.employeeUserId !== employeeUserId
    ) {
      throw new AuthError('CONFLICT');
    }
    return runDetail(context, runId);
  }
  await lockDraft(tx, runId);
  if (
    !(await tx.employeeProfile.findUnique({
      where: { userId: employeeUserId },
      select: { userId: true },
    }))
  ) {
    throw new AuthError('VALIDATION_FAILED', 'employeeUserId');
  }
  const line =
    (await tx.payRunLine.findUnique({
      where: { runId_employeeUserId: { runId, employeeUserId } },
      select: { id: true },
    })) ?? (await tx.payRunLine.create({ data: { runId, employeeUserId }, select: { id: true } }));
  const item = await tx.payRunItem.create({
    data: {
      runId,
      lineId: line.id,
      kind: manual,
      amountVnd: amount,
      generated: false,
      reason: why,
      clientRequestId,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await tx.payRun.update({
    where: { id: runId },
    data: { rowVersion: { increment: 1 } },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PAY_RUN_ITEM_ADDED',
    entityType: 'PayRunItem',
    entityId: item.id,
    subjectUserId: employeeUserId,
    reason: why,
    classification: 'EMPLOYEE_PAY',
    after: { runId, kind: manual, amountVnd: amount.toString() },
  });
  return runDetail(context, runId);
}

export async function voidItem(
  context: AdminContext,
  runIdRaw: string,
  itemIdRaw: string,
  request: PayRunItemVoidRequest,
): Promise<PayRunDetailResponse> {
  const { tx } = context;
  requireManage(context);
  const runId = uuid(runIdRaw, 'id');
  const itemId = uuid(itemIdRaw, 'itemId');
  const body = exactKeys(request, ['expectedVersion', 'reason'], 'body');
  const expected = version(body['expectedVersion']);
  const why = reason(body['reason'], 'reason', PAY_REASON_MAX)!;
  await lockDraft(tx, runId, expected);
  const item = await tx.payRunItem.findFirst({
    where: { id: itemId, runId },
    select: {
      id: true,
      kind: true,
      amountVnd: true,
      generated: true,
      voidedAt: true,
      line: { select: { employeeUserId: true } },
    },
  });
  if (!item) throw new AuthError('NOT_FOUND');
  if (item.generated || item.voidedAt) throw new AuthError('CONFLICT');
  await tx.payRunItem.update({
    where: { id: itemId },
    data: { voidedAt: context.now, voidedByUserId: context.actor.userId, voidReason: why },
    select: { id: true },
  });
  await tx.payRun.update({
    where: { id: runId },
    data: { rowVersion: { increment: 1 } },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PAY_RUN_ITEM_VOIDED',
    entityType: 'PayRunItem',
    entityId: itemId,
    subjectUserId: item.line.employeeUserId,
    reason: why,
    classification: 'EMPLOYEE_PAY',
    before: { runId, kind: item.kind, amountVnd: item.amountVnd.toString() },
  });
  return runDetail(context, runId);
}
