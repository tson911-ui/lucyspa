import type { CustomerInvoiceDetail } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CustomerInvoiceDetailScreen,
  CustomerInvoicesScreen,
} from '../../components/customer/screens/invoices';
import { CustomerContext } from '../../components/customer/session';
import { getCustomerDictionary } from '../../i18n/customer';
import type { Locale } from '../../i18n/locales';
import { ApiClient } from '../api/client';
import { appendPage, formatBusinessDate, formatVnd, invoiceTone } from './invoice';

const vi = getCustomerDictionary('vi');
const en = getCustomerDictionary('en');

test('amounts are integer VND; a business date is the calendar day it names', () => {
  assert.equal(formatVnd('180000', 'vi'), '180.000 ₫');
  assert.equal(formatVnd('180000', 'en'), '180,000 ₫');
  assert.equal(formatVnd('0', 'vi'), '0 ₫');
  assert.equal(formatBusinessDate('2027-03-01', 'vi'), '01/03/2027');
  assert.equal(formatBusinessDate('2027-03-01', 'en'), '01/03/2027');
});

test('status tones and the paged list never repeat an invoice', () => {
  assert.equal(invoiceTone('PAID'), 'success');
  assert.equal(invoiceTone('PENDING_PAYMENT'), 'warning');
  assert.equal(invoiceTone('CANCELLED'), 'neutral');
  const merged = appendPage([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
  assert.deepEqual(
    merged.map((item) => item.id),
    ['a', 'b', 'c'],
  );
});

test('every invoice status and payment method has a Vietnamese and an English label', () => {
  for (const dictionary of [vi, en]) {
    for (const status of ['PENDING_PAYMENT', 'PAID', 'CANCELLED'] as const) {
      assert.ok(dictionary.invoices.status[status]);
    }
    for (const method of ['CASH', 'PAYOS'] as const) {
      assert.ok(dictionary.invoices.method[method]);
    }
  }
  assert.equal(vi.nav.invoices, 'Hóa đơn');
  assert.match(vi.invoices.note, /không phải hóa đơn điện tử/);
});

/** First paint with a real context and an API whose requests never settle. */
function paint(node: ReactNode, locale: Locale): string {
  const api = new ApiClient({
    fetch: () => new Promise<Response>(() => undefined),
  });
  return renderToStaticMarkup(
    <CustomerContext.Provider
      value={{
        locale,
        t: getCustomerDictionary(locale),
        api,
        base: `/${locale}/account`,
        sessionLost: false,
      }}
    >
      <AppRouterContext.Provider value={{ push: () => undefined } as never}>
        {node}
      </AppRouterContext.Provider>
    </CustomerContext.Provider>,
  );
}

test('screens wait for the server; no amount is shown before it answers', () => {
  const list = paint(<CustomerInvoicesScreen />, 'vi');
  assert.ok(list.includes(vi.invoices.title));
  assert.ok(list.includes(vi.common.loading));
  // The shared page frame and header, no legacy markup.
  assert.match(list, /class="ls-page ls-page-default"/);
  assert.match(list, /<h1 class="ls-page-title">Hóa đơn của tôi<\/h1>/);
  assert.doesNotMatch(list, /wf-|cu-/);
  const detail = paint(<CustomerInvoiceDetailScreen id="inv-1" />, 'en');
  assert.ok(detail.includes(en.common.loading));
  assert.ok(!detail.includes(en.invoices.total), 'no amounts before the server answers');
});

test('the detail contract carries no staff, cancel, provider or audit fields', () => {
  const sample: CustomerInvoiceDetail = {
    id: 'i',
    kind: 'VISIT',
    code: 'INV-270301-ABCDEF',
    status: 'PAID',
    branch: { id: 'br', name: 'Q1', timezone: 'Asia/Ho_Chi_Minh' },
    businessDate: '2027-03-01',
    finalizedAt: '2027-03-01T07:00:00.000Z',
    paidAt: '2027-03-01T07:05:00.000Z',
    cancelledAt: null,
    totalVnd: '200000',
    paidVnd: '200000',
    balanceVnd: '0',
    visitDate: '2027-03-01',
    subtotalVnd: '200000',
    discountTotalVnd: '0',
    discount: null,
    lines: [],
    payments: [],
  };
  const keys = [...Object.keys(sample), ...Object.keys(sample.branch)];
  for (const internal of [
    'payerUserId',
    'visitId',
    'employee',
    'collectedBy',
    'cancelReason',
    'rowVersion',
    'version',
    'anomalies',
    'managementNotes',
    'checkoutUrl',
    'qrCode',
    'providerReference',
    'actions',
  ]) {
    assert.ok(!keys.includes(internal), internal);
  }
});
