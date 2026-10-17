import assert from 'node:assert/strict';
import { test } from 'node:test';
import { opensInput } from './opens-input';

test('a label that opens a dialog for more input ends with one ellipsis', () => {
  assert.equal(opensInput('Điều chỉnh'), 'Điều chỉnh…');
  assert.equal(opensInput('Thêm chi nhánh…'), 'Thêm chi nhánh…');
});
