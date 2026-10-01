import type {
  BranchSummary,
  EmployeeResponse,
  EmploymentClassificationEntry,
  EmploymentResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EmployeeDetail } from '../../components/workforce/screens/employee-detail';
import {
  AccessSection,
  EmploymentSection,
  EndDialog,
  PasswordDialog,
  ProfileDialog,
  PromoteDialog,
} from '../../components/workforce/screens/employee-lifecycle';
import { organizationDictionary } from '../../i18n/organization';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, failure, json, owner, render, scriptedFetch } from '../../test/support';
import { WorkforceApi } from './api';
import {
  backdatedForNonOwner,
  credentialsRequest,
  detailActions,
  detailErrorMessage,
  employeeCommands,
  endAccessMessage,
  endingOutcome,
  endRequest,
  menuOverlays,
  passwordProblem,
  profileForm,
  profilePatch,
  nextClassifications,
  promotionRequest,
} from './employee-detail';
import { ApiError } from './api';
import { reauthenticate, withReauthentication } from './reauth';

const vi = getWorkforceDictionary('vi');
const organizationMoreActions = organizationDictionary('vi').moreActions;
const en = getWorkforceDictionary('en');
const TODAY = '2026-09-26';
const PASSWORD = 'hoa sen xanh buổi sáng 2026';
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
const member: EmployeeResponse = {
  id: '6f1c7a52-0000-4000-8000-000000000021',
  employeeId: 'NV0021',
  fullName: 'Lê Thị Hồng',
  dateOfBirth: '1998-07-14',
  address: '8 Trần Phú',
  phone: '+84905222333',
  email: 'hong@example.com',
  emailVerified: false,
  locale: 'vi',
  status: 'ACTIVE',
  branchIds: ['A'],
  version: 4,
};
const entry = (
  classification: EmploymentClassificationEntry['classification'],
  effectiveDate: string,
  reason: string | null = null,
): EmploymentClassificationEntry => ({
  classification,
  effectiveDate,
  reason,
  recordedByUserId: 'owner-1',
  recordedAt: `${effectiveDate}T02:00:00.000Z`,
});
const employment = (history: EmploymentClassificationEntry[]): EmploymentResponse => {
  const current = [...history].reverse().find((row) => row.effectiveDate <= TODAY) ?? null;
  const title =
    current === null
      ? 'NOT_STARTED'
      : current.classification === 'OFFICIAL_EMPLOYEE'
        ? 'EMPLOYEE'
        : current.classification;
  return {
    employeeId: member.id,
    title,
    version: member.version,
    today: TODAY,
    current,
    onDate: null,
    payrollEligibleToday: current?.classification === 'OFFICIAL_EMPLOYEE',
    history,
  };
};
const trainee = employment([entry('TRAINEE', '2026-08-01', 'Học việc')]);
const official = employment([
  entry('TRAINEE', '2026-08-01'),
  entry('OFFICIAL_EMPLOYEE', '2026-09-01'),
]);
const ended = employment([entry('OFFICIAL_EMPLOYEE', '2026-01-05'), entry('ENDED', '2026-09-20')]);
const endingLater = employment([entry('TRAINEE', '2026-08-01'), entry('ENDED', '2026-10-31')]);
const detail = (
  employmentData: EmploymentResponse | null,
  account = owner,
  person: EmployeeResponse = member,
  locale: 'vi' | 'en' = 'vi',
) =>
  render(
    <EmployeeDetail
      employee={person}
      employment={employmentData}
      employmentError={null}
      branches={branches}
      reloadAll={() => Promise.resolve()}
      reloadEmployment={() => Promise.resolve()}
    />,
    account,
    locale,
  );
const noop = () => Promise.resolve();
const ignore = () => undefined;
const lifecycle = {
  profile: (person = member, account = owner) =>
    render(
      <ProfileDialog employee={person} reload={noop} onClose={ignore} onDone={ignore} />,
      account,
    ),
  employment: (data: EmploymentResponse, locale: 'vi' | 'en' = 'vi') =>
    render(<EmploymentSection employment={data} timeZone="Asia/Ho_Chi_Minh" />, owner, locale),
  account: (data: EmploymentResponse | null, person = member, locale: 'vi' | 'en' = 'vi') =>
    render(<AccessSection employee={person} employment={data} />, owner, locale),
  promote: (data: EmploymentResponse) =>
    render(
      <PromoteDialog
        employee={member}
        employment={data}
        reload={noop}
        onClose={ignore}
        onDone={ignore}
      />,
      owner,
    ),
  end: (data: EmploymentResponse, canDisable = true, account = owner) =>
    render(
      <EndDialog
        employee={member}
        employment={data}
        canDisable={canDisable}
        reload={noop}
        onClose={ignore}
        onDone={ignore}
      />,
      account,
    ),
  password: (person: EmployeeResponse) =>
    render(
      <PasswordDialog employee={person} reload={noop} onClose={ignore} onDone={ignore} />,
      owner,
    ),
};
const manager = employee([
  ['VIEW_EMPLOYEES', 'A'],
  ['UPDATE_EMPLOYEES', 'A'],
  ['MANAGE_EMPLOYEE_PAY', 'A'],
  ['MANAGE_EMPLOYEE_ACCESS', 'A'],
  ['MANAGE_EMPLOYEE_STATUS', 'A'],
  ['MANAGE_EMPLOYEE_SCOPE', 'A'],
]);

test('1–2, 15, 19. detail shows profile, read-only login ID, separate status and classification', () => {
  const markup = detail(trainee);
  for (const text of [
    'Lê Thị Hồng',
    '+84905222333',
    'hong@example.com',
    vi.employees.detail.emailUnverified,
    '14/07/1998',
    '8 Trần Phú',
    vi.employees.detail.locales.vi,
  ]) {
    assert.ok(markup.includes(text), text);
  }
  assert.match(markup, /<strong id="employee-login-id">NV0021<\/strong>/);
  assert.ok(markup.includes(vi.employees.detail.loginIdHint));
  assert.doesNotMatch(markup, /<input[^>]*value="NV0021"/, 'employee code is never an input');
  assert.doesNotMatch(markup, /username|tên đăng nhập/i);
  // Account status and employment classification are separate, each labelled.
  assert.ok(markup.includes(`${vi.employees.titleColumn}:`));
  assert.ok(markup.includes(`${vi.employees.detail.accountStatus}:`));
  assert.ok(markup.includes(vi.employees.classifications.TRAINEE));
  assert.ok(markup.includes(vi.employees.statuses.ACTIVE));
  const english = detail(official, owner, member, 'en');
  for (const text of ['Employee ID (login ID)', 'Employee', 'Sign-in account']) {
    assert.ok(english.includes(text), text);
  }
  assert.ok(lifecycle.employment(official, 'en').includes('Classification history'));
  // One page with tabs: profile, employment, roles and branches, skills (only the first is painted).
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 4);
  for (const label of [
    vi.employees.detail.profile,
    vi.employees.detail.employment,
    vi.employees.detail.accessTab,
    vi.employees.skills,
  ]) {
    assert.ok(markup.includes(`>${label}</button>`), label);
  }
  assert.equal((markup.match(/<h1/g) ?? []).length, 1, 'one page title');
  assert.doesNotMatch(markup, /<details|<fieldset|wf-/);
});

test('3. profile edits send only supported, changed fields to the existing command', async () => {
  const form = profileForm(member);
  assert.equal(profilePatch(member, form), null, 'nothing changed');
  assert.deepEqual(
    profilePatch(member, { ...form, fullName: ' Lê Thị Hồng Nhung ', locale: 'en' }),
    { expectedVersion: 4, fullName: 'Lê Thị Hồng Nhung', locale: 'en' },
  );
  const patch = profilePatch(member, {
    ...form,
    address: '9 Trần Phú',
    dateOfBirth: '1998-07-15',
  })!;
  assert.deepEqual(Object.keys(patch).sort(), ['address', 'dateOfBirth', 'expectedVersion']);
  // Follow-up Step 3: phone is a shared profile field (same rules as My Account).
  assert.deepEqual(profilePatch(member, { ...form, phone: ' 0905 111 222 ' }), {
    expectedVersion: 4,
    phone: '0905 111 222',
  });
  const { fetcher, calls } = scriptedFetch([context('c', true), () => json(200, member)]);
  await employeeCommands.updateProfile(new WorkforceApi({ fetch: fetcher }), member.id, patch);
  assert.equal(calls[1]?.url, `/api/v1/employees/${member.id}/profile`);
  assert.deepEqual(calls[1]?.body, patch);
  // The dialog offers exactly these fields; email and the employee code are never inputs.
  const markup = lifecycle.profile();
  assert.ok(markup.includes(vi.employees.detail.profileReadonlyNote));
  for (const label of [
    vi.employees.fullName,
    vi.employees.detail.phone,
    vi.employees.detail.dateOfBirth,
    vi.employees.detail.address,
    vi.employees.detail.locale,
  ]) {
    assert.ok(markup.includes(label), label);
  }
  assert.doesNotMatch(markup, /type="email"|value="NV0021"/);
  assert.match(
    markup,
    /disabled=""[^>]*><span class="ls-btn-label">Lưu/,
    'nothing changed: Save is off',
  );
  assert.equal(
    detailErrorMessage(new ApiError(409, 'CONFLICT', 'phone'), vi),
    vi.employees.create.duplicatePhone,
  );
});

test('4. classification, effective date, upcoming entries and history are shown', () => {
  const markup = lifecycle.employment(endingLater);
  assert.ok(markup.includes(vi.employees.detail.history));
  assert.ok(markup.includes('01/08/2026'));
  assert.ok(markup.includes('Đã ghi nhận trước: Đã nghỉ từ 31/10/2026.'));
  assert.match(
    markup,
    new RegExp(`>${vi.employees.detail.no}</dd>`),
    'trainee: not payroll-eligible',
  );
  const body = lifecycle.employment(official).match(/<tbody[\s\S]*<\/tbody>/)?.[0] ?? '';
  assert.equal((body.match(/<tr\b/g) ?? []).length, 2, 'one row per recorded classification');
  assert.match(lifecycle.employment(official), new RegExp(`>${vi.employees.detail.yes}</dd>`));
});

test('5–7. classification change: forward only, only the classification changes', async () => {
  assert.ok(detailActions(owner, member, trainee).promote);
  assert.equal(detailActions(owner, member, official).promote, false);
  assert.equal(detailActions(owner, member, ended).promote, false);
  assert.equal(detailActions(owner, member, endingLater).promote, false, 'ENDED recorded');
  assert.ok(menuOverlays(detailActions(owner, member, trainee)).includes('promote'));
  assert.ok(!menuOverlays(detailActions(owner, member, official)).includes('promote'));
  // Targets are an explicit radio choice (a trainee may become CTV or Nhân viên).
  const dialog = lifecycle.promote(trainee);
  for (const label of [
    vi.employees.classifications.COLLABORATOR,
    vi.employees.classifications.OFFICIAL_EMPLOYEE,
  ]) {
    assert.ok(dialog.includes(label), label);
  }
  assert.ok(dialog.includes(vi.employees.detail.promoteHint));
  const request = promotionRequest(4, 'OFFICIAL_EMPLOYEE', '2026-10-01', ' Hoàn thành học việc ');
  assert.deepEqual(request, {
    expectedVersion: 4,
    classification: 'OFFICIAL_EMPLOYEE',
    effectiveDate: '2026-10-01',
    reason: 'Hoàn thành học việc',
  });
  const { fetcher, calls } = scriptedFetch([context('c', true), () => json(200, official)]);
  await employeeCommands.promote(new WorkforceApi({ fetch: fetcher }), member.id, request);
  assert.equal(calls[1]?.url, `/api/v1/employees/${member.id}/employment`);
  assert.deepEqual(Object.keys(calls[1]?.body as object).sort(), [
    'classification',
    'effectiveDate',
    'expectedVersion',
    'reason',
  ]);
  assert.ok(backdatedForNonOwner(manager, '2026-09-01', TODAY));
  assert.equal(backdatedForNonOwner(owner, '2026-09-01', TODAY), false);
  assert.equal(
    detailErrorMessage(new ApiError(409, 'CONFLICT', 'classification'), vi),
    vi.employees.detail.transitionNotAllowed,
  );
  // Step 2: the offered targets follow the matrix (never back from Nhân viên, never after ENDED).
  assert.deepEqual(nextClassifications('TRAINEE'), ['COLLABORATOR', 'OFFICIAL_EMPLOYEE']);
  assert.deepEqual(nextClassifications('COLLABORATOR'), ['OFFICIAL_EMPLOYEE']);
  assert.deepEqual(nextClassifications('OFFICIAL_EMPLOYEE'), []);
  assert.deepEqual(nextClassifications('ENDED'), []);
  assert.deepEqual(nextClassifications(null), []);
  const collaborator = employment([entry('COLLABORATOR', '2026-08-01')]);
  assert.ok(detailActions(owner, member, collaborator).promote);
  assert.ok(detailActions(owner, member, collaborator).end);
  assert.deepEqual(
    promotionRequest(4, 'COLLABORATOR', '2026-10-01', 'x').classification,
    'COLLABORATOR',
  );
  // Ending a manager is refused until the role is removed; the reason is explained.
  assert.equal(
    detailErrorMessage(new ApiError(409, 'CONFLICT', 'managerRole'), vi),
    vi.employees.detail.managerRoleFirst,
  );
});

test('Step 2. the header shows the authoritative server title', () => {
  assert.ok(detail(trainee).includes(`>${vi.employees.titles.TRAINEE}<`));
  assert.ok(detail(official).includes(`>${vi.employees.titles.EMPLOYEE}<`));
  const collaborator = employment([entry('COLLABORATOR', '2026-08-01')]);
  assert.ok(detail(collaborator).includes(`>${vi.employees.titles.COLLABORATOR}<`));
  const manager = { ...official, title: 'MANAGER' as const };
  assert.ok(detail(manager).includes(`>${vi.employees.titles.MANAGER}<`));
  const notStarted = employment([entry('TRAINEE', '2026-10-01')]);
  assert.ok(detail(notStarted).includes(`>${vi.employees.titles.NOT_STARTED}<`));
});

test('8–10. password reset: policy, confirmation, credential command with reauthentication', async () => {
  assert.equal(passwordProblem('short', 'short'), 'length');
  // Global rule (follow-up Step 6): 8–128 code points.
  assert.equal(passwordProblem('Lotus#7', 'Lotus#7'), 'length');
  assert.equal(passwordProblem('Lotus#72', 'Lotus#72'), null);
  assert.equal(passwordProblem('a'.repeat(128), 'a'.repeat(128)), null);
  assert.equal(passwordProblem('a'.repeat(129), 'a'.repeat(129)), 'length');
  assert.equal(passwordProblem(PASSWORD, `${PASSWORD}.`), 'mismatch');
  assert.equal(passwordProblem(PASSWORD, PASSWORD), null);
  const request = credentialsRequest(4, PASSWORD, ' Quên mật khẩu ');
  assert.deepEqual(request, { expectedVersion: 4, newPassword: PASSWORD, reason: 'Quên mật khẩu' });
  const { fetcher, calls } = scriptedFetch([
    context('c1', true),
    failure(403, 'REAUTHENTICATION_REQUIRED', 'Reauthentication required'),
    () => new Response(null, { status: 204 }),
    context('c2', true),
    () => json(200, member),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await withReauthentication(
    () => employeeCommands.setCredentials(api, member.id, request),
    async () => {
      await reauthenticate(api, 'mật khẩu của chủ spa 2026');
      return true;
    },
  );
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      'GET /api/v1/auth/context',
      `POST /api/v1/employees/${member.id}/credentials`,
      'POST /api/v1/auth/reauthenticate',
      'GET /api/v1/auth/context',
      `POST /api/v1/employees/${member.id}/credentials`,
    ],
  );
  const markup = lifecycle.password(member);
  assert.ok(markup.includes(vi.employees.detail.resetPassword));
  assert.match(markup, /type="password"[^>]*minLength="8"|minLength="8"[^>]*type="password"/);
  assert.ok(markup.includes(vi.employees.detail.passwordHint));
  assert.ok(
    lifecycle
      .password({ ...member, status: 'PENDING_SETUP' })
      .includes(vi.employees.detail.setPassword),
  );
  assert.equal(
    detailErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'newPassword'), vi),
    vi.employees.create.passwordRejected,
  );
});

test('11. ended employment: no promotion, reset or reactivation controls', () => {
  const actions = detailActions(owner, { ...member, status: 'INACTIVE' }, ended);
  assert.deepEqual(
    [actions.promote, actions.end, actions.resetPassword, actions.reactivate, actions.deactivate],
    [false, false, false, false, false],
  );
  assert.ok(lifecycle.employment(ended).includes('Đã kết thúc làm việc từ 20/09/2026'));
  assert.ok(
    lifecycle
      .account(ended, { ...member, status: 'INACTIVE' })
      .includes(vi.employees.detail.endedNoAccessChanges),
  );
  // No header menu at all: nothing can be promoted, reset, reactivated or ended.
  assert.deepEqual(menuOverlays(actions), []);
  const markup = detail(ended, owner, { ...member, status: 'INACTIVE' });
  assert.ok(!markup.includes(vi.employees.titles.OWNER));
  assert.ok(!markup.includes(`aria-label="${organizationMoreActions}"`));
  // Ended but still ACTIVE (access kept on purpose): only disabling sign-in is offered.
  const kept = detailActions(owner, member, ended);
  assert.deepEqual([kept.resetPassword, kept.deactivate], [false, true]);
  assert.equal(
    detailErrorMessage(new ApiError(409, 'CONFLICT', 'employment'), vi),
    vi.employees.detail.endedNoAccessChanges,
  );
});

test('12–14. ending uses the existing command and states the access outcome honestly', async () => {
  const request = endRequest(4, '2026-09-26', ' Nghỉ việc ', true);
  assert.deepEqual(request, {
    expectedVersion: 4,
    effectiveDate: '2026-09-26',
    reason: 'Nghỉ việc',
    disableAccess: true,
  });
  const { fetcher, calls } = scriptedFetch([
    context('c', true),
    () => json(200, { employee: member, employment: ended, access: 'DISABLED' }),
  ]);
  const result = await employeeCommands.endEmployment(
    new WorkforceApi({ fetch: fetcher }),
    member.id,
    request,
  );
  assert.equal(calls[1]?.url, `/api/v1/employees/${member.id}/end-employment`);
  assert.equal(endAccessMessage(result.access, vi), vi.employees.detail.endedAccess.DISABLED);
  // Never a delete call.
  assert.ok(calls.every((call) => !/delete/i.test(call.url)));
  assert.equal(endingOutcome(TODAY, TODAY, true, 'ACTIVE'), 'DISABLE_NOW');
  assert.equal(endingOutcome('2026-09-01', TODAY, true, 'ACTIVE'), 'DISABLE_NOW');
  assert.equal(endingOutcome(TODAY, TODAY, true, 'INACTIVE'), 'ALREADY_INACTIVE');
  assert.equal(endingOutcome(TODAY, TODAY, false, 'ACTIVE'), 'NOT_REQUESTED');
  assert.equal(endingOutcome('2026-10-31', TODAY, true, 'ACTIVE'), 'FUTURE_NO_AUTO_DISABLE');
  assert.match(vi.employees.detail.outcome.FUTURE_NO_AUTO_DISABLE, /KHÔNG tự động/);
  assert.match(en.employees.detail.outcome.FUTURE_NO_AUTO_DISABLE, /NOT disabled automatically/);
  assert.match(vi.employees.detail.endedAccess.UNCHANGED_FUTURE_DATE, /vô hiệu hóa thủ công/);
  // The form states the consequence before confirmation and says nothing is deleted.
  const markup = lifecycle.end(trainee);
  assert.ok(markup.includes(vi.employees.detail.endHint));
  assert.ok(markup.includes(vi.employees.detail.outcome.DISABLE_NOW));
  assert.ok(markup.includes(vi.employees.detail.endConfirm));
  // Without MANAGE_EMPLOYEE_STATUS the disable option is off and explained.
  const payOnly = employee([
    ['VIEW_EMPLOYEES', 'A'],
    ['MANAGE_EMPLOYEE_PAY', 'A'],
  ]);
  const canDisable = detailActions(payOnly, member, trainee).disableWhenEnding;
  assert.equal(canDisable, false);
  const limited = lifecycle.end(trainee, canDisable, payOnly);
  const checkbox = limited.match(/<input[^>]*name="end-disable-access"[^>]*>/)?.[0] ?? '';
  assert.match(checkbox, /disabled=""/);
  assert.doesNotMatch(checkbox, /checked/);
  assert.ok(limited.includes(vi.employees.detail.noStatusPermission));
  assert.ok(limited.includes(vi.employees.detail.outcome.NOT_REQUESTED));
});

test('18. controls follow the permission hints; self and viewers get none', () => {
  const viewer = employee([['VIEW_EMPLOYEES', 'A']]);
  const none = detailActions(viewer, member, trainee);
  assert.deepEqual(Object.values(none), [false, false, false, false, false, false, false]);
  const viewMarkup = detail(trainee, viewer);
  assert.deepEqual(menuOverlays(none), []);
  assert.ok(!viewMarkup.includes(`>${vi.employees.detail.editProfile}<`), 'no primary action');
  assert.ok(!viewMarkup.includes(`aria-label="${organizationMoreActions}"`), 'no ⋮ menu');
  // The owner sees the primary action and the menu; the menu order is fixed.
  const ownerMarkup = detail(trainee);
  assert.ok(ownerMarkup.includes(`>${vi.employees.detail.editProfile}<`));
  assert.ok(ownerMarkup.includes(`aria-label="${organizationMoreActions}"`));
  assert.deepEqual(menuOverlays(detailActions(owner, member, trainee)), [
    'promote',
    'password',
    'status',
    'end',
  ]);
  const full = detailActions(manager, member, trainee);
  assert.deepEqual(
    [full.editProfile, full.promote, full.end, full.resetPassword, full.deactivate],
    [true, true, true, true, true],
  );
  // Pay without access: classification actions only.
  const pay = detailActions(employee([['MANAGE_EMPLOYEE_PAY', 'A']]), member, trainee);
  assert.deepEqual([pay.promote, pay.resetPassword], [true, false]);
  // All-branch rule: a grant in A does not cover an employee also in B.
  const wide = detailActions(manager, { ...member, branchIds: ['A', 'B'] }, trainee);
  assert.deepEqual([wide.promote, wide.resetPassword, wide.editProfile], [false, false, false]);
  // Oneself: never classification, credentials or status (the Owner has no profile).
  const self = detailActions(manager, { ...member, id: 'emp-1' }, trainee);
  assert.deepEqual(
    [self.promote, self.end, self.resetPassword, self.deactivate],
    [false, false, false, false],
  );
  // Deny wins.
  const denied = employee([['MANAGE_EMPLOYEE_ACCESS', 'A']], [['MANAGE_EMPLOYEE_ACCESS', 'A']]);
  assert.equal(detailActions(denied, member, trainee).resetPassword, false);
});
