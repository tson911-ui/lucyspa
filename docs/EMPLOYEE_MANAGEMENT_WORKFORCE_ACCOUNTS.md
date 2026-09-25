# Employee management: workforce accounts (Owner/manager-managed credentials)

**Status:** implemented and tested locally. Committed on its own as `feat: add
owner-managed workforce credentials`, on top of `bacc0f9` (Step 1) and `7a516ed` (Step 2).
**Not pushed, not deployed.** No migration.

## Product rules (approved; recorded in `LUCY_SPA_PRD.md` 6.4 and 7.1a)

- **Customers are unchanged:** self-registration, OTP email verification and self-service
  password recovery all stay as they were. No customer code was modified.
- **Workforce members never self-register and need no OTP:** the Owner or an authorized
  manager controls their credentials.
- **The employee code is the workforce login ID.**
  - Example: `NV0001`, entered case-insensitively in the WORKFORCE realm with identifier
    type `EMPLOYEE_ID`.
  - There is no username or loginId column.
  - The code is only an identifier; no logic reads classification or role from it.
- **Owner/manager-managed passwords are an official workforce flow:** the Owner or an
  authorized manager may provision or reset a workforce password directly.
  - The workforce email reset remains for compatibility with verified recovery emails.
- **Classification is separate from account status and roles.**
  - A TRAINEE may have an ACTIVE account.
  - Manager, KTV, etc. remain database roles.
  - No new classification was added.
- **Ending employment deletes nothing.**

## Create with login access

`POST /api/v1/employees` takes an optional `initialPassword`.

**Without it:** behaviour is unchanged. The account is `PENDING_SETUP` and cannot sign in.

**With it:**

- **Password handling:**
  - validated by the existing policy (`validatePasswordForSetting`: 15–128 code points,
    NFC, malformed text rejected, common-password blocklist);
  - hashed with the existing Argon2id `PasswordService` before the transaction, so the
    expensive work never holds locks. A caller without a session never reaches the
    hashing.
- **Authorization** (inside the create command):
  - fresh reauthentication (`REAUTHENTICATION_REQUIRED` otherwise);
  - `MANAGE_EMPLOYEE_ACCESS` in every selected branch;
  - in addition to `CREATE_EMPLOYEES`, and to `MANAGE_EMPLOYEE_PAY` for
    OFFICIAL_EMPLOYEE.
- **What is written:** the user is created `ACTIVE` with `passwordHash`, at credential
  version 1 (the first credential; there are no prior sessions or flows to retire).
- **Atomicity:** the user, profile, classification, branch assignments, audit and
  credentials are written in one transaction. Any failure leaves nothing behind (tested
  with an injected failure after the credential audit row).
- **Audit:** `EMPLOYEE_CREATED` (status ACTIVE) and `ACCESS_PASSWORD_SET`
  `{status, credentialVersion: 1, method: INITIAL_PROVISIONING}`. The audit never holds
  password material.
- **Classification:** unaffected. TRAINEE and OFFICIAL_EMPLOYEE both work.

## Direct set/reset: `POST /api/v1/employees/:id/credentials`

Body: `{expectedVersion, newPassword, reason}`. The response is `EmployeeResponse` with
`Cache-Control: no-store`, and the password is never echoed. This is the future
"Đặt lại mật khẩu" backend.

**Rules:**

- the target must be an EMPLOYEE (the Owner and customers are 404);
- a non-Owner cannot target themselves;
- fresh reauthentication;
- `MANAGE_EMPLOYEE_ACCESS` in every branch of the employee;
- a version check;
- the account must not be `INACTIVE` (409 `status`);
- employment must not be ENDED as of today (409 `employment`);
- containment: the target holds no power the actor lacks, so no takeover of a more
  powerful colleague;
- the existing password policy and hashing.

**Effect:**

- the password hash is replaced;
- `credentialVersion` increments, which invalidates sessions bound to the old version;
- `PENDING_SETUP` becomes `ACTIVE`;
- every session of the employee is revoked explicitly;
- open `RESET_PASSWORD`, `EMPLOYEE_SETUP` and `VERIFY_RECOVERY_EMAIL` flows are retired;
- audit `ACCESS_PASSWORD_SET` `{method: MANAGER_SET, credentialVersion, replacedExisting}`
  with the reason, plus `SESSIONS_REVOKED`.

**Existing setup-token flow:** `POST /employees/:id/setup` and
`/auth/employee-setup/complete` remain available but are not part of the normal Lucy Spa
flow. Setup issuance now also refuses ENDED employment.

## ENDED guards (no rehire)

Employment is "ended" when the classification in effect on today's business date is ENDED.
While it is, the following are refused with 409 `employment`:

- `setCredentials`;
- setup issuance;
- reactivation through `POST /employees/:id/status` (`ACTIVE` from `INACTIVE`).

Deactivation still works. History is never rewritten.

## End employment: `POST /api/v1/employees/:id/end-employment`

Body: `{expectedVersion, effectiveDate, reason, disableAccess}`. Response:
`{employee, employment, access}`.

- **Classification:** appends ENDED using the Step 1 rules, shared through a single
  helper:
  - `MANAGE_EMPLOYEE_PAY`;
  - only TRAINEE → ENDED and OFFICIAL_EMPLOYEE → ENDED;
  - the date must be later than the latest change;
  - backdating is Owner-only;
  - a reason is required.
- **Access, when `disableAccess` is set and the date is today or earlier:** the account is
  set INACTIVE in the same transaction, using the existing status internals:
  - needs `MANAGE_EMPLOYEE_STATUS`;
  - credential flows are retired;
  - `authzVersion` increments and sessions are revoked;
  - audited as `STATUS_CHANGED` and `SESSIONS_REVOKED`.
  - Result: `access: DISABLED`, or `ALREADY_INACTIVE`.
- **Future date:** ENDED is recorded with that date, but access is NOT disabled, and
  nothing disables it later automatically (there is no scheduler). The response says
  `access: UNCHANGED_FUTURE_DATE`. The account must be disabled with the status command on
  or after the date. Until then the member is still in their previous classification and
  access management works normally.
- **`disableAccess: false`:** `access: UNCHANGED`. From the end date, the ENDED guards
  apply.
- **Audit:** `EMPLOYMENT_ENDED` `{effectiveDate, disableAccessRequested, access}` with the
  reason.
- **Nothing is deleted:** user, profile, attendance, leave, classification history and
  audit remain.

## Web UI

**"Thêm nhân sự" form:**

- A new optional section "Tài khoản đăng nhập" / "Sign-in access" with the checkbox "Cấp
  tài khoản đăng nhập ngay" / "Set up login access now".
  - It is offered only with `MANAGE_EMPLOYEE_ACCESS`.
  - It is unchecked by default and independent of the TRAINEE/OFFICIAL_EMPLOYEE choice.
- **When checked, it shows:**
  - "Mã đăng nhập: NV0001", which is the employee code as typed, upper-cased and read-only
    (no second identifier);
  - "Mật khẩu ban đầu" and "Nhập lại mật khẩu" (`type=password`,
    `autocomplete=new-password`, minimum length 15);
  - the hint "Ít nhất 15 ký tự. Có thể dùng một cụm từ dễ nhớ…".
- **Checks before sending:** length 15–128 code points, confirmation matches, and access
  permission in every selected branch. The common-password check stays server-side and is
  explained if refused.
- **Password handling:** the password is sent exactly as typed, only when the section is
  checked.
- **Unchecked:** the existing notice explains the member stays "Chờ thiết lập".

**Success messages:**

- With access: "Đã tạo nhân sự {name} ({code}) — {classification}. Nhân sự có thể đăng
  nhập ngay bằng mã nhân viên {code} và mật khẩu đã đặt."
- Without access: the previous PENDING_SETUP message.

**Reauthentication** (reusable: `useReauthentication()` in
`components/workforce/reauth-dialog.tsx` plus `withReauthentication()` in
`lib/workforce/reauth.ts`):

- When a command returns `REAUTHENTICATION_REQUIRED`, a dialog asks the signed-in
  Owner/manager for their own password. The dialog states it is not the employee's
  password.
- It calls `POST /auth/reauthenticate`, refreshes the CSRF context for the rotated
  session, and resends the command once.
- **Wrong password:** it shows "Mật khẩu không đúng" and clears the field.
- **Cancel:** nothing more is sent, and the message says nothing was saved.
- The actor's password lives only in the dialog state for that one request.
- The whole create (including the dialog) runs inside the existing single-flight guard, so
  repeated clicks never send a second request.

**Not built yet:** no employee-detail UI for reset or ending; the backend is ready for
them.

## Security properties preserved

- Argon2id and the unchanged password policy on every path; no plaintext anywhere.
  Request logging records only request id, status and duration.
- Credential changes increment `credentialVersion` and revoke sessions; access changes
  increment `authzVersion`.
- Fresh reauthentication for every credential action.
- All-branch permission checks.
- Containment, no self-targeting, and Owner/customer targets are 404.
- Realms stay separate: a workforce credential never signs in as a customer, and the
  EMPLOYEE_ID identifier only exists in the WORKFORCE realm.
- Login rate limits and the uniform 401 are unchanged.
- Roles, branch-scoped assignments and `EXCEEDS_ACTOR` delegation are unchanged.

## Tests

- **`apps/api/src/employees/workforce-account.integration.test.ts` — 11/11**, all fixtures
  rolled back, logging in through the real `LoginService`. By requested point:

  | Points       | What is checked                                                                                                                                                                                                                                                                                                  |
  | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1–2          | No username/login column exists. Sign-in by lower-case employee code works in WORKFORCE/EMPLOYEE_ID, and not as a customer email.                                                                                                                                                                                |
  | 3–7, 11      | TRAINEE and OFFICIAL_EMPLOYEE are created ACTIVE. The Argon2id hash verifies. The classification history is unchanged. The response and all audits contain no password or hash.                                                                                                                                  |
  | 6            | Short, common and malformed initial passwords are rejected, and nothing is created.                                                                                                                                                                                                                              |
  | 12           | Without a password the account is PENDING_SETUP and cannot sign in.                                                                                                                                                                                                                                              |
  | 8–10         | Without `MANAGE_EMPLOYEE_ACCESS` the request is FORBIDDEN (plain creation still works). A non-fresh session gets REAUTHENTICATION_REQUIRED. An injected failure after the credential write leaves no user or profile.                                                                                            |
  | 13–14        | Provisioning takes credentialVersion 1 → 2 and ACTIVE. A reset takes it 2 → 3; the old session is revoked, the old password fails and the new one works. Audits are checked, including SESSIONS_REVOKED. Refused: stale confirmation, weak password, stale version, missing permission, self-target, no session. |
  | 17–18        | The Owner and a customer are 404. A colleague holding `MANAGE_PERMISSIONS` cannot be reset by the admin (unchanged); the Owner can reset them.                                                                                                                                                                   |
  | 19–20, 15–16 | Ending today with disableAccess needs `MANAGE_EMPLOYEE_STATUS`. It results in INACTIVE, a revoked session and failed login. Profile, attendance and audits remain. Reactivation and credential/setup issuance are refused for ENDED employment, and the account can still be deactivated.                        |
  | 21           | A future end date gives UNCHANGED_FUTURE_DATE: the account stays ACTIVE, the session stays valid, and reset still works before the date.                                                                                                                                                                         |
  | 23           | The directory still lists created members with their classification.                                                                                                                                                                                                                                             |

- **Web: `apps/web/src/lib/workforce/workforce-access.test.tsx` — 7/7.**
  - login ID preview and access-permission gating;
  - the account section, VI/EN;
  - password length and confirmation checks, and a request that carries the password only
    when chosen (untrimmed);
  - reauthentication: prompt, `/auth/reauthenticate` with the actor's password, fresh
    CSRF, one retry;
  - cancel sends nothing, and other errors never prompt;
  - the dialog markup;
  - the success message, the PENDING message, and error messages.
- **Web: the Step 2 test** was updated because the password fields are now opt-in.
- **Web totals:** 55/55; `tsc --noEmit` passes.
- **API HTTP:** `employee.http.test.ts` 2/2, now including strict DTOs, CSRF and no-echo
  checks for `/credentials` and `/end-employment`, and a rejected `initialPassword`
  number and `username`.
- **API unit/HTTP:** 86 pass / 0 fail.
- **Full registered API integration suite: 135/135.** This includes customer registration,
  OTP, login and password reset, all unchanged (point 22), and the employee, employment,
  branch-assignment and role-admin suites after the refactor.
- **Static checks:** eslint and boundaries pass; prettier passes.
- **Visual check:** the account section and the dialog at 375 px (headless Edge).

## Remaining limitations

- There is no scheduler: future-dated endings require disabling access manually.
- There is no self-service "change my password" for employees, and no
  "must change at first login" flag.
- There is no employee-detail UI yet for reset or ending. The backend is ready.
- Password generation is not implemented.

## Files changed

- **API:**
  - `employees/employee.service.ts`: create with password, `setCredentials`,
    `endEmployment`, ENDED guards, and shared `appendClassification`, `inactivate`,
    `requireFresh`, `preparePassword`;
  - `employees/employee.controller.ts`;
  - `employees/workforce-account.integration.test.ts` (new);
  - `employees/employee.http.test.ts`;
  - the EmployeeService constructor call sites in 4 integration tests;
  - `scripts/test-auth-integration.mjs`.
- **Contracts:** `packages/contracts/src/index.ts`.
- **Web:**
  - `components/workforce/reauth-dialog.tsx` (new);
  - `lib/workforce/reauth.ts` (new);
  - `lib/workforce/workforce-access.test.tsx` (new);
  - `components/workforce/screens/employee-create.tsx`;
  - `components/workforce/screens/employees.tsx`;
  - `lib/workforce/employee-create.ts`;
  - `lib/workforce/employee-create.test.tsx`;
  - `i18n/workforce.ts`.
- **Docs:** this report, `LUCY_SPA_PRD.md` and `LUCYSPA_HANDOFF.md`.

## Next step

**Employee detail.** Show and edit the profile, the classification history with
promotion, "Đặt lại mật khẩu" (using `/credentials` and the reauthentication dialog),
"Kết thúc làm việc" (using `/end-employment`), status, and branch assignments. Role and
skill assignment UIs come later.
