import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceExempt,
  canAdministerBelow,
  canAppoint,
  canManageTeam,
  canSupervise,
  OWNER_SUPERVISION_RANK,
  supervisionRank,
  supervisorWhere,
  type AuthorityGraph,
  type OrganizationLevel,
  type Scope,
} from '@lucy-spa/server';

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

function person(
  id: string,
  appointments: { level: OrganizationLevel; scope: Scope; teamId?: string }[] = [],
  teams: { teamId: string; branchId: string }[] = [],
  branches = ['b1'],
): AuthorityGraph {
  return {
    userId: id,
    kind: 'EMPLOYEE',
    authzVersion: 1,
    activeBranchIds: new Set(branches),
    organization,
    appointments: appointments.map((entry, index) => ({
      id: `${id}-${index}`,
      level: entry.level,
      scope: entry.scope,
      teamId: entry.teamId ?? null,
    })),
    teamMemberships: teams,
    roleGrants: [],
    overrides: [],
  };
}
const b1: Scope = { kind: 'BRANCH', branchId: 'b1' };
const owner: AuthorityGraph = { ...person('owner'), kind: 'OWNER' };

test('rank follows the locked hierarchy and never supervises equals, superiors or self', () => {
  const ceo = person('ceo', [{ level: 'CEO', scope: { kind: 'GLOBAL' } }]);
  const regional = person('regional', [
    { level: 'REGIONAL_MANAGER', scope: { kind: 'REGION', regionId: 'r1' } },
  ]);
  const area = person('area', [{ level: 'AREA_MANAGER', scope: { kind: 'AREA', areaId: 'a1' } }]);
  const store = person('store', [{ level: 'STORE_MANAGER', scope: b1 }]);
  const deputy = person('deputy', [{ level: 'DEPUTY_STORE_MANAGER', scope: b1 }]);
  const deputy2 = person('deputy2', [{ level: 'DEPUTY_STORE_MANAGER', scope: b1 }]);
  const chain = [ceo, regional, area, store, deputy, person('ktv')];
  for (let high = 0; high < chain.length; high += 1) {
    for (let low = 0; low < chain.length; low += 1) {
      const expected = high < low && chain[high]!.appointments!.length > 0;
      assert.equal(canSupervise(chain[high]!, chain[low]!), expected, `${high}->${low}`);
    }
  }
  assert.equal(canSupervise(deputy, deputy2), false, 'peers do not supervise one another');
  assert.equal(canSupervise(store, store), false);
  assert.equal(canSupervise(person('ktv'), store), false);
});

test('regional authority never reaches another region', () => {
  const regional = person('regional', [
    { level: 'REGIONAL_MANAGER', scope: { kind: 'REGION', regionId: 'r1' } },
  ]);
  assert.equal(canSupervise(regional, person('x', [], [], ['b2'])), false);
  assert.equal(canSupervise(regional, person('y', [], [], ['b1'])), true);
  assert.equal(
    canSupervise(regional, person('z', [], [], ['b1', 'b2'])),
    false,
    'a target spanning regions needs authority over every branch',
  );
});

test('Team Leader supervises only members of a led team and cannot manage other teams', () => {
  const leader = person('leader', [{ level: 'TEAM_LEADER', scope: b1, teamId: 't1' }]);
  assert.equal(canSupervise(leader, person('m', [], [{ teamId: 't1', branchId: 'b1' }])), true);
  assert.equal(canSupervise(leader, person('o', [], [{ teamId: 't2', branchId: 'b1' }])), false);
  assert.equal(canSupervise(leader, person('u')), false);
  assert.equal(canManageTeam(leader, 't1', 'b1'), true);
  assert.equal(canManageTeam(leader, 't2', 'b1'), false);
  assert.equal(canManageTeam(leader, null, 'b1'), false, 'creating a team needs Deputy or above');
  const deputy = person('deputy', [{ level: 'DEPUTY_STORE_MANAGER', scope: b1 }]);
  assert.equal(canManageTeam(deputy, null, 'b1'), true);
  assert.equal(canManageTeam(deputy, 't9', 'b2'), false);
});

test('one Team Leader may lead several teams', () => {
  const leader = person('leader', [
    { level: 'TEAM_LEADER', scope: b1, teamId: 't1' },
    { level: 'TEAM_LEADER', scope: b1, teamId: 't2' },
  ]);
  assert.equal(canManageTeam(leader, 't1', 'b1'), true);
  assert.equal(canManageTeam(leader, 't2', 'b1'), true);
  assert.equal(canSupervise(leader, person('m', [], [{ teamId: 't2', branchId: 'b1' }])), true);
});

test('Owner is outside the hierarchy: never supervised, always able to appoint', () => {
  const ceo = person('ceo', [{ level: 'CEO', scope: { kind: 'GLOBAL' } }]);
  assert.equal(canSupervise(ceo, owner), false);
  assert.equal(canSupervise(owner, ceo), true);
  assert.equal(canAppoint(owner, 'CEO', { kind: 'GLOBAL' }), true);
});

test('appointment requires a valid scope for the level and a strictly higher appointment', () => {
  const store = person('store', [{ level: 'STORE_MANAGER', scope: b1 }]);
  assert.equal(canAppoint(store, 'DEPUTY_STORE_MANAGER', b1), true);
  assert.equal(canAppoint(store, 'STORE_MANAGER', b1), false);
  assert.equal(
    canAppoint(store, 'DEPUTY_STORE_MANAGER', { kind: 'BRANCH', branchId: 'b2' }),
    false,
  );
  assert.equal(canAppoint(store, 'AREA_MANAGER', { kind: 'AREA', areaId: 'a1' }), false);
  assert.equal(canAppoint(store, 'TEAM_LEADER', b1), false, 'Team Leader needs a team');
  assert.equal(canAppoint(store, 'TEAM_LEADER', b1, 't1'), true);
  assert.equal(
    canAppoint(owner, 'DEPUTY_STORE_MANAGER', { kind: 'GLOBAL' }),
    false,
    'scope mismatch',
  );
  assert.equal(
    canAppoint(owner, 'DEPUTY_STORE_MANAGER', b1, 't1'),
    false,
    'only Team Leader has a team',
  );
});

test('attendance exemption is derived from appointment rank, not names', () => {
  const scopeFor = (level: OrganizationLevel): Scope =>
    level === 'CEO'
      ? { kind: 'GLOBAL' }
      : level === 'REGIONAL_MANAGER'
        ? { kind: 'REGION', regionId: 'r1' }
        : level === 'AREA_MANAGER'
          ? { kind: 'AREA', areaId: 'a1' }
          : b1;
  for (const level of ['CEO', 'REGIONAL_MANAGER', 'AREA_MANAGER', 'STORE_MANAGER'] as const) {
    assert.equal(attendanceExempt(person('p', [{ level, scope: scopeFor(level) }])), true, level);
  }
  assert.equal(
    attendanceExempt(person('p', [{ level: 'DEPUTY_STORE_MANAGER', scope: b1 }])),
    false,
  );
  assert.equal(
    attendanceExempt(person('p', [{ level: 'TEAM_LEADER', scope: b1, teamId: 't' }])),
    false,
  );
  assert.equal(attendanceExempt(person('plain')), false);
  assert.equal(attendanceExempt(owner), true);
  assert.equal(attendanceExempt({ ...person('customer'), kind: 'CUSTOMER' }), false);
});

test('supervisor SQL filter fails closed for non-employees and excludes self', () => {
  assert.deepEqual(supervisorWhere({ ...person('c'), kind: 'CUSTOMER' }), { id: { in: [] } });
  assert.deepEqual(supervisorWhere(owner), { kind: 'EMPLOYEE' });
  assert.deepEqual(supervisorWhere(person('nobody')), {
    kind: 'EMPLOYEE',
    id: { not: 'nobody' },
    OR: [{ id: { in: [] } }],
  });
  const store = supervisorWhere(person('store', [{ level: 'STORE_MANAGER', scope: b1 }]));
  assert.notDeepEqual(store.OR, [{ id: { in: [] } }]);
});

test('administering a structure inside a container is not the same as appointing that level', () => {
  const region: Scope = { kind: 'REGION', regionId: 'r1' };
  const area: Scope = { kind: 'AREA', areaId: 'a1' };
  // The production defect: canAppoint rejects even the Owner when the container scope kind
  // differs from the appointed level's scope kind (an Area is created inside a REGION).
  assert.equal(canAppoint(owner, 'AREA_MANAGER', region), false);
  assert.equal(canAdministerBelow(owner, 'AREA_MANAGER', region), true, 'Owner creates an Area');
  assert.equal(canAdministerBelow(owner, 'STORE_MANAGER', area), true, 'Owner places a Branch');
  assert.equal(canAdministerBelow(owner, 'REGIONAL_MANAGER', { kind: 'GLOBAL' }), true);
  assert.equal(canAdministerBelow(owner, 'TEAM_LEADER', b1), true, 'Owner creates a Team');
  const regional = person('regional', [{ level: 'REGIONAL_MANAGER', scope: region }]);
  assert.equal(canAdministerBelow(regional, 'AREA_MANAGER', region), true);
  assert.equal(
    canAdministerBelow(regional, 'AREA_MANAGER', { kind: 'REGION', regionId: 'r2' }),
    false,
  );
  assert.equal(canAdministerBelow(regional, 'REGIONAL_MANAGER', region), false, 'peer level');
  assert.equal(canAdministerBelow(regional, 'REGIONAL_MANAGER', { kind: 'GLOBAL' }), false);
  const deputy = person('deputy', [{ level: 'DEPUTY_STORE_MANAGER', scope: b1 }]);
  assert.equal(canAdministerBelow(deputy, 'TEAM_LEADER', b1), true);
  assert.equal(canAdministerBelow(deputy, 'AREA_MANAGER', region), false);
  assert.equal(canAdministerBelow(person('nobody'), 'TEAM_LEADER', b1), false);
  const ceo = person('ceo', [{ level: 'CEO', scope: { kind: 'GLOBAL' } }]);
  assert.equal(canAdministerBelow(ceo, 'REGIONAL_MANAGER', { kind: 'GLOBAL' }), true);
  assert.equal(canAdministerBelow({ ...person('c'), kind: 'CUSTOMER' }, 'TEAM_LEADER', b1), false);
});

test('supervisionRank reports the level at which an actor covers the whole target', () => {
  const region: Scope = { kind: 'REGION', regionId: 'r1' };
  const tl = person('tl', [{ level: 'TEAM_LEADER', scope: b1, teamId: 't1' }]);
  const deputy = person('deputy', [{ level: 'DEPUTY_STORE_MANAGER', scope: b1 }]);
  const store = person('store', [{ level: 'STORE_MANAGER', scope: b1 }]);
  const regional = person('regional', [{ level: 'REGIONAL_MANAGER', scope: region }]);
  const ceo = person('ceo', [{ level: 'CEO', scope: { kind: 'GLOBAL' } }]);
  const member = person('member', [], [{ teamId: 't1', branchId: 'b1' }]);
  const stranger = person('stranger');
  assert.equal(supervisionRank(tl, member), 1);
  assert.equal(supervisionRank(tl, stranger), null, 'a Team Leader only reaches their own team');
  assert.equal(supervisionRank(deputy, stranger), 2);
  assert.equal(supervisionRank(store, stranger), 3);
  assert.equal(supervisionRank(regional, stranger), 5);
  assert.equal(supervisionRank(ceo, stranger), 6);
  assert.equal(supervisionRank(owner, stranger), OWNER_SUPERVISION_RANK);
  assert.ok(OWNER_SUPERVISION_RANK > 6);
  // A multi-branch target needs every branch covered; the rank is the lowest per-branch rank.
  const twoBranches = person('two', [], [], ['b1', 'b2']);
  assert.equal(supervisionRank(store, twoBranches), null);
  assert.equal(supervisionRank(regional, person('two', [], [], ['b1'])), 5);
  const both = person('both', [
    { level: 'STORE_MANAGER', scope: b1 },
    { level: 'DEPUTY_STORE_MANAGER', scope: { kind: 'BRANCH', branchId: 'b2' } },
  ]);
  assert.equal(supervisionRank(both, twoBranches), 2, 'lowest of the per-branch levels');
  // Peers, superiors, self, non-employees: no rank.
  assert.equal(supervisionRank(deputy, deputy), null);
  assert.equal(supervisionRank(deputy, store), null);
  assert.equal(supervisionRank(deputy, owner), null);
  assert.equal(supervisionRank({ ...person('c'), kind: 'CUSTOMER' }, stranger), null);
  // canSupervise is exactly "has a rank".
  for (const actor of [tl, deputy, store, regional, ceo, owner, stranger, both]) {
    for (const target of [member, stranger, twoBranches, store, owner]) {
      assert.equal(canSupervise(actor, target), supervisionRank(actor, target) !== null);
    }
  }
});
