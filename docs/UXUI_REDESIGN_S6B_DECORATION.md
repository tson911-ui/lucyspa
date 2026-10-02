# UX/UI Step S6b (+S6c): season decoration options, custom events, Celebration kit, full-page preview

Status: implemented on base `7ac7476`. Plan and locked decisions: `UXUI_REDESIGN_S6_PLAN.md` (sections 5-7, 11). The Owner asked for S6b and S6c together.

## What changed

- **Migration** `20261022000000_uxui_s6b_season_decoration` (additive): 9 columns on `website_seasons` (`slot_header/logo/corners/dividers/footer/tint`, `greeting_strip`, `greeting_footer`, `particle_density` with a CHECK; particles stay `particles_enabled`) and table `website_season_slot_media` (PK season+slot, slot CHECK, media FK RESTRICT, season FK CASCADE). Old rows mean "everything on, medium". No permission change.
- **API**: create/update take the 8 switches, `particleDensity` and `slotMedia` (all optional: omitted = default on create, unchanged on update; `null` is refused). Media must exist (locked FOR SHARE); a season is listed as a usage of its images (`MEDIA_IN_USE` blocks delete; alt text is not required for decoration). Audit records the effective values. Public `GET /public/website/season` gains `slots`, `density`, `greetingStrip`, `greetingFooter`, `media` (customer side only); `isPubliclyServed` serves a slot image only while its season is live.
- **contracts**: `celebration` kit (palette, no yellow, `customEvent`), slot/density registry, `SeasonDecorationFields`. **ui**: Celebration art (balloon-and-ribbon bunting, corner bunches, cake, gifts, confetti), every slot switchable (a switched-off row renders nothing; plain divider rule keeps the rhythm; bare effects switch when the strip greeting is off), media images per slot (`safeImageUrl`, aria-hidden, lazy), `SeasonSlotRow`, `SeasonLivePreview`.
- **web**: form reordered (Event name first, base kit, schedule with the computed Tet year name and an art note, greeting + the two greeting switches, Decoration section: 7 slot rows with image picker, density control). Full-page preview: route `/{locale}/season-preview` (404 unless the API answers 200 for the seasons list with the visitor's cookie, i.e. MANAGE_WEBSITE_CONTENT; `X-Frame-Options: SAMEORIGIN` for that one path, noindex, no-store) draws the real home from the unsaved draft sent by `postMessage` (origin and source checked, parsed by the live parser); one frame at a time (desktop 1440 / phone 390, light / dark), "Open at 100%".

## Tests

Whole-repo `pnpm test`, `pnpm format:check`, `pnpm lint` pass. New: contracts/ui (celebration palette, motifs, slot switches, images, preview scale), API unit + HTTP (strict decoration body), web (draft, message parsing, guard, frame slots, form), DB foundation and API integration (`media`, `popup`, `slide`, `season` suites, 44 cases) against the dev DB.

## UX gate (real web build + scratch API/DB; images opened)

1. Public home, Celebration: 360/768/1440 light, 1440 dark `.local/uxui-screens/s6b-celebration-*`; all slots off `s6b-off-*`; all 7 images `s6b-images-*`. Fixed: phone footer cake under the plaque, bright dark-theme floor, double-gap plain divider.
2. Admin season form and preview (phone, dark): `.local/uxui-audit/shots/season-new-*`, `season-detail-*`, `s6b-detail-1440-dark-preview.png`.
3. DOM audit and compare: see the final chat message.

## Deploy / open questions

Deploy order as S3: migrate, API, web. `vu-lan` kit is S6e (not in the registry yet). The bottom corner pieces of Tet and Christmas belong to the footer scene; the Corners switch drives the header corners (a corner image fills all four).
