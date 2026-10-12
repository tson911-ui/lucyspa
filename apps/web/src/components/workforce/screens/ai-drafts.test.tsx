import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiDraftsDictionary } from '../../../i18n/ai-drafts';
import { customer, employee, owner, render } from '../../../test/support';
import { AiDraftScreen } from './ai-draft-detail';
import { AiDraftsScreen } from './ai-drafts';

const text = aiDraftsDictionary('vi');
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test('both pages need USE_AI_CONTENT; MANAGE_PRODUCTS alone opens nothing', () => {
  for (const page of [<AiDraftsScreen key="l" />, <AiDraftScreen key="d" id="x" />]) {
    for (const account of [employee([['MANAGE_PRODUCTS']]), customer]) {
      assert.match(render(page, account), re(text.noAccess));
    }
  }
  assert.doesNotMatch(render(<AiDraftsScreen />, owner), re(text.noAccess));
  assert.doesNotMatch(
    render(<AiDraftsScreen />, employee([['USE_AI_CONTENT']])),
    re(text.noAccess),
  );
});

test('the dictionaries are complete in both languages, name every warning code and never use the clinic word', () => {
  const en = aiDraftsDictionary('en');
  const flat = (value: unknown, path = ''): string[] =>
    typeof value === 'string'
      ? [path]
      : Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
          flat(entry, `${path}.${key}`),
        );
  assert.deepEqual(flat(text), flat(en));
  assert.doesNotMatch(JSON.stringify(text), /khám/i);
  // Every code the server can raise has its own sentence (the same list as `WarningCode`).
  for (const code of [
    'CLINIC_WORD',
    'FORBIDDEN_PHRASE',
    'AUTHENTICITY_CLAIM',
    'TESTIMONIAL',
    'FACT_MISSING',
    'INGREDIENT_ADDED',
    'TOO_SIMILAR',
    'URL_OR_CONTACT',
    'MARKUP_OR_EMOJI',
    'SEO_TITLE_LONG',
    'SEO_DESCRIPTION_LONG',
    'SEO_DUPLICATE',
    'WRONG_LANGUAGE',
    'EMPTY_FIELD',
    'BRAND_CHANGED',
    'INJECTION_SIGN',
  ]) {
    assert.ok(Reflect.get(text.warnings, code) && Reflect.get(en.warnings, code), code);
  }
  for (const status of [
    'QUEUED',
    'GENERATING',
    'DRAFT_READY',
    'NEEDS_ATTENTION',
    'FAILED',
    'APPLIED',
    'REJECTED',
    'STALE',
  ]) {
    assert.ok(Reflect.get(text.statuses, status), status);
  }
});
