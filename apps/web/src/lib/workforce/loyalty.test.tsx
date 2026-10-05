import type { BranchSummary, LoyaltyLedgerEntryResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdjustDialog } from '../../components/workforce/screens/loyalty-adjust-dialog';
import { LoyaltyCustomerScreen } from '../../components/workforce/screens/loyalty-customer';
import { LoyaltyGoLive } from '../../components/workforce/screens/loyalty-go-live';
import { LoyaltyScreen } from '../../components/workforce/screens/loyalty';
import { loyaltyDictionary } from '../../i18n/loyalty';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { ApiError } from './api';
import {
  adjustmentBody,
  canCorrect,
  correctionDraft,
  formatPoints,
  loyaltyBranches,
  loyaltyErrorMessage,
  loyaltyTabs,
  parseAmount,
  referralErrorMessage,
  tierTone,
} from './loyalty';
import { normalizeLedger, normalizeLoyaltyPage } from './loyalty-list';
import { navigationFor } from './permissions';

const vi = getWorkforceDictionary('vi');
const l = loyaltyDictionary('vi');

const branch = (id: string, name: string, isActive = true): BranchSummary =>
  ({ id, name, isActive }) as BranchSummary;
const branches = new Map([
  ['b1', branch('b1', 'Quận 1')],
  ['b2', branch('b2', 'Quận 3')],
  ['b3', branch('b3', 'Đã đóng', false)],
]);
const entry = (change: Partial<LoyaltyLedgerEntryResponse> = {}): LoyaltyLedgerEntryResponse => ({
  id: 'e1',
  wallet: 'SPA',
  kind: 'EARN',
  points: 930,
  shortfallPoints: 0,
  invoiceCode: 'HD-1',
  paidSeq: 1,
  reason: null,
  actorName: null,
  correctsEntryId: null,
  reversesEntryId: null,
  corrected: false,
  createdAt: '2027-03-01T00:00:00.000Z',
  ...change,
});

test('points are formatted with the locale grouping and a true minus sign', () => {
  assert.equal(formatPoints(1130, 'vi'), '1.130');
  assert.equal(formatPoints(1130, 'en'), '1,130');
  assert.equal(formatPoints(120, 'en', true), '+120');
  assert.equal(formatPoints(-40, 'en', true), '−40');
  assert.equal(formatPoints(0, 'en', true), '0');
});

test('an amount is a positive whole number within the bound, nothing else', () => {
  assert.equal(parseAmount('120'), 120);
  assert.equal(parseAmount(' 1000000 '), 1_000_000);
  for (const bad of ['', '0', '-5', '1.5', '1,5', 'abc', '1000001', '01', '12345678']) {
    assert.equal(parseAmount(bad), null, bad);
  }
});

test('the adjustment body carries the wallet, the signed points, the reason and the client id only', () => {
  const draft = {
    wallet: 'BEAUTY' as const,
    direction: 'subtract' as const,
    amount: '40',
    reason: ' Sửa nhầm ',
  };
  assert.deepEqual(adjustmentBody(draft, 'uuid-1'), {
    wallet: 'BEAUTY',
    points: -40,
    reason: 'Sửa nhầm',
    clientRequestId: 'uuid-1',
  });
  assert.deepEqual(adjustmentBody({ ...draft, direction: 'add' }, 'uuid-1', 'entry-9'), {
    wallet: 'BEAUTY',
    points: 40,
    reason: 'Sửa nhầm',
    clientRequestId: 'uuid-1',
    correctsEntryId: 'entry-9',
  });
  // Incomplete drafts send nothing.
  assert.equal(adjustmentBody({ ...draft, amount: '' }, 'uuid-1'), null);
  assert.equal(adjustmentBody({ ...draft, reason: '   ' }, 'uuid-1'), null);
  assert.equal(adjustmentBody({ ...draft, reason: 'x'.repeat(501) }, 'uuid-1'), null);
});

test('a correction starts as the opposite of the entry and only an uncorrected, moving entry offers it', () => {
  assert.deepEqual(correctionDraft(entry()), {
    wallet: 'SPA',
    direction: 'subtract',
    amount: '930',
    reason: '',
  });
  assert.deepEqual(
    correctionDraft(entry({ kind: 'EARN_REVERSAL', points: -200, shortfallPoints: 150 })),
    { wallet: 'SPA', direction: 'add', amount: '200', reason: '' },
  );
  assert.equal(canCorrect(entry()), true);
  assert.equal(canCorrect(entry({ corrected: true })), false);
  assert.equal(canCorrect(entry({ kind: 'MANUAL_CORRECTION' })), false);
  assert.equal(
    canCorrect(entry({ points: 0, shortfallPoints: 40, kind: 'MANUAL_ADJUSTMENT' })),
    false,
  );
});

test('loyalty branches and tabs follow the permissions, never role names', () => {
  const viewer = employee([['VIEW_LOYALTY', 'b1']]);
  assert.deepEqual(
    loyaltyBranches(viewer, branches).map((item) => item.id),
    ['b1'],
  );
  assert.deepEqual(
    loyaltyBranches(owner, branches).map((item) => item.id),
    ['b1', 'b2'],
  );
  assert.deepEqual(loyaltyTabs(viewer, branches), {
    customers: true,
    referrals: true,
    exceptions: false,
    combos: false,
    comboUsage: false,
    birthday: false,
    goLive: false,
  });
  assert.deepEqual(loyaltyTabs(owner, branches), {
    customers: true,
    referrals: true,
    exceptions: true,
    combos: true,
    comboUsage: true,
    birthday: true,
    goLive: true,
  });
  // The exceptions list is organization-wide: a branch grant does not open it.
  assert.equal(
    loyaltyTabs(employee([['VIEW_LOYALTY_EXCEPTIONS', 'b1']]), branches).exceptions,
    false,
  );
  assert.equal(loyaltyTabs(employee([['VIEW_LOYALTY_EXCEPTIONS']]), branches).exceptions, true);
  // Only the Owner holds the go-live switch (the API refuses it to any role, so a grant is a stale hint).
  assert.equal(loyaltyTabs(employee([['VIEW_LOYALTY']]), branches).goLive, false);
  // The birthday gift setup is the Owner's alone too (Phase 5 P5-6): no staff grant opens the tab.
  assert.equal(loyaltyTabs(employee([['VIEW_LOYALTY']]), branches).birthday, false);
});

test('the sidebar offers the loyalty page to those who can use it', () => {
  const keys = (account: Parameters<typeof navigationFor>[0]) =>
    navigationFor(account).map((item) => item.key);
  assert.ok(keys(owner).includes('loyalty'));
  assert.ok(keys(employee([['VIEW_LOYALTY', 'b1']])).includes('loyalty'));
  assert.ok(keys(employee([['VIEW_LOYALTY_EXCEPTIONS']])).includes('loyalty'));
  assert.ok(!keys(employee([['VIEW_INVOICES', 'b1']])).includes('loyalty'));
  assert.ok(!keys(employee()).includes('loyalty'));
});

test('tier tone, URL state and error text', () => {
  assert.equal(tierTone('NONE'), 'neutral');
  assert.equal(tierTone('GOLD'), 'info');
  assert.deepEqual(normalizeLedger({ wallet: 'X', page: 0 }), { wallet: '', page: 1 });
  assert.deepEqual(normalizeLedger({ wallet: 'BEAUTY', page: 3 }), { wallet: 'BEAUTY', page: 3 });
  assert.deepEqual(normalizeLoyaltyPage({ tab: 'nope', page: 2, status: 'x' }), {
    tab: '',
    page: 2,
    status: '',
  });
  assert.deepEqual(normalizeLoyaltyPage({ tab: 'referrals', page: 1, status: 'REWARDED' }), {
    tab: 'referrals',
    page: 1,
    status: 'REWARDED',
  });
  // Phase 5 P5-5: referral errors have their own texts; an unknown referrer phone says so on the staff screens only.
  assert.equal(
    referralErrorMessage(new ApiError(409, 'REFERRAL_LOCKED'), vi, 'vi'),
    l.errors.REFERRAL_LOCKED,
  );
  assert.equal(
    referralErrorMessage(new ApiError(404, 'NOT_FOUND', 'referrerPhone'), vi, 'en'),
    'No member matches this number.',
  );
  assert.equal(
    referralErrorMessage(new ApiError(404, 'NOT_FOUND'), vi, 'vi'),
    loyaltyErrorMessage(new ApiError(404, 'NOT_FOUND'), vi, 'vi'),
  );
  const refused = new ApiError(409, 'LOYALTY_NOT_LIVE');
  assert.equal(loyaltyErrorMessage(refused, vi, 'vi'), l.errors.LOYALTY_NOT_LIVE);
  // Owner decision on P5-T8: a manual deduction beyond the balance names the balance.
  assert.equal(
    loyaltyErrorMessage(new ApiError(409, 'LOYALTY_BALANCE_TOO_LOW', 'balance1130'), vi, 'vi'),
    'Số dư chỉ còn 1.130 điểm',
  );
  assert.equal(
    loyaltyErrorMessage(new ApiError(409, 'LOYALTY_BALANCE_TOO_LOW', 'balance50'), vi, 'en'),
    'The balance is only 50 points',
  );
  assert.equal(loyaltyErrorMessage(new ApiError(403, 'FORBIDDEN'), vi, 'vi'), vi.errors.forbidden);
  assert.equal(
    loyaltyErrorMessage(new ApiError(409, 'LOYALTY_ALREADY_LIVE'), vi, 'vi'),
    l.errors.LOYALTY_ALREADY_LIVE,
  );
});

test('every loyalty text exists in both languages', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      typeof child === 'object' && child !== null
        ? keys(child, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    );
  assert.deepEqual(keys(loyaltyDictionary('en')), keys(loyaltyDictionary('vi')));
  for (const dictionary of [loyaltyDictionary('vi'), loyaltyDictionary('en')]) {
    for (const wallet of ['SPA', 'BEAUTY'] as const)
      assert.ok(dictionary.wallets[wallet].length > 0);
  }
});

test('the screens paint a loading state first and never a legacy table', () => {
  for (const node of [<LoyaltyScreen key="a" />, <LoyaltyCustomerScreen key="b" userId="u1" />]) {
    const markup = render(node, owner);
    assert.ok(!markup.includes('wf-table'));
    assert.ok(markup.includes(vi.common.loading));
  }
  const goLive = render(<LoyaltyGoLive />, owner);
  assert.ok(goLive.includes(vi.common.loading));
});

test('the adjustment dialog is a short form: wallet, direction, amount, reason; Cancel then the primary', () => {
  const markup = render(
    <AdjustDialog
      userId="u1"
      correcting={null}
      onDone={() => undefined}
      onClose={() => undefined}
    />,
    owner,
  );
  for (const text of [
    l.adjust.title,
    l.adjust.wallet,
    l.adjust.direction,
    l.adjust.amount,
    l.adjust.reason,
  ]) {
    assert.ok(markup.includes(text), text);
  }
  assert.ok(!markup.includes('<fieldset'));
  assert.ok(markup.indexOf(vi.common.cancel) < markup.lastIndexOf(l.adjust.submit));
  // A correction locks the wallet to the entry's own and says it is linked.
  const correcting = render(
    <AdjustDialog
      userId="u1"
      correcting={entry()}
      onDone={() => undefined}
      onClose={() => undefined}
    />,
    owner,
  );
  assert.ok(correcting.includes(l.adjust.correctTitle));
  assert.ok(correcting.includes(l.adjust.correctDescription));
  assert.ok(correcting.includes('value="930"'));
});
