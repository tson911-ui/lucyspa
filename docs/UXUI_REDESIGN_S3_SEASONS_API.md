# UX/UI Step S3: seasons table, admin API, public endpoint, holiday links

Status: implemented on base `679b568` (S2 art approved, CI green). Plan: `UXUI_REDESIGN_S3_PLAN.md` (approved 2026-10-02 with linked-content visibility moved into S3; delete rule A). Contract: `UXUI_REDESIGN_DESIGN.md` 20.4, 20.6, 20.10. No web change (admin tab is S4, wiring is S5).

## What changed

- **DB (1 additive migration)** `20261021000000_uxui_s3_website_seasons`: `website_seasons` (preset key format check only, label 1-80, window `ends_at > starts_at`, greetings 1-80, customer/admin/particles/enabled switches, `row_version`), plus nullable `season_id` on `website_popups` and `website_slides` (FK `ON DELETE RESTRICT`, indexed). No new permission or env var.
- **API** (`apps/api/src/website/season.*`, `MANAGE_WEBSITE_CONTENT` GLOBAL only): list/get/create/`:id/update`/`:id/enabled`/`:id/delete`. Status Draft/Scheduled/Active/Ended derived at read time (no job). Enabling a season that overlaps another enabled one is `SEASON_OVERLAP` (409, names the other id); touching windows are fine. Audit `SEASON_CREATED/UPDATED/ENABLED/DISABLED/DELETED`.
- **Public** `GET /api/v1/public/website/season?locale=vi|en`: `{ presetKey, greeting, endsAt, particles, customer, admin }` or `204`, `Cache-Control: public, max-age=60`, no cookie. Greeting = the schedule's override for the locale, else the registry default. `204` when both sides are off or the preset left the registry. Deviation from 20.4 (approved): the two side flags; `particles` also requires the customer side.
- **Holiday links (20.6)**: popup and slide bodies take optional `seasonId` and return it. A linked item stores the season window (what it sends is ignored) and every season save keeps it in step (version moves, so an open form gets `CONFLICT`). A linked item is public, counted for the popup overlap rule and the 8-slide limit, and served as an image only while its season is enabled; its status reads Draft/Hidden otherwise. Saving or enabling a season re-checks its items (`POPUP_OVERLAP`, `SLIDE_LIMIT` roll the save back).
- **Delete (rule A)**: the items are unlinked and set hidden, with `POPUP_DISABLED`/`SLIDE_DISABLED` audit events (reason `SEASON_DELETED`) and the ids in `SEASON_DELETED`.
- **Locking**: one lock order everywhere: season advisory lock, then popup or slide lock, then rows. Popup and slide create/update/enable now take the season lock first, so a season edit and a linked save cannot deadlock.

## Tests and checks

- Unit `season.core.test` 6/6; HTTP `season.http.test` 1/1 (strict bodies, CSRF/Origin, anonymous public season, `seasonId` on popup and slide bodies); `popup.http`/`slide.http` expectations gained the optional key.
- Scratch-DB integration (`lucy_spa_authtest_20261001`): `season.integration` 11/11 (permission and scope, CRUD + audit + conflict, validation, overlap/touching/disable frees, public cases incl. bad-data tie-break, popup and slide links, limits, delete rule A), `popup` 10/10, `slide` 11/11, `media` 11/11, database foundations `website-season` / `popup` / `slide` 1/1 each. `season.integration` is added to `scripts/test-auth-integration.mjs`, the foundation test to the database `test:integration` list.
- Typecheck of every package, lint, format:check and the whole-repo `pnpm test` before the push (see the commit).
- Not run: the two-connection race on the season lock (same pattern as popup/slider; goes with the Step 14 race checks). No UI, so no screenshots or DOM audit.

## Deploy (Owner)

`pnpm db:generate`, `pnpm db:deploy` (1 additive migration), restart API. No `db:permissions:sync` needed (no new permission). Rollback: the old build ignores the new table and columns.

## Open questions

None. S4 must send `seasonId` on popup/slide saves (an omitted `seasonId` unlinks the item) and add the `SEASON_OVERLAP` error text.
