import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InvoiceResponse } from '@lucy-spa/contracts';
import { productOrdersDictionary } from '../../i18n/product-orders';
import { ApiError } from './api';
import {
  contactBody,
  expectedText,
  hasPreOrderLine,
  leadTimeText,
  orderStatusTone,
  preOrderErrorText,
  ticketUrl,
} from './product-orders';

const d = productOrdersDictionary('vi');

test('every status has a tone, a staff word and a customer word, in both languages', () => {
  const statuses = [
    'AWAITING_PAYMENT',
    'PAID',
    'ORDERED',
    'ARRIVED',
    'HANDED_OVER',
    'COMPLETED',
    'CANCELLED',
  ] as const;
  for (const locale of ['vi', 'en'] as const) {
    const words = productOrdersDictionary(locale);
    for (const status of statuses) {
      assert.ok(words.status[status], `${locale} ${status}`);
      assert.ok(words.customerStatus[status], `${locale} customer ${status}`);
      assert.ok(['success', 'info', 'warning', 'neutral'].includes(orderStatusTone(status)));
    }
  }
  assert.equal(orderStatusTone('COMPLETED'), 'success');
  assert.equal(orderStatusTone('CANCELLED'), 'neutral');
  assert.equal(orderStatusTone('ARRIVED'), 'warning');
});

test('the expected range is a range of calendar days, "dự kiến" until it is fixed at payment', () => {
  const words = { range: d.card.range, afterPayment: d.card.afterPayment };
  assert.equal(
    expectedText({ expectedFrom: '2026-10-11', expectedTo: '2026-10-13' }, 'vi', words),
    '11/10/2026 – 13/10/2026',
  );
  assert.equal(
    expectedText({ expectedFrom: '2026-10-11', expectedTo: '2026-10-11' }, 'vi', words),
    '11/10/2026',
  );
  assert.equal(
    expectedText({ expectedFrom: null, expectedTo: null }, 'vi', words),
    'Sau khi thanh toán',
  );
  assert.equal(
    leadTimeText(d.mode, 3, 5),
    'Dự kiến có hàng sau 3–5 ngày kể từ lúc thanh toán (không phải cam kết).',
  );
  assert.equal(
    leadTimeText(d.mode, 4, 4),
    'Dự kiến có hàng sau 4 ngày kể từ lúc thanh toán (không phải cam kết).',
  );
});

test('the customer phone is checked loosely here and for real by the server', () => {
  assert.deepEqual(contactBody({ phone: ' 0901 234 567 ', name: '  Chị   Lan ' }), {
    contact: { phone: '0901 234 567', name: 'Chị Lan' },
  });
  assert.deepEqual(contactBody({ phone: '+84 901 234 567', name: '' }), {
    contact: { phone: '+84 901 234 567' },
  });
  for (const phone of [
    '',
    '   ',
    'abc',
    '12345',
    '0901-abc-567',
    '9'.repeat(16),
    '0901 234 567 ext',
  ]) {
    assert.deepEqual(contactBody({ phone, name: '' }), { problem: 'phone' }, phone);
  }
});

test('the ticket link is the website origin, the language and the token', () => {
  const token = 'A'.repeat(43);
  assert.equal(
    ticketUrl('https://lucyspa.vn/', 'vi', token),
    `https://lucyspa.vn/vi/ticket/${token}`,
  );
  assert.equal(
    ticketUrl('http://localhost:3000', 'en', token),
    `http://localhost:3000/en/ticket/${token}`,
  );
});

test('an invoice with a pre-order line asks for the contact, one without does not', () => {
  const invoice = (modes: ('IN_STOCK' | 'PRE_ORDER')[]) =>
    ({
      productLines: modes.map((fulfilmentMode) => ({ fulfilmentMode })),
    }) as unknown as InvoiceResponse;
  assert.equal(hasPreOrderLine(invoice([])), false);
  assert.equal(hasPreOrderLine(invoice(['IN_STOCK'])), false);
  assert.equal(hasPreOrderLine(invoice(['IN_STOCK', 'PRE_ORDER'])), true);
});

test('a refused pre-order command is explained; lines the stock covers are named', () => {
  const invoice = {
    productLines: [
      {
        id: 'L1',
        nameVi: 'Kem - 50 ml',
        nameEn: 'Cream - 50 ml',
        variantLabelVi: '50 ml',
        variantLabelEn: '50 ml',
      },
    ],
  } as unknown as InvoiceResponse;
  const name = (line: InvoiceResponse['productLines'][number]) => line.nameVi;
  const refusal = (code: string, field?: string) => new ApiError(409, code, field ?? null);
  assert.equal(
    preOrderErrorText(refusal('PRODUCT_PRE_ORDER_NOT_NEEDED', 'L1'), 'vi', invoice, name),
    'Kho đang đủ hàng cho Kem - 50 ml. Hãy bán như hàng có sẵn.',
  );
  assert.equal(
    preOrderErrorText(refusal('PRODUCT_PRE_ORDER_NOT_ALLOWED'), 'vi', invoice, name),
    d.errors.PRODUCT_PRE_ORDER_NOT_ALLOWED,
  );
  assert.equal(
    preOrderErrorText(refusal('PRE_ORDER_CONTACT_REQUIRED'), 'en', invoice, name),
    productOrdersDictionary('en').errors.PRE_ORDER_CONTACT_REQUIRED,
  );
  assert.equal(preOrderErrorText(refusal('SOMETHING_ELSE'), 'vi', invoice, name), null);
  assert.equal(preOrderErrorText(new Error('boom'), 'vi', invoice, name), null);
});

test('no Vietnamese text calls the spa a clinic', () => {
  const all = JSON.stringify(productOrdersDictionary('vi'));
  assert.doesNotMatch(all, /khám/i);
});
