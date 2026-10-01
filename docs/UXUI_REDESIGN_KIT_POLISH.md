# UX/UI Kit polish (plan section 11) - report

Base 54a110d. UI kit only: no API, DB, migration or permission change. Not committed.

## What changed

- `Badge`: padding 2/8 px -> 4/8 px (on the grid; pill is 26 px tall instead of 22).
- `Notice`: the 4 px left border is now one 1 px border like every other surface; inside a `Card` it stays a plain tint (`border: 0`). Owner review: same radius token as `Card` (`radius-md`), no shadow, flat tint.
- Phone card list (`DataTable`): the title is clamped to 2 lines and always reserves 2 lines (48 px, also the touch target), so titles no longer change card height; the full name is on the detail page (the cell `title`, via `nodeText`, serves desktop and the audit only). Scoped to `td` so sortable headers are untouched. Related fix: `.ls-table-block` and the phone `tbody` are `minmax(0, 1fr)` tracks, and so is `.ls-sortby`, so a long value or the sort select no longer widens the table past the page (content-overflow 98 -> 2).
- `ReauthDialog` re-skinned on `FormDialog` (size sm, `Field` + `TextInput`, Cancel then Confirm, error in the form). Text is now neutral, no "nhân sự"/"nhân viên", VI and EN (`reauth.body`). Behaviour unchanged (own password, `POST /auth/reauthenticate`, wrong password clears the field and shows the error). Confirm is disabled until a password is typed.
- Audit script (`scripts/uxui-page-audit.js`), two false positives fixed, not silenced: visually hidden text (phone icon-only Filter button) no longer counts for `icon-text-misaligned` / `wrapped-label`; docked shell chrome (`aside.ls-sidebar`, `header.ls-topbar`, edge to edge with one border) is not compared with content surfaces in `surface-style-mix`.

## Tests

- `packages/ui`: 238/238 (new CSS regression test for badge, notice, phone title). `apps/web` targeted: workforce-access + ui-ratchet 8/8. Typecheck ui + web clean, eslint on touched files clean, `pnpm format:check` clean.
- Ratchet lowered: `wfClassUses` 334 -> 325, `componentsCssSpacingLiterals` 7 -> 6.
- Not run (Step 14): `pnpm check`, integration, smoke.

## DOM audit (real app, scratch DB, 30 pages x 3 widths, vs `docs/uxui-audit-baseline.json`)

- No type rose. Totals: off-grid-spacing 1202 -> 24, border-width-mix 15 -> 0, content-overflow 98 -> 2, wrapped-label 157 -> 14, surface-style-mix 36 -> 6, icon-text-misaligned 2 -> 0, row-height-uneven 24 -> 15 (baseline has 26 pages, now 30), small-target 43 -> 9, text-clipped 0.
- Left, not caused here: off-grid on legacy pages (`wf-small` 14 px, legend, input margins), `row-height-uneven` on phone cards (24 px: the "Chi nhánh" value with a `+N` chip wraps to two lines; titles are now equal at 64 px; Step 5b keeps values in full), `surface-style-mix` of `ls-form-actions` (3 form pages) and Notice (r10, no shadow, by design) vs Card (shadow) on dashboard and organization, 2 `tr` in legacy attendance/leave.

## UX gate

- Rendered employees, organization, dashboard, services at 360/768/1440 light + dark (real app) and the reauth dialog at 360/768/1440 light + 1440 dark (static render, `.local/uxui-screens/`).
- Badges, notice border and phone cards look as intended; phone titles are two lines with equal height, tokens only, no horizontal scroll, targets 44/40 px.
- Reauth dialog: one h1-level title, one control, footer Cancel then Confirm (primary last), bottom sheet on a phone.
- Reference comparison: 8/8 yes for employees/organization except phone card heights (residual above).

## Open questions

- Phone cards still differ when a value (for example several branches) wraps; clamp body values too, or keep them in full?
