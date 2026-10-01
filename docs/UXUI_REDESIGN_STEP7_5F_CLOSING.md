# UX/UI Step 7.5f: closing verification (Step 7.5 report)

Status: local, not committed, not deployed. 7.5d, 7.5e and 7.5f ran back to back (Owner decision); this is the one review and deploy check for them. No new component here.

## Step 7.5 in one table

| Part | Result                                                                                | Report                               |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| 7.5a | Rules FR1-FR15, audit tooling, baseline                                               | UXUI_REDESIGN_STEP7_5A_RULES_GATE.md |
| 7.5b | Page, PageHeader, Stack/Cluster/Grid, one card surface                                | ..._STEP7_5B_PAGE_FRAME.md           |
| 7.5c | DataTable policy, single `⋮` menu, toolbar and pager                                  | ..._STEP7_5C_DATA_FRAME.md           |
| 7.5d | FormGrid, CheckField, Disclosure, FormDialog/Drawer; Skills and Branches; hover theme | ..._STEP7_5D_FORMS_OVERLAYS.md       |
| 7.5e | Dashboard frame, Organization on `Tabs`                                               | ..._STEP7_5E_DASHBOARD_TABS.md       |

## Closing checks

- Full DOM audit, 26 pages x 3 widths: 2296 -> 488 findings, no check above its baseline (before/after tables and the reference comparison in `UXUI_AUDIT_AFTER_7_5.md`, snapshot `uxui-audit-after-7_5.json`). small-target 43 -> 23 after the raw checkboxes of Roles, Service detail and Team detail became `CheckField` (Owner review item 2).
- Ratchet (`ui-ratchet-baseline.json`): raw tables 24 -> 23, `wf-*` uses 715 -> 698, `<details>` 22 -> 20, native checkboxes 18 -> 12. Spacing literals stay 0.
- Tests: ui 233/233, web 235/235; typecheck ui + web, eslint, prettier, boundaries clean. No `pnpm check`/smoke (reserved for Step 14).
- Design contract: hover theme added to 6.3, Steps 8-10 remap added to 18. No API, DB, contract or permission change; `next-env.d.ts` untouched.

## What to look at on the real app (deploy check)

- Light mode hover: sidebar items, table rows, `⋮` menu items, outline/ghost buttons, pager and tabs turn very light red with `#782b37` text and border; solid red buttons darken. Dark mode hover looks as before.
- Skills: "Thêm kỹ năng" in the header opens a dialog (bottom sheet on a phone); Edit and Activate/Deactivate (reason required) are in the row menu. Branches: table with paging, create dialog.
- Dashboard: one-row header, aligned widget values, "Sắp xếp bố cục" mode. Organization: tabs strip. Check 360, 768, 1440, light and dark.

## Owner review answers (applied)

1. Toasts: mounted in Step 8a; success = toast, errors stay in place. Until then success is a page `Notice`.
2. Skills deactivation with a required reason in a confirmation: approved.
