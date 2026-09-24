import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IDENTITY_NORMALIZATION_VERSION,
  IdentityValidationError,
  normalizeEmail,
  normalizeEmployeeCode,
  normalizePhone,
} from './identity.js';

test('email preserves delivery local case, canonicalizes IDNA, and retains dots and tags', () => {
  assert.deepEqual(normalizeEmail(' \tLinh.Spa+member@EXAMPLE.COM\r\n'), {
    emailCanonical: 'linh.spa+member@example.com',
    emailDelivery: 'Linh.Spa+member@example.com',
    normalizationVersion: IDENTITY_NORMALIZATION_VERSION,
  });
  assert.deepEqual(normalizeEmail('Linh@bücher.de'), {
    emailCanonical: 'linh@xn--bcher-kva.de',
    emailDelivery: 'Linh@xn--bcher-kva.de',
    normalizationVersion: 1,
  });
  assert.notEqual(
    normalizeEmail('linh+spa@example.com').emailCanonical,
    normalizeEmail('linh@example.com').emailCanonical,
  );
  assert.notEqual(
    normalizeEmail('linh.spa@gmail.com').emailCanonical,
    normalizeEmail('linhspa@gmail.com').emailCanonical,
  );
  assert.notEqual(
    normalizeEmail('a@аpple.com').emailCanonical,
    normalizeEmail('a@apple.com').emailCanonical,
  );
});

test('email rejects unsupported syntax, controls, malformed IDNA, and length violations', () => {
  const invalid: unknown[] = [
    null,
    12,
    '',
    'a'.repeat(1_025),
    'a@b@example.com',
    '.a@example.com',
    'a..b@example.com',
    'a.@example.com',
    'Linh <a@example.com>',
    'a@example.com,b@example.com',
    '"a"@example.com',
    'lính@example.com',
    'a@[127.0.0.1]',
    'a@127.0.0.1',
    'a@localhost',
    'a@under_score.com',
    'a@-example.com',
    'a@example-.com',
    'a@example..com',
    'a@example.com.',
    'a@xn--.com',
    'a\r\nb@example.com',
    'a\0@example.com',
    'a@exa\tmple.com',
    '\u00a0a@example.com',
    'a@%65xample.com',
    'a@example.com/path',
    'a@example.com:80',
    'a@example.com?query',
    'a@\ud800.com',
    `${'a'.repeat(65)}@example.com`,
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`,
  ];
  for (const input of invalid) assert.throws(() => normalizeEmail(input), IdentityValidationError);
  assert.equal(normalizeEmail(`${'a'.repeat(64)}@example.com`).emailDelivery.length, 76);
  const boundary = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
  assert.equal(normalizeEmail(boundary).emailDelivery.length, 254);
});

test('phone normalizes valid VN mobile, fixed lines, 0084, and explicit international input', () => {
  for (const input of [
    '0912 345 678',
    '(0912) 345-678',
    '0912.345.678',
    '+84 912 345 678',
    '0084 912 345 678',
  ]) {
    assert.deepEqual(normalizePhone(input), {
      phoneCanonical: '+84912345678',
      normalizationVersion: 1,
    });
  }
  assert.equal(normalizePhone('028 3822 1234').phoneCanonical, '+842838221234');
  assert.equal(normalizePhone('+84 (28) 3822-1234').phoneCanonical, '+842838221234');
  assert.equal(normalizePhone('+1 213 373 4253').phoneCanonical, '+12133734253');
  assert.equal(normalizePhone('+44 20 7946 0018').phoneCanonical, '+442079460018');
});

test('phone rejects prose/extensions, ambiguous prefixes and metadata-invalid numbers', () => {
  const invalid: unknown[] = [
    null,
    912345678,
    '',
    ' '.repeat(129),
    '84912345678',
    '912345678',
    '+840912345678',
    '00840912345678',
    '00442079460018',
    'call 0912345678',
    '0912345678 ext 1',
    '0912345678x1',
    '0912345678#1',
    '0912\t345678',
    '0912345678\n',
    '０９１２３４５６７８',
    '0912+345678',
    '++84912345678',
    '+84+912345678',
    '000912345678',
    '+99912345678',
    '+84123456789',
    '0123456789',
    '0912345',
    '+123',
  ];
  for (const input of invalid) assert.throws(() => normalizePhone(input), IdentityValidationError);
});

test('employee code trims and uppercases ASCII only with 1–64 character bound', () => {
  assert.deepEqual(normalizeEmployeeCode(' \tnv_linh-01\n'), {
    employeeCodeCanonical: 'NV_LINH-01',
    normalizationVersion: 1,
  });
  assert.equal(normalizeEmployeeCode('a'.repeat(64)).employeeCodeCanonical, 'A'.repeat(64));
  for (const input of [
    '',
    ' ',
    null,
    42,
    'a'.repeat(65),
    'NV 01',
    'NV/01',
    'nv.01',
    'NVé',
    'ſtaff',
    'ß',
    'ＡBC',
  ]) {
    assert.throws(() => normalizeEmployeeCode(input), IdentityValidationError);
  }
});

test('validation errors never include rejected identifiers', () => {
  for (const normalize of [normalizeEmail, normalizePhone, normalizeEmployeeCode]) {
    try {
      normalize('private identity<>');
    } catch (error) {
      assert.ok(error instanceof IdentityValidationError);
      assert.equal(String(error).includes('private identity'), false);
      assert.equal(JSON.stringify(error).includes('private identity'), false);
    }
  }
});
