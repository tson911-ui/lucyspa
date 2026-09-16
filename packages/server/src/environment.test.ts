import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseApiEnvironment, parseWorkerEnvironment } from './environment.js';
import { redisConnectionOptions } from './redis.js';

const valid = {
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379/0',
  WEB_ORIGIN: 'http://localhost:3000',
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
  assert.equal(parseApiEnvironment({ ...valid, NODE_ENV: 'production' }).swaggerEnabled, false);
  assert.equal(parseApiEnvironment({ ...valid, SWAGGER_ENABLED: 'false' }).swaggerEnabled, false);
  assert.throws(() => parseApiEnvironment({ ...valid, SWAGGER_ENABLED: 'yes' }));
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
