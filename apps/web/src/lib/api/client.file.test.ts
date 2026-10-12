import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client';

/** Phase 8 P8-5: a POST that answers with a file (a report export): CSRF, the name the server gave, the row count, refusals as ApiError. */
function client(handler: (path: string, init: RequestInit) => Response) {
  const calls: { path: string; init: RequestInit }[] = [];
  const fetcher = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    if (path.endsWith('/api/v1/auth/context')) {
      return Promise.resolve(
        new Response(JSON.stringify({ csrfToken: 'token-1', authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    calls.push({ path, init });
    return Promise.resolve(handler(path, init));
  }) as typeof fetch;
  return { api: new ApiClient({ fetch: fetcher }), calls };
}

test('postFile sends the JSON request with the CSRF token and returns the blob, its name and its row count', async () => {
  const { api, calls } = client(
    () =>
      new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition':
            'attachment; filename="lucyspa_refunds_2026-10-01_2026-10-12.xlsx"',
          'X-Report-Rows': '42',
        },
      }),
  );
  const file = await api.postFile('/api/v1/reports/export', { report: 'refunds', format: 'xlsx' });
  assert.equal(file.filename, 'lucyspa_refunds_2026-10-01_2026-10-12.xlsx');
  assert.equal(file.rows, 42);
  assert.equal(file.blob.size, 4);
  const sent = calls[0]!;
  assert.equal(sent.init.method, 'POST');
  const headers = sent.init.headers as Record<string, string>;
  assert.equal(headers['X-CSRF-Token'], 'token-1');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(sent.init.body)), { report: 'refunds', format: 'xlsx' });
});

test('a refusal is an ApiError with the API code; a rotated session is retried once with a fresh token', async () => {
  const { api } = client(
    () => new Response(JSON.stringify({ code: 'EXPORT_BUSY', message: 'busy' }), { status: 429 }),
  );
  await assert.rejects(api.postFile('/api/v1/reports/export', {}), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'EXPORT_BUSY');
    assert.equal(error.status, 429);
    return true;
  });
  let first = true;
  const { api: retrying, calls } = client(() => {
    if (first) {
      first = false;
      return new Response(JSON.stringify({ code: 'REQUEST_NOT_ALLOWED', message: 'no' }), {
        status: 403,
      });
    }
    return new Response('a,b\r\n', {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="x.csv"' },
    });
  });
  const file = await retrying.postFile('/api/v1/reports/export', {});
  assert.equal(file.filename, 'x.csv');
  assert.equal(calls.length, 2);
});
