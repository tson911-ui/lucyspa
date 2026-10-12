import type { ProductTextCleanupPreviewResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productTextCleanupDictionary } from '../../../i18n/product-text-cleanup';
import { customer, employee, owner, render } from '../../../test/support';
import { Cleanup, ProductTextCleanupScreen } from './product-text-cleanup';

const text = productTextCleanupDictionary('vi');
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const preview = (): ProductTextCleanupPreviewResponse => ({
  items: [
    {
      id: 'a',
      code: 'sua-rua-mat-the-whoo',
      nameVi: 'Sữa Rửa Mặt Cấp Ẩm The Whoo',
      rowVersion: 1,
      textHash: 'a'.repeat(64),
      removedEntries: 3,
      removedChars: 612,
    },
    {
      id: 'b',
      code: 'kem-mat-whoo',
      nameVi: 'Kem Mắt Whoo Cheonyuldan',
      rowVersion: 4,
      textHash: 'b'.repeat(64),
      removedEntries: 3,
      removedChars: 640,
    },
  ],
  truncated: false,
});

test('the page needs MANAGE_PRODUCTS (the server repeats it)', () => {
  assert.doesNotMatch(render(<ProductTextCleanupScreen />, owner), re(text.noAccess));
  assert.doesNotMatch(
    render(<ProductTextCleanupScreen />, employee([['MANAGE_PRODUCTS']])),
    re(text.noAccess),
  );
  for (const account of [employee([['MANAGE_PRODUCT_PRICES']]), customer]) {
    const html = render(<ProductTextCleanupScreen />, account);
    assert.match(html, re(text.noAccess));
    assert.match(html, /<h1[^>]*>Dọn lời đánh giá của nhà cung cấp<\/h1>/);
  }
});

test('the list: one h1, one primary action with the count, every product with its comment count, no clinic word', () => {
  const html = render(<Cleanup data={preview()} reload={async () => undefined} />, owner);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /<h1[^>]*>Dọn lời đánh giá của nhà cung cấp<\/h1>/);
  assert.match(html, /Dọn 2 sản phẩm/);
  assert.match(html, /Sữa Rửa Mặt Cấp Ẩm The Whoo/);
  assert.match(html, /sua-rua-mat-the-whoo/);
  assert.equal((html.match(/Sẽ dọn/g) ?? []).length, 2);
  assert.match(html, /Chỉ phần &quot;Đánh giá&quot; bị bỏ/);
  assert.doesNotMatch(html, /khám/i);
  assert.doesNotMatch(html, /Một số sản phẩm nhập từ nhà cung cấp[^<]*khách hàng của Lucy/);
});

test('an empty list says nothing is left; English reads in English', () => {
  const html = render(
    <Cleanup data={{ items: [], truncated: false }} reload={async () => undefined} />,
    owner,
  );
  assert.match(html, re(text.empty));
  assert.doesNotMatch(html, /Dọn \d+ sản phẩm/);
  const en = productTextCleanupDictionary('en');
  assert.match(en.title, /supplier/i);
  assert.ok(en.submit.includes('{count}') && text.submit.includes('{count}'));
});
