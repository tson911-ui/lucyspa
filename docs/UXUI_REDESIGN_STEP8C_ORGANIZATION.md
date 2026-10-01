# UX/UI Step 8c: Organization (tabs, regions, areas, branch placement, appointments)

Status: local, not committed, not deployed. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 8 (8c). Base: 3459413 (8b committed).

## What changed

- **Organization screen** rebuilt on the kit. `PageHeader` with one primary action that follows the tab (Tạo vùng / Tạo khu vực / Bổ nhiệm; none on Branches, whose only action is per row), the two owner/attendance notes as one `Notice`, then four `Tabs` with counts. The tab, search, the tab's filter and the page live in the address bar (`?tab=areas`); changing tab clears search and filter.
- **Every tab is a client-mode `DataTable`** (20/page, sort, one `⋮` per row) with a `ListToolbar` (search + one `FacetedFilter` + reload): regions/areas filter by status, branches by placement, appointments by management level. Search ignores case and accents (areas also match their region, branches their area, appointments the scope name). Name column truncates with a `title`; phone = stacked cards.
- **Dialogs replace the 3 `<details>` forms and the inline row editing**: create region, create area, appoint (level, scope, employee `Combobox` with the same debounced server search, reason) are `FormDialog`; rename region, edit area, place branch are `FormDialog`; activate/deactivate (region, area) and end appointment are `ConfirmDialog` with a required reason. `window.prompt` is gone. Success = toast, errors stay in the dialog.
- Areas tab shows a notice and hides "Tạo khu vực" when no active region exists. A team-leader appointment keeps the muted "Quản lý nhóm" hint instead of a menu (ended from Teams, as before).
- New `lib/workforce/organization-list.ts` (URL state, filters, scope names) and `organization-dialogs.tsx`; dictionary: 24 keys (vi + en).

## Not changed

No API, DB, contract or permission change; same endpoints and permissions (VIEW/MANAGE_ORGANIZATION, MANAGE_ORG_ASSIGNMENTS). Payloads verified against the scratch API (rename = name only, status = isActive only, area edit, null placement). Ending an appointment no longer asks for the extra "I confirm" checkbox: the confirm dialog is the confirmation (button + required reason).

## Tests run

- web: organization-list (new, 5), organization screen (new, 3), screens, employee-detail, ui-ratchet: 25/25. Typecheck, eslint, prettier clean. No `packages/ui` change.
- Ratchet lowered: raw tables 18 -> 14, `wf-*` uses 483 -> 439, `<details>` 7 -> 4, checkboxes 9 -> 8, solid danger buttons 8 -> 6.
- Not run (Step 14): `pnpm check`, integration, smoke.

## UX gate

- Rendered all four tabs and the create region / create area / appoint / edit area / deactivate dialogs at 360, 768, 1440 light and 1440 dark. Tokens only, one h1, one primary action last, toolbar one row, single-border table, pager footer, phone dialogs are bottom sheets, no horizontal scroll. Fixed: search placeholders clipped in the toolbar (shortened).
- DOM audit vs baseline: organization 67 -> 40; no rule rose except `icon-text-misaligned` 2 -> 9 (icon-only phone "Bộ lọc" button, accepted false positive since 9a). Remaining hits are the shared kit items in plan section 11 (badge 2 px padding, 4 px notice border, sidebar vs card, sort-header wrap, phone card heights).
- Reference comparison (8 questions): gutter 16 / header 24, title 24/600, action at the trailing edge, one-row toolbar, single-border table with uniform rows, one pager row, create in a dialog, nothing touches another surface: yes.

## Open questions

- Owner's "chưa ổn lắm" notes on the 7.5 deploy are still pending.
