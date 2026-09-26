# Pre-Phase-3 follow-up Step 7: My Income (Thu nhập của tôi) foundation

**Status:** implemented and tested locally. One focused commit, pushed to `origin/main`.
**Not deployed.** Production is at `1261871` (follow-up Step 6, deployed and accepted).
**No migration.**

## Purpose

"Thu nhập của tôi / My Income" lets a signed-in workforce member see their **own**
compensation information. The page is:

- read-only;
- derived only from authoritative sources that already exist;
- aware of the member's classification;
- explicit about where each amount comes from;
- free of double counting.

It is **not payroll**.

## Architecture

My Income is a **read model**. It creates no table, row or ledger. Each request computes
the result server-side from the existing rows and discards it.

| Layer    | Where                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API      | `GET /api/v1/me/income?period=DAY\|WEEK\|MONTH&date=YYYY-MM-DD`, served by `MyIncomeController` in `account/my-account.controller.ts`                      |
| Service  | `MyIncomeService` in `account/my-income.service.ts`, with the pure `incomePeriod` helper                                                                   |
| Contract | `MyIncomeResponse`, `IncomePeriod` and `UnavailableIncomeSource` in `@lucy-spa/contracts`                                                                  |
| Web      | Route `/{locale}/workforce/income`, `screens/my-income.tsx` and `lib/workforce/my-income.ts`; nav entry "Thu nhập của tôi" (Home, every workforce account) |

## Authoritative sources used

| Source                   | Table / column                                                                                                | Who                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Collaborator work pay    | `collaborator_work_occurrences` (Step 6): `agreed_pay_vnd`, `work_date`, `branch_id`, `mode`, times, `status` | Collaborators, plus historical CTV work |
| Base salary              | `employee_profiles.base_salary_vnd`: the configured current amount, monthly per the PRD payroll model         | Official employees, managers included   |
| Classification and title | `employment_classification_changes` (effective-dated) and the Step 2 title rule                               | Everyone                                |

**Base salary has no effective-date history** in the schema; changes are only audited. My
Income therefore shows "the monthly base salary currently configured" without an effective
date, and does not invent one.

Nothing else exists yet: no service/tour pay, commission, tips or adjustments.

## Behavior by classification

### COLLABORATOR

- A period total over **SCHEDULED** occurrences only, grouped by their branch-local
  `work_date`.
- **Tổng tiền công thỏa thuận** is the sum of agreed pay only, as an exact `bigint`.
- **Số buổi làm** counts all SCHEDULED occurrences in the period.
- **Chưa thỏa thuận tiền công** counts occurrences whose pay is still `null`. This line is
  shown only when the count is above zero.
- Details per occurrence: date, branch, Theo ca / Full ngày, hours and pay. Pay shows
  "Chưa thỏa thuận" when null, **never 0**.
- A per-branch breakdown appears when more than one branch is involved.
- The wording says "agreed pay". It never says "Đã nhận", "Thực nhận" or "Đã thanh toán":
  this amount is not settled, paid, net or attendance-adjusted, and the page says so.
- Future sources (service/tour pay, commission, tips, adjustments) are listed under
  **"Chưa có trong hệ thống"**, never as 0.

### OFFICIAL_EMPLOYEE, including managers

- **Lương cơ bản hiện tại**: the configured amount, shown with "/ tháng".
- "Chưa được cấu hình" appears when the salary is null, never 0.
- **No** day, week or month earnings, proration, daily or hourly figures, or
  attendance-based amounts. The same monthly figure appears whatever the period (tested).
- The future sources are listed as not yet available.
- A manager is OFFICIAL_EMPLOYEE plus a manager-group role, with the **same** semantics.
  There is no separate manager salary; only the title shows "Quản lý" (tested).

### TRAINEE

There is no source, so nothing is shown except an honest empty state: "Hiện chưa có nguồn
thu nhập nào…". No base salary and no zeroes (tested).

### OWNER

`kind: OWNER` with no employee profile, which is never created. There is no salary, just
the note "Tài khoản Chủ Spa không có nguồn thu nhập cá nhân nào được cấu hình trong mục
này." The endpoint and UI do not crash (tested).

### Classification changes and ENDED

- CTV work stays CTV work. For a CTV → OFFICIAL promotion, earlier occurrences and their
  agreed pay are returned **as recorded**, beside the current base salary (tested). Nothing
  is converted, rewritten or double counted.
- The collaborator section appears whenever the member is a collaborator today **or** the
  period contains collaborator work.
- **ENDED:** history stays readable while the account can still sign in. The access rules
  were not broadened.

## Periods

All periods use calendar dates.

| Period | Range                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------ |
| DAY    | The selected date                                                                                |
| WEEK   | **ISO: Monday–Sunday**. The project had no week convention; this is now it, and the UI states it |
| MONTH  | The calendar month                                                                               |

- The default is MONTH around the member's branch-local "today". The UI has Previous/Next
  and a date picker.
- Occurrences are grouped by their **branch-local `work_date`**, which is already a local
  calendar date. There is no UTC conversion, so nothing shifts between days or months.
- This is tested with a Tokyo branch: an occurrence on 31/10 counts in October and one on
  01/11 in November. A week that crosses the month boundary (28/09–04/10) is also tested.

## Multi-branch

Each item keeps its branch. The total aggregates every branch of the member's own work, and
`byBranch` gives the per-branch totals and counts. No finance ledger is created.

## Security, authorization and privacy

- **Identity** comes from the session only (`runAdminCommand`).
  - The query DTO accepts only `period` and `date`. `employeeId`, `userId` or any other
    parameter is rejected with 400 (HTTP test).
  - Anonymous callers get 401 and customers get 403 (tested).
- **Self data needs no permission**, and this grants no `VIEW_EMPLOYEE_PAY` or
  `MANAGE_EMPLOYEE_PAY`. There is no screen for viewing everyone's income.
- **Payloads** contain only the member's own rows. Tested: another collaborator's 999,000
  never appears.
- **Responses** carry the global `Cache-Control: no-store` (asserted in the HTTP test).
  Request logs never contain bodies.
- **No audit row per read.** This follows the existing convention for self reads such as
  `/auth/me` and `/me/account`. A test asserts that a read writes nothing: no occurrence
  rows, no audit rows, no ledger.

## No double counting: future Payroll and Finance contracts

- **One economic source.** Take a CTV occurrence at Lucy Spa Đà Nẵng on 27/09/2026, FULL_DAY,
  150,000 VND.
  - My Income **displays** 150,000.
  - Future payroll will **reference** the same occurrence and its 150,000.
  - Future branch finance will **classify** the same 150,000 as a personnel/operating cost of
    that branch.
  - These are three views of **one** amount, never three costs.
- **Payroll** must consume `collaborator_work_occurrences` (and the base salary) by
  reference. Settlement, paid state, net pay, deductions and adjustments belong to payroll,
  not to this read model.
- **Finance:** CTV agreed pay is a **personnel/operating cost** of the occurrence's branch.
  It is **not depreciation**. Both may appear in future reports as separate categories. This
  step implements neither ledger.
- **Attendance** never changes CTV income: there is no hours × rate, no lateness or
  early-leave deduction, and no recalculation (tested with a check-in).

## UI

- **Thu nhập của tôi** has [Ngày] [Tuần] [Tháng] buttons (`aria-pressed`), a date picker,
  Previous/Next, and the selected range, with the week convention shown for Tuần.
- **CTV section:** the total of agreed pay, the occurrence count, the unagreed count when
  above zero, an explanation note, the per-branch breakdown when there are several branches,
  and the detail table.
- **Official / manager section:** Lương cơ bản hiện tại "x.xxx.xxx ₫ / tháng" with its
  meaning.
- **"Chưa có trong hệ thống"** lists the future sources by name.
- **Empty states** exist for a trainee and for the Owner.
- Everything is in VI and EN. There is no redesign; My Account keeps the Step 6 schedule
  view and reads the **same** occurrence rows, with no duplicate storage.

## Tests and checks

| Check                                                                                               | Result                                   |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| New `account/my-income.integration.test.ts`                                                         | 7/7 subtests pass                        |
| New `account/my-income.http.test.ts` (no identifier or unknown query, `no-store`, session identity) | pass                                     |
| API auth/workforce integration, all suites (Step 6 schedule and auth included)                      | 212/212 pass                             |
| API unit + HTTP                                                                                     | 92 pass, 0 fail (30 integration skipped) |
| Database integration                                                                                | 31/31 pass                               |
| Web, including the new `my-income.test.tsx`                                                         | 109/109 pass                             |
| `pnpm lint` (ESLint + boundaries), `pnpm format:check`, `tsc --noEmit` (api, web)                   | pass                                     |

The integration subtests map to the required cases:

| Cases         | Coverage                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1, 9, 13–19   | Day totals; null pay is never 0 and never in the total; unagreed count                                                              |
| 10, 12, 14–16 | ISO week from any anchor in it; next week; a week across a month boundary; branch breakdown; cancelled excluded                     |
| 11, 13        | Months by branch-local date, including a Tokyo branch at a month edge                                                               |
| 2, 20, 23, 25 | Own data only; a read writes nothing; attendance changes nothing; default period                                                    |
| 6–8, 24       | Official salary; a salary never prorated; a manager has the same semantics; an unset salary; a trainee gets nothing; no zero fields |
| 21–22         | CTV → OFFICIAL keeps earlier CTV pay unchanged                                                                                      |
| 3–5           | Anonymous and customers refused; invalid period; the Owner without a profile                                                        |

The web tests cover case 26 (VI/EN), wording without payment terms, no `0 ₫`, the empty
states, the nav entry, and a request carrying only period and date. Cases 27–28 are covered
by the full suites.

`pnpm typecheck` was not run, because it regenerates `apps/web/next-env.d.ts`. The file's
hash was confirmed unchanged (`a419cbe…`).

## Database and migration status

No migration and no new index. The query uses the existing
`collaborator_work_employee_date_idx` (`employee_user_id, work_date, status`) and is bounded
to one period (at most 31 days).

## Explicit deferrals

None of the following were implemented:

- payroll runs, periods, locking, settlement, paid/unpaid state, payment dates, net pay, tax,
  insurance, deductions (attendance or other), overtime;
- service/tour pay, commission, tips, the adjustments ledger;
- payroll approval and export;
- finance and expense journals, P&L, depreciation, cash disbursement;
- a management "everyone's income" view;
- base-salary effective-date history (a schema decision for payroll);
- booking, and the UX/UI redesign.

## Production deployment (not performed; requires Owner authorization)

There is **no migration**.

1. Take a routine backup.
2. `git pull` (`1261871..<Step 7 commit>`), then `pnpm install --frozen-lockfile`.
3. `pnpm build`, then restart `lucyspa-api`, `lucyspa-web` and `lucyspa-worker`.
4. Smoke checks:
   - A CTV opens Thu nhập của tôi: Ngày, Tuần and Tháng show the agreed-pay totals and
     details, and an unagreed occurrence shows "Chưa thỏa thuận".
   - An official employee sees Lương cơ bản hiện tại / tháng.
   - A trainee and the Owner see empty states.
   - No page shows 0 for tour, commission or tips.

## Recommended next step

The pre-Phase-3 follow-up (Steps 1–7) is complete once this is deployed. The next step is
**Phase 3 booking planning and design**, using:

- the collaborator availability contract (Step 6, A14);
- the design's section 13 booking contract.

Payroll and finance remain separate later modules. They must reference the same source rows
(A6 and the contracts above).
