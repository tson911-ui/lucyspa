# UX/UI Part 2, Step P2-4: public home (with the services pages)

Contract: `UXUI_REDESIGN_PART2_DESIGN.md` 5.2 and 5.3. **Stop for Owner review after this Step.** The services list and detail
(planned for P2-5) were built here so no link on the home page leads to a 404; P2-5 shrinks to polish (see the plan).

## What changed

- **Home** (`HomeContent`, pure): h1 = the Owner's tagline; one factual sentence; "Đặt lịch ngay" and "Xem dịch vụ"; the hero media is the
  Slider when a slide is live, else the picture chosen in Shop info (16:10 frame), else a brand panel. A facts strip (hours headline, address,
  hotline link), one card per live catalogue group (first 3 services, prices as listed, "Xem tất cả" to `/services?group=`), and "Ghé thăm Lucy Spa"
  (grouped hours, address, hotline, "Đặt lịch ngay", "Chỉ đường" = the Owner's map link or a maps search link, no embedded map). **No "why choose us".**
  A part that cannot be read shows a notice with a reload button; the rest renders. Cards reveal on scroll (`Reveal`, contract 7 M1).
- **Services** (`/services`, `/services?group=`, `/services/[code]`): filter pills (links), one section per group, cards with estimate, price,
  description and "Đặt lịch" (`/account/book?service=CODE`, preselect is handled in P2-7); detail with facts, per-nail or estimate note, breadcrumbs and the
  other services of the group. Unknown, paused or bad codes are a real **404**; a failed read is a notice. Nav entry "Dịch vụ" is on.
- **Footer** gets the contact column (address, hotline, hours headline, tagline) from the shop profile.
- **Data:** server reads with checked parsers (`public-site-core.ts`: malformed answers are dropped, only same-origin media paths and https links
  survive), formatters for price (`5.000 ₫ – 30.000 ₫/ngón`), estimate, links. The season preview in the admin loads the same data in the browser.
- **Fix of a latent S5 bug found here:** Next's fetch cache never replaces a stored 200 with a 204, so an ended season stayed on the site. The season and
  the public reads now use a 60 s in-process memo (`ttl-memo.ts`; failures 5 s; one read per key at a time), `cache: 'no-store'`.
- **Fix of a latent Step 13 flaw:** the slider's picture box grew to a portrait image's height; it is now clipped to its 12:5 frame.
- Loading skeletons only on home and the services list (a `loading.tsx` above the detail route would send HTTP 200 before `notFound()`).
- Tooling: the audit script knows the public frame (docked chrome, menus and price lists are not record lists, pinned card actions, card action rows);
  `uxui-screens.mjs` scrolls through the page before capturing (reveal-on-scroll). A guard test fails if `site.css` reuses a class another stylesheet owns
  (`.ls-facts` had silently picked up an admin background).

## Migrations, permissions

None.

## Tests

- New: `public-site-core.test.ts` (parsers, price/estimate/links, filter), `components/public/public-pages.test.tsx` (home states, hero media choice, footer,
  list, detail), `ttl-memo.test.ts`, `site-frame.test.tsx` (class-clash guard). Updated: `slides.test.tsx` (HomeSlider props), `season-core.test.tsx` (`no-store`),
  `site-nav.test.ts`. Whole-repo `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` clean before the push.

## UX gate

- Real app, `gate14.mjs` on `/vi` and `/en` home, services list (all, filtered, EN), service detail VI and EN, 360/768/1440 light and dark: **42 renders, DOM audit 0,
  axe 0.** Missing service and bad code answer 404 (checked with curl).
- Opened: home 360/768/1440 light and dark with the Celebration season live; the no-season state (360/1440 light and dark); a chosen hero picture; a live slide
  (portrait test image cropped to the frame); services list 768 and 360, group filter; service detail 1440 light and 360 dark. Checked: hero, facts, group cards,
  visit cards, footer contact column (two columns on tablets), tab bar, season art and strip around the new chrome, 44 px targets, no horizontal scroll.
- Scratch-DB hours open 00:00 to 24:00 (the preview shows that); production default is 09:00 to 21:00. Scratch catalogue names are test data.

## Open questions

None. The Owner reviews the home on the real app before P2-5.
