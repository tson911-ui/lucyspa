import type { TipServedBy } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payDictionary } from '../../../i18n/pay';
import type { TipDraft } from '../../../lib/workforce/pay';
import { owner, render } from '../../../test/support';
import { TipStep } from './pos-tip-step';

const c = payDictionary('vi').tips.step;
const noop = () => undefined;
const served = (...names: string[]): TipServedBy[] =>
  names.map((name, index) => ({ employee: { id: `k${index + 1}`, name }, netVnd: '0' }));
const none = (count: number): TipDraft[] =>
  Array.from({ length: count }, (_, index) => ({
    employeeUserId: `k${index + 1}`,
    pick: 'NONE',
    other: null,
  }));
const step = (people: TipServedBy[], drafts: TipDraft[], showProblems = false) =>
  render(
    <TipStep
      served={people}
      drafts={drafts}
      onChange={noop}
      invoiceVnd="500000"
      showProblems={showProblems}
    />,
    owner,
    'vi',
  );

test('one KTV: that person only, a choice of none, the presets or another amount, and what the customer transfers', () => {
  const html = step(served('Lê Thị Hoa'), none(1));
  assert.match(html, /Tip gửi tới Lê Thị Hoa/);
  assert.equal(html.match(/type="radio"/g)?.length, 5);
  for (const label of [c.none, '20.000', '50.000', '100.000', c.other])
    assert.ok(html.includes(label), label);
  // The group is named after the one person; no money field until "Khác" is picked.
  assert.match(html, /<legend[^>]*>Tip gửi tới Lê Thị Hoa<\/legend>/);
  assert.doesNotMatch(html, /inputmode="numeric"|inputMode="numeric"/);
  assert.match(html, /500\.000\u00a0₫/);
  assert.ok(html.includes(c.help));
  // Nothing was chosen: the customer transfers the invoice amount only.
  assert.equal(html.match(/500\.000\u00a0₫/g)?.length, 2);
});

test('several KTVs: every one of them is listed with their own choice, and the total adds up', () => {
  const html = step(served('Lê Thị Hoa', 'Phạm Văn Nam'), [
    { employeeUserId: 'k1', pick: '50000', other: null },
    { employeeUserId: 'k2', pick: 'OTHER', other: 30_000 },
  ]);
  assert.ok(html.includes(c.many));
  assert.match(html, /<legend[^>]*>Lê Thị Hoa<\/legend>/);
  assert.match(html, /<legend[^>]*>Phạm Văn Nam<\/legend>/);
  assert.equal(html.match(/role="radiogroup"/g)?.length, 2);
  // "Khác" opens the money field with the typed amount; the transfer is 500.000 + 50.000 + 30.000.
  assert.ok(html.includes('30.000'));
  assert.ok(html.includes('580.000\u00a0₫'));
  assert.ok(html.includes(c.otherAmount));
});

test('an invalid amount is said once, only after the customer tried to continue', () => {
  const bad: TipDraft[] = [{ employeeUserId: 'k1', pick: 'OTHER', other: 1_500 }];
  assert.doesNotMatch(step(served('Lê Thị Hoa'), bad), new RegExp(c.invalid.slice(0, 12)));
  const html = step(served('Lê Thị Hoa'), bad, true);
  assert.ok(html.includes(c.invalid));
  assert.ok(!html.includes('wf-'));
});
