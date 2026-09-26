# Phase 3 — Step 4: Customer Account UI + Member Booking & Any-KTV Assignment

Status: **OWNER APPROVED / COMPLETE.** Step 5 (Operational Booking Management, Queue & Arrival) is **NOT STARTED**.

Built on the approved design contract
([`PHASE3_BOOKING_VISITS_DESIGN.md`](PHASE3_BOOKING_VISITS_DESIGN.md), Q1–Q6 and O1–O11), the
Step 2 schema ([`PHASE3_STEP2_DATABASE_FOUNDATION.md`](PHASE3_STEP2_DATABASE_FOUNDATION.md)) and
the Step 3 engine ([`PHASE3_STEP3_AVAILABILITY_QUALIFICATION_ENGINE.md`](PHASE3_STEP3_AVAILABILITY_QUALIFICATION_ENGINE.md)).
It adds no migration and no new authentication.

## 1. Files

**API** (`apps/api/src/booking/`, new):

| File                                                                                                                                            | Purpose                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `customer-command.ts`                                                                                                                           | `runCustomerCommand`: the customer-realm session frame (the counterpart of `runAdminCommand`) and the safe mapping of database outcomes |
| `booking.planner.ts`                                                                                                                            | The pure Q3 / §6–§7 assignment planner and the exact tie-break                                                                          |
| `booking.core.ts`                                                                                                                               | Request normalization, `createCustomerBooking` and `cancelCustomerBooking` (transactional cores), and the customer read models          |
| `customer-booking.service.ts` / `customer-booking.controller.ts`                                                                                | Application service and thin controller (`/api/v1/me/...`)                                                                              |
| `booking.planner.test.ts`, `customer-booking.http.test.ts`, `customer-booking.integration.test.ts`, `customer-booking.race.integration.test.ts` | Tests                                                                                                                                   |

**API** (changed):

- `app.module.ts`: registers the controller and service;
- `auth/auth.error.ts`: eight new allowlisted booking codes;
- `availability/availability.engine.ts`: **additive** `qualifiedEmployeesByService`. It reuses the engine's own `employeeVerdict` for the time-independent rules and changes no Step 3 behaviour.

**Contracts:** `packages/contracts/src/index.ts` gains the customer booking request and response types.

**Web** (new):

- `lib/api/client.ts`: the shared CSRF-aware client, **moved** from `lib/workforce/api.ts`, which now re-exports it as `WorkforceApi` (contract §13: shared, not duplicated);
- `lib/customer/auth.ts` and `lib/customer/booking.ts`, with `booking.test.tsx`;
- `i18n/customer.ts` (VI/EN);
- `components/customer/session.tsx` and `shell.tsx`;
- `components/customer/screens/auth.tsx`, `book.tsx` and `bookings.tsx`;
- `app/customer.css`;
- the routes under `app/[locale]/account/`.

**Web** (changed): the public landing page gains Book, Sign in and Register links (`app/[locale]/(public)/page.tsx`, `i18n/dictionaries.ts`, `app/globals.css`).

**Other:**

- `scripts/test-auth-integration.mjs`: registers the two new integration tests;
- this document, and `LUCYSPA_HANDOFF.md`.

## 2. Customer pages (`/{vi|en}/account/…`)

| Route                      | Screen                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/account/register`        | Registration form, then the 6-digit OTP step (verify / resend after the server's wait), then Login                                                                                            |
| `/account/login`           | Member sign-in (CUSTOMER realm, email). Shows notices for expired, signed-out, activated and reset                                                                                            |
| `/account/forgot-password` | Email, then code and new password (8–128, confirmed), then Login. The same neutral outcome for every account state                                                                            |
| `/account`                 | Home: greeting, Book / My bookings, the next three upcoming bookings, account details (name and language from `/auth/me`)                                                                     |
| `/account/book`            | The wizard: branch → services (ordered, reorderable) → who each service is for → KTV per service (specific or **Any**) → date and a server-feasible start → review → confirm → in-app success |
| `/account/bookings`        | My bookings: **Upcoming** (soonest first) and **History** (latest first)                                                                                                                      |
| `/account/bookings/[id]`   | Detail: code, branch, times in the branch timezone, status, services with recipient, KTV (with "chosen for you" for Any) and reference price. Cancellation with a confirmation panel          |

- The signed-in pages sit behind `RequireCustomer`:
  - anonymous visitors go to login with a safe `next`;
  - staff sessions are refused with a sign-out button;
  - the workforce shell still refuses customers.
- A 401 on a read returns to login with the page as `next`. A 401 on a submission keeps the page and its entries, with a notice (the same rule as the workforce area).
- Nothing is kept in web storage. Flow tokens live in the page's memory.

## 3. API (`/api/v1/me/…`, customer session only)

| Method and path                                               | Purpose                                                                                                                                                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET booking/branches`                                        | Active branches                                                                                                                                                                                     |
| `GET booking/branches/:branchId`                              | Services offered there, with catalog reference price and duration, and the bookable `firstDate`/`lastDate` (branch-local, from `booking.maxAdvanceDays`)                                            |
| `GET booking/branches/:branchId/employees?serviceIds=a,b`     | Per service, the KTVs who pass the engine's time-independent rules (account, employment, trainee, branch assignment, skills), by display name only                                                  |
| `GET booking/availability?branchId&date&serviceIds&employees` | Feasible `HH:MM` starts on the configured slot grid for the whole ordered sequence with the given per-service choice (`ANY` or a KTV id). It runs the same engine and planner as creation. Advisory |
| `POST bookings`                                               | Create; returns the persisted detail (201). A replay returns the same booking                                                                                                                       |
| `GET bookings`                                                | Upcoming and history                                                                                                                                                                                |
| `GET bookings/:id`                                            | Own booking detail                                                                                                                                                                                  |
| `POST bookings/:id/cancel`                                    | Cancel (idempotent); returns the detail                                                                                                                                                             |

Controllers only validate shapes with strict DTOs; unknown fields are rejected, so there is no mass assignment. Business rules live in the service, the core and the Step 3 engine.

## 4. Auth, security and ownership

- `runCustomerCommand` follows the admin frame's lock order:
  1. the shared auth-graph lock;
  2. the session user row `FOR UPDATE`;
  3. `resolveForMutation`, then the work.

  Only an authenticated CUSTOMER passes; staff sessions get `FORBIDDEN`, no session gets `AUTHENTICATION_REQUIRED`.

- The session is the **only** identity. No owner or customer id is accepted from the browser, and the owner and creator of a booking are the session's user.
- Reads and cancels use `WHERE id = :id AND owner_user_id = :session`. Another customer's booking is indistinguishable from a missing one (`NOT_FOUND`).
- The global guard enforces JSON, exact Origin and the session-bound CSRF token on every POST.
- Error mapping: only allowlisted codes and safe messages leave the API.
  - The Step 2 overlap backstop (`23P01`) becomes `BOOKING_SLOT_UNAVAILABLE`.
  - A unique-key race becomes `CONFLICT`.
  - Anything else becomes `SERVICE_UNAVAILABLE`.
  - No Prisma or PostgreSQL text is ever returned.
- Customers see KTV display names only, never other customers' data. The detail exposes no internal fields (version, idempotency key, creator, cancel reason).

**New codes:**

| Code                          | Status | Meaning                                          |
| ----------------------------- | ------ | ------------------------------------------------ |
| `BOOKING_SLOT_UNAVAILABLE`    | 409    | The time was just taken; also the mapped `23P01` |
| `BOOKING_KTV_UNAVAILABLE`     | 409    | The chosen KTV is not free or eligible           |
| `BOOKING_NO_SUITABLE_KTV`     | 409    | No eligible KTV                                  |
| `BOOKING_SERVICE_UNAVAILABLE` | 409    | A service is not offered at the branch           |
| `BOOKING_CUSTOMER_CONFLICT`   | 409    | The customer's own overlap                       |
| `BOOKING_INVALID_TIME`        | 400    | Closed, outside hours, or off the slot grid      |
| `BOOKING_OUTSIDE_HORIZON`     | 400    | Outside the booking window                       |
| `BOOKING_CANCEL_NOT_ALLOWED`  | 409    | Cancellation refused                             |

## 5. Specific KTV, Any KTV and the tie-break (contract §6–§7)

**Timing:** the Step 3 engine chains the lines (line k+1 starts at line k's end plus the O7 buffer) and applies every rule: hours, horizon, slot grid, qualification, leave, CTV work, occupancy, running executions, and the customer's own bookings.

**Specific KTV:**

- kept only when the engine finds them eligible for that line;
- **never replaced**: the result is `BOOKING_KTV_UNAVAILABLE`, and the customer picks another time or KTV;
- specific lines are fixed first.

**Any KTV (Q3):**

1. **Single KTV first:** employees eligible for every Any line, chosen by the tie-break.
2. **Split** only when nobody can take all Any lines: line by line in order, **preferring the previous line's employee**, then the tie-break.
3. A line with nobody eligible makes the start infeasible.

**Tie-break (exact, contract §6):**

1. fewest booked minutes for that employee at that branch on that date;
2. then the earliest `employee_code` (canonical);
3. then the user id.

**Booked minutes (Owner-locked definition):** the sum of the duration snapshots (`booking_service_lines.duration_minutes`) of the service lines assigned to that KTV whose booking is currently `CONFIRMED` or `CHECKED_IN`, restricted to the **same branch** and the **same branch-local business date** (`bookings.service_date`) as the booking being planned.

- **Never counted:**
  - `CANCELLED` or `NO_SHOW` bookings;
  - other business dates;
  - other branches;
  - service buffer minutes;
  - any money, tour, commission, payroll or other financial concept.
- **Scope:** the metric exists only for this deterministic Any-KTV tie-break. It is not workforce or compensation data.
- **Provisional minutes:** while one new booking is planned, the planner adds the duration of each line it has already assigned in that booking to that KTV's workload before the next comparison. This covers lines fixed to a specific KTV and earlier Any lines, so newly assigned minutes are never treated as zero.
- **Order of application:**
  1. Q3 single-KTV-first is decided before workload. Workload only chooses among the employees who can take every Any line; it never breaks up a feasible single-KTV plan.
  2. In a split, the previous line's KTV is still preferred when eligible.
  3. Otherwise: fewer booked minutes (provisional included), then employee code, then user id.

There is no randomness, no UI order and no role name in this. Customers never see the ranking; after booking, the detail shows the assigned KTV per line (`assignment_mode = ANY` shows "chosen for you").

**Mixed:** the UI offers Any or a qualified KTV per service. Specific lines are fixed and Any lines are planned around them. The Step 2 per-line `assignment_mode` stores both.

## 6. Recipients (O11)

- The booking owner is always the session's customer.
- Each service line names a recipient:
  - **Self** (`SELF`, no name, at most one per booking); or
  - another person (`CHILD`, `FAMILY` or `OTHER`) with a required name (≤ 200 characters) and an optional phone.
- One person with several services is **one** `booking_recipients` row, referenced by each of their lines.
- No account is created (the test asserts the user count is unchanged), and there is no family address book.
- The UI explains that the customer is the booking owner and that the person does not need an account.

## 7. Write transaction, locking and re-check (contract §15–§16)

`createCustomerBooking(tx, customer, request, now)` runs inside the customer frame's transaction:

1. **Replay:** an existing booking for (customer, idempotency key) is returned unchanged.
2. **Pre-lock read:** the engine evaluates the sequence to find the involved KTVs (every specific one, and every Any-line candidate).
3. **Locks:** those employees' `users` rows and the customer row, `FOR UPDATE`, in **sorted UUID order** (`lockAvailabilitySubjects`).
4. **Re-check under the locks:** the replay check again, then the engine again. The plan is chosen only from this post-lock result, and Any candidates are limited to the locked rows.
   - If the pre-lock read showed every line covered but the post-lock plan finds no eligible KTV, the result is `BOOKING_SLOT_UNAVAILABLE` ("shown free, then taken").
5. **Insert:**
   - the booking: `CONFIRMED` (O4), channel `ONLINE`, a generated code `BK-YYMMDD-XXXXXX`, starts and ends, branch-local service date;
   - its recipients;
   - the ordered lines, with the KTV, the assignment mode, planned start and end, and the **snapshots** (O5): duration, buffer, service code, VI/EN names, catalog price min/max and unit.
6. **Outbox:** `BOOKING_CREATED` is appended in the same transaction.
7. **Backstop:** the Step 2 exclusion constraint stays the final guard. Any failure rolls back everything; the tests show that a refused write leaves no row.

A lookup (branches, KTVs, availability) reserves nothing.

**Lock-order note:** the frame locks the session user first. The booking then locks the involved KTVs together with the customer in sorted order; re-locking a row this transaction already holds does nothing. Staff commands never lock customer rows, so no lock cycle can form.

## 8. Idempotency and concurrency

- The client sends a UUID idempotency key, generated when the review step opens and reused on every retry of that confirmation.
- The Step 2 unique index `(created_by_user_id, idempotency_key)` is the source of truth; no Redis is involved.
- Replays return the same booking, cancelled or not, and no second outbox event.
- A concurrent duplicate is serialized by the customer row lock and then replays.
- **Real race test** (two connections, deterministic):
  - a third transaction holds the KTV row lock;
  - two booking transactions for the same KTV and time are started;
  - the test waits until **both** show as waiting on that lock in `pg_stat_activity`, then releases it.
  - Specific KTV: one wins, and the other gets `BOOKING_KTV_UNAVAILABLE` with nothing persisted.
  - Any KTV: one wins, and the other gets `BOOKING_SLOT_UNAVAILABLE`.

## 9. My bookings, detail and cancellation (O3)

- **Displayed status** (contract §3): `CONFIRMED`, `CANCELLED` and `NO_SHOW` come from the booking. After check-in the status is derived from the visit: `ARRIVED`, `IN_SERVICE`, `COMPLETED`, or `CANCELLED`.
- **Upcoming:**
  - `CONFIRMED` bookings that have not ended;
  - bookings displayed as `ARRIVED` or `IN_SERVICE`.
  - Everything else is history.
- **Cancel** (`cancelCustomerBooking`): the booking row is locked. `canCancel` is decided by the server, and the button only appears when it is true.
  - **`CONFIRMED`:** becomes `CANCELLED`, with the time, the customer as actor and the optional reason. The planned KTV occupancy is released by the Step 2 trigger (tested).
  - **Late flag:** `cancelled_late = true` when less than `booking.lateCancelAlertMinutes` (setting, default 15) remain before the start. The cancellation still succeeds, with no penalty and no approval.
  - **`CHECKED_IN` with nothing started** (contract §3): the linked visit and its planned lines are cancelled instead, and the booking stays `CHECKED_IN` (displayed as cancelled). Check-in itself is Step 5; this path exists so the O3 rule is complete.
  - **Refused** (`BOOKING_CANCEL_NOT_ALLOWED`): any line started or done, `NO_SHOW`, or anything not cancellable.
  - **Repeat:** returns the same state and appends no second event.

## 10. Events (outbox, contract §17)

Events are appended in the originating transaction with `appendOutboxEvent`, `aggregateType: 'Booking'`, `schemaVersion: 1`. Payloads hold ids and minimal facts only.

- `BOOKING_CREATED`: `bookingId`, `channel`, `startsAt`, and per line `lineId`, `employeeUserId` and `assignmentMode`.
- `BOOKING_CANCELLED`: `bookingId`, `cancelledByUserId`, `actor: 'CUSTOMER'`, **`late`**, `afterCheckIn`.
  - A late cancellation's manager alert is delivered from this event in Step 9.

There is no consumer, no notification and no email or SMS (O10). Booking success is shown in the UI only.

## 11. UI (Q6): functional, responsive, VI/EN

- It reuses the design tokens and the shared `wf-` form, button, notice and badge primitives; `app/customer.css` holds layout only. No new UI framework.
- Mobile-first:
  - 44 px touch targets;
  - navigation, actions and summary wrap on phones;
  - a slot-button grid;
  - visible focus;
  - step headings take focus when the step changes.
- Labels on every input.
- States covered:
  - loading on first paint;
  - load errors with retry and a request reference;
  - empty branches, services and history;
  - no qualified KTV for a service (continuing is blocked);
  - no times for the date;
  - slot or KTV taken on submit (back to the time step, with the message and a fresh list);
  - pending and disabled submission;
  - success confirmation;
  - cancel confirmation;
  - session lost, and auth redirects.
- All new text exists in VI and EN (`i18n/customer.ts`), with a language switch in the header and on the auth cards.
- No business data or rule is hard-coded in components. Dates, limits, times and eligible KTVs come from the server.
- There is no premium motion or redesign.

## 12. Tests and results (targeted)

| Suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Result                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `booking.planner.test` (unit: tie-break order; single-KTV preference over a better single-line pick; tie-break among whole-sequence candidates; split only when needed, with previous-employee preference; specific never replaced, mixed planning; outcome mapping and locked-set limit; frame maps `23P01` and unknown errors; provisional minutes within the same booking change a split decision; specific-line minutes count; single-KTV beats a much lighter candidate; equal workload → code → user id) | **10 / 10 pass**                                        |
| `customer-booking.http.test` (CSRF, wrong or missing Origin → 403 before the service; owner, status, code, channel, nested price, recipient `userId`, bad relation, empty lines, bad time → 400; session token is the identity; availability rejects an extra `ownerUserId`; strict cancel body; stable error codes with no internal text)                                                                                                                                                                     | **1 / 1 pass**                                          |
| `customer-booking.integration.test` (rolled back, real sessions)                                                                                                                                                                                                                                                                                                                                                                                                                                               | **11 / 11 pass** (10 subtests + parent)                 |
| `customer-booking.race.integration.test` (two real connections, committed fixtures, cleaned up)                                                                                                                                                                                                                                                                                                                                                                                                                | **3 / 3 pass**                                          |
| `availability.integration.test` (Step 3; engine export added)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 11 / 11 pass                                            |
| `api.test`, `auth.http.test`, `my-account.http.test` (module wiring, auth errors)                                                                                                                                                                                                                                                                                                                                                                                                                              | pass (23 / 23 together with the planner and HTTP tests) |
| Web: whole unit/SSR suite, including the new `lib/customer/booking.test.tsx` (8 tests: request shape with no owner and each person once; reorder and removal alignment; recipient name rule; customer-safe localized errors and retry codes; reference price format; safe `next`; CUSTOMER-realm login with a CSRF refresh; session kinds; wizard, home and detail first paint in VI/EN; no internal fields in the detail contract) and the moved client's existing tests                                      | **117 / 117 pass**                                      |
| `tsc --noEmit` (api, web, contracts build)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | clean                                                   |
| `pnpm lint` (ESLint, import boundaries) and `pnpm format:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                | pass                                                    |

The `customer-booking.integration.test` subtests cover:

- no session, an anonymous session, or a staff session → refused;
- catalog and dates, qualified KTVs, and availability from the server;
- a specific booking: CONFIRMED, snapshots, `BOOKING_CREATED`, idempotent replay;
- specific never replaced, with nothing persisted on refusal;
- the customer's own conflict, invalid time, horizon, and service not offered;
- Any: whole sequence to the only two-skill KTV; fewest booked minutes; the employee-code fallback;
- booked minutes counts only `CONFIRMED` and `CHECKED_IN` at the same branch and date, with the buffer never counted (60 + 20 = 80; the `CANCELLED` 30, `NO_SHOW` 45, other-branch 90, other-date 40 and buffer 15 are excluded), and the lighter KTV then wins end to end;
- a split with a family recipient and no account created;
- ownership isolation;
- cancellation releases occupancy, repeats safely, replays the key, and frees the slot; the late flag and event;
- after check-in: cancel before START cancels the visit, and cancel after START is refused.

**Not run, by scope:**

- the full repository suites;
- `next build` and `next typegen`, because they can rewrite `apps/web/next-env.d.ts`, which must stay untouched. `tsc` and the SSR tests validate the new routes and screens.

`apps/web/next-env.d.ts` keeps its pre-existing hash `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`.

## 13. Limitations and deferrals

- **Race-test cleanup:** the committed fixtures are removed with `session_replication_role = replica`, which needs a superuser test database (the local one is). The cleanup matches race fixtures by their unique markers (`IT-RACE-*`, `RACE_*`, `race-*@example.invalid`).
- **Not built yet:**
  - PRD 11.4 busy-KTV hints (next feasible time, waiting count);
  - editing the customer's profile (not part of Phase 1 for customers; the home shows `/auth/me` data only);
  - booking modification: cancel and re-book instead (contract §19).
- **In-app notifications** (the booking-success notification and the manager late-cancel alert) are Step 9. Their events are already in the outbox.
- **Customer overlap** considers `CONFIRMED` bookings only (contract §5).
- **KTV display name** is the employee's full name. There is no separate display-name field.
- **No customer-facing routes for Step 5+:** no check-in, queue, walk-in or START/END.

## 14. Step 5 context

- Arrival (`VisitService.arrive`) must:
  - lock the booking;
  - honour `booking.checkInWindowMinutes` (O2);
  - create the visit, participants (from `booking_recipients`) and visit lines carrying `booking_service_line_id`, which moves the occupancy (Step 2);
  - set the booking `CHECKED_IN`.
- The customer cancel path already handles `CHECKED_IN` with nothing started.
- Queue capacity and walk-ins should use the engine in the `OPERATIONAL` context and the same lock-then-re-check pattern (`lockAvailabilitySubjects` + engine) as `createCustomerBooking`.
- Desk bookings (`MANAGE_BOOKINGS`) can reuse `createCustomerBooking`'s core with `channel = DESK` and staff as the creator. This will need a staff command frame and a parameter for the channel and creator.
