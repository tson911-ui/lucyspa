import type { MyAccountResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChangeEmailSection,
  ChangePasswordSection,
  MyAccountView,
} from '../../components/workforce/screens/my-account';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, json, owner, render, scriptedFetch } from '../../test/support';
import { WorkforceApi } from './api';
import { detailErrorMessage } from './employee-detail';
import { ApiError } from './api';
import {
  changeOwnPassword,
  changePasswordErrorMessage,
  changePasswordProblem,
  emailChangeErrorMessage,
  emailChangeProblem,
  EMPTY_CHANGE_PASSWORD,
  requestEmailChange,
  resendEmailChange,
  verifyEmailChange,
  myAccountCommands,
  myProfileForm,
  myProfilePatch,
} from './my-account';
import { navigationFor } from './permissions';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

const mine: MyAccountResponse = {
  id: 'emp-1',
  kind: 'EMPLOYEE',
  fullName: 'Nguyễn Anh Thư',
  phone: '+84905123456',
  email: { address: 'thu@example.com', verified: false },
  locale: 'vi',
  status: 'ACTIVE',
  title: 'COLLABORATOR',
  employee: {
    employeeId: 'CTV-07',
    dateOfBirth: '1995-03-08',
    address: '5 Hai Bà Trưng',
    classification: 'COLLABORATOR',
    branches: [{ id: 'A', code: 'BR-A', name: 'Chi nhánh A' }],
    skills: [{ id: 's1', code: 'WASH', nameVi: 'Gội đầu', nameEn: 'Hair wash' }],
  },
  version: 5,
};
const ownerAccount: MyAccountResponse = {
  id: 'owner-1',
  kind: 'OWNER',
  fullName: 'Chủ Lucy',
  phone: null,
  email: { address: 'owner@example.com', verified: true },
  locale: 'vi',
  status: 'ACTIVE',
  title: 'OWNER',
  employee: null,
  version: 2,
};
const view = (account: MyAccountResponse, locale: 'vi' | 'en' = 'vi') =>
  render(
    <MyAccountView account={account} reload={() => Promise.resolve()} />,
    account.kind === 'OWNER' ? owner : employee(),
    locale,
  );

test('My Account is in every workforce navigation, Owner included', () => {
  for (const account of [owner, employee(), employee([['VIEW_EMPLOYEES', 'A']])]) {
    const item = navigationFor(account).find((entry) => entry.key === 'myAccount');
    assert.deepEqual(item, { key: 'myAccount', group: 'home', path: '/account' });
  }
  assert.equal(vi.nav.myAccount, 'Tài khoản của tôi');
  assert.equal(en.nav.myAccount, 'My Account');
});

test('the view shows the authoritative profile, title, work and security, read-only where managed', () => {
  const markup = view(mine);
  for (const text of [
    vi.myAccount.personal,
    vi.myAccount.work,
    vi.myAccount.security.replace('&', '&amp;'),
    'Nguyễn Anh Thư',
    'CTV-07',
    '+84905123456',
    '08/03/1995',
    '5 Hai Bà Trưng',
    'Chi nhánh A',
    'Gội đầu',
    'thu@example.com',
    vi.myAccount.emailUnverified,
    vi.myAccount.workReadonly,
    vi.myAccount.changeEmail.title,
  ]) {
    assert.ok(markup.includes(text), text);
  }
  // The server title is rendered as given (never recomputed).
  assert.ok(markup.includes(`>${vi.employees.titles.COLLABORATOR}<`));
  assert.ok(view({ ...mine, title: 'MANAGER' }).includes(`>${vi.employees.titles.MANAGER}<`));
  // Only the self-editable fields are inputs; code, classification, branches, skills,
  // status and email never are.
  for (const id of ['my-name', 'my-phone', 'my-dob', 'my-address', 'my-locale']) {
    assert.match(markup, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(markup, /id="my-(code|email|classification|branch|skill|status|salary)/);
  assert.doesNotMatch(markup, /lương|salary/i, 'no pay data');
  assert.ok(view(mine, 'en').includes('Hair wash'));
  assert.ok(
    view({
      ...mine,
      employee: { ...mine.employee!, classification: null },
      title: 'NOT_STARTED',
    }).includes(vi.myAccount.notStarted),
  );
});

test('the Owner sees only fields that exist for them (no employee profile)', () => {
  const markup = view(ownerAccount);
  assert.ok(markup.includes(`>${vi.employees.titles.OWNER}<`));
  assert.ok(markup.includes('owner@example.com') && markup.includes(vi.myAccount.emailVerified));
  assert.ok(markup.includes(vi.myAccount.ownerEditNote));
  assert.doesNotMatch(markup, /id="my-(dob|address)"/);
  assert.ok(!markup.includes(vi.myAccount.work), 'no work section');
  assert.ok(!markup.includes(vi.employees.detail.loginId), 'no employee code');
});

test('self-edits send only changed allowlisted fields to /me, never an ID', async () => {
  const form = myProfileForm(mine);
  assert.equal(myProfilePatch(mine, form), null, 'nothing changed');
  const patch = myProfilePatch(mine, {
    ...form,
    fullName: ' Anh Thư ',
    phone: '0905 999 888',
    address: '7 Lý Tự Trọng',
    locale: 'en',
  })!;
  assert.deepEqual(patch, {
    expectedVersion: 5,
    fullName: 'Anh Thư',
    phone: '0905 999 888',
    address: '7 Lý Tự Trọng',
    locale: 'en',
  });
  // The Owner never sends date of birth or address.
  assert.deepEqual(
    myProfilePatch(ownerAccount, {
      ...myProfileForm(ownerAccount),
      dateOfBirth: '1980-01-01',
      address: 'x',
      fullName: 'Chủ',
    }),
    { expectedVersion: 2, fullName: 'Chủ' },
  );
  const { fetcher, calls } = scriptedFetch([
    () => json(200, mine),
    context('c', true),
    () => json(200, mine),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await myAccountCommands.get(api);
  await myAccountCommands.updateProfile(api, patch);
  assert.equal(calls[0]?.url, '/api/v1/me/account');
  assert.equal(calls[2]?.url, '/api/v1/me/account/profile');
  assert.deepEqual(calls[2]?.body, patch);
  assert.ok(!JSON.stringify(calls[2]?.body).includes('emp-1'), 'identity comes from the session');
  // Shared refusals are explained without revealing who holds a phone.
  assert.equal(
    detailErrorMessage(new ApiError(409, 'CONFLICT', 'phone'), vi),
    vi.employees.create.duplicatePhone,
  );
  assert.ok(
    detailErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'phone'), vi).includes(
      vi.employees.create.fields.phone,
    ),
  );
});

test('change password: a form under Account & Security with password fields only', () => {
  const markup = view(mine);
  const security = markup.slice(markup.indexOf(vi.myAccount.security.replace('&', '&amp;')));
  assert.ok(security.includes(vi.myAccount.changePassword.title), 'inside Account & Security');
  const form = render(<ChangePasswordSection />, employee());
  for (const [id, label, autocomplete] of [
    ['change-current', 'Mật khẩu hiện tại', 'current-password'],
    ['change-next', 'Mật khẩu mới', 'new-password'],
    ['change-confirm', 'Xác nhận mật khẩu mới', 'new-password'],
  ] as const) {
    assert.ok(form.includes(`>${label}<`), label);
    assert.match(
      form,
      new RegExp(`<input id="${id}" type="password"[^>]*autoComplete="${autocomplete}"`),
      id,
    );
  }
  assert.ok(form.includes(`>${vi.myAccount.changePassword.submit}<`));
  assert.doesNotMatch(form, /value="[^"]+"/, 'no password value is ever pre-filled');
  const english = render(<ChangePasswordSection />, owner, 'en');
  for (const label of ['Current password', 'New password', 'Confirm new password']) {
    assert.ok(english.includes(`>${label}<`), label);
  }
  assert.ok(view(ownerAccount).includes(vi.myAccount.changePassword.title), 'Owner too');
});

test('change password: client checks help; the server stays authoritative', async () => {
  const good = {
    current: 'a calm lotus evening 2026',
    next: 'jasmine tea by the river',
    confirm: 'jasmine tea by the river',
  };
  assert.equal(changePasswordProblem(EMPTY_CHANGE_PASSWORD), 'currentRequired');
  assert.equal(changePasswordProblem({ ...good, next: 'short', confirm: 'short' }), 'length');
  // E. a confirmation mismatch never reaches the server.
  assert.equal(changePasswordProblem({ ...good, confirm: `${good.next}!` }), 'mismatch');
  assert.equal(
    changePasswordProblem({ ...good, next: good.current, confirm: good.current }),
    'same',
  );
  assert.equal(changePasswordProblem(good), null);
  // Passwords only (no ID); then a fresh CSRF token for the rotated session.
  const { fetcher, calls } = scriptedFetch([
    context('c1', true),
    () => json(204, null),
    context('c2', true),
  ]);
  await changeOwnPassword(new WorkforceApi({ fetch: fetcher }), good);
  assert.deepEqual(
    calls.map((call) => [call.method, call.url]),
    [
      ['GET', '/api/v1/auth/context'],
      ['POST', '/api/v1/me/password'],
      ['GET', '/api/v1/auth/context'],
    ],
  );
  assert.deepEqual(calls[1]?.body, { currentPassword: good.current, newPassword: good.next });
  // Safe, specific messages; never the password.
  const texts = vi.myAccount.changePassword;
  for (const [error, message] of [
    [new ApiError(401, 'AUTHENTICATION_FAILED'), texts.wrongCurrent],
    [new ApiError(400, 'VALIDATION_FAILED', 'newPassword'), texts.rejected],
    [new ApiError(400, 'VALIDATION_FAILED', 'newPasswordUnchanged'), texts.same],
    [new ApiError(429, 'RATE_LIMITED'), vi.errors.rateLimited],
  ] as const) {
    assert.equal(changePasswordErrorMessage(error, vi), message);
  }
  assert.equal(
    changePasswordErrorMessage(new ApiError(401, 'AUTHENTICATION_FAILED'), en),
    'The current password is incorrect.',
  );
});

test('change email: a real form in Account & Security; the code step comes later', () => {
  const markup = view(mine);
  const security = markup.slice(markup.indexOf(vi.myAccount.security.replace('&', '&amp;')));
  assert.ok(security.includes(`<summary>${vi.myAccount.changeEmail.title}</summary>`));
  assert.ok(!markup.includes('Email không đổi được ở đây'), 'the static note is gone');
  const form = render(
    <ChangeEmailSection account={mine} reload={() => Promise.resolve()} />,
    employee(),
  );
  assert.match(
    form,
    /<input id="email-current-password" type="password"[^>]*autoComplete="current-password"/,
  );
  assert.match(form, /<input id="email-new" type="email"/);
  assert.ok(form.includes(`>${vi.myAccount.changeEmail.send}<`));
  assert.ok(form.includes(vi.myAccount.changeEmail.intro));
  assert.doesNotMatch(form, /id="email-code"/, 'no code field before a code was sent');
  assert.doesNotMatch(form, /value="[^"]+"/, 'nothing pre-filled');
  const english = render(
    <ChangeEmailSection account={ownerAccount} reload={() => Promise.resolve()} />,
    owner,
    'en',
  );
  for (const label of ['Current password', 'New email', 'Send verification code']) {
    assert.ok(english.includes(label), label);
  }
  assert.ok(view(ownerAccount).includes(vi.myAccount.changeEmail.title), 'Owner too');
});

test('change email: request, resend and verify over /me/email; safe messages', async () => {
  assert.equal(emailChangeProblem('', 'a@example.com'), 'passwordRequired');
  assert.equal(emailChangeProblem('pw', '  '), 'emailRequired');
  assert.equal(emailChangeProblem('pw', 'not an email'), 'invalidEmail');
  assert.equal(emailChangeProblem('pw', ' new@example.com '), null);
  assert.equal(emailChangeProblem('pw', 'THU@example.com', 'thu@example.com'), 'sameEmail');
  const flow = {
    status: 'accepted',
    flowToken: 'f'.repeat(43),
    codeLifetimeSeconds: 300,
    resendAfterSeconds: 60,
  };
  const { fetcher, calls } = scriptedFetch([
    context('c1', true),
    () => json(202, flow),
    () => json(204, null),
    () => json(204, null),
    context('c2', true),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  const accepted = await requestEmailChange(api, 'a calm lotus evening 2026', ' new@example.com ');
  await resendEmailChange(api, accepted.flowToken);
  await verifyEmailChange(api, accepted.flowToken, ' 123456 ');
  assert.deepEqual(
    calls.map((call) => [call.method, call.url]),
    [
      ['GET', '/api/v1/auth/context'],
      ['POST', '/api/v1/me/email/request'],
      ['POST', '/api/v1/me/email/resend'],
      ['POST', '/api/v1/me/email/verify'],
      ['GET', '/api/v1/auth/context'],
    ],
  );
  // Only the password and address; never an account identifier.
  assert.deepEqual(calls[1]?.body, {
    currentPassword: 'a calm lotus evening 2026',
    newEmail: 'new@example.com',
  });
  assert.deepEqual(calls[2]?.body, { flowToken: flow.flowToken });
  assert.deepEqual(calls[3]?.body, { flowToken: flow.flowToken, otp: '123456' });
  const texts = vi.myAccount.changeEmail;
  for (const [error, message] of [
    [new ApiError(401, 'AUTHENTICATION_FAILED'), texts.wrongPassword],
    [new ApiError(400, 'VERIFICATION_FAILED'), texts.codeRejected],
    [new ApiError(409, 'CONFLICT', 'email'), texts.taken],
    [new ApiError(400, 'VALIDATION_FAILED', 'newEmail'), texts.invalidEmail],
    [new ApiError(400, 'VALIDATION_FAILED', 'newEmailUnchanged'), texts.sameEmail],
    [new ApiError(429, 'RATE_LIMITED'), vi.errors.rateLimited],
  ] as const) {
    assert.equal(emailChangeErrorMessage(error, vi), message);
  }
});
