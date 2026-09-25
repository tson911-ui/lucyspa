import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fill, getWorkforceDictionary } from '../../i18n/workforce';
import {
  formatDate,
  formatVnd,
  inclusiveDays,
  isVndInput,
  todayIn,
  zonedInstant,
  zonedLocal,
} from './format';

test('VND amounts are formatted from the integer string, never through floats', () => {
  // Beyond Number.MAX_SAFE_INTEGER: a float round-trip would corrupt the digits.
  assert.equal(formatVnd('123456789012345678', 'vi'), '123.456.789.012.345.678 ₫');
  assert.equal(formatVnd('450000', 'en'), '450,000 ₫');
  assert.equal(formatVnd('0', 'vi'), '0 ₫');
  assert.equal(isVndInput('450000'), true);
  for (const bad of ['', '01', '4.5', '-1', '1e6', '450,000', '1234567890123456789']) {
    assert.equal(isVndInput(bad), false, bad);
  }
});

test('whole calendar days and date-only display without timezone shifts', () => {
  assert.equal(inclusiveDays('2026-10-10', '2026-10-10'), 1);
  assert.equal(inclusiveDays('2026-10-10', '2026-10-12'), 3);
  assert.equal(inclusiveDays('2026-10-12', '2026-10-10'), null);
  assert.equal(formatDate('2026-10-10', 'vi'), '10/10/2026');
  assert.equal(formatDate('2026-10-10', 'en'), '2026-10-10');
});

test('branch wall-clock times convert through the branch timezone, not the browser', () => {
  assert.equal(zonedInstant('2026-09-25T17:30', 'Asia/Ho_Chi_Minh'), '2026-09-25T10:30:00.000Z');
  assert.equal(zonedLocal('2026-09-25T10:30:00.000Z', 'Asia/Ho_Chi_Minh'), '2026-09-25T17:30');
  // DST zone: 2026-07-01 is UTC-4 in New York.
  assert.equal(zonedInstant('2026-07-01T09:00', 'America/New_York'), '2026-07-01T13:00:00.000Z');
  assert.equal(zonedInstant('garbage', 'UTC'), null);
  assert.equal(todayIn('Pacific/Kiritimati', new Date('2026-09-25T12:00:00Z')), '2026-09-26');
});

test('VI and EN dictionaries have the same keys; codes map to labels', () => {
  const shape = (value: unknown): unknown =>
    value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shape(entry)]))
      : typeof value;
  assert.deepEqual(shape(getWorkforceDictionary('vi')), shape(getWorkforceDictionary('en')));
  for (const locale of ['vi', 'en'] as const) {
    const types = getWorkforceDictionary(locale).leave.types;
    for (const code of [
      'ANNUAL',
      'SICK',
      'PERSONAL',
      'FAMILY_EVENT',
      'MATERNITY',
      'OTHER',
    ] as const) {
      assert.ok(types[code].length > 0 && types[code] !== code, `${locale} ${code}`);
    }
  }
  assert.equal(fill('Hello, {name} {missing}', { name: 'Lan' }), 'Hello, Lan {missing}');
});
