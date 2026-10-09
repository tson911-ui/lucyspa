import type { CampaignDetailResponse, CampaignItemRow } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campaignDictionary } from '../../i18n/campaigns';
import { ApiError } from '../api/client';
import {
  activeTab,
  badgePreview,
  CAMPAIGN_DETAIL_DEFAULTS,
  CAMPAIGN_LIST_DEFAULTS,
  campaignDays,
  campaignErrorField,
  campaignErrorText,
  campaignPath,
  campaignTone,
  createRequest,
  emptyCreateDraft,
  firstProblemField,
  groupNumbers,
  groupRequest,
  infoDraftOf,
  infoEditRequest,
  isStaleVersion,
  isValidSlug,
  itemProblems,
  itemsQuery,
  moneyBound,
  normalizeCampaignDetail,
  normalizeCampaignList,
  pickerFilter,
  pickerFilterCount,
  pickerQuery,
  presentationDraftOf,
  presentationEditRequest,
  presentationProblems,
  priceRangeInvalid,
  publishBlocker,
  rangeText,
  ruleText,
  rulePreviewPrice,
  ruleValueValid,
  selectAll,
  suggestSlug,
  toggleSelected,
  validateCreate,
  validateInfo,
  withName,
  campaignListQuery,
} from './campaigns';

const NOW = new Date('2026-10-09T03:00:00.000Z');

test('the address suggestion drops accents, maps đ by hand, joins words with single hyphens and stays valid', () => {
  assert.equal(suggestSlug('Đồng giá mùa hè'), 'dong-gia-mua-he');
  assert.equal(suggestSlug('  Ngày hội  làm đẹp!! 2026 '), 'ngay-hoi-lam-dep-2026');
  assert.equal(suggestSlug('ĐẠI TIỆC'), 'dai-tiec');
  assert.equal(suggestSlug('***'), '');
  const long = suggestSlug('a'.repeat(59) + ' bbb ccc');
  assert.ok(long.length <= 60);
  assert.ok(!long.endsWith('-'));
  assert.ok(isValidSlug(suggestSlug('Giáng sinh sớm')));
  assert.ok(!isValidSlug('ab'));
  assert.ok(!isValidSlug('Has-Capitals'));
  assert.ok(!isValidSlug('double--hyphen'));
  assert.ok(!isValidSlug('-lead'));
  assert.ok(isValidSlug('abc'));
  assert.equal(campaignPath('giang-sinh-som', 'vi'), '/vi/products?campaign=giang-sinh-som');
});

test('the address follows the Vietnamese name until the person types in the address field', () => {
  let draft = emptyCreateDraft(NOW);
  draft = withName(draft, { nameVi: 'Đồng giá mùa hè' });
  assert.equal(draft.slug, 'dong-gia-mua-he');
  draft = withName(draft, { nameEn: 'Summer flat price' });
  assert.equal(draft.slug, 'dong-gia-mua-he', 'the English name does not touch the address');
  draft = { ...draft, slug: 'my-own', slugTouched: true };
  draft = withName(draft, { nameVi: 'Tên khác' });
  assert.equal(draft.slug, 'my-own');
});

test('the default period is tomorrow 08:00 to a week later 23:59 in Vietnam time', () => {
  const draft = emptyCreateDraft(NOW);
  assert.equal(draft.startsAt, '2026-10-10T08:00');
  assert.equal(draft.endsAt, '2026-10-17T23:59');
});

test('a create form is validated field by field and becomes the exact API request', () => {
  const draft = emptyCreateDraft(NOW);
  const problems = validateCreate(draft, NOW);
  assert.deepEqual(Object.keys(problems).sort(), ['nameEn', 'nameVi', 'slug']);
  assert.equal(firstProblemField(problems), 'slug');
  assert.equal(createRequest(draft, NOW), null);
  const ok = {
    ...draft,
    slug: 'ngay-hoi',
    nameVi: ' Ngày hội ',
    nameEn: 'Fair',
    note: '  ghi chú  ',
  };
  assert.deepEqual(validateCreate(ok, NOW), {});
  assert.deepEqual(createRequest(ok, NOW), {
    slug: 'ngay-hoi',
    nameVi: 'Ngày hội',
    nameEn: 'Fair',
    internalNote: 'ghi chú',
    startsAt: '2026-10-10T01:00:00.000Z',
    endsAt: '2026-10-17T16:59:00.000Z',
  });
  assert.equal(createRequest({ ...ok, note: '' }, NOW)?.internalNote, null);
  assert.equal(validateCreate({ ...ok, startsAt: '2026-10-09T09:00' }, NOW).startsAt, 'startsPast');
  assert.equal(validateCreate({ ...ok, endsAt: '2026-10-09T08:00' }, NOW).endsAt, 'endsBefore');
  assert.equal(validateCreate({ ...ok, startsAt: '' }, NOW).startsAt, 'startsAt');
  assert.equal(validateCreate({ ...ok, nameVi: 'x'.repeat(201) }, NOW).nameVi, 'nameVi');
  assert.equal(validateCreate({ ...ok, note: 'x'.repeat(2001) }, NOW).note, 'note');
});

const campaign = (patch: Partial<CampaignDetailResponse> = {}): CampaignDetailResponse => ({
  id: 'c1',
  slug: 'ngay-hoi',
  nameVi: 'Ngày hội',
  nameEn: 'Fair',
  internalNote: null,
  startsAt: '2026-10-20T01:00:00.000Z',
  endsAt: '2026-10-25T16:59:00.000Z',
  state: 'DRAFT',
  publishedAt: null,
  endedEarlyAt: null,
  endedEarlyReason: null,
  rowVersion: 4,
  badgeVi: null,
  badgeEn: null,
  headlineVi: null,
  headlineEn: null,
  messageVi: null,
  messageEn: null,
  ctaLabelVi: null,
  ctaLabelEn: null,
  bannerMediaId: null,
  bannerUrl: null,
  groups: [],
  review: {
    itemCount: 3,
    noDiscountCount: 1,
    overlapCount: 0,
    ownPromotionCount: 0,
    minPercent: 10,
    maxPercent: 20,
  },
  can: {
    edit: true,
    editPresentation: true,
    changeItems: true,
    publish: true,
    end: false,
    remove: true,
  },
  ...patch,
});

test('an info edit sends only the changed keys, and nothing when nothing changed', () => {
  const current = campaign();
  const initial = infoDraftOf(current);
  assert.equal(infoEditRequest(initial, current), null);
  assert.deepEqual(infoEditRequest({ ...initial, nameVi: ' Tên mới ' }, current), {
    expectedVersion: 4,
    nameVi: 'Tên mới',
  });
  assert.deepEqual(infoEditRequest({ ...initial, note: 'ghi chú' }, current), {
    expectedVersion: 4,
    internalNote: 'ghi chú',
  });
  const cleared = campaign({ internalNote: 'cũ' });
  assert.deepEqual(infoEditRequest({ ...infoDraftOf(cleared), note: '' }, cleared), {
    expectedVersion: 4,
    internalNote: null,
  });
  const moved = infoEditRequest({ ...initial, endsAt: '2026-10-28T10:00' }, current);
  assert.deepEqual(moved, { expectedVersion: 4, endsAt: '2026-10-28T03:00:00.000Z' });
  assert.ok(!('startsAt' in (moved ?? {})), 'an unchanged start is never sent');
});

test('an unchanged start or end in the past of an old draft is not flagged; a changed one is', () => {
  const current = campaign({
    startsAt: '2026-10-01T01:00:00.000Z',
    endsAt: '2026-10-05T01:00:00.000Z',
  });
  const initial = infoDraftOf(current);
  assert.deepEqual(validateInfo(initial, initial, NOW), {});
  assert.equal(
    validateInfo({ ...initial, startsAt: '2026-10-02T08:00' }, initial, NOW).startsAt,
    'startsPast',
  );
  assert.equal(
    validateInfo({ ...initial, endsAt: '2026-10-06T08:00' }, initial, NOW).endsAt,
    'endsPast',
  );
});

test('the presentation edit sends changed texts as text or null, the banner id, and refuses too-long texts', () => {
  const current = campaign({ badgeVi: '-20%', bannerMediaId: 'm1' });
  const initial = presentationDraftOf(current);
  assert.equal(presentationEditRequest(initial, current), null);
  assert.deepEqual(
    presentationEditRequest(
      { ...initial, badgeVi: '', headlineVi: ' Giảm sâu ', bannerMediaId: null },
      current,
    ),
    { expectedVersion: 4, badgeVi: null, headlineVi: 'Giảm sâu', bannerMediaId: null },
  );
  assert.deepEqual(
    presentationProblems({ ...initial, badgeEn: 'x'.repeat(25), ctaLabelVi: 'y'.repeat(41) }),
    ['badgeEn', 'ctaLabelVi'],
  );
  assert.equal(presentationEditRequest({ ...initial, badgeEn: 'x'.repeat(25) }, current), null);
  assert.equal(badgePreview(current, 'vi'), '-20%');
  assert.equal(badgePreview(current, 'en'), null);
});

test('rule values are whole numbers in range and the preview follows the shared arithmetic', () => {
  assert.ok(ruleValueValid({ kind: 'PERCENT', value: '90' }));
  assert.ok(!ruleValueValid({ kind: 'PERCENT', value: '91' }));
  assert.ok(!ruleValueValid({ kind: 'PERCENT', value: '0' }));
  assert.ok(!ruleValueValid({ kind: 'PERCENT', value: '' }));
  assert.ok(!ruleValueValid({ kind: 'AMOUNT', value: '007' }));
  assert.ok(ruleValueValid({ kind: 'AMOUNT', value: '1000000000' }));
  assert.ok(!ruleValueValid({ kind: 'AMOUNT', value: '1000000001' }));
  assert.ok(!ruleValueValid({ kind: 'PRICE', value: '12345678901' }));
  assert.equal(rulePreviewPrice({ kind: 'PERCENT', value: '10' }, '199999'), '180000');
  assert.equal(rulePreviewPrice({ kind: 'AMOUNT', value: '30000' }, '500000'), '470000');
  assert.equal(rulePreviewPrice({ kind: 'PRICE', value: '99000' }, '500000'), '99000');
  assert.equal(rulePreviewPrice({ kind: 'PRICE', value: '500000' }, '500000'), null, 'no discount');
  assert.equal(rulePreviewPrice({ kind: 'PERCENT', value: '' }, '500000'), null);
  assert.deepEqual(groupRequest({ kind: 'PERCENT', value: '20' }, 7), {
    expectedVersion: 7,
    rule: { kind: 'PERCENT', value: '20' },
  });
  assert.equal(ruleText({ kind: 'PERCENT', value: '20' }, 'vi'), 'Giảm 20%');
  assert.equal(ruleText({ kind: 'AMOUNT', value: '30000' }, 'vi'), 'Giảm 30.000 ₫');
  assert.equal(ruleText({ kind: 'PRICE', value: '99000' }, 'en'), 'Flat price 99,000 ₫');
});

test('groups are numbered 1, 2, 3 by order whatever the stored positions are', () => {
  const rule = { kind: 'PERCENT', value: '5' } as const;
  const numbers = groupNumbers([
    { id: 'b', position: 7, rule, itemCount: 0 },
    { id: 'a', position: 2, rule, itemCount: 0 },
  ]);
  assert.equal(numbers.get('a'), 1);
  assert.equal(numbers.get('b'), 2);
});

test('the list and page state are normalized and become the exact query strings of the API', () => {
  assert.deepEqual(normalizeCampaignList({ q: 'x'.repeat(100), state: 'WRONG', page: -3 }), {
    q: 'x'.repeat(80),
    state: '',
    page: 1,
  });
  assert.deepEqual(campaignListQuery(CAMPAIGN_LIST_DEFAULTS), { page: 1 });
  assert.deepEqual(campaignListQuery({ q: ' sale ', state: 'ACTIVE', page: 2 }), {
    page: 2,
    q: 'sale',
    state: 'ACTIVE',
  });
  const state = normalizeCampaignDetail({
    ...CAMPAIGN_DETAIL_DEFAULTS,
    tab: 'nope',
    problem: 'bad',
    min: '0012,5',
    max: '00',
    stock: 'yes',
    ppage: 0,
  });
  assert.equal(state.tab, '');
  assert.equal(state.problem, '');
  assert.equal(state.min, '125');
  assert.equal(state.max, '');
  assert.equal(state.stock, '');
  assert.equal(state.ppage, 1);
  assert.equal(moneyBound('1.234.567'), '1234567');
  assert.equal(moneyBound('12345678901234'), '1234567890');
});

test('the products list read carries only the set filters; the picker read and the add-all body agree on the filter', () => {
  assert.deepEqual(itemsQuery(CAMPAIGN_DETAIL_DEFAULTS), { page: 1 });
  assert.deepEqual(
    itemsQuery({
      ...CAMPAIGN_DETAIL_DEFAULTS,
      ipage: 3,
      iq: ' kem ',
      group: 'g1',
      problem: 'OVERLAP',
    }),
    { page: 3, q: 'kem', groupId: 'g1', problem: 'OVERLAP' },
  );
  assert.deepEqual(pickerQuery(CAMPAIGN_DETAIL_DEFAULTS), { page: 1 });
  const filtered = {
    ...CAMPAIGN_DETAIL_DEFAULTS,
    ppage: 2,
    pq: ' kem ',
    brand: 'b1',
    category: 'c1',
    min: '100000',
    max: '300000',
    stock: '1',
  };
  assert.deepEqual(pickerQuery(filtered), {
    page: 2,
    q: 'kem',
    brandId: 'b1',
    categoryId: 'c1',
    minPriceVnd: '100000',
    maxPriceVnd: '300000',
    inStockOnly: 'true',
  });
  assert.deepEqual(pickerFilter(filtered), {
    q: 'kem',
    brandId: 'b1',
    categoryId: 'c1',
    minPriceVnd: '100000',
    maxPriceVnd: '300000',
    inStockOnly: true,
  });
  assert.deepEqual(pickerFilter(CAMPAIGN_DETAIL_DEFAULTS), {});
  assert.equal(pickerFilterCount(filtered), 6);
  assert.ok(priceRangeInvalid({ min: '300000', max: '100000' }));
  assert.ok(!priceRangeInvalid({ min: '100000', max: '' }));
  assert.ok(!priceRangeInvalid({ min: '100000', max: '100000' }));
});

test('the picker tab falls back to the products tab when the campaign cannot change products', () => {
  const picker = { ...CAMPAIGN_DETAIL_DEFAULTS, tab: 'picker' };
  assert.equal(activeTab(picker, true), 'picker');
  assert.equal(activeTab(picker, false), 'items');
  assert.equal(activeTab(CAMPAIGN_DETAIL_DEFAULTS, true), 'items');
  assert.equal(activeTab({ ...CAMPAIGN_DETAIL_DEFAULTS, tab: 'info' }, false), 'info');
});

test('selection keeps order, ignores duplicates and never passes the limit of one add', () => {
  assert.deepEqual(toggleSelected(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleSelected(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleSelected(['a', 'b'], 'c', 2), ['a', 'b']);
  assert.deepEqual(selectAll(['a'], ['a', 'b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(selectAll(['a'], ['b', 'c', 'd'], 3), ['a', 'b', 'c']);
});

const item = (patch: Partial<CampaignItemRow> = {}): CampaignItemRow => ({
  variantId: 'v1',
  groupId: 'g1',
  sku: 'S1',
  productCode: 'p',
  productName: 'Kem',
  variantLabel: '50 ml',
  brandName: null,
  listPriceVnd: '100000',
  campaignPriceVnd: '80000',
  discountPercent: 20,
  otherCampaigns: [],
  hasOwnPromotion: false,
  ...patch,
});

test('item problems come from the row: no price, another campaign, an own promotion', () => {
  assert.deepEqual(itemProblems(item()), []);
  assert.deepEqual(
    itemProblems(
      item({
        campaignPriceVnd: null,
        discountPercent: null,
        otherCampaigns: [{ id: 'c2', nameVi: 'Khác', priceVnd: '70000' }],
        hasOwnPromotion: true,
      }),
    ),
    ['NO_DISCOUNT', 'OVERLAP', 'OWN_PROMOTION'],
  );
});

test('publishing is blocked, in the order the API checks it: start passed, empty, nothing discounted', () => {
  const pass = { startsAt: '2026-10-20T01:00:00.000Z' };
  assert.equal(publishBlocker({ ...campaign(), ...pass }, NOW), null);
  assert.equal(
    publishBlocker(campaign({ startsAt: '2026-10-01T01:00:00.000Z' }), NOW),
    'CAMPAIGN_START_PASSED',
  );
  const empty = campaign({ review: { ...campaign().review, itemCount: 0, noDiscountCount: 0 } });
  assert.equal(publishBlocker(empty, NOW), 'CAMPAIGN_EMPTY');
  const none = campaign({ review: { ...campaign().review, itemCount: 2, noDiscountCount: 2 } });
  assert.equal(publishBlocker(none, NOW), 'CAMPAIGN_NO_DISCOUNT');
  assert.equal(
    publishBlocker(campaign({ can: { ...campaign().can, publish: false } }), NOW),
    null,
    'a campaign that cannot be published has no blocker to show',
  );
  assert.equal(rangeText(campaign().review, 'vi'), '10% đến 20%');
  assert.equal(rangeText({ minPercent: 15, maxPercent: 15 }, 'vi'), '15%');
  assert.equal(rangeText({ minPercent: null, maxPercent: null }, 'vi'), '—');
});

test('tones and the by-day period', () => {
  assert.equal(campaignTone('ACTIVE'), 'success');
  assert.equal(campaignTone('SCHEDULED'), 'info');
  assert.equal(campaignTone('DRAFT'), 'neutral');
  assert.equal(campaignTone('ENDED'), 'neutral');
  assert.equal(
    campaignDays(
      { startsAt: '2026-10-09T17:30:00.000Z', endsAt: '2026-10-11T03:00:00.000Z' },
      'vi',
    ),
    '10/10/2026 đến 11/10/2026',
    'a UTC evening is already the next day in Vietnam',
  );
});

test('every error code of the campaign engine has a Vietnamese and an English text; a stale version is recognized', () => {
  const fallback = () => 'chung';
  for (const locale of ['vi', 'en'] as const) {
    for (const code of [
      'CONFLICT',
      'CAMPAIGN_SLUG_TAKEN',
      'CAMPAIGN_NOT_EDITABLE',
      'CAMPAIGN_ENDED',
      'CAMPAIGN_START_PASSED',
      'CAMPAIGN_EMPTY',
      'CAMPAIGN_NO_DISCOUNT',
      'CAMPAIGN_GROUP_LIMIT',
      'CAMPAIGN_VARIANT_NOT_SELLABLE',
    ]) {
      const text = campaignErrorText(new ApiError(409, code), locale, fallback);
      assert.notEqual(text, 'chung', `${locale} ${code}`);
      assert.ok(!/khám/i.test(text));
    }
  }
  const vi = campaignDictionary('vi');
  assert.equal(
    campaignErrorText(new ApiError(409, 'CAMPAIGN_SLUG_TAKEN', 'slug'), 'vi', fallback),
    vi.errors.CAMPAIGN_SLUG_TAKEN,
  );
  assert.equal(
    campaignErrorText(new ApiError(400, 'VALIDATION_FAILED', 'filter'), 'vi', fallback),
    vi.errors.filter,
  );
  assert.equal(
    campaignErrorText(new ApiError(400, 'VALIDATION_FAILED', 'slug'), 'vi', fallback),
    vi.problems.slug,
  );
  assert.equal(
    campaignErrorText(new ApiError(400, 'VALIDATION_FAILED', 'name'), 'vi', fallback),
    'chung',
  );
  assert.equal(campaignErrorText(new ApiError(500, 'HTTP_500'), 'vi', fallback), 'chung');
  assert.equal(campaignErrorText(new Error('x'), 'vi', fallback), 'chung');
  assert.ok(isStaleVersion(new ApiError(409, 'CONFLICT')));
  assert.ok(!isStaleVersion(new ApiError(409, 'CONFLICT', 'slug')));
  assert.ok(!isStaleVersion(new ApiError(409, 'CAMPAIGN_ENDED')));
  assert.equal(campaignErrorField(new ApiError(409, 'CAMPAIGN_SLUG_TAKEN', 'slug')), 'slug');
  assert.equal(campaignErrorField(new ApiError(400, 'VALIDATION_FAILED', 'endsAt')), 'endsAt');
  assert.equal(campaignErrorField(new ApiError(400, 'VALIDATION_FAILED', 'filter')), null);
});

test('the dictionaries have the same keys in both languages and no clinical wording', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix];
  assert.deepEqual(keys(campaignDictionary('vi')), keys(campaignDictionary('en')));
  assert.ok(!/khám/i.test(JSON.stringify(campaignDictionary('vi'))));
});
