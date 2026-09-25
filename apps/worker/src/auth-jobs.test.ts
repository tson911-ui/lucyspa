import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { DatabaseClient } from '@lucy-spa/database';
import { createLogger, FakeAuthEmailTransport } from '@lucy-spa/server';
import { parseAuthJobsEnvironment, startAuthJobs } from './auth-jobs.js';

const deliveryRing = JSON.stringify({ 1: randomBytes(32).toString('base64url') });
const smtp = {
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp-relay.gmail.com',
  MAIL_FROM_ADDRESS: 'system@lucyspa.vn',
  AUTH_DELIVERY_KEYS: deliveryRing,
  AUTH_DELIVERY_ACTIVE_VERSION: '1',
};

test('worker job configuration is validated before start and fails closed', () => {
  const config = parseAuthJobsEnvironment(smtp, 'production');
  assert.equal(config.mail.transport, 'smtp');
  assert.equal(config.deliveryKeys?.size, 1);
  assert.equal(config.dispatchIntervalMs, 5_000);
  assert.equal(config.cleanupIntervalSeconds, 900);
  assert.equal(config.cleanupEnabled, true);
  // Dispatch cannot start without the delivery ring to decrypt envelopes.
  assert.throws(
    () => parseAuthJobsEnvironment({ ...smtp, AUTH_DELIVERY_KEYS: undefined }, 'production'),
    /AUTH_DELIVERY_KEYS/,
  );
  // No credentials are needed or read for the IP-authenticated relay.
  assert.equal('username' in config.mail || 'password' in config.mail, false);
  assert.throws(() => parseAuthJobsEnvironment({}, 'production'), /MAIL_TRANSPORT/);
  assert.equal(parseAuthJobsEnvironment({}, 'development').mail.transport, 'disabled');
  // Cleanup must run within the 24-hour deadline: at most every 12 hours.
  assert.throws(
    () => parseAuthJobsEnvironment({ AUTH_CLEANUP_INTERVAL_SECONDS: '86400' }, 'development'),
    /AUTH_CLEANUP_INTERVAL_SECONDS/,
  );
  assert.throws(
    () => parseAuthJobsEnvironment({ AUTH_CLEANUP_ENABLED: 'yes' }, 'development'),
    /AUTH_CLEANUP_ENABLED/,
  );
  assert.throws(
    () => parseAuthJobsEnvironment({ EMAIL_DISPATCH_BATCH_SIZE: '0' }, 'development'),
    /EMAIL_DISPATCH_BATCH_SIZE/,
  );
});

test('job failures are logged by error class only, never with addresses or codes', async () => {
  const secret = 'linh@example.com 012345';
  const lines: string[] = [];
  const logger = createLogger('worker', 'info', {
    write: (line: string) => {
      lines.push(line);
    },
  });
  const failing = () => Promise.reject(new Error(`database echo ${secret}`));
  const database = {
    $queryRaw: failing,
    $transaction: failing,
    outboxEvent: { updateMany: failing },
  } as unknown as DatabaseClient;
  const jobs = startAuthJobs(
    database,
    { ...parseAuthJobsEnvironment(smtp, 'production'), dispatchIntervalMs: 60_000 },
    logger,
    new FakeAuthEmailTransport(),
  );
  // Both loops run immediately once; wait for their first cycle to be logged.
  for (let attempt = 0; attempt < 50 && lines.length < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await jobs.stop();
  const output = lines.join('\n');
  assert.match(output, /Auth email dispatch cycle failed/);
  assert.match(output, /Auth cleanup cycle failed/);
  assert.match(output, /"errorName":"Error"/);
  assert.equal(output.includes('linh@example.com'), false);
  assert.equal(output.includes('012345'), false);
});
