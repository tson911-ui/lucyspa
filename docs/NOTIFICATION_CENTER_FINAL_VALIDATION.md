# Notification Center — Final Validation Gate (Steps 1–4)

Status: **PASS — pending Owner review. Not committed, not pushed, not deployed. Production untouched.**
Scope: Steps 1–4 ([1](NOTIFICATION_CENTER_STEP1_FOUNDATION.md), [2](NOTIFICATION_CENTER_STEP2_ROUTING.md),
[3](NOTIFICATION_CENTER_STEP3_LEAVE_EVENTS.md), [4](NOTIFICATION_CENTER_STEP4_API_UI.md)), commits
`a2dca30`, `b61bb69`, `894c172`, `c213a36`. In-app only. Revenue Notifications are **deferred** to Phase 4.

All database work ran on local scratch PostgreSQL databases (never production, never `lucy_spa_dev` data
for destructive checks). No production migration or deployment was performed.

## Result per gate

| #   | Gate                                     | Result                               |
| --- | ---------------------------------------- | ------------------------------------ |
| 1   | Database / migration                     | **PASS**                             |
| 2   | Hierarchy routing                        | **PASS**                             |
| 3   | Leave events and consumer end to end     | **PASS**                             |
| 4   | API and security                         | **PASS**                             |
| 5   | Web VI/EN                                | **PASS** (automated; see limitation) |
| 6   | Phase 3 regression                       | **PASS**                             |
| 7   | Repo quality gates and production builds | **PASS**                             |
| 8   | Protected file / no deploy               | **PASS**                             |

Documented, unrelated exception: two `My Income` integration assertions fail only in the 15:00–17:00 UTC
window (see "Pre-existing finding").

## 1. Database / migration

- Clean DB: `db:generate`, `db:validate`, `db:deploy` applied all 25 migrations; `db:status` reports the
  schema up to date.
- `prisma migrate diff` (migrations → schema) exits 2 with **only** the known limitation: the composite
  `(team_id, branch_id)` foreign keys on `organization_assignments` / `team_memberships` are hand-written SQL
  that Prisma cannot model next to the single-column relation. It is not real drift and that diff must
  never be applied.
- `notifications`: `branch_id` nullable, `params` jsonb and `archived_at` nullable; CHECKs
  `notifications_type_check`, `notifications_entity_type_check`, `notifications_params_object`,
  `notifications_type_entity`, `notifications_branch_scope`; unique `(source_event_id, recipient_user_id)`.
- The migration contains no destructive statement (DROP TABLE/COLUMN, DELETE, TRUNCATE, type rewrite: none;
  the only `DROP` is `DROP NOT NULL` and replacing widened CHECKs).
- **Upgrade of a populated database:** the first 24 migrations were applied, then a customer user (with its
  profile), a branch, outbox events and three Phase 3 notifications (two unread, one read) were inserted; the
  last migration was then applied. All three rows, their types, branch links and read state were identical
  afterwards, with `params` and `archived_at` NULL. No data loss.
- Test-tooling note: a first attempt silently inserted nothing (customer users need their profile in the
  same transaction). It was discarded and redone correctly as above.

## 2–4. Routing, Leave events, API/security

Run against the fully migrated scratch database:

- `pnpm test:integration` (database package): **44/44 pass**.
- `pnpm test:auth:integration` (296 tests, includes routing, Leave, inbox, organization, bootstrap suites):
  **294 pass, 2 fail** — both in `My Income`, unrelated (below). Every notification suite passes:
  lowest-eligible-level routing, all same-level peers, escalation only when a level is empty, Owner only as
  final fallback, requester excluded; Leave event written in the same transaction as the request/decision,
  no reason/PII in event or notification, idempotent re-processing, failure injection rolls back and leaves
  the event pending; inbox ownership isolation, pagination, category/unread/archived filters, counts,
  read/archive idempotency, archived items not counted and untouched by mark-all, malformed/extra input and
  CSRF/origin.
- **New real-concurrency test** `apps/api/src/leave/leave-consumer.race.integration.test.ts` (kept): with
  committed data and several real connections, six workers racing for one event produce exactly one
  `PUBLISHED` and one notification per manager; six events swept by three concurrent workers are each
  processed exactly once; a failing consumer commits nothing, leaves the event pending, and a later worker
  completes it. It runs only when `NOTIFICATION_RACE_DATABASE_URL` names a scratch superuser database (like the
  Phase 3 race tests) and is skipped otherwise, so it is not part of the default auth-integration entry
  point. It **passed 3 of 3 runs** and cleaned up its rows (0 notifications/outbox/users left). The first
  build flagged three strict-typing errors in the file; they were fixed (types only) before the runs.
- Phase 3 relay isolation: the relay never claims/marks a Leave event; the Leave consumer ignores Booking and
  Phase 3 conflict events (`leave-relay-isolation.test`, pass).

## 5. Web

`pnpm test` web suite: **146/146**, covering bell/badge, inbox tabs, filters, archive/inbox switch,
mark one/all, load more and empty/error states as rendered markup and pure functions; Leave requested /
approved / rejected in VI and EN; Phase 3 rendering; Booking/Visit links; `/leave` link only for workforce
accounts (the leave page has no per-request route, so no deep link is invented). **Limitation:** no
browser/manual UI run was possible (the web tests are server-rendered markup and pure-function tests).

## 6. Phase 3 regression

Worker `booking-jobs.integration.test` (real PostgreSQL + Redis, scratch DB): all 9 scenarios pass
(START/END warnings, recovery, duplicate BullMQ delivery, reassignment recipients, branch DENY, late
cancellation, leave-conflict and reassignment consumers). Booking, visit, reassignment and service-execution
integration suites are inside the passing auth-integration run.

## 7. Quality gates and builds

| Command                        | Result                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`            | pass                                                                                                    |
| `pnpm lint` (+ boundaries)     | pass                                                                                                    |
| `pnpm typecheck`               | pass                                                                                                    |
| `pnpm test` (unit)             | pass: server 22/22, worker 8 pass + 1 skipped, web 146/146, API 148 pass + 47 skipped (need a database) |
| `pnpm build` (all deployables) | pass                                                                                                    |

## Pre-existing finding (not caused by Steps 1–4)

`apps/api/src/account/my-income.integration.test.ts` (test "2, 20, 23, 25") compares the default period date
with the Ho Chi Minh business date, but the member's income view appears to anchor on the furthest-ahead branch
timezone in the fixture (Asia/Tokyo). Between 15:00 and 17:00 UTC Tokyo is already on the next date, so
`'2026-09-30'` ≠ `'2026-09-29'` (cause inferred from the clock, not re-run outside the window). The gate ran at 15:13 UTC. No Steps 1–4 commit touches `apps/api/src/account`
or any income code (empty diff since before `a2dca30`), so no code was changed. Recommend fixing the fixture
clock separately; it is not a production defect.

## Defects and fixes in this gate

- No product defect found; **no production code changed**.
- The new race test file needed three type-only fixes before it built.

## Files changed by the gate

- New: `apps/api/src/leave/leave-consumer.race.integration.test.ts`, `docs/NOTIFICATION_CENTER_FINAL_VALIDATION.md`.
- Modified: `LUCYSPA_HANDOFF.md`.

## Awaiting production (Owner approval required)

- Migration: **`20261012000000_notification_foundation`** only (additive, non-destructive).
- Deployables affected: **API, Worker, Web**, and the packages `contracts`, `server`, `database` they bundle.
- Dependency/lockfile: `packages/server` now depends on the workspace package `@lucy-spa/contracts`
  (`pnpm-lock.yaml` +3 lines, already committed); no external dependency was added.
- Deployment outline: database backup → `pnpm db:deploy` → build server packages, API, Web, Worker →
  restart PM2 `lucyspa-api`, `lucyspa-web`, `lucyspa-worker` (the worker restart starts the Leave consumer).
  Existing Phase 3 notifications are preserved; no data backfill is required.

## Protected file and repository state

- `apps/web/next-env.d.ts`: unchanged by the production build (`git diff` empty); never staged.
- `git status`: only the new race test, this document and `LUCYSPA_HANDOFF.md` are pending; nothing committed,
  pushed or deployed.

## Deferred

Revenue Notifications (until Phase 4 supplies real Invoice/Payment data, events such as `INVOICE_PAID` and the
revenue authorization model), email and channel preferences, retention/hard delete, timer escalation,
migrating Phase 3 recipient routing, per-request leave deep link.
