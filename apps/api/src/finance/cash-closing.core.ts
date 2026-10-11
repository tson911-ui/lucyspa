import {
  CASH_AMOUNT_MAX_VND,
  CASH_PAGE_SIZE,
  CASH_REASON_MAX,
  type CashCloseRequest,
  type CashClosingItem,
  type CashClosingListResponse,
  type CashClosingPreviewRequest,
  type CashClosingPreviewResponse,
  type CashClosingResponse,
} from '@lucy-spa/contracts';
import { countUnposted, postCashSources } from '@lucy-spa/server';
import type { Prisma } from '@lucy-spa/database';
import { randomUUID } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { canManageAt, canViewAt } from './cash.access.js';
import { alertThreshold, financeGoLive, nextFloatDefault } from './cash.core.js';
import { fundBalance } from './cash-entries.core.js';
import { exactKeys, money, reason, uuid } from './finance.input.js';
import { spendConfirmation, takeFreshConfirmation } from './finance.reauth.js';

/**
 * Phase 7 P7-5 (design 7.4, 7.5; P7-T9): the daily count and closing of one branch cash fund.
 *
 * - Expected cash = the previous closing's next-day float (or the opening balance on the first day) + cash in - cash out of the days since.
 * - The person counts the drawer and the safe. A count that differs from the book needs a reason; the difference becomes its own entry of
 *   the day (`COUNT_DIFFERENCE`) and is never taken out of anyone's pay. The Owner may take money out (`OWNER_WITHDRAWAL`); what stays is the
 *   next day's float. After the closing the book equals exactly that float.
 * - A closing locks the day: nothing is added to it afterwards; a payment found late is dated the first open day. It is never reopened.
 * - It first posts every source of the fund that is not in the book yet (the closing never trusts the background poster), takes the fund
 *   lock for the whole transaction, needs MANAGE_CASH at the branch and a fresh password, and is idempotent per `clientRequestId`.
 */
type Tx = Prisma.TransactionClient;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  if (new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

const localDay = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

const FUND_SELECT = {
  id: true,
  kind: true,
  name: true,
  isActive: true,
  openingBalanceVnd: true,
  branch: { select: { id: true, code: true, name: true, timezone: true } },
} satisfies Prisma.CashFundSelect;

async function cashFund(tx: Tx, idRaw: string) {
  const id = uuid(idRaw, 'id');
  const fund = await tx.cashFund.findUnique({ where: { id }, select: FUND_SELECT });
  if (!fund || !fund.isActive || fund.kind !== 'CASH' || fund.branch === null) {
    throw new AuthError('NOT_FOUND');
  }
  return { ...fund, kind: 'CASH' as const, branch: fund.branch };
}
type CashFundRow = Awaited<ReturnType<typeof cashFund>>;

async function lastClosing(tx: Tx, fundId: string) {
  return tx.cashDayClosing.findFirst({
    where: { fundId },
    orderBy: { businessDate: 'desc' },
    select: { businessDate: true, nextFloatVnd: true },
  });
}

/** The figures of the day about to be closed, from the book. */
async function figures(tx: Tx, fund: CashFundRow, date: string) {
  const previous = await lastClosing(tx, fund.id);
  const start = previous ? previous.nextFloatVnd : fund.openingBalanceVnd;
  const after = previous ? previous.businessDate.toISOString().slice(0, 10) : '0001-01-01';
  const rows = await tx.$queryRaw<{ cash_in: bigint; cash_out: bigint }[]>`
    SELECT COALESCE(SUM(amount_vnd) FILTER (WHERE direction = 'IN'), 0)::bigint AS cash_in,
           COALESCE(SUM(amount_vnd) FILTER (WHERE direction = 'OUT'), 0)::bigint AS cash_out
    FROM fund_entries
    WHERE fund_id = ${fund.id}::uuid AND business_date > ${after}::date AND business_date <= ${date}::date`;
  const cashIn = rows[0]?.cash_in ?? 0n;
  const cashOut = rows[0]?.cash_out ?? 0n;
  return {
    opening: start,
    cashIn,
    cashOut,
    expected: start + cashIn - cashOut,
    lastClosedDate: previous ? previous.businessDate.toISOString().slice(0, 10) : null,
  };
}

async function fundItem(tx: Tx, fund: CashFundRow) {
  const previous = await lastClosing(tx, fund.id);
  return {
    id: fund.id,
    kind: fund.kind,
    branch: { id: fund.branch.id, code: fund.branch.code, name: fund.branch.name },
    name: fund.name,
    openingBalanceVnd: fund.openingBalanceVnd.toString(),
    balanceVnd: (await fundBalance(tx, fund)).toString(),
    lastClosedDate: previous ? previous.businessDate.toISOString().slice(0, 10) : null,
  };
}

interface ClosingRow {
  id: string;
  fund_id: string;
  business_date: string;
  opening_float_vnd: string;
  cash_in_vnd: string;
  cash_out_vnd: string;
  expected_vnd: string;
  counted_vnd: string;
  difference_vnd: string;
  reason: string | null;
  withdrawal_vnd: string;
  next_float_vnd: string;
  closed_by_user_id: string;
  closed_by_name: string;
  closed_at: Date;
}

const CLOSING_COLUMNS = `c.id, c.fund_id, to_char(c.business_date, 'YYYY-MM-DD') AS business_date, c.opening_float_vnd::text,
  c.cash_in_vnd::text, c.cash_out_vnd::text, c.expected_vnd::text, c.counted_vnd::text, c.difference_vnd::text, c.reason,
  c.withdrawal_vnd::text, c.next_float_vnd::text, c.closed_by_user_id, u.full_name AS closed_by_name, c.closed_at`;

function present(row: ClosingRow, threshold: bigint): CashClosingItem {
  const difference = BigInt(row.difference_vnd);
  return {
    id: row.id,
    fundId: row.fund_id,
    businessDate: row.business_date,
    openingFloatVnd: row.opening_float_vnd,
    cashInVnd: row.cash_in_vnd,
    cashOutVnd: row.cash_out_vnd,
    expectedVnd: row.expected_vnd,
    countedVnd: row.counted_vnd,
    differenceVnd: row.difference_vnd,
    reason: row.reason,
    withdrawalVnd: row.withdrawal_vnd,
    nextFloatVnd: row.next_float_vnd,
    closedBy: { id: row.closed_by_user_id, name: row.closed_by_name },
    closedAt: row.closed_at.toISOString(),
    alert: (difference < 0n ? -difference : difference) >= threshold && difference !== 0n,
  };
}

async function closingById(tx: Tx, id: string, threshold: bigint): Promise<CashClosingItem> {
  const rows = await tx.$queryRawUnsafe<ClosingRow[]>(
    `SELECT ${CLOSING_COLUMNS} FROM cash_day_closings c JOIN users u ON u.id = c.closed_by_user_id WHERE c.id = $1::uuid`,
    id,
  );
  return present(rows[0]!, threshold);
}

// ----------------------------------------------------------------------------------------------- preview
export async function previewClosing(
  context: AdminContext,
  fundIdRaw: string,
  request: CashClosingPreviewRequest,
): Promise<CashClosingPreviewResponse> {
  const { tx } = context;
  const body = exactKeys(request, ['date'], 'body');
  const date = dateOf(body['date'], 'date');
  const fund = await cashFund(tx, fundIdRaw);
  if (!canManageAt(context, fund.branch.id)) throw new AuthError('FORBIDDEN');
  if (!(await financeGoLive(tx))) throw new AuthError('FINANCE_NOT_LIVE');
  await tx.$queryRaw`SELECT id FROM cash_funds WHERE id = ${fund.id}::uuid FOR UPDATE`;
  await postCashSources(tx, { since: null, fundId: fund.id });
  const today = localDay(context.now, fund.branch.timezone);
  const figs = await figures(tx, fund, date);
  const unposted = (
    await countUnposted(tx, { branchId: fund.branch.id, upToDate: date, scope: 'CASH' })
  ).total;
  const blockedBy =
    figs.lastClosedDate !== null && date <= figs.lastClosedDate
      ? 'ALREADY_CLOSED'
      : date > today
        ? 'FUTURE_DAY'
        : unposted > 0
          ? 'UNPOSTED'
          : null;
  return {
    fund: await fundItem(tx, fund),
    businessDate: date,
    openingFloatVnd: figs.opening.toString(),
    cashInVnd: figs.cashIn.toString(),
    cashOutVnd: figs.cashOut.toString(),
    expectedVnd: figs.expected.toString(),
    unposted,
    lastClosedDate: figs.lastClosedDate,
    defaultNextFloatVnd: (await nextFloatDefault(tx)).toString(),
    alertThresholdVnd: (await alertThreshold(tx)).toString(),
    closable: blockedBy === null,
    blockedBy,
  };
}

// --------------------------------------------------------------------------------------------- the closing
const CLOSE_KEYS = ['date', 'countedVnd', 'withdrawalVnd', 'reason', 'clientRequestId'] as const;

export async function closeDay(
  context: AdminContext,
  fundIdRaw: string,
  request: CashCloseRequest,
  freshAuthSeconds: number,
): Promise<CashClosingResponse> {
  const { tx } = context;
  const body = exactKeys(request, CLOSE_KEYS, 'body');
  const date = dateOf(body['date'], 'date');
  const counted = money(body['countedVnd'], 'countedVnd');
  const withdrawal = money(body['withdrawalVnd'], 'withdrawalVnd');
  if (withdrawal > counted) throw new AuthError('VALIDATION_FAILED', 'withdrawalVnd');
  const why = reason(body['reason'], 'reason', CASH_REASON_MAX, false);
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  const fund = await cashFund(tx, fundIdRaw);
  if (!canManageAt(context, fund.branch.id)) throw new AuthError('FORBIDDEN');
  if (!(await financeGoLive(tx))) throw new AuthError('FINANCE_NOT_LIVE');
  const threshold = await alertThreshold(tx);

  const replay = async (): Promise<CashClosingResponse | null> => {
    const prior = await tx.cashDayClosing.findFirst({
      where: { closedByUserId: context.actor.userId, clientRequestId },
      select: { id: true, fundId: true, businessDate: true, countedVnd: true, withdrawalVnd: true },
    });
    if (!prior) return null;
    if (
      prior.fundId !== fund.id ||
      prior.businessDate.toISOString().slice(0, 10) !== date ||
      prior.countedVnd !== counted ||
      prior.withdrawalVnd !== withdrawal
    ) {
      throw new AuthError('CONFLICT');
    }
    return { item: await closingById(tx, prior.id, threshold), fund: await fundItem(tx, fund) };
  };
  const early = await replay();
  if (early) return early;

  const today = localDay(context.now, fund.branch.timezone);
  if (date > today) throw new AuthError('VALIDATION_FAILED', 'date');
  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);
  // The fund is ours for the whole transaction: the background poster and every manual entry wait.
  await tx.$queryRaw`SELECT id FROM cash_funds WHERE id = ${fund.id}::uuid FOR UPDATE`;
  const settled = await replay();
  if (settled) return settled;
  const previous = await lastClosing(tx, fund.id);
  if (previous && date <= previous.businessDate.toISOString().slice(0, 10)) {
    throw new AuthError('CASH_DAY_CLOSED');
  }
  // The closing never trusts the poster: everything of the fund up to the day is in the book, or the day stays open.
  await postCashSources(tx, { since: null, fundId: fund.id });
  if (
    (await countUnposted(tx, { branchId: fund.branch.id, upToDate: date, scope: 'CASH' })).total > 0
  ) {
    throw new AuthError('CASH_UNPOSTED');
  }
  const figs = await figures(tx, fund, date);
  const difference = counted - figs.expected;
  if (difference !== 0n && why === null) throw new AuthError('VALIDATION_FAILED', 'reason');
  if (counted > BigInt(CASH_AMOUNT_MAX_VND)) throw new AuthError('VALIDATION_FAILED', 'countedVnd');

  const id = randomUUID();
  const dayDate = new Date(`${date}T00:00:00.000Z`);
  if (difference !== 0n) {
    await tx.fundEntry.create({
      data: {
        fundId: fund.id,
        branchId: fund.branch.id,
        businessDate: dayDate,
        direction: difference < 0n ? 'OUT' : 'IN',
        category: 'COUNT_DIFFERENCE',
        amountVnd: difference < 0n ? -difference : difference,
        sourceType: 'CASH_CLOSING',
        sourceId: id,
        sourceLeg: 0,
        reason: why,
        actorUserId: context.actor.userId,
      },
      select: { id: true },
    });
  }
  if (withdrawal > 0n) {
    await tx.fundEntry.create({
      data: {
        fundId: fund.id,
        branchId: fund.branch.id,
        businessDate: dayDate,
        direction: 'OUT',
        category: 'OWNER_WITHDRAWAL',
        amountVnd: withdrawal,
        sourceType: 'CASH_CLOSING',
        sourceId: id,
        sourceLeg: 1,
        reason: why ?? 'Rút tiền khi chốt ngày',
        actorUserId: context.actor.userId,
      },
      select: { id: true },
    });
  }
  await tx.cashDayClosing.create({
    data: {
      id,
      fundId: fund.id,
      branchId: fund.branch.id,
      businessDate: dayDate,
      openingFloatVnd: figs.opening,
      cashInVnd: figs.cashIn,
      cashOutVnd: figs.cashOut,
      expectedVnd: figs.expected,
      countedVnd: counted,
      differenceVnd: difference,
      reason: why,
      withdrawalVnd: withdrawal,
      nextFloatVnd: counted - withdrawal,
      closedByUserId: context.actor.userId,
      reauthenticatedAt: confirmedAt,
      clientRequestId,
    },
    select: { id: true },
  });
  await spendConfirmation(context, confirmedAt, 'CASH_CLOSING', id);
  await appendAdminAudit(context, {
    action: 'CASH_DAY_CLOSED',
    entityType: 'CashDayClosing',
    entityId: id,
    branchId: fund.branch.id,
    reason: why,
    classification: 'FINANCIAL',
    after: {
      fundId: fund.id,
      businessDate: date,
      expectedVnd: figs.expected.toString(),
      countedVnd: counted.toString(),
      differenceVnd: difference.toString(),
      withdrawalVnd: withdrawal.toString(),
      nextFloatVnd: (counted - withdrawal).toString(),
    },
  });
  return { item: await closingById(tx, id, threshold), fund: await fundItem(tx, fund) };
}

// -------------------------------------------------------------------------------------------------- list
export async function listClosings(
  context: AdminContext,
  fundIdRaw: string,
  query: { page?: unknown },
): Promise<CashClosingListResponse> {
  const { tx } = context;
  const fund = await cashFund(tx, fundIdRaw);
  if (!canViewAt(context, fund.branch.id)) throw new AuthError('FORBIDDEN');
  const pageRaw = query.page === undefined || query.page === '' ? '1' : query.page;
  const page =
    typeof pageRaw === 'string' && /^[1-9][0-9]{0,4}$/.test(pageRaw) ? Number(pageRaw) : 0;
  if (page === 0) throw new AuthError('VALIDATION_FAILED', 'page');
  const threshold = await alertThreshold(tx);
  const [count, rows] = await Promise.all([
    tx.cashDayClosing.count({ where: { fundId: fund.id } }),
    tx.$queryRawUnsafe<ClosingRow[]>(
      `SELECT ${CLOSING_COLUMNS} FROM cash_day_closings c JOIN users u ON u.id = c.closed_by_user_id
       WHERE c.fund_id = $1::uuid ORDER BY c.business_date DESC LIMIT ${CASH_PAGE_SIZE} OFFSET ${(page - 1) * CASH_PAGE_SIZE}`,
      fund.id,
    ),
  ]);
  return {
    fund: await fundItem(tx, fund),
    items: rows.map((row) => present(row, threshold)),
    page,
    pageSize: CASH_PAGE_SIZE,
    total: count,
    alertThresholdVnd: threshold.toString(),
  };
}
