import {
  LOYALTY_TIERS_V1,
  type CustomerComboUseResponse,
  type CustomerLedgerItemResponse,
  type LoyaltyWalletResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerLoyaltyScreen, WalletCard } from '../../components/customer/screens/loyalty';
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
  tierRows,
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

test('the tier table is the shared version 1 table, five tiers with a discount, never typed in the page', () => {
  const rows = tierRows();
  assert.deepEqual(
    rows.map((row) => [row.tier, row.fromPoints, row.discountPercent]),
    [
      ['SILVER', 500, 3],
      ['GOLD', 1000, 4],
      ['PLATINUM', 3000, 5],
      ['DIAMOND', 5000, 7],
      ['RUBY', 10000, 9],
    ],
  );
  // Every row comes from the contract table: a change there changes the page.
  assert.equal(rows.length, LOYALTY_TIERS_V1.filter((entry) => entry.tier !== 'NONE').length);
  assert.ok(
    rows.every((row, index) => index === 0 || row.fromPoints > rows[index - 1]!.fromPoints),
  );
});

function renderCard(locale: Locale, wallet: LoyaltyWalletResponse) {
  return renderToStaticMarkup(
    <CustomerContext.Provider
      value={{
        locale,
        t: getCustomerDictionary(locale),
        api: new ApiClient({ onUnauthenticated: () => undefined }),
        base: `/${locale}/account`,
        sessionLost: false,
      }}
    >
      <WalletCard wallet={wallet} />
    </CustomerContext.Provider>,
  );
}

test('the Beauty card shows the real tier percent of the Beauty wallet, like the Spa card (P6-11)', () => {
  const beauty: LoyaltyWalletResponse = {
    wallet: 'BEAUTY',
    balancePoints: 1200,
    tier: 'GOLD',
    memberDiscountBp: 400,
    nextTier: 'PLATINUM',
    pointsToNextTier: 1800,
  };
  for (const locale of ['vi', 'en'] as const) {
    const html = renderCard(locale, beauty);
    assert.match(html, /4%/, locale);
    assert.doesNotMatch(html, /mở bán|Beauty opens/);
  }
  // No tier yet: the same wording as the Spa card, not a "coming soon" notice.
  const none = renderCard('vi', {
    ...beauty,
    balancePoints: 40,
    tier: 'NONE',
    memberDiscountBp: 0,
    nextTier: 'SILVER',
    pointsToNextTier: 460,
  });
  assert.match(none, /Chưa có/);
  assert.doesNotMatch(none, /mở bán/);
  assert.match(renderCard('vi', { ...beauty, wallet: 'SPA' }), /4%/);
});

test('the tier section says how points are earned, in both languages', () => {
  assert.equal(
    vi.tiers.rule,
    '1.000đ thanh toán = 1 điểm. Điểm không hết hạn. Hạng mới áp dụng từ lần thanh toán sau.',
  );
  assert.match(en.tiers.rule, /1,000/);
  assert.match(en.tiers.rule, /never expire/);
  assert.match(en.tiers.rule, /next payment/);
});
