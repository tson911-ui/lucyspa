import type { SupplierCandidateDetail } from '@lucy-spa/contracts';
import { applyUrlPatch } from '@lucy-spa/ui';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supplierImportsDictionary } from '../../i18n/supplier-imports';
import { ApiError } from './api';
import {
  draftOf,
  duplicateMatches,
  editRequest,
  IMPORT_FILTERS,
  IMPORT_LIST_DEFAULTS,
  IMPORT_PAGE_KEYS,
  IMPORT_WARNING_FILTERS,
  importErrorText,
  importListQuery,
  isImportConflict,
  isOpen,
  LUCY_SKU,
  mappingTexts,
  normalizeImportList,
  pictureUrl,
  stateTone,
  suggestionFor,
  validateDraft,
  warningText,
} from './supplier-imports';

const detail = (patch: Partial<SupplierCandidateDetail> = {}): SupplierCandidateDetail => ({
  id: 'c1',
  state: 'NEEDS_REVIEW',
  rowVersion: 3,
  supplier: { id: 's1', name: 'Haru Ohui' },
  nameVi: 'Kem dưỡng A',
  nameEn: 'Kem dưỡng A',
  needsTranslation: true,
  descriptionVi: 'Mô tả',
  descriptionEn: null,
  brandId: null,
  categoryId: null,
  proposedSku: 'nuoc-hoa-hong',
  warnings: [
    { code: 'SKU_FORMAT', sku: 'nuoc-hoa-hong', upperCaseWouldBe: 'NUOC-HOA-HONG' },
    {
      code: 'BRAND_UNMAPPED',
      texts: ['OHUI', 'Kem Dưỡng'],
      suggestions: [{ id: 'b1', name: 'OHUI' }],
    },
    { code: 'CATEGORY_UNMAPPED', texts: ['Kem Dưỡng'], suggestions: [] },
    {
      code: 'POSSIBLE_DUPLICATE',
      matches: [
        { kind: 'PRODUCT', productId: 'p1', name: 'Kem dưỡng A' },
        { kind: 'CANDIDATE', candidateId: 'c2', name: 'Kem dưỡng A 50ml' },
        { kind: 'PRODUCT' },
        'junk',
      ],
    },
  ],
  source: {
    sourceId: 'src1',
    sourceName: 'Website haruohui.com',
    sourceKey: '101',
    url: 'https://haruohui.com/san-pham/101/',
    name: 'Kem dưỡng A',
    sku: 'nuoc-hoa-hong',
    categoryNames: ['OHUI', 'Kem Dưỡng'],
    brandText: null,
  },
  images: [],
  brands: [{ id: 'b1', name: 'OHUI' }],
  categories: [{ id: 'k1', name: 'Kem dưỡng' }],
  approval: { canApprove: false, blockers: ['SKU_INVALID', 'DUPLICATE_UNRESOLVED'] },
  decided: null,
  canSeePrices: false,
  ...patch,
});

test('the list state keeps to known values and builds the server query', () => {
  assert.deepEqual(
    normalizeImportList({ filter: 'WHATEVER', warning: 'bad code', page: -3, review: 'x' }),
    { filter: 'OPEN', warning: '', page: 1, review: '' },
  );
  assert.deepEqual(
    normalizeImportList({
      filter: 'READY_FOR_REVIEW',
      warning: 'SKU_FORMAT',
      page: 2,
      review: '8b195417-e076-45d3-a262-97fefb8e7d15',
    }),
    {
      filter: 'READY_FOR_REVIEW',
      warning: 'SKU_FORMAT',
      page: 2,
      review: '8b195417-e076-45d3-a262-97fefb8e7d15',
    },
  );
  assert.deepEqual(importListQuery({ filter: 'OPEN', warning: '', page: 1, review: '' }), {
    page: 1,
    state: 'OPEN',
  });
  assert.deepEqual(
    importListQuery({
      filter: 'IMPORTED',
      warning: 'IMAGE_SHARED',
      page: 3,
      review: '',
    }),
    {
      page: 3,
      state: 'IMPORTED',
      warning: 'IMAGE_SHARED',
    },
  );
  assert.ok(IMPORT_FILTERS.includes('OPEN') && IMPORT_WARNING_FILTERS.includes('SKU_FORMAT'));
});

test('opening a candidate keeps the filter and the page; a new filter returns to page 1 and closes it', () => {
  const state = { filter: 'IMPORTED', warning: 'SKU_FORMAT', page: 3, review: '' };
  const opened = applyUrlPatch(
    state,
    { review: '8b195417-e076-45d3-a262-97fefb8e7d15' },
    IMPORT_LIST_DEFAULTS,
    IMPORT_PAGE_KEYS,
  );
  assert.deepEqual(opened, { ...state, review: '8b195417-e076-45d3-a262-97fefb8e7d15' });
  const refiltered = applyUrlPatch(
    opened,
    { filter: 'OPEN' },
    IMPORT_LIST_DEFAULTS,
    IMPORT_PAGE_KEYS,
  );
  assert.deepEqual(refiltered, { filter: 'OPEN', warning: 'SKU_FORMAT', page: 1, review: '' });
  const paged = applyUrlPatch(state, { page: 4 }, IMPORT_LIST_DEFAULTS, IMPORT_PAGE_KEYS);
  assert.deepEqual(paged, { ...state, page: 4 });
});

test('the SKU shape is exactly the database rule: nothing is upper-cased or repaired', () => {
  for (const ok of ['A', 'KD-101', '50709298', 'A'.repeat(64)]) assert.ok(LUCY_SKU.test(ok), ok);
  for (const bad of ['', 'kd-101', 'ten san pham', 'Á', '-X', 'A'.repeat(65)])
    assert.equal(LUCY_SKU.test(bad), false, bad);
});

test('the form: checks what it can, sends only what changed, keeps the price out of the edit', () => {
  const item = detail();
  const draft = draftOf(item);
  assert.equal(editRequest(draft, item), null);
  assert.deepEqual(validateDraft(draft), { proposedSku: true });
  assert.deepEqual(validateDraft({ ...draft, nameVi: ' ', nameEn: '', listPriceVnd: '12.5' }), {
    nameVi: true,
    nameEn: true,
    proposedSku: true,
    listPriceVnd: true,
  });
  const fixed = {
    ...draft,
    proposedSku: 'NUOC-HOA-HONG',
    brandId: 'b1',
    needsTranslation: false,
    nameEn: ' Cream ',
    listPriceVnd: '480000',
  };
  assert.deepEqual(validateDraft(fixed), {});
  assert.deepEqual(editRequest(fixed, item), {
    expectedVersion: 3,
    nameEn: 'Cream',
    needsTranslation: false,
    brandId: 'b1',
    proposedSku: 'NUOC-HOA-HONG',
  });
  // Emptying a field sends null, not an empty string.
  assert.deepEqual(editRequest({ ...draft, descriptionVi: '', proposedSku: '' }, item), {
    expectedVersion: 3,
    descriptionVi: null,
    proposedSku: null,
  });
});

test('warnings read plainly in both languages; duplicates and mapping texts come from the evaluation payload', () => {
  for (const code of IMPORT_WARNING_FILTERS) {
    assert.notEqual(warningText(code, 'vi'), code, code);
    assert.notEqual(warningText(code, 'en'), code, code);
  }
  assert.equal(warningText('SOMETHING_NEW', 'vi'), 'SOMETHING_NEW');
  const item = detail();
  assert.deepEqual(duplicateMatches(item), [
    { ref: 'PRODUCT:p1', kind: 'PRODUCT', name: 'Kem dưỡng A' },
    { ref: 'CANDIDATE:c2', kind: 'CANDIDATE', name: 'Kem dưỡng A 50ml' },
  ]);
  assert.deepEqual(mappingTexts(item, 'BRAND'), ['OHUI', 'Kem Dưỡng']);
  assert.deepEqual(mappingTexts(item, 'CATEGORY'), ['Kem Dưỡng']);
  assert.equal(suggestionFor(item, 'BRAND'), 'b1');
  assert.equal(suggestionFor(item, 'CATEGORY'), null);
  assert.deepEqual(
    mappingTexts(detail({ warnings: [] }), 'BRAND'),
    ['OHUI', 'Kem Dưỡng'],
    'falls back to the source categories',
  );
});

test('this area has its own words for a refused command, and the blocker is named', () => {
  const fallback = () => 'FALLBACK';
  const plain = (code: string, field?: string) =>
    importErrorText(new ApiError(409, code, field), 'vi', fallback);
  assert.equal(
    plain('CANDIDATE_DECIDED'),
    supplierImportsDictionary('vi').errors.CANDIDATE_DECIDED,
  );
  assert.match(plain('CANDIDATE_BLOCKED', 'SKU_TAKEN'), /SKU đã có ở một sản phẩm khác/);
  assert.equal(plain('SOMETHING_ELSE'), 'FALLBACK');
  assert.equal(importErrorText(new Error('x'), 'en', fallback), 'FALLBACK');
  assert.ok(isImportConflict(new ApiError(409, 'CONFLICT', undefined)));
  assert.ok(isImportConflict(new ApiError(409, 'CANDIDATE_DECIDED', undefined)));
  assert.equal(isImportConflict(new ApiError(409, 'CANDIDATE_BLOCKED', undefined)), false);
});

test('states, pictures and dictionaries', () => {
  assert.equal(stateTone('READY_FOR_REVIEW'), 'success');
  assert.equal(stateTone('NEEDS_REVIEW'), 'warning');
  assert.equal(stateTone('REJECTED'), 'error');
  assert.equal(stateTone('IMPORTED'), 'info');
  assert.ok(isOpen('NEEDS_REVIEW') && isOpen('READY_FOR_REVIEW'));
  assert.ok(
    !isOpen('IMPORTED') && !isOpen('REJECTED') && !isOpen('IGNORED') && !isOpen('APPROVED'),
  );
  assert.equal(pictureUrl('c1', 'i1', 'md'), '/api/v1/supplier-imports/candidates/c1/images/i1/md');
  const shape = (value: unknown, path = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => shape(child, `${path}.${key}`))
      : [path];
  assert.deepEqual(shape(supplierImportsDictionary('en')), shape(supplierImportsDictionary('vi')));
  assert.doesNotMatch(JSON.stringify(supplierImportsDictionary('vi')), /khám/i);
});
