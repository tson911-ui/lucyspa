import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isNewProduct,
  isProductCode,
  pageOffset,
  parsePublicProductsQuery,
  priceBlock,
  productStock,
  searchPatterns,
  variantStock,
} from './public-products.logic.js';

const fallback = { min: 3, max: 5 };
const stock = (available: number, sellOnOrder: boolean, own?: [number, number]) =>
  variantStock(
    {
      available,
      sellOnOrder,
      leadTimeDaysMin: own?.[0] ?? null,
      leadTimeDaysMax: own?.[1] ?? null,
    },
    fallback,
  );

test('stock: in stock shows nothing, none on order is a pre-order, none otherwise is sold out; never a number', () => {
  assert.deepEqual(stock(7, true), {
    state: 'IN_STOCK',
    leadTimeDaysMin: null,
    leadTimeDaysMax: null,
  });
  assert.deepEqual(stock(1, false), {
    state: 'IN_STOCK',
    leadTimeDaysMin: null,
    leadTimeDaysMax: null,
  });
  assert.deepEqual(stock(0, true), { state: 'PRE_ORDER', leadTimeDaysMin: 3, leadTimeDaysMax: 5 });
  assert.deepEqual(stock(0, true, [7, 10]), {
    state: 'PRE_ORDER',
    leadTimeDaysMin: 7,
    leadTimeDaysMax: 10,
  });
  assert.deepEqual(stock(0, false), {
    state: 'OUT_OF_STOCK',
    leadTimeDaysMin: null,
    leadTimeDaysMax: null,
  });
  assert.deepEqual(Object.keys(stock(9, true)).sort(), [
    'leadTimeDaysMax',
    'leadTimeDaysMin',
    'state',
  ]);
});

test('stock of a product with several variants: any in stock wins, else the pre-order span, else sold out', () => {
  const inStock = stock(2, false);
  const early = stock(0, true, [2, 3]);
  const late = stock(0, true, [7, 10]);
  const gone = stock(0, false);
  assert.equal(productStock([gone, inStock, late]).state, 'IN_STOCK');
  assert.deepEqual(productStock([gone, early, late]), {
    state: 'PRE_ORDER',
    leadTimeDaysMin: 2,
    leadTimeDaysMax: 10,
  });
  assert.equal(productStock([gone, gone]).state, 'OUT_OF_STOCK');
  assert.equal(
    productStock([]).state,
    'IN_STOCK',
    'a product without variants is never listed; no label if it were',
  );
});

test('price block: struck list price and a half-up percent only while a promotion lowers the price', () => {
  assert.deepEqual(priceBlock(100_000n, 100_000n), {
    priceVnd: '100000',
    listPriceVnd: null,
    discountPercent: null,
  });
  assert.deepEqual(priceBlock(389_000n, 329_000n), {
    priceVnd: '329000',
    listPriceVnd: '389000',
    discountPercent: 15,
  });
  // 12.5 % rounds half up to 13.
  assert.equal(priceBlock(8_000n, 7_000n).discountPercent, 13);
  assert.equal(
    priceBlock(1_000_000n, 999_999n).discountPercent,
    null,
    'a cut that rounds to nothing shows no percent',
  );
  assert.equal(priceBlock(1_000n, 1n).discountPercent, 99, 'never 100');
  assert.equal(
    priceBlock(100n, 150n).listPriceVnd,
    null,
    'a promotion above the list price never applies',
  );
});

test('"Mới": within N days of the first publication; zero days turns it off', () => {
  const published = new Date('2026-10-01T00:00:00Z');
  const day = 86_400_000;
  assert.equal(isNewProduct(published, new Date(published.getTime() + 29 * day), 30), true);
  assert.equal(isNewProduct(published, new Date(published.getTime() + 30 * day), 30), false);
  assert.equal(isNewProduct(published, new Date(published.getTime() + day), 0), false);
  assert.equal(isNewProduct(null, published, 30), false);
});

test('search: folded terms, wildcards typed by the visitor are letters', () => {
  assert.deepEqual(searchPatterns('Kem dưỡng'), ['%kem%', '%duong%']);
  assert.deepEqual(searchPatterns('50%_off'), ['%50\\%\\_off%']);
  assert.deepEqual(searchPatterns('   '), []);
  assert.equal(searchPatterns('a b c d e f g h').length, 6, 'at most six terms');
});

test('query: bounded, no unknown sort, no page past the limit, only code-shaped filters', () => {
  assert.deepEqual(parsePublicProductsQuery({}), {
    q: '',
    category: null,
    brand: null,
    sort: 'featured',
    page: 1,
  });
  assert.deepEqual(
    parsePublicProductsQuery({
      q: ' kem ',
      category: 'skin-care',
      brand: 'lucy',
      sort: 'price_desc',
      page: '3',
    }),
    { q: 'kem', category: 'skin-care', brand: 'lucy', sort: 'price_desc', page: 3 },
  );
  for (const bad of [
    { sort: 'cost' },
    { page: '0' },
    { page: '501' },
    { page: '1e3' },
    { page: '-1' },
    { category: 'a b' },
    { category: "x'; drop" },
    { brand: '../x' },
    { q: 'x'.repeat(81) },
  ]) {
    assert.throws(
      () => parsePublicProductsQuery(bad),
      /VALIDATION_FAILED|validation/i,
      JSON.stringify(bad),
    );
  }
  assert.equal(pageOffset(1), 0);
  assert.equal(pageOffset(3), 40);
});

test('product code shape: slug characters only, up to 96', () => {
  assert.equal(isProductCode('kem-duong-am-50ml'), true);
  assert.equal(isProductCode('A_b-9'), true);
  assert.equal(isProductCode('x'.repeat(96)), true);
  assert.equal(isProductCode('x'.repeat(97)), false);
  assert.equal(isProductCode('a/b'), false);
  assert.equal(isProductCode(''), false);
  assert.equal(isProductCode('-start'), false);
});
