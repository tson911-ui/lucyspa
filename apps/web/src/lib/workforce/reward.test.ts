import type { BranchSummary, RewardCatalogItemResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewardDictionary } from '../../i18n/reward';
import { employee } from '../../test/support';
import { ApiError } from './api';
import { loyaltyTabs } from './loyalty';
import {
  createItemRequest,
  draftFromItem,
  editItemRequest,
  emptyIssueDraft,
  emptyItemDraft,
  expiryText,
  issueRequest,
  rewardBranches,
  rewardErrorText,
  statusTone,
  validateIssueDraft,
  validateItemDraft,
  type RewardItemDraft,
} from './reward';

/** Phase 5 P5-9: the reward catalog form ships empty, validates everything and sends only the contract's fields. */
const filled = (change: Partial<RewardItemDraft> = {}): RewardItemDraft => ({
  ...emptyItemDraft(),
  kind: 'VOUCHER',
  nameVi: 'Phiếu tri ân',
  nameEn: 'Thank-you voucher',
  ...change,
});

const item = (change: Partial<RewardCatalogItemResponse> = {}): RewardCatalogItemResponse => ({
  id: 'r1',
  code: 'REWARD-ABC234',
  kind: 'FREE_SERVICE',
  service: { id: 'svc-1', nameVi: 'Massage', nameEn: 'Massage' },
  nameVi: 'Massage miễn phí',
  nameEn: 'Free massage',
  active: true,
  expiryDays: 30,
  rowVersion: 3,
  createdAt: '2027-03-01T00:00:00.000Z',
  updatedAt: '2027-03-02T00:00:00.000Z',
  createdByName: 'Chủ spa',
  ...change,
});

test('a new reward starts empty: nothing is preset and nothing is sent until it is valid', () => {
  const draft = emptyItemDraft();
  assert.equal(draft.kind, '');
  assert.equal(draft.nameVi, '');
  assert.equal(draft.expiry, 'never');
  assert.deepEqual(validateItemDraft(draft, false), {
    kind: 'required',
    nameVi: 'required',
    nameEn: 'required',
  });
  assert.equal(createItemRequest(draft), null);
});

test('a free service needs a service; the other kinds send none; the request carries only the contract fields', () => {
  assert.equal(validateItemDraft(filled({ kind: 'FREE_SERVICE' }), false).serviceId, 'required');
  assert.deepEqual(createItemRequest(filled({ kind: 'FREE_SERVICE', serviceId: 'svc-1' })), {
    kind: 'FREE_SERVICE',
    serviceId: 'svc-1',
    nameVi: 'Phiếu tri ân',
    nameEn: 'Thank-you voucher',
    active: true,
    expiryDays: null,
  });
  // A service picked before the kind was changed is never sent for another kind.
  assert.equal(createItemRequest(filled({ kind: 'VOUCHER', serviceId: 'svc-1' }))?.serviceId, null);
  assert.equal(createItemRequest(filled({ kind: 'PRODUCT_GIFT' }))?.expiryDays, null);
});

test('the validity is never, or a whole number of days from 1 to 3650', () => {
  const days = (text: string) =>
    validateItemDraft(filled({ expiry: 'days', days: text }), false).days;
  assert.equal(days(''), 'required');
  for (const bad of ['0', '-1', '1.5', 'abc', '3651', '12345'])
    assert.equal(days(bad), 'invalid', bad);
  assert.equal(days('1'), undefined);
  assert.equal(days('3650'), undefined);
  assert.equal(createItemRequest(filled({ expiry: 'days', days: ' 14 ' }))?.expiryDays, 14);
  // Switching back to "never" drops a typed number.
  assert.equal(createItemRequest(filled({ expiry: 'never', days: '14' }))?.expiryDays, null);
});

test('editing starts from the saved item, never sends the kind or the service, and carries its row version', () => {
  const draft = draftFromItem(item());
  assert.equal(draft.kind, 'FREE_SERVICE');
  assert.equal(draft.serviceId, 'svc-1');
  assert.equal(draft.expiry, 'days');
  assert.equal(draft.days, '30');
  assert.equal(validateItemDraft(draft, true).kind, undefined);
  assert.deepEqual(editItemRequest({ ...draft, nameVi: '  Massage mới ', active: false }, 3), {
    expectedRowVersion: 3,
    nameVi: 'Massage mới',
    nameEn: 'Free massage',
    active: false,
    expiryDays: 30,
  });
  assert.equal(editItemRequest({ ...draft, nameEn: '   ' }, 3), null);
  assert.equal(draftFromItem(item({ expiryDays: null })).expiry, 'never');
  assert.equal(expiryText(null, 'vi'), 'Không hết hạn');
  assert.equal(expiryText(30, 'vi'), '30 ngày kể từ ngày tặng');
  assert.equal(expiryText(30, 'en'), '30 days from the grant date');
});

test('a grant needs the reward, a quantity from 1 to 50 and a reason, and sends only those', () => {
  const draft = emptyIssueDraft();
  assert.equal(draft.quantity, '1');
  assert.deepEqual(validateIssueDraft(draft), { catalogItemId: 'required', reason: 'required' });
  assert.equal(issueRequest(draft), null);
  for (const bad of ['0', '51', '1.5', 'x', '']) {
    assert.ok(
      validateIssueDraft({ catalogItemId: 'r1', quantity: bad, reason: 'Tri ân' }).quantity,
      bad,
    );
  }
  assert.equal(
    validateIssueDraft({ catalogItemId: 'r1', quantity: '1', reason: 'x'.repeat(501) }).reason,
    'invalid',
  );
  assert.deepEqual(issueRequest({ catalogItemId: 'r1', quantity: ' 3 ', reason: '  Tri ân  ' }), {
    catalogItemId: 'r1',
    quantity: 3,
    reason: 'Tri ân',
  });
});

test('error texts: the reward codes first, the shared message otherwise; the status colours', () => {
  const refusal = (code: string) => new ApiError(409, code);
  const fallback = () => 'shared';
  for (const locale of ['vi', 'en'] as const) {
    for (const code of [
      'REWARD_SERVICE_INVALID',
      'REWARD_ITEM_INACTIVE',
      'REWARD_NOT_USABLE',
      'REWARD_NOTHING_LEFT',
      'REWARD_ALREADY_VOIDED',
      'REWARD_USE_NOT_RESTORABLE',
      'LOYALTY_NOT_LIVE',
    ]) {
      const text = rewardErrorText(refusal(code), locale, fallback);
      assert.notEqual(text, 'shared', code);
      assert.equal(text, (rewardDictionary(locale).errors as Record<string, string>)[code]);
    }
  }
  assert.equal(rewardErrorText(refusal('OTHER'), 'vi', fallback), 'shared');
  assert.equal(statusTone('ACTIVE'), 'success');
  assert.equal(statusTone('USED_UP'), 'neutral');
  assert.equal(statusTone('EXPIRED'), 'warning');
  assert.equal(statusTone('VOIDED'), 'error');
});

test('both languages have the same texts, and no Vietnamese text uses the word for a medical examination', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
      : [prefix];
  assert.deepEqual(keys(rewardDictionary('vi')), keys(rewardDictionary('en')));
  // Lucy Spa is a spa, not a clinic (Owner rule).
  assert.ok(!/khám(?! phá)/i.test(JSON.stringify(rewardDictionary('vi'))));
});

test('the gift desk is offered to ISSUE_REWARDS at a branch, the catalog to the global MANAGE_REWARD_CATALOG', () => {
  const branches = new Map<string, BranchSummary>([
    ['b1', { id: 'b1', name: 'Chi nhánh 1', isActive: true } as BranchSummary],
    ['b2', { id: 'b2', name: 'Chi nhánh 2', isActive: false } as BranchSummary],
  ]);
  const desk = (grants: Parameters<typeof employee>[0]) =>
    loyaltyTabs(employee(grants), branches).rewardDesk;
  assert.equal(desk([['ISSUE_REWARDS', 'b1']]), true);
  assert.equal(desk([['ISSUE_REWARDS', 'b2']]), false, 'a closed branch does not count');
  assert.equal(desk([['VIEW_LOYALTY', 'b1']]), false);
  assert.equal(desk([['MANAGE_REWARD_CATALOG']]), false);
  const catalog = (grants: Parameters<typeof employee>[0]) =>
    loyaltyTabs(employee(grants), branches).rewardCatalog;
  assert.equal(catalog([['MANAGE_REWARD_CATALOG']]), true);
  assert.equal(catalog([['MANAGE_REWARD_CATALOG', 'b1']]), false);
  assert.equal(catalog([['ISSUE_REWARDS', 'b1']]), false);
  assert.deepEqual(
    rewardBranches(employee([['ISSUE_REWARDS', 'b1']]), branches).map((branch) => branch.id),
    ['b1'],
  );
});
