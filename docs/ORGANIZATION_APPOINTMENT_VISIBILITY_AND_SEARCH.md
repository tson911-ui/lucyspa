# Organization appointment visibility and employee search

Status: **IMPLEMENTED AND OWNER APPROVED. Production deployment PENDING (not deployed).**
Builds on [ORGANIZATION_HIERARCHY_TEAM_MANAGEMENT.md](ORGANIZATION_HIERARCHY_TEAM_MANAGEMENT.md).
No database change, no migration, no change to Organization or hierarchy rules.

## Problems fixed

1. **Employee search in Organization → Management appointments** ("Tìm theo tên hoặc mã nhân viên")
   did not really search. The directory only matched the whole typed phrase as a case-insensitive
   substring, so accent-less input, word-separated partial names and other Unicode spellings failed
   ("trần h" did not reliably find "LUCY01 – Trần Hoàng Anh Thư"). The UI also sent an empty `q`
   (rejected by the API), fired a request per keystroke and kept a stale selection.
2. **Management level was invisible.** The Employees page "Chức danh" column is the employment
   title (classification and legacy manager-group role) and never read Organization Appointments,
   so an employee with an active CEO appointment still showed "Quản lý".

## Implementation

### Search

- `apps/api/src/employees/employee-search.ts`: `foldSearch` (NFC, strip diacritics, `đ`→`d`,
  lower case) and `searchEmployeeIds`, resolved in PostgreSQL before scoping and paging. A match is
  the folded phrase contained in the folded name or employee code, or every whitespace-separated
  term being the start of a name word (or contained in the code). LIKE metacharacters are escaped;
  patterns are bound parameters.
  Examples: "trần h", "TRAN H", "tran hoang anh", "anh thư", "thu" and the employee code (any
  case) all find LUCY01; "Nguyễn Trần Anh" is not matched by "trần h".
- `employee-directory.service.ts` uses it for `q`; every scope, hierarchy and permission filter is
  applied unchanged afterwards. Other directory consumers benefit too.
- `organization.tsx` (appointment form): debounced (250 ms), empty query not sent, stale selection
  cleared when it leaves the results.
- Not changed: the team-member search (`TeamService`) keeps its own matching.

### Management level (Cấp quản lý)

- Contract: `EmployeeDirectoryAppointment { id, level, scope, teamId, teamName }`; optional
  `organizationAppointments` on `EmployeeDirectoryEntry` (list) and `EmployeeResponse`
  (`GET /employees/:id` only).
- One shared authorization helper, `employee-appointments.ts` → `visibleAppointments`, used by the
  directory and the detail read: an appointment is returned only when the caller holds
  `VIEW_ORGANIZATION` or `MANAGE_ORG_ASSIGNMENTS` at its scope (Owner: every scope), the team (if
  any) is active, and employment has not ended. The field is omitted when there is nothing to show.
- Display (`management-levels.tsx`, shared by list and detail): a "Cấp quản lý" column on the list
  and a "Cấp quản lý:" line beside the title on the detail page, each active appointment as one
  label such as `CEO / Quản lý cấp cao · Toàn hệ thống` or `Trưởng nhóm · Chi nhánh A (Nhóm 1)`.
  Several appointments are all shown, none singled out; `—` when there is none; only offered to
  callers who may see appointments (the API is the authority, the UI check is a hint).
- The employment title is never replaced or overwritten.

## Files

- API: `employees/employee-search.ts`, `employee-search.test.ts`, `employee-appointments.ts`,
  `employee-directory.service.ts`, `employee.service.ts`.
- Contracts: `packages/contracts/src/index.ts`.
- Web: `screens/organization.tsx`, `screens/employees.tsx`, `screens/employee-detail.tsx`,
  `screens/management-levels.tsx`, `lib/workforce/employee-appointments.ts` and its test.
- Tests: `employee-directory.integration.test.ts`, `employee.integration.test.ts`.

## Validation (targeted; full regression not rerun)

- Typecheck (all packages), lint, format: pass.
- Unit: `employee-search` 3/3; web 140/140 (includes appointment labels: system CEO, several
  appointments, none).
- Integration against the isolated validation database: employee-directory 7/7 (Vietnamese search
  cases, scope still applied after search, management level hidden without visibility and shown
  with it, no appointment → no field); employee 11/11 (detail shows active appointments only to
  permitted callers, ended ones dropped); employee-directory-groups 5/5; role-assignment 6/6;
  workforce-account 11/11; employment 11/11; branch-assignment 5/5; collaborator 7/7.
- Not verified visually in a browser.

## Limitations / deferred

- Team-member search keeps the previous matching.
- Employee detail lists appointments read-only; managing them remains in Organization.
- Region/area names for appointment scopes come from the caller's account organization tree.

## Production

**Not deployed.** This patch has no migration; deploying it is a normal application rollout after
the organization checkpoint (`14b5bcd`) deployment steps in
[ORGANIZATION_HIERARCHY_TEAM_MANAGEMENT.md](ORGANIZATION_HIERARCHY_TEAM_MANAGEMENT.md).
