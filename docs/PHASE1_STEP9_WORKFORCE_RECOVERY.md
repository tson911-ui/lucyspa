# Phase 1 Step 9: workforce recovery

Status: **implemented and validated locally; awaiting review**. No staging, commit,
push or Step 10 work. Baseline is Step 8 commit `2f49625`.

This implements the approved [authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md)
for:

- workforce password recovery (section 6, "Forgot password and workforce recovery
  email");
- recovery-email verification (section 6, and the section 10
  `/auth/recovery-email/*` contracts);
- the Owner protections that apply to them (section 8).

It extends the Step 6 password-reset implementation and reuses:

- the Step 3 session and fresh-reauthentication primitives;
- the Step 4/6 challenge, OTP, delivery, throttle and resend infrastructure;
- the Step 8 `/auth/reauthenticate` endpoint as the fresh password proof.

**No Prisma schema, migration or database privilege change was needed.** The
`VERIFY_RECOVERY_EMAIL` purpose and its Step 2 trigger rules already existed:
customers are refused, and the delivery target must equal the stored address.
`apps/web/next-env.d.ts` is untouched. **No real Owner was created**: every Owner
created in tests was rolled back.

## Workforce password recovery

`POST /auth/password-reset/request` now accepts `realm: 'CUSTOMER' | 'WORKFORCE'`.
The complete and shared resend routes are unchanged.

A code is issued only for an ACTIVE User **of the requested realm** that has a
password and a **verified** email:

| Realm       | Eligible kinds    |
| ----------- | ----------------- |
| `CUSTOMER`  | CUSTOMER          |
| `WORKFORCE` | OWNER or EMPLOYEE |

Everything else gets the identical 202 with an unstored random token and no email.
That includes:

- unknown addresses and the other realm;
- PENDING_SETUP and INACTIVE employees;
- an unverified Owner or employee email.

Reset therefore never activates pending setup, never reactivates employment, and
never crosses realms. Principal kind is immutable in SQL, so a flow issued in one
realm cannot later serve another.

Completion, audit, session revocation and budgets are exactly Step 6's. One addition:
on success, any actionable `VERIFY_RECOVERY_EMAIL` flow of the User is invalidated,
together with the existing `RESET_PASSWORD`/`EMPLOYEE_SETUP` flows. That proof is bound
to the replaced credential version. Customers never have such flows, so customer
behavior is unchanged.

## Recovery-email verification

| Route                               | Input                | Result                                                     |
| ----------------------------------- | -------------------- | ---------------------------------------------------------- |
| `POST /auth/recovery-email/request` | `{}`                 | 202 AcceptedFlow                                           |
| `POST /auth/recovery-email/verify`  | `{ flowToken, otp }` | 204; the stored email is marked verified. No cookie change |

Both routes keep the Step 3 JSON, exact-Origin and session-bound CSRF protection. The
User is always the session's User; no body field names a User, address or flag.

**Request:**

- It requires an authenticated OWNER or EMPLOYEE session reauthenticated within
  `AUTH_FRESH_AUTH_SECONDS`, which defaults to 5 minutes (`POST /auth/reauthenticate`).
- Errors:
  - 401 `AUTHENTICATION_REQUIRED` for no session or an anonymous session;
  - 403 `REQUEST_NOT_ALLOWED` for a customer;
  - 403 `REAUTHENTICATION_REQUIRED` when the password proof is missing or stale. This
    is a new allowlisted error code.
- When the stored email exists and is still unverified, a 15-minute flow is issued with
  a 5-minute code. It is bound to:
  - the User;
  - the stored canonical email;
  - the stored `emailDelivery` snapshot;
  - the credential version.

  It is sent in the User's `preferredLocale`, because the request carries no locale.

- A verified or absent email, or suppression by the email budgets, still returns the
  same 202 with an inert token. No address or verification state is disclosed.
- A new request supersedes the User's older actionable flow.

**Verify:**

- It requires an authenticated OWNER/EMPLOYEE session of **the same User** the flow
  was issued to. Fresh proof is not required again, because the design requires it only
  at request.
- Another User's token is treated as unknown (400 `VERIFICATION_FAILED`), and that flow
  is neither debited nor invalidated.
- The lock order is:
  1. the IP verification budget;
  2. the User and then the session (`resolveForMutation`);
  3. the identity;
  4. the challenge.

  The User, address, credential version, flow and code deadlines, attempts and
  identity failure budget are then rechecked, and the HMAC is compared in constant
  time.

- Wrong codes debit the flow and identity budgets in a committed transaction. The fifth
  failure invalidates the flow.
- On success, in one transaction:
  - the challenge is consumed and its pending delivery erased;
  - `emailVerifiedAt` is set by a guarded update. The guard requires the same address,
    the same credential version and a still-null `emailVerifiedAt`;
  - `RECOVERY_EMAIL_VERIFIED` is appended, with actor `USER` = subject, method
    `EMAIL_OTP`, and the challenge ID. It contains no email, code, token or hash.
- **Nothing else changes.** Password, credential and authorization versions, status,
  row version and locale stay as they were. Existing sessions remain valid, and no
  cookie is issued or rotated.

**Resend.** The shared `POST /auth/challenges/resend` now also forwards
`VERIFY_RECOVERY_EMAIL` flows. It rotates the code of a live flow whose email is still
unverified, keeps the fixed flow deadline, and uses the same lock order.

**Email.** The encrypted `AuthDelivery`/outbox path carries a `VERIFY_RECOVERY_EMAIL`
envelope, with vi/en wording for the staff recovery email.

## Owner protections

- Owner recovery is self-service only. It uses a purpose-bound challenge sent to the
  Owner's own stored address, after the Owner has proven that address while signed in
  with fresh password proof.
- No staff or administrative reset, bypass or impersonation path was added.
- Throttling never changes Owner status.

## Shared-code changes (behavior-preserving)

- `otp-flow.ts` now provides the User-bound flow helpers that both Step 6 reset and
  recovery email use:
  - `issueUserChallenge`;
  - `rotateUserChallenge`;
  - `invalidateChallenges`;
  - `supersedeActionable`;
  - `userOtpBinding`.

  The identity lock accepts the new purpose. `PasswordResetService` delegates to these
  helpers instead of private copies, and its binding, deadlines and outbox output are
  unchanged.

- `PasswordResetService.request` takes an optional trailing `realm`, which defaults to
  `CUSTOMER`.
- `RegistrationService` optionally receives `RecoveryEmailService` for the shared
  resend endpoint.
- These controller helpers are now exported for reuse:
  - `peer` and `retryAfter` from `password-reset.controller.ts`;
  - `requireEmptyObject` from `session-auth.controller.ts`.

## Validation

| Check                                                                | Result                             |
| -------------------------------------------------------------------- | ---------------------------------- |
| Contracts and API strict TypeScript build                            | PASS                               |
| Recovery-email HTTP contract test                                    | PASS: 1                            |
| Password reset HTTP contract tests (updated for the WORKFORCE realm) | PASS: 2                            |
| PostgreSQL rollback integration: workforce recovery                  | PASS: 5 (4 subtests, none skipped) |
| PostgreSQL rollback integration: Step 6 customer reset regression    | PASS: 5 (4 subtests)               |
| ESLint and Prettier on changed files                                 | PASS                               |

The workforce integration test covers the following for **both the Owner and an
employee**:

- the WORKFORCE reset is inert while the email is unverified;
- a stale session is refused;
- the fresh-proof flow binding, lifetimes, stored-spelling delivery and locale;
- a persisted wrong-code debit;
- the shared resend rotation with a fixed deadline;
- verification changing only `emailVerifiedAt`, with sessions still valid and a
  secret-free audit carrying the request ID;
- replay rejection;
- an inert re-request after verification;
- the CUSTOMER realm refusing the account;
- a full WORKFORCE reset that changes the credential, revokes sessions and appends a
  `SYSTEM` audit.

It also covers:

- PENDING_SETUP, INACTIVE and customer accounts being refused in the WORKFORCE realm,
  with pending status unchanged;
- a customer getting `REQUEST_NOT_ALLOWED`;
- anonymous or missing sessions;
- another User's session unable to use or debit a flow;
- a random token failing;
- five failures invalidating the flow;
- customer reset still working through the default realm.

A postcheck confirms that no fixture users, challenges or audit rows remain, and that
the Owner count is unchanged.

The Step 4, 5, 7 and 8 suites were not rerun. The shared-resend change affects only
flows whose purpose is not `ACTIVATE_CUSTOMER`.

## Exact Step 9 files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/app.module.ts
apps/api/src/auth/auth-delivery.ts
apps/api/src/auth/auth.error.ts
apps/api/src/auth/otp-flow.ts
apps/api/src/auth/password-reset.controller.ts
apps/api/src/auth/password-reset.http.test.ts
apps/api/src/auth/password-reset.service.ts
apps/api/src/auth/registration.service.ts
apps/api/src/auth/session-auth.controller.ts
packages/contracts/src/index.ts
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/auth/recovery-email.controller.ts
apps/api/src/auth/recovery-email.http.test.ts
apps/api/src/auth/recovery-email.service.ts
apps/api/src/auth/workforce-recovery.integration.test.ts
docs/PHASE1_STEP9_WORKFORCE_RECOVERY.md
```

## Review boundary and open items

No schema blocker. The following were **not** added:

- employee lifecycle or setup (Step 10);
- role administration or the audit-read API (Step 11);
- email delivery (Step 12);
- UI.

Open items:

- **Employees without email.** Employees without an email have no self-service
  recovery. They depend on the Step 10 authorized setup reissue, as the design
  specifies.
- **Email delivery.** As in Steps 4 and 6, codes are stored encrypted but not sent
  until a provider and dispatcher are configured.
- **Real Owner.** Creating the real Owner is still pending, as recorded in Step 8. Once
  the Owner is created, the Owner signs in, reauthenticates and verifies the stored
  email through these routes. Only then is Owner self-service reset available.
- **Idle timeout.** The Step 8 idle-timeout item is unchanged. Recovery-email
  endpoints do not extend idle activity.
