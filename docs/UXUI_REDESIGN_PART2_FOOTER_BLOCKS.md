# Part 2 follow-up: footer block area (2026-10-04)

## What changed

- The footer's brand column (under the logo) is a **block area** the Owner manages in Admin > Website > Shop info, last section "Khối dưới logo chân trang": add, edit, delete, drag or move, show/hide (row `⋮` menu), up to 12 blocks. Edits stay in the form and save with the profile (one row version, like Facts and Why).
- **Default on production: no blocks.** Nothing is seeded (migration default `[]`). The footer shows the logo alone, so **the tagline no longer appears in the footer after deploy until a Slogan block is added** (the footer's `tagline` prop is gone).
- Six types:

| Type         | Holds                                                                 | Drawn                                                                                    |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Social icons | Facebook, Zalo, TikTok, Instagram, YouTube, Messenger (https only)    | one row of round buttons (shared hover/press motion), only networks with a link, new tab |
| App download | Google Play and App Store links (https only, one is enough)           | the official badges, each only when its link is set, new tab                             |
| Text         | Vietnamese and English text, 300 characters, line breaks kept         | paragraph                                                                                |
| Link list    | optional title (both languages or none), 1 to 8 links with both names | titled navigation; `https://` or `/vi`, `/en`, `/{locale}/...` paths (popup rule 16.2)   |
| Image        | a media library picture, optional link                                | picture up to 20 rem; its alt text is the media's (Vietnamese required)                  |
| Slogan       | nothing (uses the Shop info tagline)                                  | paragraph                                                                                |

- Security and access: links are re-checked in the API strictly (https, no credentials, no `javascript:` or `//host`), tolerantly on read, and again in the web before an `href` is drawn; external links carry `rel="noopener noreferrer"` and an accessible name that says "opens in a new tab". `MANAGE_WEBSITE_CONTENT` is unchanged.
- Image blocks: saving checks the picture exists and has alt text (new pictures only); the media library's "used in" list and delete protection now count footer pictures; the public media route serves a picture only while a **visible** block uses it (all three proven by an integration test).
- **Store badges** are Google's and Apple's own files, unmodified, in `apps/web/public/badges` (Apple's generated SVG for Vietnam and US-UK, Google's `badge_web_generic` PNG for Vietnamese and English), in the visitor's language. Each is drawn with its artwork 40 px high (token `--ls-store-badge-h`); Google's file carries clear space, so it is drawn taller by its own scale and its transparent margin is pulled back, not cropped. Never recoloured or filtered; below the fold, so lazy-loaded. Accessible names use the official wording.
- Social glyphs are inlined from Simple Icons (CC0), `currentColor`, no hex.

## Migration

`20261026000000_uxui_part2_footer_blocks`: one column `footer_blocks JSONB NOT NULL DEFAULT '[]'` on `website_shop_info` plus its own CHECK (array, at most 12). Additive, no data change. A server still at `d59d02c` also has `20261024000000` and `20261025000000` pending: the Part 2 runbook (pinned to `7adf3bf`) lists only migrations up to `20261023000000`.
After deploy also check `/badges/app-store-vi.svg` and `/badges/google-play-vi.png` answer 200 (a new static folder).

## Tests

`pnpm test` (UI 432, web 447, API 218 with 68 database tests opt-in, server 35, worker 15 with 1 skipped), `pnpm check` and `pnpm smoke` pass. Integration (test database, scratch only): shop-info 11 and DB foundation 1 pass, including the footer picture case. Public pages and the member bookings page, 360/768/1440, light and dark, with every block present: DOM audit and axe clean.

## UX gate

Footer opened at 360, 768 and 1440 light and 1440 dark in three states (no blocks, a mix, every block) and in English; admin list and the three drawer states (add, link list, picture) opened. Found and fixed: six buttons wrapped at 768 (the brand column takes the full first row on a tablet while it holds blocks), the English Google badge was inset and briefly squeezed (flex shrink), and React preloaded both badges (now lazy). A drawer reports the audit's FR3 surface finding that every existing drawer reports (checked on the slide drawer).

## Open questions

- Please confirm the badge use against Apple's and Google's current badge programs before launch; I used their official files unmodified but did not review the full brand guideline pages.
- The Image block's alt text is the media's, in the visitor's language, falling back to Vietnamese when there is no English (as the hero image does).
