import type { BranchSummary, EmployeeResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EmployeeCreateForm } from '../../components/workforce/screens/employee-create';
import { CreatedNotice, EmployeesScreen } from '../../components/workforce/screens/employees';
import { getWorkforceDictionary } from '../../i18n/workforce';
import {
  context,
  customer,
  employee,
  failure,
  json,
  owner,
  render,
  scriptedFetch,
} from '../../test/support';
import { WorkforceApi } from './api';
import {
  businessToday,
  canOfferCreate,
  createEmployee,
  createErrorMessage,
  createProblems,
  creatableBranches,
  directoryClassification,
  emptyCreateForm,
  INITIAL_CLASSIFICATIONS,
  needsStartReason,
  officialAvailability,
  oneAtATime,
  toCreateRequest,
  type CreateForm,
} from './employee-create';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const branch = (id: string, name: string, extra: Partial<BranchSummary> = {}): BranchSummary => ({
  id,
  code: `BR-${id}`,
  name,
  timezone: 'Asia/Ho_Chi_Minh',
  isActive: true,
  version: 1,
  ...extra,
});
const branches = new Map([
  ['A', branch('A', 'Chi nhánh A')],
  ['B', branch('B', 'Chi nhánh B')],
  ['C', branch('C', 'Chi nhánh C', { isActive: false })],
]);
const creator = employee([
  ['VIEW_EMPLOYEES', 'A'],
  ['CREATE_EMPLOYEES', 'A'],
]);
const payroll = employee([
  ['VIEW_EMPLOYEES', 'A'],
  ['CREATE_EMPLOYEES', 'A'],
  ['CREATE_EMPLOYEES', 'B'],
  ['MANAGE_EMPLOYEE_PAY', 'A'],
]);
const filled = (extra: Partial<CreateForm> = {}): CreateForm => ({
  ...emptyCreateForm('vi'),
  employeeId: ' KTV-07 ',
  fullName: ' Nguyễn Thị Hoa ',
  dateOfBirth: '1998-05-20',
  address: '12 Lê Lợi',
  phone: '0905 123 456',
  classification: 'OFFICIAL_EMPLOYEE',
  employmentStartDate: '2026-10-01',
  branchIds: ['A'],
  ...extra,
});
const createdEmployee: EmployeeResponse = {
  id: '6f1c7a52-0000-4000-8000-000000000001',
  employeeId: 'KTV-07',
  fullName: 'Nguyễn Thị Hoa',
  dateOfBirth: '1998-05-20',
  address: '12 Lê Lợi',
  phone: '+84905123456',
  email: null,
  emailVerified: false,
  locale: 'vi',
  status: 'PENDING_SETUP',
  branchIds: ['A'],
  version: 1,
};
const TODAY = '2026-09-26';
/** The `<input>` tag with the given name and value, whatever the attribute order. */
const inputTag = (markup: string, name: string, value: string) =>
  markup.match(new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"[^>]*>`))?.[0] ?? '';

test('1–2. the add action is offered only with CREATE_EMPLOYEES', () => {
  for (const account of [creator, payroll, owner]) {
    assert.ok(canOfferCreate(account));
    assert.match(render(<EmployeesScreen />, account), new RegExp(`>${vi.employees.add}<`));
  }
  assert.match(render(<EmployeesScreen />, owner, 'en'), />Add employee</);
  const viewer = employee([['VIEW_EMPLOYEES', 'A']]);
  assert.equal(canOfferCreate(viewer), false);
  assert.doesNotMatch(render(<EmployeesScreen />, viewer), new RegExp(vi.employees.add));
  assert.equal(canOfferCreate(customer), false);
  // A deny at the only granted branch removes the action as well.
  const denied = employee([['CREATE_EMPLOYEES', 'A']], [['CREATE_EMPLOYEES', 'A']]);
  assert.equal(canOfferCreate(denied), false);
  // Branch choices: active branches with CREATE_EMPLOYEES only.
  assert.deepEqual(
    creatableBranches(creator, branches.values()).map((entry) => entry.id),
    ['A'],
  );
  assert.deepEqual(
    creatableBranches(owner, branches.values()).map((entry) => entry.id),
    ['A', 'B'],
  );
});

test('3–6. explicit TRAINEE or OFFICIAL_EMPLOYEE choice; no default, no ENDED', () => {
  assert.deepEqual(INITIAL_CLASSIFICATIONS, ['TRAINEE', 'OFFICIAL_EMPLOYEE']);
  assert.equal(emptyCreateForm('vi').classification, '', 'nothing preselected');
  const markup = render(
    <EmployeeCreateForm
      branches={branches}
      onCreated={() => undefined}
      onCancel={() => undefined}
    />,
    owner,
  );
  const trainee = inputTag(markup, 'new-classification', 'TRAINEE');
  const official = inputTag(markup, 'new-classification', 'OFFICIAL_EMPLOYEE');
  assert.match(trainee, /type="radio"/);
  assert.match(official, /type="radio"/);
  assert.doesNotMatch(trainee + official, /checked/, 'nothing preselected');
  assert.doesNotMatch(official, /disabled/);
  assert.doesNotMatch(markup, /ENDED/);
  assert.doesNotMatch(markup, new RegExp(vi.employees.classifications.ENDED));
  assert.ok(markup.includes(vi.employees.classifications.TRAINEE));
  assert.ok(markup.includes(vi.employees.classifications.OFFICIAL_EMPLOYEE));
  assert.ok(markup.includes(vi.employees.create.intro), 'the trainee stage is not required');
  // A missing choice is reported, never defaulted.
  assert.ok(
    createProblems(filled({ classification: '' }), 'allowed', TODAY).includes('classification'),
  );
  assert.throws(() => toCreateRequest(filled({ classification: '' }), TODAY));
  // 5. Official directly: the request carries OFFICIAL_EMPLOYEE, no trainee step.
  assert.equal(toCreateRequest(filled(), TODAY).classification, 'OFFICIAL_EMPLOYEE');
  assert.equal(
    toCreateRequest(filled({ classification: 'TRAINEE' }), TODAY).classification,
    'TRAINEE',
  );
  assert.deepEqual(createProblems(filled(), 'allowed', TODAY), []);
  assert.deepEqual(createProblems(filled({ classification: 'TRAINEE' }), 'noPay', TODAY), []);
});

test('7–8, 13. the request: start date, branches, no salary or account fields', async () => {
  const { fetcher, calls } = scriptedFetch([context('csrf-1'), () => json(201, createdEmployee)]);
  const api = new WorkforceApi({ fetch: fetcher });
  const request = toCreateRequest(filled({ branchIds: ['A', 'B'], email: '  ' }), TODAY);
  const created = await createEmployee(api, request);
  assert.equal(created.id, createdEmployee.id);
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    ['GET /api/v1/auth/context', 'POST /api/v1/employees'],
    'one create request; no setup link, password, role or skill request',
  );
  assert.deepEqual(calls[1]?.body, {
    employeeId: 'KTV-07',
    fullName: 'Nguyễn Thị Hoa',
    dateOfBirth: '1998-05-20',
    address: '12 Lê Lợi',
    phone: '0905 123 456',
    email: null,
    locale: 'vi',
    branchIds: ['A', 'B'],
    classification: 'OFFICIAL_EMPLOYEE',
    employmentStartDate: '2026-10-01',
  });
  const body = calls[1]?.body as Record<string, unknown>;
  for (const absent of ['baseSalaryVnd', 'password', 'roleIds', 'skillIds', 'employmentReason']) {
    assert.ok(!(absent in body), absent);
  }
  // Start date problems and the past-date reason.
  assert.ok(
    createProblems(filled({ employmentStartDate: '' }), 'allowed', TODAY).includes(
      'employmentStartDate',
    ),
  );
  assert.ok(
    createProblems(filled({ employmentStartDate: '2026-02-30' }), 'allowed', TODAY).includes(
      'employmentStartDate',
    ),
  );
  const past = filled({ employmentStartDate: '2026-09-01' });
  assert.ok(needsStartReason(past, TODAY));
  assert.ok(createProblems(past, 'allowed', TODAY).includes('employmentReason'));
  assert.equal(
    toCreateRequest({ ...past, employmentReason: ' Đã làm từ tháng 9 ' }, TODAY).employmentReason,
    'Đã làm từ tháng 9',
  );
  assert.equal(needsStartReason(filled({ employmentStartDate: TODAY }), TODAY), false);
  assert.ok(createProblems(filled({ branchIds: [] }), 'allowed', TODAY).includes('branchIds'));
  // Today's business date follows the selected branches' timezones (UTC without one).
  const now = new Date('2026-09-25T18:30:00Z');
  assert.equal(businessToday(['A'], branches, now), '2026-09-26');
  assert.equal(businessToday([], branches, now), '2026-09-25');
  // The form asks for no password and says sign-in is not granted yet.
  const markup = render(
    <EmployeeCreateForm
      branches={branches}
      onCreated={() => undefined}
      onCancel={() => undefined}
    />,
    owner,
  );
  // Sign-in access is opt-in: no password field until "set up login access now" is chosen.
  assert.doesNotMatch(markup, /type="password"/);
  assert.doesNotMatch(markup, /baseSalary|lương cơ bản/i, 'no salary field');
  assert.ok(markup.includes(vi.employees.create.accountNote));
  const optional = [
    vi.employees.create.fields.employmentReason,
    vi.employees.create.fields.initialPassword,
    vi.employees.create.fields.confirmPassword,
  ];
  for (const label of Object.values(vi.employees.create.fields).filter(
    (label) => !optional.includes(label),
  )) {
    assert.ok(markup.includes(label), label);
  }
  assert.match(markup, /id="new-start" type="date" required=""/);
  assert.match(inputTag(markup, 'new-branches', 'A'), /type="checkbox"/);
  assert.match(inputTag(markup, 'new-branches', 'B'), /type="checkbox"/);
  assert.doesNotMatch(markup, /value="C"/, 'inactive branches are not offered');
});

test('9. the created member is confirmed and listed with its classification', () => {
  const notice = render(
    <CreatedNotice employee={createdEmployee} classification="OFFICIAL_EMPLOYEE" />,
    owner,
  );
  assert.ok(notice.includes('Nguyễn Thị Hoa') && notice.includes('KTV-07'));
  assert.ok(notice.includes(vi.employees.classifications.OFFICIAL_EMPLOYEE));
  assert.ok(notice.includes('chưa thể đăng nhập'), 'no claim that the member can sign in');
  assert.ok(notice.includes(`href="/vi/workforce/employees/${createdEmployee.id}"`));
  const now = new Date('2026-09-26T03:00:00Z');
  const entry = (classification: 'TRAINEE' | 'OFFICIAL_EMPLOYEE', date: string) => ({
    classification,
    classificationEffectiveDate: date,
    branchIds: ['A'],
  });
  assert.equal(
    directoryClassification(entry('TRAINEE', '2026-09-01'), branches, vi, 'vi', now),
    'Học viên',
  );
  assert.equal(
    directoryClassification(entry('OFFICIAL_EMPLOYEE', '2026-10-01'), branches, vi, 'vi', now),
    'Nhân viên chính thức (từ 01/10/2026)',
  );
  assert.equal(
    directoryClassification(entry('OFFICIAL_EMPLOYEE', '2026-10-01'), branches, en, 'en', now),
    'Official employee (from 2026-10-01)',
  );
  assert.equal(
    directoryClassification(
      { classification: null, classificationEffectiveDate: null, branchIds: [] },
      branches,
      vi,
      'vi',
      now,
    ),
    '—',
  );
});

test('10. duplicates, invalid fields and authorization failures are explained', async () => {
  const cases: [number, string, string, string][] = [
    [409, 'CONFLICT', 'Conflict: employeeId', vi.employees.create.duplicateEmployeeId],
    [409, 'CONFLICT', 'Conflict: phone', vi.employees.create.duplicatePhone],
    [409, 'CONFLICT', 'Conflict: email', vi.employees.create.duplicateEmail],
    [400, 'VALIDATION_FAILED', 'Validation failed: employeeCode', 'Mã nhân viên'],
    [400, 'VALIDATION_FAILED', 'Validation failed: phone', 'Số điện thoại'],
    [400, 'VALIDATION_FAILED', 'Validation failed: employmentReason', 'Lý do ghi nhận'],
    [403, 'FORBIDDEN', 'Forbidden', vi.employees.create.forbidden],
  ];
  for (const [status, code, message, expected] of cases) {
    const { fetcher } = scriptedFetch([context('c'), failure(status, code, message)]);
    const api = new WorkforceApi({ fetch: fetcher });
    const error = await createEmployee(api, toCreateRequest(filled(), TODAY)).catch((e) => e);
    assert.ok(createErrorMessage(error, vi).includes(expected), `${code} ${message}`);
  }
  assert.equal(createErrorMessage(new Error('x'), vi), vi.errors.unexpected);
});

test('11. repeated submits while pending send exactly one create request', async () => {
  let release: (response: Response) => void = () => undefined;
  const { fetcher, calls } = scriptedFetch([context('csrf'), () => json(201, createdEmployee)]);
  const slow: typeof fetch = (input, init) =>
    String(input).endsWith('/api/v1/employees')
      ? new Promise<Response>((resolve) => {
          release = resolve;
        }).then(() => fetcher(input, init))
      : fetcher(input, init);
  const api = new WorkforceApi({ fetch: slow });
  const submit = oneAtATime(() => createEmployee(api, toCreateRequest(filled(), TODAY)));
  const first = submit();
  const again = [submit(), submit(), submit()];
  assert.deepEqual(await Promise.all(again), [undefined, undefined, undefined]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  release(new Response());
  assert.equal((await first)?.id, createdEmployee.id);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
});

test('12. without MANAGE_EMPLOYEE_PAY the official choice is unavailable', () => {
  assert.equal(officialAvailability(creator, ['A']), 'noPay');
  assert.equal(officialAvailability(payroll, ['A']), 'allowed');
  assert.equal(officialAvailability(payroll, ['A', 'B']), 'noPayForBranches');
  assert.equal(officialAvailability(owner, ['A', 'B']), 'allowed');
  assert.ok(createProblems(filled(), 'noPay', TODAY).includes('official'));
  assert.ok(createProblems(filled(), 'noPayForBranches', TODAY).includes('official'));
  const markup = render(
    <EmployeeCreateForm
      branches={branches}
      onCreated={() => undefined}
      onCancel={() => undefined}
    />,
    creator,
  );
  assert.match(inputTag(markup, 'new-classification', 'OFFICIAL_EMPLOYEE'), /disabled=""/);
  assert.doesNotMatch(inputTag(markup, 'new-classification', 'TRAINEE'), /disabled/);
  assert.ok(markup.includes(vi.employees.create.officialNoPay));
  // The only permitted branch is preselected; others are not offered.
  assert.match(inputTag(markup, 'new-branches', 'A'), /checked=""/);
  assert.doesNotMatch(markup, /value="B"/);
});

test('14. the directory search and list controls are unchanged', () => {
  const markup = render(<EmployeesScreen />, employee([['VIEW_EMPLOYEES', 'A']]));
  for (const id of ['emp-q', 'emp-branch', 'emp-status'])
    assert.ok(markup.includes(`id="${id}"`), id);
  assert.match(markup, /role="search"/);
  assert.ok(markup.includes(vi.employees.title));
  const none = render(
    <EmployeeCreateForm
      branches={branches}
      onCreated={() => undefined}
      onCancel={() => undefined}
    />,
    employee([['CREATE_EMPLOYEES', 'Z']]),
  );
  assert.ok(none.includes(vi.employees.create.noBranches));
});
