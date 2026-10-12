import {
  LOYALTY_TIERS_V1,
  type BookingFunnelReport,
  type BookingPoint,
  type CustomerVisitsReport,
  type LoyaltyPointsRow,
  type LoyaltyReport,
  type ReportBranchRef,
  type StaffActivityReport,
  type StaffRow,
  type TopCustomerRow,
  type TopCustomersReport,
  type VisitPoint,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import {
  bucketStart,
  bucketStarts,
  parseBucket,
  parseRange,
  type ReportRange,
} from './report.dates.js';
import type { ReportBranch, ReportContext } from './report.frame.js';
import { factCtes } from './revenue.sql.js';

/**
 * Phase 8 P8-8 (docs/PHASE8_REPORTS.md 4.3-4.4): customers, bookings, loyalty, top customers and staff. Read-only; every figure is a fact
 * about what happened, never a ranking or a judgement. Definitions are in `reports-people.ts` (contracts).
 */

export interface PeopleQuery {
  from?: unknown;
  to?: unknown;
  branchId?: unknown;
  bucket?: unknown;
  restrictTo?: readonly ReportBranch[];
}

interface Frame {
  covered: readonly ReportBranch[];
  range: ReportRange;
  ids: string[];
  refs: ReportBranchRef[];
  period: { from: string; to: string; previous: null };
}

function frame(
  context: ReportContext,
  query: PeopleQuery,
  requires: Parameters<ReportContext['scope']>[0],
): Frame {
  const covered = query.restrictTo ?? context.scope(requires, query.branchId);
  const range = parseRange(query);
  return {
    covered,
    range,
    ids: covered.map((branch) => branch.id),
    refs: covered.map(({ id, code, name }) => ({ id, code, name })),
    period: { from: range.from, to: range.to, previous: null },
  };
}

const bp = (part: number, whole: number): number =>
  whole <= 0 ? 0 : Math.round((part * 10000) / whole);

/** The branch-local day bounds of a range against an instant column (branch alias `b`). */
const within = (column: string, range: ReportRange) => Prisma.sql`
  ${Prisma.raw(column)} >= ((${range.from}::date)::timestamp AT TIME ZONE b.timezone)
  AND ${Prisma.raw(column)} < ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)`;

// ------------------------------------------------------------------------------------------------ customers (C1)

export async function customerVisits(
  context: ReportContext,
  query: PeopleQuery,
): Promise<CustomerVisitsReport> {
  const f = frame(context, query, ['VIEW_BOOKINGS']);
  const bucket = parseBucket(query.bucket, f.range);
  const visits = await context.tx.$queryRaw<
    { day: string; branch_id: string; origin: string; n: number }[]
  >(Prisma.sql`
    SELECT to_char(v.service_date, 'YYYY-MM-DD') AS day, v.branch_id::text AS branch_id, v.origin::text AS origin, count(*)::int AS n
    FROM visits v
    WHERE v.status = 'COMPLETED' AND v.branch_id = ANY(${f.ids}::uuid[])
      AND v.service_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
    GROUP BY v.service_date, v.branch_id, v.origin`);
  const people = await context.tx.$queryRaw<
    { day: string; branch_id: string; pkey: string | null; first_seen: string | null }[]
  >(Prisma.sql`
    WITH in_range AS (
      SELECT v.service_date, v.branch_id, COALESCE(p.customer_user_id::text, p.phone_canonical) AS pkey
      FROM visits v JOIN visit_participants p ON p.visit_id = v.id
      WHERE v.status = 'COMPLETED' AND v.branch_id = ANY(${f.ids}::uuid[])
        AND v.service_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
    ),
    first_seen AS (
      SELECT COALESCE(p2.customer_user_id::text, p2.phone_canonical) AS pkey, min(v2.service_date) AS first_seen
      FROM visits v2 JOIN visit_participants p2 ON p2.visit_id = v2.id
      WHERE v2.status = 'COMPLETED' AND v2.service_date <= ${f.range.to}::date
        AND COALESCE(p2.customer_user_id::text, p2.phone_canonical) IN (SELECT pkey FROM in_range WHERE pkey IS NOT NULL)
      GROUP BY 1
    )
    SELECT to_char(r.service_date, 'YYYY-MM-DD') AS day, r.branch_id::text AS branch_id, r.pkey,
           to_char(fs.first_seen, 'YYYY-MM-DD') AS first_seen
    FROM in_range r LEFT JOIN first_seen fs ON fs.pkey = r.pkey`);

  const starts = bucketStarts(f.range, bucket);
  const points = new Map<string, { visits: number; people: Set<string>; fresh: Set<string> }>(
    starts.map((start) => [start, { visits: 0, people: new Set(), fresh: new Set() }]),
  );
  const totals = {
    visits: 0,
    bookedVisits: 0,
    walkInVisits: 0,
    people: 0,
    newPeople: 0,
    returningPeople: 0,
    unidentified: 0,
  };
  const branchVisits = new Map<string, number>(f.ids.map((id) => [id, 0]));
  for (const row of visits) {
    points.get(bucketStart(row.day, bucket))!.visits += row.n;
    totals.visits += row.n;
    if (row.origin === 'BOOKING') totals.bookedVisits += row.n;
    else totals.walkInVisits += row.n;
    branchVisits.set(row.branch_id, (branchVisits.get(row.branch_id) ?? 0) + row.n);
  }
  const everyone = new Map<string, boolean>(); // person -> is new in the period
  const branchPeople = new Map<string, Set<string>>(f.ids.map((id) => [id, new Set()]));
  for (const row of people) {
    if (row.pkey === null) {
      totals.unidentified += 1;
      continue;
    }
    const point = points.get(bucketStart(row.day, bucket))!;
    point.people.add(row.pkey);
    const isNew = row.first_seen !== null && row.first_seen >= f.range.from;
    if (
      isNew &&
      row.first_seen !== null &&
      bucketStart(row.first_seen, bucket) === bucketStart(row.day, bucket)
    ) {
      point.fresh.add(row.pkey);
    }
    everyone.set(row.pkey, isNew);
    branchPeople.get(row.branch_id)?.add(row.pkey);
  }
  totals.people = everyone.size;
  totals.newPeople = [...everyone.values()].filter(Boolean).length;
  totals.returningPeople = totals.people - totals.newPeople;
  const series: VisitPoint[] = starts.map((start) => {
    const point = points.get(start)!;
    return {
      start,
      visits: point.visits,
      people: point.people.size,
      newPeople: point.fresh.size,
      returningPeople: point.people.size - point.fresh.size,
    };
  });
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    bucket,
    series,
    totals,
    byBranch: f.refs.map((branch) => ({
      branch,
      visits: branchVisits.get(branch.id) ?? 0,
      people: branchPeople.get(branch.id)?.size ?? 0,
    })),
  };
}

// --------------------------------------------------------------------------------------------------- bookings (C2)

export async function bookingFunnel(
  context: ReportContext,
  query: PeopleQuery,
): Promise<BookingFunnelReport> {
  const f = frame(context, query, ['VIEW_BOOKINGS']);
  const bucket = parseBucket(query.bucket, f.range);
  const rows = await context.tx.$queryRaw<
    {
      day: string;
      channel: 'ONLINE' | 'DESK';
      status: string;
      late: boolean | null;
      n: number;
    }[]
  >(Prisma.sql`
    SELECT to_char(bk.service_date, 'YYYY-MM-DD') AS day, bk.channel::text AS channel, bk.status::text AS status,
           bk.cancelled_late AS late, count(*)::int AS n
    FROM bookings bk
    WHERE bk.branch_id = ANY(${f.ids}::uuid[])
      AND bk.service_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
    GROUP BY bk.service_date, bk.channel, bk.status, bk.cancelled_late`);
  const empty = (): Omit<BookingPoint, 'start'> => ({
    bookings: 0,
    checkedIn: 0,
    cancelled: 0,
    lateCancelled: 0,
    noShow: 0,
    open: 0,
  });
  const add = (target: Omit<BookingPoint, 'start'>, row: (typeof rows)[number]) => {
    target.bookings += row.n;
    if (row.status === 'CHECKED_IN') target.checkedIn += row.n;
    else if (row.status === 'CANCELLED') {
      target.cancelled += row.n;
      if (row.late === true) target.lateCancelled += row.n;
    } else if (row.status === 'NO_SHOW') target.noShow += row.n;
    else target.open += row.n;
  };
  const starts = bucketStarts(f.range, bucket);
  const points = new Map(starts.map((start) => [start, empty()]));
  const totals = empty();
  const channels = new Map<'ONLINE' | 'DESK', Omit<BookingPoint, 'start'>>([
    ['ONLINE', empty()],
    ['DESK', empty()],
  ]);
  for (const row of rows) {
    add(points.get(bucketStart(row.day, bucket))!, row);
    add(totals, row);
    add(channels.get(row.channel)!, row);
  }
  const kept = totals.bookings - totals.cancelled;
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    bucket,
    series: starts.map((start) => ({ start, ...points.get(start)! })),
    totals,
    cameBp: bp(totals.checkedIn, kept),
    noShowBp: bp(totals.noShow, kept),
    byChannel: (['ONLINE', 'DESK'] as const).map((channel) => {
      const c = channels.get(channel)!;
      return {
        channel,
        bookings: c.bookings,
        checkedIn: c.checkedIn,
        cancelled: c.cancelled,
        noShow: c.noShow,
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------- loyalty (C3)

const tierSql = (column: string) =>
  Prisma.raw(
    `CASE ${[...LOYALTY_TIERS_V1]
      .reverse()
      .map((entry) => `WHEN ${column} >= ${entry.fromPoints} THEN '${entry.tier}'`)
      .join(' ')} END`,
  );

export async function loyaltyReport(
  context: ReportContext,
  query: PeopleQuery,
): Promise<LoyaltyReport> {
  const f = frame(context, query, ['VIEW_LOYALTY']);
  // Points that belong to no branch (manual adjustments, referral awards) are shown only to a person who reads every branch.
  const includesBranchless = context.allBranches.every((branch) => f.ids.includes(branch.id));
  const zone = f.covered[0]?.timezone ?? 'Asia/Ho_Chi_Minh';
  const points = await context.tx.$queryRaw<
    { wallet: 'SPA' | 'BEAUTY'; kind: string; points: string; entries: string }[]
  >(Prisma.sql`
    SELECT e.wallet::text AS wallet, e.kind::text AS kind, COALESCE(sum(e.points), 0)::text AS points, count(*)::text AS entries
    FROM loyalty_ledger_entries e
    LEFT JOIN invoices i ON i.id = e.invoice_id
    WHERE (e.invoice_id IS NOT NULL AND i.branch_id = ANY(${f.ids}::uuid[])
           OR (e.invoice_id IS NULL AND ${includesBranchless}))
      AND (e.created_at AT TIME ZONE ${zone})::date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
    GROUP BY e.wallet, e.kind
    ORDER BY e.wallet, e.kind`);
  const tiers = await context.tx.$queryRaw<
    { tier: string; wallet: string; n: string }[]
  >(Prisma.sql`
    SELECT ${tierSql('w.balance_points')} AS tier, w.wallet::text AS wallet, count(*)::text AS n
    FROM loyalty_wallets w JOIN users u ON u.id = w.user_id AND u.kind = 'CUSTOMER'
    GROUP BY 1, 2`);
  const outstanding = await context.tx.$queryRaw<{ wallet: string; points: string }[]>(Prisma.sql`
    SELECT w.wallet::text AS wallet, COALESCE(sum(w.balance_points), 0)::text AS points
    FROM loyalty_wallets w JOIN users u ON u.id = w.user_id AND u.kind = 'CUSTOMER' GROUP BY w.wallet`);
  const [referrals] = await context.tx.$queryRaw<{ bound: string; rewarded: string }[]>(Prisma.sql`
    SELECT (count(*) FILTER (WHERE (r.bound_at AT TIME ZONE ${zone})::date BETWEEN ${f.range.from}::date AND ${f.range.to}::date))::text AS bound,
           (count(*) FILTER (WHERE (r.awarded_at AT TIME ZONE ${zone})::date BETWEEN ${f.range.from}::date AND ${f.range.to}::date))::text AS rewarded
    FROM referrals r WHERE ${includesBranchless}`);
  const [rewards] = await context.tx.$queryRaw<{ n: string }[]>(Prisma.sql`
    SELECT count(*)::text AS n
    FROM reward_redemptions r JOIN branches b ON b.id = r.branch_id
    WHERE r.branch_id = ANY(${f.ids}::uuid[]) AND ${within('r.redeemed_at', f.range)}
      AND NOT EXISTS (SELECT 1 FROM reward_redemption_releases x WHERE x.redemption_id = r.id)`);
  const [birthday] = await context.tx.$queryRaw<{ n: string; amount: string }[]>(Prisma.sql`
    SELECT count(*)::text AS n, COALESCE(sum(r.amount_vnd), 0)::text AS amount
    FROM birthday_redemptions r JOIN invoices i ON i.id = r.invoice_id JOIN branches b ON b.id = i.branch_id
    WHERE i.branch_id = ANY(${f.ids}::uuid[]) AND ${within('r.redeemed_at', f.range)}
      AND NOT EXISTS (SELECT 1 FROM birthday_redemption_releases x WHERE x.redemption_id = r.id)`);
  const tierOrder = LOYALTY_TIERS_V1.map((entry) => entry.tier as string);
  const tierRows = tierOrder.map((tier) => ({
    tier,
    spa: Number(tiers.find((row) => row.tier === tier && row.wallet === 'SPA')?.n ?? '0'),
    beauty: Number(tiers.find((row) => row.tier === tier && row.wallet === 'BEAUTY')?.n ?? '0'),
  }));
  const out = (wallet: string) =>
    Number(outstanding.find((row) => row.wallet === wallet)?.points ?? '0');
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    points: points.map((row): LoyaltyPointsRow => ({
      wallet: row.wallet,
      kind: row.kind,
      points: Number(row.points),
      entries: Number(row.entries),
    })),
    tiers: tierRows,
    outstanding: { spa: out('SPA'), beauty: out('BEAUTY') },
    referrals: {
      bound: Number(referrals?.bound ?? '0'),
      rewarded: Number(referrals?.rewarded ?? '0'),
    },
    rewardRedemptions: Number(rewards?.n ?? '0'),
    birthday: { redeemed: Number(birthday?.n ?? '0'), amountVnd: birthday?.amount ?? '0' },
    includesBranchless,
  };
}

// ----------------------------------------------------------------------------------------------- top customers (C4)

export const TOP_CUSTOMERS_LIMIT = 50;

export async function topCustomers(
  context: ReportContext,
  query: PeopleQuery,
): Promise<TopCustomersReport> {
  const f = frame(context, query, ['VIEW_REVENUE', 'VIEW_LOYALTY']);
  const rows = await context.tx.$queryRaw<
    {
      user_id: string;
      name: string;
      phone: string | null;
      invoices: string;
      collected: string;
      visits: string;
    }[]
  >(Prisma.sql`
    WITH paid AS (
      SELECT i.payer_user_id AS user_id, count(DISTINCT i.id) AS invoices, sum(p.amount_vnd) AS collected
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.branch_id = ANY(${f.ids}::uuid[]) AND p.status = 'SUCCEEDED'
        AND p.business_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
        AND i.payer_user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM payment_corrections c WHERE c.payment_id = p.id)
      GROUP BY i.payer_user_id
      ORDER BY sum(p.amount_vnd) DESC
      LIMIT ${TOP_CUSTOMERS_LIMIT}
    )
    SELECT paid.user_id::text AS user_id, u.full_name AS name, u.phone_canonical AS phone,
           paid.invoices::text AS invoices, paid.collected::text AS collected,
           (SELECT count(DISTINCT v.id) FROM visit_participants vp
              JOIN visits v ON v.id = vp.visit_id
             WHERE vp.customer_user_id = paid.user_id AND v.status = 'COMPLETED' AND v.branch_id = ANY(${f.ids}::uuid[])
               AND v.service_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date)::text AS visits
    FROM paid JOIN users u ON u.id = paid.user_id
    ORDER BY paid.collected DESC, u.full_name`);
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    limit: TOP_CUSTOMERS_LIMIT,
    rows: rows.map((row): TopCustomerRow => ({
      userId: row.user_id,
      name: row.name,
      phone: row.phone,
      invoices: Number(row.invoices),
      collectedVnd: row.collected,
      visits: Number(row.visits),
    })),
  };
}

// ------------------------------------------------------------------------------------------------------- staff (S1)

export async function staffActivity(
  context: ReportContext,
  query: PeopleQuery,
): Promise<StaffActivityReport> {
  const f = frame(context, query, ['VIEW_STAFF_REPORTS']);
  // A column is shown only when the person holds its permission at EVERY covered branch.
  const holdsAll = (permission: Parameters<ReportContext['can']>[0]) =>
    f.covered.every((branch) => context.can(permission, branch.id));
  const sales = holdsAll('VIEW_REVENUE');
  const pay = holdsAll('VIEW_EMPLOYEE_PAY');
  const scope = { branchIds: f.ids, from: f.range.from, to: f.range.to };

  const rows = await context.tx.$queryRaw<
    {
      user_id: string;
      name: string;
      code: string | null;
      services: string;
      customers: string;
      actual: string;
      planned: string;
      service_sales: string;
      product_sales: string;
      ref_orders: string;
      ref_total: string;
      tips: string;
      tour: string;
      commission: string;
      att_days: string;
      att_minutes: string;
      leave_days: string;
    }[]
  >(Prisma.sql`
    WITH ${factCtes(scope)},
    execs AS (
      SELECT e.employee_user_id AS user_id, count(*) AS services, count(DISTINCT vsl.participant_id) AS customers,
             COALESCE(sum(extract(epoch FROM (e.ended_at - e.started_at)) / 60), 0)::bigint AS actual,
             COALESCE(sum(vsl.duration_minutes), 0)::bigint AS planned
      FROM service_executions e
      JOIN visit_service_lines vsl ON vsl.id = e.visit_service_line_id
      JOIN visits v ON v.id = vsl.visit_id
      JOIN branches b ON b.id = v.branch_id
      WHERE e.status = 'ENDED' AND v.branch_id = ANY(${f.ids}::uuid[]) AND ${within('e.ended_at', f.range)}
      GROUP BY e.employee_user_id
    ),
    svc_sales AS (
      SELECT ils.employee_user_id AS user_id, sum(x.amount_vnd) AS amount
      FROM facts x JOIN invoice_line_services ils ON ils.invoice_line_id = x.line_id
      WHERE x.kind = 'SERVICE' GROUP BY ils.employee_user_id
    ),
    prod_sales AS (
      SELECT ilp.seller_user_id AS user_id, sum(x.amount_vnd) AS amount
      FROM facts x JOIN invoice_line_products ilp ON ilp.invoice_line_id = x.line_id
      WHERE x.kind = 'PRODUCT' AND ilp.seller_user_id IS NOT NULL GROUP BY ilp.seller_user_id
    ),
    refs AS (
      SELECT r.employee_user_id AS user_id, count(*) AS orders, COALESCE(sum(i.total_vnd), 0) AS total
      FROM order_referrals r
      JOIN invoices i ON i.id = r.invoice_id
      WHERE i.branch_id = ANY(${f.ids}::uuid[]) AND i.business_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
      GROUP BY r.employee_user_id
    ),
    tip AS (
      SELECT t.employee_user_id AS user_id,
             sum(t.amount_vnd) AS amount
      FROM tips t
      WHERE t.branch_id = ANY(${f.ids}::uuid[]) AND t.business_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
      GROUP BY t.employee_user_id
    ),
    earn AS (
      SELECT a.employee_user_id AS user_id,
             COALESCE(sum(a.amount_vnd) FILTER (WHERE a.kind = 'TOUR'), 0) AS tour,
             COALESCE(sum(a.amount_vnd) FILTER (WHERE a.kind = 'PRODUCT_COMMISSION'), 0) AS commission
      FROM pay_earnings a
      WHERE a.branch_id = ANY(${f.ids}::uuid[]) AND a.business_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
      GROUP BY a.employee_user_id
    ),
    att AS (
      SELECT r.employee_user_id AS user_id, count(*) AS days,
             COALESCE(sum(extract(epoch FROM (r.check_out_at - r.check_in_at)) / 60) FILTER (WHERE r.check_out_at IS NOT NULL), 0)::bigint AS minutes
      FROM attendance_records r
      WHERE r.branch_id = ANY(${f.ids}::uuid[]) AND r.business_date BETWEEN ${f.range.from}::date AND ${f.range.to}::date
      GROUP BY r.employee_user_id
    ),
    team AS (
      SELECT DISTINCT a.employee_user_id AS user_id FROM employee_branch_assignments a
      WHERE a.revoked_at IS NULL AND a.branch_id = ANY(${f.ids}::uuid[])
      UNION SELECT user_id FROM execs UNION SELECT user_id FROM svc_sales UNION SELECT user_id FROM prod_sales
      UNION SELECT user_id FROM refs UNION SELECT user_id FROM tip UNION SELECT user_id FROM earn UNION SELECT user_id FROM att
    ),
    leave AS (
      SELECT l.employee_user_id AS user_id,
             sum(LEAST(l.end_date, ${f.range.to}::date) - GREATEST(l.start_date, ${f.range.from}::date) + 1) AS days
      FROM leave_requests l
      WHERE l.status = 'APPROVED' AND l.start_date <= ${f.range.to}::date AND l.end_date >= ${f.range.from}::date
        AND l.employee_user_id IN (SELECT user_id FROM team)
      GROUP BY l.employee_user_id
    )
    SELECT u.id::text AS user_id, u.full_name AS name, ep.employee_code_canonical AS code,
           COALESCE(execs.services, 0)::text AS services, COALESCE(execs.customers, 0)::text AS customers,
           COALESCE(execs.actual, 0)::text AS actual, COALESCE(execs.planned, 0)::text AS planned,
           COALESCE(svc_sales.amount, 0)::text AS service_sales, COALESCE(prod_sales.amount, 0)::text AS product_sales,
           COALESCE(refs.orders, 0)::text AS ref_orders, COALESCE(refs.total, 0)::text AS ref_total,
           COALESCE(tip.amount, 0)::text AS tips, COALESCE(earn.tour, 0)::text AS tour, COALESCE(earn.commission, 0)::text AS commission,
           COALESCE(att.days, 0)::text AS att_days, COALESCE(att.minutes, 0)::text AS att_minutes,
           COALESCE(leave.days, 0)::text AS leave_days
    FROM team
    JOIN users u ON u.id = team.user_id
    LEFT JOIN employee_profiles ep ON ep.user_id = u.id
    LEFT JOIN execs ON execs.user_id = u.id
    LEFT JOIN svc_sales ON svc_sales.user_id = u.id
    LEFT JOIN prod_sales ON prod_sales.user_id = u.id
    LEFT JOIN refs ON refs.user_id = u.id
    LEFT JOIN tip ON tip.user_id = u.id
    LEFT JOIN earn ON earn.user_id = u.id
    LEFT JOIN att ON att.user_id = u.id
    LEFT JOIN leave ON leave.user_id = u.id
    ORDER BY u.full_name, u.id`);
  return {
    generatedAt: context.now.toISOString(),
    period: f.period,
    branches: f.refs,
    columns: { sales, pay },
    rows: rows.map((row): StaffRow => ({
      userId: row.user_id,
      name: row.name,
      employeeCode: row.code,
      servicesPerformed: Number(row.services),
      customersServed: Number(row.customers),
      actualMinutes: Number(row.actual),
      plannedMinutes: Number(row.planned),
      serviceSalesVnd: sales ? row.service_sales : null,
      productSalesVnd: sales ? row.product_sales : null,
      referralOrders: Number(row.ref_orders),
      referralInvoiceVnd: sales ? row.ref_total : null,
      tipsVnd: pay ? row.tips : null,
      tourVnd: pay ? row.tour : null,
      commissionVnd: pay ? row.commission : null,
      attendanceDays: Number(row.att_days),
      attendanceMinutes: Number(row.att_minutes),
      leaveDays: Number(row.leave_days),
    })),
  };
}
