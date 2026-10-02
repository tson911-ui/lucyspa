# UX/UI Step S5 plan: wiring the active season into the app

Status: IMPLEMENTED (report `UXUI_REDESIGN_S5_WIRING.md`); plan written under the Owner's standing instruction (2026-10-02: continue S3 -> S4 -> S5 without stopping for plan approval; stop only for an Owner decision or red CI). Base: S4 commit. Contract: `UXUI_REDESIGN_DESIGN.md` 20.2, 20.5, 20.9, 21. Web only; no API, schema or migration change (the combined-holiday visibility of public popups and slides already shipped in S3).

## Scope

- **Server read** (`lib/season-server.ts`): the root layout asks the API for `GET /api/v1/public/website/season?locale=` with a 60 s data cache, a 1.5 s timeout and a shape check (the preset key must be in the registry). Any failure, timeout, `204` or odd body means "no season": the app renders exactly as today (fail closed, 20.9).
- **Root layout**: `<html data-season="<preset>">` when a season applies, so tokens are present on the first paint (no flash); `data-season-admin="off"` when the season does not apply to admin or this device hid it (cookie `ls-season-admin=off`, one year, Lax; the layout reads it). Reading the cookie makes the shell render per request; the season itself is cached for 60 s.
- **Customer side** (public site shell and the member area): a `SeasonBanner` under the header when `customer` is on: the S2 `SeasonFrame` with the greeting, ornaments in the gutters and, when `particles` is on and the preset has any, `SeasonParticles` inside the band, plus the per-device "Turn off effects" button (`ls-fx`). Server-rendered band, particles after first paint, nothing under reduced motion. Text and buttons keep the brand tokens (D1).
- **Admin touch** (Q-S4): the 2 px accent line under the topbar already reads `--ls-season-line`; it now turns on with `data-season` and off with `data-season-admin="off"`. A small greeting chip with a "Hide" control sits in the dashboard header (the chip and a "Show" button replace each other); hiding sets the cookie and the attribute at once. No ornaments, particles or motion in admin.
- **Mobile**: no code. The app reads the same public endpoint plus the shared registry (tokens, greeting defaults, ornament ids) and bundles its own native ornaments (Q-S8); noted in the report and the handoff.
- **i18n** vi + en for the new buttons.

## Tests and gate

- Unit: season response parsing and fail-closed cases, root attributes (`data-season`, `data-season-admin`, cookie), banner server render (greeting, ornaments hidden from assistive technology, particles only when asked, nothing when `customer` is off), admin chip texts, cookie helper.
- Validation: affected package tests, typecheck, lint, `pnpm format:check`, whole-repo `pnpm test` before the push.
- UX gate (mandatory): public home with an active season, member login page, and the dashboard with the chip at 360/768/1440 light and 1440 dark via the real-app capture against the scratch DB (`lucy_spa_uxaudit_20261001`), DOM audit compared with the baseline, 5-line UX-gate note in the report.

## Decisions I need from the Owner

None. Defaults taken: the banner sits directly under the site header (and at the top of the member area); the effects button sits under the band at the trailing edge and exists only when effects are on for the season.
