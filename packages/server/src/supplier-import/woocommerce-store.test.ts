import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpFetchError, type HttpClient } from './http-client.js';
import { FIXTURE_BASE_URL, FIXTURE_HOST, fakeClient, jsonRoute, storeProduct } from './fixtures.js';
import {
  SourceReadError,
  createStoreApiAdapter,
  normalizeStoreProduct,
} from './woocommerce-store.js';

const normalize = (raw: unknown) => normalizeStoreProduct(raw, FIXTURE_HOST);

test('a normal product becomes a plain-text record keyed by its WooCommerce id', () => {
  const { record, problems } = normalize(
    storeProduct(42, {
      name: 'Kem &amp; Serum <b>42</b>',
      description: '<p>Dòng một</p><script>x()</script><p>Dòng hai</p>',
      prices: {
        regular_price: '350000',
        sale_price: '280000',
        currency_code: 'VND',
        currency_minor_unit: 0,
      },
      categories: [{ name: 'OHUI' }, { name: 'Set Quà Tặng' }],
      brands: [{ name: 'OHUI' }],
      attributes: [{ name: 'Dung tích', terms: [{ name: '50ml' }, { name: '100ml' }] }],
    }),
  );
  assert.ok(record);
  assert.equal(record.sourceKey, '42');
  assert.equal(record.name, 'Kem & Serum 42');
  assert.equal(record.sku, 'SKU-42');
  assert.equal(record.priceVnd, 350000);
  assert.equal(record.promoPriceVnd, 280000);
  assert.deepEqual(record.categoryNames, ['OHUI', 'Set Quà Tặng']);
  assert.equal(record.brandText, 'OHUI');
  assert.equal(record.descriptionText, 'Dòng một\nDòng hai');
  assert.deepEqual(record.attributes, [{ name: 'Dung tích', values: ['50ml', '100ml'] }]);
  assert.equal(record.images.length, 1);
  assert.deepEqual(
    problems.map((p) => p.code),
    [],
  );
  assert.match(record.contentHash, /^[0-9a-f]{64}$/);
});

test('a missing SKU is a warning (HARU-<id> fills in later), not a failure', () => {
  const { record, problems } = normalize(storeProduct(7, { sku: '' }));
  assert.equal(record?.sku, null);
  assert.deepEqual(
    problems.map((p) => [p.code, p.fatal]),
    [['SKU_MISSING', false]],
  );
});

test('an unusable product is reported with its id and never becomes a record', () => {
  for (const [raw, code, key] of [
    [storeProduct(8, { name: '   ' }), 'NAME_MISSING', '8'],
    [storeProduct(9, { permalink: '' }), 'URL_MISSING', '9'],
    [storeProduct(10, { permalink: 'https://evil.example/x' }), 'URL_OFF_HOST', '10'],
    [storeProduct(11, { permalink: 'http://shop.example/x' }), 'URL_OFF_HOST', '11'],
    [{ id: 'abc', name: 'x' }, 'INVALID_PRODUCT', null],
    [null, 'INVALID_PRODUCT', null],
    [storeProduct(0), 'INVALID_PRODUCT', null],
  ] as const) {
    const result = normalize(raw);
    assert.equal(result.record, null);
    assert.equal(result.key, key);
    assert.ok(
      result.problems.some((p) => p.code === code && p.fatal),
      String(code),
    );
  }
});

test('prices: whole VND only, never guessed; other currencies are kept as sent', () => {
  const price = (prices: Record<string, unknown>) => normalize(storeProduct(1, { prices })).record;
  assert.equal(
    price({ regular_price: '99000', currency_code: 'VND', currency_minor_unit: 0 })?.priceVnd,
    99000,
  );
  // Sale price not lower than the regular price is not a promotion.
  assert.equal(
    price({
      regular_price: '99000',
      sale_price: '99000',
      currency_code: 'VND',
      currency_minor_unit: 0,
    })?.promoPriceVnd,
    null,
  );
  assert.equal(
    price({
      regular_price: '99000',
      sale_price: '120000',
      currency_code: 'VND',
      currency_minor_unit: 0,
    })?.promoPriceVnd,
    null,
  );
  // VND with two minor digits: only exact whole amounts are accepted.
  assert.equal(
    price({ regular_price: '9900000', currency_code: 'VND', currency_minor_unit: 2 })?.priceVnd,
    99000,
  );
  const fractional = normalize(
    storeProduct(1, {
      prices: { regular_price: '9900050', currency_code: 'VND', currency_minor_unit: 2 },
    }),
  );
  assert.equal(fractional.record?.priceVnd, null);
  assert.ok(fractional.problems.some((p) => p.code === 'PRICE_NOT_WHOLE_VND'));
  assert.deepEqual(fractional.record?.originalPrice, {
    regular: '9900050',
    sale: null,
    minorUnit: 2,
  });
  const usd = normalize(
    storeProduct(1, {
      prices: { regular_price: '1999', currency_code: 'USD', currency_minor_unit: 2 },
    }),
  );
  assert.equal(usd.record?.priceVnd, null);
  assert.equal(usd.record?.currency, 'USD');
  assert.ok(usd.problems.some((p) => p.code === 'CURRENCY_NOT_VND'));
  for (const bad of ['-5', '12.5', 'abc', '1e6']) {
    const result = normalize(
      storeProduct(1, {
        prices: { regular_price: bad, currency_code: 'VND', currency_minor_unit: 0 },
      }),
    );
    assert.equal(result.record?.priceVnd, null, bad);
    assert.ok(
      result.problems.some((p) => p.code === 'PRICE_INVALID'),
      bad,
    );
  }
  const free = normalize(
    storeProduct(1, {
      prices: { regular_price: '0', currency_code: 'VND', currency_minor_unit: 0 },
    }),
  );
  assert.equal(free.record?.priceVnd, null);
  assert.ok(free.problems.some((p) => p.code === 'PRICE_MISSING'));
});

test("images are only the product's own, in order, on the source host, without duplicates", () => {
  const { record, problems } = normalize(
    storeProduct(5, {
      images: [
        { src: 'https://shop.example/wp-content/uploads/a.jpg', alt: 'A' },
        { src: 'https://cdn.evil.example/b.jpg' },
        { src: 'http://shop.example/c.jpg' },
        { src: 'https://shop.example/wp-content/uploads/a.jpg', alt: 'again' },
        { src: 'https://shop.example/wp-content/uploads/d.jpg' },
        { alt: 'no src' },
        'junk',
      ],
    }),
  );
  assert.deepEqual(
    record?.images.map((image) => image.url),
    [
      'https://shop.example/wp-content/uploads/a.jpg',
      'https://shop.example/wp-content/uploads/d.jpg',
    ],
  );
  assert.ok(problems.some((p) => p.code === 'IMAGE_OFF_HOST' && p.detail === '4'));
  const none = normalize(storeProduct(6, { images: [] }));
  assert.ok(none.problems.some((p) => p.code === 'IMAGE_MISSING'));
  assert.equal(none.record?.imagesHash.length, 64);
});

test('variations are kept as references with their own ids', () => {
  const { record } = normalize(
    storeProduct(20, {
      type: 'variable',
      variations: [
        { id: 21, attributes: [{ name: 'Dung tích', value: '50ml' }] },
        { id: 'x' },
        { id: 22, attributes: [{ name: 'Dung tích', value: '100ml' }] },
      ],
    }),
  );
  assert.deepEqual(
    record?.variations.map((v) => v.key),
    ['21', '22'],
  );
  assert.equal(record?.variations[1]?.attributes[0]?.value, '100ml');
});

test('stock is never read', () => {
  const { record } = normalize(storeProduct(3, { is_in_stock: false, stock_quantity: 4 }));
  assert.ok(record);
  assert.equal(JSON.stringify(record).includes('stock'), false);
});

test('hashes change only with what they cover', () => {
  const base = normalize(storeProduct(1)).record!;
  const price = normalize(
    storeProduct(1, {
      prices: { regular_price: '260000', currency_code: 'VND', currency_minor_unit: 0 },
    }),
  ).record!;
  assert.equal(base.contentHash, price.contentHash);
  assert.notEqual(base.priceHash, price.priceHash);
  const image = normalize(
    storeProduct(1, { images: [{ src: 'https://shop.example/x.jpg' }] }),
  ).record!;
  assert.notEqual(base.imagesHash, image.imagesHash);
  assert.equal(base.contentHash, image.contentHash);
  const text = normalize(storeProduct(1, { name: 'Khác' })).record!;
  assert.notEqual(base.contentHash, text.contentHash);
});

// ------------------------------------------------------------------------------------------------- the API reading

const PRODUCTS = '/wp-json/wc/store/v1/products';

test('listPage asks for id order and reports the totals', async () => {
  const client = fakeClient({
    [PRODUCTS]: jsonRoute([storeProduct(1), storeProduct(2)], {
      'x-wp-total': '352',
      'x-wp-totalpages': '18',
    }),
  });
  const page = await createStoreApiAdapter(client, FIXTURE_BASE_URL).listPage(1, 20);
  assert.deepEqual(
    page.records.map((r) => r.sourceKey),
    ['1', '2'],
  );
  assert.equal(page.total, 352);
  assert.equal(page.totalPages, 18);
  assert.equal(client.urls[0], `${PRODUCTS}?page=1&per_page=20&orderby=id&order=asc`);
});

test('one broken product does not break the page; a repeated id is dropped', async () => {
  const client = fakeClient({
    [PRODUCTS]: jsonRoute([
      storeProduct(1),
      { id: 2 },
      storeProduct(1, { name: 'Again' }),
      storeProduct(3),
    ]),
  });
  const page = await createStoreApiAdapter(client, FIXTURE_BASE_URL).listPage(1, 20);
  assert.deepEqual(
    page.records.map((r) => r.sourceKey),
    ['1', '3'],
  );
  assert.ok(
    page.problems.some((p) => p.key === '1' && p.problems.some((x) => x.code === 'DUPLICATE_KEY')),
  );
  assert.ok(
    page.problems.some((p) => p.key === '2' && p.problems.some((x) => x.code === 'NAME_MISSING')),
  );
});

test('a sub-directory install keeps its path', async () => {
  const client = fakeClient({ '*': jsonRoute([]) });
  await createStoreApiAdapter(client, 'https://shop.example/vn/').listPage(1, 5);
  assert.ok(client.urls[0]?.startsWith('/vn/wp-json/wc/store/v1/products?'));
});

test('HTTP and content problems map to the source status the Owner sees', async () => {
  const cases: [number, string, string, string][] = [
    [401, '{}', 'AUTHENTICATION_REQUIRED', 'AUTHENTICATION_REQUIRED'],
    [403, '{}', 'AUTHENTICATION_REQUIRED', 'AUTHENTICATION_REQUIRED'],
    [404, '{}', 'API_NOT_FOUND', 'ADAPTER_REQUIRED'],
    [410, '{}', 'API_NOT_FOUND', 'ADAPTER_REQUIRED'],
    [429, '{}', 'RATE_LIMITED', 'SOURCE_ERROR'],
    [503, '{}', 'SERVER_ERROR', 'SOURCE_ERROR'],
    [400, '{}', 'UNEXPECTED_STATUS', 'ADAPTER_REQUIRED'],
    [
      200,
      '<html><title>Just a moment...</title></html>',
      'CHALLENGE_PAGE',
      'AUTHENTICATION_REQUIRED',
    ],
    [200, '<html><body>Home page</body></html>', 'NOT_JSON', 'ADAPTER_REQUIRED'],
    [200, '{"code":"rest_no_route"}', 'UNEXPECTED_SHAPE', 'ADAPTER_REQUIRED'],
  ];
  for (const [status, body, code, expected] of cases) {
    const client = fakeClient({ [PRODUCTS]: { status, body } });
    await assert.rejects(
      createStoreApiAdapter(client, FIXTURE_BASE_URL).listPage(1, 20),
      (error) =>
        error instanceof SourceReadError && error.code === code && error.status === expected,
      `${status} ${code}`,
    );
  }
});

test('network failures become SOURCE_ERROR without leaking details', async () => {
  const client: HttpClient = {
    requestCount: () => 0,
    setMinInterval: () => undefined,
    get: async () => {
      throw new HttpFetchError('TIMEOUT');
    },
  };
  await assert.rejects(
    createStoreApiAdapter(client, FIXTURE_BASE_URL).listPage(1, 20),
    (error) =>
      error instanceof SourceReadError &&
      error.status === 'SOURCE_ERROR' &&
      error.detail === 'TIMEOUT',
  );
});

test('fetchProducts returns only the ids asked for; fetchProduct insists on the same id', async () => {
  const client = fakeClient({
    [PRODUCTS]: jsonRoute([storeProduct(1), storeProduct(2), storeProduct(99)]),
    [`${PRODUCTS}/2`]: jsonRoute(storeProduct(2)),
    [`${PRODUCTS}/3`]: jsonRoute(storeProduct(4)),
  });
  const adapter = createStoreApiAdapter(client, FIXTURE_BASE_URL);
  const page = await adapter.fetchProducts(['1', '2']);
  assert.deepEqual(
    page.records.map((r) => r.sourceKey),
    ['1', '2'],
  );
  assert.match(client.urls[0] ?? '', /include=1%2C2/);
  assert.equal((await adapter.fetchProduct('2'))?.sourceKey, '2');
  await assert.rejects(
    adapter.fetchProduct('3'),
    (error) => error instanceof SourceReadError && error.code === 'UNEXPECTED_SHAPE',
  );
});
