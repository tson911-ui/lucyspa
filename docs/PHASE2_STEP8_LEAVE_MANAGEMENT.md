# Phase 2 Step 8: leave management

Status: **CLOSED** (Owner-authorized to close on passing checks; commit
`feat: add phase 2 leave management`). Baseline is `bde0ab1`. The work is backend/API
only. Nothing was deployed to production.

Context:

- [Step 2](PHASE2_STEP2_DATABASE_FOUNDATION.md), Owner decision **H8**: whole-day leave;
  an employee may cancel only PENDING.
- Owner decision **H2**: `EmployeeBranchAssignment` is the single membership source.
- Step 8 Owner clarifications: controlled leave types, 1 leave day per month as the
  business baseline, and paid/unpaid, quota and carry-forward left to a future
  configurable Leave Policy.
- PRD section 10.2 (request → Manager/Owner approve or reject; approved leave makes the
  employee unavailable for booking).

## 1. Scope implemented

- **Employee self-service:** create an own PENDING request, read own requests, cancel an
  own PENDING request.
- **Decisions:** approve or reject a PENDING request under `APPROVE_LEAVE`, with
  multi-branch containment.
- **Scoped reads** for approvers.
- **A read helper for future Booking:** "which employees are on approved leave on date
  Y?".
- **Schema:** one Owner-authorized migration adding the controlled leave type (section
  18).

## 2. LeaveRequest schema used

The Step 2 `leave_requests` table, plus the new `leave_type` column:

- **Columns:** `employee_user_id`, `leave_type`, `start_date` / `end_date` (DATE),
  `reason` (required), `status` (`LeaveStatus`), `requested_at`, the decision fields
  (`decided_by_user_id`, `decided_at`, `decision_reason`), the cancellation fields
  (`cancelled_by_user_id`, `cancelled_at`, `cancellation_reason`), `row_version`,
  `created_at`, `updated_at`.
- **Level:** employee-level, with **no branch column**.
- **Existing SQL protections (unchanged):** date order, finite dates, non-blank text,
  status/fact consistency, no self-decision, ordered timeline, positive version, and a
  lifecycle trigger that forbids delete and truncate.
- **Trigger change:** the trigger now also freezes `leave_type` once a request is decided
  or cancelled.

## 3. Leave type codes

`LeaveType` enum (SQL and Prisma):

| Code           | Meaning                                              |
| -------------- | ---------------------------------------------------- |
| `ANNUAL`       | Normal / annual leave (the monthly entitlement kind) |
| `SICK`         | Sick leave                                           |
| `PERSONAL`     | Personal or family matter                            |
| `FAMILY_EVENT` | Wedding, bereavement or other family event           |
| `MATERNITY`    | Maternity-related leave                              |
| `OTHER`        | Anything else; the required `reason` explains it     |

- **Labels:** the codes are stable English identifiers. VI/EN display labels belong in the
  UI (Step 9).
- **Leave type is separate from paid/unpaid treatment.** No code implies pay, and there
  is deliberately no `UNPAID` type (Owner decision).
- **No editor:** there is no admin leave-type editor.

## 4. Whole-day semantics

- **Inclusive calendar dates:** requests are `YYYY-MM-DD` dates. `2026-10-10 →
2026-10-10` is 1 day; `2026-10-10 → 2026-10-12` is 3 days (the `days` field).
- **Date-only parsing:** each date is parsed as that exact calendar day and stored in a
  PostgreSQL `DATE`. It is never derived from a timestamp, so no timezone shifts it
  (tested: the stored `start_date::text` equals the input).
- **Rejected input:** invalid dates (`2027-02-30`), timestamps, `endDate < startDate`, and
  spans over 366 days.
- **Whole days only:** no hours, half days, morning/afternoon or shifts. The strict DTO
  rejects any such field.

## 5. Employee create / read / cancel

- **Create:**
  - `POST /api/v1/leave-requests` with `{ leaveType, startDate, endDate, reason }`
    returns 201 and a PENDING request.
  - The employee is always the session's User. The body can't name another employee:
    the DTO rejects `employeeId` and the service ignores it (tested).
- **Read:**
  - `GET /api/v1/leave-requests/me?from&to&status` returns the caller's own requests
    that overlap the range.
  - Bounded: the range is at most 400 days (default 93 days back to 366 days ahead), and
    at most 500 rows are returned.
- **Cancel:**
  - `POST /:id/cancel` with `{ expectedVersion, reason? }` works on the caller's own
    PENDING request only.
  - Another employee's request is 404, APPROVED/REJECTED/CANCELLED is 409, and a stale
    version is 409.
  - The request stays as history, and its dates become free.
- **Callers:** customers get 403 and anonymous callers 401 on every route. The Owner (no
  employee profile) gets 403 on the self-service routes.

## 6. Approval / rejection

- **Routes:**
  - `POST /:id/approve` with `{ expectedVersion, reason? }`;
  - `POST /:id/reject` with `{ expectedVersion, reason }` (a reason is required for
    rejection).
- **Transitions:** only PENDING → APPROVED or REJECTED. A second decision is 409.
- **Recorded facts:** `decided_by_user_id`, `decided_at` (database clock) and
  `decision_reason`.
- **Already-APPROVED requests:** management handling (withdrawal or cancellation) is
  **not implemented**. The Step 2 trigger keeps APPROVED → CANCELLED possible for a
  future authorized workflow. That workflow was not invented, and APPROVED is never
  self-cancelled.

## 7. Authorization / containment

- **Decisions:** `APPROVE_LEAVE` over **every active branch of the employee**
  (`requireAcross`, the same all-or-nothing rule as employee scope, employee skills and
  branch assignments). A branchless employee needs GLOBAL `APPROVE_LEAVE`.
- **No self-decision:** a caller can't decide their own request (403); SQL enforces this
  too.
- **Transaction boundary:** authorization runs inside the transaction on the
  transaction-time authority graph, after the row locks and before any lifecycle state
  is revealed.
- **Scoped reads (`GET /api/v1/leave-requests?from&to&status&employeeId`):**
  - GLOBAL `APPROVE_LEAVE` sees everyone.
  - A branch grant sees only employees whose active branches all lie inside the caller's
    authorized member branches.
  - No authority is 403; an employee outside scope is 404.

## 8. Multi-branch behavior

- **One request per employee:** a request is never duplicated per assignment. An A+B
  employee's request needs `APPROVE_LEAVE` at A and B. A manager of A only can neither
  decide nor list it (tested).
- **Current membership:** containment uses the employee's current active assignments.

## 9. Overlap behavior

- **Blocking statuses:** PENDING and APPROVED requests of the same employee never share a
  calendar date. A new request overlapping one is 409 (`startDate`).
- **Allowed:** adjacent dates, and other employees' dates.
- **History:** REJECTED and CANCELLED requests don't block; the same dates can be
  requested again (tested).

## 10. Concurrency

This reuses the shared admin-command frame, with no new concurrency mechanism.

- **Per-employee serialization:** every leave write locks the **employee's User row**
  `FOR UPDATE` before reading leave rows. For a self request the employee is the actor;
  for a cancel or decision, the request's employee is locked with the actor, sorted by
  UUID. So two overlapping creations, or a creation and a decision, for one employee
  can't interleave, and the second sees the first's result.
- **Request lock:** cancellation and decisions then lock the request row `FOR UPDATE`
  and check status and `expectedVersion`. Approval racing cancellation, or two managers
  deciding, leaves exactly one winner; the other gets 409 and nothing is rewritten. SQL
  also forbids invalid transitions.
- **No database exclusion constraint** (Owner decision: no `btree_gist`).
- **Test coverage:**
  - the integration test traces the transaction's statements and asserts the lock order
    (employee row, then the overlap check, then the insert; employee row before request
    row);
  - it also asserts the loser outcomes (stale version, status already changed).
  - Genuine multi-connection racing isn't run: leave history can't be deleted, so a test
    that committed rows would leave permanent data in the development database.

## 11. Audit

Existing append-only `AuditEvent`, entity type `LeaveRequest`:

| Action            | Content                                                                      |
| ----------------- | ---------------------------------------------------------------------------- |
| `LEAVE_REQUESTED` | after: type, dates, status                                                   |
| `LEAVE_CANCELLED` | before/after type, dates, status; cancellation reason                        |
| `LEAVE_APPROVED`  | before/after type, dates, status; the employee's branch IDs; optional reason |
| `LEAVE_REJECTED`  | before/after type, dates, status; the employee's branch IDs; required reason |

Every event records the actor, the subject employee and the request ID. The branch is
null, because leave is employee-level; the branch scope is in `after.employeeBranchIds`.

## 12. 1-day-per-month requirement status

- **Current business baseline:** **Lucy Spa employees receive 1 leave day per month.**
- **Not enforced:** quota enforcement is **intentionally deferred** until a Leave Policy
  is configured.
- **Undecided policy:** accrual timing, start-date proration, expiry vs carry-forward,
  and which types consume entitlement.
- **Not built:** no balance, accrual or quota logic. A second request in the same month
  is accepted (tested).
- **Future policy:** a policy can compute balances from the stored type and dates without
  rewriting historical requests.

## 13. Paid/unpaid policy status

- **Undecided and configurable:** paid/unpaid treatment is **intentionally undecided**.
  There is no `isPaid`, paid-status, deduction, balance or payroll column (a test asserts
  the exact column set).
- **Future design:** Leave Type → Leave Policy configuration → paid/unpaid → payroll.
- **No payroll implementation** exists.

## 14. Carry-forward policy status

Carry-forward is **intentionally undecided and configurable**. Nothing assumes unused
days expire or carry forward, and no carry-forward data is stored.

## 15. Future Booking compatibility

- **The question Booking will ask:** "Is employee X on approved leave on date Y?" The
  answer is `status = 'APPROVED' AND start_date <= Y AND end_date >= Y`, indexed by
  `leave_requests_status_dates_idx` and `leave_requests_employee_idx`.
- **Helper:** `employeesOnApprovedLeave(tx, employeeIds, date)` in
  `apps/api/src/leave/leave.availability.ts` answers it for a set of employees. It
  gives one answer per employee, regardless of branches, and the end date is inclusive.
  PENDING, REJECTED and CANCELLED never count (tested).
- **Not implemented:** Booking itself; no bookings, notifications, reassignment or
  auto-suggest were built.

## 16. Attendance interaction

None. Approving leave doesn't create, change or delete attendance records, and there is
no attendance or payroll deduction logic. Comparing leave with attendance is future
work.

## 17. Tests and checks

| Check                                                                                     | Result                  |
| ----------------------------------------------------------------------------------------- | ----------------------- |
| Leave integration (real PostgreSQL, each command in its own savepoint, rolled back)       | **PASS 7** (6 subtests) |
| Leave HTTP contract test                                                                  | PASS 1                  |
| Phase 2 schema integration (now also applies the follow-up migrations; leave type checks) | PASS 10                 |
| Every HTTP suite that boots `AppModule` (it registers the new controller)                 | PASS 32                 |
| Prisma schema valid and formatted; local database matches the schema (empty diff)         | PASS                    |
| Builds: contracts, database, API; web `tsc --noEmit` (writes nothing)                     | PASS                    |
| ESLint, Prettier and the boundary check on changed files                                  | PASS                    |

**The integration test covers:**

- **Create:**
  - own PENDING request; stored type; single-day and 3-day requests with exact stored
    dates; audit;
  - invalid range, impossible date, timestamp, `UNPAID`, blank reason and an overlong
    span are 400;
  - customer 403; anonymous 401; a smuggled `employeeId` is ignored;
  - overlap with PENDING and APPROVED is 409; adjacent dates are allowed.
- **Approve and reject:**
  - an unauthorized employee is 403; an unknown request is 404; a stale version is 409;
  - approval by a branch manager, with lock order and audit;
  - a second transition is 409;
  - an A-only manager is refused for an A+B employee, and an A+B manager decides;
  - a branchless employee needs GLOBAL;
  - self-decision is 403;
  - rejection requires a reason; a rejected request doesn't block new ones.
- **Cancel:**
  - another employee's request is 404; a customer is 403; a stale version is 409;
  - cancel with audit; approval racing a cancellation and cancellation racing an approval
    are 409;
  - APPROVED is never self-cancelled; the cancelled request is kept as history, and its
    dates can be requested again.
- **Reads:** own only; customers 403; an oversized range 400; containment for A-only, A+B
  and GLOBAL approvers; an out-of-scope employee 404; no permission 403; anonymous 401.
- **Booking foundation:** approved leave by employee and date; PENDING excluded; an
  inclusive end date; one employee-level row for a multi-branch employee.
- **Policy:** the exact column set (no pay, balance or carry-forward fields), the exact
  enum values, and no quota enforced.

The postcheck confirms no leave rows or users remain and no Owner was created.

## 18. Migration and database status

- **Migration:** `20260927000000_phase2_leave_type` (Owner-authorized):
  - `CREATE TYPE "LeaveType"` with the six codes;
  - `leave_requests.leave_type` added as `NOT NULL`, with **no default**; the table was
    empty, so no backfill was needed;
  - `lucy_guard_leave_request()` replaced, adding `leave_type` to the frozen request
    facts. Every other protection is unchanged.
- **Applied LOCAL ONLY** with `prisma migrate deploy` to the development database
  (`127.0.0.1`, `lucy_spa_dev`). There was no reset, no `db push` and no data removal.
- **Production was untouched.** Deploying Phase 2 later needs `pnpm db:deploy` and
  `pnpm db:permissions:sync`.

## 19. Deferrals and limitations

- **Leave Policy (future):** the 1-day/month quota, accrual, carry-forward/expiry,
  proration, which types consume entitlement, and paid/unpaid treatment.
- **Payroll:** not implemented.
- **Booking (Phase 3):** availability exclusion, auto-suggest exclusion, detecting
  affected bookings, and notification/reassignment.
- **Management handling of APPROVED leave** (withdrawal or cancellation): a future
  authorized workflow.
- **No editing of PENDING requests;** an employee cancels and re-requests.
- **Scoped reads use current membership:** after an employee moves branches, their past
  requests follow their current branches.
- **The default read window uses the UTC calendar date;** explicit `from`/`to` are exact.
- **UI:** Step 9.

## 20. Git context

- **Baseline:** `bde0ab1`, with `apps/web/next-env.d.ts` a pre-existing generated dirty
  file that stays untouched and unstaged.
- **Commit:** only Step 8 schema, migration, implementation, test and documentation files.

## 21. Next step

**Phase 2 Step 9: Workforce Login/Dashboard + Phase 2 UI Integration.** It needs separate
Owner authorization.
