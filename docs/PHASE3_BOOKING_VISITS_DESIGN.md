# Phase 3: Booking & Visits design contract

**Status: Step 1 of 10, OWNER APPROVED / COMPLETE** (design contract, including the
locked Q1–Q6 and O1–O11). **Step 2 (Booking & Visit Database Foundation) has NOT started.** No Phase 3 code, schema or UI exists. This document is the contract that Steps 2–10 must follow. Where it is silent,
`LUCY_SPA_PRD.md` governs; `LUCYSPA_HANDOFF.md` records the accepted state it builds on
(Phase 1, Phase 2 and the Phase 2 follow-up are production accepted; the last
documentation commit is `1b07357`).

The Owner decisions Q1–Q6 and O1–O11 for Phase 3 are **locked**. They are applied in the
sections below, and O1–O11 are summarized in section 21. No open design question remains.

---

## 1. Existing foundations to reuse

Phase 3 builds on these. There are no parallel replacement systems.

| Foundation                                    | Where it lives today                                                                                                                                         | Phase 3 use                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Customer registration, OTP activation, resend | `POST /api/v1/auth/register`, `/auth/activation/verify`, `/auth/challenges/resend`                                                                           | **Reused unchanged**; Step 4 adds the UI                                    |
| Customer login, session, logout               | `POST /api/v1/auth/login` (`realm: CUSTOMER`, `identifierType: EMAIL`), `GET /auth/me`, `/auth/logout`, `/auth/logout-all`, `GET /auth/context` (CSRF)       | **Reused unchanged**; Step 4 UI                                             |
| Customer forgot / reset password              | `POST /api/v1/auth/password-reset/request` (`realm: CUSTOMER`) and `/complete`                                                                               | **Reused unchanged**; Step 4 UI                                             |
| Password policy                               | 8–128 characters and the blocklist, one server rule                                                                                                          | Reused unchanged                                                            |
| Sessions, CSRF, exact Origin                  | Global `CsrfGuard`, session cookie, `no-store` responses                                                                                                     | Reused unchanged for every Phase 3 endpoint                                 |
| Permission engine                             | Code-owned catalog, roles as bundles, GLOBAL or per-branch grants, denies, containment; `runAdminCommand` frame                                              | **Extended**: new Phase 3 permission codes (section 14)                     |
| Branches                                      | `branches` (IANA timezone, active flag), `branch_operating_hours` (per ISO weekday, minutes)                                                                 | Reused unchanged as the opening-hours source                                |
| Services                                      | `services` (`durationMinutes` = deterministic scheduling duration; estimated min/max; price range and unit), `service_skills`, `service_branch_availability` | Reused unchanged; Phase 3 tables reference `services` `ON DELETE RESTRICT`  |
| Employees                                     | `employee_profiles`, account `status`, effective-dated `employment_classification_changes`                                                                   | Reused unchanged                                                            |
| Branch assignments                            | Active `employee_branch_assignments` (the single source of operational and authorization membership)                                                         | Reused unchanged                                                            |
| Skills                                        | `employee_skills` (active = not revoked); qualification = service eligible skills ∩ employee active skills                                                   | Reused unchanged; skills are **not** permissions                            |
| CTV work                                      | `collaborator_work_occurrences` and the `collaboratorWorkCovering` read contract                                                                             | Reused unchanged inside the availability engine                             |
| Leave                                         | `leave_requests` (whole calendar days, `APPROVED` status, `LeaveType`) and the approve flow (`APPROVE_LEAVE`)                                                | Reused; **extended** in Step 8 with a conflict hook after approval          |
| Attendance                                    | `attendance_records` (branch-local business date, check-in/out)                                                                                              | Reused read-only for "checked in today"                                     |
| Audit                                         | `audit_events` (actor, subject, entity, branch, reason, before/after, classification)                                                                        | Reused unchanged                                                            |
| Outbox                                        | `outbox_events` and `appendOutboxEvent(tx, …)` (same-transaction append)                                                                                     | Reused; **extended** with a generic relay (section 17)                      |
| Worker, Redis, BullMQ                         | `apps/worker` (BullMQ worker, database-polled auth email dispatch), `redisConnectionOptions`, `QUEUE_PREFIX`                                                 | Reused; **extended** with a booking-events queue (section 12)               |
| Web workforce shell and API client            | `apps/web` workforce area, CSRF-aware fetch client, i18n VI/EN                                                                                               | Reused; the client is **extended** (shared) for the customer area in Step 4 |

**New Phase 3 responsibilities:**

- bookings and their service lines;
- the availability and qualification engine;
- KTV assignment (specific and Any-KTV);
- visits, participants, visit service lines and service executions;
- the arrival queue, walk-ins, reassignment;
- the booking configuration settings;
- Phase 3 events and notifications;
- the customer account and booking UI.

**Gaps found during inspection** (recorded, not fixed in Step 1):

1. There is **no customer web UI** at all (only a public landing page). Step 4 builds it.
2. Activation does **not** sign the customer in (204, no cookie), so the journey is
   Register → OTP → **Login** → Booking. This is intended.
3. Customers sign in by **email only** (Phase 1 design). Phone login is not part of Phase 3.
4. There is **no configuration/settings registry** (`AppSetting` is only a PRD concept).
   Step 2 creates the single registry (section 18). No competing mechanism exists to reuse.
5. There is **no generic outbox relay**. The only consumer marks its own auth-email rows
   published. Step 2 defines and Step 9 activates the relay (section 17).
6. There is **no notification center**. Step 9 creates the in-app one (section 17).
7. **Branch hours are per weekday only**, with no date-specific closures. Bookings up to 60
   days ahead cannot see holidays yet (deferral, section 19).
8. **Leave is whole-day only**, so approved leave blocks a whole branch-local day.
9. The web API client lives under `lib/workforce`. Step 4 should share it rather than copy
   it.

## 2. Domain boundaries

| Domain                       | Owns                                                                                                                                                                                                                                                            | Does not own                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Booking**                  | A member's reservation: branch, the **booking/account owner** (the signed-in customer), requested time, status (`CONFIRMED`, `CHECKED_IN`, `CANCELLED`, `NO_SHOW`), cancellation and no-show facts, idempotency, booking code                                   | Arrival mechanics after check-in; service progress; prices |
| **Booking service line**     | One requested service in a booking: service, **service recipient** (the owner or a named family member/other recipient, O11), sequence, planned start/end, duration and buffer snapshots, catalog reference snapshot (O5), **assigned KTV** and assignment mode | Actual execution; billing                                  |
| **KTV assignment**           | Choosing and changing the KTV of a booking or visit line, using the availability engine; assignment history                                                                                                                                                     | Deciding availability itself                               |
| **Availability**             | The **one** engine answering "can employee E do services S at branch B over [t0, t1)?" and generating slots. Pure reads (section 5)                                                                                                                             | Writing anything                                           |
| **Visit**                    | An on-site stay at one branch: created at arrival (from a booking) or for a walk-in. Status `OPEN` (arrived/waiting), `IN_SERVICE`, `COMPLETED`, `CANCELLED`                                                                                                    | Payment (Phase 4 adds invoice and `PAID`)                  |
| **Visit participant**        | Who receives services: `MEMBER` (a customer account), `GUEST` (name, optional phone), `CHILD` (name, guardian participant)                                                                                                                                      | Accounts; staff never create member accounts               |
| **Visit service line**       | One service for one participant: service, sequence, assigned KTV, planned window, status, catalog reference snapshot (O5), "added on behalf" facts, START-overdue warning fact                                                                                  | Price calculation and billing (Phase 4)                    |
| **Service execution**        | The START/END facts of one visit service line: started_at, expected_end_at, ended_at, how it ended, pre-END and END-overdue warning facts                                                                                                                       | Tours, commissions, payroll                                |
| **Queue**                    | The ordering of waiting work per branch and KTV, derived from bookings and visits plus Manager override facts                                                                                                                                                   | Its own copy of booking or visit state                     |
| **Walk-in**                  | Creating a visit without a booking, using genuine free capacity                                                                                                                                                                                                 | A separate availability rule                               |
| **Reassignment**             | Changing a line's KTV with history, actor, reason; leave conflicts                                                                                                                                                                                              | Silent cancellation                                        |
| **Events and notifications** | Outbox events after commits; in-app notifications; the operational warning jobs (START-overdue, pre-END, END-overdue)                                                                                                                                           | Business state (never authoritative)                       |

No Phase 3 domain calculates money: no invoice, discount, point, tour or commission logic.

## 3. Booking state machine

There is **one stored status per concern**. The booking stops owning progress once the
customer arrives, and the visit takes over. This avoids contradictory copies.

```
            ┌──────────── CANCELLED  (customer or staff, before check-in; see O3 below)
CONFIRMED ──┼──────────── NO_SHOW    (Manager, after the hold)
            └──────────── CHECKED_IN (arrival; a visit is created in the same transaction)
```

| Status       | Meaning                                                                                                                                 | Set by                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `CONFIRMED`  | Valid reservation holding its KTV intervals. Auto-confirmed when every line passes availability (PRD 11.5)                              | Booking creation        |
| `CHECKED_IN` | Customer arrived; the linked visit (1:1) now owns progress                                                                              | Arrival command         |
| `CANCELLED`  | Cancelled before check-in, with actor, reason, time and a late flag (less than `booking.lateCancelAlertMinutes` before the appointment) | Customer (own) or staff |
| `NO_SHOW`    | Not arrived; the Manager marked no-show after the hold                                                                                  | Manager                 |

- **Terminal:** `CANCELLED`, `NO_SHOW` and `CHECKED_IN` are terminal _for the booking_.
- **PRD states:** `ARRIVED`, `IN_SERVICE` and `COMPLETED` of PRD 49 are **derived for
  display** from the linked visit (booking `CHECKED_IN` plus visit status). They are never
  stored twice.
- **Customer cancellation (O3):** a customer may cancel **until service START**.
  - While the booking is `CONFIRMED`, the booking becomes `CANCELLED`.
  - After `CHECKED_IN` but before any line has started, the customer's cancellation cancels
    the linked visit and its unstarted lines instead (visit `CANCELLED`). The booking stays
    `CHECKED_IN` and its displayed state is derived as cancelled.
  - Once any line has started, customer cancellation is refused.
  - Cancelling less than `booking.lateCancelAlertMinutes` (default 15) before the
    appointment still succeeds. It sets the late flag and alerts managers, with no point
    penalty and no approval step.
- **No `PENDING` state (O4):** a valid booking that passes availability, qualification,
  concurrency and validation is created `CONFIRMED` in one transaction. There is no manual
  approval workflow.
- **No automatic transitions:** there is no automatic no-show and no automatic cancellation.

## 4. Visit, participants, lines and service execution

**Creation:**

- **From a booking (arrival):** in one transaction, set the booking to `CHECKED_IN` and
  create the visit (`OPEN`, `arrived_at`). Each distinct booking recipient becomes a
  participant: the owner as `MEMBER`, and a named family member or other recipient as
  `GUEST` or `CHILD` (O11). Each booking line becomes a visit service line for its
  recipient's participant, with the same KTV, planned window and snapshots.
- **Walk-in:** staff create a visit directly (section 9) with participants and lines.
  Lines are assigned through the availability engine against **now**.

**Visit status** is derived from its lines, and stored for querying with invariants:

| Visit status | When                                                                  |
| ------------ | --------------------------------------------------------------------- |
| `OPEN`       | Arrived; no line started yet (waiting)                                |
| `IN_SERVICE` | At least one line in progress                                         |
| `COMPLETED`  | Every non-cancelled line ended                                        |
| `CANCELLED`  | Every line cancelled before any start (for example the customer left) |

**Visit service line status:**

```
PLANNED → IN_PROGRESS → DONE
PLANNED → CANCELLED   (with reason; never after START)
```

**Service execution** (one per line):

- **START** creates the execution row: `started_at = now`,
  `expected_end_at = started_at + line duration_minutes` (the service duration snapshotted
  on the line), status `IN_PROGRESS`.
- **END** sets `ended_at = now`, status `ENDED`, `end_kind = NORMAL`.
- **Exceptional resolution:** a Manager with the permission ends it with
  `end_kind = MANAGER_RESOLVED`, a **required reason** and a recorded end time (now, or an
  earlier time not before `started_at`), with audit.
- **No automatic END**, ever (PRD 13.4).
- **Occupancy:** from START until END or resolution, the KTV is **occupied**. The
  availability engine treats an open execution as occupying the KTV at least until now,
  whatever `expected_end_at` says, plus the line's buffer (O7). A KTV cannot START another
  line while one of their executions is open.

**Multiple lines and KTVs:**

- A participant's lines run **sequentially**, in line order. A participant never has two
  lines `IN_PROGRESS` at once; parallel service is not supported (section 6).
- Different participants in one visit may be served in parallel by different KTVs.
- A visit may involve several KTVs (PRD 11.3).

**Catalog reference snapshot (O5):**

- Every booking and visit service line stores, when it is created: the service code, the VI
  and EN names, the scheduling duration, and the catalog price min/max and pricing unit.
- Later catalog edits therefore never rewrite historical service context.
- This is historical reference data only. Phase 3 computes no invoice totals, discounts,
  payments, payment state, POS or settlement; those are Phase 4.

**Actual times** are stored as UTC `timestamptz`. The branch-local business date is computed
by the database from the branch timezone (the existing convention).

## 5. Availability and qualification engine (authoritative, Step 3)

There is **one** engine, a read-only domain service in `apps/api` (`availability/`), reused
by:

- booking creation;
- Any-KTV assignment;
- slot listing;
- walk-in capacity;
- reassignment suggestions;
- queue capacity.

Nothing else re-implements these rules.

**Eligibility of employee E for a service line of service S at branch B over [t0, t1)**
(branch-local date D). E is eligible only when **all** of these hold:

1. **Branch and service:**
   - the branch is active;
   - S is active;
   - `service_branch_availability(S, B)` is active.
2. **Opening hours:** B is open on D's weekday, and [t0, t1) lies inside
   `branch_operating_hours`. The **whole sequence** must end by closing time.
3. **Horizon:** D is between the branch-local today and today + `booking.maxAdvanceDays`
   (default 60). For bookings, t0 is not in the past.
4. **Slot grid:** for bookings, the sequence start is aligned to `booking.slotIntervalMinutes`
   (default 15) from the opening time. Line ends are **not** aligned; occupancy uses real
   durations.
5. **Employee:** `kind = EMPLOYEE` and account `status = ACTIVE`.
6. **Classification on D:**
   - `OFFICIAL_EMPLOYEE` is bookable;
   - `COLLABORATOR` is bookable **only** when `collaboratorWorkCovering(E, B, D, t0, t1)`
     returns a SCHEDULED occurrence covering the whole interval;
   - `TRAINEE`, `ENDED` or none: **never**.
7. **Branch assignment:** an active `employee_branch_assignments` row for (E, B).
8. **Qualification:** S's eligible skills ∩ E's active skills ≠ ∅ (the skill rule; skills
   are not roles).
9. **Leave:** no `APPROVED` leave of E covering D. Leave is whole-day and applies to every
   branch. Pending leave does not block.
10. **Conflicts:** no overlap with E's other occupying intervals:
    - `CONFIRMED` booking lines;
    - `PLANNED` visit service lines;
    - open executions (occupying until at least now);
    - the actual [started_at, ended_at) of executions for past times.

    **Buffer (O7):** each occupying interval extends by its line's `buffer_minutes` after
    its end. The buffer is snapshotted from `booking.serviceBufferMinutes` (default 0) when
    the line is placed, so a later setting change never creates retroactive conflicts. A
    candidate interval also counts its own buffer when checked against the next occupying
    interval.

11. **Attendance (O6), same-day operations only** (walk-in, queue, "now" assignment and
    START): E is checked in at B today (an attendance record with no check-out), so a
    physically absent employee is never assigned as currently available.
    - Future bookings do **not** require attendance; today's attendance state is never
      applied to a future date.
    - Future availability relies only on the scheduling facts in rules 1–10.

**Customer-side rules:**

- A booking's own lines never overlap each other; lines are sequential.
- A customer's new booking must not overlap their other `CONFIRMED` bookings (PRD 11.1:
  "if they do not conflict").

**Outputs:**

- `eligibleEmployees(B, S, t0, t1)`;
- `planSequence(B, [S1..Sn], start, preference)` (section 6);
- `slots(B, [S1..Sn], date, preference)`, which returns start times with a feasible plan.

For busy KTVs (PRD 11.4), the engine also returns the **next feasible start** and a waiting
count. It never reveals other customers' identities.

**Explanation codes:** each rejection reason is a stable code (`BRANCH_CLOSED`,
`OUTSIDE_HOURS`, `NOT_QUALIFIED`, `ON_LEAVE`, `NOT_ASSIGNED`, `CTV_NOT_SCHEDULED`,
`TRAINEE`, `CONFLICT`, `HORIZON`, `NOT_CHECKED_IN`, …). The UI and tests use them; they are never shown raw to
customers.

## 6. Multiple services: sequencing and KTV assignment (Q3)

**Timing:**

- A booking is an ordered list of lines chosen by the customer.
- Line 1 starts at the requested start. Line _k+1_ starts when line _k_ ends plus the
  buffer (O7), so with the default of 0 the start is `start + Σ durationMinutes`.
- A line's KTV is occupied over [start, end + buffer). With a single KTV, consecutive lines
  are therefore continuous.
- The whole sequence must fit inside opening hours: the last line must **end** by closing
  time. The trailing buffer may run past closing.
- The customer's lines never overlap, and there is no parallel service for one participant.

**Assignment (locked Q3):**

1. **Single-KTV first.** Find employees eligible for **every** line of the sequence with
   **continuous** availability from the first start to the last end (one employee, all
   lines). If any exist, assign one of them to all lines.
2. **Multi-KTV fallback,** only if step 1 finds nobody. Assign line by line in order, each
   to an employee eligible for that line's interval. At each line, prefer the previous
   line's employee, then apply the tie-break. If any line has no eligible employee, the
   start time is infeasible.

**Tie-break (deterministic):**

1. fewest booked minutes for that employee at that branch on that date;
2. then earliest `employee_code`;
3. then user id.

The data model always stores the KTV **per line**, so both outcomes use the same tables.

## 7. Specific KTV and Any-KTV

- **Specific KTV (per booking, or per line when the customer picks different KTVs):** the
  chosen employee must pass the engine for each of their lines. The slot list shows only
  starts where the chosen employee is feasible. There is no silent substitution; if the KTV
  becomes unavailable, section 10 applies.
- **Any KTV ("Nhân viên bất kỳ"):** runs `planSequence` with single-KTV preference and the
  tie-break (section 6). Slot listing returns the earliest feasible starts (PRD 11.2 "best
  suitable/earliest"). The chosen employee is **recorded on the line** with
  `assignment_mode = ANY`, so later reassignment and history treat it like any other
  assignment.
- **Mixed:** some lines use a specific KTV and some use Any. Specific lines are fixed first,
  then the Any lines are planned around them with the same rules.
- **One engine:** Any-KTV calls the same engine. There is no separate availability logic.
- **Customer visibility:** customers see KTV display names only as needed for selection,
  never other customers' bookings.

## 8. Queue and arrival (Q4: hybrid, not FIFO)

The queue is **derived**, not a stored copy. It is computed per branch from:

- today's `CONFIRMED` bookings;
- `OPEN` / `IN_SERVICE` visits and their lines;
- Manager override facts on visits.

The single stored ordering field is `visit.queue_override_at`, plus the audit trail.

**Arrival:**

- Staff find the booking (code, phone or name search with masked results) and mark it
  arrived. This is idempotent; a second arrival returns the same visit.
- **Check-in window (O2):** arrival (`CHECKED_IN`) is allowed from
  `booking.checkInWindowMinutes` (default 60) before the appointment time until the booking
  is cancelled or no-show.
  - A customer who is physically there earlier may wait, but is not checked in yet.
  - Being late does not block arrival.
  - The late-arrival hold (below) is a separate rule.

**Ordering of waiting lines for a KTV:**

1. **Manager overrides** ("advance queue"), in override time.
2. **On-time booked** lines whose participant arrived: by planned start. A booked customer
   who arrives on time keeps appointment priority over walk-ins.
3. **Late booked** arrivals within the hold (`booking.lateHoldMinutes`, default 20): keep
   their reserved slot. Walk-ins do not take that reserved interval while the hold runs.
4. **Walk-ins:** by arrival time. They are served **only in genuine free capacity**: the KTV
   is free now, and the walk-in line ends before the KTV's next reserved interval
   (walk-in capacity check through the engine).

**After the hold:**

- Nothing happens automatically.
- A Manager may mark **NO_SHOW** (booking terminal, its intervals released), **release the
  slot** (same effect for capacity), or **advance** a waiting visit.
- Every Manager override is audited with actor, reason and time.
- A late customer arriving after the hold but before any Manager action is still checked
  in against the booking. They keep appointment priority unless a Manager has overridden it.

**Busy information for customers and staff** comes from the engine (section 5). There is no
personal data about others.

## 9. Walk-in, guest, child and family participants

**Kinds of visit:**

- a booked member (via arrival);
- an existing member identified at the desk (phone or email lookup; the match is masked and
  staff confirm with the customer);
- a walk-in guest with no account;
- a child without a phone or account;
- family members participating in the same visit.

**Online booking for family members (O11):**

- A signed-in customer may book for themselves or for a family member or other recipient.
- The customer stays the **booking/account owner**. Each booking line names its **service
  recipient**:
  - `SELF`; or
  - a recipient entry on the booking: display name, relation (`CHILD`, `FAMILY` or `OTHER`),
    and an optional phone.
- **No customer account** is created for that recipient, and staff never create a stand-in
  adult account.
- At arrival the recipient becomes a visit participant (section 4).

**Participants:**

- `MEMBER`: `customer_user_id`.
- `GUEST`: display name, optional phone and note. **No `users` row** is created, so the
  unique phone of accounts is untouched.
- `CHILD`: display name and a `guardian_participant_id` (the adult in the same visit).

Every visit service line names its **recipient participant** and its **KTV**.

**Roles in a visit (PRD 12):**

- **account/booking owner:** the booking owner, or the member who brings the others;
- **payer:** a Phase 4 invoice concern, recorded later;
- **service recipient:** the participant on each line;
- **combo owner:** a Phase 5 concern, with no field in Phase 3;
- **KTV:** per line.

**Staff never create adult member accounts.** An adult who wants an account registers
themselves (Step 4 UI).

Combos are not consumed in Phase 3.

## 10. Leave conflicts and reassignment (Step 8)

- **Availability:** approved leave blocks availability through the engine (rule 9).
- **Conflict detection:** after a leave approval commits, a conflict hook (in the same
  transaction as the approval, or immediately after through the outbox) finds `CONFIRMED`
  booking lines and `PLANNED` visit lines of that employee on the leave dates. Each is
  flagged `assignment_conflict = LEAVE`. **Nothing is cancelled** (PRD 10.2).
- **Notifications:** managers at the branch and the affected customers are notified
  (in-app), with the event `BOOKING_KTV_CONFLICT`.
- **Replacement suggestions:** the engine lists qualified, available employees for the same
  line intervals, single-KTV preferred for multi-line bookings.
- **Customer choice:** the customer may pick a suggested KTV, choose another eligible KTV,
  keep the time with Any-KTV, move the time, or cancel.
- **Manager reassignment:** any authorized Manager may reassign directly.
- **Every reassignment** records, in `line_assignment_history` and in audit:
  - the line;
  - the old and new KTV;
  - the actor (customer or staff);
  - the reason (`LEAVE`, `CUSTOMER_CHOICE`, `MANAGER`, …);
  - the time.
- **Validation:** reassignment re-runs the engine for the new KTV. It uses optimistic
  versions and the same KTV locking as booking creation (section 16).
- **Scope:** reassignment of an `IN_PROGRESS` line is not allowed. That case is resolved
  through section 11 exceptional handling instead.

## 11. START and END rules (Step 7)

- **START** is allowed only when **all** of these hold:
  - the line is `PLANNED`;
  - the visit is `OPEN` or `IN_SERVICE`;
  - the actor is the assigned KTV (or authorized staff acting for them);
  - the KTV has no other open execution;
  - the participant has no other line in progress;
  - the KTV is checked in today (O6).
- **Expected duration** = the line's `duration_minutes` snapshot.
- **Actual duration** = `ended_at − started_at`, stored as facts only.
- **END** is allowed when the execution is `IN_PROGRESS`. The visit becomes `COMPLETED`
  when every non-cancelled line is `DONE`.
- **Forgotten END:**
  - The KTV stays occupied; there is no auto-END.
  - The pre-END and END-overdue warnings (section 12) go to the KTV and the Manager.
  - A Manager with the resolution permission may end it exceptionally with a required
    reason and an end time, audited as `SERVICE_EXECUTION_RESOLVED`.
- **No money:** Phase 3 calculates no payroll, tours or commissions. It records trustworthy
  facts (who, which service, which participant, start, end, how ended) that Phase 4/5 will
  read.
- **Add service on behalf (PRD 13.5):**
  - the KTV picks an existing active service offered at the branch;
  - no price is typed or edited;
  - the new line records `added_on_behalf`, the actor, the time and the assigned KTV, and is
    placed through the engine.
  - Like every line, it stores the catalog reference snapshot (section 4, O5). That
    snapshot is historical reference only; invoice pricing and billing remain Phase 4.

## 12. Operational warnings (Q5 and O1)

There are three **separate** warning conditions. Each notifies the assigned KTV and the
branch Managers. **No warning ever ends or changes a service.**

| Kind            | Applies when                                                                                                                | Due at                                           | Setting (default) |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------- |
| `START_OVERDUE` | A visit service line is `PLANNED`, its participant has arrived (the visit is `OPEN` or `IN_SERVICE`) and it has not STARTED | `planned_start_at + service.startOverdueMinutes` | 5                 |
| `PRE_END` (Q5)  | The execution is `IN_PROGRESS`                                                                                              | `expected_end_at − service.warningLeadMinutes`   | 5                 |
| `END_OVERDUE`   | The execution is still `IN_PROGRESS` after its expected end                                                                 | `expected_end_at + service.endOverdueMinutes`    | 5                 |

Example: START at 10:00 with a 90-minute service gives an expected end of 11:30, a PRE_END
warning at 11:25 and, if still unended, an END_OVERDUE warning at 11:35.

A booked customer who has not arrived gets no START_OVERDUE warning. That case belongs to
the late-arrival hold (section 8).

**Scheduling:**

- The source transactions append outbox events:
  - `VISIT_LINE_SCHEDULED {lineId, plannedStartAt}` on arrival, walk-in creation,
    reassignment or replanning;
  - `SERVICE_STARTED {executionId, expectedEndAt}` on START.
- The worker's outbox relay (section 17) adds **BullMQ delayed jobs** on the queue
  `booking-events`:
  - `start-overdue:{lineId}:{plannedStartEpochMs}`;
  - `pre-end:{executionId}:{expectedEndEpochMs}`;
  - `end-overdue:{executionId}:{expectedEndEpochMs}`.
- Job ids are stable, so a re-add is a no-op. The delay is computed from the due time, and an
  overdue job runs immediately.
- Jobs are scheduled from committed outbox rows, **never** from the HTTP request, so a
  rolled-back command schedules nothing.

**Execution (validate in PostgreSQL):**

- The worker locks the line or execution row and re-checks the applicability condition in
  the table above.
- It proceeds only if the planned start or expected end still matches the job, and that
  kind's warning fact is still null:
  - `start_overdue_warned_at` on the line;
  - `pre_end_warned_at` or `end_overdue_warned_at` on the execution.
- In one transaction it then sets the fact and appends `SERVICE_WARNING_DUE {kind, …}`.
  Otherwise the job is a **stale no-op**. For example, START before the due time silences
  START_OVERDUE, and END silences both end warnings.

**Retries:** BullMQ retries with backoff. The database guards make retries idempotent, so
each warning kind is emitted at most once per line or execution.

**Cancellation and rescheduling:**

- START, END, cancellation or resolution need no Redis cleanup, because execution-time
  validation turns stale jobs into no-ops. A best-effort `remove(jobId)` is optional.
- If the planned start or expected end changes (for example reassignment, replanning or an
  allowed correction), new job ids are derived and the old jobs go stale.
- Setting changes apply to jobs scheduled afterwards.

**Recovery (Redis is not authoritative):** a periodic **reconciliation sweep** in the worker
(for example every minute) finds lines and executions whose warning is due and not emitted.
It emits them directly with the same guards, so a lost Redis job still produces its warning.

**Notifications:** `SERVICE_WARNING_DUE` produces in-app notifications to the KTV and the
branch Managers. Nothing depends on an open browser tab or on frontend polling.

**Scope:** no generic scheduler platform, only these three job kinds on one queue.

## 13. Customer account UI integration (Step 4)

Step 4 reuses the Phase 1 endpoints exactly. It adds no new authentication.

| Screen (`/{locale}/…`)  | Calls                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register                | `GET /auth/context` → `POST /auth/register` (name, date of birth, address, email, phone, password 8–128, locale) → 202 `{flowToken, codeLifetimeSeconds, resendAfterSeconds}`                           |
| Activate (OTP)          | `POST /auth/activation/verify {flowToken, otp}` → 204 (no cookie); resend via `POST /auth/challenges/resend {flowToken}`                                                                                |
| Login                   | `POST /auth/login {realm: 'CUSTOMER', identifierType: 'EMAIL', identifier, password}`, then a fresh `GET /auth/context`                                                                                 |
| Session                 | `GET /auth/me` (`kind: 'CUSTOMER'`); logout via `POST /auth/logout`                                                                                                                                     |
| Forgot / reset password | `POST /auth/password-reset/request {realm: 'CUSTOMER', email, locale}` → `POST /auth/password-reset/complete {flowToken, otp, newPassword}` → Login                                                     |
| Into booking            | After login: branch → services → recipient for each service (self or a family member/other recipient, O11) → KTV (specific or Any) → date → slot → confirm, then an in-app booking-success confirmation |

**Customer account area ("My bookings"):**

- upcoming bookings and booking history;
- booking detail: services, recipients, KTVs, times and status (the displayed status is
  derived per section 3);
- cancellation until service START (O3), with the late-cancel rule applied by the server.

**Notifications (O10):** booking success is shown in the UI and as an in-app notification.
There is **no** booking confirmation email, **no** SMS and no other external channel in
Phase 3.

**UI rules:**

- Anti-enumeration: responses to request and resend are identical for every account state.
- VI/EN throughout.
- The shared CSRF-aware client from `lib/workforce` is moved or shared, not duplicated.
- The workforce shell keeps refusing customer sessions, and customer pages refuse workforce
  sessions.

## 14. Authorization

**Principles:**

- Authorization is by **permission**, never by role names.
- **Skills qualify; they never authorize.**
- **Customers:** customer-owned actions are **ownership-based**. A customer can list, create
  and cancel only their own bookings (cancel until service START, O3). They may name a
  family member or other recipient on their own booking (O11). The session is the only
  identity; no customer id is accepted from the browser.

**New permission codes (locked, O8)**, added to the catalog in Step 2 and synced by
`db:permissions:sync`:

| Code                        | Scope       | Allows                                                                                                             |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `VIEW_BOOKINGS`             | Branch      | See branch bookings, visits, the queue board and occupancy (no pay data)                                           |
| `MANAGE_BOOKINGS`           | Branch      | Create a booking for a member at the desk, cancel, check in (arrival), create walk-ins and participants, add lines |
| `MANAGE_QUEUE`              | Branch      | NO_SHOW, release slot, advance queue, other queue overrides                                                        |
| `REASSIGN_SERVICES`         | Branch      | Change a line's KTV (conflicts and ad-hoc)                                                                         |
| `PERFORM_SERVICES`          | Branch      | START and END **own** assigned lines; add a service on behalf of the customer                                      |
| `RESOLVE_SERVICE_EXECUTION` | Branch      | Exceptionally end or resolve another KTV's execution (reason required)                                             |
| `MANAGE_BOOKING_SETTINGS`   | GLOBAL_ONLY | Change the section 18 settings (audited)                                                                           |

**Other rules:**

- Staff acting for another KTV's START/END need `RESOLVE_SERVICE_EXECUTION`.
- The Owner holds all permissions, as today.

## 15. API and domain service boundaries (intended; implemented in later steps)

| Operation                         | Service                                    | Transaction and idempotency                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Availability and slots            | `AvailabilityService` (read-only)          | Read snapshot; no locks                                                                                                                                                                                                                                                        |
| Create booking (customer or desk) | `BookingService.create`                    | One transaction: lock the involved KTV user rows (sorted UUID) and the customer row, re-run the engine, insert the booking, its recipients and lines (with snapshots), `CONFIRMED` (O4), outbox. **Idempotency key** (client UUID) unique per actor, replaying the same result |
| Cancel booking                    | `BookingService.cancel`                    | Allowed until service START (O3); `expectedVersion`; state guard; late-cancel flag and manager alert; outbox                                                                                                                                                                   |
| Any-KTV plan                      | `AssignmentService.plan` (engine)          | Read; the chosen plan is re-validated inside the create transaction                                                                                                                                                                                                            |
| Arrival / check-in                | `VisitService.arrive`                      | Check-in window (O2); lock the booking; idempotent (returns the existing visit)                                                                                                                                                                                                |
| Queue operations                  | `QueueService` (no-show, release, advance) | `expectedVersion`; audit with reason                                                                                                                                                                                                                                           |
| Walk-in                           | `VisitService.createWalkIn`                | Locks as for booking creation; idempotency key                                                                                                                                                                                                                                 |
| Visit transitions and lines       | `VisitService`                             | Version and state guards                                                                                                                                                                                                                                                       |
| START / END / resolve             | `ServiceExecutionService`                  | Lock line and KTV; unique execution per line; idempotent replays                                                                                                                                                                                                               |
| Reassignment                      | `AssignmentService.reassign`               | Lock line, old and new KTV; re-run the engine; history and audit                                                                                                                                                                                                               |

**Common rules:**

- Every command uses the existing frame: session → locks → authorization at transaction
  time.
- Outbox is appended in the same transaction.
- Strict DTOs; CSRF and Origin on every POST.

## 16. Concurrency and transaction rules

PostgreSQL is authoritative; Redis never holds booking, queue or visit truth.

| Risk                                                        | Protection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double-booking a KTV, or two customers taking the same time | Every command that adds or moves KTV intervals locks the affected **employee `users` rows** `FOR UPDATE` in sorted UUID order (the existing pattern for leave and CTV work), then re-runs the engine (buffer included) inside the transaction. **Database backstop (O9):** a `btree_gist` exclusion constraint on active per-KTV intervals is preferred where production PostgreSQL supports the extension (confirmed before the Step 2 migration). Otherwise a guard trigger performs the overlap check. The backstop never replaces the application locking and re-checks |
| Duplicate booking submission                                | Client idempotency key, unique per actor, with the stored outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Customer's own overlapping bookings                         | Lock the customer `users` row; the engine checks the customer rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Duplicate START                                             | A unique execution per line, plus state guard `PLANNED → IN_PROGRESS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Duplicate END                                               | State guard `IN_PROGRESS → ENDED`; a replay returns the ended row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Duplicate arrival                                           | Booking row lock; `CHECKED_IN` returns the existing visit (a unique booking → visit link)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Duplicate warning processing                                | Per-kind warning facts (`start_overdue_warned_at`, `pre_end_warned_at`, `end_overdue_warned_at`) plus stable job ids (section 12)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Reassignment races                                          | Line `expectedVersion`; lock line, old and new KTV; engine re-check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| History                                                     | Bookings, visits, lines and executions are never deleted (guard triggers, as for CTV work)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 17. Events, outbox, relay and notifications

**Events** (appended with `appendOutboxEvent` in the source transaction; payloads carry ids
and minimal facts, no personal data beyond ids):

- `BOOKING_CREATED`, `BOOKING_CANCELLED` (with a `late` flag), `BOOKING_NO_SHOW`,
  `BOOKING_KTV_CONFLICT`;
- `CUSTOMER_ARRIVED`, `WALK_IN_CREATED`;
- `KTV_REASSIGNED`;
- `VISIT_LINE_SCHEDULED`, `SERVICE_STARTED`, `SERVICE_WARNING_DUE` (with `kind`),
  `SERVICE_ENDED`, `SERVICE_EXECUTION_RESOLVED`;
- `EMPLOYEE_LEAVE_APPROVED` (conflict hook).

**Relay:**

- A small worker loop polls unpublished `outbox_events` of the Phase 3 aggregate types (the
  same database-polling style as the auth dispatcher) and dispatches them to handlers:
  notifications, and the warning jobs (section 12).
- It marks each row published only after its handler succeeds, so delivery is
  at-least-once.
- Handlers are idempotent: unique notification rows per (event, recipient) and stable job
  ids.
- The auth-email outbox handling is left unchanged.

**Notifications (Step 9):**

- An in-app `notifications` table (recipient user, type, entity reference, read state), with
  VI/EN rendering on the client.
- Recipients:
  - customers: their bookings;
  - KTVs: assigned lines;
  - managers: users holding `MANAGE_QUEUE` or `MANAGE_BOOKINGS` at the branch, resolved when
    the handler runs.
- The late-cancellation alert (PRD 11.6, O3) goes to managers.
- **In-app only (O10):** booking success is confirmed in the customer UI and as an in-app
  notification. There is no booking email, no SMS and no other external channel in
  Phase 3.
- UI requests never send notifications directly.

## 18. Configuration registry

A new **single** registry, created in Step 2 (none exists to reuse). It is code-owned keys
with typed validation and defaults, stored in `app_settings`
(`key`, `value jsonb`, `row_version`, `updated_by`, `updated_at`), read through one
`SettingsService` with short in-process caching.

| Key                                         | Default | Range            |
| ------------------------------------------- | ------- | ---------------- |
| `booking.maxAdvanceDays`                    | 60      | 1–365            |
| `booking.slotIntervalMinutes`               | 15      | 5–60, divides 60 |
| `booking.lateHoldMinutes`                   | 20      | 0–120            |
| `booking.lateCancelAlertMinutes`            | 15      | 0–1440           |
| `service.warningLeadMinutes` (PRE_END lead) | 5       | 1–60             |
| `service.startOverdueMinutes`               | 5       | 1–60             |
| `service.endOverdueMinutes`                 | 5       | 1–60             |
| `booking.checkInWindowMinutes` (O2)         | 60      | 0–1440           |
| `booking.serviceBufferMinutes` (O7)         | 0       | 0–60             |

**Rules:**

- Changes require `MANAGE_BOOKING_SETTINGS` (GLOBAL), use `expectedVersion`, and are audited
  with before/after.
- Changes apply to **new** calculations. Existing bookings keep their times, and lines keep
  their buffer snapshot.
- **Branch-level overrides** (`BranchSetting` in the PRD) are deferred. The key design leaves
  room for them.
- Business logic never hard-codes these values; the defaults live only in the registry.

## 19. Phase boundaries and deferrals

**Outside Phase 3:**

- invoices and snapshot pricing for billing, POS, cash, PayOS, split payment;
- discounts, tips, payroll, tours, commissions;
- loyalty earning/redemption, tiers, combos (consumption), rewards, referrals, birthday
  benefits;
- products, inventory, Beauty commerce;
- the luxury redesign and premium motion, native apps, Zalo, and other Future/TBD PRD items.

The Phase 3 schema adds **no** billing columns. The only price data is the catalog
reference snapshot on service lines (O5), which is historical reference, not billing.

**Also deferred:**

- date-specific branch closures and holidays;
- branch-level settings overrides;
- email, SMS and push booking notifications (O10);
- booking modification (move time or change services) beyond cancel-and-rebook and
  reassignment;
- recurring bookings.

## 20. Step dependency map

```
Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7
Step 4 → Step 8
Step 5 + Step 7 + Step 8 → Step 9
Steps 2–9 → Step 10
```

| Step | Content                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | Schema: bookings, booking recipients, lines (with snapshots), visits, participants, visit lines, executions (with warning facts), assignment history, settings registry, permission codes, guards and constraints |
| 3    | **The authoritative engine**, reused by 4 (booking and Any-KTV), 5 (queue capacity), 6 (walk-in), 7 (START checks), 8 (replacement suggestions)                                                                   |
| 4    | Customer account UI and member booking, including Any-KTV                                                                                                                                                         |
| 5    | Desk and queue operations, arrival                                                                                                                                                                                |
| 6    | Walk-in, guests and children                                                                                                                                                                                      |
| 7    | START and END                                                                                                                                                                                                     |
| 8    | Leave conflicts and reassignment                                                                                                                                                                                  |
| 9    | Relay, notifications, operational warnings (START-overdue, pre-END, END-overdue)                                                                                                                                  |
| 10   | Integration gate and production acceptance                                                                                                                                                                        |

Every implementation step keeps a Markdown report: what was built, migrations, security,
tests and results, deferrals, and next-step context.

## 21. Owner decisions O1–O11 (locked)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                        | Applied in               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| O1  | Three separate operational warnings to the KTV and Manager: **START overdue** (not started `startOverdueMinutes` after the planned start, once arrived), **pre-END** (`warningLeadMinutes` before the expected end, Q5), **END overdue** (unended `endOverdueMinutes` after the expected end). All default to 5 minutes and are configurable. Delayed jobs with PostgreSQL validation, idempotency and recovery. Never auto-END | Sections 12, 17, 18      |
| O2  | Check-in (`CHECKED_IN`) opens `booking.checkInWindowMinutes` (default 60, configurable) before the appointment. Earlier arrivals wait without check-in. The 20-minute hold stays separate                                                                                                                                                                                                                                       | Sections 8, 15, 18       |
| O3  | A customer may cancel until service START. Less than the late-cancel threshold (default 15) before the appointment still succeeds with a Manager alert; no point penalty and no approval                                                                                                                                                                                                                                        | Sections 3, 14, 15, 17   |
| O4  | Valid bookings are auto-confirmed (`CONFIRMED`); there is no `PENDING` approval workflow                                                                                                                                                                                                                                                                                                                                        | Sections 3, 15           |
| O5  | Service lines keep a catalog/reference snapshot (code, names, duration, price min/max and unit) so later catalog edits never rewrite history. No billing, discount, payment, POS or settlement in Phase 3                                                                                                                                                                                                                       | Sections 2, 4, 11, 19    |
| O6  | Future bookings do not require attendance. Same-day operational and walk-in assignment and START require check-in                                                                                                                                                                                                                                                                                                               | Sections 5, 11           |
| O7  | Service buffer default 0, configurable (`booking.serviceBufferMinutes`), snapshotted per line and applied to KTV occupancy and adjacency                                                                                                                                                                                                                                                                                        | Sections 4, 5, 6, 18     |
| O8  | The seven permission codes as listed; permission-based only; skills are qualification, never permissions                                                                                                                                                                                                                                                                                                                        | Section 14               |
| O9  | `btree_gist` exclusion constraint preferred as the database backstop where production supports it; otherwise a trigger check plus row locks. It never replaces transactions, deterministic locking and engine re-checks. No extension enabled in Step 1                                                                                                                                                                         | Section 16               |
| O10 | Booking success shown in the UI and in-app; no booking email, no SMS, no other external channel. Customers view and manage bookings in their account area                                                                                                                                                                                                                                                                       | Sections 13, 17, 19      |
| O11 | A customer may book online for themselves or for a family member or other recipient. The customer stays the booking/account owner; the recipient is a service recipient and later a visit participant; no account is created for them                                                                                                                                                                                           | Sections 2, 4, 9, 13, 14 |

---

## Step 1 report

- **Deliverable:** this design contract. There is no separate report, following the
  follow-up design convention.
- **Inspection (targeted):**
  - the PRD sections for booking (11), walk-in (12), visits (13), notifications (38),
    entities (41), time (43), API boundaries (48), state machines (49), events (50) and
    configuration (51);
  - the handoff's Phase 3 constraints and accepted state;
  - the customer-auth controllers and DTOs, and the web routes;
  - the schema models for services, skills, branch availability, operating hours, leave,
    attendance, CTV work, outbox and audit;
  - the worker, BullMQ and Redis setup and the outbox usage;
  - a check for existing settings or exclusion-constraint infrastructure (none).
- **No code, migration, schema or UI** was added or changed. Tests and builds were not
  rerun because no executable code changed.
- `apps/web/next-env.d.ts` was not touched.
- **Owner decisions:** O1–O11 are **resolved by the Owner** and incorporated throughout
  (section 21 lists where each applies). No open design blocker remains.
- **Owner approval:** the contract is **OWNER APPROVED / COMPLETE**.
- **Next:** Step 2 (Booking & Visit Database Foundation), which has **NOT started**. It
  begins only on the Owner's instruction.
