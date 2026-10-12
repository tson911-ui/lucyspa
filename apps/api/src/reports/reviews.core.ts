import {
  REVIEW_MIN_RATINGS,
  type RatingSummary,
  type ReviewBranchRow,
  type ReviewStaffRow,
  type ReviewsReport,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { parseRange } from './report.dates.js';
import type { ReportBranch, ReportContext } from './report.frame.js';

/**
 * Phase 8 P8-17 (docs/PHASE8_REPORTS.md 4.9): what customers rated, as numbers only: average and distribution per branch and per person, with the
 * number of ratings; fewer than 5 ratings is "chưa đủ đánh giá" (the average is withheld by the screen). Comments are not part of this report.
 * Needs VIEW_REVIEWS at the branch. Private: the people rated cannot see it unless the Owner decides so. Read-only.
 */
export interface ReviewsQuery {
  from?: unknown;
  to?: unknown;
  branchId?: unknown;
  restrictTo?: readonly ReportBranch[];
}

type Counts = [number, number, number, number, number];

function summary(counts: Counts): RatingSummary {
  const count = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((total, n, index) => total + n * (index + 1), 0);
  return {
    count,
    averageHundredths: count === 0 ? null : Math.round((sum * 100) / count),
    distribution: counts,
    enough: count >= REVIEW_MIN_RATINGS,
  };
}

const counts = (row: { r1: string; r2: string; r3: string; r4: string; r5: string }): Counts => [
  Number(row.r1),
  Number(row.r2),
  Number(row.r3),
  Number(row.r4),
  Number(row.r5),
];

const within = (range: { from: string; to: string }) => Prisma.sql`
  r.created_at >= ((${range.from}::date)::timestamp AT TIME ZONE b.timezone)
  AND r.created_at < ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)`;

const buckets = (column: string) =>
  Prisma.raw(
    [1, 2, 3, 4, 5]
      .map((n) => `count(*) FILTER (WHERE ${column} = ${n})::text AS r${n}`)
      .join(', '),
  );

export async function reviewsReport(
  context: ReportContext,
  query: ReviewsQuery,
): Promise<ReviewsReport> {
  const covered = query.restrictTo ?? context.scope(['VIEW_REVIEWS'], query.branchId);
  const range = parseRange(query);
  const ids = covered.map((branch) => branch.id);
  const tx = context.tx;

  const perBranch = await tx.$queryRaw<
    { branch_id: string; r1: string; r2: string; r3: string; r4: string; r5: string }[]
  >(Prisma.sql`
    SELECT r.branch_id::text AS branch_id, ${buckets('r.rating')}
    FROM customer_reviews r JOIN branches b ON b.id = r.branch_id
    WHERE r.branch_id = ANY(${ids}::uuid[]) AND ${within(range)}
    GROUP BY r.branch_id`);
  const byId = new Map(perBranch.map((row) => [row.branch_id, counts(row)]));
  const branchRows: ReviewBranchRow[] = covered.map((branch) => ({
    branch: { id: branch.id, code: branch.code, name: branch.name },
    ...summary(byId.get(branch.id) ?? [0, 0, 0, 0, 0]),
  }));
  const total = branchRows.reduce<Counts>(
    (acc, row) => acc.map((n, i) => n + row.distribution[i]!) as Counts,
    [0, 0, 0, 0, 0],
  );

  const staffRows = await tx.$queryRaw<
    {
      user_id: string;
      name: string;
      code: string | null;
      r1: string;
      r2: string;
      r3: string;
      r4: string;
      r5: string;
    }[]
  >(Prisma.sql`
    SELECT s.employee_user_id::text AS user_id, u.full_name AS name, ep.employee_code_canonical AS code, ${buckets('s.rating')}
    FROM customer_review_staff_ratings s
    JOIN customer_reviews r ON r.id = s.review_id
    JOIN branches b ON b.id = r.branch_id
    JOIN users u ON u.id = s.employee_user_id
    LEFT JOIN employee_profiles ep ON ep.user_id = u.id
    WHERE r.branch_id = ANY(${ids}::uuid[]) AND ${within(range)}
    GROUP BY s.employee_user_id, u.full_name, ep.employee_code_canonical
    ORDER BY u.full_name, s.employee_user_id`);
  const staff: ReviewStaffRow[] = staffRows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    employeeCode: row.code,
    ...summary(counts(row)),
  }));

  const [paid] = await tx.$queryRaw<{ n: string }[]>(Prisma.sql`
    SELECT count(*)::text AS n
    FROM invoices i JOIN branches b ON b.id = i.branch_id
    WHERE i.branch_id = ANY(${ids}::uuid[]) AND i.status = 'PAID' AND i.payer_user_id IS NOT NULL
      AND i.paid_at >= ((${range.from}::date)::timestamp AT TIME ZONE b.timezone)
      AND i.paid_at < ((${range.to}::date + 1)::timestamp AT TIME ZONE b.timezone)`);
  const totals = summary(total);
  const paidInvoices = Number(paid?.n ?? '0');
  return {
    generatedAt: context.now.toISOString(),
    period: { from: range.from, to: range.to, previous: null },
    branches: covered.map(({ id, code, name }) => ({ id, code, name })),
    totals,
    byBranch: branchRows,
    staff,
    paidInvoices,
    // Reviews of invoices paid before the period can fall inside it: the share never shows above 100%.
    responseBp:
      paidInvoices === 0 ? 0 : Math.min(10_000, Math.round((totals.count * 10_000) / paidInvoices)),
  };
}
