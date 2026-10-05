import type { CustomerComboUseResponse, CustomerLedgerItemResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerLoyaltyScreen } from '../../components/customer/screens/loyalty';
import { CustomerContext } from '../../components/customer/session';
import { getCustomerDictionary } from '../../i18n/customer';
import { customerLoyaltyDictionary } from '../../i18n/customer-loyalty';
import type { Locale } from '../../i18n/locales';
import { ApiClient } from '../api/client';
import {
  comboTone,
  formatDay,
  formatSignedPoints,
  giftTone,
  historyText,
  referralTone,
  usedByText,
} from './loyalty';

const vi = customerLoyaltyDictionary('vi');
const en = customerLoyaltyDictionary('en');

const entry = (over: Partial<CustomerLedgerItemResponse>): CustomerLedgerItemResponse => ({
  id: 'e1',
  wallet: 'SPA',
  kind: 'EARNED',
  points: 10,
  createdAt: '2026-10-05T18:30:00.000Z',
  ...over,
});

test('dates are the Vietnam calendar day; points carry a plus or a true minus', () => {
  // 18:30 UTC is already the next day in Vietnam (UTC+7).
  assert.equal(formatDay('2026-10-05T18:30:00.000Z', 'vi'), '06/10/2026');
  assert.equal(formatDay('2026-10-05T10:30:00.000Z', 'en'), '05/10/2026');
  assert.equal(formatSignedPoints(1250, 'vi'), '+1.250');
  assert.equal(formatSignedPoints(-20, 'en'), '−20');
  assert.equal(formatSignedPoints(0, 'en'), '0');
});

test('the points history reads in simple words and never shows a staff reason', () => {
  assert.equal(historyText(entry({}), vi), 'Tích điểm từ hóa đơn');
  assert.equal(
    historyText(entry({ kind: 'TAKEN_BACK', points: -10 }), en),
    'Taken back for an invoice',
  );
  assert.equal(historyText(entry({ kind: 'REFERRAL' }), vi), 'Thưởng giới thiệu');
  assert.equal(historyText(entry({ kind: 'ADJUSTED' }), vi), 'Điều chỉnh bởi Lucy Spa');
  assert.equal(historyText(entry({ kind: 'ADJUSTED' }), en), 'Adjusted by Lucy Spa');
});

test('a combo use shows the owner as "you" and a relative only by a masked name', () => {
  const use = (over: Partial<CustomerComboUseResponse>): CustomerComboUseResponse => ({
    id: 'u',
    usedAt: '2026-10-05T03:00:00.000Z',
    comboNameVi: 'Combo',
    comboNameEn: 'Combo',
    serviceNameVi: 'Massage',
    serviceNameEn: 'Massage',
    sessionKind: 'PAID',
    usedBy: 'OWNER',
    recipientMasked: null,
    branchName: 'Đà Nẵng',
    ...over,
  });
  assert.equal(usedByText(use({}), vi), 'Bạn');
  assert.equal(
    usedByText(use({ usedBy: 'RELATIVE', recipientMasked: 'N••• T••• L•••' }), vi),
    'Người thân: N••• T••• L•••',
  );
  assert.equal(usedByText(use({ usedBy: 'RELATIVE' }), en), 'Relative');
});

test('status tones: only what can be used now is green; a paused combo is a warning', () => {
  assert.equal(comboTone('ACTIVE'), 'success');
  assert.equal(comboTone('PAUSED'), 'warning');
  assert.equal(comboTone('USED_UP'), 'neutral');
  assert.equal(comboTone('EXPIRED'), 'neutral');
  assert.equal(giftTone('ACTIVE'), 'success');
  assert.equal(giftTone('VOIDED'), 'neutral');
  assert.equal(referralTone('REWARDED'), 'success');
  assert.equal(referralTone('WAITING'), 'neutral');
});

test('both languages carry every text and neither says "khám"', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
      : [prefix];
  assert.deepEqual(keys(vi), keys(en));
  assert.doesNotMatch(JSON.stringify(vi), /khám/i);
});

function render(locale: Locale) {
  const t = getCustomerDictionary(locale);
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={{ push: () => undefined } as never}>
      <CustomerContext.Provider
        value={{
          locale,
          t,
          api: new ApiClient({ onUnauthenticated: () => undefined }),
          base: `/${locale}/account`,
          sessionLost: false,
        }}
      >
        <CustomerLoyaltyScreen />
      </CustomerContext.Provider>
    </AppRouterContext.Provider>,
  );
}

test('the page opens with its single heading, then loads; nothing is shown before the server answers', () => {
  const html = render('vi');
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /Điểm thưởng và ưu đãi/);
  assert.doesNotMatch(html, /Lịch sử điểm|Combo của tôi|Quà tặng của tôi/);
  assert.match(render('en'), /Points and rewards/);
});
