import type { BranchSummary, EmployeeResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReauthDialog } from '../../components/workforce/reauth-dialog';
import {
  AccessFields,
  EmployeeCreateForm,
} from '../../components/workforce/screens/employee-create';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, failure, json, owner, render, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  canProvisionAccess,
  createdMessage,
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
      cancelHref="/vi/workforce/employees"
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
      cancelHref="/vi/workforce/employees"
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
  assert.match(markup, /minLength="8"[^>]*type="password"/);
  assert.match(markup, /autoComplete="new-password"/);
  assert.ok(markup.includes(vi.employees.create.fields.confirmPassword));
  assert.ok(markup.includes('Từ 8 ký tự trở lên'));
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
  assert.ok(english.includes('At least 8 characters'));
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
  assert.match(markup, /type="password"/);
  assert.match(markup, /autoComplete="current-password"/);
  assert.ok(markup.includes(vi.reauth.title));
  assert.ok(markup.includes('mật khẩu của chính bạn'));
  assert.ok(!/nhân sự|nhân viên/.test(markup), 'the body does not mention staff');
});

test('success says the member can sign in with the employee code; errors are specific', () => {
  const notice = createdMessage(active, 'TRAINEE', vi);
  assert.ok(notice.includes('có thể đăng nhập ngay bằng mã nhân viên NV0001'));
  const pending = createdMessage({ ...active, status: 'PENDING_SETUP' }, 'TRAINEE', vi);
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

// HIG C60 (one modal at a time): while the password check is open, the confirmation that asked for it is suspended (out of sight,
// reason and pending request kept); the requests and their order stay those of `withReauthentication` (tested above). The kit flow
// itself (suspended confirm, cancel brings it back with the reason, a confirmed check sends the command again) is in
// packages/ui/src/overlays-v2.test.tsx.
test('C60: every confirmation that can ask for the password is suspended while the check is open', () => {
  const read = (file: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../components/workforce/${file}`, import.meta.url)),
      'utf8',
    );
  assert.match(read('reauth-dialog.tsx'), /return \{ confirm, dialog, asking: open \};/);
  const invoice = read('screens/pos-invoice.tsx');
  assert.match(invoice, /const \{ confirm, dialog, asking \} = useReauthentication\(\);/);
  for (const confirm of ['ReverseConfirm', 'CancelConfirm']) {
    const element = new RegExp(`<${confirm}\\b[\\s\\S]*?\\/>`).exec(invoice)?.[0] ?? '';
    assert.match(element, /suspended=\{asking\}/, confirm);
  }
  const dialogs = read('screens/pos-dialogs.tsx');
  assert.equal(
    dialogs.match(/<ConfirmDialog\n\s+suspended=\{suspended\}/g)?.length,
    2,
    'both POS confirms forward it',
  );
  assert.match(read('screens/loyalty-go-live.tsx'), /<ConfirmDialog\n\s+suspended=\{checking\}/);
  assert.match(read('screens/loyalty-combo-usage.tsx'), /<ConfirmDialog\n\s+suspended=\{asking\}/);
});

// The form dialogs and drawers whose save can ask for the password: each one is suspended while the check is open (C60).
test('C60: every form dialog or drawer that can ask for the password is suspended while the check is open', () => {
  const read = (file: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../components/workforce/screens/${file}`, import.meta.url)),
      'utf8',
    );
  const wired: [file: string, expression: string, count: number][] = [
    ['reports-export.tsx', 'asking', 1],
    ['referral-dialogs.tsx', 'asking', 1],
    ['product-refunds.tsx', 'asking', 1],
    ['product-orders.tsx', 'asking', 1],
    ['product-exchanges.tsx', 'asking', 1],
    ['loyalty-adjust-dialog.tsx', 'asking', 1],
    ['employee-lifecycle.tsx', 'asking', 1],
    ['cash-book.tsx', 'command.asking', 3],
    ['advances.tsx', 'command.asking', 2],
    ['payroll-dialogs.tsx', 'command.asking', 3],
    ['online-order-dialogs.tsx', 'asking', 2],
  ];
  for (const [file, expression, count] of wired) {
    const source = read(file);
    const escaped = expression.replace('.', '\\.');
    assert.equal(
      source.match(new RegExp(`suspended=\\{${escaped}\\}`, 'g'))?.length,
      count,
      `${file}: ${count} × suspended={${expression}}`,
    );
  }
  // The shared command hooks hand `asking` to their dialogs.
  assert.match(
    read('cash-book.tsx'),
    /return \{ run, pending, error, requestId: requestId\.current, dialog, asking \};/,
  );
  assert.match(
    read('payroll-command.tsx'),
    /return \{ run, pending, error, requestId, dialog, asking \};/,
  );
  // The online-order command dialog forwards it to whichever surface it draws.
  assert.equal(read('online-order-dialogs.tsx').match(/suspended=\{suspended\}/g)?.length, 2);
  // Every payroll dialog whose command asks for the password is wired (no reauth command left without it).
  for (const file of ['advances.tsx', 'payroll-dialogs.tsx']) {
    const source = read(file);
    const asking = source.match(/usePayrollCommand\(\{ reauth/g)?.length ?? 0;
    assert.equal(source.match(/suspended=\{command\.asking\}/g)?.length, asking, file);
  }
});
