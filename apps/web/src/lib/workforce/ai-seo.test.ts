import type { AiSeoDetail } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyRequest,
  editRequest,
  errorKey,
  formOf,
  hasEnglishText,
  isDirty,
  isWorking,
  normalizeAiSeoList,
  serverField,
  statusTone,
} from './ai-seo';
import { aiSeoDictionary } from '../../i18n/ai-seo';

const detail = (patch: Partial<AiSeoDetail> = {}): AiSeoDetail => ({
  id: 'd1',
  kind: 'SERVICE',
  status: 'DRAFT_READY',
  errorCode: null,
  rowVersion: 4,
  current: {
    label: 'Gội đầu',
    seoDescriptionVi: '',
    seoDescriptionEn: '',
    sourceVi: 'Gội đầu bằng thảo mộc.',
    englishNow: '',
    englishLabel: 'DESCRIPTION',
  },
  stale: false,
  draft: {
    seoDescriptionVi: 'Mô tả việt',
    seoDescriptionEn: 'English description',
    englishText: 'English text',
  },
  edited: null,
  warnings: [],
  blocking: false,
  instruction: null,
  regenerations: 0,
  canRegenerate: true,
  updatedAt: '2026-10-13T00:00:00.000Z',
  ...patch,
});

test('the form starts from the saved edit, else the draft; a change is dirty until it is the saved text again', () => {
  const fresh = detail();
  const form = formOf(fresh);
  assert.deepEqual(form, {
    seoDescriptionVi: 'Mô tả việt',
    seoDescriptionEn: 'English description',
    englishText: 'English text',
  });
  assert.equal(isDirty(form, fresh), false);
  assert.equal(isDirty({ ...form, seoDescriptionVi: 'khác' }, fresh), true);
  const edited = detail({
    edited: { seoDescriptionVi: 'đã sửa', seoDescriptionEn: 'edited', englishText: null },
  });
  assert.equal(formOf(edited).seoDescriptionVi, 'đã sửa');
  assert.equal(hasEnglishText(edited), false);
  assert.equal(formOf(edited).englishText, '');
  assert.equal(hasEnglishText(fresh), true);
  assert.equal(hasEnglishText(detail({ draft: null })), false);
});

test('an edit carries the row version and trimmed text, and no English text when the draft has none; apply asks to acknowledge only when told', () => {
  const fresh = detail();
  assert.deepEqual(
    editRequest({ seoDescriptionVi: '  a ', seoDescriptionEn: ' b', englishText: ' c  ' }, fresh),
    {
      expectedRowVersion: 4,
      content: { seoDescriptionVi: 'a', seoDescriptionEn: 'b', englishText: 'c' },
    },
  );
  const noEnglish = detail({
    draft: { seoDescriptionVi: 'a', seoDescriptionEn: 'b', englishText: null },
  });
  assert.equal(
    editRequest({ seoDescriptionVi: 'a', seoDescriptionEn: 'b', englishText: 'ignored' }, noEnglish)
      .content.englishText,
    null,
  );
  assert.deepEqual(applyRequest(fresh, false), { expectedRowVersion: 4 });
  assert.deepEqual(applyRequest(fresh, true), { expectedRowVersion: 4, acknowledgeWarnings: true });
});

test('list state, status tones, working states and server fields are read strictly', () => {
  assert.deepEqual(normalizeAiSeoList({ status: 'DRAFT_READY', kind: 'SHOP', page: 2 }), {
    status: 'DRAFT_READY',
    kind: 'SHOP',
    page: 2,
  });
  assert.deepEqual(normalizeAiSeoList({ status: 'x', kind: 'y', page: 0 }), {
    status: '',
    kind: '',
    page: 1,
  });
  assert.equal(statusTone('APPLIED'), 'success');
  assert.equal(statusTone('DRAFT_READY'), 'info');
  assert.equal(statusTone('FAILED'), 'warning');
  assert.equal(statusTone('REJECTED'), 'neutral');
  assert.equal(isWorking('QUEUED'), true);
  assert.equal(isWorking('GENERATING'), true);
  assert.equal(isWorking('DRAFT_READY'), false);
  assert.equal(serverField({ field: 'seoDescriptionEn' }), 'seoDescriptionEn');
  assert.equal(serverField({ field: 'scope' }), null);
  assert.equal(errorKey('CAP_FEATURE', ['CAP_FEATURE', 'OTHER']), 'CAP_FEATURE');
  assert.equal(errorKey('WHAT', ['CAP_FEATURE', 'OTHER']), 'OTHER');
  assert.equal(errorKey(null, ['OTHER']), 'OTHER');
});

test('every status, kind, block reason and warning code has words in both languages; no sentence uses the clinic word', () => {
  const vi = aiSeoDictionary('vi');
  const en = aiSeoDictionary('en');
  for (const status of [
    'QUEUED',
    'GENERATING',
    'DRAFT_READY',
    'NEEDS_ATTENTION',
    'FAILED',
    'APPLIED',
    'REJECTED',
    'STALE',
  ] as const) {
    assert.ok(vi.statuses[status] && en.statuses[status], status);
  }
  for (const code of ['OFF', 'SEO_OFF', 'NO_RATE', 'NOTHING_TO_DRAFT'] as const) {
    assert.ok(vi.create.blocked[code] && en.create.blocked[code], code);
  }
  for (const code of [
    'CLINIC_WORD',
    'FORBIDDEN_PHRASE',
    'AUTHENTICITY_CLAIM',
    'TESTIMONIAL',
    'URL_OR_CONTACT',
    'MARKUP_OR_EMOJI',
    'SEO_DESCRIPTION_LONG',
    'SEO_DUPLICATE',
    'WRONG_LANGUAGE',
    'EMPTY_FIELD',
    'INJECTION_SIGN',
    'FACT_WRONG',
  ]) {
    assert.ok(vi.warnings[code] && en.warnings[code], code);
  }
  assert.doesNotMatch(JSON.stringify(vi), /khám(?! phá)/i);
});
