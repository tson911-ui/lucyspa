import type { ComboSoldItemResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  soldEvent,
  soldReason,
  soldTone,
} from '../../components/workforce/screens/loyalty-combo-sold';
import { comboSoldDictionary } from '../../i18n/combo-sold';
import { normalizeLoyaltyPage } from './loyalty-list';

const item = (over: Partial<ComboSoldItemResponse>): ComboSoldItemResponse => ({
  purchaseId: 'p',
  buyer: { id: 'u', displayName: 'Phạm Mai An', phoneMasked: '090••••31' },
  comboNameVi: 'Combo',
  comboNameEn: 'Combo',
  serviceNameVi: 'Massage',
  serviceNameEn: 'Massage',
  soldAt: '2026-10-05T03:00:00.000Z',
  branchName: 'Đà Nẵng',
  saleInvoiceCode: 'INV-261005-AAAAAA',
  paidSessions: 3,
  bonusSessions: 1,
  paidLeft: 2,
  bonusLeft: 1,
  expiresAt: null,
  status: 'ACTIVE',
  event: null,
  valueVnd: null,
  ...over,
});

test('every state has its own tone, and a frozen or revoked combo explains itself', () => {
  assert.equal(soldTone('ACTIVE'), 'success');
  assert.equal(soldTone('FROZEN'), 'warning');
  assert.equal(soldTone('REVOKED'), 'error');
  assert.equal(soldTone('USED_UP'), 'neutral');
  assert.equal(soldTone('EXPIRED'), 'neutral');
  assert.equal(soldEvent(item({}), 'vi'), '—');
  assert.equal(soldReason(item({}), 'vi'), '—');
  const frozen = item({
    status: 'FROZEN',
    event: {
      kind: 'FROZEN',
      at: '2026-10-05T18:30:00.000Z',
      cause: 'SALE_REVERSED',
    },
  });
  // 18:30 UTC is already the next day in Vietnam.
  assert.equal(soldEvent(frozen, 'vi'), 'Khóa 06/10/2026');
  assert.equal(soldReason(frozen, 'vi'), 'thanh toán bị đảo');
  const revoked = item({
    status: 'REVOKED',
    event: {
      kind: 'REVOKED',
      at: '2026-10-05T03:00:00.000Z',
      cause: 'SALE_CANCELLED',
    },
  });
  assert.equal(soldEvent(revoked, 'en'), 'Revoked 05/10/2026');
  assert.equal(soldReason(revoked, 'en'), 'invoice cancelled');
});

test('the status filter belongs to its tab: a combo status on the combos-sold tab, a referral one on the referral tab', () => {
  const base = { tab: '', page: 1, status: '' };
  assert.equal(
    normalizeLoyaltyPage({ ...base, tab: 'comboSold', status: 'FROZEN' }).status,
    'FROZEN',
  );
  assert.equal(normalizeLoyaltyPage({ ...base, tab: 'comboSold', status: 'PENDING' }).status, '');
  assert.equal(
    normalizeLoyaltyPage({ ...base, tab: 'referrals', status: 'PENDING' }).status,
    'PENDING',
  );
  assert.equal(normalizeLoyaltyPage({ ...base, tab: 'referrals', status: 'FROZEN' }).status, '');
  assert.equal(normalizeLoyaltyPage({ ...base, tab: 'comboSold' }).tab, 'comboSold');
});

test('both languages carry every text and never say "khám"', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
      : [prefix];
  assert.deepEqual(keys(comboSoldDictionary('vi')), keys(comboSoldDictionary('en')));
  assert.doesNotMatch(JSON.stringify(comboSoldDictionary('vi')), /khám/i);
});
