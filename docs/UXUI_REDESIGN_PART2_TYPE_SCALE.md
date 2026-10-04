# Part 2 follow-up: one type scale, equal cards, real-menu review (2026-10-04)

## What changed

- **One type scale for every public and member page** (`tokens.css`, `--ls-type-*`, measured on the Lovable captures at 1:1 and calibrated against our own known sizes). Titles are Playfair 400 (Owner decision 2026-10-04) and read these tokens only; the staff area keeps its own scale.

| Role                        | Token                               | 360 / 768 / 1440 px | Used for                                                    |
| --------------------------- | ----------------------------------- | ------------------- | ----------------------------------------------------------- |
| Hero                        | `--ls-type-hero`                    | 36 / 43 / 48        | home headline                                               |
| Page title                  | `--ls-type-page`                    | 28 / 33 / 36        | h1 of services, booking, member pages                       |
| Section title               | `--ls-type-section`                 | 24 / 29 / 30        | home sections                                               |
| Subsection                  | `--ls-type-sub`                     | 20 / 22 / 24        | sign-in title, member section, booking step, service groups |
| Card title                  | `--ls-type-card`                    | 18                  | cards, form section titles                                  |
| Price / lead / body / small | `price` / `lead` / `body` / `small` | 20 / 16 / 15 / 13   | prices, hero lead, text, meta                               |

- **Member pages and the booking form no longer use the staff sans for titles** (the dump found page title, section title, card title, booking step and form section title in the wrong face). `scripts/uxui-page-audit.js` now allows exactly this scale.
- **Rhythm on the 4 px grid, stepped by width (never fluid):** band padding 48 / 64 / 80, page top 40 / 48 / 64, heading to content 24 / 32. Site container 73 rem (content about 1100 px), like the reference. Supporting UI is lighter (menu, pills, text links regular or medium; footer titles 500). Hero media and cards share soft 16 px corners; public form fields are pills; the sign-in card is 448 px with a centred title above its tabs.
- **Cards:** services list, related services, home groups and why-us cards of a row are one size and share their inner rows (CSS subgrid, flex fallback): name (two lines, ellipsis, full name as tooltip), time, price, optional two-line description, button at the bottom; the title link stays a full-size tap target. Detail page shows two related cards a row.

## Not changed on purpose

- Title weight is **400** since 2026-10-04 (the Owner chose it after the 1:1 comparison; it replaces Q-P2-5's 500/600). One token: `--ls-weight-title`.

## Real menu (no invented services)

The Owner's read-only production export (1 branch, 4 groups, 23 services; no staff or customer data) is imported into the **scratch** database only (`.local/p3-import-catalog.mjs`, git-ignored): the invented catalog stays hidden, the branch is renamed in place to the real one. The review runs on that real menu.

Found only with the real data, and fixed:

- **Home groups:** four groups in a three-column grid left "Massage" alone on a second row. Exactly four cards are now a 2 x 2 block (`.ls-site-grid-groups:has(> :nth-child(4):last-child)`, 1024 px and up; 640 to 1023 px was already two columns).
- **Booking, first step, 360 px:** the per-nail price range ("5.000 ₫ – 30.000 ₫ / móng") squeezed the service name to about 23 px and ran under it (DOM audit FR11, three findings). On phones the rows that carry the per-nail note now put the price on its own line under the name, above the note; every other row keeps its trailing price. Zero findings after.
- **Service detail breadcrumb:** a one-word crumb ("Nail") was a 27 px target; crumb links are now at least as wide as they are tall (40/44 px).
- **Section counts** ("Sắp tới 3", "Lịch sử 0") were drawn in the title's serif, whose old-style figures made a small 0 look like "o": sans now.

Scratch data only (never in the repo): the catalog import gives each real service the one skill most employees at an active branch hold (otherwise no start time existed), and nine bookings for three new `@example.com` customers use real services only.

## Checks

`pnpm check`, `pnpm smoke`, DOM audit and axe on home VI/EN, services, sign-in, register, forgot password and the member pages. 1:1 side-by-side crops against the Lovable captures were opened and critiqued (services, sign-in, groups, why-us, footer).

## Open for the Owner

Send the export (steps above); decide weight 400 for titles; the footer link rows stay at 40 px (tap target), looser than the reference's 28 px.
