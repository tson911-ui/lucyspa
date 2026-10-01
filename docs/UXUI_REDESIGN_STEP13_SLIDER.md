# UX/UI Step 13: homepage slider (Content C)

Status: implemented locally, awaiting Owner review (uncommitted, not deployed). Base 2526a51 (CI of that commit was still running at the start, no job red). Contract: UXUI_REDESIGN_DESIGN.md 16.2, 16.6-16.9, Q-CM7/10 and the Step 11 carry-over. Per Owner decision (steps up to 13): no screenshots, no DOM audit, no browser run; the quality gate and a real run of the flows happen once at Step 14.

## What changed

- **DB (1 additive migration)** `20261020000000_uxui_step13_website_slides`: `website_slides` (main image required, phone image optional, both `ON DELETE RESTRICT`; title/subtitle/link/alt VI+EN; optional window; dense non-unique `sort_order`). Link rule, lengths, link+label pairing, window and version are CHECKs. No new permission or env var.
- **API** (`apps/api/src/website/slide.*`, `MANAGE_WEBSITE_CONTENT` GLOBAL only): list/get/create/`:id/update`/`:id/enabled`/`:id/delete` and `POST reorder { orderedIds }` (one transaction; the ids must be exactly the existing slides, else `CONFLICT`). New slide goes last; delete closes the order up. At most 8 visible at once (`SLIDE_LIMIT`: busiest instant over the enabled windows, ended windows ignored). One advisory lock, always taken first, serializes slider commands. Audit `SLIDE_CREATED/UPDATED/ENABLED/DISABLED/DELETED`, `SLIDES_REORDERED`.
- **Carry-over from 11/12**: `mediaUsages` lists slides (desktop or phone image) so `deleteMedia` answers `MEDIA_IN_USE` and alt cannot be removed; `isPubliclyServed` serves images of a visible slide; both images need Vietnamese alt (`MEDIA_ALT_REQUIRED`).
- **Public (anonymous)**: `GET /api/v1/public/website/slides?locale=vi|en` (visible slides in order, max 8, `{locale}` resolved, slide alt beats image alt, `Cache-Control: public, max-age=60`).
- **Kit** (`packages/ui`): `Slider` (prev/next, dots, swipe, autoplay 6 s that stops for hover/focus/touch/Pause, none under reduced motion, single slide has no controls, fixed ratio, first image eager), `slider-core`, `MediaRow`, icons pause/play. Tokens only.
- **Web**: `/website?tab=slider`: sortable list (drag, touch, keyboard, up/down buttons; saved at once with rollback), status badge + schedule, `⋮` menu (Edit, Show/Hide, Delete with a "live now" warning), drawer for add/edit (two `MediaPicker` images, optional times in Vietnam time). Public home page shows the slider above the welcome copy and nothing when there are no slides.

## Decisions to confirm (not in the contract)

1. The list is paged 20 per page (FR); a drag reorders within the page (cross-page moves need a Step later).
2. Slide text sits **under** the picture (contrast-safe), not over it; Part 2 can restyle.
3. A phone image on any slide switches the whole slider to a 4:5 phone frame; otherwise 16:9.

## Tests and checks

- `pnpm test` whole repo green (server 35, worker 15, ui 259, web 329, api 186 + integration skipped there); `format:check`, `lint` (eslint + boundaries), `typecheck` of every package clean; UI ratchet unchanged; no `next-env.d.ts` change.
- Scratch-DB integration: `slide.integration` 11/11 (permission, validation, order, images, visible limit, public reads/images), `popup` 10/10, `media` 11/11, `website-slide-foundation` 1/1, `website-popup-foundation` 1/1.
- Not run (Step 14): screenshots, DOM audit, browser flow, two-connection race on the slider lock.

## Deploy (Owner)

`pnpm db:deploy` (1 additive migration), restart API/web. No `db:permissions:sync`. Rollback: the old build ignores the new table.
