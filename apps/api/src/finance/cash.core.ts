import {
  CASH_DIFFERENCE_ALERT_DEFAULT_VND,
  type CashFundItem,
  type CashGoLiveRequest,
  type CashOverviewResponse,
} from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import {
  accessOf,
  activeBranches,
  canViewAt,
  holdsEverywhere,
  requireManageAt,
  type ActiveBranch,
} from './cash.access.js';
import { exactKeys, money, uuid } from './finance.input.js';
import { spendConfirmation, takeFreshConfirmation } from './finance.reauth.js';

/**
 * Phase 7 P7-2: the funds and the Owner's go-live of the cash book and payroll (design sections 7.1, 14; P7-T15).
 *
 * - Go-live is ONE explicit action: a counted opening balance for every active branch's cash and for the bank, a fresh password, and
 *   MANAGE_CASH at every active branch. It stores the instant (the database clock), creates the funds and can never be repeated or moved.
 *   Until it exists nothing is posted and nothing is earned (the consumers read `finance_go_live`); no default date exists anywhere.
 * - The overview shows each fund the person may see: opening balance, current balance (opening + the whole book) and the last closed day.
 */
export const DEFAULT_NEXT_FLOAT_VND = 1_000_000n;

const day = (value: Date): string => value.toISOString().slice(0, 10);

export async function financeGoLive(tx: AdminContext['tx']) {
  return tx.financeGoLive.findUnique({
    where: { id: 1 },
    select: { at: true, setBy: { select: { id: true, fullName: true } } },
  });
}

export async function alertThreshold(tx: AdminContext['tx']): Promise<bigint> {
  const row = await tx.appSetting.findUnique({
    where: { key: 'cash.difference_alert_vnd' },
    select: { value: true },
  });
  const value = row?.value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : BigInt(CASH_DIFFERENCE_ALERT_DEFAULT_VND);
}

export async function nextFloatDefault(tx: AdminContext['tx']): Promise<bigint> {
  const row = await tx.appSetting.findUnique({
    where: { key: 'cash.default_next_float_vnd' },
    select: { value: true },
  });
  const value = row?.value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : DEFAULT_NEXT_FLOAT_VND;
}

export async function cashOverview(context: AdminContext): Promise<CashOverviewResponse> {
  const { tx } = context;
  const branches = await activeBranches(context);
  const access = accessOf(context, branches).filter((entry) => entry.view || entry.manage);
  const live = await financeGoLive(tx);
  const bankVisible = holdsEverywhere(context, branches, 'view');
  const seeable = new Set(
    branches.filter((branch) => canViewAt(context, branch.id)).map((b) => b.id),
  );
  if (access.length === 0 && !bankVisible) throw new AuthError('FORBIDDEN');

  const funds = await tx.cashFund.findMany({
    where: { isActive: true },
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      kind: true,
      name: true,
      openingBalanceVnd: true,
      branch: { select: { id: true, code: true, name: true } },
    },
  });
  const visible = funds.filter((fund) =>
    fund.kind === 'BANK' ? bankVisible : fund.branch !== null && seeable.has(fund.branch.id),
  );
  const ids = visible.map((fund) => fund.id);
  const [sums, closings] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          tx.$queryRaw<{ fund_id: string; net: bigint }[]>`
            SELECT fund_id, COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_vnd ELSE -amount_vnd END), 0)::bigint AS net
            FROM fund_entries WHERE fund_id = ANY(${ids}::uuid[]) GROUP BY fund_id`,
          tx.$queryRaw<{ fund_id: string; last_date: Date }[]>`
            SELECT fund_id, MAX(business_date) AS last_date
            FROM cash_day_closings WHERE fund_id = ANY(${ids}::uuid[]) GROUP BY fund_id`,
        ]);
  const threshold = await alertThreshold(tx);
  const net = new Map(sums.map((row) => [row.fund_id, row.net]));
  const closed = new Map(closings.map((row) => [row.fund_id, day(row.last_date)]));
  const items: CashFundItem[] = visible.map((fund) => ({
    id: fund.id,
    kind: fund.kind,
    branch: fund.branch,
    name: fund.name,
    openingBalanceVnd: fund.openingBalanceVnd.toString(),
    balanceVnd: (fund.openingBalanceVnd + (net.get(fund.id) ?? 0n)).toString(),
    lastClosedDate: fund.kind === 'CASH' ? (closed.get(fund.id) ?? null) : null,
  }));
  return {
    goLive: live
      ? { at: live.at.toISOString(), setBy: { id: live.setBy.id, name: live.setBy.fullName } }
      : null,
    branches: access,
    canGoLive: live === null && holdsEverywhere(context, branches, 'manage'),
    funds: items,
    defaultNextFloatVnd: (await nextFloatDefault(tx)).toString(),
    differenceAlerts: await countDifferenceAlerts(tx, ids, threshold),
    alertThresholdVnd: threshold.toString(),
  };
}

async function countDifferenceAlerts(
  tx: AdminContext['tx'],
  fundIds: readonly string[],
  threshold: bigint,
): Promise<number> {
  if (fundIds.length === 0) return 0;
  const rows = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM cash_day_closings
    WHERE fund_id = ANY(${[...fundIds]}::uuid[]) AND abs(difference_vnd) >= ${threshold}
      AND closed_at >= clock_timestamp() - interval '30 days'`;
  return Number(rows[0]?.n ?? 0n);
}

interface ParsedGoLive {
  readonly branches: Map<string, bigint>;
  readonly bank: bigint;
}

function parseGoLive(request: unknown, branches: readonly ActiveBranch[]): ParsedGoLive {
  const body = exactKeys(request, ['branches', 'bankVnd'], 'body');
  const list = body['branches'];
  if (!Array.isArray(list) || list.length > 200)
    throw new AuthError('VALIDATION_FAILED', 'branches');
  const counted = new Map<string, bigint>();
  for (const item of list) {
    const entry = exactKeys(item, ['branchId', 'countedVnd'], 'branches');
    const id = uuid(entry['branchId'], 'branchId');
    if (counted.has(id)) throw new AuthError('CASH_OPENING_INVALID');
    counted.set(id, money(entry['countedVnd'], 'countedVnd'));
  }
  const expected = new Set(branches.map((branch) => branch.id));
  if (counted.size !== expected.size || [...counted.keys()].some((id) => !expected.has(id))) {
    throw new AuthError('CASH_OPENING_INVALID');
  }
  return { branches: counted, bank: money(body['bankVnd'], 'bankVnd') };
}

export async function startCashBook(
  context: AdminContext,
  request: CashGoLiveRequest,
  freshAuthSeconds: number,
): Promise<CashOverviewResponse> {
  const { tx } = context;
  const branches = await activeBranches(context);
  if (!holdsEverywhere(context, branches, 'manage')) throw new AuthError('FORBIDDEN');
  for (const branch of branches) requireManageAt(context, branch.id);
  const parsed = parseGoLive(request, branches);
  if (await financeGoLive(tx)) throw new AuthError('FINANCE_ALREADY_LIVE');
  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);

  const at = context.now;
  await tx.financeGoLive.create({
    data: { id: 1, at, setByUserId: context.actor.userId, reauthenticatedAt: confirmedAt },
    select: { id: true },
  });
  await spendConfirmation(context, confirmedAt, 'FINANCE_GO_LIVE', null);
  for (const branch of branches) {
    await tx.cashFund.create({
      data: {
        kind: 'CASH',
        branchId: branch.id,
        name: `Quỹ tiền mặt ${branch.name}`,
        openingBalanceVnd: parsed.branches.get(branch.id) ?? 0n,
        openingAt: at,
        openingByUserId: context.actor.userId,
      },
      select: { id: true },
    });
  }
  await tx.cashFund.create({
    data: {
      kind: 'BANK',
      name: 'Quỹ ngân hàng',
      openingBalanceVnd: parsed.bank,
      openingAt: at,
      openingByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'FINANCE_GO_LIVE',
    entityType: 'FinanceGoLive',
    entityId: '1',
    classification: 'FINANCIAL',
    after: {
      at: at.toISOString(),
      bankVnd: parsed.bank.toString(),
      branches: branches.map((branch) => ({
        branchId: branch.id,
        countedVnd: (parsed.branches.get(branch.id) ?? 0n).toString(),
      })),
    },
  });
  return cashOverview(context);
}
