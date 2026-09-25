# Phase 2 Step 10: production deployment and completion gate

Status: **CLOSED. Phase 2 is COMPLETE.** Deployment date: **2026-09-25 (UTC)**.

- **Step 10A (readiness):** done in the repository. It found one release blocker, fixed
  in `93a256e`.
- **Step 10B (production deployment):** performed **manually by the Owner/operator** on
  the production VPS; the results below are the operator-verified facts.
- **This report:** records those results and doesn't repeat any production action.

## 1. Release commit

| Item                                                       | Commit                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| **Application production release** (deployed)              | `93a256e6bbd2055fd9af823c4028c1404cb878db` (`93a256e`)        |
| Production commit before deployment (Phase 1 + email HTML) | `389c0b460530cbd65fd05a2c8797723efd2165de` (`389c0b4`)        |
| Repository documentation closure                           | the documentation-only commit that adds this report (Git log) |

The documentation closure commit changes only documentation and **does not require
redeploying** the application. Production runs `93a256e`.

The release contains the Phase 2 Steps 2–9 commits plus the Step 10A release-gate
correction, `93a256e fix: use safe attendance default date window`. That fix moved the
attendance default read window's upper bound to UTC date + 1; see the handoff.

## 2. Pre-deployment state (operator-verified)

- **Repository:** `/opt/lucyspa`, clean working tree, at `389c0b4`.
- **PM2:** `lucyspa-api`, `lucyspa-web` and `lucyspa-worker`, all online.
- **API health:** `status: ok`, database `up`, Redis `up`.
- **Disk:** 100G total, 12G used, 89G available (12%).
- **Database:**
  - PostgreSQL in container `lucy-spa-postgres-1` (image `postgres:17-alpine`);
  - database `lucy_spa_dev`, user `lucy_dev`, no credentials recorded.
- **Migration state** after checking out the release: 5 repository migrations visible,
  with **exactly** these 3 pending:
  - `20260925000000_phase2_services_skills_operations`
  - `20260926000000_phase2_branch_row_version`
  - `20260927000000_phase2_leave_type`

This matched the Step 10A expectation (Phase 0 and Phase 1 applied, Phase 2 pending).

## 3. Backup

- **File:** `/root/backups/lucyspa-pre-phase2-20260925T113940Z.dump`
- **Created:** 2026-09-25 11:39:40 UTC, before any migration.
- **Size:** 94 KB.
- **Format:** PostgreSQL custom format (gzip), dumped from PostgreSQL 17.11.
- **Verification:** `pg_restore --list` read it successfully: database `lucy_spa_dev`,
  187 TOC entries, format CUSTOM.
- **Retained** on the server. No credentials are recorded here.

## 4. Build

- **Checkout:**
  - `origin/main` fetched, and `93a256e` verified to exist;
  - the working tree was clean;
  - `93a256e6bbd2055fd9af823c4028c1404cb878db` was checked out.
- **`pnpm install --frozen-lockfile`: PASS.** All 9 workspace projects recognized, the
  lockfile up to date, pnpm 12.4.2.
- **`pnpm build`: PASS.** Prisma Client generation, contracts, database, UI, the Next.js
  web app (the workforce routes are present in the production build), server, worker and
  API.

## 5. Migrations

- **Command:** `pnpm db:deploy`. All three Phase 2 migrations applied successfully.
- **Verification:** `pnpm db:status` reports **5 migrations found, database schema is up
  to date**.
- **Not used:** no reset, `db push`, `migrate dev`, manual SQL, `migrate resolve` or
  restore.

## 6. Permission sync

It ran after the new application was healthy, using the committed operator command
`pnpm db:permissions:sync`:

| Run          | Result                             |
| ------------ | ---------------------------------- |
| First        | **7 inserted, 10 already present** |
| Verification | **0 inserted, 17 already present** |

- **Catalog:** complete (17 definitions); the sync is proven idempotent.
- **No mismatch** on any existing definition, and no manual SQL.
- **The 7 Phase 2 codes:** `MANAGE_BRANCHES`, `MANAGE_SERVICES`, `MANAGE_SERVICE_PRICES`
  (GLOBAL_ONLY), `MANAGE_SKILLS`, `VIEW_ATTENDANCE`, `MANAGE_ATTENDANCE`, `APPROVE_LEAVE`.

## 7. PM2 deployment and restart

- **Restarted:** `lucyspa-api`, `lucyspa-worker` and `lucyspa-web`. All three came back
  online and stayed online after a wait.
- **Recent output logs:** "API infrastructure connected" and "API started".
- **Error log:** it contains historical entries from earlier starts; no current restart
  loop or health failure was observed.

## 8. Health checks

- **API readiness:**
  `{"status":"ok","service":"api","checks":{"database":"up","redis":"up"}}`, both after
  the restart and in the final check.
- **PM2:** all three processes online.

## 9. Smoke checks (anonymous only)

| Check                         | Result                                     |
| ----------------------------- | ------------------------------------------ |
| `/vi`                         | 200                                        |
| `/en`                         | 200                                        |
| `/vi/workforce/login`         | 200 (the route was 404 before the release) |
| `/en/workforce/login`         | 200                                        |
| `/api/v1/auth/context`        | valid JSON, `authenticated: false`         |
| `/api/v1/auth/me` (anonymous) | 401, as expected                           |
| `pnpm db:status`              | up to date                                 |
| Permission sync recheck       | 0 inserted, 17 present                     |

**Authenticated workforce smoke testing was not performed.** Production has no workforce
account; it will happen after the Owner bootstrap is separately authorized.

## 10. Data safety verification

- **Additive only:** the migrations are additive (Step 10A review) and were applied
  without reset, restore or manual SQL.
- **Permissions:** the 10 existing Phase 1 permission definitions were present before the
  sync and were reported unchanged ("already present"), with no mismatch.
- **Backup:** the verified pre-deployment backup (section 3) is retained as the recovery
  point.
- **No new data:** no Owner, employee or other user, and no business data, was created
  during deployment.

## 11. Known limitations (accepted; carried from Step 10A)

- **Concurrency tests:** no genuine two-connection leave-concurrency test. Serialization
  is verified by lock-order tests, and the database refuses invalid status changes.
- **No logged-in browser pass for the workforce UI**, locally or in production.
  Behaviour is covered by automated tests; production verification follows the Owner
  bootstrap.
- **Employee names** in attendance and leave views need `VIEW_EMPLOYEES` over the
  employee. This is a deliberate security boundary.
- **Leave policy:** no leave quota enforcement. The 1 day per month baseline is
  documented only; paid/unpaid and carry-forward are deferred to a future configurable
  Leave Policy.
- **Booking integration** (availability, auto-suggest, conflicts) is Phase 3.
- **Leave's default read window** is anchored on the UTC date. It runs from 93 days back
  to 306 days ahead, so there's no practical effect. The originally deployed 366-day-ahead
  default exceeded the 400-day maximum and was fixed after deployment; see the Step 8
  report's post-deployment correction.
- **Per-step deferrals:** the other items recorded in the Step 2–9 reports. For example,
  the Step 2 report's header still shows its pre-approval status, although the handoff
  records it closed.

## 12. Owner bootstrap status

**Production has no Owner.** None was created, by design. The Owner bootstrap
(`pnpm owner:bootstrap`, password only via hidden prompt or stdin) is the **next
operational action**, and it needs separate explicit Owner authorization. It is not
unfinished Phase 2 implementation. After it:

- authenticated production smoke tests of the workforce UI;
- permission grants to staff.

## 13. Rollback and failure notes

- No failure occurred, and no rollback or restore was used.
- **Recovery point:** `/root/backups/lucyspa-pre-phase2-20260925T113940Z.dump`.
- **Guidance (Step 10A):**
  - prefer a forward fix;
  - Phase 1 application code is compatible with the additive Phase 2 schema, so a code
    rollback is possible without touching the database;
  - a destructive database restore requires explicit Owner authorization.

## 14. Final production state

- **Release:** `93a256e` in `/opt/lucyspa`.
- **PM2:** `lucyspa-api`, `lucyspa-web` and `lucyspa-worker` all online.
- **API:** `status: ok`, database `up`, Redis `up`.
- **Migrations:** 5 applied, database schema up to date.
- **Permission catalog:** 17 definitions, sync idempotent.
- **Workforce area** `/vi|en/workforce` live. No Owner or workforce account yet.
- **Operational follow-ups carried from Phase 1:**
  - separate runtime and migration database roles: production still uses one role
    (`lucy_dev`) on database `lucy_spa_dev`;
  - custom lucyspa.vn DKIM and DMARC alignment.

## 15. Git context

- **Application release in production:** `93a256e`.
- **This closure:** a documentation-only commit adding this report and updating
  `LUCYSPA_HANDOFF.md`; no application code, schema or migration changed.
- **Excluded:** `apps/web/next-env.d.ts` remains the pre-existing local generated
  modification, never staged or committed.

## 16. Phase 2 completion status

**PHASE 2 COMPLETE.** Steps 1–10 are closed, and the Phase 2 release `93a256e` is running
in production with migrations applied and the permission catalog synced.

The next action is the separately authorized Owner bootstrap, followed by authenticated
production verification. Phase 3 has not started and needs its own authorization.
