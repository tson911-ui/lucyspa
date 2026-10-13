import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPORT_DEFINITIONS } from '@lucy-spa/contracts';
import { assistantDictionary } from '../../i18n/assistant';
import {
  QUESTION_MAX,
  askErrorKey,
  dayText,
  readyQuestion,
  reportHref,
  reportPageOf,
  reportPages,
} from './assistant';

test('every report a tool reads has a page to link to; two reports on one page give one link, in the order used', () => {
  for (const id of [
    'revenue-overview',
    'refunds',
    'revenue-by-service',
    'revenue-by-product',
    'customers-visits',
    'bookings-funnel',
    'cash-daily',
    'cash-funds',
    'labour-cost',
    'payroll-monthly',
    'advances',
    'profit',
    'reviews',
  ]) {
    assert.ok(
      REPORT_DEFINITIONS.some((definition) => definition.id === id),
      `${id} is a report`,
    );
    assert.ok(reportPageOf(id), id);
  }
  assert.equal(reportPageOf('nope'), null);
  assert.deepEqual(reportPages(['revenue-by-service', 'revenue-overview', 'revenue-by-product']), [
    'sales',
    'revenue',
  ]);
  assert.equal(reportHref('/vi/workforce', 'pay'), '/vi/workforce/reports/pay');
});

test('a question is trimmed and sent only when it has text and is not over 300 characters', () => {
  assert.deepEqual(readyQuestion('  Doanh thu?  '), { text: 'Doanh thu?', ok: true });
  assert.equal(readyQuestion('   ').ok, false);
  assert.equal(readyQuestion('x'.repeat(QUESTION_MAX)).ok, true);
  assert.equal(readyQuestion('x'.repeat(QUESTION_MAX + 1)).ok, false);
});

test('errors and dates read as plain text; every block and error has words in both languages, none with the clinic word', () => {
  assert.equal(askErrorKey({ code: 'RATE_LIMITED' }), 'RATE_LIMITED');
  assert.equal(askErrorKey({ code: 'SERVICE_UNAVAILABLE' }), 'OTHER');
  assert.equal(askErrorKey(null), 'OTHER');
  assert.equal(dayText('2026-10-01'), '01/10/2026');
  const vi = assistantDictionary('vi');
  const en = assistantDictionary('en');
  for (const key of ['AI_OFF', 'ASSISTANT_OFF', 'NO_RATE', 'NO_KEY', 'OTHER'] as const) {
    assert.ok(vi.blocked[key] && en.blocked[key], key);
  }
  for (const key of ['RATE_LIMITED', 'FORBIDDEN', 'VALIDATION_FAILED', 'OTHER'] as const) {
    assert.ok(vi.errors[key] && en.errors[key], key);
  }
  for (const page of Object.keys(vi.pages)) assert.ok(Reflect.get(en.pages, page), page);
  assert.doesNotMatch(JSON.stringify(vi), /khám(?! phá)/i);
});
