# Phase 3 — Step 6: Walk-In, Guest & Visit Foundation

Status: Phase 3 Step 6 = **OWNER APPROVED / COMPLETE**. Phase 3 Step 7 = **NOT STARTED**.

Front-desk intake of customers without a booking, built on Steps 1–5. It includes the **Owner-approved TRUE WAITING WALK-IN foundation amendment**, recorded in §3 and in [`PHASE3_STEP2_DATABASE_FOUNDATION.md`](PHASE3_STEP2_DATABASE_FOUNDATION.md) ("Amendment (Step 6)").

## 1. Why the Step 2 amendment was necessary

In the Step 2 schema, every visit service line had to carry a real KTV and planned interval: `employee_user_id`, `planned_start_at` and `planned_end_at` were `NOT NULL`, and every line immediately claimed KTV occupancy.

A physically present walk-in with no free KTV therefore could not be recorded without inventing a KTV or a time. The Owner rejected both alternatives:

- leaving the customer unrecorded;
- reserving an arbitrary future slot.

The Owner chose **Option C**: a line may **wait** with its real service intent, but no KTV, no times and no occupancy, until an initial assignment gives it real ones.

## 2. Files

**Database:**

- Migration `20261006000000_phase3_visit_line_waiting_status`: enum value `WAITING`, in its own migration.
- Migration `20261006000001_phase3_waiting_walkin_lines`: nullable assignment columns, `requested_employee_user_id`, CHECKs, indexes, updated triggers, hardening.
- `packages/database/prisma/schema.prisma`:
  - `WAITING`;
  - optional `employeeUserId`/`employee`, `plannedStartAt`/`plannedEndAt` and `bufferMinutes`;
  - `requestedEmployee`, with named `EmployeeProfile` relations.
- `packages/database/src/phase3-foundation.integration.test.ts`: one new subtest.

**API:**

- New `apps/api/src/walkin/`:
  - `walkin.core.ts`, `walkin.service.ts`, `walkin.controller.ts`;
  - `walkin.integration.test.ts`, `walkin.race.integration.test.ts`, `walkin.http.test.ts`.
- Changed:
  - `app.module.ts`;
  - `auth/auth.error.ts`: `WALKIN_NOT_ASSIGNABLE`, `WALKIN_LINE_NOT_WAITING`;
  - `operations/operations.core.ts`: the `waitingPool`, and assigned-line narrowing in the per-KTV queues;
  - `operations/operations.integration.test.ts`: a nullable-type adjustment only;
  - `booking/booking.core.ts`: customer cancellation after check-in also cancels `WAITING` lines.

**Contracts:** the walk-in, member-lookup, waiting-pool and intent types; `waitingPool` on `OperationalTodayResponse`.

**Web:**

- New:
  - `components/workforce/screens/walk-in.tsx`;
  - the route `app/[locale]/workforce/(app)/walk-in/page.tsx`;
  - `lib/workforce/walk-in.ts` and its test.
- Changed:
  - `components/workforce/screens/booking-board.tsx`: the waiting-pool section; advance now takes any visit;
  - `lib/workforce/permissions.ts`: nav `walkIn`, shown with `MANAGE_BOOKINGS`;
  - `lib/workforce/permissions.test.ts`: the Owner's nav list;
  - `i18n/workforce.ts`: `walkIn` and the pool texts, VI/EN.

**Other:** `scripts/test-auth-integration.mjs` (two new integration tests), this document, the Step 2 amendment note, and `LUCYSPA_HANDOFF.md`.

## 3. Visit service line lifecycle and invariants (database-enforced)

```
WAITING → PLANNED → IN_PROGRESS → DONE
WAITING → CANCELLED        PLANNED → CANCELLED
```

| Status                           | Assigned KTV, planned start and end, buffer                      | Occupancy                                                       |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `WAITING`                        | all NULL; `booking_service_line_id` NULL                         | **none**                                                        |
| `PLANNED`, `IN_PROGRESS`, `DONE` | all NOT NULL, with end = start + duration (existing shape CHECK) | `PLANNED`/`IN_PROGRESS`: exactly the normal claim; `DONE`: none |
| `CANCELLED`                      | all set or all NULL (keeps its last shape)                       | none                                                            |

**Always true:**

- **Snapshots:** `duration_minutes`, the catalog snapshot (code, VI/EN names, price min/max, unit), `service_id`, `sequence` and `assignment_mode` are required.
- **Assignment tuple:** KTV, start, end and buffer are **all-or-none** (CHECK `visit_service_lines_assignment`).
- **Requested KTV** (CHECK `visit_service_lines_requested`):
  - allowed only with `SPECIFIC`;
  - required while a `SPECIFIC` line waits;
  - an assigned requested line's KTV **equals** the requested KTV, so there is no silent substitution.
- **Guard trigger (`lucy_guard_visit_service_line`):**
  - inserts may be `PLANNED` or `WAITING`;
  - transitions are limited to the lifecycle above;
  - the KTV is set by `WAITING → PLANNED`, may change while `PLANNED` (Step 8) and is fixed once started;
  - intent (mode and requested KTV) changes only while `WAITING`;
  - snapshot and duration are immutable.
- **Occupancy trigger:** claims only when `PLANNED`/`IN_PROGRESS` **and** a KTV is assigned, so `WAITING` never creates a claim. `WAITING → PLANNED` creates the claim under the **unchanged** overlap exclusion constraint.
- **Visit guard:** a visit cannot close while any line is `WAITING`, `PLANNED` or `IN_PROGRESS`.
- **START (Step 7) compatibility:** the existing execution guard requires the executing employee to equal the line's assigned KTV. A `WAITING` line has none, so it **can never start** (tested).
- **Buffer (Owner decision 1, OWNER APPROVED):** the duration and catalog facts are snapshotted at intake. A `WAITING` line has buffer **NULL** (with no KTV, no planned times and no occupancy). The buffer is snapshotted only when `WAITING → PLANNED` succeeds, from the current `booking.serviceBufferMinutes`, and is kept afterwards.

## 4. Member lookup and identity

- `GET /api/v1/operations/branches/:branchId/members?phone=…` or `?email=…` (contract §9: phone or email lookup, masked, staff confirm).
  - **Exact** match on the normalized phone (`normalizePhone`) or email (`normalizeEmail`) only.
  - Active **CUSTOMER** accounts only, and at most one result.
  - There is no name or partial search, so no enumeration.
  - It returns `{ id, displayName, phoneMasked, emailMasked }` only.
- No lookup ever creates or completes an account. "No member found" means continuing as a guest.
- **Staff never create accounts.**
  - A **member** participant links to the existing customer (`customer_user_id`).
  - **Guests** and **children** are named participants with no account, email, password or invented phone (a guest may give a phone).
  - **Owner (Owner decision):** a direct walk-in's `owner_user_id` is **NULL**. A member participant is a service recipient, never an inferred account owner, and participant order never matters. The intake request has no explicit owner field, and Step 6 defines no payer semantics (Phase 4 owns settlement).

## 5. Participants (locked Step 5 rule)

- `MEMBER`: an existing active customer.
- `GUEST`: a name, with an optional phone.
- `CHILD`: a name plus a guardian, who must be an adult (member or guest) in **the same walk-in**. Without an adult present, staff record the child as a guest. The UI only offers a child when an adult exists.
- Several participants per visit are supported. Each participant's services form their own ordered sequence, and different participants may be served in parallel.

## 6. Walk-in intake (direct visit)

`POST /api/v1/operations/branches/:branchId/walk-ins { idempotencyKey, participants[], lines[] }`. Lines are `{ participantKey, serviceId, requestedEmployeeUserId | null }`. The browser cannot send arrival time, KTV, times, status, owner or prices (strict DTO).

In one transaction:

1. **Replay:** the same (actor, idempotency key) returns the same visit, using the existing unique `visits (created_by_user_id, idempotency_key)`.
2. **Checks:**
   - the branch is active;
   - members exist as active customers;
   - services are active and offered at the branch (otherwise `BOOKING_SERVICE_UNAVAILABLE`);
   - each requested KTV is assigned to the branch.
3. **The visit:** `origin = WALK_IN`, `OPEN`, **no booking**, **no owner** (`owner_user_id` NULL), `arrived_at` = **the database clock**, and a branch-local `service_date`.
4. **Participants, then the lines,** all `WAITING`, with the per-participant sequence and snapshots.
5. **Audit and event:** audit `WALK_IN_CREATED` (counts only, no personal data); outbox `WALK_IN_CREATED` (contract §17).
6. **Immediate assignment (Owner decision 4):** one attempt per participant (§7). No capacity keeps the lines `WAITING`; the intake still succeeds.

The response reports each participant as `ASSIGNED` (KTV and times per line) or `WAITING` with a reason:

- `NO_CAPACITY`;
- `REQUESTED_KTV_UNAVAILABLE`;
- `OUTSIDE_HOURS`;
- `SERVICE_UNAVAILABLE`.

## 7. Initial assignment (Owner-approved Step 6 operation; not Step 8)

`POST /api/v1/operations/visits/:visitId/participants/:participantId/assign` (empty body), also used internally by intake. The unit is **one participant's ordered `WAITING` sequence** (Owner decision 2). In the caller's transaction:

1. **Lock the visit row** `FOR UPDATE` (serializes assignments of the visit) and authorize at its branch.
2. **Load the participant's `WAITING` lines.** If none remain, the result is "assigned" (idempotent).
3. **Origin:** the **exact authoritative database clock** (Owner decision 3/4). Planned times are never earlier than the assignment's `now`; the only difference is JavaScript's millisecond precision, less than 1 ms. If the participant already has planned or running lines, the origin is their end plus buffer.
   - The Step 3 engine works in whole branch-local minutes. That is an application rule, not a database invariant, so it evaluates the sequence from the **next whole minute**, which covers each stored interval except its first seconds.
   - The unchanged overlap exclusion constraint still guards those seconds: a conflict there keeps the line `WAITING`.
   - There is no slot grid for walk-ins.
4. **Pre-lock engine read** in the **`OPERATIONAL`** context. It enforces:
   - the branch-local same day and attendance;
   - employment, branch assignment and skills;
   - leave and CTV occurrence;
   - bookings, assigned visit lines and open executions;
   - buffers and closing time.

   The involved KTV rows (requested ones, and every Any candidate) are then locked `FOR UPDATE` in sorted order.

5. **Engine read again under the locks,** then the **Step 4 planner** (reused unchanged):
   - `SPECIFIC` lines only with their requested KTV;
   - `ANY` lines single-KTV-first for the whole sequence, split only when needed, with previous-line preference and the locked booked-minutes tie-break.
6. **Success:** each line `WAITING → PLANNED` with the KTV, planned start and end and the **current buffer**. The trigger claims the occupancy.
   - Audit `VISIT_LINE_ASSIGNED`; outbox `VISIT_LINE_SCHEDULED` (contract §17).
   - A lost race (`23P01`) rolls back to a savepoint: the lines stay `WAITING`, and the rest of the caller's transaction (for example the intake) is intact.
7. **No capacity:** the lines stay `WAITING` and nothing is written.

**Protected bookings:** the engine's `CONFLICT` covers the whole occupancy [start, end + buffer). A walk-in is placed only if its entire sequence fits before a KTV's next reserved or planned interval (tested with a booking 20 minutes ahead).

## 8. Waiting intent (Owner decision 5)

`POST /api/v1/operations/visits/:visitId/lines/:lineId/intent { requestedEmployeeUserId | null }`:

- changes ANY ↔ SPECIFIC, or requested KTV A → B;
- only on `WAITING` lines (otherwise `WALKIN_LINE_NOT_WAITING`), and the requested KTV must be assigned to the visit's branch;
- creates **no occupancy**;
- audit `WAITING_INTENT_CHANGED` with before/after; a repeat with the same intent is a no-op.

Changing the KTV of an **assigned** line remains Step 8 (`REASSIGN_SERVICES`).

## 8a. Cancel a waiting walk-in (Owner decision 3, part of Step 6)

The customer of a walk-in leaves before any service started. This is **not** a no-show.

`POST /api/v1/operations/visits/:visitId/cancel-walk-in { reason }`:

- `MANAGE_BOOKINGS` at the visit's own branch; **reason required** (1–500 characters).
- **Lock:** the visit row is locked first, exactly like initial assignment, so the two serialize.
- **Allowed** only for `origin = WALK_IN` visits that are `OPEN` with no line `IN_PROGRESS`/`DONE`, that is, before any START. Otherwise `WALKIN_CANCEL_NOT_ALLOWED`. Booked visits keep the customer cancellation path.
- **Effect:**
  - every `WAITING` line, and every pre-START `PLANNED` line, becomes `CANCELLED` with actor, time and reason;
  - a `WAITING` line never had an occupancy claim;
  - a `PLANNED` line's claim is released by the existing Step 2 trigger;
  - then the visit becomes `CANCELLED`, the existing terminal state, with actor, time and reason;
  - there is no new state, and the visit guard makes a closed visit with an open line impossible.
- **Result:** the walk-in disappears from the `waitingPool`, and a later assignment is refused (`WALKIN_NOT_ASSIGNABLE`, checked before the idempotent shortcut).
- **Audit and repeat:** audit `WALK_IN_CANCELLED` with the reason. The contract (§17) defines no outbox event for it, so none is written. A repeat on a cancelled walk-in returns quietly.
- **Race with assignment** (proven with real connections): exactly one of two outcomes.
  - **Cancellation first:** lines are cancelled, nothing is ever claimed, and the assignment is refused.
  - **Assignment first:** its `PLANNED` line is cancelled before START, and its claim is released.

  Either way the end state is a `CANCELLED` visit with `CANCELLED` lines and **no occupancy**.

## 9. Queue integration (Step 5 board)

- **Branch-level `waitingPool`** (new, on `GET /api/v1/operations/branches/:branchId/today`):
  - one entry per participant with `WAITING` lines in today's `OPEN`/`IN_SERVICE` visits;
  - each entry shows the visit, arrival time, participant and kind, the service sequence (mode, requested KTV) and the allowed actions (assign, change intent, advance);
  - **no fake KTV.**
  - Ordered by the **same `orderQueue`**: Manager-advanced first (`OVERRIDE`, by override time), then `WALK_IN` by actual arrival, with the Step 5 tie-breaks.
  - The order is **advisory** (Owner decision 6): any entry that fits may be assigned.
- **Per-KTV queues** list only **assigned** lines, as before. After assignment, a walk-in's lines appear in its KTV's queue in the `WALK_IN` group. The locked order `OVERRIDE → ON_TIME → LATE_IN_HOLD → (LATE_AFTER_HOLD + WALK_IN by arrival)` is unchanged (Step 5 tests still pass).
- **Step 3:** a `WAITING` line claims nothing, so it never blocks availability (tested).

## 10. Permissions (contract §14; no role names; skills never authorize)

| Operation                                      | Permission, at the record's own branch                               |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| Member lookup, walk-in options, walk-in intake | `MANAGE_BOOKINGS` ("create walk-ins and participants, add lines")    |
| Initial assignment of a waiting sequence       | `MANAGE_BOOKINGS`. It is initial assignment, not `REASSIGN_SERVICES` |
| Waiting intent change                          | `MANAGE_BOOKINGS`                                                    |
| Cancel a waiting walk-in                       | `MANAGE_BOOKINGS` (reason required)                                  |
| Advancing a waiting walk-in                    | `MANAGE_QUEUE` (existing Step 5 advance)                             |
| Viewing the pool                               | `VIEW_BOOKINGS` (the board)                                          |

Branch ids from the browser are never trusted: assignment and intent use the visit's branch, read inside the transaction.

## 11. Idempotency and concurrency

- **Intake:** replays by (actor, idempotency key). The actor's row lock in the workforce frame serializes duplicates.
- **Assignment:** serialized by the visit row lock. A repeat returns the current state with no second claim or event.
- **Competing assignments** for the same KTV: the KTV row locks serialize them, and the second re-check sees the first's claim. The exclusion constraint stays the backstop.
- **Race test** (real connections, lock held until both are observed waiting):
  - two walk-ins for the same KTV: both intakes succeed, exactly one line is `PLANNED` and the other `WAITING`, with one claim;
  - two assignments of the same waiting visit: both report assigned, with one claim and one `VISIT_LINE_SCHEDULED`;
  - cancellation vs assignment of the same waiting walk-in: one valid lifecycle, ending in a `CANCELLED` visit and lines with no occupancy.

## 12. UI

- **`/{vi|en}/workforce/walk-in` ("Khách vãng lai / Walk-in"):**
  - branch selector (branches with `MANAGE_BOOKINGS`);
  - member lookup by exact phone or email, with found / not-found states;
  - add guest, add child (only when an adult exists, with a guardian select);
  - per participant, ordered services with Any or a qualified KTV ("not checked in" marked);
  - validation and double-submit protection;
  - the result per participant: assigned KTV and times, or waiting with a localized reason;
  - links to the board and to a new walk-in.
- **Board ("Lịch hẹn hôm nay"):**
  - a "Waiting for staff" section with position, group, kind, arrival time, services and requested KTV or Any;
  - "Assign staff", which reports assigned or still waiting with the reason;
  - a per-line requested-staff select and Save;
  - "Serve next" (advance, with a reason);
  - **"Cancel waiting walk-in" / "Hủy lượt khách đang chờ"**, with a confirmation and a **required reason**. The board refreshes after success, and errors are localized.
- Existing workforce styles are reused. All new texts are in VI and EN, and there is no premium redesign.

## 13. Tests and results (targeted)

| Suite                                                                                                                                                                                               | Result             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `phase3-foundation.integration.test` (database; new amendment subtest)                                                                                                                              | **11 / 11 pass**   |
| `walkin.integration.test` (rolled back; real staff sessions and roles)                                                                                                                              | **11 / 11 pass**   |
| `walkin.race.integration.test` (two real connections; committed fixtures, cleanup verified; incl. cancel vs assign)                                                                                 | **4 / 4 pass**     |
| `walkin.http.test` (CSRF and Origin; strict bodies reject arrival time, owner, booking, status, KTV, planned times, passwords, unknown kinds; stable codes)                                         | **1 / 1 pass**     |
| Regression: `operations.integration` 9, `operations.race` 3, `customer-booking.integration` 11, `customer-booking.race` 3, `availability.integration` 11, `walkin.integration` 9                    | **46 / 46 pass**   |
| Regression: `booking.planner` 10, `operations.state` 5, HTTP tests (operations, customer booking, walk-in) 3, `api.test` 7                                                                          | **25 / 25 pass**   |
| Web: the whole unit/SSR suite, including the new `walk-in.test.tsx` (nav and branches by `MANAGE_BOOKINGS`; request shape; draft problems; localized reasons; first paint) and the updated nav list | **126 / 126 pass** |
| `prisma validate`, `db:deploy`, `migrate diff` (empty), `tsc` (API, web, contracts, database)                                                                                                       | clean              |
| `pnpm lint` (ESLint and import boundaries) and `pnpm format:check`                                                                                                                                  | pass               |

**What the new tests cover:**

- **Database amendment:**
  - `WAITING` lines are valid without KTV or times and create no claim;
  - partial shapes are rejected (KTV only, times only, `PLANNED` without KTV, specific without requested, requested with ANY, promotion without assignment);
  - intent changes only while waiting;
  - a requested line assigned to a different KTV is rejected;
  - no execution can start on a waiting line;
  - `WAITING → PLANNED` claims exactly one interval including the buffer;
  - an overlapping assignment gets `23P01`;
  - a visit cannot close with a waiting line;
  - cancelled waiting lines hold no claim.
- **Service:**
  - lookup: exact phone and email, masked fields only, employees never returned, invalid and empty queries refused, permissions, no account created;
  - member walk-in: direct visit, no booking, owner is the member, server arrival time, Any single KTV by code, buffer snapshot, truncated minute, one claim, events and audit, idempotent replay;
  - guest and child: no account, guardian link, split only because nobody can take the whole sequence (k2 then k1), the child in parallel on k3;
  - child without adult and non-customer "member": refused;
  - no capacity: waiting with no KTV, times or buffer and no event; absent and unqualified requested KTVs wait and are never substituted;
  - Step 3: waiting intent blocks nobody;
  - future booking: blocks a walk-in that doesn't fit; after it is cancelled, assignment gives the requested KTV; a repeat assign is idempotent;
  - intent changes ANY/SPECIFIC/A → B are audited, while a branch outsider, a viewer, another branch, and an assigned line are refused;
  - board: pool by arrival, advance first, the assigned walk-in in the KTV queue as `WALK_IN`, no fake KTV;
  - permissions and branch scope for intake and options.

**Not run, by scope:**

- the full repository suites;
- `next build` and `next typegen`, which can rewrite `apps/web/next-env.d.ts` (hash `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`, untouched).

Final Owner-review fix (owner, cancellation, exact time), targeted reruns:

- Step 6 integration 11/11 and race 4/4, which pass in parallel after the "no account" checks were made precise instead of comparing the global user count;
- walk-in HTTP 1/1, including the cancel endpoint (CSRF, required reason, strict body);
- regression: `operations.integration` 9, `operations.race` 3, `customer-booking.integration` 11, `walkin.integration` 11, `walkin.race` 4 = **38 / 38**; `operations.state` 5, operations and walk-in HTTP 2, `api.test` 7 = **14 / 14**;
- web **126 / 126**;
- `tsc` (API, web, contracts), `pnpm lint` (ESLint and boundaries), `pnpm format:check`: pass.

New checks:

- **Ownership:** a member walk-in, and member-first or guest-first order, all give `owner_user_id` NULL.
- **Exact time:** `planned_start_at` equals the intake's authoritative arrival clock, and the end is start + duration.
- **Cancellation:**
  - a blank reason is refused, and viewer and other-branch actors are refused;
  - the visit and every line end up `CANCELLED` with no KTV and no claims; the walk-in is gone from the pool;
  - the audit keeps the reason; a repeat is harmless; assignment afterwards is refused;
  - an assigned-but-not-started walk-in is cancelled and its claim released;
  - a started walk-in is refused;
  - the race above.

## 14. Limitations and deferrals

- **Automatic dispatch:** the pool order is advisory; there is no automatic dispatcher (Owner decision 6).
- **Cancellation scope:** it applies to the whole walk-in visit, before any START. Cancelling one participant of a multi-participant walk-in, and cancelling after START, are not part of Step 6.
- **Engine minute resolution:** a walk-in whose first seconds would overlap something ending exactly on the next minute stays `WAITING`. The constraint refuses it and staff assign again a moment later.
- **Race-test fixtures** are committed and cleaned with `session_replication_role = replica` (local superuser test database).
- **Deferred:** START/END and execution resolution (Step 7), reassignment of assigned lines and leave conflicts (Step 8), notifications and warnings (Step 9), POS and billing (Phase 4).

## 15. Step 7 context

- START must require:
  - line `status = 'PLANNED'`, with a non-null KTV and planned times (guaranteed by the CHECKs);
  - the executing employee equal to the assigned KTV (existing guard);
  - the OPERATIONAL eligibility (attendance).

  A `WAITING` line is never startable.

- END and resolution follow contract §4. A running execution already blocks its KTV for new assignments (Step 3 `SERVICE_RUNNING`).
