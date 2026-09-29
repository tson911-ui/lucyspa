import { PERMISSION_CATALOG, type PermissionCode } from '@lucy-spa/database';

/** Code-owned codes only; anything else (including a stale string) is denied. */
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.map((entry) => entry.code),
);

export function isKnownPermission(value: string): value is PermissionCode {
  return KNOWN_PERMISSIONS.has(value);
}

export type Scope =
  | { readonly kind: 'GLOBAL' }
  | { readonly kind: 'REGION'; readonly regionId: string }
  | { readonly kind: 'AREA'; readonly areaId: string }
  | { readonly kind: 'BRANCH'; readonly branchId: string };
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
  readonly organization?: OrganizationTree;
  readonly appointments?: readonly OrganizationAppointment[];
  readonly teamMemberships?: readonly { readonly teamId: string; readonly branchId: string }[];
}

export type OrganizationLevel =
  | 'CEO'
  | 'REGIONAL_MANAGER'
  | 'AREA_MANAGER'
  | 'STORE_MANAGER'
  | 'DEPUTY_STORE_MANAGER'
  | 'TEAM_LEADER';
export interface OrganizationAppointment {
  readonly id: string;
  readonly level: OrganizationLevel;
  readonly scope: Scope;
  readonly teamId: string | null;
}
export interface OrganizationTree {
  readonly regions: readonly { readonly id: string; readonly name?: string }[];
  readonly areas: readonly {
    readonly id: string;
    readonly regionId: string;
    readonly name?: string;
  }[];
  readonly branches: readonly {
    readonly id: string;
    readonly areaId: string | null;
    readonly regionId: string | null;
  }[];
}

/** A persisted resource's authoritative location; never a client-submitted branch. */
export type Target = Scope;

/** Contains named and future descendants; ancestry comes from PostgreSQL, never request hints. */
export function scopeContains(
  graph: Pick<AuthorityGraph, 'organization'>,
  scope: Scope,
  target: Scope,
): boolean {
  if (scope.kind === 'GLOBAL') return true;
  if (target.kind === 'GLOBAL') return false;
  if (scope.kind === 'BRANCH')
    return target.kind === 'BRANCH' && scope.branchId === target.branchId;
  if (scope.kind === 'AREA') {
    return target.kind === 'AREA'
      ? scope.areaId === target.areaId
      : target.kind === 'BRANCH' &&
          graph.organization?.branches.some(
            (branch) => branch.id === target.branchId && branch.areaId === scope.areaId,
          ) === true;
  }
  if (target.kind === 'REGION') return scope.regionId === target.regionId;
  if (target.kind === 'AREA')
    return (
      graph.organization?.areas.some(
        (area) => area.id === target.areaId && area.regionId === scope.regionId,
      ) === true
    );
  return (
    graph.organization?.branches.some(
      (branch) => branch.id === target.branchId && branch.regionId === scope.regionId,
    ) === true
  );
}

export function scopeIsActive(graph: AuthorityGraph, scope: Scope): boolean {
  if (scope.kind === 'GLOBAL') return true;
  if (scope.kind === 'REGION')
    return graph.organization?.regions.some((region) => region.id === scope.regionId) === true;
  if (scope.kind === 'AREA')
    return graph.organization?.areas.some((area) => area.id === scope.areaId) === true;
  return graph.activeBranchIds.has(scope.branchId);
}

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
      (scopeContains(graph, override.scope, target) ||
        (options.unrestricted === true && scopeContains(graph, target, override.scope))),
  );
}

function granted(graph: AuthorityGraph, permission: string, target: Target): boolean {
  const allows = [
    ...graph.roleGrants,
    ...graph.overrides.filter((override) => override.effect === 'ALLOW'),
  ];
  return allows.some((grant) => {
    if (grant.permission !== permission) return false;
    if (
      PERMISSION_CATALOG.find((entry) => entry.code === permission)?.scopeCapability ===
        'GLOBAL_ONLY' &&
      grant.scope.kind !== 'GLOBAL'
    )
      return false;
    // A GLOBAL grant authorizes the global action and every branch, including future ones.
    return scopeIsActive(graph, grant.scope) && scopeContains(graph, grant.scope, target);
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
