import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  capabilityDigest,
  constantTimeEqual,
  csrfToken,
  generateCapability,
  generateOtp,
  lengthPrefixedTuple,
  otpDigest,
  throttleDigest,
  verifyCsrfToken,
  verifyOtpDigest,
  type OtpBinding,
} from './crypto.js';

test('capabilities are opaque 32-byte values with canonical encoding and only a digest for storage', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => generateCapability()));
  assert.equal(tokens.size, 100);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const decoded = Buffer.from(token, 'base64url');
    assert.equal(decoded.length, 32);
    assert.equal(token, decoded.toString('base64url'));
    assert.deepEqual(capabilityDigest(token), createHash('sha256').update(decoded).digest());
    assert.notDeepEqual(capabilityDigest(token), decoded);
  }
});

test('capability parsing rejects padding, whitespace, wrong length and aliases accepted by Buffer', () => {
  const canonical = Buffer.alloc(32).toString('base64url');
  const alias = canonical.slice(0, -1) + 'B';
  assert.deepEqual(Buffer.from(alias, 'base64url'), Buffer.from(canonical, 'base64url'));
  for (const malformed of [
    '',
    canonical + '=',
    canonical + '\n',
    ' ' + canonical,
    canonical.slice(1),
    canonical + 'A',
    '+'.repeat(43),
    alias,
  ]) {
    assert.equal(capabilityDigest(malformed), null);
  }
});

test('length-prefixed UTF-8 tuples have an independently specified encoding without ambiguities', () => {
  assert.equal(
    lengthPrefixedTuple(['a', 'bc', '\u00e9', '']).toString('hex'),
    '000000016100000002626300000002c3a900000000',
  );
  assert.notDeepEqual(lengthPrefixedTuple(['ab', 'c']), lengthPrefixedTuple(['a', 'bc']));
  assert.notDeepEqual(lengthPrefixedTuple(['a\0', 'b']), lengthPrefixedTuple(['a', '\0b']));
  assert.notDeepEqual(lengthPrefixedTuple(['', '']), lengthPrefixedTuple(['']));
  assert.throws(() => lengthPrefixedTuple(['\ud800']), /Invalid cryptographic tuple field/);
});

test('constant-time comparison accepts byte-array views and rejects unequal content or length', () => {
  const bytes = randomBytes(32);
  assert.equal(constantTimeEqual(bytes, new Uint8Array(bytes)), true);
  assert.equal(constantTimeEqual(bytes, bytes.subarray(1)), false);
  const different = Buffer.from(bytes);
  different[0] = different[0]! ^ 1;
  assert.equal(constantTimeEqual(bytes, different), false);
});

test('CSRF uses the reviewed formula and binds both session ID and raw token', () => {
  const key = randomBytes(32);
  const raw = generateCapability();
  const sessionId = 'session-id';
  // Encode independently so the test checks the protocol rather than reusing its encoder.
  const parts = ['csrf-v1', sessionId, raw].map((part) => {
    const value = Buffer.from(part, 'utf8');
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(value.length);
    return Buffer.concat([prefix, value]);
  });
  const expected = createHmac('sha256', key).update(Buffer.concat(parts)).digest('base64url');
  assert.equal(csrfToken(sessionId, raw, key), expected);
  assert.equal(verifyCsrfToken(expected, sessionId, raw, key), true);
  assert.equal(verifyCsrfToken(expected, 'different-session', raw, key), false);
  assert.equal(verifyCsrfToken(expected, sessionId, generateCapability(), key), false);
  assert.equal(verifyCsrfToken(expected, sessionId, raw, randomBytes(32)), false);
  assert.equal(verifyCsrfToken(expected + '=', sessionId, raw, key), false);
  assert.equal(verifyCsrfToken(expected, '', raw, key), false);
  assert.equal(verifyCsrfToken(expected, sessionId, 'invalid-capability', key), false);
  assert.throws(() => csrfToken(sessionId, raw, Buffer.alloc(31)), /Invalid authentication key/);
  assert.throws(() => csrfToken('', raw, key), /Invalid CSRF session binding/);
});

test('OTP uses a keyed verifier bound to every challenge field and rejects cross-purpose replay', () => {
  const key = randomBytes(32);
  const binding: OtpBinding = {
    purpose: 'RESET_PASSWORD',
    challengeId: 'challenge-id',
    generation: 1,
    subjectId: 'user-id',
    emailCanonical: 'linh@example.test',
    credentialVersion: 1,
  };
  const digest = otpDigest(binding, '000123', key);
  assert.equal(digest.length, 32);
  assert.equal(verifyOtpDigest(digest, binding, '000123', key), true);
  assert.equal(verifyOtpDigest(digest, binding, '123456', key), false);
  assert.equal(verifyOtpDigest(digest, binding, '000123', randomBytes(32)), false);
  for (const changed of [
    { ...binding, purpose: 'VERIFY_RECOVERY_EMAIL' as const },
    { ...binding, challengeId: 'other-id' },
    { ...binding, generation: 2 },
    { ...binding, subjectId: 'other-user-id' },
    { ...binding, emailCanonical: 'other@example.test' },
    { ...binding, credentialVersion: 2 },
  ]) {
    assert.equal(verifyOtpDigest(digest, changed, '000123', key), false);
  }
  assert.equal(verifyOtpDigest(digest.subarray(1), binding, '000123', key), false);
  for (const code of [
    '12345',
    '1234567',
    '000123\n',
    'abcdef',
    '\uff10\uff10\uff10\uff11\uff12\uff13',
  ]) {
    assert.equal(verifyOtpDigest(digest, binding, code, key), false);
    assert.throws(() => otpDigest(binding, code, key), /Invalid OTP binding/);
  }
  assert.throws(() => otpDigest({ ...binding, generation: 0 }, '000123', key));
  assert.throws(() => otpDigest({ ...binding, credentialVersion: null }, '000123', key));
  assert.throws(() => otpDigest({ ...binding, generation: 2_147_483_648 }, '000123', key));
  assert.throws(() => otpDigest(binding, '000123', Buffer.alloc(31)), /Invalid authentication key/);
  assert.equal(
    otpDigest({ ...binding, purpose: 'ACTIVATE_CUSTOMER', credentialVersion: null }, '000123', key)
      .length,
    32,
  );
});

test('OTP generation returns exactly six ASCII digits', () => {
  for (let index = 0; index < 100; index += 1) assert.match(generateOtp(), /^[0-9]{6}$/);
});

test('throttle pseudonyms separate operations and identities without retaining raw input', () => {
  const key = randomBytes(32);
  const digest = throttleDigest('AUTH_CONTEXT_IP', '127.0.0.1', key);
  assert.equal(digest.length, 32);
  assert.deepEqual(digest, throttleDigest('AUTH_CONTEXT_IP', '127.0.0.1', key));
  assert.notDeepEqual(digest, throttleDigest('OTP_IP', '127.0.0.1', key));
  assert.notDeepEqual(digest, throttleDigest('AUTH_CONTEXT_IP', '127.0.0.2', key));
  assert.notDeepEqual(digest, throttleDigest('AUTH_CONTEXT_IP', '127.0.0.1', randomBytes(32)));
  assert.throws(() => throttleDigest('', '127.0.0.1', key), /Invalid throttle binding/);
  assert.throws(() => throttleDigest('AUTH_CONTEXT_IP', '127.0.0.1', Buffer.alloc(31)));
});
