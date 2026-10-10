import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURE_BASE_URL, fakeClient, jsonRoute, storeProduct } from './fixtures.js';
import { SAMPLE_SIZE, runSourceTest } from './source-test.js';

const PRODUCTS = '/wp-json/wc/store/v1/products';
const robots = (text: string, status = 200) => ({
  status,
  body: text,
  headers: { 'content-type': 'text/plain' },
});
const sample = (
  count: number,
  make: (id: number) => Record<string, unknown> = (id) => storeProduct(id),
) => Array.from({ length: count }, (_, index) => make(index + 1));

test('a healthy source passes with two requests, the sample and the totals', async () => {
  const client = fakeClient({
    '/robots.txt': robots('User-agent: Googlebot\nAllow: /\n'),
    [PRODUCTS]: jsonRoute(
      sample(20, (id) => storeProduct(id, id % 2 ? { sku: '' } : {})),
      { 'x-wp-total': '352' },
    ),
  });
  const result = await runSourceTest({ client, baseUrl: FIXTURE_BASE_URL });
  assert.equal(result.outcome, 'PASSED');
  assert.equal(result.requests, 2);
  assert.equal(client.urls[0], '/robots.txt');
  assert.match(client.urls[1] ?? '', /per_page=20/);
  assert.equal(result.summary?.total, 352);
  assert.equal(result.summary?.sampled, 20);
  assert.equal(result.summary?.withSku, 10, 'missing SKUs do not fail a test');
  assert.equal(result.sample.length, 20);
  assert.equal(result.sample[0]?.key, '1');
  assert.ok(result.problems.some((group) => group.code === 'SKU_MISSING' && group.count === 10));
});

test('the sample can never exceed 20 products, whatever is asked', async () => {
  const client = fakeClient({ '/robots.txt': robots('', 404), [PRODUCTS]: jsonRoute(sample(20)) });
  await runSourceTest({ client, baseUrl: FIXTURE_BASE_URL, sampleSize: 500 });
  assert.match(client.urls[1] ?? '', new RegExp(`per_page=${SAMPLE_SIZE}(&|$)`));
});

test('a missing robots.txt is fine, a disallowing one stops before any product is requested', async () => {
  const missing = fakeClient({ '/robots.txt': robots('', 404), [PRODUCTS]: jsonRoute(sample(3)) });
  const passed = await runSourceTest({ client: missing, baseUrl: FIXTURE_BASE_URL });
  assert.equal(passed.outcome, 'PASSED');
  assert.equal(passed.summary?.robots, 'NO_FILE');

  for (const text of [
    'User-agent: *\nDisallow: /',
    'User-agent: LucySpaCatalogBot\nDisallow: /wp-json/',
  ]) {
    const blocked = fakeClient({ '/robots.txt': robots(text), [PRODUCTS]: jsonRoute(sample(3)) });
    const result = await runSourceTest({ client: blocked, baseUrl: FIXTURE_BASE_URL });
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.outcome === 'FAILED' && result.failure.code, 'ROBOTS_DISALLOWED');
    assert.deepEqual(blocked.urls, ['/robots.txt']);
  }
});

test('an unreachable robots.txt counts as "not allowed" (SOURCE_ERROR) and no product is requested', async () => {
  const client = fakeClient({ '/robots.txt': robots('', 503), [PRODUCTS]: jsonRoute(sample(3)) });
  const result = await runSourceTest({ client, baseUrl: FIXTURE_BASE_URL });
  assert.equal(result.outcome, 'FAILED');
  assert.equal(result.outcome === 'FAILED' && result.failure.code, 'ROBOTS_UNAVAILABLE');
  assert.equal(result.outcome === 'FAILED' && result.failure.status, 'SOURCE_ERROR');
  assert.deepEqual(client.urls, ['/robots.txt']);
});

test('Crawl-delay slows the client down', async () => {
  const client = fakeClient({
    '/robots.txt': robots('User-agent: *\nCrawl-delay: 4\n'),
    [PRODUCTS]: jsonRoute(sample(2)),
  });
  const result = await runSourceTest({ client, baseUrl: FIXTURE_BASE_URL });
  assert.equal(result.outcome, 'PASSED');
  assert.equal(client.minInterval, 4000);
  assert.equal(result.summary?.crawlDelaySeconds, 4);
});

test('API problems map to the three source statuses', async () => {
  const run = async (status: number, body = '{}') => {
    const client = fakeClient({ '/robots.txt': robots('', 404), [PRODUCTS]: { status, body } });
    const result = await runSourceTest({ client, baseUrl: FIXTURE_BASE_URL });
    return result.outcome === 'FAILED' ? result.failure : null;
  };
  assert.deepEqual(await run(403), {
    code: 'AUTHENTICATION_REQUIRED',
    status: 'AUTHENTICATION_REQUIRED',
    detail: '403',
  });
  assert.equal((await run(404))?.status, 'ADAPTER_REQUIRED');
  assert.equal((await run(500))?.status, 'SOURCE_ERROR');
  assert.equal(
    (await run(200, '<html>Just a moment...</html>'))?.status,
    'AUTHENTICATION_REQUIRED',
  );
});

test('a sample that is too empty or too broken fails with the reason', async () => {
  const fails = async (items: unknown[]) => {
    const client = fakeClient({ '/robots.txt': robots('', 404), [PRODUCTS]: jsonRoute(items) });
    const result = await runSourceTest({ client, baseUrl: FIXTURE_BASE_URL });
    return result.outcome === 'FAILED' ? result.failure.code : result.outcome;
  };
  assert.equal(await fails([]), 'EMPTY');
  // 3 of 10 products unusable (no name): below 90% usable.
  assert.equal(
    await fails(sample(10, (id) => (id <= 3 ? storeProduct(id, { name: '' }) : storeProduct(id)))),
    'TOO_FEW_USABLE',
  );
  assert.equal(
    await fails(
      sample(10, (id) =>
        storeProduct(id, {
          prices: { regular_price: '', currency_code: 'VND', currency_minor_unit: 0 },
        }),
      ),
    ),
    'TOO_FEW_PRICES',
  );
  assert.equal(await fails(sample(10, (id) => storeProduct(id, { images: [] }))), 'TOO_FEW_IMAGES');
  // One unusable product in twenty is tolerated (95% usable) and reported.
  const client = fakeClient({
    '/robots.txt': robots('', 404),
    [PRODUCTS]: jsonRoute(
      sample(20, (id) => (id === 7 ? storeProduct(id, { name: '' }) : storeProduct(id))),
    ),
  });
  const result = await runSourceTest({ client, baseUrl: FIXTURE_BASE_URL });
  assert.equal(result.outcome, 'PASSED');
  assert.equal(result.summary?.usable, 19);
  assert.ok(
    result.problems.some((group) => group.code === 'NAME_MISSING' && group.keys[0] === '7'),
  );
});

test('the result carries no description text, only lengths, and no stock', async () => {
  const client = fakeClient({ '/robots.txt': robots('', 404), [PRODUCTS]: jsonRoute(sample(3)) });
  const result = await runSourceTest({ client, baseUrl: FIXTURE_BASE_URL });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('Mô tả dài'), false);
  assert.equal(serialized.includes('is_in_stock'), false);
  assert.ok((result.sample[0]?.descriptionLength ?? 0) > 0);
});
