import type { BranchSummary, EmployeeResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReauthDialog } from '../../components/workforce/reauth-dialog';
import {
  AccessFields,
  EmployeeCreateForm,
} from '../../components/workforce/screens/employee-create';
import { CreatedNotice } from '../../components/workforce/screens/employees';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, failure, json, owner, render, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  canProvisionAccess,
  createEmployee,
  createErrorMessage,
  createProblems,
  emptyCreateForm,
  loginIdPreview,
  passwordLength,
  toCreateRequest,
  type CreateForm,
} from './employee-create';
import {
  reauthenticate,
  reauthErrorMessage,
  ReauthenticationCancelled,
  withReauthentication,
} from './reauth';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const TODAY = '2026-09-26';
const PASSWORD = 'hoa sen xanh buổi sáng 2026';
const ACTOR_PASSWORD = 'mật khẩu của chủ spa 2026';
const branches = new Map<string, BranchSummary>([
  [
    'A',
    {
      id: 'A',
      code: 'BR-A',
      name: 'Chi nhánh A',
      timezone: 'Asia/Ho_Chi_Minh',
      isActive: true,
      version: 1,
    },
  ],
]);
const form = (extra: Partial<CreateForm> = {}): CreateForm => ({
  ...emptyCreateForm('vi', ['A']),
  employeeId: ' nv0001 ',
  fullName: 'Trần Thị Mai',
  dateOfBirth: '1999-03-02',
  address: '5 Hùng Vương',
  phone: '0905 111 222',
  classification: 'TRAINEE',
  employmentStartDate: '2026-10-01',
  ...extra,
});
const active: EmployeeResponse = {
  id: '6f1c7a52-0000-4000-8000-000000000009',
  employeeId: 'NV0001',
  fullName: 'Trần Thị Mai',
  dateOfBirth: '1999-03-02',
  address: '5 Hùng Vương',
  phone: '+84905111222',
  email: null,
  emailVerified: false,
  locale: 'vi',
  status: 'ACTIVE',
  branchIds: ['A'],
  version: 1,
};
const accessAdmin = employee([
  ['CREATE_EMPLOYEES', 'A'],
  ['MANAGE_EMPLOYEE_ACCESS', 'A'],
]);
const creatorOnly = employee([['CREATE_EMPLOYEES', 'A']]);

test('the employee code is the login ID; access is offered with MANAGE_EMPLOYEE_ACCESS', () => {
  assert.equal(loginIdPreview(' nv0001 '), 'NV0001');
  assert.equal(loginIdPreview(''), '');
  assert.ok(canProvisionAccess(owner, ['A']));
  assert.ok(canProvisionAccess(accessAdmin, ['A']));
  assert.equal(canProvisionAccess(accessAdmin, ['A', 'B']), false, 'every selected branch');
  assert.equal(canProvisionAccess(creatorOnly, ['A']), false);
  const offered = render(
    <EmployeeCreateForm
      branches={branches}
      onCreated={() => undefined}
      onCancel={() => undefined}
    />,
    accessAdmin,
  );
  assert.ok(offered.includes(vi.employees.create.provisionAccess));
  assert.match(offered, /name="new-provision-access"/);
  assert.doesNotMatch(offered, /name="new-provision-access"[^>]*checked/, 'opt-in');
  assert.doesNotMatch(offered, /type="password"/);
  assert.doesNotMatch(offered, /username|tên đăng nhập/i, 'no second identifier');
  const notOffered = render(
    <EmployeeCreateForm
      branches={branches}
      onCreated={() => undefined}
      onCancel={() => undefined}
    />,
    creatorOnly,
  );
  assert.doesNotMatch(notOffered, /new-provision-access/);
  assert.ok(notOffered.includes(vi.employees.create.accountNote), 'PENDING_SETUP explained');
});

test('the account section shows the employee code as login ID and the password policy', () => {
  const markup = renderToStaticMarkup(
    <AccessFields
      form={form({ provisionAccess: true })}
      set={() => undefined}
      accessAllowed
      invalid={() => undefined}
      t={vi}
    />,
  );
  assert.match(markup, /<output id="new-login-id"[^>]*>NV0001<\/output>/);
  assert.match(markup, /id="new-password" type="password"[^>]*minLength="15"/);
  assert.match(markup, /autoComplete="new-password"/);
  assert.ok(markup.includes(vi.employees.create.fields.confirmPassword));
  assert.ok(markup.includes('Ít nhất 15 ký tự'));
  const english = renderToStaticMarkup(
    <AccessFields
      form={form({ provisionAccess: true, employeeId: '' })}
      set={() => undefined}
      accessAllowed={false}
      invalid={() => undefined}
      t={en}
    />,
  );
  assert.ok(english.includes('Set up login access now'));
  assert.ok(english.includes(en.employees.create.loginIdPending));
  assert.ok(english.includes(en.employees.create.accessNotAllowed));
  assert.ok(english.includes('At least 15 characters'));
});

test('password checks mirror the policy length; the request carries it only when chosen', () => {
  assert.deepEqual(createProblems(form(), 'allowed', TODAY, false), [], 'not provisioning');
  const provisioning = form({
    provisionAccess: true,
    initialPassword: PASSWORD,
    confirmPassword: PASSWORD,
  });
  assert.deepEqual(createProblems(provisioning, 'allowed', TODAY, true), []);
  assert.deepEqual(createProblems(provisioning, 'allowed', TODAY, false), ['access']);
  assert.deepEqual(
    createProblems(
      { ...provisioning, initialPassword: 'short', confirmPassword: 'short' },
      'allowed',
      TODAY,
    ),
    ['initialPassword'],
  );
  assert.deepEqual(
    createProblems({ ...provisioning, confirmPassword: `${PASSWORD}!` }, 'allowed', TODAY),
    ['confirmPassword'],
  );
  assert.equal(passwordLength('é'.repeat(15)), 15, 'NFC code points');
  assert.equal(toCreateRequest(form(), TODAY).initialPassword, undefined);
  // Sent exactly as typed (no trimming): the API normalizes and validates it.
  const request = toCreateRequest({ ...provisioning, initialPassword: ` ${PASSWORD} ` }, TODAY);
  assert.equal(request.initialPassword, ` ${PASSWORD} `);
  assert.equal(request.classification, 'TRAINEE', 'a trainee may have login access');
  assert.equal(
    toCreateRequest({ ...provisioning, classification: 'OFFICIAL_EMPLOYEE' }, TODAY).classification,
    'OFFICIAL_EMPLOYEE',
  );
  assert.ok(!('username' in request) && !('loginId' in request));
});

test('reauthentication: prompt on REAUTHENTICATION_REQUIRED, confirm, then one retry', async () => {
  const { fetcher, calls } = scriptedFetch([
    context('csrf-1', true),
    failure(403, 'REAUTHENTICATION_REQUIRED', 'Reauthentication required'),
    () => new Response(null, { status: 204 }),
    context('csrf-2', true),
    () => json(201, active),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  const request = toCreateRequest(
    form({ provisionAccess: true, initialPassword: PASSWORD, confirmPassword: PASSWORD }),
    TODAY,
  );
  let prompts = 0;
  const created = await withReauthentication(
    () => createEmployee(api, request),
    async () => {
      prompts += 1;
      await reauthenticate(api, ACTOR_PASSWORD);
      return true;
    },
  );
  assert.equal(prompts, 1);
  assert.equal(created.status, 'ACTIVE');
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      'GET /api/v1/auth/context',
      'POST /api/v1/employees',
      'POST /api/v1/auth/reauthenticate',
      'GET /api/v1/auth/context',
      'POST /api/v1/employees',
    ],
  );
  assert.deepEqual(calls[2]?.body, { password: ACTOR_PASSWORD }, "the actor's own password");
  assert.equal(calls[4]?.headers['X-CSRF-Token'], 'csrf-2', 'fresh CSRF after rotation');
  assert.equal((calls[4]?.body as { initialPassword: string }).initialPassword, PASSWORD);
  assert.equal(JSON.stringify(calls[4]?.body).includes(ACTOR_PASSWORD), false);
});

test('reauthentication: cancel sends nothing more; other errors never prompt', async () => {
  const cancelled = scriptedFetch([
    context('c', true),
    failure(403, 'REAUTHENTICATION_REQUIRED', 'Reauthentication required'),
  ]);
  const api = new WorkforceApi({ fetch: cancelled.fetcher });
  const request = toCreateRequest(form(), TODAY);
  const error = await withReauthentication(
    () => createEmployee(api, request),
    () => Promise.resolve(false),
  ).catch((failed: unknown) => failed);
  assert.ok(error instanceof ReauthenticationCancelled);
  assert.equal(cancelled.calls.length, 2);
  assert.equal(createErrorMessage(error, vi), vi.reauth.cancelled);
  let prompted = false;
  const other = scriptedFetch([context('c'), failure(403, 'FORBIDDEN', 'Forbidden')]);
  await assert.rejects(
    withReauthentication(
      () => createEmployee(new WorkforceApi({ fetch: other.fetcher }), request),
      () => {
        prompted = true;
        return Promise.resolve(true);
      },
    ),
    (failed: unknown) => failed instanceof ApiError && failed.code === 'FORBIDDEN',
  );
  assert.equal(prompted, false);
  // A wrong actor password is explained in the dialog.
  assert.equal(
    reauthErrorMessage(new ApiError(401, 'AUTHENTICATION_FAILED'), vi),
    vi.reauth.wrongPassword,
  );
});

test("the dialog asks for the actor's own password and never renders it", () => {
  const markup = renderToStaticMarkup(
    <ReauthDialog
      t={vi}
      api={new WorkforceApi({ fetch: () => new Promise<Response>(() => undefined) })}
      onConfirmed={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /id="reauth-password" type="password" autoComplete="current-password"/);
  assert.ok(markup.includes(vi.reauth.title));
  assert.ok(markup.includes('mật khẩu của chính bạn'));
  assert.ok(markup.includes('không phải mật khẩu của nhân viên'));
});

test('success says the member can sign in with the employee code; errors are specific', () => {
  const notice = render(<CreatedNotice employee={active} classification="TRAINEE" />, owner);
  assert.ok(notice.includes('có thể đăng nhập ngay bằng mã nhân viên NV0001'));
  const pending = render(
    <CreatedNotice employee={{ ...active, status: 'PENDING_SETUP' }} classification="TRAINEE" />,
    owner,
  );
  assert.ok(pending.includes('chưa thể đăng nhập'));
  assert.equal(
    createErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'initialPassword'), vi),
    vi.employees.create.passwordRejected,
  );
  assert.equal(
    createErrorMessage(new ApiError(403, 'REAUTHENTICATION_REQUIRED'), vi),
    vi.errors.reauthenticate,
  );
});
