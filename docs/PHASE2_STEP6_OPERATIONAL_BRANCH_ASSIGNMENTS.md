# Phase 2 Step 6: operational branch assignments

Status: **CLOSED** (Owner-authorized to close on passing checks; commit
`feat: add phase 2 operational branch assignments`). Baseline is `184e47f`. The work is
backend/API only. Nothing was deployed to production.

Context:

- [Step 2](PHASE2_STEP2_DATABASE_FOUNDATION.md), Owner decision **H2**:
  `EmployeeBranchAssignment` is the single source of truth for operational and
  authorization membership.
- [Step 3](PHASE2_STEP3_BRANCH_ADMIN_HOURS.md): branch lifecycle.
- [Step 5](PHASE2_STEP5_SKILLS_EMPLOYEE_SKILLS.md): skill scope uses the same
  membership.
- PRD section 5 (employee assignments are branch-scoped data) and section 9 (booking
  filters by branch assignment).

## 1. Scope implemented

- **Read:** an employee's branch assignments, active and revoked history.
- **Assign:** add the employee to one branch.
- **Revoke:** remove one active assignment, keeping it as history.

All on the existing model, with no new table, permission code or migration.

## 2. Existing `EmployeeBranchAssignment` model reused

Phase 1 Step 2 already provides:

- `employee_user_id`, `branch_id`, `granted_at`, `granted_by_user_id` and
  `revoked_at`;
- a partial unique index allowing **one active row per (employee, branch)**;
- a history trigger making grant facts immutable, revocation one-way and deletion
  impossible;
- restrictive FKs. The FK to `employee_profiles` means only employees can have rows.

Phase 1 Step 10 already exposed `POST /employees/:id/scope`, which replaces the
complete set. **Step 6 doesn't duplicate that logic.** The Step 10 body became one
private routine, `applyScope`, used by `changeScope` (unchanged contract) and by the
new discrete assign and revoke commands.

## 3. APIs and routes (under `/api/v1/employees`)

| Route                                           | Body                                | Result                                         |
| ----------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `GET /:id/branch-assignments`                   | —                                   | `{ employeeId, version, active[], history[] }` |
| `POST /:id/branch-assignments`                  | `expectedVersion, branchId, reason` | 200, the same shape                            |
| `POST /:id/branch-assignments/:branchId/revoke` | `expectedVersion, reason`           | 200, the same shape                            |

- **Entries:** `id, branchId, grantedAt, grantedByUserId, revokedAt`.
- **Version:** `version` and `expectedVersion` are the employee's `row_version`, the
  same version used by the Step 10 employee commands.
- **Existing route:** `POST /:id/scope` remains the full-set variant.
- **Protection:** every POST keeps the JSON, exact-Origin and session-bound CSRF checks.
  Strict DTOs reject unknown fields such as `grantedByUserId`, `revokedAt` or
  `branchIds`, and a reason is required.

## 4. Authorization rule

**`MANAGE_EMPLOYEE_SCOPE`** (existing semantics: "Change employee authorization branch
membership") is required at **every affected branch**, meaning the old set plus the new
set.

- Assigning A → A+B needs it at A and B. Revoking B from A+B needs it at A and B.
- **Self-changes:** non-Owners can't change their own branch scope.
- **Refused callers:** customers get 403 and anonymous callers 401.
- **Refused targets:** customer, Owner and unknown targets are 404.
- **Read visibility:** the employee themself, or `VIEW_EMPLOYEES` over every branch of
  the employee; otherwise 404.

## 5. Containment behavior

These are the Step 10 / Step 7 rules, unchanged:

- **Gained capabilities:** `checkGraphChange(actor, before, after)` refuses any
  capability the employee would gain that the actor doesn't hold. Adding a branch can
  activate a dormant branch grant.
- **Dormant grants:** activating one additionally needs `MANAGE_PERMISSIONS` at the
  added branch.
- **Scope limits:** a branch-scoped actor can't expand an employee into a branch
  outside their authority, and can't act on a multi-branch employee unless they cover
  **all** of its branches. Both are tested.
- **Owner and customers:** never targets, because only EMPLOYEE Users with a profile
  pass the frame.

## 6. Multi-branch behavior

Employees may hold any number of active assignments. Reads return every active row plus
history. Mutations evaluate every current branch. Examples: a manager of A and B can move
an A-only employee into B, while a manager of A alone can't touch an A+B employee.

## 7. Assignment and revocation lifecycle

- **Assign:**
  - authorization comes first, so membership state isn't revealed to unauthorized
    callers;
  - an already active branch is 409;
  - an inactive or unknown branch is 400 `VALIDATION_FAILED`, using the Step 3
    lifecycle: new assignments only go to active branches.
- **Revoke:**
  - authorization first; a branch without an active assignment is 404;
  - sets `revoked_at` on the active row and keeps it as history.
- **Re-assignment** after revocation inserts a new active row; the old row stays in
  history.
- **Assignment history is never deleted** (DB trigger).

## 8. Zero-branch and final-assignment behavior

This is resolved from the committed design; nothing was invented. Design section 7
says: **"For an employee without any active branch, require GLOBAL permission."**
Step 10 already allowed an empty set.

- **Removing the final branch is allowed.** The employee then has zero operational
  branches. This is valid, for example head-office staff.
- **A branchless employee can then be administered only with GLOBAL authority.**

**Fix applied in Step 6.** Step 10's scope check covered only `old ∪ new`. For a
branchless employee that is just the new branch, so a branch-A manager could have
claimed a branchless (possibly GLOBAL-privileged) employee into A. `applyScope` now also
requires GLOBAL `MANAGE_EMPLOYEE_SCOPE` whenever the current set is empty, which is what
the design requires. This tightens existing behavior; the Step 10 suite still passes.

## 9. Graph-change handling

Every assign or revoke is a security-graph change, run exactly as Step 10's scope
change:

1. **Locks:** the **exclusive** graph lock first, then the actor and target Users by
   UUID, then the actor's session.
2. **Authorization inside the transaction:** the actor's and target's graphs are
   loaded under those locks.
3. **Checks:** `MANAGE_EMPLOYEE_SCOPE` over all affected branches (GLOBAL for
   branchless targets), `checkGraphChange`, and `MANAGE_PERMISSIONS` if a dormant grant
   activates.
4. **Mutation:** insert or revoke the row, bump the employee's `row_version`, and
   retire any outstanding EMPLOYEE_SETUP capability.
5. **Invalidation and audit** (sections 10 and 12).

A rejection throws inside the transaction, so nothing is written (tested).

## 10. Session and authorization-version invalidation

`invalidateAuthorization` applies to **the target employee only**: it increments
`authzVersion` and revokes that employee's sessions. No unrelated users are affected.
A `SESSIONS_REVOKED` audit event is written when sessions existed.

## 11. Concurrency and locking

- **Serialization:** the exclusive graph lock serializes every membership change. With
  the target User row lock, two concurrent requests can't both see "not assigned".
- **Duplicates:** the partial unique index `(employee, branch) WHERE revoked_at IS NULL`
  makes a duplicate active membership impossible even outside the API (tested with a
  direct insert).
- **Optimistic concurrency:** `expectedVersion` against the employee's `row_version`,
  bumped on every change, with 409 on a stale value. No new schema was needed.

## 12. Audit behavior

This uses the existing action names:

- **`BRANCH_SCOPE_CHANGED`:**
  - before: the branch IDs;
  - after: the branch IDs plus `operation` (`ASSIGN` / `REVOKE`) and the affected
    `branchId`;
  - also carries the actor, the subject employee and the reason.
  - It is written as a global event (null branch), the same as Step 10, because the
    before and after sets can span branches.
- **`SESSIONS_REVOKED`:** reason `BRANCH_SCOPE_CHANGED` and the count.

## 13. Tests and checks

| Check                                                                                           | Result                  |
| ----------------------------------------------------------------------------------------------- | ----------------------- |
| Branch-assignment integration (real PostgreSQL, each command in its own savepoint, rolled back) | **PASS 5** (4 subtests) |
| Branch-assignment HTTP contract test                                                            | PASS 1                  |
| Phase 1 Step 10 employee integration (the scope routine was refactored and tightened)           | PASS 10                 |
| Every HTTP suite that boots `AppModule`, including the Step 10 employee HTTP test               | PASS 30                 |
| Builds: contracts and API; web `tsc --noEmit` (writes nothing)                                  | PASS                    |
| ESLint, Prettier and the boundary check on changed files                                        | PASS                    |

**The integration test covers:**

- **Assign and revoke:**
  - assign A → A+B takes the exclusive lock, bumps `authzVersion`, revokes the
    employee's session and writes both audit events (`ASSIGN`, the branch, the before
    set);
  - a duplicate is 409 with still one active row, and a direct duplicate insert is
    refused by the DB;
  - a stale version is 409;
  - revoke keeps history and the active set no longer includes the branch; a second
    revoke is 404; re-assignment creates a new row (3 rows total).
- **Containment:**
  - a branch-A manager can't expand into B or revoke from an A+B employee;
  - an A+B manager can do both;
  - inactive and unknown branches are rejected;
  - a dormant branch grant (a role at B) blocks an admin lacking it, and the rejected
    change leaves no row.
- **Final branch:** revoking it is allowed; the branch manager then can't reassign
  (through either route); a GLOBAL admin can.
- **Targets and callers:**
  - customer, Owner and unknown targets are 404;
  - customer callers are 403 and anonymous callers 401;
  - a self-change is refused;
  - self and scoped reads work, and out-of-scope reads are 404.

The postcheck confirms no users remain and no Owner was created. Only the suites that
exercise changed code were rerun.

## 14. Migration and database status

**No new migration and no schema change.** `EmployeeBranchAssignment` supported Step 6
as designed. Nothing was changed in production.

## 15. Deferrals and limitations

- **Step 7:** attendance, which must record check-in only at a branch where the
  employee has an active assignment and lock the branch row (Step 3 note).
- **Phase 3:** booking filters on branch assignment.
- **Step 9:** UI.
- **No primary branch:** the model has no "primary branch" or effective-dated schedule,
  and none was invented.
- **Every operational change is also an authorization change** and signs the employee
  out, because membership is also authorization membership (H2). That is the accepted
  consequence of the single-source decision.
- **Production:** the Phase 2 migrations and code are not deployed. That needs
  `pnpm db:deploy` and `pnpm db:permissions:sync`.

## 16. Git context

- **Baseline:** `184e47f`, with `apps/web/next-env.d.ts` a pre-existing generated dirty
  file that stays untouched and unstaged.
- **Commit:** only Step 6 implementation, test and documentation files.

## 17. Next step

**Phase 2 Step 7: Attendance.** It needs separate Owner authorization.
