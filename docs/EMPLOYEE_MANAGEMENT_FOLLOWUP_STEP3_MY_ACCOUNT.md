# Pre-Phase-3 follow-up Step 3: My Account and the shared authoritative profile

**Status:** implemented and tested locally. One focused commit, pushed to `origin/main`.
**Not deployed.** Production is at `455394f` (follow-up Step 2, deployed and accepted).
No migration.

Design: [collaborator and My Account design](PHASE2_FOLLOWUP_COLLABORATOR_MY_ACCOUNT_DESIGN.md),
sections 7 and 9. Owner decisions Q10 (phone self-edit without OTP, audited) and Q11 (name
self-edit, audited) apply.

## What was implemented

"Tài khoản của tôi / My Account" for every signed-in workforce account: the Owner,
managers, employees, collaborators and trainees.

It is a **self-service view over the same profile rows** that "Nhân sự → employee detail"
reads and writes:

- one person has one authoritative profile and several views of it;
- there is no new table or column, no copied fields and no synchronization.

## Route and navigation

- Page: `/{locale}/workforce/account`
  (`apps/web/src/app/[locale]/workforce/(app)/account/page.tsx`).
- Navigation: "Tài khoản của tôi / My Account" in the Home group, for every workforce
  account including the Owner. No broad redesign; it uses the existing shell and
  components.

## Authoritative data sources

| Shown in My Account                   | Source (the same one employee detail uses)                           |
| ------------------------------------- | -------------------------------------------------------------------- |
| Name, phone, language, account status | `users.full_name`, `phone_canonical`, `preferred_locale`, `status`   |
| Email and verification                | `users.email_delivery`, `email_verified_at` (same as `/auth/me`)     |
| Employee code (login ID)              | `employee_profiles.employee_code_canonical`                          |
| Date of birth, address                | `employee_profiles.date_of_birth`, `address`                         |
| Title                                 | Step 2 server rule `titleOfEmployee` (the Owner is always `OWNER`)   |
| Classification                        | `employment_classification_changes`, the row in effect today         |
| Branches                              | Unrevoked `employee_branch_assignments`                              |
| Skills                                | Unrevoked `employee_skills` (skill catalog names)                    |
| Concurrency version                   | `users.row_version`, shared with employee detail's `expectedVersion` |

**One write path.** `apps/api/src/employees/profile.ts` (`writeProfile`) is the only code
that writes profile fields. Both the management command (`POST /employees/:id/profile`)
and the self command (`POST /me/account/profile`) call it after the same
`normalizeProfilePatch`, so the validation and normalization rules cannot diverge.

The integration test proves the single source both ways:

- (A) a self-edit is immediately what employee detail returns;
- (B) a management edit is immediately what My Account returns;
- both share one version number.

## APIs

| Method and path                                | Behavior                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/v1/me/account`                       | `MyAccountResponse` for the session's own user. No ID parameter exists.                       |
| `POST /api/v1/me/account/profile`              | `{expectedVersion, fullName?, phone?, dateOfBirth?, address?, locale?}` → `MyAccountResponse` |
| `POST /api/v1/employees/:id/profile` (changed) | Now also accepts `phone`, with the same rules (design section 9).                             |

`MyAccountResponse` contains only the fields listed above. It carries **no** base salary,
agreed pay, roles, permissions or authorization data. Own pay belongs to the later
My Income step.

## Self-editable fields

The account may edit:

- full name;
- phone;
- date of birth;
- address;
- preferred language.

The Owner may edit name, phone and language only (see below).

Validation is shared with management:

- **Phone** is normalized exactly as at signup and creation, and is unique across all
  users, customers included. A clash returns `409 CONFLICT phone` without revealing the
  holder. There is no OTP (Q10). Phone is not a workforce login identifier, so changing it
  has no authentication effect.
- **Stale versions** return `409 CONFLICT`, the same optimistic concurrency as employee
  detail.

## Read-only and management-only fields

The following are shown read-only, or not shown at all, and can never be changed through
My Account:

- employee code / login ID;
- classification and title;
- manager status, roles and permissions;
- branches and skills;
- employment status and account status;
- email;
- base salary, agreed pay and administrative compensation.

This is enforced in two layers:

1. **Strict DTO.** The global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`)
   rejects any other body field with 400. The HTTP test covers `employeeId`,
   `classification`, `status`, `kind`, `branchIds`, `skillIds`, `roleIds`,
   `baseSalaryVnd`, `email`, `password`, `userId` and `id`.
2. **Service allowlist.** Even if extra fields reached the service, `normalizeProfilePatch`
   reads only the five allowlisted fields. The integration test submits all of them and
   proves nothing else changes.

Employee detail remains the management surface; no management permission changed.

## Owner behavior

- The Owner stays `User.kind = OWNER` with **no** `EmployeeProfile`; none is ever created.
- My Account shows:
  - name and title "Chủ Spa / Spa Owner";
  - phone, or "—" if none;
  - language;
  - email and its verification state, in Account & Security.
- There is no work section, employee code, date of birth, address or classification.
- Date of birth and address are refused for the Owner (`VALIDATION_FAILED`), both in the UI
  and in the API.
- Owner protection is unchanged: employee administration still returns `NOT_FOUND` for the
  Owner.

## Recovery-email behavior

- "Tài khoản & bảo mật / Account & Security" shows the stored email and whether it is
  verified. These come from the same `users` row as `/auth/me` `recoveryEmail`, and the
  test asserts they are equal.
- The **existing** `RecoveryEmailSection` is rendered on the page. It uses the existing
  `/api/v1/auth/recovery-email/request|verify` endpoints and the existing reauthentication
  dialog. There is no new storage and no second recovery mechanism.
- **Temporary duplication of the entry point.** The dashboard still renders the same
  section. Removing it now would risk regressing the Owner-recovery prompt that was just
  accepted. Both entry points use one component, one set of endpoints and one database
  field. The dashboard entry can be reduced to a link in a later UI pass.
- The email cannot be changed here. The verified email-change flow is a later step, and no
  temporary shortcut was added.

## Authorization and security

- **Identity from the session only.**
  - The service runs in the existing admin command frame (`runAdminCommand`).
  - The frame resolves the session, locks the caller's user row and refuses customers
    (`FORBIDDEN`) and anonymous callers (`AUTHENTICATION_REQUIRED`).
  - The subject is always `actor.userId`, so another account cannot be read or changed.
- **CSRF and origin.** The write is protected by the global CSRF guard: exact Origin plus
  the session-bound token. The HTTP test shows all three refusals, and that none of them
  reaches the service.
- **Session and access rules** are unchanged. Inactive accounts cannot sign in, as before.
  Nothing about login, sessions or authorization versions changed; a profile edit does not
  bump the authorization version.

## Audit

- **Self-edits:** recorded as `PROFILE_UPDATED`, with actor and subject both set to the
  signed-in user. `after = { fields: [...], via: 'MY_ACCOUNT' }` holds **field names only**;
  values are never copied into history. The branch is set only when the member has exactly
  one branch.
- **Management edits** are unchanged: `PROFILE_UPDATED` with the changed field names.

## Tests and checks

| Check                                                                     | Result                                   |
| ------------------------------------------------------------------------- | ---------------------------------------- |
| New `account/my-account.integration.test.ts`                              | 7/7 subtests pass                        |
| API auth/workforce integration (`pnpm test:auth:integration`, all suites) | 171/171 pass                             |
| API unit + HTTP, including the new `account/my-account.http.test.ts`      | 87 pass, 0 fail (25 integration skipped) |
| Web (`apps/web` `pnpm test`), including the new `my-account.test.tsx`     | 95/95 pass                               |
| `pnpm lint` (ESLint + import boundaries), `pnpm format:check`             | pass                                     |
| `tsc --noEmit` for `apps/api` and `apps/web`                              | pass                                     |

The new integration tests map to the required cases:

- **A:** a self-edit is seen by employee detail.
- **B:** a management edit is seen by My Account.
- **C:** the self-edit cannot touch code, classification, status, branches, skills, roles,
  pay or email; phone and validation refusals work.
- **D:** only the session's own account is reachable; customers and anonymous callers are
  refused.
- **E:** the Owner works without an employee profile.
- **F–G:** a manager, employee, collaborator, trainee and not-yet-started member each see
  their own authoritative title, equal to `/auth/me`.
- **H:** the email state matches `/auth/me`. The existing recovery-email suites still pass.

`pnpm typecheck` was **not** run. Its web step runs Next.js route-type generation, which
rewrites `apps/web/next-env.d.ts`, and that file must stay untouched. The web and API were
type-checked with `tsc --noEmit` instead, and the `next-env.d.ts` hash was confirmed
unchanged (`a419cbe…`).

## Explicit deferrals

These remain NOT implemented:

- self-service password change (Step 4);
- verified email change (Step 5);
- collaborator work schedule and agreed pay (Step 6);
- My Income, including own base salary (Q9) (Step 7);
- removing the dashboard's recovery-email entry;
- any UX/UI redesign, which stays deferred until the Phase 3 core is complete;
- Phase 3 booking, which is NOT STARTED.

## Production deployment (not performed; requires Owner authorization)

There is **no migration**.

1. Take a database backup (routine).
2. `git pull`; expect `455394f..<Step 3 commit>`.
3. `pnpm install --frozen-lockfile`. The lockfile is unchanged; this is a harmless check.
4. `pnpm build`, then restart `lucyspa-api`, `lucyspa-web` and `lucyspa-worker` in PM2.
5. Smoke checks:
   - "Tài khoản của tôi" appears in the menu for the Owner and for an employee;
   - the Owner sees "Chủ Spa" and their verified email;
   - an employee edits their phone, and the Owner sees the new phone in employee detail;
   - the recovery-email section still works on both pages.

## Next step

Step 4 is **self-service password change** (`POST /api/v1/me/password`): current password
required, the existing password policy, session rotation, and an entry in My Account →
Account & Security.
