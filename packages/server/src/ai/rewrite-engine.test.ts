import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesOf, snapshotOf } from './rewrite-engine.js';

test('a stored snapshot is read back; one without a name is refused', () => {
  assert.equal(snapshotOf(null), null);
  assert.equal(snapshotOf({ nameVi: '  ' }), null);
  assert.equal(snapshotOf([]), null);
  assert.deepEqual(
    snapshotOf({
      nameVi: 'Kem',
      brand: 'The Whoo',
      category: 7,
      variantLabels: ['50ml', 3, ''],
      supplierText: 'Mô tả',
      attributes: [{ name: 'Dung tích', values: ['50ml'] }, { nope: true }, 'x'],
    }),
    {
      nameVi: 'Kem',
      brand: 'The Whoo',
      category: null,
      variantLabels: ['50ml'],
      supplierText: 'Mô tả',
      attributes: [{ name: 'Dung tích', values: ['50ml'] }],
    },
  );
});

test('supplier attributes are read from a list of name/value or from an object', () => {
  assert.deepEqual(
    attributesOf([
      { name: 'Dung tích', value: '180ml' },
      { name: ' Loại da ', values: ['Da khô', 'Da thường'] },
      { name: '', value: 'x' },
      { name: 'Trống', value: '' },
    ]),
    [
      { name: 'Dung tích', values: ['180ml'] },
      { name: 'Loại da', values: ['Da khô', 'Da thường'] },
    ],
  );
  assert.deepEqual(attributesOf({ 'Dung tích': '50ml', Màu: ['đỏ'], Rỗng: [] }), [
    { name: 'Dung tích', values: ['50ml'] },
    { name: 'Màu', values: ['đỏ'] },
  ]);
  assert.deepEqual(attributesOf({}), []);
  assert.deepEqual(attributesOf('text'), []);
});
