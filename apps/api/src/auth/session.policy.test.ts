import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  authorizationChanged,
  endedAuthenticatedSession,
  hasFreshReauthentication,
  sessionPrincipal,
  type SessionPolicy,
  type SessionRecord,
} from './session.policy.js';

const now = new Date('2026-09-24T00:00:00.000Z');
const policy: SessionPolicy = { idleTtlSeconds: 1_800, csrfKeys: new Map([[1, randomBytes(32)]]) };

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-fixture',
    kind: 'AUTHENTICATED',
    userId: 'user-fixture',
    credentialVersion: 3,
    authzVersion: 5,
    csrfKeyVersion: 1,
    createdAt: new Date(now.getTime() - 3_600_000),
    lastActivityAt: new Date(now.getTime() - 1_000),
    absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
    revokedAt: null,
    reauthenticatedAt: null,
    user: {
      kind: 'EMPLOYEE',
      status: 'ACTIVE',
      passwordHash: 'credential-presence-fixture',
      emailVerifiedAt: null,
      credentialVersion: 3,
      authzVersion: 5,
    },
    ...overrides,
  };
}

test('session principal excludes credential material and database records', () => {
  const principal = sessionPrincipal(record(), now, policy);
  assert.equal(principal?.userKind, 'EMPLOYEE');
  assert.equal(principal?.userId, 'user-fixture');
  assert.ok(!JSON.stringify(principal).includes('credential-presence-fixture'));
  assert.ok(!Object.hasOwn(principal ?? {}, 'user'));
  assert.ok(!Object.hasOwn(principal ?? {}, 'passwordHash'));
});

test('expiry/revocation/unknown CSRF key fail closed at the exact boundary', () => {
  for (const invalid of [
    null,
    record({ revokedAt: now }),
    record({ absoluteExpiresAt: now }),
    record({ lastActivityAt: new Date(now.getTime() - 1_800_000) }),
    record({ lastActivityAt: new Date(now.getTime() + 1) }),
    record({ createdAt: new Date(now.getTime() + 1) }),
    record({ csrfKeyVersion: 2 }),
  ]) {
    assert.equal(sessionPrincipal(invalid, now, policy), null);
  }
  assert.ok(
    sessionPrincipal(record({ lastActivityAt: new Date(now.getTime() - 1_799_999) }), now, policy),
  );
});

test('every read requires current ACTIVE User credential and both current versions', () => {
  const base = record();
  assert.ok(base.user);
  for (const user of [
    null,
    { ...base.user, status: 'INACTIVE' as const },
    { ...base.user, status: 'PENDING_SETUP' as const },
    { ...base.user, passwordHash: null },
    { ...base.user, credentialVersion: 4 },
    { ...base.user, authzVersion: 6 },
    { ...base.user, kind: 'CUSTOMER' as const, emailVerifiedAt: null },
  ]) {
    assert.equal(sessionPrincipal(record({ user }), now, policy), null);
  }
  assert.equal(sessionPrincipal(record({ userId: null }), now, policy), null);
  assert.ok(
    sessionPrincipal(
      record({ user: { ...base.user, kind: 'CUSTOMER', emailVerifiedAt: now } }),
      now,
      policy,
    ),
  );
  // Owner bootstrap does not pretend the recovery email has been verified.
  assert.ok(sessionPrincipal(record({ user: { ...base.user, kind: 'OWNER' } }), now, policy));
});

test('only a live session that ended through a permission change reports AUTHORIZATION_CHANGED', () => {
  const base = record();
  assert.ok(base.user);
  const changed = record({ revokedAt: now, user: { ...base.user, authzVersion: 6 } });
  assert.equal(sessionPrincipal(changed, now, policy), null);
  assert.equal(authorizationChanged(changed, now, policy), true);
  // Not a permission change: unknown token, healthy session, anonymous, or any other reason it ended.
  for (const other of [
    null,
    record(),
    record({ revokedAt: now }),
    record({
      kind: 'ANONYMOUS',
      userId: null,
      credentialVersion: null,
      authzVersion: null,
      user: null,
    }),
    record({ user: { ...base.user, authzVersion: 6 }, absoluteExpiresAt: now }),
    record({
      user: { ...base.user, authzVersion: 6 },
      lastActivityAt: new Date(now.getTime() - 1_800_000),
    }),
    record({ user: { ...base.user, authzVersion: 6, credentialVersion: 4 } }),
    record({ user: { ...base.user, authzVersion: 6, status: 'INACTIVE' } }),
    record({ user: { ...base.user, authzVersion: 6 }, csrfKeyVersion: 2 }),
  ]) {
    assert.equal(authorizationChanged(other, now, policy), false);
  }
});

test('only a signed-in session that no longer resolves counts as ended', () => {
  const base = record();
  assert.ok(base.user);
  for (const gone of [
    record({ revokedAt: now }),
    record({ absoluteExpiresAt: now }),
    record({ lastActivityAt: new Date(now.getTime() - 1_800_000) }),
    record({ user: { ...base.user, authzVersion: 6 } }),
  ]) {
    assert.equal(endedAuthenticatedSession(gone, now, policy), true);
  }
  const anonymous = record({
    kind: 'ANONYMOUS',
    userId: null,
    credentialVersion: null,
    authzVersion: null,
    user: null,
    revokedAt: now,
  });
  for (const live of [null, record(), anonymous]) {
    assert.equal(endedAuthenticatedSession(live, now, policy), false);
  }
});

test('anonymous sessions carry no identity and expire absolutely without idle refresh', () => {
  const anonymous = record({
    kind: 'ANONYMOUS',
    userId: null,
    user: null,
    credentialVersion: null,
    authzVersion: null,
    createdAt: new Date(now.getTime() - 899_999),
    lastActivityAt: new Date(now.getTime() - 899_999),
    absoluteExpiresAt: new Date(now.getTime() + 1),
  });
  assert.ok(sessionPrincipal(anonymous, now, policy));
  assert.equal(sessionPrincipal(anonymous, new Date(now.getTime() + 1), policy), null);
  for (const invalid of [
    { userId: 'not-anonymous' },
    { credentialVersion: 1 },
    { authzVersion: 1 },
    { reauthenticatedAt: now },
  ]) {
    assert.equal(sessionPrincipal({ ...anonymous, ...invalid }, now, policy), null);
  }
});

test('fresh password reauthentication requires authenticated authority and bounded time', () => {
  const fresh = sessionPrincipal(record({ reauthenticatedAt: now }), now, policy);
  assert.ok(fresh);
  assert.equal(hasFreshReauthentication(fresh, now, 300), true);
  assert.equal(hasFreshReauthentication(fresh, new Date(now.getTime() + 300_000), 300), false);
  assert.equal(hasFreshReauthentication(fresh, new Date(now.getTime() - 1), 300), false);
  assert.equal(hasFreshReauthentication({ ...fresh, reauthenticatedAt: null }, now, 300), false);
  assert.equal(hasFreshReauthentication({ ...fresh, kind: 'ANONYMOUS' }, now, 300), false);
});
