import type {
  InvoiceProductLineResponse,
  InvoiceResponse,
  PosProductOption,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProductLinesCard, SidesCard } from '../../components/workforce/screens/pos-products';
import { productSaleDictionary } from '../../i18n/product-sale';
import { fill, getWorkforceDictionary } from '../../i18n/workforce';
import { owner, render } from '../../test/support';
import { ApiError } from './api';
import {
  addBody,
  optionLabel,
  parseQuantity,
  productErrorText,
  productTitle,
  stockTone,
  updateBody,
} from './product-sale';

const option = (change: Partial<PosProductOption> = {}): PosProductOption => ({
  variantId: '11111111-1111-4111-8111-111111111111',
  productId: '22222222-2222-4222-8222-222222222222',
  sku: 'KEM-50',
  nameVi: 'Kem dưỡng da',
  nameEn: 'Skin cream',
  variantLabelVi: '50 ml',
  variantLabelEn: '50 ml',
  unitPriceVnd: '200000',
  listPriceVnd: '200000',
  onPromotion: false,
  available: 5,
  ...change,
});

const productLine = (
  change: Partial<InvoiceProductLineResponse> = {},
): InvoiceProductLineResponse => ({
  id: 'L1',
  sequence: 1,
  productId: '22222222-2222-4222-8222-222222222222',
  variantId: '11111111-1111-4111-8111-111111111111',
  sku: 'KEM-50',
  nameVi: 'Kem dưỡng da',
  nameEn: 'Skin cream',
  variantLabelVi: '50 ml',
  variantLabelEn: '50 ml',
  quantity: 2,
  unitPriceVnd: '200000',
  grossVnd: '400000',
  listPriceVnd: '200000',
  onPromotion: false,
  pricedAt: '2027-03-01T00:00:00.000Z',
  seller: { id: 'S1', displayName: 'Lan' },
  reservation: null,
  ...change,
});

const invoice = (change: Partial<InvoiceResponse> = {}): InvoiceResponse =>
  ({
    id: 'i1',
    code: 'INV-1',
    status: 'DRAFT',
    kind: 'PRODUCT_SALE',
    productLines: [productLine()],
    subtotalVnd: '400000',
    discountTotalVnd: '0',
    totalVnd: '400000',
    discount: { sides: undefined },
    actions: { sellProducts: true },
    ...change,
  }) as unknown as InvoiceResponse;

test('quantity: a whole number from 1 to 1,000, nothing else', () => {
  assert.equal(parseQuantity('1'), 1);
  assert.equal(parseQuantity(' 12 '), 12);
  assert.equal(parseQuantity('1000'), 1000);
  for (const bad of ['', '0', '1001', '-1', '2.5', '1e2', '01', 'x', '10000']) {
    assert.equal(parseQuantity(bad), null, bad);
  }
});

test('add request: a product, a quantity within what is available, a seller; no price can be expressed', () => {
  const chosen = option();
  const ok = addBody({ option: chosen, quantity: '2', sellerUserId: 'S1' }, 7);
  assert.deepEqual(ok, {
    body: { expectedVersion: 7, variantId: chosen.variantId, quantity: 2, sellerUserId: 'S1' },
  });
  assert.deepEqual(addBody({ option: null, quantity: '2', sellerUserId: 'S1' }, 7), {
    problem: 'product',
  });
  assert.deepEqual(addBody({ option: chosen, quantity: 'x', sellerUserId: 'S1' }, 7), {
    problem: 'quantity',
  });
  assert.deepEqual(addBody({ option: chosen, quantity: '6', sellerUserId: 'S1' }, 7), {
    problem: 'stock',
  });
  assert.deepEqual(addBody({ option: chosen, quantity: '1', sellerUserId: '' }, 7), {
    problem: 'seller',
  });
  assert.deepEqual(
    addBody({ option: option({ available: 0 }), quantity: '1', sellerUserId: 'S1' }, 7),
    {
      problem: 'stock',
    },
  );
  const json = JSON.stringify(ok);
  for (const forbidden of ['price', 'Price', 'cost', 'total', 'branchId', 'status']) {
    assert.ok(!json.includes(forbidden), forbidden);
  }
});

test('update request: only what changed, and nothing at all is "unchanged"', () => {
  const line = productLine();
  assert.deepEqual(updateBody(line, { quantity: '3', sellerUserId: 'S1' }, 4), {
    body: { expectedVersion: 4, quantity: 3 },
  });
  assert.deepEqual(updateBody(line, { quantity: '2', sellerUserId: 'S2' }, 4), {
    body: { expectedVersion: 4, sellerUserId: 'S2' },
  });
  assert.deepEqual(updateBody(line, { quantity: '2', sellerUserId: 'S1' }, 4), {
    problem: 'unchanged',
  });
  assert.deepEqual(updateBody(line, { quantity: '0', sellerUserId: 'S1' }, 4), {
    problem: 'quantity',
  });
  assert.deepEqual(updateBody(line, { quantity: '2', sellerUserId: '' }, 4), {
    problem: 'seller',
  });
});

test('labels: the product and its variant, the price, and "Hết hàng" when nothing is left', () => {
  assert.equal(productTitle(option(), 'vi'), 'Kem dưỡng da · 50 ml');
  assert.equal(productTitle(option({ variantLabelEn: null }), 'en'), 'Skin cream');
  // An invoice line's name already ends with " - <label>": the label is shown once, the same way as in a search result.
  assert.equal(
    productTitle(option({ nameVi: 'Kem dưỡng da - 50 ml' }), 'vi'),
    'Kem dưỡng da · 50 ml',
  );
  assert.equal(optionLabel(option(), 'vi'), 'Kem dưỡng da · 50 ml — 200.000 ₫ — còn 5');
  assert.equal(
    optionLabel(option({ available: 0 }), 'vi'),
    'Kem dưỡng da · 50 ml — 200.000 ₫ — Hết hàng',
  );
  assert.equal(
    optionLabel(option({ available: 0 }), 'en'),
    'Skin cream · 50 ml — 200,000 ₫ — Out of stock',
  );
  assert.equal(stockTone('CONSUMED'), 'success');
  assert.equal(stockTone('RESERVED'), 'info');
  assert.equal(stockTone('RELEASED'), 'neutral');
});

test("a refused finalization names the lines that are out of stock, in the cashier's words", () => {
  const lines = [
    productLine({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    productLine({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      nameVi: 'Tinh chất',
      nameEn: 'Serum',
      variantLabelVi: null,
      variantLabelEn: null,
    }),
  ];
  const error = new ApiError(
    409,
    'PRODUCT_OUT_OF_STOCK',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  );
  const fallback = () => 'FALLBACK';
  const vi = productErrorText(error, 'vi', { productLines: lines }, fallback);
  assert.match(vi, /Kem dưỡng da · 50 ml, Tinh chất/);
  assert.match(vi, /Không đủ hàng/);
  assert.match(
    productErrorText(error, 'en', { productLines: lines }, fallback),
    /Skin cream · 50 ml, Serum/,
  );
  // An id the invoice no longer holds, or no id at all, still says what happened.
  assert.match(
    productErrorText(new ApiError(409, 'PRODUCT_OUT_OF_STOCK'), 'vi', null, fallback),
    /Không đủ hàng/,
  );
  assert.match(
    productErrorText(new ApiError(409, 'PRODUCT_SELLER_INVALID'), 'vi', null, fallback),
    /người bán/i,
  );
  assert.equal(productErrorText(new ApiError(500, 'OTHER'), 'vi', null, fallback), 'FALLBACK');
  assert.equal(productErrorText(new Error('x'), 'vi', null, fallback), 'FALLBACK');
});

test('texts exist in both languages with the same keys, and the Vietnamese never uses the clinic word', () => {
  const vi = productSaleDictionary('vi');
  const en = productSaleDictionary('en');
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
      : [prefix];
  assert.deepEqual(keys(vi).sort(), keys(en).sort());
  const flat = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : typeof value === 'object' && value !== null
        ? Object.values(value).flatMap(flat)
        : [];
  for (const text of flat(vi)) assert.ok(!/khám/i.test(text), text);
  assert.notEqual(vi.board.action, en.board.action);
});

test('the product lines card: names, seller, price and stock state; actions only on a draft the cashier may edit', () => {
  const draft = render(
    <ProductLinesCard
      invoice={invoice()}
      idle
      onAdd={() => undefined}
      onEdit={() => undefined}
      onRemove={() => undefined}
    />,
    owner,
    'vi',
  );
  assert.ok(draft.includes('Kem dưỡng da · 50 ml'));
  assert.ok(draft.includes('Lan'));
  assert.ok(draft.includes('200.000 ₫'));
  assert.ok(draft.includes('400.000 ₫'));
  assert.ok(draft.includes('Thêm sản phẩm'), 'a draft offers the add action');
  const rowMenu = fill(getWorkforceDictionary('vi').common.list.actionsFor, {
    name: 'Kem dưỡng da · 50 ml',
  });
  assert.ok(draft.includes(rowMenu), 'a draft has the row menu (edit, remove)');
  const paid = render(
    <ProductLinesCard
      invoice={invoice({
        status: 'PAID',
        productLines: [productLine({ reservation: { status: 'CONSUMED', quantity: 2 } })],
      })}
      idle
      onAdd={() => undefined}
      onEdit={() => undefined}
      onRemove={() => undefined}
    />,
    owner,
    'vi',
  );
  assert.ok(paid.includes('Đã xuất kho'));
  assert.ok(!paid.includes('Thêm sản phẩm'), 'a finalized invoice cannot take products');
  assert.ok(!paid.includes(rowMenu), 'the seller is fixed once finalized: no row menu');
  const noRight = render(
    <ProductLinesCard
      invoice={invoice({ actions: { sellProducts: false } as InvoiceResponse['actions'] })}
      idle
      onAdd={() => undefined}
      onEdit={() => undefined}
      onRemove={() => undefined}
    />,
    owner,
    'vi',
  );
  assert.ok(!noRight.includes('Thêm sản phẩm'));
  const empty = render(
    <ProductLinesCard
      invoice={invoice({ productLines: [] })}
      idle
      onAdd={() => undefined}
      onEdit={() => undefined}
      onRemove={() => undefined}
    />,
    owner,
    'en',
  );
  assert.ok(empty.includes('No products yet'));
});

test('the sides card: one row per side that has lines, the offer that won and the figures of the server', () => {
  const side = (change: Record<string, unknown>) => ({
    side: 'SPA',
    subtotalVnd: '0',
    discountVnd: '0',
    netVnd: '0',
    candidates: [],
    winner: null,
    winnerSource: null,
    member: null,
    birthday: null,
    selectionReason: null,
    ...change,
  });
  const html = render(
    <SidesCard
      invoice={invoice({
        discount: {
          sides: [
            side({
              side: 'SPA',
              subtotalVnd: '300000',
              discountVnd: '30000',
              netVnd: '270000',
              winnerSource: 'MEMBER_TIER',
              member: { tier: 'GOLD' },
            }),
            side({ side: 'BEAUTY', subtotalVnd: '200000', discountVnd: '0', netVnd: '200000' }),
          ],
        } as unknown as InvoiceResponse['discount'],
      })}
    />,
    owner,
    'vi',
  );
  assert.ok(html.includes('Spa'));
  assert.ok(html.includes('Lucy Beauty'));
  assert.ok(html.includes('270.000 ₫'));
  assert.ok(html.includes('− 30.000 ₫'));
  assert.ok(html.includes('Không có ưu đãi'));
  // A product-only invoice has one side with lines; a service-only invoice has no sides at all.
  const only = render(
    <SidesCard
      invoice={invoice({
        discount: {
          sides: [
            side({ side: 'SPA' }),
            side({ side: 'BEAUTY', subtotalVnd: '100000', netVnd: '100000' }),
          ],
        } as unknown as InvoiceResponse['discount'],
      })}
    />,
    owner,
    'vi',
  );
  assert.ok(!only.includes('>Spa<'));
  assert.equal(render(<SidesCard invoice={invoice()} />, owner, 'vi'), '');
});
