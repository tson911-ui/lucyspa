import {
  CASH_AMOUNT_MAX_VND,
  CASH_MANUAL_KINDS,
  CASH_PAGE_SIZE,
  CASH_REASON_MAX,
  FUND_ENTRY_CATEGORIES,
  type CashEntryItem,
  type CashEntryListResponse,
  type CashEntryResponse,
  type CashFundItem,
  type CashManualEntryRequest,
  type CashManualKind,
  type CashReverseRequest,
  type CashTransferRequest,
  type CashTransferResponse,
  type FundDirectionName,
  type FundEntryCategoryName,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { randomUUID } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import {
  activeBranches,
  canManageAt,
  canViewAt,
  holdsEverywhere,
  type ActiveBranch,
} from './cash.access.js';
import { financeGoLive } from './cash.core.js';
import { exactKeys, money, reason, uuid } from './finance.input.js';
import { spendConfirmation, takeFreshConfirmation } from './finance.reauth.js';

/**
 * Phase 7 P7-4 (design 7.1, 7.2): what a person writes into the book by hand, and how the book is read.
 *
 * - Manual entries: money in (`MANUAL_INCOME`), money out (`MANUAL_EXPENSE`), a staff deposit of collected cash (`DEPOSIT`) and an
 *   Owner withdrawal (`OWNER_WITHDRAWAL`, fresh password). Amount and reason are always required (PRD 35.3). `MANAGE_CASH` at the fund's
 *   branch (the bank fund: at every branch); a deposit is also open to `COLLECT_PAYMENTS` (a KTV can deposit, never withdraw).
 * - A transfer between two funds (cash banked, bank cash taken out): two linked entries, `MANAGE_CASH` on both, fresh password.
 * - A mistake is reversed by a CORRECTION entry that points at the entry (manual ones only: the posted ones follow their source).
 * - A cash fund never goes below zero through a manual payment: the drawer cannot give what it does not hold.
 * - Nothing is written before the Owner has started the book. A closed day takes nothing: the entry goes to the first open day.
 */
type Tx = Prisma.TransactionClient;

const MANUAL = new Set<string>(CASH_MANUAL_KINDS);
const CATEGORIES = new Set<string>(FUND_ENTRY_CATEGORIES);
const DIRECTIONS = new Set(['IN', 'OUT']);
const OUT_KINDS = new Set<string>(['MANUAL_EXPENSE', 'OWNER_WITHDRAWAL']);

interface FundRow {
  id: string;
  kind: 'CASH' | 'BANK';
  name: string;
  isActive: boolean;
  openingBalanceVnd: bigint;
  branch: { id: string; code: string; name: string; timezone: string } | null;
}

const FUND_SELECT = {
  id: true,
  kind: true,
  name: true,
  isActive: true,
  openingBalanceVnd: true,
  branch: { select: { id: true, code: true, name: true, timezone: true } },
} satisfies Prisma.CashFundSelect;

async function needLive(tx: Tx): Promise<void> {
  if (!(await financeGoLive(tx))) throw new AuthError('FINANCE_NOT_LIVE');
}

async function needFund(tx: Tx, id: string): Promise<FundRow> {
  const fund = await tx.cashFund.findUnique({ where: { id }, select: FUND_SELECT });
  if (!fund || !fund.isActive) throw new AuthError('NOT_FOUND');
  return fund;
}

/** Locks funds in id order: FOR UPDATE when the command takes money out (it checks the balance), else FOR SHARE. */
async function lockFunds(tx: Tx, ids: readonly string[], exclusive: boolean): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  if (exclusive) {
    await tx.$queryRaw`SELECT id FROM cash_funds WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM cash_funds WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR SHARE`;
  }
}

export async function fundBalance(tx: Tx, fund: Pick<FundRow, 'id' | 'openingBalanceVnd'>) {
  const rows = await tx.$queryRaw<{ net: bigint }[]>`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_vnd ELSE -amount_vnd END), 0)::bigint AS net
    FROM fund_entries WHERE fund_id = ${fund.id}::uuid`;
  return fund.openingBalanceVnd + (rows[0]?.net ?? 0n);
}

function mayView(context: AdminContext, fund: FundRow, branches: readonly ActiveBranch[]): boolean {
  return fund.kind === 'BANK'
    ? holdsEverywhere(context, branches, 'view')
    : fund.branch !== null && canViewAt(context, fund.branch.id);
}

function mayManage(
  context: AdminContext,
  fund: FundRow,
  branches: readonly ActiveBranch[],
): boolean {
  return fund.kind === 'BANK'
    ? holdsEverywhere(context, branches, 'manage')
    : fund.branch !== null && canManageAt(context, fund.branch.id);
}

function mayDeposit(context: AdminContext, fund: FundRow): boolean {
  return (
    fund.kind === 'CASH' &&
    fund.branch !== null &&
    (canManageAt(context, fund.branch.id) ||
      decide(context.actor.graph, 'COLLECT_PAYMENTS', { kind: 'BRANCH', branchId: fund.branch.id }))
  );
}

const localDay = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

/** The day a new entry of the fund counts for: today in the branch's calendar, or the day after the last closing. */
async function openDay(tx: Tx, fund: FundRow, timeZone: string, now: Date): Promise<Date> {
  const today = localDay(now, timeZone);
  let day = today;
  if (fund.kind === 'CASH') {
    const last = await tx.cashDayClosing.findFirst({
      where: { fundId: fund.id },
      orderBy: { businessDate: 'desc' },
      select: { businessDate: true },
    });
    if (last) {
      const next = new Date(last.businessDate.getTime() + 86_400_000).toISOString().slice(0, 10);
      if (next > day) day = next;
    }
  }
  return new Date(`${day}T00:00:00.000Z`);
}

// --------------------------------------------------------------------------------------------------- presenting
interface EntryRow {
  id: string;
  seq: string;
  business_date: string;
  direction: string;
  category: string;
  amount_vnd: string;
  reference: string | null;
  reason: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  occurred_at: Date;
  reverses_entry_id: string | null;
  reversed_by: string | null;
}

const ENTRY_COLUMNS = Prisma.sql`
  e.id, e.seq::text AS seq, to_char(e.business_date, 'YYYY-MM-DD') AS business_date, e.direction::text AS direction,
  e.category::text AS category, e.amount_vnd::text AS amount_vnd, e.reason, e.actor_user_id, u.full_name AS actor_name,
  e.occurred_at, e.reverses_entry_id,
  (SELECT r.id FROM fund_entries r WHERE r.reverses_entry_id = e.id) AS reversed_by,
  COALESCE(i1.code, i2.code, pr.code, px.code) AS reference`;

const ENTRY_JOINS = Prisma.sql`
  FROM fund_entries e
  LEFT JOIN users u ON u.id = e.actor_user_id
  LEFT JOIN payments p ON e.source_type = 'PAYMENT' AND p.id = e.source_id
  LEFT JOIN invoices i1 ON i1.id = p.invoice_id
  LEFT JOIN payment_corrections pc ON e.source_type = 'PAYMENT_CORRECTION' AND pc.id = e.source_id
  LEFT JOIN payments p2 ON p2.id = pc.payment_id
  LEFT JOIN invoices i2 ON i2.id = p2.invoice_id
  LEFT JOIN product_refunds pr ON e.source_type = 'PRODUCT_REFUND' AND pr.id = e.source_id
  LEFT JOIN product_exchanges px ON e.source_type = 'PRODUCT_EXCHANGE' AND px.id = e.source_id`;

function presentEntry(row: EntryRow, canManageFund: boolean): CashEntryItem {
  return {
    id: row.id,
    seq: row.seq,
    businessDate: row.business_date,
    direction: row.direction as FundDirectionName,
    category: row.category as FundEntryCategoryName,
    amountVnd: row.amount_vnd,
    reference: row.reference,
    reason: row.reason,
    actor: row.actor_user_id ? { id: row.actor_user_id, name: row.actor_name ?? '' } : null,
    occurredAt: row.occurred_at.toISOString(),
    reversesEntryId: row.reverses_entry_id,
    reversedByEntryId: row.reversed_by,
    canReverse: canManageFund && MANUAL.has(row.category) && row.reversed_by === null,
  };
}

async function entriesByIds(tx: Tx, ids: readonly string[], canManageFund: boolean) {
  const rows = await tx.$queryRaw<EntryRow[]>`
    SELECT ${ENTRY_COLUMNS} ${ENTRY_JOINS} WHERE e.id = ANY(${ids}::uuid[]) ORDER BY e.seq`;
  return rows.map((row) => presentEntry(row, canManageFund));
}

async function fundItem(tx: Tx, fund: FundRow): Promise<CashFundItem> {
  const closed = await tx.cashDayClosing.findFirst({
    where: { fundId: fund.id },
    orderBy: { businessDate: 'desc' },
    select: { businessDate: true },
  });
  return {
    id: fund.id,
    kind: fund.kind,
    branch: fund.branch
      ? { id: fund.branch.id, code: fund.branch.code, name: fund.branch.name }
      : null,
    name: fund.name,
    openingBalanceVnd: fund.openingBalanceVnd.toString(),
    balanceVnd: (await fundBalance(tx, fund)).toString(),
    lastClosedDate: closed ? closed.businessDate.toISOString().slice(0, 10) : null,
  };
}

// ------------------------------------------------------------------------------------------------------ reads
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

function oneOf(value: unknown, allowed: ReadonlySet<string>, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !allowed.has(value))
    throw new AuthError('VALIDATION_FAILED', field);
  return value;
}

export interface EntryQuery {
  from?: unknown;
  to?: unknown;
  category?: unknown;
  direction?: unknown;
  page?: unknown;
}

export async function listEntries(
  context: AdminContext,
  fundIdRaw: string,
  query: EntryQuery,
): Promise<CashEntryListResponse> {
  const { tx } = context;
  const fundId = uuid(fundIdRaw, 'id');
  const fund = await tx.cashFund.findUnique({ where: { id: fundId }, select: FUND_SELECT });
  const branches = await activeBranches(context);
  if (!fund || !mayView(context, fund, branches))
    throw new AuthError(fund ? 'FORBIDDEN' : 'NOT_FOUND');
  const from = optionalDate(query.from, 'from');
  const to = optionalDate(query.to, 'to');
  if (from && to && from > to) throw new AuthError('VALIDATION_FAILED', 'to');
  const category = oneOf(query.category, CATEGORIES, 'category');
  const direction = oneOf(query.direction, DIRECTIONS, 'direction');
  const pageRaw = query.page === undefined || query.page === '' ? '1' : query.page;
  const page =
    typeof pageRaw === 'string' && /^[1-9][0-9]{0,4}$/.test(pageRaw) ? Number(pageRaw) : 0;
  if (page === 0) throw new AuthError('VALIDATION_FAILED', 'page');

  const where = Prisma.sql`e.fund_id = ${fund.id}::uuid
    ${from ? Prisma.sql`AND e.business_date >= ${from}::date` : Prisma.empty}
    ${to ? Prisma.sql`AND e.business_date <= ${to}::date` : Prisma.empty}
    ${category ? Prisma.sql`AND e.category = ${category}::"FundEntryCategory"` : Prisma.empty}
    ${direction ? Prisma.sql`AND e.direction = ${direction}::"FundDirection"` : Prisma.empty}`;
  const [totals, rows] = await Promise.all([
    tx.$queryRaw<{ n: bigint; in_vnd: bigint; out_vnd: bigint }[]>`
      SELECT count(*)::bigint AS n,
             COALESCE(SUM(e.amount_vnd) FILTER (WHERE e.direction = 'IN'), 0)::bigint AS in_vnd,
             COALESCE(SUM(e.amount_vnd) FILTER (WHERE e.direction = 'OUT'), 0)::bigint AS out_vnd
      FROM fund_entries e WHERE ${where}`,
    tx.$queryRaw<EntryRow[]>`
      SELECT ${ENTRY_COLUMNS} ${ENTRY_JOINS} WHERE ${where}
      ORDER BY e.business_date DESC, e.seq DESC LIMIT ${CASH_PAGE_SIZE} OFFSET ${(page - 1) * CASH_PAGE_SIZE}`,
  ]);
  const manage = mayManage(context, fund, branches);
  return {
    fund: await fundItem(tx, fund),
    items: rows.map((row) => presentEntry(row, manage)),
    page,
    pageSize: CASH_PAGE_SIZE,
    total: Number(totals[0]?.n ?? 0n),
    inVnd: (totals[0]?.in_vnd ?? 0n).toString(),
    outVnd: (totals[0]?.out_vnd ?? 0n).toString(),
    can: { record: manage, deposit: mayDeposit(context, fund), transfer: manage },
  };
}

// ---------------------------------------------------------------------------------------------- manual entry
const MANUAL_KEYS = [
  'fundId',
  'kind',
  'amountVnd',
  'reason',
  'clientRequestId',
  'branchId',
] as const;

/** The branch a BANK entry is attributed to: required for the shared bank fund, never given for a cash fund. */
function entryBranch(fund: FundRow, branches: readonly ActiveBranch[], raw: unknown): ActiveBranch {
  if (fund.kind === 'CASH') {
    if (raw !== undefined && raw !== null && raw !== fund.branch?.id) {
      throw new AuthError('VALIDATION_FAILED', 'branchId');
    }
    const own = branches.find((branch) => branch.id === fund.branch?.id);
    if (!own) throw new AuthError('NOT_FOUND');
    return own;
  }
  const chosen = branches.find((branch) => branch.id === uuid(raw, 'branchId'));
  if (!chosen) throw new AuthError('VALIDATION_FAILED', 'branchId');
  return chosen;
}

export async function recordManualEntry(
  context: AdminContext,
  request: CashManualEntryRequest,
  freshAuthSeconds: number,
): Promise<CashEntryResponse> {
  const { tx } = context;
  const body = exactKeys(request, MANUAL_KEYS, 'body');
  const fundId = uuid(body['fundId'], 'fundId');
  const kind = body['kind'];
  if (typeof kind !== 'string' || !MANUAL.has(kind))
    throw new AuthError('VALIDATION_FAILED', 'kind');
  const manualKind = kind as CashManualKind;
  const amount = money(body['amountVnd'], 'amountVnd', { positive: true });
  const why = reason(body['reason'], 'reason', CASH_REASON_MAX)!;
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');

  await needLive(tx);
  const fund = await needFund(tx, fundId);
  const branches = await activeBranches(context);
  if (manualKind === 'DEPOSIT' && fund.kind !== 'CASH')
    throw new AuthError('VALIDATION_FAILED', 'kind');
  const allowed =
    manualKind === 'DEPOSIT'
      ? fund.kind === 'CASH' && mayDeposit(context, fund)
      : mayManage(context, fund, branches);
  if (!allowed) throw new AuthError('FORBIDDEN');
  if (manualKind === 'DEPOSIT' && fund.kind !== 'CASH')
    throw new AuthError('VALIDATION_FAILED', 'kind');
  const branch = entryBranch(fund, branches, body['branchId']);

  const replay = async (): Promise<CashEntryResponse | null> => {
    const prior = await tx.fundEntry.findFirst({
      where: { actorUserId: context.actor.userId, clientRequestId },
      select: { id: true, fundId: true, category: true, amountVnd: true, reason: true },
    });
    if (!prior) return null;
    if (
      prior.fundId !== fund.id ||
      prior.category !== manualKind ||
      prior.amountVnd !== amount ||
      prior.reason !== why
    ) {
      throw new AuthError('CONFLICT');
    }
    return { item: (await entriesByIds(tx, [prior.id], true))[0]! };
  };
  const early = await replay();
  if (early) return early;

  const confirmedAt =
    manualKind === 'OWNER_WITHDRAWAL'
      ? await takeFreshConfirmation(context, freshAuthSeconds)
      : null;
  const out = OUT_KINDS.has(manualKind);
  await lockFunds(tx, [fund.id], out);
  const settled = await replay();
  if (settled) return settled;
  if (out && fund.kind === 'CASH' && (await fundBalance(tx, fund)) < amount) {
    throw new AuthError('CASH_INSUFFICIENT');
  }
  const created = await tx.fundEntry.create({
    data: {
      fundId: fund.id,
      branchId: branch.id,
      businessDate: await openDay(tx, fund, branch.timezone, context.now),
      direction: out ? 'OUT' : 'IN',
      category: manualKind,
      amountVnd: amount,
      reason: why,
      actorUserId: context.actor.userId,
      clientRequestId,
    },
    select: { id: true },
  });
  if (confirmedAt) await spendConfirmation(context, confirmedAt, 'CASH_WITHDRAWAL', created.id);
  await appendAdminAudit(context, {
    action: 'CASH_ENTRY_RECORDED',
    entityType: 'FundEntry',
    entityId: created.id,
    branchId: branch.id,
    reason: why,
    classification: 'FINANCIAL',
    after: { fundId: fund.id, category: manualKind, amountVnd: amount.toString() },
  });
  return { item: (await entriesByIds(tx, [created.id], true))[0]! };
}

// -------------------------------------------------------------------------------------------------- reversal
const REVERSE_KEYS = ['reason', 'clientRequestId'] as const;

export async function reverseEntry(
  context: AdminContext,
  entryIdRaw: string,
  request: CashReverseRequest,
): Promise<CashEntryResponse> {
  const { tx } = context;
  const entryId = uuid(entryIdRaw, 'id');
  const body = exactKeys(request, REVERSE_KEYS, 'body');
  const why = reason(body['reason'], 'reason', CASH_REASON_MAX)!;
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  await needLive(tx);
  const entry = await tx.fundEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      fundId: true,
      branchId: true,
      direction: true,
      category: true,
      amountVnd: true,
      reversesEntryId: true,
    },
  });
  if (!entry) throw new AuthError('NOT_FOUND');
  const fund = await needFund(tx, entry.fundId);
  const branches = await activeBranches(context);
  if (!mayManage(context, fund, branches)) throw new AuthError('FORBIDDEN');
  if (!MANUAL.has(entry.category)) throw new AuthError('CASH_ENTRY_NOT_REVERSIBLE');

  const replay = async (): Promise<CashEntryResponse | null> => {
    const prior = await tx.fundEntry.findFirst({
      where: { actorUserId: context.actor.userId, clientRequestId },
      select: { id: true, reversesEntryId: true, reason: true },
    });
    if (!prior) return null;
    if (prior.reversesEntryId !== entry.id || prior.reason !== why) throw new AuthError('CONFLICT');
    return { item: (await entriesByIds(tx, [prior.id], true))[0]! };
  };
  const early = await replay();
  if (early) return early;

  const out = entry.direction === 'IN'; // reversing money in takes money out
  await lockFunds(tx, [fund.id], out);
  const settled = await replay();
  if (settled) return settled;
  if (
    await tx.fundEntry.findFirst({ where: { reversesEntryId: entry.id }, select: { id: true } })
  ) {
    throw new AuthError('CASH_ENTRY_NOT_REVERSIBLE');
  }
  if (out && fund.kind === 'CASH' && (await fundBalance(tx, fund)) < entry.amountVnd) {
    throw new AuthError('CASH_INSUFFICIENT');
  }
  const branch = branches.find((candidate) => candidate.id === entry.branchId);
  const created = await tx.fundEntry.create({
    data: {
      fundId: fund.id,
      branchId: entry.branchId,
      businessDate: await openDay(tx, fund, branch?.timezone ?? 'Asia/Ho_Chi_Minh', context.now),
      direction: out ? 'OUT' : 'IN',
      category: 'CORRECTION',
      amountVnd: entry.amountVnd,
      reversesEntryId: entry.id,
      reason: why,
      actorUserId: context.actor.userId,
      clientRequestId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'CASH_ENTRY_REVERSED',
    entityType: 'FundEntry',
    entityId: created.id,
    branchId: entry.branchId,
    reason: why,
    classification: 'FINANCIAL',
    before: { entryId: entry.id, category: entry.category, amountVnd: entry.amountVnd.toString() },
  });
  return { item: (await entriesByIds(tx, [created.id], true))[0]! };
}

// ------------------------------------------------------------------------------------------------- transfer
const TRANSFER_KEYS = [
  'fromFundId',
  'toFundId',
  'amountVnd',
  'reason',
  'clientRequestId',
  'branchId',
] as const;

export async function transferBetweenFunds(
  context: AdminContext,
  request: CashTransferRequest,
  freshAuthSeconds: number,
): Promise<CashTransferResponse> {
  const { tx } = context;
  const body = exactKeys(request, TRANSFER_KEYS, 'body');
  const fromId = uuid(body['fromFundId'], 'fromFundId');
  const toId = uuid(body['toFundId'], 'toFundId');
  if (fromId === toId) throw new AuthError('VALIDATION_FAILED', 'toFundId');
  const amount = money(body['amountVnd'], 'amountVnd', { positive: true });
  const why = reason(body['reason'], 'reason', CASH_REASON_MAX)!;
  const clientRequestId = uuid(body['clientRequestId'], 'clientRequestId');
  await needLive(tx);
  const [from, to] = [await needFund(tx, fromId), await needFund(tx, toId)];
  const branches = await activeBranches(context);
  if (!mayManage(context, from, branches) || !mayManage(context, to, branches)) {
    throw new AuthError('FORBIDDEN');
  }
  // A transfer is attributed to the branch of its cash side; two bank-side funds do not exist (one bank fund).
  const anchor = from.kind === 'CASH' ? from : to;
  if (from.kind === 'BANK' && to.kind === 'BANK')
    throw new AuthError('VALIDATION_FAILED', 'toFundId');
  const branch = entryBranch(anchor, branches, body['branchId']);

  const replay = async (): Promise<CashTransferResponse | null> => {
    const prior = await tx.fundEntry.findFirst({
      where: { actorUserId: context.actor.userId, clientRequestId },
      select: { id: true, sourceId: true, fundId: true, amountVnd: true, reason: true },
    });
    if (!prior) return null;
    if (prior.fundId !== from.id || prior.amountVnd !== amount || prior.reason !== why) {
      throw new AuthError('CONFLICT');
    }
    const legs = await tx.fundEntry.findMany({
      where: { sourceType: 'FUND_TRANSFER', sourceId: prior.sourceId },
      orderBy: { sourceLeg: 'asc' },
      select: { id: true },
    });
    return {
      items: await entriesByIds(
        tx,
        legs.map((leg) => leg.id),
        true,
      ),
    };
  };
  const early = await replay();
  if (early) return early;

  const confirmedAt = await takeFreshConfirmation(context, freshAuthSeconds);
  await lockFunds(tx, [from.id, to.id], true);
  const settled = await replay();
  if (settled) return settled;
  if (from.kind === 'CASH' && (await fundBalance(tx, from)) < amount) {
    throw new AuthError('CASH_INSUFFICIENT');
  }
  const transferId = randomUUID();
  const make = async (fund: FundRow, direction: 'IN' | 'OUT', leg: number) => {
    const fundBranch = fund.branch ?? branch;
    const row = await tx.fundEntry.create({
      data: {
        fundId: fund.id,
        branchId: fundBranch.id,
        businessDate: await openDay(tx, fund, fundBranch.timezone, context.now),
        direction,
        category: 'FUND_TRANSFER',
        amountVnd: amount,
        sourceType: 'FUND_TRANSFER',
        sourceId: transferId,
        sourceLeg: leg,
        reason: why,
        actorUserId: context.actor.userId,
        ...(leg === 0 ? { clientRequestId } : {}),
      },
      select: { id: true },
    });
    return row.id;
  };
  const out = await make(from, 'OUT', 0);
  const inn = await make(to, 'IN', 1);
  await spendConfirmation(context, confirmedAt, 'CASH_TRANSFER', transferId);
  await appendAdminAudit(context, {
    action: 'CASH_TRANSFER',
    entityType: 'FundTransfer',
    entityId: transferId,
    branchId: branch.id,
    reason: why,
    classification: 'FINANCIAL',
    after: { fromFundId: from.id, toFundId: to.id, amountVnd: amount.toString() },
  });
  return { items: await entriesByIds(tx, [out, inn], true) };
}

export const CASH_LIMITS = Object.freeze({
  amountMax: CASH_AMOUNT_MAX_VND,
  reasonMax: CASH_REASON_MAX,
});
