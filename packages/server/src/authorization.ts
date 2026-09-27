import { PERMISSION_CATALOG, type PermissionCode } from '@lucy-spa/database';

/** Code-owned codes only; anything else (including a stale string) is denied. */
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.map((entry) => entry.code),
);

export function isKnownPermission(value: string): value is PermissionCode {
  return KNOWN_PERMISSIONS.has(value);
}

export type Scope =
  { readonly kind: 'GLOBAL' } | { readonly kind: 'BRANCH'; readonly branchId: string };
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
