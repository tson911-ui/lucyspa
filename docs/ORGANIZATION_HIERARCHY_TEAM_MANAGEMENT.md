# Organization Hierarchy and Team Management

Status: **IMPLEMENTED, PENDING OWNER APPROVAL. Not committed, not pushed, not deployed.**
Product rules: [LUCY_SPA_PRD.md §7.2a](../LUCY_SPA_PRD.md). Handoff: [LUCYSPA_HANDOFF.md](../LUCYSPA_HANDOFF.md).

The Notification Center, revenue notifications and the Hệ thống / Dịch vụ / Khách hàng / Tin tức
redesign are **not** part of this work. No new notification or delivery is implied.

## Locked model

```
Owner (separate, protected)
→ CEO / Senior Manager → Regional Manager → Area Manager → Store Manager
→ Deputy Store Manager → Team Leader → Employee / KTV / CTV / Trainee
```

Scope ancestry: `SYSTEM (persisted as GLOBAL) → REGION → AREA → BRANCH`.

- Regions and Areas are configurable rows (`regions`, `areas`, `branches.area_id`); no geography is hard-coded.
- Hierarchy semantics are code-owned (`OrganizationLevel`, `ORGANIZATION_RANK` in
  `packages/server/src/organization.ts`). Role display names and `isManagerGroup` never grant
  authority or seniority; Owner explicitly configures appointments.
- Authorization = **permission + scope + hierarchy + containment**. Hierarchy is an additional
  restriction and never a grant. ALLOW/DENY semantics (DENY wins; ancestor DENY beats narrower
  ALLOW) and Owner protection are preserved.
- Store Manager and above are attendance-exempt. Deputy Store Managers and Team Leaders still
  check in and out. Deputies are unlimited. Teams are unlimited per branch.
- Teams: one active membership per employee per branch; at most one active Team Leader per team
  (or none); one eligible Team Leader may lead several teams; archive/delete preserves the
  employee, employment and history.

## Data model (additive migrations, not yet applied)

| Migration                                 | Contents                                                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261011000000_organization_scope_enums` | `ScopeKind` += `REGION`, `AREA`; `PermissionCode` += `VIEW_ORGANIZATION`, `MANAGE_ORGANIZATION`, `MANAGE_ORG_ASSIGNMENTS`, `VIEW_TEAMS`, `MANAGE_TEAMS` (committed separately, before constraints use them).      |
| `20261011000001_organization_teams`       | `regions`, `areas`, `branches.area_id`, region/area columns and consistency checks on role assignments and permission overrides, `teams`, `organization_assignments`, `team_memberships`, triggers, catalog rows. |

Integrity enforced in PostgreSQL (these partial unique indexes are the concurrency guarantee):

- `team_memberships_active_employee_branch_key` — one active team per employee per branch.
- `organization_assignments_team_leader_key` — one active Team Leader per team.
- `organization_assignments_active_key` — no duplicate active appointment (no cap on Deputies).
- Composite FKs `(team_id, branch_id)` keep teams and their relationships in one branch; a team's
  branch is immutable.
- `lucy_guard_organization_history` — relationships can only be _ended_ once (no rewrite, reopen or
  delete). `lucy_check_organization_relationship` — an active relationship needs an active branch
  membership and an active team. `lucy_guard_team_relationships` — a team cannot be archived while
  it has active members or a leader.
- Scope-consistency CHECKs on `user_role_assignments`, `user_permission_overrides` and
  `organization_assignments`; `GLOBAL_ONLY` permissions cannot be overridden at a subordinate scope.

Prisma representation limitation (not unintended drift): `organization_assignments` and
`team_memberships` each carry a single-column FK `team_id -> teams(id)` (modelled in
`schema.prisma`) **and** a hand-written composite FK `(team_id, branch_id) -> teams(id, branch_id)`
that guarantees a relationship's branch equals its team's branch. Prisma can declare only one
relation per field, and the schema keeps the single-column one so the ORM relations stay simple,
so `prisma migrate diff` reports exactly those two composite FKs as "to be removed" and nothing
else. Partial unique indexes, CHECKs and triggers are likewise invisible to Prisma. The diff was
verified to show no other difference; the composite FKs are exercised by the integration test.
Do **not** apply that diff as a migration: it would drop the same-branch guarantee.
Team/region/area `code` is validated by the API against the same pattern as the database CHECK
(`^[A-Z][A-Z0-9_]{0,63}$`, upper-cased on input).

### Employment / branch relationship ends => no active team relationship

Invariant: an employee never keeps an active team membership or appointment after the relevant
employment or branch relationship has ended. Rows are _ended_ (`ended_at`), never deleted, so
history is retained.

- **Branch assignment revoked** (`changeScope`): in the same exclusive transaction the employee's
  active memberships and appointments in the removed branches are ended, affected teams are
  version-bumped, authorization is invalidated, and `ORGANIZATION_RELATIONSHIPS_ENDED`
  (`cause: BRANCH_ASSIGNMENT_REVOKED`) is audited. A DB trigger also refuses new active
  relationships without an active branch membership.
- **Employment ended, effective today or earlier** (`endEmployment`, now an exclusive command): all
  of the employee's active memberships and appointments (every branch, and region/area/system
  appointments) are ended in the same transaction and audited (`cause: EMPLOYMENT_ENDED`).
- **Employment ended with a future effective date** (there is no scheduler): the employee stays
  employed until that date. Once it is due, (a) the authority graph ignores their appointments and
  memberships immediately, (b) team member counts and leader display exclude them, and (c) every
  exclusive team command first sweeps and ends the relationships of employees whose employment has
  ended (`ORGANIZATION_RELATIONSHIPS_ENDED`, `cause: EMPLOYMENT_ENDED`), so they never block or
  linger in team operations.
- Deactivating an account (INACTIVE) is not ending employment and keeps relationships; inactive
  accounts cannot sign in and are excluded from candidate selection.

No user, role, permission grant, region, area or team is created or inferred by migration. The
five permission catalog rows are inserted by the migration and also listed in
`PERMISSION_CATALOG`; the operator `db:permissions:sync` remains idempotent.

## Authorization

- `packages/server/src/authorization.ts` — `Scope` gains `REGION`/`AREA`; `scopeContains` derives
  ancestry from PostgreSQL (never request hints); grants need an active scope; DENY at any
  containing scope wins, and (for unrestricted checks) a DENY on any descendant blocks an ancestor grant.
- `authorization.store.ts` — the authority graph loads the organization tree, active appointments
  (ignoring archived teams and inactive scopes) and active team memberships.
- `packages/server/src/organization.ts` — `canSupervise`, `canManageTeam`, `canAppoint`,
  `attendanceExempt`, `supervisorWhere` (SQL-equivalent filter applied _before_ paging so pages and
  totals never leak invisible employees) and `attendanceExemptEmployeeIds`.
- `apps/api/src/authorization/authorization.ts` — delegation containment/graph-change checks expand
  the capability universe over regions, areas, branches **and symbolic future descendants**, and
  require `canSupervise`.
- `apps/api/src/authorization/organization-policy.ts` — `requireSupervision` / `scopeBranchIds`,
  applied additionally (not instead) in attendance correction/list, leave list/decision,
  collaborator work, skills, employee directory/service, and role administration.

## API

`/api/v1/organization` (snapshot, regions, areas, branch placement, appointments; versioned,
audited, exclusive-locked) and `/api/v1/teams` (list, get, create, rename, delete, leader,
candidate employees, bulk members). Team Leader appointment is only through the versioned team
command. Bulk membership accepts either ≤100 explicit ids or _all matching_ filters (with ≤100
exclusions and a stable user-id cursor); the server processes 100 per batch, re-authorizes every
row inside the authoritative transaction, and rejects the batch if any row became ineligible.
Completed batches stay committed if a later batch fails.

## Attendance and availability

- Check-in/out is refused with `FORBIDDEN` for Store-Manager-or-higher (`attendanceExempt`). The web
  attendance screen hides the actions and explains the exemption (`attendanceRequired` on `/auth/me`).
- Operational availability treats an _exempt official employee with an active, contained
  appointment_ as present (`attendanceExemptEmployeeIds`); `NOT_CHECKED_IN` still applies to
  everyone else, including Deputy Store Managers and Team Leaders. Other availability rules
  (leave, skills, branch, overlap, CTV schedule) are unchanged.
- Existing attendance history is untouched; an already-open record is resolved through the
  existing authorized correction flow, never automatic checkout.

## Web

- `/workforce/organization` — regions/areas CRUD, branch placement, appointments (append-only end).
- `/workforce/teams` and `/workforce/teams/[id]` — search/filter, create/edit/delete (archive) with
  confirmation, assign/change/remove Team Leader, and bulk add/remove/transfer with checkbox
  selection, **Select Page**, **Select All Matching**, **Clear Selection**, batch progress, and
  selection reset on filter change. Client permission checks are UX hints only.
- Navigation entries and vi/en text (`i18n/organization.ts`, `i18n/workforce.ts`); roles UI
  understands region/area scopes.

## Legacy organization bootstrap (production deployment gate)

The hierarchy is enforced additionally to permissions, so an existing manager who holds
permissions but no appointment would lose employee, leave, attendance, directory, skill,
work-schedule and permission administration over other employees the moment the new application
serves them. The operator command below removes that gap **before** enforcement reaches them. It is
a one-time migration aid, not a fallback: authorization itself never consults legacy data.

```
pnpm organization:bootstrap                 # DRY RUN (default): report only, changes nothing
pnpm organization:bootstrap -- --json       # machine-readable dry run
pnpm organization:bootstrap -- --check      # deploy gate: exit 1 while appointments are pending
                                            #   or manual-review cases remain
pnpm organization:bootstrap -- --apply      # create the derived appointments
```

Code: `apps/api/src/bootstrap/organization-bootstrap.ts` (+ `.cli.ts`). Never runs on startup.

**Evidence used.** Only authoritative rows: active role assignments (with the role's permissions),
ALLOW overrides, active branch memberships, account status and the employment classification on the
business date. Never a display name, never `isManagerGroup`, never a hard-coded id. The set of
permissions that count is code-owned (`HIERARCHY_GATED_PERMISSIONS`): the permissions whose use on
other employees is now hierarchy-gated (VIEW/CREATE/UPDATE_EMPLOYEES, MANAGE_EMPLOYEE_STATUS/ACCESS/
SCOPE/PAY, VIEW_EMPLOYEE_PAY, MANAGE_PERMISSIONS, MANAGE_SKILLS, VIEW/MANAGE_ATTENDANCE,
APPROVE_LEAVE, VIEW/MANAGE_WORK_SCHEDULE). Booking, service, branch and catalog permissions do not
qualify: they never act on another employee.

**Mapping (per employee, deterministic order).**

| Existing authority                                                                        | Result                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Effective gated grant at BRANCH _b_, active membership of _b_, official + ACTIVE employee | **Automatic:** one `DEPUTY_STORE_MANAGER` appointment at _b_ (one per such branch; multi-branch employees get exactly their own branches). |
| Same, but a DENY cancels every gated grant at _b_                                         | Skipped `AUTHORITY_FULLY_DENIED` (a partial DENY still maps: the appointment grants no permission and DENY keeps narrowing).               |
| Grant at a branch without an active membership                                            | Skipped `DORMANT_GRANT_NO_ACTIVE_BRANCH_MEMBERSHIP`.                                                                                       |
| An active appointment of Deputy level or above already covers _b_                         | Skipped `ALREADY_APPOINTED` (no duplicate; also what makes a repeat run a no-op).                                                          |
| Effective SYSTEM (GLOBAL) gated grant                                                     | **Owner review** `GLOBAL_LEGACY_AUTHORITY`: never guessed as CEO/Regional/Area. Branch grants of the same person still map automatically.  |
| REGION/AREA gated grant                                                                   | **Owner review** `REGION_OR_AREA_LEGACY_AUTHORITY`.                                                                                        |
| Gated permissions but not an official employee (Trainee, Collaborator, unclassified)      | **Owner review** `NOT_OFFICIAL_EMPLOYEE`: nothing is appointed.                                                                            |
| Employment ended / account not ACTIVE                                                     | Skipped `EMPLOYMENT_ENDED` / `NOT_ACTIVE`.                                                                                                 |
| No gated permission at all                                                                | Nothing (counted only).                                                                                                                    |
| Owner                                                                                     | Never a candidate: the Owner stays outside the hierarchy and is never converted.                                                           |

**Why Deputy, not Store Manager.** Deputy is the minimum position that keeps supervision of
everyone below it in the branch, keeps the person on attendance (Store Manager and above are
exempt, which would silently change an obligation), and grants nothing itself. Consequences the
Owner should know: two bootstrapped managers at the same branch are peers and do not supervise each
other (before, permission containment alone allowed a stronger manager over a weaker one);
promoting someone to Store Manager, or placing anyone at Region/Area/System, is an explicit Owner
action in the Organization screen.

**Safety properties.** Apply is one transaction under the exclusive authorization-graph lock; it
only inserts (no row is edited or removed); appointments are created strictly where effective
authority already existed, so no capability is broadened (appointments confer no permission and
permission decisions are unchanged, which the integration test asserts); the partial unique index
also forbids duplicates; the run is idempotent. Provenance: every appointment has an
`ORGANIZATION_APPOINTED` audit event with `actorKind = BOOTSTRAP`, reason "Legacy organization
bootstrap", `source = LEGACY_ORGANIZATION_BOOTSTRAP`, the level, scope, the operator execution
context and the exact causes (permission, role code or ALLOW override, scope); the grantor recorded
on the row is the Owner; one `ORGANIZATION_BOOTSTRAP_RUN` summary is written per applying run.
Affected employees' sessions are revoked (authorization version bump), as for any appointment.

**Deployment order.**

1. Back up the database.
2. `pnpm db:deploy` (additive migrations; the **old** application keeps running safely, it ignores
   the new tables and enum values).
3. `pnpm db:permissions:sync` (operator step; idempotent, the migration already inserted the rows).
4. `pnpm organization:bootstrap` dry run; the Owner reviews appointments, manual-review and skipped
   lists.
5. `pnpm organization:bootstrap -- --apply` (harmless to the old application).
6. `pnpm organization:bootstrap -- --check`: appointments pending must be 0 (manual-review entries
   are the Owner's decisions and may remain; they are listed, never guessed).
7. Roll out the new application. Managers keep their capabilities through their appointments.
8. Owner resolves each manual-review employee in the Organization screen (CEO, Regional, Area,
   Store Manager, or leave as is), then re-run `--check` for an empty report.

Rollback before step 7 needs no bootstrap undo (appointments are inert to the old application).

## Tests added

- `apps/api/src/authorization/organization-scopes.test.ts`, `organization-policy.test.ts` — scope
  containment, DENY, Owner protection, rank, Team Leader containment, appointment validity,
  attendance exemption.
- `apps/api/src/teams/team.selection.test.ts`, `apps/web/src/lib/workforce/teams.test.ts` — selection
  contracts and client selection state.
- `apps/api/src/bootstrap/organization-bootstrap.integration.test.ts` — the legacy bootstrap (mapping,
  containment, Owner, idempotence, manual review, ended/inactive, provenance, no broadening).
- `packages/database/src/organization-foundation.integration.test.ts` — the constraints above
  against real PostgreSQL (rolled back). Catalog-size assertions updated 26 → 31.

## Deferred / known limits

- No UI to list or restore archived teams; team codes of archived teams stay reserved per branch.
- Notification Center / revenue notifications and routing delivery (foundation only, see PRD).
- Concurrency is proven at the database-constraint level; there is no multi-connection race test.

## Final validation

See the section appended by the validation gate below.
