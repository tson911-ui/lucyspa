# Phase 3 — Step 5: Operational Booking Management, Queue & Arrival

Status: **OWNER APPROVED / COMPLETE.** Step 6 (Walk-In, Guest & Visit Foundation) is **NOT STARTED**.

This step implements staff operations on existing bookings, following the approved design contract ([`PHASE3_BOOKING_VISITS_DESIGN.md`](PHASE3_BOOKING_VISITS_DESIGN.md) §3, §4, §8, §14, §16, §17). The flow is: board → today's schedule → computed queue → customer arrival → late hold → NO_SHOW/release → advance.

It builds on Steps 2–4 and adds no migration. It does not implement walk-ins, START/END, reassignment, jobs or notifications.

## 1. Files

**API** (`apps/api/src/operations/`, new):

| File                                                                                                                           | Purpose                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `operations.state.ts`                                                                                                          | Pure: derived booking states, the arrival window, the late hold, punctuality, the hybrid queue order, free capacity, phone masking |
| `operations.core.ts`                                                                                                           | Transactional: `arriveBooking`, `markNoShow`, `advanceVisit`, and the `operationalToday` board and queue read model                |
| `operations.service.ts` / `operations.controller.ts`                                                                           | Permission and branch-scoped service (in the workforce `runAdminCommand` frame), and the thin controller                           |
| `operations.state.test.ts`, `operations.http.test.ts`, `operations.integration.test.ts`, `operations.race.integration.test.ts` | Tests                                                                                                                              |

**API** (changed):

- `app.module.ts`: registers the controller and service.
- `auth/auth.error.ts`: five new allowlisted codes (§8).
- `booking/booking.core.ts`: `settingValue` is now **exported** (reused, not duplicated). This is its only change.

**Contracts:** `packages/contracts/src/index.ts` gains the operational types (`OperationalTodayResponse`, `OperationalBooking`, `OperationalQueueKtv`, the states, groups and punctuality values).

**Web:**

- New:
  - `components/workforce/screens/booking-board.tsx`;
  - `lib/workforce/booking-board.ts` and its test;
  - the route `app/[locale]/workforce/(app)/booking-board/page.tsx`.
- Changed:
  - `lib/workforce/permissions.ts`: a nav entry `bookingBoard`, shown with `VIEW_BOOKINGS` at any branch;
  - `lib/workforce/permissions.test.ts`: the Owner's pinned navigation list now includes the new entry;
  - `i18n/workforce.ts`: the `bookingBoard` section in VI and EN.

**Other:**

- `scripts/test-auth-integration.mjs`: registers the two new integration tests;
- this document, and `LUCYSPA_HANDOFF.md`.

## 2. Operational board and branch-local day

`GET /api/v1/operations/branches/:branchId/today` requires `VIEW_BOOKINGS` at that branch.

**The day:**

- `now` is the database clock, read inside the request transaction.
- The **date** is `now` in the **branch's IANA timezone**, computed by PostgreSQL. The server's and browser's zones are never used.
- The board lists the branch's bookings whose `service_date` (branch-local, Step 2) is that date, in any status, ordered by start time and then code.

**Each booking row carries:**

- code, start and end;
- the derived **state** (§4);
- `arrivalOpensAt` and `holdUntil`;
- the booker's name and **masked phone** (last three digits);
- recipients;
- lines: service snapshot names, times, recipient, KTV display name, and the Step 8 `LEAVE` conflict flag (shown, never resolved here);
- the visit, if arrived: code, `arrivedAt`, punctuality, override;
- **allowed actions** (`arrive`, `noShow`, `advance`), decided by the server from the state and the caller's permissions.

No auth or security fields, idempotency keys, internal ids beyond the booking and visit ids, or financial data are returned.

**The response also carries:**

- the settings in use;
- `permissions { arrive, manageQueue }` for this branch;
- the computed **queue** (§3).

**Refresh:** the page reloads after every command, and passively every 30 s. Passive reads never extend the idle session. No realtime infrastructure was added.

## 3. The computed hybrid queue (Q4, contract §8)

There is **no queue table.**

- The only stored ordering fact is `visit.queue_override_at` / `queue_override_by_user_id` (Step 2), with the audit trail.
- Everything else is computed per branch and date by `operations.state.ts`.

For each KTV with work at the branch today, the queue returns:

- **`waiting`**: the `PLANNED` lines of `OPEN`/`IN_SERVICE` visits (arrived, not started), ordered as follows (contract §8 with **Owner decision 3**):
  1. **OVERRIDE**: visits a Manager advanced, by override time. This group sits above everything.
  2. **ON_TIME**: booked visits that arrived at or before the booking start (exactly at the start counts), by planned start.
  3. **LATE_IN_HOLD**: booked visits that arrived after the start but no later than start + hold (the end itself included), by planned start. They keep appointment priority.
  4. **Actual-arrival order:** everyone else, by arrival time in one shared ordering.
     - **LATE_AFTER_HOLD**: the hold had already expired when the customer arrived. The booking stays valid and may arrive, but its protected appointment priority is **lost**; arriving does not restore it.
     - **WALK_IN**: from Step 6.
  - Final tie-breaks, for determinism: visit id, then line id.
  - Only an explicit, audited Manager **advance** lifts a line above this order.
  - This is **not FIFO**: a protected late customer still follows on-time customers, and a post-hold arrival follows every protected booking.
- **`serving`**: the `IN_PROGRESS` lines.
- **`reserved`**: lines of bookings not arrived yet (still `CONFIRMED`), with their state (`UPCOMING`, `ARRIVAL_WINDOW_OPEN`, `LATE_HOLD`, `HOLD_EXPIRED`). **They keep blocking capacity** until arrival, cancellation or a Manager's NO_SHOW. Nothing is released automatically.
- **`freeNow`**: nothing is running, and no planned or reserved interval `[start, end + buffer)` covers now (half-open, like Step 2). This means "genuinely free". The walk-in check against the next reservation is done by the engine in Step 6.

**Step 6 extension point:**

- `WaitingLine.visitOrigin` and `bookingStartsAt: null` already route walk-in visits to the `WALK_IN` group. It shares the actual-arrival ordering with `LATE_AFTER_HOLD` arrivals, behind protected bookings and below Manager overrides.
- The read model reads **all** of today's visit lines (booked or walk-in). Step 6 only has to create walk-in visits; nothing in the queue changes. No walk-in record is created in Step 5.

## 4. States, arrival window and late hold

All states are derived from stored facts, the two settings and an explicit `now`. Nothing new is persisted.

- **Settings:** `booking.checkInWindowMinutes` (default 60) and `booking.lateHoldMinutes` (default 20), read through the Step 2 registry (`settingValue`). A missing row falls back to the registry default; an invalid stored value is an error.
- **`CONFIRMED` bookings:**

  | State                 | When                                                                    |
  | --------------------- | ----------------------------------------------------------------------- |
  | `UPCOMING`            | now < start − window                                                    |
  | `ARRIVAL_WINDOW_OPEN` | start − window ≤ now ≤ start (arriving exactly at the start is on time) |
  | `LATE_HOLD`           | start < now ≤ start + hold (the hold includes its end)                  |
  | `HOLD_EXPIRED`        | now > start + hold (still reserved; a Manager decides)                  |

- **Other bookings:**
  - after arrival, from the visit: `ARRIVED` (`OPEN`), `IN_SERVICE`, `COMPLETED`, `CANCELLED` (visit cancelled);
  - `CANCELLED` and `NO_SHOW` from the booking.
- **Punctuality** of an arrival:
  - `ON_TIME`: arrived at or before the start;
  - `LATE_IN_HOLD`: arrived at or before start + hold;
  - `LATE_AFTER_HOLD`: arrived later.
- **Arrival window (O2):** arrival is allowed from start − window until the booking is cancelled or no-show. Being late never blocks arrival. Too early gives `BOOKING_ARRIVAL_TOO_EARLY` and **writes nothing**; the customer may wait physically.
- **No automatic transitions:** there is no automatic NO_SHOW, cancellation or release at hold expiry (tested hours later).

## 5. Booking → Visit (arrival, contract §4)

`POST /api/v1/operations/bookings/:id/arrive` (empty body) requires `MANAGE_BOOKINGS` at the **booking's own** branch. It runs in one transaction:

1. **Lock the booking** row `FOR UPDATE`.
2. **Handle the status:**
   - `CHECKED_IN` → return the existing visit (idempotent);
   - `CANCELLED` or `NO_SHOW` → `BOOKING_ARRIVAL_NOT_ALLOWED`;
   - before the window → `BOOKING_ARRIVAL_TOO_EARLY`.
3. **Create the visit:** `OPEN`, origin `BOOKING`, linked 1:1 to the booking (unique), the booking's branch and owner, `arrived_at = now`, branch-local `service_date`, code `VS-…` derived from the booking code, and staff as creator.
4. **Create the participants**, one per recipient:
   - the owner (`SELF`) → `MEMBER` (the customer account);
   - a `CHILD` → `CHILD`, guarded by the owner's participant when the owner is also a recipient; otherwise `GUEST` (the schema requires a guardian inside the visit);
   - `FAMILY` or `OTHER` → `GUEST`, with name and phone.

   No account is created (O11).

5. **Create the visit lines**, one per booking line, for its recipient's participant, with:
   - the same KTV and assignment mode;
   - the same planned start and end;
   - the same duration and buffer snapshots, service code, VI/EN names and catalog price snapshot (never re-read from the catalog);
   - the leave-conflict flag carried over.

   Each line has a per-participant sequence and is `PLANNED`. Its Step 2 trigger **moves** the KTV occupancy from the booking line to the visit line (tested: 3 claims before, 3 after, none duplicated).

6. **Update the booking:** `CHECKED_IN`, with `checked_in_at` and `by`.
7. **Audit and event:** audit `BOOKING_CHECKED_IN` (with punctuality); outbox `CUSTOMER_ARRIVED`.

**Arrival is a lifecycle transition, not a new booking:**

- no availability re-run and no Any-KTV planning;
- no KTV change;
- no new occupancy;
- no START (no service execution is created).

An unexpectedly unavailable KTV stays assigned and is shown through the line's conflict flag. Reassignment is Step 8.

## 6. NO_SHOW, release and advance (Q4)

- **NO_SHOW** (`POST …/bookings/:id/no-show {reason}`) requires `MANAGE_QUEUE` at the booking's branch.
  - The booking row is locked.
  - Allowed only for a `CONFIRMED` booking **after the late hold**. Inside the hold: `BOOKING_HOLD_ACTIVE`; the reservation stays protected.
  - It sets `NO_SHOW` with time, actor and the **required reason**. The Step 2 trigger releases the planned KTV occupancy, which the engine confirms free.
  - Audit `BOOKING_NO_SHOW` (with the reason); outbox `BOOKING_NO_SHOW`.
  - A repeat returns quietly with no second event.
  - An arrived or started booking gets `BOOKING_NO_SHOW_NOT_ALLOWED`.
  - No penalty, no loyalty, no billing.
- **Release:** contract §8 lists "release the slot" with "the same effect for capacity" as NO_SHOW, and the approved state model has no other releasing state for an unarrived booking. **Release is therefore the NO_SHOW operation.** No hidden lifecycle state was added. A staff cancellation remains the separate `CANCELLED` path of contract §3; it is not built in Step 5.
- **Advance** (`POST …/visits/:id/advance {reason}`) requires `MANAGE_QUEUE` at the visit's branch.
  - It sets the Manager override fact (`queue_override_at` / `by`) on an arrived, waiting (`OPEN`) visit, whose lines then lead their KTVs' queues.
  - Audit `QUEUE_ADVANCED` (with the reason).
  - A repeat keeps the first override.
  - A started or ended visit gets `QUEUE_ADVANCE_NOT_ALLOWED`.
  - The contract defines no outbox event for it.
  - With no walk-ins yet, advancing reorders arrived booked customers. Step 6 walk-ins join the same computed order.

## 7. Permission mapping (contract §14; never role names; skills never authorize)

| Operation                   | Permission, at the record's own branch                  |
| --------------------------- | ------------------------------------------------------- |
| View the board and queue    | `VIEW_BOOKINGS`                                         |
| Customer arrival (check-in) | `MANAGE_BOOKINGS` ("check in (arrival)")                |
| NO_SHOW / release slot      | `MANAGE_QUEUE` ("NO_SHOW, release slot")                |
| Advance queue               | `MANAGE_QUEUE` ("advance queue, other queue overrides") |

- **Branch scope:** the board takes the branch from the path and checks it. Commands derive the branch from the booking or visit **inside the transaction**; a branch id from the browser is never trusted.
- Customer sessions never pass the workforce frame.
- **Naming:** customer arrival (booking/visit) is kept distinct from employee attendance (`attendance_records`, Step 3 O6) in code, API and UI ("Khách đã đến / Customer arrived"). Employee attendance is untouched.

## 8. Concurrency, locking and error codes

- Arrival and NO_SHOW both lock the **booking row** `FOR UPDATE` before any check, and advance locks the **visit row**. PostgreSQL serializes competing operations on the same booking. The Step 2 unique `visits.booking_id` stays the backstop.
- **Two devices arriving at once:** both succeed with the **same** visit; one visit and one `CUSTOMER_ARRIVED` exist.
- **Arrival vs NO_SHOW:** exactly one wins.
  - Either `CHECKED_IN` + a visit, with the reservation moved to the visit line and the loser getting `BOOKING_NO_SHOW_NOT_ALLOWED`;
  - or `NO_SHOW` with no visit, the reservation released, and the loser getting `BOOKING_ARRIVAL_NOT_ALLOWED`.
  - Never both.
- **New codes:**

  | Code                          | Status |
  | ----------------------------- | ------ |
  | `BOOKING_ARRIVAL_TOO_EARLY`   | 409    |
  | `BOOKING_ARRIVAL_NOT_ALLOWED` | 409    |
  | `BOOKING_HOLD_ACTIVE`         | 409    |
  | `BOOKING_NO_SHOW_NOT_ALLOWED` | 409    |
  | `QUEUE_ADVANCE_NOT_ALLOWED`   | 409    |

  Database internals never leak.

## 9. Audit and events

**Audit:** `audit_events` through the existing `appendAdminAudit`, in the same transaction, with actor, branch, entity, time and request id:

- `BOOKING_CHECKED_IN`: subject is the customer; before/after status; visit id; punctuality;
- `BOOKING_NO_SHOW`: with the **reason**;
- `QUEUE_ADVANCED`: with the **reason** and the override time.

**Outbox** (`appendOutboxEvent`, same transaction, `aggregateType: 'Booking'`, ids only):

- `CUSTOMER_ARRIVED`: `bookingId`, `visitId`, `punctuality`;
- `BOOKING_NO_SHOW`: `bookingId`, `markedByUserId`.

There is no consumer and no notification (Step 9).

## 10. UI (`/{vi|en}/workforce/booking-board`, "Lịch hẹn hôm nay / Bookings today")

- It lives in the existing workforce shell, in the Operations navigation group, shown with `VIEW_BOOKINGS`.
- **Branch selector:** only branches where the account holds `VIEW_BOOKINGS`.
- **Header:** the branch-local date, the last update time, a refresh button, and a search box (code, booker or recipient name, last phone digits).
- **Bookings table** (it turns into labelled cards on phones, using the shared table styles). Each row shows:
  - time and code;
  - booker and masked phone;
  - each service with time, recipient and KTV, plus the leave-conflict badge;
  - the state badge, with its deadline ("check-in from", "held until") or the arrival time and punctuality;
  - the actions the server allowed.
- **Confirmations:** arrival needs a confirmation; NO_SHOW and advance need a confirmation with a **required reason**. There are pending and disabled states, and success and error notices with localized texts (never raw codes). The board reloads after every action.
- **Queue:** one card per KTV: free or busy, serving, waiting in order with a group badge, and reservations with their state.
- **Other states:** empty day, no match, no permitted branch, loading, load error.
- All new text is in VI and EN (`i18n/workforce.ts`, `bookingBoard`). No timing rule is re-computed in the browser.

## 11. Tests and results (targeted)

| Suite                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Result                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `operations.state.test` (unit: window 61/60/inside and setting; hold boundaries incl. end, expiry, setting; no automatic NO_SHOW hours later; arrived states and punctuality; hybrid order OVERRIDE > ON_TIME > LATE_IN_HOLD (hold end included) > actual-arrival order shared by LATE_AFTER_HOLD and WALK_IN, not by plan, input-order independent; one instant past the hold end loses protection; the hold setting decides; free capacity half-open; masking) | **5 / 5 pass**                                                  |
| `operations.http.test` (CSRF and Origin before the service; arrival takes no body; NO_SHOW and advance need a reason and nothing else; stable codes with no internals)                                                                                                                                                                                                                                                                                           | **1 / 1 pass**                                                  |
| `operations.integration.test` (rolled back; real staff sessions, roles scoped per branch)                                                                                                                                                                                                                                                                                                                                                                        | **9 / 9 pass** (8 subtests + parent)                            |
| `operations.race.integration.test` (two real connections via a held booking lock observed in `pg_stat_activity`; committed fixtures, then verified cleanup)                                                                                                                                                                                                                                                                                                      | **3 / 3 pass**                                                  |
| `customer-booking.integration.test` (Step 4; shares `settingValue`)                                                                                                                                                                                                                                                                                                                                                                                              | 11 / 11 pass                                                    |
| `api.test`, `customer-booking.http.test` (module wiring)                                                                                                                                                                                                                                                                                                                                                                                                         | pass (14 / 14 together with the operations unit and HTTP tests) |
| Web: the whole unit/SSR suite (includes the new `booking-board.test.tsx`: nav and branches by `VIEW_BOOKINGS` per branch; search; localized operational errors; state tones; server-loaded first paint; and the Owner's nav list with the new entry)                                                                                                                                                                                                             | **121 / 121 pass**                                              |
| `tsc --noEmit` (API, web; contracts build)                                                                                                                                                                                                                                                                                                                                                                                                                       | clean                                                           |
| `pnpm lint` (ESLint and import boundaries) and `pnpm format:check`                                                                                                                                                                                                                                                                                                                                                                                               | pass                                                            |

The `operations.integration.test` subtests cover:

- **Board:**
  - only this branch and its local day (local 00:30 and 23:30 included, tomorrow's 00:10 and another branch excluded, in a branch zone where it is about noon);
  - the read model: masked phone, recipients, KTVs, `arrivalOpensAt`;
  - view-only actions;
  - no internal fields;
  - `FORBIDDEN` without `VIEW_BOOKINGS` or at another branch; no session is refused.
- **Window:** 61 minutes early is refused with nothing written; exactly 60 is accepted; the setting set to 90 takes effect.
- **Arrival:**
  - one visit, with owner and branch;
  - `MEMBER`, `CHILD` (guarded by the owner) and `GUEST` (with phone) participants;
  - lines carried with the same KTV, times, assignment mode and snapshot names (not the catalog), and per-participant sequence;
  - no execution;
  - occupancy moved, 3 → 3;
  - the booking `CHECKED_IN` by staff; audit and event;
  - a repeat returns the same visit;
  - a child-only booking gives a `GUEST`;
  - the board shows `ARRIVED` / `ON_TIME` with advance allowed.
- **Hold:**
  - `LATE_HOLD` keeps the KTV not free and reserved; the engine sees `CONFLICT`;
  - NO_SHOW at start + 20 refused, and at + 25 with the hold set to 30 refused;
  - still `CONFIRMED`;
  - desk and other-branch managers refused; a blank reason refused;
  - NO_SHOW at + 21 succeeds, and a repeat is harmless;
  - reason, actor, audit and event recorded;
  - the engine no longer sees `CONFLICT`;
  - arrival afterwards refused.
- **After arrival or START:** NO_SHOW refused (before and after a started execution); advance refused once started; the board shows `IN_SERVICE`, with the KTV serving and not free.
- **Queue:**
  - an on-time arrival leads a late one even though the late one's plan is earlier;
  - deterministic;
  - advance needs `MANAGE_QUEUE`;
  - after advance the late visit leads as `OVERRIDE`; a repeat keeps the first override;
  - the audit is written once;
  - no table with "queue" in its name exists.
- **After the hold** (Owner decision 3):
  - a booking hours past its hold is still `CONFIRMED` (nothing automatic);
  - arrival is still allowed;
  - punctuality is `LATE_AFTER_HOLD` / `LATE_IN_HOLD` (arrived exactly at start + 20) / `ON_TIME`;
  - the queue orders on-time, then in-hold, then post-hold arrivals **by arrival time**: a post-hold customer planned earlier but arriving later follows one who arrived first;
  - a Manager advance puts a post-hold arrival first.
- **Permissions:** arrival refused for viewer, other-branch and no-permission accounts; the desk's permissions show `{ arrive: true, manageQueue: false }`; a manager arrives.

**Not run, by scope:**

- the full repository suites;
- `next build` and `next typegen`, which can rewrite `apps/web/next-env.d.ts`. `tsc` and the SSR tests validate the new route and screen.

`apps/web/next-env.d.ts` keeps its pre-existing hash `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`.

## 12. Interpretations, limitations and deferrals

**Owner decisions (locked before approval):**

1. **Release = NO_SHOW.** For an un-arrived booking, releasing reserved capacity is the authorized NO_SHOW transition. There is no separate `RELEASED` state. The Step 2 mechanism releases the occupancy, and the action is audited with actor, reason and time.
2. **No NO_SHOW during the hold.** It is allowed only after hold expiry, by `MANAGE_QUEUE`. There is still no automatic NO_SHOW.
3. **Arrival after hold expiry:**
   - still allowed, unless the booking is cancelled or no-show;
   - the protected appointment priority is **lost**, and the customer is ordered by actual arrival time (with future walk-ins);
   - it is not restored by arriving;
   - only an explicit, audited Manager advance lifts it.
   - On-time arrivals and late arrivals within the hold keep booked priority.

   _Implemented by the `LATE_AFTER_HOLD` group (§3)._

4. **Boundaries:**
   - arriving exactly at the start is on time;
   - the hold end itself is protected, and `HOLD_EXPIRED` starts strictly after it (10:00 with a 20-minute hold: 10:00 on time, through 10:20 protected, after 10:20 expired);
   - the check-in window opens exactly at start − window.
5. **Participants:** a child recipient becomes `CHILD` (guarded by the owner's participant) only when the owner is also a recipient in the visit. The owner is never added just to satisfy `CHILD`; otherwise the child is a `GUEST`.

**Limitations and deferrals:**

- Staff search is a filter on today's board (code, names, last phone digits). A cross-day search endpoint is not part of Step 5.
- The race test uses committed fixtures cleaned with `session_replication_role = replica`, which needs a superuser test database (the local one is).
- **Deferred:**
  - walk-ins and guests (Step 6), including the engine's walk-in capacity check;
  - START and END (Step 7);
  - reassignment and leave conflicts (Step 8);
  - notifications and warning jobs (Step 9);
  - staff booking cancellation and desk booking creation;
  - POS and billing (Phase 4).

## 13. Step 6 context

- **Walk-in visits:** create visits with `origin = WALK_IN`, participants and lines assigned through the engine in the `OPERATIONAL` context against `now`, using the same lock-then-re-check pattern as Step 4 (`lockAvailabilitySubjects`).
- **The queue needs no change:** walk-in lines appear in the `WALK_IN` group, ordered by arrival time together with post-hold booked arrivals, behind protected bookings. Manager overrides still lead.
- **Genuine free capacity:** `freeNow` shows it. The walk-in check must also ensure the walk-in line ends before the KTV's next reserved or planned interval; the engine's `CONFLICT` covers this.
