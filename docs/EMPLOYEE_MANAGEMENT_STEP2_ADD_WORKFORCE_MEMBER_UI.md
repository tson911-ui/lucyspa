# Employee management Step 2: "Add workforce member" UI

Status: implemented and tested locally. Committed on its own as `feat: add workforce member
creation UI`, on top of Step 1 (`bacc0f9`). **Not pushed and not deployed.**

## UI implemented

- **Where:** `/{locale}/workforce/employees` (Workforce › Employees).
- **Action:** a primary button in the page header, "Thêm nhân sự" / "Add workforce
  member". It is shown only when the account has `CREATE_EMPLOYEES` somewhere (see
  Authorization).
- **Opening it:** the form appears inline under the header as a "Thêm nhân sự" section.
  This is the existing workforce pattern (no modal or new route). It has three groups:
  1. **Personal details:** employee ID, full name, date of birth, phone, email, the
     member's language and address.
  2. **Classification and start date:** an explicit radio choice, the start date and, when
     needed, a reason.
  3. **Branches:** a checklist.
- **Other content:**
  - an intro line: "Nhân sự mới có thể là học viên hoặc nhân viên chính thức ngay từ đầu —
    không bắt buộc qua giai đoạn học viên."
  - an info notice that creating a member does not grant sign-in.
- **Buttons:** "Tạo nhân sự" / "Create workforce member" and "Hủy" / "Cancel".
- **Layout:**
  - existing classes (`wf-form`, `wf-row`, `wf-field`, `wf-checklist`, `Notice`,
    `SubmitButton`);
  - the only new CSS is `.wf-legend`, a bordered `.wf-choices` radio group, and
    top-aligned fields inside this form only (`.wf-member-form`).
  - Checked at 375 px (one column) and 1000 px (two-column rows).

## Fields (from the actual create API)

| Form field                 | API field (`EmployeeCreateRequest`) | Required                          |
| -------------------------- | ----------------------------------- | --------------------------------- |
| Mã nhân viên / Employee ID | `employeeId`                        | yes                               |
| Họ tên / Full name         | `fullName`                          | yes                               |
| Ngày sinh / Date of birth  | `dateOfBirth`                       | yes                               |
| Số điện thoại / Phone      | `phone`                             | yes                               |
| Email                      | `email`                             | no (blank is sent as `null`)      |
| Ngôn ngữ của nhân sự       | `locale` (`vi`/`en`)                | yes (defaults to the UI language) |
| Địa chỉ / Address          | `address`                           | yes (the API requires it)         |
| Phân loại nhân sự          | `classification`                    | yes, explicit                     |
| Ngày bắt đầu / Start date  | `employmentStartDate`               | yes                               |
| Lý do …                    | `employmentReason`                  | only for a past start date        |
| Chi nhánh / Branches       | `branchIds`                         | at least one                      |

- **Never sent or shown:** salary, password, setup token, roles, permission overrides and
  skills.
- **No new database fields.**
- **Formats stay server-owned:** employee-code characters, phone parsing, email and
  date-of-birth rules. The form checks only that required values are present, that dates
  are real calendar dates and that the choices are allowed.

## Classification behavior

- **Two radio options, "Học viên" (TRAINEE) and "Nhân viên chính thức"
  (OFFICIAL_EMPLOYEE),** each with a short explanation. English: "Trainee" and "Official
  employee".
- **Nothing is preselected.** Submitting without a choice is reported. The request builder
  refuses to build a request without an explicit choice; there is no default to TRAINEE.
- **No trainee stage:** OFFICIAL_EMPLOYEE is sent directly as the initial classification.
  Step 1 records a single OFFICIAL_EMPLOYEE entry, with no artificial trainee history.
- **ENDED is never rendered or submittable.** The client list of initial classifications
  is `['TRAINEE', 'OFFICIAL_EMPLOYEE']`, and the API DTO rejects ENDED anyway.
- **Promotion is not part of this step.**

## Start-date behavior

- **Required:** a date input (`YYYY-MM-DD`, 2000–2100, the Step 1 API range). It is the
  effective date of the initial classification.
- **Past start dates:**
  - if the start date is before today's business date, a required "Lý do ghi nhận ngày bắt
    đầu trong quá khứ" field appears (the Step 1 rule);
  - today's date is computed like the API does: the latest local date among the selected
    branches' timezones, or UTC with none;
  - the API decides authoritatively.
- **Future start dates** are allowed. The directory then shows e.g. "Nhân viên chính thức
  (từ 01/10/2026)".

## Branch behavior

- **Options:**
  - branches come from the existing `GET /api/v1/branches` (`useBranches`), so no branch
    logic is duplicated and nothing is hard-coded;
  - only active branches where the account has `CREATE_EMPLOYEES` are listed (the API's
    `requireAcross`);
  - if exactly one branch qualifies, it is preselected.
- **Selection:**
  - several branches can be selected (the API accepts up to 50);
  - at least one is required in this UI;
  - a branchless employee (which needs GLOBAL authority in the API) is not offered here.
- **No qualifying branch:** the section shows "Bạn chưa được phép thêm nhân sự ở chi nhánh
  nào đang hoạt động."

## Salary decision

**Salary is not exposed in Step 2.**

- The API allows creation without `baseSalaryVnd`.
- A salary field would invite entering pay for trainees, who are not payroll-eligible.
- It would add a second pay-permission path to this form.
- Salary management belongs to the later employee-detail/pay steps.

No payroll or salary history is implemented.

## Authorization and visibility

The UI hints use the existing `/auth/me` grants (`canAnywhere`, `canAt`, `canAcross`) and
add no new authorization system. The API remains authoritative, and Step 1 enforces
`MANAGE_EMPLOYEE_PAY` for OFFICIAL_EMPLOYEE on the server.

- **Add action:** `canAnywhere(CREATE_EMPLOYEES)`. Hidden for viewers without it, for
  customers, and when the only grant is denied.
- **Branch choices:** `canAt(CREATE_EMPLOYEES, branch)`.
- **Official employee choice:**
  - enabled only with `MANAGE_EMPLOYEE_PAY` across every selected branch;
  - without pay authority anywhere, it is disabled with the note "Chỉ người có quyền quản
    lý lương nhân viên mới tạo được nhân viên chính thức. Bạn vẫn có thể thêm học viên.";
  - with pay authority in only some selected branches, a branch-specific note is shown;
  - if OFFICIAL_EMPLOYEE was chosen before selecting such a branch, submitting is blocked
    with that note.
- **A user with `CREATE_EMPLOYEES` but no `MANAGE_EMPLOYEE_PAY`** can create trainees only.
- **Owner:** gets every option. The form creates EMPLOYEE users only; there is no way to
  create an Owner, and the existing Owner is untouched.

## Success and error behavior

- **Submitting:**
  - obviously incomplete input is listed in a single error notice before any request;
  - the button shows "Đang tạo…" and is disabled while pending, and Cancel is disabled
    too;
  - a single-flight guard (`oneAtATime`) ensures repeated clicks or Enter presses send one
    request.
- **Success:**
  - the form closes and the directory filters are cleared and reloaded, so the new member
    is listed;
  - a success notice says "Đã tạo nhân sự {name} ({code}) — {classification}. Nhân sự chưa
    thể đăng nhập cho đến khi tài khoản được cấp.";
  - it links to the existing detail page, which is usable for a new member (skills and
    branch assignments). Returning to the list was chosen because the notice can also
    state the account situation. The detail page is unchanged (Step 3).
- **Directory:** a new "Phân loại" / "Classification" column shows the latest recorded
  classification, with "(từ …)" when it starts in the future.
  - Backend: `EmployeeDirectoryEntry` gains `classification` and
    `classificationEffectiveDate` (the latest entry of the Step 1 history). This is the only
    API change.
- **Errors** (localized; entered values are kept):
  - duplicate employee ID, phone or email (409 with a field) get specific messages;
  - `VALIDATION_FAILED` names the field in plain words (for example the API's
    `employeeCode` becomes "Mã nhân viên");
  - 403 explains branch and official-employee permission;
  - network, session expiry and other failures use the existing messages.
- **Account:** the new member is `PENDING_SETUP`. The UI never claims they can sign in and
  never asks for a password.

## Tests and checks

- **Web: `apps/web/src/lib/workforce/employee-create.test.tsx`, 8/8.** It covers the 14
  requested points:
  - **1–2:** the action exists for creators and the Owner (VI/EN). There is no action for
    viewers, customers or deny-only accounts, and branch options are limited to active
    branches with the grant.
  - **3–6:** both radios are present, neither is preselected, neither is disabled for the
    Owner, and ENDED is absent. A missing choice is reported and never defaulted, and
    OFFICIAL_EMPLOYEE is sent directly.
  - **7–8, 13:** checks the exact request body (start date, branches `['A','B']`, blank
    email as null, trimmed values). It confirms exactly one request (`GET context` +
    `POST /api/v1/employees`), with no salary, password, role, skill or setup request and
    no password or salary field. It also covers the start-date and past-date reason rules
    and business-date timezones.
  - **9:** the success notice (name, code, classification, no sign-in claim, detail link)
    and the directory classification labels (VI/EN, future "from").
  - **10:** duplicate employee ID, phone and email; invalid `employeeCode`, phone and
    reason; 403; unexpected errors.
  - **11:** four rapid submits while the create is pending result in exactly one POST.
  - **12:** without pay authority the official radio is disabled with an explanation, and
    a request for it is blocked. Pay in only some branches is handled.
  - **14:** the directory search, branch and status filters still render.
- **Web totals:** 48/48 (40 existing + 8 new), `tsc --noEmit` passes, eslint and
  boundaries pass, prettier passes.
- **API (directory change):**
  - employment integration 11/11, now also asserting that the directory lists a new
    official employee with its classification and date;
  - directory integration 5/5 (the key set includes the new fields);
  - employee integration 10/10;
  - API unit/HTTP 86 pass / 0 fail.
- **Visual check:** server-rendered form with the real CSS in headless Edge at 375 px and
  1000 px, VI and EN, for the Owner and a trainee-only creator.
- **Not run:** `next build`, because it rewrites `apps/web/next-env.d.ts`.

## Known limitations

- The form is inline on the Employees page; there is no separate route.
- No live employee-ID or phone availability check: duplicates are reported by the API on
  submit.
- Browser date inputs display the date in the device's own format.
- Branchless creation (GLOBAL authority) is not offered.
- The directory label is the latest recorded classification. A future-dated entry is
  shown with its "from" date rather than the classification in effect today.

## Deferred

- account provisioning, setup links and the password setup page;
- role and permission assignment;
- skill assignment at creation;
- salary and pay;
- promotion and ending employment (the Step 1 API exists; no UI yet);
- the employee-detail expansion;
- Phase 3 booking;
- full UI/UX redesign.

## Files changed

- **Web, new:**
  - `apps/web/src/components/workforce/screens/employee-create.tsx`
  - `apps/web/src/lib/workforce/employee-create.ts`
  - `apps/web/src/lib/workforce/employee-create.test.tsx`
- **Web, changed:**
  - `apps/web/src/components/workforce/screens/employees.tsx`: the action, success notice
    and classification column;
  - `apps/web/src/i18n/workforce.ts`: VI/EN strings;
  - `apps/web/src/app/workforce.css`: small form styles.
- **API and contracts:**
  - `packages/contracts/src/index.ts`: directory entry classification fields;
  - `apps/api/src/employees/employee-directory.service.ts`;
  - `apps/api/src/employees/employee-directory.integration.test.ts`;
  - `apps/api/src/employees/employment.integration.test.ts`.
- **Docs:** this report and `LUCYSPA_HANDOFF.md`.
- **No migration.**

## Git state

- One local commit on top of `bacc0f9`; not pushed and not deployed.
- `apps/web/next-env.d.ts` keeps its pre-existing modification and is neither staged nor
  committed.
- Deploying Steps 1–2 later needs a verified backup and `pnpm db:deploy`, for Step 1's
  migration and the earlier pending service migrations.

## Next step

**Step 3: employee detail.** Show and edit the profile, classification history with
promotion (TRAINEE → OFFICIAL_EMPLOYEE) and ending through the Step 1 API, and branch
assignments. Account provisioning, roles and skills remain separate steps.
