# Part 2 follow-up: one type scale, equal cards, real-menu review (2026-10-04)

## What changed

- **One type scale for every public and member page** (`tokens.css`, `--ls-type-*`, measured on the Lovable captures at 1:1 and calibrated against our own known sizes). Titles are Playfair 500 and read these tokens only; the staff area keeps its own scale.

| Role                        | Token                               | 360 / 768 / 1440 px | Used for                                                    |
| --------------------------- | ----------------------------------- | ------------------- | ----------------------------------------------------------- |
| Hero                        | `--ls-type-hero`                    | 32 / 39 / 48        | home headline                                               |
| Page title                  | `--ls-type-page`                    | 28 / 33 / 36        | h1 of services, booking, member pages                       |
| Section title               | `--ls-type-section`                 | 24 / 29 / 30        | home sections                                               |
| Subsection                  | `--ls-type-sub`                     | 20 / 22 / 24        | sign-in title, member section, booking step, service groups |
| Card title                  | `--ls-type-card`                    | 18                  | cards, form section titles                                  |
| Price / lead / body / small | `price` / `lead` / `body` / `small` | 20 / 16 / 15 / 13   | prices, hero lead, text, meta                               |

- **Member pages and the booking form no longer use the staff sans for titles** (the dump found page title, section title, card title, booking step and form section title in the wrong face). `scripts/uxui-page-audit.js` now allows exactly this scale.
- **Rhythm on the 4 px grid, stepped by width (never fluid):** band padding 48 / 64 / 80, page top 40 / 48 / 64, heading to content 24 / 32. Site container 73 rem (content about 1100 px), like the reference. Supporting UI is lighter (menu, pills, text links regular or medium; footer titles 500). Hero media and cards share soft 16 px corners; public form fields are pills; the sign-in card is 448 px with a centred title above its tabs.
- **Cards:** services list, related services, home groups and why-us cards of a row are one size and share their inner rows (CSS subgrid, flex fallback): name (two lines, ellipsis, full name as tooltip), time, price, optional two-line description, button at the bottom; the title link stays a full-size tap target. Detail page shows two related cards a row.

## Not changed on purpose

- Titles stay at weight 500 (Owner decision Q-P2-5: 500/600). In the 1:1 crops the reference looks closer to 400; 400 is already loaded, so it is a one-token change (`--ls-weight-title`) if the Owner wants it.

## Real menu (no invented services)

The scratch catalog was invented, so it is now **hidden** (rows stay: scratch bookings reference them). `docs/CATALOG_EXPORT_FOR_REVIEW.md` has the read-only export for the iNET terminal (two catalog tables, JSON, no customer data). When the file arrives: `.local/p3-import-catalog.mjs` (dry run first), then the review shots of services, service detail and home groups are retaken. Until then the layout was proven with a clearly synthetic fixture (never shown as the menu): equal rows at 360/768/1440, VI and EN, light and dark (`.local/p3-measure-grids.mjs`), DOM audit 36 of 36 renders clean, computed typography of every heading flagged off-scale or off-face (`.local/p3-type-dump.mjs`: none left).

## Checks

`pnpm check`, `pnpm smoke`, DOM audit and axe on home VI/EN, services, sign-in, register, forgot password and the member pages. 1:1 side-by-side crops against the Lovable captures were opened and critiqued (services, sign-in, groups, why-us, footer).

## Open for the Owner

Send the export (steps above); decide weight 400 for titles; the footer link rows stay at 40 px (tap target), looser than the reference's 28 px.
