import type { Prisma } from '@lucy-spa/database';
import { decide, type AuthorityGraph, type OrganizationLevel } from './authorization.js';
import { loadAuthorityGraph } from './authorization.store.js';
import { ORGANIZATION_RANK, supervisionRank } from './organization.js';
import { assertAuthTransaction } from './auth-lock.js';

export interface SupervisorRoutingInput {
  /** The employee the notification is about (for example the leave requester). */
  readonly subjectUserId: string;
  /** The permission a recipient must effectively hold to handle the subject. */
  readonly permission: string;
  /**
   * Branches that define the subject's location. Defaults to the subject's active branches.
   * Callers that must mirror an existing action pass the same set that action authorizes
   * against (for example the branches leave approval checks).
   */
  readonly branchIds?: readonly string[];
  /** Never routed to (in addition to the subject), for example the requesting actor. */
  readonly exclude?: readonly string[];
}

export interface SupervisorRouting {
  /** Sorted account ids. Empty only when nobody, including the Owner, can be reached. */
  readonly recipients: readonly string[];
  /** Where the recipients came from. */
  readonly source: 'SUPERVISOR' | 'OWNER_FALLBACK' | 'NONE';
  /** The appointment level shared by the recipients (null for the Owner fallback / none). */
  readonly level: OrganizationLevel | null;
}

const LEVEL_BY_RANK = new Map<number, OrganizationLevel>(
  (Object.entries(ORGANIZATION_RANK) as [OrganizationLevel, number][]).map(([level, rank]) => [
    rank,
    level,
  ]),
);

/** Same rule as `decideAcross`: every branch, or GLOBAL when the subject has no branch. */
function holdsAcross(graph: AuthorityGraph, permission: string, branches: readonly string[]) {
  if (branches.length === 0) return decide(graph, permission, { kind: 'GLOBAL' });
  return branches.every((branchId) => decide(graph, permission, { kind: 'BRANCH', branchId }));
}

/** Latest branch-local calendar date among the branches (UTC when there are none). */
async function businessDate(tx: Prisma.TransactionClient, branches: readonly string[]) {
  const [row] = await tx.$queryRaw<{ today: string }[]>`
    SELECT COALESCE(MAX(to_char(now() AT TIME ZONE b.timezone, 'YYYY-MM-DD')),
                    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')) AS today
    FROM (SELECT timezone FROM branches WHERE id = ANY(${[...branches]}::uuid[])) b`;
  return new Date(`${row!.today}T00:00:00.000Z`);
}

/**
 * Who should be told about a matter concerning an employee, using only the existing authority
 * primitives: effective permission + scope + hierarchy + containment. No role names, no ids.
 *
 * Traversal: every eligible person is ranked by the appointment level at which they supervise
 * the subject (`supervisionRank`). The LOWEST level that has at least one eligible person is
 * selected and ALL eligible people at that level receive it; higher levels are never added. A
 * level without an eligible person is skipped, which is the upward escalation. The Owner is
 * used only when no employee is eligible at any level. No timers.
 *
 * Eligible means: an ACTIVE account, employment not ended on the branch-local date, an active
 * organization appointment that supervises the subject at every branch of the subject (Team
 * Leaders only for members of their own team), and the permission effectively held (DENY
 * respected) at every one of those branches, exactly as the corresponding action requires.
 *
 * The caller holds the shared authorization-graph lock, as Phase 3 recipient selection does.
 */
export async function resolveSupervisorRecipients(
  tx: Prisma.TransactionClient,
  input: SupervisorRoutingInput,
): Promise<SupervisorRouting> {
  assertAuthTransaction(tx);
  const none: SupervisorRouting = { recipients: [], source: 'NONE', level: null };
  const subject = await loadAuthorityGraph(tx, input.subjectUserId);
  if (!subject || subject.kind !== 'EMPLOYEE') return none;
  const branches = [...new Set(input.branchIds ?? subject.activeBranchIds)].sort();
  const excluded = new Set([input.subjectUserId, ...(input.exclude ?? [])]);

  // Narrow the pool in SQL to people whose appointment scope can contain the subject; the
  // authoritative checks below still decide.
  const organization = subject.organization;
  const branchRows = (organization?.branches ?? []).filter((branch) =>
    branches.includes(branch.id),
  );
  const regionIds = [...new Set(branchRows.flatMap((b) => (b.regionId ? [b.regionId] : [])))];
  const areaIds = [...new Set(branchRows.flatMap((b) => (b.areaId ? [b.areaId] : [])))];
  const candidates = await tx.user.findMany({
    where: {
      kind: 'EMPLOYEE',
      status: 'ACTIVE',
      id: { notIn: [...excluded] },
      employeeProfile: {
        organizationAssignments: {
          some: {
            endedAt: null,
            OR: [
              { scopeKind: 'GLOBAL' },
              ...(regionIds.length
                ? [{ scopeKind: 'REGION' as const, regionId: { in: regionIds } }]
                : []),
              ...(areaIds.length ? [{ scopeKind: 'AREA' as const, areaId: { in: areaIds } }] : []),
              ...(branches.length
                ? [{ scopeKind: 'BRANCH' as const, branchId: { in: branches } }]
                : []),
            ],
          },
        },
      },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  const today = await businessDate(tx, branches);
  const ranked = new Map<number, string[]>();
  for (const candidate of candidates) {
    const graph = await loadAuthorityGraph(tx, candidate.id);
    if (!graph) continue;
    const rank = supervisionRank(graph, subject, branches);
    if (rank === null || !holdsAcross(graph, input.permission, branches)) continue;
    const employment = await tx.employmentClassificationChange.findFirst({
      where: { employeeUserId: candidate.id, effectiveDate: { lte: today } },
      orderBy: { effectiveDate: 'desc' },
      select: { classification: true },
    });
    if (!employment || employment.classification === 'ENDED') continue;
    ranked.set(rank, [...(ranked.get(rank) ?? []), candidate.id]);
  }
  if (ranked.size > 0) {
    const lowest = Math.min(...ranked.keys());
    return {
      recipients: ranked.get(lowest)!.sort(),
      source: 'SUPERVISOR',
      level: LEVEL_BY_RANK.get(lowest) ?? null,
    };
  }

  // Final fallback: the Owner (never a routine recipient while any employee is eligible).
  const owners = await tx.user.findMany({
    where: { kind: 'OWNER', status: 'ACTIVE', id: { notIn: [...excluded] } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 2,
  });
  if (owners.length === 1)
    return { recipients: [owners[0]!.id], source: 'OWNER_FALLBACK', level: null };
  return none;
}
