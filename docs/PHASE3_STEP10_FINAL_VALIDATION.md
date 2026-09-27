# Phase 3 Step 10 — Final validation and production acceptance

Status: **OWNER APPROVED / COMPLETE**.

Technical gate: **PASS in the local validation environment**, including the production build.
Phase 3 = **COMPLETE / OWNER APPROVED**. This is not a production deployment.
Phase 4 = **NOT STARTED**. No commit or push was performed during validation.

## Checkpoint and environment

- Checkpoint: `8b4976c4f7894212258e8a32a2b728d4d961de74`
  (`feat: add phase3 notifications and service warnings`). Steps 1–9 remain Owner approved.
- Validation date: 2026-09-27. The resumed pass retained earlier passing results and existing fixes.
- Windows / PowerShell; Node `24.20.0`, pnpm `12.4.2`, Prisma `7.10.0`, Next.js `16.3.5`.
- PostgreSQL `17.11`, local `127.0.0.1:5432`, `btree_gist` available; local Redis reachable.
- Development migrations: `lucy_spa_dev`. Tests: dedicated local database
  `lucy_spa_step10_validation_20260927`, created only after checking it did not exist.
  No database reset/drop or production data changes occurred.
- Secrets were loaded from existing local environment files without changing or printing them.
- Database integration tests used transactions/isolated schemas; race tests cleaned up only their
  own committed fixtures. The real Redis test used a unique queue prefix, not `FLUSHDB`.
- Logs and the command ledger are retained in ignored `.local/phase3-step10/`.

## Stage A — Database and Prisma

The previously deferred `20261009000001_phase3_notifications` migration applied successfully to
the local development database. The validation database received all existing migrations.
Prisma generation and schema validation passed. Permission catalog synchronization passed.

A real Step 8 defect required forward migration
`20261010000001_phase3_requested_ktv_reassignment`. The old CHECK required actual and requested
KTV to remain equal forever, contradicting approved explicit SPECIFIC reassignment. The new
CHECK retains valid request shape; an INSERT/WAITING-transition trigger requires initial
assignment to honor that request. Existing immutable-intent and execution-state guards remain.
The requested KTV is never rewritten to the replacement, and normal Step 8 permission,
acknowledgement, history, audit, and outbox requirements are unchanged.

Both local databases now have all **22 migrations**. Final migrate status is current and Prisma
schema diff is empty. No Prisma model changed in the correction, so the already generated client
remains current. Initial-assignment rejection, reassignment success, immutable request intent,
occupancy, and execution restrictions passed against the corrected database.

PostgreSQL constraints/triggers were exercised by the database, booking, walk-in, execution,
reassignment and worker integration suites. Notification uniqueness and durable warning schedules
were exercised with duplicate consumers/jobs, real Redis job removal/recreation, and read-state retries.

## Stages B–D — Automated and security results

Counts below consolidate the original pass with only affected reruns. They do not add repeated
executions as new tests. Node counts include parent test containers; the repository uses `test()`
containers, so Node's separate `suites` field is zero rather than a useful suite count.

| Validation group                                              | Final passing nodes | Outstanding failures |
| ------------------------------------------------------------- | ------------------: | -------------------: |
| Shared server unit tests                                      |                  19 |                    0 |
| API unit/domain/HTTP tests                                    |                 125 |                    0 |
| Web functional/rendering/state tests                          |                 134 |                    0 |
| Worker unit tests                                             |                   6 |                    0 |
| Database integration, four files                              |                  42 |                    0 |
| API/auth integration, forty files including new race coverage |                 288 |                    0 |
| Worker PostgreSQL/Redis integration                           |                  10 |                    0 |
| **Total: seven groups, 45 integration files**                 |             **624** |                **0** |

The default unit runs recorded **40 intentional opt-in skips** (39 API integration containers
and one worker integration container). Those suites were subsequently executed explicitly against
the local database; no required suite remains skipped/deferred. The new race suite also ran
explicitly. The original API integration run contained 273 nodes; six Step 8 child nodes became
executable after fixture repair/addition, and the new race file added nine nodes, giving 288.
The web run's one failure was repaired by its four-test permissions rerun, giving 134 distinct passes.

| Required area          | Result / evidence                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking/availability   | PASS: horizon, slots, business hours, snapshots, ANY/SPECIFIC, Q3, customer recipients/cancellation, skills, employment, branch, approved leave, CTV occurrence, trainee exclusion, conflicts.                                        |
| Queue/arrival          | PASS: branch-local board, check-in window, on-time priority, late hold, release/no-show/advance, arrival idempotency and races.                                                                                                       |
| Walk-in/guest          | PASS: real WAITING intent, no WAITING occupancy, member/guest recipients, initial assignment, cancellation, booking competition and assignment races. Affected suites reran after the constraint fix.                                 |
| Service execution      | PASS: authoritative START/END, idempotency, expected end, participant ordering, own-work permission, attendance, unfinished KTV block, OPEN → IN_SERVICE → COMPLETED, no payment transition.                                          |
| Leave/reassignment     | PASS: approval-derived conflicts without automatic reassignment, replacement revalidation, explicit scope, ANY/SPECIFIC acknowledgement, preserved request, version/history/audit/outbox, no started/final-line reassignment.         |
| Notifications/warnings | PASS: +5m START, −5m pre-END, +5m END, stale-state no-ops, no automatic execution, durable idempotency/recovery, current KTV, late cancellation, leave/reassignment consumers, own inbox/read state.                                  |
| Authorization/security | PASS: existing full auth integration coverage plus HTTP/CSRF/session tests; permission and branch scope, employment/account constraints, Owner invariants, customer isolation, own KTV work, REASSIGN_SERVICES and own notifications. |

### Concurrency and recovery

Existing booking ANY/SPECIFIC contention, arrival/no-show, walk-in/booking, and competing walk-in
assignment tests passed. Added real independent-transaction coverage for START/START, END/END,
START/cancellation, reassignment/START, two managers reassigning one version, reassignment/cancellation,
replacement occupancy contention, and leave approval/reassignment. Each verifies the authoritative
result plus absence of partial history/audit/outbox or conflicting occupancy.

Worker tests exercise source-row locks during START, END, cancellation and reassignment;
warning workers retry/no-op after the authoritative mutation. Duplicate outbox calls, distinct
BullMQ deliveries of one semantic warning, recovery versus scheduling, and read-state preservation
all pass. The real local Redis case removes its own delayed job, recreates it from PostgreSQL,
and verifies duplicate jobs create only one user-visible occurrence.

## Stages E–F — Static, production build and UI

- Typecheck: PASS for packages, API, worker, and web. The initial recursive gate stopped at a
  worker fixture type error; only API/worker required the final affected rerun.
- Lint: the full repository scan found one type-only import. That import and subsequently
  changed test sources passed focused reruns; the repository boundary check passed separately.
- Formatting: repository `format:check` found 49 Phase 3 files. Only that explicit list was
  formatted, followed by the new report/handoff. Final repository formatting check passed.
- Build: package/server and API/worker compilation passed; Next production build passed,
  including route generation and 54 static pages. Subsequent web edits were formatting-only.
- To protect the real `apps/web/next-env.d.ts`, web `typecheck` and `build` ran through the existing
  scripts in `.local/phase3-step10/workspace/apps/web`, with the same sources/configuration and
  installed dependencies. Next generated only the copy's files. This is a protection mechanism,
  not an alternate compiler or validation implementation.
- The existing production HTTP smoke passed default locale redirect, VI/EN content and language
  links, health/no-store and 404 behavior. A temporary local production server also returned 200
  for twenty VI/EN customer/workforce entry routes: registration/login, booking, booking management,
  customer notifications, booking board, walk-in, My Services, reassignment, workforce notifications.
- Existing 134 web tests cover functional rendering/state helpers, navigation/permissions,
  localized safe errors, booking/operations, execution, reassignment, notification inbox/read state,
  and applicable loading/empty/denied states. API/HTTP tests cover the backing operations.

UI acceptance is at the automated rendering/state/API/production-HTTP level available in this
repository. This does not claim a new full browser click-through, manual mobile/desktop visual
review, or accessibility audit. No visual redesign was performed.

## Failures, causes, minimum fixes and affected reruns

| Failure                                            | Classification / cause                                                                            | Fix and evidence                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-escalated pnpm/NVM4306; Docker not on PATH     | Local sandbox/tool configuration; installed pnpm and running local services were available        | Used approved elevated execution for the existing pnpm shim. `nvm reshim` alone did not resolve sandbox access. No reinstall/infra reset.                      |
| Direct Prisma invocation could not find schema     | Command ran from repository root without package configuration                                    | Used the existing database package/root scripts. Deploy, generate, validate and diff passed.                                                                   |
| API build: implicit-any `bookingLines`             | Step 8 test source type error                                                                     | Explicit Prisma row-array type; API build passed.                                                                                                              |
| Worker build: JSON payload return type             | Implementation type mismatch: Prisma JSON object permits optional properties                      | Return `Prisma.JsonObject`; worker build/typecheck passed. No event semantics changed.                                                                         |
| Worker fixture rejected by users credentials CHECK | Employee/customer fixtures lacked required phone                                                  | Valid unique fixture phones; later integration passed.                                                                                                         |
| Worker/Step 7/Step 8 fixture codes rejected        | Visit/Booking codes contained underscores disallowed by existing CHECK                            | Valid hyphenated fixture codes; affected tests passed.                                                                                                         |
| Step 8 customer fixture rejected                   | ACTIVE CUSTOMER fixture lacked verified email                                                     | Added fixture email and verified timestamp; affected suite became executable.                                                                                  |
| Leave approval audit assertion                     | Approved Step 8 added `affectedLineCount`; legacy expected audit omitted it                       | Expected zero for the no-conflict fixture. Dependent read/future-leave failures disappeared on the affected rerun.                                             |
| Web Owner navigation assertion                     | Approved reassignment navigation missing from expected list                                       | Added `reassignment`; four-test permissions rerun passed.                                                                                                      |
| New worker fixture compile                         | `randomUUID()` inferred narrower UUID template than persisted string IDs                          | Test helper explicitly returns `Promise<string>`; build/typecheck passed.                                                                                      |
| Worker leave event fixture timeline                | Suite clock preceded default `requestedAt`; changing only `createdAt` did not fix it              | Explicit earlier `requestedAt` and `createdAt`; final ten-node worker suite passed.                                                                            |
| SPECIFIC Visit reassignment and race failures      | Real database bug: initial-assignment CHECK also prohibited legitimate later reassignment         | Forward migration described above; sixteen-node reassignment/race rerun passed, including new initial-assignment/intent regression. No business rule weakened. |
| Foundation regression expected old CHECK name      | New initial-assignment guard correctly rejected the invalid fixture but emitted a different error | Assert the exact new guard message; eleven-node foundation rerun passed.                                                                                       |
| Lint type-only import                              | `createLogger` used only as a type in worker jobs                                                 | Type-only import; targeted lint and boundary check passed.                                                                                                     |
| Formatting in 49 files                             | Formatting intentionally deferred through Steps 7–9                                               | Prettier on reported files only; final format check passed. No protected generated file touched.                                                               |

Temporary diagnostic logging existed only in ignored compiled API output to expose the reassignment
constraint error. The next normal API build replaced it; no diagnostic error disclosure was added
to production source. No test was deleted/skipped and no locked business rule was changed to pass.

## Preserved rules, limitations and acceptance

- All approved booking defaults, cancellation/queue timing, assignment preference and SPECIFIC
  intent rules remain. PostgreSQL is authoritative; occupancy remains trigger-managed.
- No auto-START, auto-END, automatic reassignment, or payment transition was added. Warnings notify only.
- Phase 3 delivery remains in-app. No email/SMS/Zalo, native push, marketing or Phase 4 functionality.
- No remaining failing validation or unresolved Owner product decision. Owner review/acceptance is complete.
- Production infrastructure/data were not changed. This is local technical acceptance, not deployment
  verification, sustained load testing, production privilege certification, or an external-channel test.
- The installed PostgreSQL driver emits a non-failing deprecation warning about queued queries on a
  transaction client. Current supported versions pass; a future driver upgrade should reassess it.
- Protected `apps/web/next-env.d.ts` retains git blob hash
  `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`. Its pre-existing local diff is unchanged.
  It was never intentionally modified/restored/regenerated/formatted/staged/committed. The index is empty.
- Step 10 = OWNER APPROVED / COMPLETE; Phase 3 = COMPLETE / OWNER APPROVED.
  Phase 4 = NOT STARTED. No Phase 4 work.

## Exact validation commands and logs

Initial database commands before the structured runner: `pnpm db:deploy`, `pnpm db:generate`,
`pnpm db:validate`, and
`pnpm --filter @lucy-spa/database exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.
All passed after selecting the existing package workflow; deploy output is in `db-deploy.log`.

The ledger below records actual child commands and exit codes. Each row was captured by
`node .local/phase3-step10/run.mjs <label> <command> <arguments...>` unless noted above.
Database tests set `STEP10_DATABASE_NAME=lucy_spa_step10_validation_20260927`; the runner verifies
localhost and injects that URL into `DATABASE_URL` and `PHASE3_TEST_DATABASE_URL`. Standalone API
integration runs additionally set `RUN_AUTH_INTEGRATION=true`; the aggregate script sets it itself.
`web-smoke` used `WEB_SMOKE_URL=http://127.0.0.1:3107`.

- `unit-initial` (exit 1): `pnpm test`
- `validation-db-deploy` (exit 0): `pnpm db:deploy`
- `api-build-fixed` (exit 0): `pnpm --filter @lucy-spa/api build`
- `db-integration` (exit 0): `pnpm --filter @lucy-spa/database test:integration`
- `worker-build` (exit 1): `pnpm --filter @lucy-spa/worker build`
- `permissions-sync` (exit 0): `pnpm db:permissions:sync`
- `worker-build-fixed` (exit 0): `pnpm --filter @lucy-spa/worker build`
- `worker-integration` (exit 1): `node --test apps/worker/dist/booking-jobs.integration.test.js`
- `unit-suites` (exit 1): `pnpm -r run --if-present test`
- `worker-fixtures-build` (exit 0): `pnpm --filter @lucy-spa/worker build`
- `worker-integration-fixtures-fixed` (exit 1): `node --test apps/worker/dist/booking-jobs.integration.test.js`
- `web-permissions-fixed` (exit 0): `pnpm --filter @lucy-spa/web exec node --import tsx --test src/lib/workforce/permissions.test.ts`
- `api-unit` (exit 0): `pnpm --filter @lucy-spa/api test`
- `auth-integration` (exit 1): `pnpm --filter @lucy-spa/api test:integration`
- `api-fixtures-races-build` (exit 0): `pnpm --filter @lucy-spa/api build`
- `api-race-fixture-build` (exit 0): `pnpm --filter @lucy-spa/api build`
- `worker-recovery-build` (exit 1): `pnpm --filter @lucy-spa/worker build`
- `api-affected-integration` (exit 1): `node --test --test-concurrency=1 apps/api/dist/leave/leave.integration.test.js apps/api/dist/operations/service-execution.integration.test.js apps/api/dist/operations/reassignment.integration.test.js apps/api/dist/operations/execution-reassignment.race.integration.test.js`
- `typecheck-server` (exit 1): `pnpm -r --filter "!@lucy-spa/web" run --if-present typecheck`
- `worker-recovery-types-fixed` (exit 0): `pnpm --filter @lucy-spa/worker build`
- `typecheck-web` (exit 0): `pnpm --dir .local/phase3-step10/workspace/apps/web typecheck`
- `worker-integration-recovery` (exit 1): `node --test apps/worker/dist/booking-jobs.integration.test.js`
- `reassignment-diagnostic` (exit 1): `node --test apps/api/dist/operations/reassignment.integration.test.js`
- `format-initial` (exit 1): `pnpm format:check`
- `lint` (exit 1): `pnpm lint`
- `worker-leave-fixture-build` (exit 0): `pnpm --filter @lucy-spa/worker build`
- `requested-ktv-migration-validation` (exit 0): `pnpm db:deploy`
- `worker-events-fixture-fixed` (exit 1): `node --test apps/worker/dist/booking-jobs.integration.test.js`
- `api-migration-regression-build` (exit 0): `pnpm --filter @lucy-spa/api build`
- `reassignment-migration-races` (exit 0): `node --test --test-concurrency=1 apps/api/dist/operations/reassignment.integration.test.js apps/api/dist/operations/execution-reassignment.race.integration.test.js`
- `build-web` (exit 0): `pnpm --dir .local/phase3-step10/workspace/apps/web build`
- `format-phase3` (exit 0): `pnpm exec prettier --write apps/api/src/auth/auth.error.ts apps/api/src/authorization/authorization.ts apps/api/src/availability/availability.engine.ts apps/api/src/leave/leave.service.ts apps/api/src/notifications/notification.controller.ts apps/api/src/notifications/notification.http.test.ts apps/api/src/notifications/notification.service.ts apps/api/src/notifications/notification.test.ts apps/api/src/operations/execution-reassignment.race.integration.test.ts apps/api/src/operations/leave-conflicts.ts apps/api/src/operations/reassignment.controller.ts apps/api/src/operations/reassignment.core.ts apps/api/src/operations/reassignment.http.test.ts apps/api/src/operations/reassignment.integration.test.ts apps/api/src/operations/reassignment.rules.test.ts apps/api/src/operations/reassignment.service.ts apps/api/src/operations/service-execution.availability.test.ts apps/api/src/operations/service-execution.controller.ts apps/api/src/operations/service-execution.core.ts apps/api/src/operations/service-execution.http.test.ts apps/api/src/operations/service-execution.integration.test.ts apps/api/src/operations/service-execution.service.ts apps/web/src/app/[locale]/account/(app)/notifications/page.tsx apps/web/src/app/[locale]/workforce/(app)/notifications/page.tsx apps/web/src/components/notifications/inbox.tsx apps/web/src/components/workforce/screens/my-services.tsx apps/web/src/components/workforce/screens/reassignment.tsx apps/web/src/i18n/notifications.ts apps/web/src/i18n/workforce.ts apps/web/src/lib/notifications.test.tsx apps/web/src/lib/notifications.ts apps/web/src/lib/workforce/permissions.ts apps/web/src/lib/workforce/reassignment.test.tsx apps/web/src/lib/workforce/reassignment.ts apps/web/src/lib/workforce/service-execution.test.tsx apps/web/src/lib/workforce/service-execution.ts apps/worker/src/booking-jobs.integration.test.ts apps/worker/src/booking-jobs.ts apps/worker/src/notification-delivery.ts apps/worker/src/service-warnings.test.ts apps/worker/src/service-warnings.ts docs/PHASE3_STEP7_SERVICE_EXECUTION.md docs/PHASE3_STEP8_LEAVE_CONFLICT_REASSIGNMENT.md docs/PHASE3_STEP9_NOTIFICATIONS_WARNINGS.md LUCYSPA_HANDOFF.md packages/contracts/src/index.ts packages/server/src/authorization.store.ts packages/server/src/authorization.ts packages/server/src/index.ts`
- `worker-final-build` (exit 0): `pnpm --filter @lucy-spa/worker build`
- `lint-affected` (exit 0): `pnpm exec eslint apps/worker/src/booking-jobs.ts apps/worker/src/booking-jobs.integration.test.ts apps/api/src/operations/reassignment.integration.test.ts --max-warnings 0`
- `requested-ktv-migration-local` (exit 0): `pnpm db:deploy`
- `typecheck-affected` (exit 0): `pnpm -r --filter @lucy-spa/api --filter @lucy-spa/worker typecheck`
- `boundaries` (exit 0): `node scripts/check-boundaries.mjs`
- `worker-final-integration` (exit 0): `node --test apps/worker/dist/booking-jobs.integration.test.js`
- `prisma-final-diff` (exit 0): `pnpm --filter @lucy-spa/database exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
- `foundation-migration-regression` (exit 1): `node --test packages/database/dist/phase3-foundation.integration.test.js`
- `walkin-migration-regression` (exit 0): `node --test --test-concurrency=1 apps/api/dist/walkin/walkin.integration.test.js apps/api/dist/walkin/walkin.race.integration.test.js`
- `web-smoke` (exit 0): `node scripts/smoke-web.mjs`
- `web-functional-routes` (exit 0): `node .local/phase3-step10/web-smoke-runner.mjs`
- `database-regression-build` (exit 0): `pnpm --filter @lucy-spa/database build`
- `foundation-migration-regression-fixed` (exit 0): `node --test packages/database/dist/phase3-foundation.integration.test.js`
- `lint-database-regression` (exit 0): `pnpm exec eslint packages/database/src/phase3-foundation.integration.test.ts --max-warnings 0`
- `final-migration-status` (exit 0): `pnpm db:status`

Final documentation formatting and repository check: `pnpm exec prettier --write docs/PHASE3_STEP10_FINAL_VALIDATION.md LUCYSPA_HANDOFF.md` followed by `pnpm format:check` (log `format-final.log`).
