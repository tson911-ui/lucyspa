import type { InvoiceResponse, ProductOrderResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { productOrdersDictionary } from '../../../i18n/product-orders';
import { fetchPublicTicket, parsePublicTicket } from '../../../lib/public-ticket';
import { owner, render } from '../../../test/support';
import { TicketUnavailable, TicketView } from '../../public/ticket-view';
import { ProductOrderCard } from './pos-pre-orders';

const d = productOrdersDictionary('vi');
const api = { post: () => Promise.resolve({}) } as never;

const order = (patch: Partial<ProductOrderResponse> = {}): ProductOrderResponse => ({
  id: 'o1',
  code: 'DT000012',
  invoiceId: 'i1',
  invoiceCode: 'INV-1',
  branchId: 'A',
  status: 'PAID',
  contactPhone: '+84901234567',
  contactMasked: false,
  contactName: 'Chị Lan',
  customer: null,
  createdAt: '2026-10-08T03:00:00.000Z',
  ticketLinkActive: false,
  ticketExpiresAt: null,
  lines: [
    {
      id: 'ol1',
      invoiceLineId: 'l1',
      variantId: 'v1',
      sku: 'KEM-50',
      nameVi: 'Kem dưỡng - 50 ml',
      nameEn: 'Day cream - 50 ml',
      variantLabelVi: '50 ml',
      variantLabelEn: '50 ml',
      quantity: 2,
      status: 'PAID',
      paidAt: '2026-10-08T03:00:00.000Z',
      expectedFrom: '2026-10-11',
      expectedTo: '2026-10-13',
      orderedAt: null,
      arrivedAt: null,
      handedOverAt: null,
      handedOverTo: null,
      handedOverToName: null,
      completedAt: null,
      cancelledAt: null,
      cancelCause: null,
      refunded: false,
      rowVersion: 2,
    },
  ],
  ...patch,
});

const invoice = (patch: Record<string, unknown> = {}) =>
  ({
    id: 'i1',
    code: 'INV-1',
    branch: { id: 'A', name: 'Chi nhánh A', timezone: 'Asia/Ho_Chi_Minh' },
    actions: { sellProducts: true, orderTicket: true },
    ...patch,
  }) as unknown as InvoiceResponse;

const card = (o: ProductOrderResponse, inv: InvoiceResponse = invoice()) =>
  render(
    <ProductOrderCard invoice={inv} order={o} idle api={api} onChanged={() => undefined} />,
    owner,
  );

test('the order card shows the code, the contact, each line with its status and the expected range', () => {
  const html = card(order());
  assert.match(html, /DT000012/);
  assert.match(html, /\+84901234567/);
  assert.match(html, /Chị Lan/);
  assert.match(html, /Kem dưỡng · 50 ml/);
  assert.match(html, />Đã thanh toán</);
  assert.match(html, /11\/10\/2026 – 13\/10\/2026/);
  assert.match(html, /Dự kiến, không phải cam kết|không phải cam kết/);
  assert.doesNotMatch(html, /khám/i);
});

test('a guest gets the ticket link action; a member sees the ticket inside the invoice and has no link', () => {
  assert.match(card(order()), new RegExp(d.ticket.make));
  assert.match(
    card(order({ ticketLinkActive: true })),
    new RegExp(`${d.ticket.revoke}[\\s\\S]*${d.ticket.makeAgain}`),
    'revoke, then the primary new-link action',
  );
  const member = card(order({ customer: { id: 'c1', displayName: 'Khách A' } }));
  assert.doesNotMatch(member, new RegExp(d.ticket.make));
  assert.match(member, new RegExp(d.ticket.memberNote));
  // No link action without the right to sell, or for a cancelled order.
  assert.doesNotMatch(
    card(order(), invoice({ actions: { sellProducts: false, orderTicket: false } })),
    new RegExp(d.ticket.make),
  );
  assert.doesNotMatch(card(order({ status: 'CANCELLED' })), new RegExp(d.ticket.make));
});

test('the link of a guest expires 30 days after the order is closed: the date is shown, and an expired link cannot be made again', () => {
  const closed = (days: number) =>
    order({
      status: 'HANDED_OVER',
      ticketLinkActive: days < 30,
      ticketExpiresAt: new Date(Date.now() + (30 - days) * 86_400_000).toISOString(),
      lines: [{ ...order().lines[0]!, status: 'HANDED_OVER' }],
    });
  const live = card(closed(2));
  assert.match(live, /Đang có liên kết cho khách, dùng được đến /);
  assert.match(live, new RegExp(d.ticket.revoke), 'a live link can still be revoked');
  const dead = card(closed(40));
  assert.match(dead, /Liên kết đã hết hạn ngày /);
  assert.doesNotMatch(dead, new RegExp(d.ticket.make), 'no new link of a dead order');
  assert.doesNotMatch(dead, new RegExp(d.ticket.revoke));
  // An open order has no date: the plain sentence stays.
  assert.match(card(order({ ticketLinkActive: true })), new RegExp(d.ticket.active));
});

test('a line waiting for payment has no range yet, and a cancelled or refunded line says so', () => {
  const waiting = order({
    status: 'AWAITING_PAYMENT',
    lines: [
      { ...order().lines[0]!, status: 'AWAITING_PAYMENT', expectedFrom: null, expectedTo: null },
    ],
  });
  assert.match(card(waiting), /Sau khi thanh toán/);
  const refunded = order({
    status: 'CANCELLED',
    lines: [
      {
        ...order().lines[0]!,
        status: 'CANCELLED',
        refunded: true,
        cancelCause: 'SUPPLIER_CANNOT_DELIVER',
      },
    ],
  });
  const html = card(refunded);
  assert.match(html, />Đã hủy</);
  assert.match(html, /Đã hoàn tiền/);
});

const ticket = {
  code: 'DT000012',
  status: 'PAID' as const,
  branchName: 'Chi nhánh A',
  branchTimezone: 'Asia/Ho_Chi_Minh',
  paidAt: '2026-10-08T03:00:00.000Z',
  totalVnd: '400000',
  lines: [
    {
      nameVi: 'Kem dưỡng - 50 ml',
      nameEn: 'Day cream - 50 ml',
      variantLabelVi: '50 ml',
      variantLabelEn: '50 ml',
      quantity: 2,
      unitPriceVnd: '200000',
      grossVnd: '400000',
      status: 'PAID' as const,
      expectedFrom: '2026-10-11',
      expectedTo: '2026-10-13',
    },
  ],
};

test('the public ticket reads out the code, what was paid and the expected range, and nothing personal', () => {
  const html = renderToStaticMarkup(<TicketView locale="vi" ticket={ticket} />);
  assert.match(html, /<h1[^>]*>Phiếu hẹn nhận hàng<\/h1>/);
  assert.match(html, /DT000012/);
  assert.match(html, /400\.000/);
  assert.match(html, /11\/10\/2026 – 13\/10\/2026/);
  assert.match(html, /không phải cam kết/);
  assert.doesNotMatch(html, /\+84|0901|khám/);
  const english = renderToStaticMarkup(<TicketView locale="en" ticket={ticket} />);
  assert.match(english, /Pick-up ticket/);
  assert.match(english, /Day cream - 50 ml/);
});

test('an unreadable ticket says to try again; it never claims the link is wrong', () => {
  const html = renderToStaticMarkup(<TicketUnavailable locale="vi" retryHref="/vi/ticket/x" />);
  assert.match(html, /Chưa mở được phiếu/);
  assert.match(html, /href="\/vi\/ticket\/x"/);
  assert.doesNotMatch(html, /Không tìm thấy phiếu/);
});

test('the ticket is fetched fresh, parsed strictly, and only a real 404 is "missing"', async () => {
  const token = 'B'.repeat(43);
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const reply = (status: number, body: unknown = ticket) => {
    const fetcher: typeof fetch = (url, init) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    return fetcher;
  };
  const ok = await fetchPublicTicket(token, reply(200));
  assert.equal(ok.kind, 'ok');
  assert.equal(calls[0]?.init?.cache, 'no-store');
  assert.equal(calls[0]?.init?.credentials, 'omit');
  assert.ok(calls[0]?.url.endsWith(`/api/v1/public/product-order-tickets/${token}`));
  assert.deepEqual(await fetchPublicTicket(token, reply(404, { code: 'NOT_FOUND' })), {
    kind: 'missing',
  });
  assert.deepEqual(await fetchPublicTicket(token, reply(500, {})), { kind: 'error' });
  assert.deepEqual(await fetchPublicTicket(token, reply(200, { code: 5 })), { kind: 'error' });
  assert.deepEqual(await fetchPublicTicket(token, () => Promise.reject(new Error('down'))), {
    kind: 'error',
  });
  // A token of the wrong shape never reaches the API.
  const before = calls.length;
  for (const bad of ['', 'short', 'x'.repeat(44), `${'A'.repeat(42)}!`, '../etc/passwd']) {
    assert.deepEqual(await fetchPublicTicket(bad, reply(200)), { kind: 'missing' }, bad);
  }
  assert.equal(calls.length, before);
  assert.equal(parsePublicTicket({ ...ticket, lines: [{ nameVi: 1 }] }), null);
  assert.equal(parsePublicTicket({ ...ticket, status: 'WHATEVER' }), null);
  assert.equal(parsePublicTicket(null), null);
});
