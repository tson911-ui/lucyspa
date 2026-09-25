import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { safeNext } from '../../components/workforce/screens/login';
import { SessionNoticeContext, WorkforceContext } from '../../components/workforce/session';
import { SessionLostNotice } from '../../components/workforce/shell';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, failure, json, scriptedFetch } from '../../test/support';
import { ACTIVITY_HEADER, WorkforceApi } from './api';
import { expiredLoginPath, expiryAction } from './expiry';
import { loadSession } from './workflows';

test('user-caused reads carry the activity marker; session checks never do', async () => {
  const { fetcher, calls } = scriptedFetch([
    () => json(200, {}),
    () => json(200, {}),
    context('csrf', true),
    () => json(200, { id: 'u', kind: 'OWNER', authorization: { version: 1, owner: true } }),
    () => json(201, {}),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await api.get('/api/v1/services');
  await api.get('/api/v1/services', {}, { passive: true });
  await loadSession(api); // context + /auth/me
  await api.post('/api/v1/services', {});
  assert.equal(calls[0]?.headers[ACTIVITY_HEADER], 'user', 'page load counts');
  assert.equal(calls[1]?.headers[ACTIVITY_HEADER], undefined, 'passive read does not');
  assert.equal(calls[2]?.url, '/api/v1/auth/context');
  assert.equal(calls[2]?.headers[ACTIVITY_HEADER], undefined, 'context never counts');
  assert.equal(calls[3]?.url, '/api/v1/auth/me');
  assert.equal(calls[3]?.headers[ACTIVITY_HEADER], undefined, 'session resolution never counts');
  assert.equal(calls[4]?.method, 'POST');
});

test('expiry: a failed submission keeps the page; a failed read returns to login', async () => {
  const seen: ('GET' | 'POST')[] = [];
  let restored = 0;
  const { fetcher } = scriptedFetch([
    context('csrf'),
    failure(401, 'AUTHENTICATION_REQUIRED'),
    failure(401, 'AUTHENTICATION_REQUIRED'),
    () => json(200, {}),
  ]);
  const api = new WorkforceApi({
    fetch: fetcher,
    onUnauthenticated: (method) => seen.push(method),
    onAuthenticatedResponse: () => (restored += 1),
  });
  await assert.rejects(api.post('/api/v1/services', { code: 'X' }));
  await assert.rejects(api.get('/api/v1/services'));
  await api.get('/api/v1/services');
  assert.deepEqual(seen, ['POST', 'GET']);
  assert.deepEqual(seen.map(expiryAction), ['keep', 'redirect']);
  assert.ok(restored >= 1, 'a successful response clears the expired notice');
});

test('expired sessions return to the same workforce page after signing in', () => {
  const base = '/vi/workforce';
  const current = '/vi/workforce/services/1f0c?tab=price';
  const login = expiredLoginPath(base, current);
  assert.ok(login.startsWith('/vi/workforce/login?'));
  const params = new URL(login, 'https://lucyspa.vn').searchParams;
  assert.equal(params.get('expired'), '1');
  // The login screen accepts it and returns there after sign-in.
  assert.equal(safeNext(params.get('next'), base), current);
  assert.equal(
    safeNext(new URL(expiredLoginPath(base, base), 'https://x').searchParams.get('next'), base),
    base,
  );
  // It still never leaves the workforce area.
  assert.equal(safeNext('https://evil.example/vi/workforce', base), base);
});

test('the kept page explains that nothing was saved and offers sign-in in a new tab', () => {
  const t = getWorkforceDictionary('vi');
  const render = (lost: boolean) =>
    renderToStaticMarkup(
      <WorkforceContext.Provider
        value={{
          locale: 'vi',
          t,
          api: new WorkforceApi({ fetch: () => new Promise<Response>(() => undefined) }),
          base: '/vi/workforce',
        }}
      >
        <SessionNoticeContext.Provider value={{ lost, dismiss: () => undefined }}>
          <SessionLostNotice />
        </SessionNoticeContext.Provider>
      </WorkforceContext.Provider>,
    );
  assert.equal(render(false), '');
  const markup = render(true);
  assert.ok(markup.includes(t.auth.sessionLost));
  assert.match(markup, /href="\/vi\/workforce\/login\?next=%2Fvi%2Fworkforce" target="_blank"/);
});
