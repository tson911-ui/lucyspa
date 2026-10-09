import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dayMonthYearToIso,
  isoToDayMonthYear,
  isRealIsoDate,
  isWithinRange,
  maskDayMonthYear,
  readTypedDate,
} from './date-text-core';

test('digits are laid out as dd/mm/yyyy and a partial entry stays partial', () => {
  assert.equal(maskDayMonthYear('15032026'), '15/03/2026');
  assert.equal(maskDayMonthYear('1503'), '15/03');
  assert.equal(maskDayMonthYear('1'), '1');
  assert.equal(maskDayMonthYear('15/03/2026999'), '15/03/2026');
  assert.equal(maskDayMonthYear('ab'), '');
});

test('only whole, real dates are dates; future dates are allowed', () => {
  assert.equal(dayMonthYearToIso('09/10/2026'), '2026-10-09');
  assert.equal(dayMonthYearToIso('09/10/2099'), '2099-10-09');
  assert.equal(dayMonthYearToIso('30/02/2026'), null);
  assert.equal(dayMonthYearToIso('31/04/2026'), null);
  assert.equal(dayMonthYearToIso('29/02/2028'), '2028-02-29');
  assert.equal(dayMonthYearToIso('29/02/2027'), null);
  assert.equal(dayMonthYearToIso('09/13/2026'), null);
  assert.equal(dayMonthYearToIso('09/10/1899'), null);
  assert.equal(dayMonthYearToIso('09/10'), null);
  assert.equal(isRealIsoDate('2026-10-09'), true);
  assert.equal(isRealIsoDate('2026-10-9'), false);
});

test('the ISO date shows as dd/mm/yyyy and comes back', () => {
  assert.equal(isoToDayMonthYear('2026-10-09'), '09/10/2026');
  assert.equal(isoToDayMonthYear(''), '');
  assert.equal(isoToDayMonthYear('bad'), '');
  assert.equal(dayMonthYearToIso(isoToDayMonthYear('2026-01-31') ?? ''), '2026-01-31');
});

test('what is typed or pasted: a date, empty, or not yet a date', () => {
  assert.equal(readTypedDate('09102026'), '2026-10-09');
  assert.equal(readTypedDate('09/10/2026'), '2026-10-09');
  assert.equal(readTypedDate('2026-10-09'), '2026-10-09');
  assert.equal(readTypedDate(''), '');
  assert.equal(readTypedDate('  '), '');
  assert.equal(readTypedDate('09/10'), null);
  assert.equal(readTypedDate('32/10/2026'), null);
});

test('min and max are inclusive and optional', () => {
  assert.equal(isWithinRange('2026-10-09', '2026-10-09', '2026-10-09'), true);
  assert.equal(isWithinRange('2026-10-10', undefined, '2026-10-09'), false);
  assert.equal(isWithinRange('2026-10-08', '2026-10-09'), false);
  assert.equal(isWithinRange('2030-01-01'), true);
});
