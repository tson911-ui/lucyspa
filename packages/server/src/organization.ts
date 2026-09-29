import type { Prisma } from '@lucy-spa/database';
import {
  scopeContains,
  type AuthorityGraph,
  type OrganizationAppointment,
  type OrganizationLevel,
  type Scope,
} from './authorization.js';
import { assertAuthTransaction } from './auth-lock.js';

export const ORGANIZATION_RANK: Readonly<Record<OrganizationLevel, number>> = Object.freeze({
  CEO: 6,
  REGIONAL_MANAGER: 5,
  AREA_MANAGER: 4,
  STORE_MANAGER: 3,
  DEPUTY_STORE_MANAGER: 2,
  TEAM_LEADER: 1,
});

function appointmentsAt(graph: AuthorityGraph, target: Scope): readonly OrganizationAppointment[] {
  return (graph.appointments ?? []).filter((appointment) =>
    scopeContains(graph, appointment.scope, target),
  );
}

/** Position is an additional restriction, never a permission grant. Owner is outside this hierarchy. */
export function canSupervise(
  actor: AuthorityGraph,
  target: AuthorityGraph,
  branchIds?: readonly string[],
): boolean {
  if (target.kind !== 'EMPLOYEE') return false;
  if (actor.kind === 'OWNER') return true;
  if (actor.kind !== 'EMPLOYEE' || actor.userId === target.userId) return false;
  const branches = branchIds ?? [...target.activeBranchIds];
  const locations: Scope[] = branches.length
    ? [...new Set(branches)].map((branchId) => ({ kind: 'BRANCH', branchId }))
    : [{ kind: 'GLOBAL' }];
  return locations.every((location) => {
    const targetRank = Math.max(
      0,
      ...(target.appointments ?? [])
        .filter(
          (appointment) =>
            location.kind === 'GLOBAL' || scopeContains(actor, appointment.scope, location),
        )
        .map((appointment) => ORGANIZATION_RANK[appointment.level]),
    );
    return appointmentsAt(actor, location).some((appointment) => {
      if (ORGANIZATION_RANK[appointment.level] <= targetRank) return false;
      if (appointment.level !== 'TEAM_LEADER') return true;
      return (
        appointment.teamId !== null &&
        target.teamMemberships?.some(
          (membership) =>
            membership.teamId === appointment.teamId &&
            location.kind === 'BRANCH' &&
            membership.branchId === location.branchId,
        ) === true
      );
    });
  });
}

/** Team creation uses null teamId and requires Deputy level or above. */
export function canManageTeam(
  graph: AuthorityGraph,
  teamId: string | null,
  branchId: string,
): boolean {
  if (graph.kind === 'OWNER') return true;
  if (graph.kind !== 'EMPLOYEE') return false;
  return appointmentsAt(graph, { kind: 'BRANCH', branchId }).some(
    (appointment) =>
      appointment.level !== 'TEAM_LEADER' || (teamId !== null && appointment.teamId === teamId),
  );
}

/** Permission, recipient activity/employment, and whole-target containment are checked by callers. */
export function canAppoint(
  graph: AuthorityGraph,
  level: OrganizationLevel,
  scope: Scope,
  teamId: string | null = null,
): boolean {
  const validScope =
    level === 'CEO'
      ? scope.kind === 'GLOBAL'
      : level === 'REGIONAL_MANAGER'
        ? scope.kind === 'REGION'
        : level === 'AREA_MANAGER'
          ? scope.kind === 'AREA'
          : scope.kind === 'BRANCH';
  if (!validScope || (level === 'TEAM_LEADER' ? teamId === null : teamId !== null)) return false;
  if (graph.kind === 'OWNER') return true;
  if (graph.kind !== 'EMPLOYEE') return false;
  return appointmentsAt(graph, scope).some(
    (appointment) => ORGANIZATION_RANK[appointment.level] > ORGANIZATION_RANK[level],
  );
}

/**
 * Authority to administer a structure of `level` INSIDE `container` (create an Area in a
 * Region, place a Branch in an Area, create a Team in a Branch): the Owner always; an employee
 * only through an appointment that contains the container and outranks `level`. Unlike
 * `canAppoint`, the container's scope kind is not the appointed level's scope kind (an Area
 * lives in a REGION container, a Branch in an AREA or the SYSTEM), so the two must not be mixed.
 * Permission (for example MANAGE_ORGANIZATION) is checked separately by the caller.
 */
export function canAdministerBelow(
  graph: AuthorityGraph,
  level: OrganizationLevel,
  container: Scope,
): boolean {
  if (graph.kind === 'OWNER') return true;
  if (graph.kind !== 'EMPLOYEE') return false;
  return appointmentsAt(graph, container).some(
    (appointment) => ORGANIZATION_RANK[appointment.level] > ORGANIZATION_RANK[level],
  );
}

export function attendanceExempt(graph: AuthorityGraph): boolean {
  return (
    graph.kind === 'OWNER' ||
    (graph.kind === 'EMPLOYEE' &&
      (graph.appointments ?? []).some(
        (appointment) => ORGANIZATION_RANK[appointment.level] >= ORGANIZATION_RANK.STORE_MANAGER,
      ))
  );
}

function scopeWhere(
  graph: AuthorityGraph,
  branchId: string,
): Prisma.OrganizationAssignmentWhereInput[] {
  const branch = graph.organization?.branches.find((row) => row.id === branchId);
  return [
    { scopeKind: 'GLOBAL' },
    { scopeKind: 'BRANCH', branchId },
    ...(branch?.areaId ? [{ scopeKind: 'AREA' as const, areaId: branch.areaId }] : []),
    ...(branch?.regionId ? [{ scopeKind: 'REGION' as const, regionId: branch.regionId }] : []),
  ];
}

/** Subordinate predicate at one branch (no permission grant); null when the actor holds no position there. */
function subordinateAt(
  actor: AuthorityGraph,
  branchId: string,
): Prisma.EmployeeProfileWhereInput | null {
  const appointments = appointmentsAt(actor, { kind: 'BRANCH', branchId });
  if (appointments.length === 0) return null;
  const rank = Math.max(...appointments.map((appointment) => ORGANIZATION_RANK[appointment.level]));
  const protectedLevels = (Object.keys(ORGANIZATION_RANK) as OrganizationLevel[]).filter(
    (level) => ORGANIZATION_RANK[level] >= rank,
  );
  const subordinate: Prisma.EmployeeProfileWhereInput = {
    organizationAssignments: {
      none: { endedAt: null, level: { in: protectedLevels }, OR: scopeWhere(actor, branchId) },
    },
    ...(rank === ORGANIZATION_RANK.TEAM_LEADER
      ? {
          teamMemberships: {
            some: {
              endedAt: null,
              branchId,
              teamId: {
                in: appointments.flatMap((appointment) =>
                  appointment.teamId ? [appointment.teamId] : [],
                ),
              },
              team: { isActive: true },
            },
          },
        }
      : {}),
  };
  return subordinate;
}

/**
 * Filter for records that belong to ONE branch (attendance, leave history): the record's employee
 * must be a subordinate at that branch. Unlike `supervisorWhere` it does not require the actor to
 * cover the employee's other branches, and it does not require a current branch membership, so
 * history in the actor's branch stays readable. Null means the actor has no position there.
 */
export function branchRecordSupervisorWhere(
  actor: AuthorityGraph,
  branchId: string,
): Prisma.UserWhereInput | null {
  if (actor.kind === 'OWNER') return { kind: 'EMPLOYEE' };
  if (actor.kind !== 'EMPLOYEE') return null;
  const subordinate = subordinateAt(actor, branchId);
  return subordinate
    ? { kind: 'EMPLOYEE', id: { not: actor.userId }, employeeProfile: subordinate }
    : null;
}

/** SQL-equivalent hierarchy filter applied BEFORE candidate/directory pagination. No permission grant. */
export function supervisorWhere(
  actor: AuthorityGraph,
  branchIds?: readonly string[],
): Prisma.UserWhereInput {
  if (actor.kind === 'OWNER') return { kind: 'EMPLOYEE' };
  if (actor.kind !== 'EMPLOYEE') return { id: { in: [] } };
  const candidates = branchIds ??
    actor.organization?.branches.map((branch) => branch.id) ?? [...actor.activeBranchIds];
  const allowed = [...new Set(candidates)].filter(
    (branchId) => appointmentsAt(actor, { kind: 'BRANCH', branchId }).length > 0,
  );
  const clauses: Prisma.UserWhereInput[] = allowed.map((branchId) => {
    const subordinate = subordinateAt(actor, branchId) as Prisma.EmployeeProfileWhereInput;
    return {
      OR: [
        { employeeProfile: { branchAssignments: { none: { revokedAt: null, branchId } } } },
        { employeeProfile: subordinate },
      ],
    };
  });
  const visible: Prisma.UserWhereInput[] = allowed.length
    ? [
        {
          employeeProfile: {
            branchAssignments: {
              some: { revokedAt: null, branchId: { in: allowed } },
              // Branch-local team candidate queries do not authorize full employee account edits.
              ...(branchIds === undefined
                ? { none: { revokedAt: null, branchId: { notIn: allowed } } }
                : {}),
            },
          },
          AND: clauses,
        },
      ]
    : [];
  if (
    branchIds === undefined &&
    appointmentsAt(actor, { kind: 'GLOBAL' }).some((appointment) => appointment.level === 'CEO')
  ) {
    visible.push({
      employeeProfile: {
        branchAssignments: { none: { revokedAt: null } },
        organizationAssignments: { none: { endedAt: null, level: 'CEO' } },
      },
    });
  }
  return {
    kind: 'EMPLOYEE',
    id: { not: actor.userId },
    OR: visible.length ? visible : [{ id: { in: [] } }],
  };
}

/** Batch policy for operational availability; caller supplies the authoritative business date. */
export async function attendanceExemptEmployeeIds(
  transaction: Prisma.TransactionClient,
  employeeIds: readonly string[],
  businessDate?: Date,
): Promise<ReadonlySet<string>> {
  assertAuthTransaction(transaction);
  if (!employeeIds.length) return new Set();
  const now =
    businessDate ??
    (await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  const rows = await transaction.employeeProfile.findMany({
    where: { userId: { in: [...employeeIds] }, user: { status: 'ACTIVE', kind: 'EMPLOYEE' } },
    select: {
      userId: true,
      classificationChanges: {
        where: { effectiveDate: { lte: now } },
        orderBy: { effectiveDate: 'desc' },
        take: 1,
        select: { classification: true },
      },
      branchAssignments: {
        where: { revokedAt: null, branch: { isActive: true } },
        select: { branchId: true },
      },
      organizationAssignments: {
        where: {
          endedAt: null,
          level: { in: ['CEO', 'REGIONAL_MANAGER', 'AREA_MANAGER', 'STORE_MANAGER'] },
        },
        select: {
          level: true,
          branchId: true,
          region: { select: { isActive: true } },
          area: { select: { isActive: true, region: { select: { isActive: true } } } },
        },
      },
    },
  });
  return new Set(
    rows
      .filter(
        (row) =>
          row.classificationChanges[0]?.classification === 'OFFICIAL_EMPLOYEE' &&
          row.organizationAssignments.some(
            (appointment) =>
              appointment.level === 'CEO' ||
              appointment.region?.isActive ||
              (appointment.area?.isActive && appointment.area.region.isActive) ||
              (appointment.branchId !== null &&
                row.branchAssignments.some((branch) => branch.branchId === appointment.branchId)),
          ),
      )
      .map((row) => row.userId),
  );
}
