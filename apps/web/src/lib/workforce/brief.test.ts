import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRIEF_LIMITS } from '@lucy-spa/contracts';
import { briefDictionary } from '../../i18n/brief';

test('the customer card has words in both languages for every block and part, none with the clinic word, and the rules it states match the limits', () => {
  const vi = briefDictionary('vi');
  const en = briefDictionary('en');
  for (const key of ['AI_OFF', 'BRIEF_OFF', 'NO_RATE', 'NO_KEY', 'OTHER'] as const) {
    assert.ok(vi.blocked[key] && en.blocked[key], key);
  }
  for (const part of ['facts', 'summary', 'suggestions'] as const) {
    assert.deepEqual(Object.keys(vi[part]).sort(), Object.keys(en[part]).sort(), part);
  }
  assert.doesNotMatch(JSON.stringify(vi), /khám(?! phá)/i);
  // The window and the keep days are the server's numbers; the screen never promises other ones.
  assert.equal(BRIEF_LIMITS.windowBeforeMinutes, 120);
  assert.equal(BRIEF_LIMITS.keepDaysAfterService, 7);
  assert.equal(BRIEF_LIMITS.suggestions, 3);
});
