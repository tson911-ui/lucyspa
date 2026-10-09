import type {
  ProductOrderContextResponse,
  ProductOrderDetailLine,
  ProductOrderDetailResponse,
  ProductOrderQueueResponse,
  ProductOrderQueueRow,
  ProductOrderToOrderResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productOrdersDictionary } from '../../../i18n/product-orders';
import { QUEUE_LIST_DEFAULTS } from '../../../lib/workforce/product-orders';
import { owner, render } from '../../../test/support';
import { CancelDialog, ProductOrderDetailView, ProductOrdersList } from './product-orders';

const text = productOrdersDictionary('vi');
/** A pattern that matches the text literally (dictionary texts contain brackets and dots). */
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const noop = () => Promise.resolve();
const resource = <T,>(data: T) => ({ data, error: null, loading: false, reload: noop });
const update = () => undefined;

const context = (work = true): ProductOrderContextResponse => ({
  branches: [{ id: 'A', code: 'A', name: 'Chi nhánh A', work, refund: true }],
});

const queueRow = (patch: Partial<ProductOrderQueueRow> = {}): ProductOrderQueueRow => ({
  lineId: 'l1',
  orderId: 'o1',
  orderCode: 'DT000012',
  channel: 'COUNTER',
  invoiceId: 'i1',
  invoiceCode: 'HD000042',
  customerName: 'Chị Lan',
  contactPhone: '+84901234567',
  contactName: null,
  variantId: 'v1',
  sku: 'KEM-50',
  nameVi: 'Kem dưỡng',
  nameEn: 'Day cream',
  variantLabelVi: '50 ml',
  variantLabelEn: '50 ml',
  quantity: 2,
  status: 'ORDERED',
  paidAt: '2026-10-08T03:00:00.000Z',
  expectedFrom: '2026-10-11',
  expectedTo: '2026-10-13',
  orderedAt: '2026-10-08T04:00:00.000Z',
  arrivedAt: null,
  late: false,
  heldTooLong: false,
  supplier: null,
  rowVersion: 3,
  ...patch,
});

const queue = (
  rows: ProductOrderQueueRow[],
  tab: ProductOrderQueueResponse['tab'] = 'ORDERED',
): ProductOrderQueueResponse => ({
  tab,
  rows,
  total: rows.length,
  page: 1,
  pageSize: 20,
  counts: { TO_ORDER: 0, ORDERED: rows.length, ARRIVED: 0, DONE: 0, CANCELLED: 0 },
});

const toOrder: ProductOrderToOrderResponse = {
  groups: [
    {
      variantId: 'v1',
      sku: 'KEM-50',
      nameVi: 'Kem dưỡng',
      nameEn: 'Day cream',
      variantLabelVi: '50 ml',
      variantLabelEn: '50 ml',
      supplier: { id: 's1', name: 'Nhà cung cấp A' },
      totalQuantity: 5,
      lines: [
        {
          lineId: 'l1',
          orderCode: 'DT000012',
          quantity: 2,
          paidAt: '2026-10-08T03:00:00.000Z',
          expectedFrom: '2026-10-11',
          expectedTo: '2026-10-13',
          rowVersion: 2,
        },
        {
          lineId: 'l2',
          orderCode: 'DT000013',
          quantity: 3,
          paidAt: '2026-10-08T04:00:00.000Z',
          expectedFrom: '2026-10-11',
          expectedTo: '2026-10-13',
          rowVersion: 2,
        },
      ],
    },
    {
      variantId: 'v2',
      sku: 'SRM-30',
      nameVi: 'Tinh chất',
      nameEn: 'Serum',
      variantLabelVi: null,
      variantLabelEn: null,
      supplier: null,
      totalQuantity: 1,
      lines: [
        {
          lineId: 'l3',
          orderCode: 'DT000014',
          quantity: 1,
          paidAt: '2026-10-08T05:00:00.000Z',
          expectedFrom: null,
          expectedTo: null,
          rowVersion: 2,
        },
      ],
    },
  ],
};

const list = (
  tab: string,
  data: ProductOrderQueueResponse | null,
  grouped: ProductOrderToOrderResponse | null = null,
  ctx: ProductOrderContextResponse = context(),
) =>
  render(
    <ProductOrdersList
      context={ctx}
      list={{ ...QUEUE_LIST_DEFAULTS, tab }}
      updateList={update}
      queue={resource(data)}
      toOrder={resource(grouped)}
    />,
    owner,
  );

test('the "to order" tab groups the paid lines by supplier, those without one last, with the totals', () => {
  const html = list('TO_ORDER', null, toOrder);
  assert.match(html, /<h1[^>]*>Hàng đặt trước<\/h1>/);
  assert.match(html, /Nhà cung cấp A/);
  assert.match(html, /Chưa có nhà cung cấp/);
  assert.ok(html.indexOf('Nhà cung cấp A') < html.indexOf('Chưa có nhà cung cấp'));
  assert.match(html, /Kem dưỡng · 50 ml/);
  assert.match(html, />5</);
  assert.match(html, /Thao tác cho Kem dưỡng · 50 ml/);
  assert.doesNotMatch(html, /khám/i);
});

test('the five tabs are always there, the chosen one is selected, and headings carry no count', () => {
  const html = list('ORDERED', queue([queueRow()]));
  for (const label of Object.values(text.queue.tabs)) assert.match(html, new RegExp(label));
  assert.match(html, /aria-selected="true"[^>]*>[^<]*Đã đặt/);
  assert.doesNotMatch(html, /<h[1-6][^>]*>[^<]*\d/);
});

test('an ordered line shows its order code as a link, the customer, the status and the expected range', () => {
  const html = list('ORDERED', queue([queueRow()]));
  assert.match(html, /href="[^"]*\/product-orders\/o1"/);
  assert.match(html, /DT000012/);
  assert.match(html, /Chị Lan/);
  assert.match(html, />Đã đặt hàng</);
  assert.match(html, /11\/10\/2026 – 13\/10\/2026/);
});

test('late and long-waiting lines say so in words, not only in colour', () => {
  const html = list(
    'ARRIVED',
    queue(
      [
        queueRow({
          status: 'ARRIVED',
          late: false,
          heldTooLong: true,
          arrivedAt: '2026-09-30T03:00:00.000Z',
        }),
      ],
      'ARRIVED',
    ),
  );
  assert.match(html, re(text.queue.held));
  assert.match(html, /Thao tác cho DT000012/, 'an arrived line has its actions menu');
  const late = list('ORDERED', queue([queueRow({ late: true })]));
  assert.match(late, re(text.queue.late));
});

test('an empty tab says what is missing, and a search that finds nothing says so', () => {
  assert.match(list('ARRIVED', queue([], 'ARRIVED')), re(text.queue.empty.ARRIVED));
  assert.match(list('TO_ORDER', null, { groups: [] }), re(text.queue.empty.TO_ORDER));
  const searched = render(
    <ProductOrdersList
      context={context()}
      list={{ ...QUEUE_LIST_DEFAULTS, tab: 'ORDERED', q: 'zzz' }}
      updateList={update}
      queue={resource(queue([], 'ORDERED'))}
      toOrder={resource(null)}
    />,
    owner,
  );
  assert.match(searched, re(text.queue.noMatch));
});

test('without a branch to work in, the page says so and offers nothing', () => {
  const html = list('TO_ORDER', null, null, context(false));
  assert.match(html, re(text.queue.noAccess));
  assert.doesNotMatch(html, re(text.queue.allocate));
});

test("the allocate action is the header action, and it is not the page's primary button", () => {
  const html = list('ORDERED', queue([queueRow()]));
  assert.match(html, re(text.queue.allocate));
  assert.doesNotMatch(html, /ls-btn-primary[^>]*>[^<]*Cấp hàng/);
});

// ------------------------------------------------------------------------------------------------ the order page

const detailLine = (patch: Partial<ProductOrderDetailLine> = {}): ProductOrderDetailLine => ({
  id: 'l1',
  invoiceLineId: 'il1',
  variantId: 'v1',
  sku: 'KEM-50',
  nameVi: 'Kem dưỡng',
  nameEn: 'Day cream',
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
  late: false,
  heldTooLong: false,
  refund: null,
  actions: {
    markOrdered: true,
    handOver: false,
    cancelCauses: ['CUSTOMER_CANCELLED_BEFORE_ORDERING', 'SUPPLIER_CANNOT_DELIVER'],
    refundVnd: '400000',
    correctReference: false,
  },
  ...patch,
});

const detail = (
  patch: Partial<ProductOrderDetailResponse> = {},
  lines: ProductOrderDetailLine[] = [detailLine()],
): ProductOrderDetailResponse => ({
  id: 'o1',
  code: 'DT000012',
  invoiceId: 'i1',
  invoiceCode: 'HD000042',
  branchId: 'A',
  status: 'PAID',
  contactPhone: '+84901234567',
  contactMasked: false,
  contactName: 'Chị Lan',
  customer: null,
  createdAt: '2026-10-08T03:00:00.000Z',
  ticketLinkActive: false,
  ticketExpiresAt: null,
  lines,
  invoiceStatus: 'PAID',
  can: { work: true, refund: true, ticketLink: true },
  ...patch,
});

const page = (order: ProductOrderDetailResponse) =>
  render(<ProductOrderDetailView order={order} reload={noop} />, owner);

test('the order page shows the contact, each line with its status, and has no primary button', () => {
  const html = page(detail());
  assert.match(html, /<h1[^>]*>Đơn DT000012<\/h1>/);
  assert.match(html, /\+84901234567/);
  assert.match(html, /Chị Lan/);
  assert.match(html, /HD000042/);
  assert.match(html, /Kem dưỡng · 50 ml/);
  assert.doesNotMatch(html, /ls-btn-primary/);
  assert.doesNotMatch(html, /khám/i);
});

test('a masked phone number is labelled as partly hidden', () => {
  const html = page(detail({ contactMasked: true, contactPhone: '•••••••567', contactName: null }));
  assert.match(html, re(text.detail.fields.phoneMasked));
  assert.match(html, /•••••••567/);
});

test('warnings: a line waiting too long, a late line, a cancelled invoice and an unpaid order each say so', () => {
  assert.match(page(detail({}, [detailLine({ heldTooLong: true })])), re(text.detail.held));
  assert.match(page(detail({}, [detailLine({ late: true })])), re(text.detail.late));
  assert.match(page(detail({ invoiceStatus: 'CANCELLED' })), re(text.detail.invoiceCancelled));
  assert.match(page(detail({ invoiceStatus: 'PENDING_PAYMENT' })), re(text.detail.notPaid));
  assert.doesNotMatch(page(detail()), re(text.detail.notPaid));
});

test('a refund is shown with its money, method, code and the corrected reference, for those who may see it', () => {
  const html = page(
    detail({}, [
      detailLine({
        status: 'CANCELLED',
        cancelCause: 'SUPPLIER_CANNOT_DELIVER',
        refunded: true,
        refund: {
          code: 'HT000003',
          amountVnd: '400000',
          method: 'BANK_TRANSFER_MANUAL',
          bankReference: 'FT0002',
          corrections: 1,
          refundedAt: '2026-10-09T03:00:00.000Z',
        },
        actions: {
          markOrdered: false,
          handOver: false,
          cancelCauses: [],
          refundVnd: '400000',
          correctReference: true,
        },
      }),
    ]),
  );
  assert.match(html, /400\.000 ₫/);
  assert.match(html, /chuyển khoản/);
  assert.match(html, /HT000003/);
  assert.match(html, /FT0002/);
  assert.match(html, /Đã sửa 1 lần/);
});

test('the cancel dialog asks for the amount only for a change of mind, starting at the whole share', () => {
  const mind = detailLine({
    status: 'ARRIVED',
    actions: {
      markOrdered: false,
      handOver: true,
      cancelCauses: ['CUSTOMER_CHANGED_MIND'],
      refundVnd: '400000',
      correctReference: false,
    },
  });
  const html = render(
    <CancelDialog line={mind} onClose={noop} onDone={noop} onConflict={noop} />,
    owner,
  );
  assert.match(html, re(text.cancel.amountField));
  assert.match(html, /value="400.000"/, 'the whole share is the starting amount');
  assert.match(html, /400.000/);
  const supplier = detailLine({
    actions: {
      markOrdered: true,
      handOver: false,
      cancelCauses: ['SUPPLIER_CANNOT_DELIVER'],
      refundVnd: '400000',
      correctReference: false,
    },
  });
  const other = render(
    <CancelDialog line={supplier} onClose={noop} onDone={noop} onConflict={noop} />,
    owner,
  );
  assert.doesNotMatch(
    other,
    re(text.cancel.amountField),
    'every other cause refunds the whole share',
  );
});

test('English renders every new text', () => {
  const html = render(<ProductOrderDetailView order={detail()} reload={noop} />, owner, 'en');
  assert.match(html, /Order DT000012/);
  assert.match(html, /Goods in the order/);
});
