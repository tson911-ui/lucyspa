import type {
  BranchSummary,
  ComboLookupComboResponse,
  ComboResponse,
  InvoiceLineComboUseResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comboDictionary } from '../../i18n/combo';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee } from '../../test/support';
import { ApiError } from './api';
import {
  comboErrorText,
  comboLookupLabel,
  comboOptionLabel,
  comboUseBadgeText,
  comboUseBody,
  comboUseTone,
  createRequest,
  draftFromCombo,
  emptyComboDraft,
  sessionsText,
  usageSessionText,
  validateComboDraft,
  versionRequest,
  type ComboDraft,
} from './combo';
import { loyaltyTabs } from './loyalty';

/** Phase 5 P5-7: the combo form ships empty, validates everything and sends only the contract's fields. */
const filled = (change: Partial<ComboDraft> = {}): ComboDraft => ({
  ...emptyComboDraft(),
  serviceId: 'svc-1',
  nameVi: 'Combo massage mua 5 tặng 1',
  nameEn: 'Massage combo, pay 5 get 1',
  paid: '5',
  bonus: '1',
  price: 1_000_000,
  ...change,
});

const combo = (): ComboResponse => ({
  id: 'c1',
  code: 'COMBO-ABC234',
  service: { id: 'svc-1', code: 'MASSAGE', nameVi: 'Massage', nameEn: 'Massage' },
  createdAt: '2027-03-01T00:00:00.000Z',
  current: {
    id: 'v2',
    versionNo: 2,
    nameVi: 'Combo 10 tặng 2',
    nameEn: 'Combo 10 + 2',
    paidSessions: 10,
    bonusSessions: 2,
    totalSessions: 12,
    priceVnd: '1800000',
    active: false,
    createdAt: '2027-03-02T00:00:00.000Z',
    createdByName: 'Chủ spa',
  },
  versions: [],
});

test('a new combo is empty: nothing preset, nothing can be sent', () => {
  const empty = emptyComboDraft();
  assert.equal(empty.serviceId, '');
  assert.equal(empty.nameVi, '');
  assert.equal(empty.paid, '');
  assert.equal(empty.price, null);
  assert.deepEqual(Object.keys(validateComboDraft(empty, false)).sort(), [
    'nameEn',
    'nameVi',
    'paid',
    'price',
    'serviceId',
  ]);
  assert.equal(createRequest(empty), null);
});

test('validation: names, whole sessions within bounds and a positive price', () => {
  assert.deepEqual(validateComboDraft(filled(), false), {});
  const issues = (change: Partial<ComboDraft>) => validateComboDraft(filled(change), false);
  assert.equal(issues({ nameVi: '   ' }).nameVi, 'required');
  assert.equal(issues({ nameEn: 'x'.repeat(121) }).nameEn, 'invalid');
  assert.equal(issues({ paid: '0' }).paid, 'invalid');
  assert.equal(issues({ paid: '1.5' }).paid, 'invalid');
  assert.equal(issues({ paid: '201' }).paid, 'invalid');
  assert.equal(issues({ bonus: '' }).bonus, 'required');
  assert.equal(issues({ bonus: '-1' }).bonus, 'invalid');
  assert.equal(issues({ price: 0 }).price, 'invalid');
  assert.equal(issues({ price: null }).price, 'required');
  // Bonus sessions can be 0 (not every combo has a gift).
  assert.deepEqual(issues({ bonus: '0' }), {});
  // The service is chosen on a new combo only; editing keeps the one it has.
  assert.equal(validateComboDraft(filled({ serviceId: '' }), false).serviceId, 'required');
  assert.deepEqual(validateComboDraft(filled({ serviceId: '' }), true), {});
});

test('the create request carries only the contract fields, trimmed, the price as whole VND text', () => {
  const body = createRequest(filled({ nameVi: '  Combo  ', price: 2_500_000 }));
  assert.deepEqual(body, {
    serviceId: 'svc-1',
    nameVi: 'Combo',
    nameEn: 'Massage combo, pay 5 get 1',
    paidSessions: 5,
    bonusSessions: 1,
    priceVnd: '2500000',
    active: true,
  });
  assert.ok(!('code' in body!) && !('expiryMode' in body!) && !('expiresAt' in body!));
});

test('editing starts from the current version and sends the version it started from', () => {
  const draft = draftFromCombo(combo());
  assert.equal(draft.serviceId, 'svc-1');
  assert.equal(draft.paid, '10');
  assert.equal(draft.bonus, '2');
  assert.equal(draft.price, 1_800_000);
  assert.equal(draft.active, false);
  const body = versionRequest({ ...draft, price: 1_700_000 }, 2);
  assert.deepEqual(body, {
    expectedVersionNo: 2,
    nameVi: 'Combo 10 tặng 2',
    nameEn: 'Combo 10 + 2',
    paidSessions: 10,
    bonusSessions: 2,
    priceVnd: '1700000',
    active: false,
  });
  assert.equal(versionRequest({ ...draft, paid: '' }, 2), null);
});

test('texts: sessions, the sale picker label and combo errors, in both languages', () => {
  assert.equal(sessionsText(5, 1, 'vi'), '5 buổi + 1 tặng');
  assert.equal(sessionsText(7, 0, 'vi'), '7 buổi');
  assert.equal(sessionsText(5, 1, 'en'), '5 sessions + 1 free');
  assert.equal(
    comboOptionLabel({ nameVi: 'Combo A', nameEn: 'Combo B', priceVnd: '1000000' }, 'vi'),
    'Combo A · 1.000.000 ₫',
  );
  assert.equal(
    comboOptionLabel({ nameVi: 'Combo A', nameEn: 'Combo B', priceVnd: '1000000' }, 'en'),
    'Combo B · 1,000,000 ₫',
  );
  const fallback = () => 'shared';
  const refusal = (code: string) => new ApiError(409, code);
  assert.equal(
    comboErrorText(refusal('LOYALTY_NOT_LIVE'), 'vi', fallback),
    comboDictionary('vi').errors.LOYALTY_NOT_LIVE,
  );
  assert.equal(
    comboErrorText(refusal('COMBO_CHANGED'), 'en', fallback),
    comboDictionary('en').errors.COMBO_CHANGED,
  );
  assert.equal(comboErrorText(refusal('OTHER'), 'vi', fallback), 'shared');
  // Lucy Spa is a spa, not a clinic: no Vietnamese text uses the word for a medical examination.
  const all =
    JSON.stringify(comboDictionary('vi')) + JSON.stringify(getWorkforceDictionary('vi').nav);
  assert.ok(!/khám(?! phá)/i.test(all));
});

test('the combo tab is offered to a global MANAGE_COMBOS holder only (the API decides again)', () => {
  const branches = new Map<string, BranchSummary>([
    ['b1', { id: 'b1', isActive: true } as BranchSummary],
  ]);
  assert.equal(loyaltyTabs(employee([['MANAGE_COMBOS']]), branches).combos, true);
  assert.equal(loyaltyTabs(employee([['MANAGE_COMBOS', 'b1']]), branches).combos, false);
  assert.equal(loyaltyTabs(employee([['VIEW_LOYALTY', 'b1']]), branches).combos, false);
  assert.equal(loyaltyTabs(employee([['SELL_COMBOS', 'b1']]), branches).combos, false);
});

// ------------------------------------------------------------------------------------------ Phase 5 P5-8

const use = (change: Partial<InvoiceLineComboUseResponse> = {}): InvoiceLineComboUseResponse => ({
  purchaseId: 'p1',
  comboNameVi: 'Combo massage',
  comboNameEn: 'Massage combo',
  usedBy: 'OWNER',
  relationshipNote: null,
  state: 'SELECTED',
  sessionNo: null,
  sessionKind: null,
  countsAsTour: null,
  usedAt: null,
  ...change,
});

test('the use request carries only the combo, who used it and a relative note, and the version it started from', () => {
  assert.equal(comboUseBody({ purchaseId: '', usedBy: 'OWNER', note: '' }, 3), null);
  assert.deepEqual(comboUseBody({ purchaseId: 'p1', usedBy: 'OWNER', note: 'ignored' }, 3), {
    expectedVersion: 3,
    purchaseId: 'p1',
    usedBy: 'OWNER',
  });
  assert.deepEqual(comboUseBody({ purchaseId: 'p1', usedBy: 'RELATIVE', note: '  Con gái ' }, 4), {
    expectedVersion: 4,
    purchaseId: 'p1',
    usedBy: 'RELATIVE',
    relationshipNote: 'Con gái',
  });
  // An empty note is not sent; a note over the limit is not sent at all.
  assert.deepEqual(comboUseBody({ purchaseId: 'p1', usedBy: 'RELATIVE', note: '   ' }, 4), {
    expectedVersion: 4,
    purchaseId: 'p1',
    usedBy: 'RELATIVE',
  });
  assert.equal(
    comboUseBody({ purchaseId: 'p1', usedBy: 'RELATIVE', note: 'x'.repeat(121) }, 4),
    null,
  );
});

test('the use texts: the picker label, the badge before and after the session is taken, the history session', () => {
  const found: ComboLookupComboResponse = {
    purchaseId: 'p1',
    nameVi: 'Combo massage',
    nameEn: 'Massage combo',
    service: { id: 's1', nameVi: 'Massage', nameEn: 'Massage' },
    sessionsLeft: 4,
    totalSessions: 6,
    lineIds: ['l1'],
  };
  assert.equal(comboLookupLabel(found, 'vi'), 'Combo massage · 4/6');
  assert.equal(comboLookupLabel(found, 'en'), 'Massage combo · 4/6');
  assert.equal(comboUseBadgeText(use(), 'vi'), 'Combo massage · Chủ combo');
  assert.equal(
    comboUseBadgeText(
      use({ usedBy: 'RELATIVE', state: 'USED', sessionNo: 6, sessionKind: 'BONUS' }),
      'vi',
    ),
    'Combo massage · buổi 6 (tặng) · Người thân',
  );
  assert.equal(
    comboUseBadgeText(use({ state: 'USED', sessionNo: 2, sessionKind: 'PAID' }), 'en'),
    'Massage combo · session 2 (paid) · The combo owner',
  );
  assert.equal(usageSessionText({ sessionNo: 6, sessionKind: 'BONUS' }, 'vi'), 'Buổi 6 · tặng');
  assert.equal(usageSessionText({ sessionNo: 1, sessionKind: 'PAID' }, 'en'), 'Session 1 · paid');
  assert.equal(comboUseTone('USED'), 'success');
  assert.equal(comboUseTone('SELECTED'), 'info');
  assert.equal(comboUseTone('RELEASED'), 'neutral');
  assert.equal(comboUseTone('RESTORED'), 'warning');
});

test('the use errors have their own texts in both languages and nothing says the word for a medical examination', () => {
  const fallback = () => 'shared';
  for (const code of [
    'COMBO_NOT_USABLE',
    'COMBO_NO_SESSION_LEFT',
    'COMBO_SERVICE_MISMATCH',
    'COMBO_LINE_QUANTITY',
    'COMBO_USE_NOT_RESTORABLE',
  ]) {
    for (const locale of ['vi', 'en'] as const) {
      const text = comboErrorText(new ApiError(409, code), locale, fallback);
      assert.notEqual(text, 'shared', code);
      assert.equal(text, (comboDictionary(locale).errors as Record<string, string>)[code]);
    }
  }
  const all = JSON.stringify(comboDictionary('vi'));
  assert.ok(!/khám(?! phá)/i.test(all));
});

test('the usage history tab is offered to a global RESTORE_COMBO_SESSIONS or MANAGE_COMBOS holder only', () => {
  const branches = new Map<string, BranchSummary>([
    ['b1', { id: 'b1', isActive: true } as BranchSummary],
  ]);
  assert.equal(loyaltyTabs(employee([['RESTORE_COMBO_SESSIONS']]), branches).comboUsage, true);
  assert.equal(loyaltyTabs(employee([['MANAGE_COMBOS']]), branches).comboUsage, true);
  assert.equal(
    loyaltyTabs(employee([['RESTORE_COMBO_SESSIONS', 'b1']]), branches).comboUsage,
    false,
  );
  assert.equal(
    loyaltyTabs(employee([['CONSUME_COMBO_SESSIONS', 'b1']]), branches).comboUsage,
    false,
  );
  assert.equal(loyaltyTabs(employee([['VIEW_LOYALTY', 'b1']]), branches).comboUsage, false);
});
