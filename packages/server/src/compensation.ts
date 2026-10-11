import type { Prisma } from '@lucy-spa/database';
import {
  commissionAmount,
  pickCommissionRule,
  pickTourRule,
  proportionalShare,
  type CommissionRuleRow,
  type TourRuleRow,
} from './pay-rules.js';

/**
 * Phase 7 P7-9 (design PHASE7_PAYROLL_FUNDS.md section 5; P7-T3, P7-T4, P7-T6): earning tour and product commission.
 *
 * The engine is STATE-BASED, like the stock-sale settlement: it reads the authoritative state of ONE invoice and brings its earnings
 * in line with it, so it gives the same result whatever order things happened in and a replay writes nothing:
 *
 * - The invoice is PAID at episode N (paid at or after the Owner's go-live): every eligible line has exactly one earning for that episode.
 *   A service line earns the tour amount of its service in force on the day, for the KTV on the line, if that person is an OFFICIAL
 *   employee that day (a collaborator is paid by agreement, a trainee earns nothing) and the service was really paid for: a bonus combo
 *   session and a reward are free and earn nothing (PRD 17.6); a PAID combo session earns (Owner, OQ-104). A product line earns the
 *   commission of the most specific rule in force, on the line's net after discounts (OQ-105), for its seller, or for the person the
 *   Owner named as seller afterwards (an audited override). With no rule in force nothing is earned (the line shows up as "no rule").
 * - An earning is never edited. When its episode has ended (the payment was reversed, the invoice cancelled or paid again), when a
 *   product is refunded or exchanged, or when the seller is changed, the engine adds a NEGATIVE row that points at it, cumulative and
 *   never above the earning (a refund takes back its share of the commission).
 * - Every row has a `source_key`, so two workers or two passes never write the same row twice.
 * Nothing is paid by any of this: earnings only feed the payroll DRAFT, which the Owner closes by hand.
 */
type Tx = Prisma.TransactionClient;

export interface PayRules {
  tour: TourRuleRow[];
  commission: CommissionRuleRow[];
}

const day = (value: Date): string => value.toISOString().slice(0, 10);

export async function loadPayRules(tx: Tx): Promise<PayRules> {
  const [tour, commission] = await Promise.all([
    tx.tourRule.findMany({
      select: { id: true, serviceId: true, amountVnd: true, effectiveFrom: true },
    }),
    tx.commissionRule.findMany({
      select: {
        id: true,
        scope: true,
        brandId: true,
        categoryId: true,
        productId: true,
        employeeUserId: true,
        kind: true,
        value: true,
        effectiveFrom: true,
      },
    }),
  ]);
  return {
    tour: tour.map((rule) => ({
      id: rule.id,
      serviceId: rule.serviceId,
      amountVnd: rule.amountVnd,
      effectiveFrom: day(rule.effectiveFrom),
    })),
    commission: commission.map((rule) => ({ ...rule, effectiveFrom: day(rule.effectiveFrom) })),
  };
}

/** The people who are OFFICIAL employees on a date: the latest classification change on or before it. */
export async function officialOn(
  tx: Tx,
  ids: readonly string[],
  date: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const changes = await tx.employmentClassificationChange.findMany({
    where: {
      employeeUserId: { in: [...ids] },
      effectiveDate: { lte: new Date(`${date}T00:00:00.000Z`) },
    },
    orderBy: [{ employeeUserId: 'asc' }, { effectiveDate: 'desc' }],
    select: { employeeUserId: true, classification: true },
  });
  const latest = new Map<string, string>();
  for (const change of changes)
    if (!latest.has(change.employeeUserId))
      latest.set(change.employeeUserId, change.classification);
  return new Set(
    [...latest]
      .filter(([, classification]) => classification === 'OFFICIAL_EMPLOYEE')
      .map(([id]) => id),
  );
}

export interface ReconcileResult {
  /** Earnings and reversals written by this call. */
  written: number;
}

/**
 * Brings the earnings of one invoice in line with its state. The caller holds a transaction; the invoice row is locked here so two
 * passes never interleave. Returns how many rows were written.
 */
export async function reconcileInvoiceEarnings(
  tx: Tx,
  invoiceId: string,
  preloaded?: PayRules,
): Promise<ReconcileResult> {
  const live = await tx.financeGoLive.findUnique({ where: { id: 1 }, select: { at: true } });
  if (!live) return { written: 0 };
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      paidSeq: true,
      paidAt: true,
      branchId: true,
      orderReferral: { select: { employeeUserId: true } },
    },
  });
  if (!invoice) return { written: 0 };
  // An online line has no seller; the staff code the customer entered at checkout names who earns on it (P7-T16).
  const referral = invoice.orderReferral?.employeeUserId ?? null;
  const episode =
    invoice.status === 'PAID' && invoice.paidAt !== null && invoice.paidAt >= live.at
      ? invoice.paidSeq
      : null;
  const existing = await tx.payEarning.findMany({
    where: { invoiceId },
    select: {
      id: true,
      kind: true,
      employeeUserId: true,
      invoiceLineId: true,
      paidSeq: true,
      amountVnd: true,
      quantity: true,
      reversesId: true,
      reason: true,
      sourceKey: true,
    },
  });
  const rows: Prisma.PayEarningCreateManyInput[] = [];
  let createdCount = 0;

  if (episode !== null) {
    const rules = preloaded ?? (await loadPayRules(tx));
    const [dateRow] = await tx.$queryRaw<{ d: Date }[]>`
      SELECT lucy_branch_local_date(${invoice.branchId}::uuid, ${invoice.paidAt}::timestamptz) AS d`;
    const date = day(dateRow!.d);
    const lines = await tx.invoiceLine.findMany({
      where: { invoiceId },
      select: {
        id: true,
        kind: true,
        quantity: true,
        serviceDetails: { select: { serviceId: true, employeeUserId: true } },
        productDetails: {
          select: { productId: true, brandId: true, categoryId: true, sellerUserId: true },
        },
        allocations: { select: { netVnd: true } },
        comboConsumption: { select: { release: true, session: { select: { kind: true } } } },
        rewardRedemption: { select: { release: true } },
        paySellerOverrides: {
          orderBy: { seq: 'desc' },
          take: 1,
          select: { employeeUserId: true },
        },
      },
    });
    const candidates = new Set<string>();
    for (const line of lines) {
      const service = line.serviceDetails[0];
      const product = line.productDetails[0];
      if (service) candidates.add(service.employeeUserId);
      if (product)
        candidates.add(
          line.paySellerOverrides[0]?.employeeUserId ?? product.sellerUserId ?? referral ?? '',
        );
    }
    candidates.delete('');
    const official = await officialOn(tx, [...candidates], date);
    for (const line of lines) {
      const service = line.serviceDetails[0];
      const product = line.productDetails[0];
      if (line.kind === 'SERVICE' && service) {
        const consumedFree =
          (line.comboConsumption !== null &&
            line.comboConsumption.release === null &&
            line.comboConsumption.session.kind === 'BONUS') ||
          (line.rewardRedemption !== null && line.rewardRedemption.release === null);
        if (consumedFree || !official.has(service.employeeUserId)) continue;
        const rule = pickTourRule(rules.tour, service.serviceId, date);
        if (!rule || rule.amountVnd <= 0n) continue;
        rows.push({
          kind: 'TOUR',
          employeeUserId: service.employeeUserId,
          branchId: invoice.branchId,
          invoiceId,
          invoiceLineId: line.id,
          paidSeq: episode,
          businessDate: new Date(`${date}T00:00:00.000Z`),
          amountVnd: rule.amountVnd,
          quantity: 1,
          ruleId: rule.id,
          ruleKind: 'TOUR',
          ruleValue: rule.amountVnd,
          sourceKey: `TOUR:${line.id}:${episode}:${service.employeeUserId}`,
        });
      }
      if (line.kind === 'PRODUCT' && product) {
        const seller =
          line.paySellerOverrides[0]?.employeeUserId ?? product.sellerUserId ?? referral;
        const net = line.allocations[0]?.netVnd;
        if (!seller || net === undefined || line.quantity === null || !official.has(seller))
          continue;
        const rule = pickCommissionRule(
          rules.commission,
          {
            employeeUserId: seller,
            productId: product.productId,
            categoryId: product.categoryId,
            brandId: product.brandId,
          },
          date,
        );
        if (!rule) continue;
        const amount = commissionAmount(rule, net, line.quantity);
        if (amount <= 0n) continue;
        rows.push({
          kind: 'PRODUCT_COMMISSION',
          employeeUserId: seller,
          branchId: invoice.branchId,
          invoiceId,
          invoiceLineId: line.id,
          paidSeq: episode,
          businessDate: new Date(`${date}T00:00:00.000Z`),
          amountVnd: amount,
          baseVnd: net,
          quantity: line.quantity,
          ruleId: rule.id,
          ruleKind: rule.kind,
          ruleValue: rule.value,
          sourceKey: `COMM:${line.id}:${episode}:${seller}`,
        });
      }
    }
    // A recipient earns on a line once at a time: a new row only when there is no live earning for that person, line and episode (one
    // that was reversed by the end of its episode or by a change of seller is dead; coming back later is a new generation of the key).
    const dead = new Set(
      existing
        .filter(
          (row) =>
            row.reversesId !== null &&
            (row.reason === 'EPISODE_ENDED' || row.reason === 'SELLER_CHANGED'),
        )
        .map((row) => row.reversesId),
    );
    const groupOf = (row: {
      kind: string;
      invoiceLineId: string;
      paidSeq: number;
      employeeUserId: string;
    }) => `${row.kind}:${row.invoiceLineId}:${row.paidSeq}:${row.employeeUserId}`;
    const earns = existing.filter((row) => row.reversesId === null);
    const live = new Set(earns.filter((row) => !dead.has(row.id)).map(groupOf));
    const generations = new Map<string, number>();
    for (const row of earns)
      generations.set(groupOf(row), (generations.get(groupOf(row)) ?? 0) + 1);
    const wanted = rows
      .splice(0)
      .filter((row) => !live.has(groupOf(row as Parameters<typeof groupOf>[0])))
      .map((row) => ({
        ...row,
        sourceKey: `${row.sourceKey}:${generations.get(groupOf(row as Parameters<typeof groupOf>[0])) ?? 0}`,
      }));
    const created = wanted.length === 0 ? [] : await createEarnings(tx, wanted);
    createdCount = created.length;
    for (const row of created) {
      existing.push({
        id: row.id,
        kind: row.kind,
        employeeUserId: row.employeeUserId,
        invoiceLineId: row.invoiceLineId,
        paidSeq: row.paidSeq,
        amountVnd: row.amountVnd,
        quantity: row.quantity,
        reversesId: null,
        reason: null,
        sourceKey: row.sourceKey,
      });
    }
    rows.push(
      ...(await reversalRows(
        tx,
        invoiceId,
        episode,
        existing,
        new Map(lines.map((line) => [line.id, wantedRecipient(line, referral)])),
      )),
    );
  } else {
    rows.push(...(await reversalRows(tx, invoiceId, null, existing, new Map())));
  }
  const inserted =
    rows.length === 0
      ? 0
      : (await tx.payEarning.createMany({ data: rows, skipDuplicates: true })).count;
  return { written: inserted + createdCount };
}

type LineForRecipient = {
  serviceDetails: { employeeUserId: string }[];
  productDetails: { sellerUserId: string | null }[];
  paySellerOverrides: { employeeUserId: string }[];
};

/** Who should be earning on a line right now (the KTV of a service line, the seller or the named override of a product line). */
function wantedRecipient(line: LineForRecipient, referral: string | null): string | null {
  const service = line.serviceDetails[0];
  if (service) return service.employeeUserId;
  const product = line.productDetails[0];
  if (product)
    return line.paySellerOverrides[0]?.employeeUserId ?? product.sellerUserId ?? referral;
  return null;
}

async function createEarnings(tx: Tx, data: Prisma.PayEarningCreateManyInput[]) {
  const created = await tx.payEarning.createManyAndReturn({
    data,
    skipDuplicates: true,
    select: {
      id: true,
      kind: true,
      employeeUserId: true,
      invoiceLineId: true,
      paidSeq: true,
      amountVnd: true,
      quantity: true,
      sourceKey: true,
    },
  });
  return created;
}

/**
 * The reversals an invoice's earnings need: all of an earning when its episode is over or its recipient is no longer the wanted one,
 * and for a product line its share of the units refunded or exchanged. Cumulative: only the missing part is added.
 */
async function reversalRows(
  tx: Tx,
  invoiceId: string,
  currentEpisode: number | null,
  existing: readonly {
    id: string;
    kind: 'TOUR' | 'PRODUCT_COMMISSION';
    employeeUserId: string;
    invoiceLineId: string;
    paidSeq: number;
    amountVnd: bigint;
    quantity: number | null;
    reversesId: string | null;
  }[],
  recipients: ReadonlyMap<string, string | null>,
): Promise<Prisma.PayEarningCreateManyInput[]> {
  const earns = existing.filter((row) => row.reversesId === null);
  if (earns.length === 0) return [];
  const reversedBy = new Map<string, bigint>();
  for (const row of existing) {
    if (row.reversesId !== null)
      reversedBy.set(row.reversesId, (reversedBy.get(row.reversesId) ?? 0n) - row.amountVnd);
  }
  const [refunds, exchanges] = await Promise.all([
    tx.productRefund.groupBy({
      by: ['invoiceLineId', 'paidSeq'],
      where: { invoiceId },
      _sum: { quantity: true },
    }),
    tx.productExchange.groupBy({
      by: ['invoiceLineId', 'paidSeq'],
      where: { invoiceId },
      _sum: { quantity: true },
    }),
  ]);
  const unitsOut = new Map<string, number>();
  for (const group of [...refunds, ...exchanges]) {
    const key = `${group.invoiceLineId}:${group.paidSeq}`;
    unitsOut.set(key, (unitsOut.get(key) ?? 0) + (group._sum.quantity ?? 0));
  }
  const originals = await tx.payEarning.findMany({
    where: { id: { in: earns.map((row) => row.id) } },
    select: { id: true, branchId: true, businessDate: true },
  });
  const meta = new Map(originals.map((row) => [row.id, row]));
  const out: Prisma.PayEarningCreateManyInput[] = [];
  for (const earn of earns) {
    const done = reversedBy.get(earn.id) ?? 0n;
    let wanted: bigint;
    let reason: string;
    const stale = currentEpisode === null || earn.paidSeq !== currentEpisode;
    const moved =
      !stale &&
      recipients.has(earn.invoiceLineId) &&
      recipients.get(earn.invoiceLineId) !== earn.employeeUserId;
    if (stale) {
      wanted = earn.amountVnd;
      reason = 'EPISODE_ENDED';
    } else if (moved) {
      wanted = earn.amountVnd;
      reason = 'SELLER_CHANGED';
    } else if (earn.kind === 'PRODUCT_COMMISSION' && earn.quantity !== null) {
      const units = unitsOut.get(`${earn.invoiceLineId}:${earn.paidSeq}`) ?? 0;
      wanted = proportionalShare(earn.amountVnd, 0, units, earn.quantity);
      reason = 'REFUND';
    } else {
      continue;
    }
    if (wanted <= done) continue;
    const info = meta.get(earn.id)!;
    out.push({
      kind: earn.kind,
      employeeUserId: earn.employeeUserId,
      branchId: info.branchId,
      invoiceId,
      invoiceLineId: earn.invoiceLineId,
      paidSeq: earn.paidSeq,
      businessDate: info.businessDate,
      amountVnd: -(wanted - done),
      reversesId: earn.id,
      reason,
      sourceKey: `REV:${earn.id}:${wanted}`,
    });
  }
  return out;
}

export interface SweepResult {
  invoices: number;
  written: number;
}

/**
 * One pass over the invoices that may need their earnings brought in line: those paid since `since`, those that already have earnings
 * and changed since then, and those with a refund or exchange since then. `since = null` looks at everything since go-live. Each
 * invoice runs in the caller's transaction one after the other (the worker gives each its own transaction).
 */
export async function candidateInvoices(
  tx: Tx,
  options: { since: Date | null; limit: number },
): Promise<{ id: string; touchedAt: Date }[]> {
  const live = await tx.financeGoLive.findUnique({ where: { id: 1 }, select: { at: true } });
  if (!live) return [];
  const floor = options.since && options.since > live.at ? options.since : live.at;
  const rows = await tx.$queryRaw<{ id: string; touched: Date }[]>`
    SELECT i.id,
           GREATEST(i.updated_at,
                    COALESCE((SELECT max(r.occurred_at) FROM product_refunds r WHERE r.invoice_id = i.id), 'epoch'::timestamptz),
                    COALESCE((SELECT max(x.occurred_at) FROM product_exchanges x WHERE x.invoice_id = i.id), 'epoch'::timestamptz)) AS touched
    FROM invoices i
    WHERE (i.paid_at >= ${floor})
       OR (${options.since === null} AND EXISTS (SELECT 1 FROM pay_earnings e WHERE e.invoice_id = i.id))
       OR (i.updated_at >= ${floor} AND EXISTS (SELECT 1 FROM pay_earnings e WHERE e.invoice_id = i.id))
       OR EXISTS (SELECT 1 FROM product_refunds r WHERE r.invoice_id = i.id AND r.occurred_at >= ${floor})
       OR EXISTS (SELECT 1 FROM product_exchanges x WHERE x.invoice_id = i.id AND x.occurred_at >= ${floor})
    ORDER BY touched DESC, i.id
    LIMIT ${options.limit}`;
  return rows.map((row) => ({ id: row.id, touchedAt: row.touched }));
}
