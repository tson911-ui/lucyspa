import type {
  OnlineContextResponse,
  OnlineQueueResponse,
  OnlineQueueRow,
  OnlineStaffLine,
  OnlineStaffOrderResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onlineFulfilmentDictionary } from '../../../i18n/online-fulfilment';
import { ONLINE_LIST_DEFAULTS } from '../../../lib/workforce/online-orders';
import { owner, render } from '../../../test/support';
import {
  AddressDialog,
  CorrectShipmentDialog,
  DeliveredDialog,
  LogDialog,
  OnlineCancelDialog,
  ReturnCostDialog,
  ReturnedDialog,
  SettleDialog,
  ShipDialog,
} from './online-order-dialogs';
import { nextStep, OnlineOrderDetailView, OnlineOrdersList } from './online-orders';

const text = onlineFulfilmentDictionary('vi');
/** A pattern that matches the text literally (dictionary texts contain brackets and dots). */
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const noop = () => Promise.resolve();
const resource = <T,>(data: T) => ({ data, error: null, loading: false, reload: noop });
const update = () => undefined;

const context = (work = true, refund = false): OnlineContextResponse => ({
  branches: [{ id: 'A', code: 'A', name: 'Chi nhánh A', work, refund }],
});

const row = (patch: Partial<OnlineQueueRow> = {}): OnlineQueueRow => ({
  orderId: 'o1',
  code: 'DO000012',
  invoiceCode: 'HD000042',
  state: 'READY_TO_SHIP',
  placedAt: '2026-10-08T03:00:00.000Z',
  paidAt: '2026-10-08T03:05:00.000Z',
  recipientName: 'Lê Văn Bình',
  recipientPhoneMasked: '+84•••••003',
  provinceName: 'Hà Nội',
  lineCount: 2,
  quantity: 3,
  totalVnd: '750000',
  hasPreOrder: false,
  readyAt: '2026-10-08T03:05:00.000Z',
  shippedAt: null,
  carrierName: null,
  trackingCode: null,
  late: false,
  overdueDelivery: false,
  ...patch,
});

const queue = (
  rows: OnlineQueueRow[],
  tab: OnlineQueueResponse['tab'] = 'TO_SHIP',
): OnlineQueueResponse => ({
  tab,
  rows,
  total: rows.length,
  page: 1,
  pageSize: 20,
  counts: { TO_SHIP: 0, WAITING_GOODS: 0, SHIPPED: 0, DELIVERY_FAILED: 0, DONE: 0, CANCELLED: 0 },
});

const list = (
  tab: string,
  data: OnlineQueueResponse | null,
  ctx: OnlineContextResponse = context(),
  q = '',
) =>
  render(
    <OnlineOrdersList
      context={ctx}
      list={{ ...ONLINE_LIST_DEFAULTS, tab, q }}
      updateList={update}
      queue={resource(data)}
    />,
    owner,
  );

test('the six tabs are always there, the chosen one is selected, and no heading carries a count', () => {
  const html = list('TO_SHIP', queue([row()]));
  assert.match(html, /<h1[^>]*>Đơn online<\/h1>/);
  for (const label of Object.values(text.queue.tabs)) assert.match(html, re(label));
  assert.match(html, /aria-selected="true"[^>]*>[^<]*Cần gửi/);
  assert.doesNotMatch(html, /<h[1-6][^>]*>[^<]*\d/);
  assert.doesNotMatch(html, /khám/i);
});

test('a row opens its order, shows the recipient with a masked phone, the state, the total and the pre-order mark', () => {
  const html = list('TO_SHIP', queue([row({ hasPreOrder: true })]));
  assert.match(html, /href="[^"]*\/online-orders\/o1"/);
  assert.match(html, /DO000012/);
  assert.match(html, /Lê Văn Bình/);
  assert.match(html, /\+84•••••003/);
  assert.match(html, />Chờ gửi</);
  assert.match(html, /750\.000 ₫/);
  assert.match(html, re(text.queue.preOrder));
  assert.match(html, /Thao tác cho DO000012/);
});

test('late and overdue orders say so in words, not only in colour', () => {
  assert.match(list('TO_SHIP', queue([row({ late: true })])), re(text.queue.late));
  const html = list(
    'SHIPPED',
    queue(
      [row({ state: 'SHIPPED', overdueDelivery: true, carrierName: 'GHN', trackingCode: 'G1' })],
      'SHIPPED',
    ),
  );
  assert.match(html, re(text.queue.overdue));
  assert.match(html, /GHN, G1/);
});

test('an empty tab says what is missing, and a search that finds nothing says so', () => {
  assert.match(list('SHIPPED', queue([], 'SHIPPED')), re(text.queue.empty.SHIPPED));
  assert.match(list('TO_SHIP', queue([]), context(), 'zzz'), re(text.queue.noMatch));
});

test('a person who may only refund still sees the branch; one with neither sees a notice', () => {
  assert.match(list('TO_SHIP', queue([row()]), context(false, true)), /DO000012/);
  const none = list('TO_SHIP', null, context(false, false));
  assert.match(none, re(text.queue.noAccess));
  assert.doesNotMatch(none, /role="tablist"/);
});

// ------------------------------------------------------------------------------------------------ the order page

const line = (patch: Partial<OnlineStaffLine> = {}): OnlineStaffLine => ({
  id: 'l1',
  sequence: 1,
  variantId: 'v1',
  nameVi: 'Kem dưỡng ẩm',
  nameEn: 'Moisturizer',
  variantLabelVi: '50 ml',
  variantLabelEn: '50 ml',
  quantity: 2,
  unitPriceVnd: '250000',
  lineTotalVnd: '500000',
  mode: 'IN_STOCK',
  status: 'PAID',
  expectedFrom: null,
  expectedTo: null,
  cancelCause: null,
  refundedVnd: null,
  rowVersion: 3,
  sku: 'KEM-50',
  ready: true,
  cancelCauses: ['CUSTOMER_CHANGED_MIND'],
  refundShareVnd: '500000',
  ...patch,
});

const can = (patch: Partial<OnlineStaffOrderResponse['can']> = {}) => ({
  ship: false,
  markDelivered: false,
  log: true,
  correctShipment: false,
  correctAddress: true,
  markReturned: false,
  refund: true,
  settleFailedDelivery: false,
  recordReturnCost: true,
  ...patch,
});

const order = (patch: Partial<OnlineStaffOrderResponse> = {}): OnlineStaffOrderResponse => ({
  id: 'o1',
  code: 'DO000012',
  invoiceId: 'i1',
  invoiceCode: 'HD000042',
  branchId: 'A',
  state: 'READY_TO_SHIP',
  placedAt: '2026-10-08T03:00:00.000Z',
  paidAt: '2026-10-08T03:05:00.000Z',
  deadlineAt: null,
  subtotalVnd: '500000',
  discountVnd: '0',
  shippingFeeVnd: '0',
  totalVnd: '500000',
  recipient: {
    name: 'Lê Văn Bình',
    phone: '+84912000003',
    provinceCode: 'HA_NOI',
    provinceName: 'Hà Nội',
    ward: 'Phường Cửa Nam',
    street: '12 Phố Hàng Bài',
    corrected: false,
  },
  customer: { id: 'u1', displayName: 'Lê Văn Bình' },
  lines: [line()],
  hasPreOrder: false,
  shipment: null,
  deliveredAt: null,
  deliveredBy: null,
  logs: [],
  payment: null,
  settlement: null,
  deliveryFailed: false,
  returnStarted: false,
  returnedToShop: false,
  returns: [],
  policyVersion: 1,
  carriers: [{ id: 'c1', name: 'GHN' }],
  can: can({ ship: true }),
  ...patch,
});

const shipped = (patch: Partial<OnlineStaffOrderResponse> = {}) =>
  order({
    state: 'SHIPPED',
    lines: [line({ status: 'SHIPPED', ready: false, cancelCauses: [] })],
    shipment: {
      id: 's1',
      carrierId: 'c1',
      carrierName: 'GHN',
      trackingCode: 'GHN123',
      trackingUrl: 'https://track.example.vn/?code=GHN123',
      shippedAt: '2026-10-09T03:00:00.000Z',
      shippedByName: 'Lan',
      carrierFeeOutVnd: '30000',
      corrections: [],
    },
    carriers: [],
    can: can({ markDelivered: true, correctShipment: true }),
    ...patch,
  });

const page = (value: OnlineStaffOrderResponse, locale: 'vi' | 'en' = 'vi') =>
  render(<OnlineOrderDetailView order={value} reload={noop} />, owner, locale);

test('the order page shows the code, the recipient, the address, the lines and one primary action', () => {
  const html = page(order());
  assert.match(html, /<h1[^>]*>Đơn online DO000012<\/h1>/);
  assert.match(html, /Lê Văn Bình/);
  assert.match(html, /\+84912000003/);
  assert.match(html, /12 Phố Hàng Bài, Phường Cửa Nam, Hà Nội/);
  assert.match(html, /Kem dưỡng ẩm/);
  assert.match(html, /KEM-50/);
  assert.match(html, re(text.detail.fields.free), 'delivery is free');
  assert.equal((html.match(/ls-btn-primary/g) ?? []).length, 1);
  assert.match(html, /ls-btn-primary[^>]*>(?:<[^>]*>)*[^<]*Gửi hàng/);
  assert.doesNotMatch(html, /khám/i);
});

test('the primary action is the next step and nothing is drawn that the flags do not allow', () => {
  assert.equal(nextStep(order()), 'ship');
  assert.equal(nextStep(shipped()), 'delivered');
  assert.equal(
    nextStep({ can: can({ markDelivered: true, markReturned: true }), returnStarted: true }),
    'returned',
  );
  assert.equal(
    nextStep({ can: can({ settleFailedDelivery: true }), returnStarted: true }),
    'settle',
  );
  assert.equal(nextStep({ can: can(), returnStarted: false }), null);
  const none = page(order({ can: can({ log: false, correctAddress: false, refund: false }) }));
  assert.doesNotMatch(none, /ls-btn-primary/);
  assert.doesNotMatch(none, re(text.detail.actions.correctAddress));
  assert.doesNotMatch(none, re(text.detail.actions.log));
  assert.doesNotMatch(none, re(text.detail.actions.correctShipment));
});

test('a shipped order shows the carrier, the tracking code as a link and the cost only when it is on the order', () => {
  const html = page(shipped());
  assert.match(html, /GHN/);
  assert.match(html, /href="https:\/\/track\.example\.vn\/\?code=GHN123"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /30\.000 ₫/);
  assert.match(html, re(text.detail.internalFee));
  assert.match(html, re(text.detail.actions.correctShipment));
  assert.match(html, re(text.detail.actions.markDelivered));
  const hidden = page(
    shipped({
      shipment: { ...shipped().shipment!, carrierFeeOutVnd: null, trackingUrl: null },
    }),
  );
  assert.doesNotMatch(hidden, /30\.000 ₫/);
  assert.doesNotMatch(hidden, re(text.detail.shipmentFields.fee));
  assert.doesNotMatch(hidden, re(text.detail.internalFee));
  assert.match(hidden, /GHN123/);
});

test('an order not shipped yet says so; an order waiting for goods names the lines', () => {
  assert.match(page(order()), re(text.detail.notShipped));
  const waiting = page(
    order({
      state: 'WAITING_GOODS',
      lines: [
        line({ mode: 'PRE_ORDER', status: 'PAID', ready: false }),
        line({ id: 'l2', sequence: 2 }),
      ],
      can: can(),
    }),
  );
  assert.match(waiting, re(text.detail.notices.waitingGoods.split('{names}')[0]!));
  assert.match(waiting, re(text.detail.preOrder));
});

test('a failed delivery shows its notices, the log, and the settlement action only when allowed', () => {
  const failed = page(
    shipped({
      state: 'DELIVERY_FAILED',
      deliveryFailed: true,
      logs: [
        {
          id: 'g1',
          kind: 'DELIVERY_FAILED',
          reasonCode: 'CUSTOMER_AWAY',
          note: 'Khách đi vắng, hẹn mai',
          actorKind: 'STAFF',
          actorName: 'Lan',
          occurredAt: '2026-10-10T03:00:00.000Z',
        },
      ],
    }),
  );
  assert.match(failed, re(text.detail.notices.deliveryFailed));
  assert.match(failed, re(text.log.kinds.DELIVERY_FAILED));
  assert.match(failed, re(text.log.reasons.CUSTOMER_AWAY));
  assert.match(failed, /Khách đi vắng, hẹn mai/);
  const back = page(
    shipped({
      state: 'DELIVERY_FAILED',
      deliveryFailed: true,
      returnStarted: true,
      returnedToShop: true,
      can: can({ settleFailedDelivery: true }),
    }),
  );
  assert.match(back, re(text.detail.notices.returnedToShop));
  assert.match(back, /ls-btn-primary[^>]*>(?:<[^>]*>)*[^<]*Xử lý giao thất bại/);
  const empty = page(order());
  assert.match(empty, re(text.detail.logEmpty));
});

test('the settlement result is shown with its figures and the stock decision', () => {
  const html = page(
    shipped({
      state: 'CANCELLED',
      settlement: {
        goodsPaidVnd: '500000',
        carrierFeeOutVnd: '30000',
        carrierFeeBackVnd: '20000',
        refundVnd: '450000',
        reason: 'Khách từ chối nhận',
        settledByName: 'Lan',
        settledAt: '2026-10-12T03:00:00.000Z',
        returnedToStock: 'NOT_SELLABLE',
      },
    }),
  );
  assert.match(html, re(text.detail.settlement));
  assert.match(html, /450\.000 ₫/);
  assert.match(html, /20\.000 ₫/);
  assert.match(html, re(text.detail.restockResult.NOT_SELLABLE));
  assert.match(html, /Khách từ chối nhận/);
});

test('a return case shows its cost and a menu to record it only for a person who may refund', () => {
  const withCost = page(
    order({
      returns: [
        {
          id: 'r1',
          code: 'TH000003',
          status: 'OPEN',
          reason: 'WRONG_OR_DAMAGED',
          quantity: 1,
          returnCostVnd: '25000',
        },
      ],
    }),
  );
  assert.match(withCost, /TH000003/);
  assert.match(withCost, /25\.000 ₫/);
  assert.match(withCost, /Thao tác với TH000003/);
  const without = page(
    order({
      can: can({ recordReturnCost: false }),
      returns: [
        {
          id: 'r1',
          code: 'TH000003',
          status: 'OPEN',
          reason: 'WRONG_OR_DAMAGED',
          quantity: 1,
          returnCostVnd: null,
        },
      ],
    }),
  );
  assert.match(without, /TH000003/);
  assert.doesNotMatch(without, /Thao tác với TH000003/);
});

test('a line that can be cancelled has a row menu; one that cannot, has none', () => {
  assert.match(page(order()), /Thao tác với Kem dưỡng ẩm/);
  assert.doesNotMatch(page(shipped()), /Thao tác với Kem dưỡng ẩm/);
});

test('English renders every new text', () => {
  const html = page(shipped(), 'en');
  assert.match(html, /Online order DO000012/);
  assert.match(html, /Tracking code/);
  assert.match(html, /Delivery log/);
});

// ------------------------------------------------------------------------------------------------ the dialogs

const props = { onClose: noop, onDone: noop, onConflict: noop };

test('the ship dialog lists the whole parcel, the carriers and the three fields; without a carrier it says why', () => {
  const html = render(<ShipDialog order={order()} {...props} />, owner);
  assert.match(html, re(text.ship.title));
  assert.match(html, /Kem dưỡng ẩm/);
  assert.match(html, /× 2/);
  assert.match(html, /<option[^>]*value="c1"[^>]*>GHN</);
  assert.match(html, re(text.ship.tracking));
  assert.match(html, re(text.ship.fee));
  assert.match(html, re(text.ship.feeHint));
  assert.doesNotMatch(html, re(text.ship.noCarriers));
  const none = render(<ShipDialog order={order({ carriers: [] })} {...props} />, owner);
  assert.match(none, re(text.ship.noCarriers));
});

test('the shipment correction asks for the cost only when the order carries it', () => {
  const withFee = render(<CorrectShipmentDialog order={shipped()} {...props} />, owner);
  assert.match(withFee, re(text.correctShipment.fee));
  assert.match(withFee, /value="30\.000"/);
  const noFee = render(
    <CorrectShipmentDialog
      order={shipped({ shipment: { ...shipped().shipment!, carrierFeeOutVnd: null } })}
      {...props}
    />,
    owner,
  );
  assert.doesNotMatch(noFee, re(text.correctShipment.fee));
  assert.match(noFee, re(text.correctShipment.tracking));
});

test('the delivered dialog has an optional day that cannot be after today', () => {
  const html = render(<DeliveredDialog order={shipped()} {...props} />, owner);
  assert.match(html, re(text.delivered.day));
  assert.match(html, /type="date"/);
  assert.match(html, /max="\d{4}-\d{2}-\d{2}"/);
});

test('the log dialog offers only what the parcel allows', () => {
  const sent = render(<LogDialog order={shipped()} {...props} />, owner);
  assert.match(sent, re(text.log.kinds.DELIVERY_FAILED));
  assert.match(sent, re(text.log.kinds.RETURN_STARTED));
  assert.doesNotMatch(sent, re(text.log.kinds.RETURNED_TO_SHOP));
  const unsent = render(<LogDialog order={order()} {...props} />, owner);
  assert.doesNotMatch(unsent, re(text.log.kinds.DELIVERY_FAILED));
  assert.match(unsent, re(text.log.kinds.CONTACTED));
});

test('the "returned to shop" and address dialogs carry their fields', () => {
  assert.match(
    render(<ReturnedDialog order={shipped()} {...props} />, owner),
    re(text.returned.note),
  );
  const html = render(<AddressDialog order={order()} {...props} />, owner);
  assert.match(html, /value="Lê Văn Bình"/);
  assert.match(html, /<option[^>]*value="HA_NOI"[^>]*selected/);
  assert.match(html, re(text.address.reason));
});

test('the cancel dialog starts a change of mind at the whole share and asks for the method', () => {
  const html = render(<OnlineCancelDialog line={line()} {...props} />, owner);
  assert.match(html, re(text.cancel.title));
  assert.match(html, /value="500\.000"/);
  assert.match(html, /Tiền mặt/);
  const none = render(<OnlineCancelDialog line={line({ cancelCauses: [] })} {...props} />, owner);
  assert.match(none, /chưa thể hủy lúc này/);
});

test('the settlement dialog shows the formula live: goods, cost out, cost back and the refund', () => {
  const html = render(
    <SettleDialog
      order={shipped({
        lines: [line({ status: 'SHIPPED', refundShareVnd: '500000' })],
        can: can({ settleFailedDelivery: true }),
      })}
      {...props}
    />,
    owner,
  );
  assert.match(html, re(text.settle.goods));
  assert.match(html, /500\.000 ₫/);
  assert.match(html, /−30\.000 ₫/);
  assert.match(html, re(text.settle.formula));
  // Cost back is empty at first, so the refund is goods - cost out.
  assert.match(html, /470\.000 ₫/);
  assert.match(html, re(text.settle.method));
  assert.match(html, re(text.settle.warning));
});

test('when the shipping costs eat the whole price, the dialog hides the method and forces "not sellable"', () => {
  const html = render(
    <SettleDialog
      order={shipped({
        lines: [line({ status: 'SHIPPED', refundShareVnd: '20000' })],
        can: can({ settleFailedDelivery: true }),
      })}
      {...props}
    />,
    owner,
  );
  assert.match(html, re(text.settle.noRefund));
  assert.doesNotMatch(html, re(text.settle.method));
  assert.match(html, re(text.settle.restockLocked));
  assert.doesNotMatch(html, re(text.settle.owner));
});

test('a person who cannot see the cost out gets a warning instead of a refund figure', () => {
  const html = render(
    <SettleDialog
      order={shipped({
        shipment: { ...shipped().shipment!, carrierFeeOutVnd: null },
        can: can({ settleFailedDelivery: true }),
      })}
      {...props}
    />,
    owner,
  );
  assert.match(html, re(text.settle.noPreview));
});

test('the return cost dialog names the case', () => {
  const html = render(
    <ReturnCostDialog
      returnCase={{
        id: 'r1',
        code: 'TH000003',
        status: 'OPEN',
        reason: 'WRONG_OR_DAMAGED',
        quantity: 1,
        returnCostVnd: '0',
      }}
      {...props}
    />,
    owner,
  );
  assert.match(html, /TH000003/);
  assert.match(html, re(text.returnCost.description.slice(0, 30)));
});
