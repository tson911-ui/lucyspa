import {
  REVENUE_CHANNELS,
  REVENUE_KINDS,
  REVENUE_SIDES,
  type ReportBranchRef,
  type ReportBucket,
  type RevenueBranchRow,
  type RevenueChannel,
  type RevenueKind,
  type RevenueMethod,
  type RevenueMethodRow,
  type RevenuePart,
  type RevenuePoint,
  type RevenueReport,
  type RevenueSide,
  type RevenueTotals,
} from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import {
  bucketStart,
  bucketStarts,
  parseBucket,
  parseRange,
  previousRange,
  type ReportRange,
} from './report.dates.js';
import type { ReportBranch, ReportContext } from './report.frame.js';
import {
  loadControlTotal,
  loadFacts,
  loadOnlineHeld,
  loadPaidInvoices,
  loadVisits,
  type FactRow,
} from './revenue.sql.js';

/**
 * Phase 8 P8-3: the revenue report (docs/PHASE8_REPORTS.md 4.1-4.2). The SQL module (`revenue.sql.ts`) yields the facts; everything here
 * is arithmetic over them, so each breakdown is a regrouping of the same facts and its parts add up to the headline by construction.
 * The control total is computed without the splitting and must agree, else the report is refused (REPORT_TOTALS_DIFFER).
 */

export interface RevenueQuery {
  from?: unknown;
  to?: unknown;
  branchId?: unknown;
  bucket?: unknown;
  compare?: unknown;
}

const zero = (): Totals => ({ collected: 0n, refunds: 0n, exchanges: 0n });

interface Totals {
  collected: bigint;
  refunds: bigint;
  exchanges: bigint;
}

const net = (t: Totals): bigint => t.collected - t.refunds - t.exchanges;

function add(target: Totals, fact: FactRow): void {
  if (fact.flow === 'PAYMENT') target.collected += fact.amountVnd;
  else if (fact.flow === 'REFUND') target.refunds -= fact.amountVnd;
  else target.exchanges -= fact.amountVnd;
}

const str = (value: bigint) => value.toString();

function totalsOf(t: Totals, shipping: bigint): RevenueTotals {
  return {
    netVnd: str(net(t)),
    collectedVnd: str(t.collected),
    refundsVnd: str(t.refunds),
    exchangesVnd: str(t.exchanges),
    shippingVnd: str(shipping),
  };
}

/** Half-up share in basis points; 0 when the net is not positive. */
function shareBp(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const scaled = part * 10000n * 2n + whole;
  return Number(scaled / (whole * 2n));
}

function parts<K extends string>(
  keys: readonly K[],
  amounts: Map<K, bigint>,
  whole: bigint,
  keepEmpty: boolean,
): RevenuePart<K>[] {
  return keys
    .filter((key) => keepEmpty || (amounts.get(key) ?? 0n) !== 0n)
    .map((key) => ({
      key,
      netVnd: str(amounts.get(key) ?? 0n),
      shareBp: shareBp(amounts.get(key) ?? 0n, whole),
    }));
}

interface Computed {
  facts: FactRow[];
  control: { netVnd: bigint; shippingVnd: bigint };
}

async function compute(
  context: ReportContext,
  branches: readonly ReportBranch[],
  range: ReportRange,
): Promise<Computed> {
  const scope = { branchIds: branches.map((branch) => branch.id), from: range.from, to: range.to };
  const facts = await loadFacts(context.tx, scope);
  const control = await loadControlTotal(context.tx, scope);
  const sum = facts.reduce((acc, fact) => acc + fact.amountVnd, 0n);
  if (sum !== control.netVnd) throw new AuthError('REPORT_TOTALS_DIFFER');
  return { facts, control };
}

function series(
  facts: readonly FactRow[],
  range: ReportRange,
  bucket: ReportBucket,
): RevenuePoint[] {
  const starts = bucketStarts(range, bucket);
  const map = new Map(starts.map((start) => [start, zero()]));
  for (const fact of facts) add(map.get(bucketStart(fact.day, bucket))!, fact);
  return starts.map((start) => ({ start, ...totalsOf(map.get(start)!, 0n) }));
}

function branchRef(branch: ReportBranch): ReportBranchRef {
  return { id: branch.id, code: branch.code, name: branch.name };
}

/** R1-R4: the revenue report of a period, with the optional comparison to the equal period before it. */
export async function revenueReport(
  context: ReportContext,
  query: RevenueQuery,
): Promise<RevenueReport> {
  const covered = context.scope(['VIEW_REVENUE'], query.branchId);
  const range = parseRange(query);
  const bucket = parseBucket(query.bucket, range);
  const compare = query.compare === undefined || query.compare === '' ? 'none' : query.compare;
  if (compare !== 'none' && compare !== 'previous') {
    throw new AuthError('VALIDATION_FAILED', 'compare');
  }
  const previous = compare === 'previous' ? previousRange(range) : null;

  const current = await compute(context, covered, range);
  const before = previous ? await compute(context, covered, previous) : null;

  const scope = { branchIds: covered.map((b) => b.id), from: range.from, to: range.to };
  const [paid, visits, held] = await Promise.all([
    loadPaidInvoices(context.tx, scope),
    loadVisits(context.tx, scope),
    loadOnlineHeld(
      context.tx,
      covered.map((b) => b.id),
    ),
  ]);

  const all = zero();
  const bySide = new Map<RevenueSide, bigint>();
  const byKind = new Map<RevenueKind, bigint>();
  const byChannel = new Map<RevenueChannel, bigint>();
  const methods = new Map<RevenueMethod, { in: bigint; out: bigint }>();
  const perBranch = new Map<string, Totals>(covered.map((b) => [b.id, zero()]));
  for (const fact of current.facts) {
    add(all, fact);
    add(perBranch.get(fact.branchId) ?? zero(), fact);
    bySide.set(fact.side, (bySide.get(fact.side) ?? 0n) + fact.amountVnd);
    byKind.set(fact.kind, (byKind.get(fact.kind) ?? 0n) + fact.amountVnd);
    byChannel.set(fact.channel, (byChannel.get(fact.channel) ?? 0n) + fact.amountVnd);
    const row = methods.get(fact.method) ?? { in: 0n, out: 0n };
    if (fact.flow === 'PAYMENT') row.in += fact.amountVnd;
    else row.out -= fact.amountVnd;
    methods.set(fact.method, row);
  }
  const headline = net(all);

  const previousNetByBranch = new Map<string, bigint>();
  if (before) {
    for (const fact of before.facts) {
      previousNetByBranch.set(
        fact.branchId,
        (previousNetByBranch.get(fact.branchId) ?? 0n) + fact.amountVnd,
      );
    }
  }
  const paidByBranch = new Map(paid.map((row) => [row.branchId, row]));
  const byBranch: RevenueBranchRow[] = covered.map((branch) => {
    const totals = perBranch.get(branch.id) ?? zero();
    const invoices = paidByBranch.get(branch.id);
    return {
      branch: branchRef(branch),
      netVnd: str(net(totals)),
      collectedVnd: str(totals.collected),
      refundsVnd: str(totals.refunds),
      exchangesVnd: str(totals.exchanges),
      paidInvoices: invoices?.count ?? 0,
      visits: visits.get(branch.id) ?? 0,
      previousNetVnd: before ? str(previousNetByBranch.get(branch.id) ?? 0n) : null,
    };
  });

  const paidCount = paid.reduce((acc, row) => acc + row.count, 0);
  const paidTotal = paid.reduce((acc, row) => acc + row.totalVnd, 0n);
  const sides = parts(REVENUE_SIDES, bySide, headline, false);
  const kinds = parts(REVENUE_KINDS, byKind, headline, false);
  const channels = parts(REVENUE_CHANNELS, byChannel, headline, true);

  // Parts add up to the headline (the facts are regrouped, so this holds unless a key was dropped).
  for (const group of [sides, kinds, channels]) {
    const total = group.reduce((acc, part) => acc + BigInt(part.netVnd), 0n);
    if (total !== headline) throw new AuthError('REPORT_TOTALS_DIFFER');
  }
  const methodRows: RevenueMethodRow[] = (['CASH', 'PAYOS', 'TRANSFER'] as const).map((method) => {
    const row = methods.get(method) ?? { in: 0n, out: 0n };
    return { method, inVnd: str(row.in), outVnd: str(row.out), netVnd: str(row.in - row.out) };
  });
  if (methodRows.reduce((acc, row) => acc + BigInt(row.netVnd), 0n) !== headline) {
    throw new AuthError('REPORT_TOTALS_DIFFER');
  }
  if (byBranch.reduce((acc, row) => acc + BigInt(row.netVnd), 0n) !== headline) {
    throw new AuthError('REPORT_TOTALS_DIFFER');
  }

  const beforeTotals = zero();
  if (before) for (const fact of before.facts) add(beforeTotals, fact);

  return {
    generatedAt: context.now.toISOString(),
    period: {
      from: range.from,
      to: range.to,
      previous: previous ? { from: previous.from, to: previous.to } : null,
    },
    bucket,
    branches: covered.map(branchRef),
    totals: totalsOf(all, current.control.shippingVnd),
    previousTotals: before ? totalsOf(beforeTotals, before.control.shippingVnd) : null,
    series: series(current.facts, range, bucket),
    previousSeries: before && previous ? series(before.facts, previous, bucket) : null,
    byBranch,
    bySide: sides,
    byKind: kinds,
    byChannel: channels,
    byMethod: methodRows,
    paidInvoices: {
      count: paidCount,
      totalVnd: str(paidTotal),
      averageVnd: str(
        paidCount === 0 ? 0n : (paidTotal * 2n + BigInt(paidCount)) / (BigInt(paidCount) * 2n),
      ),
    },
    visits: [...visits.values()].reduce((acc, n) => acc + n, 0),
    onlineHeldVnd: str(held),
    unclassifiedVnd: str(bySide.get('UNCLASSIFIED') ?? 0n),
  };
}
