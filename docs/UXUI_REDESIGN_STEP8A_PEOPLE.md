# UX/UI Step 8a: Skills (finish), Roles, Teams, toasts, permission-change notice

Status: local, not committed, not deployed. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 8 (8a).

## What changed

- **Toasts**: `ToastProvider` mounted in the workforce shell (`WorkforceToasts`). `useSubmit` and the new `useSuccessToast()` turn success into a toast (no provider, e.g. tests: old behaviour). Errors stay in place. Skills, Roles, Teams use it; other screens with their own success `Notice` state move when their Step comes.
- **Permission change notice**: API 401 for a session ended only by a role/scope change now carries `reason: AUTHORIZATION_CHANGED` (`/auth/me` and the admin command frame; no migration: the revoked session keeps its old `authzVersion`). Web: `ApiError.reason`; kept page shows "Quyền của bạn đã thay đổi, vui lòng đăng nhập lại" (+ sign-in in a new tab), a redirect goes to login with the same text. `SessionWatch` in the shell checks `/auth/me` passively on window focus and every 3 min (never extends idle timeout; any 401 from it keeps the page with the notice). No in-session permission refresh.
- **Skills**: success = toast.
- **Roles**: `DataTable` (client, search, status filter, sort, 20/page), `⋮` = Edit or View permissions, Switch off/on (`ConfirmDialog` + reason, no delete). Create/edit = `FormDrawer` with names, manager-group `CheckField`, grouped permission matrix (`FormSection` per group, `CheckField` per permission), reason. Read-only users get a view drawer.
- **Teams list**: server-mode `DataTable` (20/page), URL state (q, branch, page), name = link, create = `FormDialog`.
- **Team detail**: breadcrumbs, header (Edit primary, Change leader, `⋮` = remove leader, Delete with reason), summary card, members in `Tabs` (members / add). New kit `SelectionBar` replaces the toolbar while rows are selected (Select all N, Clear, Transfer, Remove / Add); reason + progress in a dialog. Old `<details>`, native fieldsets, raw tables, confirm-checkbox removed.
- **Kit fixes found by the gate**: `.ls-cell-end/center/actions` lost to `.ls-table td` (numeric columns were never right aligned: now fixed everywhere); breadcrumb links are 40/44 px targets; `useOptionalToast`, `SelectionBar`.

## Not changed

No DB or permission change. Team/role API calls and payloads as before (member batches, 100 cap, all-matching).

## Tests run

- api unit suite 172 pass / 0 fail (62 DB tests skipped); new csrf.guard + session.policy tests; integration on the scratch DB: workforce-auth, role-admin (reason checked through `listRoles` and `/auth/me`). Typecheck, eslint, prettier clean.
- web: 246/246 (new: roles-list, teams-list, session watch, reason handling; role-admin rewritten for the drawer). ui: 235/235. Ratchet lowered: raw tables 19, wf uses 604, details 12, fieldsets 17, solid danger 8.
- Not run (Step 14): `pnpm check`, full integration, smoke.

## UX gate

- Rendered roles, teams, team detail (360/768/1440 light, 1440 dark), selection state, create/edit drawers, leader dialog, toast. Spacing on tokens, one h1 + one primary last, one toolbar row, single-border tables, no horizontal scroll.
- DOM audit vs baseline: roles 176 -> 28 at 3 widths, teams 93 -> 4, team-detail 153 -> 3; no rule above baseline except `icon-text-misaligned` 2 -> 7 (icon-only phone Filter button, accepted false positive). Remaining per-page hits are shared kit ones (sort header `th` wrap, Badge 2 px padding, sidebar vs table surface).

## Owner decisions (8a approved)

- Bulk add / remove / transfer of team members stays through the `SelectionBar`: an Owner-approved exception to contract 10.4 ("bulk actions are not introduced"), because the function already existed.
- CSRF guard: a signed-in session that no longer resolves (revoked, expired, permissions changed) now answers 401 `AUTHENTICATION_REQUIRED` (+ `reason: AUTHORIZATION_CHANGED` when only the permissions changed) before the CSRF token is checked. Origin/content-type checks stay first (403, no session state leaks); anonymous or unknown tokens and a wrong or missing CSRF token on a valid session stay 403. Tests: `csrf.guard.test.ts` (both cases + cross-site) and `session.policy.test.ts`.

## Open questions

- Success `Notice`s on screens of later Steps (services, branches, employee lifecycle, my services) remain until those Steps.
