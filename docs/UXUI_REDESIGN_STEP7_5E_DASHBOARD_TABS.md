# UX/UI Step 7.5e: dashboard and tabs

Status: local, not committed, not deployed. Plan: UXUI_REDESIGN_STEP7_5_PLAN.md section 6 and 7.5e.

## What changed

- Widget titles: `CardHeader clamp` = one line, ellipsis, full text in `title`. All widget cards (loading, message, error, data) use it, so the value row of every card in a row starts at the same offset (was 89/89/89/113 px).
- Header: the branch select lost its label above (aria-label + title instead), is 280 px wide with an ellipsis, and sits in the page-header actions next to the layout button. The button now reads "Sắp xếp bố cục" / "Arrange layout". The Owner note is an info `Notice`.
- Recovery email: its action moved into the card header as a kit `Button` (was a full-width raw button); a `Notice` inside any card is now a tint with no border and no margin (`.ls-card .ls-notice`), so there is no box in a box on any page.
- Paid-invoices widget: with no payments and no comparison it shows a flush `EmptyState` instead of a 0-1 axis.
- Layout mode: the banner is a card with header (title, one-line hint, "Đặt lại mặc định" in the card header) and the hidden-widget buttons. Handles, dashed outlines and the keyboard alternative were already there; layout and persistence are unchanged.
- Organization: the four outline buttons used as tabs are now the kit `Tabs` (about 45 lines changed). `.ls-tab` no longer shrinks, so the strip scrolls instead of wrapping labels at 360 px.

## Tests and gate

- ui 233/233, web 235/235 (new: clamped titles, Owner note, CSS rules). Typecheck, eslint, prettier clean. Ratchet lowered again (wf uses 707->698).
- UX gate: Dashboard at 360/768/1440 light + 1440 dark, layout mode on all widths, Organization top. Header on one row, 24 px between blocks, 16 px inside cards, one primary action per region.
- DOM audit vs baseline: dashboard 86->15 findings; gone: nested box, off-grid spacing, uneven value offset, orphan action. Still reported: list-height-uneven (widgets differ in size by design), surface-style-mix (a notice next to cards), one segment label wrapping at 360 px (Comparison control).
- Not here: the tables inside Organization tabs (raw `wf-table`, Step 8c).

## Open questions

None.
