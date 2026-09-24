import type { AuthorizationScope, CurrentAccountResponse } from '@lucy-spa/contracts';
import { PERMISSION_CATALOG, type PermissionCode } from '@lucy-spa/database';

/** Code-owned codes only; anything else (including a stale string) is denied. */
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.map((entry) => entry.code),
);

export function isKnownPermission(value: string): value is PermissionCode {
  return KNOWN_PERMISSIONS.has(value);
}

export type Scope = AuthorizationScope;
export const GLOBAL: Scope = Object.freeze({ kind: 'GLOBAL' });

export interface Grant {
  readonly permission: string;
  readonly scope: Scope;
}

export interface Override extends Grant {
  readonly effect: 'ALLOW' | 'DENY';
}

/**
 * Authoritative inputs for one principal, loaded inside the deciding transaction.
 * `roleGrants` come only from active roles; `activeBranchIds` are memberships that
 * are not revoked and whose branch is active. Membership alone grants nothing.
 */
export interface AuthorityGraph {
  readonly userId: string;
  readonly kind: 'OWNER' | 'EMPLOYEE' | 'CUSTOMER';
  readonly authzVersion: number;
  readonly activeBranchIds: ReadonlySet<string>;
  readonly roleGrants: readonly Grant[];
  readonly overrides: readonly Override[];
}

/** A persisted resource's authoritative location; never a client-submitted branch. */
export type Target =
  { readonly kind: 'GLOBAL' } | { readonly kind: 'BRANCH'; readonly branchId: string };

export interface DecideOptions {
  /**
   * For a GLOBAL target, also reject when any branch DENY exists for the permission
   * (design: unrestricted GLOBAL authority, e.g. null-branch audit events).
   */
  readonly unrestricted?: boolean;
}

function denied(graph: AuthorityGraph, permission: string, target: Target, options: DecideOptions) {
  return graph.overrides.some(
    (override) =>
      override.effect === 'DENY' &&
      override.permission === permission &&
      (override.scope.kind === 'GLOBAL' ||
        (target.kind === 'BRANCH' && override.scope.branchId === target.branchId) ||
        (target.kind === 'GLOBAL' && options.unrestricted === true)),
  );
}

function granted(graph: AuthorityGraph, permission: string, target: Target): boolean {
  const allows = [
    ...graph.roleGrants,
    ...graph.overrides.filter((override) => override.effect === 'ALLOW'),
  ];
  return allows.some((grant) => {
    if (grant.permission !== permission) return false;
    // A GLOBAL grant authorizes the global action and every branch, including future ones.
    if (grant.scope.kind === 'GLOBAL') return true;
    // A branch grant never authorizes a global action, and needs current active membership.
    return (
      target.kind === 'BRANCH' &&
      grant.scope.branchId === target.branchId &&
      graph.activeBranchIds.has(target.branchId)
    );
  });
}

/**
 * Design section 7 evaluation for one permission and one target. The caller has already
 * validated the authenticated session, operation and target (step 1) and applies domain
 * target protections (step 2). Owner passes permission/scope checks only.
 */
export function decide(
  graph: AuthorityGraph,
  permission: string,
  target: Target,
  options: DecideOptions = {},
): boolean {
  if (!isKnownPermission(permission)) return false;
  if (graph.kind === 'OWNER') return true;
  // Customer self-service is never enabled through workforce permissions.
  if (graph.kind !== 'EMPLOYEE') return false;
  if (denied(graph, permission, target, options)) return false;
  return granted(graph, permission, target);
}

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

// Stands for every branch not named in either graph, including future branches.
const UNNAMED_BRANCH = '\u0000unnamed-branch';

function branchUniverse(...graphs: AuthorityGraph[]): string[] {
  const ids = new Set<string>([UNNAMED_BRANCH]);
  for (const graph of graphs) {
    for (const id of graph.activeBranchIds) ids.add(id);
    for (const entry of [...graph.roleGrants, ...graph.overrides]) {
      if (entry.scope.kind === 'BRANCH') ids.add(entry.scope.branchId);
    }
  }
  return [...ids];
}

function targetsFor(universe: string[]): Target[] {
  return [GLOBAL, ...universe.map((branchId) => ({ kind: 'BRANCH', branchId }) as const)];
}

/** Every (permission, target) the subject is effectively authorized for. */
function capabilities(graph: AuthorityGraph, universe: string[]): Set<string> {
  const result = new Set<string>();
  for (const { code } of PERMISSION_CATALOG) {
    for (const target of targetsFor(universe)) {
      if (decide(graph, code, target)) {
        result.add(`${code}|${target.kind === 'GLOBAL' ? '*' : target.branchId}`);
      }
    }
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
  const universe = branchUniverse(actor, target);
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
  const universe = branchUniverse(actor, before, after);
  const previous = capabilities(before, universe);
  const held = capabilities(actor, universe);
  for (const capability of capabilities(after, universe)) {
    if (!previous.has(capability) && !held.has(capability)) return 'EXCEEDS_ACTOR';
  }
  return null;
}

function sameScope(left: Scope, right: Scope): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'GLOBAL' || left.branchId === (right as { branchId: string }).branchId)
  );
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
      const left = `${a.permission}|${a.scope.kind === 'GLOBAL' ? '' : a.scope.branchId}`;
      const right = `${b.permission}|${b.scope.kind === 'GLOBAL' ? '' : b.scope.branchId}`;
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
      (grant.scope.kind === 'GLOBAL' || graph.activeBranchIds.has(grant.scope.branchId)),
  );
  const denies = graph.overrides.filter(
    (override) => override.effect === 'DENY' && isKnownPermission(override.permission),
  );
  return { version: graph.authzVersion, grants: unique(allows), denies: unique(denies) };
}
