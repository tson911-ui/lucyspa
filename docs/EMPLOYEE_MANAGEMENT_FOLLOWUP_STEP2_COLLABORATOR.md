# Pre-Phase-3 follow-up Step 2: COLLABORATOR, manager invariant, titles, directory sections

**Status:** implemented and tested locally. One focused commit, pushed to `origin/main`.
**Not deployed.** Production is still at `fb0725d`. Two additive migrations and a read-only
production pre-check (below) must run as part of the next deployment.

Design and Owner decisions: [collaborator and My Account design](PHASE2_FOLLOWUP_COLLABORATOR_MY_ACCOUNT_DESIGN.md)
(Q1–Q16 resolved on 2026-09-26).

## Scope

Implemented:

- the `COLLABORATOR` (CTV) employment classification;
- the manager invariant (a manager-group role requires `OFFICIAL_EMPLOYEE`);
- the authoritative, server-derived display title;
- four exclusive directory sections.

Two small consequences that the decisions require were implemented because the new
classification would otherwise break them:

- Q16: a base salary is refused for COLLABORATOR and TRAINEE;
- Q15: collaborators cannot file leave requests.

**Not implemented:** collaborator schedule and agreed pay, My Account, email or password
self-service, My Income, and Phase 3. Nothing is bookable yet (Q13 is a Phase 3 rule).

## Database

| Migration                                            | Change                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `20261002000000_employment_collaborator`             | `ALTER TYPE "EmploymentClassification" ADD VALUE 'COLLABORATOR' BEFORE 'OFFICIAL_EMPLOYEE'` |
| `20261002000001_employment_collaborator_transitions` | `CREATE OR REPLACE FUNCTION lucy_check_employment_classification()` with the new matrix     |

Both are additive:

- no table, column or row is changed;
- effective-dated history is untouched and stays append-only;
- the enum value is in its own migration, because PostgreSQL cannot use a new enum value in
  the same transaction that adds it.

The transition matrix is enforced in both SQL and TypeScript:

| From         | Allowed to                                             |
| ------------ | ------------------------------------------------------ |
| (first row)  | TRAINEE, COLLABORATOR, OFFICIAL_EMPLOYEE (never ENDED) |
| TRAINEE      | COLLABORATOR, OFFICIAL_EMPLOYEE, ENDED                 |
| COLLABORATOR | OFFICIAL_EMPLOYEE, ENDED                               |
| OFFICIAL     | ENDED only (Q1: no OFFICIAL → COLLABORATOR)            |
| ENDED        | nothing (no rehire)                                    |

Every later row must have a strictly later effective date.

Locally, `prisma migrate diff` from the migrated database to `schema.prisma` is empty.

## Production pre-check

This is `pnpm db:precheck:collaborator`, implemented in
`packages/database/src/precheck-collaborator.ts` and `collaborator-precheck.ts`.

It is read-only: it runs in a `READ ONLY` transaction, prints what it finds and changes
nothing. It exits with code 1 when it finds:

1. an active manager-group role held by a member who is not `OFFICIAL_EMPLOYEE` today,
   using each member's branch-local today;
2. a base salary set on a member whose latest classification is not `OFFICIAL_EMPLOYEE`.

Findings are resolved by a human, for example by removing the role or clearing the salary.
Nothing is changed silently. Locally the check passed with 0 managers and 0 salaries.

## Manager invariant (API)

| Point | Rule                                                                                                                              | Refusal                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| E1    | Assigning an active manager-group role requires the target to be `OFFICIAL_EMPLOYEE` today                                        | `409 CONFLICT employmentClassification` |
| E2    | Making a role an active manager-group role, by flag or by reactivation, requires every holder to be OFFICIAL today                | `409 CONFLICT managerGroupHolders`      |
| E3/E4 | Recording any change (ENDED) for an `OFFICIAL_EMPLOYEE` who holds a manager-group role is refused; the role is removed first (Q3) | `409 CONFLICT managerRole`              |

Create as COLLABORATOR needs only `CREATE_EMPLOYEES` (Q2). The agreed pay, which comes in a
later step, will need the pay permission.

`setBaseSalary` refuses a non-null salary unless the latest classification is
`OFFICIAL_EMPLOYEE`. Clearing a salary is always allowed. Create refuses `baseSalaryVnd`
with a non-OFFICIAL classification (Q16).

`POST /leave-requests` refuses a COLLABORATOR today with `409 CONFLICT classification` (Q15).

## Titles

`apps/api/src/employees/workforce-title.ts` is the single source for titles.

| Condition (precedence order)                   | Title          | VI           | EN           |
| ---------------------------------------------- | -------------- | ------------ | ------------ |
| Owner                                          | `OWNER`        | Chủ Spa      | Spa Owner    |
| No classification in effect yet (future start) | `NOT_STARTED`  | Chưa bắt đầu | Not started  |
| ENDED in effect                                | `ENDED`        | Đã nghỉ      | Ended        |
| OFFICIAL + active manager-group role           | `MANAGER`      | Quản lý      | Manager      |
| OFFICIAL                                       | `EMPLOYEE`     | Nhân viên    | Employee     |
| COLLABORATOR                                   | `COLLABORATOR` | CTV          | Collaborator |
| TRAINEE                                        | `TRAINEE`      | Học viên     | Trainee      |

The title is exposed in three places:

- `EmploymentResponse.title`;
- `EmployeeDirectoryEntry.title`;
- `CurrentAccountResponse.workforceTitle` (`/auth/me`; absent for customers).

The web renders it and never recomputes it. The shell shows the signed-in account's title.
The detail header shows a title badge. The directory has a "Chức danh / Title" column; a
future start shows as "Chưa bắt đầu (từ dd/mm/yyyy)".

Classification labels were shortened to match: Học viên, CTV, Nhân viên, Đã nghỉ.

## Directory sections (Q5)

`GET /employees?group=MANAGERS|EMPLOYEES|COLLABORATORS|TRAINEES`. Each section is
server-paginated independently. A member appears in exactly one section:

- **Quản lý:** OFFICIAL today and holding an active manager-group role;
- **Nhân viên / CTV / Học viên:** by the classification in effect today;
- **ENDED:** placed by the last classification that was active before ENDED; they still
  follow the existing status and filter behavior;
- **not started yet:** placed by the upcoming classification;
- **no history (legacy):** Nhân viên.

The Owner is never in the directory. Sections render in the order Quản lý, Nhân viên, CTV,
Học viên, each with its own empty and filtered states.

## Web

- **Create:** a third explicit radio, "CTV", with its own hint. It needs no pay permission.
- **Detail:**
  - "Chuyển phân loại" offers only the matrix targets (TRAINEE → CTV / Nhân viên,
    CTV → Nhân viên), chosen explicitly;
  - ending a COLLABORATOR is supported;
  - the `managerRole` refusal is explained.
- **Roles:** manager-group roles are disabled, with a hint, for a member who is not official.
  The two new API refusals are explained.
- **Leave:** a collaborator sees a notice instead of the request form.

## Tests

| Suite                                                             | Result                                      |
| ----------------------------------------------------------------- | ------------------------------------------- |
| API auth/workforce integration (`test:auth:integration`)          | 163/163 pass (new `collaborator` suite 7/7) |
| API unit + HTTP                                                   | 86 pass, 0 fail (integration cases skipped) |
| Database integration                                              | 31/31 pass                                  |
| Web                                                               | 91/91 pass                                  |
| `pnpm typecheck`, `pnpm lint` (+ boundaries), `pnpm format:check` | pass                                        |

The new `collaborator.integration.test.ts` covers:

- creating a collaborator without the pay permission;
- the transition matrix, through the API and directly in SQL;
- E1, E2 and E3;
- titles and exclusive sections, including ended and not-started members;
- `/auth/me` titles;
- Q16 salary refusals;
- Q15 leave refusal;
- the pre-check detecting legacy data.

The web tests cover:

- the four sections, in order, with their empty and filtered states;
- title rendering and the "Chưa bắt đầu" date;
- the CTV radio;
- promotion targets;
- manager roles disabled for non-official members;
- the collaborator leave notice.

## Production deployment (not performed; requires Owner authorization)

1. Take a fresh database backup.
2. Run `pnpm db:precheck:collaborator` **before** migrating. It must report 0/0. Resolve any
   finding by hand first.
3. Deploy the code: `git pull`, then `pnpm install --frozen-lockfile` if the lockfile
   changed.
4. Run `pnpm db:deploy`. Two new migrations are expected.
5. Run `pnpm build`, then restart `lucyspa-api`, `lucyspa-web` and `lucyspa-worker` in PM2.
6. Run `pnpm db:precheck:collaborator` again. It must report 0/0.
7. Smoke checks:
   - `/auth/me` shows the Owner title "Chủ Spa";
   - the directory shows four sections;
   - creating a CTV works.

## Next

Step 3 is **My Account read + self profile edit**: `GET/POST /me/account`, phone and name
self-edit with audit (Q10/Q11), and the recovery email moving into Account & Security.
Collaborator schedule and pay remain Step 6. **Phase 3 is NOT STARTED.**
