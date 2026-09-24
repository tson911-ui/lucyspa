import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { createLogger } from './logger.js';

test('authentication secrets and request envelopes are redacted without serializing driver errors', async () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger('test', 'info', stream);
  const secrets = Object.fromEntries(
    [
      'password',
      'newPassword',
      'passwordHash',
      'otp',
      'flowToken',
      'setupToken',
      'csrfToken',
      'sessionToken',
      'token',
      'rawToken',
      'tokenHash',
      'verifierDigest',
      'encryptedPayload',
      'nonce',
      'tag',
      'emailPayload',
    ].map((field) => [field, 'sensitive-canary']),
  );
  logger.info(
    {
      ...secrets,
      nested: secrets,
      auth: { csrfKeys: 'sensitive-canary' },
      req: { body: secrets, headers: { cookie: 'sensitive-canary' } },
      res: { headers: { 'set-cookie': 'sensitive-canary' } },
      err: new Error('sensitive-canary'),
      requestId: 'safe-id',
    },
    'Safe event',
  );
  await new Promise<void>((resolve) => logger.flush(() => resolve()));
  assert.doesNotMatch(lines.join(''), /sensitive-canary/);
  assert.match(lines.join(''), /safe-id/);
  assert.match(lines.join(''), /REDACTED/);
});
