# UX/UI redesign, Step 5b: UX gate fixes

**Status: CLOSED / OWNER APPROVED (2026-09-30).**

Owner approved fixing F1-F12 and F14 of `UXUI_REDESIGN_DESIGN.md` 21.3 (F13 stays in Step 8), rendering the open states, and
a new auth card header.

## What changed

- **F1/F2** legacy `.wf-app` plain-control rules have zero specificity (`:where`), so `ls-*` search and selects win (icon no longer overlaps text; page-size select no longer full width).
- **F3** `.ls-badge` is `width: max-content` (one line when there is room); action cells never wrap their label at 640 px and up.
- **F4/F5** `DataTable`: each value sits in `.ls-cell-value`; empty values show an em dash; phone card rows are two columns (label start, value end); card titles and actions are 40/44 px targets; the Skills "Sửa" disclosure looks like the other row buttons and sits on the cell's end edge.
- **F6** phone `ListToolbar`: search and Filters share one row; below 480 px the button is icon + count (accessible name is the full label) so the placeholder is not clipped; the toolbar-to-table gap is 16 px.
- **F7-F9** `AppShell` gets `topbarEnd`; order is notifications, theme, language, user. The bell is a ghost icon button with a brand-colored count (no amber); the language link is a ghost button.
- **F8/F10/F14** topbar has a fixed height; theme options use `--ls-control-h` (40/44 px, also on auth pages); the brand link is a full-size target and starts on the sidebar icon edge (the hidden menu button's tooltip wrapper no longer adds a gap).
- **F11** `.wf-main h1` is `--ls-text-xl`, weight 600; `h2`/`h3` use tokens too.
- **F12** sort buttons have a minimum width.
- **Open states** (new findings, fixed): tablet overlay was under sticky table headers (slot z-index); phone nav drawer filled the screen (now leaves a 40 px strip); user menu clipped "Sign out" on phones (max-height); its labels and stacked theme options are aligned; the filter sheet is a bottom sheet (`Drawer side="bottom"`); tooltips show on keyboard focus only.
- **Auth header** (Owner request): wordmark twice as large (`BrandWordmark size="display"`, 2.5 rem) and centered, then a centered `--ls-text-lg` title and a muted subtitle. Login: "Đăng nhập" / "Dành cho nhân viên"; EN "Sign in" / "For staff". Forgot-password gets the same header (its own title and intro text are unchanged).
- `scripts/uxui-screens.mjs`: `--click` (real pointer press) and `--eval` to capture open states.

## Migrations / permissions

None. No API or business logic change.

## Tests run

`packages/ui` all tests 122/122, `tsc` (ui, web) clean; web `screens.test`, `notification-center.test` pass; eslint and prettier clean on touched packages.
`employee-detail.test.tsx` fails only when run from the repo root ("React is not defined", tsx config); passes from `apps/web`. Known item for Step 14 (final validation).

## UX gate

Screens: Employees, Skills, Dashboard, login (VI and EN), forgot-password at 360/768/1440 light and 1440 dark; open states user menu (360/768/1440), phone drawer (360), tablet overlay (768), filter sheet (360).
Automatic audit: no horizontal scroll and no target under the minimum on any render. Left as is: sort labels that wrap show their arrow at the column end; Skills "Thêm kỹ năng" card (F13, Step 8); the dashboard is still the legacy page (Step 6).
Images: `.local/uxui-screens/` (`5b-*`).

## Open questions

None.
