# Phase 1 Step 2: authentication database schema and migration

Status: reviewed and **applied to the approved local database** on 2026-09-24.
Post-migration checks passed. Step 3 has not started.

This change implements section 11 of the approved
[authentication and security design](PHASE1_AUTH_SECURITY_DESIGN.md), within the
[PRD](../LUCY_SPA_PRD.md) and [handoff](../LUCYSPA_HANDOFF.md). It adds persistence
for identity, authentication, authorization and audit. It creates no accounts,
branches, role bundles, permission rows or other seed data. There are no new
runtime endpoints, email processors, login flows or business modules.

## Models and relationships

The [Prisma schema](../packages/database/prisma/schema.prisma) retains the Phase 0
`Branch` and `OutboxEvent` tables and adds these 15 models. All new foreign keys
use restrictive update and delete actions; none cascades identity or audit history.
Record identities use UUIDs, authoritative timestamps use `timestamptz(3)`, and
dates of birth use PostgreSQL `date`.

| Model                      | Purpose and relationships                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User`                     | Immutable CUSTOMER, EMPLOYEE or OWNER principal; credentials, globally unique non-null canonical email/phone, verification state and credential/authorization/row versions.          |
| `CustomerProfile`          | Exactly one profile for a CUSTOMER, keyed by its User; required date of birth and address.                                                                                           |
| `EmployeeProfile`          | Exactly one profile for an EMPLOYEE, keyed by its User; unique canonical staff code, date of birth, address and nullable nonnegative bigint salary in VND, without a salary default. |
| `EmployeeBranchAssignment` | EmployeeProfile-to-Branch membership with a User grantor; revoked assignments remain as history.                                                                                     |
| `RegistrationIntent`       | Expiring candidate identity/profile and password hash; optional completed User link. Candidate email/phone are deliberately nonunique and do not reserve User identities.            |
| `AuthChallenge`            | Activation, reset, recovery-email verification or employee setup; exactly one RegistrationIntent or User subject, capability digest, purpose binding, attempts and deadlines.        |
| `AuthDelivery`             | One encrypted email delivery per challenge/generation, with bounded expiry, retry and lease metadata.                                                                                |
| `Session`                  | Anonymous or authenticated opaque-token digest; only authenticated sessions reference a User and its credential/authorization versions.                                              |
| `AuthThrottleBucket`       | Pseudonymous identity/IP rate-limit counters and independent cooldown buckets; no User FK or raw unknown identifier.                                                                 |
| `Role`                     | Configurable named bundle with active state and row version; OWNER is reserved and prohibited.                                                                                       |
| `Permission`               | One of the ten reviewed Phase 1 permission codes, with code-owned scope capability and data classification.                                                                          |
| `RolePermission`           | Composite-key Role-to-Permission relationship.                                                                                                                                       |
| `UserRoleAssignment`       | EMPLOYEE-to-Role grant in GLOBAL or explicit BRANCH scope.                                                                                                                           |
| `UserPermissionOverride`   | EMPLOYEE-to-Permission ALLOW or DENY in GLOBAL or explicit BRANCH scope.                                                                                                             |
| `AuditEvent`               | Permanent append-only event with optional actor/subject User and Branch references, classification and before/after JSON objects.                                                    |

The twelve enums describe principal kind/status, locale, challenge purpose,
delivery/session state, scope kind/capability, permission effect/code, audit actor
kind and data classification. They do not introduce a production role-power matrix.
All reviewed Phase 1 permissions are branch-capable; shared role editing still
requires GLOBAL `MANAGE_PERMISSIONS` in the later authorization implementation.

Branch gains inverse Prisma relations only. Its stored columns, existing indexes,
timezone default and Phase 0 migration are unchanged. Outbox storage is unchanged:
future authentication events reference a delivery ID in the existing versioned
payload, without a new FK or secret-bearing generic payload.

## Migration and impact

New migration:
[`20260923000000_phase1_auth_identity_authorization_audit`](../packages/database/prisma/migrations/20260923000000_phase1_auth_identity_authorization_audit/migration.sql).

The migration adds 15 empty tables, 12 enums, indexes, restrictive foreign keys,
CHECK constraints and protective functions/triggers. It performs no Phase 0 data
updates, inserts or deletes and no destructive DDL. Existing migration history is
unchanged. No seed, database reset, volume removal or environment rewrite is part
of this step.

Applying this migration is a database schema change. Creating references to existing
`branches` may briefly acquire locks on that table; review scheduling and database
privileges before applying to any other database with active traffic. After explicit
Owner approval, the unchanged migration was applied using `prisma migrate deploy`
to local `lucy_spa_dev` at `127.0.0.1:5432`, schema `public`. Its successful completion
was recorded at `2026-09-24T00:01:45.076Z`. No other database deployment is claimed.

## SQL safeguards beyond Prisma

The migration retains SQL-only constraints explicitly. Future Prisma migrations
must preserve these custom checks, partial indexes and triggers rather than
assuming the Prisma model captures every invariant.

- Canonical identity storage checks, positive versions, nonblank required fields,
  E.164 phone shape and Argon2id hash shape supplement later maintained runtime
  validators. Customer requires ACTIVE status, verified email, phone and password;
  Owner requires ACTIVE status, email and password. Employee password requirements
  follow ACTIVE/PENDING_SETUP/INACTIVE state.
- A partial unique index permits at most one Owner. User ID/kind are immutable,
  User deletion/truncation is rejected, and Owner insertion requires a separate
  bootstrap privilege. Zero Owner rows remain valid before explicit bootstrap.
- Deferred constraint triggers check the final transaction state for exactly the
  profile matching each principal kind. Profile ownership cannot be moved.
- Partial indexes allow only one active employee membership per branch. Membership
  identity, original grant and completed revocation cannot be rewritten or deleted.
- Role/override scopes require null branch for GLOBAL and a Branch FK for BRANCH;
  separate partial unique indexes prevent duplicate global and branch grants.
  Only employees may receive mutable roles or overrides. Permission code semantics
  are fixed, including restricted employee-pay classification.
- Registration candidates and their expiry are immutable; completion must identify
  their matching customer. Terminal intent and challenge states cannot reopen.
  Challenges bind immutable purpose, subject, delivery address and flow deadline.
  Failed attempts cannot decrease or exceed the limit; resends increment generation
  without extending the flow or resetting the budget. An actionable partial index
  covers identity/purpose until consumption or explicit invalidation, including
  expired rows awaiting invalidation under the later issuance lock protocol.
- Employee setup uses its high-entropy capability without email, OTP verifier or
  code timestamps, and records both credential and authorization versions. Email
  challenges use 32-byte keyed verifier digests and separate code/flow deadlines.
- Deliveries bind to an email challenge generation and deadline. A leased delivery
  stays PENDING; DELIVERED, FAILED, INVALIDATED and EXPIRED are terminal. Terminal
  transitions require ciphertext, nonce, tag, encryption key version and lease
  material to be cleared. Retries cannot replace the encrypted code payload.
- Session subject/version fields distinguish anonymous and authenticated state.
  Rotation requires a new row, activity cannot move backward, and revocation cannot
  be undone. Capability/session/pseudonym digests and delivery lease tokens are
  32 bytes; AES-GCM nonce/tag storage is 12/16 bytes respectively.
- Fixed counter windows have positive `windowSeconds` and no cooldown field.
  A separate cooldown bucket uses `windowSeconds = 0`, Unix epoch
  `1970-01-01T00:00:00Z` as its fixed window start, zero count and `nextAllowedAt`.
  Counter/cooldown values cannot decrease, so ordinary window rollover cannot
  silently reset the independently persisted cooldown.
- Audit actor shape, object-shaped snapshots and salary-event classification are
  checked. UPDATE, DELETE and TRUNCATE are rejected. Indexes support time, actor,
  subject, entity and branch/action queries without changing audit access policy.

SQL shape checks do not prove mailbox/phone ownership, perform cryptography or
replace authorization. Pseudonym key rotation still requires the approved protocol
to preserve live uniqueness and budgets across versions.

## Database privileges and later runtime work

Provision distinct migration, runtime and bootstrap database credentials before
trusting the production security boundary. No database roles, login credentials or
role memberships are provisioned by this migration.

`lucy_owner_bootstrap_capability()` is an inert privilege marker with PUBLIC
EXECUTE revoked. Its EXECUTE permission must be granted only to the dedicated
bootstrap principal; the ordinary runtime principal must not inherit it. The
migration/table owner is privileged and is not suitable as a runtime identity.

Runtime credentials must not own protected tables or have DDL/trigger-bypass
rights. Audit privileges are limited to INSERT and appropriately controlled SELECT,
with no UPDATE, DELETE or TRUNCATE. Revoking PUBLIC rights and installing triggers
does not establish least privilege for a separately provisioned runtime role or
claim protection against the database administrator.

Step 3 and later authorized work must implement password hashing and normalization,
session/CSRF checks, purpose-specific cryptographic verification, transaction-time
authorization, stable lock ordering, delegation checks, authz/credential version
increments and affected-session/challenge invalidation. Sensitive writes and their
allowlisted audit events must commit together; database JSON shape checks do not
redact secrets or enforce per-action before/after allowlists. Audit reads still
need branch/global and employee-pay permissions.

No cleanup worker is introduced. Later bounded cleanup of eligible transient rows
must delete dependent deliveries, then challenges, then registration intents in
that order, with appropriate expiry/terminal checks. Secret digests in terminal
challenge rows disappear when those rows are cleaned up. Permanent User, employee
membership and audit history are not cleanup targets. Numeric lifetimes and
attempt budgets remain validated runtime security configuration.

## Validation

The added integration suite exercises the migration SQL in a randomly named,
isolated PostgreSQL schema inside one transaction. Both Phase 0 and Phase 1 DDL
and every fixture row are rolled back. Savepoints isolate expected failures and
`SET CONSTRAINTS ALL IMMEDIATE` exercises deferred profile checks without commit.
It does not deploy a migration, write Prisma migration-ledger rows or modify
existing application tables.

Verified on 2026-09-24:

| Check                                                                                                          | Result                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm --filter @lucy-spa/database exec prisma validate`                                                        | PASS                                                                                 |
| Offline `prisma migrate diff --from-schema <Phase 0 snapshot> --to-schema prisma/schema.prisma --script`       | PASS; generated additive SQL, then added reviewed SQL-only safeguards                |
| `pnpm --filter @lucy-spa/database exec prisma generate`                                                        | PASS; generated client remains ignored                                               |
| `pnpm exec tsc -p <package>/tsconfig.json` for database, API, worker and server                                | PASS                                                                                 |
| `node --test packages/database/dist/auth-schema.integration.test.js`                                           | PASS: 16 tests, no failures or skips, including restricted-role bootstrap/DDL checks |
| `node --test packages/database/dist/database.integration.test.js`                                              | PASS: all 3 existing Phase 0 database checks                                         |
| `node --test "apps/api/dist/**/*.test.js" "apps/worker/dist/**/*.test.js" "packages/server/dist/**/*.test.js"` | PASS: all 12 existing backend tests                                                  |
| Repository ESLint and `node scripts/check-boundaries.mjs`                                                      | PASS                                                                                 |
| Prettier on changed JSON/TypeScript/Markdown; Prisma formatter                                                 | PASS                                                                                 |
| `git diff --check`                                                                                             | PASS                                                                                 |

Before deployment, read-only inspection confirmed that the configured database had only
`branches`, `outbox_events` and `_prisma_migrations`, with only
`20260916000000_phase0_foundation` applied. Both application tables had
zero rows. The new test suite verifies unchanged table/ledger counts and schema
inventory after rollback, and verifies its temporary schema and NOLOGIN test role
no longer exist. It never commits or changes application migration metadata.

The current local development connection has superuser privileges. This does not
meet the later production runtime privilege requirement. The restricted-role test
creates its own temporary role and grants inside the rolled-back transaction to
exercise the database boundary; no persistent role or grant is provisioned.

The original Phase 0 migration and the pre-existing `apps/web/next-env.d.ts` have
the same Git content hashes as at task start. No web build or Next type generation
was run. The Owner authorized the Step 2 commit and push after the local migration
and post-migration verification; the generated web file is excluded.

## Local deployment and post-migration verification

Only `20260923000000_phase1_auth_identity_authorization_audit` was newly applied.
`20260916000000_phase0_foundation` remains applied and unchanged. Both migration
checksums match their files, with zero failed or pending migrations.

| Post-migration check                                                                        | Result                                                                                                                            |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate status`                                                                     | PASS: database schema is up to date                                                                                               |
| `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | PASS: no difference, exit 0                                                                                                       |
| PostgreSQL catalog and enum-value checks                                                    | PASS: all 15 new tables and 12 enums present and matching                                                                         |
| SQL-only constraint/index/trigger checks                                                    | PASS: 43 validated CHECKs, 21 validated FKs, 60 valid indexes including 7 partial indexes, 21 enabled triggers                    |
| Function privileges and search paths                                                        | PASS: all 13 functions SECURITY INVOKER with pinned paths and no PUBLIC EXECUTE; bootstrap marker has no non-owner EXECUTE grants |
| Prisma Client read-only smoke check                                                         | PASS: queries against all 17 models, including the 15 new models                                                                  |
| Data preservation                                                                           | PASS: Phase 0 tables remain empty; new tables are empty; no seeds or business-data changes                                        |
| File preservation                                                                           | PASS: prepared schema/migration hashes and `next-env.d.ts` unchanged                                                              |

No full test rerun was needed for deployment of the already tested, unchanged SQL.
Production runtime/migration/bootstrap privilege separation remains a later
deployment prerequisite; applying locally does not provision those credentials.

PostgreSQL's [constraint-trigger documentation](https://www.postgresql.org/docs/17/sql-createtrigger.html)
and [function privilege/search-path documentation](https://www.postgresql.org/docs/17/sql-createfunction.html)
were consulted for the SQL-only protections. These do not replace the deployment
privilege review or later application security tests.

## Review boundary

Step 2 has been reviewed, deployed locally and verified. Stop here; runtime
authentication and authorization work requires separate Step 3 authorization.
Loyalty, Booking and POS remain outside this change. Applying this migration to
another database also requires authorization for that target.
