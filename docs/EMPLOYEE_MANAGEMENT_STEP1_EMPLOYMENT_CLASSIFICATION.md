# Employee management Step 1: employment classification foundation

Status: implemented and tested locally. Committed on its own as `feat: add employment
classification history`; **not pushed and not deployed**. Backend and database only; no UI.

## Business model

Employment classification is separate from the account status (`users.status`), roles,
branches and skills.

| Value               | Vietnamese                    | Payroll-eligible |
| ------------------- | ----------------------------- | ---------------- |
| `TRAINEE`           | Học viên                      | No               |
| `OFFICIAL_EMPLOYEE` | Nhân viên chính thức          | Yes              |
| `ENDED`             | Đã kết thúc làm việc/học việc | No               |

- **Creation** picks `TRAINEE` or `OFFICIAL_EMPLOYEE` explicitly. TRAINEE is not a required
  stage: an official hire gets one `OFFICIAL_EMPLOYEE` entry and no trainee history.
  `ENDED` is never an initial classification.
- **Allowed changes:** `TRAINEE → OFFICIAL_EMPLOYEE` (promotion), `TRAINEE → ENDED`,
  `OFFICIAL_EMPLOYEE → ENDED`. Nothing follows `ENDED`; there is no rehire workflow.
- **History** is append-only and effective-dated with calendar `DATE`s. It is authoritative
  (it is not derived from the audit log). The classification on date D is the entry with
  the latest `effective_date <= D`. Before the first entry there is no classification.
- **Effective dates** must be strictly later than the latest entry, so there are never two
  entries on the same date and history is never rewritten or reordered.
- **Backdating:**
  - a change dated before today's business date is Owner-only and needs a reason (every
    change needs a reason);
  - it is never before the latest entry, and therefore never before the initial start;
  - there is no payroll locking yet.
- **Creation with a past start date** (recording existing staff) needs `employmentReason`.
- **Today's business date** comes from the database clock in the employee's branch
  timezones: the latest local date across their branches, or UTC when they have none. No
  timezone is hard-coded.

## Database

Migration `20260930000000_employment_classification`:

- **Enum and table:** enum `EmploymentClassification` and table
  `employment_classification_changes`:
  - `employee_user_id` references `employee_profiles` (RESTRICT);
  - `classification`;
  - `effective_date DATE` (must be finite);
  - `reason` (NULL or non-blank);
  - `recorded_by_user_id` references `users` (RESTRICT; NULL only for backfill);
  - `recorded_at`.
- **Unique** `(employee_user_id, effective_date)`.
- **Trigger `lucy_check_employment_classification`** (BEFORE INSERT/UPDATE/DELETE, plus a
  TRUNCATE guard):
  - rejects UPDATE, DELETE and TRUNCATE;
  - locks the employee profile row;
  - rejects `ENDED` as the first entry, a date not later than the latest entry, and any
    disallowed transition.
  - Errors are SQLSTATE `23514`.
- **Backfill:**
  - every existing employee gets one `OFFICIAL_EMPLOYEE` entry dated at the UTC date of the
    account's creation, with the reason "Backfilled: employment predates classification
    history" and no recorder;
  - no trainee period can be truthfully inferred for existing staff;
  - the Owner has no employee profile and is not touched.

Only additive changes: no existing table, column or row is modified.

## API

- **`POST /api/v1/employees` (create)** requires `classification`
  (`TRAINEE` | `OFFICIAL_EMPLOYEE`) and `employmentStartDate` (`YYYY-MM-DD`), plus an
  optional `employmentReason` (required when the start date is in the past).
  - `OFFICIAL_EMPLOYEE` creates payroll eligibility, so it also needs
    `MANAGE_EMPLOYEE_PAY` in every requested branch; `TRAINEE` needs only
    `CREATE_EMPLOYEES`.
  - The initial entry is written in the same transaction as the employee.
  - Audited as `EMPLOYMENT_CLASSIFICATION_RECORDED`.
- **`GET /api/v1/employees/:id/employment[?date=YYYY-MM-DD]`** returns `EmploymentResponse`:
  - `history` (oldest first), `current` (today), `onDate` (for `date`),
    `payrollEligibleToday`, `today` and `version`;
  - visible to the employee themself and to `VIEW_EMPLOYEES` over every branch of the
    employee; otherwise 404.
- **`POST /api/v1/employees/:id/employment`** takes `{expectedVersion, classification:
OFFICIAL_EMPLOYEE | ENDED, effectiveDate, reason}`. It is CSRF-protected and records one
  change.
  - **Authority:** `MANAGE_EMPLOYEE_PAY` over every branch of the employee; never for
    oneself unless Owner; backdating is Owner-only (403).
  - **Errors:**
    - 409 `classification`: transition not allowed;
    - 400 `effectiveDate`: not later than the latest entry;
    - 409: stale `expectedVersion`.
  - Bumps the employee version; audited as `EMPLOYMENT_CLASSIFICATION_CHANGED` with
    before/after and `backdated`.
- **Owner and customers** are never targets (404), as with every employee command.
- **Code:** helpers in `apps/api/src/employees/employment.ts`, commands in
  `EmployeeService`, contract types in `packages/contracts`.

**Clients:** the web app has no employee creation form yet, so no UI change was needed.
Any future creation UI must send `classification` and `employmentStartDate`.

## Not in this step

- UI for creation, detail, login provisioning, roles or skills;
- payroll calculation, salary history, tour pay and commissions;
- leave-policy changes;
- rehire;
- Phase 3.

Attendance and leave behaviour is unchanged.

## Tests

- **`employment.integration.test.ts`** (11/11), with all fixtures rolled back:
  - backfill;
  - 1: create as TRAINEE, with audit;
  - 2–3: create as OFFICIAL_EMPLOYEE (FORBIDDEN without pay authority), with a single
    entry and no trainee history;
  - 4: ENDED rejected as the initial classification (API and SQL);
  - 5–8: promotion preserves the trainee entry byte-for-byte; the classification on a date
    before the start, at the start, the day before promotion, on promotion and after it;
    audit; invalid `date`;
  - 9: repeat promotion, a TRAINEE request and anything after ENDED are rejected;
    TRAINEE → ENDED is allowed; stale version; SQL rejects a bad transition, UPDATE and
    DELETE;
  - 10: same-date and earlier dates are rejected (API and SQL);
  - 11: an injected failure after the classification insert leaves no user and no history
    row; every API-created employee has history;
  - 12: authorization:
    - staff without pay authority, pay authority missing a branch, non-Owner backdating,
      blank reason, anonymous and customer actors, no-VIEW 404, and self-promotion are all
      rejected;
    - self read works;
    - the payroll manager can promote;
  - 13: the Owner has no profile or history and is a 404 target; the Owner may backdate,
    audited `backdated: true`, but never before the start.
- **Point 14 regressions:**
  - attendance 7/7, leave 8/8, employee 10/10, directory 5/5, branch assignment 5/5,
    role-admin 8/8, skills 4/4, branches 7/7;
  - full registered API integration 124/124;
  - API unit/HTTP 86 pass / 0 fail. The HTTP tests cover 400 for ENDED, missing or
    lowercase classification, bad dates and invalid change bodies; 403 without CSRF; and
    argument forwarding.
- **Static checks:** eslint and boundaries pass; prettier passes; `prisma validate` passes;
  the migrate diff is empty.

## Deployment (not done)

Needs a verified backup, then `pnpm db:deploy`. Pending production migrations include
`20260928000000_phase2_service_duration_estimate`,
`20260929000000_phase2_service_price_range_unit` and this one.
