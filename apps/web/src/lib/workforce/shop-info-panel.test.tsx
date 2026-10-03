import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaLibraryScreen } from '../../components/workforce/screens/media-library';
import { ShopInfoPanel } from '../../components/workforce/screens/website-shop-info';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

test('the website page offers the Shop info tab to the people who manage website content', () => {
  const page = render(<MediaLibraryScreen />, owner);
  assert.ok(page.includes(vi.website.shop));
  const english = render(<MediaLibraryScreen />, owner, 'en');
  assert.ok(english.includes(en.website.shop));
  const branchOnly = render(<MediaLibraryScreen />, employee([['MANAGE_WEBSITE_CONTENT', 'B']]));
  assert.ok(!branchOnly.includes(vi.website.shop));
});

test('the Shop info panel loads before it shows a form and refuses everyone without the global permission', () => {
  const loading = render(<ShopInfoPanel />, owner);
  assert.ok(loading.includes(vi.common.loading));
  assert.ok(!loading.includes(vi.shopInfo.save));
  for (const account of [employee([['MANAGE_WEBSITE_CONTENT', 'B']]), employee([])]) {
    const denied = render(<ShopInfoPanel />, account);
    assert.ok(denied.includes(vi.shopInfo.noAccess));
    assert.ok(!denied.includes(vi.shopInfo.save));
  }
});

test('Vietnamese and English shop info texts cover the same problems', () => {
  assert.deepEqual(Object.keys(vi.shopInfo.problems), Object.keys(en.shopInfo.problems));
  assert.deepEqual(Object.keys(vi.shopInfo), Object.keys(en.shopInfo));
});
