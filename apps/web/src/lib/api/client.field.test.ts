import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client';

/** Phase 6 P6-10: a refused command names the fields (or records) it cannot serve; a list of record ids is one field. */
function clientAnswering(status: number, body: unknown) {
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    return Promise.resolve(
      url.endsWith('/api/v1/auth/context')
        ? new Response(JSON.stringify({ csrfToken: 'token', authenticated: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
  }) as typeof fetch;
  return new ApiClient({ fetch: fetcher });
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('the field of an error is a name, one record id, or a list of record ids', async () => {
  const cases: [string, string | null][] = [
    ['Name is invalid: displayName', 'displayName'],
    [`This overlaps: ${A}`, A],
    [`There is not enough stock: ${A},${B}`, `${A},${B}`],
    [`There is not enough stock: ${A}, ${B}`, null],
    ['No field here', null],
  ];
  for (const [message, expected] of cases) {
    const api = clientAnswering(409, { code: 'PRODUCT_OUT_OF_STOCK', message });
    await assert.rejects(api.post('/api/v1/pos/invoices/x/finalize', {}), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'PRODUCT_OUT_OF_STOCK');
      assert.equal(error.field, expected, message);
      return true;
    });
  }
});
