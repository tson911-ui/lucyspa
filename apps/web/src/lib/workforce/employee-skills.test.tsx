import type {
  BranchSummary,
  EmployeeResponse,
  EmployeeSkillsResponse,
  SkillListResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SkillsView } from '../../components/workforce/screens/employee-skills';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, employee, json, owner, render, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  assignableSkills,
  assignBlocker,
  canManageSkills,
  grantRequest,
  revokeRequest,
  skillCommands,
  skillErrorMessage,
} from './employee-skills';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const A = '5e1c0000-aaaa-4000-8000-00000000000a';
// Loaded catalog ids: nothing in the UI knows them in advance.
const HAIR = '7a000000-1111-4000-8000-000000000001';
const NAIL = '7a000000-2222-4000-8000-000000000002';
const FACIAL = '7a000000-3333-4000-8000-000000000003';
const OLD = '7a000000-4444-4000-8000-000000000004';
const branches = new Map<string, BranchSummary>([
  [
    A,
    { id: A, code: 'A', name: 'Lucy A', timezone: 'Asia/Ho_Chi_Minh', isActive: true, version: 1 },
  ],
]);
const member: EmployeeResponse = {
  id: '6f1c7a52-0000-4000-8000-000000000051',
  employeeId: 'HV0051',
  fullName: 'Ngô Lan',
  dateOfBirth: '2004-05-05',
  address: 'Đà Nẵng',
  phone: '+84905555666',
  email: null,
  emailVerified: false,
  locale: 'vi',
  status: 'ACTIVE',
  branchIds: [A],
  version: 2,
};
const skill = (id: string, code: string, nameVi: string, nameEn: string, isActive = true) => ({
  id,
  code,
  nameVi,
  nameEn,
  isActive,
  version: 1,
});
const catalog: SkillListResponse = {
  skills: [
    skill(HAIR, 'HAIR_WASH', 'Gội đầu', 'Hair wash'),
    skill(NAIL, 'NAIL', 'Làm móng', 'Nails'),
    skill(FACIAL, 'FACIAL', 'Chăm sóc da mặt', 'Facial care'),
    skill(OLD, 'OLD_SKILL', 'Kỹ năng cũ', 'Old skill', false),
  ],
};
const held: EmployeeSkillsResponse = {
  employeeId: member.id,
  skills: [
    {
      skill: {
        id: HAIR,
        code: 'HAIR_WASH',
        nameVi: 'Gội đầu',
        nameEn: 'Hair wash',
        isActive: true,
      },
      grantedAt: '2026-09-01T02:00:00.000Z',
      grantedByUserId: 'owner-1',
    },
  ],
  history: [
    {
      skill: { id: NAIL, code: 'NAIL', nameVi: 'Làm móng', nameEn: 'Nails', isActive: true },
      grantedAt: '2026-08-01T02:00:00.000Z',
      revokedAt: '2026-08-20T03:00:00.000Z',
      grantedByUserId: 'owner-1',
    },
  ],
};
const view = (
  account = owner,
  extra: Partial<Parameters<typeof SkillsView>[0]> = {},
  locale: 'vi' | 'en' = 'vi',
) =>
  render(
    <SkillsView
      employee={member}
      ended={false}
      branches={branches}
      held={held}
      catalog={catalog}
      loading={false}
      error={null}
      reload={() => Promise.resolve()}
      {...extra}
    />,
    account,
    locale,
  );
const optionValues = (markup: string) =>
  [
    ...(markup.match(/<select id="grant-skill"[\s\S]*?<\/select>/)?.[0] ?? '').matchAll(
      /value="([^"]*)"/g,
    ),
  ].map((match) => match[1]);

test('1, 5. current skills and removed-skill history display separately', () => {
  const markup = view();
  assert.ok(markup.includes(vi.employees.skillsSection.current));
  assert.ok(markup.includes('<strong>Gội đầu</strong>') && markup.includes('(HAIR_WASH)'));
  assert.ok(markup.includes(vi.employees.skillsSection.active));
  assert.ok(markup.includes('09:00 01/09/2026'), 'grant time in the branch timezone');
  assert.ok(markup.includes(vi.employees.skillsSection.history));
  assert.match(markup, /Làm móng \(NAIL\) · 09:00 01\/08\/2026 – 10:00 20\/08\/2026/);
  assert.ok(markup.includes(vi.employees.skillsSection.intro));
  const english = view(owner, {}, 'en');
  for (const text of ['Current skills', 'Hair wash', 'Removed skills (history)', 'Assign skill']) {
    assert.ok(english.includes(text), text);
  }
});

test('2. the catalog comes from the API; nothing is hard-coded', () => {
  assert.deepEqual(
    assignableSkills(catalog, held).map((entry) => entry.id),
    [NAIL, FACIAL],
    'active catalog skills not already held',
  );
  assert.deepEqual(optionValues(view()), ['', NAIL, FACIAL]);
  for (const file of [
    '../../components/workforce/screens/employee-skills.tsx',
    './employee-skills.ts',
  ]) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /[0-9a-f]{8}-[0-9a-f]{4}-/, 'no ids');
    assert.doesNotMatch(source, /Gội|Massage|Nail|NAIL|HAIR|KTV/, 'no skill or role names');
  }
  const empty = view(owner, { catalog: { skills: [skill(OLD, 'OLD', 'x', 'x', false)] } });
  assert.ok(empty.includes(vi.employees.skillsSection.emptyCatalog));
  assert.doesNotMatch(empty, /id="grant-skill"/);
});

test('3–4. assign and remove use the existing commands; the reason is optional', async () => {
  assert.deepEqual(grantRequest(NAIL, '  '), { skillId: NAIL });
  assert.deepEqual(grantRequest(NAIL, ' Đã học xong '), { skillId: NAIL, reason: 'Đã học xong' });
  assert.deepEqual(revokeRequest(''), {});
  const { fetcher, calls } = scriptedFetch([
    context('c', true),
    () => json(200, held),
    () => json(200, held),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await skillCommands.grant(api, member.id, grantRequest(NAIL, 'Qualified'));
  await skillCommands.revoke(api, member.id, HAIR, revokeRequest('No longer offered'));
  assert.deepEqual(
    calls.slice(1).map((call) => [call.url, call.body]),
    [
      [`/api/v1/employees/${member.id}/skills`, { skillId: NAIL, reason: 'Qualified' }],
      [`/api/v1/employees/${member.id}/skills/${HAIR}/revoke`, { reason: 'No longer offered' }],
    ],
  );
  assert.ok(
    calls.every((call) => !/delete/i.test(call.url)),
    'removal is a revocation',
  );
  assert.match(vi.employees.skillsSection.removed, /lịch sử/);
});

test('6, 15–16. trainees may get skills; ended employment keeps skills but gets no new ones', () => {
  // Classification never blocks: only ENDED employment or a disabled account does.
  assert.equal(assignBlocker(member, false), null);
  assert.equal(assignBlocker(member, true), 'ended');
  assert.equal(assignBlocker({ ...member, status: 'INACTIVE' }, false), 'inactive');
  const ended = view(owner, { ended: true });
  assert.ok(ended.includes(vi.employees.skillsSection.ended));
  assert.doesNotMatch(ended, /id="grant-skill"/);
  assert.ok(ended.includes('<strong>Gội đầu</strong>'), 'current skills stay visible');
  assert.ok(ended.includes(vi.employees.skillsSection.history), 'history stays visible');
  assert.ok(ended.includes(`>${vi.employees.revokeSkill}<`), 'removal still possible');
  const disabled = view(owner, { employee: { ...member, status: 'INACTIVE' } });
  assert.ok(disabled.includes(vi.employees.skillsSection.inactive));
  assert.equal(
    skillErrorMessage(new ApiError(409, 'CONFLICT', 'employment'), vi),
    vi.employees.skillsSection.ended,
  );
  assert.equal(
    skillErrorMessage(new ApiError(409, 'CONFLICT', 'skillId'), vi),
    vi.employees.skillsSection.alreadyHeld,
  );
});

test('17. controls follow MANAGE_SKILLS over every branch, never on oneself', () => {
  const manager = employee([['MANAGE_SKILLS', A]]);
  assert.ok(canManageSkills(manager, member));
  assert.ok(canManageSkills(owner, member));
  assert.equal(canManageSkills(manager, { ...member, branchIds: [A, 'other'] }), false);
  assert.equal(canManageSkills(employee([['MANAGE_SKILLS', A]], [], member.id), member), false);
  const viewer = view(employee([['VIEW_EMPLOYEES', A]]));
  assert.ok(viewer.includes('<strong>Gội đầu</strong>'), 'readers still see the skills');
  assert.doesNotMatch(viewer, /id="grant-skill"|id="skill-reason"/);
  assert.ok(!viewer.includes(`>${vi.employees.revokeSkill}<`));
  const allHeld = view(owner, {
    catalog: { skills: [catalog.skills[0]!] },
  });
  assert.ok(allHeld.includes(vi.employees.skillsSection.allHeld));
  assert.ok(en.employees.skillsSection.intro.includes('not a role'));
});
