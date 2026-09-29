import { randomUUID } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';
import {
  decide,
  loadAuthorityGraph,
  ORGANIZATION_RANK,
  scopeContains,
  takeExclusiveAuthGraphLock,
  type AuthorityGraph,
  type Scope,
} from '@lucy-spa/server';
import { businessToday, classificationOn, day } from '../employees/employment.js';
import { invalidateAuthorization } from '../authorization/authorization.store.js';

/**
 * Permissions whose use on OTHER employees is now additionally gated by the organization
 * hierarchy (see `requireSupervision` / `supervisorWhere` / `canSupervise`). Holding one of
 * them at a branch is the only evidence of legacy management authority this bootstrap uses:
 * never a role display name, never `isManagerGroup`. The new VIEW/MANAGE_ORGANIZATION,
 * MANAGE_ORG_ASSIGNMENTS and VIEW/MANAGE_TEAMS permissions have no legacy holders and are
 * deliberately excluded.
 */
export const HIERARCHY_GATED_PERMISSIONS: readonly string[] = Object.freeze([
  'VIEW_EMPLOYEES',
  'CREATE_EMPLOYEES',
  'UPDATE_EMPLOYEES',
  'MANAGE_EMPLOYEE_STATUS',
  'MANAGE_EMPLOYEE_ACCESS',
  'MANAGE_EMPLOYEE_SCOPE',
  'VIEW_EMPLOYEE_PAY',
  'MANAGE_EMPLOYEE_PAY',
  'MANAGE_PERMISSIONS',
  'MANAGE_SKILLS',
  'VIEW_ATTENDANCE',
  'MANAGE_ATTENDANCE',
  'APPROVE_LEAVE',
  'VIEW_WORK_SCHEDULE',
  'MANAGE_WORK_SCHEDULE',
]);

/**
 * The MINIMUM position that preserves supervision: Deputy Store Manager. It supervises
 * everyone below it in the branch, still checks in/out (unlike Store Manager and above), and
 * grants no permission by itself. Promotion to Store Manager or any higher level, and any
 * REGION / AREA / SYSTEM placement, is an explicit Owner decision and is never inferred.
 */
export const BOOTSTRAP_LEVEL = 'DEPUTY_STORE_MANAGER' as const;
export const BOOTSTRAP_SOURCE = 'LEGACY_ORGANIZATION_BOOTSTRAP';
export const BOOTSTRAP_REASON = 'Legacy organization bootstrap';

export interface BootstrapCause {
  readonly permission: string;
  readonly source: 'ROLE' | 'OVERRIDE_ALLOW';
  readonly roleCode: string | null;
  readonly scope: Scope;
}

export interface PlannedAppointment {
  readonly userId: string;
  readonly employeeCode: string;
  readonly level: typeof BOOTSTRAP_LEVEL;
  readonly branchId: string;
  readonly causes: readonly BootstrapCause[];
}

export type ManualReviewReason =
  'GLOBAL_LEGACY_AUTHORITY' | 'REGION_OR_AREA_LEGACY_AUTHORITY' | 'NOT_OFFICIAL_EMPLOYEE';

export interface ManualReview {
  readonly userId: string;
  readonly employeeCode: string;
  readonly reason: ManualReviewReason;
  readonly detail: string;
  readonly causes: readonly BootstrapCause[];
  readonly branchIds: readonly string[];
}

export type SkipReason =
  | 'ALREADY_APPOINTED'
  | 'EMPLOYMENT_ENDED'
  | 'NOT_ACTIVE'
  | 'DORMANT_GRANT_NO_ACTIVE_BRANCH_MEMBERSHIP'
  | 'AUTHORITY_FULLY_DENIED';

export interface Skipped {
  readonly userId: string;
  readonly employeeCode: string;
  readonly reason: SkipReason;
  readonly branchId: string | null;
  readonly detail: string;
}

export interface OrganizationBootstrapReport {
  readonly mode: 'DRY_RUN' | 'APPLY';
  readonly businessDate: string;
  readonly employeesExamined: number;
  /** Employees with no gated permission at all: nothing to migrate (counted, not listed). */
  readonly withoutManagementAuthority: number;
  readonly appointments: readonly PlannedAppointment[];
  readonly manualReview: readonly ManualReview[];
  readonly skipped: readonly Skipped[];
  /** Rows actually created (always 0 in a dry run; 0 again on a repeat run). */
  readonly created: number;
}

export type OrganizationBootstrapOutcome =
  | { readonly status: 'OK'; readonly report: OrganizationBootstrapReport }
  | { readonly status: 'NO_OWNER' };

const byId = <T extends { userId: string; branchId?: string | null }>(a: T, b: T) =>
  a.userId < b.userId
    ? -1
    : a.userId > b.userId
      ? 1
      : (a.branchId ?? '') < (b.branchId ?? '')
        ? -1
        : 1;

function scopeOf(row: {
  scopeKind: string;
  branchId: string | null;
  regionId: string | null;
  areaId: string | null;
}): Scope | null {
  if (row.scopeKind === 'GLOBAL') return { kind: 'GLOBAL' };
  if (row.scopeKind === 'REGION' && row.regionId) return { kind: 'REGION', regionId: row.regionId };
  if (row.scopeKind === 'AREA' && row.areaId) return { kind: 'AREA', areaId: row.areaId };
  if (row.scopeKind === 'BRANCH' && row.branchId) return { kind: 'BRANCH', branchId: row.branchId };
  return null;
}

async function causesOf(tx: Prisma.TransactionClient, userId: string): Promise<BootstrapCause[]> {
  const assignments = await tx.userRoleAssignment.findMany({
    where: { userId, role: { isActive: true } },
    select: {
      scopeKind: true,
      branchId: true,
      regionId: true,
      areaId: true,
      role: {
        select: { code: true, permissions: { select: { permission: { select: { code: true } } } } },
      },
    },
  });
  const overrides = await tx.userPermissionOverride.findMany({
    where: { userId, effect: 'ALLOW' },
    select: {
      scopeKind: true,
      branchId: true,
      regionId: true,
      areaId: true,
      permission: { select: { code: true } },
    },
  });
  const causes: BootstrapCause[] = [];
  for (const assignment of assignments) {
    const scope = scopeOf(assignment);
    if (!scope) continue;
    for (const { permission } of assignment.role.permissions) {
      if (HIERARCHY_GATED_PERMISSIONS.includes(permission.code)) {
        causes.push({
          permission: permission.code,
          source: 'ROLE',
          roleCode: assignment.role.code,
          scope,
        });
      }
    }
  }
  for (const override of overrides) {
    const scope = scopeOf(override);
    if (scope && HIERARCHY_GATED_PERMISSIONS.includes(override.permission.code)) {
      causes.push({
        permission: override.permission.code,
        source: 'OVERRIDE_ALLOW',
        roleCode: null,
        scope,
      });
    }
  }
  return causes.sort((a, b) =>
    `${a.permission}|${a.source}|${a.roleCode ?? ''}|${JSON.stringify(a.scope)}` <
    `${b.permission}|${b.source}|${b.roleCode ?? ''}|${JSON.stringify(b.scope)}`
      ? -1
      : 1,
  );
}

function coveredByExistingAppointment(graph: AuthorityGraph, branchId: string): boolean {
  return (graph.appointments ?? []).some(
    (appointment) =>
      ORGANIZATION_RANK[appointment.level] >= ORGANIZATION_RANK[BOOTSTRAP_LEVEL] &&
      scopeContains(graph, appointment.scope, { kind: 'BRANCH', branchId }),
  );
}

/**
 * Pure read: derives, from authoritative role / override / branch-membership / employment
 * data only, which employees need which appointments. Deterministic (employees by id,
 * branches by id) and side-effect free, so it doubles as the dry-run and the deployment check.
 */
export async function planOrganizationBootstrap(
  tx: Prisma.TransactionClient,
): Promise<Omit<OrganizationBootstrapReport, 'mode' | 'created'>> {
  const today = await businessToday(
    tx,
    (await tx.branch.findMany({ select: { id: true } })).map((row) => row.id),
  );
  const employees = await tx.user.findMany({
    where: { kind: 'EMPLOYEE', employeeProfile: { isNot: null } },
    select: {
      id: true,
      status: true,
      employeeProfile: { select: { employeeCodeCanonical: true } },
    },
    orderBy: { id: 'asc' },
  });
  const appointments: PlannedAppointment[] = [];
  const manualReview: ManualReview[] = [];
  const skipped: Skipped[] = [];
  let withoutManagementAuthority = 0;
  for (const employee of employees) {
    const code = employee.employeeProfile!.employeeCodeCanonical;
    const graph = await loadAuthorityGraph(tx, employee.id);
    const causes = await causesOf(tx, employee.id);
    if (!graph || causes.length === 0) {
      withoutManagementAuthority += 1;
      continue;
    }
    // Only causes that are effective today count (an inactive role never reaches here; an
    // ALLOW cancelled by DENY is dropped by `decide`).
    const effective = (cause: BootstrapCause, target: Scope) =>
      cause.permission !== '' && decide(graph, cause.permission, target);
    const systemCauses = causes.filter(
      (cause) => cause.scope.kind === 'GLOBAL' && effective(cause, { kind: 'GLOBAL' }),
    );
    const geographyCauses = causes.filter(
      (cause) => cause.scope.kind === 'REGION' || cause.scope.kind === 'AREA',
    );
    const branchCauses = causes.filter((cause) => cause.scope.kind === 'BRANCH');
    const activeBranches = [...graph.activeBranchIds].sort();

    const classification = (await classificationOn(tx, employee.id, today))?.classification ?? null;
    if (classification === 'ENDED') {
      skipped.push({
        userId: employee.id,
        employeeCode: code,
        reason: 'EMPLOYMENT_ENDED',
        branchId: null,
        detail: 'Employment has ended; no appointment.',
      });
      continue;
    }
    if (employee.status !== 'ACTIVE') {
      skipped.push({
        userId: employee.id,
        employeeCode: code,
        reason: 'NOT_ACTIVE',
        branchId: null,
        detail: `Account status is ${employee.status}.`,
      });
      continue;
    }
    if (classification !== 'OFFICIAL_EMPLOYEE') {
      // Appointments are for official employees only; never escalate anyone else silently.
      manualReview.push({
        userId: employee.id,
        employeeCode: code,
        reason: 'NOT_OFFICIAL_EMPLOYEE',
        detail: `Holds management permissions but is ${classification ?? 'unclassified'}, not an official employee.`,
        causes,
        branchIds: activeBranches,
      });
      continue;
    }
    if (systemCauses.length > 0) {
      manualReview.push({
        userId: employee.id,
        employeeCode: code,
        reason: 'GLOBAL_LEGACY_AUTHORITY',
        detail:
          'Legacy SYSTEM-scope management authority does not establish CEO, Regional or Area placement. The Owner must decide the position explicitly.',
        causes: systemCauses,
        branchIds: activeBranches,
      });
    }
    if (geographyCauses.length > 0) {
      manualReview.push({
        userId: employee.id,
        employeeCode: code,
        reason: 'REGION_OR_AREA_LEGACY_AUTHORITY',
        detail: 'REGION/AREA-scope authority cannot be mapped to a position automatically.',
        causes: geographyCauses,
        branchIds: activeBranches,
      });
    }
    // BRANCH-scope authority: an explicit gated grant at a branch, effective there today.
    const branchesWithGrant = [
      ...new Set(
        branchCauses.flatMap((cause) =>
          cause.scope.kind === 'BRANCH' ? [cause.scope.branchId] : [],
        ),
      ),
    ].sort();
    for (const branchId of branchesWithGrant) {
      const here = branchCauses.filter(
        (cause) => cause.scope.kind === 'BRANCH' && cause.scope.branchId === branchId,
      );
      if (!graph.activeBranchIds.has(branchId)) {
        skipped.push({
          userId: employee.id,
          employeeCode: code,
          reason: 'DORMANT_GRANT_NO_ACTIVE_BRANCH_MEMBERSHIP',
          branchId,
          detail: 'Grant is dormant without an active branch membership.',
        });
        continue;
      }
      const live = here.filter((cause) => effective(cause, { kind: 'BRANCH', branchId }));
      if (live.length === 0) {
        skipped.push({
          userId: employee.id,
          employeeCode: code,
          reason: 'AUTHORITY_FULLY_DENIED',
          branchId,
          detail: 'Every gated grant at this branch is cancelled by a DENY.',
        });
        continue;
      }
      if (coveredByExistingAppointment(graph, branchId)) {
        skipped.push({
          userId: employee.id,
          employeeCode: code,
          reason: 'ALREADY_APPOINTED',
          branchId,
          detail: 'An active appointment already covers this branch.',
        });
        continue;
      }
      appointments.push({
        userId: employee.id,
        employeeCode: code,
        level: BOOTSTRAP_LEVEL,
        branchId,
        causes: live,
      });
    }
  }
  return {
    businessDate: day(today),
    employeesExamined: employees.length,
    withoutManagementAuthority,
    appointments: appointments.sort(byId),
    manualReview: manualReview.sort(byId),
    skipped: skipped.sort(byId),
  };
}

export interface OrganizationBootstrapOptions {
  readonly apply: boolean;
  /** Operator context for audit provenance; never a credential. */
  readonly executionContext: string;
}

/**
 * Operator command (run explicitly, never on startup) that gives existing branch-scope
 * managers the minimum position their permissions already imply, BEFORE the hierarchy is
 * enforced for them. Dry run by default. Apply is one transaction under the exclusive
 * authorization-graph lock; it only ever inserts appointments (never edits or removes any
 * row), so repeating it finds every branch already covered and changes nothing.
 * Appointments grant no permission and are created strictly at branches where the employee
 * already held effective gated authority, so no capability is broadened.
 */
export async function runOrganizationBootstrap(
  tx: Prisma.TransactionClient,
  options: OrganizationBootstrapOptions,
): Promise<OrganizationBootstrapOutcome> {
  if (options.apply) await takeExclusiveAuthGraphLock(tx);
  const owners = await tx.user.findMany({
    where: { kind: 'OWNER' },
    select: { id: true },
    take: 2,
  });
  if (owners.length !== 1) return { status: 'NO_OWNER' };
  const ownerId = owners[0]!.id;
  const plan = await planOrganizationBootstrap(tx);
  if (!options.apply || plan.appointments.length === 0) {
    return {
      status: 'OK',
      report: { mode: options.apply ? 'APPLY' : 'DRY_RUN', ...plan, created: 0 },
    };
  }
  const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  const correlationId = randomUUID();
  for (const planned of plan.appointments) {
    // Users are locked in id order (the plan is sorted) before their rows change.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${planned.userId}::uuid FOR UPDATE`;
    const row = await tx.organizationAssignment.create({
      data: {
        employeeUserId: planned.userId,
        level: planned.level,
        scopeKind: 'BRANCH',
        branchId: planned.branchId,
        assignedAt: now,
        assignedByUserId: ownerId,
      },
    });
    await tx.auditEvent.create({
      data: {
        action: 'ORGANIZATION_APPOINTED',
        actorKind: 'BOOTSTRAP',
        subjectUserId: planned.userId,
        entityType: 'OrganizationAssignment',
        entityId: row.id,
        branchId: planned.branchId,
        correlationId,
        occurredAt: now,
        reason: BOOTSTRAP_REASON,
        dataClassification: 'STANDARD',
        after: {
          source: BOOTSTRAP_SOURCE,
          level: planned.level,
          scope: { kind: 'BRANCH', branchId: planned.branchId },
          executionContext: options.executionContext,
          causes: planned.causes.map((cause) => ({
            permission: cause.permission,
            source: cause.source,
            roleCode: cause.roleCode,
            scope: JSON.parse(JSON.stringify(cause.scope)) as Prisma.InputJsonObject,
          })),
        },
      },
    });
  }
  await invalidateAuthorization(tx, new Set(plan.appointments.map((entry) => entry.userId)), now);
  await tx.auditEvent.create({
    data: {
      action: 'ORGANIZATION_BOOTSTRAP_RUN',
      actorKind: 'BOOTSTRAP',
      entityType: 'OrganizationAssignment',
      entityId: correlationId,
      correlationId,
      occurredAt: now,
      reason: BOOTSTRAP_REASON,
      dataClassification: 'STANDARD',
      after: {
        source: BOOTSTRAP_SOURCE,
        executionContext: options.executionContext,
        created: plan.appointments.length,
        manualReview: plan.manualReview.length,
        skipped: plan.skipped.length,
      },
    },
  });
  return {
    status: 'OK',
    report: { mode: 'APPLY', ...plan, created: plan.appointments.length },
  };
}
