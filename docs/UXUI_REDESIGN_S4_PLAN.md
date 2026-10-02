# UX/UI Step S4 plan: admin Seasons tab

Status: IMPLEMENTED (report `UXUI_REDESIGN_S4_SEASONS_TAB.md`); plan written under the Owner's standing instruction (2026-10-02: continue S3 -> S4 -> S5 without stopping for plan approval; stop only for an Owner decision or red CI). Base `498aa98` (S3). Contract: `UXUI_REDESIGN_DESIGN.md` 20.4, 20.6, 20.7, 21 (FR1-FR15). Web and kit only; no API, schema or migration change.

## Scope

- **Tab** "Seasons" (fourth tab of `/website`, `?tab=season`) with the page-header action "Create season". `MANAGE_WEBSITE_CONTENT` GLOBAL, as the other tabs.
- **List** (`DataTable` client mode, 20/page, one row height): season (name + preset), status badge, window (Vietnam time, last day inclusive), customer / admin / particles as text, linked items count, `⋮` menu (Edit, Enable/Disable, Delete). Above it: the year `ScheduleStrip` of the enabled seasons (as the popup tab) and a `ListToolbar` with a status filter and a year filter (page-local state, no labels above controls).
- **Form on its own page** (long form + preview, FR9): `/website/seasons/new` and `/website/seasons/:id`, saving returns to the tab with a toast. Sections: preset picker (radio cards: swatch, name, ornament thumbnail), name, dates (date inputs in Vietnam time; the Owner types the **last day inclusive**, the page sends next-day 00:00 as the exclusive end; solar presets prefill the registry's suggested window for the next occurrence, editable and saved only on Save, lunar ones prefill nothing, Q-S3), greeting VI / EN (preset default as placeholder, 80 chars), switches (customer, admin, particles, enabled), **Preview**, **Holiday content**.
- **Preview** (kit `SeasonPreview`): desktop and phone frames x light and dark, each a banner (`SeasonFrame`) plus greeting strip plus an accent chip, scoped to the chosen preset. Light/dark are forced per frame by a new scoped theme attribute (`data-preview-theme`): `tokens.css` gains two scope blocks (copies of the dark and light colour values, kept equal by `tokens.test`) and the generated `season.css` gains matching forced rules. No public preview URL exists (Q-S10).
- **Holiday content panel**: the popups and slides that follow this season (name, status, link to edit), plus "Create popup for this holiday" (opens `/website/popups/new?season=:id`) and "Add slide" (opens the slide drawer on the page with the link set). Popup form and slide drawer gain a "Holiday" select (none or any season); when one is chosen their own date fields are disabled and show the season window, and the request carries `seasonId` (an omitted `seasonId` would unlink).
- **Delete** (rule A): `ConfirmDialog` that lists how many popups and slides will be unlinked and hidden, with an extra line when the season is Active.
- **Errors**: `SEASON_OVERLAP` names the other season (looked up in the loaded list); `POPUP_OVERLAP` / `SLIDE_LIMIT` on a season save use the existing texts.
- **i18n**: vi + en for every string; no hard-coded text.

## Not in S4

Public/customer wiring, admin accent line and greeting chip (S5); any API change.

## Tests and gate

- Unit/jsdom: season form model (inclusive-last-day conversion, suggested window, validation, payload), `SeasonPreview`, token scope blocks, regenerated `season.css`, tab normalization, popup/slide `seasonId` payloads.
- Validation: affected package tests, typecheck, lint, `pnpm format:check`, whole-repo `pnpm test` before the push; ratchet counters only go down.
- UX gate (mandatory): screens Seasons list, season form and the popup form with a holiday at 360/768/1440 light + 1440 dark via `scripts/uxui-screens.mjs`; DOM audit on the changed pages against the scratch DB (`lucy_spa_uxaudit_20261001`), `--compare` baseline, 5-line UX-gate note in the report.

## Decisions I need from the Owner

None. Defaults taken: page-local list filters; the holiday panel opens the slide drawer in place; the popup and slide forms show the season select only when at least one season exists.
