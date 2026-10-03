import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebsiteShopInfoResponse } from '@lucy-spa/contracts';
import {
  formOfShopInfo,
  shopInfoChanged,
  shopInfoInputOf,
  shopInfoRequest,
  shopInfoServerProblem,
  type ShopInfoForm,
} from './shop-info';

const response: WebsiteShopInfoResponse = {
  taglineVi: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
  taglineEn: 'Heartfelt Relaxation – Elevated Beauty',
  introVi: null,
  introEn: null,
  address: '04 Nguyễn Quang Bích, Đà Nẵng',
  hotline: '0934 936 101',
  mapUrl: null,
  hoursBranchId: null,
  heroMediaId: null,
  factsVisible: true,
  facts: [
    { id: 'hours', kind: 'HOURS', visible: true, icon: null, textVi: null, textEn: null },
    { id: 'address', kind: 'ADDRESS', visible: true, icon: null, textVi: null, textEn: null },
    { id: 'hotline', kind: 'HOTLINE', visible: true, icon: null, textVi: null, textEn: null },
  ],
  featuredGroups: [],
  whyVisible: false,
  whyTitleVi: null,
  whyTitleEn: null,
  whyCards: [],
  groupOptions: [],
  rowVersion: 3,
  updatedAt: '2026-10-03T00:00:00.000Z',
  branches: [],
  hoursBranch: null,
  hours: [],
  timezone: null,
};

const base = formOfShopInfo(response);
const problem = (patch: Partial<ShopInfoForm>) => {
  const result = shopInfoInputOf({ ...base, ...patch });
  return 'problem' in result ? result.problem : null;
};

test('the form mirrors the stored profile and sends null for what is empty', () => {
  assert.equal(base.mapUrl, '');
  assert.equal(base.hoursBranchId, '');
  const result = shopInfoInputOf(base);
  assert.ok('body' in result);
  assert.deepEqual(result.body, {
    taglineVi: response.taglineVi,
    taglineEn: response.taglineEn,
    introVi: null,
    introEn: null,
    address: response.address,
    hotline: '0934 936 101',
    mapUrl: null,
    hoursBranchId: null,
    heroMediaId: null,
    factsVisible: true,
    facts: response.facts,
    featuredGroups: [],
    whyVisible: false,
    whyTitleVi: null,
    whyTitleEn: null,
    whyCards: [],
  });
  assert.deepEqual(shopInfoRequest(result.body, 3), { ...result.body, expectedVersion: 3 });
});

test('text is trimmed and collapsed, the optional link and branch are sent when set', () => {
  const result = shopInfoInputOf({
    ...base,
    taglineVi: '  Thư   Giãn ',
    mapUrl: ' https://maps.example.com/?q=Lucy+Spa ',
    hoursBranchId: 'b1',
    heroMediaId: 'm1',
  });
  assert.ok('body' in result);
  assert.equal(result.body.taglineVi, 'Thư Giãn');
  assert.equal(result.body.mapUrl, 'https://maps.example.com/?q=Lucy+Spa');
  assert.equal(result.body.hoursBranchId, 'b1');
  assert.equal(result.body.heroMediaId, 'm1');
});

test('the introduction is optional: empty is sent as null, text is cleaned, over 200 characters is named', () => {
  assert.equal(base.introVi, '');
  const set = shopInfoInputOf({ ...base, introVi: '  Mở   cửa mỗi ngày ', introEn: 'Welcome' });
  assert.ok('body' in set);
  assert.equal(set.body.introVi, 'Mở cửa mỗi ngày');
  assert.equal(set.body.introEn, 'Welcome');
  assert.equal(formOfShopInfo({ ...response, introEn: 'Welcome' }).introEn, 'Welcome');
  assert.equal(problem({ introVi: 'x'.repeat(200) }), null);
  assert.equal(problem({ introVi: 'x'.repeat(201) }), 'introVi');
  assert.equal(problem({ introEn: 'x'.repeat(201) }), 'introEn');
});

test('the first invalid field is named', () => {
  assert.equal(problem({ taglineVi: '  ' }), 'taglineVi');
  assert.equal(problem({ taglineEn: 'x'.repeat(121) }), 'taglineEn');
  assert.equal(problem({ address: '' }), 'address');
  assert.equal(problem({ hotline: 'call us' }), 'hotline');
  assert.equal(problem({ hotline: '12345' }), 'hotline');
  assert.equal(problem({ mapUrl: 'http://maps.example.com' }), 'mapUrl');
  assert.equal(problem({ mapUrl: 'https://' }), 'mapUrl');
  assert.equal(problem({ taglineVi: '', address: '' }), 'taglineVi');
});

test('changed ignores whitespace-only edits', () => {
  assert.equal(shopInfoChanged(base, { ...base, address: `  ${base.address}  ` }), false);
  assert.equal(shopInfoChanged(base, { ...base, hotline: '0934 936 102' }), true);
  assert.equal(shopInfoChanged(base, { ...base, heroMediaId: 'm1' }), true);
});

test('server refusals map to a field', () => {
  assert.equal(shopInfoServerProblem({ code: 'VALIDATION_FAILED', field: 'hotline' }), 'hotline');
  assert.equal(
    shopInfoServerProblem({ code: 'MEDIA_ALT_REQUIRED', field: 'heroMediaId' }),
    'heroMediaId',
  );
  assert.equal(
    shopInfoServerProblem({ code: 'VALIDATION_FAILED', field: 'expectedVersion' }),
    null,
  );
  assert.equal(shopInfoServerProblem({ code: 'CONFLICT' }), null);
  assert.equal(shopInfoServerProblem(new Error('x')), null);
  assert.equal(shopInfoServerProblem(null), null);
});

const customFact = (patch: object = {}) => ({
  id: '8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d10',
  kind: 'CUSTOM' as const,
  visible: true,
  icon: 'sparkles' as const,
  textVi: 'Miễn phí gửi xe',
  textEn: 'Free parking',
  ...patch,
});

test('facts strip: a custom line needs both languages within 80 characters; built-ins carry no text', () => {
  assert.equal(problem({ facts: [...base.facts, customFact()] }), null);
  assert.equal(problem({ facts: [...base.facts, customFact({ textEn: ' ' })] }), 'facts');
  assert.equal(
    problem({ facts: [...base.facts, customFact({ textVi: 'x'.repeat(81) })] }),
    'facts',
  );
  assert.equal(problem({ facts: [...base.facts, customFact({ icon: null })] }), 'facts');
  const sent = shopInfoInputOf({
    ...base,
    factsVisible: false,
    facts: [customFact({ textVi: '  Miễn  phí  gửi xe ' }), ...base.facts],
  });
  assert.ok('body' in sent);
  assert.equal(sent.body.factsVisible, false);
  assert.equal(sent.body.facts[0]?.textVi, 'Miễn phí gửi xe');
  assert.equal(sent.body.facts.length, 4);
});

test('featured groups: descriptions are optional, cleaned, and at most 120 characters', () => {
  const group = (patch: object = {}) => ({
    code: 'NAIL',
    descriptionVi: '  Móng   gọn gàng ',
    descriptionEn: '',
    ...patch,
  });
  const sent = shopInfoInputOf({ ...base, featuredGroups: [group()] });
  assert.ok('body' in sent);
  assert.deepEqual(sent.body.featuredGroups, [
    { code: 'NAIL', descriptionVi: 'Móng gọn gàng', descriptionEn: null },
  ]);
  assert.equal(
    problem({ featuredGroups: [group({ descriptionVi: 'x'.repeat(121) })] }),
    'featuredGroups',
  );
});

test('why section: off and empty is sent as is; turning it on needs both titles and a card with all four texts', () => {
  const card = (patch: object = {}) => ({
    id: '3b1d6c0a-7a5e-4e55-8a0b-0c4b0b6b9a11',
    icon: 'leaf' as const,
    headingVi: 'Dụng cụ sạch',
    headingEn: 'Clean tools',
    descriptionVi: 'Mỗi khách một bộ.',
    descriptionEn: 'One set per guest.',
    ...patch,
  });
  assert.equal(base.whyVisible, false);
  assert.equal(base.whyTitleVi, '');
  assert.equal(problem({ whyVisible: true }), 'whyTitleVi');
  assert.equal(problem({ whyVisible: true, whyTitleVi: 'Vì sao' }), 'whyTitleEn');
  assert.equal(problem({ whyVisible: true, whyTitleVi: 'Vì sao', whyTitleEn: 'Why' }), 'whyCards');
  assert.equal(
    problem({ whyVisible: true, whyTitleVi: 'Vì sao', whyTitleEn: 'Why', whyCards: [card()] }),
    null,
  );
  // Off, a half-written section may be saved (a draft), but a card that is filled in must still be valid.
  assert.equal(problem({ whyCards: [card({ descriptionEn: '' })] }), 'whyCards');
  assert.equal(problem({ whyCards: [card({ headingVi: 'x'.repeat(61) })] }), 'whyCards');
  assert.equal(problem({ whyCards: [card({ descriptionVi: 'x'.repeat(201) })] }), 'whyCards');
  assert.equal(problem({ whyTitleVi: 'x'.repeat(81) }), 'whyTitleVi');
});

test('changes in the lists count as unsaved changes, and only real ones', () => {
  assert.equal(shopInfoChanged(base, formOfShopInfo(response)), false);
  assert.equal(shopInfoChanged(base, { ...base, factsVisible: false }), true);
  assert.equal(shopInfoChanged(base, { ...base, facts: [...base.facts].reverse() }), true);
  assert.equal(shopInfoChanged(base, { ...base, whyVisible: true }), true);
  assert.equal(shopInfoChanged(base, { ...base, whyTitleVi: '  ' }), false);
});
