import type { MyAccountResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MyAccountView } from '../../components/workforce/screens/my-account';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, json, owner, render, scriptedFetch } from '../../test/support';
import { WorkforceApi } from './api';
import { detailErrorMessage } from './employee-detail';
import { ApiError } from './api';
import { myAccountCommands, myProfileForm, myProfilePatch } from './my-account';
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
    vi.myAccount.emailReadonly,
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
