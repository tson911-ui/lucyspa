# UX/UI Step 7.5d: forms and overlays (+ hover theme)

Status: local, not committed, not deployed. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md (7.5d). Owner chose to run 7.5d-7.5f in one go, then deploy and review once.

## What changed

- New in packages/ui: `FormGrid` (1/2 cols), `CheckField` (row-wide checkbox/radio, 40/44 px), `Disclosure` (button + turning chevron, replaces `<details>`), `FormDialog` and `FormDrawer` (title = action, Cancel then Save, busy state, error summary on top + focus on the invalid field, discard guard through `ConfirmDialog`, first field focused, bottom sheet on a phone for the drawer).
- Changed: `FormSection` is a named `<section>` + h3 (no fieldset); `FormActions` = Cancel then Save at the trailing edge; `Field` takes `width` (sm/md/lg) and `full`; `Drawer` takes `busy` and `initialFocus`. Tokens `--ls-field-sm/md/lg` (160/280/480), `--ls-dialog-sm/md/lg` (400/560/720), `--ls-drawer-form` (512).
- Skills: "Thêm kỹ năng" is the header primary button and opens a `FormDialog`; edit = `FormDialog`; activate/deactivate moved to the row menu with a `ConfirmDialog` that requires a reason (was a button inside the edit form). Success text is a page `Notice`.
- Branches: raw `<table>` + `<details>` create replaced by `DataTable` (client paging, name = link, `⋮` = Details) and a create `FormDialog`.
- Web glue: `lib/workforce/form-labels.ts`, dictionary `common.form.*` and `skills.(de)activate*` (vi + en).

## Hover theme (Owner request, token-only)

- Tokens `--ls-hover-bg/-text/-border/-ghost-border`. Light: nav, table rows, `⋮` menu items, facet options, calendar days, tabs, outline and ghost buttons, pager: bg #fbf1f3, text and border #782b37. Solid primary keeps the deeper red (`brand-fill-hover`). Dark: same values as before (sunken fill, unchanged text and border), asserted by test.
- Contrast: hover text on hover fill and on every surface, danger text on the hover fill, border 3:1, in both themes (tokens.test.ts). Measured on the real app with a real mouse (`.local/uxui-audit/hover.mjs`): nav, row, outline, pager, menu item match.

## Radix spike (Dialog/Drawer)

Checklist run in jsdom (focus on open and return, Escape, Tab trap, aria, scroll lock, nested guard dialog, busy lock, phone sheet): no gap, Radix not adopted.

## Tests and gate

- ui 232/232 (new: form-frame.test.tsx 9, css and token tests), web 233/233, typecheck ui + web, eslint, prettier clean. Ratchet lowered: raw tables 24->23, wf uses 715->707, `<details>` 22->20.
- UX gate: Skills and Branches at 360/768/1440 light + 1440 dark, create dialog open on Skills (all widths, light and dark). Spacing on the 4 px grid, one h1 + one primary action last, fields 16 apart, 44 px targets on phone, footer Cancel then Save. DOM audit vs baseline: skills 142->17, branches 72->8, no finding type is new.
- Not done here: create/edit in other screens (Steps 8-10), `Page variant="form"` nesting inside the shell Page (open since 7.5b; no screen needs it yet).

## Open questions

None. (Toast provider: Owner approved mounting it in Step 8a; success = toast, errors stay in place.)
