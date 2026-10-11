import type { SupplierImportAllPreview } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supplierImportsDictionary } from '../../../i18n/supplier-imports';
import { customer, employee, owner, render } from '../../../test/support';
import { Chooser, SupplierImportAllScreen } from './supplier-import-all';

const text = supplierImportsDictionary('vi');
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test('the page needs all three permissions: review, products and prices (the server repeats it)', () => {
  assert.doesNotMatch(render(<SupplierImportAllScreen />, owner), re(text.noAccess));
  assert.doesNotMatch(
    render(
      <SupplierImportAllScreen />,
      employee([['REVIEW_SUPPLIER_IMPORTS'], ['MANAGE_PRODUCTS'], ['MANAGE_PRODUCT_PRICES']]),
    ),
    re(text.noAccess),
  );
  for (const account of [
    employee([['REVIEW_SUPPLIER_IMPORTS']]),
    employee([['REVIEW_SUPPLIER_IMPORTS'], ['MANAGE_PRODUCTS']]),
    employee([['MANAGE_PRODUCTS'], ['MANAGE_PRODUCT_PRICES']]),
    customer,
  ]) {
    const html = render(<SupplierImportAllScreen />, account);
    assert.match(html, re(text.noAccess));
    assert.match(html, /<h1[^>]*>Nhập và đăng sản phẩm<\/h1>/);
  }
});

const preview = (): SupplierImportAllPreview => ({
  rows: [
    {
      id: 'a',
      rowVersion: 1,
      nameVi: 'Nước hoa hồng Ohui',
      sku: '50709298',
      thumbImageId: null,
      brand: { name: 'OHUI', isNew: true },
      category: { key: 'TONER', name: 'Nước hoa hồng/Toner' },
      priceVnd: '350000',
      blockers: [],
    },
    {
      id: 'b',
      rowVersion: 1,
      nameVi: 'Sữa rửa mặt Ohui',
      sku: '50708207',
      thumbImageId: null,
      brand: { name: 'OHUI', isNew: true },
      category: { key: 'CLEANSE', name: 'Làm sạch' },
      priceVnd: '300000',
      blockers: [],
    },
    {
      id: 'c',
      rowVersion: 1,
      nameVi: 'Sản phẩm sku sai dạng',
      sku: 'sku sai',
      thumbImageId: null,
      brand: null,
      category: { key: 'OTHER', name: 'Khác' },
      priceVnd: null,
      blockers: ['SKU_INVALID', 'PRICE_MISSING'],
    },
  ],
  total: 3,
  importable: 2,
  blocked: 1,
  newBrands: [{ name: 'OHUI', count: 2 }],
  categories: [
    { key: 'CLEANSE', name: 'Làm sạch', count: 1 },
    { key: 'TONER', name: 'Nước hoa hồng/Toner', count: 1 },
  ],
  categoriesToCreate: ['Làm sạch', 'Khác'],
});

test('the list: every importable product is ticked, with its brand, category and price; blockers are listed and cannot be ticked', () => {
  const html = render(<Chooser data={preview()} />, owner);
  assert.match(html, /<h1[^>]*>Nhập và đăng sản phẩm<\/h1>/);
  // One checkbox per importable product, all ticked, each with its own accessible name.
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.equal((html.match(/type="checkbox"[^>]*checked/g) ?? []).length, 2);
  assert.match(html, /Chọn Nước hoa hồng Ohui/);
  assert.match(html, /Sẽ nhập và đăng 2 sản phẩm\./);
  assert.match(html, /Thương hiệu mới sẽ được tạo: OHUI \(2\)\./);
  assert.match(html, /Nhóm sản phẩm sẽ được tạo: Làm sạch, Khác\./);
  assert.match(html, /Nhập và đăng 2 sản phẩm/);
  assert.match(html, /Chọn tất cả/);
  assert.match(html, /Bỏ chọn tất cả/);
  assert.match(html, /1 sản phẩm chưa nhập được/);
  assert.match(html, /SKU còn trống hoặc chưa đúng dạng/);
  assert.match(html, /Nguồn không có giá/);
  assert.match(html, /350\.000/);
  assert.doesNotMatch(html, /khám/i);
});

test('an empty list says so, and English reads in English', () => {
  const empty: SupplierImportAllPreview = {
    rows: [],
    total: 0,
    importable: 0,
    blocked: 0,
    newBrands: [],
    categories: [],
    categoriesToCreate: [],
  };
  assert.match(render(<Chooser data={empty} />, owner), re(text.all.empty));
  const html = render(<Chooser data={preview()} />, owner, 'en');
  assert.match(html, /Import and publish products/);
  assert.match(html, /Import and publish 2 products/);
  assert.match(html, /Select all/);
});
