# Employee management Step 3: employee detail and employment lifecycle UI

**Status:** implemented and tested locally. Committed on its own as `feat: add employee
detail lifecycle UI`, on top of `9adfb14`, `7a516ed` and `bacc0f9`. **Not pushed, not
deployed.** Production is still at `13f540e`.

**Scope:** web only. No backend command, migration or API contract changed; the only
backend edit is an extra test assertion. The detail screen connects the existing commands.

## What was implemented

`/{locale}/workforce/employees/{id}` (opened from Workforce › Employees, "Chi tiết") now
shows:

1. **Header:**
   - the full name and employee code;
   - two separately labelled badges, "Phân loại: …" (employment classification) and
     "Trạng thái tài khoản: …" (account status). The two concepts are never merged.
2. **Hồ sơ / Profile:**
   - the employee code as "Mã nhân viên (mã đăng nhập)", read-only with "Dùng để đăng
     nhập; không thay đổi được.";
   - full name, phone, email (marked "chưa xác minh" when unverified), date of birth,
     address and language;
   - a "Sửa hồ sơ" form.
3. **Phân loại nhân sự / Employment:**
   - the current classification, "Hiệu lực từ", and "Được tính lương hôm nay";
   - notices for changes recorded ahead of time;
   - an ended-employment notice;
   - the classification history table (newest first, with reason and recording time in
     the branch timezone);
   - the promotion and end-employment actions.
4. **Tài khoản đăng nhập / Sign-in account:**
   - the login ID, and the status badge with an explanation;
   - "Đặt lại mật khẩu" (or "Cấp mật khẩu đăng nhập" for PENDING_SETUP);
   - "Vô hiệu hóa đăng nhập" / "Kích hoạt lại đăng nhập".
5. **Phân công chi nhánh:** the existing Phase 2 Step 6 section, unchanged.
6. **Kỹ năng:** the existing Phase 2 Step 5 section, unchanged. No new skill UI was added.

The actions are collapsible (`details`) panels in the existing workforce style. VI and EN
are complete. Facts stack on screens narrower than 560 px (new `.wf-facts` layout);
checked at 375 px and 1000 px.

## APIs used (all existing)

| Action                    | API                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Load employee             | `GET /api/v1/employees/:id`                                                                                           |
| Load classification       | `GET /api/v1/employees/:id/employment` (Step 1)                                                                       |
| Edit profile              | `POST /api/v1/employees/:id/profile`                                                                                  |
| Promote                   | `POST /api/v1/employees/:id/employment` (Step 1)                                                                      |
| End employment            | `POST /api/v1/employees/:id/end-employment` (`9adfb14`)                                                               |
| Set/reset password        | `POST /api/v1/employees/:id/credentials` (`9adfb14`), with `useReauthentication` / `withReauthentication` (`9adfb14`) |
| Disable/re-enable sign-in | `POST /api/v1/employees/:id/status`                                                                                   |
| Branch assignments        | `GET/POST /api/v1/employees/:id/branch-assignments`, `…/:branchId/revoke` (Phase 2 Step 6)                            |

Every command sends `expectedVersion`. A 409 reloads the employee and the classification,
using the existing `runMutation` behaviour.

## Profile editing

- The existing profile command supports **full name, date of birth, address and language
  only**, so those are the only editable fields.
- `profilePatch` sends only the fields that changed, plus `expectedVersion`. If nothing
  changed it sends nothing and says "Không có thay đổi nào để lưu."
- The employee code, phone and email are shown read-only with the note "Mã nhân viên, số
  điện thoại và email không sửa được ở đây."
- No new editable field and no username were added.

## Classification lifecycle

- **Values:** exactly TRAINEE, OFFICIAL_EMPLOYEE and ENDED. No role names appear as
  classifications.
- **Current classification:** the one in effect on the business date the API returns
  (`today`), or "Chưa bắt đầu làm việc" before the start date.
- **Future entries:** shown as "Đã ghi nhận trước: {label} từ {date}."
- **Promotion ("Chuyển thành nhân viên chính thức"):**
  - offered only when the latest recorded classification is TRAINEE;
  - asks for the effective date (default: today) and a reason (always required by the API);
  - a date before today shows "Chỉ chủ spa được ghi nhận ngày trước hôm nay." for
    non-Owners and cannot be submitted (the API also refuses);
  - only the classification changes. The integration test now asserts that account status,
    password, credential/authorization versions, employee code, branch assignments, roles,
    overrides and skills are identical before and after a promotion;
  - on success, the employee and the history reload and a section-level notice confirms
    it.
- **Transitions:** invalid ones are never offered. After OFFICIAL_EMPLOYEE there is no
  promotion; after an ENDED entry (current or future) there is neither promotion nor
  ending.

## Password set/reset

- **Form:** new password, confirmation and reason, with the hint "Ít nhất 15 ký tự; có thể
  dùng một cụm từ dễ nhớ." (`minLength` 15). The hint text says the member signs in with
  their employee code, every session is signed out, and no OTP is needed.
- **Client checks:** length 15–128 code points and matching confirmation. The API still
  applies the full policy, and a refusal shows the policy message.
- **Sending:** uses the existing credential command. When the API requires fresh
  reauthentication, the existing dialog asks for the actor's own password and the request
  is resent once. Cancelling saves nothing.
- **After submit:** both password fields are cleared on every outcome. The password is
  never displayed, stored or logged.
- **Offered when:** the account is not INACTIVE and employment is not ENDED (the API
  enforces both). This includes PENDING_SETUP accounts, as "Cấp mật khẩu đăng nhập".

## End employment

- **Form:** effective date (default today), reason, and a "Vô hiệu hóa đăng nhập" checkbox.
  The checkbox is checked by default when the actor has `MANAGE_EMPLOYEE_STATUS`;
  otherwise it is disabled with an explanation.
- **Before confirmation**, the form states the exact consequence (`endingOutcome` mirrors
  the API):
  - today or earlier, with disabling: the account becomes "Đã nghỉ" and every session is
    signed out immediately;
  - already inactive / not requested: the corresponding message;
  - **future date:** "hệ thống chỉ ghi nhận lịch sử và KHÔNG tự động khóa đăng nhập vào
    ngày đó. Hãy vô hiệu hóa đăng nhập thủ công từ ngày kết thúc." There is no scheduler,
    and the UI never claims one.
- **Confirmation:** the red button "Xác nhận kết thúc làm việc". Afterwards the notice
  reflects the API's `access` result (for example `UNCHANGED_FUTURE_DATE` reminds the user
  to disable sign-in manually).
- **Nothing is deleted.** Only the existing command is called; there is no delete request.
- **After ENDED is in effect:** "Đã kết thúc làm việc từ {date}. …". No promotion, ending,
  password reset or re-enable controls are offered. "Vô hiệu hóa đăng nhập" stays
  available if access was deliberately kept.

## Account status

- PENDING_SETUP, ACTIVE and INACTIVE, shown with their existing labels plus a one-line
  explanation. No new status values.
- "Vô hiệu hóa đăng nhập" / "Kích hoạt lại đăng nhập" use the existing status command
  (reason required). Re-enabling is hidden while ENDED is in effect; the API refuses it
  anyway.

## Branch assignments

The existing section is reused unchanged:

- active assignments and revoked history, with times in the branch timezone;
- assign and revoke with a reason and `expectedVersion`, gated by
  `MANAGE_EMPLOYEE_SCOPE`;
- history is preserved (revocation sets `revokedAt`; the branch-assignment integration
  suite covers this).

## Authorization (UI hints; the API decides)

`detailActions` uses the existing `/auth/me` grants with the all-branch rule (`canAcross`
over every branch of the employee):

| Action              | Required                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Edit profile        | `UPDATE_EMPLOYEES`                                                                        |
| Promote / end       | `MANAGE_EMPLOYEE_PAY` (disabling access while ending also needs `MANAGE_EMPLOYEE_STATUS`) |
| Set/reset password  | `MANAGE_EMPLOYEE_ACCESS`                                                                  |
| Disable / re-enable | `MANAGE_EMPLOYEE_STATUS`                                                                  |
| Branches            | `MANAGE_EMPLOYEE_SCOPE` (existing)                                                        |

Non-Owners never get classification, credential or status actions on themselves. The
Owner is never an employee target. Denies win. Hidden controls are only hints: the backend
checks, containment, backdating and Owner protection are unchanged.

## Tests

- **Web: `apps/web/src/lib/workforce/employee-detail.test.tsx`, 8/8.** By requested point:

  | Points      | What is checked                                                                                                                                                                                                        |
  | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1–2, 15, 19 | Profile facts and the read-only login ID (never an input). Separately labelled classification and account status. EN rendering. Branch and skill sections still present.                                               |
  | 3           | Only changed supported fields are sent, to `/profile`. No phone, email or code fields.                                                                                                                                 |
  | 4           | History rows, effective dates, payroll eligibility and upcoming entries.                                                                                                                                               |
  | 5–7         | Promotion only from TRAINEE. The exact body sent to `/employment`. The backdating hint. Transition error messages.                                                                                                     |
  | 8–10        | Password policy and mismatch. `/credentials` through reauthentication: prompt, `/auth/reauthenticate`, fresh CSRF, retry. The PENDING_SETUP label. Policy error message.                                               |
  | 11          | ENDED: no promotion, ending, reset or re-enable controls, plus the ended notice.                                                                                                                                       |
  | 12–14       | The `/end-employment` body and the outcome for past, today, future, inactive and not-requested cases. Future-date wording without auto-disable. Never a delete call. Disable option off without the status permission. |
  | 18          | Viewer: no actions. Full manager: all actions. Pay-only. Multi-branch all-branch rule. Self. Deny.                                                                                                                     |

- **API: `employment.integration.test.ts`, 11/11.** The promotion now asserts that nothing
  but the classification changes (point 6).
- **Point 13:** also covered by the existing `workforce-account.integration.test.ts`
  (11/11), where the profile, attendance and audit survive ending employment.
- **Point 17:** `branch-assignment.integration.test.ts` 5/5; history is preserved.
- **Point 20:** web suite 63/63, including the Step 2 creation tests (8) and the
  workforce-access tests (7); `tsc --noEmit` passes.
- **Point 21, customer auth unchanged:** registration 7/7, login 4/4, password reset 5/5
  integration tests; auth, registration and password-reset HTTP tests 12/12.
- **Also run:** employee integration 10/10.
- **Static checks:** eslint and boundaries pass; prettier passes.
- **Visual check:** headless Edge at 375 px and 1000 px, VI and EN.

## Limitations and deferred work

- No scheduler: future-dated endings need a manual "Vô hiệu hóa đăng nhập" on or after the
  date. The UI says so.
- Phone and email are not editable (no backend command); the employee code is immutable by
  design.
- The classification reason is required for promotion (API rule), even for today's date.
- Role assignment UI, new skill UI, payroll, self-service password change, rehire and the
  full UI redesign are not part of this step.

## Files changed

- **New:**
  - `apps/web/src/components/workforce/screens/employee-lifecycle.tsx`: profile,
    employment, promotion, ending, password and status sections;
  - `apps/web/src/lib/workforce/employee-detail.ts`: action gating, request builders,
    commands, errors;
  - `apps/web/src/lib/workforce/employee-detail.test.tsx`.
- **Changed:**
  - `apps/web/src/components/workforce/screens/employee-detail.tsx`: loads the
    classification, the header badges and the section order;
  - `apps/web/src/i18n/workforce.ts`: `employees.detail` VI/EN;
  - `apps/web/src/app/workforce.css`: `.wf-facts` and `.wf-header-badges`;
  - `apps/api/src/employees/employment.integration.test.ts`: the promotion-isolation
    assertion.
- **Docs:** this report and `LUCYSPA_HANDOFF.md`. No PRD change was needed; the rules were
  already recorded in 6.4 and 7.1a.

## Next step

**Role assignment UI on employee detail.** Assign and revoke existing database roles
globally or per branch, using the existing role-admin API with containment and
`EXCEEDS_ACTOR`. The employee skill UI follows once the lifecycle flow is confirmed in use.
