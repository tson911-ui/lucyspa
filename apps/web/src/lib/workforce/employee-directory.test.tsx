import type {
  BranchSummary,
  EmployeeDirectoryEntry,
  EmployeeDirectoryResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DirectoryGroupView, EmployeesScreen } from '../../components/workforce/screens/employees';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, json, owner, render, scriptedFetch } from '../../test/support';
import { WorkforceApi } from './api';
import {
  DIRECTORY_PAGE_SIZE,
  directoryPage,
  FIRST_PAGES,
  pageItems,
  pagerState,
  totalPages,
  withGroupPage,
} from './employee-directory';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const A = '5e1c0000-aaaa-4000-8000-00000000000a';
const branches = new Map<string, BranchSummary>([
  [
    A,
    { id: A, code: 'A', name: 'Lucy A', timezone: 'Asia/Ho_Chi_Minh', isActive: true, version: 1 },
  ],
]);
const entry = (
  code: string,
  name: string,
  classification: EmployeeDirectoryEntry['classification'],
): EmployeeDirectoryEntry => ({
  id: `id-${code}`,
  employeeId: code,
  fullName: name,
  status: 'ACTIVE',
  branchIds: [A],
  version: 1,
  classification,
  classificationEffectiveDate: '2026-01-01',
});
const page = (
  items: EmployeeDirectoryEntry[],
  total = items.length,
  number = 1,
): EmployeeDirectoryResponse => ({
  items,
  nextCursor: null,
  page: { number, size: DIRECTORY_PAGE_SIZE, total },
});
const view = (
  group: 'MANAGERS' | 'EMPLOYEES',
  data: EmployeeDirectoryResponse | null,
  extra: { page?: number; filtered?: boolean; locale?: 'vi' | 'en' } = {},
) =>
  render(
    <DirectoryGroupView
      group={group}
      data={data}
      loading={false}
      error={null}
      filtered={extra.filtered ?? false}
      branches={branches}
      page={extra.page ?? 1}
      onPage={() => undefined}
      reload={() => Promise.resolve()}
    />,
    owner,
    extra.locale ?? 'vi',
  );

test('1–6, 16. sections: Managers above Employees; the API decides membership', async () => {
  const screen = render(<EmployeesScreen />, owner);
  const managersAt = screen.indexOf(`<h2>${vi.employees.directory.managers}</h2>`);
  const employeesAt = screen.indexOf(`<h2>${vi.employees.directory.employees}</h2>`);
  assert.ok(managersAt > 0 && employeesAt > managersAt, 'Quản lý above Nhân viên');
  const english = render(<EmployeesScreen />, owner, 'en');
  assert.ok(english.indexOf('<h2>Managers</h2>') < english.indexOf('<h2>Employees</h2>'));
  // Each group is its own server query: group + page, never a role name.
  const { fetcher, calls } = scriptedFetch([
    () => json(200, page([entry('QL01', 'Trần Quản Lý', 'OFFICIAL_EMPLOYEE')])),
    () => json(200, page([entry('HV01', 'Lê Học Viên', 'TRAINEE')])),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  const filters = { q: '', branchId: '', status: '' };
  const managers = await directoryPage(api, 'MANAGERS', filters, 1);
  const employees = await directoryPage(api, 'EMPLOYEES', filters, 1);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      `/api/v1/employees?group=MANAGERS&page=1&limit=${DIRECTORY_PAGE_SIZE}`,
      `/api/v1/employees?group=EMPLOYEES&page=1&limit=${DIRECTORY_PAGE_SIZE}`,
    ],
  );
  // A manager is shown only in the Managers table; classification stays a column.
  const managerTable = view('MANAGERS', managers);
  const employeeTable = view('EMPLOYEES', employees);
  assert.ok(managerTable.includes('Trần Quản Lý'));
  assert.ok(!employeeTable.includes('Trần Quản Lý'));
  assert.ok(managerTable.includes(vi.employees.classifications.OFFICIAL_EMPLOYEE));
  assert.ok(employeeTable.includes(vi.employees.classifications.TRAINEE));
  assert.ok(employeeTable.includes(`>${vi.employees.classification}<`), 'a column, not a group');
  assert.ok(view('EMPLOYEES', employees, { locale: 'en' }).includes('Trainee'));
});

test('7–11. pages: independent per group, bounded, current page marked, hidden if one', () => {
  // 7–8. Changing one group's page leaves the other untouched.
  const afterManagers = withGroupPage(FIRST_PAGES, 'MANAGERS', 3);
  assert.deepEqual(afterManagers, { MANAGERS: 3, EMPLOYEES: 1 });
  const afterEmployees = withGroupPage(afterManagers, 'EMPLOYEES', 2);
  assert.deepEqual(afterEmployees, { MANAGERS: 3, EMPLOYEES: 2 });
  assert.deepEqual(withGroupPage(afterEmployees, 'MANAGERS', 0), { MANAGERS: 1, EMPLOYEES: 2 });
  // 9. Boundaries.
  assert.deepEqual(
    [pagerState(1, 8).previousDisabled, pagerState(1, 8).nextDisabled],
    [true, false],
  );
  assert.deepEqual(
    [pagerState(8, 8).previousDisabled, pagerState(8, 8).nextDisabled],
    [false, true],
  );
  // Page links: « 1 2 3 … 8 » style.
  assert.deepEqual(pageItems(1, 8), [1, 2, 'gap', 8]);
  assert.deepEqual(pageItems(5, 8), [1, 'gap', 4, 5, 6, 7, 8]);
  assert.deepEqual(pageItems(3, 8), [1, 2, 3, 4, 'gap', 8]);
  assert.deepEqual(pageItems(2, 3), [1, 2, 3]);
  assert.equal(totalPages(0), 1);
  assert.equal(totalPages(41), 3);
  // 10. The current page is marked; previous is disabled on page 1.
  const many = view(
    'EMPLOYEES',
    page([entry('NV01', 'A', 'OFFICIAL_EMPLOYEE')], 3 * DIRECTORY_PAGE_SIZE + 1, 2),
    { page: 2 },
  );
  assert.match(many, /aria-current="page"[^>]*>2</);
  assert.equal((many.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(many, /aria-label="Trang của danh sách Nhân viên"/);
  const first = view('MANAGERS', page([entry('QL01', 'B', null)], 45), { page: 1 });
  assert.match(
    first,
    /<button[^>]*disabled=""[^>]*aria-label="Trang trước"|aria-label="Trang trước"[^>]*disabled=""/,
  );
  // 11. One page: no pager at all.
  assert.doesNotMatch(view('MANAGERS', page([entry('QL01', 'B', null)], 5)), /wf-pagination/);
});

test('12–14. empty and filtered states per section', () => {
  assert.ok(view('MANAGERS', page([])).includes('Chưa có quản lý.'));
  assert.ok(view('EMPLOYEES', page([])).includes('Chưa có nhân viên.'));
  assert.ok(view('MANAGERS', page([]), { locale: 'en' }).includes('No managers yet.'));
  assert.ok(
    view('EMPLOYEES', page([]), { filtered: true }).includes(
      vi.employees.directory.noEmployeesFiltered,
    ),
  );
  // Filters are passed to the server for each group (and blank ones omitted).
  const { fetcher, calls } = scriptedFetch([() => json(200, page([]))]);
  void directoryPage(
    new WorkforceApi({ fetch: fetcher }),
    'EMPLOYEES',
    {
      q: ' hoa ',
      branchId: A,
      status: 'INACTIVE',
    },
    2,
  );
  assert.equal(
    calls[0]?.url,
    `/api/v1/employees?group=EMPLOYEES&page=2&limit=${DIRECTORY_PAGE_SIZE}&q=hoa&branchId=${A}&status=INACTIVE`,
  );
  // The search form and status filter (incl. INACTIVE) are unchanged.
  const screen = render(<EmployeesScreen />, owner);
  for (const id of ['emp-q', 'emp-branch', 'emp-status']) assert.ok(screen.includes(`id="${id}"`));
  assert.ok(screen.includes(`value="INACTIVE"`));
});

test('15. the Owner has a reachable "Thêm nhân sự / Add employee" action', () => {
  const vi_ = render(<EmployeesScreen />, owner);
  assert.match(
    vi_,
    /<button type="button" class="wf-button wf-button-primary"[^>]*>Thêm nhân sự<\/button>/,
  );
  const en_ = render(<EmployeesScreen />, owner, 'en');
  assert.match(
    en_,
    /<button type="button" class="wf-button wf-button-primary"[^>]*>Add employee<\/button>/,
  );
  assert.equal(en.employees.add, 'Add employee');
  // Not for readers without CREATE_EMPLOYEES.
  assert.doesNotMatch(
    render(<EmployeesScreen />, employee([['VIEW_EMPLOYEES', A]])),
    /Thêm nhân sự/,
  );
});
