import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { safeNext } from '../../components/workforce/screens/login';
import { SessionNoticeContext, WorkforceContext } from '../../components/workforce/session';
import { SessionLostNotice } from '../../components/workforce/shell';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, failure, json, scriptedFetch } from '../../test/support';
import { ACTIVITY_HEADER, WorkforceApi } from './api';
import {
  expiredLoginPath,
  expiryAction,
  PERMISSIONS_CHANGED_PARAM,
  sessionEndReason,
  type SessionEndReason,
} from './expiry';
import {
  createSessionCheck,
  SESSION_WATCH_INTERVAL_MS,
  SESSION_WATCH_MIN_GAP_MS,
} from './session-watch';
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
  const render = (lost: boolean, reason: SessionEndReason = null) =>
    renderToStaticMarkup(
      <WorkforceContext.Provider
        value={{
          locale: 'vi',
          t,
          api: new WorkforceApi({ fetch: () => new Promise<Response>(() => undefined) }),
          base: '/vi/workforce',
        }}
      >
        <SessionNoticeContext.Provider
          value={{ lost, reason, dismiss: () => undefined, report: () => undefined }}
        >
          <SessionLostNotice />
        </SessionNoticeContext.Provider>
      </WorkforceContext.Provider>,
    );
  assert.equal(render(false), '');
  const markup = render(true);
  assert.ok(markup.includes(t.auth.sessionLost));
  assert.match(markup, /href="\/vi\/workforce\/login\?next=%2Fvi%2Fworkforce" target="_blank"/);
  // A permission change says so instead of "expired" (still keeps the page and offers sign-in).
  const changed = render(true, 'AUTHORIZATION_CHANGED');
  assert.ok(changed.includes(t.auth.permissionsChangedLost));
  assert.ok(!changed.includes(t.auth.sessionLost));
  assert.ok(
    t.auth.permissionsChanged.startsWith('Quyền của bạn đã thay đổi, vui lòng đăng nhập lại'),
  );
});

test('the API reason reaches the client and the login path keeps it', async () => {
  const seen: [string, string | null][] = [];
  const { fetcher } = scriptedFetch([
    context('csrf'),
    failure(401, 'AUTHENTICATION_REQUIRED', 'x', { reason: 'AUTHORIZATION_CHANGED' }),
    failure(401, 'AUTHENTICATION_REQUIRED'),
  ]);
  const api = new WorkforceApi({
    fetch: fetcher,
    onUnauthenticated: (method, reason) => seen.push([method, reason]),
  });
  await assert.rejects(api.post('/api/v1/services', {}));
  await assert.rejects(api.get('/api/v1/services'));
  assert.deepEqual(seen, [
    ['POST', 'AUTHORIZATION_CHANGED'],
    ['GET', null],
  ]);
  assert.equal(sessionEndReason('AUTHORIZATION_CHANGED'), 'AUTHORIZATION_CHANGED');
  assert.equal(sessionEndReason('SOMETHING_ELSE'), null);
  assert.equal(sessionEndReason(null), null);

  const base = '/vi/workforce';
  const changed = new URL(
    expiredLoginPath(base, `${base}/roles`, 'AUTHORIZATION_CHANGED'),
    'https://x',
  ).searchParams;
  assert.equal(changed.get('expired'), '1');
  assert.equal(changed.get('reason'), PERMISSIONS_CHANGED_PARAM);
  assert.equal(safeNext(changed.get('next'), base), `${base}/roles`);
  const plain = new URL(expiredLoginPath(base, base), 'https://x').searchParams;
  assert.equal(plain.get('reason'), null);
});

test('the session watch checks /auth/me passively, once per gap, and reports a 401 once', async () => {
  let clock = 1_000_000;
  const ended: SessionEndReason[] = [];
  const { fetcher, calls } = scriptedFetch([
    () => json(200, {}),
    () => new Response(null, { status: 503 }),
    failure(401, 'AUTHENTICATION_REQUIRED', 'x', { reason: 'AUTHORIZATION_CHANGED' }),
    failure(401, 'AUTHENTICATION_REQUIRED'),
  ]);
  const api = new WorkforceApi({
    fetch: fetcher,
    onUnauthenticated: () => assert.fail('the watch handles its own 401'),
  });
  const check = createSessionCheck({
    api,
    onEnded: (reason) => ended.push(reason),
    now: () => clock,
  });
  await check(); // healthy
  await check(); // too soon: no request
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, '/api/v1/auth/me');
  assert.equal(calls[0]?.headers[ACTIVITY_HEADER], undefined, 'never extends the idle timeout');
  clock += SESSION_WATCH_MIN_GAP_MS;
  await check(); // server error: not a verdict
  assert.deepEqual(ended, []);
  clock += SESSION_WATCH_MIN_GAP_MS;
  await check(); // permissions changed
  assert.deepEqual(ended, ['AUTHORIZATION_CHANGED']);
  clock += SESSION_WATCH_INTERVAL_MS;
  await check(); // already ended: no more requests
  assert.equal(calls.length, 3);
});
