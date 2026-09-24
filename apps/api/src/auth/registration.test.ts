import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from './auth.error.js';
import { normalizeRegistration, parseDateOfBirth, type RegistrationInput } from './registration.js';

const valid: RegistrationInput = {
  fullName: '  Nguyễn Thị Linh ',
  dateOfBirth: '1990-02-28',
  address: ' 12 Lê Lợi, Quận 1, TP. Hồ Chí Minh ',
  email: ' Linh.Spa+member@EXAMPLE.COM ',
  phone: '0912 345 678',
  password: 'a calm lotus evening 2026',
  locale: 'vi',
};

function field(work: () => unknown): string | undefined {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof AuthError);
    assert.equal(error.code, 'VALIDATION_FAILED');
    return error.field;
  }
  assert.fail('expected validation failure');
}

test('registration normalizes every required PRD field through the Step 3 identity rules', () => {
  const candidate = normalizeRegistration(valid);
  assert.equal(candidate.fullName, 'Nguyễn Thị Linh');
  assert.equal(candidate.address, '12 Lê Lợi, Quận 1, TP. Hồ Chí Minh');
  assert.equal(candidate.emailCanonical, 'linh.spa+member@example.com');
  assert.equal(candidate.emailDelivery, 'Linh.Spa+member@example.com');
  assert.equal(candidate.phoneCanonical, '+84912345678');
  assert.equal(candidate.normalizationVersion, 1);
  assert.equal(candidate.password, valid.password);
  assert.equal(candidate.locale, 'vi');
  assert.equal(candidate.dateOfBirth.toISOString(), '1990-02-28T00:00:00.000Z');
});

test('registration reports only the invalid field identifier, never the value', () => {
  assert.equal(
    field(() => normalizeRegistration({ ...valid, fullName: '   ' })),
    'fullName',
  );
  assert.equal(
    field(() => normalizeRegistration({ ...valid, fullName: 'Linh\nX' })),
    'fullName',
  );
  assert.equal(
    field(() => normalizeRegistration({ ...valid, fullName: 'x'.repeat(201) })),
    'fullName',
  );
  assert.equal(
    field(() => normalizeRegistration({ ...valid, address: '' })),
    'address',
  );
  assert.equal(
    field(() => normalizeRegistration({ ...valid, email: 'not-an-email' })),
    'email',
  );
  assert.equal(
    field(() => normalizeRegistration({ ...valid, phone: '84912345678' })),
    'phone',
  );
  assert.equal(
    field(() => normalizeRegistration({ ...valid, password: 'short' })),
    'password',
  );
  assert.equal(
    field(() => normalizeRegistration({ ...valid, locale: 'fr' as 'vi' })),
    'locale',
  );
  const error = (() => {
    try {
      normalizeRegistration({ ...valid, password: 'short' });
    } catch (caught) {
      return caught as AuthError;
    }
  })();
  assert.equal(JSON.stringify(error?.getResponse()).includes('short'), false);
});

test('date of birth is a real calendar date, not in the future, with no invented minimum age', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  assert.equal(parseDateOfBirth('2000-02-29', now).toISOString(), '2000-02-29T00:00:00.000Z');
  assert.equal(parseDateOfBirth('2026-09-24', now).toISOString(), '2026-09-24T00:00:00.000Z');
  for (const value of [
    '1900-02-29',
    '2023-02-29',
    '2026-13-01',
    '2026-00-10',
    '1899-12-31',
    '2026-09-25',
    '26-09-24',
    '2026-9-24',
    '2026-09-24T00:00:00Z',
  ]) {
    assert.equal(
      field(() => parseDateOfBirth(value, now)),
      'dateOfBirth',
      value,
    );
  }
  // 23:30 UTC is already the next calendar day in Asia/Ho_Chi_Minh.
  assert.doesNotThrow(() => parseDateOfBirth('2026-09-25', new Date('2026-09-24T23:30:00Z')));
});
