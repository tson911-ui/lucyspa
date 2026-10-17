import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listUrl, rememberListUrl } from './list-memory';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

test('a link back to a list reopens it with the filters, sort and page it was left with (C70)', () => {
  const store = memoryStore();
  rememberListUrl('/vi/workforce/products', 'q=kem&brand=b1&page=3', store);
  rememberListUrl('/vi/workforce/products/p1', '', store);
  assert.equal(
    listUrl('/vi/workforce/products', store),
    '/vi/workforce/products?q=kem&brand=b1&page=3',
  );
  // The last state wins: clearing the filters brings back the plain list.
  rememberListUrl('/vi/workforce/products', '', store);
  assert.equal(listUrl('/vi/workforce/products', store), '/vi/workforce/products');
});

test('a link that carries its own query (the POS ?back= state) or a path never seen is used as given', () => {
  const store = memoryStore();
  rememberListUrl('/vi/workforce/pos', 'status=OPEN', store);
  assert.equal(
    listUrl('/vi/workforce/pos?day=2026-10-16', store),
    '/vi/workforce/pos?day=2026-10-16',
  );
  assert.equal(listUrl('/vi/workforce/teams', store), '/vi/workforce/teams');
  assert.equal(listUrl('', store), '');
});

test('without storage (server, blocked site data) or with damaged data the link stays plain', () => {
  assert.equal(listUrl('/vi/account/bookings', null), '/vi/account/bookings');
  rememberListUrl('/vi/account/bookings', 'page=2', null);
  const broken = memoryStore();
  broken.setItem('ls:list-urls', '{not json');
  assert.equal(listUrl('/vi/account/bookings', broken), '/vi/account/bookings');
});

test('only the most recent paths are kept', () => {
  const store = memoryStore();
  for (let index = 0; index < 45; index += 1) rememberListUrl(`/vi/p${index}`, 'page=2', store);
  assert.equal(listUrl('/vi/p0', store), '/vi/p0');
  assert.equal(listUrl('/vi/p44', store), '/vi/p44?page=2');
});
