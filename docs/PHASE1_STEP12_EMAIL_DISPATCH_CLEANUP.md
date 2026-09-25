# Phase 1 Step 12: email dispatcher and cleanup

Status: **implemented and validated locally; awaiting approval**. No staging, commit,
push or Step 13 work. Baseline is Step 11 commit `b8c4837`. **Phase 1 is not complete**;
Step 13 is the completion gate.

This implements the delivery and cleanup parts of the approved
[authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md), section 6 ("Atomic
attempts, resends and delivery"), on the existing `AuthDelivery`/outbox architecture.
The auth flows are unchanged.

**No Prisma schema, migration or database privilege change was made.**
`apps/web/next-env.d.ts` is untouched. No real Owner was created. No DNS, Google Admin,
SPF, DKIM or DMARC configuration was attempted. No automated test contacts a real
email provider.

## Architecture

The worker cannot import from `apps/api` (workspace boundary rules), so the delivery
pieces it needs now live in `@lucy-spa/server`. They were moved, not rewritten, and
`apps/api` re-exports them so every existing import keeps working.

| Module (`packages/server/src`) | Contents                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `delivery-crypto.ts`           | AES-256-GCM delivery sealing and opening, and the length-prefixed tuple encoder. The ciphertext format is byte-identical. |
| `auth-lock.ts`                 | Shared and exclusive graph locks (same lock identity), and `authTransactionRunner` (shared lock first) for the worker.    |
| `auth-email.ts`                | Purposes, envelope parsing, the transport port, the `AuthEmailSendError` classification and the vi/en templates.          |
| `auth-delivery.ts`             | `AuthDeliveryProcessor` (moved) and the new `AuthEmailDispatcher`.                                                        |
| `mail.ts`                      | Mail configuration, the SMTP transport (nodemailer 10.0.10) and `FakeAuthEmailTransport`.                                 |
| `auth-cleanup.ts`              | Bounded cleanup.                                                                                                          |

`apps/worker/src/auth-jobs.ts` validates configuration and runs two non-overlapping
loops, **email dispatch** and **cleanup**, next to the existing BullMQ diagnostic
worker. No second outbox or queue was created.

## SMTP configuration contract

All values come from the environment. The worker validates them before any connection
and fails closed; errors name the field, never its value.

| Variable                                             | Default                       | Rule                                                             |
| ---------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `MAIL_TRANSPORT`                                     | `disabled` outside production | `smtp` or `disabled`. **Must be set explicitly in production.**  |
| `SMTP_HOST`                                          | —                             | Hostname, required for `smtp`.                                   |
| `SMTP_SECURITY`                                      | `starttls`                    | `starttls` or `tls`. **There is no plaintext option.**           |
| `SMTP_PORT`                                          | 587 (465 for `tls`)           | 1–65535.                                                         |
| `SMTP_EHLO_NAME`                                     | Sender domain                 | Hostname.                                                        |
| `SMTP_TIMEOUT_MS`                                    | 15000                         | 1000–120000 (connection, greeting and socket timeouts).          |
| `MAIL_FROM_ADDRESS`                                  | —                             | A plain mailbox, required for `smtp`.                            |
| `MAIL_FROM_NAME`                                     | `Lucy Spa`                    | Letters, digits and basic punctuation; no CR/LF, quotes or `<>`. |
| `AUTH_DELIVERY_KEYS`, `AUTH_DELIVERY_ACTIVE_VERSION` | —                             | Required for `smtp`; the same ring as the API.                   |

- **No SMTP username, password, app password, API key or OAuth credential** is read or
  stored. The relay authenticates the VPS by its allowlisted IP.
- **Production relay:** `MAIL_TRANSPORT=smtp`, `SMTP_HOST=smtp-relay.gmail.com`,
  `SMTP_PORT=587`, `SMTP_SECURITY=starttls`, `MAIL_FROM_ADDRESS=system@lucyspa.vn`,
  `MAIL_FROM_NAME=Lucy Spa`.
- **Sender:** `Lucy Spa <system@lucyspa.vn>`.
- **TLS:** STARTTLS is required (nodemailer `requireTLS`), certificates are verified,
  the minimum is TLS 1.2, and SNI is sent for hostnames.
- **Nodemailer** runs with logging, debug, file access and URL access disabled.
- **Message-ID** is `<deliveryId.auth@lucyspa.vn>`, stable across retries of the same
  delivery. The header `Auto-Submitted: auto-generated` is added.
- The worker `dev`/`start` scripts now also load the ignored `.env.auth.local`, where
  `pnpm auth:env:init` puts the delivery ring, as the API scripts already do.
  `.env.example` documents every variable.

## Delivery and retry behavior

These are the existing Phase 1 semantics, now run by a worker.

1. **Dispatch.** Every `EMAIL_DISPATCH_INTERVAL_MS` (default 5 s), the dispatcher
   selects up to `EMAIL_DISPATCH_BATCH_SIZE` (default 25) due rows. Due means
   `PENDING`, `nextAttemptAt` ≤ now, and no active lease, using the existing claim
   index.
2. **Claim**, in a short transaction with the shared graph lock:
   - lock the row and recheck its state;
   - a consumed or invalidated challenge, or a changed generation, gives `INVALIDATED`;
   - a passed code or delivery deadline gives `EXPIRED`;
   - otherwise decrypt the envelope, increment `attempts`, and set a 30-second lease.

   Plaintext exists only in memory between claim and send.

3. **Send** through the transport **outside any transaction**, with the delivery ID as
   the idempotency key.
4. **Complete**, in a short transaction. It verifies the lease token, then:
   - on success: `DELIVERED` with a provider message ID;
   - on a **permanent** failure (SMTP 5xx or a rejected envelope): `FAILED` with
     `PROVIDER_REJECTED` or `RECIPIENT_REJECTED`;
   - on a **transient** failure (4xx, network or TLS):
     - `RETRY_SCHEDULED`, with a backoff of 15 s × 2^(attempts−1);
     - the same code and ciphertext are kept, and no new OTP is ever generated;
     - once 5 attempts are used or the next retry would pass the code deadline, the
       delivery becomes `FAILED` with `RETRIES_EXHAUSTED`.

   Every terminal state erases the ciphertext, key version and lease. A retrying row
   keeps `safeErrorCode` null, as in the existing contract.

5. **Concurrent workers.** A second worker skips a row locked by another worker's
   claim, and a leased row gives `SKIPPED`. So under concurrency at most one worker
   sends each attempt. As the design states, email is not exactly-once; a duplicate
   after a crash mid-send is harmless because verification rechecks challenge state.
6. **Outbox.** When a delivery leaves `PENDING`, its `auth.email_delivery.requested`
   outbox event gets `publishedAt`. The event history is kept.
7. **Logging.** Only outcome counts and error class names are logged. Provider errors
   are reduced to safe codes before storage. Recipients, codes, envelopes, tokens and
   configuration values are never logged or stored in error fields.

**Semantic refinement.** The processor previously recorded every final failure as
`PROVIDER_REJECTED`. It now distinguishes a permanent rejection (failed immediately,
no pointless retries) from exhausted transient retries (`RETRIES_EXHAUSTED`).

## Email content

Emails are plain text. They are chosen by purpose and use the locale captured by the
flow: the request locale, or the stored preference for a resend. All Vietnamese and
English subjects are distinct.

| Purpose                 | vi subject                                               | en subject                                  |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------- |
| `ACTIVATE_CUSTOMER`     | Lucy Spa – Mã xác minh đăng ký tài khoản                 | Lucy Spa – Your account verification code   |
| `RESET_PASSWORD`        | Lucy Spa – Mã đặt lại mật khẩu                           | Lucy Spa – Your password reset code         |
| `VERIFY_RECOVERY_EMAIL` | Lucy Spa – Mã xác minh email khôi phục tài khoản nhân sự | Lucy Spa – Verify your staff recovery email |

Each body states:

- what the code is for;
- the code itself;
- that the code is single-use, with its **exact expiry in Vietnam time** taken from the
  delivery record (for example `14:35, 25/09/2026`). OTP lifetimes are unchanged;
- to ignore the email if the recipient did not request it;
- that Lucy Spa never asks for the code.

`RESET_PASSWORD` serves both customer and workforce recovery, because the envelope does
not carry the realm. The wording is account-neutral.

**Employee setup is never emailed.** Per the design, the 24-hour setup capability is
returned once to the authorized issuer (Step 10) and handed over through an authorized
channel, so no setup template exists.

## Cleanup behavior

The design's rule (section 6): expired intents, challenge secrets, delivery ciphertext
and expired anonymous sessions are transient data eligible for bounded cleanup, and
terminal intents and challenges are cleaned **within 24 hours**. Audit and employee
records are never cleanup targets.

Each run takes up to `AUTH_CLEANUP_MAX_BATCHES` (default 20) batches of
`AUTH_CLEANUP_BATCH_SIZE` (default 500) per step. Every batch is its own short
transaction with the shared graph lock, and rows are selected with
`FOR UPDATE SKIP LOCKED`, so rows held by a live request or delivery wait for a later
run. The runs are idempotent.

1. **Expire deliveries:** unleased `PENDING` deliveries past `expiresAt` become
   `EXPIRED`, with the ciphertext erased.
2. **Delete challenges:** consumed, invalidated or flow-expired challenges are deleted
   with their delivery rows (restrictive FK). A challenge with a delivery currently
   leased to a sender is skipped.
3. **Delete registration intents:** completed, invalidated or expired intents that no
   challenge still references.
4. **Delete anonymous sessions:** `ANONYMOUS` sessions past `absoluteExpiresAt`.

**Never touched:**

- Users, profiles and memberships;
- roles and grants;
- audit events;
- outbox history;
- throttle buckets;
- **authenticated** sessions, which the design does not list.

`AUTH_CLEANUP_INTERVAL_SECONDS` (default 900, maximum 43 200) ensures the 24-hour
deadline is met. A replayed flow token for a deleted challenge gets the same generic
`VERIFICATION_FAILED` as any unknown flow.

## Validation

All tests here are focused. Automated tests never contact a real provider.

| Check                                                                                       | Result               |
| ------------------------------------------------------------------------------------------- | -------------------- |
| Server, API and worker strict TypeScript builds                                             | PASS                 |
| `packages/server` unit tests (5 new mail tests, plus existing environment and logger tests) | PASS: 19             |
| Worker unit tests (2 new job tests, plus the existing processor test)                       | PASS: 3              |
| PostgreSQL rollback integration: email dispatch and cleanup (new)                           | PASS: 6 (5 subtests) |
| API crypto unit tests (delivery sealing moved)                                              | PASS: 10             |
| Step 4 registration and Step 6 reset integration (they run the moved processor and sealing) | PASS                 |
| ESLint, Prettier and the workspace boundary check on changed files                          | PASS                 |

**The new tests prove:**

- **Mail configuration** is explicit in production and TLS-only, rejects header
  injection in the sender name, and never echoes values.
- **Failure classification:** 5xx and envelope errors are permanent; 4xx and network
  errors are transient; no content leaks.
- **Templates:** 3 purposes × 2 locales, distinct Lucy Spa subjects, no test branding,
  the code, a Vietnam-time deadline, ignore guidance, and no recipient echo.
- **Fake transport:** records sends and replays queued failures.
- **Refusal without STARTTLS.** The SMTP transport, pointed at a local plaintext SMTP
  server with no STARTTLS offer, fails transiently and never sends `MAIL`, `DATA` or
  `AUTH`.
- **Worker configuration** requires the delivery ring for `smtp`, caps the cleanup
  interval at 12 hours, and rejects bad values.
- **Worker logs** of failing cycles contain error class names only, with no address or
  code.
- **Dispatch (integration):**
  - one send to the stored spelling with the correct purpose, locale, subject, code and
    deadline;
  - ciphertext erased and outbox published;
  - a second pass is a no-op.
- **Retry (integration):**
  - a transient failure keeps the ciphertext and backs off, with no code recorded while
    pending;
  - the retry sends the same delivery;
  - a permanent failure is `FAILED` with the ciphertext erased;
  - an error echoing the code is stored and summarized only as safe codes, ending in
    `RETRIES_EXHAUSTED`.
- **Duplicate protection (integration):** a second worker arriving mid-send gets
  `SKIPPED`, and exactly one send happens.
- **Supersession (integration):** a superseded code is never sent.
- **Cleanup (integration):**
  - with batch size 1, each step touches at most 1 row per run;
  - repeated runs converge to all zeros;
  - expired or terminal challenges, their deliveries, expired intents and expired
    anonymous sessions are removed;
  - a live challenge and its pending delivery, a live intent, a live anonymous session,
    an expired authenticated session, all users, all audit rows and outbox history
    remain.

**Not run, per instructions:** the Step 5, 7, 8, 9, 10 and 11 suites. They are left to
the Step 13 gate. Moving the lock helpers left their identity and SQL unchanged.

## Files

Modified:

```text
.env.example
LUCYSPA_HANDOFF.md
apps/api/src/auth/auth-delivery.ts       (enqueue + invalidation; re-exports moved pieces)
apps/api/src/auth/auth-store.ts          (re-exports the moved lock primitives)
apps/api/src/auth/crypto.ts              (re-exports moved delivery sealing/tuple encoder)
apps/worker/package.json                 (dev/start also load .env.auth.local)
apps/worker/src/main.ts                  (validates and starts/stops the auth jobs)
packages/server/package.json             (nodemailer 10.0.10, @types/nodemailer 8.0.2, @lucy-spa/database)
packages/server/src/auth-environment.ts  (adds parseDeliveryKeyRing)
packages/server/src/index.ts
pnpm-lock.yaml
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/auth/email-dispatch.integration.test.ts
apps/worker/src/auth-jobs.ts
apps/worker/src/auth-jobs.test.ts
packages/server/src/auth-cleanup.ts
packages/server/src/auth-delivery.ts
packages/server/src/auth-email.ts
packages/server/src/auth-lock.ts
packages/server/src/delivery-crypto.ts
packages/server/src/mail.test.ts
packages/server/src/mail.ts
docs/PHASE1_STEP12_EMAIL_DISPATCH_CLEANUP.md
```

## Remaining operational work

These are not application-code blockers.

- **Custom DKIM and DMARC.** The custom lucyspa.vn DKIM key is pending Google Workspace
  activation, and DMARC currently fails alignment until it exists. SPF and Google
  transport DKIM already pass. This is external DNS/Admin work.
- **VPS environment.** Set on the VPS:
  - `MAIL_TRANSPORT=smtp` and the SMTP variables above;
  - the **same** `AUTH_DELIVERY_KEYS` ring as the API;
  - no SMTP credentials.

  Then run the worker (`pnpm --filter @lucy-spa/worker start`) with PostgreSQL and
  Redis reachable. The worker's public IP must stay on the Google relay allowlist.

- **First real send.** An end-to-end send through the relay is a manual, opt-in
  check, for example by requesting a password reset for a test account after
  deployment. No automated test sends real email.
- **Throttle buckets.** Expired throttle buckets are not cleaned: the design's
  cleanup list does not include them. They carry `expiresAt` and can be added under a
  reviewed rule.
- **Authenticated sessions.** Expired and revoked authenticated sessions are likewise
  kept, pending a reviewed retention rule.
