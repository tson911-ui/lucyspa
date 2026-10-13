import type { AiDraftContent, AiDraftDetail } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  editRequest,
  errorKey,
  fieldSpecs,
  isConflict,
  isDirty,
  normalizeAiDraftList,
  readField,
  rowsFor,
  serverField,
  statusTone,
  workingContent,
  writeField,
} from './ai-drafts';

const content: AiDraftContent = {
  descriptionVi: 'Mô tả tiếng Việt.',
  sectionsVi: {
    benefits: 'Làm sạch.',
    ingredients: null,
    usage: 'Dùng mỗi tối.',
    suitableFor: null,
  },
  descriptionEn: 'English description.',
  sectionsEn: { benefits: 'Cleansing.', ingredients: null, usage: null, suitableFor: null },
  nameEn: 'English name',
  seoTitleVi: 'Tiêu đề | Lucy Spa',
  seoTitleEn: 'Title | Lucy Spa',
  seoDescriptionVi: 'Mô tả tìm kiếm.',
  seoDescriptionEn: 'Search description.',
};

const detail = (patch: Partial<AiDraftDetail> = {}): AiDraftDetail => ({
  id: 'i1',
  status: 'DRAFT_READY',
  errorCode: null,
  rowVersion: 3,
  runId: 'r1',
  product: { id: 'p1', code: 'kem', nameVi: 'Kem', rowVersion: 2, contentOrigin: 'SUPPLIER_COPY' },
  stale: false,
  current: { ...content, nameVi: 'Kem', descriptionVi: '' },
  draft: content,
  edited: null,
  nameViSuggestion: null,
  useNameSuggestion: false,
  suitableForInferred: false,
  factsKept: [],
  uncertain: [],
  warnings: [],
  blocking: false,
  instruction: null,
  regenerations: 0,
  canRegenerate: true,
  viewedAt: null,
  appliedAt: null,
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...patch,
});

test('the list state keeps a known status and a page of 1 or more', () => {
  assert.deepEqual(normalizeAiDraftList({ status: 'DRAFT_READY', page: 3 }), {
    status: 'DRAFT_READY',
    page: 3,
  });
  assert.deepEqual(normalizeAiDraftList({ status: 'NOPE', page: 0 }), { status: '', page: 1 });
  assert.deepEqual(normalizeAiDraftList({ status: '', page: 1.5 }), { status: '', page: 1 });
});

test('the rows of a language tab: Vietnamese has description, four sections and two search texts; English adds the name first', () => {
  assert.deepEqual(
    fieldSpecs('vi').map((spec) => spec.path),
    [
      'descriptionVi',
      'sectionsVi.benefits',
      'sectionsVi.ingredients',
      'sectionsVi.usage',
      'sectionsVi.suitableFor',
      'seoTitleVi',
      'seoDescriptionVi',
    ],
  );
  assert.deepEqual(
    fieldSpecs('en').map((spec) => spec.path),
    [
      'nameEn',
      'descriptionEn',
      'sectionsEn.benefits',
      'sectionsEn.ingredients',
      'sectionsEn.usage',
      'sectionsEn.suitableFor',
      'seoTitleEn',
      'seoDescriptionEn',
    ],
  );
  // The search texts carry the house limits the screen counts against.
  const limits = Object.fromEntries(fieldSpecs('vi').map((spec) => [spec.path, spec.limit]));
  assert.equal(limits['seoTitleVi'], 60);
  assert.equal(limits['seoDescriptionVi'], 155);
});

test('reading and writing a field: sections read as text, an emptied section becomes null, the rest is untouched', () => {
  const [, benefits, ingredients] = fieldSpecs('vi');
  assert.equal(readField(content, benefits!), 'Làm sạch.');
  assert.equal(readField(content, ingredients!), '');
  const changed = writeField(content, ingredients!, 'Glycerin.');
  assert.equal(changed.sectionsVi.ingredients, 'Glycerin.');
  assert.equal(changed.sectionsEn, content.sectionsEn);
  assert.equal(writeField(changed, ingredients!, '   ').sectionsVi.ingredients, null);
  assert.equal(content.sectionsVi.ingredients, null, 'a new object each time');
});

test('dirty: only a real change counts (spaces around a field do not), and the chosen name counts', () => {
  const base = detail({ nameViSuggestion: 'Kem mới' });
  assert.equal(isDirty(base, content, false), false);
  assert.equal(isDirty(base, { ...content, descriptionVi: '  Mô tả tiếng Việt.  ' }, false), false);
  assert.equal(isDirty(base, { ...content, descriptionVi: 'Khác.' }, false), true);
  assert.equal(isDirty(base, content, true), true);
  assert.equal(isDirty(base, null, false), false);
  // After an edit is saved, what is saved is the edit.
  const edited = detail({ edited: { ...content, descriptionVi: 'Khác.' } });
  assert.equal(workingContent(edited)?.descriptionVi, 'Khác.');
  assert.equal(isDirty(edited, { ...content, descriptionVi: 'Khác.' }, false), false);
});

test('the edit request carries the row version, the trimmed content and the name choice', () => {
  const request = editRequest(detail(), { ...content, descriptionVi: '  Khác.  ' }, true);
  assert.equal(request.expectedRowVersion, 3);
  assert.equal(request.content.descriptionVi, 'Khác.');
  assert.equal(request.useNameSuggestion, true);
});

test('status colours, error keys, server field and conflict', () => {
  assert.equal(statusTone('APPLIED'), 'success');
  assert.equal(statusTone('DRAFT_READY'), 'info');
  assert.equal(statusTone('STALE'), 'warning');
  assert.equal(statusTone('REJECTED'), 'neutral');
  assert.equal(errorKey('REFUSED', ['REFUSED', 'OTHER']), 'REFUSED');
  assert.equal(errorKey('NEW_CODE', ['REFUSED', 'OTHER']), 'OTHER');
  assert.equal(errorKey(null, ['REFUSED', 'OTHER']), 'OTHER');
  assert.equal(serverField({ code: 'VALIDATION_FAILED', field: 'warnings' }), 'warnings');
  assert.equal(serverField({ code: 'CONFLICT', field: 'x' }), null);
  assert.equal(isConflict({ code: 'CONFLICT' }), true);
  assert.equal(isConflict(new Error('x')), false);
  assert.equal(rowsFor(''), 3);
  assert.equal(rowsFor('x'.repeat(2000)), 14);
});
