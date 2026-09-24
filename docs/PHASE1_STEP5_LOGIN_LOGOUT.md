# Phase 1 Step 5: customer login and logout

Status: **implemented and validated locally; awaiting review**. No staging, commit,
push or Step 6 work. Baseline is Step 4 commit `bff1ddc`.

This implements the customer login and logout contracts of the approved
[authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md) (sections 5, 6 and 10).
It reuses the [Step 3 session primitives](PHASE1_STEP3_AUTH_RUNTIME.md) and the
customers activated by [Step 4](PHASE1_STEP4_REGISTRATION.md). **No Prisma schema,
migration or database privilege change was needed.** `apps/web/next-env.d.ts` is
untouched.

## Endpoints

Both routes are under `/api/v1/auth`. They require JSON, an exact Origin (or Referer)
and the session-bound `X-CSRF-Token` through the existing global guard. Every response
is `no-store`.

| Route               | Input                                                                  | Result                                                                                                          |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`  | `{ realm: 'CUSTOMER', identifierType: 'EMAIL', identifier, password }` | 200 `CurrentAccount`, plus a new session cookie. The client must `GET /auth/context` again for a new CSRF token |
| `POST /auth/logout` | `{}` (any property is rejected)                                        | 204. The current session is revoked, and the cookie is cleared with identical attributes and `Max-Age=0`        |

The customer `CurrentAccount` is
`{ id, kind: 'CUSTOMER', displayName, locale, authorization: { version, grants: [], denies: [] } }`.
It contains no email, phone, password state or token.

Public errors:

- 401 `AUTHENTICATION_FAILED`. One identical result for:
  - an unknown or malformed email;
  - a wrong password;
  - a wrong-realm or ineligible account;
  - a stale pre-authentication session;
  - a concurrent credential change.
- 429 `RATE_LIMITED` with `Retry-After: 900`.
- 503 `SERVICE_UNAVAILABLE`, with no driver detail.
- DTO errors keep the existing `HTTP_400`; logout with a non-empty body returns
  `VALIDATION_FAILED`.

## Behavior

- **Identifier.** The email goes through the Step 3 canonical normalization, so
  case variants of the address match the same account. There are no dot or tag
  rewrites. A malformed email fails exactly like an unknown account.
- **Budgets.** Failures are counted per canonical email in the CUSTOMER realm
  (10 per 15 minutes) and per direct IP peer (100 per 15 minutes).
  - These are fixed UTC PostgreSQL windows, debited across every retained throttle
    key version by the Step 4 `AuthThrottleService`.
  - The budgets are checked before any password work. The same limit applies to
    known and unknown identifiers, so it doesn't reveal whether an account exists.
  - Failure debits commit in their own transaction before the 401 is returned.
  - Successful logins are not counted.
- **Verification.** Every non-throttled attempt performs exactly one Argon2id
  verification. It is real for an account with a hash, and otherwise uses a dummy
  hash of a random unstored password, prepared at startup. Eligibility (CUSTOMER,
  ACTIVE, verified email) is evaluated only after that work.
- **Rehash.** Outdated parameters are rehashed through the Step 3 guarded
  compare-and-update without changing `credentialVersion`. The session evidence
  then uses the _new_ stored hash, so the documented Step 3 fail-closed rule for a
  pre-rehash hash is respected.
- **Session.** The session comes from `SessionService.rotateAuthenticated`, which:
  - locks the User and the current pre-auth session, and rechecks state, hash and
    both versions;
  - inserts a new authenticated row with the 12-hour absolute lifetime;
  - revokes the previous row, so there is no overlap window and its old CSRF token
    dies with it;
  - appends `SESSION_CREATED`, with the request ID and no token.

  Replaying the old pre-auth token fails. Login never trusts a browser-supplied
  identity.

- **Logout.** Logout uses `SessionService.revoke`, which appends `SESSIONS_REVOKED`
  for authenticated sessions and no audit for anonymous ones. The cookie is always
  cleared. The next `GET /auth/context` issues a new anonymous session. The
  existing context route already reports `authenticated` from the session kind.

## Ambiguities resolved by the existing contracts

- **WORKFORCE login.** The design's login contract includes a `WORKFORCE` realm and
  an employee-ID identifier. Owner and employee accounts don't exist until later
  steps, and their `CurrentAccount` needs the unimplemented RBAC runtime. Step 5
  therefore accepts only `realm: 'CUSTOMER'` with `identifierType: 'EMAIL'`. Other
  values get a 400 DTO error, rather than a false 401 or an invented workforce rule.
- **Deferred endpoints.** `logout-all`, `GET /auth/me` and `reauthenticate` are
  separate design endpoints and were not requested for this step. They remain
  unimplemented.

## Validation

| Check                                                                | Result                         |
| -------------------------------------------------------------------- | ------------------------------ |
| Shared server/contracts and API strict TypeScript build              | PASS                           |
| Login/logout HTTP contract test                                      | PASS                           |
| Affected existing HTTP suites (API, auth context, registration HTTP) | PASS: 17 tests                 |
| Real PostgreSQL login/logout integration                             | PASS: 4 (3 subtests), rollback |
| ESLint and Prettier on changed files                                 | PASS                           |

The login/logout HTTP test covers:

- forged or missing CSRF and origin;
- the rejected `WORKFORCE`/`EMPLOYEE_ID`/extra-field DTOs;
- exact cookie rotation;
- generic 401, 429 with Retry-After, and 503 without leaks;
- logout revocation, cookie clearing, and rejection of a non-empty body.

The existing HTTP suites were run because the shared app module changed. The Step 4
registration HTTP test now stubs `LoginService`, because its intentionally failing
password stub would otherwise block startup.

The integration test runs inside one rolled-back transaction with real Argon2. It
covers:

- one verification for each failure type (unknown, malformed, wrong password);
- failure debits that persist, with no raw email in the buckets;
- case-insensitive canonical login;
- session rotation with no overlap and the absolute lifetime;
- `SESSION_CREATED` audit carrying the request ID;
- failed replay of the pre-auth token;
- logout revocation with audit;
- the legacy-hash rehash at an unchanged credential version;
- the identifier budget blocking password work for both a real and an unknown
  identifier, while the anonymous session is kept.

A postcheck confirms no fixture Users, Sessions or AuditEvents remain. The unchanged
Step 3/4 integration suites were not rerun. The new suite is added to
`pnpm test:auth:integration`.

## Exact Step 5 files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/app.module.ts
apps/api/src/auth/auth.error.ts
apps/api/src/auth/registration.http.test.ts
packages/contracts/src/index.ts
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/auth/login.integration.test.ts
apps/api/src/auth/login.service.ts
apps/api/src/auth/session-auth.controller.ts
apps/api/src/auth/session-auth.http.test.ts
docs/PHASE1_STEP5_LOGIN_LOGOUT.md
```

## Review boundary

No schema blocker. The following were **not** added:

- workforce login;
- `logout-all`, `/auth/me` or reauthentication;
- password reset;
- Owner bootstrap, employees or RBAC;
- email delivery configuration;
- UI or any later module.

The per-IP budgets key on the direct socket peer, as in Steps 3–4, until a trusted-proxy
policy is configured. Step 6 is not started.
