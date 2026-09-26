# Pre-Phase-3 follow-up Step 5: verified self-service email change

**Status:** implemented and tested locally. One focused commit, pushed to `origin/main`.
**Not deployed.** Production is at `73cf6ad` (follow-up Step 4, deployed and accepted).
This step includes **2 small additive migrations**.

## What was implemented

"Đổi email / Change email" under My Account → Tài khoản & bảo mật, for the signed-in Owner,
managers, employees, collaborators and trainees.

**Rule:** the current email stays authoritative until the new address is verified with a
code sent to that new address.

## Challenge model (reuses the existing OTP infrastructure)

- **Purpose:** a new `AuthChallengePurpose` value, `CHANGE_EMAIL`, in the existing
  `auth_challenges` table. There is no second challenge system and no new table or column.
- **Where the proposed address lives:** only in the challenge's
  `delivery_email_snapshot`. It is never written to `users` before verification.
- **Issuing and rotating:** the existing `issueUserChallenge` / `rotateUserChallenge`.
  - The OTP is an HMAC over a binding of purpose, challenge ID, generation, user ID, the
    **proposed email's canonical form** and the credential version.
  - So a code only works for this user, this address and this credential.
  - The code is stored as a digest, never in clear.
  - The email payload is encrypted in `auth_deliveries` until sent (existing mechanism).
- **Lifetimes:** a 15-minute flow, with codes valid 5 minutes within it (the recovery-email
  values).
- **Attempts:** at most 5 per code flow; the 5th wrong code invalidates the flow.
- **Identity failure budget:** 10 per 15 minutes per proposed address (existing
  `OTP_VERIFY_FAILURE_IDENTITY`).
- **One live flow per user:** a new request supersedes the user's older flows.
- **Reservation:** another account's live flow for the same address reserves it, and the
  request gets 409 `email`. Expired flows of others are superseded.
- **Resend:** `POST /me/email/resend` rotates the code, creating a new generation. The old
  code dies and the flow deadline is unchanged. The existing 60-second cooldown and the
  5-per-hour / 10-per-day email budgets apply to the new address.

## Migrations

These are additive and do not edit historical migrations. `prisma migrate diff` is empty
after applying them locally.

| Migration                                          | Change                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `20261003000000_auth_challenge_change_email`       | `ALTER TYPE "AuthChallengePurpose" ADD VALUE 'CHANGE_EMAIL'`. It is a separate file so the value is committed before use. |
| `20261003000001_auth_challenge_change_email_guard` | `CREATE OR REPLACE FUNCTION lucy_guard_auth_challenge()` (see below).                                                     |

The guard function stays **identical** for every existing purpose. For `CHANGE_EMAIL` it
requires:

- a non-customer principal;
- a delivery address **different** from the stored one.

Without this change, the Phase 1 guard would reject a challenge that targets any address
other than the stored one. The integration test proves the database still refuses a
customer's `CHANGE_EMAIL` challenge and one aimed at the unchanged address.

**Backward compatible with `73cf6ad`.** The old code never creates or reads `CHANGE_EMAIL`,
and existing purposes behave exactly as before.

## Endpoints

These live in `apps/api/src/account/my-account.controller.ts` (`MyEmailController`) and
`email-change.service.ts`. All are POST.

| Endpoint                   | Body                            | Success                      |
| -------------------------- | ------------------------------- | ---------------------------- |
| `/api/v1/me/email/request` | `{ currentPassword, newEmail }` | 202 `AcceptedFlowResponse`   |
| `/api/v1/me/email/resend`  | `{ flowToken }`                 | 204                          |
| `/api/v1/me/email/verify`  | `{ flowToken, otp }`            | 204 + rotated session cookie |

Verify follows the existing recovery-email architecture: flow capability plus a six-digit
code. The DTOs are strict: `userId`, `employeeId`, `employeeCode`, `email` and unknown
fields are rejected with 400. Identity comes only from the session cookie.

### Request

1. The new email is normalized with the existing `normalizeEmail`. Invalid → 400 `newEmail`.
2. The **current password** is proven through `LoginService.proveCurrentPassword`. This was
   extracted from Step 4 and is now shared by change password and change email.
   - It uses the same verifier and the reauthentication budgets: 10 per user and 100 per IP
     per 15 minutes.
   - Wrong → 401 `AUTHENTICATION_FAILED`, with **no challenge and no email**.
   - Customers → 403. Anonymous → 401.
3. In one transaction, it:
   - debits the IP issuance budget;
   - re-checks that the session and the proven credential are unchanged;
   - refuses an unchanged address (400 `newEmailUnchanged`), a taken one (any user,
     including customers) or a reserved one (409 `email`, generic);
   - applies the address cooldown and budgets (429);
   - supersedes older flows and issues the flow;
   - queues the code **to the new address only**.
4. `users.email_*` is not touched. An `EMAIL_CHANGE_REQUESTED` audit is written.

### Verify

In one transaction, it:

1. debits the IP verification budget;
2. requires a workforce session;
3. locates the flow by capability. It must be `CHANGE_EMAIL` and belong to **this** user;
   another user's flow is reported as unknown (400 `VERIFICATION_FAILED`);
4. locks the identity, then the flow; checks it is live (deadline, attempts, credential
   version, address still different);
5. checks the code and its 5-minute deadline. A wrong or expired code debits the attempts
   and the identity budget, and the debit is committed. Wrong, expired, used and superseded
   codes all get the same 400;
6. re-checks availability. If the address was taken meanwhile, the flow ends with 409
   `email` and nothing changes;
7. consumes the flow. `users.email_canonical` and `email_delivery` become the new address,
   `email_verified_at = now` and `row_version + 1`. This is guarded on the unchanged old
   address and credential version;
8. retires every remaining `RESET_PASSWORD`, `VERIFY_RECOVERY_EMAIL` and `CHANGE_EMAIL`
   flow of the user, since they are bound to the old address;
9. revokes **every** session and issues one replacement session for this device;
10. writes the `EMAIL_CHANGED` and `SESSIONS_REVOKED` audits.

## Authoritative email semantics

- **Before verification:** the stored email is unchanged and remains:
  - the Owner's sign-in email;
  - a verified employee's email sign-in;
  - the recovery address;
  - what employee detail shows.
- **After verification:** there is exactly one email, the new one, and it is verified.
  - The old address is gone from the account. It no longer receives forgot-password codes
    (tested: requesting a reset for it issues nothing) and cannot sign in.
  - Pending flows bound to the old address are void.
- **Single source of truth:** the only email is `users.email_*`, with no My Account copy and
  no sync. My Account (`GET /me/account`) and employee detail (`GET /employees/:id`) show
  the same new, verified email immediately (tested).
- **Management cannot bypass the flow.** The employee-management API has no command that
  changes an existing email: the profile command excludes it, and the Owner is never an
  employee-administration target. This is unchanged.

## Owner and employee-code behavior

- **Owner:** keeps `kind = OWNER` with no employee profile (tested).
  - After a change, the **new** verified email signs in as the Owner and the old one fails
    (tested).
  - Forgot password goes to the new address.
- **Employees, managers, CTV and trainees:** the employee code / login ID is **unchanged**
  and still signs in (tested).
  - The existing rule "a verified employee may also sign in by email" now follows the new
    address; the old address fails.
  - No login identifier was added or broadened.

## Session behavior

After a successful verification, all other sessions and the pre-change token are revoked,
and **this device continues on a new session**. The Step 4 primitive
`SessionService.continueAfterCredentialChange` was generalized with a `reason`
(`PASSWORD_CHANGED` | `EMAIL_CHANGED`).

The credential version is **not** bumped, because the password did not change. The other
sessions are revoked explicitly instead, and no session check was weakened.

## Rate limiting and abuse

| What                     | Limit                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Current-password guesses | Reauthentication budgets: 10 per user and 100 per IP per 15 minutes; 429 once exhausted |
| Requests and resends     | Per-IP issuance budget; per-address 60-second cooldown and 5/hour, 10/day               |
| Code guesses             | 5 per flow; 10 identity failures per 15 minutes per address; 100 per IP per 15 minutes  |

Availability is only revealed after the password is proven and within these budgets. The
409 never says which account holds the address.

## Audit

| Event                    | Payload                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_CHANGE_REQUESTED` | `after: { method: 'SELF_SERVICE', emailVerified: false }`                                                                  |
| `EMAIL_CHANGED`          | `before: { emailPresent, emailVerified }`, `after: { method: 'SELF_SERVICE_EMAIL_OTP', emailVerified: true, challengeId }` |
| `SESSIONS_REVOKED`       | `after: { reason: 'EMAIL_CHANGED', revokedSessions }`                                                                      |
| `SESSION_CREATED`        | For the replacement session, with `reason: EMAIL_CHANGED`                                                                  |

Every event records the user as actor and subject, the request ID and the time.

Audit never contains:

- email addresses (privacy convention: no values in generic payloads);
- the password or a password hash;
- the code or challenge secrets.

The test scans every audit payload and the challenge rows for these.

## Email delivery

This uses the existing delivery pipeline (`enqueueAuthEmail` → worker → current provider)
with no new provider. `packages/server/src/auth-email.ts` gains a `CHANGE_EMAIL` template in
VI and EN:

- **VI subject:** "Lucy Spa – Mã xác minh đổi email tài khoản".
- **EN subject:** "Lucy Spa – Confirm your new account email".
- **Content:** the code is for changing the Lucy Spa account's sign-in/recovery email; if
  not requested, ignore it and the account email will not change.
- It contains no password or account details, follows the existing HTML/plain-text layout,
  and does not echo the recipient.

**The worker must be restarted** with the new code to send this purpose.

## My Account UI

- **Account & Security**
  - It shows the current email and its verified/unverified badge.
  - The static "Email không đổi được ở đây." is replaced by a **Đổi email / Change email**
    disclosure.
- **Step 1 of the flow:** Mật khẩu hiện tại (a password field) and Email mới, then
  [Gửi mã xác minh].
  - The browser checks that the password is present, the email is shaped like an address
    and differs from the current one.
  - The password is cleared after every request.
- **Step 2 of the flow:** "A code was sent to {new email}", then Mã xác minh with
  [Xác minh email], [Gửi lại mã] and [Hủy].
- **After success:** it confirms the new verified email and that other devices were signed
  out while this one stays signed in, refreshes the CSRF token and reloads My Account. The
  new email then shows as verified.
- **States:** a pending label with repeat submits ignored, safe messages (wrong password,
  invalid/same/unavailable email, wrong/expired code, rate limit), and VI/EN labels.
- **One email area:** the separate "Email khôi phục" card now appears in My Account **only
  while the stored email is unverified**, where it still offers the existing "verify this
  address" proof. When the email is verified, it was a duplicate of Account & Security and
  is no longer shown.
- **Dashboard:** its recovery-email entry is **unchanged**. This is a temporary duplicate
  entry point to the same single feature, left for the later UX cleanup.

## Tests and checks

| Check                                                                                              | Result                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| New `account/email-change.integration.test.ts` (A–V plus the DB guard)                             | 6/6 subtests pass                        |
| New `account/my-email.http.test.ts` (CSRF/Origin, strict DTOs, 202/204, cookie rotation, refusals) | pass                                     |
| API auth/workforce integration (all suites, including reset, recovery, change password)            | 188/188 pass                             |
| API unit + HTTP                                                                                    | 89 pass, 0 fail (27 integration skipped) |
| Database integration                                                                               | 31/31 pass                               |
| `@lucy-spa/server` (templates, including `CHANGE_EMAIL` VI/EN)                                     | 19/19 pass                               |
| Worker                                                                                             | 3/3 pass                                 |
| Web, including change-email form and API tests                                                     | 99/99 pass                               |
| `pnpm lint` (ESLint + boundaries), `pnpm format:check`, `tsc --noEmit` (api, web)                  | pass                                     |

The integration subtests map to the required cases:

- **A–E:** request behavior; wrong password sends nothing; invalid, same, taken (employee or
  customer) and reserved addresses are refused.
- **F–G, J, L, N, O, R–S:** success, wrong code, reuse, another user's flow; employee code
  unchanged; My Account equals employee detail; other sessions revoked and this one alive.
- **H–I, K:** attempt limit; expiry, tested with a test-only shifted clock; supersede and
  resend generations.
- **M:** anonymous, invalid-session and customer callers are refused.
- **P–Q, T–U:** Owner without a profile; old email fails and new succeeds; forgot password
  to the new address only; change password still works.
- **V:** no password, code, hash or address in audit or challenges.

`pnpm typecheck` was not run, because it regenerates `apps/web/next-env.d.ts`. The file's
hash was confirmed unchanged (`a419cbe…`).

## Explicit deferrals

These are NOT implemented:

- a management "set email when absent or unverified" command (design section 9); management
  still cannot change an email;
- masking the email in the UI (the full address is shown, as before);
- persisting a pending change across page reloads (the flow token lives in the page; start
  again after a reload);
- removing the dashboard's recovery-email entry;
- collaborator schedule and agreed pay (Step 6);
- My Income (Step 7);
- the UX/UI redesign, which stays deferred until the Phase 3 core is complete;
- Phase 3 booking, which is NOT STARTED.

## Production deployment (not performed; requires Owner authorization)

1. Take a database backup.
2. `git pull` (`73cf6ad..<Step 5 commit>`), then `pnpm install --frozen-lockfile`.
3. `pnpm db:deploy`. Two new migrations are expected:
   - `20261003000000_auth_challenge_change_email`;
   - `20261003000001_auth_challenge_change_email_guard`.
     The running `73cf6ad` stays compatible until the restart.
4. `pnpm build`, then restart **all three** PM2 processes: `lucyspa-api`, `lucyspa-web` and
   `lucyspa-worker`. The worker must know the `CHANGE_EMAIL` template.
5. Smoke checks:
   - Sign in on two browsers.
   - On the first, open My Account → Đổi email; the current password plus a new address
     sends a code to the new inbox only.
   - Verify: the first browser stays signed in, the second is signed out, and My Account and
     employee detail show the new verified email.
   - For the Owner, sign-in works with the new email and fails with the old one.
   - Forgot password sends to the new address.

## Next step

Step 6 is **collaborator work schedule and agreed pay**:

- migrations M2 and M4, plus a permission sync;
- the schedule and occurrence APIs;
- the schedule UI and audit;
- Owner decisions Q6–Q8, Q12 and Q14.
