# UX/UI Step 12: promotional popup (Content B)

Status: implemented locally, awaiting Owner review (uncommitted, not deployed). Base 4262b0d (CI green). Contract: UXUI_REDESIGN_DESIGN.md 16.2, 16.5, 16.7-16.9, Q-CM2/3/4/5/6/10 and the Step 11 carry-over (7.5 plan section 8). Per Owner decision (steps up to 13): no screenshots, no DOM audit, no browser run; both happen once at Step 14.

## What changed

- **DB (1 additive migration)** `20261019000000_uxui_step12_website_popups`: `website_popups` (image optional, title/body/CTA VI+EN, `starts_at`/`ends_at`, `is_enabled`, `row_version`). DB-enforced: window, lengths (title 120, body 300, label 40), "image or title", CTA link rule (internal `/vi|/en|/{locale}` or https only), link needs label and label needs link, `media_id` ON DELETE RESTRICT.
- **API** (`apps/api/src/website/popup.*`, `MANAGE_WEBSITE_CONTENT` GLOBAL only, no new permission): list/get/create/`:id/update`/`:id/enabled`/`:id/delete`, audit `POPUP_CREATED/UPDATED/ENABLED/DISABLED/DELETED`, versioned (`CONFLICT`). One enabled popup per instant: transactional check under an advisory lock, refusal `POPUP_OVERLAP` names the other popup's id; touching windows are fine, disabled ones may overlap. Picked image must exist and have Vietnamese alt (`MEDIA_ALT_REQUIRED`); alt cannot be removed while a popup uses the image.
- **Carry-over from 11**: `mediaUsages` now returns popups, so `deleteMedia` answers `MEDIA_IN_USE` for real (test "delete refused while referenced" + the FK as last defence).
- **Public (anonymous, read-only)**: `GET /api/v1/public/website/popup?locale=vi|en` (live popup in the visitor's language with fallback, `{locale}` resolved, `Cache-Control: public, max-age=60`, 204 when none) and `GET /api/v1/public/media/:id/:variant` (only images of an enabled, in-window popup; otherwise 404; immutable, nosniff, ETag). Neither reads a cookie.
- **Kit** (`packages/ui`): `PromoCard`, `PromoDialog` (modal: focus trap, Escape, backdrop, 44 px close, focus restore), `PromoPreview` (desktop + phone frames), `ScheduleStrip`. Tokens only.
- **Web**: `/website` has tabs Media | Popup (`?tab=popup`); popup tab = `DataTable` (status badge, window, image) + schedule strip of enabled popups + `⋮` row menu (Edit, Enable/Disable, Delete with a "live now" warning). Create/edit is its own page `/website/popups/new` and `/website/popups/:id` (long form + live preview). `MediaPicker` (search, upload, and asks for the Vietnamese description when the image has none). Media delete dialog lists where an image is used and offers nothing destructive. Public home page shows the popup after first paint, once per browser session (`ls-popup-seen:{id}:{rowVersion}`), never on account/workforce/checkout pages.

## Decisions to confirm (not in the contract)

1. Create/edit are pages, not a drawer (long form + preview, FR9). Enable/disable is a row action (`POST :id/enabled`), also audited.
2. `ApiError.field` now also reads a record id (needed to name the conflicting popup).
3. The public image route also serves `thumb` (same rule), so Step 13 can reuse it.

## Tests and checks

- `pnpm test` whole repo green: server 35, worker 15, ui 250, web 311 (includes the UI ratchet, unchanged), api 182 (+ integration, skipped there). New: popup rules 3, HTTP contract 1, kit 10 (promo 5, strip 5), web 16 (logic, first paint, VI/EN key parity). A first full run showed 5 unrelated API files failing under load (password hashing timeouts); they pass alone and in the second full run.
- Scratch DB integration: `popup.integration` 10/10 (permission, validation, image/alt rules, delete refused while used, overlap, versions, public reads, public images, delete), `media.integration` 11/11, `website-popup-foundation` 1/1, `website-media-foundation` 1/1.
- `format:check`, `lint` (eslint + boundaries), `typecheck` of every package: clean. No `apps/web/next-env.d.ts` change.
- Not run: browser flow, screenshots, DOM audit (Step 14); concurrent-save race on the advisory lock (the check is inside one transaction, covered logically, not by a two-connection test).

## Deploy (Owner)

`pnpm db:deploy` (1 migration, additive) then restart API/web. No new env var, no `db:permissions:sync`. Rollback: the old build ignores the new table.
