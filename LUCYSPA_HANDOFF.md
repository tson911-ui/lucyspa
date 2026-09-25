# Lucy Spa handoff

## Start here: next fresh agent/session

1. Read **all of [LUCY_SPA_PRD.md](LUCY_SPA_PRD.md)**, this handoff, and [README.md](README.md).
   The current PRD is authoritative for product requirements; change it only with
   explicit Owner authorization. Use its current locked rules, including the two
   independent, non-expiring loyalty wallets summarized below.
2. Inspect `git status`, `git log`, `git diff`, the repository, and existing untracked
   files before changing anything. Preserve completed work; do not scaffold again.
3. Check the latest user authorization and relevant runtime state. Reuse verified
   results below when code is unchanged; rerun checks affected by changes or failures.
4. Phase 1 Step 2 has been reviewed, its migration applied to the approved local
   database, and post-migration checks passed. Step 3 runtime foundation is committed
   and pushed (`a68f66a`); see the [Step 3 report](docs/PHASE1_STEP3_AUTH_RUNTIME.md).
   Step 4 customer registration/email OTP is committed and pushed (`bff1ddc`); see the
   [Step 4 report](docs/PHASE1_STEP4_REGISTRATION.md). Step 5 customer login/logout is
   committed and pushed (`2c3d0c2`); see the
   [Step 5 report](docs/PHASE1_STEP5_LOGIN_LOGOUT.md). Step 6 customer password reset is
   committed and pushed (`a89d147`); see the
   [Step 6 report](docs/PHASE1_STEP6_PASSWORD_RESET.md). Step 7 permission engine and
   catalog is committed and pushed (`5b67b37`); see the
   [Step 7 report](docs/PHASE1_STEP7_PERMISSION_ENGINE.md). Step 8 Owner bootstrap and
   workforce authentication is implemented and awaiting review; read the
   [Step 8 report](docs/PHASE1_STEP8_OWNER_WORKFORCE_AUTH.md).
   Do not change Git remotes, expose secrets or
   install unrelated system software without authorization.

## Current phase and Git state

- **Phase 0: PASS, committed and pushed. Phase 1 Step 1 design is complete.
  Step 2 is reviewed, applied to the local database and verified PASS.
  Step 3 runtime foundation is committed and pushed (`a68f66a`). Step 4 customer
  registration/email OTP is committed and pushed (`bff1ddc`). Step 5 customer
  login/logout is committed and pushed (`2c3d0c2`). Step 6 customer password reset is
  committed and pushed (`a89d147`). Step 7 permission engine/catalog is committed and
  pushed (`5b67b37`). Step 8 Owner bootstrap/workforce authentication is implemented,
  locally validated, uncommitted and awaiting review.**
  The [Step 3 report](docs/PHASE1_STEP3_AUTH_RUNTIME.md) and
  [Step 4 report](docs/PHASE1_STEP4_REGISTRATION.md) and
  [Step 5 report](docs/PHASE1_STEP5_LOGIN_LOGOUT.md) and
  [Step 6 report](docs/PHASE1_STEP6_PASSWORD_RESET.md) and
  [Step 7 report](docs/PHASE1_STEP7_PERMISSION_ENGINE.md) and
  [Step 8 report](docs/PHASE1_STEP8_OWNER_WORKFORCE_AUTH.md) and
  [Step 9 report](docs/PHASE1_STEP9_WORKFORCE_RECOVERY.md) and
  [Step 10 report](docs/PHASE1_STEP10_EMPLOYEE_LIFECYCLE.md) and
  [Step 11 report](docs/PHASE1_STEP11_ROLE_ADMIN_AUDIT_READ.md) and
  [Step 12 report](docs/PHASE1_STEP12_EMAIL_DISPATCH_CLEANUP.md) and
  [Step 13 completion gate](docs/PHASE1_STEP13_COMPLETION_GATE.md) record scope and validation.
- Phase 2 (Services, Employees and Operations) is authorized. Step 1 (design contract)
  was analysis only; the [Phase 2 Step 2 report](docs/PHASE2_STEP2_DATABASE_FOUNDATION.md)
  records the database foundation; the
  [Phase 2 Step 3 report](docs/PHASE2_STEP3_BRANCH_ADMIN_HOURS.md) records branch
  administration and business hours; the
  [Phase 2 Step 4 report](docs/PHASE2_STEP4_SERVICE_MANAGEMENT.md) records service
  management; the [Phase 2 Step 5 report](docs/PHASE2_STEP5_SKILLS_EMPLOYEE_SKILLS.md) records
  skills and employee skills; the [Phase 2 Step 6 report](docs/PHASE2_STEP6_OPERATIONAL_BRANCH_ASSIGNMENTS.md)
  records operational branch assignments; the
  [Phase 2 Step 7 report](docs/PHASE2_STEP7_ATTENDANCE.md) records attendance; the
  [Phase 2 Step 8 report](docs/PHASE2_STEP8_LEAVE_MANAGEMENT.md) records leave management; the
  [Phase 2 Step 9 report](docs/PHASE2_STEP9_WORKFORCE_UI.md) records the workforce UI; the
  [Phase 2 Step 10 report](docs/PHASE2_STEP10_PRODUCTION_DEPLOYMENT.md) records the
  production deployment. **Phase 2 is COMPLETE.**
  Validation results and remaining production privilege
  prerequisites are recorded in the [Step 2 report](docs/PHASE1_STEP2_DATABASE.md).
- This handoff accompanies the Step 2 commit
  `feat: add phase1 auth database foundation` on `main`. Its baseline was `f793433`
  (`docs: finalize loyalty requirements and phase1 auth design`). Inspect current
  Git status/log and remote state instead of treating that baseline as the latest
  commit. The Owner explicitly authorized committing and pushing the seven Step 2
  files; the generated web file is excluded.
- [Phase 1 auth/security design](docs/PHASE1_AUTH_SECURITY_DESIGN.md) is the committed,
  approved Step 1 artifact and remains unchanged by Step 2.
- The pre-existing `apps/web/next-env.d.ts` diff changes two generated type imports
  from `.next/types/` to `.next/dev/types/`. It was previously identified as automatic
  Next.js development output and is preserved untouched; it is not Phase 1 work.
- The Step 2 changes add only the database schema/migration, constraint integration
  tests and supporting documentation. No accounts or other data are seeded, no
  runtime authentication endpoints are implemented, and the PRD remains unchanged.
- This status supersedes older Step 2 authorization wording below. Historical
  Phase 0 verification and infrastructure notes remain for context; they are not
  the current database inventory. Both Phase 0 and Step 2 migrations are now applied
  locally, with matching checksums and no failed or pending migrations.

## Architecture and structure

pnpm 12.4.2 workspace, strict TypeScript 5.9.3, Node.js 24.20.0; production-oriented
modular monolith with separate web, API and worker processes.

```text
apps/web        Next.js 16.3.5 / React 19.3; /vi, /en shell and /health
apps/api        NestJS 11; REST, validation, safe errors, JSON logs, health/OpenAPI
apps/worker     BullMQ; technical system-check/ping handler only
packages/server Backend configuration validation, logging, Redis options
packages/database Prisma 7.10 / PostgreSQL, migration, outbox helper, optional seed
packages/contracts Public transport types
packages/ui     Shared brand component and replaceable design tokens
packages/config Shared strict TypeScript configuration
scripts/        Environment setup, package-boundary checks, runtime smoke checks
.github/workflows/ci.yml  Install/check/build/integration/smoke; no deployment
```

- Next.js/UI must not access the database or import backend packages. Backend/domain
  services own business logic and authorization; lint enforces package boundaries.
- PostgreSQL is authoritative. Redis is technical queue/cache infrastructure, never
  the sole store for customer queues, bookings, balances, ledgers or inventory.
- Preserve multi-branch identity and scope. Use transactions and idempotency for
  critical writes; preserve historical snapshots and adjustment/reversal history.
- Outbox writes use the originating Prisma transaction. Publication is deferred;
  future dispatch requires retry/concurrency handling and idempotent consumers.
- API development uses `tsc-watch` to preserve decorator metadata. Shared backend
  changes require rebuilding/restarting apps; see README commands.

## Infrastructure and database

The following records the previous 2026-09-16/17 verification, not a new runtime or
environment check. No services, migrations, seeds or `.env` inspection were run
during the current documentation update.

- Previous runtime verification: Docker Engine 29.8.0 / Compose 5.5.1; PostgreSQL
  `17-alpine` and Redis `7.4-alpine` both healthy. Loopback ports: 5432 and 6379.
- Named volumes preserve data. Redis uses AOF and `noeviction`. Docker stopped
  between interrupted sessions; restoring the Engine/services resolved connection
  failures. Verify availability when needed; do not reset databases or delete volumes.
- Migration `20260916000000_phase0_foundation` applied; migration status up to date.
  Application tables: **`branches` and `outbox_events` only**, plus Prisma migration
  metadata. Branch uses UUID identity and `Asia/Ho_Chi_Minh` timezone; timestamps use
  `timestamptz`. Outbox branch FK is restrictive; no automatic history deletion.
- Root `.env` already exists, is ignored, and contains generated local credentials.
  Do not print or overwrite it. `.env.example` contains no secrets.
- Optional development branch seed safely skipped because no branch was requested.
  No Owner/users/business settings were seeded; integration fixtures rolled back.
- Temporary smoke-test app processes were stopped; use `pnpm dev` for local review.

## Previously verified Phase 0 results

These results were recorded during the 2026-09-16/17 verification and have not been
rerun for this documentation-only update.

| Validation                                                        | Result                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                  | PASS                                                                                  |
| `pnpm format:check`; `pnpm lint` including boundaries             | PASS                                                                                  |
| Applicable workspace typecheck/build scripts                      | PASS, including Next production build                                                 |
| API/server/worker test scripts                                    | 12 passed: 7 API, 4 server, 1 worker                                                  |
| Prisma generation, validation, migration deploy/status            | PASS                                                                                  |
| `node --test packages/database/dist/database.integration.test.js` | 3 passed: transaction guard, multi-branch/outbox rollback, FK rollback                |
| `node scripts/smoke.mjs`                                          | PASS: localized web/404s, API readiness, PostgreSQL/Redis, OpenAPI, BullMQ round trip |
| Git whitespace and credential-file review                         | PASS; no local credentials in the 72 implementation files                             |

Checks completed across interrupted sessions, not one uninterrupted `pnpm check` run.
The subsequent pushed Phase 0 commit also had a successful GitHub Actions run,
[run 35068715168](https://github.com/tson911-ui/lucyspa/actions/runs/35068715168),
verified earlier in the conversation; its current remote status was not rechecked here.
Root commands `pnpm check`, `pnpm test:integration`, and `pnpm smoke` remain the
documented verification entry points. Do not repeat expensive unchanged checks solely
because a new session starts.

## Known non-blocking limitations

- No new runtime or CI verification was needed or performed for this documentation update.
- Transitive `cron-parser@4.9.0` emits a deprecation warning.
- No business jobs, outbox dispatcher, production deployment, backup/restore setup
  or launch hardening yet; these remain later-phase work.
- Windows automation encountered stale PATH/NVM sandbox restrictions. Existing tools
  worked with process-local PATH and approved execution outside the sandbox; no
  system software/configuration changes were needed. Do not reinstall tools blindly.
- Earlier duplicate pnpm build-policy entries, Windows script quoting, and Prisma
  transaction-guard issues were fixed. Inspect current files before diagnosing old errors.

## Locked requirements: do not violate

- Multi-branch from V1; never hard-code the first branch as the only branch.
- Hours: 09:00–21:00, no lunch break; ultimately configurable by branch.
- Financial/operational history is preserved; corrections use valid adjustments,
  voids or reversals. No destructive ledger deletion or retroactive recalculation.
- Service/combo refunds are not allowed. Combos currently have no expiry.
- **Spa Points and Beauty Points are separate wallets:** no transfer, merging or
  conversion to cash or partial invoice payment. Both never expire or reset;
  preserve complete ledger history. Spa Points cover eligible services/combos;
  Beauty Points cover eligible cosmetics. Award whole points after successful
  payment at 1 point per 1,000 VND eligible amount actually paid after discounts
  and vouchers; tips are excluded and the same spend must not earn twice.
  Mixed-invoice allocation and fractional remainders remain unspecified; do not invent them.
- Each wallet independently uses its current valid balance for membership tiers:
  0–499: no member discount; Silver 500–999: 3%; Gold 1,000–2,999: 4%;
  Platinum 3,000–4,999: 5%; Diamond 5,000–9,999: 7%; Ruby 10,000+: 9%.
  Member discounts spend zero points and use the tier before the transaction.
- Ordinary promotions and member discounts do not stack. Automatically apply the
  financially better eligible benefit and show staff which benefit was selected.
- Birthday benefits are Owner-configured by type, value, eligibility, scope,
  conditions and stacking; there is no automatic birthday point multiplier. If a fixed
  birthday voucher is configured to stack with membership, apply the member
  discount first, then the voucher, then calculate points. A 50,000 VND voucher is
  an example, not a default.
- Referral reward is fixed: referrer A receives **10 Spa Points AND 10 Beauty Points**
  once when genuinely new customer B completes successful registration, the first
  qualifying spa service visit and payment of the first qualifying transaction.
  Invoice value does not change this reward. Never claw back A's referral bonus if
  B's transaction is later refunded/reversed. Phone identifies the permanent referrer.
- Eligible combo purchases may receive the Spa member discount even when bonus
  sessions are included. Earn Spa Points once on the paid purchase; session use
  earns zero additional points. Newly paid extras follow normal earning rules.
- Preserve the existing product-return policies. For a fault exchange, a replacement
  with higher relevant value earns Beauty Points only on the eligible additional
  paid/value difference; same/lower relevant values preserve original points without duplicate earning
  or reduction. A true refund reverses attributable purchase points through ledger
  adjustments and may lower the tier; the referrer's fixed bonus remains protected.
- Free bonus-combo/reward/gift services generate no KTV tour compensation.
- KTV cannot set arbitrary service/product prices. Enforce permissions, branch scope
  and sole-Owner protections server-side; hiding UI controls is insufficient.
- Product importer requires staging/review and must never automatically overwrite
  Lucy Spa prices, stock or commission. Do not invent Future/TBD policies.

## Exact next step and Owner inputs

**PHASE 1 COMPLETE** (see the
[Step 13 completion gate](docs/PHASE1_STEP13_COMPLETION_GATE.md), `fab9147`). Steps 1–12
are closed; the HTML auth-email presentation followed in `389c0b4`.

**Phase 2 is COMPLETE** (see Step 10 below). Step 2 (database foundation) is **closed** (Owner-approved;
commit `feat: add phase 2 database foundation`). It adds one additive migration
(`20260925000000_phase2_services_skills_operations`) with services, skills, employee
skills, service branch availability, branch operating hours, attendance and leave
tables, plus 7 permission codes (`MANAGE_SERVICE_PRICES` is GLOBAL_ONLY). It is
applied to the local development database only; it is **not yet deployed to
production**. Production needs `pnpm db:deploy` and then `pnpm db:permissions:sync` at
deployment. Step 3 (branch administration and business hours, API only) is **closed**
(Owner-approved, including the extra migration): branch create/list/detail/rename/timezone/
activation and per-weekday hours, with default 09:00–21:00 hours created atomically and
the timezone fixed once attendance exists. It adds a second additive migration
(`20260926000000_phase2_branch_row_version`), applied locally only and not deployed to
production. Step 4 decision (Owner): a branch-scoped `MANAGE_SERVICES` grant may toggle
service availability for that branch only, never master service configuration (name,
category, duration, metadata) or price. Price stays under GLOBAL_ONLY
`MANAGE_SERVICE_PRICES`. Eligible service skills are deferred to Step 5.

Step 4 (service management, API only) is **closed** (Owner-approved; commit `feat: add
phase 2 service management`). It covers service categories, services (master data; one
concrete duration per offering), a price command restricted to GLOBAL_ONLY
`MANAGE_SERVICE_PRICES` and audited before/after, and explicit per-branch availability
(no row means not offered). Branch-scoped `MANAGE_SERVICES` can toggle only its own
branch. No schema change; not deployed to production.

Owner decisions at Step 4 close:

- Service creation requires GLOBAL `MANAGE_SERVICES` **and** `MANAGE_SERVICE_PRICES`,
  because it sets the initial price.
- Category deactivation never cascades to its services.
- For Step 5:
  - service ↔ eligible skills is written under GLOBAL `MANAGE_SERVICES`;
  - employee ↔ skills under `MANAGE_SKILLS` with the target's branch scope;
  - the skill catalog under GLOBAL `MANAGE_SKILLS`.

Step 5 has not started and needs separate Owner authorization.

Future requirements added to the PRD (documentation only; **neither is authorized for
implementation now**):

- **Premium motion (PRD section 4.4):** a cohesive premium motion design system for
  the **customer-facing** website, not the workforce dashboards. It is recorded as an
  unnumbered future milestone in PRD section 56 and is not part of Phase 2.
- **Lucy Beauty Supplier Catalog Importer (PRD section 30.9):** extends section 30 and
  belongs to the existing Phase 9 (Product Importer), after the Phase 6 product model.
  It needs preview/review and authorized approval, never silently changes prices, and
  never deletes products that disappear from the source. Sections 30.9.1–30.9.13 now
  explicitly cover:
  - one supplier with multiple catalog sources/websites;
  - automated data collection and image processing;
  - cross-source deduplication (ambiguous matches go to review, never a silent merge);
  - preserved source mappings;
  - manual ("Check Supplier Updates") and configurable scheduled synchronization, with
    change detection;
  - exception-driven Owner review with bulk approval of ready items;
  - source-level removal semantics (never delete, never auto-deactivate);
  - source-specific price observations that never set the live price;
  - per-source failure isolation;
  - Lucy Beauty remaining the operational source of truth.

  It is still future work only; the roadmap is unchanged (model in Phase 6, importer in
  Phase 9).
  Section 30.9.14 adds low-friction source onboarding (Add URL → Test/Validate →
  Enable/Ready), with an adapter/connector fallback. When a source's structure breaks,
  it is marked unhealthy and its data isn't trusted, prior observations are kept,
  nothing is treated as removed, and the live catalog isn't touched.

- **Lucy Beauty Promotion/Campaign Management (PRD section 24.1):** extends section 24;
  roadmap home is the existing Phase 6 "Promotions". It covers:
  - bulk product selection from filters;
  - percentage, fixed-amount or promotional-price discounts;
  - scheduling with automatic start and end, and no manual restoration of base prices;
  - conflict detection with no accidental stacking (section 16.1);
  - campaign-driven banners, popups and sale presentation;
  - preview, review and authorized approval.

  It stays separate from the supplier importer and the product catalog. Not authorized
  for implementation now.

**Phase 2 Step 5: CLOSED** (skills and employee skills, API only; commit `feat: add
phase 2 skills management`; no migration):

- skill catalog under GLOBAL `MANAGE_SKILLS`;
- service eligible skills under GLOBAL `MANAGE_SERVICES`, versioned by the service;
- employee skills under `MANAGE_SKILLS` across every `EmployeeBranchAssignment` branch
  of the employee, with history kept.

Future qualification rule for Phase 3: an employee satisfies the skill dimension when
the service's eligible skills and the employee's active skills intersect.

**Phase 2 Step 6: CLOSED** (operational branch assignments, API only; commit `feat: add
phase 2 operational branch assignments`; no migration).

- It reuses `EmployeeBranchAssignment` (H2) through the Step 10 scope routine, with
  discrete assign and revoke commands plus an active/history read, all under
  `MANAGE_EMPLOYEE_SCOPE` at every affected branch.
- Each change is an exclusive-lock graph change: containment, target `authzVersion`
  bump, session revocation and audit.
- Removing the final branch is allowed. A branchless employee then needs GLOBAL scope
  authority, which Step 6 now enforces per design section 7.

**Phase 2 Step 7 — CLOSED** (attendance, API only; commit `feat: add phase 2
attendance`; no migration).

- Attendance V1: one check-in + one check-out per employee + branch + business date,
  with no breaks.
- Check-in needs an active `EmployeeBranchAssignment` at an active branch (branch row
  `FOR SHARE`); the business date comes from the branch timezone.
- Self check-out only for today's open record; a forgotten check-out is a
  `MANAGE_ATTENDANCE` correction (reason, `expectedVersion`, audit, no
  self-correction).
- Reads: own records, and `VIEW_ATTENDANCE` branch-scoped reads, bounded to 93 days.
- History survives assignment revocation and branch deactivation.

**Phase 2 Step 8 — CLOSED** (leave management, API only; commit `feat: add phase 2 leave
management`; Owner-authorized migration `20260927000000_phase2_leave_type`, applied
locally only).

- Controlled `LeaveType`: `ANNUAL`, `SICK`, `PERSONAL`, `FAMILY_EVENT`, `MATERNITY`,
  `OTHER`. Leave type is separate from paid/unpaid treatment (no `UNPAID` type, no pay
  fields).
- Whole calendar days (inclusive DATE range); one employee-level request, never per
  branch.
- Employee creates, reads and cancels (PENDING only) their own requests; `APPROVE_LEAVE`
  over every active branch of the employee approves or rejects (GLOBAL for branchless;
  no self-decision).
- PENDING/APPROVED requests never overlap (employee row lock); REJECTED/CANCELLED don't
  block; everything is audited and nothing is deleted.
- 1 leave day per month is the documented business baseline. Quota, carry-forward,
  paid/unpaid and payroll are deferred to a future configurable Leave Policy.
- APPROVED leave is queryable by employee and date for future Booking
  (`employeesOnApprovedLeave`).

**Phase 2 Step 9 — CLOSED** (workforce UI; commit `feat: add phase 2 workforce ui`; no
migration).

- Workforce area `/{vi|en}/workforce`: login through the existing session/CSRF API,
  route guard, permission-aware shell from `/auth/me` hints (UX only; the server
  authorizes), and a lightweight dashboard.
- UI for branches and hours, services (master, price, availability, eligible skills),
  skills, employees (directory, skills, branch assignments), attendance (self, branch
  view, corrections) and leave (requests, cancel PENDING, approvals).
- One authorized backend addition: read-only `GET /api/v1/employees` directory, using the
  same `VIEW_EMPLOYEES` containment as the single read, filtered before paging, minimal
  fields.
- Web tests use `node --import tsx --test` (no new dependency).
- No temporary workforce account was created: user rows are permanent by design, so it
  couldn't have been cleaned up. Authenticated flows are covered by tests, not a local
  browser pass.

**Phase 2 Step 10A (completion gate / readiness) — release-gate correction.** The
readiness run found one blocker. When `to` is omitted, the attendance reads
(`GET /attendance/me`, `GET /attendance`) defaulted their upper bound to the server's
UTC calendar date. A branch ahead of UTC could therefore miss today's record: in
Ho Chi Minh City between 00:00 and 06:59 local time; in the test, the UTC+14 fixture after
10:00 UTC. The Owner-authorized fix (commit `fix: use safe attendance default date
window`) makes the default upper bound UTC date + 1, keeps a 31-date default window ending
there, and leaves explicit `from`/`to`, the 93-day maximum and all business-date logic
unchanged. It adds fixed-clock and time-of-day-independent regression tests. There is no
schema change or migration. Step 7's original behavior is as recorded in its report; this
correction supersedes only the default window. Phase 2 is **not** yet deployed to
production.

**Phase 2 Step 10 — CLOSED** (production deployment on 2026-09-25 UTC, performed
manually by the Owner/operator; see the
[Step 10 report](docs/PHASE2_STEP10_PRODUCTION_DEPLOYMENT.md)).

- **Application production release commit:** `93a256e` (full
  `93a256e6bbd2055fd9af823c4028c1404cb878db`), deployed over `389c0b4` in `/opt/lucyspa`.
  The later documentation-only closure commit is not an application release and needs no
  redeploy.
- **Backup** before migration: `/root/backups/lucyspa-pre-phase2-20260925T113940Z.dump`
  (custom format, 94 KB, verified with `pg_restore --list`: 187 TOC entries), retained.
- **Migrations:** `pnpm db:deploy` applied
  `20260925000000_phase2_services_skills_operations`,
  `20260926000000_phase2_branch_row_version` and `20260927000000_phase2_leave_type`.
  `pnpm db:status` reports 5 migrations, up to date. No reset, push, manual SQL or
  restore.
- **Permission sync:** `pnpm db:permissions:sync` inserted 7 with 10 already present;
  the recheck gave 0 inserted, 17 present (idempotent, no mismatch).
- **Processes and health:** `lucyspa-api`, `lucyspa-worker` and `lucyspa-web` restarted
  and online; API `status: ok`, database and Redis up.
- **Anonymous smoke:** `/vi`, `/en`, `/vi/workforce/login`, `/en/workforce/login` all 200;
  `/api/v1/auth/context` valid JSON (`authenticated: false`); anonymous `/auth/me` 401.
  **No authenticated production smoke test was performed.**
- **Known accepted limitations** are carried from Step 10A (see the Step 10 report,
  section 11).

**Phase 2 — COMPLETE.** Steps 1–10 are closed and the release runs in production.

**Post-deployment changes (committed; not yet deployed, production still runs
`93a256e`):**

- `fix: prevent unchanged branch hours submission` (`4c0af62`). The branch-hours form
  submitted an unchanged week, which the API rejects by contract (`VALIDATION_FAILED`
  "days"). Save is now enabled only when a weekday changes.
- `fix: keep default leave window within limit` (`1e9d196`). The default leave read window (93 days
  back to 366 days ahead = 460 days inclusive) exceeded the 400-day maximum, so every
  leave list without `from`/`to` failed with `VALIDATION_FAILED` "from". This broke the
  Leave page and the dashboard leave counts in production (found when opened as Owner).
  Final behavior:
  - default past 93 days;
  - default future 306 days;
  - inclusive default window 400 days;
  - explicit maximum range unchanged at 400 days.

  Regression tests were added. See the Step 8 report's post-deployment correction.

- `feat: add estimated service duration ranges`. Services gain a customer-facing
  estimated duration range next to the internal scheduling duration:
  - `estimatedMinMinutes`: customer-facing minimum estimate;
  - `estimatedMaxMinutes`: customer-facing maximum estimate;
  - `durationMinutes`: the deterministic internal scheduling duration (unchanged);
  - invariant: `estimatedMinMinutes <= estimatedMaxMinutes <= durationMinutes`, enforced
    in SQL, the API and the form.

  Migration `20260928000000_phase2_service_duration_estimate`: existing services are
  migrated with estimated min and max equal to their existing `durationMinutes`. Phase 3
  booking is **not** implemented; `durationMinutes` is only preserved as the future
  scheduling duration. The workforce create/edit forms and the service list show the new
  fields. Tests: schema 11/11, service catalog integration 6/6 and HTTP 1/1, skills
  integration 4/4, API unit/HTTP 77 pass, web 29/29. See the Step 4 report's
  post-deployment enhancement.

- **Permanent deletion of services and service categories**
  (`feat: add safe service catalog deletion`).
  - "Xóa" permanently removes incorrectly created configuration; "Ngừng hoạt động"
    (deactivate) remains the normal way to retire.
  - **Routes:** `POST /api/v1/services/:id/delete` needs GLOBAL `MANAGE_SERVICES` +
    `MANAGE_SERVICE_PRICES`; `POST /api/v1/service-categories/:id/delete` needs GLOBAL
    `MANAGE_SERVICES`. Both are CSRF-protected, with a confirmation dialog in the UI.
  - **Service:** its eligible-skill and branch-availability rows are removed in the same
    transaction. Any other reference (a RESTRICT foreign key) refuses with 409 "inUse",
    and nothing is deleted.
  - **Category:** refused with 409 "services" while it contains any service; services are
    never cascaded.
  - **Audit:** `SERVICE_DELETED` / `SERVICE_CATEGORY_DELETED` with a before snapshot.
  - **Phase 3 must reference `services` with `ON DELETE RESTRICT`.**
  - **Tests:** catalog integration 8/8, delete HTTP 1/1, web 37/37. No migration; no
    production data is deleted automatically.

- **Employee management Step 4B: role management UI** (`feat: add role management UI`;
  local commit on top of `e6755ff`; not pushed, not deployed, no migration). See the
  [Step 4B report](docs/EMPLOYEE_MANAGEMENT_STEP4B_ROLE_MANAGEMENT.md).
  - **Page:** "Vai trò & quyền" (`/workforce/roles`, nav with `MANAGE_PERMISSIONS`).
    - Lists roles with labelled permissions.
    - "Tạo vai trò": code, VI/EN names, permissions (none preselected), reason.
    - "Sửa vai trò": the code is read-only; names and the full permission set can change;
      roles can be switched on or off.
    - Role changes need GLOBAL `MANAGE_PERMISSIONS`; branch administrators get read-only
      access.
  - **Permissions** come from the API. The only API change: `GET /roles` adds
    `permissionCatalog` (scope capability; only `MANAGE_SERVICE_PRICES` is global-only).
  - **Containment is unchanged:** a non-Owner can bundle only unrestricted global
    permissions it holds, cannot edit its own roles, and cannot create an `OWNER` role.
    Held permissions stay removable.
  - **Roles are bundles:** the branch is chosen on assignment (employee detail), never on
    the role.
  - **No deletion** (roles are switched off instead).
  - **No roles seeded:** the Owner must create KTV, Branch Manager, etc. and choose their
    permissions.
  - **Deferred:** the per-user overrides UI.
  - **Tests:** role-assignment integration 6/6 (Step 4B subtest), role-admin 8/8,
    web 75/75.
  - **Next:** Step 5, skills.

- **Employee management Step 4: role assignment UI** (`feat: add employee role assignment
UI`; local commit on top of `deae20c`; not pushed, not deployed, no migration). See the
  [Step 4 report](docs/EMPLOYEE_MANAGEMENT_STEP4_ROLE_ASSIGNMENT.md).
  - **Where:** a "Vai trò" section on employee detail, shown with `MANAGE_PERMISSIONS`
    over all of the member's branches.
  - **Display:** each assignment shows its role name/code and a distinct scope badge
    ("Toàn hệ thống" for GLOBAL, "Chi nhánh: …" for BRANCH).
  - **Actions:** "Gán vai trò" and "Gỡ vai trò" (reason required) use the existing
    role-admin API. Options come from the loaded catalog and branches.
  - **UI hints:** roles that exceed the actor are disabled; there are no self changes.
  - **Enforcement:** the API enforces containment, scope and Owner protection.
  - **Roles vs classification:** roles are never employment classifications, and no code
    checks role names.
  - **Backend:** `assignRole` refuses ENDED employment (409 `employment`); revoking is
    still allowed. History is kept in the audit log (`ROLE_ASSIGNED`/`ROLE_REVOKED`).
  - **No roles are seeded and there is no role-admin UI:** the Owner must create KTV and
    Branch Manager roles through `POST /api/v1/roles` until one exists.
  - **Tests:** role-assignment integration 5/5, web 69/69 (6 new), role-admin 8/8,
    authorization 4/4, employee/employment/workforce-account suites, customer auth
    unchanged.
  - **Employee management is not complete.** Next: skills (Step 5), or a minimal
    role-administration screen first.

- **Employee management Step 3: employee detail and lifecycle UI** (`feat: add employee
detail lifecycle UI`; local commit on top of `9adfb14`; not pushed, not deployed; web
  only, no API or migration change). See the
  [Step 3 report](docs/EMPLOYEE_MANAGEMENT_STEP3_EMPLOYEE_DETAIL.md).
  - **The detail page shows:** header badges for classification and account status
    (separately); the profile with the employee code as read-only login ID; editing of
    full name, date of birth, address and language only (the existing command);
    classification, effective date and history; the sign-in account; branch assignments
    and skills (both unchanged).
  - **Actions**, each using the existing command and the all-branch permission hints:
    - "Chuyển thành nhân viên chính thức" (TRAINEE only; changes the classification only,
      asserted in integration);
    - "Kết thúc làm việc", which states the access outcome before confirming. For a
      future date it says access is NOT auto-disabled (no scheduler);
    - "Đặt lại mật khẩu" / "Cấp mật khẩu đăng nhập", with the password-confirmation
      dialog;
    - "Vô hiệu hóa / Kích hoạt lại đăng nhập".
  - **ENDED in effect:** no promotion, ending, reset or re-enable controls.
  - **Tests:** web 63/63 (8 new detail tests), employment integration 11/11 (promotion
    isolation), branch-assignment 5/5, workforce-account 11/11, employee 10/10. Customer
    auth unchanged: registration 7/7, login 4/4, reset 5/5, HTTP 12/12.
  - **Employee management is not complete.** Next is the role assignment UI; the skill UI
    comes after.

- **Employee management: workforce accounts, Owner/manager-managed credentials**
  (`feat: add owner-managed workforce credentials`; local commit on top of `7a516ed`, not
  pushed, not deployed, no migration). See the
  [report](docs/EMPLOYEE_MANAGEMENT_WORKFORCE_ACCOUNTS.md) and PRD 6.4/7.1a. This
  supersedes Step 2's "no password" rule.
  - **Customer vs workforce:** customer registration, OTP and recovery are unchanged. The
    workforce never self-registers, and the Owner or an authorized manager sets and resets
    workforce passwords directly (no employee OTP).
  - **Login ID:** the employee code (e.g. `NV0001`, WORKFORCE/EMPLOYEE_ID). There is no
    username column, and the code carries no classification or role meaning.
  - **"Thêm nhân sự":** optional "Cấp tài khoản đăng nhập ngay" section (login ID = employee
    code, initial password with confirmation, at least 15 characters). The member is
    created ACTIVE in the same atomic request.
    - Requires `MANAGE_EMPLOYEE_ACCESS` in every branch and a fresh reauthentication (new
      reusable dialog, `useReauthentication`).
    - Without the section the member stays PENDING_SETUP.
  - **`POST /employees/:id/credentials`** (set/reset) requires fresh reauthentication, all
    branches, containment, no self-target, not INACTIVE and not ENDED.
    - It increments `credentialVersion` and revokes sessions.
    - Audit `ACCESS_PASSWORD_SET` holds no password material.
  - **`POST /employees/:id/end-employment`** appends ENDED.
    - With `disableAccess` and a date of today or earlier, it also makes the account
      INACTIVE in the same transaction.
    - A future date is recorded only (`access: UNCHANGED_FUTURE_DATE`; no scheduler, so
      disable manually on or after the date).
  - **ENDED guards:** no reactivation, credentials or setup issuance while ENDED is in
    effect (no rehire). Nothing is deleted.
  - **Roles:** Manager and KTV remain database roles; MANAGER is not a classification.
  - **Tests:** workforce-account integration 11/11, full API integration 135/135
    (customer auth unchanged), API unit/HTTP 86/0, web 55/55.
  - **Employee management is not complete.** Next is employee detail: profile,
    classification history and promotion, "Đặt lại mật khẩu", "Kết thúc làm việc",
    status and branches. Role and skill UIs come later.

- **Employee management Step 2: "Add workforce member" UI** (`feat: add workforce member
creation UI`; local commit on top of Step 1, not pushed, not deployed). See the
  [Step 2 report](docs/EMPLOYEE_MANAGEMENT_STEP2_ADD_WORKFORCE_MEMBER_UI.md).
  - **Where:** Workforce › Employees has "Thêm nhân sự" / "Add workforce member" for
    `CREATE_EMPLOYEES`, opening an inline form.
  - **Fields:** those of the existing create API: employee ID, name, date of birth, phone,
    optional email, language, address, explicit classification, start date (with a reason
    when in the past) and branches.
  - **Classification:** TRAINEE or OFFICIAL_EMPLOYEE is an explicit choice with no default
    and never ENDED. OFFICIAL_EMPLOYEE is disabled, with an explanation, without
    `MANAGE_EMPLOYEE_PAY` in every selected branch; the API still enforces it.
  - **Not included:** salary (decision documented), password, setup link, roles and
    skills.
  - **Duplicate submits** are blocked by a single-flight guard.
  - **After creation:** the directory reloads with a success notice (the member cannot sign
    in yet) and a detail link. The directory gains a "Phân loại" column: the
    `EmployeeDirectoryEntry` fields `classification` and `classificationEffectiveDate`,
    with no migration.
  - **Tests:** web 48/48 (8 new), employment integration 11/11, directory integration 5/5,
    API unit/HTTP 86/0.
  - **Employee management is not complete.** Next is Step 3, employee detail (profile and
    classification history with promotion/ending); account provisioning, roles and skills
    come later.

- **Employee management Step 1: employment classification** (`feat: add employment
classification history`; local commit, not pushed, not deployed). See the
  [Step 1 report](docs/EMPLOYEE_MANAGEMENT_STEP1_EMPLOYMENT_CLASSIFICATION.md).
  - **Values:** `TRAINEE` / `OFFICIAL_EMPLOYEE` / `ENDED`; only OFFICIAL_EMPLOYEE is
    payroll-eligible. Classification is separate from account status, roles, branches and
    skills.
  - **Transitions:** creation chooses TRAINEE or OFFICIAL_EMPLOYEE explicitly (never
    ENDED; no forced trainee stage). Allowed changes: TRAINEE → OFFICIAL_EMPLOYEE,
    TRAINEE → ENDED, OFFICIAL_EMPLOYEE → ENDED. No rehire.
  - **History:** migration `20260930000000_employment_classification` adds
    `employment_classification_changes`, an append-only, DATE-effective, authoritative
    history (one entry per date, strictly increasing dates, transitions guarded by a SQL
    trigger). Existing employees are backfilled as OFFICIAL_EMPLOYEE from their creation
    date.
  - **API:**
    - create requires `classification` + `employmentStartDate` (plus a reason when in the
      past; OFFICIAL_EMPLOYEE also needs `MANAGE_EMPLOYEE_PAY`);
    - `GET /employees/:id/employment[?date=]` returns history, current, on-date and
      payroll eligibility;
    - `POST /employees/:id/employment` needs `MANAGE_EMPLOYEE_PAY`, a reason, no self
      change and an Owner for backdating; audited.
  - **Tests:** employment integration 11/11, full API integration 124/124, API unit/HTTP
    86/0. No UI yet.
  - **Step 2 not started.**

- **Service price ranges and pricing units** (`feat: add service price ranges and pricing units`).
  - **Model:** `priceVnd` = minimum price per unit (the price itself when exact),
    `priceMaxVnd` = maximum, `pricingUnit` = `PER_SERVICE` | `PER_NAIL`.
  - **Rule:** `0 <= priceVnd <= priceMaxVnd` in integer VND, enforced in SQL, the API and
    the form.
  - **Migration `20260929000000_phase2_service_price_range_unit`** backfills existing
    services to exact `PER_SERVICE` prices (`priceMaxVnd = priceVnd`).
  - **Pricing changes** only through the price command (GLOBAL_ONLY
    `MANAGE_SERVICE_PRICES`, reason required), audited with range and unit.
  - **UI:** "Giá tối thiểu", "Giá tối đa" and "Đơn vị tính giá"; the list shows e.g.
    "5.000–10.000 ₫/ngón" (English "/nail").
  - **The five Nail Design services are not changed automatically;** the Owner edits them
    after deploying.
  - **Tests:** schema 12/12, catalog integration 9/9, catalog HTTP 1/1, web 40/40.
  - **Deploying requires `pnpm db:deploy`** (after a verified backup) for this migration
    and `20260928000000_phase2_service_duration_estimate`.

- **Session activity (sliding idle timeout).**
  - **Problem:** production showed an actively working Owner being logged out.
    `lastActivityAt` had stayed fixed at login, because the `touch` primitive was never
    wired, so every session ended 30 minutes after login.
  - **Change:** genuine user activity now refreshes it, and the default idle timeout is
    **60 minutes** (`AUTH_IDLE_TTL_SECONDS=3600`). The **12-hour** absolute limit is
    unchanged and never extended.
  - **Counts as activity:** authenticated `/api/v1` `POST` commands after the CSRF
    guard, and `GET`s the client marks `X-Lucy-Activity: user`.
  - **Never counts:** unmarked `GET`s, `/auth/context`, `/auth/me`, and health checks.
  - **Write coalescing:** at most one write per `min(60 s, idle / 10)`; activity never
    revives an expired or revoked session.
  - **UI:** a failed submission keeps the form and offers sign-in in a new tab; a failed
    read returns to login and back to the same page.
  - **Tests:** API activity unit 7/7, activity HTTP 1/1, session integration 12/12, API
    auth/HTTP suites pass, server 19/19, web 33/33.
  - **Remaining unsaved-form limitations (follow-ups):**
    - a read that hits the expiry while a form has unsaved changes still redirects and
      discards them;
    - there is no in-page sign-in dialog and no leave-page warning for dirty forms.

    See the design's "Session activity".

  - **Deploying:** production must not override `AUTH_IDLE_TTL_SECONDS` if the 60-minute
    default is wanted; no migration is needed.

  **Deploying these changes requires `pnpm db:deploy`** (after a verified backup), since
  production is at 5 migrations and this adds a 6th.

**Next operational action: Owner bootstrap** (`pnpm owner:bootstrap` on the production
server, password via hidden prompt or stdin). It needs separate explicit Owner
authorization, and production has no Owner yet. After it: authenticated production smoke
testing of the workforce UI and staff permission grants. This is an operational step, not
unfinished Phase 2 implementation. Phase 3 has not started and needs its own
authorization. Owner decisions H1–H9 remain recorded in the Step 2 report.

Production deployment (verified by the operator, recorded in the
[Step 12 report](docs/PHASE1_STEP12_EMAIL_DISPATCH_CLEANUP.md#production-verification)):

- The VPS runs `lucyspa-api`, `lucyspa-worker` and `lucyspa-web` under PM2, restored at
  boot through systemd.
- nginx serves `https://lucyspa.vn` (`WEB_ORIGIN`) with secure cookies.
- PostgreSQL and Redis are connected, and the permission catalog is synced (10 rows).
- **Email delivery is operational end-to-end**: registration → outbox → worker → Google
  Workspace SMTP relay → Gmail, verified with real OTP emails, including the HTML
  presentation.

Remaining follow-ups (not Phase 1 code blockers):

- **Deliverability.** OTP email lands in Gmail Spam until the custom lucyspa.vn DKIM key
  and DMARC alignment are in place; SPF and Google transport DKIM pass.
- **Real Owner.** Not yet created.
- **Production database roles.** Separate the runtime and migration roles, and put the
  Owner-bootstrap privilege on a dedicated role.
- **Carried-forward decision.** The foreground idle-activity policy (Step 8). **Resolved**
  by the session-activity change listed under the post-deployment changes.

No real Owner exists; create it only on explicit Owner instruction with
`pnpm owner:bootstrap` (password via hidden prompt/stdin only).
Approved remaining plan: Step 8 Owner bootstrap (interactive/stdin password) + workforce
authentication; Step 9 workforce recovery; Step 10 employee lifecycle; Step 11 role/
permission administration + audit read; Step 12 email dispatch/cleanup (provider
deferred); Step 13 Phase 1 completion gate. Run `pnpm db:permissions:sync` explicitly
(operator command, never on startup) before any grant can be created.
Workforce password recovery and recovery-email verification are implemented (Step 9).
Employee creation, profile, status, branch scope, base salary and setup issuance/completion
are implemented (Step 10). Role, assignment, override administration and scoped audit
read are implemented (Step 11).
Locally, run `pnpm auth:env:init` once to append the OTP and delivery key rings
(existing keys are kept). OTP email is sent by the worker (Step 12) through the Google
Workspace SMTP relay (`smtp-relay.gmail.com:587`, STARTTLS, no SMTP AUTH, IP-allowlisted
VPS) as `Lucy Spa <system@lucyspa.vn>` when `MAIL_TRANSPORT=smtp`; see `.env.example`.
This is live in production. Custom lucyspa.vn DKIM and DMARC alignment are pending
external Google/DNS activation (deliverability follow-up).
The configured local database has both Phase 0 and Step 2
migrations applied. No Phase 1 implementation scope remains. Extend the existing architecture only
when authorized; the locked loyalty/combo/promotion rules remain later-phase
requirements, not permission to implement them now.

Important inputs before relevant Phase 1 work:

- Initial Owner identity/contact and secure bootstrap credential-provisioning arrangement.
- Email provider, verified sending domain/address, and test-delivery arrangement;
  obtain credentials securely when needed, never through committed files.
- Initial branch name/code and staff scope if creating real branch/employee records.

Later-phase inputs remain unresolved: final branding/service data, configured reward
catalog items/thresholds, birthday benefit configuration, campaign-specific eligibility
and values, mixed-invoice point allocation and fractional-remainder handling,
tour/salary/commission rates, product prices/stock, payment credentials, hosting/storage,
and Future/TBD shipping/tax/integration policies. The fixed referral formula and ordinary
promotion/member-discount selection rule are now resolved. Missing inputs are not
permission to invent defaults or expand Phase 1 scope.
