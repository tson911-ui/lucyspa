# Phase 2 follow-up: Collaborator and My Account foundation (design)

**Status: DESIGN; Owner decisions Q1–Q16 RESOLVED (2026-09-26). Steps 2–6 deployed and
accepted (see the Step [2](EMPLOYEE_MANAGEMENT_FOLLOWUP_STEP2_COLLABORATOR.md),
[3](EMPLOYEE_MANAGEMENT_FOLLOWUP_STEP3_MY_ACCOUNT.md),
[4](EMPLOYEE_MANAGEMENT_FOLLOWUP_STEP4_CHANGE_PASSWORD.md),
[5](EMPLOYEE_MANAGEMENT_FOLLOWUP_STEP5_VERIFIED_EMAIL_CHANGE.md) and
[6](EMPLOYEE_MANAGEMENT_FOLLOWUP_STEP6_COLLABORATOR_SCHEDULE_PAY.md) reports); Step 7 (My
Income) implemented, not deployed (see
[Step 7 report](EMPLOYEE_MANAGEMENT_FOLLOWUP_STEP7_MY_INCOME.md)).** Phase 2 remains CLOSED / PRODUCTION ACCEPTED
(Phase 2 closure docs `2d69e41`; application code in production through `1261871`, follow-up Step 6). Phase 3
(booking) remains NOT STARTED. This follow-up is designed now because collaborator
availability feeds booking. The sections below are the original design; the implemented
contracts are recorded in the step reports and in the "Final Step N contract" notes.

## 1. Current-system findings (inspected, not re-analyzed)

**Employment classification** (`employment_classification_changes`, Step 1):

- The enum is `TRAINEE | OFFICIAL_EMPLOYEE | ENDED`; the history is append-only and
  effective-dated (`DATE`).
- Transitions are enforced twice, in the SQL trigger `lucy_check_employment_classification()`
  and in `employees/employment.ts` (`TRANSITIONS`). Today:
  - `TRAINEE → OFFICIAL_EMPLOYEE | ENDED`;
  - `OFFICIAL_EMPLOYEE → ENDED`;
  - nothing after ENDED.
- `payrollEligible()` is true only for OFFICIAL_EMPLOYEE.
- ENDED-in-effect guards block reactivation, credentials, setup, new roles and new
  skills.

**Roles:**

- `Role.isManagerGroup` (migration `20261001000000`) is display grouping only.
- The directory "Quản lý" group is _any active assignment of an active manager-group role_.
  **Classification is not checked today.**
- Role assignment (`RoleAdminService.assignRole`) checks scope, containment
  (`EXCEEDS_ACTOR`), self-target, the Owner (404) and ENDED, but not classification.
- `updateRole` can flip `isManagerGroup` without looking at who holds the role.

**Profile data** is already single-source:

- `users`: `full_name`, `phone_canonical` (unique across all users, required for
  employees), `email_canonical`/`email_delivery` (unique, nullable for employees) with
  `email_verified_at`, and `preferred_locale`.
- `employee_profiles`: code (immutable, the workforce login ID), `date_of_birth`,
  `address`, `base_salary_vnd`.
- `POST /employees/:id/profile` (`UPDATE_EMPLOYEES`) edits only the name, date of birth,
  address and language. **No command edits phone or email.**
- `GET /employees/:id` requires `VIEW_EMPLOYEES`; **there is no self-read**.
- `/auth/me` returns identity, authorization and (workforce) `recoveryEmail`.

**Auth:**

- Workforce login uses the employee code (`EMPLOYEE_ID`) or a verified email (the Owner
  may use an unverified one).
- Email recovery requires a verified email.
- The recovery-email verification (`VERIFY_RECOVERY_EMAIL` challenge) proves only the
  _stored_ address. It never changes it.
- Challenge purposes: `ACTIVATE_CUSTOMER`, `RESET_PASSWORD`, `VERIFY_RECOVERY_EMAIL`,
  `EMPLOYEE_SETUP`.
- **There is no self-service password change** (a gap). There is also no email-change
  flow.

**Attendance and leave:**

- Check-in needs `kind=EMPLOYEE` and an active assignment at an active branch; the
  business date is computed in the branch timezone. It does not look at classification or
  schedules.
- Leave is self-service for any employee.

**Pay:** only `employee_profiles.base_salary_vnd` exists (`MANAGE_EMPLOYEE_PAY` /
`VIEW_EMPLOYEE_PAY`, data classification `EMPLOYEE_PAY`). There is no payroll, tour,
commission or tip data (PRD sections on tours and commissions are not implemented).

**UI:**

- The dashboard hosts "Email khôi phục".
- Employee detail edits the profile (`UPDATE_EMPLOYEES`).
- There is no "My Account" page.

## 2. Proposed domain model

| Concept                      | Where                                         | Change                                                          |
| ---------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| Employment classification    | `EmploymentClassification` enum + history     | **Add `COLLABORATOR`** (enum value, trigger and TS transitions) |
| Management role              | `Role.isManagerGroup` + active assignment     | Unchanged source; **new invariant** (section 4)                 |
| Display title                | Derived (server function), never stored       | New read-model field                                            |
| Collaborator work occurrence | **New table** `collaborator_work_occurrences` | Schedule + agreed pay                                           |
| Person profile               | Existing `users` + `employee_profiles`        | Unchanged storage; new self-service commands                    |
| Email change                 | **New challenge purpose `CHANGE_EMAIL`**      | Verified change flow                                            |
| Password change              | Existing columns                              | New self-service command                                        |

The employee code stays the stable identifier; it never encodes classification or title.

## 3. Employment transition matrix

The "from" state is the latest recorded classification; each change must be dated later
than the latest one. Backdating remains Owner-only.

| From \ To         | TRAINEE | COLLABORATOR         | OFFICIAL_EMPLOYEE | ENDED      |
| ----------------- | ------- | -------------------- | ----------------- | ---------- |
| _(initial)_       | ✅      | ✅ **new**           | ✅                | ❌         |
| TRAINEE           | —       | ✅ **new**           | ✅                | ✅         |
| COLLABORATOR      | ❌      | —                    | ✅ **new**        | ✅ **new** |
| OFFICIAL_EMPLOYEE | ❌      | ❌ (Q1: not allowed) | —                 | ✅         |
| ENDED             | ❌      | ❌                   | ❌                | —          |

- **Why TRAINEE → COLLABORATOR:** a trainee who finishes training may work flexibly
  without becoming official. It is business-safe: pay moves from none to agreed
  per-occurrence pay.
- **OFFICIAL_EMPLOYEE → COLLABORATOR** (downgrade to flexible work) is deliberately **not**
  allowed by default (Q1). If allowed, it would trigger the manager invariant (section 4)
  and base-salary handling.
- **No rehire:** ENDED stays final.
- **Permissions:** unchanged. Every classification change needs `MANAGE_EMPLOYEE_PAY` over
  every branch; there are no self changes.
- **Creation:** a new member may start as TRAINEE, COLLABORATOR or OFFICIAL_EMPLOYEE.
  OFFICIAL_EMPLOYEE additionally needs `MANAGE_EMPLOYEE_PAY` (existing rule).
  COLLABORATOR also creates pay (per occurrence), so it should need `MANAGE_EMPLOYEE_PAY`
  too (Q2).
- **Pay eligibility:** `payrollEligible()` stays OFFICIAL-only for _fixed/base salary_. A
  new `collaboratorPayEligible(date)` is true when the classification on that date is
  COLLABORATOR.

## 4. Manager invariant and enforcement points

**Invariant:** an active assignment of an active manager-group role may exist only for a
member whose classification in effect today is OFFICIAL_EMPLOYEE. Ending employment is
covered by E3 below.

Enforced in the API, the source of truth, at every write that could break it. Each check
runs inside the existing transaction and locks:

| #   | Command                                                                                                 | Rule                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | `assignRole` (role active + manager-group)                                                              | Refuse `409 employmentClassification` unless the target is OFFICIAL_EMPLOYEE today                                                         |
| E2  | `updateRole` setting `isManagerGroup=true` or re-activating a manager-group role                        | Refuse `409` if any current holder is not OFFICIAL_EMPLOYEE today (report the count)                                                       |
| E3  | `endEmployment` / classification change _away_ from OFFICIAL_EMPLOYEE while holding manager-group roles | **Q3 resolved: refuse** with `409 managerRole` until the manager-group assignments are revoked (explicit, audited, no silent role change). |
| E4  | Classification change _to_ a non-official state via the Step 1 command                                  | Same as E3                                                                                                                                 |
| E5  | `createEmployee`                                                                                        | No roles at creation, so nothing to check                                                                                                  |

**Future-dated changes:** a scheduled ENDED on a future date leaves the member a manager
until that date. Enforcement at E3 happens when the change is recorded. The display rule
(section 5) evaluates "today", so nothing invalid is shown after the date. The
no-scheduler limitation stands.

**Read-side safety:** the directory "Quản lý" group and the display title require
**both** OFFICIAL_EMPLOYEE today **and** an active manager-group role. Any legacy
inconsistency therefore shows as the person's classification title, never as "Quản lý".

**Migration pre-check:** before enabling E1–E4 in production, run a query listing active
manager-group assignments held by non-OFFICIAL members. Today's production case (Trần
Hoàng Anh Thư) must be confirmed OFFICIAL_EMPLOYEE. The Owner resolves any rows first;
the migration itself never changes roles.

Assigning a normal (non-manager) role **never** changes classification.

## 5. Display-title precedence

One server function, `workforceTitle(user, today)`, returned in `/auth/me`, the directory,
employee detail and My Account. The UI never recomputes it.

| Priority | Condition                                           | VI           | EN               |
| -------- | --------------------------------------------------- | ------------ | ---------------- |
| 1        | `kind = OWNER`                                      | Chủ Spa      | Spa Owner        |
| 2        | classification today = ENDED                        | Đã nghỉ      | Ended            |
| 3        | OFFICIAL_EMPLOYEE today + active manager-group role | Quản lý      | Manager          |
| 4        | OFFICIAL_EMPLOYEE today                             | Nhân viên    | Employee         |
| 5        | COLLABORATOR today                                  | CTV          | Collaborator     |
| 6        | TRAINEE today                                       | Học viên     | Trainee          |
| 7        | no classification yet (future start)                | Chưa bắt đầu | Not started (Q4) |

Returned as a code (`OWNER | ENDED | MANAGER | EMPLOYEE | COLLABORATOR | TRAINEE |
NOT_STARTED`) plus localized labels in the web dictionary.

**Label changes:** the classification labels change to match: OFFICIAL_EMPLOYEE "Nhân
viên" (was "Nhân viên chính thức"), ENDED "Đã nghỉ" (was "Đã kết thúc làm việc/học
việc").

**Directory grouping (Q5 resolved):** four mutually exclusive sections, each
server-paginated: Quản lý (title MANAGER), Nhân viên (OFFICIAL without a manager role), CTV
(COLLABORATOR) and Học viên (TRAINEE). ENDED and not-yet-started members are placed in the
section of their last active classification (ENDED) or of their upcoming one (not
started), with the title "Đã nghỉ" / "Chưa bắt đầu". So nobody disappears or is duplicated,
and the existing status filter keeps working.

## 6. Collaborator schedule and pay model

A new table, `collaborator_work_occurrences`, holds one row per scheduled work
occurrence.

| Column                                                  | Notes                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` uuid                                               |                                                                                                                                                       |
| `employee_user_id` → `employee_profiles` RESTRICT       |                                                                                                                                                       |
| `branch_id` → `branches` RESTRICT                       | Active assignment required at create/edit                                                                                                             |
| `work_date` DATE                                        | Business date in the branch timezone                                                                                                                  |
| `mode` enum `SHIFT \| FULL_DAY`                         |                                                                                                                                                       |
| `start_time`, `end_time` TIME                           | SHIFT: entered, `start < end`, same day (no overnight). FULL_DAY: **snapshot** of the branch's opening hours for that weekday at scheduling time (Q6) |
| `agreed_pay_vnd` BIGINT ≥ 0                             | Entered manually; **never derived from hours or attendance**                                                                                          |
| `status` enum `SCHEDULED \| CANCELLED`                  | Rows are never deleted                                                                                                                                |
| `note` text null                                        |                                                                                                                                                       |
| `created_by_user_id`, `created_at`                      |                                                                                                                                                       |
| `updated_by_user_id`, `updated_at`                      |                                                                                                                                                       |
| `cancelled_by_user_id`, `cancelled_at`, `cancel_reason` |                                                                                                                                                       |
| `row_version` int                                       | Optimistic concurrency (`expectedVersion`)                                                                                                            |

**Rules** (API; SQL CHECKs for shape):

- **Classification:** it must be COLLABORATOR **on `work_date`** (effective-dated, not
  just today). Scheduling an OFFICIAL_EMPLOYEE, TRAINEE or ENDED member on that date is
  refused. A member promoted to OFFICIAL keeps their earlier collaborator occurrences as
  history.
- **Account:** it must not be INACTIVE when scheduling.
- **Branch:** active, and an active assignment of the member.
- **Timing:** SHIFT must lie within the branch opening hours for that weekday (Q7:
  hard-block vs warn). FULL_DAY on a closed weekday is refused.
- **No overlap:** for the same collaborator, SCHEDULED occurrences on the same
  `work_date` may not overlap in time, across all branches. FULL_DAY conflicts with any
  other occurrence that day. This is serialized by locking the employee `users` row (the
  same approach as leave; no `btree_gist`). A partial unique index
  `(employee_user_id, branch_id, work_date) WHERE status='SCHEDULED' AND mode='FULL_DAY'`
  adds a SQL backstop.
- **Past dates:** allowed, to record work already done, with a required reason. Owner
  decision Q8: allow for managers, or Owner-only like classification backdating.
- **Edit:**
  - allowed changes: time/mode, pay and note, with `expectedVersion` and a required
    reason;
  - the branch is fixed; cancel and recreate instead;
  - editing a CANCELLED row is refused;
  - once payroll locking exists (later), locked periods become immutable.
- **Cancel:** sets `status=CANCELLED` with a reason and version check. It is not
  reversible; recreate instead.
- **Audit:** every create, edit and cancel appends `audit_events`:
  - actions `COLLABORATOR_WORK_SCHEDULED`, `_CHANGED` and `_CANCELLED`, with
    before/after snapshots of the date, mode, times, branch, pay and status;
  - data classification `EMPLOYEE_PAY`, because pay is included.
  - The audit trail is the change history; no second history table is needed.
- **Attendance** stays separate: check-in does **not** require a schedule. A later
  report can compare schedule vs attendance. Attendance never changes the agreed pay.

**Idempotency:**

- **Create:** no server idempotency key, consistent with existing commands. A
  double-submit is caught by the overlap rule (409) plus the UI single-flight guard.
- **Edit and cancel:** `expectedVersion`.

**Final Step 6 contracts** (implemented; these refine the proposal above, see the
[Step 6 report](EMPLOYEE_MANAGEMENT_FOLLOWUP_STEP6_COLLABORATOR_SCHEDULE_PAY.md)):

- **Times:** `start_minute`/`end_minute` SMALLINT minutes of the branch-local date, rather
  than TIME, matching the branch-hours model.
- **Pay:** `agreed_pay_vnd` is nullable (not agreed yet), so a scheduler without pay
  permission can schedule. Pay is added later with `MANAGE_EMPLOYEE_PAY`.
- **Edits:** the branch **can** be edited (the Owner request for Step 6), with pay authority
  at both branches when the occurrence is priced.
- **Reasons:** a reason is required for past dates and for cancellation.
- **Leaving COLLABORATOR:** ENDED **or promotion** cancels SCHEDULED work from the
  effective date on.
- **Permissions:** both `VIEW_WORK_SCHEDULE` and `MANAGE_WORK_SCHEDULE` were added (Q12).
- **Cost source:** the occurrence amount is the single source for future payroll and branch
  personnel cost. It is not depreciation.
- **Password rule:** the global password minimum is now 8 (Owner decision), applied to
  every account.

## 7. My Account: single source of truth

**My Account** ("Tài khoản của tôi", `/{locale}/workforce/account`) is a _projection_ of
the same `users` and `employee_profiles` rows that employee detail reads. It has no
copies and no sync. Any self-edit updates those rows, bumps `row_version` and appears in
employee detail immediately, and vice versa.

**Owner:** the Owner has no `EmployeeProfile`. Their My Account shows the user fields
only: name, email, phone if any, language, title "Chủ Spa", and security. There is no
date of birth, address, branches, skills or classification.

**New APIs:**

- `GET /api/v1/me/account`: the caller's own view. It shows:
  - identity: code, name, title and classification;
  - contact: phone, email + verified, date of birth, address, language;
  - work: branch assignments and skills;
  - account: status;
  - pay: base salary for self (Q9).
    No permission is needed beyond being the signed-in workforce user.
- `POST /api/v1/me/account/profile`: `{expectedVersion, fullName?, phone?, dateOfBirth?,
address?, locale?}`. It uses the same normalization as the management command (a
  shared service function, so the rules cannot diverge) and is audited as
  `PROFILE_UPDATED` with actor = self and field names only.
  - **Phone:** unique across all users, so a clash returns 409 `phone`. There is no SMS
    verification. Phone is not a workforce login identifier, so changing it has no auth
    effect (Q10).
- **Management side:** `POST /employees/:id/profile` gains `phone`, so employee detail can
  also correct it, with the same rules. Email changes go through the verified flow
  (section 8).

**Recovery email:** "Email khôi phục" moves from the dashboard into **My Account →
Tài khoản & bảo mật**. The same component and the same endpoints are reused. The dashboard
keeps a short warning link while the recovery email is unverified.

## 8. Email change and security

The email is a login identifier for the Owner and employees (email login) and the only
recovery channel. An unverified new email must never replace a verified one.

**Self-service change:** a new challenge purpose, `CHANGE_EMAIL`.

1. `POST /api/v1/me/email/request` `{newEmail}`:
   - needs a signed-in, freshly reauthenticated workforce session;
   - normalizes the address and checks uniqueness;
   - returns the neutral accepted shape;
   - stores a challenge bound to the user, `credentialVersion` and the **new address
     snapshot**, with the OTP sent **to the new address**;
   - also sends a notice to the old verified address, if any.
2. `POST /api/v1/me/email/verify` `{flowToken, otp}`, in one transaction:
   - re-checks uniqueness and the version;
   - sets `email_canonical`/`email_delivery` to the new address and
     `email_verified_at = now`;
   - retires open reset/recovery/change flows;
   - revokes the user's **other** sessions (the login identifier changed);
   - audits `EMAIL_CHANGED` with before/after verified flags (addresses redacted per the
     audit allowlist).

Until then the old email stays authoritative everywhere. My Account and employee detail
show the same row, so they always agree.

**Management-side email:**

- A manager may set an email only when the member has none or it is unverified. That keeps
  today's creation behaviour, and the new address remains unverified.
- If the current email is verified, a manager cannot replace it directly. The employee
  changes it through the verified flow.
- The Owner's email can only be changed by the Owner through this flow, or by the
  emergency CLI (password only; email unchanged).

**Self-service password change** (a gap today; the smallest secure design):

- `POST /api/v1/me/password` `{currentPassword, newPassword}`, workforce only; customer
  auth is unchanged.
- The current password is verified with the existing verifier. Failures count against the
  existing `REAUTH_FAILURE_USER` and IP budgets, returning a uniform 401.
- It applies the existing policy (15–128, NFC, blocklist) and Argon2id, and must differ
  from the current password.
- In one transaction:
  - new hash and `credentialVersion + 1`;
  - retire reset/setup/recovery/change flows;
  - revoke all **other** sessions;
  - rotate the current session so the user stays signed in (reuse the
    `rotateAuthenticated` pattern);
  - audit `PASSWORD_CHANGED` (method `SELF`, no material).

## 9. Self-editable vs management-only field matrix

| Field                                | Self (My Account)        | Management (employee detail)               | Notes                |
| ------------------------------------ | ------------------------ | ------------------------------------------ | -------------------- |
| Full name                            | ✏️ (Q11)                 | ✏️ `UPDATE_EMPLOYEES`                      | Same column          |
| Phone                                | ✏️                       | ✏️ `UPDATE_EMPLOYEES` (new)                | Unique; 409 on clash |
| Date of birth                        | ✏️                       | ✏️                                         |                      |
| Address                              | ✏️                       | ✏️                                         |                      |
| Language                             | ✏️                       | ✏️                                         |                      |
| Email                                | ✏️ verified flow only    | ✏️ only when absent or unverified          | Section 8            |
| Recovery email verification          | ✏️                       | —                                          | Self proof only      |
| Password                             | ✏️ with current password | Reset (existing, `MANAGE_EMPLOYEE_ACCESS`) |                      |
| Employee code / login ID             | 👁                        | 👁 (immutable)                              |                      |
| Display title, classification        | 👁                        | ✏️ `MANAGE_EMPLOYEE_PAY`                   |                      |
| Roles, manager status                | 👁                        | ✏️ `MANAGE_PERMISSIONS`                    |                      |
| Branch assignments                   | 👁                        | ✏️ `MANAGE_EMPLOYEE_SCOPE`                 |                      |
| Skills                               | 👁                        | ✏️ `MANAGE_SKILLS`                         |                      |
| Account status                       | 👁                        | ✏️ `MANAGE_EMPLOYEE_STATUS`                |                      |
| Base salary / compensation config    | 👁 own (Q9)               | ✏️ `MANAGE_EMPLOYEE_PAY`                   | `EMPLOYEE_PAY` data  |
| Collaborator schedule and agreed pay | 👁 own                    | ✏️ (section 11)                            |                      |

✏️ = editable, 👁 = read-only.

**Conflict to note:** phone is required for employees (`users_kind_credentials`) and
unique across customers too. A self-edit can collide with a customer's phone, and the
409 must not reveal who holds it (use the generic "already in use" message).

## 10. My Income: foundation vs explicit deferrals

**Can exist now ("Thu nhập của tôi"):**

- **Navigation:** the page exists, self only.
- **Collaborators:** day/week/month views of their own SCHEDULED occurrences and the
  **agreed pay** totals. They are clearly labelled "Thu nhập thỏa thuận theo lịch — chưa
  phải bảng lương" (agreed scheduled pay, not payroll).
- **Official employees:** their base salary, if Q9 is yes, labelled as configuration, not
  payable.
- **Everyone else:** an explicit "Chưa có dữ liệu thu nhập" (no income data yet) state.

**Explicitly deferred** (no fake numbers), until the source-of-truth modules exist:

- service revenue attribution;
- tour/service pay and commissions (Phase 3 booking + PRD tour and commission rules);
- tips;
- adjustments;
- payable/net amounts, pay periods, payslips and payroll locking;
- reconciliation of schedule vs attendance for pay.

**Visibility:**

- A user sees only their own income.
- Others' income needs `VIEW_EMPLOYEE_PAY` over the member's branches (existing).
- There is no new "view all income" permission until payroll exists.

**Final Step 7 contract** (implemented; see the
[Step 7 report](EMPLOYEE_MANAGEMENT_FOLLOWUP_STEP7_MY_INCOME.md)):

- **What it is:** `GET /api/v1/me/income?period=DAY|WEEK|MONTH&date`, a read model with no
  table or ledger.
- **Collaborator pay:** agreed pay of SCHEDULED occurrences by branch-local work date, with
  ISO weeks (Monday–Sunday). Null pay is counted as "unagreed", never 0.
- **Base salary:** official employees and managers see the configured monthly amount only.
  It is never prorated, and it has no effective-date history.
- **Other classifications:** a trainee gets nothing invented; the Owner has no source.
- **Future sources:** listed as unavailable, never as zeroes.
- **One source:** the same occurrence amount is referenced by future payroll and branch
  finance.

## 11. Authorization model

| Action                                    | Permission (scope = every branch of the member, unless noted)                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification changes incl. COLLABORATOR | `MANAGE_EMPLOYEE_PAY` (existing)                                                                                                                                        |
| Create member as COLLABORATOR             | `CREATE_EMPLOYEES` only (Q2)                                                                                                                                            |
| Assign manager-group role                 | `MANAGE_PERMISSIONS` + containment (existing) + **E1**                                                                                                                  |
| Collaborator schedule create/edit/cancel  | **New `MANAGE_WORK_SCHEDULE`** (branch-capable, at the occurrence's branch). Setting or changing `agreed_pay_vnd` also needs `MANAGE_EMPLOYEE_PAY` at that branch (Q12) |
| View schedules (without pay)              | New `VIEW_WORK_SCHEDULE` (branch-capable), or reuse `VIEW_ATTENDANCE` (Q12)                                                                                             |
| View agreed pay of others                 | `VIEW_EMPLOYEE_PAY` (existing)                                                                                                                                          |
| Own schedule, own pay, My Account         | Self; no permission                                                                                                                                                     |
| Self profile/email/password               | Self; fresh reauthentication for email change                                                                                                                           |

Non-Owners never schedule or change pay for themselves. The Owner is never a target.
Customers are unaffected.

## 12. Audit, concurrency and idempotency rules

- **Concurrency:** every write uses the existing command frame (locks, `expectedVersion`,
  409 on stale data, CONFLICT reload in the UI).
- **Audit:**
  - every change writes `audit_events`: actor, subject, branch, reason, and before/after
    per an allowlist;
  - pay-bearing events use `dataClassification = EMPLOYEE_PAY`;
  - there is never password or OTP material; email addresses are redacted per the
    existing allowlist.
- **SQL backstops:**
  - CHECKs for mode/time shape and non-negative pay;
  - the enum for status;
  - RESTRICT foreign keys;
  - no deletes (a trigger rejects DELETE, as for other history tables).
- **Idempotency:** creation relies on uniqueness/overlap rules and the UI single-flight
  guard; there are no new idempotency-key tables.

## 13. Phase 3 booking contract

A worker is **potentially bookable** for service S at branch B over the window [t0, t1)
on date D only if **all** of these hold. Phase 3 adds its own rules, such as existing
bookings and buffers.

1. `kind = EMPLOYEE`, account ACTIVE.
2. Classification on D ∈ {OFFICIAL_EMPLOYEE, COLLABORATOR}. TRAINEE: Owner decision Q13
   (default not bookable). ENDED is never bookable.
3. An active `EmployeeBranchAssignment` at B.
4. Skills: S's eligible skills ∩ the worker's active skills ≠ ∅ (existing rule).
5. No approved leave covering D.
6. B is open and [t0, t1) lies within its hours for D.
7. **COLLABORATOR only:** a SCHEDULED `collaborator_work_occurrence` at B on D whose
   [start, end) covers [t0, t1).
8. OFFICIAL_EMPLOYEE: rule 6 (branch hours), unless Phase 3 introduces employee shifts
   (out of scope).

Tables Phase 3 creates must reference `services`, `employee_profiles`, `branches` and
`collaborator_work_occurrences` with `ON DELETE RESTRICT`. The directory title is display
only; booking must never use role names or titles.

## 14. Proposed migrations, APIs and UI surfaces

**Migrations** (additive; each applied locally first and deployed after a verified
backup):

1. **M1** `employment_classification_collaborator`:
   - add the enum value `COLLABORATOR`;
   - replace `lucy_check_employment_classification()` with the new matrix.
   - Note: `ALTER TYPE … ADD VALUE` must commit before the value is used.
2. **M2** `collaborator_work_occurrences`: the table, enums `CollaboratorWorkMode` and
   `CollaboratorWorkStatus`, CHECKs, the partial unique index and a DELETE guard.
3. **M3** `auth_challenge_change_email`: add `CHANGE_EMAIL` to `AuthChallengePurpose`.
   Store the pending canonical address in the existing `delivery_email_snapshot`, or a new
   nullable column if the canonical form must be kept separately.
4. **M4** permissions: the catalog gains `MANAGE_WORK_SCHEDULE` (and
   `VIEW_WORK_SCHEDULE` if chosen). They are code-owned and synced by
   `db:permissions:sync`.

**APIs** (new, unless marked as a change):

- `/api/v1/me/account`: GET, and POST `/profile`.
- `/api/v1/me/email/request|verify`.
- `/api/v1/me/password`.
- `/api/v1/me/work-occurrences?from&to`: own schedule and agreed pay.
- `/api/v1/employees/:id/work-occurrences`: GET/POST, plus `/:occurrenceId` POST edit and
  `/:occurrenceId/cancel`.
- `/api/v1/work-occurrences?branchId&from&to`: branch schedule view.
- **Changed:**
  - classification commands accept COLLABORATOR;
  - `assignRole` and `updateRole` enforce E1/E2;
  - end/transition commands enforce E3/E4;
  - the profile command accepts `phone`;
  - directory, employee and `/auth/me` responses add `workforceTitle`.

**UI:**

- **Nav:** "Tài khoản của tôi" in the account area (top bar/menu) for every workforce user.
- **My Account tabs:**
  - Hồ sơ (profile);
  - Công việc (branches, skills, title: read-only);
  - Tài khoản & bảo mật (recovery email, email change, password change);
  - Thu nhập của tôi (income foundation).
- **Employee detail:** a CTV schedule panel for collaborators, and a title badge.
- **Directory:** title per row; "Quản lý" = title MANAGER.
- **Collaborator schedule page:** a per-branch calendar/list for schedulers.

## 15. Backward compatibility and production migration

- **Additive only:** existing rows keep their classification. No member becomes a
  COLLABORATOR automatically.
- **E1–E4 pre-check:** before enabling the manager invariant, list non-OFFICIAL holders of
  active manager-group roles. The deployment must stop if any exist, so the Owner decides.
- **Label changes** (Nhân viên, Đã nghỉ) are display-only; stored codes are unchanged.
- **Existing APIs:** `/auth/me`, directory and employee responses gain fields additively.
  Customer responses are unchanged.
- **Recovery email UI moves;** the endpoints are unchanged.
- **Deployment order:** backup → `db:deploy` (M1–M3) → `db:permissions:sync` (M4) →
  build → PM2 restart → grant the new schedule permission to manager roles in "Vai trò &
  quyền".

## 16. Risks and edge cases

- **Enum `ADD VALUE` in PostgreSQL** cannot be used in the same transaction that adds it.
  Keep M1's trigger replacement in a following migration, or order the statements
  carefully.
- **Effective dates vs today:**
  - a collaborator promoted to OFFICIAL on a future date stays schedulable until then;
  - a scheduled occurrence on a date after an ENDED effective date must be refused.
    Scheduling checks the classification on `work_date`. Existing future occurrences are
    auto-flagged but not deleted when ENDED is recorded (Q14: cancel them in the same
    transaction?).
- **Branch hours change after a FULL_DAY snapshot:** the snapshot keeps pay and history
  stable. Booking should use the snapshot intersected with the current hours (Q6).
- **Timezone:** `work_date` and times are branch-local; there are no overnight shifts.
- **A worker assigned to several branches** cannot be double-booked across branches on
  overlapping times (overlap is checked across branches).
- **Phone uniqueness** across customers: the 409 must not leak account existence.
- **Email change race:** uniqueness is re-checked at verify; the old address stays valid
  until then.
- **Manager removal ordering (E3)** could block an urgent termination; the UI must guide
  "remove manager role → end".
- **Owner:** never a target of any new command. My Account works without an
  `EmployeeProfile`.

## 17. Recommended implementation steps (small, in order)

1. **Step 2: COLLABORATOR classification.**
   - M1, transitions (TS + SQL), creation choice, labels, `workforceTitle` read-model and
     the directory title/grouping change;
   - E1–E4 manager invariant, with the production pre-check.
2. **Step 3: My Account read + self profile edit.**
   - `GET/POST /me/account`, the shared profile normalization, phone in the management
     command;
   - moving the recovery email into Account & Security.
3. **Step 4: Self-service password change** (`/me/password`).
4. **Step 5: Verified email change** (M3, `/me/email/*`, management email rule).
5. **Step 6: Collaborator work schedule and agreed pay** (M2, M4, APIs, schedule UI,
   audit).
6. **Step 7: My Income foundation** (own agreed-pay views, explicit deferral states).
7. Then Phase 3 booking planning, using the section 13 contract.

## Owner decisions (RESOLVED 2026-09-26; these override any earlier recommendation above)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | OFFICIAL_EMPLOYEE → COLLABORATOR: **not allowed.**                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Q2  | Selecting COLLABORATOR (at creation or as a classification change) needs **no pay permission by itself**. The employment/classification authorization stays as it is: `CREATE_EMPLOYEES` at creation, and the existing classification-change permission for changes. Entering or changing collaborator **agreed pay** requires the pay/compensation permission.                                                                                                                                 |
| Q3  | Ending or changing an OFFICIAL_EMPLOYEE who holds an active manager-group role: **REFUSE**. The management role must be removed first; a manager role is never removed silently.                                                                                                                                                                                                                                                                                                                |
| Q4  | Future employment start displays **"Chưa bắt đầu / Not started"**.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Q5  | **Four mutually exclusive directory sections**: Quản lý / Managers, Nhân viên / Employees, CTV / Collaborators, Học viên / Trainees. Each person appears in exactly one. Precedence: OFFICIAL + active manager-group role → Managers; OFFICIAL → Employees; COLLABORATOR → Collaborators; TRAINEE → Trainees. ENDED and not-yet-started people keep the existing status/filter behaviour without duplicates. The Owner is not in the directory. Each section keeps real server-side pagination. |
| Q6  | FULL_DAY **snapshots** the branch business-hours window at creation. Later branch-hour edits never rewrite an agreed occurrence.                                                                                                                                                                                                                                                                                                                                                                |
| Q7  | A SHIFT outside branch opening hours is **blocked**, not just warned.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Q8  | Past-dated occurrences are allowed for Owner/authorized management with the permission, with a **required reason**, audited.                                                                                                                                                                                                                                                                                                                                                                    |
| Q9  | A person may **see their own compensation**. Others' compensation stays permission-controlled.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q10 | Self-service phone change is allowed **without OTP**, audited. Verification can be added if phone ever becomes an auth/recovery factor.                                                                                                                                                                                                                                                                                                                                                         |
| Q11 | Self-service name change is allowed, audited.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Q12 | Explicit collaborator-schedule management authorization, plus the pay/compensation permission for entering or changing agreed pay. Pay is never exposed just because someone can schedule.                                                                                                                                                                                                                                                                                                      |
| Q13 | Trainees are **not bookable** in Phase 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Q14 | COLLABORATOR → ENDED **cancels** that collaborator's future occurrences within the controlled transition. Records are kept (never deleted) and the cancellation is audited. This takes effect once the occurrences exist (Step 6).                                                                                                                                                                                                                                                              |
| Q15 | Collaborators **do not use Leave**; their work is governed by the schedule. The leave workflow is refused for collaborators.                                                                                                                                                                                                                                                                                                                                                                    |
| Q16 | Base salary is **refused for COLLABORATOR and TRAINEE**; it is for OFFICIAL_EMPLOYEE only.                                                                                                                                                                                                                                                                                                                                                                                                      |

**Additional confirmed rules:**

- A manager must be OFFICIAL_EMPLOYEE.
- A collaborator becomes a manager only through COLLABORATOR → OFFICIAL_EMPLOYEE → a
  manager-group role.
- Display titles:
  - Chủ Spa / Spa Owner;
  - Quản lý / Manager;
  - Nhân viên / Employee;
  - CTV / Collaborator;
  - Học viên / Trainee;
  - Chưa bắt đầu / Not started;
  - Đã nghỉ / Ended, for ENDED.
- My Account and employee detail share one authoritative profile, so changes on either
  surface are visible on the other immediately.
- Collaborator pay is manual per occurrence and never derived from hours or attendance;
  attendance and schedule/pay stay separate.
- Phase 3 must require a covering collaborator occurrence.
