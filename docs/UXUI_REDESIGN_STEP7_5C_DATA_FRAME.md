# UX/UI Step 7.5c: data frame

Status: local, not committed, not deployed. Owner review round 1 applied (below).
Plan: UXUI_REDESIGN_STEP7_5_PLAN.md (7.5c). 7.5b deploy-check notes not folded in.

## What changed

- DataTable: `paging` required (pager or `{off:'reason'}`, dev error above 20 rows).
  Column policy: width, truncate, wrap (2 lines), numeric, hideBelow md/lg/xl.
  One row height, one line per cell, "—" for empty, empty/error inside the table surface.
- RowActions: one ⋮ button -> Menu (view/edit, safe, divider, danger). Kept for all lists,
  including the one-item "Chi tiết" in Employees (Owner decision).
- New: FacetedFilter, MultiValue (first value + "+N"), ListSection. ListToolbar and
  Pagination re-laid out (one row; count + reload at the end).
- Employees and Skills re-fitted. Skills edit = ⋮ > Edit dialog; create stays `<details>`
  until 7.5d. No API, DB, contract or permission change.

## Review round 1

1. Wide tables. Secondary columns hide by width: Employees branch/title/level and Skills
   English name show from 1280 px. Measured on the real app (employees, skills, 360-1920):
   no table wrapper scroll and no page scroll at any width from 768 to 1920 (and 360).
   Only 640-700 px scrolls inside the wrapper (Employees 40 px, Skills 28-88 px).
   Proof the wrapper contains overflow: an injected 3000 px table gave wrapper +1890 px,
   page +0 at 1440/1280/768. The old "visible on desktop" rule is gone, so the header is
   no longer sticky on desktop (trade-off for never scrolling the page).
2. "Chi tiết" stays in the ⋮ menu.
3. scripts/uxui-page-audit.js: 3 changes, all to remove false positives (below).

## Audit script changes (+11 lines, 2 old lines replaced; other checks untouched)

A. text-clipped: skip an element only if it is clamped on purpose (ellipsis or line
clamp) AND a title (own, ancestor or descendant) equals its full text.
False positive: Employees name `span.ls-cell-truncate`, title = full name.
Before: "Nguyễn Hoàng Gia Đạt ... (321 > 224)" reported. After: not reported.
B. wrapped-label, hidden header: skip `th`/sort buttons inside a `thead` that is
visually hidden (clip-path) - the phone card list. Nobody sees that header.
Before: "mã nhân viên wraps (x3)" at 360 px. After: not reported.
C. wrapped-label, threshold: was "text boxes in 2+ buckets of 4 px"; now "tops differ
by 10 px or more". A real second line is 14+ px lower (smallest line height 16 px);
an icon or bordered pill sits 2-6 px off the text, which is not a wrap.
Before: button `+1` (pill inside) "wraps onto 2+ lines". After: not reported.
Not loosened (injected cases, new script): ellipsis without title, with a different
title, with an unrelated ancestor title, and a real 2-line button are still reported;
only the title-equals-text case and the pill are not.
Old vs new script on all 26 pages x 3 widths (same build): new reports 0 findings the
old did not; removed 102 = 57 hidden-header (A/B), 22 clamped-with-title (A),
23 buttons (C). Independent check of the 23: no button, badge or tab on any of the
26 pages is 56 px or taller (a 2-line button is), so none was a real wrap.

## Tests and gate

- ui 217/217, web 233/233; typecheck, eslint, prettier clean. Ratchet lowered.
- DOM audit vs baseline (employees, skills, pos): no type rose.
  Employees 54 -> 18, Skills 142 -> 21 findings. Radix not needed (spike: no gap).
- Not here: Skills create `<details>` + duplicate title (7.5d), Employees create (8b).
