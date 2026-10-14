# Redesign group 1, session 4 report (C10 home, C11 services). Local only: not pushed, not deployed.

Commits: C10 `539bc55`, C11 `6020e62`. Owner decisions of session 3 recorded first (plan file, DESIGN.md 8.5 and 11.6).

## What changed

- **C10 home** (DESIGN.md 9.1, order kept): hero, trust band (the Owner's facts as title figure + caption), split intro with the slider or a flat photo slot and
  three columns of top services, product row (scroll-snap, arrows from 1024 px), category grid (services, cosmetics), the Owner's why-us cards, one flat offer
  block. No reviews band (Q5). The offer "Mua ngay" contrast is fixed (inverse button, both modes). New `pages-v2.css`, tokens `--ls-scrim` / `--ls-on-photo`,
  `ScrollRow`, `HomeProductCard`, `Slider ctaVariant`; direction C home rules deleted from `customer.css`. Home loading skeleton reshaped.
- **C11 services** (9.2): list = title band + search, chips row sticky under the compact header, one band per group, cards; detail = split hero, same-group
  row, booking band, phone booking bar (hidden while the page's own booking buttons are on screen; the contact button lifts above it). Direction C service rules
  deleted from `customer-pages.css`; the contact slot takes the color of an alternate last band.

## Checks (all run)

- `packages/ui` 557 pass, `apps/web` 1079 pass (incl. ratchet, unchanged); ui + web typecheck; eslint on the touched trees; `pnpm format:check` clean.
- DOM audit vs the C1 baseline, home / services / service detail: no count rises (home 11 to 7, services 5 to 1, detail 5 to 1 at 360). `uxui-tabbar-check` on
  the detail page 42/42 twice; `uxui-touch-check` passes. One keyboard probe (login page, untouched) failed once at 360/390 and passed on rerun, as in session 3.
- Bundle (gzip, first load): home 342.4 to 354.8 KB (+12.4: product row, ScrollRow, sale price, tooltip), /services 355.0 to 358.3. The +3 KB budget was for GSAP only.
- Season layer (Tết on the scratch shop) renders over the new home; switched off again. Not run: whole-repo `pnpm test`, smoke, integration (no push).

## UX gate (screens: `.local/uxui-screens/group1-session4/`, 28 sheets, opened one by one)

Home, services and service detail at 360, 768, 1440 light and 1440 dark, hero with a bright photo (the scrim worst case, light and dark), 130 % text at 360, the
product row end, no-match search, sticky chips, the phone bar. Layout: tokens only, no shadow or gradient, nothing clipped at 130 %. Not captured: the loading
skeleton, 200 % text, dark at 360 for the lists. Scratch media files are missing, so product and slide pictures show their fallback (an honest "no image" state).

## Needs your decision (all PROVISIONAL until you answer)

1. **Hero and slider.** DESIGN.md 9.1 has one photo hero; the Owner's slider has a title, text and button per slide. I kept every slider function by moving it to the split
   intro's photo slot; the hero uses the Owner's hero picture or a flat band. Alternative: slider as the hero.
2. **"Bán chạy".** No public data says best-selling; `featured` is the Owner's "Nổi bật" flag. The row is headed "Sản phẩm nổi bật" and no "Bán chạy" label is drawn. To use
   your wording, change `home.productsTitle` (one string) and say if the flag may carry the label.
3. **Service page content.** The data has no photo, "what is included", steps or FAQ, so those bands are not built. Needs a CMS field (or your text) per service or one site-wide FAQ.
4. **Photo fields.** No field holds a service photo or a category photo; tiles and cards are flat placeholders until you decide to add them (API + database).
5. **Home JS +12.4 KB gzip** (above). Accept, or load the product row later.

## Photos the shop needs to take (new slots; the older list in `docs/CUSTOMER_SITE_C.md` stays valid)

Home hero (wide room, 2400 x 1400, subject left or centre, text sits bottom-left); split intro (technician at work, 4:3); one tile photo for each service group
(Gội đầu, Chăm sóc da mặt, Nail, Massage; 4:3) and each top-level cosmetics category (4:3); a photo for each service (4:3, shown on its card and its page; about 30 now);
product photos and the campaign banner (Admin, existing).
