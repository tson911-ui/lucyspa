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

## B. Transparent header (provisional: the hero choice came from the question tool, not from the Owner's own words)

- The old home hero was a pale band with copy beside a rounded slider card, so light header text could not work. Chosen with
  the Owner's answer: a full-bleed hero (slides, else the Shop info picture, else the brand panel) with the headline and
  the two actions on top, the slide caption at the foot and the slider controls at the trailing edge.
- `SiteHeader` takes `overlay`: the bar is pulled out of the flow by its own height (the hero starts at the very top),
  stays sticky, is transparent with light ink until the page has scrolled about 60 px (the sentinel is 60 px tall; no
  scroll listener), then eases into the normal bar with a hairline and `--ls-shadow-sm`. Only the home path (and the admin's
  season preview) sets it; every other page is untouched. Reduced motion: the motion tokens are 0, plus a rule for
  `data-ls-motion='reduced'`.
- Contrast: tokens `--ls-hero-*` (same in both themes). Measured with a pure white slide at 360/768/1440 in light and dark:
  text at least 6.3:1, large text at least 5.8:1, controls at least 3.4:1 (needs 4.5, 3, 3). The header "Đặt lịch ngay" is a
  light button with brand text over the picture and the brand fill after the scroll; the hero primary button is light too.
- Seasons: the greeting strip and the first divider are ordered before the bar on the home page (`order: -1`), so the bar
  floats over the hero, not over them.
- Loading skeleton of the home page has the hero shape, so the bar never sits light-on-light while the page loads.

## Mobile layout (proposal, built)

360 px: logo, then bell, language, theme, account (four 44 px tools; gaps shrink to 8 / 4 px so the last one ends on the
gutter). No second menu: Trang chủ, Dịch vụ, Đặt lịch ngay, Lịch hẹn, Hóa đơn stay in the bottom tab bar, the header
"Đặt lịch ngay" is desktop only (as before). 768: same row with more air. The seasonal logo accent is hidden next to the bell
on a phone (it would sit on it).

## Tests

New: bell panel list (newest first, at most 8, no bell when signed out), person menu (3 items), `SiteHeader` overlay markup,
header/hero CSS rules, `heroFoot`, home hero markup. Whole-repo `pnpm format:check` and `pnpm test` are in the commit message.
No migration, no permission, no API change.

## UX gate

Stub API + `next dev` (no database) for the states, real API + built web on scratch DB `lucy_spa_uxaudit_20261001` for the
audit. 360/768/1440 light and 1440 dark, every image opened and read: home at top, after scroll, back at top; bell panel
(light 360/1440, dark 768); person menu (light and dark); signed out (no bell); EN; no slide with the Shop info picture and
with the brand panel; all 10 season kits (art row, strip and divider above the bar, hero under it) at the three widths in
light, 1440 dark, and scrolled; account overview, notifications, loyalty, bookings and services (solid bar, no tab row,
"Quay lại" present, title "Tài khoản của tôi"). Contrast: script measures the lightest 5 % behind each glyph with a pure white
slide, all pass (numbers above). DOM audit (`capture.mjs` home, account-login): 0 findings each, not above the baseline. Found
and fixed on the way: the light button text turned pink in dark (new `--ls-hero-on-ink`), the bell panel's "Xem tất cả" was
scrolled out of view (only the list scrolls now), the 360 px header overflowed by 12 px with the bell, a season logo accent
sat on the bell at 360 px.

## Open

- The full-bleed hero choice is the Owner's answer through the question tool: provisional until the Owner confirms.
- `SiteSubNav` (kit) has no user now; left in the kit with its test.
- Header "Đặt lịch ngay" is desktop only (below 1024 px the tab bar and the hero button carry it), as before.
