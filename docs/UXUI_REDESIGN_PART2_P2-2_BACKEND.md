# UX/UI Part 2, Step P2-2: shop info and public read endpoints

Contract: `UXUI_REDESIGN_PART2_DESIGN.md` section 6. Backend only: no screen changes (the admin tab is P2-3).

## What changed

- **Migration `20261023000000_uxui_part2_shop_info`** (additive): table `website_shop_info`, one row (`id = 'shop'` by CHECK), columns
  tagline VI/EN, address, hotline, map URL (https only), `hours_branch_id`, `hero_media_id` (both ON DELETE RESTRICT), row version,
  updater. Seeded with the Owner's values (tagline, 04 Nguyễn Quang Bích, hotline 0934 936 101, EN tagline from Q-P2-10).
  Opening hours are **not** stored: they come from the chosen branch's `branch_operating_hours` (default: the oldest active branch).
- **Admin API** `GET/POST /api/v1/website/shop-info` (`MANAGE_WEBSITE_CONTENT`, GLOBAL only, row version -> `CONFLICT`, audit
  `SHOP_INFO_UPDATED` with before/after). The GET also returns the active branches and a preview of the grouped hours.
- **Public API** (anonymous, `cache-control: public, max-age=60`, no cookie): `GET /api/v1/public/site?locale=`,
  `GET /api/v1/public/services?locale=`, `GET /api/v1/public/services/:code?locale=`. Only active services of active categories
  offered by an active branch; cheapest first (Q-P2-8); only `estimated*` minutes (never `durationMinutes`), no ids.
- The hero image counts as a media use (`SHOP_INFO`: delete refused with `MEDIA_IN_USE`, alt text required) and is publicly served.
- Contracts: `PublicSiteResponse`, `PublicHoursGroup`, `PublicServices*`, `WebsiteShopInfo*`.

## Permissions

None added (`MANAGE_WEBSITE_CONTENT` reused); no `db:permissions:sync` change.

## Tests

- Unit: `shop-info.core.test.ts` (hours grouping incl. gaps and missing days, hotline link, field validation); HTTP:
  `shop-info.http.test.ts` (Origin/CSRF, strict body, typed errors, public cache headers, locale required).
- Integration (authtest DB): `shop-info.integration.test.ts` (permission, seed values, grouped hours from a branch, audit, conflict,
  field errors, inactive branch fallback, hero image alt/serve/usage/delete block, catalogue visibility rules and absence of
  internal fields, 404s) and `website-shop-info-foundation.integration.test.ts` (single row, CHECKs, https link, restricted keys).
  Neighbouring `media` and `popup` integration suites re-run green. Added to `test-auth-integration.mjs` and `test:integration`.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck` clean; whole-repo `pnpm test` before the push.

## Open questions

None.
