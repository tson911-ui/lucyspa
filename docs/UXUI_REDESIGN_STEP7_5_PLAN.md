# UX/UI Step 7.5: page-frame standardization ("uniform Step") — PLAN ONLY

Status: **plan approved by the Owner on 2026-10-01 (answers in section 9, LOCKED); no session started, no code changed.** Inputs: `docs/UXUI_AUDIT_AFTER_STEP7.md` (19 findings, screenshots in
`.local/uxui-audit/shots/`, not re-captured), five extra Owner observations (O1-O5, below), and the shadcn-admin reference
(MIT, https://github.com/satnaing/shadcn-admin, demo https://shadcn-admin.netlify.app/; 1440 px light captures of Dashboard, Tasks,
Users, Settings saved in `docs/references/`). Locked decisions (D1-D13, Q-D1..Q-D6, Q-CM1..Q-CM13, Phase 4 Q0-Q10) are not reopened;
the places where this plan amends section 10/21 wording of the design contract (10.3, 10.4, 21.1-1) were approved in section 9 and are
written into the contract by 7.5a.

Owner observations added to the audit: **O1** repeated title ("Thêm kỹ năng" card + link with the same text), **O2** actions in odd
places (Invoices "Tải lại" alone above the filters), **O3** create forms use a bare native `<details>` "▶", **O4** the Organization
tab strip touches the card below it, **O5** the dashboard gives no hint that widgets can be dragged.

## 0. Facts that shape the plan

- The kit already has most components (`DataTable`, `Pagination`, `ListToolbar`, `RowActions`, `Menu`, `Tabs`, `Dialog`, `Drawer`, `Card`,
  `AppShell`, `Breadcrumbs`, `EmptyState`, `Field`). What is **missing** is the page-level layer promised in contract 9.6 but never built
  (`Page` container, `PageHeader`, `Stack`/`Grid`, `FormGrid`, `PageSection`) and enforcement.
- `PageHeader`, `Section`, `Empty` still live in `apps/web/.../workforce/ui.tsx` and render legacy `wf-*` markup.
- Only **2 of the workforce screens** (Employees, Skills) use `DataTable`. **18 files** still render a raw `<table>`; 9 files use
  `<details>` disclosures (23 lines); 10 files use native `<fieldset>`; 11 files use native checkboxes.
- CSS: `packages/ui/src/components.css` 2,934 lines, `apps/web/src/app/workforce.css` 785 lines (129 `wf-` selectors), `customer.css` 293.
  The audit counted 96 distinct off-grid values (2,404 element hits) and 94 "box in a box" hits, almost all from `workforce.css`.
- There is no Tailwind, Radix, or class-variance tooling in the repo today (Radix headless may be added, section 1.1); `packages/ui` is plain CSS on `--ls-*` tokens with 13k lines of
  code and tests (keyboard, ARIA, longest-VI-string) approved in Steps 3-7.
- Caveat on the reference: class names below come from fetched source excerpts (summarized, not file-by-file reads) and were checked
  against the screenshots. Before porting anything, read the actual file in full.

## 1. Foundation: shadcn-ui base or keep writing our own? — recommendation: KEEP our own kit

**Decision (Owner, locked): keep `packages/ui` (plain CSS + tokens, no Tailwind). Adopt shadcn-admin's page anatomy and interaction
patterns, re-implemented on our tokens. Do not import shadcn components. Radix primitives are allowed as headless behavior only
(next subsection).**

| Criterion       | Adopt shadcn-ui (Tailwind v4 + Radix + cva) as the base                                                                                                                                                                              | Keep our kit + port patterns (recommended)                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effort          | Install Tailwind 4 + PostCSS in `apps/web` and `packages/ui`, rewrite or wrap ~35 components, re-point 13k lines of tests. Estimate 6-8 Pro sessions **before** any audit finding is fixed.                                          | 6 sessions (section 7) and every one of them fixes audit findings.                                                                                                                                 |
| Root cause fit  | The audit problems are missing layout primitives, 2 card systems and legacy CSS, not missing components. shadcn does not remove legacy `wf-*` CSS; it would add a third styling system.                                              | Targets the actual causes.                                                                                                                                                                         |
| Tokens / themes | shadcn variables (`--background`, `--primary`, `.dark` class) must be aliased to `--ls-*`; our theme uses `data-theme` + `prefers-color-scheme` + pre-paint script, so `@custom-variant dark` has to be rewired. Doable but fragile. | Already done (Step 2), contrast test in place.                                                                                                                                                     |
| CSS collision   | Tailwind preflight resets element styles that `workforce.css` and `customer.css` (1,078 lines) rely on; both would have to be migrated in one pass or isolated with layers.                                                          | None.                                                                                                                                                                                              |
| i18n            | shadcn ships English `sr-only` strings ("Go to first page", "Open menu") inside components; each must become a prop.                                                                                                                 | Kit already takes all text via props (contract 9).                                                                                                                                                 |
| Accessibility   | Radix gives proven focus management, but our `Menu`, `Dialog`, `Combobox`, `Tabs` already have keyboard/ARIA tests.                                                                                                                  | Keep; Radix headless only where a spike shows a gap (1.1).                                                                                                                                         |
| Design fidelity | Reference controls are 32 px high (`h-8`): below our 40 px desktop minimum (the audit script flags 23-57 targets under 40 px on the demo itself). We would restyle almost every component anyway.                                    | We copy anatomy, not dimensions.                                                                                                                                                                   |
| Risk            | Big-bang restyle of 15.7k lines of screens (risk table, contract 19), two coexisting component systems for months.                                                                                                                   | Incremental; old and new CSS coexist only for unmigrated screens, with a ratchet that only goes down (section 5).                                                                                  |
| License         | MIT, notice required only if code is copied.                                                                                                                                                                                         | No verbatim code is planned. If a file is adapted: header comment "Adapted from satnaing/shadcn-admin (MIT)" plus the repo's own copyright line, and a `docs/references/LICENSE-shadcn-admin.txt`. |

### 1.1 Radix headless primitives (Owner-approved, conditional)

Allowed packages, only when the current kit is missing the behavior or its accessibility is weak: `@radix-ui/react-dropdown-menu`
(`Menu`/`RowActions`), `@radix-ui/react-dialog` (`Dialog`/`Drawer`), `@radix-ui/react-popover` (`Popover`/`FacetedFilter`),
`@radix-ui/react-tabs` (`Tabs`). Rules:

- **No Tailwind, no shadcn wrappers.** Radix is used unstyled; all look comes from `--ls-*` tokens and kit CSS. Radix stays inside
  `packages/ui` (apps/web never imports it) and every text, including `aria-label`, still arrives through props.
- **Evidence first.** A spike at the start of the session that touches the component (7.5c for `Menu`/`RowActions`/`Popover`/`Tabs`, 7.5d
  for `Dialog`/`Drawer`) runs the existing component tests plus a keyboard/screen-reader checklist (focus trap and return, Escape,
  typeahead, `aria-*`, scroll lock, nested overlays, iOS/Android touch). A component is replaced only if the check finds a real gap;
  the session report says which gap and which package. Otherwise the kit component stays and Radix is not added.
- **One adoption per component**, wrapped so the public kit API does not change (screens never see the swap); the existing tests must
  pass unchanged, plus new tests for the gap that justified it.
- **Dependencies** are added to `packages/ui` only, exact versions, named in the session report. No other new dependency without
  asking (`@radix-ui/react-slot`, cva, tailwind-merge are not needed).
- **License.** Radix is MIT and used as a package dependency, so no notice file is needed. If code is ever ported from shadcn-admin
  (MIT), the file gets a header comment "Adapted from satnaing/shadcn-admin (MIT)" and the repository's copyright line is added to
  `docs/references/LICENSE-shadcn-admin.txt` in the same session (copy the text from the repo LICENSE at that time; no code has been
  ported so far).

**What we take from the reference** (visible in `docs/references/shadcn-admin-*.png`):

1. Page anatomy: title (24 px bold) + one-line muted description on the left, actions on the right aligned to the bottom of the block,
   `flex-wrap` with a small gap; 16 px gutter to the shell edge; 16-24 px between header, toolbar, table, pagination.
2. List page: search + faceted filter buttons (popover with checkbox options and counts) + "Reset" that appears only when a filter is
   active; **one** table surface with a single border and no surrounding card; "Rows per page", "Page x of y" and numbered buttons in
   one footer row; a single `⋯` row menu in a narrow last column; name cell carries the primary text.
3. Create/edit opens a **Sheet** (side drawer) or **Dialog**, footer = Close (outline) + Save (primary), form resets on close.
4. Settings: left section nav + one form column limited to about 576 px, section title + description + separator, stacked fields with
   hint under the control.
5. Dashboard: `Tabs` under the title, 4 equal stat cards in one row, then a 2-column chart + list row.

**What we do not take** (scope or contract): global ⌘K search, column "View" toggle, row-select checkboxes / bulk actions (no
requirement, contract 10.4), black primary (ours is wine #782b37), 32 px controls, viewport-pinned pagination, the inset-card main
area, Clerk, RTL. No feature is added.

## 2. Shared primitives (all in `packages/ui`, text via props, tested, tokens only)

Status: **E** exists, **X** extend, **N** new. "Reference" points to the anatomy source above.

| Primitive                          | St. | Contract (what the primitive guarantees)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Fixes                |
| ---------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `AppShell`, `Breadcrumbs`          | X   | Content region hosts `Page`; breadcrumbs on detail/form pages are fed from route metadata (no per-screen markup); nav list gap and active item share the icon column (x=24 both); topbar order unchanged (F7-F10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #19                  |
| `Page`                             | N   | Width variants `default` (`--ls-content-max` 1280), `form` (`--ls-form-max` 720), `full` (boards). Gutter from tokens, `min-width: 0` on the container and its grid children so nothing pushes the page wider than the viewport; wide tables scroll inside their own wrapper.                                                                                                                                                                                                                                                                                                                                                                                                     | #14                  |
| `PageHeader`                       | N   | Optional breadcrumbs; one `h1`; one-line description; actions slot right, aligned to the block bottom, wraps under the title on phone; the **primary action is last and unique**; also the only place for page-level actions (refresh becomes a toolbar `IconButton`, never a stray button). Replaces `ui.tsx` `PageHeader`.                                                                                                                                                                                                                                                                                                                                                      | O2, #13, #3          |
| `Stack` / `Cluster` / `Grid`       | N   | The only things that create gaps: `Stack gap="page"` (24), `"block"` (16), `"field"` (16), `Cluster gap="inline"` (8), `"tight"` (4, icon+text). Children never carry their own margin. `Grid` has `auto-fit` with equal track heights and a `subgrid`-style header row so titles that wrap do not shift the values below (finding 2).                                                                                                                                                                                                                                                                                                                                            | #2, #4               |
| `Card`, `CardHeader`               | X   | The only container surface. Sets a context so `DataTable`, `EmptyState`, `Notice`, `Tabs`, `DescriptionList` inside it render **flush** (no border of their own). A Card inside a Card is a dev-mode warning and a test failure. `Section` (apps/web) becomes a thin alias of `Card` so the 2nd card system disappears for every page at once.                                                                                                                                                                                                                                                                                                                                    | #1, #5               |
| `FilterBar` (`ListToolbar`)        | X   | One row, every control 40 px high, no labels above (placeholder + `aria-label`), search 240-320 px, filters as `Select` or `FacetedFilter` (popover checkboxes + count, **new small part**), "Reset" only when active, right end: result count (`role=status`) + optional reload `IconButton`. On phone: search + "Filters" sheet button on one row. Unequal widths and the label-on-one-control bug go away.                                                                                                                                                                                                                                                                     | #9, #11, #13         |
| `DataTable`                        | X   | `pageSize` default 20, `paging` is a required prop (`client` \| `server` \| `cursor` \| `off` with a written reason); rows render one line by default at a uniform height (48 px, 56 px with a secondary line); a column may opt into `wrap` (max 2 lines + `title`). Column policy props: `width`, `minWidth`, `align`, `nowrap`, `numeric` (right, `nowrap`, tabular digits), `truncate`. Headers never wrap. Multi-value cells (branches) show the first value + "+N" badge with popover. Empty cell = "—". In dev, more than 20 rows with `paging="off"` logs an error and fails the list test. Phone = card list with the same rules as in the kit (fixed label/value rows). | #7, #8, #9, #10, #18 |
| `RowActions`                       | X   | Last column, 48 px, header visually hidden ("Actions"). **One `⋮` `IconButton`** (label "Thao tác"/"Actions") opening a `Menu`: Edit/View first, safe actions, divider, destructive last in danger text (10.5 matrix decides which exist). The name cell is the link to the detail page. On phone the `⋮` sits top right of the card. No stacked link + outlined button.                                                                                                                                                                                                                                                                                                          | #7, #8, #15, #18     |
| `Pagination`                       | X   | One row: "Showing 1-20 of 64" left; page-size select (10/20/50), prev/next and numbered pages right; wraps into two rows on phone; hidden buttons never leave a gap. (Already has the numbered model; changes are layout only.)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | #7                   |
| `Tabs` / `PageTabs`                | X   | Tab list sits directly under `PageHeader` (or in a `CardHeader`), 16 px above the panel; panel spacing is part of the component, so a tab list can never touch a bordered sibling. Counts are part of the label. Tab-like outline buttons are not allowed.                                                                                                                                                                                                                                                                                                                                                                                                                        | O4, #15              |
| `EmptyState`                       | X   | Flush, centered, optional icon, one optional action. Used inside a table (`colSpan`), a Card, or a widget; never a dashed box inside a bordered parent. Charts with no data show it instead of a 0-1 axis.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | #4, #5               |
| `FormDialog`, `FormDrawer`         | N   | Create/edit container built on `Dialog`/`Drawer`: title = the action ("Thêm kỹ năng"), body = `FormGrid`, footer = Cancel (secondary) then Save (primary) at the trailing edge, `busy` state, error summary on top with focus to first invalid field, dirty-guard through `ConfirmDialog`, resets on close. Dialog for short forms (up to about 5 fields), Drawer for medium forms (6-12 fields or one small sub-list), a page beyond that (rule 9); bottom sheet on phone.                                                                                                                                                                                                       | O1, O3, #8           |
| `FormGrid`, `FormSection`, `Field` | X/N | `FormGrid cols={1 \| 2}` (1 on phone), label above, hint and error below, every control the same height; field widths from tokens `--ls-field-sm/md/lg` (160/280/480) or full; `FormSection` replaces native `fieldset`/legend chrome (heading + optional description, no border); `FormActions` for page forms. Dialog widths: sm 400, md 560, lg 720.                                                                                                                                                                                                                                                                                                                           | #16                  |
| `CheckField`                       | N   | Checkbox/radio/switch + label as one row-wide target: at least 40 px desktop, 44 px coarse pointer; used by the permission matrix and team/branch pickers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | #17                  |
| `Disclosure`                       | N   | Replaces bare `<details>`: chevron icon that rotates (motion tokens), keyboard and ARIA tested, used only for optional/advanced content, **never** as a create form.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | O3                   |
| Dashboard widgets                  | X   | Widget = `Card` with single-line clamped title (`title` attribute), value row aligned across a card row, flush empty state, edit-mode affordances (section 6, 7.5e).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | #1-#4, O5            |

Rules for every primitive: no `next/*` import, no hardcoded strings, `className` limited to layout, a render + keyboard + ARIA +
longest-Vietnamese-string test, both themes, motion tokens only.

## 3. Debt removal (what dies, where, and how it is measured)

| Debt                                                                         | Removed by                                                                                              | Pages affected (audit)                                              | Measure                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Old card `wf-section` / `wf-card` next to `ls-card` (#1)                     | `Section` becomes `Card`; `wf-section`, `wf-card` (11 uses) deleted                                     | every workforce page, Dashboard recovery card                       | DOM: 0 surfaces with a legacy class; one padding value per level       |
| Box in a box: `ls-empty`, `ls-notice`, `ls-table-wrap` inside a card (#5)    | Card context makes them flush; `DataTable` and `EmptyState` own their look                              | 21 of 26 pages, 94 hits                                             | DOM "nested bordered" count = 0                                        |
| `.wf-app` base font 15.2 px and 96 off-grid values (#6)                      | Mechanical remap of `workforce.css` to `--ls-text-*` / `--ls-space-*`; base font = `--ls-text-md`       | every workforce page, 2,404 hits                                    | DOM off-grid count: baseline then 0 on migrated pages                  |
| Raw `<table>` + `wf-table` (18 files), unpaged lists                         | `DataTable` (client paging) per screen in Steps 8-10; pilots in 7.5c/7.5d                               | Services, Branches, Teams, Discounts, Roles…                        | static ratchet (section 5) + "more than 20 rows needs paging" DOM rule |
| `<details>`/`wf-disclosure` create forms (23 lines, 9 files)                 | `FormDialog`/`FormDrawer`; leftovers use `Disclosure`                                                   | Skills, Branches, Teams, Services, Roles, Organization, My account… | static ratchet                                                         |
| Native `fieldset`/legend (10 files), 13-20 px checkboxes (11 files)          | `FormSection`, `CheckField`                                                                             | Employee/Team detail, Roles, Service detail                         | static ratchet + DOM target size                                       |
| `wf-button*` raw class use (143 workforce+customer hits), text-link actions  | Screens use `Button`/`IconButton`/`RowActions`; removed per screen in Steps 8-10                        | all                                                                 | static ratchet (counts may only decrease)                              |
| Dashboard: two card systems, dashed empty box, 0-1 chart axis, orphan button | 7.5e                                                                                                    | Dashboard                                                           | DOM + review                                                           |
| Solid danger buttons outside dialogs (#12)                                   | Destructive actions move into `RowActions`/`ConfirmDialog` when the booking board is migrated (Step 10) | Booking board                                                       | static test: `variant="danger"` only inside `ConfirmDialog`            |

What 7.5 fixes centrally (every page benefits without being migrated): Card unification, flush children, `.wf-app` token remap, nav
alignment, `PageHeader` swap. What 7.5 does **not** do: rewrite screen internals. That stays in Steps 8-10 (section 8) on the new
primitives.

## 4. Frontend rules (proposed; to be written into design contract section 21 and a short digest in `CLAUDE.md`)

Mandatory for every Step after 7.5. Each rule says how it is enforced.

1. **Grid.** Every spacing value is a `--ls-space-*` token (all multiples of 4). Gaps **between blocks** use 8/16/24/32/48 only; 4/12/20 live inside controls, badges and dense rows. No px/rem literal for margin, padding, gap or layout width. _(CSS test + DOM audit)_
2. **Rhythm.** Page: header → 24 → content; sibling blocks 24; blocks inside a card 16; fields 16; label → control 8; inline 8; icon ↔ text 4. Gaps come from `Stack`/`Cluster`/`Grid`, never from margins on the child. _(DOM: sibling gaps within one container must be equal)_
3. **Surfaces.** `Card` is the only container; nothing bordered inside a card; lists have no outer card (the table is its own single-border surface); two surfaces never touch or overlap borders. _(DOM nested-border count = 0)_
4. **Page anatomy.** `Page` → `PageHeader` (one `h1`, description of one line, actions right) → content. One primary action per page, last in the header. _(DOM + review)_
5. **Button hierarchy.** primary (one per region) > secondary > ghost > danger-outline; solid danger only in `ConfirmDialog`; one height per row (40 desktop / 44 touch); all actions are kit buttons (no text-link actions, no raw `<button>`). Where an action lives is fixed: page → `PageHeader`; list (search, filter, reload) → toolbar; row → `⋮`; card → `CardHeader`; form → `FormActions`/dialog footer, primary trailing. _(static + DOM "orphan action": a button alone in its row outside header/toolbar/footer)_
6. **Alignment and baseline.** Controls in a row share height and baseline; toolbar controls have no labels above; in forms every label sits above; left edges align down a column; right-aligned actions share one right edge.
7. **Widths.** Fields use `--ls-field-*`; selects and search never stretch to `100%` inside a toolbar; long values (a 66-char branch name) clamp to one line with `title` and a max width (select 280); text measure ≤ 75 ch.
8. **Lists.** Anything that can exceed 20 rows uses `DataTable` + `Pagination` (20 per page, search from ~15 rows); no raw `<table>`; one line per row by default, uniform height; numeric columns `nowrap`, right, tabular; headers never wrap; multi-value → first + "+N"; empty → "—"; row actions in `⋮`. _(static ratchet + DOM "more than 20 rows without pagination")_
9. **Forms.** Short form (up to about 5 fields, no sub-lists) → `FormDialog`; medium form (about 6-12 fields or one small sub-list) → `FormDrawer`; long form (more than 12 fields, several sections, tabs or sub-lists, for example the employee detail) → its own page (`Page variant="form"`). Always opened from the header or toolbar primary button or a row `⋮`; no `<details>`, no inline expanding create card, no native `fieldset` chrome; hints and errors below the control; checkbox/radio/switch through `CheckField`.
10. **No duplicates.** A heading never equals the label of its only control; one title per surface. _(DOM heading-vs-control text check)_
11. **Overflow.** No horizontal page scroll at 360/768/1440; containers `min-width: 0`; only a table scrolls, inside its own wrapper. _(DOM)_
12. **Tabs.** `Tabs`/`PageTabs` under the header, 16 px to the panel; never outline buttons used as tabs.
13. **States.** Loading = skeleton with the final footprint; empty = `EmptyState` (flush, one action); error = `ErrorState` + retry; a chart without data shows the empty state, not an axis.
14. **Reorderable surfaces** (dashboard, later slider) show a grip handle, a grab cursor, a one-line hint and the keyboard alternative.
15. **Theme and i18n.** Tokens only (no hex, no amber/gold), both themes; strings via dictionaries, including `sr-only` text passed into kit components; longest Vietnamese label tested.

## 5. Quality gate v2

**Environment (reuse, do not rebuild unless missing):** scratch DB `lucy_spa_uxaudit_20261001` (dev DB never touched), API on 3101, web
on 3100, seed scripts and the real-app capture in `.local/uxui-audit/` (`capture.mjs`, `page-audit.js`, `seed*.mjs`, `creds.json`;
machine-local). 7.5a verifies the DB exists and is seeded (recreate with the existing `create-db.mjs` + `migrate.mjs` + seeds if not,
under the same name) and **promotes the secret-free DOM script to `scripts/uxui-page-audit.js`** so it is versioned; credentials and
seeds stay in `.local/`.

**Per Step (cheap path, as today):** render only the changed screens (`scripts/uxui-screens.mjs` harness, or `capture.mjs <pages>` on
the real app) at 360/768/1440 light + 1440 dark, read the `-top` crops, UX-gate note of 5 lines in the report.

**New automatic checks added to the DOM script** (each prints `CHECK` and fails the gate unless explained in the report):

| Check                                                                                             | Rule  |
| ------------------------------------------------------------------------------------------------- | ----- |
| A list with more than 20 visible rows/cards and no pagination control                             | 8     |
| Bordered surface inside/touching another bordered surface (existing check, target 0)              | 3     |
| Off-grid spacing in the content region (existing, target 0 on migrated pages)                     | 1     |
| Sibling gaps inside one container that differ                                                     | 2     |
| Heading text equal to the label of the only control in its container                              | 10    |
| Orphan action: a button/link-button alone in its row outside header, toolbar, card header, footer | 5     |
| Controls in one row with different height or baseline; toolbar control with a label above         | 6     |
| Cards in one row whose first numeric value sits at different offsets from the card top            | 2     |
| Horizontal scroll, targets under 40/44 px, wrapped badge/button labels, clipped text              | 7, 11 |
| Row height spread inside one table (more than one height class)                                   | 8     |

**Static ratchet (node:test, no DOM):** counts of raw `<table`, `wf-*` class uses, `<details`, `<fieldset`, `type="checkbox"` outside
the kit, `variant="danger"` outside `ConfirmDialog`, and px/rem spacing literals in `workforce.css`/`components.css` are pinned to the
7.5a baseline in one test file; a Step may only lower them, and the closing Step of each of 8-10 sets its group to 0.

**Reference comparison (human, side by side):** for each list/form/dashboard pilot the report links our `-top` crop next to the
matching `docs/references/shadcn-admin-*.png` and answers 8 yes/no items read from the reference: gutter equals 16 and header-to-
content 24; title 24/600 with one-line muted description; actions right and bottom aligned; toolbar is one row of equal-height
controls; table is one single-border surface with uniform rows (about 49 px in the reference, 48/56 ours); pagination is one footer
row; create opens in a sheet/dialog; no element touches another surface. Pixel matching is not a goal (brand, font and 40 px controls
differ on purpose).

**Full matrix** (26 pages x 3 widths x light/dark) runs at 7.5f (before/after table against the 7.5a baseline) and at Step 14.

## 6. Dashboard specifics (7.5e)

- Widget = `Card`; the recovery email block becomes a widget or a header `Notice` (one card system).
- Title: one line, clamped with `title`; value row aligned across a row through a fixed title row height (fixes 89/109/89/113 offsets).
- Header: greeting left; branch select max 280 px with clamped text; Customize on the right; owner note as a `Notice` below. One left edge.
- Empty widget = flush `EmptyState`; zero-value chart = empty state, integer axis when data exists; quick links in an even grid.
- Drag affordance (O5): the `Customize` button reads "Sắp xếp bố cục" with an icon; in edit mode each widget shows a grip handle, a
  dashed outline and a grab cursor, a one-line banner explains "Kéo thẻ để sắp xếp, hoặc dùng nút Lên/Xuống", and Save/Reset/Cancel sit
  in the banner. The existing keyboard alternative stays. No layout or persistence change.

## 7. Step 7.5 sessions (each fits one Pro session, ends with Owner review)

Size budget per session: about 10 source files changed, at most 3 new components with tests, one UX gate on the named screens. If a
session would exceed it, it is split before starting. Order is fixed: a → b → c → d → e → f. Each session writes
`docs/UXUI_REDESIGN_STEP7_5<letter>_*.md` (max ~40 lines) and at most 5 handoff lines.

| Session                                      | Scope                                                                                                                                                                                                                                                                   | Audit / Owner items                       | Tests and gate                                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **7.5a** Rules and gate tooling (no UI code) | Write section 4 into the design doc (new 21.4, amend 10.3/10.4/21.1 per Owner answers) and a 10-line digest into `CLAUDE.md`; promote the DOM script; add the new checks; verify/recreate the audit DB; record the **baseline** (counts per page, static ratchet file). | gate itself                               | Run the extended audit on all 26 pages once (capture only, nothing fixed); ratchet test green at baseline.                                                       |
| **7.5b** Page frame                          | `Page`, `PageHeader`, `Stack`/`Cluster`/`Grid`; `Card` flush context; `Section`/`Empty`/`Notice` in `ui.tsx` re-pointed to the kit; `workforce.css` mechanical remap to tokens and base font; nav gap/active alignment. Central effect on all pages.                    | #1 (Section), #5, #6, #19, O1 (partly)    | `components-css` test (no literals), jsdom nesting test, `packages/ui` typecheck; gate = capture of Dashboard, Employees, Skills, Branches, Leave at all widths. |
| **7.5c** Data frame                          | `DataTable` column policy and row rules, `ListToolbar`/`FacetedFilter`, `Pagination` layout, `RowActions` as single `⋮`, phone card rules, dev paging guard; re-fit **Employees and Skills** pilots; reload becomes a toolbar `IconButton`.                             | #9, #10, #11, #18, O2                     | Component tests (paging guard, numeric nowrap, `⋮` menu order, phone cards); gate on Employees + Skills + Invoices top.                                          |
| **7.5d** Forms and overlays                  | `FormGrid`, `FormSection`, field-width tokens, `CheckField`, `FormDialog`, `FormDrawer`, `Disclosure`; pilots: **Skills create/edit** (removes duplicate title + `<details>`) and **Branches** (small, legacy list → `DataTable` + create dialog).                      | #8 (Branches), #16/#17 (kit part), O1, O3 | Focus trap, dirty guard, Escape, phone bottom sheet, 44 px `CheckField`; gate on Skills, Branches, one open dialog and drawer.                                   |
| **7.5e** Dashboard and tabs                  | Section 6; `PageTabs` spacing; swap the Organization tab strip for `Tabs` only if the change stays under about 60 lines (otherwise it moves to Step 8c and the kit fix stands).                                                                                         | #1-#4, #15 (strip), O4, O5                | Widget alignment test, edit-mode hint test; gate on Dashboard (empty + full), Organization top.                                                                  |
| **7.5f** Closing verification                | No new components. Full audit matrix vs baseline, before/after table, reference comparison sheet, ratchet lowered, design-contract Step map (section 8) copied into section 18, Step 7.5 report, handoff lines.                                                         | all                                       | Full DOM audit of 26 pages; typecheck/lint of touched packages; **no** `pnpm check`/smoke (reserved for Step 14).                                                |

**Deploy checkpoints (Owner decision):** after **7.5b** and after **7.5d** the Owner deploys the result to the real app and looks at
it before the next session starts. Those two reports therefore end with "ready for Owner deploy check" and list what to look at on
the real app (pages, widths, light/dark). The sessions do not deploy; the next session starts only after the Owner says so, and any
finding from the deploy check is fixed first (or recorded) in the next session's plan.

Nothing in 7.5 touches `apps/api`, `packages/database`, `packages/contracts` or `apps/web/next-env.d.ts`; no commit or deploy without
the Owner.

## 8. Revised map for Steps 8-14 (screens are assembled from the primitives; no new `wf-*` CSS)

Steps 8-10 shrink because the frame, list and form pieces exist. They are split so each fits a session; each sub-step ends with the
gate and Owner review, and the last one of each group sets its ratchet counters to 0. Delete/Cancel/Deactivate wording follows 10.5.

| Step   | Scope                                                                                                                                                                                                                                                                                                                                                              | Uses                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 7.5    | This Step (a-f).                                                                                                                                                                                                                                                                                                                                                   | —                                                  |
| **9a** | **Services first (right after 7.5d and its deploy check)**: `DataTable` client mode (20/page, sort code/name/category/price), toolbar search (code, VI/EN name) + category/status filters, category column replaces grouping, categories in a second tab, `⋮` row menu (Edit, Deactivate/Delete per 10.5), price `numeric`, create in `FormDrawer`. No API change. | `DataTable`, `FilterBar`, `PageTabs`, `FormDrawer` |
| 8a     | Skills (finish), Roles (permission matrix with `CheckField`, grouped, no delete), Teams list + detail.                                                                                                                                                                                                                                                             | `FormDialog`, `CheckField`                         |
| 8b     | Employees detail, lifecycle, roles, skills, create (multi-step page keeps the `Page variant="form"`).                                                                                                                                                                                                                                                              | `FormSection`, `Drawer`                            |
| 8c     | Organization (tabs, appointments, regions).                                                                                                                                                                                                                                                                                                                        | `Tabs`, `DataTable`                                |
| 9b     | Service detail, Branches detail, Discounts list/detail/form.                                                                                                                                                                                                                                                                                                       | `DescriptionList`, `FormSection`                   |
| 9c     | POS board, invoice, payments (financial actions stay in `ConfirmDialog`, re-auth unchanged).                                                                                                                                                                                                                                                                       | `DataTable`, `ActionBar`                           |
| 10a    | Booking board (cancel actions into `⋮` + `ConfirmDialog`, no solid red, equal card heights), walk-in, reassignment.                                                                                                                                                                                                                                                | `Card`, `RowActions`                               |
| 10b    | My services, collaborator schedule, attendance, leave (768 px overflow fix), my account, my income, notifications; **delete remaining `wf-*` CSS**.                                                                                                                                                                                                                | all                                                |
| 11-13  | Website content: media library, popup, slider are built on `DataTable`, `FormDrawer`, `SortableGrid`, `ImageUploader` with the rules of section 4; no layout CSS of their own.                                                                                                                                                                                     | unchanged scope                                    |
| 14     | Final validation as before, **plus** the full audit matrix with zero unexplained `CHECK`, ratchet all 0, reference comparison on key pages, axe pass.                                                                                                                                                                                                              | —                                                  |

Part 2 (customer area and public site) later reuses `Page`, `PageHeader`, `Card` and the same tokens; `customer.css` is out of scope
here. Rough size: 7.5 = 6 sessions, 8 = 3, 9 = 4 (with 9a), 10 = 2, 11-13 and 14 unchanged.

## 9. Owner decisions (answered 2026-10-01, LOCKED)

1. **Foundation:** keep our own kit and port shadcn-admin's patterns. Radix primitives may be used as headless behavior (no Tailwind,
   styled only with Lucy tokens/CSS) for DropdownMenu/RowActions, Dialog, Popover and Tabs, if the current kit lacks the behavior or
   its accessibility is weak (rules in 1.1). Code ported from an MIT repo carries a notice.
2. **Contract amendments approved:** (a) single `⋮` row menu, name cell is the link (10.4); (b) primary action last at the trailing
   edge in headers, forms and dialogs (10.3); (c) 21.1-1 = tokens that are multiples of 4, gaps between blocks multiples of 8.
3. **Lists without an outer card** approved: the table is its own single-border surface; toolbar and pagination sit on the page.
4. **Create/edit containers approved, by size:** short form → Dialog; medium form → Drawer; long form (for example the employee
   detail) → its own page (rule 9). Never inline or in `<details>`.
5. **Sessions and Step 8-14 map approved** (sections 7 and 8), plus a new rule: after **7.5b** and after **7.5d** the Owner deploys and
   reviews on the real app before the next session starts (section 7).

First session: **7.5a**, started only when the Owner says so.

## 10. Risks

| Risk                                                                     | Mitigation                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Central `Section`→`Card` and CSS remap shifts every legacy page a little | 7.5b captures 5 representative pages before/after and runs the full audit in 7.5f; old pages keep their markup |
| Client-side paging hides volume problems                                 | Already accepted (Q-D3); total is always shown                                                                 |
| Flush-in-Card via context hides a real nested surface                    | DOM nested-border check stays at 0 and runs on every gate                                                      |
| Ratchet baseline drifts when screens are edited outside Steps            | Test lives with the code; a failing count blocks the Step report                                               |
| Reference details misread from summarized source                         | Read the full file before porting; screenshots are the source of truth for anatomy                             |
| Audit DB missing or stale                                                | 7.5a verifies first and rebuilds under the same name with the existing scripts                                 |

## 11. Kit polish (batched before Step 14; Owner decision 2026-10-01 at 8b review)

Shared defects the DOM audit keeps reporting on every migrated page. They are not fixed per Step; one kit session fixes them together before Step 14 and the audit counts drop on all pages at once.

| Defect                                                                  | Where                  | Note                                                                         |
| ----------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `Badge` padding is 2 px (off the 4 px grid)                             | `packages/ui` badge    | `off-grid-spacing`, the largest remaining count                              |
| Sidebar (no radius, no shadow) next to a Card (radius, shadow)          | shell vs `Card`        | `surface-style-mix` on every page                                            |
| `Notice` has a 4 px left border among 1 px borders                      | `Notice`               | `border-width-mix`                                                           |
| Phone card list: cards of one table have different heights (names wrap) | `DataTable` phone mode | `row-height-uneven` at 360 px                                                |
| Icon-only phone Filter button flagged                                   | `ListToolbar`          | `icon-text-misaligned`, accepted false positive; fix the check or the button |
