# Employee management Step 4B: role management UI

Status: implemented and tested locally. Committed on its own as `feat: add role management
UI`, on top of `e6755ff`. **Not pushed, not deployed** (production is still `13f540e`).
No migration.

## Why

Step 4 made role assignment possible on employee detail, but the role catalog was empty.
The backend already had role administration, but there was no screen for it. With this
step the Owner (or a global permission administrator) can create roles such as KTV or
Branch Manager, choose each role's permissions explicitly, and assign them right away on
employee detail.

## What was implemented

**New page: Workforce › "Vai trò & quyền" / "Roles & permissions"** (`/{locale}/workforce/roles`,
management navigation group).

- **Navigation:** shown with `MANAGE_PERMISSIONS` in any scope. This matches the API's
  `GET /roles` rule.
- **Intro:**
  - a role is a permission bundle;
  - where it applies (all branches or one branch) is chosen when it is assigned to a
    member;
  - a role is not an employment classification.
- **Role list** (from `GET /api/v1/roles`): for each role it shows the localized name, the
  code, "Đang dùng" / "Đã tắt", both names, and its permissions with human labels. The
  technical code is shown as secondary text, and a "Chỉ toàn hệ thống" badge marks
  global-only permissions.
- **Empty state:** "Chưa có vai trò. Tạo vai trò đầu tiên để gán cho nhân sự." /
  "No roles yet. Create the first role to assign it to workforce members."
- **"Tạo vai trò" / "Create role"** (`POST /api/v1/roles`) asks for:
  - the code (checked live against the API rule: `A-Z0-9_`, starts with a letter, not
    `OWNER`; it cannot be changed later);
  - the Vietnamese and English names;
  - permissions, all unchecked initially, so there is no default bundle;
  - a reason.
- **"Sửa vai trò" / "Edit role"** per role:
  - the code is shown read-only;
  - names can be changed (`POST /roles/:id`) and the complete permission set replaced
    (`POST /roles/:id/permissions`). The permission call uses the version returned by the
    rename;
  - "Tắt vai trò" / "Bật lại vai trò" (the existing `isActive` update);
  - a note that permission changes apply immediately to everyone holding the role and sign
    them out;
  - a reason is required for every change.
- **Scope help** ("Phạm vi áp dụng"):
  - every permission can apply per branch or globally, chosen at assignment;
  - "Chỉ toàn hệ thống" permissions work only when the role is assigned globally;
  - catalog actions (services, skills, creating branches) also need a global assignment.
- **Read-only accounts:** branch-scoped administrators see the roles, with the note that
  creating and editing need global role management.
- **Success notices** are shown at page level. After each save the form reloads with the
  role's new version.
- **Step 4 reuse:** the employee-detail role assignment loads the same catalog, so a new
  role is immediately assignable (proven in the integration test).

## Permission catalog (source of truth)

- **Where it comes from:** the list, order and scope capability come only from the API.
  - `GET /api/v1/roles` now also returns `permissionCatalog: {code, scopeCapability}[]`.
  - This is the code-owned `PERMISSION_CATALOG`, previously exposed only as bare codes.
  - It is the only API change: additive, read-only metadata. Nothing was renamed or added.
- **Frontend additions:**
  - human VI/EN labels keyed by code;
  - a display grouping: Nhân sự, Lương & phân loại, Vận hành, Danh mục, Quản trị.
  - A code without a label still appears, under "Khác", with its raw code.
- **Global-only permissions:** only `MANAGE_SERVICE_PRICES` is GLOBAL_ONLY.

## Containment and security (unchanged, enforced by the API)

- **Who may change roles:** creating, renaming, activating and changing permissions need
  GLOBAL `MANAGE_PERMISSIONS`, because roles are shared global resources.
- **Containment:** a non-Owner may only put in a role permissions it holds with
  unrestricted GLOBAL authority (`requireBundleHeld`). Adding a permission counts;
  removing never does.
- **Edits to assigned roles:** permission changes re-check every current holder of the
  role (`checkGraphChange`, `EXCEEDS_ACTOR`) and sign them out.
- **Self-escalation:** a non-Owner cannot modify a role assigned to themself.
- **Role code:** `OWNER` is rejected, and there is no Owner role. The Owner is not an
  employee and is never a role target.
- **UI hints only:** permissions the actor cannot add are disabled with "bạn không có quyền
  này trên toàn hệ thống". Permissions already in the role stay removable. The API remains
  authoritative, and its refusals are explained.

## Role scope vs assignment scope

The role carries no branch; its request has only code, names, permissions and reason. The
assignment on employee detail chooses GLOBAL or one branch. One "Branch Manager" role
assigned at "Lucy Spa Đà Nẵng" is enough; there are no per-branch duplicate roles.

## Deletion

The backend has no role deletion. Roles are switched off instead (`isActive: false`): a
switched-off role grants nothing, but stays in the list and on existing assignments. No
delete action is offered.

## Role catalog after this step

- Still empty. No KTV, Branch Manager or other roles were seeded, and no permission
  bundles were assumed.
- The Owner creates them in this screen and chooses their permissions explicitly.
- A test asserts that no roles with these codes exist.

## Deferred

- Per-user permission overrides (ALLOW/DENY): the API exists, but there is no UI.
- A role-history view (the audit log keeps `ROLE_CREATED`, `ROLE_UPDATED` and
  `ROLE_PERMISSIONS_CHANGED`).
- Skills (next), payroll, booking, and the full UI redesign.

## Tests

- **API: `role-assignment.integration.test.ts` — 6/6.** The new Step 4B subtest checks:
  - the `UserKind` enum is unchanged and no KTV or manager roles are seeded;
  - `permissionCatalog` equals the permission list;
  - a global non-Owner administrator creates a role with its chosen permission;
  - creating a role, or adding permissions, with powers the administrator lacks is
    FORBIDDEN;
  - an `OWNER` code is rejected;
  - a branch-scoped administrator cannot create roles;
  - renaming keeps the code, and the new permission set persists and is listed;
  - the created role is immediately assignable at branch scope (the assignment, not the
    role, carries the branch);
  - `ROLE_CREATED` is audited with its reason.
- **API: `role-admin.integration.test.ts` — 8/8.** It now asserts the catalog metadata:
  only `MANAGE_SERVICE_PRICES` is global-only.
- **Web: `role-admin.test.tsx` — 6/6.**
  - empty state (VI/EN);
  - role display, labels, and a global-only marker once per checklist;
  - catalog grouping and order, with an unknown code kept visible;
  - no hard-coded roles or ids;
  - exact create, rename, permission and activation requests and URLs;
  - the code is never an input, and code validation;
  - containment hints: disabled if not held or denied; already-held permissions stay
    removable;
  - error messages;
  - view-only vs edit rights;
  - classification unchanged; the intro and help texts explain assignment scope; no
    branch field on roles; no preselected permissions.
- **Web: `permissions.test.ts`** now includes the navigation entry.
- **Regressions:**
  - web 75/75 (Steps 2–4 included); `tsc --noEmit` passes;
  - integration: authorization 4/4, employee 10/10, employment 11/11,
    workforce-account 11/11;
  - API unit/HTTP 86/0;
  - customer auth: registration 7/7, login 4/4, password reset 5/5.
- **Static checks:** eslint and boundaries pass; prettier passes.
- **Visual check:** 375 px, headless Edge.

## Files changed

- **API:**
  - `apps/api/src/authorization/role-admin.service.ts`: `permissionCatalog` in `listRoles`;
  - `role-admin.integration.test.ts`;
  - `apps/api/src/employees/role-assignment.integration.test.ts`.
- **Contracts:** `packages/contracts/src/index.ts` (`PermissionScopeCapability`,
  `RoleListResponse.permissionCatalog`).
- **Web, new:**
  - `app/[locale]/workforce/(app)/roles/page.tsx`;
  - `components/workforce/screens/roles.tsx`;
  - `lib/workforce/role-admin.ts`;
  - `lib/workforce/role-admin.test.tsx`.
- **Web, changed:**
  - `lib/workforce/permissions.ts`: navigation;
  - `lib/workforce/permissions.test.ts`;
  - `lib/workforce/employee-roles.test.tsx`: fixture field;
  - `i18n/workforce.ts`.
- **Docs:** this report and `LUCYSPA_HANDOFF.md`. No PRD change was needed.

## Next step

Step 5: employee skill assignment on employee detail, which is separate from roles.
