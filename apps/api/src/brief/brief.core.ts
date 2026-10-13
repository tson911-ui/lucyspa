import { createHash } from 'node:crypto';
import { BRIEF_LIMITS, type CustomerBriefFacts } from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { cleanNote, type SuggestionCandidate } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Claude integration Wave D (CI-S2 and CI-S3, design 7.2 and 7.3): what the staff member serving a visit may see. The relationship is the
 * rule, not a role: the person must be the one assigned to that visit line, hold `VIEW_CUSTOMER_BRIEF` at the branch, and the visit must
 * be open and no more than two hours before the planned start. Everything here is computed by code from earlier visits at the same
 * branch; the AI only condenses the notes and picks from the short list this file builds.
 */
export interface LineAccess {
  lineId: string;
  visitId: string;
  participantId: string;
  branchId: string;
  customerUserId: string | null;
  serviceDate: Date;
}

interface LineRow {
  id: string;
  visit_id: string;
  participant_id: string;
  employee_user_id: string | null;
  status: string;
  planned_start_at: Date | null;
  branch_id: string;
  visit_status: string;
  service_date: Date;
  arrived_at: Date;
  customer_user_id: string | null;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The line the person may open the brief for, or an error: NOT_FOUND for a line that is not theirs, FORBIDDEN for the rest. */
export async function requireLine(context: AdminContext, lineId: string): Promise<LineAccess> {
  if (!ID.test(lineId)) throw new AuthError('NOT_FOUND');
  const rows = await context.tx.$queryRaw<LineRow[]>(Prisma.sql`
    SELECT l.id, l.visit_id, l.participant_id, l.employee_user_id, l.status::text AS status, l.planned_start_at,
           v.branch_id, v.status::text AS visit_status, v.service_date, v.arrived_at, p.customer_user_id
      FROM visit_service_lines l
      JOIN visits v ON v.id = l.visit_id
      JOIN visit_participants p ON p.id = l.participant_id AND p.visit_id = l.visit_id
     WHERE l.id = ${lineId}::uuid`);
  const line = rows[0];
  if (line === undefined || line.employee_user_id !== context.actor.userId) {
    throw new AuthError('NOT_FOUND');
  }
  if (
    !decide(context.actor.graph, 'VIEW_CUSTOMER_BRIEF', {
      kind: 'BRANCH',
      branchId: line.branch_id,
    })
  ) {
    throw new AuthError('FORBIDDEN');
  }
  const opensAt =
    (line.planned_start_at ?? line.arrived_at).getTime() -
    BRIEF_LIMITS.windowBeforeMinutes * 60_000;
  if (
    !['OPEN', 'IN_SERVICE'].includes(line.visit_status) ||
    line.status === 'CANCELLED' ||
    context.now.getTime() < opensAt
  ) {
    throw new AuthError('FORBIDDEN');
  }
  return {
    lineId: line.id,
    visitId: line.visit_id,
    participantId: line.participant_id,
    branchId: line.branch_id,
    customerUserId: line.customer_user_id,
    serviceDate: line.service_date,
  };
}

const day = (value: Date): string => value.toISOString().slice(0, 10);

/** The facts of the brief, computed from this customer's completed visits at this branch before the current one. No AI. */
export async function briefFacts(
  context: AdminContext,
  access: LineAccess,
): Promise<{ facts: CustomerBriefFacts; notes: string[] }> {
  const empty: CustomerBriefFacts = {
    known: false,
    visits: 0,
    lastVisitDate: null,
    lastKtvName: null,
    averageGapDays: null,
    usualServices: [],
    productsBefore: [],
    notes: 0,
  };
  const customer = access.customerUserId;
  if (customer === null) return { facts: empty, notes: [] };
  const { tx } = context;
  const visits = await tx.$queryRaw<{ id: string; service_date: Date }[]>(Prisma.sql`
    SELECT DISTINCT v.id, v.service_date
      FROM visits v JOIN visit_participants p ON p.visit_id = v.id AND p.customer_user_id = ${customer}::uuid
     WHERE v.branch_id = ${access.branchId}::uuid AND v.status = 'COMPLETED' AND v.id <> ${access.visitId}::uuid
     ORDER BY v.service_date, v.id`);
  const dates = visits.map((row) => row.service_date.getTime());
  const gaps = dates.slice(1).map((time, at) => (time - (dates[at] ?? time)) / 86_400_000);
  const last = visits.at(-1);
  const services = await tx.$queryRaw<{ name: string; n: number }[]>(Prisma.sql`
    SELECT l.service_name_vi AS name, count(*)::int AS n
      FROM visit_service_lines l
      JOIN visit_participants p ON p.id = l.participant_id AND p.visit_id = l.visit_id
      JOIN visits v ON v.id = l.visit_id
     WHERE p.customer_user_id = ${customer}::uuid AND v.branch_id = ${access.branchId}::uuid AND v.status = 'COMPLETED'
       AND l.status = 'DONE' AND v.id <> ${access.visitId}::uuid
       AND v.service_date >= ${new Date(context.now.getTime() - 365 * 86_400_000)}::date
     GROUP BY l.service_name_vi ORDER BY n DESC, l.service_name_vi LIMIT 3`);
  const ktv =
    last === undefined
      ? []
      : await tx.$queryRaw<{ name: string }[]>(Prisma.sql`
          SELECT u.full_name AS name
            FROM visit_service_lines l
            JOIN visit_participants p ON p.id = l.participant_id AND p.visit_id = l.visit_id
            JOIN users u ON u.id = l.employee_user_id
           WHERE l.visit_id = ${last.id}::uuid AND p.customer_user_id = ${customer}::uuid AND l.status = 'DONE'
           ORDER BY l.sequence LIMIT 1`);
  const products = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`
    SELECT ilp.product_name_vi AS name
      FROM invoice_line_products ilp
      JOIN invoice_lines il ON il.id = ilp.invoice_line_id
      JOIN invoices i ON i.id = il.invoice_id
      JOIN visits v ON v.id = i.visit_id
      JOIN visit_participants p ON p.visit_id = v.id AND p.customer_user_id = ${customer}::uuid
     WHERE i.status = 'PAID' AND v.branch_id = ${access.branchId}::uuid
     GROUP BY ilp.product_name_vi ORDER BY count(*) DESC, ilp.product_name_vi LIMIT 5`);
  const noteRows = await tx.$queryRaw<{ note: string }[]>(Prisma.sql`
    SELECT note FROM (
      SELECT p.note AS note, p.created_at AS at
        FROM visit_participants p JOIN visits v ON v.id = p.visit_id
       WHERE p.customer_user_id = ${customer}::uuid AND v.branch_id = ${access.branchId}::uuid
         AND p.note IS NOT NULL AND btrim(p.note) <> ''
      UNION ALL
      SELECT c.note AS note, c.occurred_at AS at
        FROM service_line_assignment_changes c
        JOIN visit_service_lines l ON l.id = c.visit_service_line_id
        JOIN visit_participants p ON p.id = l.participant_id AND p.visit_id = l.visit_id
        JOIN visits v ON v.id = l.visit_id
       WHERE p.customer_user_id = ${customer}::uuid AND v.branch_id = ${access.branchId}::uuid
         AND c.note IS NOT NULL AND btrim(c.note) <> ''
    ) n ORDER BY at DESC LIMIT ${BRIEF_LIMITS.notesMax}`);
  const notes = noteRows
    .map((row) => cleanNote(row.note, BRIEF_LIMITS.noteChars))
    .filter((note) => note !== '');
  return {
    facts: {
      known: true,
      visits: visits.length,
      lastVisitDate: last ? day(last.service_date) : null,
      lastKtvName: ktv[0]?.name ?? null,
      averageGapDays:
        gaps.length === 0
          ? null
          : Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length),
      usualServices: services.map((row) => ({ name: row.name, times: row.n })),
      productsBefore: products.map((row) => row.name),
      notes: notes.length,
    },
    notes,
  };
}

/** The services of this participant done or being done in this visit (what the talking points are about). */
export async function servicesToday(context: AdminContext, access: LineAccess): Promise<string[]> {
  const rows = await context.tx.$queryRaw<{ name: string }[]>(Prisma.sql`
    SELECT service_name_vi AS name FROM visit_service_lines
     WHERE visit_id = ${access.visitId}::uuid AND participant_id = ${access.participantId}::uuid
       AND status IN ('IN_PROGRESS', 'DONE') ORDER BY sequence`);
  return rows.map((row) => row.name);
}

/**
 * The few products the model may pick from, chosen by code: published, in stock at this branch, with an approved description, not bought by
 * this customer in the last 60 days, best sellers at the branch first. (No service-to-category mapping exists in the catalogue, so the
 * model decides which of the eight fit what was done today; it can only name these ids.)
 */
export async function suggestionCandidates(
  context: AdminContext,
  access: LineAccess,
): Promise<SuggestionCandidate[]> {
  const customer = access.customerUserId;
  const since = new Date(context.now.getTime() - BRIEF_LIMITS.boughtWithinDays * 86_400_000);
  const rows = await context.tx.$queryRaw<
    {
      id: string;
      name: string;
      brand: string | null;
      benefits: string | null;
      suits: string | null;
    }[]
  >(Prisma.sql`
    SELECT p.id, p.name_vi AS name, b.name_vi AS brand,
           p.description_sections_vi ->> 'benefits' AS benefits, p.description_sections_vi ->> 'suitableFor' AS suits
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.status = 'PUBLISHED' AND p.description_sections_vi ->> 'benefits' IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM product_variants pv JOIN stock_levels sl ON sl.variant_id = pv.id AND sl.branch_id = ${access.branchId}::uuid
          WHERE pv.product_id = p.id AND pv.is_active AND sl.on_hand - sl.reserved > 0)
       AND (${customer}::uuid IS NULL OR NOT EXISTS (
         SELECT 1 FROM invoice_line_products ilp
           JOIN invoice_lines il ON il.id = ilp.invoice_line_id
           JOIN invoices i ON i.id = il.invoice_id
           JOIN visits v ON v.id = i.visit_id
           JOIN visit_participants vp ON vp.visit_id = v.id AND vp.customer_user_id = ${customer}::uuid
          WHERE ilp.product_id = p.id AND i.status = 'PAID' AND i.paid_at >= ${since}))
     ORDER BY (
         SELECT coalesce(sum(il2.quantity), 0) FROM invoice_line_products ilp2
           JOIN invoice_lines il2 ON il2.id = ilp2.invoice_line_id
           JOIN invoices i2 ON i2.id = il2.invoice_id
          WHERE ilp2.product_id = p.id AND i2.status = 'PAID' AND i2.branch_id = ${access.branchId}::uuid
            AND i2.paid_at >= ${new Date(context.now.getTime() - 30 * 86_400_000)}) DESC, p.name_vi
     LIMIT ${BRIEF_LIMITS.candidates}`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    benefits: row.benefits,
    suitableFor: row.suits,
  }));
}

export const hashOf = (...parts: readonly string[]): string =>
  createHash('sha256').update(parts.join('\u0001')).digest('hex');

/** When a cached brief stops being kept: the day after the service plus the retention days (design OQ-CI-10: 7 days after the service). */
export const expiryOf = (serviceDate: Date): Date =>
  new Date(serviceDate.getTime() + (BRIEF_LIMITS.keepDaysAfterService + 1) * 86_400_000);

/** The audit event of a view: who looked, at which visit line, which part; never the content. */
export function auditView(
  context: AdminContext,
  access: LineAccess,
  part: 'BRIEF' | 'SUGGESTIONS',
): Promise<void> {
  return appendAdminAudit(context, {
    action: 'CUSTOMER_BRIEF_VIEWED',
    entityType: 'VisitServiceLine',
    entityId: access.lineId,
    after: { part, visitId: access.visitId, branchId: access.branchId },
  });
}
