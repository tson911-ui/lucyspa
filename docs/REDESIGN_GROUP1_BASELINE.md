# Redesign group 1: the "before" baseline and how to reproduce it (C1)

The "before" is the current production look: HEAD `b87f038` has the same app code as production `04ceaa5` (only an integration test
differs). The images and audits live in the git-ignored `.local/`; this file is the recipe so they can be made again. No app code.

## Page list

`scripts/uxui-customer-pages.json`: 42 customer pages (public, auth, account, shop; with the seeded member each one needs) plus the extra
states. Each page: 360, 768 and 1440 px light and 1440 px dark. There is no info/CMS page route: `[...rest]` only answers 404, and the
contact and policy content lives in the footer blocks. The error page (`(site)/error.tsx`) and the `loading.tsx` skeletons cannot be
captured by a normal render (they need a thrown error or a streamed response); they are checked in their own Steps (C16, C18).

## Scratch stack (never `lucy_spa_dev`)

1. DB: `CREATE DATABASE lucy_spa_polish1_scratch TEMPLATE lucy_spa_uxaudit_20261001` (no open connection to the template), then
   `eval "$(node scripts/scratch-db-env.mjs lucy_spa_polish1_scratch)"`, check `echo "DB=${DATABASE_URL##*/}"`, then `pnpm db:deploy`
   (134 migrations). The template holds the imported catalog (114 services) and the owner login of `uxui-audit-capture.mjs`.
2. Build: `pnpm build:server`, `pnpm --filter @lucy-spa/api build`, then `API_UPSTREAM_ORIGIN=http://127.0.0.1:3101 pnpm --filter @lucy-spa/web build`.
3. Start API 3101 (with the PayOS simulator) and web 3100 (`next start`) on that database. The API only accepts the origin `localhost:3100`.
4. Seed (each refuses any other database name): products with pictures in every state, online sales on, members with carts and orders,
   slides, one popup, one campaign, bookings and invoices, a pickup ticket. Known drift: the API no longer lets a shop-only product into a
   cart, so the "problem" cart holds the over-stock and no-picture lines only.
5. Capture every page of the list, then the extra states, then the contact sheets (`montage`): one sheet per page with the four renders side by side.

## State left on the scratch shop

Slider on (the sample slide "Tuần lễ 20/10" off), footer blocks off, no season, popup off. The promotional popup opens at 360 px on the
first visit, so a baseline page is shot with it off and the popup has its own shots.

## Known limits of the baseline

The seeded shop has no real photos (flat placeholders), so "before" and "after" both show placeholders. Reviews are not shown (Q5).
