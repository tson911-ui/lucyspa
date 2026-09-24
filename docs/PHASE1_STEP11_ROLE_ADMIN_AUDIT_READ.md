# Phase 1 Step 11: role and permission administration, and audit read

Status: **implemented and validated locally; awaiting review**. No staging, commit,
push or Step 12 work. Baseline is Step 10 commit `55d10d6`.

This implements the approved [authentication/security design](PHASE1_AUTH_SECURITY_DESIGN.md)
for:

- roles, overrides and delegation (section 7);
- sole-Owner protection (section 8);
- audit read (section 9);
- the `CreateOrUpdateRole` / `SetRolePermissions` / `AssignOrRevokeRole` /
  `SetOrRemoveUserPermissionOverride` / `ReadAudit` contracts (section 10).

All permission logic is the Step 7 engine: `decide`, `decideAcross`,
`checkGraphChange`, `loadAuthorityGraph` and `invalidateAuthorization`. **No Prisma
schema, migration or database privilege change was needed.**
`apps/web/next-env.d.ts` is untouched. No real Owner was created.

## Endpoints (under `/api/v1`)

All routes need an authenticated OWNER or EMPLOYEE session. Customers get 403
`FORBIDDEN`, and a missing or anonymous session gets 401. Every POST keeps the Step 3
JSON, exact-Origin and session-bound CSRF protection. DTOs reject unknown fields, and
permission codes are validated against the code-owned catalog.

| Route                                 | Body                                                                                          | Authorization                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET roles`                           | —                                                                                             | MANAGE_PERMISSIONS in some scope; returns roles and the catalog                                                                 |
| `POST roles` → 201                    | `code, displayNameVi, displayNameEn, permissions[], reason`                                   | GLOBAL MANAGE_PERMISSIONS; a non-Owner may bundle only permissions held with unrestricted GLOBAL authority                      |
| `POST roles/:id`                      | `expectedVersion, displayNameVi?, displayNameEn?, isActive?, reason`                          | GLOBAL MANAGE_PERMISSIONS; never a role assigned to the (non-Owner) actor; activation is checked as a grant for every recipient |
| `POST roles/:id/permissions`          | `expectedVersion, permissions[] (complete set), reason`                                       | GLOBAL MANAGE_PERMISSIONS, bundle rule for added codes, and **every current recipient** checked                                 |
| `GET employees/:id/authorization`     | —                                                                                             | MANAGE_PERMISSIONS over all of the employee's branches, otherwise 404                                                           |
| `POST employees/:id/roles`            | `expectedVersion, roleId, scope, reason`                                                      | MANAGE_PERMISSIONS at the scope and at every branch of the target, plus `checkGraphChange`                                      |
| `POST employees/:id/roles/revoke`     | `expectedVersion, assignmentId, reason`                                                       | Same rules                                                                                                                      |
| `POST employees/:id/overrides`        | `expectedVersion, permission, effect ALLOW\|DENY, scope, reason`                              | Same rules; creates or changes the override at that scope                                                                       |
| `POST employees/:id/overrides/remove` | `expectedVersion, overrideId, reason`                                                         | Same rules; removal restores inheritance                                                                                        |
| `GET audit-events`                    | `limit, cursor, branchId, action, subjectUserId, actorUserId, entityType, entityId, from, to` | See [Audit read](#audit-read)                                                                                                   |

- `scope` is `{ kind: 'GLOBAL' }` or `{ kind: 'BRANCH', branchId }`. A branch ID sent
  with GLOBAL is rejected, and only active branches are accepted.
- **Versions.** Role commands use the role's `rowVersion`. Assignment and override
  commands use the employee's **`authzVersion`**, which `GET …/authorization` exposes
  as `version`.
- **Errors.** A stale version or a duplicate gives 409 `CONFLICT`. Unknown or
  protected targets give 404.
- **The role code** is normalized to uppercase, must match `[A-Z][A-Z0-9_]{0,63}`, is
  never `OWNER` (also a Step 2 CHECK), and cannot change after creation.

## Graph-change transaction

Every mutation of roles, role permissions, assignments or overrides runs in
`SessionService.withExclusiveTransaction`, so the **exclusive graph lock is the
first statement**. The shared `runAdminCommand` frame then:

1. locks the actor and every affected User (targets, or all recipients of a shared
   role) **sorted by UUID**, before the actor's session;
2. resolves the session with `resolveForMutation` and loads the actor's authority
   graph under those locks;
3. loads each affected User's graph before the change, applies the change, and
   reloads it afterwards;
4. requires `checkGraphChange(actor, before, after)` to pass for **every** affected
   User. Any capability gained must be held by the actor. This covers removing a
   DENY, turning a DENY into an ALLOW, a GLOBAL grant, reactivating a role and editing
   a bundle. Self-targets and Owner or customer targets are rejected.

Any rejection throws inside the transaction, so **nothing is written**. On success,
in the same transaction:

- outstanding `EMPLOYEE_SETUP` capabilities of the affected Users are invalidated;
- `invalidateAuthorization` increments each affected User's `authzVersion` and revokes
  their sessions (Users, then Sessions);
- the audit events are appended: `ROLE_CREATED`, `ROLE_UPDATED`,
  `ROLE_PERMISSIONS_CHANGED` (with the count of affected Users), `ROLE_ASSIGNED`,
  `ROLE_REVOKED`, `PERMISSION_OVERRIDE_CHANGED` (before and after effect, with `null`
  meaning none) and `SESSIONS_REVOKED` (reason `AUTHORIZATION_CHANGED`).

Role-definition events are global (null branch). Assignment and override events carry
the scope's branch.

**Shared roles.** Before any shared-role edit, the actor must hold MANAGE_PERMISSIONS
over **each recipient**: over all of the recipient's branches and every branch where
the recipient holds this role. A GLOBAL delegator with a branch DENY therefore cannot
edit a role held by someone in that branch. If any recipient fails, nothing changes.

**Lock order.** Graph lock (exclusive) → Users by UUID → session → role, assignment,
override and challenge rows. This is the Step 7 order, and the Step 10 frame is now
shared rather than duplicated.

## Audit read

A single-branch event needs VIEW_AUDIT_LOG at that branch. A null-branch event needs
**unrestricted** GLOBAL VIEW_AUDIT_LOG, meaning no branch DENY for it.

`EMPLOYEE_PAY` events also need VIEW_EMPLOYEE_PAY:

- at that branch for a branch event;
- as unrestricted GLOBAL for a null-branch event.

The visibility predicate is built from `decide` over every existing branch. It is
AND-ed with the filters **before** ordering and paging.

- **Paging.** Keyset pagination orders by `occurredAt`, then `id`, newest first. The
  opaque cursor is `nextCursor`. `limit` is 1–100 (default 50), and no total count is
  exposed.
- **No access.** An actor without VIEW_AUDIT_LOG anywhere gets 403. Pay permission
  alone grants nothing.
- **Response.** It contains the stored allowlisted fields only. Audit rows are never
  written or changed by this API: there is no POST route, and the Step 2 append-only
  trigger remains.

## Shared-code changes

- **New `authorization/admin-command.ts`.** It holds the admin frame (`runAdminCommand`,
  `requireAcross`, `appendAdminAudit`), extracted from Step 10's private `command`
  frame. `EmployeeService` now uses it, and its behavior is unchanged: the Step 10
  suites pass.
- **`AppModule`** registers `AuthorizationAdminController`, `RoleAdminService` and
  `AuditReadService`.

## Validation

| Check                                                               | Result               |
| ------------------------------------------------------------------- | -------------------- |
| Contracts and API strict TypeScript build                           | PASS                 |
| Step 11 HTTP contract tests (commands and audit GET)                | PASS: 2              |
| Every HTTP suite that boots `AppModule`, plus the Step 7 unit tests | PASS: 34 in total    |
| PostgreSQL rollback integration: Step 11                            | PASS: 8 (7 subtests) |
| PostgreSQL rollback integration: Step 10 (the command frame moved)  | PASS: 10             |
| ESLint, Prettier and the workspace boundary check                   | PASS                 |

**The Step 11 integration test** runs each command in its own savepoint, so a
rejected command rolls back exactly as its own production transaction would. It
covers:

- **Locking:** the real `withExclusiveTransaction` blocks a concurrent shared-lock
  probe, and releases it afterwards. Graph commands go through the exclusive runner
  and then hold the lock.
- **Role create/rename:** OWNER and unknown codes are refused, duplicates and stale
  versions give 409, and the audit is written. Customers and anonymous callers are
  refused.
- **Assignment:**
  - `authzVersion` is incremented and sessions revoked, with a `SESSIONS_REVOKED`
    audit;
  - a stale version gives 409;
  - a branch manager can grant a held permission in its own branch, but not an unheld
    one, another branch, GLOBAL, a target in another branch, or itself;
  - Owner and customer targets give 404 and receive no rows;
  - revocation works, and an unknown assignment gives 404.
- **Overrides:**
  - lifting a DENY, or turning it into an ALLOW, that would confer an unheld
    permission is refused, and the DENY stays;
  - a reducing DENY is allowed and audited;
  - the Owner can lift a DENY.
- **Shared roles:**
  - a GLOBAL delegator with a branch DENY cannot edit a role held by a recipient in
    that branch;
  - unheld permissions cannot enter a bundle;
  - a non-Owner cannot edit their own role;
  - an Owner edit invalidates both recipients (versions and sessions), and so does
    deactivation.
- **Setup:** a role assignment retires an outstanding setup capability.
- **Audit read:**
  - branch-only, branch plus pay, GLOBAL, GLOBAL with a branch DENY (which also hides
    null-branch events) and GLOBAL plus pay readers each see exactly their events;
  - pay alone, customers and anonymous callers are refused;
  - pages are newest first with a stable cursor;
  - branch and action filters work;
  - bad cursors and limits are rejected;
  - a runtime UPDATE of an audit row is refused.

Postchecks confirm that no fixture users, roles, branches or audit rows remain, the
permission count is unchanged, and no Owner was created.

## Exact Step 11 files

Modified:

```text
LUCYSPA_HANDOFF.md
apps/api/src/app.module.ts
apps/api/src/employees/employee.service.ts
packages/contracts/src/index.ts
scripts/test-auth-integration.mjs
```

Created:

```text
apps/api/src/authorization/admin-command.ts
apps/api/src/authorization/audit-read.service.ts
apps/api/src/authorization/authorization-admin.controller.ts
apps/api/src/authorization/authorization-admin.http.test.ts
apps/api/src/authorization/role-admin.integration.test.ts
apps/api/src/authorization/role-admin.service.ts
docs/PHASE1_STEP11_ROLE_ADMIN_AUDIT_READ.md
```

## Review boundary and open items

No schema blocker. The following were **not** added:

- UI;
- email dispatch (Step 12);
- payroll;
- the completion gate (Step 13).

Open items:

- **Choices where the design is silent.** Each is conservative:
  - a non-Owner can bundle only permissions it holds with unrestricted GLOBAL
    authority;
  - any non-Owner edit of a role the actor holds is refused, even a rename;
  - assignment and override commands version on `authzVersion`;
  - role lists are visible to any holder of MANAGE_PERMISSIONS;
  - roles are never deleted; deactivate them instead.
- **Audit read is not itself audited.** It is a read; the design asks only for
  security logs of rejected attempts, and those remain the logging layer's job.
- **Real Owner.** Still not created. Until then, no role can be created outside
  tests.
