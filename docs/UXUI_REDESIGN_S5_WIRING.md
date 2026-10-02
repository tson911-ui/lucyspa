# UX/UI Step S5: wiring the active season into the app

Status: implemented on base `5375b0a` (S4, CI pending at the start of S5). Plan: `UXUI_REDESIGN_S5_PLAN.md`. Contract: `UXUI_REDESIGN_DESIGN.md` 20.2, 20.5, 20.9. Web only; no API, schema or migration change (combined-holiday visibility of public popups and slides shipped in S3).

## What changed

- **Server read** `lib/season-server.ts`: `GET /api/v1/public/website/season?locale=` from the server, 60 s data cache, 1.5 s timeout, body checked by `parsePublicSeason` (registry preset, greeting <= 80, real date and booleans). A `204`, error status, bad body, network failure or timeout is "no season": the app renders exactly as before.
- **Root layout**: `<html data-season="<preset>">` on first paint (no flash). `data-season-admin="off"` when the schedule excludes admin or this device hid it (cookie `ls-season-admin=off`, one year, Lax). The layout now reads that cookie, so the public home is rendered per request; the season call itself is cached.
- **Customer side**: `SeasonBand` (server component) under the public site header and at the top of the member area: the S2 `SeasonFrame` with greeting and ornaments, `SeasonParticles` inside the band when the schedule and preset allow (after first paint, none under reduced motion, paused in a hidden tab), and the per-device "Turn off effects" button. No band when `customer` is off.
- **Admin touch**: the topbar accent line (S1) now follows `data-season`/`data-season-admin`; a small greeting chip with "Hide season" / "Show season" sits under the dashboard header (client-side, after paint). Hiding sets the cookie and the attribute at once. No ornaments, particles or motion in admin.
- **Mobile**: nothing to build. The app reads the same public endpoint plus the shared registry (`packages/contracts`: tokens, default greetings, ornament ids, particle kind) and bundles its own native ornaments (Q-S8).
- vi + en strings in `i18n/season.ts`. Audit script: the aria-hidden particle layer (`.ls-fx`) is excluded (decoration clipped by its band).

## Tests and checks

- web `season-core.test` 7: answer validation (every preset, bad shapes), fail-closed server read (204, 500, bad body, network, bad JSON; anonymous, 1.5 s, 60 s cache), root attributes, cookie, band spec, band server render (greeting, hidden ornaments, effects button only when effects exist, nothing on `customer: false` or a failing API), texts in both languages.
- `pnpm lint`, `pnpm format:check`, typecheck of every package and the whole-repo `pnpm test` before the push; ui CSS tests cover the new rules (tokens only).

## UX gate (public home with an active season, member login, dashboard; 360/768/1440 light, 1440 dark; scratch DB with an active season, a linked popup and a linked slide)

1. The band sits under the header on a 16/24 px rhythm, aligned to the page edges; the greeting wraps to three lines at 360 inside its gutters; the effects button is a 44 px ghost button at the trailing edge.
2. Ornaments and particles stay in the band gutters, never under text; brand red buttons and text are unchanged (D1).
3. Dashboard: accent line under the topbar, chip and Hide button on one line under the header; no new audit finding on the dashboard (same 10 as before).
4. Remaining audit findings on the home and member login are the legacy public layout (`welcome-*`, `wf-login-card`), which Part 2 replaces; none comes from the band. The `.ls-fx` layer is now excluded from the audit.
5. Screenshots: `.local/uxui-audit/shots/home-*`, `account-login-*`, `dashboard-*`.

## Deploy (Owner)

Web only on top of S3/S4 (see the S1-S5 runbook). `API_UPSTREAM_ORIGIN` is unchanged: the layout uses the same setting as the rewrites (default `http://127.0.0.1:3001`).

## Open questions

None.
