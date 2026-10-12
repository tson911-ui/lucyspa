import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiSettingsDictionary } from '../../../i18n/ai-settings';
import { customer, employee, owner, render } from '../../../test/support';
import { AiSettingsScreen } from './ai-settings';

const text = aiSettingsDictionary('vi');
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test('the page needs MANAGE_AI_SETTINGS; USE_AI_CONTENT alone opens nothing', () => {
  assert.doesNotMatch(render(<AiSettingsScreen />, owner), re(text.noAccess));
  assert.doesNotMatch(
    render(<AiSettingsScreen />, employee([['MANAGE_AI_SETTINGS']])),
    re(text.noAccess),
  );
  for (const account of [
    employee([['USE_AI_CONTENT']]),
    employee([['MANAGE_PRODUCTS']]),
    customer,
  ]) {
    const html = render(<AiSettingsScreen />, account);
    assert.match(html, re(text.noAccess));
    assert.match(html, /<h1[^>]*>Cài đặt AI<\/h1>/);
  }
});

test('the dictionaries are complete in both languages and never use the clinic word', () => {
  const en = aiSettingsDictionary('en');
  const flat = (value: unknown, path = ''): string[] =>
    typeof value === 'string'
      ? [path]
      : Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
          flat(entry, `${path}.${key}`),
        );
  assert.deepEqual(flat(text), flat(en));
  assert.doesNotMatch(JSON.stringify(text), /khám/i);
  assert.match(text.words.authenticityHint, /nhà phân phối chính thức/);
  for (const status of [
    'OK',
    'KEY_MISSING',
    'AUTH_FAILED',
    'UNREACHABLE',
    'LIMIT_REACHED',
    'ERROR',
  ] as const) {
    assert.ok(text.key.statuses[status] && en.key.statuses[status], status);
  }
});
