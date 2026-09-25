# Phase 2 Step 7: attendance

Status: **CLOSED** (Owner-authorized to close on passing checks; commit
`feat: add phase 2 attendance`). Baseline is `5c7f826`. The work is backend/API only.
Nothing was deployed to production.

Context:

- [Step 2](PHASE2_STEP2_DATABASE_FOUNDATION.md), Owner decision **H7**: one attendance
  record per employee + branch + date, no breaks, manager corrections audited.
- Owner decision **H2**: `EmployeeBranchAssignment` is the single membership source.
- [Step 3](PHASE2_STEP3_BRANCH_ADMIN_HOURS.md): attendance writes lock the branch row
  `FOR SHARE`; a timezone change is refused once attendance exists.
- [Step 6](PHASE2_STEP6_OPERATIONAL_BRANCH_ASSIGNMENTS.md): branch assignments.

## 1. Scope implemented

Attendance V1 is **one check-in + one check-out per employee + branch + business date,
with no breaks**.

- self check-in and self check-out;
- bounded reads of the caller's own records;
- branch-scoped reads under `VIEW_ATTENDANCE`;
- manager corrections under `MANAGE_ATTENDANCE` (including a forgotten check-out), with
  a required reason, `expectedVersion` and audit.

It uses the existing `AttendanceRecord` model, permission codes and audit table.

## 2. APIs and routes (under `/api/v1/attendance`)

| Route                 | Body / query                                       | Result          |
| --------------------- | -------------------------------------------------- | --------------- |
| `POST /check-in`      | `branchId`                                         | 201, the record |
| `POST /:id/check-out` | `{}` (must be empty)                               | 200, the record |
| `POST /:id/correct`   | `expectedVersion, checkInAt?, checkOutAt?, reason` | 200, the record |
| `GET /me`             | `from?, to?, branchId?` (`YYYY-MM-DD`)             | `{ records[] }` |
| `GET /`               | `from?, to?, branchId?, employeeId?`               | `{ records[] }` |

- **Record:** `id, employeeId, branchId, businessDate (YYYY-MM-DD), checkInAt,
checkOutAt | null, version`.
- **Protection:** every POST keeps the JSON, exact-Origin and session-bound CSRF checks.
  Strict DTOs reject unknown fields such as `employeeId`, `checkInAt` on check-in,
  `businessDate` or a non-empty check-out body.
- **Client-supplied times:** never accepted for check-in or check-out; the database
  clock (`now()` of the transaction) is used.

## 3. Attendance lifecycle

1. **Open:** check-in creates the record with `checkInAt` and `checkOutAt = null`,
   version 1.
2. **Closed:** check-out sets `checkOutAt` on the same record, version 2.
3. **Corrected:** a manager correction may set or change either timestamp; each change
   bumps the version.

There is no delete route and no break or shift sub-record.

## 4. Business date and timezone

- **Source:** the business date is the calendar date of the check-in instant in the
  **branch's IANA timezone** (`branches.timezone`).
- **Computation:** in SQL, `to_char(instant AT TIME ZONE branch.timezone, 'YYYY-MM-DD')`.
  It never uses the server's local timezone, and no zone such as `Asia/Ho_Chi_Minh` is
  hard-coded.
- **Enforcement:** the Step 2 trigger `lucy_check_attendance_record` independently
  requires `business_date = (check_in_at AT TIME ZONE branch.timezone)::date`.
- **Tested:** two branches at UTC+14 and UTC−11 always get different business dates
  for the same instant.

## 5. Self check-in

In one transaction under the shared authorization lock:

1. **Caller:** an authenticated EMPLOYEE; customers are 403 and anonymous callers 401.
2. **Branch:** `SELECT … FOR SHARE` on the branch. Unknown is 404; inactive is 409.
3. **Membership:** an active `EmployeeBranchAssignment` (not revoked) for the caller at
   that branch, checked inside the transaction; otherwise 403.
4. **Duplicate:** an existing record for employee + branch + business date is 409.
5. **Write:** create the record, then audit `ATTENDANCE_CHECKED_IN`.

A multi-branch employee may check in at each assigned branch; each gets its own record.

## 6. Self check-out

- **Owner of the record:** only the employee on the record; anyone else's record, or an
  unknown ID, is 404.
- **Open only:** an already checked-out record is 409.
- **Today only:** the record's business date must equal today's date in the branch
  timezone; an earlier day is 409, and a forgotten check-out is fixed by a manager
  correction.
- **Membership:** not required at check-out, so an employee can still close their own
  open record.
- **Write:** the record row is locked `FOR UPDATE`; `checkOutAt = now`, version + 1;
  audit `ATTENDANCE_CHECKED_OUT`.

## 7. Read APIs

- **Bounded:** `from`/`to` are business dates; the default is the last 31 days, the
  maximum range is 93 days (otherwise 400), and at most 2,000 records are returned.
  Records are ordered by business date, then check-in, newest first.
- **`GET /me`:** EMPLOYEE only; the caller's own records, optionally filtered by branch.
- **`GET /`:** `VIEW_ATTENDANCE` records.
  - GLOBAL authority sees every branch.
  - BRANCH authority sees only the branches where the actor holds it through an active
    membership.
  - No visible branch is 403; a requested branch outside the visible set is 404, so
    other branches aren't revealed.
  - Optional `employeeId` filter.

## 8. Correction behavior

- **Permission:** `MANAGE_ATTENDANCE` at the record's branch (GLOBAL or BRANCH).
- **Self-corrections:** a non-Owner can't correct their own record (403).
- **Reason:** required and non-blank.
- **Version:** `expectedVersion` must match; stale is 409.
- **Timestamps:**
  - neither may be in the future;
  - `checkOutAt` must be after `checkInAt`;
  - a changed `checkInAt` must keep the same business date (the business date and
    employee never change);
  - a no-op correction is 400.
- **Write:** version + 1; audit `ATTENDANCE_CORRECTED` with before and after
  timestamps and the reason.

## 9. Branch-assignment interaction

- Check-in requires an active assignment at that branch (H2), rechecked in the
  transaction.
- Revoking an assignment blocks new check-ins there but leaves existing records
  untouched and readable (tested).
- Assignment changes don't alter attendance rows.

## 10. Branch deactivation and history

- An inactive branch refuses new check-ins (409).
- Records at deactivated branches remain readable (tested). The FK is restrictive and
  nothing is deleted.
- The Step 3 rule still applies: a branch timezone can't change once attendance exists,
  so stored business dates stay consistent.

## 11. Authorization rules

| Action      | Rule                                                           |
| ----------- | -------------------------------------------------------------- |
| Check-in    | EMPLOYEE with an active assignment at an active branch         |
| Check-out   | EMPLOYEE on their own open record for today                    |
| Own read    | EMPLOYEE, own records only                                     |
| Branch read | `VIEW_ATTENDANCE` per branch (GLOBAL sees all)                 |
| Correct     | `MANAGE_ATTENDANCE` at the record's branch; no self-correction |

Customers are 403 on every route; anonymous callers are 401.

## 12. Concurrency and locking

- **Branch lock:** check-in holds the branch row `FOR SHARE`, so it can't race a
  timezone change or a deactivation (branch update uses `FOR UPDATE`).
- **Duplicates:** the unique index `attendance_records_employee_branch_date_key`
  makes a second record impossible, even for two concurrent check-ins or a direct
  insert (tested). A losing insert is mapped to 409.
- **Record lock:** check-out and correction lock the record `FOR UPDATE`.
- **Optimistic concurrency:** corrections use `expectedVersion` against `row_version`.

## 13. Audit behavior

| Action                   | Content                                     |
| ------------------------ | ------------------------------------------- |
| `ATTENDANCE_CHECKED_IN`  | business date, check-in                     |
| `ATTENDANCE_CHECKED_OUT` | check-in, check-out                         |
| `ATTENDANCE_CORRECTED`   | before/after check-in and check-out, reason |

Every event records the actor, the subject employee, the record's branch and the
request ID.

## 14. Tests and checks

| Check                                                                                    | Result                  |
| ---------------------------------------------------------------------------------------- | ----------------------- |
| Attendance integration (real PostgreSQL, each command in its own savepoint, rolled back) | **PASS 6** (5 subtests) |
| Attendance HTTP contract test                                                            | PASS 1                  |
| Every HTTP suite that boots `AppModule` (it registers the new controller)                | PASS 31                 |
| Builds: contracts and API; web `tsc --noEmit` (writes nothing)                           | PASS                    |
| ESLint, Prettier and the boundary check on changed files                                 | PASS                    |

**The integration test covers:**

- **Check-in:** success and audit; branch-local business date (UTC+14 versus UTC−11);
  duplicate 409 plus a direct DB duplicate refused; no assignment 403; unknown branch
  404; customer 403; anonymous 401; a multi-branch employee at two branches.
- **Check-out:** same record updated with audit; another employee's record and an
  unknown ID 404; double check-out 409; an earlier business date 409.
- **Correction:** forgotten check-out fixed by a manager with audit (before, after,
  reason); a manager of another branch 403; blank reason, check-out before check-in,
  future time and a changed business date 400; stale version 409; self-correction 403.
- **Reads:** own records only; branch-scoped reads limited to the branch; another branch
  404; no permission 403; customers 403; an oversized range 400; GLOBAL read.
- **History:** records remain after assignment revocation and branch deactivation; new
  check-ins there are refused.

The postcheck confirms no attendance rows or users remain and no Owner was created.

## 15. Migration and database status

**No new migration and no schema change.** The Step 2 `AttendanceRecord` model,
constraints and trigger supported Step 7 as designed. Nothing was changed in
production.

## 16. Deferrals and limitations

- **Not implemented (by decision):** breaks, shifts, lateness or penalties, payroll,
  booking integration, geofencing and notifications. The schema has no lateness fields.
- **One visit per day:** a second check-in the same day at the same branch is refused;
  a re-open after check-out is a manager correction.
- **Step 8:** leave. **Step 9:** UI.
- **Production:** the Phase 2 migrations and code are not deployed. That needs
  `pnpm db:deploy` and `pnpm db:permissions:sync`.

## 17. Git context

- **Baseline:** `5c7f826`, with `apps/web/next-env.d.ts` a pre-existing generated dirty
  file that stays untouched and unstaged.
- **Commit:** only Step 7 implementation, test and documentation files.

## 18. Next step

**Phase 2 Step 8: Leave Management.** It needs separate Owner authorization.
