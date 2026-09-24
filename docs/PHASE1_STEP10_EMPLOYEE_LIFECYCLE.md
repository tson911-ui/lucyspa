# Phase 1 Step 10: employee lifecycle

Status: **implemented and validated locally; awaiting review**. No staging, commit,
push or Step 11 work. Baseline is Step 9 commit `19a04c0`.

This implements the approved [authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md)
for employees:

- account lifecycle and setup (section 2);
- authorization, delegation and escalation (section 7);
- sole-Owner protection (section 8);
- audit (section 9);
- the administrative command and `/auth/employee-setup/complete` contracts (section 10).

It uses the existing building blocks:

- the Step 7 engine: `decideAcross`, `checkContainment`, `checkGraphChange`,
  `authorizationSummary`, `loadAuthorityGraph` and `invalidateAuthorization`;
- the Step 3 session, CSRF and fresh-reauthentication primitives;
- the Step 6/9 challenge and throttle helpers.

**No Prisma schema, migration or database privilege change was needed.**
`apps/web/next-env.d.ts` is untouched. No real Owner was created.
`pnpm db:permissions:sync` was run only inside the rolled-back test transaction.

## Endpoints

Every route requires an authenticated OWNER or EMPLOYEE session. Customers get 403
`FORBIDDEN`, and a missing or anonymous session gets 401 `AUTHENTICATION_REQUIRED`.
Every POST keeps the Step 3 JSON, exact-Origin and session-bound CSRF protection. DTOs
reject unknown fields, so status, kind, password, verification, role and contact
changes cannot be mass-assigned.

| Route                                | Body                                                                                           | Authorization (every affected branch; no branch ⇒ GLOBAL)                                                                          | Result                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /employees`                    | `employeeId, fullName, dateOfBirth, address, phone, email?, locale, branchIds, baseSalaryVnd?` | CREATE_EMPLOYEES; plus MANAGE_EMPLOYEE_PAY when a salary is supplied                                                               | 201 `EmployeeResponse`, **PENDING_SETUP**                                 |
| `GET /employees/:id`                 | —                                                                                              | VIEW_EMPLOYEES, otherwise 404                                                                                                      | 200 `EmployeeResponse`                                                    |
| `POST /employees/:id/profile`        | `expectedVersion, fullName?, dateOfBirth?, address?, locale?`                                  | UPDATE_EMPLOYEES                                                                                                                   | 200                                                                       |
| `POST /employees/:id/status`         | `expectedVersion, status: ACTIVE\|INACTIVE, reason`                                            | MANAGE_EMPLOYEE_STATUS; reactivation also requires containment                                                                     | 200                                                                       |
| `POST /employees/:id/scope`          | `expectedVersion, branchIds (complete resulting set), reason`                                  | MANAGE_EMPLOYEE_SCOPE at old ∪ new branches; `checkGraphChange`; MANAGE_PERMISSIONS at added branches if a dormant grant activates | 200                                                                       |
| `POST /employees/:id/base-salary`    | `expectedVersion, baseSalaryVnd (string\|null), reason`                                        | MANAGE_EMPLOYEE_PAY                                                                                                                | 200                                                                       |
| `POST /employees/:id/setup`          | `expectedVersion, reason`                                                                      | Fresh reauthentication, MANAGE_EMPLOYEE_ACCESS and containment                                                                     | 200 `{ setupToken, expiresAt }`, returned once, `Cache-Control: no-store` |
| `POST /auth/employee-setup/complete` | `setupToken, newPassword`                                                                      | The capability itself (anonymous session and CSRF token)                                                                           | 204, no login cookie                                                      |

`EmployeeResponse` contains:

- `id`, `employeeId`, `fullName`, `dateOfBirth`, `address`, `phone`;
- `email` and `emailVerified`;
- `locale`, `status` and `branchIds`;
- `version` (the User `rowVersion`, used for `expectedVersion`).

`baseSalaryVnd` is included only when VIEW_EMPLOYEE_PAY passes for **every** branch
of the employee. Mutations return the updated record under the same rule.

New public error codes:

- 403 `FORBIDDEN`: the action permission is missing;
- 404 `NOT_FOUND`: an unknown ID, a non-employee target, or a read without
  VIEW_EMPLOYEES;
- 409 `CONFLICT`: a stale `expectedVersion`, an invalid status transition, or a
  duplicate `employeeId`/`phone`/`email`. A duplicate names only the submitted field,
  never the other account.

## Behavior

- **Authority is decided inside the transaction.**
  - Each command loads the actor's graph with `loadAuthorityGraph` under its locks.
    Branches come from the employee's stored, unrevoked memberships, never from the
    client.
  - A profile, status, pay or credential change requires the permission at **all** of
    the target's branches. For an employee without a branch, GLOBAL authority is
    required.
  - DENY always wins (Step 7).
- **Lock order:**
  1. the graph lock: shared, or **exclusive** for creation and scope changes;
  2. the actor and target Users, sorted by UUID;
  3. the actor's session, through `resolveForMutation`;
  4. challenge rows.

  `SessionService.withExclusiveTransaction` takes the exclusive lock as the first
  statement.

- **Owner and customers are never targets.**
  - Any command against them returns 404 and changes nothing.
  - Creation always inserts `kind: EMPLOYEE`, so it cannot create an Owner.
  - Non-Owners cannot change their own status, scope, pay or credentials (403).
- **Creation.**
  - The new employee is `PENDING_SETUP`, with no password.
  - An optional email is stored **unverified**. The Step 9 flow proves it later.
  - The employee gets explicit branch memberships, granted by the actor.
  - `EMPLOYEE_CREATED` is appended. If a salary was supplied, a separate
    `BASE_SALARY_CHANGED` is appended with classification `EMPLOYEE_PAY`.
  - Skills (Phase 2) and roles (Step 11) are not accepted.
- **Profile.** Only name, date of birth, address and locale are editable. Phone, email,
  employee ID and pay are excluded. `PROFILE_UPDATED` records the changed field
  **names** only.
- **Status.**
  - ACTIVE or PENDING_SETUP → INACTIVE, in the same transaction:
    - actionable `RESET_PASSWORD`, `EMPLOYEE_SETUP` and `VERIFY_RECOVERY_EMAIL` flows
      are invalidated, and pending deliveries erased;
    - `invalidateAuthorization` increments `authzVersion` and revokes every session;
    - `STATUS_CHANGED` (with reason) and `SESSIONS_REVOKED` are appended.
  - The password hash and history are kept.
  - INACTIVE → ACTIVE requires **containment**, because reactivation restores the
    employee's assigned powers. The result is ACTIVE when a credential remains,
    otherwise PENDING_SETUP.
  - Every other transition returns 409.
- **Scope.**
  - The request carries the complete new set of branches.
  - Removed memberships get `revokedAt`, so history is kept. Added memberships are
    inserted, and only active branches are accepted.
  - The change is rejected when `checkGraphChange` fails.
  - MANAGE_PERMISSIONS is also required at the added branches if the new membership
    activates a dormant branch grant.
  - Outstanding setup capabilities are invalidated, and the target's `authzVersion` is
    incremented with sessions revoked.
  - `BRANCH_SCOPE_CHANGED` is written as a global event (null branch), with the before
    and after sets and the reason.
- **Base salary.**
  - A nonnegative integer decimal string, stored as bigint. Null means unknown and is
    never turned into 0.
  - `BASE_SALARY_CHANGED` is always `EMPLOYEE_PAY` (a Step 2 CHECK also enforces this),
    and records the before and after amounts and the reason. Standard audit rows never
    contain amounts.
  - No payroll calculation.
- **Setup issuance.**
  - Requires fresh reauthentication (403 `REAUTHENTICATION_REQUIRED`),
    MANAGE_EMPLOYEE_ACCESS at every branch, and containment (Step 7). Containment
    evaluates the target as if ACTIVE and rejects self-targets.
  - INACTIVE targets get 409.
  - Reissue to an ACTIVE employee, in one transaction:
    - clears the password, increments `credentialVersion` and sets PENDING_SETUP;
    - revokes the employee's sessions.
  - Any prior setup, reset or recovery-email flow is invalidated.
  - The new `EMPLOYEE_SETUP` challenge:
    - holds only the SHA-256 digest of a 256-bit capability;
    - captures `credentialVersion` and `authzVersion`;
    - lives 24 hours;
    - has a per-User identity key.
  - `ACCESS_SETUP_ISSUED` is appended; it never contains the token.
- **Setup completion.**
  - The new password is checked against the policy and hashed before any lookup.
  - The per-IP verification budget applies.
  - Lock order: User, then challenge.
  - It requires EMPLOYEE, PENDING_SETUP, no password, a live flow, and **both**
    captured versions unchanged. Anything else retires the capability and returns 400
    `VERIFICATION_FAILED`, so a promotion, scope change, reissue or inactivation makes
    old capabilities useless.
  - On success, atomically:
    - the challenge is consumed;
    - the password is set, `credentialVersion` incremented and the status set to ACTIVE;
    - sessions and sibling flows are revoked;
    - `ACCESS_SETUP_COMPLETED` is appended, with actor `SYSTEM`.
  - No session is created.
- **Employees without email.** Setup reissue is their recovery arrangement. Employees
  with email can prove it and use the Step 9 self-service reset.

## Shared-code changes

- **Lock order unified (fix).** `PasswordResetService` (completion and the shared
  resend) used to lock the reset challenge before the User. It now locks
  identity, then the User, then the challenge. That matches setup issuance and
  reissue, inactivation, setup completion and the Step 9 recovery-email paths, which
  all lock the User before challenge rows. Before the fix, a reset completion racing a
  setup reissue or inactivation for the same employee could deadlock. Nothing else in
  the reset flow changed.

- `SessionService.withExclusiveTransaction` was added; `withTransaction` is unchanged.
- `AuthError` gained `FORBIDDEN`, `NOT_FOUND` and `CONFLICT`.
- `registration.ts` now exports its existing `text` normalizer for employee profile
  text.
- `AppModule` registers `EmployeeController`/`EmployeeService` and
  `EmployeeSetupController`/`EmployeeSetupService`.

## Validation

| Check                                                                      | Result                              |
| -------------------------------------------------------------------------- | ----------------------------------- |
| Contracts and API strict TypeScript build                                  | PASS                                |
| Employee HTTP contract tests (commands and setup completion)               | PASS: 2                             |
| Every HTTP suite that boots `AppModule` (rerun because the module changed) | PASS: 24                            |
| PostgreSQL rollback integration: employee lifecycle                        | PASS: 10 (9 subtests, none skipped) |
| ESLint, Prettier and the workspace boundary check                          | PASS                                |

**HTTP tests** check that for every command:

- a missing CSRF token, a wrong Origin or a missing Origin gives 403 before the
  service is reached;
- `status`, `kind`, `password`, `emailVerified` and `roleIds` are rejected at creation,
  and contact or pay fields are rejected in profile patches;
- malformed salary, status and version values are rejected;
- the 201/200/204 contracts hold;
- setup issuance sends `no-store`;
- setup completion sets no cookie;
- the FORBIDDEN, NOT_FOUND, CONFLICT and REAUTHENTICATION_REQUIRED mappings are
  correct, with no secret echoed.

**The integration test** runs inside one rolled-back transaction, with the real
triggers and constraints, and covers:

- branch isolation;
- multi-branch all-or-nothing, and "no branch requires GLOBAL";
- GLOBAL grant plus branch DENY;
- salary gating on create and update, and multi-branch pay;
- `EMPLOYEE_PAY` audit classification, with standard audit rows free of amounts;
- object-scoped 404 reads;
- unique conflicts;
- customer, anonymous and Owner-target refusal, with the Owner row unchanged;
- self-administration refusal;
- profile allowlist and version conflicts;
- setup:
  - fresh-proof requirement;
  - digest-only storage and the 24-hour lifetime;
  - supersession and completion;
  - replay rejection;
  - reissue revoking sessions and bumping the credential;
  - a scope change retiring a capability;
- containment blocking setup and reactivation for stronger staff;
- inactivation revoking sessions and setup and bumping `authzVersion`, with the
  credential kept;
- reactivation to ACTIVE, or to PENDING_SETUP without a credential;
- scope changes:
  - outside the actor's scope;
  - transfer with membership history;
  - dormant-grant activation without MANAGE_PERMISSIONS;
  - a branch DENY on scope management;
  - unknown branches.

Postchecks confirm that no fixture users, audit rows or branches remain, the
permission count is unchanged, and no Owner was created.

After the lock-order fix, the Step 6 customer reset and Step 9 workforce recovery
integration suites were rerun together with this one: PASS, 20 tests in total. They run
in a single rolled-back transaction, so they confirm unchanged reset behavior, not true
concurrency. The deadlock fix rests on the unified lock order. The Step 4, 5, 7 and 8
suites were not rerun.

## Exact Step 10 files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/app.module.ts
apps/api/src/auth/auth.error.ts
apps/api/src/auth/password-reset.service.ts
apps/api/src/auth/registration.ts
apps/api/src/auth/session.service.ts
packages/contracts/src/index.ts
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/auth/employee-setup.controller.ts
apps/api/src/auth/employee-setup.service.ts
apps/api/src/employees/employee.controller.ts
apps/api/src/employees/employee.http.test.ts
apps/api/src/employees/employee.input.ts
apps/api/src/employees/employee.integration.test.ts
apps/api/src/employees/employee.service.ts
docs/PHASE1_STEP10_EMPLOYEE_LIFECYCLE.md
```

## Review boundary and open items

No schema blocker. The following were **not** added:

- role/permission administration, including initial roles at creation;
- the audit-read API (Step 11);
- email delivery (Step 12);
- payroll;
- skills (Phase 2);
- UI.

Open items:

- **Employee list.** There is only a single-employee read. A scoped, paginated list,
  filtered before counts as the design requires, can be added when a UI needs it.
- **Initial roles.** Created employees have no roles. Assign roles through Step 11
  **before** issuing setup, as the design recommends. A role change after issuance
  retires the capability, because it changes `authzVersion` (Step 7).
- **Handing over the setup token.** The token is returned once in the HTTP response.
  The "authorized secure channel" for giving it to the employee remains an operational
  procedure.
- **Real Owner.** Still not created (Step 8).
