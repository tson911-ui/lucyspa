# UX/UI Step S4: admin Seasons tab

Status: implemented on base `498aa98` (S3, CI green). Plan: `UXUI_REDESIGN_S4_PLAN.md` (written under the Owner's standing instruction to continue S3 -> S5 without stopping for plan approval). Contract: `UXUI_REDESIGN_DESIGN.md` 20.4, 20.6, 20.7, 21. Web and kit only; no API, schema or migration change.

## What changed

- **Tab** "Seasons" (`/website?tab=season`, page-header action "Create season"): `DataTable` (20/page) with season, theme, status badge, dates (last day inclusive), what it applies to, linked content count and the `⋮` menu (edit, enable/disable, delete); a schedule strip of the enabled seasons; status and year filters.
- **Form page** `/website/seasons/new` and `/website/seasons/:id`: theme picker (radio cards with swatch and ornament), internal name, first and last day (Vietnam time; the request ends at the start of the day after the last day), greetings VI/EN with the theme default as placeholder (80 chars), switches (customer, admin accent line, effects, enabled), preview, holiday content. Solar themes prefill the registry's suggested days (next occurrence), lunar ones prefill nothing; nothing is saved until Save (Q-S3).
- **Preview** (kit `SeasonPreview`): desktop and phone x light and dark, the real `SeasonFrame` and `GreetingStrip` scoped to the theme. Light/dark are forced per frame: `tokens.css` gains the `data-preview-theme` scope (the dark block's selector list, plus a colours-only forced-light block kept equal by `tokens.test`), `season.css` gains matching forced rules per theme. No public preview URL.
- **Holiday content**: lists the popups and slides that follow the season; "Create popup for this season" opens the popup form with the link set, "Add slide" opens the slide drawer in place. The popup form and the slide drawer got a "Follow a season" select (shown when seasons exist); choosing one disables their own dates and shows the season's. Their requests always send `seasonId`.
- **Delete** (rule A): confirmation says how many popups and slides will be unlinked and hidden, plus an extra line for an active season. `SEASON_OVERLAP` names the other season; `POPUP_OVERLAP`/`SLIDE_LIMIT` keep their texts. All strings in vi and en.

## Tests and checks

- ui: `season-preview.test` 5 (four frames forced and scoped, no controls, tokens-only CSS with no border inside a card, brand button unchanged, picker radios), `tokens.test` (forced-light block equals the light values), regenerated `season.css` freshness; chart/shell/season tests follow the shared dark selector.
- web: `seasons.test` 12 (inclusive last day, round trip, validation, suggested days, greeting preview, filters, tab, form page, access, overlap id from the real client, `seasonId` always sent, vi/en key parity); popup and slide round-trips gained `seasonId`.
- `pnpm lint`, `pnpm format:check`, typecheck of every package and the whole-repo `pnpm test` before the push.

## UX gate (screens: seasons tab, season form new/edit, popup form with a season; 360/768/1440 light, 1440 dark; scratch DB, DOM audit)

1. Screens render with the shared kit only (Page, PageHeader, Card, FormSection, DataTable, Tabs); no new `wf-*`, hex or px spacing literal (CSS tests); ratchet counters unchanged.
2. Fixed during the gate: forced-dark captions were low contrast (the theme scope moved from the figure to the stage), long switch labels wrapped at 360 (shortened, detail moved to the section hint), holiday links were 24 px high (control height).
3. Audit left: list phone cards of two heights (same as the other tabs), `surface-style-mix` of the form footer and textarea (the same generic form-page finding as `discount-new`); no horizontal scroll, no off-grid spacing, no small target.
4. Compared with `docs/references` patterns of the popup page: same frame, footer order (Cancel, Save) and preview placement.
5. Screenshots in `.local/uxui-audit/shots/` (`website-seasons`, `season-new`, `season-detail`, `popup-season`), listed for Owner review in the chat summary.

## Deploy (Owner)

Web only (the S3 migration and API come first). No new env var or permission.

## Open questions

None.
