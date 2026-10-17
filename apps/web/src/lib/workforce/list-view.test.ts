import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { paginationLabels } from './list-view';

test('the staff pager carries the list language, so its counts group (1.234 / 1,234) through the kit', () => {
  assert.equal(paginationLabels(getWorkforceDictionary('vi'), 'Nhân viên').locale, 'vi');
  assert.equal(paginationLabels(getWorkforceDictionary('en'), 'Employees').locale, 'en');
});
