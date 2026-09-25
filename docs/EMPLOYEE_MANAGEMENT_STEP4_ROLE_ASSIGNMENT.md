# Employee management Step 4: role assignment UI

**Status:** implemented and tested locally. Committed on its own as `feat: add employee role
assignment UI`, on top of `deae20c`. **Not pushed, not deployed.** Production is still at
`13f540e`. No migration.

## Roles vs employment classification

| Concept                   | Question it answers                               | Values                                        | Where                       |
| ------------------------- | ------------------------------------------------- | --------------------------------------------- | --------------------------- |
| Employment classification | What is this person's relationship with Lucy Spa? | TRAINEE, OFFICIAL_EMPLOYEE, ENDED (unchanged) | "Phân loại nhân sự" section |
| Role                      | What can this person do in the system?            | Database roles, e.g. KTV, branch manager      | New "Vai trò" section       |

- Roles are the existing database permission bundles (`Role`, `RolePermission`,
  `UserRoleAssignment`). Authorization stays permission-based.
- No code checks role names: no `MANAGER`/`KTV` special cases.
- The web tests assert that the role UI source contains no role names or IDs, and that the
  classification labels remain exactly the three values.
- The integration test asserts that the database enum is unchanged.

## What was implemented

**Web — the "Vai trò / Roles" section on employee detail** (between "Tài khoản đăng nhập"
and "Phân công chi nhánh"):

- **Current assignments:** the role name (localized, from the loaded catalog), the role
  code, and a scope badge:
  - **GLOBAL:** "Toàn hệ thống" / "All branches (global)", warning tone;
  - **BRANCH:** "Chi nhánh: {name}" / "Branch: {name}", info tone.
  - A switched-off role is marked "Vai trò đang tắt — hiện không cấp quyền nào" (the
    engine ignores inactive roles).
- **"Gán vai trò" / "Assign role":** scope, then role, then a required reason.
  - Scopes: GLOBAL (only with GLOBAL `MANAGE_PERMISSIONS`) and the member's active branches
    where the actor holds `MANAGE_PERMISSIONS`. Branches the member is not assigned to are
    not offered: the API would accept them, but the grant would stay dormant.
  - Roles: active catalog roles, by their loaded IDs. A role carrying a permission the
    actor does not hold at the chosen scope is shown disabled, "— vượt quyền của bạn".
    This is a UX hint of the containment rule.
  - A note says that changing roles signs the member out (the existing graph-change
    behaviour).
- **"Gỡ vai trò" / "Remove role":** per assignment, using the shared reason field. It is
  offered only where the actor manages that scope (GLOBAL assignments need GLOBAL
  `MANAGE_PERMISSIONS`).
- **Visibility:** the whole section appears only with `MANAGE_PERMISSIONS` over every
  branch of the member, which is the API's read rule for
  `GET /employees/:id/authorization`. Other users do not see it.
- **Self:** assignments are shown, but there is no assign form and no remove buttons ("Bạn
  không thể thay đổi vai trò của chính mình.").
- **Empty catalog:** "Chưa có vai trò nào trong hệ thống… hiện chưa có màn hình tạo vai
  trò." No roles are invented.
- VI/EN; phone layout checked at 375 px.

**Backend — one minimal guard:** `RoleAdminService.assignRole` now refuses (409
`employment`) when ENDED is in effect on today's business date. This mirrors the no-rehire
guards from `9adfb14`. Revocation stays allowed, so access can be removed after someone
leaves. No other backend or contract change.

## Existing APIs used

| Purpose                                                                 | API                                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Role catalog (IDs, names, permissions, active state)                    | `GET /api/v1/roles`                                                                 |
| The member's assignments and `authzVersion` (used as `expectedVersion`) | `GET /api/v1/employees/:id/authorization`                                           |
| Assign                                                                  | `POST /api/v1/employees/:id/roles` `{expectedVersion, roleId, scope, reason}`       |
| Remove                                                                  | `POST /api/v1/employees/:id/roles/revoke` `{expectedVersion, assignmentId, reason}` |
| Branch names/timezones                                                  | `GET /api/v1/branches`                                                              |

A 409 reloads the assignments and the catalog.

## Containment and protections (unchanged, enforced by the API)

- `MANAGE_PERMISSIONS` is required at the changed scope and at every branch of the target
  (`requireTarget`). A GLOBAL scope needs GLOBAL authority.
- `checkGraphChange`:
  - `EXCEEDS_ACTOR`: a non-Owner confers only capabilities it holds;
  - `SELF_TARGET`;
  - `TARGET_PROTECTED`.
- The Owner has no employee profile and is a 404 target. There is no Owner workflow here.
- Branch validity: the branch must exist and be active.
- Every change increments the target's `authzVersion`, revokes their sessions and is
  audited.

## Assignment and revocation history

- The existing backend deletes the assignment row on revocation and records history in the
  audit log:
  - `ROLE_ASSIGNED` (after: assignment id, role id/code, scope);
  - `ROLE_REVOKED` (before: the same snapshot), with the reason.
- The UI states "Lịch sử gán/gỡ vai trò được lưu trong nhật ký kiểm toán." The integration
  test verifies both audit records survive a revocation.
- Ending employment does not touch role assignments. They stay visible, can be removed, and
  cannot be added to.

## Role catalog found

- **No roles are seeded** in code, migrations or bootstrap.
- The PRD (7.2) suggests `SENIOR_MANAGER`, `TEAM_LEADER` and `STAFF`/`KTV` only as
  examples.
- Roles are created and configured through the existing API (GLOBAL `MANAGE_PERMISSIONS`):
  - `POST /api/v1/roles` `{code, displayNameVi, displayNameEn, permissions, reason}`;
  - `POST /api/v1/roles/:id`;
  - `POST /api/v1/roles/:id/permissions`.
- **There is no role-administration UI.** Until one exists, KTV and Branch Manager roles
  must be created through the API by the Owner. This step deliberately creates no default
  roles.

## Tests

- **API: `apps/api/src/employees/role-assignment.integration.test.ts`, 5/5** (fixtures
  rolled back). By requested point:

  | Points     | What is checked                                                                                                                                                                                                                                                                                |
  | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 8–9        | The database classification enum is exactly TRAINEE, OFFICIAL_EMPLOYEE, ENDED.                                                                                                                                                                                                                 |
  | 1–4, 10–13 | KTV and branch-manager roles are assigned at branch scope by a branch-A administrator. Classification history, employee code, account status, password/credential version, branch assignments and skills are identical before and after. Audited.                                              |
  | 14–17      | Refused: a role carrying `MANAGE_EMPLOYEE_ACCESS` the actor lacks (FORBIDDEN); self-assignment (FORBIDDEN); the Owner as target (404); GLOBAL scope by a branch administrator (FORBIDDEN); branch B outside the actor's scope (FORBIDDEN). Nothing is assigned. The Owner can assign globally. |
  | 18–19      | After ending employment today, the existing role is still listed. A new role is refused with 409 `employment`. Revocation works, and the `ROLE_ASSIGNED`/`ROLE_REVOKED` audit records keep scope and reason.                                                                                   |

- **Web: `apps/web/src/lib/workforce/employee-roles.test.tsx`, 6/6:**
  - names, codes and distinct GLOBAL/branch badges, inactive role, VI/EN;
  - exact assign and remove requests;
  - role and scope options come only from the loaded data (active roles, the member's
    manageable branches);
  - the role UI source contains no hard-coded role names or IDs;
  - classification labels unchanged;
  - scope and containment hints, visibility rule, self and branch-only revoke rules;
  - ENDED: no new roles, existing ones visible and removable;
  - honest empty catalog.
- **Regressions:**
  - web 69/69, including Step 2 creation and Step 3 detail (points 20–21); `tsc --noEmit`
    passes;
  - integration: role-admin 8/8, authorization 4/4, employee 10/10, employment 11/11,
    workforce-account 11/11;
  - API unit/HTTP 86/0;
  - customer auth (point 22): registration 7/7, login 4/4, password reset 5/5.
- **Static checks:** eslint and boundaries pass; prettier passes.

## Deferred and limitations

- A role-administration UI (create roles, configure permissions, activate/deactivate) is a
  separate step. The API exists.
- Per-user permission overrides (ALLOW/DENY) have an API but no UI here.
- Role history is shown as a pointer to the audit log. There is no role-history list on
  the detail page yet (it needs `VIEW_AUDIT_LOG`).
- Skills (Step 5), payroll, booking and the full redesign are not part of this step.

## Files changed

- **API:**
  - `apps/api/src/authorization/role-admin.service.ts`: the ENDED guard in `assignRole`;
  - `apps/api/src/employees/role-assignment.integration.test.ts` (new);
  - `scripts/test-auth-integration.mjs`: registration.
- **Web:**
  - `apps/web/src/components/workforce/screens/employee-roles.tsx` (new);
  - `apps/web/src/lib/workforce/employee-roles.ts` (new);
  - `apps/web/src/lib/workforce/employee-roles.test.tsx` (new);
  - `apps/web/src/components/workforce/screens/employee-detail.tsx`: renders the section;
  - `apps/web/src/i18n/workforce.ts`: `roles` VI/EN.
- **Docs:** this report and `LUCYSPA_HANDOFF.md`. No PRD change was needed; 7.2 already
  defines roles as permission bundles.

## Next step

Two options:

- **Step 5: employee skill assignment** on employee detail. The existing section needs to
  become part of the lifecycle-aware flow, with ENDED handling.
- **Or first a minimal role-administration screen**, so the Owner can create KTV and
  Branch Manager roles without using the API directly.
