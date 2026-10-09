import assert from 'node:assert/strict';
import test from 'node:test';
import { dayMonthYearToIso, isoToDayMonthYear, maskDayMonthYear } from './date-input-core';

test('maskDayMonthYear lays digits out as dd/mm/yyyy and stays partial while typing', () => {
  assert.equal(maskDayMonthYear('1'), '1');
  assert.equal(maskDayMonthYear('15'), '15');
  assert.equal(maskDayMonthYear('150'), '15/0');
  assert.equal(maskDayMonthYear('15031990'), '15/03/1990');
  assert.equal(maskDayMonthYear('15/03/1990'), '15/03/1990');
  assert.equal(maskDayMonthYear('15-03-1990 99'), '15/03/1990');
  assert.equal(maskDayMonthYear('abc'), '');
});

test('dayMonthYearToIso accepts only real dates up to today, from 1900', () => {
  const today = '2026-10-09';
  assert.equal(dayMonthYearToIso('15/03/1990', today), '1990-03-15');
  assert.equal(dayMonthYearToIso('29/02/2024', today), '2024-02-29');
  assert.equal(dayMonthYearToIso('29/02/2023', today), null);
  assert.equal(dayMonthYearToIso('31/04/1990', today), null);
  assert.equal(dayMonthYearToIso('00/03/1990', today), null);
  assert.equal(dayMonthYearToIso('15/13/1990', today), null);
  assert.equal(dayMonthYearToIso('15/03/1899', today), null);
  assert.equal(dayMonthYearToIso('10/10/2026', today), null);
  assert.equal(dayMonthYearToIso('09/10/2026', today), '2026-10-09');
  assert.equal(dayMonthYearToIso('15/03/19', today), null);
  assert.equal(dayMonthYearToIso('', today), null);
});

test('isoToDayMonthYear shows an ISO date as dd/mm/yyyy', () => {
  assert.equal(isoToDayMonthYear('1990-03-15'), '15/03/1990');
  assert.equal(isoToDayMonthYear(''), '');
  assert.equal(isoToDayMonthYear('15/03/1990'), '');
});
