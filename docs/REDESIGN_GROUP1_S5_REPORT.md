# Redesign group 1, session 5 report (C11b, C12, C13). Local only: not pushed, not deployed.

Commits: C11b `46fe6bf`, C12 `9ae12ea`, C13 `8308b67`. Owner decisions on the session 4 report are in the plan file (items 1 to 5).
**Migration (new): `20261214000000_redesign_service_content_photos`**: additive and nullable only (see below). Group 1 is therefore no longer a web-only reload:
the deploy guide (C19) must run the migration, restart the API, then reload the web.

## What changed

- **C11b (migration, API, admin, public):**
  - Database: `services` gets `included_vi/en`, `steps_vi/en`, `faq_vi/en` (JSONB, NULL = none) and `photo_media_id`; `service_categories` and `product_categories` get
    `photo_media_id`. Every photo key is a RESTRICT foreign key to the media library (own index). No existing row or function changes. `prisma migrate diff` shows nothing about these columns.
  - API: the service update takes the six content fields and `photoMediaId`; the group update takes `photoMediaId`; the cosmetics category edit takes an optional `photoMediaId`
    (left out = unchanged, so older callers keep the photo). Same permissions as before (GLOBAL `MANAGE_SERVICES`; product categories as before). Texts are trimmed, blank items dropped, limits 12 items /
    300 characters / 10 FAQ pairs, a pair needs both sides, an empty list is stored as NULL, a same-content save is not a change (no version bump). A photo must exist and have Vietnamese alt text (the
    media rule of popups and slides). Audit records before/after. The media library lists the new usages and refuses to delete a photo in use; a photo is public while its service, group or category is active.
  - Public API: `image` on services, groups and cosmetics categories (MD/LG renditions); included, steps and FAQ only on the service detail response, in the visitor language.
  - Admin (existing forms, same look): service edit drawer gets a Photo section (the media picker) and a content section (one-per-line boxes, question/answer rows); group and cosmetics-category dialogs get a Photo section.
  - Customer pages: service cards, the service hero, the home category tiles show the photo (flat placeholder when empty); the service page draws "Dịch vụ bao gồm", "Các bước thực hiện" and the FAQ accordion only when filled.
  - Home product row: now loads after the first paint (its own chunk; skeleton of the same box meanwhile; also loads when within 600 px of the screen). **Home first-load JS 345.4 KB gzip** (session 4: 354.8; before C10: 342.4; budget line 345.4).
- **C12 (products):** title band (the Owner's hero or a plain title, campaign strips), list band with search, sort, category and brand chips (from 640 px; a phone keeps the filter sheet), a 2 / 3 / 4 column grid of flat cards
  (the same card as the home row), pager, the commitment as a last band. Product page: split hero (square gallery with named arrows and thumbnails; name, labels, price, variants, buy block), about band (description,
  usage / ingredients accordion, where to buy), commitment band, related products as a scroll row. Loading skeleton reshaped. The purchase block, sale price and countdown are unchanged.
- **C13 (cart, checkout, orders):** cart and checkout get a title band (`ShopScreen`) and a content band; cart lines in one surface with a sticky summary; checkout is one 720 px column with the payment method as a radio card
  (PayOS is the only method, so it is shown selected) and the coupon / staff-code rows wrap instead of squeezing the field (carry-over fixed). Orders: the order page has the record on the left and a summary card (totals,
  Pay / Cancel) plus the delivery card on the right, and the dates are a vertical timeline with icons. The orders list was already the kit table with status badges and is unchanged. The member frame around the orders (no title band) is C15.

## Checks (all run)

- API: 412 unit/HTTP tests pass; integration (clean scratch DB built from every migration): service catalog, product catalog, public products, media and shop info suites pass (round trip, audit, alt rule, RESTRICT, public serving).
  `ui` 559 and `web` 1100 pass (ratchet unchanged); typecheck, eslint, `pnpm format:check` clean. DOM audit vs the C1 baseline: no count rises (the 3 first rises were fixed). `uxui-tabbar-check` and `uxui-touch-check` pass (one login keyboard probe flaked once, as in sessions 3 and 4).
- End to end on the scratch stack (browser): home row loads after paint; service bands show and hide; category chips; cart, checkout and a real order placement reached the PayOS link; order page timeline.

## UX gate (`.local/uxui-screens/group1-session5/`, 45 sheets, each opened)

Products, product page, cart, checkout, orders at 360 / 768 / 1440 light and 1440 dark, 130 % text, empty / problem / pre-order / sold-out / no-image / accordion states; C11b photo and content states (service in Vietnamese and English, tiles, row, admin drawers).
Not captured: loading skeletons, 200 % text, dark at 360. Scratch media files are missing, so the shop's own pictures show placeholders; the photo states use generated test images.

## Needs your decision

1. Checkout shows one payment method (PayOS) as a selected radio card; no new method was added. 2. Orders list/detail still sit in the member frame (no title band) until C15. 3. The old direction C rules for these pages remain in `site.css` (overridden, C18 deletes them).
