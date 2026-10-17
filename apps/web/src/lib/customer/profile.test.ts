import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerProfileDictionary } from '../../i18n/customer-profile';
import { ApiClient, ApiError } from '../api/client';
import {
  birthdayText,
  emailErrorMessage,
  emailProblem,
  nameErrorMessage,
  nameProblem,
  phoneText,
  saveCustomerName,
  verifyEmailChange,
} from './profile';

const vi = customerProfileDictionary('vi');

test('the name: required, trimmed, at most 200 characters counted as people see them', () => {
  assert.equal(nameProblem(''), 'nameRequired');
  assert.equal(nameProblem('   '), 'nameRequired');
  assert.equal(nameProblem('Hoàng Thị Lan'), null);
  assert.equal(nameProblem('x'.repeat(200)), null);
  assert.equal(nameProblem('x'.repeat(201)), 'nameTooLong');
  // An emoji is one code point, like the server counts it.
  assert.equal(nameProblem('😀'.repeat(200)), null);
});

test('the new email: password first, then address, format and "not the same one"', () => {
  const now = 'lan@example.com';
  assert.equal(emailProblem('', 'a@b.vn', now), 'passwordRequired');
  assert.equal(emailProblem('secret', '  ', now), 'emailRequired');
  assert.equal(emailProblem('secret', 'not an email', now), 'invalidEmail');
  assert.equal(emailProblem('secret', 'a b@c.vn', now), 'invalidEmail');
  assert.equal(emailProblem('secret', ' LAN@Example.com ', now), 'sameEmail');
  assert.equal(emailProblem('secret', 'lan.moi@example.com', now), null);
});

test('birthday and phone are shown the way a person writes them', () => {
  assert.equal(birthdayText('1990-03-05'), '05/03/1990');
  assert.equal(birthdayText(null), null);
  assert.equal(birthdayText('not a date'), null);
  assert.equal(phoneText('+84901234567'), '0901234567');
  assert.equal(phoneText('0901234567'), '0901234567');
  assert.equal(phoneText(null), null);
});

test('errors name the fix; anything else falls back to the generic message', () => {
  const conflict = new ApiError(409, 'CONFLICT');
  assert.equal(nameErrorMessage(conflict, vi), vi.stale);
  assert.equal(
    nameErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'fullName'), vi),
    vi.nameInvalid,
  );
  assert.equal(nameErrorMessage(new ApiError(500, 'HTTP_500'), vi), null);
  assert.equal(nameErrorMessage(new Error('x'), vi), null);

  assert.equal(emailErrorMessage(new ApiError(401, 'AUTHENTICATION_FAILED'), vi), vi.wrongPassword);
  assert.equal(emailErrorMessage(new ApiError(409, 'CONFLICT', 'email'), vi), vi.emailTaken);
  assert.equal(
    emailErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'newEmail'), vi),
    vi.invalidEmail,
  );
  assert.equal(
    emailErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'newEmailUnchanged'), vi),
    vi.sameEmail,
  );
  assert.equal(emailErrorMessage(new ApiError(400, 'VERIFICATION_FAILED'), vi), vi.badCode);
  assert.equal(emailErrorMessage(new ApiError(429, 'RATE_LIMITED'), vi), null);
});

test('no message blames the person, says "Oops" or uses "khám"', () => {
  for (const locale of ['vi', 'en'] as const) {
    const text = customerProfileDictionary(locale);
    // Every string, the nested account-deletion texts (session 10 A2) included.
    const strings = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : value !== null && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : [];
    for (const value of strings(text)) {
      assert.doesNotMatch(value, /oops|khám/i);
      assert.doesNotMatch(value, /\s{2,}/);
    }
  }
});

/** A recording fetch that answers every request with `body` and remembers what was sent. */
function recorder(body: unknown = { ok: true }) {
  const calls: { url: string; method: string; body: unknown; headers: Headers }[] = [];
  const api = new ApiClient({
    fetch: (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        headers: new Headers(init?.headers),
      });
      const payload = url.endsWith('/api/v1/auth/context')
        ? { authenticated: true, csrfToken: 'token-' + calls.length }
        : body;
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  return { api, calls };
}

test('saving the name sends the trimmed name and the version it was read at, to the session-only route', async () => {
  const { api, calls } = recorder();
  await saveCustomerName(api, 4, '  Hoàng Thị Lan ');
  const write = calls.find((call) => call.method === 'POST');
  assert.ok(write);
  assert.match(write.url, /\/api\/v1\/me\/profile$/);
  assert.deepEqual(write.body, { expectedVersion: 4, fullName: 'Hoàng Thị Lan' });
  assert.ok(write.headers.get('x-csrf-token'), 'the write carries the CSRF token');
});

test('verifying the email takes a fresh CSRF token afterwards (the session cookie rotated)', async () => {
  const { api, calls } = recorder();
  await verifyEmailChange(api, 'flow-token', ' 123456 ');
  const verify = calls.find((call) => call.url.endsWith('/api/v1/me/email/verify'));
  assert.deepEqual(verify?.body, { flowToken: 'flow-token', otp: '123456' });
  const contexts = calls.filter((call) => call.url.endsWith('/api/v1/auth/context'));
  assert.ok(contexts.length >= 2, 'the context was fetched again after the rotation');
  assert.ok(
    calls.indexOf(contexts.at(-1)!) > calls.indexOf(verify!),
    'the last context read is after the verification',
  );
});
