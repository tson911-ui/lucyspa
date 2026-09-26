import type {
  BranchSummary,
  EmployeeAuthorizationResponse,
  EmployeeResponse,
  RoleListResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RolesSection, RolesView } from '../../components/workforce/screens/employee-roles';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, json, owner, render, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  assignRequest,
  canManageRoles,
  grantable,
  revokeRequest,
  roleCommands,
  roleErrorMessage,
  scopeOptions,
} from './employee-roles';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
// Opaque IDs as the API returns them: nothing in the UI knows them in advance.
const ROLE_KTV = '9b0f2d1c-1111-4c3a-8a7e-000000000001';
const ROLE_MANAGER = '9b0f2d1c-2222-4c3a-8a7e-000000000002';
const ROLE_ACCESS = '9b0f2d1c-3333-4c3a-8a7e-000000000003';
const ROLE_OFF = '9b0f2d1c-4444-4c3a-8a7e-000000000004';
const BRANCH_A = '5e1c0000-aaaa-4000-8000-00000000000a';
const BRANCH_B = '5e1c0000-bbbb-4000-8000-00000000000b';
const BRANCH_OFF = '5e1c0000-cccc-4000-8000-00000000000c';
const branch = (id: string, name: string, isActive = true): BranchSummary => ({
  id,
  code: name.toUpperCase(),
  name,
  timezone: 'Asia/Ho_Chi_Minh',
  isActive,
  version: 1,
});
const branches = new Map([
  [BRANCH_A, branch(BRANCH_A, 'Lucy A')],
  [BRANCH_B, branch(BRANCH_B, 'Lucy B')],
  [BRANCH_OFF, branch(BRANCH_OFF, 'Lucy Off', false)],
]);
const member: EmployeeResponse = {
  id: '6f1c7a52-0000-4000-8000-000000000031',
  employeeId: 'NV0031',
  fullName: 'Phạm Thu',
  dateOfBirth: '1997-01-01',
  address: 'Đà Nẵng',
  phone: '+84905333444',
  email: null,
  emailVerified: false,
  locale: 'vi',
  status: 'ACTIVE',
  branchIds: [BRANCH_A, BRANCH_OFF],
  version: 3,
};
const catalog: RoleListResponse = {
  roles: [
    {
      id: ROLE_KTV,
      code: 'KTV',
      displayNameVi: 'Kỹ thuật viên',
      displayNameEn: 'Technician',
      isActive: true,
      isManagerGroup: false,
      permissions: ['VIEW_ATTENDANCE'],
      version: 1,
    },
    {
      id: ROLE_MANAGER,
      code: 'BRANCH_MANAGER',
      displayNameVi: 'Quản lý chi nhánh',
      displayNameEn: 'Branch manager',
      isActive: true,
      isManagerGroup: false,
      permissions: ['VIEW_ATTENDANCE', 'APPROVE_LEAVE'],
      version: 1,
    },
    {
      id: ROLE_ACCESS,
      code: 'ACCESS_ADMIN',
      displayNameVi: 'Quản trị tài khoản',
      displayNameEn: 'Access admin',
      isActive: true,
      isManagerGroup: false,
      permissions: ['MANAGE_EMPLOYEE_ACCESS'],
      version: 1,
    },
    {
      id: ROLE_OFF,
      code: 'OLD_ROLE',
      displayNameVi: 'Vai trò cũ',
      displayNameEn: 'Old role',
      isActive: false,
      isManagerGroup: false,
      permissions: [],
      version: 2,
    },
  ],
  permissions: [],
  permissionCatalog: [],
};
const authorization: EmployeeAuthorizationResponse = {
  userId: member.id,
  version: 7,
  roleAssignments: [
    {
      id: 'as-1',
      roleId: ROLE_KTV,
      roleCode: 'KTV',
      scope: { kind: 'BRANCH', branchId: BRANCH_A },
    },
    { id: 'as-2', roleId: ROLE_MANAGER, roleCode: 'BRANCH_MANAGER', scope: { kind: 'GLOBAL' } },
    {
      id: 'as-3',
      roleId: ROLE_OFF,
      roleCode: 'OLD_ROLE',
      scope: { kind: 'BRANCH', branchId: BRANCH_A },
    },
  ],
  overrides: [],
};
// A branch-A people administrator (MANAGE_PERMISSIONS in A, plus what it may delegate).
const hrA = employee([
  ['MANAGE_PERMISSIONS', BRANCH_A],
  ['VIEW_ATTENDANCE', BRANCH_A],
  ['APPROVE_LEAVE', BRANCH_A],
]);
const view = (
  account = owner,
  extra: Partial<Parameters<typeof RolesView>[0]> = {},
  locale: 'vi' | 'en' = 'vi',
) =>
  render(
    <RolesView
      employee={member}
      ended={false}
      branches={branches}
      authorization={authorization}
      catalog={catalog}
      loading={false}
      error={null}
      reload={() => Promise.resolve()}
      {...extra}
    />,
    account,
    locale,
  );
const optionsOf = (markup: string, select: string) =>
  [
    ...(markup.match(new RegExp(`<select id="${select}"[\\s\\S]*?</select>`))?.[0] ?? '').matchAll(
      /<option([^>]*)>([^<]*)<\/option>/g,
    ),
  ].map(([, attributes, label]) => ({
    value: /value="([^"]*)"/.exec(attributes ?? '')?.[1] ?? '',
    disabled: /disabled=""/.test(attributes ?? ''),
    label: label ?? '',
  }));

test('1–3. assignments show role name, code and a distinct GLOBAL or branch scope', () => {
  const markup = view();
  assert.ok(markup.includes('<strong>Kỹ thuật viên</strong>'));
  assert.ok(markup.includes('<strong>Quản lý chi nhánh</strong>'));
  assert.match(markup, /wf-badge-info">Chi nhánh: Lucy A</);
  assert.match(markup, /wf-badge-warning">Toàn hệ thống</);
  assert.ok(markup.includes(vi.roles.inactiveRole), 'switched-off role shown as such');
  assert.ok(markup.includes(vi.roles.intro));
  assert.ok(markup.includes(vi.roles.history));
  const english = view(owner, {}, 'en');
  for (const text of [
    'Roles',
    'Technician',
    'Branch: Lucy A',
    'All branches (global)',
    'Assign role',
  ]) {
    assert.ok(english.includes(text), text);
  }
});

test('4–7. assign and remove use the existing API with loaded IDs', async () => {
  const { fetcher, calls } = scriptedFetch([
    context('c', true),
    () => json(200, authorization),
    () => json(200, authorization),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await roleCommands.assign(
    api,
    member.id,
    assignRequest(7, ROLE_KTV, { kind: 'BRANCH', branchId: BRANCH_A }, ' KTV ở A '),
  );
  await roleCommands.revoke(api, member.id, revokeRequest(7, 'as-1', ' Chuyển bộ phận '));
  assert.deepEqual(
    calls.slice(1).map((call) => [call.url, call.body]),
    [
      [
        `/api/v1/employees/${member.id}/roles`,
        {
          expectedVersion: 7,
          roleId: ROLE_KTV,
          scope: { kind: 'BRANCH', branchId: BRANCH_A },
          reason: 'KTV ở A',
        },
      ],
      [
        `/api/v1/employees/${member.id}/roles/revoke`,
        { expectedVersion: 7, assignmentId: 'as-1', reason: 'Chuyển bộ phận' },
      ],
    ],
  );
  // Role and scope options come from the loaded catalog and branches.
  const markup = view();
  assert.deepEqual(
    optionsOf(markup, 'role-id').map((option) => option.value),
    ['', ROLE_KTV, ROLE_MANAGER, ROLE_ACCESS],
    'active roles only, by loaded id',
  );
  assert.deepEqual(
    optionsOf(markup, 'role-scope').map((option) => option.value),
    ['', 'GLOBAL', `BRANCH:${BRANCH_A}`],
  );
  // No role name, code or id is hard-coded in the role UI or logic.
  for (const file of [
    '../../components/workforce/screens/employee-roles.tsx',
    './employee-roles.ts',
  ]) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /['"](KTV|MANAGER|BRANCH_MANAGER|RECEPTIONIST|ACCOUNTING)['"]/);
    assert.doesNotMatch(source, /[0-9a-f]{8}-[0-9a-f]{4}-/);
  }
});

test('8–9. employment classification stays TRAINEE / COLLABORATOR / OFFICIAL_EMPLOYEE / ENDED', () => {
  for (const dictionary of [vi, en]) {
    assert.deepEqual(Object.keys(dictionary.employees.classifications), [
      'TRAINEE',
      'COLLABORATOR',
      'OFFICIAL_EMPLOYEE',
      'ENDED',
    ]);
  }
});

test('Step 2. manager-group roles are offered only to an official employee', () => {
  const managerCatalog: RoleListResponse = {
    ...catalog,
    roles: catalog.roles.map((role) =>
      role.id === ROLE_MANAGER ? { ...role, isManagerGroup: true } : role,
    ),
  };
  const managerOption = (markup: string) =>
    optionsOf(markup, 'role-id').find((option) => option.value === ROLE_MANAGER);
  const official = view(owner, { catalog: managerCatalog });
  assert.ok(!managerOption(official)?.label.includes(vi.roles.managerOfficialOnly));
  const notOfficial = view(owner, { catalog: managerCatalog, official: false });
  assert.ok(managerOption(notOfficial)?.label.includes(vi.roles.managerOfficialOnly));
  assert.match(notOfficial, new RegExp(`value="${ROLE_MANAGER}" disabled`));
  // Ordinary roles stay available to trainees and collaborators.
  const ordinary = optionsOf(notOfficial, 'role-id').find((option) => option.value === ROLE_KTV);
  assert.ok(!ordinary?.label.includes(vi.roles.managerOfficialOnly));
  assert.equal(
    roleErrorMessage(new ApiError(409, 'CONFLICT', 'employmentClassification'), vi),
    vi.roles.managerNeedsOfficial,
  );
});

test('14–17. containment, self, Owner and scope hints (the API decides)', () => {
  // 17. Branch-scoped administrator: no GLOBAL, only the member's active branches it manages.
  assert.deepEqual(scopeOptions(hrA, member, branches), [{ kind: 'BRANCH', branchId: BRANCH_A }]);
  assert.deepEqual(scopeOptions(owner, member, branches), [
    { kind: 'GLOBAL' },
    { kind: 'BRANCH', branchId: BRANCH_A },
  ]);
  // 14. Roles carrying permissions the actor lacks are shown but not selectable.
  const [ktv, manager, access] = catalog.roles;
  const at = { kind: 'BRANCH', branchId: BRANCH_A } as const;
  assert.ok(grantable(hrA, ktv!, at));
  assert.ok(grantable(hrA, manager!, at));
  assert.equal(grantable(hrA, access!, at), false);
  assert.equal(grantable(hrA, ktv!, { kind: 'BRANCH', branchId: BRANCH_B }), false);
  assert.ok(grantable(owner, access!, { kind: 'GLOBAL' }));
  assert.equal(
    roleErrorMessage(new ApiError(403, 'FORBIDDEN'), vi),
    vi.roles.forbidden,
    'the API refusal is explained',
  );
  // Only visible with MANAGE_PERMISSIONS over every branch of the member.
  assert.equal(canManageRoles(hrA, member), false, 'member is also in another branch');
  assert.ok(canManageRoles(hrA, { ...member, branchIds: [BRANCH_A] }));
  assert.equal(
    render(
      <RolesSection employee={member} ended={false} official branches={branches} />,
      employee([['VIEW_EMPLOYEES']]),
    ),
    '',
  );
  // 15. Oneself: assignments visible, no assign form and no remove buttons.
  const self = view(employee([['MANAGE_PERMISSIONS']], [], member.id));
  assert.ok(self.includes(vi.roles.selfNote));
  assert.doesNotMatch(self, /id="role-id"/);
  assert.ok(!self.includes(`>${vi.roles.revoke}<`));
  // A branch administrator cannot remove a GLOBAL assignment.
  const branchOnly = view(employee([['MANAGE_PERMISSIONS', BRANCH_A]]), {
    employee: { ...member, branchIds: [BRANCH_A] },
  });
  assert.equal((branchOnly.match(new RegExp(`>${vi.roles.revoke}<`, 'g')) ?? []).length, 2);
});

test('18–19. ended employment: no new roles; existing ones stay and can be removed', () => {
  const markup = view(owner, { ended: true });
  assert.ok(markup.includes(vi.roles.endedNoNewRoles));
  assert.doesNotMatch(markup, /id="role-id"|id="role-scope"/);
  assert.ok(markup.includes('<strong>Kỹ thuật viên</strong>'), 'not silently removed');
  assert.ok(markup.includes(`>${vi.roles.revoke}<`), 'removal still possible');
  assert.equal(
    roleErrorMessage(new ApiError(409, 'CONFLICT', 'employment'), vi),
    vi.roles.endedNoNewRoles,
  );
});

test('an empty role catalog is reported honestly, without invented roles', () => {
  const markup = view(owner, {
    catalog: { roles: [], permissions: [], permissionCatalog: [] },
    authorization: { ...authorization, roleAssignments: [] },
  });
  assert.ok(markup.includes(vi.roles.emptyCatalog));
  assert.ok(markup.includes(vi.roles.none));
  assert.doesNotMatch(markup, /id="role-id"/);
});
