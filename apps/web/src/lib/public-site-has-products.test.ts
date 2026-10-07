import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchHasPublicProducts } from './public-site';

const answer = (status: number, body: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

const list = (total: number) => ({
  hero: null,
  commitment: null,
  categories: [],
  brands: [],
  items: [],
  page: 1,
  pageSize: 20,
  total,
});

test('the menus know whether any product is published', async () => {
  assert.equal(await fetchHasPublicProducts('vi', answer(200, list(0))), false);
  assert.equal(await fetchHasPublicProducts('vi', answer(200, list(3))), true);
});

test('an unreadable catalog never hides the menu entry', async () => {
  assert.equal(await fetchHasPublicProducts('vi', answer(500, {})), true);
  assert.equal(await fetchHasPublicProducts('vi', answer(200, { nonsense: true })), true);
  const failing = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  assert.equal(await fetchHasPublicProducts('vi', failing), true);
});
