# UX/UI Step S3 plan: seasons table, admin API, public endpoint, holiday links

Status: IMPLEMENTED in S3 (report `UXUI_REDESIGN_S3_SEASONS_API.md`); plan approved 2026-10-02, linked-content visibility moved into S3, delete rule A. Base `679b568` (S2 art approved, CI green). Contract: `UXUI_REDESIGN_DESIGN.md`
20.4, 20.6 and the decisions in 20.10 (Q-S2 linked content follows the season; Q-S7 `season_id` column added in S3; Q-S9 reuse
`MANAGE_WEBSITE_CONTENT`; Q-S11 overlapping enabled seasons are rejected). Follows the popup (Step 12) and slide (Step 13) patterns.

## Scope

API, database, contracts only; **no web change** (admin tab is S4, wiring is S5). One additive migration, no new permission, no new env.
Scope note: 20.8 lists "combined-holiday visibility in public popup/slides endpoints" under S5. I move the **API side** of it into S3
so linked content can never be public while its season is off; S5 stays pure web wiring.

## Database (one additive migration `20261021000000_uxui_s3_website_seasons`)

- `website_seasons`: `id` uuid, `preset_key` text (format check only; the API validates it against the registry, so a new preset
  needs no migration), `label` (internal name, 1-80), `starts_at`, `ends_at` timestamptz (`ends_at > starts_at`; the web form enters
  Vietnam time and sends the exclusive end, as for popups), `greeting_vi`, `greeting_en` (nullable, 1-80, plain text; empty = preset
  default), `apply_customer` and `apply_admin` (default true), `particles_enabled` (default true), `is_enabled` (default false),
  `row_version`, created/updated by and at. Index on `starts_at desc`. Marketing content, so a real delete is allowed (design 16.8).
- `website_popups.season_id` and `website_slides.season_id`: nullable uuid, FK `ON DELETE RESTRICT` (last line of defence; the API
  unlinks first), indexed. Existing rows and constraints are untouched.

## API (`apps/api/src/website`, `MANAGE_WEBSITE_CONTENT`, GLOBAL only, CSRF/Origin and rate limit as popups)

- `season.core.ts`, `season.service.ts`, `season.controller.ts`: `GET /api/v1/website/seasons` (all rows with status and `now`, client-side
  paging like popups), `GET :id`, `POST` create, `POST :id/update` (expectedVersion), `POST :id/enabled`, `POST :id/delete`.
- Status Draft, Scheduled, Active, Ended (derived at read time; no job). **Overlap:** an enabled season that overlaps another enabled
  one is refused with `SEASON_OVERLAP` (409, names the other id) under a new advisory lock; touching windows are fine.
- Every write is an `AuditEvent` (`SEASON_CREATED/UPDATED/ENABLED/DISABLED/DELETED`).
- **Public** `GET /api/v1/public/website/season?locale=vi|en`: the one active season or `204`, `Cache-Control: public, max-age=60`, no
  cookie, no personal data. Body `{ presetKey, greeting, endsAt, particles, customer, admin }`; the greeting is the locale's override or the
  registry default. Deviation from 20.4 to confirm: two extra booleans (`customer`, `admin`) so one endpoint also serves the admin
  accent line in S5. If both flags are off the answer is `204`.
- **Holiday links (20.6):** popup and slide requests accept `seasonId` (nullable) and return it. A linked item's own dates are ignored
  by the API: it stores the season window and the season save keeps it in sync, so the existing overlap, visible-limit and public
  queries keep working unchanged. Public visibility adds one rule: a linked item shows only while its season is enabled. The popup
  overlap check and the slide limit count a linked item only while its season is enabled. Saving a season re-checks its linked items
  (`POPUP_OVERLAP`, `SLIDE_LIMIT` roll the season save back and name the conflict).
- Contracts: season request/response/list/status types, `PublicSeasonResponse`, `seasonId` on popup and slide types.

## Tests

1. **Unit** `season.core.test.ts`: status derivation, field parsing (label, greeting 80, plain text, preset key from the registry, window),
   effective-enabled helper, greeting choice per locale.
2. **HTTP** `season.http.test.ts`: strict admin bodies, CSRF/Origin, anonymous public season, `204`, headers, no cookie.
3. **Integration** `season.integration.test.ts` on the scratch DB only (run this suite file alone; full integration at Step 14):
   permission and GLOBAL scope, CRUD with audit rows, row-version conflict, overlap refused / touching allowed / disable frees /
   two concurrent enabling saves (one wins), DB checks (window, key format, greeting length), public endpoint for Scheduled, Active,
   Ended, Disabled, both flags off, locale greeting, bad-data overlap picks the latest start; links: a linked popup and slide take the
   season window, a season edit re-syncs them, disabling the season hides them publicly and in `isPubliclyServed`, re-checks raise
   `POPUP_OVERLAP`/`SLIDE_LIMIT`, deleting a season unlinks and hides its items with audit, FK restrict as the last line.
4. Existing `popup.*` and `slide.*` suites stay green. Also `pnpm lint`, typecheck of contracts/database/api, `pnpm format:check`, then the
   whole-repo `pnpm test` before the push. No UI, so no screenshots; no DOM audit.

## Decisions I need from the Owner

1. **Deleting a season that has linked popups or slides.** (A, recommended) The delete goes through, the items are unlinked and set to
   hidden, and the audit log records it; nothing stays public by surprise. (B) The delete is refused until every linked item is
   unlinked or deleted by hand. (C) The linked popups and slides are deleted with the season.

Technical defaults (change any): linked items store the season window and follow it; the season list is client-side paged (a year has
about a dozen rows); the API takes UTC instants and the web converts Vietnam time (S4); the public response carries `customer` and
`admin` flags. Stop for approval before coding.
