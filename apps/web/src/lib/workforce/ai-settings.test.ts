import type { AiSettings } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  draftFromSettings,
  editRequest,
  isDirty,
  phrasesOf,
  serverField,
  validateDraft,
  vndText,
} from './ai-settings';

const settings: AiSettings = {
  enabled: false,
  rewriteEnabled: false,
  monthlyCapVnd: '3000000',
  featureCapsVnd: {
    PRODUCT_REWRITE: '2000000',
    SEO: '300000',
    ASSISTANT: '300000',
    BRIEF: '200000',
  },
  vndPerUsd: null,
  rewriteModel: 'claude-opus-5-5',
  rewriteEffort: 'medium',
  concurrency: 2,
  refusalFallback: true,
  allowAuthenticityClaims: false,
  bannedPhrases: ['số 1'],
  runAllUnlockedAt: null,
  rowVersion: 7,
};

test('a form read from the settings is clean and sends nothing but the version', () => {
  const draft = draftFromSettings(settings);
  assert.equal(draft.vndPerUsd, '');
  assert.equal(draft.bannedPhrases, 'số 1');
  assert.deepEqual(editRequest(draft, settings), { expectedRowVersion: 7 });
  assert.equal(isDirty(draft, settings), false);
  assert.deepEqual(validateDraft(draft), {});
});

test('only what changed is sent: switches, the rate, one cap, the model, the phrases', () => {
  const draft = {
    ...draftFromSettings(settings),
    enabled: true,
    vndPerUsd: '26000',
    featureCapsVnd: { ...settings.featureCapsVnd, SEO: '500000' },
    rewriteModel: 'claude-sonnet-5-5' as const,
    allowAuthenticityClaims: true,
    bannedPhrases: 'số 1\n\n  đảm bảo   da đẹp  \n',
  };
  assert.deepEqual(editRequest(draft, settings), {
    expectedRowVersion: 7,
    enabled: true,
    vndPerUsd: 26000,
    featureCapsVnd: { SEO: '500000' },
    rewriteModel: 'claude-sonnet-5-5',
    allowAuthenticityClaims: true,
    bannedPhrases: ['số 1', 'đảm bảo da đẹp'],
  });
  assert.equal(isDirty(draft, settings), true);
  assert.deepEqual(phrasesOf(' a \n\n b  c '), ['a', 'b c']);
});

test('clearing the rate sends null; typing the same value sends nothing', () => {
  const typed = { ...settings, vndPerUsd: 26000 };
  assert.deepEqual(editRequest({ ...draftFromSettings(typed), vndPerUsd: '' }, typed), {
    expectedRowVersion: 7,
    vndPerUsd: null,
  });
  assert.deepEqual(editRequest({ ...draftFromSettings(typed), vndPerUsd: '26000' }, typed), {
    expectedRowVersion: 7,
  });
});

test('validation: rate range, caps are whole amounts, concurrency 1 to 4, phrase lengths', () => {
  const base = draftFromSettings(settings);
  assert.deepEqual(validateDraft({ ...base, vndPerUsd: '999' }), { vndPerUsd: true });
  assert.deepEqual(validateDraft({ ...base, vndPerUsd: '25000.5' }), { vndPerUsd: true });
  assert.deepEqual(validateDraft({ ...base, vndPerUsd: '26000' }), {});
  assert.deepEqual(validateDraft({ ...base, monthlyCapVnd: '' }), { monthlyCapVnd: true });
  assert.deepEqual(validateDraft({ ...base, monthlyCapVnd: '-5' }), { monthlyCapVnd: true });
  assert.deepEqual(
    validateDraft({ ...base, featureCapsVnd: { ...base.featureCapsVnd, BRIEF: '' } }),
    { featureCapsVnd: true },
  );
  assert.deepEqual(validateDraft({ ...base, concurrency: '5' }), { concurrency: true });
  assert.deepEqual(validateDraft({ ...base, concurrency: '0' }), { concurrency: true });
  assert.deepEqual(validateDraft({ ...base, bannedPhrases: 'a' }), { bannedPhrases: true });
  assert.deepEqual(validateDraft({ ...base, bannedPhrases: 'x'.repeat(81) }), {
    bannedPhrases: true,
  });
});

test('the server refusing a field marks that field; money reads with separators', () => {
  assert.equal(serverField({ field: 'vndPerUsd' }), 'vndPerUsd');
  assert.equal(serverField({ field: 'featureCapsVnd.SEO' }), 'featureCapsVnd');
  assert.equal(serverField({ field: 'enabled' }), null);
  assert.equal(serverField(new Error('x')), null);
  assert.equal(vndText('3000000', 'vi'), (3000000).toLocaleString('vi-VN'));
  assert.equal(vndText(null, 'vi'), null);
});
