# Phase 1 Step 6: customer password reset

Status: **implemented and validated locally; awaiting review**. No staging, commit,
push or Step 7 work. Baseline is Step 5 commit `2c3d0c2`.

This implements the forgot-password flow in the approved
[authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md) sections 6, 9 and 10
(PRD 6.4) for the CUSTOMER realm. It reuses the Step 3 crypto, password and session
primitives and the Step 4 challenge, delivery, throttle and resend infrastructure.
**No Prisma schema, migration or database privilege change was needed.**
`apps/web/next-env.d.ts` is untouched.

## Endpoints

All routes are under `/api/v1/auth`. They require JSON, an exact Origin (or Referer)
and the session-bound `X-CSRF-Token` through the existing global guard.

| Route                              | Input                                  | Result                                                                                               |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /password-reset/request`     | `{ realm: 'CUSTOMER', email, locale }` | 202 AcceptedFlow `{ status, flowToken, codeLifetimeSeconds: 300, resendAfterSeconds: 60 }`           |
| `POST /password-reset/complete`    | `{ flowToken, otp, newPassword }`      | 204. The password is changed and all sessions are revoked. No login cookie; normal login is required |
| `POST /challenges/resend` (shared) | `{ flowToken }`                        | 202. It now also rotates live reset flows                                                            |

Public errors:

- 400 `VALIDATION_FAILED: email` or `VALIDATION_FAILED: newPassword` for explicit
  syntax/policy errors. Only the field name is returned.
- 400 `VERIFICATION_FAILED` for every unknown, wrong, expired, exhausted, replayed,
  superseded or stale flow.
- 429 `RATE_LIMITED` with a coarse `Retry-After` for per-IP budgets only.
- 503 `SERVICE_UNAVAILABLE` when the OTP or delivery keys are missing, or when the
  database or password work queue is unavailable.

## Behavior

- **Request.** A code is issued only for an ACTIVE `CUSTOMER` with a verified email
  and a password.
  - The challenge binds `userId`, `credentialVersion`/`authzVersion` snapshots and
    the **stored verified `emailDelivery`**. The submitted spelling is used only to
    compute the canonical key.
  - Unknown, ineligible, cooldown- or budget-suppressed requests return the identical
    202 with an unstored random token, and send no email.
  - A new request supersedes any actionable reset for the same identity.
- **Flow limits.** The flow lasts 15 minutes. Each code is six CSPRNG digits, lasts
  `min(generated + 5 min, flow expiry)`, and is stored only as the HMAC verifier.
  That verifier is bound to the purpose, challenge, generation, User,
  canonical email and credential version.
- **Complete.** The new password is validated against the Step 3 policy and
  blocklist, then hashed with Argon2id _before_ any lookup, so real and unknown flows
  do the same work. One transaction then:
  1. debits the IP verification budget;
  2. locks the identity, then the challenge row, then the User row;
  3. rechecks User eligibility, the delivery target, the credential version, the flow
     and code expiry, the attempts and the identity failure budget;
  4. compares the digests in constant time.

  A wrong code increments the flow and identity failure counters, which commit before
  the 400. The fifth failure invalidates the flow. A credential change after issuance,
  such as another reset, retires the flow.

  On success, in that same transaction:
  - the challenge is consumed;
  - the password hash is replaced and `credentialVersion` incremented, under a
    version compare guard;
  - **all** of the User's sessions are revoked;
  - other actionable `RESET_PASSWORD`/`EMPLOYEE_SETUP` challenges and pending
    deliveries are invalidated;
  - the audit events are appended.

  No session is created, and existing cookies stop working because their sessions
  are revoked and the credential version changed.

- **Audit.** `PASSWORD_RESET_COMPLETED` has actor `SYSTEM`, the verified subject,
  method `EMAIL_OTP`, and the before/after credential version. `SESSIONS_REVOKED`
  records the reason and count, and is written only when sessions existed. Neither
  contains email, code, token or hash.
- **Budgets.** Step 4's rules are reused unchanged, and are now shared by purpose
  through `otp-flow.ts`:

  | Budget                    | Limit              |
  | ------------------------- | ------------------ |
  | Resend cooldown per email | 60 seconds         |
  | Email issuance            | 5/hour and 10/day  |
  | Identity failures         | 10 per 15 minutes  |
  | IP issuance               | 30/hour            |
  | IP verification           | 100 per 15 minutes |

  All are keyed by canonical email or IP rather than by flow, so they apply across
  activation and reset.

- **Email.** The existing encrypted `AuthDelivery` and outbox path carries a
  `RESET_PASSWORD` envelope, with vi/en reset wording. The request `locale` selects
  the language of the first email. A resend uses the User's stored
  `preferredLocale`, because the challenge schema has no locale column.

## Shared-code changes (behavior-preserving)

- `otp-flow.ts` now holds the helpers Step 4 used privately:
  - identity locking (now purpose-aware);
  - email and IP budgets;
  - code expiry;
  - key readiness;
  - the error guard;
  - `accepted`;
  - `RateLimitedError`.

  `RegistrationService` uses them unchanged, and its existing exports remain. It
  optionally receives `PasswordResetService`, so the shared resend endpoint can
  forward reset flows. Activation-only construction still works.

- `auth-delivery.ts` accepts a `RESET_PASSWORD` purpose. The default is still
  `ACTIVATE_CUSTOMER`.

## Design points resolved from existing contracts

- **WORKFORCE realm.** The design's request contract includes a `realm`.
  Owner/employee recovery requires workforce accounts and a verified recovery email,
  which are later steps. Step 6 therefore accepts only `realm: 'CUSTOMER'`; others get
  a 400 DTO error, consistent with Step 5 login.
- **Resend locale.** A resend uses the stored `preferredLocale`, as described above.

## Validation

| Check                                                                          | Result                         |
| ------------------------------------------------------------------------------ | ------------------------------ |
| Shared server/contracts and API strict TypeScript build                        | PASS                           |
| Password reset HTTP contract tests                                             | PASS: 2                        |
| Real PostgreSQL password reset integration                                     | PASS: 5 (4 subtests), rollback |
| Affected Step 4/5 HTTP, registration unit and API/context suites (shared code) | PASS: 21                       |
| Step 4 registration integration (refactored shared helpers)                    | PASS: 7, rollback              |
| ESLint and Prettier on changed files                                           | PASS                           |

The integration test covers:

- an unknown identity getting an inert flow;
- the challenge binding and stored-spelling delivery;
- 15-minute flow and 5-minute code deadlines, and a secret-free outbox;
- a persisted wrong-code debit;
- the shared-resend cooldown and generation rotation without deadline extension,
  with old-code rejection;
- completion changing the hash and credential version and revoking both authenticated
  sessions, with a secret-free audit carrying the request ID;
- replay rejection;
- the five-failure lockout;
- supersession by a newer request;
- a credential-version change retiring a flow.

The unchanged Step 5 login integration suite and the crypto tests were not rerun.

## Exact Step 6 files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/app.module.ts
apps/api/src/auth/auth-delivery.ts
apps/api/src/auth/registration.service.ts
packages/contracts/src/index.ts
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/auth/otp-flow.ts
apps/api/src/auth/password-reset.controller.ts
apps/api/src/auth/password-reset.http.test.ts
apps/api/src/auth/password-reset.integration.test.ts
apps/api/src/auth/password-reset.service.ts
docs/PHASE1_STEP6_PASSWORD_RESET.md
```

## Review boundary

No schema blocker. The following were **not** added:

- workforce recovery or recovery-email verification;
- Owner bootstrap, employees or RBAC;
- a real email provider or dispatcher;
- UI or any later module.

As in Step 4, codes are stored encrypted but not sent until a provider and dispatcher
are configured. Timing is equalized for the password work, but request-path database
work still differs slightly between eligible and ineligible identities. The design
asks for tested distributions, not a claim of perfectly equal timing. Step 7 is not
started.
