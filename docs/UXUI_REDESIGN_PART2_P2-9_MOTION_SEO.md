# Part 2, P2-9: motion pass and search-engine data

Contract 7 (motion), 9 and Q-P2-4 (SEO). No API, database or permission change.

## Motion (customer side only; tokens and `.ls-site` scope, none of it loads in the staff area)

- **M1 reveal / M4 header**: already in place (P2-1, P2-4); unchanged.
- **M2 hero**: no text animation; the hero picture gets a transform-only settle (`scale` 1.04 to 1 on the reveal tokens) inside a clipping frame (`.ls-photo`).
- **M3 hover**: photo scale 1.03 (zoom token), group/visit cards step border and shadow, the "Xem tất cả" arrow nudges 4 px. Only where hover exists (`@media (hover: hover)`).
- **M5 route**: `RouteFade` (opacity only) now wraps every public page (`(public)/template.tsx`) and the whole account area including the sign-in pages (`account/template.tsx`, replacing the one inside `(app)`); the fade wrapper passes the remaining height on so a short page still pushes the footer down.
- **M6 parallax**: the hero picture only, CSS scroll-driven (`animation-timeline: view()`) inside `@supports`, at >= 1024 px, fine pointer, `prefers-reduced-motion: no-preference`, and only when `MotionGate` (new tiny client piece in the site frame) has marked the document `data-ls-motion="full"`, i.e. not data saver and not a device with 2 GB or less. Travel is the `--ls-parallax-shift` token; `scale` and `translate` are used (not `transform`), so settle, zoom and parallax never replace each other.
- **M7 booking**: the tick scales in, the step bar fill eases, and the phone action bar is mounted with the first chosen service so it slides up then (the phone tab bar leaves only while the bar is there).
- Rules kept: tokens only (the existing literal-duration test still passes), all durations are 0 under reduced motion, only `scale`/`translate`/`opacity` move (a new test fails if a keyframe animates a layout property), no motion library.

## Search-engine data (home, service list and a service only)

- Page metadata (`lib/public-metadata.ts`): title, description (from Shop info and the live catalogue), canonical, `hreflang` vi/en/x-default, Open Graph and Twitter data, `robots: index, follow`. A service that does not exist (404) or cannot be read stays `noindex`. Everything else keeps the layout default `noindex, nofollow`: the member area and its sign-in pages, the staff area and the season preview.
- `sitemap.xml` (both languages for home, list and every live service, each with its alternates) and `robots.txt` (disallows account, staff area, season preview and API; points at the sitemap) are built at request time from the visitor's own host and protocol (`x-forwarded-*`/`host`, validated as a plain host), so **no new environment variable** is needed.
- LocalBusiness (`DaySpa`) JSON-LD on the home page from Shop info only: slogan, phone, address, hours (24:00 written as 23:59), map link, hero picture; `<`, `>`, `&` are escaped so the data cannot close the tag.
- Verified on the running scratch app (`.local/p2-seo-check.mjs`): home/list/detail answer `index, follow` with canonical and 3 alternates; unknown service 404 + `noindex`; account, sign-in and staff login `noindex, nofollow`.

## Placeholder photo (decision Q-P2-11)

The file is `docs/mockups/part2/assets/placeholder-hero.jpg`. Importing it is an **admin upload on the live site** (Admin > Media > upload, title "PLACEHOLDER - replace with a real shop photo", Vietnamese alt text required), then choosing it in Admin > Website > Shop info > home image. It is in the deployment runbook as an Owner step; this Step does not put any image in a database.

## Tests

`seo-core.test.ts` (origin validation, alternates, clipping, service description, hours, JSON-LD safety, sitemap, robots, image URLs), MotionGate and the hero-motion CSS rules in `site-frame.test.tsx`, the booking first-paint test (no bar before a service is chosen). Real-app gate on the changed pages with the picture, without a season and with one: see the commit.
