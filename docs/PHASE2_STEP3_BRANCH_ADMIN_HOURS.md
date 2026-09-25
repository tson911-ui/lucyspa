# Phase 2 Step 3: branch administration and business hours

Status: **CLOSED** (Owner-approved; commit `feat: add branch administration and business
hours`). Nothing was deployed to production. Baseline is `fe16dc0`. The work is backend/API only.

This builds on the [Step 2 database foundation](PHASE2_STEP2_DATABASE_FOUNDATION.md),
which also records the Step 1 contract and decisions. The PRD basis is section 4.3
(09:00–21:00 default, configurable per branch), section 5 (branch model) and section
43.2 (branch-local time).

## Scope implemented

- **Branch administration**, using the existing `Branch` model:
  - create;
  - scoped list and detail;
  - rename and change timezone;
  - activate and deactivate.

  Branches are **never deleted**. The code is immutable after creation.

- **Default business hours:** creation inserts seven rows (Monday–Sunday,
  09:00–21:00, no lunch closure) **in the same transaction**. They are ordinary rows,
  editable afterwards.
- **Business hours management:** each weekday is open with `opensAt`/`closesAt`
  (`HH:MM`, branch-local wall clock; `24:00` allowed only as a closing time) or
  closed. Weekdays not listed in an update are left unchanged. A branch created before
  Phase 2 (development seed) can be configured too, because missing days are inserted.
- **Timezone rule:** set at creation (default `Asia/Ho_Chi_Minh`). It may change only
  while the branch has **no attendance records**; otherwise 409 `CONFLICT`
  (`timezone`). Historical attendance is never rewritten. A zone must pass the IANA
  syntax and `Intl` checks **and** exist in PostgreSQL's `pg_timezone_names`, because
  the attendance business-date trigger uses the database's zone list.

**One additive migration was needed and is Owner-approved:**
`20260926000000_phase2_branch_row_version`.
The Phase 0 `branches` table had no version column, so the repository's
`expectedVersion` / 409 convention couldn't apply. The migration adds `row_version`
(default 1) with a positive CHECK. Existing rows start at 1 and no data changes. It
was applied to the **local development database only**; the drift check against
`schema.prisma` is empty.

## API (under `/api/v1/branches`)

| Route              | Body                                         | Authorization                                                          | Result         |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------- | -------------- |
| `GET /`            | —                                            | Workforce session; scoped (see below)                                  | `{ branches }` |
| `GET /:id`         | —                                            | Visible branch, otherwise 404                                          | Branch + hours |
| `POST /`           | `code, name, timezone?, isActive?, reason?`  | **GLOBAL** `MANAGE_BRANCHES`                                           | 201            |
| `POST /:id`        | `expectedVersion, name?, timezone?, reason?` | `MANAGE_BRANCHES` for that branch                                      | 200            |
| `POST /:id/status` | `expectedVersion, isActive, reason`          | **GLOBAL** `MANAGE_BRANCHES`, plus an escalation check for each member | 200            |
| `POST /:id/hours`  | `expectedVersion, days[1–7], reason?`        | `MANAGE_BRANCHES` for that branch                                      | 200            |

- **Branch fields:** `id`, `code`, `name`, `timezone`, `isActive` and `version`. The
  detail read adds `hours`, Monday first.
- **One version for the whole branch:** `version` covers the branch **and** its hours.
  Every command bumps it, so one `expectedVersion` protects the whole aggregate.
- **Strict DTOs:** unknown fields are rejected, so `code` and version fields can't be
  sent in updates. Times must be `HH:MM`, and weekdays 1–7.
- **Errors:** `VALIDATION_FAILED` (safe field names), `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT` (stale version, duplicate code, unchanged status, or a timezone change
  after attendance) and `AUTHENTICATION_REQUIRED`.

## Authorization and branch scope

All of this uses the Phase 1 engine through the shared admin frame
(`runAdminCommand`), with transaction-time authorization. Customers get 403 and
anonymous callers 401.

**Reads:**

- An actor with GLOBAL `MANAGE_BRANCHES`, including the Owner, sees every branch,
  active or inactive.
- Any other workforce actor sees only the **active branches they are a member of**,
  which they need operationally.
- An invisible branch returns 404.

**Rename, timezone and hours:** `requireAcross(MANAGE_BRANCHES, [branch])`. A branch
grant works only with active membership, so an inactive branch needs a GLOBAL grant.

**Activation and deactivation are security-graph changes.** The engine counts only
memberships in active branches, so flipping a branch changes every member's effective
authority. The command therefore:

- takes the **exclusive** graph lock first, then locks the actor and all members by
  UUID, then the branch row;
- requires GLOBAL `MANAGE_BRANCHES`;
- compares each member's authority before and after with `checkGraphChange`, so a
  non-Owner can't revive authority they don't hold and can't flip a branch they
  belong to;
- calls `invalidateAuthorization` to bump each member's `authzVersion` and revoke
  their sessions.

**Owner:** passes the permission checks through the existing Owner semantics. It is
never a branch member.

## Audit and concurrency

These are append-only audit events, written in the same transaction:

| Action                  | Contents                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `BRANCH_CREATED`        | code, name, timezone, active flag, default-hours summary                            |
| `BRANCH_UPDATED`        | before/after of changed fields only (name, timezone)                                |
| `BRANCH_STATUS_CHANGED` | before/after active flag and the number of affected members; the reason is required |
| `SESSIONS_REVOKED`      | one per member with sessions, reason `BRANCH_STATUS_CHANGED`                        |
| `BRANCH_HOURS_CHANGED`  | before/after of changed weekdays only (`HH:MM`, or "not configured")                |

Every event carries the actor, `entityType Branch`, the branch ID and the request ID.
No secrets or personal data are included.

**Concurrency:** `expectedVersion` against `branches.row_version`, with 409 on a stale
value. Branch rows are locked `FOR UPDATE` after the frame's User locks. An unchanged
update is rejected (`VALIDATION_FAILED`), so empty audit events never occur.

## Tests and checks

| Check                                                                                         | Result                   |
| --------------------------------------------------------------------------------------------- | ------------------------ |
| Migration applied locally (`migrate deploy`); drift `migrate diff` to `schema.prisma`         | Applied; drift **empty** |
| Branch integration test (real PostgreSQL, each command in its own savepoint, all rolled back) | **PASS 7** (6 subtests)  |
| Branch HTTP contract test                                                                     | PASS 1                   |
| Every HTTP suite that boots `AppModule` (rerun because the module changed)                    | PASS 27                  |
| Builds: database, contracts, API; web `tsc --noEmit` (writes nothing)                         | PASS                     |
| ESLint, Prettier and the boundary check on changed files                                      | PASS                     |

**The integration test covers:**

- **Creation:**
  - code normalization (`q1-x` becomes `Q1-X`), name trimming, the default timezone;
  - version 1 and exactly seven 09:00–21:00 rows (540–1260 minutes);
  - the audit with actor and reason;
  - duplicate, invalid and blank codes and names rejected; an unknown zone rejected;
  - branch-scoped managers, customers and anonymous callers refused.
- **Atomicity:** the seventh default day is made to fail through a temporary
  `NOT VALID` CHECK inside a savepoint, and neither the branch nor any hours row
  remains.
- **Scoped reads:**
  - branch manager and plain member see only their branch;
  - the other branch is 404;
  - the global administrator sees all;
  - customers are refused.
- **Rename:**
  - version bump, stale 409 and the before/after audit;
  - another branch is 404, and an unchanged value is rejected.
- **Timezone:**
  - changes are allowed before attendance and audited, and an invalid zone is
    rejected;
  - **after an attendance record exists, a change is 409** and the stored zone is
    unchanged, while renaming still works.
- **Hours:**
  - closing Sunday and setting Monday 10:00–24:00 leaves other days unchanged, bumps
    the version and records the before/after audit;
  - rejected: open ≥ close, a missing time, a closed day with times, `24:00` opening,
    weekday 8, no change, stale version, and another branch;
  - a legacy branch with no rows gets configured.
- **Activation:**
  - a branch-scoped manager is refused;
  - GLOBAL deactivation takes the exclusive lock, revokes the member's session, bumps
    `authzVersion` and audits the affected-member count;
  - the same status is 409;
  - a non-Owner GLOBAL manager can't reactivate a branch that would revive authority
    they lack;
  - the administrator reactivates; the branch is never deleted.

The postcheck confirms the branch count and users are unchanged and no Owner was
created. The Step 2 schema test and the other Phase 1 suites were not rerun: they
don't exercise the changed code, and the new migration is additive and drift-checked.

## Files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/app.module.ts                         (registers the branch controller and service)
packages/contracts/src/index.ts                    (branch contracts)
packages/database/prisma/schema.prisma             (Branch.rowVersion)
scripts/test-auth-integration.mjs                  (adds the branch integration test)
```

Created:

```text
apps/api/src/branches/branch.controller.ts
apps/api/src/branches/branch.http.test.ts
apps/api/src/branches/branch.input.ts
apps/api/src/branches/branch.integration.test.ts
apps/api/src/branches/branch.service.ts
packages/database/prisma/migrations/20260926000000_phase2_branch_row_version/migration.sql
docs/PHASE2_STEP3_BRANCH_ADMIN_HOURS.md
```

## Known limitations and deferrals

- **Timezone race with attendance.** The "no attendance" check and the timezone change
  happen under the branch row lock. Step 7 attendance writes must also take that lock
  (`FOR SHARE`) so a check-in can't race a timezone change.
- **Legacy branches** created by the development seed have no hours until configured.
  Branches created through the API always have seven.
- **Not implemented, as instructed:**
  - split shifts, lunch breaks, holiday or special-date overrides;
  - booking availability or closing-time checks (Phase 3);
  - UI (Step 9);
  - production branch creation or deployment.
- **Production deployment** will need `pnpm db:deploy` (both Phase 2 migrations) and
  `pnpm db:permissions:sync`. Only then can the Owner create the real first branch
  through the API; its name and code are Owner input.

## Recommended Step 4 scope

**Service management**:

- **Categories** (`MANAGE_SERVICES`, GLOBAL): create, update, activate and deactivate.
- **Services:**
  - code, names, descriptions, category, `durationMinutes` and the active flag under
    `MANAGE_SERVICES`;
  - the price under **GLOBAL_ONLY `MANAGE_SERVICE_PRICES`** only, as a separate
    command, always audited with before/after (PRD 8.3).
- **Service↔branch availability:** explicit rows, no row means not offered.
  **Owner decision (recorded at Step 3 close):**
  - a branch-scoped `MANAGE_SERVICES` grant **may toggle availability for that
    authorized branch only**;
  - it must **not** authorize changes to global/master service configuration: name,
    category, internal duration, other global metadata, or price;
  - master service configuration requires GLOBAL `MANAGE_SERVICES`;
  - price changes remain protected by GLOBAL_ONLY `MANAGE_SERVICE_PRICES`.
- **Eligible skills:** **deferred to Step 5** (Owner decision), together with the skill
  catalog.
- **Reads:** scoped lists and details. Durations are internal, not for any public
  menu.
- **Tests:** HTTP and rolled-back integration.
- **Out of scope:** tour, points, booking and UI.
