import type { RewardCatalogItemResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../api/client';
import { rewardDictionary } from '../../i18n/reward';
import {
  createItemRequest,
  draftFromItem,
  editItemRequest,
  emptyItemDraft,
  rewardErrorText,
} from './reward';

/** Phase 6 P6-18 (Q10): the stock link of a product gift in the catalog form. */
const variant = {
  id: 'v1',
  sku: 'KEM-50',
  nameVi: 'Kem dưỡng',
  nameEn: 'Day cream',
  labelVi: '50 ml',
  labelEn: '50 ml',
};
const gift = (patch: Partial<RewardCatalogItemResponse> = {}): RewardCatalogItemResponse => ({
  id: 'r1',
  code: 'REWARD-ABC234',
  kind: 'PRODUCT_GIFT',
  service: null,
  variant: null,
  nameVi: 'Kem tặng',
  nameEn: 'Free cream',
  active: true,
  expiryDays: null,
  rowVersion: 2,
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
  createdByName: 'Chủ spa',
  ...patch,
});
const filled = (kind: 'PRODUCT_GIFT' | 'VOUCHER', variantId: string) => ({
  ...emptyItemDraft(),
  kind,
  variantId,
  nameVi: 'Tên',
  nameEn: 'Name',
});

test('a new product gift sends its variant only when one was chosen; other kinds never do', () => {
  assert.equal(createItemRequest(filled('PRODUCT_GIFT', 'v1'))?.variantId, 'v1');
  assert.equal(
    'variantId' in (createItemRequest(filled('PRODUCT_GIFT', '')) ?? {}),
    false,
    'no product: no stock moves',
  );
  assert.equal('variantId' in (createItemRequest(filled('VOUCHER', 'v1')) ?? {}), false);
});

test('an edit keeps the link when it is untouched, and sends the new one (or null) when it changed', () => {
  const linked = gift({ variant });
  const same = draftFromItem(linked);
  assert.equal(same.variantId, 'v1');
  assert.equal('variantId' in (editItemRequest(same, 2, linked) ?? {}), false, 'untouched: absent');
  assert.equal(editItemRequest({ ...same, variantId: 'v2' }, 2, linked)?.variantId, 'v2');
  assert.equal(editItemRequest({ ...same, variantId: '' }, 2, linked)?.variantId, null);
  const unlinked = gift();
  assert.equal(
    editItemRequest({ ...draftFromItem(unlinked), variantId: 'v1' }, 2, unlinked)?.variantId,
    'v1',
  );
  // A caller that does not pass the item (the older call) sends nothing about the link.
  assert.equal('variantId' in (editItemRequest({ ...same, variantId: 'v2' }, 2) ?? {}), false);
  // A gift of another kind never relinks.
  const voucher = gift({ kind: 'VOUCHER' });
  assert.equal('variantId' in (editItemRequest(draftFromItem(voucher), 2, voucher) ?? {}), false);
});

test('"Hết hàng" and the locked link read as plain words in both languages', () => {
  const out = new ApiError(409, 'REWARD_OUT_OF_STOCK');
  assert.match(
    rewardErrorText(out, 'vi', () => 'x'),
    /^Hết hàng/,
  );
  assert.match(
    rewardErrorText(out, 'en', () => 'x'),
    /^Out of stock/,
  );
  assert.equal(
    rewardErrorText(new ApiError(409, 'REWARD_GIFT_LINK_LOCKED'), 'vi', () => 'x'),
    rewardDictionary('vi').errors.REWARD_GIFT_LINK_LOCKED,
  );
  for (const text of Object.values(rewardDictionary('vi').errors))
    assert.doesNotMatch(text, /khám/i);
});
