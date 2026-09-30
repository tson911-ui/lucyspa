import type { BranchSummary, InvoiceLineResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PosInvoiceScreen } from '../../components/workforce/screens/pos-invoice';
import { PosScreen } from '../../components/workforce/screens/pos';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { ApiError } from './api';
import { navigationFor } from './permissions';
import {
  cancelBody,
  hasPriceRange,
  hasQuantity,
  invoiceTone,
  lineInput,
  payerBody,
  posBranches,
  posErrorMessage,
  priceBody,
  priceRange,
} from './pos';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

const line = (change: Partial<InvoiceLineResponse> = {}): InvoiceLineResponse => ({
  id: 'l1',
  sequence: 1,
  visitServiceLineId: 'v1',
  participant: { id: 'p1', kind: 'GUEST', displayName: 'Chị Hoa' },
  employee: { id: 'e1', displayName: 'Lan' },
  itemCode: 'GEL',
  nameVi: 'Sơn gel',
  nameEn: 'Gel polish',
  pricingUnit: 'PER_SERVICE',
  priceMinVnd: '50000',
  priceMaxVnd: '80000',
  quantityLimit: 1,
  quantity: 1,
  unitPriceVnd: null,
  grossVnd: null,
  priceSetAt: null,
  addedOnBehalf: false,
  priceEditable: true,
  ...change,
});
const nail = (change: Partial<InvoiceLineResponse> = {}) =>
  line({
    pricingUnit: 'PER_NAIL',
    priceMinVnd: '10000',
    priceMaxVnd: '10000',
    quantityLimit: 10,
    quantity: null,
    ...change,
  });

test('POS nav and branches follow VIEW_INVOICES per branch; never role names', () => {
  const cashier = employee([['VIEW_INVOICES', 'A']]);
  assert.ok(navigationFor(cashier).some((item) => item.key === 'pos'));
  assert.ok(
    !navigationFor(employee([['MANAGE_BOOKINGS', 'A']])).some((item) => item.key === 'pos'),
  );
  const branches = new Map([
    ['A', { id: 'A', name: 'Quận 1', isActive: true } as unknown as BranchSummary],
    ['B', { id: 'B', name: 'Quận 3', isActive: true } as unknown as BranchSummary],
    ['C', { id: 'C', name: 'Quận 5', isActive: false } as unknown as BranchSummary],
  ]);
  assert.deepEqual(
    posBranches(cashier, branches).map((branch) => branch.id),
    ['A'],
  );
  assert.deepEqual(
    posBranches(owner, branches).map((branch) => branch.id),
    ['A', 'B'],
  );
});

test('price request: a price only for a range, inside the historical range; nothing else expressible', () => {
  const ranged = line();
  assert.ok(hasPriceRange(ranged) && !hasQuantity(ranged));
  assert.deepEqual(priceBody(ranged, { price: '65000', quantity: '' }, 3), {
    body: { expectedVersion: 3, unitPriceVnd: '65000' },
  });
  for (const price of ['', '49999', '80001', '65.5', '-1', '065000', '6e4', ' ']) {
    assert.deepEqual(priceBody(ranged, { price, quantity: '' }, 3), { problem: 'price' }, price);
  }
  // The same price again is not a change.
  assert.deepEqual(
    priceBody(line({ unitPriceVnd: '65000' }), lineInput(line({ unitPriceVnd: '65000' })), 3),
    {
      problem: 'unchanged',
    },
  );
  // A quantity can never be sent for a PER_SERVICE line, and an exact price is never sent.
  const body = priceBody(ranged, { price: '60000', quantity: '9' }, 1);
  assert.ok('body' in body && !('quantity' in body.body));
  const json = JSON.stringify(body);
  for (const forbidden of [
    'totalVnd',
    'grossVnd',
    'priceMaxVnd',
    'quantityLimit',
    'status',
    'branchId',
  ]) {
    assert.ok(!json.includes(`"${forbidden}"`), forbidden);
  }
});

test('quantity request: PER_NAIL only, a positive integer within the limit', () => {
  const nails = nail();
  assert.ok(!hasPriceRange(nails) && hasQuantity(nails));
  assert.deepEqual(priceBody(nails, { price: '', quantity: '4' }, 2), {
    body: { expectedVersion: 2, quantity: 4 },
  });
  for (const quantity of ['', '0', '11', '2.5', '-3', 'x', '04']) {
    assert.deepEqual(
      priceBody(nails, { price: '', quantity }, 2),
      { problem: 'quantity' },
      quantity,
    );
  }
  assert.deepEqual(priceBody(nail({ quantity: 4 }), { price: '', quantity: '4' }, 2), {
    problem: 'unchanged',
  });
  const both = priceBody(nail({ priceMaxVnd: '12000' }), { price: '11000', quantity: '3' }, 5);
  assert.deepEqual(both, { body: { expectedVersion: 5, unitPriceVnd: '11000', quantity: 3 } });
});

test('payer and cancellation bodies: ids and a reason only', () => {
  assert.deepEqual(payerBody(null, 4), { expectedVersion: 4, payerUserId: null });
  assert.deepEqual(payerBody('u-1', 4), { expectedVersion: 4, payerUserId: 'u-1' });
  assert.equal(cancelBody('   ', 2), null);
  assert.equal(cancelBody('x'.repeat(501), 2), null);
  assert.deepEqual(cancelBody('  Khách hủy  ', 2), { expectedVersion: 2, reason: 'Khách hủy' });
});

test('amounts and ranges are shown in the locale without floating point', () => {
  assert.equal(priceRange(line(), 'vi'), '50.000 ₫–80.000 ₫');
  assert.equal(priceRange(line({ priceMinVnd: '40000', priceMaxVnd: '40000' }), 'en'), '40,000 ₫');
  assert.equal(invoiceTone('PAID'), 'success');
  assert.equal(invoiceTone('CANCELLED'), 'error');
  assert.equal(invoiceTone('DRAFT'), 'neutral');
});

test('errors are localized; POS texts exist in both languages', () => {
  for (const code of [
    'INVOICE_VISIT_NOT_COMPLETED',
    'INVOICE_STATE_INVALID',
    'INVOICE_NOT_READY',
    'INVOICE_CANCEL_NOT_ALLOWED',
    'CONFLICT',
  ] as const) {
    const error = new ApiError(409, code);
    assert.equal(posErrorMessage(error, vi), vi.pos.errors[code]);
    assert.equal(posErrorMessage(error, en), en.pos.errors[code]);
    assert.ok(!posErrorMessage(error, en).includes('INVOICE_'));
  }
  assert.equal(posErrorMessage(new Error('x'), en), en.errors.unexpected);
  assert.deepEqual(Object.keys(vi.pos).sort(), Object.keys(en.pos).sort());
  assert.notEqual(vi.pos.finalize, en.pos.finalize);
  assert.notEqual(vi.nav.pos, en.nav.pos);
});

test('first paint loads from the server for the board and the invoice', () => {
  const cashier = employee([['VIEW_INVOICES', 'A']]);
  assert.ok(
    render(
      <AppRouterContext.Provider value={{ push: () => undefined } as never}>
        <PosScreen />
      </AppRouterContext.Provider>,
      cashier,
    ).includes(vi.common.loading),
  );
  assert.ok(render(<PosInvoiceScreen id="i1" />, cashier, 'en').includes(en.common.loading));
});
