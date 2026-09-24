import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { parseAuthEnvironment } from '@lucy-spa/server';
import type { Response } from 'express';
import { clearSessionCookie, sessionCookie, setSessionCookie } from './cookies.js';
import { generateCapability } from './crypto.js';

test('production and explicit loopback cookies share exact issuance/clearing attributes', () => {
  const keys = {
    AUTH_CSRF_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
  };
  const token = generateCapability();
  for (const local of [false, true]) {
    const config = parseAuthEnvironment(
      { ...keys, AUTH_ALLOW_INSECURE_LOCAL_COOKIE: String(local) },
      local ? 'development' : 'production',
      local ? 'http://localhost:3000' : 'https://spa.example',
    );
    const values: string[] = [];
    const response = {
      append: (header: string, value: string) => {
        assert.equal(header, 'Set-Cookie');
        values.push(value);
      },
    } as Response;
    setSessionCookie(response, config, token);
    clearSessionCookie(response, config);
    const prefix = `${local ? 'lucy_session_dev' : '__Host-lucy_session'}=`;
    const attributes = `Path=/; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`;
    assert.deepEqual(values, [
      `${prefix}${token}; ${attributes}`,
      `${prefix}; ${attributes}; Max-Age=0`,
    ]);
    assert.doesNotMatch(values[0]!, /Domain=|Expires=|Max-Age=/i);
    assert.throws(() => setSessionCookie(response, config, 'bad'), /Invalid session capability/);
  }
});

test('cookie parser accepts only one strict canonical capability under the configured name', () => {
  const token = generateCapability();
  assert.equal(sessionCookie(`other=x; lucy_session_dev=${token}`, 'lucy_session_dev'), token);
  for (const header of [
    undefined,
    '',
    `lucy_session_dev=${token}=`,
    `lucy_session_dev=%41${token}`,
    `lucy_session_dev=${token}; lucy_session_dev=${token}`,
    `__Host-lucy_session=${token}`,
    'x'.repeat(8193),
  ]) {
    assert.equal(sessionCookie(header, 'lucy_session_dev'), undefined);
  }
});
