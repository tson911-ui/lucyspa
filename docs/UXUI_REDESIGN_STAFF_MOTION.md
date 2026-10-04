# Staff area motion, scrolling overlays and the Back button

Run on 2026-10-04 against the scratch database (web 3100, API 3101). Staff area (`/workforce`) and member area (`/account`).

## What changed

- **Same motion system as the public site, on the staff area.** Sidebar and in-page links use `PrefetchLink` (`prefetch`, production only; off for data saver and low memory via `prefetchAllowed`). The current page's sidebar highlight is one element that slides (`useSlidingPill`, now shared with the public menus; `.ls-sidebar-pill`, `--ls-dur-slide`). Sidebar groups open and close by easing grid rows (`.ls-nav-collapse`); a closed group is `visibility: hidden`. A navigation eases the new page in (`RouteEnter stack` in the `(app)` template; the first load never animates).
- **Hover colours are untouched** (light solid `#782b37` + white, dark solid pink + dark text). Only the way they arrive is smooth: buttons ease over the base duration and lift half the public distance (fine pointers), press dips; nav, tabs, menu items, table rows and media tiles ease.
- **Skeletons.** `LoadingState` (block and page variants) replaces the bare "Đang tải…" line in all 29 places, the session check and a route `loading.tsx` inside the shell.
- **Data is never old.** A staff page is only code; every number is fetched with `cache: 'no-store'` when it opens, `staleTimes` is not raised, and a page restored from the back/forward cache reloads (`FreshOnReturn`). Pinned in `staff-freshness.test.ts`.
- **Reduced motion / data saver / low memory:** tokens are 0 for reduced motion; `MotionGate` + `html[data-ls-motion='reduced'] .ls-shell` zero slide, rise, lifts and the skeleton loop; the pill never slides and links do not prefetch.
- **Overlays scroll.** Cause: the backdrop grid row was `auto`, so a tall drawer stretched past the screen and its footer was out of reach. Now the row is exactly the viewport, the panel clips, header and footer are fixed and only the body scrolls (dialogs, drawers, bottom sheets, promo dialog; `dvh` with a `vh` fallback).
- **Back button on every page** except the staff dashboard and the public home: staff `(app)` pages, member pages and the booking page. `PageBack` goes `router.back()` when the tab has in-app history (filters, search, scroll are restored), else links to the logical parent (`lib/navigation/back.ts`: detail to list, list to dashboard or account home, website entries to their tab, version form to its program). Shared ghost button, VI/EN from `common.back`, `ls-back-row` is a new fixed place in the audit (FR5).

## Migrations, permissions, API

None. No new environment variable.

## Tests

`pnpm format:check`, `lint`, `typecheck`, `test` (whole repo), `build` and `smoke`: see the final chat message. New: `staff-motion.test.tsx` (prefetch policy, sidebar pill, overlay and Back CSS pins), `staff-freshness.test.ts`, `back.test.ts`.

## UX gate

Opened screenshots: Thêm dịch vụ drawer at 1366x768 light and dark, 768x600 dark, 360x640 light (sheet, footer pinned); Thêm kỹ năng, Tạo nhóm, Tạo vùng dialogs at 360 and 1366; member bookings 1440 light, booking detail 360 dark, booking page 1440, POS invoice 360, dashboard 1440 (no Back). DOM audit (gate14): no new finding except the Back row, fixed in the audit; known leftovers are data-driven FR8 on the dashboard and employees at 360 and the POS invoice table scroll region (axe), as before.

## Open

- The member pages' Back reads `document.referrer` after a reload; the first page of a tab with no history always goes to the parent.
- Public service pages keep their breadcrumbs and have no Back button (the request named the admin and the account area).
