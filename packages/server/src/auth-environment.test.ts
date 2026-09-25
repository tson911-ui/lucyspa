import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { parseAuthEnvironment } from './auth-environment.js';

function environment(): NodeJS.ProcessEnv {
  return {
    AUTH_CSRF_KEYS: JSON.stringify({ '1': randomBytes(32).toString('base64url') }),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: JSON.stringify({ '1': randomBytes(32).toString('base64url') }),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
  };
}

test('auth config supplies reviewed security defaults and production host-cookie mode', () => {
  const config = parseAuthEnvironment(environment(), 'production', 'https://spa.example.test');
  assert.equal(config.anonymousTtlSeconds, 900);
  assert.equal(config.idleTtlSeconds, 3600);
  assert.equal(config.absoluteTtlSeconds, 43_200);
  assert.equal(config.freshAuthSeconds, 300);
  assert.equal(config.contextLimit, 30);
  assert.equal(config.contextWindowSeconds, 900);
  assert.equal(config.otpIpIssueLimit, 30);
  assert.equal(config.cookieName, '__Host-lucy_session');
  assert.equal(config.cookieSecure, true);
  assert.equal(config.csrfActiveVersion, 1);
  assert.equal(config.csrfKeys.get(1)?.length, 32);
  assert.equal(config.throttleKeys.get(1)?.length, 32);
  assert.equal(config.otpKeys, undefined);
  assert.equal(config.otpActiveVersion, undefined);
});

test('plaintext local cookie requires explicit opt-in and an exact loopback origin', () => {
  const env = { ...environment(), AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true' };
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    for (const nodeEnv of ['development', 'test'] as const) {
      const config = parseAuthEnvironment(env, nodeEnv, origin);
      assert.equal(config.cookieName, 'lucy_session_dev');
      assert.equal(config.cookieSecure, false);
    }
    assert.throws(() => parseAuthEnvironment(environment(), 'development', origin), /WEB_ORIGIN/);
    assert.throws(() => parseAuthEnvironment(env, 'production', origin));
  }
  for (const origin of [
    'http://localhost.attacker.test',
    'http://192.168.1.1:3000',
    'http://example.test',
    'https://localhost:3000',
  ]) {
    assert.throws(() => parseAuthEnvironment(env, 'development', origin));
  }
  assert.throws(() => parseAuthEnvironment(env, 'production', 'https://spa.example.test'));
  assert.throws(() => parseAuthEnvironment(environment(), 'production', 'http://spa.example.test'));
  assert.throws(() =>
    parseAuthEnvironment(
      { ...env, AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'yes' },
      'test',
      'http://localhost',
    ),
  );
});

test('auth config independently rejects malformed/non-origin URLs', () => {
  for (const origin of [
    'invalid',
    'https://user:password@example.test',
    'https://example.test/',
    'https://example.test/path',
    'https://example.test?query',
    'file:///tmp/test',
  ])
    assert.throws(() => parseAuthEnvironment(environment(), 'production', origin), /WEB_ORIGIN/);
});

test('key rings support retained rotation versions and stronger keys; optional OTP must be complete', () => {
  const env = {
    ...environment(),
    AUTH_CSRF_KEYS: JSON.stringify({
      '1': randomBytes(32).toString('base64url'),
      '2': randomBytes(64).toString('base64url'),
    }),
    AUTH_CSRF_ACTIVE_VERSION: '2',
    AUTH_OTP_KEYS: JSON.stringify({ '3': randomBytes(32).toString('base64url') }),
    AUTH_OTP_ACTIVE_VERSION: '3',
  };
  const config = parseAuthEnvironment(env, 'production', 'https://example.test');
  assert.equal(config.csrfKeys.size, 2);
  assert.equal(config.csrfActiveVersion, 2);
  assert.equal(config.csrfKeys.get(2)?.length, 64);
  assert.equal(config.otpActiveVersion, 3);
  assert.equal(config.otpKeys?.get(3)?.length, 32);
  assert.throws(
    () =>
      parseAuthEnvironment(
        { ...environment(), AUTH_OTP_ACTIVE_VERSION: '1' },
        'production',
        'https://example.test',
      ),
    /AUTH_OTP_KEYS/,
  );
  assert.throws(
    () =>
      parseAuthEnvironment(
        { ...environment(), AUTH_OTP_KEYS: env.AUTH_OTP_KEYS },
        'production',
        'https://example.test',
      ),
    /AUTH_OTP_ACTIVE_VERSION/,
  );
  assert.throws(
    () =>
      parseAuthEnvironment(
        { ...env, AUTH_CSRF_ACTIVE_VERSION: '3' },
        'production',
        'https://example.test',
      ),
    /AUTH_CSRF_ACTIVE_VERSION/,
  );
});

test('key configuration fails closed on missing/short/noncanonical keys or invalid versions', () => {
  const value = randomBytes(32).toString('base64url');
  for (const input of [
    '',
    'not-json-secret',
    'null',
    '[]',
    '{}',
    JSON.stringify('string'),
    JSON.stringify({ '1': randomBytes(31).toString('base64url') }),
    JSON.stringify({ '1': value + '=' }),
    JSON.stringify({ '1': value + '\n' }),
    JSON.stringify({ '1': 123 }),
    JSON.stringify({ '0': value }),
    JSON.stringify({ '-1': value }),
    JSON.stringify({ '01': value }),
    JSON.stringify({ '1\n': value }),
    JSON.stringify({ '2147483648': value }),
    JSON.stringify({ '9007199254740993': value }),
    JSON.stringify({ '1': 'A'.repeat(42) + 'B' }),
  ]) {
    assert.throws(
      () =>
        parseAuthEnvironment(
          { ...environment(), AUTH_CSRF_KEYS: input },
          'production',
          'https://example.test',
        ),
      /AUTH_CSRF_KEYS/,
    );
  }
  assert.throws(
    () => parseAuthEnvironment({}, 'production', 'https://example.test'),
    /AUTH_CSRF_KEYS/,
  );
  const env = environment();
  delete env.AUTH_THROTTLE_KEYS;
  assert.throws(
    () => parseAuthEnvironment(env, 'production', 'https://example.test'),
    /AUTH_THROTTLE_KEYS/,
  );
});

test('keys are independent across purposes and rotation versions', () => {
  const env = environment();
  assert.throws(
    () =>
      parseAuthEnvironment(
        { ...env, AUTH_THROTTLE_KEYS: env.AUTH_CSRF_KEYS },
        'production',
        'https://example.test',
      ),
    /INDEPENDENT/,
  );
  assert.throws(
    () =>
      parseAuthEnvironment(
        { ...env, AUTH_OTP_KEYS: env.AUTH_CSRF_KEYS, AUTH_OTP_ACTIVE_VERSION: '1' },
        'production',
        'https://example.test',
      ),
    /INDEPENDENT/,
  );
  const repeated = randomBytes(32).toString('base64url');
  assert.throws(
    () =>
      parseAuthEnvironment(
        { ...env, AUTH_CSRF_KEYS: JSON.stringify({ '1': repeated, '2': repeated }) },
        'production',
        'https://example.test',
      ),
    /INDEPENDENT/,
  );
});

test('all security durations, limits and active versions are bounded positive canonical integers', () => {
  for (const field of [
    'AUTH_ANONYMOUS_TTL_SECONDS',
    'AUTH_IDLE_TTL_SECONDS',
    'AUTH_ABSOLUTE_TTL_SECONDS',
    'AUTH_FRESH_AUTH_SECONDS',
    'AUTH_CONTEXT_LIMIT',
    'AUTH_CONTEXT_WINDOW_SECONDS',
    'AUTH_OTP_IP_ISSUE_LIMIT',
    'AUTH_CSRF_ACTIVE_VERSION',
    'AUTH_THROTTLE_ACTIVE_VERSION',
  ]) {
    for (const value of [
      '',
      '0',
      '-1',
      '1.5',
      'NaN',
      'Infinity',
      '1e3',
      '01',
      '1\n',
      '2147483648',
      '9007199254740993',
    ]) {
      assert.throws(
        () =>
          parseAuthEnvironment(
            { ...environment(), [field]: value },
            'production',
            'https://example.test',
          ),
        new RegExp(field),
      );
    }
  }
  for (const overrides of [
    { AUTH_ANONYMOUS_TTL_SECONDS: '43201' },
    { AUTH_IDLE_TTL_SECONDS: '43201' },
    { AUTH_FRESH_AUTH_SECONDS: '3601' }, // fresh-auth window may not exceed the idle timeout
  ])
    assert.throws(() =>
      parseAuthEnvironment(
        { ...environment(), ...overrides },
        'production',
        'https://example.test',
      ),
    );
  const config = parseAuthEnvironment(
    { ...environment(), AUTH_CONTEXT_LIMIT: '60', AUTH_CONTEXT_WINDOW_SECONDS: '300' },
    'production',
    'https://example.test',
  );
  assert.equal(config.contextLimit, 60);
  assert.equal(config.contextWindowSeconds, 300);
});

test('auth configuration errors do not serialize supplied secret values', () => {
  const secret = 'do-not-leak-this-secret';
  for (const overrides of [
    { AUTH_CSRF_KEYS: secret },
    { AUTH_CSRF_ACTIVE_VERSION: secret },
    { AUTH_CSRF_KEYS: JSON.stringify({ '1': secret }) },
  ]) {
    assert.throws(
      () =>
        parseAuthEnvironment(
          { ...environment(), ...overrides },
          'production',
          'https://example.test',
        ),
      (error: unknown) => error instanceof Error && !error.message.includes(secret),
    );
  }
});

test('optional delivery encryption ring must be complete and independent of OTP keys', () => {
  const otp = JSON.stringify({ '1': randomBytes(32).toString('base64url') });
  const config = parseAuthEnvironment(
    {
      ...environment(),
      AUTH_OTP_KEYS: otp,
      AUTH_OTP_ACTIVE_VERSION: '1',
      AUTH_DELIVERY_KEYS: JSON.stringify({ '2': randomBytes(32).toString('base64url') }),
      AUTH_DELIVERY_ACTIVE_VERSION: '2',
    },
    'production',
    'https://example.test',
  );
  assert.equal(config.deliveryActiveVersion, 2);
  assert.equal(config.deliveryKeys?.get(2)?.length, 32);
  assert.equal(
    parseAuthEnvironment(environment(), 'production', 'https://example.test').deliveryKeys,
    undefined,
  );
  assert.throws(
    () =>
      parseAuthEnvironment(
        { ...environment(), AUTH_DELIVERY_ACTIVE_VERSION: '1' },
        'production',
        'https://example.test',
      ),
    /AUTH_DELIVERY_KEYS/,
  );
  assert.throws(
    () =>
      parseAuthEnvironment(
        {
          ...environment(),
          AUTH_OTP_KEYS: otp,
          AUTH_OTP_ACTIVE_VERSION: '1',
          AUTH_DELIVERY_KEYS: otp,
          AUTH_DELIVERY_ACTIVE_VERSION: '1',
        },
        'production',
        'https://example.test',
      ),
    /INDEPENDENT/,
  );
});
