# Pre-Phase-3 follow-up Step 6: collaborator work schedule, agreed pay, and a global 8-character password minimum

**Status:** implemented and tested locally. One focused commit, pushed to `origin/main`.
**Not deployed.** Production is at `6a69d6b` (follow-up Step 5, deployed and accepted).

This step has two separate scopes:

- **A.** Collaborator (CTV) work schedule and agreed pay.
- **B.** A global password rule of 8–128 characters.

It also carries one small **hardening fix** to the Step 5 migration (see A2).

---

## A. Collaborator work schedule and agreed pay

### A1. Domain model

The new table `collaborator_work_occurrences` (Prisma `CollaboratorWorkOccurrence`) holds
**one authoritative row per work occurrence**.

| Column                                                  | Meaning                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                                                    | uuid                                                                                   |
| `employee_user_id` → `employee_profiles`                | The collaborator (RESTRICT)                                                            |
| `branch_id` → `branches`                                | The branch where the work happens **and where its cost belongs** (RESTRICT)            |
| `work_date` DATE                                        | Branch-local business date                                                             |
| `mode` `SHIFT` \| `FULL_DAY`                            | Theo ca / Full ngày                                                                    |
| `start_minute`, `end_minute` SMALLINT                   | Minutes of the work date, `0 ≤ start < end ≤ 1440` (no overnight). FULL_DAY = snapshot |
| `agreed_pay_vnd` BIGINT NULL                            | Tiền công thỏa thuận: integer VND, entered by hand; null = not agreed yet              |
| `status` `SCHEDULED` \| `CANCELLED`                     | Rows are never deleted                                                                 |
| `note`                                                  | Optional                                                                               |
| `created_by_user_id`, `created_at`                      | Immutable                                                                              |
| `updated_by_user_id`, `updated_at`                      | Last change                                                                            |
| `cancelled_by_user_id`, `cancelled_at`, `cancel_reason` | Set together on cancellation                                                           |
| `row_version`                                           | Optimistic concurrency (`expectedVersion`)                                             |

Money is a BIGINT in integer VND, carried as a decimal string in the API. There are no
floats, as with `base_salary_vnd`.

History is the audit trail. Every create, edit and cancel appends an `audit_events` row
(`COLLABORATOR_WORK_SCHEDULED`, `_CHANGED`, `_CANCELLED`) with a before/after snapshot of
branch, date, mode, times, pay and status. These are classified `EMPLOYEE_PAY` because they
include pay.

### A2. Migrations

All migrations are additive; no historical migration was edited.

| Migration                                      | Change                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `20261004000000_work_schedule_permissions`     | `PermissionCode` gains `VIEW_WORK_SCHEDULE` and `MANAGE_WORK_SCHEDULE` (enum values only; rows come from `pnpm db:permissions:sync`) |
| `20261004000001_collaborator_work_occurrences` | The enums and table, with RESTRICT FKs and indexes (see below)                                                                       |

The table migration also adds:

- **SQL CHECKs:** minutes in range with `start < end`; pay ≥ 0; the cancellation fields
  set exactly when status is CANCELLED, with a non-blank reason; version > 0.
- **A partial unique index:** a SCHEDULED FULL_DAY is the collaborator's only work that
  date.
- **A guard trigger:**
  - no DELETE;
  - identity and creation fields are immutable;
  - a cancelled row is final;
  - every change bumps the version by exactly one;
  - new rows start SCHEDULED at version 1.
- **Function hardening:** a fixed `search_path` and no PUBLIC execute (the Phase 1
  convention) for the new trigger function.

**Hardening fix.** The Step 5 `CREATE OR REPLACE FUNCTION lucy_guard_auth_challenge()`
dropped that function's pinned `search_path`, because Postgres resets it on replace.
PUBLIC execute had stayed revoked. The same statement restores the setting; the function
body is unchanged. This was verified on the local database.

`prisma migrate diff` is empty after applying locally.

### A3. SHIFT (Theo ca)

A SHIFT needs a work date, branch, start and end time, and optionally the agreed pay (see
A5). The rules:

- `start < end`, so a zero-length or reversed shift is 400 `endTime`.
- The shift must lie completely inside the branch's opening window **for that date** (its
  weekday hours; times are branch-local). Otherwise it is **blocked** with 409
  `branchHours`, not just warned.
- A closed day gets 409 `branchClosed`.
- No overlap with the collaborator's other SCHEDULED work that date **at any branch**
  (409 `overlap`). Adjacent shifts are fine. Checks are serialized by locking the
  collaborator's user row.

### A4. FULL_DAY (Full ngày) snapshot

- When scheduled, the occurrence **copies** the branch hours of that date into its own
  `start_minute`/`end_minute`. For example, branch hours 09:00–21:00 give an occurrence of
  09:00–21:00.
- Later branch-hour changes **never** rewrite it. This is tested: the hours were changed to
  10:00–20:00 and the occurrence stayed 09:00–21:00.
- A pay-only or note-only edit keeps the snapshot.
- Changing the date, branch or mode is a new agreement, so the hours are re-snapshotted.
- On a closed day, creation is refused (409 `branchClosed`).
- A FULL_DAY conflicts with any other work of the collaborator that date.

### A5. Agreed pay (Tiền công thỏa thuận)

- The amount is **entered by hand** per occurrence and stored exactly as entered (tested:
  80,000 → `80000`).
- There is **no hours × rate calculation anywhere**: not in the API, the database or the UI.
- **Attendance never changes it** (tested: a check-in leaves the pay unchanged).
- Changing it is an explicit, authorized, audited edit with before/after pay.
- `null` means "not agreed yet". A scheduler without pay permission can create an
  occurrence, and someone with pay permission adds the pay later. In the UI it shows as
  "Chưa nhập".

### A6. Future payroll and finance: one source of truth

- `agreed_pay_vnd` on the occurrence is **the single economic source amount** for that work.
- Future payroll (collaborator compensation) and future branch finance (personnel cost,
  profitability) must **reference this row** (`collaborator_work_occurrences.id`) and read
  its amount. They must never copy the amount into a second stored figure. For example, a
  150,000 VND occurrence is **one** cost, displayed by both, never 150,000 + 150,000.
- **Cost attribution:** the authoritative `branch_id` is the branch the cost belongs to.
  Moving a priced occurrence to another branch moves its cost, so that edit requires pay
  authority at both branches.
- **Accounting category:** collaborator agreed pay is a **personnel / operating cost**. It is
  **not depreciation**. Future reporting may show both, as separate categories.
- **Cancelled occurrences** keep their amount as history. Whether a cancelled occurrence is
  payable is a later payroll decision; by default, only SCHEDULED occurrences represent work.
- Nothing in payroll, journals, expenses, depreciation or P&L was built.

### A7. Permissions and pay visibility

| Action                                                          | Requirement                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Create, edit, cancel an occurrence                              | **`MANAGE_WORK_SCHEDULE`** at the occurrence's branch (both branches when moving) |
| Set or change agreed pay (including moving a priced occurrence) | **also `MANAGE_EMPLOYEE_PAY`** at the branch or branches                          |
| View schedules                                                  | **`VIEW_WORK_SCHEDULE`** or `MANAGE_WORK_SCHEDULE` at the branch                  |
| See others' agreed pay                                          | `VIEW_EMPLOYEE_PAY` or `MANAGE_EMPLOYEE_PAY` at the branch (existing permissions) |
| Own schedule and own pay (My Account)                           | Self; no permission                                                               |

Notes:

- **New permissions:** `VIEW_WORK_SCHEDULE` and `MANAGE_WORK_SCHEDULE` are branch-capable
  and STANDARD, so scheduling never implies pay. The existing pay permissions were reused
  for pay rather than inventing new ones.
- **Owner:** always authorized, and works without an employee profile (tested).
- **Self-scheduling:** a non-Owner never schedules, edits or cancels their own work.
- **Branch scope:** unchanged.
- **Pay in responses:** omitted entirely (the key is absent) for a caller without pay
  visibility.

### A8–A10. Editing, past dates, cancellation

- **Edit** (`POST /collaborator-work/:id`) can change branch, date, mode, SHIFT times, pay
  and note.
  - Every rule is re-checked: classification on the new date, assignment, branch hours and
    overlap (excluding the occurrence itself).
  - It uses `expectedVersion`; a stale version is 409.
  - A CANCELLED occurrence cannot be edited.
  - Each edit is audited with before/after.
- **Past dates** (before the branch-local today) are allowed for authorized management
  (Owner decision Q8) but **require a reason** (400 `reason`). This applies to create, and
  to edits where the old or the new date is past. The reason is audited.
- **Cancel** (`POST /collaborator-work/:id/cancel`) requires a reason and `expectedVersion`.
  - The row stays, with who and when recorded, and is audited.
  - The database refuses deletes and the un-cancelling of a row (tested).
  - A cancelled occurrence no longer counts for the Phase 3 contract below.

### A11. COLLABORATOR → ENDED

In the same transaction as the classification change (`appendClassification`, which both
end-employment paths use), every SCHEDULED occurrence **on or after** the ENDED effective
date is cancelled:

- the classification's reason becomes the cancel reason;
- one `COLLABORATOR_WORK_CANCELLED` audit is written per occurrence, with cause
  `EMPLOYMENT_CLASSIFICATION_CHANGED`;
- the rows are kept.

Earlier and historical occurrences are untouched (tested). The same applies to a
COLLABORATOR → OFFICIAL_EMPLOYEE promotion, because an occurrence may only exist while the
person is COLLABORATOR on that date.

### A12–A13. Leave and attendance

- **Leave:** collaborators still cannot use Leave (the Step 2 rule, re-tested). Their
  availability is the occurrences: no occurrence means not scheduled.
- **Attendance:** unchanged and separate. The schedule records what was planned and agreed;
  attendance records what happened. Neither rewrites the other, and attendance never touches
  agreed pay.

### A14. Phase 3 booking contract

This is a read-only helper, `collaboratorWorkCovering(tx, { employeeUserId, branchId,
workDate, startMinute, endMinute })`, in
`apps/api/src/collaborator-work/collaborator-work.rules.ts`.

It returns the SCHEDULED occurrence of that collaborator **at that branch on that date**
that **covers the whole window**, or null.

- SHIFT uses its explicit times; FULL_DAY uses its **snapshot**.
- Other branches and partial coverage return null (tested).

Phase 3 must additionally check:

- employment on the date;
- the branch assignment;
- skills;
- account state;
- booking overlap;
- its own rules.

Standing rules:

- **TRAINEE** stays not bookable.
- **OFFICIAL_EMPLOYEE** needs no occurrences (branch hours apply).
- Phase 3 tables must reference `collaborator_work_occurrences` with `ON DELETE RESTRICT`.

### A15. Management UI: "Lịch làm CTV / Collaborator schedule"

The route is `/{locale}/workforce/collaborator-schedule`, shown in the menu to holders of
either schedule permission.

- **Period and branch filters.**
- **Table columns:** CTV (name and code), ngày làm, chi nhánh, hình thức (Theo ca / Full
  ngày), giờ làm, **Tiền công thỏa thuận**, trạng thái, and the actions allowed by
  permission.
  - Pay shows "—" when hidden and "Chưa nhập" when not agreed.
  - Amounts are formatted as VND, e.g. `80.000 ₫`.
- **"Xếp lịch CTV" form:**
  - chi nhánh and ngày làm, which load the CTVs who can be scheduled that day plus the
    branch hours;
  - CTV select;
  - Hình thức radios;
  - Bắt đầu and Kết thúc for Theo ca;
  - **for Full ngày, the snapshot window is shown before confirming**;
  - Tiền công thỏa thuận (only with pay permission; otherwise a note);
  - Ghi chú, and Lý do (required for past dates).
- **Row actions:** edit and cancel with a reason.
- There is **no hourly-rate calculator**.
- The rest of the workforce UI is not redesigned.

### A16. My Account: CTV view

For a signed-in collaborator, My Account shows **"Lịch làm việc / Work schedule"**:

- their own occurrences, from one week back to eight weeks ahead;
- **their own agreed pay**;
- read-only, with no inputs.

It is not payroll and not an income total. Other users see no such section, and nobody sees
another collaborator's pay here (`GET /me/collaborator-work` returns only the caller's
rows).

### API

| Endpoint                                                                 | Purpose                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `GET /api/v1/collaborator-work?from&to[&branchId][&employeeId][&status]` | Up to 62 days, scoped to the caller's schedule branches    |
| `GET /api/v1/collaborator-work/options?branchId&workDate`                | Branch hours and schedulable CTVs (`MANAGE_WORK_SCHEDULE`) |
| `POST /api/v1/collaborator-work`                                         | Create (201)                                               |
| `POST /api/v1/collaborator-work/:id`                                     | Edit                                                       |
| `POST /api/v1/collaborator-work/:id/cancel`                              | Cancel                                                     |
| `GET /api/v1/me/collaborator-work?from&to`                               | Own occurrences, with own pay                              |

Every command is protected by CSRF and exact-Origin checks. The DTOs are strict: pay must
be an integer-VND **string** (a number, a decimal, a negative, `hourlyRateVnd` or `hours`
is rejected with 400).

---

## B. Global password policy: 8–128 characters

### B1–B2. One rule for every account and every flow

`PASSWORD_POLICY` (`apps/api/src/auth/password.service.ts`) is now
`{ minCodePoints: 8, maxCodePoints: 128 }` (was 15). Every password-setting path already
went through this one policy (`normalizePassword` / `validatePasswordForSetting` /
`hashForSetting`), so all of them changed together:

| Flow                                                | Where                                                    | Tested                                  |
| --------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| Workforce initial credential (create with password) | `EmployeeService.create`                                 | 7 refused, 8 accepted and signs in      |
| Management credential reset                         | `EmployeeService.setCredentials`                         | 7 and 129 refused, 8 and 128 accepted   |
| Setup / activation                                  | `EmployeeSetupService.complete`                          | 7 refused, 8 accepted                   |
| Change Password (My Account)                        | `LoginService.changePassword`                            | 7 and `12345678` refused, 8 accepted    |
| Workforce forgot/reset password                     | `PasswordResetService.complete`                          | 7 refused, 8 accepted and signs in      |
| Owner bootstrap / Owner password reset CLIs         | `validatePasswordForSetting`                             | Messages say 8–128                      |
| Customer registration                               | `RegistrationService.register` → `normalizeRegistration` | 7 refused, 8 accepted, verify, signs in |
| Customer forgot/reset password                      | `PasswordResetService.complete`                          | 7 refused, 8 accepted and signs in      |

There is no customer change-password or customer UI yet; customers are API only. No
separate customer minimum exists.

**The database has no password-length constraint**, only the hash shape, so no migration
was needed for Part B.

### B3. Other protections preserved, and the blocklist fixed

These are unchanged:

- Argon2id and its parameters;
- NFC normalization with no trimming;
- rate limits;
- current-password proof;
- reset security;
- session revocation and rotation;
- CSRF and Origin checks;
- `credentialVersion`;
- audit rules.

No password is stored or logged in clear.

**The common-password blocklist had to be regenerated.** The previous snapshot kept only
source entries of 15 or more code points (72 fingerprints), because shorter ones already
failed the length rule. Lowering the minimum without regenerating would have **silently
allowed** `password`, `12345678` and similar.

- The blocklist was regenerated from the **same pinned SecLists source**, with its checksum
  verified by the existing generator. It now keeps **8–128 code points: 39,329
  fingerprints**.
- `generate.mjs` and `README.md` were updated to match.
- The generated module is about 2.7 MB. It is API-side only, never in the web bundle.
- Tested: `12345678`, `password` and `123456789987654321` are refused.

### B4. Frontend, contracts and messages

- `PASSWORD_LENGTH` (web) is now `{ min: 8, max: 128 }`.
- The two hard-coded `minLength={15}` (Change Password, Forgot Password) now use it.
- Every VI/EN hint and error says 8.
- The OpenAPI descriptions and the contracts comment were updated.
- The PRD's password line and the Phase 1 security design note record the Owner decision.
- A web test asserts that no dictionary text still says 15 characters in any form.

### B5. Existing passwords

Nothing is forced. Existing hashes stay valid, and there is no rehash for this rule. The
blocklist still applies only when a password is set.

---

## Tests and checks

| Check                                                                                          | Result                                   |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| New `collaborator-work/collaborator-work.integration.test.ts`                                  | 9/9 subtests pass                        |
| New `collaborator-work/collaborator-work.http.test.ts` (CSRF/Origin, strict DTOs, VND strings) | pass                                     |
| New `auth/password-policy.integration.test.ts` (all password flows at 7 / 8 / 128 / 129)       | 5/5 subtests pass                        |
| `auth/password.test.ts` (boundaries, blocklist at 8+)                                          | 8/8 pass                                 |
| API auth/workforce integration, all suites                                                     | 204/204 pass                             |
| API unit + HTTP                                                                                | 91 pass, 0 fail (29 integration skipped) |
| Database integration                                                                           | 31/31 pass                               |
| Web, including the new `collaborator-work.test.tsx` and password assertions                    | 104/104 pass                             |
| `pnpm lint` (ESLint + boundaries), `pnpm format:check`, `tsc --noEmit` (api, web)              | pass                                     |

The collaborator subtests map to the required cases:

| Cases     | Coverage                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------- |
| 1, 12, 15 | A SHIFT is created with exact pay                                                                        |
| 2–4, 6    | FULL_DAY snapshot; later hours change and a pay-only edit keep it; closed day refused                    |
| 5, 7–9    | Outside hours, zero-length and reversed shifts; same-branch and cross-branch overlap                     |
| 10–11, 26 | OFFICIAL, TRAINEE and Owner targets refused; no assignment; never self; the Owner acts without a profile |
| 14–15, 24 | Scheduler cannot set or change pay, or move a priced occurrence; pay manager can; stale version          |
| 13, 25    | Attendance leaves pay unchanged; the Phase 3 read contract                                               |
| 16–17     | Past dates need a reason; cancel keeps the row and history; the database refuses delete and un-cancel    |
| 20–23     | Leave refused; CTV sees own occurrences and pay only; viewer and pay manager scoping                     |
| 18–19     | ENDED cancels future occurrences only, atomically, audited                                               |

Existing tests were updated for the new facts: the catalog has 19 codes instead of 17, the
"weak" example passwords are now 7 characters, and the nav includes the schedule. The
isolated Phase 2 schema test checks only the Phase 2 codes.

`pnpm typecheck` was not run, because it regenerates `apps/web/next-env.d.ts`. The file's
hash was confirmed unchanged (`a419cbe…`).

## Explicit deferrals

None of the following were implemented: full payroll, base-salary calculation, service or
tour compensation, commission, tips, payroll settlement or payment, paid/unpaid state,
financial journals, expense UI, depreciation, branch P&L, My Income totals, booking, and the
UX/UI redesign.

Also deferred:

- per-date branch-hour exceptions (holidays); hours are per weekday today;
- recurring schedules;
- a schedule-vs-attendance report;
- payroll locking of past occurrences.

## Production deployment (not performed; requires Owner authorization)

1. Take a database backup.
2. `git pull` (`6a69d6b..<Step 6 commit>`), then `pnpm install --frozen-lockfile`.
3. `pnpm db:deploy`. Two new migrations are expected:
   - `20261004000000_work_schedule_permissions`;
   - `20261004000001_collaborator_work_occurrences`.
     The running `6a69d6b` stays compatible until the restart.
4. **`pnpm db:permissions:sync`** inserts the `VIEW_WORK_SCHEDULE` and
   `MANAGE_WORK_SCHEDULE` catalog rows. Until they are synced, no role can be granted the
   new codes, so only the Owner (who holds every permission) can use the schedule.
5. `pnpm build`, then restart `lucyspa-api`, `lucyspa-web` and `lucyspa-worker`.
6. Grant the new permissions to roles as the Owner decides, for example branch managers
   `MANAGE_WORK_SCHEDULE` and `VIEW_WORK_SCHEDULE`, with pay permissions only where intended.
7. Smoke checks:
   - As Owner, open Lịch làm CTV and schedule a CTV Theo ca and a Full ngày, with pay.
   - Try an out-of-hours shift and an overlapping shift; both are refused.
   - The CTV sees them in My Account → Lịch làm việc.
   - A new password of 8 characters is accepted; `12345678` is refused.
   - Existing passwords still sign in.

## Next step

Step 7 is the **My Income foundation**: a read model over the authoritative sources (base
salary for official employees, collaborator occurrences and their agreed pay) with the
explicit deferral states from design section 10. It must reference, never duplicate, the
occurrence amounts (A6).
