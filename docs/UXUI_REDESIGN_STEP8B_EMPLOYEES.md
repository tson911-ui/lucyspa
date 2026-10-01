# UX/UI Step 8b: Employees (detail, lifecycle, roles, skills, create)

Status: local, not committed, not deployed. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 8 (8b). Base: 390b355 (9a + 8a, Owner: ready to deploy).

## What changed

- **Employee detail** (`employee-detail.tsx`): breadcrumbs, one h1 (name) + employee ID, summary badges (title, management level, account status), header = `⋮` menu (Change classification, Set/Reset password, Disable/Re-enable sign-in, End employment) then the primary `Sửa hồ sơ`. Four `Tabs`: Profile (profile card + sign-in account card), Employment (current card, notices, history `DataTable`), Roles and branches, Skills. Menu order lives in `menuOverlays()` (tested).
- **Lifecycle** (`employee-lifecycle.tsx`): every `<details>` form is a dialog. Profile, Promote (radio group), End employment (date, reason, `CheckField`, the consequence notice kept) and Password (`PasswordInput`, reauthentication unchanged) are `FormDialog`; Disable/Re-enable sign-in is a `ConfirmDialog` with a required reason. Success = toast, errors stay in the dialog.
- **Roles / Skills / Branch assignments**: `DataTable` + row `⋮` (remove = `ConfirmDialog`, reason required except skills) and an add `FormDialog`. The add action sits in the list-section title row. Removed-skill and assignment history are tables with 20/page. No raw table, `<details>`, native fieldset or checkbox is left on these screens.
- **Create** moved to its own page `/employees/new` (long form, FR9): `Page width="form"`, `FormSection`s, `RadioGroup`, `CheckField` branches, `PasswordInput`, footer Cancel then `Tạo nhân sự` outside the card. On success the new member's page opens with a toast (`createdMessage`, still says whether they can sign in yet). The directory's `Thêm nhân sự` button navigates there; the inline form and `CreatedNotice` are gone.
- **Kit fixes found by the gate** (`packages/ui`): `ListSection` gets an `actions` slot; `.ls-field` no longer stretches its control when a sibling in the grid row is taller (inputs were 54-64 px); `RadioGroup` options are row-wide targets (`ls-check-field`) and the legend gap is 4 px.
- Dictionary: 8 new keys (tab labels, confirm titles) in vi and en. Audit script: a list-section header counts as an action place; the sticky phone form bar bleeding into the gutter is not an overflow.

## Not changed

No DB, API, permission or contract change; every command, payload and error mapping is as before.

## Tests run

- web 246/246 (employee detail, roles, skills, create, access, directory tests rewritten for dialogs and the new page), ui 236/236 (new: ListSection actions, RadioGroup/field alignment). Typecheck, eslint and prettier clean in web and ui.
- Ratchet lowered: raw tables 19 -> 18, wf uses 604 -> 483, details 12 -> 7, fieldsets 17 -> 11, checkboxes 12 -> 9. Not run (Step 14): `pnpm check`, full integration, smoke.

## UX gate

- Rendered employee detail (all tabs, menu, profile / promote / end / disable / assign-role dialogs) and `/employees/new` at 360, 768, 1440 light and 1440 dark. One h1, one primary action last, tokens only, no horizontal scroll, phone dialogs are bottom sheets, tab strip scrolls at 360.
- DOM audit vs baseline: employee-detail 238 -> 13, employees 54 -> 22 (unchanged by this Step), employee-new 0 -> 2. What remains is shared kit: Badge 2 px padding, sidebar vs card surface, 4 px notice border, phone card heights.
- Reference comparison (8 questions): gutter and header-to-content spacing, title 24/600, actions at the trailing edge, one single-border table, create opens in a dialog or its own page, nothing touches another surface: yes.

## Owner decisions (8b approved)

- The footnote under the roles table stays as helper text (`ls-hint`: small, muted, token-based).
- Audit script: the page-level check is untouched (`documentElement.scrollWidth > innerWidth` still reports `page-horizontal-scroll`; it runs outside the element loop). The only exemption skips `content-overflow` on an element that contains `.ls-form-actions` and overflows by at most one gutter (17 px), which is the sticky phone bar bleeding into the gutter. `text-clipped` and every other element overflow are unchanged.
- Remaining shared kit defects (badge 2 px padding, sidebar vs card surface, 4 px notice border, phone card heights) are recorded as "Kit polish" in UXUI_REDESIGN_STEP7_5_PLAN.md section 11, to be fixed together before Step 14.
