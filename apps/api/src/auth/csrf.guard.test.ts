import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseApiEnvironment } from '@lucy-spa/server';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthError } from './auth.error.js';
import { CsrfGuard } from './csrf.guard.js';
import { csrfToken, generateCapability } from './crypto.js';
import type { SessionPrincipal } from './session.policy.js';
import type { SessionService } from './session.service.js';

const environment = parseApiEnvironment({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'https://spa.example',
  AUTH_CSRF_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
  AUTH_CSRF_ACTIVE_VERSION: '1',
  AUTH_THROTTLE_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
  AUTH_THROTTLE_ACTIVE_VERSION: '1',
});

function run(
  sessions: Partial<SessionService>,
  token: string,
  csrf: string | undefined,
): Promise<boolean> {
  const guard = new CsrfGuard(environment, sessions as SessionService, new Reflector());
  const request = {
    method: 'POST',
    headers: {
      origin: environment.webOrigin,
      'content-type': 'application/json',
      cookie: `${environment.auth.cookieName}=${token}`,
      ...(csrf === undefined ? {} : { 'x-csrf-token': csrf }),
    },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
  } as unknown as ExecutionContext;
  return guard.canActivate(context);
}

const rejects = (work: Promise<unknown>, code: string, reason?: string) =>
  assert.rejects(
    work,
    (error: unknown) =>
      error instanceof AuthError && error.code === code && error.reason === reason,
  );

test('a signed-in session that ended is a 401 before the CSRF token is checked', async () => {
  const token = generateCapability();
  const none = () => Promise.resolve(null);
  const ended = (value: 'AUTHORIZATION_CHANGED' | 'ENDED') => ({
    resolve: none,
    endedSession: () => Promise.resolve(value),
  });
  // Permissions changed: 401 with the reason, whatever CSRF token (or none) was sent.
  await rejects(
    run(ended('AUTHORIZATION_CHANGED'), token, 'wrong'),
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_CHANGED',
  );
  await rejects(
    run(ended('AUTHORIZATION_CHANGED'), token, undefined),
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_CHANGED',
  );
  // Revoked or expired for another reason: 401 without a reason.
  await rejects(run(ended('ENDED'), token, 'wrong'), 'AUTHENTICATION_REQUIRED');
  // Anonymous or unknown token (not a signed-in session that ended): the old 403.
  await rejects(
    run({ resolve: none, endedSession: () => Promise.resolve(null) }, token, 'x'),
    'REQUEST_NOT_ALLOWED',
  );
  await rejects(run({ resolve: none }, token, 'x'), 'REQUEST_NOT_ALLOWED');
});

test('a wrong or missing CSRF token on a valid session is still a 403', async () => {
  const token = generateCapability();
  const session = {
    id: randomUUID(),
    csrfKeyVersion: 1,
  } as SessionPrincipal;
  const sessions = {
    resolve: () => Promise.resolve(session),
    endedSession: () => assert.fail('a valid session never asks whether it ended'),
  };
  await rejects(run(sessions, token, 'wrong'), 'REQUEST_NOT_ALLOWED');
  await rejects(run(sessions, token, undefined), 'REQUEST_NOT_ALLOWED');
  const good = csrfToken(session.id, token, environment.auth.csrfKeys.get(1)!);
  assert.equal(await run(sessions, token, good), true);
});

test('cross-site requests never learn whether the session ended', async () => {
  const token = generateCapability();
  const guard = new CsrfGuard(
    environment,
    {
      resolve: () => Promise.resolve(null),
      endedSession: () => assert.fail('origin is checked first'),
    } as unknown as SessionService,
    new Reflector(),
  );
  const request = {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/json',
      cookie: `${environment.auth.cookieName}=${token}`,
      'x-csrf-token': 'x',
    },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
  } as unknown as ExecutionContext;
  await rejects(guard.canActivate(context), 'REQUEST_NOT_ALLOWED');
});
