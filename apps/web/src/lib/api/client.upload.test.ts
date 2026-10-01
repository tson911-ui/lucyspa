import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client';

/** A scripted XMLHttpRequest: the test decides how each request ends. */
class FakeXhr {
  static instances: FakeXhr[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  withCredentials = false;
  body: unknown;
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
}

function client(events: { unauthenticated?: string[]; ok?: number[] } = {}) {
  FakeXhr.instances = [];
  const contexts: string[] = [];
  let issued = 0;
  const fetcher = ((input: RequestInfo | URL) => {
    contexts.push(String(input));
    issued += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ csrfToken: `token-${issued}`, authenticated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  const api = new ApiClient({
    fetch: fetcher,
    xhr: () => new FakeXhr() as unknown as XMLHttpRequest,
    onUnauthenticated: (_method, reason) => events.unauthenticated?.push(String(reason)),
    onAuthenticatedResponse: () => events.ok?.push(1),
  });
  return { api, contexts };
}

const form = () => {
  const data = new FormData();
  data.append('file', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }), 'a.png');
  return data;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('upload: multipart POST with the CSRF token, no Content-Type, credentials, progress, JSON result', async () => {
  const ok: number[] = [];
  const { api, contexts } = client({ ok });
  const progress: number[] = [];
  const pending = api.upload<{ duplicate: boolean }>('/api/v1/website/media', form(), {
    onProgress: (percent) => progress.push(percent),
  });
  await settle();
  const xhr = FakeXhr.instances[0]!;
  assert.deepEqual(contexts, ['/api/v1/auth/context'], 'the token is fetched first');
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, '/api/v1/website/media');
  assert.equal(xhr.headers['X-CSRF-Token'], 'token-1');
  assert.equal(xhr.headers['Accept'], 'application/json');
  assert.equal(
    Object.keys(xhr.headers).some((name) => name.toLowerCase() === 'content-type'),
    false,
    'the browser sets the multipart boundary',
  );
  assert.equal(xhr.withCredentials, true);
  assert.ok(xhr.body instanceof FormData);
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 } as ProgressEvent);
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 } as ProgressEvent);
  xhr.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 } as ProgressEvent);
  xhr.answer(200, { asset: { id: 'x' }, duplicate: false });
  assert.deepEqual(await pending, { asset: { id: 'x' }, duplicate: false });
  assert.deepEqual(progress, [25, 100]);
  assert.equal(ok.length, 2, 'the token read and the upload both keep the session alive');
});

test('upload: API errors keep their typed code, field and request id', async () => {
  const { api } = client();
  const pending = api.upload('/api/v1/website/media', form());
  await settle();
  FakeXhr.instances[0]!.answer(415, {
    statusCode: 415,
    code: 'MEDIA_TYPE_UNSUPPORTED',
    message: 'Only JPEG, PNG or WebP images are accepted',
    requestId: 'req-9',
  });
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.deepEqual(
      [error.status, error.code, error.requestId],
      [415, 'MEDIA_TYPE_UNSUPPORTED', 'req-9'],
    );
    return true;
  });
});

test('upload: a body the proxy refused (not JSON) is HTTP_<status>, a dropped connection is NETWORK', async () => {
  const { api } = client();
  const first = api.upload('/api/v1/website/media', form());
  await settle();
  FakeXhr.instances[0]!.answer(413, '<html>Payload Too Large</html>');
  await assert.rejects(
    first,
    (error: unknown) => error instanceof ApiError && error.code === 'HTTP_413',
  );
  const second = api.upload('/api/v1/website/media', form());
  await settle();
  FakeXhr.instances[1]!.onerror?.();
  await assert.rejects(
    second,
    (error: unknown) => error instanceof ApiError && error.code === 'NETWORK',
  );
});

test('upload: a rotated session retries once with a fresh token', async () => {
  const { api, contexts } = client();
  const pending = api.upload<{ ok: boolean }>('/api/v1/website/media', form());
  await settle();
  FakeXhr.instances[0]!.answer(403, { statusCode: 403, code: 'REQUEST_NOT_ALLOWED', message: 'x' });
  await settle();
  await settle();
  assert.equal(FakeXhr.instances.length, 2);
  assert.equal(FakeXhr.instances[1]!.headers['X-CSRF-Token'], 'token-2');
  FakeXhr.instances[1]!.answer(200, { ok: true });
  assert.deepEqual(await pending, { ok: true });
  assert.equal(contexts.length, 2);
});

test('upload: an ended session tells the shell (with the reason) instead of retrying', async () => {
  const unauthenticated: string[] = [];
  const { api } = client({ unauthenticated });
  const pending = api.upload('/api/v1/website/media', form());
  await settle();
  FakeXhr.instances[0]!.answer(401, {
    statusCode: 401,
    code: 'AUTHENTICATION_REQUIRED',
    message: 'x',
    reason: 'AUTHORIZATION_CHANGED',
  });
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
  assert.deepEqual(unauthenticated, ['AUTHORIZATION_CHANGED']);
  assert.equal(FakeXhr.instances.length, 1);
});

test('upload: cancelling aborts the request and rejects with AbortError', async () => {
  const { api } = client();
  const controller = new AbortController();
  const pending = api.upload('/api/v1/website/media', form(), { signal: controller.signal });
  await settle();
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.equal(FakeXhr.instances[0]!.aborted, true);

  const early = new AbortController();
  early.abort();
  const never = api.upload('/api/v1/website/media', form(), { signal: early.signal });
  await assert.rejects(
    never,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});
