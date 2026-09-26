# Phase 3 — Step 3: Availability & Qualification Engine

Status: **OWNER APPROVED / COMPLETE.** Step 4 (Customer Account UI + Member Booking & Any-KTV Assignment) is **NOT STARTED**.

This step implements the single authoritative engine of the design contract
([`PHASE3_BOOKING_VISITS_DESIGN.md`](PHASE3_BOOKING_VISITS_DESIGN.md) §5, §6, §15, §16, §18)
on top of the Step 2 foundation ([`PHASE3_STEP2_DATABASE_FOUNDATION.md`](PHASE3_STEP2_DATABASE_FOUNDATION.md)).
It is server-side domain logic only. It adds no migration, endpoint, UI, job, notification or
write path.

## 1. Files

| File                                                         | Change                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/availability/availability.types.ts`            | New: reason codes, contexts, request and result types                                                                                         |
| `apps/api/src/availability/availability.engine.ts`           | New: the settings reader, fact loader, pure evaluator, `evaluateSequence`, `feasibleStarts`, `validateAssignment`, `lockAvailabilitySubjects` |
| `apps/api/src/availability/availability.service.ts`          | New: `AvailabilityService`, the read-only Nest entry point (REPEATABLE READ snapshot)                                                         |
| `apps/api/src/availability/availability.integration.test.ts` | New: the targeted engine test (rolled-back transaction)                                                                                       |
| `apps/api/src/collaborator-work/collaborator-work.rules.ts`  | Additive: `collaboratorWorkOnDate` (the batched form of `collaboratorWorkCovering`) and `coversWindow` (its predicate)                        |
| `apps/api/src/app.module.ts`                                 | Registers `AvailabilityService` as a provider (no controller)                                                                                 |
| `scripts/test-auth-integration.mjs`                          | Adds the new integration test to the explicit integration runner                                                                              |

## 2. Engine API (domain boundary)

The engine lives in `apps/api/src/availability/` (contract §5). Every function takes the caller's
`Prisma.TransactionClient`, so the same code serves a read-only lookup and a re-check inside a
later write transaction.

| Function                                                   | Purpose                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluateSequence(tx, SequenceAtRequest)`                  | One ordered service sequence at one branch-local start. Returns sequence reasons, each planned line (times, snapshot duration and buffer, occupancy end), a verdict per evaluated employee per line, the per-line eligible employees, the **whole-sequence** employees (Q3 single-KTV candidates) and `everyLineCovered` (a split plan exists) |
| `feasibleStarts(tx, SequenceRequest)`                      | The starts on one date where every line has an eligible employee: on the slot grid for BOOKING, or every `stepMinutes` (default 1) otherwise. Each start reports `singleEmployeeAvailable`. One fact load, evaluated in memory                                                                                                                 |
| `validateAssignment(tx, request + assignments[])`          | The **re-check before write** of a proposed employee per line. Only those employees are loaded; `exclude` stops the lines being replaced from conflicting with themselves                                                                                                                                                                      |
| `lockAvailabilitySubjects(tx, userIds)`                    | The §16 lock order: `users` rows `FOR UPDATE`, sorted by UUID. For later write transactions only                                                                                                                                                                                                                                               |
| `loadAvailabilityFacts` / `evaluateSequenceAt`             | The two halves: a fixed number of set-based queries per date, then a pure evaluation of one start                                                                                                                                                                                                                                              |
| `readAvailabilitySettings(tx)`                             | Reads the consumed settings from the Step 2 registry                                                                                                                                                                                                                                                                                           |
| `AvailabilityService.evaluate / feasibleStarts / validate` | Injectable read-only wrappers, each in one REPEATABLE READ transaction (contract §15: "read snapshot; no locks")                                                                                                                                                                                                                               |

**Inputs:**

- `branchId`;
- `serviceDate` (branch-local `YYYY-MM-DD`);
- `startMinute` (branch-local minute of the day);
- `serviceIds` (ordered);
- `context`;
- `now`: always explicit, never read from the clock inside the engine;
- `employeeUserIds` (optional: a specific KTV; the default is everyone actively assigned to the branch);
- `customerUserId` (optional);
- `exclude` (`bookingServiceLineIds`, `visitServiceLineIds`, `bookingId`).

**Contexts** (the caller states which rules apply):

| Context                                                                      | Horizon and past start | Slot grid | Attendance   | Date                           |
| ---------------------------------------------------------------------------- | ---------------------- | --------- | ------------ | ------------------------------ |
| `BOOKING` (customer or desk scheduling)                                      | yes                    | yes       | **no** (O6)  | today … today + max            |
| `OPERATIONAL` (same-day walk-in, queue, "now" assignment, START eligibility) | no                     | no        | **yes** (O6) | must be the branch-local today |
| `REVALIDATION` (re-checking an established sequence, e.g. a reassignment)    | no                     | no        | no           | any                            |

Candidate output is sorted by user id. This makes it deterministic, but it is **not** a ranking: the
Q3 tie-break (booked minutes, employee code, id) and the choice of employee are Step 4.

## 3. Rules enforced (contract §5, in order)

**Sequence rules** (any failure means no employee is evaluated):

1. **Branch:** active, and open on the date's ISO weekday (`branch_operating_hours`, via the existing `branchWindow`). Otherwise `BRANCH_CLOSED`.
2. **Services:** every service is active and actively offered at the branch (`service_branch_availability`). Otherwise `SERVICE_UNAVAILABLE`, with `unavailableServiceIndexes`.
3. **Hours:** the first line starts at or after opening, and the **last line ends** at or before closing. The trailing buffer may run past closing (contract §6). Otherwise `OUTSIDE_HOURS`.
4. **Horizon** (BOOKING): `today ≤ date ≤ today + booking.maxAdvanceDays`, where today is branch-local, and the start instant is not before `now`. Otherwise `HORIZON`.
5. **Slot grid** (BOOKING): `(start − opening) mod booking.slotIntervalMinutes = 0`. Only the sequence start is aligned; later lines follow real durations. Otherwise `INVALID_SLOT`.
6. **Same day** (OPERATIONAL): the date is the branch-local today. Otherwise `NOT_SAME_DAY`.
7. **Customer:** when `customerUserId` is given, no other `CONFIRMED` booking of theirs overlaps [first start, last end). Otherwise `CUSTOMER_CONFLICT`.

**Employee rules, per line** (all failing reasons are reported, in this order):

1. `EMPLOYEE_INACTIVE`: the account is not `kind = EMPLOYEE` with `status = ACTIVE`, or the classification on the date is `ENDED` or absent. The classification is the latest effective change on or before the date, the same rule as `classificationOn`.
2. `TRAINEE`: classified `TRAINEE` on the date. Never bookable, and never an eligible candidate.
3. `NOT_ASSIGNED`: no active `employee_branch_assignments` row for the branch (`revoked_at IS NULL`). Past work at the branch does not count.
4. `NOT_QUALIFIED`: the service's eligible skills do not intersect the employee's active (unrevoked) skills. **ANY-OF** (verified, §11): one matching active skill is enough; the eligible skills are alternatives, not a required set. Skills are qualification, never permissions or roles.
5. `ON_LEAVE`: `APPROVED` leave covers the date. Leave is whole-day and applies at every branch; it uses the existing `employeesOnApprovedLeave`. Pending, rejected and cancelled requests never block.
6. `CTV_NOT_SCHEDULED`: `COLLABORATOR` without a `SCHEDULED` occurrence at this branch on the date covering the **whole line service interval** [line start, line end), but **not** its trailing buffer (verified, §11). Each line of a sequence is checked on its own interval. This is the `collaboratorWorkCovering` rule, applied in batch. A partial occurrence, another date, or a `CANCELLED` occurrence never counts. `OFFICIAL_EMPLOYEE` needs no occurrence.
7. `NOT_CHECKED_IN` (OPERATIONAL only): no open attendance record (no check-out) for this branch on the date.
8. `SERVICE_RUNNING`: the employee has an **unended** execution that started before this line's occupancy ends (§6).
9. `CONFLICT`: another occupying interval of the employee overlaps this line's occupancy (§6).

No role name, and no permission, is consulted anywhere in the engine.

## 4. Reason codes

The contract §5 names are used unchanged: `BRANCH_CLOSED`, `OUTSIDE_HOURS`, `NOT_QUALIFIED`,
`ON_LEAVE`, `NOT_ASSIGNED`, `CTV_NOT_SCHEDULED`, `TRAINEE`, `CONFLICT`, `HORIZON`,
`NOT_CHECKED_IN`.

The contract list ends with "…". These codes were added, one per rule, with no synonyms:

- `SERVICE_UNAVAILABLE`
- `INVALID_SLOT`
- `NOT_SAME_DAY`
- `CUSTOMER_CONFLICT`
- `EMPLOYEE_INACTIVE`
- `SERVICE_RUNNING`

`HORIZON` covers both "beyond the maximum advance" and "a start in the past". Raw Prisma or
PostgreSQL errors are never returned as availability results. Invalid engine inputs (no
services, an unknown branch, a bad date or minute) throw, because they are programming errors.

## 5. Time zone and business date

- Branch-local wall-clock minutes are mapped to instants **by PostgreSQL in the branch's IANA timezone**. One query maps each minute 0…1500 of the date (closing ≤ 24:00, plus the maximum 60-minute buffer), so the mapping is DST-safe and never uses the server or browser zone.
- "Today" is `now` in the branch timezone. The test proves that 00:30 local on 1 March (still 28 February in UTC) counts as 1 March.
- The CTV occurrence and operating-hour windows are branch-local minutes of the date, compared directly.
- Holiday and date-specific closures are **not modeled** (contract §1 gap 7, §19). The engine uses the weekday hours only.

## 6. Occupancy, buffer and conflicts

**Timing** (contract §6):

- Line 1 starts at the requested start.
- Line k+1 starts at line k's end plus the buffer.
- Each line occupies its KTV over **[start, end + buffer)**, half-open, exactly like the Step 2 `ktv_occupancies` range.
- New lines use the current `booking.serviceBufferMinutes`, which later writes snapshot. Existing lines use their own snapshotted `buffer_minutes`.
- The buffer is turnover time, never part of `durationMinutes`.

**Example:** with a 10:00–11:00 line and a 10-minute buffer, starts at 11:00 and 11:05 are
rejected and 11:10 is accepted. With buffer 0, a 14:00 start next to a 13:00–14:00 line is
accepted. A candidate's own buffer also counts against the next occupied interval.

**Occupying facts**, read from the authoritative line and execution state:

| Source                                                      | Interval                                              |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `CONFIRMED` booking lines not yet carried into a visit line | [planned start, planned end + buffer)                 |
| `PLANNED` or `IN_PROGRESS` visit lines                      | [planned start, planned end + buffer)                 |
| `ENDED` executions                                          | [started_at, ended_at + buffer): their real past time |
| `IN_PROGRESS` (unended) executions                          | [started_at, **∞**) → `SERVICE_RUNNING`               |

**Running past the expected end:**

- An unended execution keeps its KTV unavailable for every interval that ends after the start, including after the planned and expected end, until END (or a manager resolution) is recorded.
- The planned range is not relied on for this.
- Nothing ends an execution automatically (O1).
- After END, the KTV's actual run [started_at, ended_at + buffer) still occupies the past; later time frees up.

**Deliberate consequence:** an execution that is never ENDed hides that KTV from all later
availability, including future days, until it is resolved. The O1 END-overdue warning (Step 9)
and the manager resolution (Step 7) are the recovery path.

**`KtvOccupancy`** is **not read** by the engine. It stays the internal Step 2 backstop. The
engine's planned ranges are identical to its ranges, so the two never disagree, and the engine
is a superset: it also covers running and ended executions.

Occupancy is cross-branch (a KTV is one person), like the database constraint.

## 7. Settings consumed

The settings are read from `app_settings` through the Step 2 registry (`BOOKING_SETTINGS` and
`isValidBookingSetting`) **inside the caller's transaction**, with no cache. A change applies to
the next evaluation, and the in-transaction re-check sees the committed values.

| Setting                        | Used for                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `booking.maxAdvanceDays`       | the BOOKING horizon (final allowed date = today + N; the first rejected date = today + N + 1) |
| `booking.slotIntervalMinutes`  | the BOOKING start grid from opening; the `feasibleStarts` step                                |
| `booking.serviceBufferMinutes` | the buffer of new lines (timing and the candidate's own occupancy)                            |

- A missing row falls back to the registry default. An invalid stored value throws.
- No value is hard-coded in the engine.
- `checkInWindowMinutes`, `lateHoldMinutes` and the warning settings belong to arrival, queue and warnings (Steps 5, 7 and 9), not availability.

## 8. Multi-service feasibility (Q3 foundation)

`evaluateSequence` returns, for an ordered list of services:

- the chained line times;
- for each line, a verdict for every evaluated employee and the eligible list (the inputs to a Step 4 split plan);
- `wholeSequenceEmployeeUserIds`: employees eligible for **every** line. Because the lines are chained through the buffer, this also means continuous availability for the whole sequence. An employee lacking the skill for one service, or with a conflict in one segment, is excluded here but may still be eligible for other lines;
- `everyLineCovered` / `feasible`: a plan exists (single-KTV or split).

The engine does **not** choose: the single-KTV-first selection, the tie-break, "prefer the
previous line's employee", and mixed specific/any planning are Step 4.

## 9. Concurrency and re-check boundary

- **An availability lookup is advisory** until the later write transaction locks, re-checks and persists the assignment. A read-only result reserves nothing.
- `AvailabilityService` lookups run in one REPEATABLE READ snapshot and take no locks (contract §15).
- For the Step 4+ write path, contract §16, inside one transaction:
  1. `lockAvailabilitySubjects(tx, [...employees, customer])` locks the rows in sorted UUID order;
  2. `validateAssignment(tx, …)` re-runs the engine, excluding the lines being replaced;
  3. the write persists;
  4. the Step 2 `ktv_occupancies_no_overlap` exclusion (SQLSTATE `23P01`) remains the last-resort backstop.
- Step 3 performs no booking or assignment write. The locking of an actual write and the handling of `23P01` are Step 4 responsibilities.

## 10. Validation (targeted)

| Check                                                                    | Result                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `apps/api` `tsc --noEmit` and `pnpm build`                               | OK                                                              |
| `availability.integration.test` (new; `RUN_AUTH_INTEGRATION=true`)       | **11 / 11 pass** (10 subtests + parent; all fixtures roll back) |
| `collaborator-work.integration.test` (its rules file changed additively) | 10 / 10 pass                                                    |
| `api.test` (module wiring)                                               | 7 / 7 pass                                                      |
| ESLint on the changed files, and `scripts/check-boundaries.mjs`          | pass                                                            |
| Prettier on the changed files                                            | pass                                                            |

What the engine test covers:

- **Branch and service:**
  - branch open → available;
  - Sunday closed → `BRANCH_CLOSED`;
  - a 20:00 start ending exactly at 21:00 → allowed;
  - 20:15 (ends after closing) and 08:45 (before opening) → `OUTSIDE_HOURS`;
  - a service not offered at the branch → `SERVICE_UNAVAILABLE`, with nobody evaluated.
- **Qualification and employment:**
  - default pool and eligible set;
  - `TRAINEE`, `EMPLOYEE_INACTIVE`, `NOT_ASSIGNED` (a specific KTV assigned elsewhere), `NOT_QUALIFIED`;
  - deterministic ordering.
- **CTV:**
  - a covering SCHEDULED occurrence, including one ending exactly at the line end → eligible;
  - a partial occurrence (either side), no occurrence, and a CANCELLED occurrence → `CTV_NOT_SCHEDULED`.
- **Leave:** APPROVED → `ON_LEAVE`; PENDING → not blocked.
- **O6:**
  - a future booking without attendance → eligible;
  - same-day OPERATIONAL without check-in → `NOT_CHECKED_IN`, and with check-in → eligible;
  - another date → `NOT_SAME_DAY`;
  - the branch-local today across the UTC date line.
- **O7 and conflicts:**
  - with 10:00–11:00 + 10 min, starts at 10:30, 11:00 and 11:05 → `CONFLICT`, 11:10 → free;
  - with buffer 0, adjacent starts on both sides are allowed and an overlap is rejected;
  - the buffer setting changes the candidate's own occupancy without a code change.
- **Re-check before write:** `validateAssignment` is valid when the replaced line is excluded and gets `CONFLICT` otherwise.
- **Customer:** own CONFIRMED booking → `CUSTOMER_CONFLICT`, and not when excluded.
- **Cancellation and locks:** a cancelled booking frees the time; the lock helper runs.
- **Running service:**
  - unended past its expected end → `SERVICE_RUNNING`, in OPERATIONAL and in BOOKING, including a start two hours later;
  - time before the start is unaffected;
  - after END, the next time is free and the actual run still conflicts.
- **Settings:**
  - horizon: today + 60 allowed, +61 rejected; before today and a past start rejected;
  - `maxAdvanceDays` = 10: +10 allowed, +11 rejected;
  - slot grid: 15 → 10:15 valid, 10:05 not; 30 → 10:15 not, 10:30 valid; REVALIDATION is off-grid.
- **Multi-service:**
  - chained timing, with and without a buffer;
  - whole-sequence candidates;
  - a missing skill or a conflict in segment 2 excluded from the whole sequence but kept per line;
  - `feasibleStarts` stays on the grid, excludes conflicts, and its last start still ends by closing.

The full repository suite and builds were not run, by scope.

## 11. Limitations, interpretations and deferrals

**Verified semantics** (checked against the source documents, not the implementation):

- **Skill qualification is ANY-OF.** Every source agrees; there is no contradiction.
  - Owner decision **H4** (`PHASE2_STEP2_DATABASE_FOUNDATION.md`): "A service may have several eligible skills; ANY one qualifies". The schema's `service_skills` relation holds "the eligible skills".
  - `PHASE2_STEP5_SKILLS_EMPLOYEE_SKILLS.md`: "an employee satisfies the skill dimension when the intersection between the service's eligible skills and the employee's active skills is non-empty. For example, eligible {A, B, C} and employee {B, D} is a match". The skills integration test asserts the "ANY-one intersection".
  - Phase 2 follow-up design §13.4 and the handoff: "S's eligible skills ∩ the worker's active skills ≠ ∅".
  - Step 1 contract §5.8: "S's eligible skills ∩ E's active skills ≠ ∅".
  - PRD §9 says only "Required skill", with no all-of wording.
- **CTV coverage is the line's service interval [t0, t1), without the trailing buffer.** The O7 buffer extends _occupancy_, not the service time the occurrence must cover.
  - PRD §9.9: "a scheduled CTV work occurrence at that branch covering the whole service time".
  - Phase 2 follow-up design §13 defines the window as the service window: "potentially bookable for service S at branch B over the window [t0, t1) … 7. COLLABORATOR only: a SCHEDULED collaborator_work_occurrence at B on D whose [start, end) covers [t0, t1)". It keeps buffers apart: "Phase 3 adds its own rules, such as existing bookings and buffers."
  - Step 1 contract §5: "Eligibility of employee E for a service line of service S at branch B over [t0, t1)", then 5.6: "`collaboratorWorkCovering(E, B, D, t0, t1)` returns a SCHEDULED occurrence covering the whole interval". The buffer appears only in 5.10: "each occupying interval extends by its line's `buffer_minutes` after its end … A candidate interval also counts **its own buffer** when checked against the next occupying interval". That wording means [t0, t1) itself excludes the buffer. O7 applies the buffer "to KTV occupancy and adjacency".
  - The closing-time rule (§6) was **not** used as the basis.
  - No source states that the occurrence must also cover the buffer. Requiring it would be a new rule for the Owner to decide: a one-line change in `employeeVerdict` (compare against the occupancy end instead of the line end).
  - Tested: with occurrence 09:00–11:00, service 10:00–11:00 and a 10-minute buffer (occupancy [10:00, 11:10)), the CTV is accepted. A sequence at 09:00 of two 60-minute services (the second 10:10–11:10) rejects line 2 with `CTV_NOT_SCHEDULED` and has no whole-sequence candidate.
- **An unended execution** occupies its KTV with no end until END or resolution (§6). This is stricter than the contract's "until at least now", as the Step 3 instructions require.

**Not modeled or deferred:**

- date-specific holidays and closures;
- partial-day leave;
- future-dated branch assignments (active = not revoked);
- the settings **write** API and the `SettingsService` cache of §18: the engine reads settings uncached inside the transaction;
- the "next feasible start and waiting count" for busy KTVs (PRD 11.4) and customer-facing slot presentation (Step 4, built on `feasibleStarts`);
- queue capacity and ordering (Step 5);
- walk-in flows (Step 6);
- START/END services (Step 7), which use `OPERATIONAL` plus `validateAssignment`;
- reassignment (Step 8), which uses `REVALIDATION` with `exclude`;
- warnings and jobs (Step 9).

**Customer overlap:** only `CONFIRMED` bookings are considered, as the contract states. Open
visits of the same customer are a Step 5/6 concern.

## 12. Step 4 context

- **Booking creation**, in this order:
  1. build the sequence with `evaluateSequence` (BOOKING, with `customerUserId`);
  2. pick the assignment (single-KTV first from `wholeSequenceEmployeeUserIds`, else a per-line split), applying the §6 tie-break;
  3. in the write transaction, `lockAvailabilitySubjects` then `validateAssignment`;
  4. insert the booking and lines with the snapshot values from `PlannedLine` (`durationMinutes`, `bufferMinutes`, times);
  5. map `23P01` to "slot just taken".
- **Specific KTV:** pass `employeeUserIds: [ktv]`. Slot listing uses `feasibleStarts` with the same restriction.
- **Presentation:** never show reason codes raw to customers. Translate them in the UI (contract §5).
