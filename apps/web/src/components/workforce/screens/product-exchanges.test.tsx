import type {
  ProductExchangeResponse,
  ProductExchangeSummaryResponse,
  ProductReturnCaseResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productExchangesDictionary } from '../../../i18n/product-exchanges';
import { productRefundsDictionary } from '../../../i18n/product-refunds';
import { productReturnsDictionary } from '../../../i18n/product-returns';
import { owner, render } from '../../../test/support';
import { ExchangesSection } from './product-exchanges';
import { ProductReturnCaseView } from './product-returns';

const text = productExchangesDictionary('vi');
const noop = () => Promise.resolve();

const accepted = (patch: Partial<ProductReturnCaseResponse> = {}): ProductReturnCaseResponse =>
  ({
    id: 'c1',
    code: 'TH000001',
    branchId: 'A',
    branchName: 'Chi nhánh A',
    invoice: { id: 'i1', code: 'HD000042', paidAt: '2026-10-08T03:00:00.000Z', customerName: null },
    line: {
      id: 'l1',
      sequence: 1,
      sku: 'KEM-50',
      productNameVi: 'Kem dưỡng',
      productNameEn: 'Moisturizer',
      variantLabelVi: '50 ml',
      variantLabelEn: '50 ml',
      soldQuantity: 3,
    },
    reason: 'WRONG_OR_DAMAGED',
    requestedOutcome: 'EXCHANGE',
    quantity: 2,
    sealIntact: true,
    notes: null,
    handoverAt: '2026-10-08T03:00:00.000Z',
    windowEndsAt: '2026-10-10T03:00:00.000Z',
    windowException: null,
    status: 'ACCEPTED',
    decidedOutcome: 'EXCHANGE',
    closedByName: 'Chủ',
    closedAt: '2026-10-08T06:00:00.000Z',
    closingNote: null,
    openedByName: 'Lan',
    openedAt: '2026-10-08T05:00:00.000Z',
    rowVersion: 2,
    photos: [],
    events: [],
    can: {
      note: true,
      addPhoto: false,
      decide: false,
      cancel: false,
      removePhoto: false,
      refunds: true,
    },
    ...patch,
  }) as ProductReturnCaseResponse;

const exchange = (patch: Partial<ProductExchangeResponse> = {}): ProductExchangeResponse => ({
  id: 'x1',
  code: 'DH000001',
  status: 'AWAITING_PAYMENT',
  rule: 'PRICE_DIFFERENCE',
  quantity: 2,
  replacement: {
    variantId: 'v2',
    sku: 'SERUM-30',
    nameVi: 'Serum',
    nameEn: 'Serum',
    variantLabelVi: '30 ml',
    variantLabelEn: '30 ml',
    unitPriceVnd: '150000',
  },
  creditVnd: '200000',
  replacementGrossVnd: '300000',
  appliedCreditVnd: '200000',
  payableVnd: '100000',
  refundVnd: '0',
  refund: null,
  invoice: {
    id: 'i2',
    code: 'HD000099',
    status: 'PENDING_PAYMENT',
    totalVnd: '100000',
    balanceVnd: '100000',
  },
  reason: 'Sản phẩm lỗi, khách đổi sang loại khác',
  actorName: 'Hà',
  occurredAt: '2026-10-08T07:00:00.000Z',
  completion: null,
  beautyPointsEarned: null,
  ...patch,
});

const summary = (
  patch: Partial<ProductExchangeSummaryResponse> = {},
): ProductExchangeSummaryResponse => ({
  caseId: 'c1',
  caseCode: 'TH000001',
  invoiceCode: 'HD000042',
  caseQuantity: 2,
  creditVnd: '200000',
  exchangeable: true,
  blocked: null,
  exchanges: [],
  can: { exchange: true, complete: false, correctReference: false },
  ...patch,
});

const actions = (markup: string, label = text.action) =>
  (
    markup.match(
      new RegExp('<button[^>]*><span class="ls-btn-label">' + label + '</span></button>', 'g'),
    ) ?? []
  ).length;

const view = (c: ProductReturnCaseResponse, exchanges: ProductExchangeSummaryResponse | null) =>
  render(
    <ProductReturnCaseView
      item={c}
      reload={noop}
      exchanges={exchanges ? { summary: exchanges, reload: noop } : null}
    />,
    owner,
  );

test('an accepted exchange case offers one primary action "Đổi hàng" and lists nothing exchanged yet', () => {
  const markup = view(accepted(), summary());
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.equal(actions(markup), 1, 'one primary action');
  assert.ok(markup.includes(text.title));
  assert.ok(markup.includes(text.empty));
  assert.ok(markup.includes('200.000'), 'what the customer paid for these units');
  assert.notEqual(text.title, text.action, 'the heading does not repeat the label of its action');
  assert.ok(
    !markup.includes(productRefundsDictionary('vi').title),
    'an exchange case has no refund card',
  );
});

test('the exchange card has its place at first paint; a failure offers a retry; a person who may not exchange sees none of it', () => {
  const loading = view(accepted(), null);
  assert.ok(loading.includes(text.title));
  assert.ok(loading.includes(text.loading));
  assert.ok(!loading.includes(productReturnsDictionary('vi').view.acceptedNotice));
  assert.equal(actions(loading), 0);
  const failed = render(
    <ProductReturnCaseView
      item={accepted()}
      reload={noop}
      exchanges={{ summary: null, error: new Error('x'), reload: noop }}
    />,
    owner,
  );
  assert.ok(failed.includes(text.title));
  assert.ok(!failed.includes(text.loading));
  assert.ok(failed.includes('Tải lại'));
  const nobody = view(accepted({ can: { ...accepted().can, refunds: false } }), null);
  assert.ok(!nobody.includes(text.title));
  assert.equal(actions(nobody), 0);
  assert.ok(nobody.includes(productReturnsDictionary('vi').view.acceptedNotice));
  // A refund case never gets the exchange card.
  assert.ok(!view(accepted({ decidedOutcome: 'REFUND' }), null).includes(text.title));
});

test('a dearer exchange shows the new goods, what the customer pays, the invoice to open and the pending old goods', () => {
  const markup = view(accepted(), summary({ exchanges: [exchange()] }));
  assert.ok(markup.includes('DH000001'));
  assert.ok(markup.includes(text.statuses.AWAITING_PAYMENT));
  assert.ok(markup.includes('Serum'));
  assert.ok(markup.includes('SERUM-30'));
  assert.ok(markup.includes(`${text.exchange.payable}: 100.000`));
  assert.ok(markup.includes(text.rules.PRICE_DIFFERENCE));
  assert.ok(markup.includes('HD000099'));
  assert.ok(markup.includes('còn thu 100.000'));
  assert.ok(markup.includes(text.exchange.goodsPending));
  assert.ok(markup.includes('Sản phẩm lỗi, khách đổi sang loại khác'));
  assert.ok(markup.includes(text.exchange.pointsNone));
});

test('while the old goods wait, the card offers "Hoàn tất đổi"; the correction is in the menu only for a transfer', () => {
  const waiting = exchange({
    status: 'AWAITING_COMPLETION',
    invoice: { id: 'i2', code: 'HD000099', status: 'PAID', totalVnd: '100000', balanceVnd: '0' },
  });
  const markup = render(
    <ExchangesSection
      summary={summary({
        exchanges: [waiting],
        blocked: 'OPEN_EXCHANGE',
        exchangeable: false,
        can: { exchange: false, complete: true, correctReference: false },
      })}
      onComplete={() => undefined}
      onCorrect={() => undefined}
    />,
    owner,
  );
  assert.ok(markup.includes(text.complete.action));
  assert.ok(markup.includes(text.statuses.AWAITING_COMPLETION));
  assert.ok(!markup.includes(text.blocked.OPEN_EXCHANGE), 'the status of the exchange says it');
  assert.ok(!markup.includes(text.correct.action));
  const noComplete = render(
    <ExchangesSection
      summary={summary({ exchanges: [exchange()] })}
      onComplete={() => undefined}
      onCorrect={() => undefined}
    />,
    owner,
  );
  assert.ok(!noComplete.includes(text.complete.action));
});

test('a cheaper exchange shows what was handed back, how, the reference and its corrections; the completed goods and lots; the points', () => {
  const cheaper = exchange({
    status: 'COMPLETED',
    payableVnd: '0',
    refundVnd: '60000',
    appliedCreditVnd: '140000',
    replacementGrossVnd: '140000',
    refund: {
      method: 'BANK_TRANSFER_MANUAL',
      bankReference: 'FT0002',
      firstBankReference: 'FT0001',
      corrections: [
        {
          id: 'k1',
          bankReference: 'FT0002',
          reason: 'Gõ sai',
          actorName: 'Hà',
          occurredAt: '2026-10-08T08:00:00.000Z',
        },
      ],
    },
    invoice: { id: 'i2', code: 'HD000099', status: 'PAID', totalVnd: '0', balanceVnd: '0' },
    completion: {
      restock: 'SELLABLE',
      actorName: 'Hà',
      occurredAt: '2026-10-08T07:00:00.000Z',
      lotCodes: ['TH000001-E'],
    },
    beautyPointsEarned: 0,
  });
  const markup = render(
    <ExchangesSection
      summary={summary({
        exchanges: [cheaper],
        can: { exchange: false, complete: false, correctReference: true },
      })}
      onComplete={() => undefined}
      onCorrect={() => undefined}
    />,
    owner,
  );
  assert.ok(markup.includes(text.statuses.COMPLETED));
  assert.ok(markup.includes(`${text.exchange.refund}: 60.000`));
  assert.ok(markup.includes(text.methods.BANK_TRANSFER_MANUAL));
  assert.ok(markup.includes('FT0002'));
  assert.ok(markup.includes(`${text.exchange.referenceFirst}: FT0001`));
  assert.ok(markup.includes(text.restocks.SELLABLE));
  assert.ok(markup.includes('TH000001-E'));
  assert.ok(markup.includes(text.exchange.pointsNone));
  assert.ok(markup.includes(text.correct.action));
  const earned = render(
    <ExchangesSection
      summary={summary({ exchanges: [exchange({ status: 'COMPLETED', beautyPointsEarned: 100 })] })}
      onComplete={() => undefined}
      onCorrect={() => undefined}
    />,
    owner,
  );
  assert.ok(earned.includes('Cộng 100 điểm trên phần khách trả thêm'));
});

test('a same-item exchange says there is no price difference; a cancelled one says it is cancelled', () => {
  const same = render(
    <ExchangesSection
      summary={summary({
        exchanges: [
          exchange({ rule: 'SAME_ITEM', payableVnd: '0', status: 'COMPLETED' }),
          exchange({ id: 'x2', code: 'DH000002', status: 'CANCELLED' }),
        ],
      })}
      onComplete={() => undefined}
      onCorrect={() => undefined}
    />,
    owner,
  );
  assert.ok(same.includes(text.rules.SAME_ITEM));
  assert.ok(same.includes(text.exchange.none));
  assert.ok(same.includes(text.statuses.CANCELLED));
});

test('a blocked case says why in plain words and has no action; an exchanged case needs no warning', () => {
  const blocked = view(
    accepted(),
    summary({
      exchangeable: false,
      blocked: 'INVOICE_NOT_PAID',
      can: { exchange: false, complete: false, correctReference: false },
    }),
  );
  assert.ok(blocked.includes(text.blocked.INVOICE_NOT_PAID));
  assert.equal(actions(blocked), 0);
  const done = view(
    accepted(),
    summary({
      exchangeable: false,
      blocked: 'ALREADY_EXCHANGED',
      exchanges: [exchange({ status: 'COMPLETED' })],
      can: { exchange: false, complete: false, correctReference: false },
    }),
  );
  assert.ok(!done.includes(text.blocked.ALREADY_EXCHANGED));
  assert.equal(actions(done), 0);
});

test('a line held by another exchange says so when this case has no unfinished exchange of its own', () => {
  const held = view(
    accepted(),
    summary({
      exchangeable: false,
      blocked: 'OPEN_EXCHANGE',
      can: { exchange: false, complete: false, correctReference: false },
    }),
  );
  assert.ok(held.includes(text.blocked.OPEN_EXCHANGE));
  assert.equal(actions(held), 0);
});

test('a case that is not accepted shows no exchange section even if a summary exists', () => {
  const markup = view(accepted({ status: 'OPEN', decidedOutcome: null }), summary());
  assert.ok(!markup.includes(text.title));
});

test('the English page says the same things, and no Vietnamese text says "khám"', () => {
  const en = productExchangesDictionary('en');
  const markup = render(
    <ProductReturnCaseView
      item={accepted()}
      reload={noop}
      exchanges={{ summary: summary({ exchanges: [exchange()] }), reload: noop }}
    />,
    owner,
    'en',
  );
  assert.ok(markup.includes(en.title));
  assert.ok(markup.includes(en.statuses.AWAITING_PAYMENT));
  assert.ok(markup.includes(en.exchange.goodsPending));
  assert.doesNotMatch(JSON.stringify(text), /khám/i);
});
