# Phase 1 Step 4: customer registration and email OTP activation

Status: **implemented and validated locally; awaiting review**. No staging, commit,
push or Step 5 work. Baseline is Step 3 commit `a68f66a`.

This implements the customer activation flow in the approved
[authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md) sections 2, 3, 6 and
10 (PRD 6.1–6.3), reusing the [Step 3 runtime](PHASE1_STEP3_AUTH_RUNTIME.md) and the
existing [Step 2 database](PHASE1_STEP2_DATABASE.md). **No Prisma schema, migration or
database privilege change was needed.** `apps/web/next-env.d.ts` is untouched.

## Endpoints

All three routes are under `/api/v1/auth`. They require JSON, an exact Origin (or
Referer) and the session-bound `X-CSRF-Token` from `GET /auth/context` (the existing
global guard). Unknown fields such as `role`, `kind` or `status` are rejected.

| Route                          | Input                                                                | Result                                                                                    |
| ------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /auth/register`          | `{ fullName, dateOfBirth, address, email, phone, password, locale }` | 202 `{ status: 'accepted', flowToken, codeLifetimeSeconds: 300, resendAfterSeconds: 60 }` |
| `POST /auth/activation/verify` | `{ flowToken, otp }`                                                 | 204; the customer is ACTIVE; **no session or login cookie is created**                    |
| `POST /auth/challenges/resend` | `{ flowToken }`                                                      | 202 `{ status: 'accepted', resendAfterSeconds: 60 }`                                      |

The contract types are exported from `@lucy-spa/contracts`.

Public errors:

- 400 `VALIDATION_FAILED: <field>` for domain validation. Only the field name is
  returned, never the submitted value.
- 400 `VERIFICATION_FAILED` for every unknown, wrong, expired, exhausted, replayed,
  superseded or conflicting flow.
- 429 `RATE_LIMITED` with a coarse `Retry-After` for per-IP budgets only.
- 503 `SERVICE_UNAVAILABLE` when the OTP or delivery keys are missing, or when the
  database or password work queue is unavailable.

DTO shape errors keep the existing global `HTTP_400` contract.

## Behavior

- **Required PRD fields.** Name and address are NFC-normalized and trimmed. Control
  characters are rejected, with limits of 200 and 500 code points. The date of birth
  is a real `YYYY-MM-DD` calendar date from 1900 up to today in `Asia/Ho_Chi_Minh`,
  stored as a date. No minimum age was invented. Email and phone use the Step 3
  normalization (version 1). The password uses the Step 3 policy and blocklist, and
  Argon2id hashing. Locale is `vi | en`.
- **Registration order.**
  1. Validate the input.
  2. Debit the per-IP issuance budget (429 when exhausted, before any password work).
  3. Hash the password. This always happens, so real, duplicate and suppressed
     requests do comparable work.
  4. In one transaction:
     - Take a per-canonical-email advisory lock over every retained key version.
     - Check the cooldown and the email budgets.
     - Refuse silently when an existing User owns the email or phone.
     - Supersede any actionable activation for that identity.
     - Insert the `RegistrationIntent` (30 minutes), then the `ACTIVATE_CUSTOMER`
       challenge.
     - Create the encrypted `AuthDelivery` and its outbox event.
- **Suppressed requests.** Duplicate, cooldown and budget-suppressed requests return
  the identical 202 shape with an unstored random `flowToken`. They send no email and
  never alter an existing User or another flow's candidate data. Pending signups do
  not reserve unique identities.
- **Challenge material.**
  - A 256-bit `flowToken` is stored only as a SHA-256 digest.
  - The six-digit CSPRNG code is stored only as the Step 3 HMAC verifier. It is
    bound to purpose, challenge, generation, intent and canonical email, together
    with the OTP key version.
  - `identityKey` is a purpose-specific HMAC of the canonical email under the
    throttle-pseudonym ring.
  - Code lifetime is `min(generated + 5 min, flow expiry)`. The flow expiry equals
    the intent expiry and is never extended.
- **Verification.** Verification runs in one transaction:
  1. Debit the IP budget.
  2. Lock the identity, then the challenge row.
  3. Recheck the flow, intent and code expiry, the 5-attempt flow limit, the
     10-failure identity budget and the key version.
  4. Compare the digests in constant time.

  A wrong code increments `failedAttempts` and the identity failure budget. That
  transaction commits before the 400 is returned. The fifth failure invalidates the
  flow and its intent.

  On success, one transaction:
  - creates the ACTIVE `CUSTOMER` User (with `emailVerifiedAt`) and its
    `CustomerProfile`;
  - completes the intent and consumes the challenge;
  - invalidates pending deliveries and sibling activations;
  - appends the `USER_CREATED` and `CUSTOMER_EMAIL_VERIFIED` audit events. Their
    actor is `SYSTEM`, and they contain no email, profile or code.

  If an email or phone collision is found at activation, or a unique-index race is
  lost, the activation is rolled back or refused, the flow is retired, and the
  response is `VERIFICATION_FAILED`. Verified email is never attached to an existing
  User.

- **Resend.** The endpoint always returns the same 202. Within the live flow, and
  subject to the 60-second cooldown and the 5/hour and 10/day email budgets, it:
  - increments the generation and rotates the code;
  - keeps the capability and the failure count;
  - invalidates the older delivery;
  - enqueues a new delivery.

  Old-generation codes are rejected.

- **Throttling.** All limits are PostgreSQL fixed UTC windows, debited across every
  retained throttle key version:

  | Budget            | Limit                                        |
  | ----------------- | -------------------------------------------- |
  | IP issuance       | 30/hour (`AUTH_OTP_IP_ISSUE_LIMIT`)          |
  | IP verification   | 100 per 15 minutes                           |
  | Email cooldown    | 60 seconds, in a separate zero-window bucket |
  | Email issuance    | 5/hour and 10/day                            |
  | Identity failures | 10 per 15 minutes                            |

  The IP key is the direct socket peer, as in Step 3; forwarded headers remain
  untrusted.

- **Email delivery abstraction** (`auth-delivery.ts`).
  - The OTP email is stored only as a short-lived `AuthDelivery` AES-256-GCM
    envelope. It uses a random 12-byte nonce, an HKDF-derived key from the
    independent delivery ring, and AAD that binds the delivery, challenge and
    generation.
  - The outbox event `auth.email_delivery.requested` carries only
    `{ deliveryId, eventVersion: 1 }`.
  - `AuthDeliveryProcessor.deliver(deliveryId)`:
    - rechecks the challenge state, generation and expiry;
    - decrypts the envelope and leases the row;
    - calls a provider-agnostic `AuthEmailTransport` outside the transaction, using
      the delivery ID as the idempotency key;
    - records `DELIVERED`, a bounded retry, or `FAILED`, storing only safe error codes.

    Ciphertext is erased on every terminal state, supersession and consumption.
    Retries never generate a new code.

  - vi/en message text is included. No provider, sender address or credential is
    bundled.

## Configuration

| Setting                                              | Contract                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `AUTH_OTP_KEYS`, `AUTH_OTP_ACTIVE_VERSION`           | Existing optional pair; now required by these routes               |
| `AUTH_DELIVERY_KEYS`, `AUTH_DELIVERY_ACTIVE_VERSION` | New optional complete pair; must be independent of all other rings |
| `AUTH_OTP_IP_ISSUE_LIMIT`                            | Positive bounded integer, default 30 per hour per direct peer      |

Without both the OTP and delivery rings, register and resend fail closed with 503
before any write. `pnpm auth:env:init` now generates all four rings for new files. For
an existing `.env.auth.local`, it appends only the missing OTP and delivery pairs,
never replaces existing keys, and prints no keys. **The existing local file was not
modified by this step.** Run `pnpm auth:env:init` once before using these routes
locally.

## Validation

| Check                                                                  | Result                         |
| ---------------------------------------------------------------------- | ------------------------------ |
| Shared server/contracts and API strict TypeScript build                | PASS                           |
| Registration normalization unit tests                                  | PASS: 3                        |
| Registration HTTP contract tests                                       | PASS: 3                        |
| Crypto tests (incl. new identity digest and delivery envelope)         | PASS: 10                       |
| Existing API and HTTP context/CSRF tests (regression on shared wiring) | PASS: 7 + 6 subtests           |
| Auth configuration tests (incl. delivery ring and new limit)           | PASS: 9                        |
| Real PostgreSQL registration integration                               | PASS: 7 (6 subtests), rollback |
| ESLint on the auth, server and contracts sources                       | PASS                           |
| Prettier on changed files; init script checked in scratchpad copy      | PASS                           |

The integration suite runs inside one rolled-back transaction against the real Step 2
constraints and triggers. It covers:

- digest- and ciphertext-only persistence, and a secret-free outbox payload;
- delivery, then the idempotent skip;
- wrong-code debits that persist;
- cooldown suppression, resend rotation without flow extension, and rejection of the
  old generation;
- supersession by a repeated signup;
- activation that creates the User and profile, including the deferred kind/profile
  constraint, with no session and secret-free audit;
- replay rejection, and an inert duplicate signup for an existing User;
- the five-failure lockout;
- a competing candidate that loses the phone;
- unknown and malformed flows;
- stale-delivery skip and transport-failure retry;
- the public IP budget, with no password work after refusal.

A postcheck confirms that no fixture Users or intents remain. The Step 3 session
integration suite was not rerun because its code is unchanged. The new suite is added
to the explicit `pnpm test:auth:integration` entry point.

Not covered by automated tests: a true concurrent unique-index race (the rollback
harness cannot survive an aborted transaction; it is handled by a second retiring
transaction), and wall-clock expiry. Expiry is enforced by the service checks and the
Step 2 triggers.

## Exact Step 4 files

Modified:

```text
.env.example
LUCYSPA_HANDOFF.md
apps/api/src/app.module.ts
apps/api/src/auth/auth.error.ts
apps/api/src/auth/crypto.test.ts
apps/api/src/auth/crypto.ts
packages/contracts/src/index.ts
packages/server/src/auth-environment.test.ts
packages/server/src/auth-environment.ts
scripts/init-auth-env.mjs
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/auth/auth-delivery.ts
apps/api/src/auth/auth-throttle.service.ts
apps/api/src/auth/registration.controller.ts
apps/api/src/auth/registration.http.test.ts
apps/api/src/auth/registration.integration.test.ts
apps/api/src/auth/registration.service.ts
apps/api/src/auth/registration.test.ts
apps/api/src/auth/registration.ts
docs/PHASE1_STEP4_REGISTRATION.md
```

## Review boundary and remaining prerequisites

No schema blocker. The following were **not** added:

- login, logout, password reset or recovery email;
- Owner bootstrap, employees or RBAC;
- UI, booking, loyalty or any later module;
- an outbox publisher or BullMQ dispatcher;
- a concrete email provider.

Before real delivery, the Owner must supply:

- an email provider;
- a verified sender and domain;
- a test-delivery arrangement;
- credentials, through a secure channel.

A later step then wires an `AuthEmailTransport` adapter and schedules
`AuthDeliveryProcessor` from the outbox. Until then, verification codes are stored
encrypted but are not sent. Transient-row cleanup and trusted-proxy client IPs also
remain later work. Step 5 is not started.
