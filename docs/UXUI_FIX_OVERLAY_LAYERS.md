# Fix: menus drawn behind the sticky table header (2026-10-05)

Production `d6781fa`: the account menu in the admin top bar opened behind the table header row (Chi nhánh, Kỹ năng) and cut
off "Thu nhập của tôi".

## Cause

`.ls-topbar` is `position: sticky; z-index: 10`, so it is its own stacking context. The account menu (`.ls-popover`,
`z-index: 30`) is rendered inside it: its 30 counts only inside the bar, and to the page the bar is layer 10. The sticky table
header was also layer 10 and later in the page, so it won the tie. Same tie for the site header, phone tab bar and action bar.

## Change (shared UI layer only, no page touched)

- Scale in `packages/ui/src/tokens.css`: content (none) < sticky table header 10 < **chrome 20 (new `--ls-z-chrome`)** <
  popover/menu 30 < drawer 40 < dialog 50 < toast 60.
- Chrome token on `.ls-topbar`, `.ls-sidebar-slot`, `.ls-site-header`, `.ls-tab-bar`, `.ls-action-bar`, phone
  `.ls-form-actions`; `.ls-backdrop-drawer` at the drawer layer (below dialogs). Design contract 6.6 updated.
- `components-css.test.ts` pins the order, forbids any z-index that is not a token (or the local 0/1 decoration layers) and
  checks each rule above. No stray numeric `z-index` or `zIndex` exists in `apps/` or `packages/`.

## Tests

- `.local/hc/overlay-check.mjs` (git-ignored): real app, scratch DB; opens each overlay at scroll top and mid-page and
  hit-tests a 5x5 grid, every point must belong to the overlay. Before: FAIL on Chi nhánh at 1440 and 768 (point hits `TH`).
  After: 0 failures on 10 admin pages (Chi nhánh, Kỹ năng, Hóa đơn, Điểm thưởng tabs Khách hàng / Giới thiệu / Combo đã bán /
  Danh mục quà, Nhân viên, Vai trò, Dịch vụ) and 4 customer pages, at 360/768/1440, light and dark.
- Covered: account menu, row `⋮` menus, filter popovers, dialogs and drawers (whole viewport must belong to the backdrop),
  tablet/phone navigation drawer. Whole-repo `pnpm test`, `pnpm lint`, `pnpm format:check` clean.

## UX gate

Screenshots (git-ignored): `.local/uxui-screens/hc-before` (bug) and `hc-after`: account menu over the table at 360, 768,
1440 light and 1440/360 dark; customer menu over the Điểm thưởng and Hóa đơn tables. All opened: the menu is whole, on top of
the header row, no layout change elsewhere. DOM audit (audit scratch DB, migrated additively) on Chi nhánh, Kỹ năng, Nhân viên,
Vai trò, Hóa đơn and the login pages vs `docs/uxui-audit-baseline.json`: all counts equal or lower except `edge-left` 4 -> 8
on the centred login / forgot card (same values as the 2026-10-02 captures; z-index cannot move geometry). No ratchet changed.

## Coverage limits

- The top-bar bell is a link to the notifications page, not a panel. No dialog or drawer opens from customer pages.
- Điểm thưởng: 4 of 10 tabs run; Khách hàng had no table on scratch. Toasts are top of the scale by token only.
- Chrome bars tie at 20 with the phone bottom bars; the bottom bar is later, so it wins only where they overlap (phone in
  landscape, about 320 px tall). This existed before. No migration, permission or copy change.
