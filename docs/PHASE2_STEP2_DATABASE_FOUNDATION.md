# Phase 2 Step 2: database foundation

Status: **implemented and validated locally; awaiting Owner review.** Nothing is
committed, pushed or deployed. Baseline is `ea60807`.

Phase 2 (PRD section 56) covers services, skills, employee skills, branch assignments,
attendance, leave and business hours/settings. Step 1 was analysis only. This step adds
only the **additive database and permission foundation**: no API, UI, seed data or
business logic.

## Owner decisions applied (from Step 1)

| #   | Decision                                                                                                                  | How the schema reflects it                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| H2  | The existing `EmployeeBranchAssignment` is the single source of truth for operational and authorization branch assignment | No new assignment model                                                                |
| H3  | Real branch administration comes later; no hard-coded branch or production data                                           | No rows seeded                                                                         |
| H4  | A service may have several eligible skills; ANY one qualifies                                                             | `service_skills` relation only; qualification is Phase 3                               |
| H5  | Explicit service↔branch availability; no row means the service is not offered there                                       | `service_branch_availability` with `is_active`                                         |
| H6  | One concrete `durationMinutes` per service; 30/60 offerings are separate services                                         | Single column, no range                                                                |
| H7  | One attendance record per employee, branch and business date; no breaks                                                   | Unique key; no break model                                                             |
| H8  | Whole-day leave; an employee may cancel only PENDING; manager handling later                                              | Date columns; status machine allows APPROVED → CANCELLED for the later authorized flow |
| H9  | Settings limited to what Phase 2 needs                                                                                    | Only `branch_operating_hours`; no generic settings framework                           |

## Step 1 design contract (summary)

Phase 2 Step 1 was a read-only analysis on baseline `ea60807`; it changed no files.
Its conclusions still govern the later steps:

- **Reuse Phase 1, don't rebuild it.** That covers:
  - `User` and `EmployeeProfile` and the employee admin API;
  - `EmployeeBranchAssignment`;
  - the Step 7 engine (`decide`, `decideAcross`, `checkContainment`,
    `checkGraphChange`);
  - the shared admin command frame (`runAdminCommand`, `requireAcross`,
    `appendAdminAudit`) and append-only audit with branch-scoped reads;
  - the patterns: `expectedVersion`, safe error codes, strict DTOs, bigint VND,
    `timestamptz`, branch timezone.
- **H1: UI.** Phase 1 shipped API only. There is no web login, session/CSRF client or
  dashboard shell. Phase 2 will include a workforce login and dashboard UI in a later
  step (Step 9), so the Owner can verify workflows (PRD section 57).
- **Branch administration.** Branches can only be created by the development seed.
  Real branch administration comes first (Step 3); the initial branch name and code
  are Owner input.
- **Phase boundary.** Phase 2 records facts only: services, durations, skills,
  assignments, attendance, leave and hours. Phase 3 consumes them. The availability
  engine, derived KTV status, booking, Any-KTV, queue, visits, walk-ins, Start/End,
  warnings, closing-time booking checks, leave-vs-booking conflicts, reassignment and
  notifications all stay out of Phase 2.
- **Adjusted Phase 2 plan:**
  1. Design contract.
  2. Database foundation (this report).
  3. Branch administration and business hours/settings.
  4. Service management.
  5. Skills and employee skills.
  6. Operational branch assignments (reusing membership).
  7. Attendance.
  8. Leave.
  9. Dashboard/auth shell and Phase 2 admin/employee UI.
  10. Completion gate and production deployment.

## Entities

| Table                         | Purpose and key columns                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service_categories`          | `code` (unique), `name_vi`/`name_en`, `sort_order`, `is_active`, `row_version`, timestamps                                                                        |
| `services`                    | `code` (unique), `category_id`, names, optional descriptions, **`price_vnd` bigint**, **`duration_minutes`** (internal, never public), `is_active`, `row_version` |
| `skills`                      | `code` (unique), names, `is_active`, `row_version`                                                                                                                |
| `service_skills`              | (service, skill) primary key: the eligible skills                                                                                                                 |
| `service_branch_availability` | (service, branch) primary key, `is_active`, `row_version`                                                                                                         |
| `employee_skills`             | Employee (FK to `employee_profiles`), skill, `granted_at`, `granted_by_user_id`, `revoked_at`; keeps history like branch memberships                              |
| `branch_operating_hours`      | Branch, `iso_weekday` (1 = Monday … 7 = Sunday), `is_closed`, `opens_at_minute` / `closes_at_minute` (**branch-local wall-clock minutes**, not UTC instants)      |
| `attendance_records`          | Employee, branch, `business_date` (DATE), `check_in_at`, nullable `check_out_at`, `row_version`                                                                   |
| `leave_requests`              | Employee, `start_date` / `end_date` (DATE), `reason`, `status` (new enum `LeaveStatus`), `requested_at`, decision fields, cancellation fields, `row_version`      |

Conventions follow Phase 1: UUID keys, `timestamptz(3)`, restrictive foreign keys (no
cascading deletes), `row_version` for optimistic concurrency, and bigint VND.

**Deliberately absent:**

- tour configuration and loyalty point eligibility on services (Phases 7 and 5);
- a price-history table (price changes are audited; invoices snapshot prices in
  Phase 4);
- leave types, quotas, balances and pay effects;
- breaks and shifts;
- booking settings (advance horizon, late hold, warnings);
- operational status (AVAILABLE, BOOKED and so on), which Phase 3 derives.

## Permissions

The seven new codes extend the existing catalog. The engine is unchanged, and
existing codes are reused for branch assignment (`MANAGE_EMPLOYEE_SCOPE`) and employee
reads (`VIEW_EMPLOYEES`).

| Code                    | Scope capability | Intended use (implemented in later steps)                                                                      |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `MANAGE_BRANCHES`       | BRANCH_CAPABLE   | GLOBAL: create or activate branches. Branch grant: that branch's hours and settings                            |
| `MANAGE_SERVICES`       | BRANCH_CAPABLE   | GLOBAL: categories and services (catalog-wide). Branch grant: availability at that branch, if Step 4 allows it |
| `MANAGE_SERVICE_PRICES` | **GLOBAL_ONLY**  | Service prices (PRD 8.3): one price for every branch                                                           |
| `MANAGE_SKILLS`         | BRANCH_CAPABLE   | GLOBAL: the skill catalog. Target's branches: employee-skill grants                                            |
| `VIEW_ATTENDANCE`       | BRANCH_CAPABLE   | Reading attendance for a branch                                                                                |
| `MANAGE_ATTENDANCE`     | BRANCH_CAPABLE   | Audited attendance corrections                                                                                 |
| `APPROVE_LEAVE`         | BRANCH_CAPABLE   | Approving and rejecting leave for employees of that branch                                                     |

The engine already refuses a branch grant for a GLOBAL action, so catalog-wide
actions need GLOBAL grants whatever the capability label says. Only price authority is
labeled GLOBAL_ONLY.

**Synchronized representations:**

- the PostgreSQL `PermissionCode` enum (in the migration);
- `PERMISSION_CATALOG` in `@lucy-spa/database`;
- `PermissionCodeName` in `@lucy-spa/contracts`;
- the DB catalog CHECK.

**CHECK change (smallest safe change).** The Phase 1 constraint
`permissions_phase1_catalog_semantics` required every code to be BRANCH_CAPABLE. It is
replaced by `permissions_catalog_semantics`, which is identical except that exactly
`MANAGE_SERVICE_PRICES` must be GLOBAL_ONLY. The pay classification rule is unchanged.

**New trigger.** A branch-scoped override of a GLOBAL_ONLY permission is refused, since
it could never take effect. To match, `RoleAdminService.setOverride` now rejects it
with 400 `VALIDATION_FAILED` (`scope`) instead of letting the database error surface
as 503. This is the only application-code change.

**Operator action at deployment (not done here):** run `pnpm db:permissions:sync`.
It inserts the 7 new rows and verifies the 10 existing ones.

## Migration

`packages/database/prisma/migrations/20260925000000_phase2_services_skills_operations/migration.sql`
is one additive migration.

- **DDL** is generated by `prisma migrate diff` from the updated `schema.prisma`, then
  reviewed.
- **`PermissionCode` is rebuilt in place** instead of using `ALTER TYPE … ADD VALUE`.
  PostgreSQL can't use a newly added label in the transaction that adds it, and both
  the new CHECK and the schema test need the labels immediately. The steps are: drop the
  Phase 1 CHECK, rename the old type, create the full type, cast `permissions.code` by
  label, drop the old type, then add the new CHECK. `permissions.code` is the type's
  only column, and existing rows, ids and the unique index are preserved (tested).
- **No `DROP` of data**, no data rewrite except the label cast, and no seed rows.

**SQL-only invariants** (the migration says they must be retained):

- canonical uppercase codes, non-blank names and descriptions, `sort_order` ≥ 0,
  positive `row_version`;
- `price_vnd` ≥ 0; `duration_minutes` from 1 to 1440;
- `employee_skills`:
  - only one active (skill, employee) pair, through a partial unique index;
  - revocation is one-way and can't precede the grant;
  - the grant facts are immutable;
  - rows can't be deleted or truncated;
- `branch_operating_hours`: the ISO weekday is 1–7; closed days carry no times; open
  days need 0 ≤ open < close ≤ 1440; one row per branch and weekday;
- `attendance_records`:
  - one row per (employee, branch, business date);
  - check-out must be strictly after check-in;
  - `business_date` must equal the check-in's calendar date in the branch timezone
    (trigger);
  - a record can't move to another employee;
  - no truncate.

  Deletion is left to the application, for later audited corrections.

- `leave_requests`:
  - the end date is on or after the start date; text fields are non-blank;
  - decision and cancellation fields must match the status;
  - **nobody decides their own leave**;
  - the timeline is ordered;
  - a trigger allows only these transitions:

    | From      | To                                            |
    | --------- | --------------------------------------------- |
    | PENDING   | PENDING (edit), APPROVED, REJECTED, CANCELLED |
    | APPROVED  | CANCELLED                                     |
    | REJECTED  | (terminal)                                    |
    | CANCELLED | (terminal)                                    |

  - request facts are frozen once decided;
  - no delete or truncate.

  Inserts are not restricted to PENDING, so a later manager workflow can record leave
  directly.

**Local application only.** The migration was applied to the **local development
database** with `prisma migrate deploy` so the dependent tests could run. **Production
was not touched.**

## Tests and checks

| Check                                                                                                | Result                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------- |
| `prisma validate`, `prisma format`                                                                   | PASS                            |
| `prisma migrate deploy` (local dev DB), then `migrate status`                                        | Applied; up to date             |
| Drift: `prisma migrate diff` from the migrated DB to `schema.prisma`                                 | **Empty**: schema and SQL match |
| New `phase2-schema.integration.test` (isolated schema, rolled back)                                  | **PASS 10** (9 subtests)        |
| Step 7 authorization unit tests (catalog assertion updated to 17)                                    | PASS 8                          |
| Authorization and role-admin integration (catalog sync now 17; new GLOBAL_ONLY branch-override case) | PASS 12                         |
| Builds: database, contracts, server, API; worker typecheck; web `tsc --noEmit` (writes nothing)      | PASS                            |
| ESLint, Prettier (changed files), boundary check                                                     | PASS                            |

**The schema test proves:**

- Phase 1 permission rows keep their ids through the enum rebuild, and the temporary
  type is gone;
- the enum labels equal the code catalog;
- `MANAGE_SERVICE_PRICES` must be GLOBAL_ONLY; other Phase 2 codes must be
  BRANCH_CAPABLE and STANDARD; the pay rule is intact;
- a GLOBAL_ONLY branch override is refused, while GLOBAL and ordinary branch overrides
  are allowed;
- service price, duration, code, name and description rules, uniqueness and restrictive
  FKs;
- service-skill and branch-availability keys and FKs;
- employee-skill single active grant, re-grant after revocation, immutable history, no
  delete, and employees only;
- every operating-hours rule;
- attendance: the branch-timezone business date (00:30 local next day), one per day,
  a second branch allowed, check-out ordering, employee immutability, and employees only;
- leave: every CHECK and every allowed and refused transition.

**Not rerun:** the other Phase 1 suites and the Phase 0 tests, which don't exercise the
changed code.

## Files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/authorization/authorization.integration.test.ts   (catalog size)
apps/api/src/authorization/authorization.test.ts               (catalog listing)
apps/api/src/authorization/role-admin.integration.test.ts      (catalog size; GLOBAL_ONLY case)
apps/api/src/authorization/role-admin.service.ts               (reject GLOBAL_ONLY branch override)
packages/contracts/src/index.ts                                (PermissionCodeName)
packages/database/package.json                                 (test:integration includes the new test)
packages/database/prisma/schema.prisma
packages/database/src/permission-catalog.ts
```

Created:

```text
packages/database/prisma/migrations/20260925000000_phase2_services_skills_operations/migration.sql
packages/database/src/phase2-schema.integration.test.ts
docs/PHASE2_STEP2_DATABASE_FOUNDATION.md
```

## Known limitations and open questions

- **Overlapping leave** is not prevented in the database, since that needs the
  `btree_gist` extension. Step 8 enforces it in the application.
- **Open attendance.** More than one open (unchecked-out) attendance record per employee
  is not DB-restricted. That keeps a forgotten check-out from blocking the next day
  before a manager corrects it. Step 7 enforces this in the application.
- **Branch timezone.** Changing a branch's timezone later doesn't re-validate earlier
  attendance dates. Branch administration (Step 3) should treat timezone as effectively
  fixed once attendance exists.
- **Role grants of GLOBAL_ONLY permissions.** A role assigned at branch scope may
  include `MANAGE_SERVICE_PRICES`. That grant can never take effect for prices, as the
  engine requires GLOBAL, but a later step may want to reject it at assignment time.

## Recommended Step 3 scope

**Branch administration and business hours** (Step 1 order, adjusted):

- **Branch commands:** create, rename, activate and deactivate (GLOBAL
  `MANAGE_BRANCHES`), audited.
- **Defaults on creation:** a new branch gets its 09:00–21:00 hours for all 7 days in
  the same transaction.
- **Per-branch hours:** read and update with branch-scoped `MANAGE_BRANCHES` and
  `expectedVersion`, audited as sensitive configuration.
- **Timezone:** fixed at creation (`Asia/Ho_Chi_Minh` by default).
- **Reads:** scoped branch list and detail.
- **Shared frame:** `runAdminCommand`.
- **Tests:** HTTP (CSRF/origin) and rolled-back integration.
- **Not included:** services, skills, attendance, leave and UI.
