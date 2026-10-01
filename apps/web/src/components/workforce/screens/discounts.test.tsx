import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { employee, owner, render } from '../../../test/support';
import { DiscountNewScreen } from './discount-new';
import { DiscountsScreen } from './discounts';
import { DiscountVersionScreen } from './discount-version';

const vi = getWorkforceDictionary('vi');
const d = vi.discounts;

test('the list says so without a discount permission and offers no create action', () => {
  const markup = render(<DiscountsScreen />, employee([['VIEW_ATTENDANCE', 'A']]));
  assert.ok(markup.includes(d.noAccess));
  assert.ok(!markup.includes(`ls-btn-label">${d.create}</span>`));
});

test('the list is one page title over a kit table, not a legacy table', () => {
  const markup = render(<DiscountsScreen />, owner);
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(!markup.includes('wf-table'));
});

test('creating is a page of five sections, with no native fieldset or disclosure', () => {
  const markup = render(<DiscountNewScreen />, owner);
  for (const section of [
    d.sectionProgram,
    d.sectionBenefit,
    d.sectionWindow,
    d.sectionScope,
    d.sectionLimits,
  ]) {
    assert.ok(markup.includes(section), section);
  }
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(markup.includes(d.code));
  assert.ok(!markup.includes('<fieldset'));
  assert.ok(!markup.includes('<details'));
  // Cancel then the primary action, last.
  assert.ok(
    markup.indexOf(vi.common.cancel) < markup.lastIndexOf(`ls-btn-label">${d.create}</span>`),
  );
});

test('a new version is a page too: loading state without a drawer', () => {
  const markup = render(<DiscountVersionScreen id="x" />, owner);
  assert.ok(!markup.includes('ls-drawer'));
  assert.ok(!markup.includes('<fieldset'));
});

test('a viewer cannot create programs', () => {
  const markup = render(<DiscountNewScreen />, employee([['CREATE_VOUCHERS']]));
  assert.ok(markup.includes(vi.errors.forbidden));
  assert.ok(!markup.includes('<form'));
});
