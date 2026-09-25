# Phase 2 Step 5: skills and employee skills

Status: **CLOSED** (Owner-authorized to close on passing checks; commit
`feat: add phase 2 skills management`). Baseline is `8ad0bd1`. The work is backend/API
only. Nothing was deployed to production.

This builds on the [Step 2 database foundation](PHASE2_STEP2_DATABASE_FOUNDATION.md)
(the `skills`, `service_skills` and `employee_skills` tables),
[Step 3](PHASE2_STEP3_BRANCH_ADMIN_HOURS.md) and
[Step 4](PHASE2_STEP4_SERVICE_MANAGEMENT.md), including its eligible-skill authority
decision. The PRD basis is section 9 (employees are assigned skills) and section 8.1
(eligible skills per service).

## 1. Scope implemented

- **Skill catalog:** create, list, update names, activate and deactivate. The code is
  immutable and skills are never deleted.
- **Service eligible skills:** replace a service's full eligible-skill set; the set is
  exposed on every service read.
- **Employee skills:** grant, revoke and read an employee's active skills.

Not in scope: UI, attendance, leave, a new branch-assignment model, the booking or
auto-suggest engine, and Phase 3 qualification logic.

## 2. Important files changed

- **Created:**
  - `apps/api/src/skills/skill.service.ts` and `skill.controller.ts`;
  - `skill.http.test.ts` and `skill.integration.test.ts`;
  - this report.
- **Modified:**
  - `apps/api/src/catalog/service-catalog.service.ts`: `eligibleSkills` added to
    service reads, plus the `setEligibleSkills` command;
  - `apps/api/src/catalog/service-catalog.controller.ts`: the new route;
  - `apps/api/src/app.module.ts`;
  - `packages/contracts/src/index.ts`: skill contracts and
    `ServiceResponse.eligibleSkills`;
  - `scripts/test-auth-integration.mjs`;
  - `LUCYSPA_HANDOFF.md`.

## 3. APIs and routes (under `/api/v1`)

| Route                                       | Purpose                                                          |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `GET skills`                                | Skill catalog (inactive only for GLOBAL `MANAGE_SKILLS`)         |
| `POST skills` → 201                         | Create (`code, nameVi, nameEn, reason?`)                         |
| `POST skills/:id`                           | Update names (`expectedVersion, nameVi?, nameEn?, reason?`)      |
| `POST skills/:id/status`                    | Activate/deactivate (`expectedVersion, isActive, reason`)        |
| `POST services/:id/skills`                  | Replace eligible skills (`expectedVersion, skillIds[], reason?`) |
| `GET employees/:id/skills`                  | The employee's active skills                                     |
| `POST employees/:id/skills`                 | Grant (`skillId, reason?`)                                       |
| `POST employees/:id/skills/:skillId/revoke` | Revoke (`reason?`)                                               |

**Changed:** `GET services`, `GET services/:id` and every service command response now
include `eligibleSkills` (`id, code, nameVi, nameEn, isActive`).

**Protection:** every POST keeps the JSON, exact-Origin and session-bound CSRF checks,
and DTOs reject unknown fields such as `isActive` at creation, `code` in an update, or
a client-supplied `branchId`.

## 4. Authorization rules (Owner decisions)

| Operation                               | Requirement                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Skill catalog create, update and status | **GLOBAL `MANAGE_SKILLS`**; a branch-scoped grant is refused                                        |
| Service ↔ eligible skills               | **GLOBAL `MANAGE_SERVICES`**; `MANAGE_SKILLS` and branch-scoped `MANAGE_SERVICES` are refused       |
| Employee ↔ skills (grant/revoke)        | **`MANAGE_SKILLS` for every branch of the employee**                                                |
| Read the skill catalog                  | Any authenticated workforce actor                                                                   |
| Read an employee's skills               | The employee themself, or `VIEW_EMPLOYEES` / `MANAGE_SKILLS` over all their branches; otherwise 404 |

- **Engine:** all of this uses the Phase 1 engine (`decide`, `decideAcross`,
  `requireAcross`) inside the shared admin frame, with transaction-time authorization.
- **Refused callers:** customers get 403 and anonymous callers 401. Owner and customer
  targets of employee skills are 404, and so are unknown IDs.

## 5. Skill catalog behavior

- **Codes and names:** codes are trimmed, uppercased, match `[A-Z][A-Z0-9_]{0,63}` and
  are unique. Names are non-blank.
- **Concurrency:** `expectedVersion` against `skills.row_version`. No-op updates are
  rejected, and a same-status change is 409.
- **Deactivation doesn't cascade** (consistent with categories): existing service and
  employee assignments remain. It blocks **new** assignments of the skill.
- **Visibility:** non-catalog-managers see active skills only.

## 6. ServiceSkill behavior

- **Replace, not add/remove:** the command replaces the service's complete
  eligible-skill set. Zero, one or many skills are valid.
- **Input handling:** duplicate IDs in the request collapse, so no duplicate relation
  can be created. Unknown or inactive skills can't be **newly** added
  (`VALIDATION_FAILED: skillIds`). A kept skill that was deactivated later stays until
  it is removed.
- **Removal:** deletes only the relation row, never the skill. An unchanged set is
  rejected.
- **Future qualification rule (recorded for Phase 3; not implemented here).** If a
  service has several eligible skills, an employee satisfies the **skill dimension**
  when the intersection between the service's eligible skills and the employee's active
  skills is **non-empty**. For example, eligible {A, B, C} and employee {B, D} is a
  match. The booking/auto-assignment engine that applies this, together with branch,
  status, attendance, leave and bookings (PRD section 9), is Phase 3. The integration
  test checks this intersection only as a data-level assertion.

## 7. EmployeeSkill behavior

- **One grant per skill:** a skill is an employee capability, one active row per
  (employee, skill). There are no per-branch copies. Branch scope only decides **who**
  may change it.
- **Grant:**
  - the target must be an EMPLOYEE (with a profile) and the skill active;
  - an already active grant is 409;
  - an INACTIVE employee can't gain skills (409, the same convention as Step 10 setup
    issuance), while PENDING_SETUP and ACTIVE employees can;
  - revocation is allowed for any status.
- **Revoke:** sets `revoked_at` on the active row; with no active grant it is 404.
  **History is kept:** a re-grant creates a new row, and the Step 2 triggers make
  grants immutable and revocation one-way.
- **No self-changes:** a non-Owner can't grant or revoke their own skills.

## 8. Multi-branch containment

- **Scope source:** an employee's branches come from their unrevoked
  `EmployeeBranchAssignment` rows (the H2 single source of truth).
- **Every branch must pass:** mutations need `MANAGE_SKILLS` over all of them, so one
  denied branch rejects the change. An employee with no branch needs GLOBAL.
- **Tested:** a branch-A manager can manage an A-only employee but **not** an employee
  in A and B, and not a branchless one. A GLOBAL holder manages both.
- **Not `checkContainment`:** skills are capabilities, not authority, so the
  credential-control containment check doesn't apply. The multi-branch all-or-nothing
  scope check is what prevents over-reach.

## 9. Concurrency approach

- **Skills:** `expectedVersion` / `row_version`, with 409 on a stale value.
- **Service eligible skills:** part of the service's configuration, so they are
  protected by the **service's** `expectedVersion`, and every change bumps
  `services.row_version`. Newly added skills are locked `FOR SHARE`, so a concurrent
  deactivation can't slip in.
- **Employee skills:** discrete grant/revoke commands with no version. The frame locks
  the employee's User row for the whole transaction, which serializes concurrent changes
  to the same employee. Duplicates are also impossible because of the `(employee, skill)`
  partial unique index, and 409 is returned when the grant already exists. The skill row
  is locked `FOR SHARE` during a grant. This is a set of discrete operations, not a
  read-modify-write, so no update can be lost. No schema was added for it.

## 10. Audit behavior

All events are append-only and written in the same transaction:

| Action                   | Entity         | Contents                                                           | Branch                                          |
| ------------------------ | -------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `SKILL_CREATED`          | Skill          | code, names, active                                                | null                                            |
| `SKILL_UPDATED`          | Skill          | before/after of changed names                                      | null                                            |
| `SKILL_STATUS_CHANGED`   | Skill          | before/after active flag; reason required                          | null                                            |
| `SERVICE_SKILLS_CHANGED` | Service        | before and after sets, `added` and `removed`, each as `{id, code}` | null                                            |
| `EMPLOYEE_SKILL_GRANTED` | User (subject) | grant ID, skill ID and code                                        | the employee's branch if exactly one, else null |
| `EMPLOYEE_SKILL_REVOKED` | User (subject) | grant ID, skill ID and code; `revoked: true`                       | same                                            |

## 11. Tests and checks

| Check                                                                                    | Result                  |
| ---------------------------------------------------------------------------------------- | ----------------------- |
| Skills integration (real PostgreSQL, each command in its own savepoint, all rolled back) | **PASS 4** (3 subtests) |
| Skills HTTP contract test (CSRF/Origin for all 6 commands, strict DTOs, error mapping)   | PASS 1                  |
| Step 4 service-catalog integration (the catalog service changed)                         | PASS 5                  |
| Every HTTP suite that boots `AppModule`                                                  | PASS 29                 |
| Builds: contracts and API; web `tsc --noEmit` (writes nothing)                           | PASS                    |
| ESLint, Prettier and the boundary check on changed files                                 | PASS                    |

**The integration test covers:**

- **Skill catalog:**
  - create and normalize, duplicate 409, invalid code;
  - branch-scoped `MANAGE_SKILLS` and `MANAGE_SERVICES` refused for create and update;
    customer 403, anonymous 401;
  - update with a before/after audit, stale 409;
  - deactivation with a reason, same-status 409, inactive hidden from non-managers.
- **Service eligible skills:**
  - an empty set is valid;
  - `MANAGE_SKILLS`, branch-scoped `MANAGE_SERVICES` and branch `MANAGE_SKILLS` are
    refused;
  - multiple skills with duplicates collapsed, version bumped and audited;
  - stale 409, no-op rejected, inactive or unknown skills rejected;
  - removal keeps the skill; clearing to empty works.
- **Employee skills:**
  - a branch manager grants within scope, and the audit carries the branch;
  - a duplicate is 409 with still one active row;
  - **a multi-branch (A+B) or branchless employee is refused to a branch-A manager**;
    a GLOBAL holder succeeds (audit branch null);
  - `MANAGE_SERVICES` alone is refused;
  - customer, unknown and Owner targets are 404;
  - inactive or unknown skills are rejected; an INACTIVE employee is 409; self-grant is
    refused;
  - revoke keeps history and the catalog and is audited; a second revoke is 404;
    re-grant creates a new row;
  - reads work for self and a scoped manager, are 404 across scope, and customers are
    refused;
  - the ANY-one intersection holds as a data-level check.

The postcheck confirms the skill count and users are unchanged and no Owner was
created. The Step 2 and 3 suites and the Phase 1 suites weren't rerun, since shared
authorization and the schema are unchanged.

## 12. Database and migration status

**No new migration and no schema change.** The Step 2 tables supported Step 5 without
defect, and nothing was changed in production.

## 13. Deferrals and limitations

- **Phase 3:** the qualification/booking engine applying the ANY-one rule, derived KTV
  status, and auto-suggestions.
- **Step 6:** operational branch assignments, using `EmployeeBranchAssignment`.
- **Step 9:** UI.
- **Deactivated skills keep their assignments.** Their existing service and employee
  assignments remain for review. Phase 3 qualification should consider only
  **active** skills and should decide whether a deactivated eligible skill still
  qualifies. This is recorded for that design.
- **Revocation reads:** grant/revocation history is stored but only active skills are
  returned. A history read can be added with the UI if needed.
- **Production:** the Phase 2 migrations and code are not deployed. That needs
  `pnpm db:deploy` and `pnpm db:permissions:sync`.

## 14. Git context

- **Baseline:** `8ad0bd1`, with `apps/web/next-env.d.ts` a pre-existing generated dirty
  file that stays untouched and unstaged.
- **Commit:** only Step 5 implementation, test and documentation files.

## 15. Next step

**Phase 2 Step 6: Operational Branch Assignments.** It needs separate Owner
authorization; it reuses `EmployeeBranchAssignment` (H2).
