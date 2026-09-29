import type { CurrentAccountResponse } from '@lucy-spa/contracts';
import { PERMISSION_CATALOG } from '@lucy-spa/database';
import {
  decide,
  canSupervise,
  GLOBAL,
  isKnownPermission,
  type AuthorityGraph,
  type DecideOptions,
  type Grant,
  type Scope,
  type Target,
} from '@lucy-spa/server';
export {
  decide,
  GLOBAL,
  isKnownPermission,
  type AuthorityGraph,
  type DecideOptions,
  type Grant,
  type Override,
  type Scope,
  type Target,
} from '@lucy-spa/server';

/**
 * Multi-branch operations: every affected branch (old and new scopes) must pass; one
 * denial rejects the whole operation. With no affected branch, GLOBAL is required.
 */
export function decideAcross(
  graph: AuthorityGraph,
  permission: string,
  affectedBranchIds: Iterable<string>,
  options: DecideOptions = {},
): boolean {
  const branches = [...new Set(affectedBranchIds)];
  if (branches.length === 0) return decide(graph, permission, GLOBAL, options);
  return branches.every((branchId) =>
    decide(graph, permission, { kind: 'BRANCH', branchId }, options),
  );
}

/** Include symbolic future descendants: today's branch expansion alone cannot prove containment. */
function capabilityUniverse(...graphs: AuthorityGraph[]) {
  const regions = new Map<string, { id: string }>();
  const areas = new Map<string, { id: string; regionId: string }>();
  const branches = new Map<
    string,
    { id: string; areaId: string | null; regionId: string | null }
  >();
  branches.set('\u0000future-branch', { id: '\u0000future-branch', areaId: null, regionId: null });
  for (const graph of graphs) {
    for (const row of graph.organization?.regions ?? []) regions.set(row.id, row);
    for (const row of graph.organization?.areas ?? []) areas.set(row.id, row);
    for (const row of graph.organization?.branches ?? []) branches.set(row.id, row);
    for (const id of graph.activeBranchIds)
      if (!branches.has(id)) branches.set(id, { id, areaId: null, regionId: null });
    for (const { scope } of [...graph.roleGrants, ...graph.overrides]) {
      if (scope.kind === 'REGION' && !regions.has(scope.regionId))
        regions.set(scope.regionId, { id: scope.regionId });
      if (scope.kind === 'BRANCH' && !branches.has(scope.branchId))
        branches.set(scope.branchId, { id: scope.branchId, areaId: null, regionId: null });
    }
  }
  for (const { id } of regions.values()) {
    const areaId = '\u0000future-area:' + id;
    areas.set(areaId, { id: areaId, regionId: id });
  }
  for (const area of areas.values()) {
    const id = '\u0000future-branch:' + area.id;
    branches.set(id, { id, areaId: area.id, regionId: area.regionId });
  }
  const organization = {
    regions: [...regions.values()],
    areas: [...areas.values()],
    branches: [...branches.values()],
  };
  const targets: Target[] = [
    GLOBAL,
    ...organization.regions.map((row) => ({ kind: 'REGION' as const, regionId: row.id })),
    ...organization.areas.map((row) => ({ kind: 'AREA' as const, areaId: row.id })),
    ...organization.branches.map((row) => ({ kind: 'BRANCH' as const, branchId: row.id })),
  ];
  return { organization, targets };
}
function scopeKey(scope: Scope): string {
  return scope.kind === 'GLOBAL'
    ? '*'
    : scope.kind === 'REGION'
      ? 'R:' + scope.regionId
      : scope.kind === 'AREA'
        ? 'A:' + scope.areaId
        : 'B:' + scope.branchId;
}
function capabilities(
  graph: AuthorityGraph,
  universe: ReturnType<typeof capabilityUniverse>,
): Set<string> {
  const result = new Set<string>();
  const expanded = { ...graph, organization: universe.organization };
  for (const { code } of PERMISSION_CATALOG)
    for (const target of universe.targets) {
      if (decide(expanded, code, target)) result.add(code + '|' + scopeKey(target));
    }
  return result;
}

/**
 * Evaluate a target as if ACTIVE: status never short-circuits its assigned authority
 * to zero. Grants that would be effective under the target's memberships count.
 */
function asActiveEmployee(graph: AuthorityGraph): AuthorityGraph {
  return { ...graph, kind: 'EMPLOYEE' };
}

export type ContainmentFailure =
  'ACTOR_NOT_WORKFORCE' | 'TARGET_PROTECTED' | 'SELF_TARGET' | 'EXCEEDS_ACTOR';

/**
 * Credential-control containment (MANAGE_EMPLOYEE_ACCESS issuance and reactivation):
 * the target's complete effective authority, over global capabilities and every
 * branch (named or future) and accounting for DENYs, must be within the actor's.
 * Branch overlap alone is insufficient. Owner may act on any employee.
 */
export function checkContainment(
  actor: AuthorityGraph,
  target: AuthorityGraph,
): ContainmentFailure | null {
  if (actor.kind !== 'OWNER' && actor.kind !== 'EMPLOYEE') return 'ACTOR_NOT_WORKFORCE';
  if (target.kind !== 'EMPLOYEE') return 'TARGET_PROTECTED';
  if (actor.kind === 'OWNER') return null;
  if (actor.userId === target.userId) return 'SELF_TARGET';
  if (!canSupervise(actor, target)) return 'EXCEEDS_ACTOR';
  const universe = capabilityUniverse(actor, target);
  const held = capabilities(actor, universe);
  for (const capability of capabilities(asActiveEmployee(target), universe)) {
    if (!held.has(capability)) return 'EXCEEDS_ACTOR';
  }
  return null;
}

/**
 * Role/override/scope changes: a non-Owner may only confer authority they effectively
 * hold. Any capability present after but not before counts as granted, so removing a
 * DENY or expanding branch scope is a grant. Non-Owners cannot change themselves and
 * nobody can change Owner/customer principals through this path. The caller also
 * requires MANAGE_PERMISSIONS (and MANAGE_EMPLOYEE_SCOPE where applicable) at every old
 * and new affected scope via `decideAcross`, and repeats this for every affected
 * recipient of a shared role edit.
 */
export function checkGraphChange(
  actor: AuthorityGraph,
  before: AuthorityGraph,
  after: AuthorityGraph,
): ContainmentFailure | null {
  if (actor.kind !== 'OWNER' && actor.kind !== 'EMPLOYEE') return 'ACTOR_NOT_WORKFORCE';
  if (before.kind !== 'EMPLOYEE' || after.kind !== 'EMPLOYEE' || before.userId !== after.userId) {
    return 'TARGET_PROTECTED';
  }
  if (actor.kind === 'OWNER') return null;
  if (actor.userId === after.userId) return 'SELF_TARGET';
  if (!canSupervise(actor, before) || !canSupervise(actor, after)) return 'EXCEEDS_ACTOR';
  const universe = capabilityUniverse(actor, before, after);
  const previous = capabilities(before, universe);
  const held = capabilities(actor, universe);
  for (const capability of capabilities(after, universe)) {
    if (!previous.has(capability) && !held.has(capability)) return 'EXCEEDS_ACTOR';
  }
  return null;
}

function sameScope(left: Scope, right: Scope): boolean {
  return scopeKey(left) === scopeKey(right);
}

function unique(entries: Grant[]): { permission: string; scope: Scope }[] {
  const result: Grant[] = [];
  for (const entry of entries) {
    if (
      !result.some(
        (seen) => seen.permission === entry.permission && sameScope(seen.scope, entry.scope),
      )
    ) {
      result.push(entry);
    }
  }
  return result
    .map((entry) => ({ permission: entry.permission, scope: { ...entry.scope } }))
    .sort((a, b) => {
      const left = `${a.permission}|${scopeKey(a.scope)}`;
      const right = `${b.permission}|${scopeKey(b.scope)}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

/**
 * CurrentAccount `authorization` display hints (design section 10). Owner is a virtual
 * role; customers have empty lists. Workforce grants list only effective ALLOW/role
 * grants (branch grants need active membership); denies list every DENY override.
 * Enforcement never relies on this summary.
 */
export function authorizationSummary(
  graph: AuthorityGraph,
): CurrentAccountResponse['authorization'] {
  if (graph.kind === 'OWNER') return { version: graph.authzVersion, owner: true };
  if (graph.kind !== 'EMPLOYEE') return { version: graph.authzVersion, grants: [], denies: [] };
  const allows = [
    ...graph.roleGrants,
    ...graph.overrides.filter((override) => override.effect === 'ALLOW'),
  ].filter(
    (grant) =>
      isKnownPermission(grant.permission) &&
      (grant.scope.kind !== 'BRANCH' || graph.activeBranchIds.has(grant.scope.branchId)),
  );
  const denies = graph.overrides.filter(
    (override) => override.effect === 'DENY' && isKnownPermission(override.permission),
  );
  return { version: graph.authzVersion, grants: unique(allows), denies: unique(denies) };
}
