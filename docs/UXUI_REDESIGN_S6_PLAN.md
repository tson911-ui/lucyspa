# UX/UI Step S6 plan: seasonal reskinning of the whole customer site

Status: APPROVED by the Owner 2026-10-02 after the Tet mockup (decisions in section 11, LOCKED). S6a-S6e are all implemented (reports `UXUI_REDESIGN_S6A_ENGINE.md`, `S6B_DECORATION`, `S6D_KITS`, `S6E_KITS`). Base `8322941` (S1-S5 deployed). Contract: `UXUI_REDESIGN_DESIGN.md` 20 (S6 replaces the 20.2 decision "particles only inside the banner"; 20.1, 20.3 and the Q-S1 yellow rule stay). Owner brief of 2026-10-02: decoration layer across the whole public site, 9 presets, custom events, per-slot customization, full-page preview, screenshot-gate fix.

## 1. Mockups (opened and checked)

A static page that loads the **real** `tokens.css`, `season.css`, `components.css`, `shell.css` and web `globals.css` and the real home markup, with the decoration layer prototyped on top (`.local/season-s6/mockup.html`, git-ignored; art colours come from its own palette, not yet from the registry). Be Vietnam Pro loaded as in the app. Files in `.local/season-s6/mockups/`:

- Tet: `s6-tet-1440-light.png`, `s6-tet-1440-dark.png`, `s6-tet-390-light.png`, `s6-tet-390-dark.png`
- Christmas: `s6-christmas-1440-light.png`, `-1440-dark`, `-390-light`, `-390-dark`
- Slot maps (numbered, dashed outlines): `s6-tet-map-1440-light.png`, `s6-christmas-map-1440-light.png`

I opened all 10 images. Problems found in my own first renders, now fixed in the mockup and turned into rules (section 3): Christmas footer text invisible in dark (white snow under light text), footer text colliding with art on a phone, logo accent overlapping the wordmark, header lanterns hidden under the corner branches on a phone, a doubled divider line (header border plus divider), a muddy pink band in dark. Known limits of the mockup: particles are a frozen frame (live ones animate), Tet's goat and the other art are first drafts for review, `Tat hieu ung` is the existing S5 button.

## 2. What changes and what does not

Layout, copy, buttons, links, routes and API behaviour of the public pages are unchanged; text, buttons and accents keep brand tokens (D1). Decoration is `aria-hidden`, `pointer-events: none`, no focusable child, no image request unless the Owner picked a media image, no third-party script. Admin keeps only the S5 accent line and chip. Reduced motion: no particles (checked in the component). Nothing is drawn under readable text.

## 3. The decoration model (7 slots)

| #   | Slot        | Where                                                                              | Tet                                                       | Christmas                               |
| --- | ----------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| 1   | `particles` | fixed viewport layer, **behind** the content layer                                 | mai and peach petals                                      | snow                                    |
| 2   | `header`    | top decor row (96 px desktop, 68 phone), a rail across the width                   | red lanterns on a cord, small blossoms                    | string lights                           |
| 3   | `logo`      | beside the wordmark, outside its letters                                           | mai sprig                                                 | santa hat                               |
| 4   | `corners`   | the four corners: top two in the header row, bottom two in the footer scene        | mai branches; li xi and paper firecracker strings         | pine garlands with bow; trees and gifts |
| 5   | `dividers`  | replaces the header border, the line before the footer and (Part 2) section breaks | coin with blossoms                                        | pine twig with berries and a snowflake  |
| 6   | `footer`    | footer scene (300 px desktop, 224-268 phone) above the existing footer text        | zodiac animal (Goat, Dinh Mui 2027) on a gold ingot, band | snowy hills, greeting plaque            |
| 7   | `tint`      | two soft radial washes on `body` (CSS only)                                        | pink, faint warm                                          | pale green and ice blue                 |

Rules fixed by the review:

1. **Layering and keep-out (Owner decision 1, tightened after the mockup review):** particles live in a layer behind the content (`z-index: 0`, the shell `position: relative; z-index: 1`) **and** the layer carries a mask with a soft hole over every line of text, button, input and opaque block on the page (measured from the DOM after first paint and on resize, content change and font load). A petal therefore never crosses or sits behind a word: it fades out as it reaches text and in again after it. The mockup's petals visibly crossed "Dang nhap thanh vien"; the real build must not.
2. **Reserved rows, not overlays:** the header row and footer scene take their own height, so art never sits on the logo, nav or greeting. Top stack adds about 96 + 28 (divider) + the greeting strip; the S5 "Turn off effects" button moves **into** the strip's trailing edge to save its own row (about 220 px desktop in total, 170 phone).
3. **Text on art always sits on a surface:** the footer greeting is on a token panel (snow plaque, pink band), with a contrast test per kit, theme and panel. No text directly on drawing.
4. **Art uses its own tokens** `--ls-season-art-1..8` (per theme), never the brand, text or status tokens; yellow only in Tet, Mid-Autumn, 30/4-1/5 and 2/9 (Q-S1, test extended to the new tokens). Vu Lan and Celebration never use yellow.
5. Logo accent sits above or beside the letters (hat on top edge, sprig at the end), 24-46 px, never wider than the header's free space; on 360 px it shrinks (no wrap).
6. Phone drops elements, never shrinks text: fewer lanterns (2 vs 9), smaller corners, zodiac above the plaque.
7. Particles: density low / medium / high = 12 / 24 / 40 on desktop, 6 / 12 / 20 on a phone; `transform` and `opacity` only; start after first paint; paused in a hidden tab; none under reduced motion or `ls-fx=off`.

Architecture: art is TSX/SVG per kit in `packages/ui/src/season-art/<kit>.tsx` (pure functions of a palette, server-rendered, repeats by CSS: lantern count by breakpoint, no JS layout). `SeasonDecor` (server component) renders rows and slots from the public season payload; the public layout, member layout and later Part 2 pages all use it, so adding a page needs no art work. The S5 `SeasonBand` becomes the slim greeting strip; the S2 ornament motifs stay only as picker thumbnails.

## 4. Kits (registry in `packages/contracts`, data only)

Ten kits: the 8 existing keys, new `vu-lan`, new `celebration`. Per kit the registry adds the slot art ids, the art palette (light and dark) and `particle` kind.

| Kit                     | Particles                                        | Header, logo, corners, dividers, footer                                                                                                             | Yellow |
| ----------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `tet`                   | mai / peach petals                               | lanterns; mai branch by the logo; li xi + paper firecrackers; zodiac animal in the footer with greeting                                             | yes    |
| `christmas`             | snow                                             | string lights; santa hat; garlands, tree, baubles, gifts; snowy footer                                                                              | no     |
| `valentine`             | hearts                                           | heart bunting; ribbon heart by the logo; roses in the corners; rose-and-heart footer                                                                | no     |
| `womens-day` (8/3)      | petals                                           | flower garland; small bouquet by the logo; bouquets in the corners                                                                                  | no     |
| `vn-womens-day` (20/10) | lotus petals                                     | lotus garland; lotus bud by the logo; stylised ao dai silhouettes in the footer                                                                     | no     |
| `mid-autumn`            | drifting star lanterns                           | star and carp lanterns; moon by the logo; mooncake and jade rabbit corners; banyan tree with Chu Cuoi in the footer                                 | yes    |
| `reunification-labour`  | none                                             | red bunting with yellow stars; static fireworks in the corners; footer bunting                                                                      | yes    |
| `national-day` (2/9)    | none                                             | same family with a peace dove and lotus                                                                                                             | yes    |
| `vu-lan` (new)          | none (calm; slow floating lanterns optional, Q6) | floating lotus lanterns on water in the header; a rose-on-shirt (hoa hong cai ao) by the logo; lotus corners; no fireworks, balloons or loud colour | no     |
| `celebration` (new)     | confetti                                         | balloons and ribbons in the header; cake by the logo; confetti and ribbon corners; cake footer                                                      | no     |

30/4-1/5 and 2/9 are two kits with the same family so the Owner can choose either (as today). Art is drawn larger and as multi-element compositions (the mockups show the level: 9 lanterns plus blossoms, 3-layer corner branches, 12-part firecracker string). Each kit ships as its own review (Owner approves the art before the next, as in S2).

### 4.1 Owner addition (2026-10-02, after the S6a review): iconic motifs as scenes

Every kit draws its **iconic, recognizable motifs as multi-element scenes**, not just flowers. The list below is the contract: it is data in the registry (`SEASON_MOTIFS`), every drawing carries `data-motif="<id>"`, and a test fails when a shipped kit lacks one. Art stays friendly and elegant (a spa brand), sits in the reserved rows and corners, and never covers text. The shipped Tet and Christmas kits were redone to this list (S6a revision).

| Kit              | Motifs (ids in the registry)                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Christmas        | Santa Claus, snowman, reindeer sleigh, gifts, stockings, candy canes, wreath, bells, decorated tree                                                           |
| Tet              | li xi, cau doi, hoa mai, hoa dao, banh chung, banh tet, mam ngu qua, dua hau, paper firecrackers, lanterns, the year's zodiac animal                          |
| Mid-Autumn       | mua lan su rong, ong Dia, drum and cymbals, den ong sao, den ca chep, den keo quan, full moon, chi Hang and chu Cuoi under the banyan, jade rabbit, mooncakes |
| Valentine        | roses, chocolates, love letters, teddy bears hugging a heart, heart with an arrow (no cupid, Owner 2026-10-03)                                                |
| 8/3 and 20/10    | flower bouquets, ao dai, non la, gift boxes                                                                                                                   |
| 30/4-1/5 and 2/9 | red flag with yellow star bunting, fireworks, peace doves, lotus                                                                                              |
| Vu Lan           | rose pinned on a shirt, floating hoa dang, lotus                                                                                                              |
| Celebration      | balloons, confetti, ribbons, cake                                                                                                                             |

Where they go (Tet and Christmas, as built): the header rail carries the hanging pieces (lanterns, or lights with stockings, bells and candy canes), the two top corners the branches or garlands, the divider a small centrepiece (coin and blossoms, or candy canes, bells and a wreath), and the footer scene the larger groups (Tet: cau doi pair, firecracker string, mam ngu qua, banh chung and banh tet, watermelons, li xi, the zodiac animal; Christmas: tree, gifts, snowman, Santa Claus, the sleigh with reindeer). Tablets and phones keep a subset (the lantern, firecracker, li xi and zodiac, or tree, gifts and sleigh) and drop the rest by CSS.

## 5. Custom events

An event is a row of the existing `website_seasons`: its own name (`label`, now also shown as the event name in lists), dates (Vietnam time, last day inclusive), greeting VI/EN, a **base kit** (`preset_key`, any of the ten), links to popups and slides (S3, unchanged), overlap rule, audit. Vu Lan is a normal kit; the Owner types its lunar dates (never computed). The form's first field becomes "Event name" for custom events and keeps the solar prefill for the holiday kits. No colour pickers or free drawing (D10 stays).

## 6. Owner customization per event (admin Seasons form, new "Decoration" section)

- A switch per slot (7), default all on; a segmented control for particle density (low / medium / high, default medium).
- Optional **image per slot** from the media library (existing picker, JPEG/PNG/WebP only, so transparent PNG or WebP for ornaments): replaces that slot's drawn art. Rules: header = a strip, repeats horizontally, fixed height; logo = fixed box; corners = one image, mirrored on the right and bottom corners; dividers = repeating strip; footer = centred scene; particles = sprite; tint = background image at low opacity. Alt text empty, `aria-hidden`; sizes capped by CSS boxes; `loading="lazy"`. The media library's `RESTRICT` rule keeps an in-use image from being deleted.
- **Full-page live preview** (replaces the small card preview): the real public home page in an iframe at true width, desktop 1440 or phone 390, light or dark (one selector row, one frame at a time, scaled to fit with "Open at 100%"). It reflects unsaved form state live through `postMessage`.
  - Route `/{locale}/season-preview` (noindex, outside the public sitemap): renders the real public layout and home page; applies `data-season`, theme and the draft config from the message. It requires the Owner's session with `MANAGE_WEBSITE_CONTENT` (404 otherwise, checked server-side), so there is **no shareable link** (Q-S10 holds). It contains no data beyond the public home page.
  - Theme and width are per frame (attribute on the iframe's own `<html>`), so the admin page's theme is untouched.

## 7. Data, API, migration (one additive migration)

`website_seasons`: add `slot_particles` (existing `particles_enabled` keeps that meaning, no new column), `slot_header`, `slot_logo`, `slot_corners`, `slot_dividers`, `slot_footer`, `slot_tint` (boolean, default true), `particle_density` (text, check low/medium/high, default medium). New table `website_season_slot_media` (`season_id` FK cascade, `slot` text check, `media_id` FK RESTRICT, PK `(season_id, slot)`). `preset_key` stays validated by the API against the registry (the two new kits need no migration). No new permission (`MANAGE_WEBSITE_CONTENT`), no new env var. Rollback: the old build ignores the columns and table.

API: create/update bodies gain the 7 switches, `particleDensity`, and `slotMedia: { slot: mediaId }` (strict body, media must exist and be an image); responses return them; audit events carry the changes. Public `GET /public/website/season` gains `slots`, `density`, `media: { slot: url }` and keeps old fields, so a mobile build from S5 still works; the web parser fails closed to "no season" on any odd shape.

## 8. Screenshot gate fix and CLAUDE.md

- `scripts/uxui-screens.mjs`: fail hard (exit code 3, message `UNREACHABLE` or `BROWSER ERROR PAGE`) when `Page.navigate` returns `errorText`, the final URL is a `chrome-error://` page, the main document status is 4xx/5xx (opt out with `--allow-status`), or the page has no visible body text; check the URL once before launching the browser; optional `--expect <text>` that must be on the page. A node test runs the script against a closed port and a 404 and asserts a non-zero exit and no PNG written for the failure. `.local/uxui-audit/capture.mjs` gets the same guards.
- CLAUDE.md, in "UX quality gate": "Never report screenshots without opening each one (Read the image) and saying what was checked. A screenshot of a browser error page or a missing server is a failed gate; the script must exit non-zero for it. Do not claim an image was reviewed that was not opened."

## 9. Tests

contracts (10 kits, art palettes, yellow only in the four kits, Vu Lan and Celebration never yellow, greeting defaults); ui (every kit renders every slot, all `aria-hidden`, no focusable child, slot switches, density counts, behind-content layering CSS, reduced motion, text-panel contrast per kit x theme x panel, art tokens only, no hex or px-spacing literal in `season-decor.css`); API unit and integration (new fields, slot media validation, delete protection, audit, old clients); web (parse payload, layout renders zones, preview route access 404 without permission, postMessage draft applied); script test for the gate. Validation per CLAUDE.md: touched suites, typecheck and lint of affected packages, `pnpm format:check`, whole-repo `pnpm test` before a push. UX gate: Tet, Christmas (and each kit as it ships) at 360/768/1440 light and 1440 dark, DOM audit against the baseline, the admin Decoration section and preview at the same widths.

## 10. Proposed steps (each ends with Owner review)

| Step | Scope                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S6a  | Screenshot-gate fix and CLAUDE.md line; engine (`SeasonDecor`, slots, tokens, layering, particles density); Tet and Christmas kits at the mockup level |
| S6b  | Migration, API, public payload, admin Decoration section with switches, density, media replace; custom events and `celebration` kit                    |
| S6c  | Full-page preview route and admin preview                                                                                                              |
| S6d  | Valentine, 8/3, 20/10 kits (art review)                                                                                                                |
| S6e  | Mid-Autumn, Vu Lan, 30/4-1/5, 2/9 kits (art review); design doc 20 and handoff updated; deploy runbook addendum                                        |

S6b needs S6a's slot list; S6c needs S6b's draft config; kits S6d/S6e are independent of S6b and may run earlier. One additive migration (S6b). Deploy order as S3: migrate, API, web.

## 11. Owner decisions (2026-10-02, LOCKED; do not reopen)

1. **Particles behind content**, and (review of the mockup) they must never cross text: the layer is masked over every line of text, button and opaque block (section 3, rule 1).
2. **Split S6a-S6e.**
3. **Reserved rows accepted as mocked** (about 220 px at the top, 300 px footer scene; phone 170 / 224-268).
4. **Zodiac is computed, never typed.** For the Tet kit the animal and the can-chi name come from the **end date's year** of the season window (Vietnam time, last day inclusive; Tet falls 21 Jan - 20 Feb, so the end date is always in the lunar year's Gregorian year). The cycle is the **Vietnamese** one: Ty chuot, Suu **trau**, Dan ho, Mao **meo** (cat, not rabbit), Thin rong, Ty ran, Ngo ngua, Mui de, Than khi, Dau ga, Tuat cho, Hoi lon (with diacritics in code), with correct can-chi (2027 Dinh Mui, 2028 Mau Than). Unit-tested for 2020-2031. **Art exists for 2027 only (the goat); if the year's animal has no art, no animal is drawn, never a wrong one.** The admin preview shows the computed year name so the Owner can verify it. **Rule for every future zodiac animal:** clear Tet style (red and gold ao or khan, cau doi or li xi, mai and dao blossoms, gold coins, a festive pose).
5. **Greeting in both places** (strip under the header, short line in the footer scene), **each toggleable** per event (S6b adds the two switches; S6a renders both always).
6. **Vu Lan:** no particles by default, with an option for slow floating lanterns (S6e; the density control applies to them).
7. **Preview route** admin-only and session-guarded: accepted (Q-S10 holds, no shareable link).
8. **Slot images** JPEG/PNG/WebP only; corners use one mirrored image: accepted.
9. **Iconic motifs as scenes** for every kit (section 4.1); redo Tet and Christmas first, then build the other kits to the list.
