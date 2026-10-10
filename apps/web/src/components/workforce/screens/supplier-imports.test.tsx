import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supplierImportsDictionary } from '../../../i18n/supplier-imports';
import { customer, employee, owner, render } from '../../../test/support';
import { SupplierImportsScreen } from './supplier-imports';

const text = supplierImportsDictionary('vi');
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test('access: only REVIEW_SUPPLIER_IMPORTS opens the review; everyone else is told they have no access', () => {
  assert.doesNotMatch(render(<SupplierImportsScreen />, owner), re(text.noAccess));
  assert.doesNotMatch(
    render(<SupplierImportsScreen />, employee([['REVIEW_SUPPLIER_IMPORTS']])),
    re(text.noAccess),
  );
  for (const account of [
    employee([['MANAGE_SUPPLIER_SOURCES']]),
    employee([['MANAGE_PRODUCTS']]),
    employee([['REVIEW_SUPPLIER_IMPORTS', 'A']]),
    customer,
  ]) {
    const html = render(<SupplierImportsScreen />, account);
    assert.match(html, re(text.noAccess));
    assert.match(html, /<h1[^>]*>Duyệt sản phẩm nhập<\/h1>/);
  }
  assert.doesNotMatch(render(<SupplierImportsScreen />, employee([['MANAGE_PRODUCTS']])), /khám/i);
});

test('English renders the title and the no-access sentence in English', () => {
  const html = render(<SupplierImportsScreen />, employee([['MANAGE_PRODUCTS']]), 'en');
  assert.match(html, /Review imported products/);
  assert.match(html, /You have not been given access to review imported products\./);
});
