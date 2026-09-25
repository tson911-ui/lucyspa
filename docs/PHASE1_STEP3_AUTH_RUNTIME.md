# Phase 1 Step 3: authentication runtime foundation

Status: **implemented and validated locally; awaiting review**. No staging,
commit, push or Step 4 work. Baseline remains
`562609b5933b29f76a4077f6316a45224da80865`.

This implements the approved [authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md)
using the existing [Step 2 database](PHASE1_STEP2_DATABASE.md). No Prisma schema,
migration or database privilege changes were needed. The pre-existing
`apps/web/next-env.d.ts` is untouched; its SHA-256 remains
`0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`.

## Implemented behavior

- Passwords: NFC, 15–128 Unicode code points, unchanged case/spaces, no truncation;
  Argon2id 64 MiB / 3 iterations / parallelism 1, random 16-byte salt, 32-byte output.
  Hashing/verification share two concurrent slots and a bounded queue of 16.
  PHC parameters are validated before native work; rehash uses old-hash and
  credential-version compare-and-update, preserves stronger costs, and does not
  increment the credential version. A stale update fails closed.
- A local, pinned SecLists top100k common/compromised-password snapshot is checked
  when setting a password. Its 72 entries within the accepted length range are
  stored as fingerprints; the remaining source entries already fail length policy.
  This finite list is not an exhaustive breach database. Source, checksum, license
  and update instructions are in `apps/api/src/auth/password-data/README.md`.
- Identity normalization version 1: validated ASCII dot-atom email with IDNA DNS
  domains, separate case-preserving delivery address and lowercase comparison key;
  phone prechecks plus full country metadata/E.164, including VN mobile/fixed line
  and explicit international numbers; bounded ASCII employee codes. No provider
  dot/tag rewriting, Unicode local-part transliteration, or phone ownership claim.
- CSPRNG 32-byte capabilities, strict canonical base64url, SHA-256 of decoded
  capability bytes, length-prefixed HMAC-SHA256 and constant-time comparisons.
  CSRF tuple is `csrf-v1`, session UUID, raw base64url cookie value; fields are
  UTF-8 with unsigned 32-bit big-endian byte lengths. OTP/throttle use independent
  keys and purpose-bound tuples; no OTP issuance, delivery or redemption flow.
- Shared API Prisma provider. Sessions store only token digests. Reads validate
  absolute/idle expiry, revocation, current User kind/status/credential prerequisites,
  both security versions and availability of the stored CSRF key version.
  Context reads never update activity. Explicit foreground touch is a separate helper
  (later wired to genuine user activity; see the design's "Session activity").
- Rotation uses a new row and revokes the previous token atomically. User state,
  checked password hash and versions are rechecked under locks. Reauthentication
  retains the original absolute expiry. Authenticated lifecycle changes and their
  allowlisted audit events share the transaction; anonymous creation adds no audit.
- Global guard requires JSON, exact Origin (or Referer origin only when Origin is
  absent) and valid session-bound CSRF for unsafe HTTP methods. Foreign Fetch
  Metadata is rejected as additional defense. SameSite is not the sole protection.
- `GET /api/v1/auth/context` returns only `{ csrfToken, authenticated }`, uses
  `Cache-Control: no-store`, reuses valid sessions and replaces invalid sessions
  with a rate-limited anonymous session. Database failures return sanitized 503;
  CSRF/origin failures 403, context admission limit 429 with coarse Retry-After.
  HEAD does not allocate a session. Session, password and identity records are
  never response DTOs. HTTP logs contain request IDs/status/timing, not secrets.
- Production cookie: `__Host-lucy_session; Path=/; HttpOnly; SameSite=Lax; Secure`,
  host-only, with no persistent expiry/Max-Age. Explicit loopback HTTP development
  uses `lucy_session_dev` without Secure. Clear helper matches attributes with
  `Max-Age=0`. Production rejects the development exception.
- Next.js forwards `/api/*` to a validated configured origin; Nest retains all auth
  authority. No backend imports or auth UI were added to the web package.

## Configuration and integration contract

For this existing checkout, `pnpm auth:env:init` created the ignored
`.env.auth.local`, without rewriting `.env` or printing keys. Existing auth files
are never overwritten. Fresh `pnpm env:init` also initializes this file.

API dev/start loads `.env` and `.env.auth.local`; process environment has priority.
Production must inject its own independent random keys and HTTPS public origin.
No key has a built-in fallback. OTP configuration is optional until the later flow;
if supplied, both its ring and active version must validate.

| Setting                                              | Contract/default                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `AUTH_CSRF_KEYS`, `AUTH_CSRF_ACTIVE_VERSION`         | Required JSON version→canonical base64url key ring and active version                 |
| `AUTH_THROTTLE_KEYS`, `AUTH_THROTTLE_ACTIVE_VERSION` | Required independent key ring and active version                                      |
| `AUTH_OTP_KEYS`, `AUTH_OTP_ACTIVE_VERSION`           | Optional complete independent pair; no email flow yet                                 |
| `AUTH_ALLOW_INSECURE_LOCAL_COOKIE`                   | Explicit `true` only for development/test with loopback HTTP                          |
| `AUTH_ANONYMOUS_TTL_SECONDS`                         | 900                                                                                   |
| `AUTH_IDLE_TTL_SECONDS`                              | 1800 at Step 3; 3600 since the session-activity change (see the design)               |
| `AUTH_ABSOLUTE_TTL_SECONDS`                          | 43200                                                                                 |
| `AUTH_FRESH_AUTH_SECONDS`                            | 300                                                                                   |
| `AUTH_CONTEXT_LIMIT`, `AUTH_CONTEXT_WINDOW_SECONDS`  | 30 new anonymous sessions per direct peer per 900-second fixed UTC window             |
| `API_UPSTREAM_ORIGIN`                                | Web server configuration; defaults to `http://127.0.0.1:3001`; never request-selected |

Keys must decode to at least 32 bytes, have canonical positive PostgreSQL-compatible
integer versions, and be independent across rings/versions. All TTLs/limits are
positive bounded integers, with fresh ≤ idle ≤ absolute and anonymous ≤ absolute.
CSRF key removal invalidates sessions using that version. Retain keys for live
artifacts when rotating; the throttle debits all retained versions in stable order
so adding a new version does not reset a live budget. Retire throttle keys only
after their last window expires; do not rotate away active budgets.

Forwarded address/protocol headers are untrusted. The context quota currently uses
the direct socket peer, so clients behind the web proxy share its quota. Configure
limits for that deployment; a future per-client proxy policy requires explicit
trusted-proxy configuration. No wildcard/reflective credentialed CORS is enabled.

Mutation lock order is graph shared lock → identity/throttle → Users sorted by UUID
→ Sessions. Future security-graph writers must use the same lock namespace/key
exclusively. Mutation-time session checks must run inside the caller's transaction.
Helpers accepting an existing transaction assume the documented lock order and
require the caller to propagate failures so the whole transaction rolls back.
Never commit a partially failed rotation or audited mutation.

Future login must keep credential evidence consistent with a guarded rehash result;
passing the old pre-rehash hash into rotation fails closed. The login flow, dummy
verification/timing behavior, rate limits and current-account response are deferred.
Reauthentication, logout and role/permission workflows are likewise not endpoints
in this step. No automatic authenticated session results from OTP/reset primitives.

## Dependencies

| Added direct dependency                   | Why                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `argon2@0.45.1`                           | Maintained Argon2id implementation, PHC and verification; native Windows/Node 24 verified |
| `libphonenumber-js@1.13.13`               | Maintained full `/max` country metadata rather than hand-written carrier rules            |
| `validator@13.15.35`                      | Maintained mailbox/DNS validation after explicit supported-syntax/IDNA prechecks          |
| `@types/validator@13.15.10` (development) | Strict TypeScript definitions                                                             |

Only Argon2's required native install/build script was enabled in `allowBuilds`.
The lockfile is pinned. Cryptographic randomness, SHA-256, HMAC, constant-time
comparison and IDNA use Node 24 standard APIs; no cryptocurrency functionality.
Primary implementation references: [node-argon2](https://github.com/ranisalt/node-argon2),
[libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js),
[validator.js](https://github.com/validatorjs/validator.js),
[Node crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html),
[Next rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites).

## Validation

Completed incrementally across quota interruptions; successful unchanged suites
were not rerun as a single blanket check. Final focused results:

| Check                                                               | Result                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm db:status` before runtime implementation                      | PASS: both existing migrations applied, up to date                    |
| `pnpm install --frozen-lockfile`                                    | PASS after resolving pnpm's duplicate Argon2 build-policy placeholder |
| Password + identity tests                                           | PASS: 13 tests                                                        |
| Crypto + auth configuration tests                                   | PASS: 16 tests                                                        |
| Session policy tests                                                | PASS: 5 tests                                                         |
| HTTP context/CSRF/cookies + existing API + environment/logger tests | PASS: 21 tests                                                        |
| Real PostgreSQL session/context/throttle integration                | PASS: 11 tests, no failures/skips                                     |
| Shared server/contracts and API strict TypeScript build             | PASS                                                                  |
| Web/worker direct TypeScript check without Next type generation     | PASS                                                                  |
| ESLint on changed code areas and package boundaries                 | PASS                                                                  |
| Changed-file formatting and Git whitespace check                    | PASS                                                                  |

Total: **66 passing tests** across the listed groups. The integration suite checks
digest-only persistence, exact response/cookie contract, stable context without
activity updates, stale credentials/versions, rotation and replay, reauthentication,
audit-error rollback, revocation, shared/exclusive graph locks and retained-key
throttle budgets. All fixtures and lock probes roll back. Postchecks verify no
fixture Users, Sessions or AuditEvents remain. No migration/DDL/seed/data reset occurs.

The local three-sample Argon2 benchmark was **151.0 / 157.2 / 193.0 ms** (mean 167.1 ms)
at the approved target, with default two concurrent work slots (~128 MiB Argon2
working memory plus overhead). This is local evidence, not a production latency SLA.

No full Next build/type generation or blanket Phase 0/Step 2 retest was run.
The protected generated web file remains byte-for-byte unchanged. CI now includes
the explicit rollback auth integration entry point. Production smoke configuration
was adapted to required HTTPS public-origin/key validation; a full production
web/worker smoke rerun remains outside this focused local verification.

## Exact Step 3 files

Modified:

```text
.env.example
.github/workflows/ci.yml
LUCYSPA_HANDOFF.md
README.md
apps/api/package.json
apps/api/src/api.test.ts
apps/api/src/app.module.ts
apps/api/src/platform/configure-http.ts
apps/api/src/platform/http-exception.filter.ts
apps/api/src/platform/infrastructure.service.ts
apps/web/next.config.ts
package.json
packages/contracts/src/index.ts
packages/server/src/environment.test.ts
packages/server/src/environment.ts
packages/server/src/index.ts
packages/server/src/logger.ts
pnpm-lock.yaml
pnpm-workspace.yaml
scripts/smoke.mjs
```

Created:

```text
apps/api/src/auth/auth-context.controller.ts
apps/api/src/auth/auth-store.ts
apps/api/src/auth/auth.error.ts
apps/api/src/auth/auth.http.test.ts
apps/api/src/auth/context-throttle.service.ts
apps/api/src/auth/cookies.test.ts
apps/api/src/auth/cookies.ts
apps/api/src/auth/crypto.test.ts
apps/api/src/auth/crypto.ts
apps/api/src/auth/csrf.guard.ts
apps/api/src/auth/identity.test.ts
apps/api/src/auth/identity.ts
apps/api/src/auth/password-data/LICENSE
apps/api/src/auth/password-data/README.md
apps/api/src/auth/password-data/common-passwords.ts
apps/api/src/auth/password-data/generate.mjs
apps/api/src/auth/password.service.ts
apps/api/src/auth/password.test.ts
apps/api/src/auth/session.integration.test.ts
apps/api/src/auth/session.policy.test.ts
apps/api/src/auth/session.policy.ts
apps/api/src/auth/session.service.ts
apps/api/src/platform/prisma.service.ts
docs/PHASE1_STEP3_AUTH_RUNTIME.md
packages/server/src/auth-environment.test.ts
packages/server/src/auth-environment.ts
packages/server/src/logger.test.ts
scripts/init-auth-env.mjs
scripts/test-auth-integration.mjs
```

Local ignored setup artifact: `.env.auth.local` (secrets, never part of the diff).
`apps/web/next-env.d.ts` remains the user's existing `M` entry, excluded from Step 3.

## Review boundary

No schema blocker. No registration/login/logout/reset/OTP delivery, Owner bootstrap,
employee management, full role/permission runtime, auth UI or later business modules
were added. Production least-privilege database provisioning, email provider/key
setup, transient-row cleanup worker and deployment hardening remain later work.
Step 3 is ready for review; no staging, commit, push or Step 4 is authorized here.
