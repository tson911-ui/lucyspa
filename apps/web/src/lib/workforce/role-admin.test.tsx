import type { RoleListResponse, RoleResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RolesAdminView } from '../../components/workforce/screens/roles';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, json, owner, render, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  activationRequest,
  canBundle,
  canEditRoles,
  canViewRoles,
  createRequest,
  groupedCatalog,
  namesRequest,
  permissionsRequest,
  roleAdminCommands,
  roleAdminErrorMessage,
  roleCodePreview,
} from './role-admin';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const ROLE_ID = '0c2d5b1e-7777-4a44-9d11-00000000abcd';
// The catalog as the API returns it (the source of truth), including a code without a label.
const permissionCatalog: RoleListResponse['permissionCatalog'] = [
  { code: 'VIEW_EMPLOYEES', scopeCapability: 'BRANCH_CAPABLE' },
  { code: 'MANAGE_EMPLOYEE_PAY', scopeCapability: 'BRANCH_CAPABLE' },
  { code: 'VIEW_ATTENDANCE', scopeCapability: 'BRANCH_CAPABLE' },
  { code: 'APPROVE_LEAVE', scopeCapability: 'BRANCH_CAPABLE' },
  { code: 'MANAGE_SERVICE_PRICES', scopeCapability: 'GLOBAL_ONLY' },
  { code: 'MANAGE_PERMISSIONS', scopeCapability: 'BRANCH_CAPABLE' },
  { code: 'FUTURE_PERMISSION' as 'VIEW_EMPLOYEES', scopeCapability: 'BRANCH_CAPABLE' },
];
const role: RoleResponse = {
  id: ROLE_ID,
  code: 'TECHNICIAN',
  displayNameVi: 'Kỹ thuật viên',
  displayNameEn: 'Technician',
  isActive: true,
  permissions: ['APPROVE_LEAVE', 'VIEW_ATTENDANCE'],
  version: 3,
};
const catalog = (roles: RoleResponse[]): RoleListResponse => ({
  roles,
  permissions: permissionCatalog.map((entry) => entry.code),
  permissionCatalog,
});
const view = (data: RoleListResponse, account = owner, locale: 'vi' | 'en' = 'vi') =>
  render(
    <RolesAdminView catalog={data} loading={false} error={null} reload={() => Promise.resolve()} />,
    account,
    locale,
  );
// A global permission administrator who is not the Owner and holds only some powers.
const admin = employee([
  ['MANAGE_PERMISSIONS'],
  ['VIEW_ATTENDANCE'],
  ['APPROVE_LEAVE'],
  ['VIEW_EMPLOYEES'],
]);

test('1. an empty catalog explains how to start', () => {
  const markup = view(catalog([]));
  assert.ok(markup.includes('Chưa có vai trò. Tạo vai trò đầu tiên để gán cho nhân sự.'));
  assert.ok(view(catalog([]), owner, 'en').includes(en.roleAdmin.empty));
  assert.ok(markup.includes(vi.roleAdmin.create));
});

test('2–4, 15. roles, permission labels and scope capability come from the loaded catalog', () => {
  const markup = view(catalog([role, { ...role, id: 'other', code: 'OLD', isActive: false }]));
  assert.ok(markup.includes('Kỹ thuật viên') && markup.includes('(TECHNICIAN)'));
  assert.ok(markup.includes(vi.roleAdmin.active) && markup.includes(vi.roleAdmin.inactive));
  assert.ok(markup.includes('Duyệt nghỉ phép') && markup.includes('APPROVE_LEAVE'));
  assert.ok(markup.includes(vi.roleAdmin.scope.GLOBAL_ONLY), 'service prices: global only');
  // Branch-capable is the rule, stated once; only the exception is marked per permission.
  assert.ok(markup.includes(vi.roleAdmin.scopeLegend));
  assert.equal(
    (markup.match(new RegExp(`>${vi.roleAdmin.scope.GLOBAL_ONLY}<`, 'g')) ?? []).length,
    3,
    'only MANAGE_SERVICE_PRICES, once per checklist (create + two edit forms)',
  );
  // IDs come from the API: edit inputs are keyed by the loaded role id.
  assert.match(markup, new RegExp(`id="role-${ROLE_ID}-vi"`));
  // Checklist order and grouping follow the API catalog; unknown codes stay visible.
  const groups = groupedCatalog(catalog([]));
  assert.deepEqual(
    groups.map((group) => [group.group, group.entries.map((entry) => entry.code)]),
    [
      ['employees', ['VIEW_EMPLOYEES']],
      ['pay', ['MANAGE_EMPLOYEE_PAY']],
      ['operations', ['VIEW_ATTENDANCE', 'APPROVE_LEAVE']],
      ['catalog', ['MANAGE_SERVICE_PRICES']],
      ['admin', ['MANAGE_PERMISSIONS']],
      ['other', ['FUTURE_PERMISSION']],
    ],
  );
  assert.match(markup, /value="FUTURE_PERMISSION"/);
  // No role, permission list or id is hard-coded in the screen or its logic.
  for (const file of ['../../components/workforce/screens/roles.tsx', './role-admin.ts']) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /['"](KTV|BRANCH_MANAGER|MANAGER|RECEPTIONIST|ACCOUNTING)['"]/);
    assert.doesNotMatch(source, /[0-9a-f]{8}-[0-9a-f]{4}-/);
  }
  assert.ok(view(catalog([role]), owner, 'en').includes('Roles &amp; permissions'));
});

test('5–8. create and edit use the existing role API; the code never changes', async () => {
  assert.deepEqual(
    createRequest({
      code: ' ktv ',
      displayNameVi: ' Kỹ thuật viên ',
      displayNameEn: 'Technician ',
      permissions: ['VIEW_ATTENDANCE', 'APPROVE_LEAVE'],
      reason: ' Vai trò cho KTV ',
    }),
    {
      code: 'KTV',
      displayNameVi: 'Kỹ thuật viên',
      displayNameEn: 'Technician',
      permissions: ['APPROVE_LEAVE', 'VIEW_ATTENDANCE'],
      reason: 'Vai trò cho KTV',
    },
  );
  assert.deepEqual(roleCodePreview('owner'), { code: 'OWNER', valid: false });
  assert.equal(roleCodePreview('1ktv').valid, false);
  assert.equal(roleCodePreview('quan_ly_chi_nhanh').valid, true);
  const renamed = namesRequest(role, { displayNameVi: 'KTV', displayNameEn: 'Technician' }, 'x')!;
  assert.deepEqual(renamed, { expectedVersion: 3, reason: 'x', displayNameVi: 'KTV' });
  assert.ok(!('code' in renamed), 'names only');
  assert.equal(
    namesRequest(
      role,
      { displayNameVi: role.displayNameVi, displayNameEn: role.displayNameEn },
      'x',
    ),
    null,
  );
  assert.deepEqual(permissionsRequest(role, ['VIEW_ATTENDANCE', 'VIEW_EMPLOYEES'], 'y', 4), {
    expectedVersion: 4,
    permissions: ['VIEW_ATTENDANCE', 'VIEW_EMPLOYEES'],
    reason: 'y',
  });
  assert.equal(permissionsRequest(role, ['VIEW_ATTENDANCE', 'APPROVE_LEAVE'], 'y'), null);
  assert.deepEqual(activationRequest(role, 'Không dùng nữa'), {
    expectedVersion: 3,
    isActive: false,
    reason: 'Không dùng nữa',
  });
  const { fetcher, calls } = scriptedFetch([
    context('c', true),
    () => json(201, role),
    () => json(200, { ...role, version: 4 }),
    () => json(200, { ...role, version: 5 }),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await roleAdminCommands.create(
    api,
    createRequest({ ...role, permissions: role.permissions, reason: 'r' }),
  );
  await roleAdminCommands.update(api, ROLE_ID, renamed);
  await roleAdminCommands.setPermissions(
    api,
    ROLE_ID,
    permissionsRequest(role, ['VIEW_EMPLOYEES'], 'r', 4)!,
  );
  assert.deepEqual(
    calls.slice(1).map((call) => call.url),
    ['/api/v1/roles', `/api/v1/roles/${ROLE_ID}`, `/api/v1/roles/${ROLE_ID}/permissions`],
  );
  // The edit form shows the code as text, never as an input.
  const markup = view(catalog([role]));
  assert.ok(markup.includes(vi.roleAdmin.codeReadonly));
  assert.doesNotMatch(markup, /<input[^>]*value="TECHNICIAN"/);
});

test('9–11. containment hints; the API refusal is explained; no Owner role', () => {
  assert.ok(canBundle(owner, 'MANAGE_EMPLOYEE_PAY'));
  assert.ok(canBundle(admin, 'VIEW_ATTENDANCE'));
  assert.equal(canBundle(admin, 'MANAGE_EMPLOYEE_PAY'), false, 'not held');
  const denied = employee(
    [['MANAGE_PERMISSIONS'], ['VIEW_ATTENDANCE']],
    [['VIEW_ATTENDANCE', 'A']],
  );
  assert.equal(canBundle(denied, 'VIEW_ATTENDANCE'), false, 'not unrestricted');
  const markup = view(catalog([role]), admin);
  const tag = (code: string) =>
    markup.match(
      new RegExp(`<input[^>]*name="role-new-permission"[^>]*value="${code}"[^>]*>`),
    )?.[0] ?? '';
  assert.match(tag('MANAGE_EMPLOYEE_PAY'), /disabled=""/);
  assert.doesNotMatch(tag('VIEW_ATTENDANCE'), /disabled/);
  assert.ok(markup.includes(vi.roleAdmin.notHeld));
  // Already in a role: removing it is never blocked, even if the actor lacks it.
  const held = view(catalog([{ ...role, permissions: ['MANAGE_EMPLOYEE_PAY'] }]), admin);
  const editTag =
    held.match(
      new RegExp(
        `<input[^>]*name="role-${ROLE_ID}-permission"[^>]*value="MANAGE_EMPLOYEE_PAY"[^>]*>`,
      ),
    )?.[0] ?? '';
  assert.match(editTag, /checked=""/);
  assert.doesNotMatch(editTag, /disabled/);
  assert.equal(roleAdminErrorMessage(new ApiError(403, 'FORBIDDEN'), vi), vi.roleAdmin.forbidden);
  assert.equal(
    roleAdminErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'code'), vi),
    vi.roleAdmin.invalidCode,
  );
  assert.equal(
    roleAdminErrorMessage(new ApiError(409, 'CONFLICT', 'code'), vi),
    vi.roleAdmin.duplicateCode,
  );
});

test('who may see and change roles', () => {
  const branchAdmin = employee([['MANAGE_PERMISSIONS', 'A']]);
  assert.ok(canViewRoles(branchAdmin));
  assert.equal(canEditRoles(branchAdmin), false);
  assert.ok(canEditRoles(admin) && canEditRoles(owner));
  assert.equal(canViewRoles(employee([['VIEW_EMPLOYEES']])), false);
  const readOnly = view(catalog([role]), branchAdmin);
  assert.ok(readOnly.includes(vi.roleAdmin.readOnlyNote));
  assert.doesNotMatch(readOnly, /id="role-new-code"|<summary>Sửa vai trò<\/summary>/);
});

test('12, 14–17. roles are bundles; assignment decides the scope; nothing is seeded', () => {
  // Employment classification is untouched by roles.
  assert.deepEqual(Object.keys(vi.employees.classifications), [
    'TRAINEE',
    'OFFICIAL_EMPLOYEE',
    'ENDED',
  ]);
  // The page explains that the assignment, not the role, chooses the branch.
  const markup = view(catalog([role]));
  assert.ok(markup.includes(vi.roleAdmin.intro));
  assert.match(vi.roleAdmin.intro, /khi gán cho từng nhân sự: toàn hệ thống hoặc một chi nhánh/);
  assert.match(vi.roleAdmin.intro, /không phải phân loại nhân sự/);
  assert.ok(markup.includes(vi.roleAdmin.scopeHelp));
  // The role payload has no branch or scope field.
  assert.deepEqual(Object.keys(createRequest({ ...role, permissions: [], reason: 'r' })).sort(), [
    'code',
    'displayNameEn',
    'displayNameVi',
    'permissions',
    'reason',
  ]);
  // The create form starts with no permission selected (no default bundle).
  const tags = markup.match(/<input[^>]*name="role-new-permission"[^>]*>/g) ?? [];
  assert.ok(tags.length > 0);
  assert.ok(tags.every((tag) => !/checked/.test(tag)));
});
