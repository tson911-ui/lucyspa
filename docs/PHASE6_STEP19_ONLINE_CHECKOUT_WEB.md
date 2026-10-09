# P6-19 online checkout: web side

Backend (apps/api, contracts, server, database) was done earlier and is not touched here. Delivery is free for every online order; the master switch "Bán online" is OFF until the Owner turns it on.

## Built

- Product page: purchase block (client island under the price): quantity stepper, "Thêm vào giỏ" / "Đặt trước", "Đăng nhập để mua" (returns to the page), "Mua tại cửa hàng" (shop closed or `sellOnline=false`), disabled "Hết hàng". Free-delivery line and "not a promise" shipping text.
- Header cart (members, shop open) next to the bell with a line count; below 480 px it is an entry of the account menu (no room for a fifth round tool). Account menu also gets "Đơn hàng online".
- `/{locale}/cart`, `/{locale}/checkout` (own route group, noindex, member guard that returns here after sign-in), `/{locale}/account/orders` and `/orders/[id]` (countdown, Thanh toán, Hủy đơn dialog, refresh once and a passive poll every 5 s for ~2 min after the bank).
- Staff page `/workforce/online-sales` ("Bán online", MANAGE_PRODUCTS, nav group Danh mục): switch with confirm dialog, branch, limits, shipping promise, fee block (off), policy VI/EN with default preview.
- Also: `fieldOf` accepts dotted fields (`address.recipientPhone`); `safeCustomerNext` allows /products, /cart, /checkout of the same language; icons `cart`, `truck`; notification texts for the 7 new ONLINE_ORDER_* types and the ONLINE_ORDER_ALERT link (the web did not typecheck without them); `channel` added to a queue test fixture.
- Extension point for P6-20: `components/shop/order-fulfilment.tsx` (draws nothing).

## Files

components/shop/*, lib/shop/online.ts, i18n/online-shop.ts, i18n/online-sales.ts, lib/workforce/online-sales.ts, components/workforce/screens/online-sales.tsx, app routes `(site)/(shop)`, `account/(app)/orders`, `workforce/(app)/online-sales`; edited product-offer, account-menu, site-chrome-client, site-session (`ready`), permissions/nav-groups, packages/ui site.css, components.css, icons.

## Tests (apps/web unless noted)

- `tsc --noEmit` clean; `eslint apps/web/src packages/ui/src --max-warnings 0` clean; `prettier --check` clean; `next build` OK.
- `node --import tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"`: 778 pass, 0 fail (new: lib/shop/online.test.ts, lib/workforce/online-sales.test.ts, field/next/permissions/nav cases). packages/ui: 467 pass.
- End to end on scratch DB `lucy_spa_w4_ui_scratch` with the PayOS simulator preloaded (`.local/w4-ui/`): checkout through the real page placed order, payment link, saved address; "bank pays" then return page refreshed to paid.

## UX gate

Screens rendered at 360/768/1440 light + 1440 dark (prod build), every image opened: product page (signed out, add, pre-order, shop-only, sold out, closed), cart (normal, pre-order, problems, empty, closed, EN), checkout (normal, errors, problem cart), orders list, order (unpaid, 3 min left, expired, cancel dialog, paid, waiting goods, cancelled, back from bank, paid now), admin on/off. 130% text checked at 360 (cart, checkout, product, order). DOM audit: online-sales 0 findings, dashboard 86 to 8 vs baseline, products 0.
Not fixed / not exercised: the 20 px checkbox inputs inside 44 px CheckField rows and the 113x40 logo link are flagged by the script (kit pattern); at 130% the existing site header overflows at 360 px; the real PayOS host and the worker's auto-cancel were not run; uxaudit DB not used (it lacks migrations 97+).

## Backend issue found (not changed)

`POST me/online-orders/:id/refresh`, `.../cancel` and `POST me/addresses/:id/delete` take `@Body() _body: EmptyDto` (no decorators); the global pipe (`forbidUnknownValues`) answers 400 HTTP_400 for any body. Use `requireEmptyObject` as other controllers do. The scratch stack only works around it in `.local/w4-ui/fake-payos.mjs`.
