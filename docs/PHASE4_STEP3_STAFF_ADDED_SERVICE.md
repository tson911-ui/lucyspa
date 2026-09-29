# Phase 4 Step 3 — Staff-Added Service

Status: **CLOSED / OWNER APPROVED — implemented, validated locally, checkpoint-committed and pushed (`feat: complete phase 4 step 3 staff-added service`), not deployed to production.** The three Owner clarifications in section 15 are approved exactly as documented: PERFORM_SERVICES "own Visit" semantics; the 20 service-line maximum is a technical safety bound, not business policy; one VisitServiceLine = one operational service performance with no quantity field; the exact OP-1 quantity/quantityLimit persistence location is deferred to the Step 4/5 design. Step 4 has NOT started.
Contract: [PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md](PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md) (Step 1, `71c9286`);
Step 2: [PHASE4_STEP2_VISIT_COMPLETION.md](PHASE4_STEP2_VISIT_COMPLETION.md) (`a30ae9a`). Locked decisions Q0–Q6, Q9–Q10 and
OP-1…OP-7 are untouched; Q7 (before Step 8) and Q8 (before Step 10) remain open.

## 1. Scope

Let authorized staff add ONE existing catalog service to an existing OPEN or IN_SERVICE visit, on behalf of the customer (PRD 13.5).
The result is a real `VisitServiceLine` that joins the normal lifecycle (assignment, START/END, Step 2 cancellation, shared
completion rule). Not in this Step: Invoice / POS / Payment / Discount / Voucher / PayOS, products, combos, loyalty, tips, revenue,
quantity / quantity-limit persistence (Step 4/5) and Step 4 itself.

## 2. Repository facts discovered before implementing

- `visit_service_lines` already carries `added_on_behalf`, `added_by_user_id`, `added_at` with a CHECK, and the full catalog snapshot
  (code, VI/EN names, duration, price min/max, unit); the line guard allows inserting a `WAITING` or `PLANNED` line and moving
  `WAITING -> PLANNED|CANCELLED`. Nothing wrote those columns before this Step.
- The Phase 3 walk-in machinery already does what a staff-added line needs: `assignWaitingSequence` places a participant's WAITING
  lines through the OPERATIONAL availability engine, the KTV row locks, the planner (tie-break) and the `ktv_occupancies` exclusion
  backstop, for visits that are `OPEN` **or** `IN_SERVICE`, appends `VISIT_LINE_SCHEDULED` (which the worker uses to schedule the
  warnings) and audits `VISIT_LINE_ASSIGNED`. It was reused unchanged.
- The shared completion rule from Step 2 (`settleVisitAfterLineChange`) already counts WAITING/PLANNED/IN_PROGRESS as open, so an
  added line keeps a visit from completing with no change to that rule; the database visit guard independently refuses to close a
  visit with an open line.
- The Phase 3 design (O8) gives adding a service to two existing permissions: `MANAGE_BOOKINGS` ("add lines") and
  `PERFORM_SERVICES` ("add a service on behalf of the customer"). No new permission is needed.
- A visit line has **no quantity**: one line is one performed service. OP-1 (per-service quantity limit with a historical snapshot)
  concerns Invoice/POS quantity; its exact persistence location is a Step 4/5 decision, so Step 3 adds no quantity or limit column and its
  request has no quantity.
- There was no idempotency storage for line creation (bookings/visits store keys on their own rows).

## 3. Files

Created: `apps/api/src/operations/visit-service-add.core.ts`, `apps/api/src/walkin/service-options.ts`,
`apps/api/src/operations/visit-service-add.{integration,race.integration,http}.test.ts`,
`packages/database/src/phase4-visit-line-add-requests.integration.test.ts`,
`packages/database/prisma/migrations/20261013000000_phase4_visit_line_add_requests/migration.sql`,
`apps/web/src/components/workforce/screens/add-service.tsx`, `apps/web/src/lib/workforce/add-service.{ts,test.ts}`,
this report.

Modified: `packages/database/prisma/schema.prisma`, `packages/database/package.json` (test list),
`packages/contracts/src/index.ts`, `apps/api/src/auth/auth.error.ts`, `apps/api/src/operations/{service-execution.controller,
service-execution.service,service-execution.core,operations.core}.ts`, `apps/api/src/walkin/{walkin.service,walkin.core}.ts`,
`apps/web/src/components/workforce/screens/{booking-board,my-services}.tsx`, `apps/web/src/i18n/workforce.ts`,
`scripts/test-auth-integration.mjs`, `LUCYSPA_HANDOFF.md`, and one clarification in the design contract (section 14).

Small refactors, behavior unchanged and covered by the regression run: the walk-in option query moved verbatim into
`loadServiceOptions` (used by `WalkInService.options` and the new options endpoint); `requirePerformer` and
`requireRequestedEmployee` became exported.

## 4. Migration

**One additive migration, `20261013000000_phase4_visit_line_add_requests`: a new append-only table `visit_line_add_requests`**
(`actor_user_id`, `idempotency_key uuid`, `visit_service_line_id`, `created_at`), unique `(actor_user_id, idempotency_key)` and unique
`visit_service_line_id`, restrictive FKs to `users` and `visit_service_lines`, and the existing Phase 1 append-only /
no-truncate triggers. No existing table, column, enum, guard or permission changed; no data rewritten.

Why it is required: the Owner asked that replaying a request never duplicates a line, and the repository pattern for that is a client
UUID unique per actor with a stored outcome. Adding a service is not naturally idempotent (a customer may legitimately buy the same
service twice), and `visit_service_lines` has no key column; adding one would have meant replacing the line guard function, so a separate
append-only table is the smallest safe change.

Validation: applied to a scratch database with the other 24 migrations (`db:deploy`, `db:status`: 26 migrations, up to date);
`prisma migrate diff` shows only the two known composite-FK Prisma limitations (nothing for the new table); a database test covers the
unique keys, restrictive references and append-only behavior.

## 5. API

`POST /api/v1/operations/visits/:id/lines` (`:id` = visit id) — body, strict (any other field is 400, including `name`, `price`,
`quantity`, `plannedStartAt`, `status`, `employeeUserId`):
`{ participantId: uuid, serviceId: uuid, requestedEmployeeUserId?: uuid | null, idempotencyKey: uuid }`.
200 `AddedServiceLineResponse { lineId, visitId, visitCode, participantId, sequence, status: 'PLANNED'|'WAITING', assignmentMode,
employee, plannedStartAt, plannedEndAt, waitReason, replayed }`.
Errors: 400 `VALIDATION_FAILED` (`participantId`, `serviceId`, `idempotencyKey`, `requestedEmployeeUserId`), 401, 403 `FORBIDDEN`,
404 `NOT_FOUND`, 409 `VISIT_LINE_ADD_NOT_ALLOWED` (visit not OPEN/IN_SERVICE, or already 20 non-cancelled services, the existing walk-in
bound), 409 `BOOKING_SERVICE_UNAVAILABLE` (inactive service/category or not offered at the branch), 409 `CONFLICT` (key reused for a
different request), 409 `SERVICE_EXECUTION_CONFLICT` (lock/serialization contention, retry).

`GET /api/v1/operations/visits/:id/add-service-options` — the branch's offered services (reference price range, never a bill) and, for a desk
actor, the qualified KTVs; a performer gets the services with no staff list. Same authority as the add; refused for a closed visit.

Read models: `OperationalActiveVisit` gains `participants` and `actions.addService`; `ServiceExecutionWork.actions.addService`.

## 6. Permissions (no new permission, no role names)

| Path      | Requirement                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desk      | `MANAGE_BOOKINGS` at the **visit's** branch (never a client branch). May name any qualified KTV.                                                                                                                                   |
| Performer | `PERFORM_SERVICES` at the visit's branch, an active employee there (same check as START/END), **and assigned to a non-cancelled line of this very visit**. May leave the KTV open or choose themselves; naming another KTV is 403. |

A KTV who is not serving the visit is refused, and neither permission grants price authority: the request cannot express a price, and
the line only stores the catalog reference snapshot. The interpretation "performer must be serving that visit" is this Step's
containment of the design's "own" wording (see section 15).

## 7. Service, price and quantity

Only an active catalog service, in an active category, offered (active) at the visit's branch. The line snapshots code, VI/EN names,
`duration_minutes`, catalog min/max price and unit at that moment; a later catalog change never touches it (tested). No arbitrary name,
price or time is accepted. A visit line has no quantity (one line = one operational performance; the same service performed twice may be two lines). OP-1 is
preserved and its persistence location is deferred to Step 4/5. Price selection inside the snapshot range remains an invoice-time act (Q1, Step 5).

## 8. KTV, skills, availability, occupancy

The line is created `WAITING` (intent `ANY`, or `SPECIFIC` with the requested KTV, which must belong to the branch) and gets one immediate
assignment attempt through the unchanged Phase 3 machinery: OPERATIONAL engine (branch-local today, attendance, employment, branch
assignment, skills, leave, CTV work, existing bookings/visits, running services, buffers, closing time), KTV rows locked in sorted order
and the engine read again, the planner (SPECIFIC never substituted; ANY single-KTV first, tie-break), and the exclusion constraint as the
backstop. Success -> `PLANNED` with a real KTV and time; no capacity, an unqualified or busy requested KTV, or a lost race -> the line
stays `WAITING` with a wait reason (never an error, never an unqualified KTV, never an overlap) and is placed later by the existing
operational flow. The participant's earlier services still come first (sequence blocking is unchanged).

## 9. Visit lifecycle

Allowed visit states: `OPEN` and `IN_SERVICE` only; `COMPLETED` and `CANCELLED` are refused and never reopened or mutated. The new open line
prevents completion (the visit stays `IN_SERVICE` when the earlier services end). The line then follows START/END, the Step 2 cancellation
(`WAITING` or `PLANNED`, tested) and the single shared completion rule; nothing about payment is involved.

## 10. Audit and events

Audit `VISIT_LINE_ADDED` (STANDARD, not financial): actor, branch, visit, participant, sequence, service id/code, duration, intent and
requested KTV, the catalog price range and unit (strings), `addedOnBehalf`, `via` (`DESK`|`PERFORMER`), the visit status and server
time. The assignment writes its own `VISIT_LINE_ASSIGNED`. **Events:** no new event; the existing `VISIT_LINE_SCHEDULED`, emitted by the
assignment when a KTV is placed, already schedules the START/END warnings. A WAITING line emits none (nothing to schedule).

## 11. Concurrency and idempotency

- Serialization: the visit row is locked `FOR UPDATE` (the row START/END and Step 2 cancellation take `NOWAIT`, walk-in assignment takes),
  then the engine/KTV locks of the assignment. So add vs the last END, add vs cancelling the last line, add vs add and add vs completion are
  serialized and re-checked; the loser sees the new state (refused, or a retryable `SERVICE_EXECUTION_CONFLICT` for `NOWAIT` contenders).
- KTV time: engine re-read under KTV locks plus the database exclusion constraint; two visits wanting the same KTV time end with one planned
  line and one waiting line, never an overlap (race-tested).
- Idempotency: `idempotencyKey` is a client UUID unique per actor and stored append-only. A replay by the same actor returns the same line
  (`replayed: true`) with no second line, audit or event; the key reused for a different request is 409 `CONFLICT`; another actor's identical
  key is a different request. Checked before and again after taking the visit lock; the unique index is the backstop for a true simultaneous
  pair (race-tested: one line, one audit, one stored request).
- Catalog changes during the operation: the service row is read inside the transaction; a concurrent deactivation that commits after that
  read is not blocked (the same as walk-in intake), and the snapshot is taken from the row read.

## 12. UI (minimal; the full redesign comes later)

- **Booking board -> "Open visits":** an "Add service" button on each visit (when `actions.addService`) opens an inline form: participant,
  catalog service (with the reference price range), staff (any / me / qualified staff). No free text, price or quantity field exists.
- **My services:** the performer sees "Add service" on their own lines (visit still open); the form is the same, staff choice is any / me.
- VI/EN texts, the outcome message says whether a KTV was scheduled or the service is waiting, and stale/conflict answers show clear texts.
  The form keeps one idempotency key per identical choice and regenerates it when the choice changes.

## 13. Tests and exact results

Validation database: local scratch `lucy_spa_step3_validation_20260930` (all 25 migrations + the new one via `pnpm db:deploy`); not
`lucy_spa_dev`, not production.

| Suite                                                                                                                                                                                                                                                                             | Result                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `visit-service-add.integration.test` (new; 10 scenarios + parent)                                                                                                                                                                                                                 | **11 / 11 pass**                                                                            |
| `visit-service-add.race.integration.test` (new; 4 scenarios x 4 rounds, committed data)                                                                                                                                                                                           | **5 / 5 pass, 3 consecutive runs; cleanup left 0 rows**                                     |
| `visit-service-add.http.test` (new)                                                                                                                                                                                                                                               | **1 / 1 pass**                                                                              |
| `phase4-visit-line-add-requests.integration.test` (new, database package)                                                                                                                                                                                                         | **1 / 1 pass**                                                                              |
| Web `add-service.test` (new, 4 tests) within `pnpm test`                                                                                                                                                                                                                          | **web 155 / 155 pass** (was 151)                                                            |
| Regression on the scratch DB: service-execution, operations (+race), walk-in (+race), reassignment, execution-reassignment race, availability, customer-booking, Step 2 (integration, race, HTTP), and the affected HTTP tests; worker `booking-jobs.integration` with real Redis | **123 / 123 pass, 0 skipped**                                                               |
| Database package integration list (7 suites incl. the new one)                                                                                                                                                                                                                    | **45 / 45 pass**                                                                            |
| `pnpm test` (unit/HTTP without DB)                                                                                                                                                                                                                                                | server 22/22; worker 8 pass + 1 skipped; web 155/155; api 150 pass + 51 skipped (DB opt-in) |
| `pnpm format:check`, `pnpm lint` (+ boundaries), `pnpm typecheck` (all packages)                                                                                                                                                                                                  | pass                                                                                        |

Coverage of the required list: valid add; inactive / not-offered / inactive-category / unknown service; completed and cancelled visits;
branch scope, no permission, stranger KTV, performer naming another KTV, missing token, unknown ids; strict body (price, name, quantity, time,
status and other fields rejected); skill qualification and unqualified requested KTV; occupancy conflict; START/END of the added line and the
visit staying open until it is done; Step 2 cancellation of an unstarted (PLANNED and WAITING) added line; no-capacity WAITING line; replay,
key mismatch and per-actor keys; bounded visit size; audit and event content; snapshot immutability against a later catalog change; read models;
and four real-connection races. A web production build was **not** run (it regenerates the protected `apps/web/next-env.d.ts`).

## 14. Design-doc edit (reported)

`docs/PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md` section 5.4 (Step 3 contract) and the section 19 Step 3 row gained implementation-level
clarifications: no quantity on a visit line, the two authority paths, WAITING-then-assign behavior, the replay table, audit and event
decision, and that Step 3 adds one additive migration (previously "none expected"). No locked Owner decision (Q0–Q6, Q9–Q10, OP-1…OP-7) is
changed or reopened. After the Owner review, the same clarification text was corrected to remove the "OP-1 applies to the invoice line /
Step 4 columns" wording and to record the approved "own Visit" meaning, the technical-bound status of the 20 limit, and the deferral of
quantity persistence; the proposal in section 4.3.1 is now explicitly marked as not presupposed by Step 3.

## 15. Owner review decisions (all three APPROVED) and open notes

1. **"Own Visit" (approved meaning):** a `PERFORM_SERVICES` performer may add a service only to a Visit they are actively serving through a
   non-cancelled `VisitServiceLine`. They may leave the new line unassigned (existing flow) or request themselves; they may NOT add to
   unrelated Visits or request another KTV through performer authority alone. Desk authority (`MANAGE_BOOKINGS`) is separate and
   branch-scoped.
2. **20-service bound (approved, kept):** a **technical safety bound** inherited from the walk-in architecture (`WALKIN_LIMITS.lines`),
   **not a Lucy Spa business policy**. No new configurable rule; the UI shows nothing about it except the ordinary refusal when the bound
   is actually reached.
3. **Operational quantity model (approved):** one `VisitServiceLine` = one operational service performance; **no** quantity field on
   `VisitServiceLine` in Step 3. Performing the same catalog service twice may create two lines so assignment, timing, START/END,
   cancellation and performer history stay independent. Invoice/POS quantity is a later concern. OP-1 is preserved (per-Service limit,
   historically correct snapshot) but this Step does **not** decide where it is persisted: any earlier statement that quantity-limit
   columns "must" be added to `VisitServiceLine` was withdrawn; the exact location follows the Step 4/5 Invoice/POS architecture.
   No InvoiceLine or quantity-limit schema exists.

No other ambiguity.

## 16. Deferrals

Invoice/POS and price selection (Step 5), quantity / quantity-limit persistence (Step 4/5 design), notification to a specific KTV about an added line,
reassignment of a WAITING added line beyond the existing assignment flow, and everything in Steps 4–11.

## 17. Pre-existing unrelated issues

Not touched: the two `My Income` assertions failing only between 15:00 and 17:00 UTC (not run) and the non-failing `pg` deprecation warning.

## 18. Step 4 continuation context

Step 4 (`docs/PHASE4_STEP4_DATABASE_FOUNDATION.md`) creates the POS schema and permissions and carries the OP-1 quantity-limit foundation.
Where that snapshot lives is decided there. If it needs a value at line establishment, `addVisitServiceLine` (`visit-service-add.core.ts`,
where catalog values are read) is the Step 3 touch point to review. Reuse: `visit_line_add_requests` is independent and stays as is.
Do not start Step 4 without the Owner's instruction.
