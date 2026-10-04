import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  FooterSocialNetwork,
  WebsiteFooterBlock,
  WebsiteShopInfoResponse,
} from '@lucy-spa/contracts';
import {
  footerBlockOf,
  formOfShopInfo,
  isHttpsLink,
  isSiteLink,
  newBlockId,
  newFooterBlock,
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
  footerBlocks: [],
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
    footerBlocks: [],
  });
  assert.deepEqual(shopInfoRequest(result.body, 3), { ...result.body, expectedVersion: 3 });
});

const social = (urls: Partial<Record<FooterSocialNetwork, string>>): WebsiteFooterBlock => ({
  id: newBlockId(),
  type: 'SOCIAL',
  visible: true,
  urls: {
    facebook: null,
    zalo: null,
    tiktok: null,
    instagram: null,
    youtube: null,
    messenger: null,
    ...urls,
  },
});

test('footer blocks: none by default, and a new block of each type starts empty and visible', () => {
  assert.deepEqual(base.footerBlocks, []);
  const types = ['SOCIAL', 'APP', 'TEXT', 'LINKS', 'IMAGE', 'SLOGAN'] as const;
  for (const type of types) {
    const block = newFooterBlock(type);
    assert.equal(block.type, type);
    assert.equal(block.visible, true);
    assert.match(block.id, /^[0-9a-f-]{36}$/);
  }
  // An empty new block is not valid yet (except the slogan, which has nothing to fill): the dialog keeps "Save" honest.
  for (const type of ['SOCIAL', 'APP', 'TEXT', 'LINKS', 'IMAGE'] as const) {
    assert.equal(footerBlockOf(newFooterBlock(type)), null, type);
  }
  assert.deepEqual(footerBlockOf({ id: 'x', type: 'SLOGAN', visible: false }), {
    id: 'x',
    type: 'SLOGAN',
    visible: false,
  });
});

test('footer blocks: https links only, at least one, both languages for text, 12 blocks at most', () => {
  assert.equal(isHttpsLink('https://facebook.com/lucyspa'), true);
  for (const bad of [
    'http://x.example',
    'javascript:alert(1)',
    '//evil.example',
    '/vi/services',
    'https://',
    'https://a b',
    `https://x.example/${'a'.repeat(300)}`,
  ]) {
    assert.equal(isHttpsLink(bad), false, bad);
  }
  assert.equal(isSiteLink('/vi/services'), true);
  assert.equal(isSiteLink('/{locale}/services'), true);
  assert.equal(isSiteLink('/services'), false);
  assert.equal(isSiteLink('//evil.example'), false);
  assert.equal(isSiteLink('data:text/html,x'), false);
  // Social: empty fields are none, at least one https link is needed.
  const cleaned = footerBlockOf(social({ facebook: ' https://facebook.com/lucyspa ', zalo: '  ' }));
  assert.equal(
    cleaned?.type === 'SOCIAL' ? cleaned.urls.facebook : '',
    'https://facebook.com/lucyspa',
  );
  assert.equal(cleaned?.type === 'SOCIAL' ? cleaned.urls.zalo : '', null);
  assert.equal(footerBlockOf(social({})), null);
  assert.equal(footerBlockOf(social({ tiktok: 'http://tiktok.com/x' })), null);
  // App: one https link is enough, the other may stay empty.
  const app = footerBlockOf({
    id: 'a',
    type: 'APP',
    visible: true,
    googlePlayUrl: 'https://play.google.com/x',
    appStoreUrl: '',
  });
  assert.equal(app?.type === 'APP' ? app.appStoreUrl : 'x', null);
  assert.equal(
    footerBlockOf({ id: 'a', type: 'APP', visible: true, googlePlayUrl: 'x', appStoreUrl: null }),
    null,
  );
  // Text: both languages, line breaks kept, 300 characters.
  const text = footerBlockOf({
    id: 't',
    type: 'TEXT',
    visible: true,
    textVi: ' Một  dòng\n\n\n\nHai ',
    textEn: 'One',
  });
  assert.equal(text?.type === 'TEXT' ? text.textVi : '', 'Một dòng\n\nHai');
  assert.equal(
    footerBlockOf({ id: 't', type: 'TEXT', visible: true, textVi: 'Một', textEn: '' }),
    null,
  );
  assert.equal(
    footerBlockOf({ id: 't', type: 'TEXT', visible: true, textVi: 'a'.repeat(301), textEn: 'b' }),
    null,
  );
  // The list: 12 at most.
  const many = Array.from({ length: 13 }, () => ({
    id: newBlockId(),
    type: 'SLOGAN' as const,
    visible: true,
  }));
  assert.equal(problem({ footerBlocks: many }), 'footerBlocks');
  assert.equal(problem({ footerBlocks: many.slice(0, 12) }), null);
});

test('footer blocks: a link list needs both title languages or none, and every link both names and an address', () => {
  const link = { labelVi: 'Dịch vụ', labelEn: 'Services', url: '/{locale}/services' };
  const list = (patch: object) => ({
    id: 'l',
    type: 'LINKS' as const,
    visible: true,
    titleVi: null,
    titleEn: null,
    items: [link],
    ...patch,
  });
  assert.notEqual(footerBlockOf(list({})), null);
  assert.notEqual(footerBlockOf(list({ titleVi: 'Khám phá', titleEn: 'Explore' })), null);
  assert.equal(footerBlockOf(list({ titleVi: 'Khám phá' })), null);
  assert.equal(footerBlockOf(list({ items: [] })), null);
  assert.equal(footerBlockOf(list({ items: Array.from({ length: 9 }, () => link) })), null);
  assert.equal(footerBlockOf(list({ items: [{ ...link, labelEn: '' }] })), null);
  assert.equal(footerBlockOf(list({ items: [{ ...link, url: 'http://x.example' }] })), null);
  assert.equal(footerBlockOf(list({ items: [{ ...link, labelVi: 'a'.repeat(41) }] })), null);
  // Image: a picture is required, its link is optional but must be safe.
  assert.equal(
    footerBlockOf({ id: 'i', type: 'IMAGE', visible: true, mediaId: '', linkUrl: null }),
    null,
  );
  assert.equal(
    footerBlockOf({
      id: 'i',
      type: 'IMAGE',
      visible: true,
      mediaId: 'm',
      linkUrl: 'javascript:alert(1)',
    }),
    null,
  );
  const image = footerBlockOf({
    id: 'i',
    type: 'IMAGE',
    visible: true,
    mediaId: 'm',
    linkUrl: ' ',
  });
  assert.equal(image?.type === 'IMAGE' ? image.linkUrl : 'x', null);
});

test('footer blocks: the saved request carries them cleaned, and a change in order or visibility counts as a change', () => {
  const first = social({ facebook: ' https://facebook.com/x ' });
  const second: WebsiteFooterBlock = { id: newBlockId(), type: 'SLOGAN', visible: true };
  const form = { ...base, footerBlocks: [first, second] };
  const result = shopInfoInputOf(form);
  assert.ok('body' in result);
  const sent = result.body.footerBlocks[0];
  assert.equal(sent?.type === 'SOCIAL' ? sent.urls.facebook : '', 'https://facebook.com/x');
  assert.equal(shopInfoChanged(form, base), true);
  assert.equal(shopInfoChanged({ ...form, footerBlocks: [second, first] }, form), true, 'order');
  assert.equal(
    shopInfoChanged({ ...form, footerBlocks: [first, { ...second, visible: false }] }, form),
    true,
    'visibility',
  );
  assert.equal(shopInfoChanged({ ...form, footerBlocks: [first, second] }, form), false);
  // A copy made by the form never shares nested lists with the response.
  const copy = formOfShopInfo({ ...response, footerBlocks: [first] });
  assert.notEqual(copy.footerBlocks[0], first);
  assert.deepEqual(copy.footerBlocks, [first]);
});

test('the server names the footer when it refuses a block, and a picture without alt text is the block or the hero', () => {
  assert.equal(
    shopInfoServerProblem({ code: 'VALIDATION_FAILED', field: 'footerBlocks' }),
    'footerBlocks',
  );
  assert.equal(
    shopInfoServerProblem({ code: 'MEDIA_ALT_REQUIRED', field: 'footerBlocks' }),
    'footerBlocks',
  );
  assert.equal(
    shopInfoServerProblem({ code: 'MEDIA_ALT_REQUIRED', field: 'heroMediaId' }),
    'heroMediaId',
  );
  assert.equal(shopInfoServerProblem({ code: 'MEDIA_ALT_REQUIRED' }), 'heroMediaId');
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
