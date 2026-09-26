import type { CurrentAccountResponse, CustomerBookingDetail } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookScreen } from '../../components/customer/screens/book';
import {
  CustomerBookingDetailScreen,
  CustomerHomeScreen,
} from '../../components/customer/screens/bookings';
import { CustomerAccountContext, CustomerContext } from '../../components/customer/session';
import { getCustomerDictionary } from '../../i18n/customer';
import type { Locale } from '../../i18n/locales';
import { context, customer, failure, json, scriptedFetch } from '../../test/support';
import { ApiClient, ApiError } from '../api/client';
import { customerLogin, loadCustomerSession, safeCustomerNext } from './auth';
import {
  createRequest,
  customerErrorMessage,
  emptyDraft,
  formatVndRange,
  moveService,
  peopleProblem,
  RETRY_TIME_CODES,
  toggleService,
  type BookingDraft,
} from './booking';

const vi = getCustomerDictionary('vi');
const en = getCustomerDictionary('en');

function draft(): BookingDraft {
  let value = { ...emptyDraft(), branchId: 'b1', date: '2027-03-01', startTime: '10:00' };
  value = toggleService(toggleService(toggleService(value, 's1'), 's2'), 's3');
  return {
    ...value,
    startTime: '10:00',
    people: [
      ...value.people,
      { key: 'kid', relation: 'CHILD', name: '  Bé Na ', phone: ' ' },
      { key: 'unused', relation: 'OTHER', name: 'Nobody', phone: '' },
    ],
    recipientOf: ['self', 'kid', 'kid'],
    staffOf: ['ANY', 'emp-2', 'ANY'],
  };
}

test('the create request: session owner never sent; each used person once; Any = null', () => {
  const body = createRequest(draft(), 'key-1');
  assert.equal(body.idempotencyKey, 'key-1');
  assert.ok(!('ownerUserId' in body) && !('customerId' in body), 'no owner in the body');
  assert.deepEqual(body.recipients, [
    { key: 'self', relation: 'SELF' },
    { key: 'kid', relation: 'CHILD', displayName: 'Bé Na' },
  ]);
  assert.deepEqual(body.lines, [
    { serviceId: 's1', recipientKey: 'self', employeeUserId: null },
    { serviceId: 's2', recipientKey: 'kid', employeeUserId: 'emp-2' },
    { serviceId: 's3', recipientKey: 'kid', employeeUserId: null },
  ]);
});

test('reordering and removing services keeps each choice with its service', () => {
  const moved = moveService(draft(), 2, -1);
  assert.deepEqual(moved.serviceIds, ['s1', 's3', 's2']);
  assert.deepEqual(moved.staffOf, ['ANY', 'ANY', 'emp-2']);
  assert.equal(moved.startTime, '', 'a new order needs a new time');
  const removed = toggleService(draft(), 's2');
  assert.deepEqual(removed.serviceIds, ['s1', 's3']);
  assert.deepEqual(removed.recipientOf, ['self', 'kid']);
  assert.deepEqual(moveService(draft(), 0, -1).serviceIds, ['s1', 's2', 's3']);
});

test('another person needs a name; the owner does not', () => {
  const value = draft();
  assert.equal(peopleProblem(value), null);
  const nameless = {
    ...value,
    people: value.people.map((p) => (p.key === 'kid' ? { ...p, name: ' ' } : p)),
  };
  assert.equal(peopleProblem(nameless), 'name');
});

test('errors are customer-safe and localized; slot problems send the customer back to time', () => {
  for (const code of RETRY_TIME_CODES) {
    const text = customerErrorMessage(new ApiError(409, code), vi);
    assert.ok(text.length > 0 && !text.includes(code), code);
  }
  assert.equal(
    customerErrorMessage(new ApiError(409, 'BOOKING_KTV_UNAVAILABLE'), en),
    en.errors.booking.BOOKING_KTV_UNAVAILABLE,
  );
  assert.equal(customerErrorMessage(new ApiError(500, 'HTTP_500'), vi), vi.errors.unexpected);
  assert.equal(
    customerErrorMessage(new Error('Prisma P2002 constraint'), vi),
    vi.errors.unexpected,
  );
  assert.ok(!RETRY_TIME_CODES.has('BOOKING_CANCEL_NOT_ALLOWED'));
});

test('prices are catalog reference ranges; post-login destinations stay in the member area', () => {
  assert.equal(formatVndRange('150000', '150000', 'vi'), '150.000 ₫');
  assert.equal(formatVndRange('150000', '200000', 'en'), '150,000 ₫ – 200,000 ₫');
  assert.equal(safeCustomerNext('/vi/account/bookings/x', '/vi/account'), '/vi/account/bookings/x');
  assert.equal(safeCustomerNext('https://evil.example', '/vi/account'), '/vi/account');
  assert.equal(safeCustomerNext('/vi/workforce', '/vi/account'), '/vi/account');
  assert.equal(safeCustomerNext('/vi/account/login?next=x', '/vi/account'), '/vi/account');
});

test('login uses the CUSTOMER realm by email and refreshes CSRF; staff sessions are told apart', async () => {
  const { fetcher, calls } = scriptedFetch([
    context('anon'),
    () => json(200, customer),
    context('fresh', true),
  ]);
  const api = new ApiClient({ fetch: fetcher });
  await customerLogin(api, ' lan@example.com ', 'secret-pass');
  assert.equal(calls[1]?.url, '/api/v1/auth/login');
  assert.deepEqual(calls[1]?.body, {
    realm: 'CUSTOMER',
    identifierType: 'EMAIL',
    identifier: 'lan@example.com',
    password: 'secret-pass',
  });
  assert.equal(calls[1]?.headers['X-CSRF-Token'], 'anon');

  const staff: CurrentAccountResponse = { ...customer, kind: 'EMPLOYEE' };
  const session = scriptedFetch([context('t', true), () => json(200, staff)]);
  assert.equal(
    (await loadCustomerSession(new ApiClient({ fetch: session.fetcher }))).kind,
    'workforce',
  );
  const anonymous = scriptedFetch([context('t', false)]);
  assert.equal(
    (await loadCustomerSession(new ApiClient({ fetch: anonymous.fetcher }))).kind,
    'anonymous',
  );
  const expired = scriptedFetch([context('t', true), failure(401, 'AUTHENTICATION_REQUIRED')]);
  assert.equal(
    (await loadCustomerSession(new ApiClient({ fetch: expired.fetcher }))).kind,
    'anonymous',
  );
});

/** First paint with real contexts and an API whose requests never settle. */
function paint(node: ReactNode, locale: Locale = 'vi', fetcher?: typeof fetch): string {
  const api = new ApiClient({ fetch: fetcher ?? (() => new Promise<Response>(() => undefined)) });
  return renderToStaticMarkup(
    <CustomerContext.Provider
      value={{
        locale,
        t: getCustomerDictionary(locale),
        api,
        base: `/${locale}/account`,
        sessionLost: false,
      }}
    >
      <CustomerAccountContext.Provider
        value={{ account: { ...customer, displayName: 'Lan' }, signOut: () => Promise.resolve() }}
      >
        {node}
      </CustomerAccountContext.Provider>
    </CustomerContext.Provider>,
  );
}

test('screens: booking wizard starts at the branch step; home greets; VI and EN', () => {
  const book = paint(<BookScreen />);
  assert.match(book, new RegExp(vi.book.title));
  assert.match(book, /aria-current="step"[^>]*>Chi nhánh</);
  assert.ok(book.includes(vi.common.loading), 'branches come from the server');
  const bookEn = paint(<BookScreen />, 'en');
  assert.match(bookEn, new RegExp(en.book.steps.review));
  const home = paint(<CustomerHomeScreen />);
  assert.match(home, /Xin chào, Lan/);
  assert.match(home, /href="\/vi\/account\/book"/);
  const detail = paint(<CustomerBookingDetailScreen id="b-1" />, 'en');
  assert.ok(detail.includes(en.common.loading), 'detail is loaded from the server, never faked');
});

test('the detail contract carries no internal or audit fields', () => {
  const sample: CustomerBookingDetail = {
    id: 'b',
    code: 'BK-270301-ABCDEF',
    branch: { id: 'br', name: 'Q1', timezone: 'Asia/Ho_Chi_Minh' },
    date: '2027-03-01',
    startsAt: '2027-03-01T03:00:00.000Z',
    endsAt: '2027-03-01T04:00:00.000Z',
    status: 'CONFIRMED',
    serviceNames: [{ vi: 'A', en: 'A' }],
    canCancel: true,
    createdAt: '2027-02-01T00:00:00.000Z',
    cancelledAt: null,
    cancelledLate: null,
    recipients: [{ key: 'r', relation: 'SELF', displayName: null }],
    lines: [],
  };
  const keys = Object.keys(sample);
  for (const internal of [
    'rowVersion',
    'idempotencyKey',
    'createdByUserId',
    'ownerUserId',
    'cancelReason',
  ]) {
    assert.ok(!keys.includes(internal), internal);
  }
});
