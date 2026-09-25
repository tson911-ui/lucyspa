import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PERMISSION_CATALOG } from '@lucy-spa/database';
import {
  authorizationSummary,
  checkContainment,
  checkGraphChange,
  decide,
  decideAcross,
  GLOBAL,
  type AuthorityGraph,
  type Grant,
  type Override,
} from './authorization.js';

const A = 'branch-a';
const B = 'branch-b';
const P = 'VIEW_EMPLOYEES';
const inA = { kind: 'BRANCH', branchId: A } as const;
const inB = { kind: 'BRANCH', branchId: B } as const;

function employee(
  options: {
    id?: string;
    branches?: string[];
    roleGrants?: Grant[];
    overrides?: Override[];
  } = {},
): AuthorityGraph {
  return {
    userId: options.id ?? 'employee',
    kind: 'EMPLOYEE',
    authzVersion: 3,
    activeBranchIds: new Set(options.branches ?? []),
    roleGrants: options.roleGrants ?? [],
    overrides: options.overrides ?? [],
  };
}

const owner: AuthorityGraph = {
  userId: 'owner',
  kind: 'OWNER',
  authzVersion: 1,
  activeBranchIds: new Set(),
  roleGrants: [],
  overrides: [],
};

test('design section 7 decision table', () => {
  // Role grant in A, no global grant, resource in B → Deny.
  assert.equal(
    decide(employee({ branches: [A, B], roleGrants: [{ permission: P, scope: inA }] }), P, inB),
    false,
  );
  // Role grant in B, no active B membership → Deny.
  assert.equal(
    decide(employee({ branches: [A], roleGrants: [{ permission: P, scope: inB }] }), P, inB),
    false,
  );
  // Global ALLOW plus B DENY → Deny in B (still allowed in A).
  const globalAllowBDeny = employee({
    overrides: [
      { permission: P, effect: 'ALLOW', scope: GLOBAL },
      { permission: P, effect: 'DENY', scope: inB },
    ],
  });
  assert.equal(decide(globalAllowBDeny, P, inB), false);
  assert.equal(decide(globalAllowBDeny, P, inA), true);
  // Global DENY plus B ALLOW → Deny in B.
  assert.equal(
    decide(
      employee({
        branches: [B],
        overrides: [
          { permission: P, effect: 'DENY', scope: GLOBAL },
          { permission: P, effect: 'ALLOW', scope: inB },
        ],
      }),
      P,
      inB,
    ),
    false,
  );
  // B ALLOW plus active B membership, no applicable DENY → Allow in B only.
  const bAllow = employee({
    branches: [A, B],
    overrides: [{ permission: P, effect: 'ALLOW', scope: inB }],
  });
  assert.equal(decide(bAllow, P, inB), true);
  assert.equal(decide(bAllow, P, inA), false);
  // Branch grant with null requested branch for a global action → Deny.
  assert.equal(decide(bAllow, P, GLOBAL), false);
  // No grant or unknown permission → Deny.
  assert.equal(decide(employee({ branches: [A] }), P, inA), false);
  assert.equal(
    decide(
      employee({ roleGrants: [{ permission: 'DELETE_EVERYTHING', scope: GLOBAL }] }),
      'DELETE_EVERYTHING',
      GLOBAL,
    ),
    false,
  );
});

test('global grants, membership, Owner and non-workforce principals', () => {
  const globalRole = employee({ roleGrants: [{ permission: P, scope: GLOBAL }] });
  // GLOBAL covers every branch, including branches the employee is not a member of.
  assert.equal(decide(globalRole, P, GLOBAL), true);
  assert.equal(decide(globalRole, P, { kind: 'BRANCH', branchId: 'future-branch' }), true);
  // Membership alone grants nothing.
  assert.equal(decide(employee({ branches: [A, B] }), P, inA), false);
  // A DENY in one branch does not need membership to apply.
  assert.equal(
    decide(
      employee({
        roleGrants: [{ permission: P, scope: GLOBAL }],
        overrides: [{ permission: P, effect: 'DENY', scope: inB }],
      }),
      P,
      inB,
    ),
    false,
  );
  // Owner passes permission/scope checks for catalog permissions only.
  for (const { code } of PERMISSION_CATALOG) {
    assert.equal(decide(owner, code, GLOBAL), true);
    assert.equal(decide(owner, code, inB), true);
  }
  assert.equal(decide(owner, 'UNKNOWN_CODE', GLOBAL), false);
  // Customers never receive workforce authority, even with stray rows.
  const customer: AuthorityGraph = {
    ...employee({ roleGrants: [{ permission: P, scope: GLOBAL }] }),
    kind: 'CUSTOMER',
  };
  assert.equal(decide(customer, P, GLOBAL), false);
});

test('unrestricted global authority rejects any branch DENY for that permission', () => {
  const graph = employee({
    roleGrants: [{ permission: 'VIEW_AUDIT_LOG', scope: GLOBAL }],
    overrides: [{ permission: 'VIEW_AUDIT_LOG', effect: 'DENY', scope: inB }],
  });
  assert.equal(decide(graph, 'VIEW_AUDIT_LOG', GLOBAL), true);
  assert.equal(decide(graph, 'VIEW_AUDIT_LOG', GLOBAL, { unrestricted: true }), false);
  assert.equal(
    decide(
      employee({ roleGrants: [{ permission: 'VIEW_AUDIT_LOG', scope: GLOBAL }] }),
      'VIEW_AUDIT_LOG',
      GLOBAL,
      {
        unrestricted: true,
      },
    ),
    true,
  );
});

test('multi-branch operations require every affected branch; none requires GLOBAL', () => {
  const both = employee({
    branches: [A, B],
    roleGrants: [
      { permission: P, scope: inA },
      { permission: P, scope: inB },
    ],
  });
  assert.equal(decideAcross(both, P, [A, B]), true);
  assert.equal(decideAcross(both, P, [A, B, 'branch-c']), false);
  const onlyA = employee({ branches: [A, B], roleGrants: [{ permission: P, scope: inA }] });
  assert.equal(decideAcross(onlyA, P, [A]), true);
  assert.equal(decideAcross(onlyA, P, [A, B]), false, 'one denial rejects the operation');
  // An employee without any active branch requires GLOBAL permission.
  assert.equal(decideAcross(both, P, []), false);
  assert.equal(
    decideAcross(employee({ roleGrants: [{ permission: P, scope: GLOBAL }] }), P, []),
    true,
  );
});

test('containment: target authority must be within the actor across global and every branch', () => {
  const manager = employee({
    id: 'manager',
    branches: [A],
    roleGrants: [
      { permission: P, scope: inA },
      { permission: 'MANAGE_EMPLOYEE_ACCESS', scope: inA },
    ],
  });
  const staffA = employee({
    id: 'staff',
    branches: [A],
    roleGrants: [{ permission: P, scope: inA }],
  });
  assert.equal(checkContainment(manager, staffA), null);
  // Branch overlap alone is insufficient: the target also holds B.
  const staffAB = employee({
    id: 'staff',
    branches: [A, B],
    roleGrants: [
      { permission: P, scope: inA },
      { permission: P, scope: inB },
    ],
  });
  assert.equal(checkContainment(manager, staffAB), 'EXCEEDS_ACTOR');
  // A global target grant covers future branches the actor cannot.
  const globalStaff = employee({ id: 'staff', roleGrants: [{ permission: P, scope: GLOBAL }] });
  assert.equal(checkContainment(manager, globalStaff), 'EXCEEDS_ACTOR');
  // A global actor with a branch DENY does not contain a global target without it.
  const deniedGlobal = employee({
    id: 'manager',
    roleGrants: [{ permission: P, scope: GLOBAL }],
    overrides: [{ permission: P, effect: 'DENY', scope: inB }],
  });
  assert.equal(checkContainment(deniedGlobal, globalStaff), 'EXCEEDS_ACTOR');
  assert.equal(
    checkContainment(
      employee({ id: 'manager', roleGrants: [{ permission: P, scope: GLOBAL }] }),
      globalStaff,
    ),
    null,
  );
  // Permission-management power is authority too.
  const permissionManager = employee({
    id: 'staff',
    branches: [A],
    roleGrants: [
      { permission: P, scope: inA },
      { permission: 'MANAGE_PERMISSIONS', scope: inA },
    ],
  });
  assert.equal(checkContainment(manager, permissionManager), 'EXCEEDS_ACTOR');
  // Status never short-circuits to zero: the target is evaluated as if ACTIVE, and
  // an ineffective branch grant (no membership) is not counted.
  const ineffective = employee({
    id: 'staff',
    branches: [],
    roleGrants: [{ permission: P, scope: inB }],
  });
  assert.equal(checkContainment(manager, ineffective), null);
  // Protected targets, self-issuance, Owner and non-workforce actors.
  assert.equal(checkContainment(manager, owner), 'TARGET_PROTECTED');
  assert.equal(checkContainment(owner, owner), 'TARGET_PROTECTED');
  assert.equal(checkContainment(manager, { ...staffA, kind: 'CUSTOMER' }), 'TARGET_PROTECTED');
  assert.equal(checkContainment(manager, { ...manager }), 'SELF_TARGET');
  assert.equal(checkContainment(owner, staffAB), null);
  assert.equal(
    checkContainment({ ...staffA, kind: 'CUSTOMER', userId: 'c' }, employee({ id: 'x' })),
    'ACTOR_NOT_WORKFORCE',
  );
});

test('graph changes: gained authority must be held by the actor; removing a DENY is a grant', () => {
  const manager = employee({
    id: 'manager',
    branches: [A],
    roleGrants: [
      { permission: P, scope: inA },
      { permission: 'MANAGE_PERMISSIONS', scope: inA },
    ],
  });
  const before = employee({ id: 'staff', branches: [A] });
  const grantA = employee({
    id: 'staff',
    branches: [A],
    roleGrants: [{ permission: P, scope: inA }],
  });
  assert.equal(checkGraphChange(manager, before, grantA), null);
  // Granting a permission the actor does not hold.
  const grantPay = employee({
    id: 'staff',
    branches: [A],
    roleGrants: [{ permission: 'VIEW_EMPLOYEE_PAY', scope: inA }],
  });
  assert.equal(checkGraphChange(manager, before, grantPay), 'EXCEEDS_ACTOR');
  // Global delegation cannot exceed a branch-limited actor.
  const grantGlobal = employee({
    id: 'staff',
    branches: [A],
    roleGrants: [{ permission: P, scope: GLOBAL }],
  });
  assert.equal(checkGraphChange(manager, before, grantGlobal), 'EXCEEDS_ACTOR');
  // Removing a DENY confers authority and is checked like a grant.
  const withDeny = employee({
    id: 'staff',
    roleGrants: [{ permission: 'VIEW_EMPLOYEE_PAY', scope: GLOBAL }],
    overrides: [{ permission: 'VIEW_EMPLOYEE_PAY', effect: 'DENY', scope: GLOBAL }],
  });
  const withoutDeny = { ...withDeny, overrides: [] };
  assert.equal(checkGraphChange(manager, withDeny, withoutDeny), 'EXCEEDS_ACTOR');
  // Branch expansion activating a previously ineffective grant is a grant too.
  const dormant = employee({
    id: 'staff',
    branches: [A],
    roleGrants: [{ permission: P, scope: inB }],
  });
  const expanded = { ...dormant, activeBranchIds: new Set([A, B]) };
  assert.equal(checkGraphChange(manager, dormant, expanded), 'EXCEEDS_ACTOR');
  // Reducing authority never exceeds the actor.
  assert.equal(checkGraphChange(manager, grantPay, before), null);
  // Self-changes, Owner/customer targets and Owner actors.
  assert.equal(checkGraphChange(manager, manager, manager), 'SELF_TARGET');
  assert.equal(checkGraphChange(manager, owner, owner), 'TARGET_PROTECTED');
  assert.equal(
    checkGraphChange(manager, before, { ...grantA, userId: 'other' }),
    'TARGET_PROTECTED',
  );
  assert.equal(checkGraphChange(owner, before, grantGlobal), null);
  assert.equal(checkGraphChange(owner, owner, owner), 'TARGET_PROTECTED');
});

test('account authorization summary: Owner virtual role, customer empty, effective workforce hints', () => {
  assert.deepEqual(authorizationSummary(owner), { version: 1, owner: true });
  assert.deepEqual(authorizationSummary({ ...employee(), kind: 'CUSTOMER', authzVersion: 2 }), {
    version: 2,
    grants: [],
    denies: [],
  });
  const summary = authorizationSummary(
    employee({
      branches: [A],
      roleGrants: [
        { permission: P, scope: inA },
        { permission: P, scope: inA },
        { permission: P, scope: inB },
        { permission: 'VIEW_AUDIT_LOG', scope: GLOBAL },
        { permission: 'NOT_A_CODE', scope: GLOBAL },
      ],
      overrides: [
        { permission: 'MANAGE_EMPLOYEE_PAY', effect: 'ALLOW', scope: inA },
        { permission: P, effect: 'DENY', scope: inB },
      ],
    }),
  );
  assert.deepEqual(summary, {
    version: 3,
    grants: [
      { permission: 'MANAGE_EMPLOYEE_PAY', scope: inA },
      { permission: 'VIEW_AUDIT_LOG', scope: GLOBAL },
      { permission: P, scope: inA },
    ],
    denies: [{ permission: P, scope: inB }],
  });
});

test('the code-owned catalog is exactly the Phase 1 and Phase 2 permissions', () => {
  assert.deepEqual(
    PERMISSION_CATALOG.map((entry) => [
      entry.code,
      entry.scopeCapability,
      entry.dataClassification,
    ]),
    [
      ['VIEW_EMPLOYEES', 'BRANCH_CAPABLE', 'STANDARD'],
      ['CREATE_EMPLOYEES', 'BRANCH_CAPABLE', 'STANDARD'],
      ['UPDATE_EMPLOYEES', 'BRANCH_CAPABLE', 'STANDARD'],
      ['MANAGE_EMPLOYEE_STATUS', 'BRANCH_CAPABLE', 'STANDARD'],
      ['MANAGE_EMPLOYEE_ACCESS', 'BRANCH_CAPABLE', 'STANDARD'],
      ['MANAGE_EMPLOYEE_SCOPE', 'BRANCH_CAPABLE', 'STANDARD'],
      ['VIEW_EMPLOYEE_PAY', 'BRANCH_CAPABLE', 'EMPLOYEE_PAY'],
      ['MANAGE_EMPLOYEE_PAY', 'BRANCH_CAPABLE', 'EMPLOYEE_PAY'],
      ['MANAGE_PERMISSIONS', 'BRANCH_CAPABLE', 'STANDARD'],
      ['VIEW_AUDIT_LOG', 'BRANCH_CAPABLE', 'STANDARD'],
      ['MANAGE_BRANCHES', 'BRANCH_CAPABLE', 'STANDARD'],
      ['MANAGE_SERVICES', 'BRANCH_CAPABLE', 'STANDARD'],
      ['MANAGE_SERVICE_PRICES', 'GLOBAL_ONLY', 'STANDARD'],
      ['MANAGE_SKILLS', 'BRANCH_CAPABLE', 'STANDARD'],
      ['VIEW_ATTENDANCE', 'BRANCH_CAPABLE', 'STANDARD'],
      ['MANAGE_ATTENDANCE', 'BRANCH_CAPABLE', 'STANDARD'],
      ['APPROVE_LEAVE', 'BRANCH_CAPABLE', 'STANDARD'],
    ],
  );
});
