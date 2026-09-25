# Employee management Step 5: employee skill assignment UI

**Status:** implemented and tested locally. Committed on its own as `feat: add employee skill
assignment UI`, on top of `f7badbb`. **Not pushed, not deployed.** Production is still at
`13f540e`. No migration.

## Skill vs role vs classification

| Concept                   | Answers                                                          | Where               |
| ------------------------- | ---------------------------------------------------------------- | ------------------- |
| Employment classification | Relationship with Lucy Spa (TRAINEE / OFFICIAL_EMPLOYEE / ENDED) | "Phân loại nhân sự" |
| Role                      | What the member may do in the system (permission bundle)         | "Vai trò"           |
| **Skill**                 | **Which services the member is qualified to perform**            | **"Kỹ năng"**       |

Skills are employee-level qualifications from the existing Phase 2 skill catalog. They are
not per branch.

Nothing derives one concept from another:

- no automatic skills on creation, promotion or role assignment;
- no role granted or removed when skills change;
- no skill inferred from the employee code or classification.

The integration test proves each of these.

## What was implemented

**Web — the "Kỹ năng / Skills" section of employee detail** was rebuilt as
`employee-skills.tsx`. It replaces the Phase 2 inline section on the same page.

- **Intro:** states the separation from roles, permissions, classification and branch.
- **"Kỹ năng hiện có":**
  - each current skill shows its localized name, code and an "Đang có" badge;
  - it shows "từ {grant time}", in the member's branch timezone;
  - it notes when the skill is switched off in the catalog.
- **"Gán kỹ năng":**
  - the choices are the active catalog skills not already held, loaded from
    `GET /api/v1/skills`;
  - an optional reason is sent only when filled (the existing contract).
- **"Gỡ kỹ năng"** removes a current skill. The earlier grant is kept, and the message says
  so.
- **"Lịch sử kỹ năng đã gỡ":** removed grants with their grant and removal times.
- **Honest states:**
  - empty catalog: "Danh mục kỹ năng chưa có kỹ năng nào đang dùng…";
  - every skill already held;
  - ENDED employment;
  - disabled account.
- **Read-only access:** readers without `MANAGE_SKILLS` see skills and history, but no
  controls.
- VI and EN strings; phone layout checked at 375 px.

**Backend** (existing commands; two minimal changes):

1. **History:** `GET/POST …/employees/:id/skills` responses now include
   `history: EmployeeSkillHistoryEntry[]`. These are the existing revoked `EmployeeSkill`
   rows (`revokedAt` set), most recent first. The field is additive; `skills` is unchanged.
   Rows were already kept and never deleted; the API just did not return them.
2. **ENDED guard:** `grantEmployeeSkill` refuses with 409 `employment` when ENDED is in
   effect on today's business date. This matches the Step 3/4 no-rehire guards. The
   existing INACTIVE-status guard stays, and revocation stays possible.

## APIs used

| Action                   | API                                                             |
| ------------------------ | --------------------------------------------------------------- |
| Catalog                  | `GET /api/v1/skills`                                            |
| Current skills + history | `GET /api/v1/employees/:id/skills`                              |
| Assign                   | `POST /api/v1/employees/:id/skills` `{skillId, reason?}`        |
| Remove                   | `POST /api/v1/employees/:id/skills/:skillId/revoke` `{reason?}` |

- Removal sets `revokedAt`; nothing is deleted.
- Re-granting a skill creates a new row, so each qualification period stays visible.
- Grants and removals are audited as `EMPLOYEE_SKILL_GRANTED` / `EMPLOYEE_SKILL_REVOKED`,
  with the reason.

## Lifecycle behaviour

- **TRAINEE:** may hold skills; classification never blocks assignment.
- **OFFICIAL_EMPLOYEE:** gets no automatic skills. Promotion leaves skills untouched.
- **ENDED in effect:** "Gán kỹ năng" is not offered and the API refuses it. Current skills
  and history stay visible, and removal stays possible.
- **INACTIVE account:** no new skills (existing rule).

## Authorization (existing, unchanged)

- `MANAGE_SKILLS` is required over every branch of the member (`requireAcross`).
- Non-Owners cannot change their own skills.
- The Owner and customers are never targets (404).
- Reading skills: the member themself, `VIEW_EMPLOYEES`, or `MANAGE_SKILLS` over the
  member.
- The UI hides controls using the same all-branch rule; the API remains authoritative.

## Tests

- **API: `employee-skills.integration.test.ts`, 5/5** (fixtures rolled back). By requested
  point:

  | Points     | What is checked                                                                                                                                                                                                                                          |
  | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 6–7, 11–14 | A TRAINEE receives a skill. A new OFFICIAL_EMPLOYEE has none. Roles, classification history, status, password, employee code and branch assignments are unchanged by granting.                                                                           |
  | 1, 3–5     | Assign two skills and remove one: current vs history in the response. Re-granting creates a new row (3 stored rows, none deleted). The revoke reason is audited.                                                                                         |
  | 8–10       | Promotion and role assignment leave the skill rows identical. A skill grant leaves role assignments unchanged.                                                                                                                                           |
  | 15–17      | After ending employment today (access kept), a new skill is refused with 409 `employment`. The current skill stays visible and removal still works. Refused: a viewer without `MANAGE_SKILLS`, a member in another branch, oneself, and the Owner (404). |

- **API: `skills/skill.integration.test.ts` 4/4 and `skill.http.test.ts` 1/1**, unchanged
  and passing.
- **Web: `employee-skills.test.tsx`, 5/5:**
  - current vs history display, with times in the branch timezone, VI/EN;
  - options come only from the loaded catalog (active, not held); no hard-coded ids or
    names;
  - empty catalog;
  - exact grant and revoke requests, with the optional reason omitted when blank; never a
    delete;
  - blockers for ENDED and INACTIVE, while current skills, history and removal stay;
  - the all-branch rule, self and read-only viewers.
- **Regressions:**
  - web 80/80 (Steps 2–4B included); `tsc --noEmit` passes;
  - integration: role-assignment 6/6 (Step 4 and 4B), role-admin 8/8, employee 10/10,
    employment 11/11, workforce-account 11/11;
  - API unit/HTTP 86/0;
  - customer auth: registration 7/7, login 4/4, password reset 5/5.
- **Static checks:** eslint and boundaries pass; prettier passes.

## Limitations

- Skills are employee-level. Branch-specific qualification, and combining role, skill and
  branch availability for booking, belong to Phase 3.
- Skill catalog management remains the existing Phase 2 "Kỹ năng" page.
- There is no per-skill effective date; grant and removal times are recorded.

## Files changed

- **API:**
  - `apps/api/src/skills/skill.service.ts`: `history` in responses, and the ENDED guard;
  - `apps/api/src/employees/employee-skills.integration.test.ts` (new);
  - `scripts/test-auth-integration.mjs`.
- **Contracts:** `packages/contracts/src/index.ts` (`EmployeeSkillHistoryEntry`,
  `EmployeeSkillsResponse.history`).
- **Web:**
  - new: `apps/web/src/components/workforce/screens/employee-skills.tsx`,
    `apps/web/src/lib/workforce/employee-skills.ts` and its test;
  - changed: `employee-detail.tsx` (uses the new section; old inline section removed) and
    `i18n/workforce.ts`.
- **Docs:** this report and `LUCYSPA_HANDOFF.md`. No PRD change was needed.

## Next step

Employee management now covers:

- creation with login;
- lifecycle (promotion, ending, reset, status);
- roles and role management;
- skills.

**Recommended:** review, then one combined deployment of the Employee Management commits,
with a verified backup, `pnpm db:deploy` for the pending migrations, and a post-deploy
check. After that, Phase 3 booking planning can combine roles, skills and branch
availability.
