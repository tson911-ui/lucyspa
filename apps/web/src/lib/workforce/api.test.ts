import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { context, failure, json, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';

test('POST fetches a CSRF context first and sends JSON with the token, same-origin', async () => {
  const { fetcher, calls } = scriptedFetch([context('csrf-1'), () => json(201, { id: 'x' })]);
  const api = new WorkforceApi({ fetch: fetcher });
  assert.deepEqual(await api.post('/api/v1/leave-requests', { a: 1 }), { id: 'x' });
  assert.equal(calls[0]?.url, '/api/v1/auth/context');
  assert.equal(calls[1]?.method, 'POST');
  assert.equal(calls[1]?.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(calls[1]?.headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[1]?.body, { a: 1 });
});

test('a rejected CSRF token is refreshed and the request retried exactly once', async () => {
  const { fetcher, calls } = scriptedFetch([
    context('old'),
    failure(403, 'REQUEST_NOT_ALLOWED'),
    context('new'),
    () => json(200, { ok: true }),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  assert.deepEqual(await api.post('/api/v1/x', {}), { ok: true });
  assert.equal(calls[3]?.headers['X-CSRF-Token'], 'new');

  const again = scriptedFetch([
    context('a'),
    failure(403, 'REQUEST_NOT_ALLOWED'),
    context('b'),
    failure(403, 'REQUEST_NOT_ALLOWED'),
  ]);
  await assert.rejects(
    new WorkforceApi({ fetch: again.fetcher }).post('/api/v1/x', {}),
    (error: unknown) => {
      return error instanceof ApiError && error.code === 'REQUEST_NOT_ALLOWED';
    },
  );
  assert.equal(again.calls.length, 4, 'no retry loop');
});

test('401 reports session expiry; error envelopes keep only safe fields', async () => {
  let expired = 0;
  const { fetcher } = scriptedFetch([
    failure(401, 'AUTHENTICATION_REQUIRED'),
    failure(400, 'VALIDATION_FAILED', 'Validation failed: reason'),
    failure(409, 'CONFLICT', 'Conflict'),
  ]);
  const api = new WorkforceApi({ fetch: fetcher, onUnauthenticated: () => (expired += 1) });
  await assert.rejects(
    api.get('/api/v1/auth/me'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
  assert.equal(expired, 1);
  await assert.rejects(api.get('/api/v1/x'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.deepEqual(
      [error.code, error.field, error.requestId],
      ['VALIDATION_FAILED', 'reason', 'req-1'],
    );
    return true;
  });
  await assert.rejects(
    api.get('/api/v1/x'),
    (error: unknown) => error instanceof ApiError && error.code === 'CONFLICT',
  );
  assert.equal(expired, 1, 'only 401 signals expiry');
});

test('network failures and GET query strings', async () => {
  const offline = new WorkforceApi({ fetch: () => Promise.reject(new Error('offline')) });
  await assert.rejects(
    offline.get('/api/v1/x'),
    (error: unknown) => error instanceof ApiError && error.code === 'NETWORK',
  );
  const { fetcher, calls } = scriptedFetch([() => json(200, {})]);
  await new WorkforceApi({ fetch: fetcher }).get('/api/v1/employees', {
    q: 'lan',
    branchId: undefined,
    status: '',
    limit: 50,
  });
  assert.equal(calls[0]?.url, '/api/v1/employees?q=lan&limit=50');
});

test('no token or credential is ever written to web storage', async () => {
  for (const file of ['api.ts', 'workflows.ts', 'permissions.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  }
});
