import type {
  ProductAccess,
  ProductCategoryResponse,
  ProductListItem,
  ProductSettingsResponse,
  ProductVariantResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productDictionary } from '../../i18n/products';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import {
  allowedStatusMoves,
  brandCreateRequest,
  crumbLabel,
  canEndPromotion,
  canOpenCatalog,
  categoryCreateRequest,
  draftFromCategory,
  draftFromSettings,
  draftFromVariant,
  emptyProductDraft,
  emptyVariantDraft,
  filterProducts,
  leadTimeRange,
  marginText,
  movedImageIds,
  normalizeProductList,
  orderCategoryTree,
  parentOptions,
  parseLeadTime,
  PRODUCT_LIST_DEFAULTS,
  priceIssue,
  priceRangeText,
  priceRequest,
  productErrorText,
  productRequest,
  productSortValue,
  promotionRequest,
  settingsRequest,
  statusMoveKind,
  validatePromotionDraft,
  validateProductDraft,
  validateSettingsDraft,
  validateVariantDraft,
  variantActiveRequest,
  variantColumnKeys,
  variantCreateRequest,
  variantEditRequest,
  vndAmount,
} from './products';
import { errorMessage } from './workflows';

const NONE: ProductAccess = { manage: false, prices: false, cost: false };
const MANAGE: ProductAccess = { manage: true, prices: false, cost: false };
const ALL: ProductAccess = { manage: true, prices: true, cost: true };

const variant = (patch: Partial<ProductVariantResponse> = {}): ProductVariantResponse => ({
  id: 'v1',
  sku: 'SKU-1',
  labelVi: '50 ml',
  labelEn: null,
  barcode: null,
  lowStockThreshold: null,
  sellOnOrder: true,
  leadTimeDaysMin: null,
  leadTimeDaysMax: null,
  usualSupplier: null,
  sortOrder: 0,
  isActive: true,
  rowVersion: 3,
  listPriceVnd: '200000',
  priceVersionNo: 2,
  effectivePriceVnd: '200000',
  activePromotion: null,
  promotions: [],
  priceHistory: [],
  ...patch,
});

const listItem = (patch: Partial<ProductListItem> = {}): ProductListItem => ({
  id: 'p1',
  code: 'serum',
  nameVi: 'Tinh chất dưỡng',
  nameEn: 'Serum',
  status: 'DRAFT',
  featured: false,
  brand: { id: 'b1', nameVi: 'Thương hiệu A', nameEn: 'Brand A' },
  category: null,
  activeVariantCount: 1,
  priceFromVnd: '100000',
  priceToVnd: '250000',
  coverMediaId: null,
  rowVersion: 1,
  updatedAt: '2026-10-07T00:00:00.000Z',
  ...patch,
});

test('the catalog opens with the catalog or the price permission; cost columns need the cost permission', () => {
  assert.equal(canOpenCatalog(NONE), false);
  assert.equal(canOpenCatalog(MANAGE), true);
  assert.equal(canOpenCatalog({ manage: false, prices: true, cost: false }), true);
  // The cost permission alone does not open the catalog.
  assert.equal(canOpenCatalog({ manage: false, prices: false, cost: true }), false);
  assert.ok(!variantColumnKeys(MANAGE).includes('cost'));
  assert.ok(!variantColumnKeys(MANAGE).includes('margin'));
  assert.ok(variantColumnKeys(ALL).includes('cost'));
  assert.ok(variantColumnKeys(ALL).includes('margin'));
});

test('status moves follow the database: never back to draft', () => {
  assert.deepEqual(allowedStatusMoves('DRAFT'), ['PUBLISHED']);
  assert.deepEqual(allowedStatusMoves('PUBLISHED'), ['INACTIVE']);
  assert.deepEqual(allowedStatusMoves('INACTIVE'), ['PUBLISHED']);
  for (const status of ['DRAFT', 'PUBLISHED', 'INACTIVE'] as const) {
    assert.ok(!(allowedStatusMoves(status) as string[]).includes('DRAFT'));
  }
  assert.equal(statusMoveKind('DRAFT', 'PUBLISHED'), 'publish');
  assert.equal(statusMoveKind('INACTIVE', 'PUBLISHED'), 'resume');
  assert.equal(statusMoveKind('PUBLISHED', 'INACTIVE'), 'stop');
  assert.deepEqual(productDictionary('vi').status, {
    DRAFT: 'Nháp',
    PUBLISHED: 'Đang bán',
    INACTIVE: 'Ngừng bán',
  });
});

test('money is whole dong typed as digits, never a float', () => {
  assert.equal(vndAmount('120000'), '120000');
  assert.equal(vndAmount(' 120000 '), '120000');
  assert.equal(vndAmount('0'), null, 'a price is above zero');
  assert.equal(vndAmount('0', 0), '0', 'a cost may be zero');
  assert.equal(vndAmount('12.5'), null);
  assert.equal(vndAmount('1,000'), null);
  assert.equal(vndAmount('-5'), null);
  assert.equal(vndAmount(''), null);
  assert.equal(priceRangeText('100000', '100000', 'vi', 'x'), '100.000 ₫');
  assert.equal(priceRangeText('100000', '250000', 'vi', 'x'), '100.000 ₫ – 250.000 ₫');
  assert.equal(priceRangeText(null, null, 'vi', 'Chưa có giá'), 'Chưa có giá');
});

test('a margin is shown only when the API sent it', () => {
  assert.equal(marginText(variant(), 'vi'), '—');
  assert.equal(marginText(variant({ marginVnd: '110000' }), 'vi'), '110.000 ₫');
  assert.equal(marginText(variant({ marginVnd: '-5000' }), 'vi'), '-5.000 ₫');
});

test('list state: unknown values fall back, filters and sort work on names, brand, status and price', () => {
  const state = normalizeProductList({
    ...PRODUCT_LIST_DEFAULTS,
    tab: 'x',
    status: 'bad',
    sort: 'cost',
    dir: 'sideways',
    page: -3,
  });
  assert.equal(state.tab, 'products');
  assert.equal(state.status, '');
  assert.equal(state.sort, 'name', 'cost is not a sortable column');
  assert.equal(state.dir, 'asc');
  assert.equal(state.page, 1);
  const items = [
    listItem(),
    listItem({ id: 'p2', nameVi: 'Kem dưỡng', nameEn: 'Cream', status: 'PUBLISHED', brand: null }),
  ];
  const base = { q: '', brand: '', category: '', status: '' };
  assert.equal(filterProducts(items, { ...base, q: 'tinh chat' }).length, 1, 'accent-insensitive');
  assert.equal(filterProducts(items, { ...base, status: 'PUBLISHED' })[0]?.id, 'p2');
  assert.equal(filterProducts(items, { ...base, brand: 'b1' })[0]?.id, 'p1');
  assert.equal(productSortValue(items[0]!, 'price', 'vi'), 100000);
  assert.equal(productSortValue(listItem({ priceFromVnd: null }), 'price', 'vi'), -1);
});

test('a product needs both names; the English one is never copied from the Vietnamese one', () => {
  const draft = { ...emptyProductDraft(), nameVi: 'Tinh chất' };
  assert.deepEqual(validateProductDraft(draft), { nameEn: 'required' });
  assert.equal(productRequest(draft), null);
  const request = productRequest({ ...draft, nameEn: ' Serum ', brandId: 'b1', featured: true });
  assert.deepEqual(request, {
    nameVi: 'Tinh chất',
    nameEn: 'Serum',
    descriptionVi: null,
    descriptionEn: null,
    brandId: 'b1',
    categoryId: null,
    featured: true,
  });
  assert.equal(
    validateProductDraft({ ...draft, nameEn: 'a', descriptionVi: 'x'.repeat(2001) }).descriptionVi,
    'invalid',
  );
});

test('brand and category requests', () => {
  assert.equal(brandCreateRequest({ nameVi: '', nameEn: 'A', isActive: true }), null);
  assert.deepEqual(brandCreateRequest({ nameVi: ' Hãng ', nameEn: 'Brand', isActive: true }), {
    nameVi: 'Hãng',
    nameEn: 'Brand',
  });
  const draft = { ...draftFromCategory(null), nameVi: 'Dưỡng da', nameEn: 'Skin care' };
  assert.deepEqual(categoryCreateRequest(draft), {
    parentId: null,
    nameVi: 'Dưỡng da',
    nameEn: 'Skin care',
    sortOrder: 0,
  });
  assert.equal(categoryCreateRequest({ ...draft, sortOrder: 'x' }), null);
});

const category = (patch: Partial<ProductCategoryResponse>): ProductCategoryResponse => ({
  id: 'c',
  parentId: null,
  code: 'c',
  nameVi: 'C',
  nameEn: 'C',
  sortOrder: 0,
  isActive: true,
  rowVersion: 1,
  productCount: 0,
  ...patch,
});

test('categories have two levels: only roots are offered as parents, a parent never gets a parent', () => {
  const root = category({ id: 'r', code: 'a-root' });
  const child = category({ id: 'k', code: 'b-child', parentId: 'r' });
  const other = category({ id: 'o', code: 'c-other', sortOrder: 5 });
  const stopped = category({ id: 's', code: 'd-stopped', isActive: false });
  assert.deepEqual(
    parentOptions([root, child, other, stopped], null).map((entry) => entry.id),
    ['r', 'o'],
  );
  // Editing a root that has children: it can only stay a root.
  assert.deepEqual(parentOptions([root, child, other], root), []);
  // Editing a child: not itself, roots only.
  assert.deepEqual(
    parentOptions([root, child, other], child).map((entry) => entry.id),
    ['r', 'o'],
  );
  assert.deepEqual(
    orderCategoryTree([other, child, root]).map((entry) => entry.id),
    ['r', 'k', 'o'],
  );
});

test('a new variant sends a price only to a price holder and a cost only to a cost holder', () => {
  const draft = {
    ...emptyVariantDraft(),
    sku: 'ab-1',
    labelVi: '50 ml',
    threshold: '5',
    listPrice: '150000',
    cost: '90000',
  };
  const manage = variantCreateRequest(draft, MANAGE)!;
  assert.equal(manage.sku, 'AB-1', 'SKU is upper case');
  assert.ok(!('listPriceVnd' in manage));
  assert.ok(!('costPriceVnd' in manage));
  assert.equal(manage.lowStockThreshold, 5);
  const prices = variantCreateRequest(draft, { manage: true, prices: true, cost: false })!;
  assert.equal(prices.listPriceVnd, '150000');
  assert.ok(!('costPriceVnd' in prices));
  const full = variantCreateRequest(draft, ALL)!;
  assert.equal(full.costPriceVnd, '90000');
  assert.equal(variantCreateRequest({ ...draft, sku: 'bad sku' }, ALL), null);
  assert.equal(variantCreateRequest({ ...draft, sku: '' }, ALL), null);
});

test('a new variant is sold on order by default, with the settings waiting time', () => {
  const draft = { ...emptyVariantDraft(), sku: 'ab-2' };
  assert.equal(draft.sellOnOrder, true, 'on by default (OQ-P6-30)');
  const request = variantCreateRequest(draft, MANAGE)!;
  assert.equal(request.sellOnOrder, true);
  assert.equal(request.leadTimeDaysMin, null);
  assert.equal(request.leadTimeDaysMax, null);
  const own = variantCreateRequest({ ...draft, leadMin: '3', leadMax: '5' }, MANAGE)!;
  assert.deepEqual([own.leadTimeDaysMin, own.leadTimeDaysMax], [3, 5]);
  // Switching the flag off drops a waiting time of its own.
  const off = variantCreateRequest(
    { ...draft, sellOnOrder: false, leadMin: '3', leadMax: '5' },
    MANAGE,
  )!;
  assert.equal(off.sellOnOrder, false);
  assert.deepEqual([off.leadTimeDaysMin, off.leadTimeDaysMax], [null, null]);
});

test('the waiting time is both boxes or neither, 1 to 90 days, from not above to', () => {
  assert.equal(parseLeadTime('', ''), 'empty');
  assert.deepEqual(parseLeadTime('1', '90'), { min: 1, max: 90 });
  assert.deepEqual(parseLeadTime(' 4 ', '4'), { min: 4, max: 4 });
  for (const [min, max] of [
    ['3', ''],
    ['', '5'],
    ['0', '5'],
    ['1', '91'],
    ['6', '5'],
    ['1.5', '5'],
    ['a', '5'],
    ['-1', '5'],
  ] as const) {
    assert.equal(parseLeadTime(min, max), null, `${min}-${max}`);
  }
  const draft = { ...emptyVariantDraft(), sku: 'AB-3', leadMin: '9', leadMax: '3' };
  assert.equal(variantCreateRequest(draft, MANAGE), null);
  assert.equal(validateVariantDraft(draft, { creating: true, ...MANAGE }).leadTime, 'invalid');
  // A bad waiting time does not block a variant that is not sold on order (the boxes are hidden then).
  assert.ok(variantCreateRequest({ ...draft, sellOnOrder: false }, MANAGE));
});

test('editing a variant sends the flag and the waiting time it holds', () => {
  const stored = variant({ sellOnOrder: false, leadTimeDaysMin: 2, leadTimeDaysMax: 4 });
  const draft = draftFromVariant(stored);
  assert.equal(draft.sellOnOrder, false);
  assert.deepEqual([draft.leadMin, draft.leadMax], ['2', '4']);
  const request = variantEditRequest({ ...draft, sellOnOrder: true }, stored, MANAGE)!;
  assert.equal(request.sellOnOrder, true);
  assert.deepEqual([request.leadTimeDaysMin, request.leadTimeDaysMax], [2, 4]);
  const cleared = variantEditRequest(
    { ...draft, sellOnOrder: true, leadMin: '', leadMax: '' },
    stored,
    MANAGE,
  )!;
  assert.deepEqual([cleared.leadTimeDaysMin, cleared.leadTimeDaysMax], [null, null]);
});

const SETTINGS: ProductSettingsResponse = {
  leadTimeDaysMin: 3,
  leadTimeDaysMax: 5,
  expiryWarningDays: 90,
  newBadgeDays: 30,
  publicPage: {
    heroMediaId: null,
    heroTitleVi: null,
    heroTitleEn: null,
    heroTextVi: null,
    heroTextEn: null,
    commitmentTitleVi: null,
    commitmentTitleEn: null,
    commitmentItems: [],
  },
  rowVersion: 4,
  access: { manage: true, prices: false, cost: false },
};

test('the settings request carries only what changed and refuses a bad draft', () => {
  const draft = draftFromSettings(SETTINGS);
  assert.deepEqual(draft, { leadMin: '3', leadMax: '5', expiry: '90', badge: '30' });
  assert.equal(settingsRequest(draft, SETTINGS, ['lead', 'expiry']), null, 'nothing changed');
  assert.deepEqual(settingsRequest({ ...draft, leadMin: '2', leadMax: '6' }, SETTINGS, ['lead']), {
    expectedRowVersion: 4,
    leadTimeDaysMin: 2,
    leadTimeDaysMax: 6,
  });
  assert.deepEqual(settingsRequest({ ...draft, expiry: '120' }, SETTINGS, ['expiry']), {
    expectedRowVersion: 4,
    expiryWarningDays: 120,
  });
  assert.deepEqual(settingsRequest({ ...draft, badge: '14' }, SETTINGS, ['lead', 'badge']), {
    expectedRowVersion: 4,
    newBadgeDays: 14,
  });
  for (const badge of ['0', '366', '1.5', '', 'x']) {
    assert.equal(validateSettingsDraft({ ...draft, badge }, ['badge']).badge, 'invalid', badge);
  }
  assert.equal(validateSettingsDraft({ ...draft, badge: '365' }, ['badge']).badge, undefined);
  // A field the screen does not offer is never sent, even when the draft differs.
  assert.equal(settingsRequest({ ...draft, expiry: '120' }, SETTINGS, ['lead']), null);
  for (const bad of [
    { ...draft, leadMin: '', leadMax: '' },
    { ...draft, leadMin: '8', leadMax: '2' },
  ]) {
    assert.equal(settingsRequest(bad, SETTINGS, ['lead']), null);
    assert.equal(validateSettingsDraft(bad, ['lead']).lead, 'invalid');
  }
  for (const expiry of ['0', '731', '1.5', '', 'x']) {
    assert.equal(validateSettingsDraft({ ...draft, expiry }, ['expiry']).expiry, 'invalid', expiry);
  }
  assert.equal(validateSettingsDraft({ ...draft, expiry: '730' }, ['expiry']).expiry, undefined);
});

test('a variant shows its own waiting time, else the settings default', () => {
  assert.deepEqual(leadTimeRange({ leadTimeDaysMin: 2, leadTimeDaysMax: 4 }, SETTINGS), {
    min: 2,
    max: 4,
  });
  assert.deepEqual(leadTimeRange({ leadTimeDaysMin: null, leadTimeDaysMax: null }, SETTINGS), {
    min: 3,
    max: 5,
  });
  assert.equal(leadTimeRange({ leadTimeDaysMin: null, leadTimeDaysMax: null }, null), null);
});

test('editing a variant leaves an unchanged or inaccessible cost out of the request', () => {
  const stored = variant({ costPriceVnd: '90000' });
  const draft = {
    ...emptyVariantDraft(),
    sku: stored.sku,
    labelVi: '75 ml',
    cost: '90000',
    sortOrder: '0',
  };
  const withoutCostRight = variantEditRequest({ ...draft, cost: '1' }, stored, MANAGE)!;
  assert.ok(!('costPriceVnd' in withoutCostRight));
  assert.equal(withoutCostRight.labelVi, '75 ml');
  assert.equal(withoutCostRight.expectedRowVersion, 3);
  assert.ok(
    !('costPriceVnd' in variantEditRequest(draft, stored, ALL)!),
    'unchanged cost is not sent',
  );
  assert.equal(variantEditRequest({ ...draft, cost: '95000' }, stored, ALL)!.costPriceVnd, '95000');
  assert.equal(variantEditRequest({ ...draft, cost: '' }, stored, ALL)!.costPriceVnd, null);
  // Switching a variant on or off sends nothing about cost, price or SKU.
  const toggle = variantActiveRequest(stored, false);
  assert.equal(toggle.isActive, false);
  assert.ok(!('costPriceVnd' in toggle));
});

test('a list price change needs a new valid amount and carries the version the editor saw', () => {
  const current = variant();
  assert.equal(priceIssue({ price: '', reason: '' }, current), 'required');
  assert.equal(priceIssue({ price: 'abc', reason: '' }, current), 'invalid');
  assert.equal(priceIssue({ price: '200000', reason: '' }, current), 'same');
  assert.equal(priceRequest({ price: '200000', reason: '' }, current), null);
  assert.deepEqual(priceRequest({ price: '220000', reason: ' đổi mùa ' }, current), {
    expectedVersionNo: 2,
    listPriceVnd: '220000',
    reason: 'đổi mùa',
  });
});

test('a promotion must be below the list price, end after it starts and not already be over', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  const current = variant();
  const ok = { price: '150000', startsAt: '2026-10-08T09:00', endsAt: '2026-10-10T09:00' };
  assert.deepEqual(validatePromotionDraft(ok, current, now), {});
  assert.equal(validatePromotionDraft({ ...ok, price: '200000' }, current, now).price, 'tooHigh');
  assert.equal(validatePromotionDraft({ ...ok, price: '250000' }, current, now).price, 'tooHigh');
  assert.equal(validatePromotionDraft({ ...ok, price: '' }, current, now).price, 'required');
  assert.equal(
    validatePromotionDraft({ ...ok, endsAt: '2026-10-08T08:00' }, current, now).endsAt,
    'window',
  );
  assert.equal(
    validatePromotionDraft(
      { ...ok, startsAt: '2026-10-01T09:00', endsAt: '2026-10-02T09:00' },
      current,
      now,
    ).endsAt,
    'window',
    'already over',
  );
  assert.equal(
    validatePromotionDraft(ok, variant({ listPriceVnd: null }), now).price,
    'noListPrice',
  );
  const request = promotionRequest(ok, current, now)!;
  // The form is in Vietnam time (UTC+7).
  assert.equal(request.startsAt, '2026-10-08T02:00:00.000Z');
  assert.equal(request.promoPriceVnd, '150000');
  assert.equal(promotionRequest({ ...ok, price: '300000' }, current, now), null);
  assert.equal(canEndPromotion({ state: 'ENDED' } as never), false);
  assert.equal(canEndPromotion({ state: 'SCHEDULED' } as never), true);
});

test('moving an image swaps neighbours and never leaves the list', () => {
  assert.deepEqual(movedImageIds(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(movedImageIds(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
  assert.equal(movedImageIds(['a', 'b', 'c'], 0, -1), null);
  assert.equal(movedImageIds(['a', 'b', 'c'], 2, 1), null);
});

test('API errors map to plain Vietnamese and English texts of their own', () => {
  const t = getWorkforceDictionary('vi');
  const fallback = (error: unknown) => errorMessage(error, t);
  const codes = [
    'PRODUCT_STATUS_INVALID',
    'PRODUCT_PUBLISH_INCOMPLETE',
    'PRODUCT_LAST_PRICED_VARIANT',
    'PRODUCT_PRICE_BELOW_PROMOTION',
    'PRODUCT_PROMOTION_PRICE_INVALID',
    'PRODUCT_PROMOTION_EXPIRED',
    'PRODUCT_PROMOTION_OVERLAP',
    'PRODUCT_CATEGORY_DEPTH',
    'MEDIA_ALT_REQUIRED',
  ];
  for (const locale of ['vi', 'en'] as const) {
    const texts = productDictionary(locale).errors as Record<string, string>;
    for (const code of codes) {
      assert.ok(texts[code], `${locale} ${code}`);
      assert.equal(productErrorText(new ApiError(409, code), locale, fallback), texts[code]);
    }
  }
  const vi = productDictionary('vi').errors;
  assert.equal(productErrorText(new ApiError(409, 'CONFLICT', 'sku'), 'vi', fallback), vi.sku);
  assert.equal(
    productErrorText(new ApiError(409, 'CONFLICT', 'barcode'), 'vi', fallback),
    vi.barcode,
  );
  assert.equal(productErrorText(new ApiError(409, 'CONFLICT'), 'vi', fallback), vi.conflict);
  assert.equal(
    productErrorText(new ApiError(403, 'FORBIDDEN'), 'vi', fallback),
    t.errors.forbidden,
  );
  assert.equal(productErrorText(new Error('x'), 'vi', fallback), t.errors.unexpected);
});

test('no Vietnamese text uses the word for a medical examination', () => {
  assert.ok(!JSON.stringify(productDictionary('vi')).toLowerCase().includes('khám'));
});

test('the current breadcrumb is one short line: a long name is cut with an ellipsis', () => {
  assert.equal(crumbLabel('Ngắn'), 'Ngắn');
  const long = 'Tinh chất dưỡng ẩm chuyên sâu cho làn da nhạy cảm và khô ráp';
  const cut = crumbLabel(long);
  assert.ok(cut.endsWith('…'));
  assert.ok([...cut].length <= 33);
  assert.ok(long.startsWith(cut.slice(0, -1)));
});
