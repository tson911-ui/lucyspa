# Pre-Phase-3 follow-up Step 4: self-service change password

**Status:** implemented and tested locally. One focused commit, pushed to `origin/main`.
**Not deployed.** Production is at `1a49e72` (follow-up Step 3, deployed and accepted).
**No migration.**

## What was implemented

"Đổi mật khẩu / Change password" for a signed-in workforce user who **knows** their current
password. It lives under My Account → Tài khoản & bảo mật / Account & Security.

This is not forgot password. The forgot/reset-password flow is unchanged, and the test
proves it still works end to end after a self-change.

## Endpoint and request contract

`POST /api/v1/me/password` → **204**, with a rotated session cookie. The client then
refetches `GET /api/v1/auth/context` for the new CSRF token, exactly as after
reauthentication.

```ts
interface SelfPasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}
```

- **Controller:** `MyPasswordController` in `apps/api/src/account/my-account.controller.ts`.
- **Service:** `LoginService.changePassword` in `apps/api/src/auth/login.service.ts`.
- **Strict DTO** (`whitelist` + `forbidNonWhitelisted`). The HTTP test proves each of these
  is rejected with 400 before reaching the service:
  - `userId`, `employeeId`, `employeeCode`, `id`;
  - a `confirmNewPassword` field;
  - wrong types.
- **Identity** comes from the session cookie only.
- **Confirmation** ("Xác nhận mật khẩu mới") is checked in the browser for usability and is
  never sent. The server's authority is the current-password proof plus the policy.

Responses:

| Case                                              | Response                                                      |
| ------------------------------------------------- | ------------------------------------------------------------- |
| Success                                           | 204 + new session cookie                                      |
| Wrong current password                            | 401 `AUTHENTICATION_FAILED`, generic; the session stays valid |
| New password fails the policy                     | 400 `VALIDATION_FAILED` `newPassword`                         |
| New password equals the current one (after proof) | 400 `VALIDATION_FAILED` `newPasswordUnchanged`                |
| Anonymous or invalid session                      | 401 `AUTHENTICATION_REQUIRED`                                 |
| Customer session                                  | 403 `FORBIDDEN`                                               |
| Budget exhausted                                  | 429 `RATE_LIMITED` + `Retry-After`                            |
| Missing or incorrect CSRF token or Origin         | 403, before the service                                       |

## Current-password verification

- The current password is verified against the user's **current** stored credential, using
  the existing `LoginService.verifyPassword` → `PasswordService.verifyAndRehash` path (the
  same code as login and reauthentication).
- There is no second hashing or verification implementation.
- The session alone is never sufficient.
- The final write is guarded on the verified hash and credential version. A concurrent reset
  or change fails closed with `AUTHENTICATION_REQUIRED`.

## Password policy and hash reuse

- **New password:** checked by `validatePasswordForSetting`, the existing workforce/setting
  policy:
  - NFC normalization and lone-surrogate rejection;
  - 15–128 code points;
  - the local common-password blocklist.
- **Hashing:** `PasswordService.hashForSetting`, i.e. Argon2id with the existing parameters
  and a fresh salt.
- **"Same as current":** compared on the normalized values, and only **after** the current
  password is proven, so it can never be used as a password oracle.
- No plaintext is stored or logged anywhere.

## Credential update (one transaction)

1. Lock the user and the current session. This is the existing `resolveForMutation` lock
   order.
2. Replace `password_hash` and set `credential_version = credential_version + 1`, the same
   semantics as a password reset or a manager reset.
3. Retire every outstanding `RESET_PASSWORD`, `EMPLOYEE_SETUP` and `VERIFY_RECOVERY_EMAIL`
   challenge and its pending deliveries, using the existing `invalidateChallenges`. This is
   the same set a completed reset retires.
4. Revoke **every** session of the user, the current one included.
5. Issue **one** replacement session for this device (next section).
6. Write the audit events.

## Session behavior after success

Sessions pin `credentialVersion`, so the bump invalidates every existing session, including
the one making the change. To keep the current device signed in without weakening that
protection, a small new primitive was added: `SessionService.continueAfterCredentialChange`.

It runs inside the same transaction, after the credential change and the revocation. It:

- issues a **new** session token (never the old one), at the **new** credential version;
- keeps the original absolute expiry, so the lifetime is not extended;
- sets `reauthenticatedAt = now`, because the password was just proven;
- is audited as `SESSION_CREATED` with `reason: PASSWORD_CHANGED`.

The result:

- the pre-change token and every other browser or device session are invalid;
- only the replacement session is alive, and it can read and write immediately (tested).

`credentialVersion` checking is unchanged everywhere, and nothing was loosened globally.

## Rate limiting

This reuses the **reauthentication failure budgets** of `LoginService` (the existing
`AuthThrottleService` windows):

- 10 failures per user per 15 minutes (`REAUTH_FAILURE_USER`);
- 100 failures per IP per 15 minutes (`LOGIN_FAILURE_IP`).

A wrong current password debits both. Once a budget is exhausted, even the correct password
is refused with 429 and no password work is done. The limit reveals nothing about the
credential. The budget is shared with reauthentication on purpose: both are "prove your
current password while signed in".

## CSRF, Origin and authorization

- The global `CsrfGuard` enforces JSON, the exact Origin and the session-bound CSRF token;
  all three refusals are tested.
- The secure cookie attributes are those of the existing `setSessionCookie`.
- Only an `AUTHENTICATED` session of an Owner or employee is accepted:
  - inactive and pending accounts already have no valid session;
  - customers get `FORBIDDEN`.

## Audit

Each successful change writes:

- **`PASSWORD_CHANGED`**
  - actor = subject = the user, `actorKind: USER`;
  - `before: { credentialVersion }`, `after: { credentialVersion, method: 'SELF_SERVICE' }`;
  - plus the request ID and time.
- **`SESSIONS_REVOKED`**, written only when other sessions existed:
  `after: { reason: 'PASSWORD_CHANGED', revokedSessions: <other sessions> }`.
- **`SESSION_CREATED`** for the replacement session.

No current password, new password or hash appears anywhere. The test scans every audit
payload of the fixtures for the plaintext values and for `$argon2`.

Failed attempts are represented, as for reauthentication, by the throttle buckets (keyed
digests only). No extra sensitive logging was added.

## Owner and workforce behavior

- The **Owner** (`User.kind = OWNER`, no `EmployeeProfile`) can change their own password.
  Afterwards they sign in by email with the new password; the old one fails. No profile is
  created.
- **Managers** (with a manager-group role), **employees**, **collaborators** and
  **trainees** can each change their own password (all tested) whenever their existing
  account state permits a session.
- Nothing about login identifiers, employee codes, classifications, roles, branches, skills,
  recovery email or customer authentication changed.

## UI

The form is a collapsible "Đổi mật khẩu" disclosure inside **Tài khoản & bảo mật**, for both
the Owner and employees. It has three `type="password"` fields:

- current, with `autocomplete="current-password"`;
- new and confirm, with `autocomplete="new-password"`.

Behavior:

- The hint states the policy.
- The browser checks that the current password is present, the new one has 15–128
  characters, the confirmation matches, and the new one differs from the current one.
- The submit button shows the pending label and ignores repeat submits.
- On success, the page confirms that other devices were signed out and this one stays
  signed in, clears **all** fields and refreshes the CSRF token.
- On a refusal, the current-password field is cleared and a safe message is shown: wrong
  current password, policy, same password, or rate limit.
- Passwords live only in component state and are never persisted.

All labels are translated (VI/EN), including Mật khẩu hiện tại / Mật khẩu mới / Xác nhận mật
khẩu mới.

## Tests and checks

| Check                                                                                          | Result                                   |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| New `account/my-password.integration.test.ts`                                                  | 9/9 subtests pass                        |
| New `account/my-password.http.test.ts`                                                         | pass                                     |
| API auth/workforce integration (`pnpm test:auth:integration`, all suites incl. reset/recovery) | 181/181 pass                             |
| API unit + HTTP                                                                                | 88 pass, 0 fail (26 integration skipped) |
| Web (`apps/web` `pnpm test`), incl. new change-password tests                                  | 97/97 pass                               |
| `pnpm lint` (ESLint + boundaries), `pnpm format:check`                                         | pass                                     |
| `tsc --noEmit` for `apps/api` and `apps/web`                                                   | pass                                     |

Coverage of the required cases:

| Case | What is tested                                                                                   | Where                                                 |
| ---- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| A    | Correct current password and a valid new one succeed                                             | integration                                           |
| B    | A wrong current password is refused and nothing changes                                          | integration                                           |
| C    | Short, blocklisted and too-long new passwords are refused                                        | integration                                           |
| D    | The same password is refused; with a wrong current password the answer stays generic (no oracle) | integration                                           |
| E    | A confirmation mismatch is caught in the browser and never sent                                  | web; the DTO also rejects a confirmation field (HTTP) |
| F    | Anonymous and invalid sessions are refused                                                       | integration                                           |
| G    | A customer session is refused                                                                    | integration                                           |
| H    | A's change leaves B's credential and sessions untouched, and no ID is accepted                   | integration, HTTP                                     |
| I–J  | The old password fails at login; the new one succeeds                                            | integration                                           |
| K    | Every other session and the pre-change token are revoked                                         | integration                                           |
| L    | The replacement session reads and writes                                                         | integration                                           |
| M    | A reset issued before the change is retired; a new forgot-password flow completes end to end     | integration                                           |
| N    | The Owner can change their password without an employee profile                                  | integration                                           |
| O    | A manager, employee, collaborator and trainee can each change theirs                             | integration                                           |
| P    | Audit payloads never contain a password or hash                                                  | integration                                           |

Other refusals:

- **Rate limiting:** after 10 wrong guesses the correct password gets 429 (integration),
  with a `Retry-After` header (HTTP).
- **CSRF and Origin** refusals are covered by the HTTP test.

`pnpm typecheck` was not run, because its web step regenerates `apps/web/next-env.d.ts`.
Targeted `tsc --noEmit` was used instead, and the file's hash was confirmed unchanged
(`a419cbe…`).

## Database and migration status

No migration and no schema change. It uses the existing `users.password_hash` and
`credential_version`, the `sessions` table, `auth_challenges`, `audit_events` and
`auth_throttle_buckets`.

## Explicit deferrals

These are NOT implemented:

- verified email change (Step 5);
- collaborator work schedule and agreed pay (Step 6);
- My Income (Step 7);
- a "sign out other devices" button separate from a password change;
- the UX/UI redesign, which stays deferred until the Phase 3 core is complete;
- Phase 3 booking, which is NOT STARTED.

## Production deployment (not performed; requires Owner authorization)

There is **no migration**.

1. Take a routine database backup.
2. `git pull` (`1a49e72..<Step 4 commit>`), then `pnpm install --frozen-lockfile`.
3. `pnpm build`, then restart `lucyspa-api`, `lucyspa-web` and `lucyspa-worker` in PM2.
4. Smoke checks:
   - Sign in on two browsers.
   - On the first, change the password in My Account → Tài khoản & bảo mật.
   - The first browser stays signed in; the second is signed out on its next request.
   - Sign-in with the old password fails; the new one works.
   - Forgot password still issues a code.

## Next step

Step 5 is **verified email change**:

- migration M3 adds `CHANGE_EMAIL` to the challenge purposes;
- `/api/v1/me/email/request|verify` with a code sent to the new address;
- the management email rule;
- presented in My Account → Account & Security.
