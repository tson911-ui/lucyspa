import type { CustomerReferralResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { employee, render } from '../../../test/support';
import { ReferralCard } from './referral-card';

/** Phase 5 P5-5: the referrer on a customer's profile and the two places its actions may appear. */
const l = loyaltyDictionary('vi');
const viewer = employee([['VIEW_LOYALTY', 'A']]);

const referral = (change: Partial<CustomerReferralResponse> = {}): CustomerReferralResponse => ({
  referrer: { id: 'r1', displayName: 'Nguyễn Thị Hoa', phoneMasked: '•••••••678' },
  boundVia: 'COUNTER',
  boundAt: '2027-03-01T03:00:00.000Z',
  boundByName: 'Lễ tân Linh',
  awarded: null,
  changes: [],
  ...change,
});
const show = (
  value: CustomerReferralResponse | null,
  can = { bindReferrer: false, changeReferrer: false },
  totals = { referred: 0, rewarded: 0 },
) =>
  render(
    <ReferralCard
      referral={value}
      asReferrer={totals}
      can={can}
      zone="Asia/Ho_Chi_Minh"
      onBind={() => undefined}
      onChange={() => undefined}
    />,
    viewer,
  );

test('no referrer: says so and offers the bind action only to the one who may', () => {
  const none = show(null);
  assert.ok(none.includes(l.referral.card.none));
  assert.ok(!none.includes(l.referral.card.bind));
  const bindable = show(null, { bindReferrer: true, changeReferrer: false });
  assert.ok(bindable.includes(l.referral.card.bind));
  assert.ok(!bindable.includes(l.referral.card.change));
});

test('a pending referral shows the referrer, how it was recorded and the waiting reward', () => {
  const html = show(referral(), { bindReferrer: false, changeReferrer: true });
  assert.ok(html.includes('Nguyễn Thị Hoa'));
  assert.ok(html.includes('•••••••678'));
  assert.ok(html.includes(`${l.referral.via.COUNTER} (Lễ tân Linh)`));
  assert.ok(html.includes(l.referral.status.PENDING));
  assert.ok(html.includes(l.referral.card.pending));
  assert.ok(html.includes(l.referral.card.change), 'the Owner may change it before the reward');
  assert.ok(!html.includes(l.referral.card.bind));
});

test('a rewarded referral is locked: no action, the award facts are shown', () => {
  const html = show(
    referral({ awarded: { at: '2027-03-02T03:00:00.000Z', invoiceCode: 'HD-0001' } }),
    { bindReferrer: false, changeReferrer: false },
  );
  assert.ok(html.includes(l.referral.status.REWARDED));
  assert.ok(html.includes('HD-0001'));
  assert.ok(!html.includes(l.referral.card.change));
});

test('Owner corrections are listed and the referrer totals appear on the referrer', () => {
  const html = show(
    referral({
      changes: [
        {
          id: 'c1',
          oldReferrer: { id: 'r0', displayName: 'Trần Văn Nam', phoneMasked: '•••••••111' },
          newReferrer: { id: 'r1', displayName: 'Nguyễn Thị Hoa', phoneMasked: '•••••••678' },
          reason: 'Khách nhập nhầm số',
          actorName: 'Chủ spa',
          createdAt: '2027-03-01T04:00:00.000Z',
        },
      ],
    }),
    { bindReferrer: false, changeReferrer: true },
    { referred: 3, rewarded: 2 },
  );
  assert.ok(html.includes(l.referral.card.history));
  assert.ok(html.includes('Trần Văn Nam'));
  assert.ok(html.includes('Khách nhập nhầm số'));
  assert.ok(html.includes('3 khách, 2 khách đã được thưởng'));
});
