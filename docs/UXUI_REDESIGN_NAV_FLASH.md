# Customer navigation flash fix (2026-10-06, after production 9b76789)

Owner report: switching pages with the phone tab bar flashed the whole screen; the home info strip overflowed at 360 px;
the contact button covered text. Added the same day: "Đặt lịch mới" button rule and the tab bar's two red tabs.

## Cause of the flash (measured on a production build, frame by frame)

1. Two frames. `(public)` and `account` each rendered their own `SitePageFrame`, so going between them (Trang chủ ↔ Lịch hẹn)
   remounted the header, tab bar, footer and `SiteSessionProvider`. The provider's cleanup removed `data-ls-session`, and
   `html:not([data-ls-session]) .ls-tab-bar` hides the bar until the session is read again: the tab bar and the bell vanished.
2. Blank state. `RequireCustomer` remounted too and drew one line of text on an empty page ("Đang kiểm tra phiên đăng nhập…").
3. `RouteEnter` faded the new page in from opacity 0 on every navigation (a dip to blank).
4. Not a cause: links were already client-side with prefetch; reveal never hid above-the-fold content on first load; no theme flash.

## What changed

- One layout: `(site)` holds `(public)` and `account` (git mv; URLs unchanged) and renders the frame once. The header, tab bar,
  footer, contact button and session stay mounted.
- Page change = view-transition cross-fade (React `<ViewTransition>`, `PageTransition`), started only by navigation links
  (`transitionTypes`), tab bar and contact button named so they stay above it, tokens for time, 0 under reduced motion.
  Browsers without the API: fade from 60 % (never from 0). `RouteEnter` is no longer used on the customer side.
- `RequireCustomer` opens from the site session at once; a first load shows a skeleton, not text.
- `Reveal`: a block that will be above the fold at scroll 0 never starts hidden (navigation from a scrolled page); one that is
  already visible at the observer's first look is shown without the fade.
- Home info strip: stacked on phones (address wraps), one row from 768 px; no sideways scroller.
- "Đặt lịch mới" / account home "Đặt lịch" button: hidden below 1024 px (the tab bar has "Đặt lịch ngay"), on the title row above.
- Tab bar: only the current tab is active; "Đặt lịch ngay" is a raised round brand button (ring + brand label on the booking page).
- Contact button on phones steps aside while reading down; shown at the top, on scrolling up (1.6 s), on focus, with its menu open.

## Evidence (prod build, stub API with 250 ms delay; `.local/nav/record.mjs`, git-ignored)

Per navigation, 360 light / 390 dark / scrolled / Tết kit: before, header+tab+footer replaced on public↔account, minimum
opacity 0, 20+ blank frames on Lịch hẹn; after, replaced 0, minimum opacity 1, 0 blank frames, one view transition per click.

## Migrations / permissions: none. Tests: ui 455 + web 522 pass; typecheck, eslint, format:check clean; DOM audit home and
account-login 0 findings (scratch DB `lucy_spa_uxaudit_20261001`); no count rose from this Step.

## UX gate: Trang chủ, Dịch vụ, Đặt lịch, Lịch hẹn, Hóa đơn, Tài khoản at 360/390/768/1440 light and dark rendered (48 images), opened:
home 360, bookings 1440, book 360 dark, account 360, and the tab-switch frame sheets. No horizontal scroll on any page at 360/390.

## Open for the Owner

- The contact button cannot be both visible and never over text. While reading down it is hidden (0 overlaps on all pages at
  360/390); it can sit over a line when shown (top of a page, scrolling up). Alternatives: slim edge handle, or a header tool.
