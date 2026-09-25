import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { isUserActivity } from './session-activity.js';
import {
  activityWriteDue,
  activityWriteIntervalSeconds,
  sessionPrincipal,
  type SessionPolicy,
  type SessionRecord,
} from './session.policy.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const policy: SessionPolicy = { idleTtlSeconds: 3_600, csrfKeys: new Map([[1, randomBytes(32)]]) };
const login = new Date('2026-09-25T09:00:00.000Z');

function record(lastActivityAt: Date, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: randomUUID(),
    kind: 'AUTHENTICATED',
    userId: randomUUID(),
    credentialVersion: 1,
    authzVersion: 1,
    csrfKeyVersion: 1,
    createdAt: login,
    lastActivityAt,
    absoluteExpiresAt: new Date(login.getTime() + 12 * HOUR),
    revokedAt: null,
    reauthenticatedAt: null,
    user: {
      kind: 'OWNER',
      status: 'ACTIVE',
      passwordHash: '$argon2id$fixture',
      emailVerifiedAt: null,
      credentialVersion: 1,
      authzVersion: 1,
    },
    ...overrides,
  };
}

/**
 * Simulates a session over time. Each request is resolved first (the guard/frame check),
 * then genuine activity applies the same write rule as `SessionService.recordActivity`.
 * Returns the time of the first rejected request, or null if none was rejected.
 */
function simulate(
  requests: { at: number; genuine: boolean }[],
  sessionPolicy: SessionPolicy = policy,
): { rejectedAt: number | null; writes: number; row: SessionRecord } {
  const row = record(login);
  let writes = 0;
  for (const { at, genuine } of requests) {
    const now = new Date(login.getTime() + at);
    const principal = sessionPrincipal(row, now, sessionPolicy);
    if (principal === null) return { rejectedAt: at, writes, row };
    if (genuine && activityWriteDue(principal, now, sessionPolicy)) {
      row.lastActivityAt = now;
      writes += 1;
    }
  }
  return { rejectedAt: null, writes, row };
}

const every = (stepMs: number, untilMs: number, genuine = true) =>
  Array.from({ length: Math.floor(untilMs / stepMs) }, (_, i) => ({
    at: (i + 1) * stepMs,
    genuine,
  }));

test('genuine activity advances the idle deadline', () => {
  const lastActivity = new Date(login.getTime() + 30 * MINUTE);
  const now = new Date(login.getTime() + 50 * MINUTE);
  const principal = sessionPrincipal(record(lastActivity), now, policy)!;
  assert.equal(activityWriteDue(principal, now, policy), true);
  // After the write the idle deadline is now + 60 min instead of lastActivity + 60 min.
  assert.ok(sessionPrincipal(record(now), new Date(now.getTime() + 59 * MINUTE), policy));
  assert.equal(
    sessionPrincipal(record(lastActivity), new Date(now.getTime() + 59 * MINUTE), policy),
    null,
  );
});

test('an active user is not logged out just because 60 minutes passed since login', () => {
  // Logged in 09:00, working every 5 minutes until 15:00.
  const result = simulate(every(5 * MINUTE, 6 * HOUR));
  assert.equal(result.rejectedAt, null);
  assert.ok(result.row.lastActivityAt.getTime() > login.getTime() + 5 * HOUR);
});

test('60 minutes without genuine activity still expires the session', () => {
  // Last genuine activity at 14:20; the session expires at 15:20.
  const lastActivity = new Date('2026-09-25T14:20:00.000Z');
  assert.ok(sessionPrincipal(record(lastActivity), new Date('2026-09-25T15:19:59.000Z'), policy));
  assert.equal(
    sessionPrincipal(record(lastActivity), new Date('2026-09-25T15:20:00.000Z'), policy),
    null,
  );
});

test('the 12-hour absolute expiry is never extended by activity', () => {
  const result = simulate(every(MINUTE, 13 * HOUR));
  assert.equal(result.rejectedAt, 12 * HOUR, 'rejected exactly at the absolute expiry');
  assert.equal(result.row.absoluteExpiresAt.getTime(), login.getTime() + 12 * HOUR);
  const late = new Date(login.getTime() + 12 * HOUR);
  const principal = sessionPrincipal(record(new Date(late.getTime() - 30_000)), late, policy);
  assert.equal(principal, null);
  const justBefore = new Date(late.getTime() - 1);
  const valid = sessionPrincipal(
    record(new Date(justBefore.getTime() - 2 * MINUTE)),
    justBefore,
    policy,
  )!;
  assert.equal(
    activityWriteDue({ ...valid, absoluteExpiresAt: justBefore }, justBefore, policy),
    false,
  );
});

test('polling and background requests cannot keep a session alive', () => {
  // One genuine request at 09:10, then passive polling every minute.
  const requests = [{ at: 10 * MINUTE, genuine: true }, ...every(MINUTE, 4 * HOUR, false)];
  const result = simulate(requests.sort((a, b) => a.at - b.at));
  assert.equal(
    result.rejectedAt,
    70 * MINUTE,
    'expires 60 minutes after the last genuine activity',
  );
  // The server never classifies these as activity.
  assert.equal(isUserActivity('GET', '/api/v1/leave-requests/me', undefined), false);
  assert.equal(isUserActivity('GET', '/api/v1/auth/me', 'user'), false);
  assert.equal(isUserActivity('GET', '/api/v1/auth/context', 'user'), false);
  assert.equal(isUserActivity('GET', '/health/ready', 'user'), false);
  assert.equal(isUserActivity('HEAD', '/api/v1/services', 'user'), false);
});

test('coalesced writes never expire an active user', () => {
  // Requests every 59 s (just under the write interval) for 5 hours.
  const result = simulate(every(59_000, 5 * HOUR));
  assert.equal(result.rejectedAt, null);
  assert.ok(result.writes < (5 * HOUR) / 59_000, 'writes are coalesced');
  assert.ok(result.writes >= (5 * HOUR) / (2 * MINUTE) - 1, 'but still roughly once a minute');
  // Short idle configurations shrink the interval to a tenth of the idle timeout.
  const short: SessionPolicy = { ...policy, idleTtlSeconds: 120 };
  assert.equal(activityWriteIntervalSeconds(short), 12);
  assert.equal(simulate(every(11_000, HOUR), short).rejectedAt, null);
  assert.equal(activityWriteIntervalSeconds(policy), 60);
});

test('genuine activity classification', () => {
  assert.equal(isUserActivity('POST', '/api/v1/services', undefined), true, 'commands');
  assert.equal(isUserActivity('POST', '/api/v1/attendance/check-in', undefined), true);
  assert.equal(isUserActivity('GET', '/api/v1/services', 'user'), true, 'marked user loads');
  assert.equal(isUserActivity('GET', '/api/v1/services', 'background'), false);
  assert.equal(isUserActivity('GET', '/api/v1/services', ['user']), false);
  assert.equal(isUserActivity('POST', '/vi/workforce', undefined), false, 'not the API');
});
