# Lucy Spa handoff (current state)

Historical detail (Phase 0-3, Phase 2 follow-up, Notification Center, Organization Hierarchy, production states,
Phase 4 Step 1-6 summaries): [docs/HANDOFF_HISTORY.md](docs/HANDOFF_HISTORY.md). Agent rules: [CLAUDE.md](CLAUDE.md).

## Start here

1. Read the PRD sections relevant to the requested task before implementation ([LUCY_SPA_PRD.md](LUCY_SPA_PRD.md);
   change it only with explicit Owner authorization), this file, and the requested Step's own doc.
2. Inspect `git status` / `git log` and the repository before changing anything. Preserve completed work.
3. One Step at a time; Owner review and checkpoint commit/push after every Step. Never deploy unless asked.
   Never touch `apps/web/next-env.d.ts`.

## Phase status

| Phase                                     | Status                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 0                                   | PASS                                                                                                                                             |
| Phase 1 (auth and security)               | COMPLETE                                                                                                                                         |
| Phase 2 (services, employees, operations) | CLOSED / PRODUCTION ACCEPTED (follow-up Steps 1-7 also accepted)                                                                                 |
| Phase 3 (booking, walk-in, queue)         | COMPLETE / OWNER APPROVED                                                                                                                        |
| Notification Center (in-app, V1)          | CLOSED / PRODUCTION VERIFIED                                                                                                                     |
| **Phase 4 (POS, invoices, payments)**     | **CLOSED / OWNER APPROVED (Steps 1-11), LIVE IN PRODUCTION**                                                                                     |
| UX/UI redesign Part 1 + Part 2            | DEPLOYED (production = `9b76789`)                                                                                                                |
| **Phase 5 (loyalty and combos)**          | **DEPLOYED 2026-10-05 (production = `f79572d`); go-live turned ON by the Owner about 17:20 (+07)**                                               |
| **Phase 6 (products, inventory, Beauty)** | **COMPLETE: Waves 1, 2, 3a, 3b and 4 DEPLOYED (production = `4b91af6`, 2026-10-09 ~14:02 +07); online store stays OFF until the Owner opens it** |
| Phase 7+ (payroll, cash, reports)         | NOT started                                                                                                                                      |

## Phase 4 steps (docs: `docs/PHASE4_*`)

| Step | Name                                                                 | Status                                 |
| ---- | -------------------------------------------------------------------- | -------------------------------------- |
| 1    | Design contract (`PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md`)            | CLOSED                                 |
| 2    | Visit completion carryover (manager END, cancel line)                | CLOSED                                 |
| 3    | Staff-added service                                                  | CLOSED                                 |
| 4    | POS database + permissions foundation (OP-1 quantity limit)          | CLOSED                                 |
| 5    | Invoice / POS (draft, price/quantity, payer, finalize, cancel, OP-7) | CLOSED                                 |
| 6    | Discounts / vouchers (+ historical service-category snapshot)        | CLOSED (`f898f2d`)                     |
| 7    | Cash / split payments / payment states / corrections                 | CLOSED / OWNER APPROVED (no migration) |
| 8    | PayOS (Q7 answered)                                                  | CLOSED / OWNER APPROVED                |
| 9    | Customer invoice history                                             | CLOSED / OWNER APPROVED                |
| 10   | Invoice / revenue notifications                                      | CLOSED / OWNER APPROVED                |
| 11   | Final validation (single full gate; no deploy)                       | CLOSED / OWNER APPROVED                |

Phase 4 migrations so far: Step 3 (`20261013…`), Step 4 (`20261014000000-04`), Step 6 (`20261015000000`, category snapshot), Step 8 (`20261016000000-01`), Step 10 (`20261017000000`, notifications).

## Locked Owner decisions (do not reopen; details in the Phase 4 design doc)

- **Q0** Phase 3 carryovers are in Phase 4 (manager END resolution, cancel unperformed line, staff-added service).
- **Q1** Price is permission-based, chosen inside the visit-line snapshot range; catalog changes never alter a transaction.
- **Q2** One Visit -> one active Invoice, only after COMPLETED; payer on the invoice (owner default, guest allowed); split payment, not split invoices.
- **Q3** Integer VND; percentages round half up; no cash rounding; versioned deterministic calculation.
- **Q4** No free-form discount; Owner-configured discounts/vouchers; invoice-level; no stacking; Member/Birthday/loyalty stay Phase 5.
- **Q5** No tip in Phase 4 (tip, cash safe, closing, commission, payroll = Phase 7).
- **Q6** Unpaid invoice cancellable; cash reversal needs `CORRECT_PAYMENTS` + reason + re-auth; a confirmed PayOS payment is never manually reversed; correction is not a refund.
- **Q9** Nine financial permissions, no role-name access, no automatic seeding, re-auth only for `CORRECT_PAYMENTS` and finalized-invoice cancellation.
- **Q10** UI term "Hóa đơn"; code `INV-YYMMDD-XXXXXX`; internal receipt, not an official e-invoice.
- **OP-1** Quantity limit is per Service (`services.max_quantity`), snapshotted on the line; no global setting.
- **OP-2** Amount due exactly 0 -> finalize directly to PAID, no Payment row.
- **OP-3** A per-customer usage limit needs an identified MEMBER payer; a guest is ineligible for it.
- **OP-4** `minimumSpend` uses the eligible subtotal before the benefit.
- **OP-5** Code-less promotions are automatic candidates, vouchers only once supplied; exactly one winner, deterministic tie-break.
- **OP-6** Cash is recorded by any actor with `COLLECT_PAYMENTS` in scope; server-recorded time; no re-auth for normal collection.
- **Q7** (PayOS, answered before Step 8): simulated PayOS in tests, live check only after deploy with a small amount; QR expires in 15 min; one pending request per invoice (cancel + recreate allowed); create/cancel needs `COLLECT_PAYMENTS` in scope; late confirmation recorded only if a balance remains, else anomaly for management; amount mismatch never marks paid (anomaly); a request may be partial (split with cash); no in-system correction of a PayOS-settled invoice (audited management note only, refunds Phase 6); staff can never mark a transfer received.
- **OP-7** `PAID -> CANCELLED` only for a zero-balance invoice with no payment row; needs `CANCEL_INVOICES`, reason, fresh re-auth; releases the redemption.

- **Phase 5 P5-Q1…P5-Q9** (locked 2026-10-04; table in `docs/PHASE5_LOYALTY_COMBOS_DESIGN.md` section 2.1; Phase 5 Q10 withdrawn): points start 0 at go-live, payer earns (guest: nobody), floor per invoice, new customer = phone with no completed visit, balance never < 0 (shortfall recorded and flagged), birthday and gift catalog ship empty, combos POS + members only, no notifications.

- **Phase 6 P6-Q1…Q18** (Owner's own words, 2026-10-07; contract `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md` section 2.1): best offer per side (Spa/Beauty) with shared discounts and payments split pro-rata, points rounded per wallet; refunds per product line, cash or manual transfer only, dedicated permission plus re-auth, no PayOS refund; product-only invoices allowed; discount scope SERVICES/PRODUCTS/BOTH, birthday = services only; stock per branch, reserved at finalization, never oversold; seller required per line; simple promotions first, campaigns last; PRD 22 campaigns deferred; Excel/CSV catalog and opening-stock import early; deploy in 2-3 waves (Wave 1 = catalog, inventory, public catalog, no POS); P6-T1…T7 approved (T8 = browse-only public pages is pending); load readiness after the public catalog Step; server 6 cores, 7.8 GB, no swap; PRD 37 Reviews moves to Phase 8; the footer "Explore" label stays.

## Open Owner checkpoints (NOT decided; do not decide or implement)

- Phase 6 (2026-10-07): the Owner approved P6-T8, P6-T9…T16, P6-T24, P6-T25 and answered OQ-P6-19…28 in own words (contract section 2.5; plain-Vietnamese guide `docs/PHASE6_OWNER_DECISIONS_VI.md`). P6-T17…T23, T26, T27 were approved afterwards (design 2.13). OQ-P6-22: personal preference = exchange or refund within 7 days, seal intact, invoice required, customer pays shipping; wrong/damaged packaging = exchange or refund within 48 hours, photo required, spa pays shipping; skin irritation = case by case (Owner/manager decides, notes and photos only). OQ-P6-24: dearer replacement = difference paid as a normal payment, cheaper = difference refunded by cash or manual transfer, approved by a refund-permission holder with password re-entry. The Owner also authorized the one PRD §56 line moving Reviews (§37) to Phase 8 (done).

- Phase 5 (2026-10-04): OQ-1 yes, P5-T1/T2/T12/T13 approved, go-live switch defaults OFF; OQ-2…OQ-11 stay open (ask only when a step is blocked): `docs/PHASE5_LOYALTY_COMBOS_DESIGN.md` section 2.3-2.4.
- P5-2 (`docs/PHASE5_STEP2_DB_PERMISSIONS_FOUNDATION.md`): migrations `20261027000000`…`20261027000003` (permission codes, semantics, loyalty foundation, combo/reward foundation); 11 permissions, nothing granted; **not deployed**; deploy = `pnpm db:deploy` then `pnpm db:permissions:sync`.
- Owner 2026-10-04 (after P5-2): P5-T3/T4/T5/T9/T11 approved; combo issued only when its invoice is PAID; go-live = new Owner-only permission `ACTIVATE_LOYALTY` + fresh re-auth, stays OFF; **no deploy until all of Phase 5 is done**; OQ-2 Owner-approved (all services earn, tips excluded); **P5-T8 REJECTED by the Owner: manual deductions above the balance are hard-blocked ("Số dư chỉ còn X điểm", nothing written); reversals keep the P5-Q5 floor-at-0 + exception**. Design doc 2.5.
- P5-3 (`docs/PHASE5_STEP3_POINTS_TIERS.md`): migrations `20261028000000`…`02` (ACTIVATE_LOYALTY code, Owner-only triggers, loyalty consumer outcomes); `loyalty` outbox consumer (earn on INVOICE_PAID, reverse on INVOICE_REOPENED/CANCELLED), manual adjustments, exceptions list, go-live screen, customer points profile; **not deployed**; deploy adds `pnpm db:permissions:sync` (53 codes) and a worker restart.
- P5-4 (`docs/PHASE5_STEP4_MEMBER_DISCOUNT.md`): migration `20261029000000`; Member Discount = tier candidate in the best-offer selection (`calculation_version = 2`, Spa tier from the balance BEFORE the invoice, snapshot on the invoice, equal amount: the MEMBER discount wins so the customer keeps the voucher, only when go-live ON); **Owner-approved 2026-10-04: P5-T6 (tie -> member discount, replaces the earlier "promotion first" answer) and OQ-2 (member discount applies to all priced services, no exclusions)**; also P5-T8 REJECTED by the Owner (manual deduction above the balance is hard-blocked); **not deployed**.
- P5-5 (`docs/PHASE5_STEP5_REFERRAL.md`) built, **not deployed**: migrations `20261030000000`, `20261030000001`; referrer at signup (silent) or counter (`MANAGE_REFERRALS`), award +10 Spa +10 Beauty by the `loyalty` consumer on the FIRST paid-with-money visit (0đ never, cancelled/never paid never, bound while OFF is stored, visits before go-live count), Owner-only `CHANGE_REFERRER` correction with history until the reward (OQ-7 rejected as written), referral list tab + profile card; deploy adds `pnpm db:permissions:sync` (54 codes). Owner approvals of 2026-10-04 (OQ-4/5/6, OQ-7 rejected, P5-T10, go-live scope) are in design 2.5. Owner review 2026-10-04: "already visited" = received a service (booker with none stays new; Owner-approved, built); never "khám" in Vietnamese (rule in CLAUDE.md, 4 strings changed); footer "Khám phá" (Explore) stays.
- Owner 2026-10-04, OQ-8 (birthday gift, P5-6) answered: payer's birthday (guest none); 29/2 = 28/2 in non-leap years; percentage on the amount after the best offer; non-combinable gift competes with the best offer (larger wins), non-money never compared; money gifts only (free service/items = P5-9); usage limit default 1 per customer per year, screen forces an explicit choice. Design 2.5.
- P5-6 (`docs/PHASE5_STEP6_BIRTHDAY.md`) built, **not deployed**: migrations `20261031000000`, `20261031000001`; Owner-only setup tab "Quà sinh nhật" (ships empty, explicit usage limit), gift layer after the best offer on the invoice (stacked / replaces / alone, frozen at finalization, points never doubled), `MANAGE_BIRTHDAY_REWARDS` Owner only.
- Owner 2026-10-05 (P5-6 follow-ups, design 2.5): a gift that may NOT combine is compared with the best offer, both on the ORIGINAL total, larger discount wins (100,000 with a 60,000 offer vs a fixed 80,000 gift: the gift wins, 20,000 paid); the "amount left after the offer" base applies only when the gift IS allowed to combine; a tie keeps the offer and the gift is not counted as used; "per year" = per birthday occurrence; **P5-T7 APPROVED**; Owner-only config and the 364-day window approved. Engine and tests follow. **P5-6 APPROVED by the Owner, 2026-10-05** (Owner's instruction to start P5-7).
- CI (Owner 2026-10-05): red since P5-2 because the foundation tests ran in parallel on a fresh database whose permission catalog was empty, so two suites inserted the same catalog rows (write conflict / deadlock, then 25P02). `test:integration` now commits the catalog once first (`node dist/sync-permissions.js`). Integration tests, `pnpm smoke` and the API integration entry refuse any database whose name is not a scratch/test one (the CI container `lucy_spa_dev` is accepted only with `CI=true`).
- Q8 (Phase 4) was answered before Step 10 (see "Q8 (notifications)" below).

## Q8 (invoice / revenue notifications) - LOCKED

In-app only (no email/Zalo). Payer: notified when invoice becomes PAID and when a finalized invoice is cancelled (no reason); nothing for drafts/partials.
PayOS request creator: notified on success or anomaly. Management: exceptions only, to `CORRECT_PAYMENTS` holders at the invoice branch (PayOS anomalies, payment reversals, finalized-invoice cancellation).
Daily revenue summary 21:30 branch-local to `VIEW_REVENUE` holders (total, cash, PayOS, paid count, pending count); revenue totals only to `VIEW_REVENUE`; exception notices show only that invoice's amounts. Routing = invoice branch + permission engine, no role names.

## Owner instruction for Step 7

Keep the payment architecture ready for a future **CARD / POS-terminal** integration, but **do NOT activate CARD**
(Lucy Spa has no POS terminal yet): no CARD method selectable, accepted or shown in the UI or API.
Step 7 (`docs/PHASE4_STEP7_PAYMENTS.md`): cash + split + reversal under `/api/v1/pos/invoices/:id/payments`; no migration; CLOSED / OWNER APPROVED.
Step 7 Owner answers: COLLECT_PAYMENTS + VIEW_INVOICES are granted together via roles (no code change); CARD reversal policy deferred until a real terminal/provider exists (open future decision); paid amount on board rows deferred to the post-Phase 4 UX/UI redesign.
CARD-ready = the per-method rule table `apps/api/src/pos/payment.methods.ts` (keyed by the DB enum, CASH only); enabling CARD is an additive enum + rule (report 6).

## Step 8 (PayOS)

Step 8 (`docs/PHASE4_STEP8_PAYOS.md`): PayOS QR requests (`COLLECT_PAYMENTS`), signed webhook, settlement core in `packages/server`, worker sweep, anomalies/notes (`CORRECT_PAYMENTS`); 2 migrations; no live call made.
Step 8 Owner answers: anomaly review and notes stay on `CORRECT_PAYMENTS` (no new permission); anomaly recipients are decided with Q8 in Step 10 (invoice page + API list suffice for now); the short memo `LUCYSPA` is fine because matching uses the PayOS order code only.
Deploy needs `PAYOS_CLIENT_ID/API_KEY/CHECKSUM_KEY` (api + worker), the webhook URL registered in PayOS, `db:permissions:sync`; then one small real payment.

## Step 9 (customer invoice history)

Step 9 (`docs/PHASE4_STEP9_CUSTOMER_INVOICES.md`): `GET /api/v1/me/invoices[/:id]`, payer = session customer and finalized only, read only; no migration.
Web `/account/invoices` (VI/EN). CLOSED / OWNER APPROVED.
Step 9 Owner answers: drafts hidden, cancelled shown as "Đã hủy" (reason hidden); guest-payer invoices never viewable/attached (V1); no customer self-pay (counter payment; online self-pay = separate future feature). Dev DB `lucy_spa_dev` is 12 migrations behind: run integration tests on a scratch DB.

## Step 10 (invoice / revenue notifications)

Step 10 (`docs/PHASE4_STEP10_INVOICE_NOTIFICATIONS.md`): Q8 policy implemented in-app only; migration `20261017000000` (`outbox_consumptions`, notification CHECKs, one summary event per branch/date).
Worker consumer `notifications` (no `published_at`) + 21:30 branch-local summary scheduler; routing by `resolvePermissionHolders`; web FINANCE tab. No new permission/env.
Step 10 Owner answers (confirmed): Owner account receives exceptions/summary via the permission engine; managers see their own reversal alerts; summary daily even with zeros (00:00-21:30, catch-up to midnight); no read-time re-check for revoked holders; expired/failed PayOS requests notify nobody. CLOSED / OWNER APPROVED.

## Step 11 (final validation)

Step 11 (`docs/PHASE4_FINAL_VALIDATION.md`): full gate on scratch DB `lucy_spa_step11_validation_20260930` (35 migrations): 917 tests pass, web build, smoke pass.
Fixed only gate-side defects (stale OpenAPI assertion in `scripts/smoke.mjs`, prettier drift). No migration, no product change (deployed later, see Production).
Report has the deployment checklist (10 pending migrations, PayOS env, webhook URL, `db:permissions:sync`, PER_NAIL limits). Step 11 and Phase 4 CLOSED / OWNER APPROVED; scratch DB dropped.

## Wallet names (2026-10-05, deployed in `f79572d`, see Production)

- Owner instruction: the wallets are "Điểm Lucy Spa" / "Điểm Lucy Beauty" (EN "Lucy Spa points" / "Lucy Beauty points") everywhere, from one place (`apps/web/src/i18n/loyalty.ts`).
- Customer Beauty card has the same "Ưu đãi hội viên" row: "Áp dụng khi Lucy Beauty mở bán" until Phase 6, which must replace it with the real tier % (design 15.3). Report: `docs/PHASE5_WALLET_NAMES.md`. No migration.

## Early START of a service (2026-10-07, deployed in `39ad8d1`, see Production)

- Owner request and eight decisions (own words): `docs/EARLY_START_DESIGN.md`. A technician may START before the booked time when the customer is checked in, they are free, nothing overlaps (also the early part, at database level) and a collaborator's shift covers it. Only the assigned technician; no notification; label "Bắt đầu sớm X phút" on My services and the booking board.
- Migration `20261105000000_early_service_start_occupancy` (replaces `lucy_sync_visit_line_occupancy`, adds an `AFTER INSERT` trigger on `service_executions`; no table or data change). Must be applied with the deploy (63 migrations). Permissions unchanged (54).
- `SERVICE_NOT_READY` removed; new block codes `SERVICE_EARLY_START_CONFLICT` / `SERVICE_EARLY_START_OUTSIDE_SHIFT`; audit/outbox `SERVICE_STARTED` gain `plannedStartAt`, `startedEarlyMinutes`. Report: `docs/EARLY_START_REPORT.md`.

## Phase 6 P6-2 (Wave 1 database and permissions foundation, 2026-10-07, committed locally, not pushed, not deployed)

- 5 additive migrations `20261106000000`…`04` (63 -> 68): 11 permission codes (54 -> 65, granted to nobody, new role-screen group "Sản phẩm và kho"), 18 new tables, 17 empty (catalog, prices and promotions, images, import jobs and rows, suppliers, receipts, lots, stock levels, counts, movements) plus `product_settings` with one row (expiry warning 90 days, "Mới" 30 days).
- No change to invoices, discounts, loyalty or payments (guard test `phase6-wave1-isolation.test.ts`); no API, screen or worker yet. Deploy of Wave 1 later = `pnpm db:deploy` then `pnpm db:permissions:sync`. Report: `docs/PHASE6_STEP2_DB_PERMISSIONS_FOUNDATION.md`. Next: P6-3 (catalog administration), after the Owner reviews P6-2.
- **P6-2 APPROVED by the Owner (2026-10-07)**, with its six database rules (price change blocked while a promotion is at or above it; promotion below list price and not already over; lots immutable; two-level categories; ranges 1-730 / 1-365; only draft receipts cancellable, with a reason). P6-3 (catalog administration) was requested in the same message; recorded in design section 2.6.

## Phase 6 P6-3 (catalog administration, 2026-10-07, committed locally, not pushed, not deployed)

- No migration (still 68). API `/api/v1/product-brands|product-categories|products` (global authority: `MANAGE_PRODUCTS`, `MANAGE_PRODUCT_PRICES`, `VIEW_PRODUCT_COST`); one presenter cuts cost and margin (keys absent) for callers without the cost permission, on every endpoint. Screens under Danh mục > Sản phẩm (list, brands and categories tabs, new page, detail with variants, price and promotion history, images). Media library list, upload and serving also open to `MANAGE_PRODUCTS`; a product image shows as a usage and blocks deletion.
- **P6-3 APPROVED by the Owner (2026-10-07) with 5 fixes, all done** (local, not pushed/deployed): (1) a promotion ended by hand, even before it starts, no longer blocks lowering the list price: migration `20261106000005_phase6_ended_promotion_price_guard` replaces one function body (now 69 migrations; Wave 1 guard test counts six); (2) screen access = `MANAGE_PRODUCTS` or `MANAGE_PRODUCT_PRICES`; (3) `MANAGE_PRODUCTS` edits image captions/alt text (delete stays `MANAGE_WEBSITE_CONTENT`); (4) product thumbnail at the start of each list row (`MediaThumb`, DataTable `leading` column); (5) top-bar overflow at 130% + 360 px recorded in `docs/UI_BACKLOG.md`, not fixed. Report: `docs/PHASE6_STEP3_CATALOG_ADMIN.md`.
- Earlier note: a setup command ran on the local `lucy_spa_dev` by mistake (applied the 68 migrations, permission sync, a review Owner account; it had no data); see the report.
- **Owner change of scope for Lucy Beauty sales (2026-10-07, docs only):** counter pre-orders (paid in full, goods ordered from the supplier, arrive in 3-5 days, "phiếu hẹn nhận hàng") and online orders (PayOS, nationwide, no COD; replaces T8). Impact, model P6-T28..T33, redesigned steps P6-3b and P6-15..24 (online = Wave 4) in design 2.7 and 18; 13 questions OQ-P6-29..41 in `docs/PHASE6_OWNER_DECISIONS_VI.md`. **The Owner answered the same day (design 2.8, in his words): T28-T32 approved, T7 confirmed (pre-order is a separate mode, not overselling), T33 changed (NO variant weight; fee simple, Wave 4; `sell_on_order` + optional wait days kept; P6-8 `channel` + `shipping_fee_vnd` approved), OQ-29/30/31/33/34/36/37/39/41 as recommended, OQ-32 (7 days late = free cancel), OQ-35 (no printing; digital only), OQ-38 deferred to Wave 4, OQ-40. Still pending: **OQ-P6-42** (how a walk-in customer without an account views the ticket; proposal = secret link + QR sent by hand) and the renumbered 18.6 table. He asked for P6-3b then P6-4 (local commits only).**

## Phase 6 P6-3b (variant pre-order fields, 2026-10-07, committed locally, not pushed, not deployed)

- Migration `20261106000006_phase6_variant_pre_order` (now 70): variant `sell_on_order` (default ON, OQ-P6-30), optional `lead_time_days_min/max` (both or neither, 1-90, min <= max: my DB rules, pending his yes/no), and the default 3-5 days on `product_settings`. NO weight (Owner removed it). New `GET /product-settings`, `POST /product-settings/edit` (view: MANAGE_PRODUCTS or PRICES; edit: MANAGE_PRODUCTS). Screens: variant drawer, "Đặt trước" column, "Cài đặt" dialog on Sản phẩm. Report: `docs/PHASE6_STEP3B_PRE_ORDER_FIELDS.md`.

## Phase 6 P6-4 (inventory, 2026-10-07, committed locally, not pushed, not deployed)

- Migrations `20261106000007_phase6_inventory_alerts` (sequences, `lucy_available_stock`, low-stock alert + expiry scan tables, movement trigger now raises the low-stock alert) and `20261106000008_phase6_notification_kinds` (widens 3 CHECKs of `notifications`; the only existing table Wave 1 touches). Now 72 migrations; Wave 1 guard counts nine. API `/inventory/*`, `/suppliers`, `/stock-receipts`, `/stock-adjustments`, `/stock-counts`; worker loop `inventory-jobs.ts` (alerts + 08:00 branch-local expiry scan); confirming a receipt writes outbox `STOCK_RECEIPT_CONFIRMED` (no consumer yet). Screens: Danh mục > Kho hàng (stock, receipts, counts, suppliers). Unit cost only with `VIEW_PRODUCT_COST`.
- My readings pending his yes/no are listed in design 4.8 and `docs/PHASE6_STEP4_INVENTORY.md`. Next: P6-5 (Excel/CSV import) after the Owner's review of P6-3b and P6-4; his answer to OQ-P6-42 is needed only before P6-16.

## Owner approval of P6-3b and P6-4 (2026-10-07) and the P6-5 request

- **Approved:** P6-3b and P6-4; migration …08 (notifications CHECKs loosened only; **Wave 1 is deployed in the evening, a quiet time**: `docs/PHASE6_WAVE1_DEPLOY_CHECKLIST.md`); my readings (pre-order on by default, branch-local expiry, nearest-expiry-first count correction, 08:00 scan, 1-90 days); **OQ-P6-42** (secret link + QR for walk-in customers, built in P6-16). Recorded in design 2.9 and `PHASE6_OWNER_DECISIONS_VI.md`.
- Asked before P6-5: finish the UI gate of P6-3b/P6-4, fix or backlog the bell badge, recreate the official DOM audit. Then P6-5 (Excel/CSV import: products and variants with the pre-order columns, opening stock; preview, row errors in Vietnamese, duplicate checks, nothing saved until he confirms, template download).

## Phase 6 P6-5 (Excel/CSV import, 2026-10-07, committed locally, not pushed, not deployed)

- Import of products and variants (pre-order columns) and of opening stock: template download (xlsx, csv), preview with row-level Vietnamese errors, duplicate checks, nothing saved until the Owner confirms; apply plans again under locks and refuses a stale preview. API `apps/api/src/product-imports/`, parser and templates in `packages/server/src/product-import/`, screens "Nhập dữ liệu" (`/import`). **No migration** (72 in Wave 1); new dependencies fflate and fast-xml-parser.
- **APPROVED by the Owner on 2026-10-07 (design 2.10): OQ-43..OQ-48 as proposed; bulk images and bulk price update move to Phase 9.** The readings (OQ-43..OQ-48 in `docs/PHASE6_OWNER_DECISIONS_VI.md`) are: skipping invalid rows needs an explicit tick, 5 MB / 2,000 rows synchronous, blank cell keeps the value, two new libraries, bulk images (31.3) and bulk price update (31.4) not built. Report: `docs/PHASE6_STEP5_IMPORT.md`.
- The official DOM audit capture is now committed (`scripts/uxui-audit-capture.mjs`); the 26 baseline pages show no count rising.

## Phase 6 P6-6 (public cosmetics catalog, 2026-10-07, committed locally, not pushed, not deployed)

- `/products` ("Mỹ phẩm"; OQ-P6-27/28 as approved): list (Owner hero + commitment box hidden while empty, search, 4 sorts, category/brand filters, 20 per page) and product page (gallery, variants, store block from the shop profile, related); public API `/api/v1/public/products[/:code|/codes]`, 60 s cache, no cost/quantity/SKU/ids; pictures public only while PUBLISHED; sitemap + JSON-LD. Migration `20261106000009` (8 columns on `product_settings`, additive); Wave 1 is now 10 migrations (73 total). Report: `docs/PHASE6_STEP6_PUBLIC_CATALOG.md`.
- **APPROVED by the Owner on 2026-10-07 (design 2.11): OQ-49..OQ-53 as proposed** (hero/commitment copy edited in Products → "Trang mỹ phẩm", four sorts, stock wording rule, store-block text, English label "Cosmetics"). P6-5 approval (OQ-43..48) is in design 2.10.
- **Deploy rule (Owner, final, design 2.11): Phase 6 deploys wave by wave, only when the Owner says so, after each wave's milestone check. Before each wave: rehearsal on a restored copy of the production DB (pg_dump), timed migrations, a written rollback plan (DB restore + previous commit), and the guide as iNET web terminal commands block by block.**

## Phase 6 P6-7 (load readiness, 2026-10-07, deployed with Wave 1, commit 6546c43)

- `ecosystem.config.cjs`: web = pm2 cluster (3), API and worker = exactly one (test pins it). Public `/api/v1/public/*` rate limit in Redis (needs nginx `X-Forwarded-For`), 5 s API cache for cosmetics reads, `scripts/load-public.mjs`. Product list API 74 -> 1,200 req/s; pages about 2.5x with 3 web processes (local numbers). Report: `docs/PHASE6_STEP7_LOAD_READINESS.md`.
- **APPROVED by the Owner on 2026-10-07 (design 2.12): OQ-54..OQ-57 as proposed** (limits, 5 s cache, 3 web processes, nginx header; Wave 1 approved). Image fallback added (`FallbackImage`, MediaThumb/Tile/Row and public product pictures). **Pushed `6546c43` to `main`, CI green (2026-10-07); that is the Wave 1 deploy commit** (guide `docs/PHASE6_WAVE1_DEPLOY_CHECKLIST.md` names it). Deployed by the Owner on 2026-10-07 (see the Production section). Wave 1 milestone report `docs/PHASE6_WAVE1_MILESTONE.md`; deploy guide (iNET terminal blocks, rehearsal, rollback) is `docs/PHASE6_WAVE1_DEPLOY_CHECKLIST.md`. Nothing of Phase 6 is on production; the Owner decides when.

## Phase 6 Wave 2 approvals and P6-8 (2026-10-07)

- **Owner approved ("as you recommended", design 2.13): T17, T18, T19, T20, T26, T27, OQ-58 (API single process in Wave 2), OQ-59 (v2 stays the source of truth for service-only invoices; v3 runs in parallel, mismatches logged/alerted; P6-9 work), OQ-60 (supervised trial sales before `SELL_PRODUCTS` is granted), and T21-T23 for Wave 3 (48 hours from handover).** Nothing pending: the (branch, variant) lock-sort refinement (T13) and OQ-P6-19 (option A) were already approved on 2026-10-07 (design 2.5); an earlier line saying otherwise was corrected on 2026-10-08.
- **P6-8 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP8_PRODUCT_LINES.md`): `PRODUCT_SALE` kind + `PRODUCT` lines with required seller, server-resolved frozen price, `channel`/`shipping_fee_vnd`, stock reserved at finalize / released at cancel, `SELL_PRODUCTS` routes under `/pos`. 2 migrations (20261107000000/1), no permission change. Product lines get no discount/points until P6-9/P6-11; consumption + T26 view + UI = P6-10.
- OQ-61..65 APPROVED by the Owner on 2026-10-08 ("as you proposed"; OQ-65: the per-side tables and the discount-scope column stay in P6-9; design 2.15). Service-only invoices unchanged: all existing POS/payment/loyalty suites pass unmodified.

## Phase 6 P6-9 pricing engine v3 (2026-10-08)

- **P6-9 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP9_PRICING_V3.md`): engine v3 per side (Spa / Beauty), scope SERVICES/PRODUCTS/BOTH + product targets (API only, no screen), shared program split (T18), per-side rows, line and payment-side allocations, OQ-59 shadow run (service-only stays v2; a mismatch is logged, audited, sent as an outbox event, never changes the amount). 2 additive migrations (20261108000000/1), no permission change.
- Owner approved P6-8 (OQ-61..65) and corrected the docs: T13 and OQ-P6-19 were approved on 2026-10-07 (design 2.15). The question-tool answer "Widen the key (Recommended)" (redemption key per invoice and program, 5 test lookup lines changed) is provisional until confirmed. My readings OQ-66..71 are pending (design 2.16).
- Nothing here is live (not deployed); no seed or code grants `SELL_PRODUCTS`. Next: P6-10 (POS screens, consumption, T26 view) only after the Owner approves P6-9.
- **P6-10 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP10_POS_PRODUCTS.md`, design 2.18): stock consumption (`packages/server/src/stock-sales.ts`, worker loop `inventory-sales-jobs.ts`, migrations 20261109000000/1), counter API (`GET /pos/branches/:id/products`), POS screens for product lines, per-side discount table, member view of product lines (T26). Needs the worker loop running and `SELL_PRODUCTS` granted after a deploy. Readings OQ-72..75 pending; one design deviation (cancel reverses an unconsumed-reversal sale itself, OQ-73). Next: P6-11 only after the Owner approves P6-10.
- **2026-10-08: the Owner APPROVED P6-9** (design 2.17): "Widen the key" confirmed, OQ-67..71 as proposed, **OQ-66 changed: a product category target also covers its subcategories** (loader widens the target set with the descendants; test edited deliberately: the "parent does not include children" assertion). OQ-72 (tree at finalization applies) pending. P6-10 requested (design 2.17/2.18).
- **2026-10-08: the Owner APPROVED P6-10** (design 2.19, exact words): OQ-72, 73, 74, 76 as proposed; **OQ-75 changed: an expired lot is still the last resort, but the sale creates an in-app alert (inventory permission holders at the branch) naming invoice, product and lot.** P6-11 requested (Beauty points, Beauty card %, Wave 2 milestone: rollback proof, rehearsal, deploy guide). Local commits only.
- **P6-11 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP11_BEAUTY_WAVE2.md`, design 2.20): Beauty points (`BEAUTY_EARN:{invoice}:{paid_seq}`, payer only, Beauty side net, never the fee), the expired-lot alert of OQ-75 as changed (`EXPIRED_LOT_SOLD`, migration `20261110000000`, recipients locked before the stock), Beauty card real %, scope/product targets on the discount screens. **Wave 2 milestone done** (`PHASE6_WAVE2_MILESTONE.md`): all suites green, rehearsal on a production-like copy (7 migrations ~0.4 s), rollback proof (`PHASE6_WAVE2_ROLLBACK_PROOF.md`: old code breaks once any product sale exists, so a 5-number gate precedes any rollback), deploy guide `PHASE6_WAVE2_DEPLOY_CHECKLIST.md` (fill `<MÃ_COMMIT_MỚI>` after the Owner pushes). Pending the Owner: OQ-77, OQ-78. Wave 2 is NOT deployed; production stays `6546c43`.
- **2026-10-08: the Owner APPROVED Wave 2** (design 2.21, exact words): OQ-77 and OQ-78 as proposed. The site is internal-only (no customers), so deploys need no quiet hour. The supervised trial sale (OQ-60) is POSTPONED (no real products until after Phase 9): `SELL_PRODUCTS` stays granted to no one after the deploy. Customer tier table now marks the Beauty tier too. Owner asked: push, CI, commit into the guide, paste the guide in chat; the Owner deploys himself.
- **2026-10-08: pushed `1358725` (full sha 135872558838e00436fa5ce829e70f0517d7be68) to `main`, CI green (Phase 0 checks).** It is the Wave 2 deploy commit named in `docs/PHASE6_WAVE2_DEPLOY_CHECKLIST.md`. NOT deployed yet: the Owner deploys himself from the guide; record the deploy (commit, migrations 80, date) here when he reports it.
- **2026-10-08: the Owner APPROVED Wave 3 decisions** (design 2.23, exact words): "Wave 3 decisions approved as you recommended: T34, T35, T36, T37, OQ-79 to OQ-88". Owner asked for **P6-12 only** (product return cases: record, eligibility checks, private evidence photos, staff screens; no money, no stock; `MANAGE_PRODUCT_RETURNS` stays granted to no one).
- **P6-12 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP12_PRODUCT_RETURNS.md`, design 2.24, readings R1-R12 pending the Owner): return cases per product line (windows 168 h / 48 h from hand-over, seal, quantity cap, private evidence photos, Owner-only removal, in-app notice to `REFUND_PRODUCTS` holders), migration `20261111000000` (81), screens "Trả hàng". No money, stock or points move; `MANAGE_PRODUCT_RETURNS` and `REFUND_PRODUCTS` granted to nobody (65 codes). Next: P6-13 only after the Owner approves P6-12.
- **2026-10-08: the Owner APPROVED P6-12** (design 2.25, exact words): "P6-12 approved: R1, R2, R3, R8, R10 and the other R items in section 2.24 as you proposed. One change: the Owner (only the Owner) may approve a return outside the time window as an exception, with a mandatory written reason, recorded in the case history and audit log." Built as a follow-up (local, not pushed, not deployed): migrations `20261112000000` (enum value) and `20261112000001` (82, 83), event `WINDOW_EXCEPTION`, audit `PRODUCT_RETURN_WINDOW_EXCEPTION`; readings E1-E6 (the Owner opens it with a reason; any present photo accepts a wrong/damaged exception case) pending the Owner.
- **P6-13 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP13_PRODUCT_REFUNDS.md`, design 2.26, readings P13-1..P13-9 pending the Owner): refunds per product line of an accepted refund case (cash or manual transfer, `REFUND_PRODUCTS` + fresh password, immutable record, amount = net share of the units), linked Beauty point reversal by the `loyalty` consumer (event `PRODUCT_REFUNDED`, option A), sellable goods into new lots (`REFUND_RETURN`), T22 (no payment reversal or cancel after a refund), migrations `20261113000000`/`20261113000001` (84, 85). A race test found and fixed a points bug (wallet lock before reading what was taken back). `REFUND_PRODUCTS` still granted to nobody. Next: P6-14 only after the Owner approves P6-13.
- **2026-10-08: the Owner APPROVED P6-13** (design 2.27, exact words): "P6-13 approved: E1–E6 and P13-2, P13-4 to P13-9 as you proposed. P13-1: yes, a refund requires an accepted return case. P13-3: password re-entry once per refund (no 5-minute window). Add: every product refund sends an in-app notification to the Owner (invoice, product, quantity, amount, method, who refunded)." Built as a follow-up (local, not pushed, not deployed): one password confirmation covers ONE refund (table `refund_reauthentication_uses`, migration `20261114000000`, 86 migrations), notice `PRODUCT_REFUND_MADE` to every active Owner account in the refund transaction; readings N1-N4 (name in the notice, Owner refunding is told, Owner only, lock order) pending the Owner. The Owner also asked P6-14 (exchanges) and the milestone 3a check.
- **P6-14 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP14_PRODUCT_EXCHANGES.md`, design 2.28, readings P14-1..P14-16 pending the Owner): exchange of an accepted EXCHANGE case for one item in stock; the replacement goes out on a NEW counter invoice whose only benefit is the exchange credit (so stock reservation/sale, cash and PayOS payments and Beauty points on the difference use the existing machinery); cheaper = refund rules + Owner notice; refunds and exchanges share one cumulative sequence per line (`lucy_line_claims`); T22 extended; migrations `20261115000000`/`20261115000001`/`20261115000002` (87-89; the last one forbids return cases on exchange invoices, P14-15); `REFUND_PRODUCTS` still granted to nobody. Next: the milestone 3a check.
- **Milestone 3a check done (2026-10-08); PUSHED as `2076cc58ed7fd062f4b05576a67d8625e325c038` (`2076cc5`), CI green, NOT deployed** (the first push bdcb5cf failed once on a media-upload rate-limit test that straddled a clock minute; test-only fix 2076cc5) (`docs/PHASE6_WAVE3A_MILESTONE.md`, `PHASE6_WAVE3A_ROLLBACK_PROOF.md`, deploy guide `PHASE6_WAVE3A_DEPLOY_CHECKLIST.md`, real commit filled in): production is still `1358725`/80 migrations; 3a = 9 migrations (89), 0 new permissions (65). Rehearsal on a production-like copy (234 MB): 9 new tables, 21 new functions, 4 function bodies replaced; 9 migrations 0.54 s, `db:deploy` 4 s. Old code `1358725` on a clean 89-migration DB: API suite 769/770, DB suite 123+18; with 3a data the old stock page and points ledger answer 503 and the old worker never reverses points of a refund, so the rollback gate is six numbers that must all be 0. The guide makes the Owner create `/opt/lucyspa-media/returns` and prove with a command that nginx does not serve it (blocking). Booking-job errors at worker start explained (55P03 NOWAIT lock collision, same on old and new worker, worker source unchanged, self-heals). 2026-10-08 the Owner's conditional rule ("if none changes money policy ... treat as approved; if any does, do not treat it as approved; ask me"): N1-N4 and P14-1, 6-14, 16 recorded as approved; P14-2, P14-3, P14-4, P14-5, P14-15 NOT approved, asked the Owner.
- **2026-10-08: the Owner approved P14-2, P14-3, P14-4, P14-5, P14-15 and asked for P6-15 to P6-18 in one run (milestone 3b)** (design 2.29, exact words): technical choices are recommended, recorded as "pending owner review" and continued; no invented money or business policy. Wave 3a is deployed (see Production).
- **P6-15 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP15_PRODUCT_ORDERS.md`, design 2.30, readings P15-1..P15-10 pending the Owner): `fulfilment_mode` on product lines, tables `product_orders` / `product_order_lines` / `product_order_events`, reservation source `ORDER_LINE`, allocation and hand-over core in `packages/server`, permission `MANAGE_PRODUCT_ORDERS` (66 codes, granted to nobody), migrations `20261116000000`/`20261116000001` (91). DB integration + 4 races + static test; 14 old API suites rerun green on 91 migrations.
- **P6-16 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP16_COUNTER_PREORDER.md`, design 2.31, readings P16-1..P16-7 pending the Owner): cashier chooses pre-order per line, phone mandatory at finalization, order card on the invoice, the member's ticket inside the invoice, the guest's secret link + QR (hash only, shown once, no automatic expiry: question for the Owner), public page `/ticket/<token>`; migration `20261117000000` (92). Next: P6-17.
- **P6-17 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP17_ORDER_QUEUE.md`, design 2.32, readings P17-1..P17-10 pending the Owner): page `/product-orders` (tabs, to-order grouped by usual supplier, order page), mark ordered, arrival allocated by the receipt and by cancel, hand-over with proof, cancel + whole-line refund, reference correction, daily 08:00 alert, member arrival notice; migration `20261118000000` (93). Open: ticket expiry, e-mail of OQ-34, partial refund, background allocation.
- **P6-18 built, committed locally, not pushed, not deployed** (`docs/PHASE6_STEP18_GIFT_STOCK.md`, design 2.33, readings P18-1..P18-5 pending the Owner): a product gift can name a variant; marking a unit used takes one unit from that branch's free stock (FEFO, never an expired lot, never reserved or arrived pre-order goods), `Hết hàng` refuses and writes nothing; a manager's restore puts the unit back into the same lot; movement kinds `GIFT_OUT` / `GIFT_RETURN`; migrations `20261119000000`/`1` (95).
- **Wave 3b milestone checked (2026-10-09); DEPLOYED by the Owner the same day (see Production):** P6-15..P6-18 = 6 migrations (89 to 95), permission `MANAGE_PRODUCT_ORDERS` (66, granted to nobody), 1 qrcode dependency; checks, rehearsal (6 migrations ~0.43 s), rollback proof (gate of nine numbers, step A1 deletes the permission row) in `docs/PHASE6_WAVE3B_MILESTONE.md`, `PHASE6_WAVE3B_ROLLBACK_PROOF.md`, deploy guide `PHASE6_WAVE3B_DEPLOY_CHECKLIST.md` (commit `43a1b29`, pushed, CI green). Open for the Owner: ticket expiry, e-mail of OQ-34, partial refund on change of mind, background allocation; readings P15-1..P18-5 pending.
- **2026-10-09: Wave 3b follow-up built, local commit, NOT pushed, NOT deployed** (design 2.35, report `docs/PHASE6_WAVE3B_FOLLOWUP.md`, readings F1..F4 pending the Owner): ticket link of a walk-in expires 30 days after the last hand-over or cancellation (derived, no migration, `ORDER_TICKET_EXPIRED` for a new link); a change of mind after the supplier order may be refunded in part (`amountVnd`, 1 to the whole share) or declined with a reason (`POST /product-orders/lines/:id/decline`, audit only); migration `20261120000000_phase6_wave3b_changed_mind_refund` (96, replaces one guard function). Needs its own deploy guide, rehearsal and rollback proof before install. Questions 2 and 4 need no code.
- **2026-10-09: Wave 4 prepared, docs only** (design 2.36, `docs/PHASE6_OWNER_DECISIONS_VI.md` section "Đợt 4": T38..T42, OQ-89..OQ-103, quick-answer table). Owner decisions recorded: free shipping on ALL online orders (fee always 0, replaces OQ-38), the shop pays the carrier and staff only enter the tracking code, a shipping-fee / free-threshold setting kept but OFF by default, failed delivery = staff retry, then refund of goods minus the two-way carrier cost the shop really paid (staff enter it with a reason). Everything else in the section is pending the Owner; no code written.
- **2026-10-09: the Owner approved Wave 4** (design 2.37, his words): F1..F4 of the 3b follow-up; T39..T42 and OQ-89..OQ-103 as recommended; T38 changed (no split: build P6-19..P6-24 incl. full campaigns and deploy ONCE with migration 96); new master switch "Bán online" in admin, OFF by default after deploy. He asked for P6-19..P6-24 in one run (technical choices recorded "pending owner review", no invented money/policy, final milestone with rollback proof, rehearsal and iNET deploy guide, no server access). Nothing of Wave 4 is built yet when this line is written.
- **2026-10-09: Wave 4 (online orders, P6-19..P6-24) built, pushed (`4b91af6`, CI green), DEPLOYED the same day by the Owner (see Production)** (reports `docs/PHASE6_STEP19_ONLINE_CHECKOUT.md`, `PHASE6_STEP20_ONLINE_FULFILMENT.md`, `PHASE6_STEP22_ONLINE_LOAD_SECURITY.md`, `PHASE6_STEP23_CAMPAIGNS.md` and the `_WEB` reports, design 2.38 W4-1..W4-12 all **pending Owner review**): online shop (cart, checkout, prepaid PayOS, 30-minute timeout, free shipping), fulfilment (carriers, tracking, delivered, failed delivery log and the one settlement, cancel/refund, returns from the delivery date), per-account budget of 120 requests/minute, full promotion campaigns (lowest price wins, frozen once published). Master switch "Bán online" is OFF by default.
- **Wave 4 + the 3b follow-up deploy as ONE deploy:** 6 migrations (95 to 101), still 66 permissions, no new dependency, no new pm2 process; stop API and worker while migrating. Rollback possible only while no online order exists (gate of 11 numbers in `docs/PHASE6_WAVE4_ROLLBACK_PROOF.md`). Guide: `docs/PHASE6_WAVE4_DEPLOY_CHECKLIST.md`; milestone: `docs/PHASE6_WAVE4_MILESTONE.md`.
- Open questions for the Owner: tiền về muộn sau khi đơn đã hủy (W4-5); đổi hàng cho đơn online (chưa làm); gắn chiến dịch với hero/popup (chưa làm); report per campaign (no screen yet).
- **2026-10-08: Wave 3 prepared, docs only** (`docs/PHASE6_OWNER_DECISIONS_VI.md`, new "Đợt 3" section; design 2.22): quick-answer table for P6-12..P6-18 (T34-T37, OQ-79..OQ-88), risks and the test plan. Nothing is approved and no code is written; the Owner answers first. Wave 2 is deployed; production stays `1358725`.

## Phase 6 Wave 2 preparation (2026-10-07, docs only, no code)

- `docs/PHASE6_OWNER_DECISIONS_VI.md` has a new "Đợt 2" section (quick-answer table at its top, risks and test plan): **pending the Owner** T17, T18, T19, T20, T26, T27 (block P6-8..P6-10), new OQ-58 (no API clustering in Wave 2), OQ-59 (old engine stays authoritative for service-only invoices while v3 runs in shadow), OQ-60 (supervised test sale, then when real selling starts; no product returns/refunds until Wave 3), plus T21..T23 (block Wave 3 only; T23 clock restated to hand-over date per OQ-40). Nothing is approved until the Owner says so.

## Production

Status as of 2026-10-09, about 14:02 (+07) (Owner-reported; supersedes the blocks below): **Phase 6 Wave 4 (online orders, shipping, failed delivery, campaigns) together with the Wave 3b follow-up is deployed. Phase 6 is COMPLETE.**

- **Production runs `4b91af65f5666ae8dd4f40fabbf9bfcde7b82c44`** (`4b91af6`), deployed by the Owner on 2026-10-09 at about 14:02 (+07). Previous: `43a1b29`. Docs commits after it (`4e71ddc` and later) are not installed.
- Backup before the deploy: `/root/backups/lucyspa-pre-phase6-dot4-20261009T065540Z.dump` (1,220,003 bytes, 1938 TOC lines); the pm2 dump is saved.
- Rehearsal on a restored production copy: 6 migrations OK (changed_mind_refund 0.025, kinds 0.009, online_checkout 0.146, fulfilment 0.068, refunds_returns 0.049, campaigns 0.088 s); `101|66|f|0|0`.
- API and worker were stopped during the migration. Production now: **101 migrations, 66 permissions, "Bán online" OFF, 0 online orders, 0 campaigns** (`101|66|f|0|0`). Counts unchanged: users 9, bookings 4, invoices 2, payments 2, notifications 29.
- pm2: api 1, worker 1, web 3 online, no new errors. Health ok; 4 public pages 200; `/api/v1/online-sales` 200 with `"enabled":false`; cart and online-orders context without login 401; public campaigns 200. Outbox backlog 0/0.
- **The online store stays OFF until the Owner opens it after Phase 9 (real products).** Step 9 of `docs/PHASE6_WAVE4_DEPLOY_CHECKLIST.md` (permissions, carriers, branch, policy text, first small real order) is done then. No new permission was added; nobody holds the order/refund permissions yet except the Owner.
- **2026-10-09 Owner decisions on Wave 4 (his words, summarised):** W4-1..W4-12 approved as proposed. Open question 1 (payment arriving after an order was cancelled): keep as is, alert the manager and refund manually. Question 2 (exchanges for online orders): not needed now. Question 3 (campaigns on the home hero and the popup): include in the upcoming UI polish pass. Question 4 (revenue report by campaign): Phase 8.
- Rollback of Wave 4 is possible only while no online order exists (gate of 11 numbers in `docs/PHASE6_WAVE4_ROLLBACK_PROOF.md`).

Previous status (superseded): as of 2026-10-09, about 04:52 (+07): **Phase 6 Wave 3b (counter pre-orders, pick-up tickets, gift stock) is deployed.**

- **Production runs `43a1b29cef128d5555e1fd69b927d62c0ab276e5`** (`43a1b29`), deployed by the Owner on 2026-10-09 at about 04:52 (+07). Previous: `2076cc5`. Docs commits after it (`78d9470` and later) are not installed.
- Backup before the deploy: `/root/backups/lucyspa-pre-phase6-dot3b-20261008T214713Z.dump` (1,144,759 bytes, 1834 TOC lines); the pm2 dump is saved.
- Rehearsal on a restored production copy: 6 migrations OK, about 0.26 s in total (slowest `product_orders` 0.145 s); `95|66|29|2|2`.
- Production now: **95 migrations, 66 permissions** (`MANAGE_PRODUCT_ORDERS` inserted; gate `95|66|0|0|0|0|0|0|0|0|0` after the migration). Counts unchanged: users 9, bookings 4, invoices 2, payments 2, notifications 29.
- pm2: api 1, worker 1, web 3 online, no new errors. Health ok; 4 public pages 200; fake ticket on web and API 404; product-orders context without login 401. Outbox backlog 0/0.
- **`MANAGE_PRODUCT_ORDERS`, `REFUND_PRODUCTS`, `MANAGE_PRODUCT_RETURNS` and `SELL_PRODUCTS` are granted to nobody (`0|0`).**
- **2026-10-09 Owner decisions on 3b (his words, summarised):** P15-1..P18-5 approved as proposed. Open question 1: the walk-in ticket link expires 30 days after the order is handed over or cancelled. Question 2: no e-mail for "goods arrived" for now (in-app for members, staff call walk-ins). Question 3: already decided in OQ-32: after the supplier order, the customer changing their mind = Owner/manager decides per case (full refund, partial or decline, with a written reason); the "always full refund" behaviour is to be changed to match. Question 4: no background auto-allocation user. Items 1 and 3 were then implemented locally (see the entry below); Wave 4 is prepared as docs only.

Previous status (superseded): as of 2026-10-08, about 21:45 (+07): **Phase 6 Wave 3a (returns, refunds, exchanges) is deployed.**

- **Production ran `2076cc58ed7fd062f4b05576a67d8625e325c038`** (`2076cc5`), deployed by the Owner on 2026-10-08 at about 21:45 (+07). Previous: `1358725`. Docs commits after it (`40f882e`, `aa2f1fb` and later) are not installed.
- Backup before the deploy: `/root/backups/lucyspa-pre-phase6-dot3a-20261008T144015Z.dump` (1,022,251 bytes, 1646 TOC lines); the pm2 dump is saved.
- Rehearsal on a restored production copy: 9 migrations OK, about 0.47 s in total (slowest `product_returns` 0.191 s); `89|65|29|2|2`.
- Production now: **89 migrations, 65 permissions** (`89|65|0|0|0|0|0|0` after the migration, the six gate numbers). Counts unchanged: users 9, bookings 4, invoices 2, payments 2, notifications 29.
- `/opt/lucyspa-media/returns` created (root, 700). `nginx -T` exit 0: only root `/var/www/html`, 0 references to `lucyspa-media`.
- pm2: api 1, worker 1, web 3, all online, no new errors (no booking lock errors this time). Health ok; 4 public pages 200; the evidence photo route without login answers 401. Outbox backlog 0/0.
- **`REFUND_PRODUCTS`, `MANAGE_PRODUCT_RETURNS` and `SELL_PRODUCTS` are granted to nobody (`0|0|0`).**

Previous status (superseded): as of 2026-10-08, about 12:02 (+07): **Phase 6 Wave 2 is deployed.**

- **Production runs `135872558838e00436fa5ce829e70f0517d7be68`** (`1358725`), deployed by the Owner on 2026-10-08 at about 12:02 (+07). Previous: `6546c43`. Docs commits after it (`da54739`, `1e6d46d` and later) are not installed.
- Backup before the deploy: `/root/backups/lucyspa-pre-phase6-dot2-20261008T045527Z.dump` (913,894 bytes, 1496 TOC lines); the pm2 dump is saved in `/root/backups`.
- Rehearsal on the restored production copy: 7 migrations OK (`invoice_kinds` 0.016, `product_sales` 0.104, `discount_scope` 0.027, `pricing_v3` 0.126, `stock_sale_kinds` 0.005, `stock_consumption` 0.022, `expired_lot_alert` 0.007 s); `80|65|28|2|2`, old invoices untouched.
- Production now: **80 migrations, 65 permissions** (0 inserted), 0 product lines, 0 product invoices, 0 sale movements. Counts before and after unchanged: users 9, bookings 4, invoices 2, payments 2, notifications 28.
- pm2 (saved): `lucyspa-api` 1 (fork), `lucyspa-worker` 1 (fork, includes the stock-consumption loop), `lucyspa-web` 3 (cluster, reloaded). No new errors (the old ELIFECYCLE lines are historical).
- Health ok (database, redis up); `/vi`, `/vi/services`, `/vi/products`, `/vi/workforce/login` all 200. Outbox backlog: loyalty 0, inventory 0.
- **`SELL_PRODUCTS` is granted to nobody (`0|0`).** The supervised trial sale (OQ-60) is postponed until real products exist (after Phase 9). The website is internal-only (no customers). Rollback to the old version remains possible while the 5-number gate of the guide (step 10) is all 0.
- Wave 3 (returns, refunds, exchanges, counter pre-orders) has not started: docs only, see `docs/PHASE6_OWNER_DECISIONS_VI.md`.

Status as of 2026-10-07, about 23:10 (+07) (Owner-reported; superseded by the block above, **Wave 1 deploy record**):

- **Production runs `6546c434595cef5c7ab764d8e5e7cc4b62afe256`** (`6546c43`), deployed by the Owner on 2026-10-07 at about 23:10 (+07). Previous: `39ad8d1`. Docs commits after it (`4a4171d` and later) are not installed.
- Backup before the deploy: `/root/backups/lucyspa-pre-phase6-dot1-20261007T160340Z.dump` (790,983 bytes, 1287 TOC lines); the pm2 dump is saved in `/root/backups`.
- Rehearsal on the restored production copy: 10 migrations OK, about 0.43 s in total (largest 0.178 s, `inventory_foundation`).
- Production now: **73 migrations, 65 permissions** (11 new, granted to no one yet), 0 products. Counts before and after unchanged: users 9, bookings 4, invoices 2, payments 2, notifications 28.
- pm2 (saved): `lucyspa-api` 1 (fork), `lucyspa-worker` 1 (fork), `lucyspa-web` 3 (cluster via `ecosystem.config.cjs`).
- Health ok (database, redis up); `/vi`, `/vi/services`, `/vi/products`, `/vi/workforce/login` answer 200; "Mỹ phẩm" is hidden from the menu and the sitemap (no published products).
- Nginx already sends `X-Forwarded-For` (`sites-available/default`). Rate limit test: 300 x 200, 400 x 429. Old pm2 error-log lines (ELIFECYCLE from earlier process stops) are historical; no new errors.
- Wave 2 has not started. Rollback needs the 11 new permission rows deleted first (guide step 9).

Status as of 2026-10-07, about 02:52 (+07) (Owner-reported; superseded by the block above):

- **Production runs `39ad8d1`** (early service start `f88dff7` plus the Owner-approval docs commit), deployed by the Owner on 2026-10-07 at about 02:52 (+07). Previous: `607ca6a`.
- Migration applied: `20261105000000_early_service_start_occupancy`. `pnpm db:status`: up to date (63 migrations). Permissions unchanged (54).
- After the deploy: health ok (database up, redis up), `/vi` and `/vi/workforce/login` answer 200, pm2 3/3 online.
- Backup taken just before this deploy: `/root/backups/lucyspa-pre-earlystart-20261006T195014Z.dump`.
- `origin/main` is at `67deff2`, newer than production: it adds only `docs/DEPLOY_EARLY_START_RUNBOOK.md` (docs, no code), so no deploy is needed.

Status as of 2026-10-07, about 01:47 (+07) (Owner-reported; superseded by the block above):

- **Production runs `607ca6a`** (phone app shell below 1024 px: the document does not scroll, `.ls-site-scroll` is the only scroll container, the tab bar is in the normal flow), deployed by the Owner on 2026-10-07 at about 01:47 (+07). Previous: `15cd7e0`.
- No new migrations (62, `pnpm db:status` up to date). Permissions unchanged (54).
- After the deploy: health ok, `/vi`, `/vi/account/bookings` and `/vi/workforce/login` answer 200, pm2 3/3 online.
- Backup taken just before this deploy: `/root/backups/lucyspa-pre-appshell-20261006T184411Z.dump`.
- **Rollback target** if the app shell misbehaves on real phones: `15cd7e0` (no DB change).
- **Real-phone test of `607ca6a` (Owner, 2026-10-07): everything OK** — no strip under the tab bar, smooth tab switching. This closes the "waiting for the real-phone test" item. The Owner did not itemise the keyboard on the booking form, pull-to-refresh, the iOS status-bar tap or the address bar; "everything OK" is the only report, nothing was reported broken.

Status as of 2026-10-06, about 23:24 (+07) (Owner-reported; the `15cd7e0` deploy, superseded by `607ca6a`):

- **Production runs `15cd7e0`** (tab bar reaches the screen edge again with `viewport-fit=cover` restored, header glass 96 % opaque, app-coloured contact buttons with a green call button, aligned footer with the shop tagline), deployed by the Owner on 2026-10-06 at about 23:24 (+07). Previous: `cdde1cf`.
- No new migrations (62, `pnpm db:status` up to date). Permissions unchanged (54).
- After the deploy: health ok, `/vi`, `/vi/account/bookings` and `/vi/workforce/login` answer 200, pm2 3/3 online.
- Backup taken just before this deploy: `/root/backups/lucyspa-pre-ui3-20261006T162055Z.dump`.
- CLOSED 2026-10-07: the strip under the tab bar (and the possible 1-pixel strip at fractional pixel ratios) is gone on the Owner's real phone with the app shell (`607ca6a`). The other open items below (130 % text header, slider on touch) still stand.
- Next in queue: planning (no code yet) for "the technician may start early when the customer is checked in", already requested.

Status as of 2026-10-06, about 18:46 (+07) (Owner-reported; the `cdde1cf` deploy, superseded by `15cd7e0`):

- **Production runs `cdde1cf`** (tab bar stays on screen when the page is wider than the viewport: `minimum-scale=1`, `overflow-x: clip`, `viewport-fit=cover` removed, bar 72 px; hover styles only for hover-capable fine pointers), deployed by the Owner on 2026-10-06 at about 18:46 (+07). Previous: `0be4abe`.
- No new migrations (62, `pnpm db:status` up to date). Permissions unchanged (54).
- After the deploy: health ok, `/vi`, `/vi/account/bookings` and `/vi/workforce/login` answer 200, pm2 3/3 online.
- Backup taken just before this deploy: `/root/backups/lucyspa-pre-tabbar2-20261006T113920Z.dump`.
- Server: the Owner is renewing the iNET Cloud Server `cs-linux-20260916080518738` ("Duy trì") before 2026-10-16.
- Open items: at 130 % text on a 360 px screen the header tools are 23 px too wide (now clipped); the home slider pauses on touch (`mouseenter` fires on a tap). The booking page's own sticky action bar note below still stands.

Status as of 2026-10-06, about 16:18 (+07) (Owner-reported; the `0be4abe` deploy, superseded by `cdde1cf`):

- **Production runs `0be4abe`** (phone tab bar fixed flush to the bottom, safe area inside it, `viewport-fit=cover`, page reserves its height), deployed by the Owner on 2026-10-06 at about 16:18 (+07). Previous: `d0fc191`.
- No new migrations (62, `pnpm db:status` up to date). Permissions unchanged (54).
- After the deploy: health ok, `/vi`, `/vi/account/bookings` and `/vi/workforce/login` answer 200, pm2 3/3 online.
- Backup taken just before this deploy: `/root/backups/lucyspa-pre-tabbar-20261006T091708Z.dump`.
- Open item: the booking page's own bottom action bar is still sticky. Apply the same fix (fixed, safe area inside, page reserves its height) if the Owner reports a gap there.

Status as of 2026-10-06, about 13:28 (+07) (Owner-reported; the `d0fc191` deploy):

- **Production runs `d0fc191`** (single shared layout, no flash on page switch, mobile info strip wraps, "Đặt lịch mới" rules, bottom bar with a raised center "Đặt lịch ngay", contact button auto-hides while scrolling down), deployed by the Owner on 2026-10-06 at about 13:28 (+07). Previous: `9b76789`.
- No new migrations (62, `pnpm db:status` up to date). Permissions unchanged (54).
- After the deploy: health ok, `/vi`, `/vi/account/bookings` and `/vi/workforce/login` answer 200, pm2 3/3 online.
- Backup taken just before this deploy: `/root/backups/lucyspa-pre-smoothnav-20261006T061633Z.dump`.
- Owner decision: keep the contact button as built (hides while scrolling down, shows on scroll up); no edge handle, not moved into the header.
- Deploy note: the first build attempt ran from `/` instead of `/opt/lucyspa` and failed, then was rerun correctly. Every deploy block must start with `cd /opt/lucyspa`.

Status as of 2026-10-06, about 12:00 (+07) (Owner-reported; the `9b76789` deploy):

- **Production runs `9b76789f3d6679ddc30a6de38c9a604d13dab8b7`** (the header/motion package `4d28ab9` plus the floating contact button, the footer Facebook and Zalo icons and the Shop info Facebook / Zalo fields), deployed by the Owner on 2026-10-06 at about 12:00 (+07). Previous: `4bdeaca`.
- Migration applied: `20261104000000_shop_info_contact_links` (62 migrations, `pnpm db:status` up to date). Permissions unchanged (54).
- After the deploy: health ok, `/vi`, `/vi/services` and `/vi/workforce/login` answer 200, pm2 3/3 online.
- Backup taken just before this deploy: `/root/backups/lucyspa-pre-contact-20261006T045934Z.dump`.
- The Owner will enter the Facebook and Zalo links himself in Admin > Website > Thông tin tiệm (nothing was filled on production).

Status as of 2026-10-06, about 09:03 (+07) (Owner-reported; the `4bdeaca` deploy):

- **Production ran `4bdeaca7496842aef43d2310b11da5a2233ed49c`** (until `9b76789` replaced it on 2026-10-06 at about 12:00 (+07)) (customer navigation + bell panel, transparent header over the ORIGINAL home hero from `3faa95b`, flaky test fixes), deployed by the Owner on 2026-10-06 at about 09:03 (+07). Previous: `be5617d` (see the next entry; its full-bleed hero was rejected by the Owner).
- No new migration: `pnpm db:status` up to date (61 migrations).
- After the deploy: health ok, `/vi`, `/vi/account/loyalty` and `/vi/workforce/login` answer 200, pm2 3/3 online.
- Backup taken just before this deploy: `/root/backups/lucyspa-pre-header2-*.dump`.
- Prisma printed "Update available 7.10.0 -> 8.0.0" on the server and it was ignored. Never upgrade Prisma without a planned step.

Status as of 2026-10-05, about 23:29 (+07) (Owner-confirmed 2026-10-06; the `be5617d` deploy):

- **Production ran `be5617d71872311de502a9f660e07a0e296b99a0`** (customer navigation + bell panel and the first, full-bleed home hero with a transparent header), deployed by the Owner on 2026-10-05 at about 23:29 (+07). Previous: `f79572d`. It ran until `4bdeaca` replaced it on 2026-10-06 at about 09:03 (+07). The Owner then rejected its full-bleed hero (the original hero came back in `3faa95b`).
- Backup taken before this deploy: `/root/backups/lucyspa-pre-header-20261005T162721Z.dump`.

Status as of 2026-10-05, about 22:08 (+07) (Owner-reported; supersedes the blocks below):

- **Production runs `f79572d02d543b1ad8c0b644d90a70f5260987c6`** (wallet names "Điểm Lucy Spa" / "Điểm Lucy Beauty", Beauty member-discount row), deployed by the Owner on 2026-10-05 at about 22:08 (+07). Previous: `d11be14`.
- No new migration: `pnpm db:status` up to date (61 migrations).
- After the deploy: health ok, `/vi`, `/vi/account/loyalty` and `/vi/workforce/login` answer 200, pm2 3/3 online, `loyalty_go_live` = 1 (ON).
- Backup taken before this deploy: `/root/backups/lucyspa-pre-walletname-20261005T150355Z.dump`.

Status as of 2026-10-05, about 21:31 (+07) (the `d11be14` deploy):

- **Production runs `d11be146088c78b1e69858b8596fd1b121d0fe72`** (overlay z-index fix `bee3785` plus the removal of the count after section headings), deployed by the Owner on 2026-10-05 at about 21:31 (+07). Previous: `d6781fa`.
- No new migration: `pnpm db:status` up to date (61 migrations).
- After the deploy: health ok, `/vi`, `/vi/account/loyalty` and `/vi/workforce/login` answer 200, pm2 3/3 online, `loyalty_go_live` = 1 (ON).
- Backup taken before this deploy: `/root/backups/lucyspa-pre-uifix-20261005T142617Z.dump`.
- CI failed once on `bee3785` at `test:auth:integration` and passed on `d11be14`; likely a CI-only flaky test (the same step passed locally on a scratch database).

Status as of 2026-10-05, about 17:44 (+07) (the customer tier table deploy):

- **Production runs `d6781fa`** (customer tier table plus the handoff docs), deployed by the Owner on 2026-10-05 at about 17:44 (+07). Previous: `42841d6`. No new migration: `pnpm db:status` up to date (61 migrations).
- After the deploy: health ok, public pages 200, `/vi/account/loyalty` 200, pm2 3/3 online, `loyalty_go_live` = 1 (ON). CI of `d6781fa` is green (Owner checked on GitHub).
- Backup taken before this deploy: `/root/backups/lucyspa-pre-tiertable-20261005T104312Z.dump`.

Status as of 2026-10-05, about 17:20 (+07) (the Phase 5 deploy):

- **Phase 5 is deployed.** Production runs `42841d6765c763b04c00e9f512c90dea4daf9729`, deployed by the Owner on 2026-10-05 at about 17:11 (+07). Previous: `58bfabc`.
- All 61 migrations are applied, including the 16 Phase 5 migrations (`20261027000000_phase5_permission_codes` to `20261103000000_phase5_reward_catalog`). `pnpm db:status`: up to date.
- `pnpm db:permissions:sync`: 13 inserted, total 54.
- After the deploy: health ok, the 3 new APIs answer 401 without a login, public pages 200, data counts unchanged (9|4|2|2).
- Backup taken before the deploy: `/root/backups/lucyspa-pre-phase5-20261005T100713Z.dump`.
- **Loyalty go-live is ON.** The Owner switched it on around 17:20 (+07) on 2026-10-05; the exact instant is the row in the `loyalty_go_live` table (immutable, never backdated). Invoices paid before it earn nothing.
- The production database is named `lucy_spa_dev`. **Integration tests, race tests and `pnpm smoke` must never run on the server** (the scratch-name guard allows that name only with `CI=true`).

Status as of 2026-10-04 14:50 (Owner-confirmed; replaces every older "not deployed" line in this file):

- Production runs `58bfabc` (latest `main`), deployed by the Owner through the usual runbook; every deploy checks out `origin/main`.
- `pnpm db:status` on the server: up to date, so all migrations through `20261026000000_uxui_part2_footer_blocks` are applied.
- Phase 4 (POS, invoices, PayOS) is live. The PayOS checksum key was rotated on the server today and a real QR test payment was marked paid correctly. The webhook signature hotfix is deployed (it is in `main`).
- Server security today: fail2ban on, SSH password login off, server rebooted onto the new kernel, all services came back.
- Deploy only when the Owner asks. Run `pnpm db:permissions:sync` at a deployment that adds permissions.

## Known pre-existing test flakes (unrelated to Phase 4; note in one line, do not investigate)

- Two `My Income` integration assertions fail only between 15:00 and 17:00 UTC.
- Worker Step 9 notification tests (`Redis job loss…`, `real Redis delayed-job loss…`) build the visit `serviceDate` from the UTC date and fail
  when the UTC and Vietnam dates differ (roughly 17:00-24:00 UTC).
- FIXED 2026-10-07: CI of `39ad8d1` failed in `pnpm test:integration` (packages/database) with `40P01 deadlock detected`. Cause: several database test files ran in parallel and their `TRUNCATE` assertions need ACCESS EXCLUSIVE on shared tables. Test-only (reproduced on a database without migration `20261105000000`); production code and the migration are not involved. The two `node --test` runs now use `--test-concurrency=1` (guard test in `assert-test-database.test.ts`).

## Hotfix: PayOS webhook signature (post 82a0862, DEPLOYED with 58bfabc)

- Webhook now verifies the signature over `data` first; authentic non-payment deliveries (URL-confirmation probe) get 200 and apply nothing.
- Refusals log a sanitized reason (`PayOS webhook refused`: reason, signature length, field names). See `docs/PHASE4_HOTFIX_PAYOS_WEBHOOK_SIGNATURE.md`.

## UX/UI Redesign track, Step 1 (design contract)

- `docs/UXUI_REDESIGN_DESIGN.md`: admin first; brand red #782b37 + white, no gold; light/dark toggle; 14-step plan (kit, shell, dashboard, 3 screen migrations, website content Steps 11-13, final gate 14).
- Documentation only (PRD 4.1 updated); no code/API/migration. Step 1 CLOSED / OWNER APPROVED: all section 17 recommendations (Q-D1..Q-D6, Q-CM1..Q-CM13) accepted and LOCKED. Step 2 not started.
- Steps 2-10 change no API; only Steps 11-13 add schema/API (new GLOBAL permission MANAGE_WEBSITE_CONTENT, env MEDIA_STORAGE_DIR).

## UX/UI Redesign track, Step 2 (foundations, CLOSED / OWNER APPROVED)

- `packages/ui`: tokens v2 (`--ls-*`, light/dark, chart, scale), `base.css`, theme cookie `ls-theme` + pre-paint script + `useTheme`, `Icon` set; Be Vietnam Pro in the locale layout.
- Gold/ivory removed; `workforce.css`, `customer.css`, `globals.css` have no hex literals (guard tests). No API/DB/contract change.
- Tests: ui 18 pass (contrast table), web `styles.test.ts` 3 pass, typecheck/lint/build clean. Report: `docs/UXUI_REDESIGN_STEP2_FOUNDATIONS.md`.

## UX/UI Redesign track, Step 3 (core components, CLOSED / OWNER APPROVED; jsdom dev dependency approved for later Steps)

- `packages/ui`: Button family, feedback/toast, forms (Field, MoneyInput, Combobox...), Dialog/Drawer/ConfirmDialog/Menu, ImageUploader shell; `components.css` (tokens only). Solid danger button is dialogs-only (test).
- Web `ui.tsx` wrappers (Badge, Notice, Field, SubmitButton, ErrorState, Empty) now render them; `wf-*` CSS stays until Steps 8-10. No API/DB/contract change.
- Tests: ui 62 pass, web unit 191 pass, typecheck/lint clean. Report: `docs/UXUI_REDESIGN_STEP3_CORE_COMPONENTS.md`.

## UX/UI Redesign track, Step 4 (data components, CLOSED / OWNER APPROVED)

- `packages/ui`: `DataTable` (client/server, card list on phone with a "Sort by" select), `Pagination`/`CursorPagination`, `ListToolbar`, `FilterChips`, `DescriptionList`, `Tabs`, `useUrlState`; jsdom dev dependency added for interactive tests.
- Pilots: Employees (server paging, URL state) and Skills (client sort/filter/paging). No API/DB/contract change.
- Tests: ui 91 pass, web unit 191 pass, typecheck/lint clean. Report: `docs/UXUI_REDESIGN_STEP4_DATA_COMPONENTS.md`.

## UX/UI Redesign track, Step 5 (app shell, navigation, auth layout; CLOSED / OWNER APPROVED)

- `packages/ui`: `AppShell` (sidebar/rail/drawer, topbar), `SidebarNav`, `UserMenu`, `ThemeToggle`, `Breadcrumbs`, `AuthLayout` (centered card on a full-screen brand gradient + SVG botanical pattern), `shell.css`, auth-panel tokens, 13 nav icons.
- Web: `WorkforceShell` rebuilt on it; nav regrouped by task via `lib/workforce/nav-groups.ts` (visibility rules in `navigationFor` unchanged; `NavItem.group` values renamed); login and forgot-password use that auth layout (split layout replaced by the card on the brand background after Owner correction); auth card UX pass: segmented identifier control, show/hide password, forgot link in the label row, token rhythm and shadow; dead `wf-topbar/nav/body` CSS removed.
- Tests: ui 108 pass, web unit 200 pass, typecheck/lint clean. Report: `docs/UXUI_REDESIGN_STEP5_SHELL_AUTH.md`.

## UX/UI Redesign track, decision D12 (seasonal/holiday themes, DOCS ONLY)

- Owner decision 2026-09-30: preset seasonal theme layer (customer side visible, admin subtle), Owner-scheduled, one active at a time, no builder. Design: `docs/UXUI_REDESIGN_DESIGN.md` section 20 (Steps S1-S5, open questions Q-S1..Q-S11); PRD 4.1/4.4 noted.
- No code, schema or API change. Step 5 needs no rework; three small adjustments are planned inside S1 (20.9).

## UX/UI Redesign track, UX quality gate (docs + tooling; Owner rule, mandatory for every remaining UI Step)

- `docs/UXUI_REDESIGN_DESIGN.md` section 21 (checklist, procedure, review of Steps 2-5: findings F1-F14, not fixed) and a short rule in `CLAUDE.md`. Tool: `node scripts/uxui-screens.mjs <name> <url-or-html>` (360/768/1440, light/dark, audit) writing to `.local/uxui-screens/` (git-ignored).
- Owner decision pending: run a "Step 5b: UX gate fixes" Step before Step 6.

### UX/UI Step 5b (UX gate fixes) - CLOSED / OWNER APPROVED

- F1-F12, F14 fixed plus open states (overlay, drawer, user menu, filter sheet); F13 stays with Step 8.
- New auth header: display wordmark, "Đăng nhập"/"Sign in", "Dành cho nhân viên"/"For staff". Report: `docs/UXUI_REDESIGN_STEP5B_UX_FIXES.md`.
- Motion (15a7783) and gate (34b62e7) commits are pushed; the 5b changes are committed.
- Known item for Step 14: `employee-detail.test.tsx` fails when run from the repo root ("React is not defined"); it passes from `apps/web`.

### UX/UI Step 6 (sortable primitives + chart kit) - committed 2264a86, deployed

- `packages/ui`: SortableList/Grid (dnd-kit, keyboard + Move buttons), LineChart/BarChart/DonutChart/Sparkline/KpiCard/ChartFrame, DateRangePicker + ComparisonToggle; new deps dnd-kit, d3-scale, d3-shape (Q-D1).
- No API, DB, permission or screen change; the dashboard (Step 7) is the first user. 195 ui tests pass; palette validator runs in a test.
- Report: `docs/UXUI_REDESIGN_STEP6_SORTABLE_CHARTS.md` (UX gate images in `.local/uxui-screens/6-*`). Not committed.

### UX/UI Step 7 (dashboard) - CLOSED / OWNER APPROVED

- Widget dashboard on the kit: shared `Card`/`Stat` in `packages/ui`, 11 permission-gated widgets, customize mode (drag, keyboard, Move buttons, size, hide), layout in localStorage per user and device.
- Comparison loader requests exactly as many previous days as current days (`previousWindow`/`loadPreviousBoard`); requests are de-duplicated and refreshed on focus and every 5 min.
- No API, DB or permission change. 199 ui + 57 targeted web tests pass. Report: `docs/UXUI_REDESIGN_STEP7_DASHBOARD.md`. Owner accepted: branch-only scope, 12 columns from 1280 px, 200-invoice cap warning.

### UX/UI Step 7.5a (frontend rules + gate v2) - CLOSED / OWNER APPROVED

- Design contract 21.4 (FR1-FR15) and 21.5 (gate v2) written; 9.1/10.3/10.4/21.1-1 amended as the Owner approved; CLAUDE.md digest added. No UI, API or DB change.
- Tooling: scripts/uxui-page-audit.js (DOM audit, rule-tagged), scripts/uxui-audit-summary.mjs (--write/--compare), apps/web/src/test/ui-ratchet.test.ts (counters only go down).
- Baseline: 26 pages x 3 widths on scratch DB lucy_spa_uxaudit_20261001 in docs/uxui-audit-baseline.json and docs/UXUI_AUDIT_BASELINE_7_5A.md. Report: docs/UXUI_REDESIGN_STEP7_5A_RULES_GATE.md. Also a PreToolUse hook (.claude/settings.json) blocks Bash heredocs.
- Next: 7.5b (page frame); after 7.5b and 7.5d the Owner deploys and reviews before the next session.

### UX/UI Step 7.5b (page frame) - committed 5039dd0, deployed

- packages/ui: Page, PageHeader, Stack/Cluster/Grid; Card flush context (table/empty inside a card lose their border; nested Card logs in dev); RouteFade stack. Workforce shell wraps in Page; ui.tsx PageHeader/Section are kit components; workforce.css remapped to tokens (0 spacing literals).
- Nav gap/active bar on the 4 px grid; Leave table scrolls inside its card. Ratchet lowered (wf uses 720, spacing literals 0). No API/DB change.
- 207 ui + 233 web tests pass; DOM audit of Dashboard/Employees/Skills/Branches/Leave: no count rose. Report: docs/UXUI_REDESIGN_STEP7_5B_PAGE_FRAME.md. Next: Owner deploy check, then 7.5c.

### UX/UI Step 7.5c (data frame) - committed 7a51634, deployed

- packages/ui: DataTable column policy + required paging (dev guard), RowActions = single menu, FacetedFilter, MultiValue, ListSection, ListToolbar/Pagination layout, single-border table surface. Employees and Skills re-fitted (Skills edit now a row-menu dialog).
- 217 ui + 233 web tests pass; DOM audit employees 54->18, skills 142->21, no type rose. Radix not needed (spike found no gap). No API/DB change.
- Review 1 applied: columns hide by width (no page scroll 360-1920), audit script false positives only. Header not sticky on desktop. Report: docs/UXUI_REDESIGN_STEP7_5C_DATA_FRAME.md. Next: Owner review, then 7.5d (forms/overlays) + deploy check.

### UX/UI Step 7.5d (forms and overlays + hover theme) - committed 70a5c9a (with 7.5e-f), deployed

- packages/ui: FormGrid, CheckField, Disclosure, FormDialog, FormDrawer (discard guard, busy, error focus), FormSection without fieldset, FormActions Cancel then Save, field/dialog width tokens. Skills (create/edit dialog, status confirm in row menu) and Branches (DataTable + create dialog) migrated.
- Hover theme by tokens (--ls-hover-*): light = very light brand red + #782b37, dark unchanged; WCAG tests in tokens.test.ts. 232 ui + 233 web tests pass; ratchet lowered. Report: docs/UXUI_REDESIGN_STEP7_5D_FORMS_OVERLAYS.md.
- Owner chose to run 7.5d-7.5f back to back, then deploy and review once.

### UX/UI Step 7.5e (dashboard and tabs) - committed 70a5c9a, deployed

- Widget titles clamp to one line (value rows align), branch select 280 px without label, layout button "Sắp xếp bố cục" + banner card, recovery email action in the card header, notices inside cards are flush, empty paid chart = EmptyState, Organization tabs on the kit Tabs.
- 233 ui + 235 web tests pass; dashboard audit 86->15 findings. Report: docs/UXUI_REDESIGN_STEP7_5E_DASHBOARD_TABS.md.

### UX/UI Step 7.5f (closing verification) - committed 70a5c9a, deployed

- Full DOM audit 26 pages x 3 widths: 2296 -> 529 findings (docs/UXUI_AUDIT_AFTER_7_5.md, snapshot docs/uxui-audit-after-7_5.json); ratchet lowered (wf uses 698, details 20, raw tables 23). Design contract 6.3 (hover) and 18 (Steps 8-10 remap) updated.
- Report: docs/UXUI_REDESIGN_STEP7_5F_CLOSING.md. Next after the Owner check: Step 9a Services (then 8a-8c, 9b-9c, 10a-10b).
- Owner review of 7.5d-f: raw checkboxes of Roles, Service detail and Team detail now CheckField (small-target 43 -> 23, no check above baseline; audit script measures a kit .ls-check-field row); toasts to be mounted in Step 8a (success = toast, errors in place); Skills deactivate-with-reason wording approved.

### UX/UI Step 9a (Services) - committed 97c536e, deployed

- Services/Categories in `Tabs`; `DataTable` client mode (search, category + status filters, sort, 20/page), row `⋮` (Details, (De)activate with reason, Delete), create = `FormDrawer`, category create/edit = `FormDialog`; `ConfirmDeleteDialog` removed. No API change.
- Ratchet: raw tables 23 -> 21, wf uses 698 -> 664, details 20 -> 17. Web targeted tests 23/23; DOM audit services 128 -> 36 (only the known icon-only phone Filter false positive rose).
- Build for the audit needs API_UPSTREAM_ORIGIN at build time. Report: docs/UXUI_REDESIGN_STEP9A_SERVICES.md. Owner said 7.5 "chua on lam"; specific notes pending.

### UX/UI Step 8a (Skills, Roles, Teams, toasts, permission-change notice) - committed 390b355, deployed

- Toast provider in the workforce shell (success = toast, errors in place); API 401 `reason: AUTHORIZATION_CHANGED` (tested) + web passive `/auth/me` check on focus and every 3 min, wording "Quyền của bạn đã thay đổi, vui lòng đăng nhập lại". No in-session permission refresh.
- Roles = DataTable + FormDrawer with grouped permission matrix; Teams list = server DataTable; Team detail = breadcrumbs, header actions, Tabs, kit `SelectionBar` for bulk members. Kit: numeric/end alignment specificity fix, breadcrumb targets, `useOptionalToast`.
- Ratchet: raw tables 19, wf uses 604, details 12, fieldsets 17, solid danger 8. Tests: web 246, ui 235, api targeted + 2 integration files on the scratch DB. Report: docs/UXUI_REDESIGN_STEP8A_PEOPLE.md.
- Owner approved 8a: bulk member actions via SelectionBar = approved exception to contract 10.4; CSRF guard answers 401 (+ AUTHORIZATION_CHANGED reason) for an ended signed-in session before checking CSRF (wrong CSRF on a valid session stays 403).

### UX/UI Step 8b (Employees: detail, lifecycle, roles, skills, create) - committed 3459413, deployed

- Employee detail = breadcrumbs, `⋮` menu + primary Edit profile, 4 Tabs (profile + account, employment history, roles and branches, skills); promote/end/password/profile = FormDialog, disable/re-enable sign-in and removals = ConfirmDialog; all `<details>` forms gone. Create = own page `/employees/new` (toast + member page after success).
- Kit: `ListSection actions`, `.ls-field` no longer stretches controls in a grid row, `RadioGroup` row-wide targets. Ratchet: raw tables 18, wf uses 483, details 7, fieldsets 11, checkboxes 9.
- Tests: web 246, ui 236. DOM audit employee-detail 238 -> 13. Report: docs/UXUI_REDESIGN_STEP8B_EMPLOYEES.md. Next: 8c (Organization).

### UX/UI Step 8c (Organization: regions, areas, branch placement, appointments) - committed a9887ba, deployed

- Page = header action per tab + one Notice + 4 Tabs (`?tab=`), each a client DataTable (20/page, sort, `⋮`) with ListToolbar (search + 1 filter); all forms are FormDialog (create/rename/edit/placement/appoint with employee Combobox), activate/deactivate and end appointment are ConfirmDialog with required reason; `<details>`, inline row editing and `window.prompt` removed. No API/DB/permission change.
- Ratchet: raw tables 14, wf uses 439, details 4, checkboxes 8, solid danger 6. Tests: new organization-list + screen tests, 25/25 targeted. DOM audit organization 67 -> 40 (rest = kit polish, plan section 11). Report: docs/UXUI_REDESIGN_STEP8C_ORGANIZATION.md. Next: 9b (Service detail, Branches detail, Discounts).

### UX/UI Step 9b (Service detail, Branch detail, Discounts list/detail/create) - committed 1377faf, deployed

- Service/Branch/Discount details = breadcrumbs, `⋮` menu + primary action, read-only `DescriptionList` cards or Tabs; edits are FormDrawer/FormDialog, status/terminate are ConfirmDialog with required reason. Discounts list = client DataTable + toolbar (URL state); create = own page `/discounts/new`, new version = own page `/discounts/[id]/versions/new` (Owner approved 9b). No API/DB/permission change.
- Ratchet: raw tables 10, wf uses 397, fieldsets 7, checkboxes 4. Tests: 46 targeted green. DOM audit service-detail 135 -> 14, branch-detail 89 -> 14, discount-detail 78 -> 14, discounts 56 -> 36. Report: docs/UXUI_REDESIGN_STEP9B_DETAILS_DISCOUNTS.md. Next: 9c (POS, invoice, payments).

### UX/UI Step 9c (POS board, invoice, payments) - committed 042a99b, deployed

- UI only. Board = toolbar + two DataTables; invoice = breadcrumbs, header `⋮` cancel + primary Finalize, cards (lines+totals, discount, promo codes, payer, payments, PayOS wait, anomalies, notes); every form is a FormDialog, reversal/cancel are ConfirmDialog with reason, re-auth unchanged. `DescriptionList layout="totals"` added. No API/DB/permission change; behavior differences listed in the report.
- Ratchet: raw tables 6, wf uses 334. Tests 39 web + 21 ui green. Scratch-DB money flow 29/29 (open, price, promo, finalize, cash, PayOS QR via simulator, PAID, reversal, cancel). Report: docs/UXUI_REDESIGN_STEP9C_POS_INVOICES.md. Next: Kit polish (plan section 11, incl. neutral password-dialog wording), then 10a.

### UX/UI Kit polish (plan section 11) - committed d1f5aae, deployed

- Kit only: Badge 4/8 padding, Notice 1 px border + card radius, phone card title 2-line clamp with reserved height + `minmax(0,1fr)` tracks (overflow 98 -> 2), `ReauthDialog` on `FormDialog` with neutral text (VI/EN). Audit script: hidden-text and docked-chrome false positives fixed.
- Ratchet wf 325, css literals 6. Tests ui 238 + web targeted 8 green. DOM audit: no type rose, off-grid 1202 -> 24. Report: docs/UXUI_REDESIGN_KIT_POLISH.md. Next: 10a.

### UX/UI Step 10a (Booking board, walk-in, reassignment) - committed c65e48b, deployed

- UI only. Board = toolbar + DataTables (bookings, open-visit lines, pool) + equal-height queue cards; check-in is a row button (short confirm; no undo in the API), other decisions in the row `⋮`; walk-in = form page + member-lookup dialog; reassignment = toolbar + DataTable + dialog. Tablet fit measured (0 px over at 768/1024/1280). Real flows on scratch DB (bookings via API): arrive, late arrival, priority, KTV start/end, forgotten END, change staff, no-show all PASS.
- Ratchet wf 237, raw tables 5, fieldsets 5, checkboxes 2, solid danger 3. Web 275 + ui 238 green. DOM audit board 123 -> 6, walk-in 62 -> 2, reassignment 58 -> 2 (phone card row-height-uneven +2, Owner-approved exception). Report: docs/UXUI_REDESIGN_STEP10A_BOOKING_WALKIN_REASSIGN.md. Next: 10b.

### UX/UI Step 10b (My services, schedule, attendance, leave, account, income, notifications) - committed c283f90, deployed

- UI only. Cards for My services; DataTables + toolbars for schedule, attendance, leave, notifications; every create/edit/decision is a dialog or drawer, destructive ones a `ConfirmDialog`; leave tablet overflow fixed. `workforce.css` deleted: the rules the member area still uses moved unchanged into `customer.css` (Part 2 removes them).
- Ratchet: raw tables 0, details 0, wf uses 80, fieldsets 4, checkboxes 1, solid danger 1 (all member area). Web 275 + ui 11 css tests green. Scratch-DB flows 65/65 (leave, attendance check-in/out, profile, collaborator schedule, KTV Start/End/Add service). Report: docs/UXUI_REDESIGN_STEP10B_PERSONAL_PAGES.md.
- Open for the Owner: "Nhận khách" icon-only below 1280 px (check on the counter machine). Cards, phone exception and merged filter approved. Next: 11 (website content).

### UX/UI Step 11 (website media library) - committed c2656ef, deployed

- First Step with API + DB since the redesign started: 2 additive migrations (`MANAGE_WEBSITE_CONTENT` GLOBAL_ONLY, `media_assets` + `media_variants`), `sharp`, `MediaStorage` (local disk), upload/list/alt/delete/serve API with audit, library page `/website` (grid, upload queue, drawer, delete). **Deploy needs**: env `MEDIA_STORAGE_DIR` (required in production, outside the release folder, in backups), `db:deploy`, `db:permissions:sync`.
- Public serving and "used in" arrive with Steps 12/13. CLAUDE.md now requires `pnpm test` (whole repo) before every push. Report: docs/UXUI_REDESIGN_STEP11_MEDIA_LIBRARY.md. Next: 12 (popup).

### UX/UI Step 12 (promotional popup) - committed 2526a51, deployed

- 1 additive migration (`website_popups`), no new permission or env. Admin API (`/api/v1/website/popups`, audit, versions), one enabled popup per instant (advisory lock, `POPUP_OVERLAP` names the other popup), image needs Vietnamese alt, media delete now refused while a popup uses the image. Public anonymous `GET /api/v1/public/website/popup` and `/api/v1/public/media/:id/:variant` (only live-popup images).
- Web: `/website` tabs Media | Popup, popup list + schedule strip, form pages `/website/popups/new|:id` with live preview, `MediaPicker`; public home page shows the popup once per session. Kit: `PromoCard/PromoDialog/PromoPreview/ScheduleStrip`. Quality gate (screenshots, DOM audit, browser flow) deferred to Step 14 by Owner decision. Report: docs/UXUI_REDESIGN_STEP12_POPUP.md. Next: 13 (slider).

### UX/UI Step 13 (homepage slider) - committed bf8bf81, pushed, DEPLOYED to production (Owner-confirmed 2026-10-02; runbook docs/DEPLOY_STEP13_RUNBOOK.md)

- 1 additive migration (`website_slides`), no new permission or env. Admin API (`/api/v1/website/slides`, audit, versions, `POST reorder` in one transaction, max 8 visible at once: `SLIDE_LIMIT`), media delete/alt rules and public image serving now include slides; public `GET /api/v1/public/website/slides`.
- Web: `/website?tab=slider` (sortable list, status, schedule, row menu, add/edit drawer); public home page shows the slider (autoplay 6 s, pause on hover/focus/touch + Pause button, none under reduced motion). Kit: `Slider`, `MediaRow`. Quality gate (screenshots, DOM audit, browser flow) deferred to Step 14 by Owner decision.
- Whole-repo `pnpm test`, lint, format, typecheck green; scratch-DB integration green. Report: docs/UXUI_REDESIGN_STEP13_SLIDER.md. Next: S1-S5 (seasonal), then 14 (final gate).

### UX/UI workforce shell feedback (b568c5b..684b9ee) - committed, pushed, DEPLOYED to production (Owner-confirmed 2026-10-02)

- Solid brand sidebar hover/current page, theme Auto by time (replaces System), collapsible sidebar groups, solid brand hover tokens everywhere, charts re-measure after the table view, theme survives a locale switch. HEAD 684b9ee. Next: S1-S5 (design 20.8), Step 14 final gate, then Part 2 (customer pages, own contract).

### UX/UI Step S1 (season registry, tokens, admin accent line) - implemented 2026-10-02 on f219980

- Owner decisions Q-S1..Q-S11 locked in design 20.10 (scoped yellow exception: Tet and Mid-Autumn ornaments only). Contracts `season-registry.ts` (8 presets, approved greetings and windows); ui `season-css.ts` generates `season.css` (`pnpm season:css`), neutral `--ls-season-*` defaults, topbar accent line (transparent by default); root layout imports `season.css`, inert until S5.
- No API, DB, permission or migration change. Tests: new `season.test.ts` (contrast presets x themes, hue rules, freshness); ui 286/286, lint, format, whole-repo `pnpm test` green. DOM audit dashboard 86 -> 10, login 11 -> 10.
- Report: docs/UXUI_REDESIGN_S1_SEASON_REGISTRY.md. S1 committed 796cdf1, CI green.

### UX/UI Step S2 (season decoration kit) - implemented 2026-10-02 on 796cdf1

- Kit in `packages/ui`: 8 inline-SVG ornaments, `SeasonFrame`/`GreetingStrip`, `SeasonParticles` (max 24, 12 on phones, only in the band gutters, none under reduced motion or `ls-fx=off`, paused in a hidden tab), `SeasonFxToggle`, `season-decor.css`. Registry gains `particle` per preset; S1 ornament colors re-chosen (3:1 on the frame, yellow only Tet and Mid-Autumn). Inert until S5.
- No API, DB, permission or migration change. New jsdom, css, fx-core and registry tests; whole-repo `pnpm test`, lint, format green. DOM audit dashboard 86 -> 10, login 11 -> 10. Specimens (Owner review of the art): `.local/season-s2-specimens/`.
- Art revision after Owner review: Christmas tree/star/baubles/bell, Mid-Autumn star lantern + moon, 30/4 and 2/9 red banner + solid yellow star + fireworks; yellow exception now covers those four presets (ornaments only). Report: docs/UXUI_REDESIGN_S2_DECORATION_KIT.md. Next: S3 (`website_seasons` migration and API).

### UX/UI Step S3 (seasons table, admin API, public endpoint, holiday links) - implemented 2026-10-02 on 679b568

- Migration `20261021000000_uxui_s3_website_seasons`: `website_seasons` + nullable `season_id` on popups and slides (RESTRICT). API `/api/v1/website/seasons` (MANAGE_WEBSITE_CONTENT, GLOBAL): CRUD, enable, delete rule A (items unlinked and hidden), `SEASON_OVERLAP`, audit; public `GET /api/v1/public/website/season?locale=` (60 s, 204 when none). No new permission or env.
- Linked popups/slides store the season window, follow its switch (public, overlap, 8-slide limit, image serving) and are re-checked on every season save. Lock order: season lock, popup/slide lock, rows. Report: docs/UXUI_REDESIGN_S3_SEASONS_API.md. Next: S4 (admin Seasons tab), S5 (wiring).

### UX/UI Step S4 (admin Seasons tab) - implemented 2026-10-02 on 498aa98

- Website tab "Mùa lễ" (?tab=season): DataTable + schedule strip + status/year filters; form pages /website/seasons/new and /:id (theme picker, inclusive last day in Vietnam time, suggested days for solar holidays, greeting VI/EN, switches, preview, holiday content). Kit: SeasonPreview (desktop/phone x light/dark via data-preview-theme scope in tokens.css + forced rules in season.css), SeasonPresetPicker, season-preview.css.
- Popup form and slide drawer got a Follow-a-season select (dates disabled, seasonId always sent). Web only, no API change. Report: docs/UXUI_REDESIGN_S4_SEASONS_TAB.md. Next: S5 (wiring).

### UX/UI Step S5 (season wiring) - implemented 2026-10-02 on 5375b0a

- Root layout reads the public season (server, 60 s cache, 1.5 s timeout, fail closed) and sets html data-season and data-season-admin (cookie ls-season-admin for the per-device hide). Customer public shell and member area get SeasonBand (frame, greeting, particles, Turn off effects); dashboard gets the admin greeting chip with Hide/Show. Web only, no API change; mobile reads the same endpoint plus the shared registry and bundles its own ornaments.
- Report: docs/UXUI_REDESIGN_S5_WIRING.md. S1-S5 complete; deploy runbook: docs/DEPLOY_S1_S5_RUNBOOK.md. Next: Step 14 final gate, Part 2.

### UX/UI Step S6a (season art engine) - implemented 2026-10-02 on 8322941

- Site-wide season art: slots (header row, logo accent, corners, dividers, strip, footer scene, tint) and particles behind content with a text keep-out mask; Tet (computed lunar year, goat art for 2027 only) and Christmas kits. Registry gained art palettes; lunar-year.ts in contracts.
- Screenshot gate fails hard (exit 3) on errors; CLAUDE.md: open every screenshot. Report: docs/UXUI_REDESIGN_S6A_ENGINE.md. Next: S6b (migration, admin Decoration section, custom events, Celebration kit).

### UX/UI Step S6b+S6c (decoration options, custom events, Celebration kit, full-page preview) - implemented 2026-10-02 on 7ac7476

- Migration 20261022000000 (9 season columns + website_season_slot_media); API: per-slot switches, density, greeting switches, image per slot (media usage kind SEASON, public serving while live); public season payload gained slots/density/media.
- Admin form: Event name first, base kit, computed Tet year name, Decoration section; full-page preview route /:locale/season-preview (session-guarded 404, SAMEORIGIN, postMessage draft). Celebration kit (balloons, confetti, ribbons, cake).
- Report: docs/UXUI_REDESIGN_S6B_DECORATION.md. Next: S6d (Valentine, 8/3, 20/10 kits), S6e (Mid-Autumn, Vu Lan, 30/4-1/5, 2/9).

### UX/UI Step S6d (Valentine, 8/3, 20/10 kits + shared kit engine) - implemented 2026-10-03 on d3ac883

- `season-kits.tsx` table (rail, corner, logo, divider, one-SVG footer scene cropped to its centre, particle glyph) shared by all new kits; Valentine (roses, chocolates, love letters, cupid), 8/3 and 20/10 (bouquets, ao dai, non la, gift boxes; orchid/tulip and lotus variants). Plaque lines avoid circumflex+tone (Georgia on Windows).
- Web UI only, no migration. Report: docs/UXUI_REDESIGN_S6D_KITS.md. Next: S6e (Mid-Autumn, 30/4-1/5, 2/9, Vu Lan).

### UX/UI Step S6e (Mid-Autumn, 30/4-1/5, 2/9, Vu Lan kits) - implemented 2026-10-03 on S6d

- Mid-Autumn (lanterns, moon with banyan, Chi Hang and Chu Cuoi, jade rabbit, mooncakes, lion dance), 30/4-1/5 and 2/9 (flag bunting, fireworks, doves, lotus), new kit `vu-lan` (lotus lanterns on water, rose on shirt, lotus; particles off by default via `particlesDefault`). All ten kits now have site art: the S5 band is removed.
- No migration (kit = registry entry). Report: docs/UXUI_REDESIGN_S6E_KITS.md. Production deploy of S6a-S6e: docs/DEPLOY_S6_RUNBOOK.md. Next: Step 14 final gate, Part 2.

### UX/UI Step S6f (Vietnamese display font, full phone footer) - implemented 2026-10-03 on 9a2bfed

- Display font is self-hosted Playfair Display (normal + italic, latin + vietnamese) instead of Georgia; 8/3 plaque line restored to "Chúc mừng Quốc tế Phụ nữ 8/3"; the circumflex+tone guard test is replaced by font and mark-rendering tests.
- Phone footer shows every motif: panorama kits draw a centre row plus two side crops (per-kit `split` in `KIT_ART`), Tet gets a shelf row, Christmas a tree/gifts/snowman/Santa row, Celebration its gift piles; tablets (761-1023 px) get the same full footers at tablet sizes. Report: docs/UXUI_REDESIGN_S6F_PHONE_FONT.md.
- Mid-Autumn lion dance redrawn (`season-art-lion.tsx`: horn, mirror, eyes, beard, scaled cloth, four human legs) with Ong Dia and cymbals; Valentine lost Cupid (teddy bears hugging a heart, heart with an arrow; `wing` color removed, `pnpm season:css` rerun).

### UX/UI Step 14 (Part 1 final gate) - run 2026-10-03 on 219d33e

- Full gate green on the real app + scratch DBs: pnpm check, integration 70+5 and 478, smoke, DOM audit and axe on 52 pages x 360/768/1440 x light/dark (axe 0), Step 12/13 browser flow, S3/Step 12/13 lock races (website.race.integration.test.ts, mutation-checked).
- Fixed: API keep-alive (proxy ECONNRESET), slide rows/date inputs/card titles/breadcrumbs at 360 px, axe heading/radiogroup/landmark findings, kit spacing literals to tokens. Report: docs/UXUI_REDESIGN_STEP14_FINAL_GATE.md (with the deploy checklist).
- Left for Part 2 (customer area): ratchet wfClassUses 80, nativeFieldsets 4, nativeCheckboxes 1, solidDangerButtons 1.

### UX/UI Part 2 contract and plan (customer area + public site) - approved 2026-10-03

- docs/UXUI_REDESIGN_PART2_DESIGN.md (contract) + _PLAN.md (steps P2-1..P2-10) + mockups in docs/mockups/part2 (home, booking; real tokens, light/dark, 360/1440 reviewed).
- Decisions: one site chrome for public + member, 4-step booking on unchanged API, new public site/services endpoints + website_shop_info (Owner-editable), Owner seed data, motion tokens scoped to .ls-site, all four Part 2 ratchet counters to 0.
- Owner answered Q-P2-1..11 on 2026-10-03 (contract section 10): no guest booking, no "why choose us" section, SEO now; P2-1..P2-10 implementation follows.

### UX/UI Part 2 Step P2-1 (foundations) - 2026-10-03

- Tokens (3xl, display, customer motion), Playfair 500/600, kit site frame (SiteHeader/Nav/TabBar/Footer/Band/PublicPage/PriceList/Steps/ChoiceCard/Reveal/ThemeCycle, site.css), siteNav registry, shared chrome + interim home hero; legacy welcome/site-header CSS deleted. Report: docs/UXUI_REDESIGN_PART2_P2-1_FOUNDATIONS.md.
- Audit script knows the public frame (display tokens, hero actions, ls-site-main). Ratchet gained siteCssSpacingLiterals 0. No migration, no permission change.

### UX/UI Part 2 Step P2-2 (shop info + public endpoints) - 2026-10-03

- Migration 20261023000000 website_shop_info (one row, Owner seed); admin GET/POST /website/shop-info; public GET /public/site, /public/services, /public/services/:code (60 s cache, no internal duration). Report: docs/UXUI_REDESIGN_PART2_P2-2_BACKEND.md.
- No new permission. Deploy: db:deploy (additive). Hero image is a media use (SHOP_INFO).

### UX/UI Part 2 Step P2-3 (admin Shop info tab) - 2026-10-03

- Website page gets a Shop info tab (tagline VI/EN, address, hotline, https map link, home image, hours branch, preview); lib/hours.ts shared with the public site. Report: docs/UXUI_REDESIGN_PART2_P2-3_SHOP_INFO_TAB.md. No migration, no permission change.

### UX/UI Part 2 Step P2-4 (public home + services pages) - 2026-10-03, STOP for Owner review

- Home from live data (tagline, facts, catalogue group cards, visit, footer contact), /services list + detail (real 404s), hero = slide / chosen picture / brand panel, no why-choose-us. Report: docs/UXUI_REDESIGN_PART2_P2-4_HOME.md.
- Fixed on the way: ended season stayed on the site (Next fetch cache never stores 204; now 60 s ttl-memo), slider box stretched by portrait images, class clash .ls-facts. P2-5 folded into P2-7/P2-9.

### UX/UI Part 2 handoff note - 2026-10-03

- docs/PART2_HANDOFF.md holds the state (P2-1..P2-4 done, CI green at 5ec3cdb), Owner decisions, lessons (run pnpm lint and pnpm smoke before pushing; the Owner checks CI), tooling and the next steps (Owner reviews the home, then P2-6).

### UX/UI Part 2 Step P2-6 (member auth + account control) - 2026-10-03

- Auth pages as one centered card in the shared site frame (SegmentedControl, show/hide password, next kept); header account menu (signed out/in) + bell; member area moved onto the shared frame with a SiteSubNav row; customer.css shell/login rules removed, wfClassUses 80 -> 65.
- Report: docs/UXUI_REDESIGN_PART2_P2-6_MEMBER_AUTH.md. No migration, no permission, no API change.

### UX/UI Part 2 Step P2-7 (booking in four steps) - 2026-10-03

- Booking page: 4 steps (services, guests, staff and time, confirm), ChoiceCard rows grouped by category, sticky summary (desktop) / action bar (phone), ?service=CODE preselect, per-nail note and total with "+ giá theo ngón"; branch asked only with more than one branch. nativeFieldsets 0, nativeCheckboxes 0.
- Report: docs/UXUI_REDESIGN_PART2_P2-7_BOOKING.md. API and booking rules unchanged; no migration.

### UX/UI Part 2 Step P2-8 (member area on the kit) - 2026-10-03

- Overview, bookings and invoices as DataTable + Pagination (cursor "Xem thêm" for invoices), detail pages as Cards, cancel via ConfirmDialog (danger, reason); customer.css, wf-app, cu-* deleted. Ratchet wfClassUses, nativeFieldsets, nativeCheckboxes, solidDangerButtons all 0.
- Report: docs/UXUI_REDESIGN_PART2_P2-8_MEMBER_AREA.md. No API change, no migration.

### UX/UI Part 2 Step P2-9 (motion pass + search-engine data) - 2026-10-03

- Motion M1-M7 on tokens (hero settle/zoom/parallax in @supports, route fade on public + account, booking micro-motion, MotionGate for data saver/low memory). SEO for home, services list and service pages only: metadata, canonical + hreflang, Open Graph, /sitemap.xml, /robots.txt, LocalBusiness JSON-LD; origin from the request host, no new env var; account/auth/staff stay noindex.
- Report: docs/UXUI_REDESIGN_PART2_P2-9_MOTION_SEO.md. No API change, no migration.

### UX/UI Part 2 header review note (Owner, 2026-10-03) - follow-up to P2-6

- Header per the Lovable reference: logo, menu Trang chủ / Dịch vụ / Lịch hẹn / Hóa đơn (the last two for signed-in members only, via the nav registry and a shared SiteSessionProvider), then VI/EN, a sun/moon toggle (clock state dropped), account (and bell) and the single Đặt lịch ngay button; no separate Đặt lịch item; phone tab bar = Trang chủ, Dịch vụ, Đặt lịch ngay (+ Lịch hẹn, Hóa đơn for members). No cosmetics entry until its phase.

### UX/UI Part 2 Step P2-10 (final gate) - 2026-10-03, STOP for Owner review

- Integration 76/76 and 486/486, axe 0 on every Part 2 page, DOM audit clean except known phone-card FR8, CLS 0 everywhere, LCP <= 2.5 s on public pages and sign-in (member pages 3.7-5.5 s on the harsh profile: client-rendered). Fixed on the way: footer/divider shifts, sign-in server rendered, unread badge instead of bell.
- Report: docs/UXUI_REDESIGN_PART2_P2-10_FINAL_GATE.md. Deploy checklist: docs/DEPLOY_PART2_RUNBOOK.md (additive migrations, no permission, no new env var).

### UX/UI Part 2 follow-up: navigation motion + 360 px findings - 2026-10-03

- Public site: prefetched menu/CTA links, sliding menu pill (`site-nav.tsx`, `--ls-dur-slide`), route entrance on navigation only (`RouteEnter`), softer section reveals; all off under reduced motion. Member sign-in untouched.
- 360 px: last phone card layout fixed in the kit, `ls-cards-one-line` on member lists, tab bar hides under an open dialog (it blocked the cancel buttons while a season was active), audit exceptions for text fields and the docked form bar. Report: docs/UXUI_REDESIGN_PART2_NAV_MOTION.md.

### UX/UI Part 2 follow-up: editable home introduction - 2026-10-04

- Admin > Website > Shop info has two optional fields (VI, EN, max 200 characters) for the sentence under the home headline; empty = the built-in sentence (smoke still sees it). `intro` added to `/public/site`.
- **One additive migration on deploy:** `20261024000000_uxui_part2_hero_intro` (2 nullable columns + CHECK). Run `db:deploy` before restarting API and web. Report: docs/UXUI_REDESIGN_PART2_HERO_INTRO.md.

### UX/UI Part 2 follow-up: Owner review of the live site - 2026-10-04

- Header hover fixed (solid fill on the pill), three-state theme button (Light/Dark/Auto), tooltips below, serif logo and three-column footer, "Ghé thăm" removed, clickable cards share one hover/press motion. Home bands alternate warm/white like the reference.
- Admin > Website > Shop info edits: facts strip (show/hide, built-ins hide, custom lines VI/EN + icon, order), featured groups (choice, order, VI/EN description) and the optional "Vì sao chọn" section (off and empty by default; supersedes Q-P2-3).
- **One additive migration on deploy:** `20261025000000_uxui_part2_facts_groups` (7 defaulted columns + CHECK on `website_shop_info`). Run `db:deploy` before restarting API and web. Report: docs/UXUI_REDESIGN_PART2_OWNER_REVIEW_2.md.
- Round 3: section headings left-aligned, group and why-us cards equal-sized per row (names clamp to 2 lines), facts strip one row (scrolls on phones), one hover/press style for all public buttons. No migration change. Nothing is seeded on production (sample texts live only in tests and the scratch script).

### UX/UI Part 2 follow-up: one type scale, equal cards, real menu - 2026-10-04

- One public/member type scale in tokens.css (`--ls-type-*`: hero 48, page 36, section 30, sub 24, card 18, body 15, small 13; Playfair 500), stepped rhythm tokens, container 73 rem; member and booking titles moved off the staff sans; the DOM audit allows this scale. Cards of a row are one size with shared rows (subgrid). Report: docs/UXUI_REDESIGN_PART2_TYPE_SCALE.md.
- Scratch catalog hidden (it was invented). Real menu: docs/CATALOG_EXPORT_FOR_REVIEW.md (read-only export on the server), then `.local/p3-import-catalog.mjs`. No migration change. Open: weight 400 for titles is the Owner's call.
- Owner decision 2026-10-04: public/member titles are Playfair **400** (`--ls-weight-title`, replaces 500/600 of Q-P2-5). The catalog export now also carries branch code and name (docs/CATALOG_EXPORT_FOR_REVIEW.md, five single-command steps).

### UX/UI Part 2 follow-up: four fixes found on the real menu - 2026-10-04

- The Owner's production export (1 branch, 4 groups, 23 services) was imported into the scratch DB only and the public and member pages were re-audited on it: 78 renders, 0 findings, 0 axe. Fixes (CSS and tests in `packages/ui` only, no migration): four home groups form a 2 x 2 block; per-nail booking rows put the price under the name on phones (it squeezed the name to 23 px, FR11); breadcrumb links are at least as wide as tall; the section count uses the sans face.
- Scratch-only data (git-ignored `.local/`): the importer now gives each service the one skill most staff at an active branch hold (before, no start time existed); real-service customers `*.real@example.com`; scratch registration needs `API_PORT=3101 node .local/uxui-audit/start-api-keys.mjs`. Report: docs/UXUI_REDESIGN_PART2_TYPE_SCALE.md.

### UX/UI Part 2 follow-up: footer block area - 2026-10-04

- The footer brand column under the logo is a block area managed in Admin > Website > Shop info (add, edit, delete, reorder, show/hide; 12 at most): social icons, app badges (official Google Play and App Store files, unmodified, `apps/web/public/badges`), text, link list, image, slogan. **Default none, nothing seeded: the footer is the logo alone, so the tagline leaves the footer until a Slogan block is added.**
- **One additive migration on deploy:** `20261026000000_uxui_part2_footer_blocks` (`footer_blocks` JSONB default `[]` + CHECK). A server at `d59d02c` also has `20261024` and `20261025` pending; the Part 2 runbook lists only up to `20261023`. Check `/badges/*` answer 200 after deploy.
- Image blocks are counted by the media library's usage list and delete protection, and served publicly only while visible. Report: docs/UXUI_REDESIGN_PART2_FOOTER_BLOCKS.md.

### UX/UI follow-up: staff area motion, scrolling overlays, Back button - 2026-10-04

- Staff area uses the public motion system: prefetched links (`PrefetchLink`), sliding sidebar highlight (`useSlidingPill`), eased group open/close, page rise on navigation only, `LoadingState` skeletons, smooth button/row/tile hover (locked hover colours untouched). Off for reduced motion, data saver, low memory. Staff data stays fresh (no-store reads, no staleTimes, bfcache reload).
- Dialogs, drawers and sheets: header and footer fixed, body scrolls at any height (backdrop row is the viewport; `dvh`). Back button (`PageBack`, `lib/navigation/back.ts`) on every page except the staff dashboard and public home. No migration. Report: docs/UXUI_REDESIGN_STAFF_MOTION.md.

### UX/UI follow-up: Back on public services pages, header CTA - 2026-10-04

- `PageBack` now also on /services and every service detail (`PublicPage` takes a `back` slot; the list returns to the home, a detail to the list). Header "Đặt lịch ngay" is the same on every page: the old `startsWith(/account/book)` test also hid it on /account/bookings. No migration.
- P5-7 (`docs/PHASE5_STEP7_COMBO_SALE.md`) built, **not deployed**: migrations `20261101000000`, `20261101000001`; combo definitions (tab Combo, `MANAGE_COMBOS`), counter sale on a visit-less `COMBO_SALE` invoice (OQ-1), combo issued by the loyalty worker only when PAID, one row per session, revoked if the paid episode ends before any use. Owner answers 2026-10-05 via the question tool, **APPROVED by the Owner in own words 2026-10-05** (design 2.5): no sale while go-live is OFF; unused combo revoked on reversal/cancel; promotions and vouchers apply to a combo as best offer only (no stacking); birthday gift does not; buying a combo is not a visit for the referral reward; one combo per invoice, `COMBO_CHANGED` and frozen issued combos approved.
- P5-8 (`docs/PHASE5_STEP8_COMBO_USAGE.md`) built, **not deployed**: migration `20261102000000`; lookup by the owner's phone (masked name), use chosen on a draft line (0đ, quantity 1, exempt from the price range only through its marker), session taken at finalization (PAID first), history tab, manager restore (`RESTORE_COMBO_SESSIONS`), frozen combos list, re-pay reopens the same combo. **P5-8 APPROVED by the Owner in own words, 2026-10-05** (design 2.5; OQ-9 answered): PAID sessions first and BONUS last; reversal after use allowed (used kept, unused frozen, Owner told through Exceptions); any branch; one session = one 0đ line, quantity 1, exempt from the price range; re-pay reopens the same frozen combo; restoring returns only the session (invoice and money untouched, no money-correction step); tour counting for PAID sessions is Phase 7. CI of 9392710 was green (run 185).
- P5-9 (`docs/PHASE5_STEP9_REWARD_CATALOG.md`) built, **not deployed**: migration `20261103000000`; catalog tab (`MANAGE_REWARD_CATALOG`, ships empty) and "Cấp quà tặng" tab (`ISSUE_REWARDS`: grant with reason, mark used, revoke with reason, history; manager restore of a mistaken use), needs go-live ON, separate from points. **P5-9 APPROVED by the Owner in own words, 2026-10-05** (design 2.5; OQ-10 answered): free service marked by hand (no 0đ line), expiry per item (none or N days), manager restore with `MANAGE_REWARD_CATALOG`, `ISSUE_REWARDS` unchanged (Owner grants it to managers only after deploy), no OTHER kind, catalog editable while OFF but grant/use/revoke need go-live ON.
- P5-10 (`docs/PHASE5_STEP10_CUSTOMER_PAGE.md`) built, **not deployed**, no migration: customer page `/account/loyalty` + `GET /api/v1/me/loyalty*`, read only, masked names, no notification. **P5-10 APPROVED by the Owner in own words, 2026-10-05** (design 2.5; OQ-11 answered): OFF = notice only, generic label "Điều chỉnh bởi Lucy Spa", member discount % on the Spa card only, birthday status and admin "view as customer" / per-customer birthday status deferred.
- P5-10b (`docs/PHASE5_STEP10B_ADMIN_COMBOS_GIFTS.md`) built, **not deployed**, no migration, no new permission: "Combo đã bán" tab (`RESTORE_COMBO_SESSIONS` or `MANAGE_COMBOS`; every state incl. frozen and revoked with date and cause, status filter, totals of usable sessions, 20 per page) and the staff profile now lists the customer's combos and gifts (`VIEW_LOYALTY` at the branch). **P5-10b APPROVED by the Owner in own words, 2026-10-05** (design 2.5): unused prepaid money value in "Combo đã bán" for the Owner only (`ACTIVATE_LOYALTY` check; paid after discount ÷ purchased sessions × purchased sessions left, bonus 0đ, a total at the top, frozen and revoked shown apart), a frozen-sessions top card, `VIEW_LOYALTY` staff may see a customer's combos and gifts, the four self-made choices. **Owner approved the money-value choices in own words, 2026-10-05** (design 2.5): amount paid = combo-sale invoice total (tips excluded: none exist before Phase 7), rounded once per combo, expired combos in no total, no money on the staff customer profile, frozen and revoked in one card. Rounding confirmed by the Owner (2026-10-05): the unused combo value stays round half up to 1 VND, no change.
- P5-11 (`docs/PHASE5_STEP11_FINAL_CHECK.md`): **Phase 5 is COMPLETE; deployed 2026-10-05 (see Production).** Built: the money value and frozen card above, the 360 px fix of "Lịch sử điểm" (`ls-cards-one-line`), six Phase 5 integration suites added to the CI entry (they were never run by CI), a millisecond flake fixed in `discount.integration`. Checked on brand-new scratch databases from zero (61 migrations): `pnpm check`, all integration and race suites, smoke, and one end-to-end run (69/69). Deploy guide for the Owner: `docs/PHASE5_DEPLOY_CHECKLIST.md` (16 migrations, 13 new permissions, rollback). Found: rolling back to `58bfabc` after the permission sync needs the 13 new permission rows deleted first (in the guide).
- Deployment of Phase 5 reported by the Owner and recorded in the Production section (commit `42841d6`, 16 migrations, 54 permissions, go-live ON about 17:20 +07 on 2026-10-05). Follow-up after the deploy: a read-only tier table (from the contract tier table v1) on the customer page `/account/loyalty`, commit `d6781fa`, deployed 2026-10-05 about 17:44 (+07).

### Fix: menus behind the sticky table header - 2026-10-05

- Cause: the top bar (sticky, z 10) is one stacking context holding the account menu, tied with the sticky table header (z 10), which came later and won. New `--ls-z-chrome: 20` for top bar, site header, sidebar, bottom bars; scale now sticky 10 < chrome 20 < popover 30 < drawer 40 < dialog 50 < toast 60 (`docs/UXUI_FIX_OVERLAY_LAYERS.md`, design 6.6). No migration. Deployed in `d11be14` (see Production).

### Fix: no count next to section headings - 2026-10-05

- Owner decision: `ListSection` has no `count` (text-only headings everywhere, rule added to CLAUDE.md); pagination "Hiển thị x–y trong n" and empty states stay (`docs/UXUI_FIX_HEADING_COUNTS.md`). Deployed in `d11be14` together with the menu layer fix `bee3785` (see Production).

### Customer navigation and transparent home header - 2026-10-05 (deployed in `4bdeaca`, 2026-10-06, see Production)

- A: account sub-tab row removed; person menu = Tài khoản của tôi / Điểm thưởng / Đăng xuất; new notification bell with a latest-8 panel next to the language button (`docs/UXUI_REDESIGN_NAV_HEADER.md`).
- B: the full-bleed hero built in `be5617d` was **rejected by the Owner** (misunderstanding) and removed; the home hero is the original split layout again. **Approved by the Owner:** a transparent header over the original hero (no background, border or shadow at the top, normal colours; solid after about 60 px of scroll; `SiteHeader overlay`).
- No migration, no permission. `be5617d` (CI green) is superseded and must not be deployed on its own.

### Public header and motion package - 2026-10-06 (not deployed)

- Active menu tab is the solid brand pill at all times (cause: the pill used the pale brand-soft token, red only on hover); one transparent, shrinking frosted header on every public and member page; pill glides to hovered/focused tab; pop panels, bell ring, button sheen, member-page reveal (`docs/UXUI_REDESIGN_PUBLIC_HEADER_MOTION.md`).
- No migration, no permission. Not deployed; the Owner deploys the pushed head after CI is green.

### Contact buttons (Zalo / Messenger / phone) - 2026-10-06 (not deployed)

- Shop info has two optional fields (Trang Facebook, Zalo); public site gets a floating contact button and footer icons (`docs/UXUI_CONTACT_BUTTONS.md`).
- **Migration `20261104000000_shop_info_contact_links`** (two nullable columns, additive). Production: apply it with the deploy, then the Owner enters the links in Admin > Website > Shop info.

### Phone app shell (2026-10-06, deployed in `607ca6a`)

- Owner decision after the strip under the tab bar survived three patches: below 1024 px the customer pages are an app shell (`.ls-site` fixed height, `.ls-site-scroll` the only scroller, tab bar in the flow). Desktop pixel-identical. Scroll code follows the scroller (`packages/ui/src/scroller.ts`), new `SiteScrollManager`.
- Customer-visible: browser address bar no longer hides on scroll; pull-to-refresh, iOS status-bar tap and the iOS keyboard were not itemised in the Owner's real-phone test ("everything OK", 2026-10-07) (`docs/UXUI_REDESIGN_APP_SHELL.md`). Gate `uxui-tabbar-check.mjs` rewritten. No migration.

### Contact button colours + footer alignment (2026-10-06, deployed in `15cd7e0`)

- Owner choice: each expanded contact button in its app's colour with a white icon, light and dark alike: Zalo blue, Messenger gradient, call GREEN `#16853a` (`--ls-brand-call`, 4.7:1; the iOS green fails AA). The "Liên hệ" toggle keeps the brand fill (`docs/UXUI_CONTACT_BUTTONS.md`).
- Footer: icons on the text edge, one 40-44 px row rhythm in all columns, the shop's own tagline under the logo (`docs/UXUI_FOOTER_ALIGNMENT.md`). No migration.

### Strip below the tab bar + see-through header (2026-10-06, deployed in `15cd7e0`)

- Header glass 78 % to 96 % (text behind it no longer readable). `viewport-fit=cover` restored (with `minimum-scale=1`, `overflow-x: clip`): most likely cause of the strip on Android, not proven. A 1-pixel last row only appears at fractional screen heights (ratio 2.625) and no CSS reached it.
- `uxui-tabbar-check.mjs` checks every pixel row of the bar, logged-in, 408x908 and 440x956 (`docs/UXUI_REDESIGN_TABBAR_STRIP.md`). No migration.

### Tab bar cut off + hover stuck on touch (2026-10-06, deployed in `cdde1cf`)

- `0be4abe` bar fell below the screen on a phone/DevTools 440x956: a page wider than the screen makes the browser zoom out and the fixed bar leaves the visible screen. Now `minimum-scale=1`, `.ls-site { overflow-x: clip }`, no `viewport-fit=cover`, bar 72 px, top line a shadow.
- Every `:hover` of the kit sits in `@media (hover: hover) and (pointer: fine)` (tests forbid a bare one). New `scripts/uxui-touch-check.mjs`; `uxui-tabbar-check.mjs` extended (`docs/UXUI_REDESIGN_TABBAR_ANDROID.md`). No migration.

### Tab bar anchored to the screen edge (2026-10-06, deployed in `0be4abe`)

- Production `d0fc191` had a gap below the phone tab bar (sticky bar in a `100svh` box, no `viewport-fit=cover`). Now `position: fixed`, safe area as padding inside the bar, page reserves its height (`docs/UXUI_REDESIGN_TABBAR_FIXED.md`).
- New gate script `scripts/uxui-tabbar-check.mjs <url>` (pixel check at top, middle, bottom, toolbar hidden, safe area). No migration.

### Navigation flash fix + tab bar (2026-10-06, deployed in `d0fc191`)

- Cause: public and account each mounted their own site frame (header, tab bar, footer, session remounted), plus a fade from opacity 0 and a text-only session check. Now one `(site)` layout, view-transition cross-fade, skeleton guard (`docs/UXUI_REDESIGN_NAV_FLASH.md`).
- Also: info strip stacks on phones, "Đặt lịch mới" hidden below 1024 px, tab bar only the current tab active with a raised "Đặt lịch ngay", contact button steps aside while reading. No migration.
- Owner decision: the contact button stays as built (hides while scrolling down, shows on scroll up).

### UI polish group 1, customer pages, Step A (2026-10-09, local, not pushed, not deployed; direction APPROVED 2026-10-09; the remaining customer pages follow in this order: shell, services and booking, catalog, account, shop)

- Plan, per-page problem list and design direction: `docs/UI_POLISH_GROUP1_CUSTOMER.md`. Sample built on the HOME PAGE only: campaign offer line above the hero (**Owner approved 2026-10-09: option A only; B and C are not built**; the button says "Xem ưu đãi" while "Bán online" is OFF and only then "Mua ngay" when it is ON), the service price list board with dotted leaders (one signature element; the name "Bảng giá dịch vụ" approved), slider polish, 130 % text header fix, slider touch-pause fix. UI only, no migration, no API change.
- Gate tooling: `scripts/uxui-screens.mjs` now captures the whole page below 1024 px (app-shell scroller) and has `--hover` and `--fresh-session`. Before/after gallery: `.local/polish1/gallery/index.html` (git-ignored).

### UI polish group 1, all customer pages (2026-10-09, UI only; pushed after CI, NOT deployed)

- Owner approved the direction, the name "Bảng giá dịch vụ" and campaign option A only; the offer strip says "Xem ưu đãi" while "Bán online" is OFF ("Mua ngay" only when ON; same rule on the cosmetics campaign strip and sale page). Every customer page was polished (shell, services + search, booking, catalog, ticket, auth, account, shop); report and gate: `docs/UI_POLISH_GROUP1_CUSTOMER.md` sections 8-10. No migration, no API change.
- Deploy guide: `docs/DEPLOY_UI_POLISH_RUNBOOK.md` (web only; API and worker stay up; web rollback from a tarball in about a minute). Before/after gallery: `.local/polish1/gallery-all/index.html` (git-ignored).

### UI polish group 1, customer pages: DEPLOYED (Owner report, 2026-10-09 ~19:23 UTC+7)

- Production = `9a575894312b04768553b9fad35fc7a3ce4c34d0` (previous `4b91af6`). Web only reloaded (`pm2 reload lucyspa-web`); API and worker not restarted. Migrations unchanged (101), permissions 66. Online sales `"enabled":false`.
- Backups: `/root/backups/lucyspa-pre-polish1-20261009T121951Z.dump` (1,328,082 bytes) and `/root/backups/lucyspa-web-pre-polish1-20261009T121952Z.tgz` (325,737,415 bytes). pm2: web 3, api 1, worker 1 online; health ok; `/vi`, `/vi/services`, `/vi/products`, `/vi/workforce/login` 200; unknown page 404.
- The 404 page text is drawn by the browser (client component), so `curl | grep` for its title is always 0; the runbook check now counts `ls-site-footer` (0 on a bare framework 404). Unknown `/vi/services/<code>` and `/vi/products/<code>` answer 404 with the API running (checked on the local build of 9a57589; a 200 seen earlier came from a test run without the API). Not checked on production. Page unchanged. Details: `docs/UI_POLISH_GROUP1_CUSTOMER.md` section 11.

### UI polish group 2, counter/POS screens, Step A (2026-10-09, local, not pushed, not deployed; waiting for Owner approval)

- Plan, screen list, problem list, design direction and the one built sample (the invoice board `/workforce/pos`): `docs/UI_POLISH_GROUP2_POS.md`. UI only, no migration, no API change.
- Shared kit change: optional `hidePhone` column flag on `DataTable` (only the invoice board uses it). Open Owner questions in section 7 of the doc (row hover vs rule 4, date format, status filter, invoice detail order, phone list style).
- Scratch data/recipes: `.local/polish2/` (seed-visits.mjs, shots.mjs); stack from `.local/polish1/` (API 3101, web 3100, DB `lucy_spa_polish1_scratch`).

### UI polish group 2, Owner decisions (2026-10-09)

- Owner approved the invoice-board sample and the order, and decided: (1) row hover follows rule 4 in ALL staff tables (solid #782b37, white text and icons; dark = existing pink accent); (2) staff date inputs are dd/mm/yyyy; (3) keep the status filter and add an accent-insensitive search on the invoice board; (4) payment block at the top of the invoice detail; (5) compact rows on the phone list. Then every remaining counter screen is polished (UI only). Recorded in `docs/UI_POLISH_GROUP2_POS.md` section 8.

### UI polish group 2, all counter screens (2026-10-09, UI only; pushed after CI, NOT deployed)

- Every counter screen polished (invoice board + search + compact phone rows, invoice detail with the payment block first, dialogs, walk-in, today's bookings, returns, pre-orders, online orders). Shared kit: staff table row hover = solid #782b37 (rule 4; customer tables keep the tint), staff dates typed dd/mm/yyyy (`DateTextInput`), `DataTable phoneRows="compact"`, money fields with thousands separators, staff top bar fits 360 px at 130% text. No migration, no API change. Report and gate: `docs/UI_POLISH_GROUP2_POS.md` sections 9-13.
- Counter flows run through the UI on the scratch DB (cash, PayOS via the simulator, sell product, return + refund, pre-order mark ordered + handover). Not fixed: search by phone on the invoice board (the board data has no phone; needs an API field). DOM audit baseline refreshed (no count rose).
- Deploy guide: `docs/DEPLOY_UI_POLISH_GROUP2_RUNBOOK.md` (web only reload; API and worker stay up). Gallery: `.local/polish2/gallery/index.html` (git-ignored).

- CI note (2026-10-09): the group 2 push ran red three times (15:14-16:22 UTC) only in `test:auth:integration`, a time-window flake (15:00-17:00 UTC, see `apps/api/src/account/my-income.integration.test.ts`); green after 17:00 UTC: commit `2ed632d0e10787c9b85252082a7f480a92c1a15f`, run 37967549325 (same code as `7164c23`). The deploy guide names `2ed632d`.

### Customer site, direction C "Ấm áp thư giãn" (Owner chose it 2026-10-10; UI only; pushed, CI green on `a907618`, run 37998033826; DEPLOYED, see the next section)

- Owner chose C of the three hidden previews; applied to EVERY customer page (home, services, booking, cosmetics, campaign, sign-in, account, cart, ticket, 404 and error, header, tab bar, footer, popup, notifications; holiday themes sit on top). A and B and the `/vi/design-preview/*` routes are removed. Contract, photo slots and the photo list: `docs/CUSTOMER_SITE_C.md`; `CLAUDE.md` now records C as the approved style.
- Code: `packages/ui/src/customer-tokens.css`, `customer.css`, `customer-pages.css` (scoped to `.ls-site`, staff area untouched); fonts Fraunces + Nunito Sans in `apps/web/src/components/public/site-fonts.ts`. Fixed: sign-in brand panel (no dark boxes, no stretching), footer social icons only with a link. No migration, no API change.
- Release = group 2 (counter screens, `7164c23`) + this; web reload only. Deploy guide: `docs/DEPLOY_CUSTOMER_SITE_C_RUNBOOK.md` (names `a907618`). Gallery: `.local/customer-c/gallery/index.html` (git-ignored). The 15:00-17:00 UTC CI flake: see `docs/CUSTOMER_SITE_C_STEP.md`.

### Customer site direction C + UI polish group 2: DEPLOYED (Owner report, 2026-10-10 ~10:29 UTC+7)

- Production = `a907618993a49e2c563d28fd75b25ddb5f177d62` (previous `9a57589`). Web only reloaded (`pm2 reload lucyspa-web`); API and worker not restarted. No migrations (101), permissions 66. Online sales `"enabled":false`. Fonts downloaded fine at build.
- Backups: `/root/backups/lucyspa-pre-giao-dien-c-20261010T032519Z.dump` (1,328,681 bytes) and `/root/backups/web-pre-giao-dien-c-20261010T032520Z.tgz` (373,169,448 bytes).
- pm2: web 3, api 1, worker 1 online. Health ok; `/vi`, `/en`, `/vi/services`, `/vi/account/login`, `/vi/workforce/login` 200; `/vi/design-preview/c` and an unknown page 404; `ls-hero-title` 1; `ls-site-footer` on the 404 page 1.
- **Pending Owner decisions (do not act yet):** home hero (keep the C photo-circle composition, and what to do with the slider); offer strip position (top strip vs bottom ribbon); hover exceptions on... (the Owner message was cut off here; read as the three hover exceptions on red surfaces in `docs/CUSTOMER_SITE_C.md`, to be confirmed). Also still open: the two hero photo slots without an Admin slot.
- **Customer home fine-tuning: PENDING (Owner, 2026-10-10; not started):** balance and alignment of the home page, hero heading size, the header in the C style, the photo caption hidden behind the small circle, and the real photos.

### Staff screens in direction C: DEPLOYED (Owner report, 2026-10-10 ~15:52 UTC+7)

- Production = `8b7c3413a0827f21e8973e45be56c94b10e5d9c2` (previous `a907618`). Web only reloaded; API and worker not restarted. No migrations (101), permissions 66. Online sales `"enabled":false`.
- Backups: `/root/backups/lucyspa-pre-giao-dien-nhan-vien-c-20261010T084705Z.dump` (1,328,919 bytes, 2104 TOC lines) and `/root/backups/web-pre-giao-dien-nhan-vien-c-20261010T084706Z.tgz` (325,982,283 bytes).
- pm2: web 3, api 1, worker 1 online. Health ok; `/vi`, `/vi/services`, `/vi/account/login`, `/vi/workforce/login`, `/vi/workforce/forgot-password` 200; unknown page 404; `ls-hero-title` 2; `ls-font-staff-title` found in the staff CSS.
- **Owner roadmap (2026-10-10; Claude integration phase added later the same day, after Phase 8; order CONFIRMED by the Owner the same day: Phase 9 → 7 → 8 → Claude integration → full review/polish pass → Phase 10):** Phase 9 → Phase 7 → Phase 8 → Claude integration → one full review/polish pass of everything (balance and alignment, customer home, ...; the Owner confirmed on 2026-10-10 that `docs/REVIEW_POLISH_CHECKLIST.md` is complete). Also in PRD section 56. The customer home fine-tuning above stays pending until that pass.

- **Review and polish pass checklist written (2026-10-10, docs only):** `docs/REVIEW_POLISH_CHECKLIST.md` (UI balance, customer home fixes, 20 px checkboxes, wide tables at 768/1024, re-test of every flow, pre-launch items: Cloudflare, off-server backups, private repo, remove Lovable template, Zalo/Facebook links, 11 real photos). The Owner confirmed the checklist is complete (home page items: only oversized title, top bar in style C, caption covered by the circle, real photos).

- **Phase 9 P9-1 design written (2026-10-10, docs only, no code, no migration):** `docs/PHASE9_PRODUCT_IMPORT.md` (sources and adapters, tables, mapping to products/variants/images, price handling, duplicates, review flow, re-sync, permissions, legal notes, risks) plus a 15-question Vietnamese Owner questionnaire in section 15. **The Owner answered the questionnaire the same day (recorded in section 15) and P9-T1..T10 are approved per those answers:** one source for now, https://haruohui.com/ (images and content permitted by the supplier, prices not stated so reference only and never public; the Owner keeps the written proof); source price never written to `cost_price_vnd`; suggestions rounded to 1,000 VND; no AI in Phase 9; the Owner handles supplier contact. Read-only probe (8 requests, section 16): WordPress + WooCommerce, public Store API (352 products), Yoast sitemap, `robots.txt` has no restriction; only 7 of 20 sampled products have a SKU (the source key is the WooCommerce product id); brand is a category term. Recommended adapter: `woocommerce-store-api`.
- **Phase 9 P9-2 built (2026-10-10; NOT deployed; commit hash in the chat report):** 2 migrations (101 → **103**: enum codes, then 8 tables + guards), permissions 66 → **68** (`MANAGE_SUPPLIER_SOURCES`, `REVIEW_SUPPLIER_IMPORTS`, GLOBAL_ONLY, granted to nobody), `/api/v1/supplier-sources` and the screen "Nguồn nhà cung cấp" (Danh mục). The permission gate (record complete + covers text or images + confirmed) is enforced in the database, the API and the screen. Report `docs/PHASE9_P9_2_SOURCES.md` (4 points the agent chose, awaiting the Owner); recipes `.local/p9-2/` (start, seed, shots). Deploy later: 2 migrations, `pnpm db:permissions:sync`, restart API + web; worker unchanged. Next: P9-3 (WooCommerce Store API adapter + Test Source) waits for the Owner's review. **Owner decisions, second round (2026-10-10, verbatim at the end of `docs/PHASE9_PRODUCT_IMPORT.md` section 16):** importer User-Agent contact hotro@lucyspa.vn (with https://lucyspa.vn), the Owner's personal email never again (it is in no file of the repo; only the author address of the git history); Lucy SKU = the supplier SKU as shown, none → `HARU-<WooCommerce product id>`, a collision with another Lucy product is a review item; each set is its own product; order confirmed (Phase 9 → 7 → 8 → Claude integration → polish pass → Phase 10); the four P9-2 choices accepted, and from P9-3 enabling a source also needs a successful Test Source (`READY`). Owner answers are recorded verbatim in section 15.
- Local cleanup (2026-10-10, local machine only): three old worktrees handled (details in the chat report); on the Owner's "ok", 88 scratch databases were dropped from the local Postgres container (kept: lucy_spa_dev, lucy_spa_uxaudit_20261001, lucy_spa_authtest_20261001, postgres).

### Staff screens in direction C (Owner decision 2026-10-10; UI only; pushed `8b7c3413a0827f21e8973e45be56c94b10e5d9c2`, CI green run 38033720488; now DEPLOYED, see above)

- Owner: staff screens (admin, counter/POS, staff sign-in) follow direction C so the whole product is one brand; no sample round. `CLAUDE.md` has the new section "Staff screens in direction C". Report: `docs/UI_STAFF_C.md`; gallery `.local/staff-c/gallery/index.html` (git-ignored); recipes `.local/staff-c/` (shots, overflow, flows2, rebuild.ps1).
- Code: staff tokens in `packages/ui/src/tokens.css`, new `packages/ui/src/staff.css` (scoped to `.ls-shell` and `.ls-auth`), Fraunces + Nunito Sans on `<html>`, serif wordmark in the staff bar and sign-in, `DataTable hideBelow: 'wide'` (< 1440 px), column fixes (Services, Staff, Discounts, Inventory, POS board). No migration, no API change, customer site unchanged.
- Gate: no cut table column at 1280 and 1440 on 57 screens; DOM audit no count above baseline (baseline refreshed); counter and admin flows driven through the UI passed; 130% text no sideways scroll. Open: wide tables still scroll inside their frame at 768 and 1024 px; four forms keep 20 px checkboxes. Deploy guide: `docs/DEPLOY_STAFF_C_RUNBOOK.md` (web reload only).
