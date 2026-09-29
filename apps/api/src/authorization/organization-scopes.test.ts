import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, type AuthorityGraph } from '@lucy-spa/server';
import { checkContainment, checkGraphChange } from './authorization.js';
const organization = {
  regions: [{ id: 'r1' }, { id: 'r2' }],
  areas: [
    { id: 'a1', regionId: 'r1' },
    { id: 'a2', regionId: 'r2' },
  ],
  branches: [
    { id: 'b1', areaId: 'a1', regionId: 'r1' },
    { id: 'b2', areaId: 'a2', regionId: 'r2' },
  ],
};
function graph(id: string, region = 'r1'): AuthorityGraph {
  return {
    userId: id,
    kind: 'EMPLOYEE',
    authzVersion: 1,
    activeBranchIds: new Set(),
    organization,
    appointments: [
      {
        id: id + '-appointment',
        level: 'REGIONAL_MANAGER',
        scope: { kind: 'REGION', regionId: region },
        teamId: null,
      },
    ],
    roleGrants: [{ permission: 'VIEW_EMPLOYEES', scope: { kind: 'REGION', regionId: region } }],
    overrides: [],
  };
}
test('regional permission reaches descendants but never another region or system', () => {
  const actor = graph('manager');
  assert.equal(decide(actor, 'VIEW_EMPLOYEES', { kind: 'AREA', areaId: 'a1' }), true);
  assert.equal(decide(actor, 'VIEW_EMPLOYEES', { kind: 'BRANCH', branchId: 'b1' }), true);
  assert.equal(decide(actor, 'VIEW_EMPLOYEES', { kind: 'BRANCH', branchId: 'b2' }), false);
  assert.equal(decide(actor, 'VIEW_EMPLOYEES', { kind: 'GLOBAL' }), false);
});
test('ancestor DENY beats narrower ALLOW; descendant DENY limits unrestricted regional authority', () => {
  const actor: AuthorityGraph = {
    ...graph('manager'),
    overrides: [
      { permission: 'VIEW_EMPLOYEES', effect: 'DENY', scope: { kind: 'REGION', regionId: 'r1' } },
      { permission: 'VIEW_EMPLOYEES', effect: 'ALLOW', scope: { kind: 'BRANCH', branchId: 'b1' } },
    ],
  };
  assert.equal(decide(actor, 'VIEW_EMPLOYEES', { kind: 'BRANCH', branchId: 'b1' }), false);
  const narrowed: AuthorityGraph = {
    ...graph('manager'),
    overrides: [
      { permission: 'VIEW_EMPLOYEES', effect: 'DENY', scope: { kind: 'BRANCH', branchId: 'b1' } },
    ],
  };
  assert.equal(
    decide(narrowed, 'VIEW_EMPLOYEES', { kind: 'REGION', regionId: 'r1' }, { unrestricted: true }),
    false,
  );
});
test('known permissions and protected Owner identity remain mandatory', () => {
  const owner: AuthorityGraph = { ...graph('owner'), kind: 'OWNER' };
  assert.equal(decide(owner, 'NOT_A_PERMISSION', { kind: 'GLOBAL' }), false);
  assert.equal(checkContainment(graph('employee'), owner), 'TARGET_PROTECTED');
  assert.equal(checkGraphChange(graph('employee'), owner, owner), 'TARGET_PROTECTED');
});
test('covering current branch does not confer regional authority over future descendants', () => {
  const actor: AuthorityGraph = {
    ...graph('actor'),
    appointments: [{ id: 'ceo', level: 'CEO', scope: { kind: 'GLOBAL' }, teamId: null }],
    activeBranchIds: new Set(['b1']),
    roleGrants: [{ permission: 'VIEW_EMPLOYEES', scope: { kind: 'BRANCH', branchId: 'b1' } }],
  };
  assert.equal(checkContainment(actor, graph('target')), 'EXCEEDS_ACTOR');
  const before: AuthorityGraph = { ...graph('target'), roleGrants: [] };
  assert.equal(checkGraphChange(actor, before, graph('target')), 'EXCEEDS_ACTOR');
});
