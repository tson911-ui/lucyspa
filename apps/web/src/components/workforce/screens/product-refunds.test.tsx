import type {
  ProductRefundResponse,
  ProductRefundSummaryResponse,
  ProductReturnCaseResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productRefundsDictionary } from '../../../i18n/product-refunds';
import { owner, render } from '../../../test/support';
import { ProductReturnCaseView } from './product-returns';
import { RefundsSection } from './product-refunds';

const text = productRefundsDictionary('vi');
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
    reason: 'PERSONAL_PREFERENCE',
    requestedOutcome: 'REFUND',
    quantity: 3,
    sealIntact: true,
    notes: null,
    handoverAt: '2026-10-08T03:00:00.000Z',
    windowEndsAt: '2026-10-15T03:00:00.000Z',
    windowException: null,
    status: 'ACCEPTED',
    decidedOutcome: 'REFUND',
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

const refund = (patch: Partial<ProductRefundResponse> = {}): ProductRefundResponse => ({
  id: 'r1',
  code: 'HT000001',
  quantity: 1,
  amountVnd: '97000',
  method: 'CASH',
  bankReference: null,
  firstBankReference: null,
  reason: 'Khách trả hàng, hoàn tiền mặt',
  restock: 'SELLABLE',
  actorName: 'Hà',
  occurredAt: '2026-10-08T07:00:00.000Z',
  lotCodes: ['TH000001-1'],
  beautyPointsTakenBack: 97,
  beautyPointsShortfall: 0,
  corrections: [],
  ...patch,
});

const summary = (
  patch: Partial<ProductRefundSummaryResponse> = {},
): ProductRefundSummaryResponse => ({
  caseId: 'c1',
  caseCode: 'TH000001',
  invoiceCode: 'HD000042',
  lineNetVnd: '291000',
  soldQuantity: 3,
  lineRefundedQuantity: 0,
  lineRefundedVnd: '0',
  lineState: 'NOT_REFUNDED',
  caseQuantity: 3,
  caseRefundedQuantity: 0,
  caseRemainingQuantity: 3,
  refundable: true,
  blocked: null,
  refunds: [],
  can: { refund: true, correctReference: false },
  ...patch,
});

/** How many buttons are labelled with the refund action (the outcome 'Hoàn tiền' also appears as plain text in the facts). */
const actions = (markup: string, label = text.action) =>
  (
    markup.match(
      new RegExp('<button[^>]*><span class="ls-btn-label">' + label + '</span></button>', 'g'),
    ) ?? []
  ).length;

const view = (c: ProductReturnCaseResponse, refunds: ProductRefundSummaryResponse | null) =>
  render(
    <ProductReturnCaseView
      item={c}
      reload={noop}
      refunds={refunds ? { summary: refunds, reload: noop } : null}
    />,
    owner,
  );

test('an accepted refund case offers one primary action "Hoàn tiền" and lists nothing refunded yet', () => {
  const markup = view(accepted(), summary());
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.equal(actions(markup), 1, 'one primary action');
  assert.ok(markup.includes(text.title));
  assert.ok(markup.includes(text.states.NOT_REFUNDED));
  assert.ok(markup.includes(text.empty));
  assert.ok(markup.includes('0 trên 3 của dòng hàng'));
  assert.ok(markup.includes('Đã hoàn 0 trên 3, còn 3'));
  // The heading of the section does not repeat the label of the action.
  assert.notEqual(text.title, text.action);
});

test('the money is shown only when the person may see the refunds; everyone else sees no refund section and no action', () => {
  const markup = view(accepted({ can: { ...accepted().can, refunds: false } }), null);
  assert.ok(!markup.includes(text.title));
  assert.equal(actions(markup), 0);
  const none = view(accepted(), null);
  assert.ok(!none.includes(text.title), 'the summary has not arrived (or is not allowed)');
});

test('a refund shows who, when, how much, how, the goods, the lots, the points and the reason', () => {
  const markup = view(
    accepted(),
    summary({
      lineState: 'PARTIALLY_REFUNDED',
      lineRefundedQuantity: 1,
      lineRefundedVnd: '97000',
      caseRefundedQuantity: 1,
      caseRemainingQuantity: 2,
      refunds: [refund()],
    }),
  );
  assert.ok(markup.includes(text.states.PARTIALLY_REFUNDED));
  assert.ok(markup.includes('HT000001'));
  assert.ok(markup.includes('97.000'));
  assert.ok(markup.includes('Hà'));
  assert.ok(markup.includes(text.methods.CASH));
  assert.ok(markup.includes(text.restocks.SELLABLE));
  assert.ok(markup.includes('TH000001-1'));
  assert.ok(markup.includes('Đã thu hồi 97 điểm'));
  assert.ok(markup.includes('Khách trả hàng, hoàn tiền mặt'));
  assert.ok(markup.includes('1 trên 3 của dòng hàng'));
});

test('a transfer refund shows its reference and the corrections; the correction action is in the card menu only for a transfer', () => {
  const transfer = refund({
    method: 'BANK_TRANSFER_MANUAL',
    bankReference: 'FT0002',
    firstBankReference: 'FT0001',
    restock: 'NOT_SELLABLE',
    lotCodes: [],
    beautyPointsTakenBack: 50,
    beautyPointsShortfall: 150,
    corrections: [
      {
        id: 'k1',
        bankReference: 'FT0002',
        reason: 'Gõ sai',
        actorName: 'Hà',
        occurredAt: '2026-10-08T08:00:00.000Z',
      },
    ],
  });
  const markup = render(
    <RefundsSection
      summary={summary({ refunds: [transfer], can: { refund: true, correctReference: true } })}
      onCorrect={() => undefined}
    />,
    owner,
  );
  assert.ok(markup.includes(text.methods.BANK_TRANSFER_MANUAL));
  assert.ok(markup.includes('FT0002'));
  assert.ok(markup.includes(`${text.refund.referenceFirst}: FT0001`));
  assert.ok(markup.includes(text.restocks.NOT_SELLABLE));
  assert.ok(markup.includes(text.refund.noStock));
  assert.ok(markup.includes('thiếu 150 điểm'));
  const cash = render(
    <RefundsSection summary={summary({ refunds: [refund()] })} onCorrect={() => undefined} />,
    owner,
  );
  assert.ok(!cash.includes(text.correct.action));
});

test('a fully refunded line has no action; a blocked case says why in plain words', () => {
  const done = view(
    accepted(),
    summary({
      lineState: 'REFUNDED',
      lineRefundedQuantity: 3,
      lineRefundedVnd: '291000',
      caseRefundedQuantity: 3,
      caseRemainingQuantity: 0,
      refundable: false,
      blocked: 'NOTHING_LEFT',
      can: { refund: false, correctReference: false },
      refunds: [refund({ quantity: 3, amountVnd: '291000' })],
    }),
  );
  assert.ok(done.includes(text.states.REFUNDED));
  assert.equal(actions(done), 0);
  const blocked = view(
    accepted(),
    summary({
      refundable: false,
      blocked: 'INVOICE_NOT_PAID',
      can: { refund: false, correctReference: false },
    }),
  );
  assert.ok(blocked.includes(text.blocked.INVOICE_NOT_PAID));
  assert.equal(actions(blocked), 0);
});

test('a case that is not accepted shows no refund section even if a summary exists', () => {
  const markup = view(accepted({ status: 'OPEN', decidedOutcome: null }), summary());
  assert.ok(!markup.includes(text.title));
});

test('the English page says the same things', () => {
  const en = productRefundsDictionary('en');
  const markup = render(
    <ProductReturnCaseView
      item={accepted()}
      reload={noop}
      refunds={{ summary: summary({ refunds: [refund()] }), reload: noop }}
    />,
    owner,
    'en',
  );
  assert.ok(markup.includes(en.title));
  assert.ok(markup.includes(en.methods.CASH));
  assert.ok(markup.includes(en.action));
});
