import type { InvoiceResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { employee, render } from '../../../test/support';
import { DiscountCard } from './pos-sections';

/** Phase 5 P5-4: staff always see the winner and why, including the Member Discount (PRD 14.1, 16.1). */
const vi = getWorkforceDictionary('vi');
const l = loyaltyDictionary('vi');
const cashier = employee([['VIEW_INVOICES', 'A']]);

const member = (change: Partial<NonNullable<InvoiceResponse['discount']['member']>> = {}) => ({
  tier: 'GOLD' as const,
  tierTableVersion: 1,
  balanceBefore: 1_100,
  discountBp: 400,
  eligibleSubtotalVnd: '500000',
  amountVnd: '20000',
  eligible: true,
  reason: null,
  winner: true,
  ...change,
});
const candidate = {
  source: 'PROMOTION' as const,
  discountId: 'd1',
  discountCode: 'SALE15',
  nameVi: 'Khuyến mãi 15%',
  nameEn: 'Sale 15%',
  versionId: 'v1',
  versionNo: 1,
  voucherId: null,
  voucherCode: null,
  kind: 'PERCENT' as const,
  percentBp: 1500,
  fixedAmountVnd: null,
  eligibleSubtotalVnd: '500000',
  eligible: true,
  reason: null,
  amountVnd: '75000',
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
      selectionReason: null,
      vouchers: [],
      appliedAt: null,
      ...discount,
    },
  }) as unknown as InvoiceResponse;

test('the member discount that won reads "Gold 4% được áp dụng" with its reason and its own row', () => {
  const html = render(
    <DiscountCard
      invoice={invoice({
        winnerSource: 'MEMBER_TIER',
        member: member(),
        selectionReason: 'MEMBER_ONLY_ELIGIBLE',
      })}
    />,
    cashier,
  );
  assert.ok(html.includes('Gold 4% được áp dụng'));
  assert.ok(html.includes(l.member.reasons.MEMBER_ONLY_ELIGIBLE));
  assert.ok(html.includes('Giảm giá hội viên Gold'));
  assert.ok(html.includes(l.member.source));
  assert.ok(html.includes(vi.pos.candidateWinner));
  assert.ok(!html.includes(vi.pos.discountNone));
});

test('a promotion that beat an eligible member discount says why, and the member row is listed as not chosen', () => {
  const html = render(
    <DiscountCard
      invoice={invoice({
        winner: candidate,
        winnerSource: 'PROMOTION',
        candidates: [candidate],
        member: member({ winner: false }),
        selectionReason: 'PROGRAM_BEATS_MEMBER',
      })}
    />,
    cashier,
  );
  assert.ok(html.includes('Khuyến mãi 15%'));
  assert.ok(html.includes(l.member.reasons.PROGRAM_BEATS_MEMBER));
  assert.ok(html.includes('Giảm giá hội viên Gold'));
  assert.ok(html.includes(vi.pos.candidateEligible), 'the member row is eligible but not chosen');
});

test('no tier: the member row says why; a draft says the tier is a preview that is fixed at finalization', () => {
  const html = render(
    <DiscountCard
      invoice={invoice({
        preview: true,
        member: member({
          tier: 'NONE',
          discountBp: 0,
          amountVnd: '0',
          eligible: false,
          reason: 'NO_TIER',
          winner: false,
        }),
      })}
    />,
    cashier,
  );
  assert.ok(html.includes(l.member.ineligible.NO_TIER));
  assert.ok(html.includes(l.member.previewNote));
  assert.ok(html.includes(vi.pos.discountNone));
});

test('a guest payer or a switched-off programme shows no member row at all', () => {
  const html = render(<DiscountCard invoice={invoice({})} />, cashier);
  assert.ok(!html.includes('Giảm giá hội viên'));
  assert.ok(html.includes(vi.pos.discountNone));
});
