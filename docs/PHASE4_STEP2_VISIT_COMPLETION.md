# Phase 4 Step 2 — Visit Completion Carryover

Status: **CLOSED / OWNER APPROVED** (implemented and validated locally; checkpoint-committed and pushed; not deployed to production).
Contract: [PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md](PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md) (Step 1 checkpoint
`71c9286e6ed9e6c051d31999185e8fe482762270`). Locked decisions Q0–Q6, Q9–Q10 and OP-1…OP-7 are untouched; Q7
(before Step 8) and Q8 (before Step 10) remain open, as does the PayOS-settled wrong-benefit consideration.

## 1. Scope

Exactly the two Phase 3 carryovers assigned to this Step:

- **A.** Management resolution of a forgotten `ServiceExecution` END.
- **B.** Cancellation of one unperformed (unstarted) visit service line.

Not in this Step: staff-added service (Step 3), and anything Invoice / POS / Payment / Discount / Voucher / PayOS /
loyalty / product / tip / payroll. Payment state never touches the Visit, and END is never blocked by billing.

## 2. Repository facts discovered before implementing

- `RESOLVE_SERVICE_EXECUTION` (branch-capable) and `MANAGE_BOOKINGS` already exist in the catalog; `MANAGER_RESOLVED`,
  `resolution_reason`, `ended_by_user_id` and the line cancellation columns already exist. **No endpoint used them.**
- The database already permits both behaviors: `service_executions_status_facts` accepts an ENDED / `MANAGER_RESOLVED`
  row with a non-blank reason and an actor, `ended_at >= started_at` is a CHECK, the line guard allows
  `PLANNED|WAITING -> CANCELLED` and `IN_PROGRESS -> DONE`, and the visit guard refuses to close a visit that still has a
  WAITING / PLANNED / IN_PROGRESS line and makes COMPLETED / CANCELLED visits immutable. The occupancy trigger already
  deletes a line's `ktv_occupancies` row when it leaves PLANNED / IN_PROGRESS. **No migration was needed.**
- Phase 3 had only two cancel paths, both whole-visit and only before any START (customer booking cancel, walk-in
  cancel). Nothing cancelled one line once a visit had started.
- The worker warning code validates the source facts in PostgreSQL (line PLANNED / execution IN_PROGRESS), so an ended
  execution or a cancelled line makes any pending START-overdue / pre-END / END-overdue job a stale no-op; the
  `SERVICE_ENDED` outbox event is consumed by the booking relay only to re-derive timers (it does not parse the END kind).
- Existing frames: `runAdminCommand` (graph lock, user rows sorted by UUID incl. an optional `lockUsers`, session,
  transaction-time authority), visit `FOR UPDATE NOWAIT` -> line -> execution locking in START/END, SQLSTATE -> 409
  `SERVICE_EXECUTION_CONFLICT` mapping in `ServiceExecutionService`.

## 3. Implementation

| File                                                         | Change                                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/operations/visit-completion.core.ts` (new)     | `resolveServiceExecution` and `cancelServiceLine`                                                                                   |
| `apps/api/src/operations/service-execution.core.ts`          | New exported `settleVisitAfterLineChange` (the one Visit-completion rule); `endService` now calls it (behavior unchanged, verified) |
| `apps/api/src/operations/service-execution.service.ts`       | `resolve`, `cancelLine` (async, performer's user row locked with the actor, permission check), `normalizeReason`, `parseEndedAt`    |
| `apps/api/src/operations/service-execution.controller.ts`    | Two POST routes with strict DTOs                                                                                                    |
| `apps/api/src/operations/operations.core.ts` / `.service.ts` | Board read model gains `activeVisits` and two permission hints                                                                      |
| `apps/api/src/auth/auth.error.ts`                            | `SERVICE_RESOLUTION_NOT_ALLOWED`, `SERVICE_LINE_CANCEL_NOT_ALLOWED` (both 409)                                                      |
| `packages/contracts/src/index.ts`                            | Request/response types; `OperationalTodayResponse.activeVisits` and `permissions.cancelLine / resolveExecution`                     |
| `apps/web/...` (see section 11)                              | Booking-board section, i18n, pure helpers                                                                                           |
| `scripts/test-auth-integration.mjs`                          | Registers the two new integration suites                                                                                            |
| `operations.integration.test.ts`                             | Two `permissions` deep-equals extended with the two new (additive) fields                                                           |

**Migration: none.** No schema, permission-catalog, seed or generated-client change.

## 4. API contracts

`POST /api/v1/operations/service-lines/:id/resolve-end` (`:id` = visit service line id, like START/END)

- Body `{ reason: string; endedAt?: string }`, strict (unknown fields such as `startedAt`, `status`, `executionId` -> 400).
  `reason` required, trimmed, NFC, 1–500 characters. `endedAt` optional ISO-8601 with a time zone
  (`Z` or `±hh:mm`), otherwise the server clock.
- 200 `ResolvedServiceExecutionResponse { lineId, visitId, visitCode, visitStatus ('IN_SERVICE'|'COMPLETED'),
executionId, employeeUserId, startedAt, endedAt, endKind: 'MANAGER_RESOLVED' }`.
- Errors: 400 `VALIDATION_FAILED` (`reason` / `endedAt`), 401, 403 `FORBIDDEN` (no permission, wrong branch, self),
  404 `NOT_FOUND`, 409 `SERVICE_RESOLUTION_NOT_ALLOWED` (never started / already ended by someone else / not in progress),
  409 `SERVICE_EXECUTION_CONFLICT` (lock contention, retry).

`POST /api/v1/operations/service-lines/:id/cancel`

- Body `{ reason: string }` (strict; `cancelledAt` and every other field rejected).
- 200 `CancelledServiceLineResponse { lineId, visitId, visitCode, visitStatus ('OPEN'|'IN_SERVICE'|'COMPLETED'|'CANCELLED') }`.
- Errors: 400, 401, 403, 404, 409 `SERVICE_LINE_CANCEL_NOT_ALLOWED`, 409 `SERVICE_EXECUTION_CONFLICT`.

`GET /api/v1/operations/branches/:branchId/today` (unchanged auth: `VIEW_BOOKINGS`) additionally returns
`activeVisits` (OPEN / IN_SERVICE visits: today's, plus older ones with a running service; at most 100, oldest arrival
first) with per-line `execution { startedAt, expectedEndAt, overdue }` and `actions { cancel, resolve }`, and
`permissions.cancelLine / resolveExecution`. The hints only shape the UI; each command is re-authorized.

## 5. Authorization and scope (no role names, no new permission)

| Action                | Permission                                             | Scope                                                                                                                                       |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolve forgotten END | `RESOLVE_SERVICE_EXECUTION` (already defined for this) | The visit's own branch, decided inside the transaction; GLOBAL/REGION/AREA grants contain it; DENY wins                                     |
| Cancel a line         | `MANAGE_BOOKINGS`                                      | The visit's own branch. Same permission that already covers walk-in intake, assignment and cancelling a waiting walk-in (Phase 3 design O8) |

- **No self-resolution:** the performer of the execution can never resolve it, even when they hold the permission
  (403). It mirrors the repository's no-self-decision rule (leave, attendance corrections, credentials); their path is the
  normal END. Being the performer grants no management authority.
- `PERFORM_SERVICES` alone, or `RESOLVE_SERVICE_EXECUTION` without `MANAGE_BOOKINGS` (and vice versa), gets 403 for the other action.
- The branch always comes from the record, never from the request.

## 6. State and integrity rules

**Resolution.** Allowed only for an execution that is `IN_PROGRESS`, on an `IN_PROGRESS` line of an `IN_SERVICE` visit.
**Owner decision (Step 2 review): it is NOT restricted to overdue executions.** An actor with `RESOLVE_SERVICE_EXECUTION` in the correct
branch scope may resolve an open execution before its expected end when operationally necessary; the safeguards below, the mandatory
reason and the audit are the control. `startedAt`, planned times and the KTV are never rewritten. `endedAt` (default: the server clock
sampled after the locks) must satisfy `startedAt <= endedAt <= server clock` (boundary values allowed); anything else,
including a future instant, a zone-less string or a malformed value, is 400 `endedAt`. Result: execution `ENDED`,
`end_kind = MANAGER_RESOLVED`, `ended_by_user_id` = the manager, `resolution_reason`, line `DONE`. The performer's later
END is the existing idempotent no-op returning the resolved facts.

**Line cancellation.** Allowed only for a `WAITING` or `PLANNED` line with **no execution row**, in an `OPEN` or
`IN_SERVICE` visit. Refused for started (`IN_PROGRESS`), performed (`DONE`), already-cancelled-by-someone-else lines and for
COMPLETED / CANCELLED visits (a completed visit is never reopened or mutated; history is never deleted — the line stays with
`status = CANCELLED`, server-time `cancelled_at`, `cancelled_by_user_id`, reason; the caller cannot supply a time).
The database trigger releases the KTV occupancy; a cancelled line no longer blocks the participant's sequence, and it can
never START (`SERVICE_START_NOT_ALLOWED`).

**Visit completion (single rule, `settleVisitAfterLineChange`)**, used by normal END, resolution and cancellation:
some line still open -> unchanged; nothing open and at least one `DONE` -> `COMPLETED` (`completedAt` = server time); nothing
open and none performed (every line cancelled) -> the existing `CANCELLED` visit with the cancel reason and actor. No payment
state is involved anywhere.

## 7. Audit

Same-transaction `audit_events`, classification `STANDARD` (operational, not financial; the `FINANCIAL` classification arrives in Step 4):

- `SERVICE_EXECUTION_RESOLVED` — entity `ServiceExecution`, actor = manager, subject = performer, branch, reason,
  `before { lineStatus, executionStatus: IN_PROGRESS, visitStatus, startedAt, expectedEndAt }`, `after { …facts, endedAt,
endKind, endedByUserId, visitStatus, lineStatus: DONE, executionStatus: ENDED, resolvedAt (server action time) }`. Replays write nothing.
- `VISIT_LINE_CANCELLED` — entity `VisitServiceLine`, actor, subject = the line's KTV (if any), branch, reason,
  `before { lineStatus, visitStatus }`, `after { lineStatus: CANCELLED, visitId, visitStatus, cancelledAt }`.

Existing audit rows are never touched.

## 8. Events / outbox — decision

- **Resolution:** the logical END happens once, so it appends **one** `SERVICE_ENDED` event (aggregate `ServiceExecution`) with
  `endKind: MANAGER_RESOLVED`, `endedByUserId` and the real performer as `employeeUserId`; the correction itself is the
  `SERVICE_EXECUTION_RESOLVED` audit. **No second "resolved" event was invented** (this refines the Step 1 table row that
  listed a possible `SERVICE_EXECUTION_RESOLVED` event: audit is sufficient and duplicate END events are avoided).
- **Line cancellation:** audit only, no event (consistent with cancelling a waiting walk-in; Phase 3 defined none). A visit
  completing because of it is derivable from the visit row; consumers must read authoritative state.

### Design-doc clarification made in this Step (reviewed)

The only change to the Owner-approved `PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md` is one row of the section 15.1 event table (the rest of
that diff is Prettier re-aligning the table). It is an **implementation-level clarification discovered during Step 2**: a
management-resolved END emits **exactly one** `SERVICE_ENDED` event (`endKind = MANAGER_RESOLVED`), the resolution-specific correction
details stay in the `SERVICE_EXECUTION_RESOLVED` audit, and no duplicate logical END event is emitted; a line cancel is audit-only. It
does not alter or reopen any locked Owner decision (Q0–Q6, Q9–Q10, OP-1…OP-7); Q0 itself assigned the exact resolution details to Step 2,
and section 5.4 of the contract (reason, end time between start and now, audit) is implemented as written.

## 9. Idempotency and concurrency

- Lock order for both commands (the existing one): graph shared lock -> user rows sorted by UUID (**actor and the line's KTV**, via
  the frame's `lockUsers`, so it serializes with that KTV's own START/END) -> the actor's session -> visit `FOR UPDATE NOWAIT`
  -> line `FOR UPDATE` -> execution `FOR UPDATE`; the clock is sampled after the locks (`clock_timestamp()`), never from the client.
  `NOWAIT` turns a contention with a walk-in assignment or another writer into a retryable 409 instead of a lock inversion.
- **Replay:** the same actor repeating a resolution / cancellation that already happened gets the original result with no second
  write, audit or event; any other actor finds the execution already ended / the line already cancelled (409).
- **Races proven with real connections (section 12):** two resolutions, normal END vs resolution, two cancellations, cancellation vs START.
  Never two winners, never both a cancelled line and an execution.
- Nothing relies on the UI; buttons only reflect the read model.

## 10. Errors

Existing conventions (`AuthError`, stable codes, no driver text); lock/serialization SQLSTATEs map to 409
`SERVICE_EXECUTION_CONFLICT` exactly as START/END do. The 403 for self-resolution reveals nothing about the performer.

## 11. UI (booking board only; no POS, no redesign)

`/{locale}/workforce/booking-board` gets an **"Open visits / Lượt khách đang mở"** section (VI/EN), fed by `activeVisits`:

- per line: participant, service, staff, status badge, running-since / expected end, "past expected end" badge;
- **End by exception** (only when `actions.resolve`): a form with the mandatory reason and a **constrained** end time —
  right now (omitted), at the expected end (offered only once it has passed) or "N minutes after the start" (1…elapsed) —
  never a free timestamp editor;
- **Cancel unperformed service** (only when `actions.cancel`): mandatory reason; the success message says when the visit
  completed or was cancelled as a result;
- stale/conflict answers show the new 409 texts and reload the board (which also refreshes every 30 s).

Pure logic in `apps/web/src/lib/workforce/visit-completion.ts` (reason normalization, end-time body construction).

## 12. Tests and exact results

Validation database: local scratch `lucy_spa_step2_validation_20260930` (created for this Step, 25 migrations applied via
`pnpm db:deploy`, `db:status` up to date; not `lucy_spa_dev`, not production). No production data touched.

| Suite / command                                                                                                                                                                                                              | Result                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `visit-completion.integration.test` (new; 13 scenarios + parent; fixtures roll back)                                                                                                                                         | **14 / 14 pass**                                                                            |
| `visit-completion.race.integration.test` (new; 4 race scenarios x 4 rounds; committed data)                                                                                                                                  | **5 / 5 pass, 3 consecutive runs; cleanup left 0 users/visits/branches/audit rows**         |
| `visit-completion.http.test` (new)                                                                                                                                                                                           | **1 / 1 pass**                                                                              |
| `apps/web` `visit-completion.test` (new, 5 tests) within `pnpm test` web                                                                                                                                                     | **web 151 / 151 pass** (was 146)                                                            |
| Phase 3 regression set on the scratch DB: service-execution, operations (+race), walk-in (+race), reassignment, execution-reassignment race, availability, customer-booking integrations + service-execution/operations HTTP | **95 pass, 0 fail** (1 skip = the worker suite without its opt-in variable)                 |
| Worker `booking-jobs.integration` with `PHASE3_TEST_DATABASE_URL` + local `REDIS_URL` (real Redis)                                                                                                                           | **10 / 10 pass**                                                                            |
| `pnpm test` (unit/HTTP, no DB)                                                                                                                                                                                               | server 22/22; worker 8 pass + 1 skipped; web 151/151; api 149 pass + 49 skipped (DB opt-in) |
| `pnpm format:check`, `pnpm lint` (+ boundaries), `pnpm typecheck` (all packages, Next route types)                                                                                                                           | pass                                                                                        |

Coverage of the required list: resolution — success, unauthorized, wrong branch, missing/blank/over-long reason, already-ended,
never-started, invalid / future / zone-less end time and boundary, self-resolution, normal END vs resolution and resolution vs
resolution races, replay, final execution completing the visit (and a non-final one not), audit content, one END event;
cancellation — success, unauthorized, wrong branch, missing reason, already-cancelled (same actor replay / other actor), started
and performed lines, completed visit, WAITING line, cancellation vs START and vs cancellation races, replay, occupancy released,
cancelled line cannot START, sequence unblocked, history/audit retained, database refuses deleting the line; board actions.
A production **web build was not run**: it regenerates the protected `apps/web/next-env.d.ts`; `next typegen` + `tsc`, the web
tests and the API/worker builds cover the changed code.

## 13. Deferrals and limitations

- Staff-added service, and any invoice/POS work: Step 3 and later. Invoice lines (Step 5) come only from `DONE` visit lines.
- A cancellation that closes a visit publishes no event; no notification is sent to the KTV for a cancelled line (Phase 3 sent none for walk-in cancels either).
- Resolution is not limited to overdue executions (**Owner-approved**; see section 6). A custom clock-time editor was not built (constrained choices only).
- `activeVisits` is capped at 100 rows per branch.
- The web layer has no browser/DOM test (repository limitation); the board changes are covered by typecheck, pure-logic tests and the API contract tests.

## 14. Pre-existing unrelated issues

Unchanged and not touched: the two `My Income` integration assertions that fail only between 15:00 and 17:00 UTC (not run
in this Step), and the non-failing `pg` deprecation warning about queued queries on a transaction client.

## 15. Step 3 continuation context

Step 3 (`docs/PHASE4_STEP3_STAFF_ADDED_SERVICE.md`) adds a staff-added visit line (`added_on_behalf`, actor, time, KTV) using an
existing catalog service with no price and no free-text name, placed through the availability engine under the locks
in section 9, allowed only while the visit is `OPEN` or `IN_SERVICE`. Reuse: `runAdminCommand` + `lockUsers`, the visit `NOWAIT`
-> line lock order, the walk-in planner/engine calls, `settleVisitAfterLineChange` (nothing to settle when a line is added), and
the new `activeVisits` board section as the natural place for a desk action. The quantity-limit snapshot columns arrive in
Step 4 (OP-1); Step 3 does not depend on them. Step 3 has NOT started and needs the Owner's explicit instruction.
