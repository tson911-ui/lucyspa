import type { InvoiceBirthdayGift, InvoiceResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { birthdayDictionary } from '../../../i18n/birthday';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { employee, render } from '../../../test/support';
import { DiscountCard } from './pos-sections';

/** Phase 5 P5-6: the birthday gift is its own layer on the invoice, after the best offer; staff see whether and why. */
const vi = getWorkforceDictionary('vi');
const l = loyaltyDictionary('vi');
const b = birthdayDictionary('vi').invoice;
const cashier = employee([['VIEW_INVOICES', 'A']]);

const gift = (change: Partial<InvoiceBirthdayGift> = {}): InvoiceBirthdayGift => ({
  versionNo: 1,
  kind: 'FIXED_AMOUNT',
  percentBp: null,
  fixedAmountVnd: '50000',
  minSpendVnd: '300000',
  birthdayOn: '2027-03-01',
  baseVnd: '465000',
  amountVnd: '50000',
  applied: true,
  mode: 'STACKED',
  reason: null,
  ...change,
});
const member = {
  tier: 'DIAMOND' as const,
  tierTableVersion: 1,
  balanceBefore: 5_200,
  discountBp: 700,
  eligibleSubtotalVnd: '500000',
  amountVnd: '35000',
  eligible: true,
  reason: null,
  winner: true,
};
const invoice = (discount: Partial<InvoiceResponse['discount']>): InvoiceResponse =>
  ({
    status: 'PENDING_PAYMENT',
    discount: {
      preview: false,
      candidates: [],
      winner: null,
      winnerSource: null,
      member: null,
      birthday: null,
      selectionReason: null,
      vouchers: [],
      appliedAt: null,
      ...discount,
    },
  }) as unknown as InvoiceResponse;

test('a gift added on top of the member discount is a separate success line with its own row and the birthday date', () => {
  const html = render(
    <DiscountCard
      invoice={invoice({
        winnerSource: 'MEMBER_TIER',
        member,
        birthday: gift(),
        selectionReason: 'MEMBER_ONLY_ELIGIBLE',
      })}
    />,
    cashier,
  );
  assert.ok(html.includes('Diamond 7% được áp dụng'), 'the ordinary winner is still announced');
  assert.ok(html.includes(b.stacked));
  assert.ok(html.includes('50.000 ₫'));
  assert.ok(html.includes(b.rowName));
  assert.ok(html.includes(b.source));
  assert.ok(html.includes('01/03/2027'));
  assert.ok(!html.includes(vi.pos.discountNone));
});

test('a gift that replaced the offer is the only benefit and says why', () => {
  const html = render(
    <DiscountCard
      invoice={invoice({
        winnerSource: 'BIRTHDAY',
        member: { ...member, winner: false },
        birthday: gift({ mode: 'REPLACES_OFFER', baseVnd: '465000', amountVnd: '100000' }),
        selectionReason: 'BIRTHDAY_BEATS_OFFER',
      })}
    />,
    cashier,
  );
  assert.ok(html.includes(b.replaces));
  assert.ok(html.includes(b.reasons.BIRTHDAY_BEATS_OFFER));
  assert.ok(!html.includes('Diamond 7% được áp dụng'));
  assert.ok(!html.includes(vi.pos.discountNone), 'no "no benefit" line next to a gift');
});

test('a gift standing alone is announced without a program winner', () => {
  const html = render(
    <DiscountCard
      invoice={invoice({
        winnerSource: 'BIRTHDAY',
        birthday: gift({ mode: 'ALONE', baseVnd: '500000' }),
        selectionReason: 'BIRTHDAY_ONLY',
      })}
    />,
    cashier,
  );
  assert.ok(html.includes(b.alone));
  assert.ok(html.includes(b.reasons.BIRTHDAY_ONLY));
  assert.ok(!html.includes(vi.pos.discountNone));
});

test('a gift that was not used says why: minimum spend, usage limit, or the offer saves more', () => {
  const reasons = [
    'BELOW_MIN_SPEND',
    'USAGE_LIMIT_REACHED',
    'OFFER_IS_BETTER',
    'NO_AMOUNT',
  ] as const;
  for (const reason of reasons) {
    const html = render(
      <DiscountCard
        invoice={invoice({
          winnerSource: 'MEMBER_TIER',
          member,
          birthday: gift({ applied: false, mode: null, reason }),
        })}
      />,
      cashier,
    );
    const text = b.notApplied[reason].replace('{amount}', '300.000 ₫');
    assert.ok(html.includes(text), reason);
    assert.ok(!html.includes(b.stacked));
  }
});

test('no gift context: nothing about birthdays; a draft that has one says it is fixed at finalization', () => {
  const none = render(<DiscountCard invoice={invoice({})} />, cashier);
  assert.ok(!none.includes(b.rowName));
  const draft = render(
    <DiscountCard
      invoice={invoice({
        preview: true,
        birthday: gift({ mode: 'ALONE' }),
        winnerSource: 'BIRTHDAY',
      })}
    />,
    cashier,
  );
  assert.ok(draft.includes(b.previewNote));
  // Member discount copy is untouched.
  assert.ok(l.member.previewNote.length > 0);
});
