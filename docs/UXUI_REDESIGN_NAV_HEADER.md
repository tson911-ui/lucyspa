# Customer navigation and transparent home header (2026-10-05)

Owner request: (A) simplify the customer navigation, (B) a transparent header on the home page.

## A. Navigation

- The account sub-tab row (Tổng quan / Lịch hẹn / Hóa đơn / Điểm thưởng / Thông báo) is gone from every `/account` page
  (`AccountTabs`, `accountTabItems` and their text keys deleted). Every member page keeps "Quay lại" (`PageBack` in `CustomerShell`).
- Header menu is unchanged: Trang chủ, Dịch vụ, and (signed in) Lịch hẹn, Hóa đơn. "Đặt lịch ngay" stays.
- The person menu has three items: "Tài khoản của tôi" (the overview page, now titled "Tài khoản của tôi" / "My account"),
  "Điểm thưởng", "Đăng xuất". No unread badge on it any more.
- New bell (`notification-bell.tsx`, signed in only): first of the header tools (so it grows into free space when the session
  is known and nothing else moves). Badge = unread count (`notification-badge` kept). The panel is the kit `Popover`
  (`--ls-z-popover`), `role=dialog`, focus moves in on open and back on Escape. It lists the latest 8 (newest first, unread
  tinted and bold, a check button marks one read and refreshes the badge and the inbox through `CHANGED`), the title and
  "Xem tất cả" stay in view while only the list scrolls. `SiteSession` now also carries the member's account (to link a
  notification to its booking or invoice).
- Removed leftovers: `member.{tabs,overview,bookings,invoices,notifications,unread}`, `home.bookingsCta`.

## B. Transparent header over the original hero (Owner correction 2026-10-05)

- The full-bleed hero first built in be5617d was **rejected by the Owner** (a misunderstanding). The home hero is exactly as before
  be5617d: light background, copy and buttons on the left, rounded slider card on the right, captions under the picture, Shop
  info picture / brand panel fallback. All pieces that existed only for the full-bleed hero were removed (CSS, tokens
  `--ls-hero-*`, `heroFoot`, the slider cover class, the hero-shaped loading skeleton, the season strip reorder).
- **Approved by the Owner:** a transparent header over the original hero. `SiteHeader` takes `overlay` (home path, and the admin
  season preview): at the top the bar has no background, no hairline and no shadow, with the normal dark/brand colours, so it
  blends with the hero background; after about 60 px of scrolling (sentinel 60 px tall, no scroll listener) it eases into the
  normal solid bar with its hairline and `--ls-shadow-sm`; back at the top it is clear again. The bar keeps its height and its
  place in the flow (the border only turns transparent), so nothing moves. Dark mode: the same, on the dark page colour.
  Reduced motion: the motion tokens are 0, plus a rule for `data-ls-motion='reduced'`. Other pages keep the solid bar.
- Seasons: the art row, bar, divider and greeting strip keep their order; the clear bar lets the season tint show behind it.

## Mobile layout (proposal, built)

360 px: logo, then bell, language, theme, account (four 44 px tools; gaps shrink to 8 / 4 px so the last one ends on the
gutter). No second menu: Trang chủ, Dịch vụ, Đặt lịch ngay, Lịch hẹn, Hóa đơn stay in the bottom tab bar, the header
"Đặt lịch ngay" is desktop only (as before). 768: same row with more air. The seasonal logo accent is hidden next to the bell
on a phone (it would sit on it).

## Tests

Bell panel list (newest first, at most 8, no bell when signed out), person menu (3 items), `SiteHeader` overlay markup, header CSS
rules (clear at the top, 60 px sentinel, nothing pulled out of the flow, no `--ls-hero-*`), the split hero CSS is back. Whole-repo
`pnpm format:check` and `pnpm test` are in the commit message. No migration, no permission, no API change.

## UX gate

Stub API + `next dev` (no database). 360/768/1440 light and dark, images opened and read: home at top, after scroll, back at the
top; bell panel; person menu; seasons Tết and Giáng sinh at top and after scroll. Pixel comparison of the home page below the
bar against the same page with the overlay switched off (the pre-be5617d layout): 0 differing samples at all three widths in
both themes, so the hero is unchanged. Account pages and the 10-kit check of the earlier build still apply to part A.

## Open

- `SiteSubNav` (kit) has no user now; left in the kit with its test.
- Header "Đặt lịch ngay" is desktop only (below 1024 px the tab bar and the hero button carry it), as before.
