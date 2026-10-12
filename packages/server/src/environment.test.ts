import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { parseApiEnvironment, parseWorkerEnvironment } from './environment.js';
import { redisConnectionOptions } from './redis.js';

const valid = {
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379/0',
  WEB_ORIGIN: 'https://spa.example',
  AUTH_CSRF_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
  AUTH_CSRF_ACTIVE_VERSION: '1',
  AUTH_THROTTLE_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
  AUTH_THROTTLE_ACTIVE_VERSION: '1',
};

test('configuration rejects missing dependencies and invalid ports without leaking inputs', () => {
  assert.throws(() => parseWorkerEnvironment({}), /DATABASE_URL.*REDIS_URL/);
  assert.throws(() => parseApiEnvironment({ ...valid, API_PORT: '0' }), /API_PORT/);
  assert.throws(() => parseApiEnvironment({ ...valid, API_PORT: '65536' }), /API_PORT/);
  assert.throws(
    () => parseApiEnvironment({ ...valid, WEB_ORIGIN: 'https://example.test/path' }),
    /WEB_ORIGIN/,
  );
  assert.throws(
    () => parseApiEnvironment({ ...valid, DATABASE_URL: 'secret-that-must-not-leak' }),
    (error: unknown) =>
      error instanceof Error && !error.message.includes('secret-that-must-not-leak'),
  );
});

test('only PostgreSQL and Redis protocols are accepted', () => {
  assert.throws(() => parseWorkerEnvironment({ ...valid, DATABASE_URL: 'file:///tmp/db.sqlite' }));
  assert.throws(() => parseWorkerEnvironment({ ...valid, REDIS_URL: 'https://localhost/' }));
  assert.throws(() => parseWorkerEnvironment({ ...valid, REDIS_URL: 'redis://localhost/wrong' }));
});

test('production docs are disabled by default and explicit false is not truthy', () => {
  const production = {
    ...valid,
    NODE_ENV: 'production',
    MEDIA_STORAGE_DIR: '/var/lib/lucy-spa/media',
  };
  assert.equal(parseApiEnvironment(production).swaggerEnabled, false);
  // UX/UI Step 11: production names an absolute media directory; the error names only the variable.
  assert.throws(
    () => parseApiEnvironment({ ...valid, NODE_ENV: 'production' }),
    /MEDIA_STORAGE_DIR$/,
  );
  assert.equal(
    parseApiEnvironment(production).mediaStorageDir,
    path.resolve('/var/lib/lucy-spa/media'),
  );
  assert.equal(parseApiEnvironment({ ...valid, SWAGGER_ENABLED: 'false' }).swaggerEnabled, false);
  assert.throws(() => parseApiEnvironment({ ...valid, SWAGGER_ENABLED: 'yes' }));
});

test('the bot data listener exists only with a long key and its own port', () => {
  assert.equal(parseApiEnvironment(valid).botData, null);
  const key = randomBytes(48).toString('base64url');
  assert.deepEqual(parseApiEnvironment({ ...valid, BOT_DATA_KEY: key }).botData, {
    key,
    host: '127.0.0.1',
    port: 3101,
  });
  assert.equal(
    parseApiEnvironment({ ...valid, BOT_DATA_KEY: key, BOT_DATA_PORT: '3201' }).botData?.port,
    3201,
  );
  // A short key, the API's own port, or an invalid port is refused; the error names the variable only, never the key.
  assert.throws(() => parseApiEnvironment({ ...valid, BOT_DATA_KEY: 'short' }), /BOT_DATA_KEY/);
  assert.throws(
    () => parseApiEnvironment({ ...valid, BOT_DATA_KEY: key, BOT_DATA_PORT: '3001' }),
    /BOT_DATA_PORT/,
  );
  assert.throws(
    () => parseApiEnvironment({ ...valid, BOT_DATA_KEY: key, BOT_DATA_PORT: '0' }),
    /BOT_DATA_PORT/,
  );
  try {
    parseApiEnvironment({ ...valid, BOT_DATA_KEY: 'short-secret-value' });
  } catch (error) {
    assert.ok(!String(error).includes('short-secret-value'));
  }
});

test('queue connections distinguish bounded HTTP calls from persistent workers', () => {
  const producer = redisConnectionOptions('rediss://worker:abc%21@localhost:6380/2', 'producer');
  assert.deepEqual(producer, {
    host: 'localhost',
    port: 6380,
    db: 2,
    username: 'worker',
    password: 'abc!',
    tls: {},
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    commandTimeout: 3000,
    enableOfflineQueue: false,
  });
  const worker = redisConnectionOptions(valid.REDIS_URL, 'worker');
  assert.equal('maxRetriesPerRequest' in worker && worker.maxRetriesPerRequest, null);
  assert.equal('commandTimeout' in worker, false);
});
