import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { hasAppHistory, parentPath, resetRouteHistory, trackRoute } from './back';

const STAFF = '/vi/workforce';
const MEMBER = '/vi/account';

test('the staff dashboard has no Back button; a list returns to it', () => {
  assert.equal(parentPath(STAFF, STAFF, null), null);
  assert.equal(parentPath(`${STAFF}/`, STAFF, null), null);
  for (const list of ['pos', 'employees', 'booking-board', 'website', 'discounts', 'my-services']) {
    assert.equal(parentPath(`${STAFF}/${list}`, STAFF, null), STAFF, list);
  }
});

test('a staff detail or form returns to its list, a version page to its detail, a website entry to its tab', () => {
  assert.equal(parentPath(`${STAFF}/employees/e1`, STAFF, null), `${STAFF}/employees`);
  assert.equal(parentPath(`${STAFF}/employees/new`, STAFF, null), `${STAFF}/employees`);
  assert.equal(parentPath(`${STAFF}/pos/inv-1`, STAFF, null), `${STAFF}/pos`);
  assert.equal(parentPath(`${STAFF}/teams/t1`, STAFF, null), `${STAFF}/teams`);
  assert.equal(
    parentPath(`${STAFF}/discounts/d1/versions/new`, STAFF, null),
    `${STAFF}/discounts/d1`,
  );
  assert.equal(
    parentPath(`${STAFF}/website/seasons/s1`, STAFF, null),
    `${STAFF}/website?tab=season`,
  );
  assert.equal(
    parentPath(`${STAFF}/website/seasons/new`, STAFF, null),
    `${STAFF}/website?tab=season`,
  );
  assert.equal(parentPath(`${STAFF}/website/popups/p1`, STAFF, null), `${STAFF}/website?tab=popup`);
});

test('the member area: home returns to the public home, lists to the home, details to their list', () => {
  assert.equal(parentPath(MEMBER, MEMBER, '/vi'), '/vi');
  assert.equal(parentPath(`${MEMBER}/bookings`, MEMBER, '/vi'), MEMBER);
  assert.equal(parentPath(`${MEMBER}/invoices`, MEMBER, '/vi'), MEMBER);
  assert.equal(parentPath(`${MEMBER}/notifications`, MEMBER, '/vi'), MEMBER);
  assert.equal(parentPath(`${MEMBER}/book`, MEMBER, '/vi'), MEMBER);
  assert.equal(parentPath(`${MEMBER}/bookings/b1`, MEMBER, '/vi'), `${MEMBER}/bookings`);
  assert.equal(parentPath(`${MEMBER}/invoices/i1`, MEMBER, '/vi'), `${MEMBER}/invoices`);
});

test('the public services pages: a service returns to the list, the list to the home', () => {
  const SERVICES = '/vi/services';
  assert.equal(parentPath(SERVICES, SERVICES, '/vi'), '/vi');
  assert.equal(parentPath(`${SERVICES}/GOI_THUONG`, SERVICES, '/vi'), SERVICES);
  assert.equal(parentPath(`${SERVICES}/GOI_THUONG/`, SERVICES, '/vi'), SERVICES);
  assert.equal(parentPath('/en/services/GOI_THUONG', '/en/services', '/en'), '/en/services');
});

test('a path outside the area has no parent', () => {
  assert.equal(parentPath('/vi/services', STAFF, null), null);
  assert.equal(parentPath('/vi/workforcefoo', STAFF, null), null);
});

beforeEach(() => resetRouteHistory());

test('history: a page opened directly has none; a click through the app, or an in-app referrer, has', () => {
  const origin = 'https://lucyspa.example';
  trackRoute('/vi/workforce/pos');
  assert.equal(hasAppHistory('', origin), false, 'first page of the tab, no referrer');
  assert.equal(hasAppHistory('https://www.google.com/', origin), false, 'came from another site');
  assert.equal(
    hasAppHistory(`${origin}/vi/workforce`, origin),
    true,
    'came from a page of the app',
  );
  trackRoute('/vi/workforce/pos');
  assert.equal(hasAppHistory('', origin), false, 'the same path again is not a navigation');
  trackRoute('/vi/workforce/pos/inv-1');
  assert.equal(hasAppHistory('', origin), true, 'a navigation inside the app');
});
