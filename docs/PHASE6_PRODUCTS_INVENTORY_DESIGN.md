# Phase 6: Products, Inventory, Beauty Points, Mixed Invoices and Product Returns: design contract (P6-1)

Status: **P6-1 is documentation only.** Owner decisions P6-Q1…Q18 were given in the Owner's own words on 2026-10-07 and are recorded below as approved.
Every technical proposal below that is not in the approved list is **pending Owner approval** (nothing here is approved by me).
Production state is whatever `LUCYSPA_HANDOFF.md` records (`39ad8d1`, 63 migrations, 54 permissions, loyalty go-live ON). No code, schema or server was changed.

Every rule carries a source label so nothing is silently invented:

| Label     | Meaning                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PRD §n`  | Written in `LUCY_SPA_PRD.md` (sections 14, 16, 18, 19, 22-28, 31, 38, 53, 56, 60, 61)                                                  |
| `P6-Qn`   | Owner decision of 2026-10-07 (section 2.1). Locked, do not reopen                                                                      |
| `P5-…`    | Locked Phase 5 decision (`PHASE5_LOYALTY_COMBOS_DESIGN.md`), reused unchanged                                                          |
| `P4 §n`   | Locked Phase 4 contract (`PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md`), reused unchanged                                                    |
| `P6-Tn`   | Technical decision. T1-T8 **approved** by the Owner (Q18, then the 2026-10-07 follow-up for T8); T9 onwards **pending Owner approval** |
| `OQ-P6-n` | **Open question.** Not decided here. Each says which Step it blocks and, where useful, a proposed default                              |

## 1. Scope, non-goals, foundations

**In scope (PRD §56 Phase 6):** brands, categories, products, variants, images, prices and simple price promotions; Excel/CSV catalog and opening-stock import;
suppliers, stock receipts, lots and expiry, movements, internal adjustments, physical counts, low-stock and expiry alerts; a public read-only catalog;
product lines on invoices with seller attribution and stock reservation; product-only invoices; mixed Spa + Beauty invoices; Lucy Beauty points and the
Beauty member discount; product-fault exchange and refund with their point effects (PRD §28.5-28.6); product gift stock; full promotion campaigns (PRD §24.1, last).

**Not in Phase 6:** product commission calculation (Phase 7, P6-T5), tips, payroll, cash drawer link of refunds (Phase 7, Q4), reports and exports (Phase 8),
Reviews (PRD §37, moved to Phase 8 by the Owner), the website importer (Phase 9), online checkout, shipping, COD, shipping fees (PRD §3.2, §61: TBD),
threshold cosmetic campaigns (PRD §22, deferred by Q12), inter-branch stock transfer (Q13), an oversell override (T7), service or combo refunds (PRD §29).

**Foundations confirmed in the repository (read, not assumed):**

- `InvoiceKind` = `VISIT` | `COMBO_SALE`; `InvoiceLineKind` = `SERVICE` | `COMBO_PURCHASE`; `InvoiceStatus` = `DRAFT` | `PENDING_PAYMENT` | `PAID` | `CANCELLED` (no `REFUNDED`).
  `invoices.visit_id` is NULL exactly for `COMBO_SALE`. `calculation_version` is 2 in force.
- Discounts are **invoice-level** (P4 §7.4: no per-line allocation). `DiscountScopeMode` = `ALL_SERVICES` | `SELECTED` (services and service categories only).
  `invoice_discount_applications` and `discount_redemptions` are **unique per invoice**; the integrity trigger accepts the discount as the applied program benefit OR the member amount, never both.
- `invoice_loyalty_snapshots` is **unique per invoice**, has one `wallet`, `eligible_spa_vnd` and `eligible_beauty_vnd` (default 0), and `birthday_*` columns.
- `loyalty_wallets` holds `SPA` and `BEAUTY` per customer (lazy). The consumer earns **Spa only** with key `SPA_EARN:{invoice}:{paid_seq}`; the Beauty wallet only holds referral awards and manual adjustments.
- `birthday_reward_versions` has **no Spa/Beauty scope column** (the Phase 5 design listed one; it was not built). Q7 makes the birthday reward services-only, so none is needed.
- Reward kind `PRODUCT_GIFT` exists and is descriptive only (no product link, no stock).
- Auth throttling is PostgreSQL-backed (`auth_throttle_buckets`, per IP and per identity), so it is already shared across processes. Redis runs for BullMQ. Public endpoints send `Cache-Control: public, max-age=60`
  and the web app keeps a 60 s memo. I found no general rate limit on public read endpoints (a quick search, to be verified at the start of the load-readiness Step).
- Production runs pm2 with `lucyspa-api`, `lucyspa-web`, `lucyspa-worker`; the pm2 configuration is not in the repository. Server (Owner, 2026-10-07): **6 cores, 7.8 GB RAM, no swap**.
- 54 permission codes exist (`packages/database/src/permission-catalog.ts`); no role is seeded; the Owner grants (P4 Q9).

## 2. Decisions

### 2.1 Owner decisions P6-Q1 … P6-Q18 (2026-10-07, the Owner's own words; locked, do not reopen)

| #      | Decision                                                                                                                                                                                                                                                | Applied in |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P6-Q1  | The best offer is chosen **per side** (Spa separately, Beauty separately). A shared discount/voucher is **split between the sides pro-rata by amount**.                                                                                                 | 6.2-6.5    |
| P6-Q2  | A shared payment is split **pro-rata by side amount**; **points are rounded per wallet**.                                                                                                                                                               | 6.6        |
| P6-Q3  | Partial refund: deduct Beauty points based on the **amount actually paid for the refunded line (after discounts)**, through a **linked ledger entry**.                                                                                                  | 8.4        |
| P6-Q4  | Refunds are paid by **cash or manual bank transfer only** (no automatic PayOS refund). Only the Owner or a senior manager holding a **dedicated permission**; **password re-entry required**. Cash drawer link deferred to Phase 7.                     | 8.3, 9     |
| P6-Q5  | `REFUNDED` is **per product line**, not for the whole invoice.                                                                                                                                                                                          | 8.2        |
| P6-Q6  | **Product-only invoices with no visit are allowed.**                                                                                                                                                                                                    | 5.1        |
| P6-Q7  | Vouchers and promotions get a scope **SERVICES / PRODUCTS / BOTH**. The **birthday reward applies to services only**.                                                                                                                                   | 6.3, 6.5   |
| P6-Q8  | **Reserve stock when the invoice is finalized**; release on cancel or void. **Never oversell.**                                                                                                                                                         | 4.5        |
| P6-Q9  | **Seller is required on every product line**; defaults to the invoice creator, changeable to any active staff member at that branch.                                                                                                                    | 5.3        |
| P6-Q10 | **`PRODUCT_GIFT` deducts stock when the customer receives it.**                                                                                                                                                                                         | 4.7        |
| P6-Q11 | **Simple price promotions (PRD §24) first**; full campaigns (PRD §24.1) at the end of Phase 6.                                                                                                                                                          | 3.4, 13    |
| P6-Q12 | **Threshold cosmetic campaigns (PRD §22) are deferred**, not in Phase 6.                                                                                                                                                                                | 1, 14      |
| P6-Q13 | **Stock is per branch**; no inter-branch transfer for now.                                                                                                                                                                                              | 4.1        |
| P6-Q14 | **Expiry warning default 90 days, configurable.**                                                                                                                                                                                                       | 4.6        |
| P6-Q15 | The public site shows **"Hết hàng"** when out of stock and **never shows quantities**.                                                                                                                                                                  | 11.1       |
| P6-Q16 | **Excel/CSV catalog and opening-stock import is built early in Phase 6** (before Phase 9). The Owner provides real prices, stock and suppliers; **no data is invented**.                                                                                | 11.2, 13   |
| P6-Q17 | **Deploy in 2-3 waves.** Wave 1 = catalog, inventory, public read-only catalog and must **not touch the payment/POS flow**.                                                                                                                             | 13         |
| P6-Q18 | **P6-T1…T7 approved** (commission is calculated in Phase 7; Phase 6 only records the seller; no oversell mode). **Load readiness: option 2** (after the public catalog Step, before the product pages go public). Server: 6 cores, 7.8 GB RAM, no swap. | 2.2, 12    |

### 2.2 Technical decisions

**Approved by the Owner (Q18, 2026-10-07):**

| #     | Decision                                                                                                                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P6-T1 | New invoice line kind `PRODUCT` and a new invoice kind for product-only sales (the no-visit case allowed by Q6). Existing invoices are untouched.                                                         |
| P6-T2 | Beauty points are awarded and reversed **asynchronously** by the `loyalty` consumer exactly like Spa points; key `BEAUTY_EARN:{invoice}:{paid_seq}`; the payer earns; a guest payer earns nobody (P5-Q2). |
| P6-T3 | Lock order extension: stock rows are locked after wallets and combo/reward rows and before payments, sorted by id (section 10.2).                                                                         |
| P6-T4 | The Beauty member discount follows the **payer** and the payer's **Beauty tier before the invoice**, read at finalization under lock and snapshotted (as P5-T3/T4).                                       |
| P6-T5 | Phase 6 stores the **seller on each product line only**. Product commission is calculated in Phase 7.                                                                                                     |
| P6-T6 | Low-stock and expiry alerts go to the holders of the matching permission at the branch through the permission engine (as Q8). No role names.                                                              |
| P6-T7 | **No oversell mode** in Phase 6 (PRD §27.2 allows a controlled override only if the Owner enables it later).                                                                                              |

**T8 was approved by the Owner in own words on 2026-10-07 (follow-up: "the public catalog is view-only: no cart, delivery or COD"); T9 onwards are pending Owner approval:**

| #      | Proposal                                                                                                                                                                                                                                                                                                                                                            | Needed before |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| P6-T8  | **APPROVED 2026-10-07.** **Public product pages are browse-only:** no cart, checkout, shipping, COD or online payment (PRD §3.2 and §61 leave them TBD). Consistent with Q15.                                                                                                                                                                                       | P6-6          |
| P6-T9  | **Variant-centred model:** every product has at least one variant; SKU, price, stock and low-stock threshold live on the variant; a product with no real variants has one default variant. The sellable unit is the variant.                                                                                                                                        | P6-2          |
| P6-T10 | **Catalog and prices are global; stock is per branch** (Q13). A branch sells a variant only from its own stock. (PRD is silent on per-branch prices; this keeps one price list.)                                                                                                                                                                                    | P6-2          |
| P6-T11 | **Product status** `DRAFT` / `PUBLISHED` / `INACTIVE`. A product referenced by any invoice, stock movement or return is never deleted (PRD §40). `INACTIVE` hides it from the public site and the POS and keeps history. Publishing needs a Vietnamese name and one priced variant.                                                                                 | P6-3          |
| P6-T12 | **Price model:** append-only price versions per variant plus per-variant promotion rows (price, start, end, early end). The effective price is a pure function of (variant, instant). A POS line re-resolves it on every draft calculation and **freezes it at finalization** (PRD §14.2); staff can never change it (PRD §23.4).                                   | P6-2          |
| P6-T13 | **Stock model:** lots, append-only signed movements, one level row per (branch, variant) as a cache. CHECKs: `on_hand >= 0`, `reserved <= on_hand`, `on_hand = Σ movements`. Refinement of the approved T3 (pending): the id sorted for stock rows is the pair (branch id, variant id). A receipt is `DRAFT` then `CONFIRMED` and immutable afterwards (PRD §27.1). | P6-2          |
| P6-T14 | **Availability = non-expired lot quantity minus open reservations.** Expired lots are never sellable and are flagged for an `EXPIRED` adjustment. Lot allocation is accounting FEFO (earliest expiry first; no expiry last). Physical shelf order is outside the system.                                                                                            | P6-4          |
| P6-T15 | **Reservation lifecycle and asynchronous consumption** (section 4.5), with a stale-episode guard like P5-T9.                                                                                                                                                                                                                                                        | P6-8          |
| P6-T16 | **Alert mechanics** (section 4.6): low stock fires once on crossing the threshold and re-arms after restock; expiry is a daily branch-local scan; an `inventory` consumer and scheduler create in-app notifications through the existing notification path.                                                                                                         | P6-4          |
| P6-T17 | **Engine version 3, per-side evaluation** (section 6). A Spa-only invoice under v3 must equal v2 exactly (differential test).                                                                                                                                                                                                                                       | P6-9          |
| P6-T18 | **One proportional-split primitive** with cumulative half-up rounding (section 6.4), used for the shared-discount sides, line net amounts, payment-to-side attribution and refund units.                                                                                                                                                                            | P6-9          |
| P6-T19 | **Persistence changes for v3** (section 6.7): applications per (invoice, side), redemption per (invoice, program), loyalty snapshot per (invoice, wallet), line net allocation rows, payment side allocation rows, updated integrity trigger.                                                                                                                       | P6-8          |
| P6-T20 | **Invoice shapes:** a `VISIT` invoice may hold service **and** product lines; the product-only kind holds product lines only; `COMBO_SALE` keeps exactly its one combo line (buy a combo and a product = two invoices). The live Phase 4 guards change only in Wave 2 (P6-8), never in Wave 1 (refinement of the approved T1, pending).                             | P6-8          |
| P6-T21 | **Refund point rule** (section 8.4): points that should remain = floor(remaining net / 1000); reversal = earned − remaining − already reversed; a shortfall follows P5-Q5 (floor at 0, recorded, flagged); a refund is never blocked by a low point balance. Rounding choice is OQ-P6-19.                                                                           | P6-13         |
| P6-T22 | **Refund records:** immutable money rows (method `CASH` or `BANK_TRANSFER_MANUAL`, amount, reason, actor, time, bank reference for a transfer); the invoice stays `PAID`; the line state is derived; an invoice with any refund cannot have a payment reversed or be cancelled.                                                                                     | P6-13         |
| P6-T23 | **48-hour rule:** for "wrong product or shipping/packing damage" the 48 hours run from the invoice's `paid_at` (Phase 6 sells at the counter only); after 48 hours the system refuses that reason (PRD §28.2: "not accepted"). No override.                                                                                                                         | P6-12         |
| P6-T24 | **Permission list** of section 9 (names, scopes, classifications; nothing seeded, nothing granted).                                                                                                                                                                                                                                                                 | P6-2          |
| P6-T25 | **Sequence and waves** of section 13.                                                                                                                                                                                                                                                                                                                               | P6-2          |
| P6-T26 | **Customer invoice view** shows product name, variant, quantity, unit price and line total; never the seller, cost, lot or SKU cost data.                                                                                                                                                                                                                           | P6-10         |
| P6-T27 | **Voiding a zero-balance paid product invoice (OP-7) restores its stock** (the sale never happened); the consumer reverses the consumption.                                                                                                                                                                                                                         | P6-10         |

### 2.3 Other Owner decisions (2026-10-07)

- PRD §37 **Reviews moves to Phase 8**. (`LUCY_SPA_PRD.md` is not edited without explicit Owner authorization; this document and the handoff record the placement.)
- The footer "Explore" label stays as is; the open item in `CLAUDE.md` is closed.
- Load readiness (P6-7): **option 2**, after the public catalog Step and before the product pages go public.
- Server: 6 cores, 7.8 GB RAM, no swap.

### 2.4 Open questions (not decided; do not implement)

OQ-P6-19 … 25 block only Wave 2 and Wave 3 Steps. OQ-P6-26 concerns only P6-7. OQ-P6-27 and 28 (public page identity and data) concern only P6-6; OQ-P6-27 also asks to confirm the navigation change. The Owner may answer them when the Step that names them is next.

| #        | Question                                                                                                                                                                                                                                                                                                                                                                                                                 | Blocks | Proposed default (only if the Owner agrees)                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-P6-19 | **Refund point rounding (PRD §18.1 asks for an explicit rule).** (A) cumulative: points that remain = floor(remaining net / 1000), so a full refund always returns the wallet to its pre-sale value, but a partial refund of 1,500đ from a 3,000đ sale (3 points) reverses 2 points. (B) per event: reverse floor(refunded net / 1000), so the same 1,500đ reverses 1, and refunding both halves reverses 2 of 3 points. | P6-13  | (A).                                                                                                                                                                                                                          |
| OQ-P6-20 | **A shared (BOTH) voucher can win one side only.** If it wins Spa but the Beauty member discount is larger on Beauty, only the Spa share is applied, the Beauty share is unused, and the voucher is redeemed once. Confirm this reading of Q1 (example in 6.8, case C).                                                                                                                                                  | P6-9   | Yes: per-side winners, one redemption per invoice per program.                                                                                                                                                                |
| OQ-P6-21 | Inside a PRODUCTS (or BOTH) scope, may a program target **selected brands, categories or products**, or only "all products"? PRD §16 lists applicable products/services/categories.                                                                                                                                                                                                                                      | P6-8   | Same shape as services: all products or a selection of brands, categories and products.                                                                                                                                       |
| OQ-P6-22 | **Which return reasons may end in a refund** (versus an exchange only)? PRD §28.1-28.3 gives conditions per reason but not the remedy for each; no day limit is given for a customer-preference return.                                                                                                                                                                                                                  | P6-12  | Ask per reason; until answered no refund path is enabled for a reason.                                                                                                                                                        |
| OQ-P6-23 | Refund **granularity**: whole line only, or a number of units of a line?                                                                                                                                                                                                                                                                                                                                                 | P6-13  | Units (cumulative rounding, section 6.4); the line becomes `REFUNDED` when all units are.                                                                                                                                     |
| OQ-P6-24 | **Exchange money and approval** (PRD §28.4 forbids inferring it): how is an additional amount collected, is a difference ever returned when the replacement is cheaper, and who approves an exchange (a separate permission or the refund permission)?                                                                                                                                                                   | P6-14  | None proposed. PRD §28.5 fixes only the points.                                                                                                                                                                               |
| OQ-P6-25 | Can the **seller of a product line be corrected after finalization** (it feeds Phase 7 commission), and by whom?                                                                                                                                                                                                                                                                                                         | P6-10  | Draft only; any later correction needs an Owner-defined audited action in Phase 7.                                                                                                                                            |
| OQ-P6-26 | **Cluster the `api` process in Wave 1?** More API processes also serve the POS, the PayOS webhook and re-authentication, while Q17 says Wave 1 must not touch the payment/POS flow.                                                                                                                                                                                                                                      | P6-7   | No: Wave 1 clusters `web` only; API clustering moves to Wave 2 (before P6-11).                                                                                                                                                |
| OQ-P6-27 | **Public cosmetics page identity.** The reference uses the label "Mỹ phẩm" and the address `/my-pham` and adds a cosmetics entry to the header and the phone tab bar; our approved header (Owner, 2026-10-03) has no cosmetics item "until its phase", our routes are English (`/services`), and PRD §47 says "Products". Which label, which address, and where in the header and tab bar?                               | P6-6   | Label "Mỹ phẩm", address `/products` (same pattern as `/services`), one header item for everyone, and a tab bar entry only for signed-out visitors (members keep their five items).                                           |
| OQ-P6-28 | **Data the reference shows but the PRD does not define:** the "Nổi bật" sort and the "Mới" badge need a rule. The commitment box and the hero image and text are page copy that only the Owner can supply.                                                                                                                                                                                                               | P6-6   | "Mới" = published within the last N days (the Owner sets N; the badge is off until set); "Nổi bật" = an Owner-set featured flag on the product; the commitment box and hero are editable by the Owner and hidden while empty. |

## 3. Catalog (PRD §23-24; T9-T12)

### 3.1 Model

`Brand → ProductCategory → Product → ProductVariant`, never hard-coded to The Whoo (PRD §23.1). Product: VI/EN name and description, brand, category, status (T11), images,
source/import metadata. Variant: SKU (unique, the stable business identifier for import matching, PRD §31.4), label (size/volume), barcode (optional, later), list price, cost price (restricted),
low-stock threshold. Categories are one level plus an optional parent (PRD §23.2 "category"; depth beyond one parent is not designed). Nothing is seeded.

### 3.2 Visibility

- Public: only `PUBLISHED` products and their variants, VI/EN text, images from the media library (usage kind `PRODUCT`), effective price, list price crossed out while a promotion is active, "Hết hàng" (section 11).
- Cost price, margin and receipt unit costs exist only behind `VIEW_PRODUCT_COST`. The **API shapes its responses by permission** (a KTV response carries no cost field); hiding in the UI alone is not enough (PRD §23.3).
- Seller-facing POS search shows name, variant, effective price and whether it is in stock at the branch (not quantities beyond what the branch staff need: `VIEW_INVENTORY` shows quantities).

### 3.3 Price authority (PRD §23.4)

Only `MANAGE_PRODUCT_PRICES` changes list price, promotional price or promotion timing; every change is audited (`FINANCIAL`). Price versions are append-only. A bulk price update goes through the import preview (section 11.2) and needs the same permission.

### 3.4 Simple promotions first (Q11, PRD §24)

Per variant: promotional price, start, end, manual early termination. When inactive or expired the effective price returns to the list price automatically (no restore step). The campaign engine of PRD §24.1 (bulk selection, scheduling, presentation, preview) is the **last** Step of Phase 6 (P6-16) and defines its own permission; it never stacks campaigns (PRD §24.1, §16.1).

### 3.5 Images

Product images use the existing media library storage (`MEDIA_STORAGE_DIR`, variants, alt text rules). Upload from the catalog screen needs `MANAGE_PRODUCTS`; a product image in use cannot be deleted from the library (same protection as popups and slides). Bulk image mapping by SKU filename (PRD §31.3) belongs to the import Step.

## 4. Inventory (PRD §27; T13-T16, Q8, Q10, Q13, Q14)

### 4.1 Model

Stock is per branch (Q13). Per (branch, variant): a level row (`on_hand`, `reserved`) is a cache of the movement ledger, updated in the same transaction under row lock. Lots: (branch, variant, lot code, expiry date or none, received quantity). Suppliers are global records (`MANAGE_PRODUCTS`). Integer units only. There is no transfer between branches.

### 4.2 Movements (append-only, signed, never edited or deleted)

`OPENING` (import), `RECEIPT`, `SALE`, `SALE_REVERSAL`, `ADJUSTMENT` (reason: `INTERNAL_USE`, `TESTER`, `DAMAGED`, `EXPIRED`, `LOSS`, `COUNT_CORRECTION`; a reason is required, PRD §27.5), `RETURN_IN` (sellable only), `EXCHANGE_OUT`, `GIFT_OUT`, `GIFT_RETURN`. Each row carries lot, actor, time (DB clock), reason, a source reference and a unique idempotency key. Internal adjustments generate no revenue (PRD §27.5). A non-sellable return is recorded with no on-hand change (PRD §28.4).

### 4.3 Receipts (PRD §27.1)

Supplier, branch, date, notes; lines with variant, quantity, unit cost (optional; entering or seeing it needs `VIEW_PRODUCT_COST`), lot code, expiry. Only `MANAGE_STOCK_RECEIPTS` creates and confirms; a confirmed receipt increases stock and is immutable; a mistake is corrected by an adjustment, never an edit. The product's cost price is a separately maintained reference; **no costing method (average, FIFO) is decided in Phase 6**: cost of goods sold stays derivable from the lot unit cost on each sale movement for Phase 8 margin reports.

### 4.4 Physical count (PRD §27.6)

A count session for a branch (all variants or a selection): staff enter counted quantities; on approval, under the stock row locks, the difference to the system quantity becomes an `ADJUSTMENT` of reason `COUNT_CORRECTION` with actor, time and audit. The number is never overwritten. Sales during a count make the system quantity move: counts are meant to be done with no sales in progress (operational note); approval always compares with the quantity locked at that moment.

### 4.5 Availability, reservation and consumption (Q8, T14, T15)

- **Available** = non-expired lot quantity − open reservations. Expired lots are excluded and flagged; the sale of expired stock is not possible (T14).
- **Reserve at finalization (sync):** under the invoice lock and the stock row locks (sorted), each product line reserves its quantity at the invoice branch. If any line lacks availability the whole finalization is refused with `PRODUCT_OUT_OF_STOCK` naming the lines; nothing is written. Two cashiers cannot both take the last unit.
- **Consumption at PAID (async):** the `inventory` consumer, on `INVOICE_PAID(invoice, paid_seq)`, re-reads authoritative state under lock; if the invoice is still `PAID` at that `paid_seq` it turns each `RESERVED` reservation into `CONSUMED` and writes the `SALE` movement with FEFO lot allocation. Otherwise it records `SKIPPED_STALE`.
  Because the reservation holds the quantity until consumption, the lag between payment and consumption never creates oversell: both `on_hand` and `reserved` fall together.
- **Reopen (async):** on `INVOICE_REOPENED(paid_seq)` the consumer writes `SALE_REVERSAL` for that episode and sets the reservation back to `RESERVED`, unless the invoice is by then `CANCELLED` (then `RELEASED`).
- **Cancel an unpaid finalized invoice (sync):** `RESERVED` becomes `RELEASED` in the cancelling transaction (Q8). A `CONSUMED` reservation is never released synchronously; the consumer restores it from the `INVOICE_REOPENED` / `INVOICE_CANCELLED(voidedPaidSeq)` event (T27 for the OP-7 void).
- **Invariants:** `on_hand >= 0`, `reserved <= on_hand`, `on_hand = Σ movements`, reservation state changes are one-way per episode, every movement key is unique, a replay creates nothing.
- Drafts reserve nothing (Q8). Product sales do not depend on loyalty go-live; only points and the member discount do.

### 4.6 Low stock and expiry (PRD §27.3-27.4, §38.3; T16, Q14)

Per-variant threshold. Low stock fires once when `on_hand` crosses at or below the threshold and re-arms after a restock above it. Expiry warning: lots expiring within N days (default **90**, configurable by the Owner in one settings row; `MANAGE_PRODUCTS`) found by a daily branch-local scan; the time of day is chosen in P6-4 (proposal 08:00). Recipients: holders of `VIEW_INVENTORY` at the branch through `resolvePermissionHolders` (T6). In-app only, like Q8; no email or Zalo.

### 4.7 Gifts (Q10)

A `PRODUCT_GIFT` reward item may be linked to a variant. When staff mark a granted gift **used** at a branch, `GIFT_OUT` deducts that branch's stock (refused with "Hết hàng" if none, nothing written); a manager's restore of a mistaken "used" writes `GIFT_RETURN`. A gift item with no variant (any created before Phase 6) deducts nothing. No money, no invoice, no points. This touches the reward module only, not payments, so it is scheduled in Wave 3.

## 5. Product lines on invoices (PRD §14, §25; Q6, Q9, T1, T12, T20)

### 5.1 Shapes

- `VISIT` invoice: service lines and product lines together (a mixed invoice).
- New product-only kind: `visit_id` NULL, product lines only, any branch staff member with `SELL_PRODUCTS` can start it; payer is a member or a guest (a guest earns nobody and gets no member discount).
- `COMBO_SALE`: unchanged, its one combo line only (T20).
- The SQL guard becomes: `visit_id` is NULL exactly for the two visit-less kinds; line kinds are checked per invoice kind. Phase 4 guards change only in Wave 2.

### 5.2 The line

A `PRODUCT` line copies, at finalization, product and variant ids, SKU, brand and category (historical, like the service category snapshot), VI/EN names, variant label, quantity (integer ≥ 1), unit price (effective, frozen), gross, seller. No cost is stored on the line. Quantity is not limited by `max_quantity` (service-only); it is limited by availability at finalization.

### 5.3 Seller (Q9, T5)

Required on every product line. Default = the invoice creator; changeable on a `DRAFT` to any **active staff member assigned to that branch**; one invoice can mix sellers (PRD §25). Seller correction after finalization is OQ-P6-25. Phase 6 only records the seller; commission is Phase 7.

### 5.4 Who can do what

Add/remove product lines, pick the seller, create a product-only draft: `SELL_PRODUCTS` at the branch. Finalize: `MANAGE_INVOICES`. Collect: `COLLECT_PAYMENTS`. Cancel: `CANCEL_INVOICES`. Voucher supply: `APPLY_DISCOUNTS`. Price is never selectable (PRD §23.4, P4 Q4 no free-form discount).

### 5.5 Referral and visits

A product-only purchase is not a visit and never satisfies the referral condition (PRD §20.3: "Product purchase alone does not replace the first qualifying completed Spa visit"). The Phase 5 rule (first completed visit, paid with money) is unchanged. A mixed visit invoice still qualifies through its service lines as today.

### 5.6 Customer view (T26)

`/account/invoices` shows product lines (name, variant, quantity, price, line total). Seller, cost, lot and internal codes are never exposed. A refunded line shows "Đã hoàn tiền" with its amount (no reason text, as for cancelled invoices).

## 6. Mixed invoices: Spa side and Beauty side (Q1, Q2, Q7; T17-T19)

PRD §18.1 and §61 forbid inventing the allocation of shared discounts and payments. The Owner decided it (Q1, Q2); this section turns those decisions into exact, deterministic rules. Everything is integer VND (`BigInt`).

### 6.1 Sides

`SPA` side = service lines (and the combo line). `BEAUTY` side = product lines. A side exists only if it has lines. Each side has its own: eligible subtotal, candidates, one winner, discount, net amount, wallet and points.

### 6.2 Candidates per side (Q1, Q7)

- **Spa side:** the Spa member discount (payer's Spa tier before the invoice), programs and vouchers with scope `SERVICES` or `BOTH`.
- **Beauty side:** the Beauty member discount (payer's Beauty tier before the invoice, T4), programs and vouchers with scope `PRODUCTS` or `BOTH`.
- A guest payer has no member candidate on either side. Code-less promotions are evaluated automatically; a voucher is a candidate only after its code is supplied (P4 OP-5, unchanged). Usage limits, validity, minimum spend (OP-4: on the eligible subtotal before the benefit) and the member-payer rule (OP-3) apply as in Phase 4.
- **Exactly one winner per side**; the largest amount wins; on an equal amount the **member discount wins** (P5-T6, extended to the Beauty side by T17), then program `code`, program id, voucher `code` ascending. No stacking inside a side.

### 6.3 Scope (Q7)

Each discount version gets a scope `SERVICES` / `PRODUCTS` / `BOTH`. Every existing program migrates to `SERVICES` so Phase 4/5 behavior is identical. `scopeMode` selection (all, or selected items) applies within the scope; whether PRODUCTS can target brands/categories/products is OQ-P6-21. The **birthday reward applies to the Spa side only** (Q7): its base is the Spa side after the Spa winner, its combination flags refer to the Spa winner, and a product-only invoice never has a birthday gift. P5-6 birthday rules are otherwise unchanged.

### 6.4 The proportional split primitive (T18)

For a total `D` split over ordered weights `w1…wn` (`W = Σ wk`): cumulative `Ck = floor((2·D·(w1+…+wk) + W) / (2·W))` (half up to 1 VND, Phase 4 Q3), `share_k = Ck − C(k−1)`, so `Σ share = D` exactly, the result is deterministic (order = invoice line sequence; sides in the order SPA, BEAUTY) and a zero weight gets zero. It is used for:

1. splitting a shared (BOTH) program's amount between the sides (weights = the sides' eligible subtotals);
2. allocating a side's discount to its lines (weights = line gross), giving each line a **net amount** (needed by refunds, Q3);
3. attributing each payment to the sides (weights = side net amounts, using the cumulative net paid so that the sides add up to the side net exactly when the invoice is fully paid, Q2);
4. the amount of a refund of some units of a line (weights = the line's units; the last unit takes the remainder).

### 6.5 A BOTH program, step by step

1. Eligible lines of both sides (inside its scope selection); eligible subtotal `E = E_spa + E_beauty`.
2. Eligibility is tested once on `E` (validity, minimum spend on `E` per OP-4, limits, payer rule).
3. Amount `A` on `E` exactly as Phase 4 (percent half up; fixed amount capped by `E`).
4. Split `A` with the primitive over (`E_spa`, `E_beauty`); each side sees its share as that program's amount.
5. Each side then picks its winner among its candidates. If the program wins on at least one side it is redeemed **once** for the invoice (usage counts once); only the sides it won receive its share.

A percentage BOTH program gives each side (±1 VND from rounding) the same result as a per-side percentage; a fixed amount is split by value. A SERVICES or PRODUCTS program is evaluated only on its own side with Phase 4 rules.

### 6.6 Net amounts, points and payments (Q2)

- Side net = side subtotal − side discount (Spa side also minus the birthday gift). Invoice total = Σ side nets (never negative per side).
- **Points per wallet:** `floor(side net / 1000)`, computed once per side on the side net, awarded at `PAID` only (PRD §18.1). Spa side to the Spa wallet, Beauty side to the Beauty wallet. Tips earn nothing (none exist before Phase 7). A guest payer earns nothing (P5-Q2).
- **Payments:** a split or partial payment is attributed to the sides pro-rata by side net with the cumulative rule (6.4, item 3); a reversal mirrors the attribution of the payment it reverses. Points never depend on which payment covered which side, because points are awarded only when the whole invoice is `PAID`; the attribution serves revenue by side, refund limits and Phase 8 reports.

### 6.7 Persistence changes (T19, made in the Wave 2 database Step, never in Wave 1)

- Discount application and redemption: one application row per (invoice, side); one redemption per (invoice, program) with release rows as today. Uniqueness moves from "per invoice" to these keys.
- `invoice_loyalty_snapshots`: one row per (invoice, wallet), each with its own balance before, tier, member amount, candidates, winner and eligible amount.
- New immutable line net allocation rows (invoice line, discount share, net) written at finalization; new immutable payment side allocation rows written with each payment and reversal.
- The invoice integrity trigger changes from "program benefit OR member amount" to: `discount_total = Σ side discounts + birthday gift`, each side's discount being its own winner (program share or member amount), never both on one side.
- `calculation_version = 3`: a draft created under v2 is recalculated at finalization under v3 (P5-T5 pattern); finalized v1 and v2 invoices are never recomputed. **Differential rule:** v3 on a Spa-only invoice (or any invoice with no product line) is byte-for-byte the v2 result.

### 6.8 Worked examples (all numbers checked)

Payer is Gold for Spa (4%) and Silver for Beauty (3%) unless stated. No program means the member discount wins on each side.

- **A (no program).** Spa 300,000, products 200,000. Spa: 4% = 12,000, net 288,000. Beauty: 3% = 6,000, net 194,000. Total 482,000. Points: 288 Spa, 194 Beauty.
- **B (shared fixed voucher 100,000, scope BOTH).** `E = 500,000`; shares 60,000 (Spa) and 40,000 (Beauty). Spa: member 12,000 against 60,000, the voucher wins. Beauty: member 6,000 against 40,000, the voucher wins. Net 240,000 and 160,000, total 400,000. Points 240 and 160. One redemption.
- **C (shared fixed voucher 30,000, scope BOTH; Beauty tier Ruby 9%).** Shares 18,000 and 12,000. Spa: member 12,000 against 18,000, the voucher wins. Beauty: member 9% of 200,000 = 18,000 against 12,000, the member wins. Net 282,000 and 182,000, total 464,000, discount 36,000. Points 282 and 182. The voucher is redeemed once and its Beauty share (12,000) is not used (OQ-P6-20).
- **D (line net).** Beauty lines 100,000 and 200,000, Beauty discount 30,000: cumulative shares 10,000 and 20,000, nets 90,000 and 180,000 (sum 270,000, 270 points).

## 7. Beauty loyalty (PRD §18, §28; T2, T4)

### 7.1 What changes from Phase 5

- The `loyalty` consumer earns on both wallets: `SPA_EARN:{invoice}:{paid_seq}` and `BEAUTY_EARN:{invoice}:{paid_seq}`; reversal on `INVOICE_REOPENED` and `INVOICE_CANCELLED(voidedPaidSeq)` reverses each earn entry once (`reverses_entry_id` unique); P5-Q1 (nothing before go-live) and P5-T9 (stale guard) apply to both wallets.
- The Beauty tier uses the same locked table (PRD §18.5, tier table version 1), independent of the Spa tier. The tier is read under the payer's wallet locks (sorted by user, wallet, both locked when both sides exist) and frozen in the per-wallet snapshot (6.7).
- The customer Beauty card replaces "Áp dụng khi Lucy Beauty mở bán" (`points.beautyDiscountPending` in `customer-loyalty.ts`) with the real tier percent (design 15.3 of Phase 5).
- New ledger kinds (names finalized in P6-8): `REFUND_REVERSAL` (PRD §28.6 `REFUND_ADJUSTMENT`) and an exchange earn (section 8.5). `REFERRAL_AWARD` is never reversed by any of them (PRD §20.4, §28.4).

### 7.2 Rules that do not change

1,000đ = 1 point, whole points, no expiry, points are not currency, tips earn nothing, the tier is read before the transaction, crossing a threshold never changes the current invoice, manual deductions above the balance are hard-blocked (P5-T8 rejected), reversals floor at 0 with a recorded shortfall (P5-Q5).

## 8. Returns, exchanges and refunds (PRD §28, §29; Q3-Q5, T21-T23)

### 8.1 The case

A **return case** records: the invoice and product line(s), reason (one of PRD §28.1 customer preference, §28.2 wrong product or shipping/packing damage, §28.3 skin irritation or reaction), the remedy (`EXCHANGE` or `REFUND`, recorded explicitly, PRD §28.4), the seal/packaging check, who bears shipping cost, evidence photos, free-text notes (no medical fields, no diagnosis, PRD §28.3), the restock decision (`SELLABLE` or `NOT_SELLABLE`) and its decider, and the outcome. Evidence photos are **private** (media storage, never served publicly, visible only to `MANAGE_PRODUCT_RETURNS` and `REFUND_PRODUCTS` holders at the branch). The 48-hour rule is T23. A new case notifies the `REFUND_PRODUCTS` holders at the branch (PRD §38.3 "Product return"). Services and combos have no refund and no return case (PRD §29).

### 8.2 Line state (Q5)

The invoice stays `PAID` (no new `InvoiceStatus`; `REFUNDED` is a **line** state). A line is `NOT_REFUNDED`, `PARTIALLY_REFUNDED` or `REFUNDED`, derived from the refunded units/amount against the line. A line can never be refunded for more than its net amount (6.4, item 2) or more units than sold.

### 8.3 Money (Q4, T22)

A refund is an immutable record: invoice, line, units, amount (line net share, rounding per 6.4 item 4), method `CASH` or `BANK_TRANSFER_MANUAL`, reason, actor, DB time, bank reference when a transfer. **No PayOS call, ever**, even when the original payment came through PayOS. Only holders of `REFUND_PRODUCTS` (BRANCH_CAPABLE at the invoice branch) with **fresh password re-authentication on every refund**, plus a reason. Payments stay immutable and are never reversed by a refund; a payment reversal (`CORRECT_PAYMENTS`) and an invoice cancellation are refused for an invoice that has any refund (T22), so a correction can never double an effect. The refund record is the hook the Phase 7 cash drawer will read; nothing else is done now.

### 8.4 Beauty points on a refund (Q3, PRD §28.6, T21, OQ-P6-19)

Per refunded line, the attributable amount is the line **net after discounts** (6.4, item 2). Proposed rule (A): points that should remain on the invoice's Beauty side after the refund = `floor((side net − Σ refunded line nets) / 1000)`; this refund's reversal = points earned − that remainder − points already reversed. A linked compensating entry (`reverses`/`corrects` unique per refund) is written asynchronously by the `loyalty` consumer on `PRODUCT_REFUNDED` (key `BEAUTY_REFUND:{refund_id}`); the original `+` entry is preserved. The Beauty balance and tier are recalculated; a refund-driven tier decrease is allowed and affects only later transactions; the Spa wallet is untouched; a referrer's award is never clawed back. A reversal larger than the balance follows P5-Q5 (floor at 0, shortfall recorded, listed in Exceptions); **a money refund is never blocked by points**. A guest payer earned nothing, so nothing is reversed.

Worked: 800,000đ side, `+800`; full refund 800,000đ leaves 0 remaining points, reverses 800 (`PURCHASE +800 → REFUND −800`); 5,200 (Diamond) becomes 4,400 (Platinum) exactly as PRD §28.6. Example D: refund the 90,000đ line from a 270,000đ side: 180 points remain, reverse 90.

### 8.5 Exchange points (PRD §28.5)

Original points are always kept. Higher replacement: additional Beauty points only on the eligible additional amount **actually paid**, at the normal rate (`floor(additional paid net / 1000)`, key `BEAUTY_EXCHANGE:{exchange_id}`). Same or lower value: no entry, nothing deducted. The mechanics of the additional payment and any difference returned are OQ-P6-24 and are not built until answered. The stock effect: the replacement leaves stock (`EXCHANGE_OUT`); the faulty item returns to sellable stock only if the case says `SELLABLE`.

## 9. Permissions (T24; nothing is seeded or granted; the Owner grants after deploy)

New codes are appended to the catalog (append-only, one migration each wave) and inserted by `pnpm db:permissions:sync`. Current count 54.

| Code                       | Scope          | Classification | Allows                                                                                                                             | Re-auth | Wave |
| -------------------------- | -------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| `MANAGE_PRODUCTS`          | GLOBAL_ONLY    | STANDARD       | Brands, categories, products, variants, images, status, suppliers, thresholds, expiry-warning setting                              | No      | 1    |
| `MANAGE_PRODUCT_PRICES`    | GLOBAL_ONLY    | FINANCIAL      | List price, promotional price and timing, early end, bulk price update (PRD §23.4); audited                                        | No      | 1    |
| `VIEW_PRODUCT_COST`        | GLOBAL_ONLY    | FINANCIAL      | See and enter cost price, receipt unit cost, margin (PRD §23.3)                                                                    | No      | 1    |
| `VIEW_INVENTORY`           | BRANCH_CAPABLE | STANDARD       | Stock levels, lots, movements, counts at the branch (never cost); recipient of low-stock and expiry alerts                         | No      | 1    |
| `MANAGE_STOCK_RECEIPTS`    | BRANCH_CAPABLE | FINANCIAL      | Create and confirm receipts at the branch (PRD §27.1)                                                                              | No      | 1    |
| `ADJUST_STOCK`             | BRANCH_CAPABLE | STANDARD       | Internal adjustments with a reason and physical counts at the branch (PRD §27.5-27.6)                                              | No      | 1    |
| `IMPORT_PRODUCT_DATA`      | GLOBAL_ONLY    | FINANCIAL      | Excel/CSV catalog and opening-stock import; a row that changes a price also needs `MANAGE_PRODUCT_PRICES`                          | No      | 1    |
| `SELL_PRODUCTS`            | BRANCH_CAPABLE | STANDARD       | Create a product-only draft, add/remove product lines, choose the seller, on a `DRAFT` at the branch (a KTV may sell, never price) | No      | 2    |
| `MANAGE_PRODUCT_RETURNS`   | BRANCH_CAPABLE | STANDARD       | Open and edit return cases, attach evidence, record the assessment and restock decision at the branch                              | No      | 3    |
| `REFUND_PRODUCTS`          | BRANCH_CAPABLE | FINANCIAL      | Approve and record a refund (cash or manual transfer) at the invoice branch; Owner or senior manager only by grant                 | Always  | 3    |
| `MANAGE_PRODUCT_CAMPAIGNS` | GLOBAL_ONLY    | FINANCIAL      | Full promotion campaigns (PRD §24.1), defined in its own Step                                                                      | No      | 3    |

Unchanged and reused: `MANAGE_DISCOUNTS` (now sets scope), `APPLY_DISCOUNTS`, `MANAGE_INVOICES`, `COLLECT_PAYMENTS`, `CANCEL_INVOICES`, `CORRECT_PAYMENTS`, `VIEW_INVOICES`, `VIEW_REVENUE`, `ISSUE_REWARDS` and `MANAGE_REWARD_CATALOG` (gift use and restore). A separate exchange-approval code exists only if the Owner chooses it (OQ-P6-24). Totals if all are added: 54 → 61 (Wave 1) → 62 (Wave 2: `SELL_PRODUCTS`) → 65 (Wave 3: returns, refunds, campaigns). Authorization is permission plus branch scope server-side, never role names; every command re-decides authority inside the transaction (P4 §11.2).

## 10. Events, idempotency, locking

### 10.1 Events and consumers

| Event / consumer                                        | Effect                                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `INVOICE_PAID`, `INVOICE_REOPENED`, `INVOICE_CANCELLED` | `loyalty`: Beauty earn and reversal as Spa. `inventory`: consumption and restoration (4.5)                                       |
| `PRODUCT_REFUNDED` (new)                                | `loyalty`: linked Beauty point reversal (8.4); `notifications`: refund exception to `CORRECT_PAYMENTS`/`REFUND_PRODUCTS` holders |
| `PRODUCT_RETURN_OPENED` (new)                           | `notifications`: manager notice (8.1)                                                                                            |
| daily inventory scan, stock crossing                    | in-app low-stock and expiry notices (4.6)                                                                                        |

Payloads carry ids and minimal facts, no personal data; consumers re-read authoritative state; `outbox_consumptions` `UNIQUE(event, consumer)` as in P4 §15.2.

### 10.2 Lock order (approved T3; the (branch, variant) sort key is the pending refinement in T13; extends P5-T12, never inverts it)

graph lock (shared) → `users` rows sorted by UUID → actor session → `visits` row → `invoices` row → `discounts` rows sorted by id → the payer's `users` row (key-share) → `loyalty_wallets` rows sorted by (user, wallet) → combo/reward rows sorted by id → **stock level rows sorted by (branch id, variant id)** → `payments`. The `inventory` consumer: event claim → `invoices` row → stock rows sorted. The refund command: invoice row → refund and line rows → stock rows (restock, synchronous). A lock that cannot be taken immediately maps to the retryable conflict (`55P03`, `40P01`, `40001`, `23505`). Timestamps come from the DB clock.

### 10.3 Idempotency keys

`BEAUTY_EARN:{invoice}:{paid_seq}`; earn reversal by `reverses_entry_id` unique; `BEAUTY_REFUND:{refund_id}`; `BEAUTY_EXCHANGE:{exchange_id}`; stock movement keys `SALE:{invoice_line}:{paid_seq}`, `SALE_REV:{invoice_line}:{paid_seq}`, `RECEIPT:{receipt_line}`, `GIFT:{grant}:{use_seq}`, `RETURN:{refund_or_case}:{line}`; one reservation per invoice line; one refund record per client request id (unique per actor); a duplicate attempt returns the stored result.

## 11. Public catalog and imports

### 11.1 Public read-only catalog (T8, Q15)

Public endpoints and pages for `PUBLISHED` products: list by category and brand, product page with images, VI/EN text, variants, effective price and the crossed-out list price while a promotion runs, "Hết hàng" when no active branch has available stock for the variant (T14), **never a quantity**, never cost. No cart, checkout, shipping or COD (T8). Same caching, SEO (metadata, sitemap, JSON-LD) and 60 s freshness pattern as the services pages. The page label and address are OQ-P6-27 (proposal: "Mỹ phẩm", `/products`); layout and states are in section 16.

### 11.2 Excel/CSV import (Q16, PRD §31)

Built early (P6-5), after the catalog and inventory exist: downloadable template; preview with valid, invalid, missing-required, duplicate-SKU, existing-to-update and new rows; the user must confirm before anything is applied (PRD §31.2); SKU is the matching key, internal ids stay internal; bulk image mapping by SKU filename (PRD §31.3); bulk price update by export, edit, re-import, preview of differences, confirm, audit (PRD §31.4); opening stock becomes `OPENING` movements per branch and lot. Large files run as background jobs (PRD §53). `IMPORT_PRODUCT_DATA` (and `MANAGE_PRODUCT_PRICES` for price rows). **The Owner supplies real prices, stock and suppliers; nothing is invented, nothing is seeded.** The website crawler and supplier importer remain Phase 9.

## 12. Load readiness for product sales (separate Step P6-7; Q18 option 2)

Timing is the Owner's: it runs after the public catalog Step and before the product pages go public. Inputs known today: 6 cores, 7.8 GB RAM, **no swap** (an out-of-memory kill is the failure mode, so process counts need a memory budget and a restart limit). The Step first measures, then changes only what the measurement justifies:

- Use all cores: **in Wave 1 only the `web` process is clustered** (it serves public pages and holds no payment logic). **The worker stays a single process** (the 21:30 and inventory schedulers and BullMQ jobs would otherwise run twice). Check Prisma pool size times process count against PostgreSQL `max_connections`.
- **Clustering the `api` process is not part of Wave 1 unless the Owner says so (OQ-P6-26).** The same process serves the POS, the PayOS webhook and re-authentication, and Q17 forbids Wave 1 from touching the payment/POS flow. A search of `apps/api/src` (non-test code) found no `setInterval`, no scheduled decorator and no module-level cache or lock; the only timer is a timeout in `infrastructure.service.ts`, and auth throttling is in PostgreSQL, so the API shows no sign of single-process state. That is a search result to be verified by a load and race test in P6-7, not a proof. If the Owner does not approve it for Wave 1, API clustering moves to Wave 2 (before P6-11).
- Cache public product pages and public product endpoints (the 60 s per-process memo becomes per-process in a cluster; use HTTP cache headers or one shared cache so stock and price freshness stays within 60 s).
- Rate limits for public read endpoints shared between processes (Redis is already running). Auth throttling already lives in PostgreSQL and is not moved.
- Gate: load test of product list and detail pages before and after, recorded in the Step report.

## 13. Execution sequence and waves (T25, pending approval)

Wave 1 must not touch payments or the POS flow (Q17): it contains no migration on `invoices`, `discounts`, `loyalty_*` or `payments`, and none of the Wave 2 permissions. The numbering differs from my first summary because Q16, Q17 and Q18 reordered it: Q18's "after P6-5" means after the public catalog Step, now P6-6.

| Step  | Content                                                                                                                                                                    | Wave |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| P6-1  | Design contract (this document)                                                                                                                                            | -    |
| P6-2  | Wave 1 database and permissions: catalog, price, inventory, import tables; the 7 Wave 1 permission codes. No invoice, discount, loyalty or payment table touched           | 1    |
| P6-3  | Catalog administration: brands, categories, products, variants, images, prices, simple promotions, cost privacy, audit                                                     | 1    |
| P6-4  | Inventory: suppliers, receipts, lots, movements, adjustments, counts, low-stock and expiry alerts                                                                          | 1    |
| P6-5  | Excel/CSV import: catalog, opening stock, bulk images, bulk price update (Q16)                                                                                             | 1    |
| P6-6  | Public read-only catalog with "Hết hàng" (pages built, not yet announced)                                                                                                  | 1    |
| P6-7  | Load readiness (Q18 option 2): web processes, public page caching, public rate limit; API clustering only if OQ-P6-26 is approved; then **Wave 1 deploy checkpoint**       | 1    |
| P6-8  | Wave 2 database: invoice kind and `PRODUCT` line, discount scope, per-side applications, per-wallet snapshot, allocations, reservation link, ledger kinds, `SELL_PRODUCTS` | 2    |
| P6-9  | Pricing engine v3 (pure engine, split primitive, differential test against v2)                                                                                             | 2    |
| P6-10 | Product lines at the POS: lines, seller, product-only invoices, reservation, consumption, customer invoice view                                                            | 2    |
| P6-11 | Beauty points, Beauty member discount, scope on the discount screens, Beauty card percent; **Wave 2 deploy checkpoint**                                                    | 2    |
| P6-12 | Returns: case records, private evidence, rules T23                                                                                                                         | 3    |
| P6-13 | Refunds per line with point reversal (`REFUND_PRODUCTS`, re-auth, exceptions)                                                                                              | 3    |
| P6-14 | Exchanges (after OQ-P6-24)                                                                                                                                                 | 3    |
| P6-15 | Product gift stock (Q10)                                                                                                                                                   | 3    |
| P6-16 | Full promotion campaigns (PRD §24.1; Q11 last)                                                                                                                             | 3    |
| P6-17 | Final check on scratch databases, deploy guides per wave; no deploy by me                                                                                                  | 3    |

Each Step: targeted tests, its own report, Owner review (CLAUDE.md). Deploy happens only when the Owner says so, wave by wave.

## 14. Deferred or outside Phase 6

PRD §22 threshold campaigns (Q12); inter-branch transfer (Q13); automatic costing method and margin reports (Phase 8); product commission (Phase 7); cash drawer and Phase 7 payroll links; Reviews (Phase 8); online checkout, shipping and COD (TBD); service or combo refunds (never, PRD §29); PayOS refunds (never in Phase 6, Q4); a point-priced reward program (never).

## 15. Testing strategy

- **Engine:** the four worked examples of 6.8 as fixtures; split-primitive properties (sums exact, deterministic, order-stable, zero weights); the differential test (no product line: v3 equals v2 for the Phase 4/5 fixtures); tie-breaks per side; birthday on the Spa side only.
- **Real-concurrency races:** two cashiers finalizing the last unit; finalization against cancel; consumption replay and stale episode (paid, reopened, cancelled orders); double refund of one line; refund against payment reversal and against cancel; two simultaneous receipts and counts; reserved/on-hand invariants under load.
- **Reconciliation:** `on_hand = Σ movements`, `reserved <= on_hand`, wallet balance `= Σ ledger` for both wallets, `Σ line nets = invoice total`, `Σ side attributions = payment`.
- **Replay tests** for every key in 10.3; additive-migration tests; a Wave 1 isolation test that fails if a Wave 1 migration touches the Phase 4/5 tables.
- **Security:** cost fields absent from every response without `VIEW_PRODUCT_COST`; public catalog never leaks cost, quantity, drafts or inactive products; evidence photos never served publicly; re-auth required for every refund; scope and DENY tests per permission.
- **Real data:** import preview/commit tested on a scratch database with the Owner's own file only.
- Whole-repo `pnpm test` before every push; integration and smoke only at the final Step or when the Owner asks (CLAUDE.md).

## 16. UI screens (Owner follow-up, 2026-10-07)

### 16.1 Reference for the public cosmetics catalog

Source: the Owner's Lovable prototype `https://pixel-perfect-render-8439.lovable.app/my-pham`, fetched as text and rendered at 360, 768 and 1440 px (light) and 1440 px (dark) with `scripts/uxui-screens.mjs` (images in `.local/uxui-screens/lovable-my-pham-*`, git-ignored). I opened the 1440 light and 360 light images; the 768 and dark images I did not open. The first text fetch missed the search box and the "Lọc" button; the images are the reference.
It is a **visual reference only**. Everything on it (products, names, prices, images, hero photo and text, phone, address, tagline) is a placeholder: **never imported, never seeded**; no code or package is copied; the page is rebuilt with our components and tokens.

What it shows: header; a rounded hero card with the eyebrow "LUCY BEAUTY SELECTION", a large serif headline and one sentence; a section header (eyebrow "Chọn riêng cho làn da Việt", title "Sản phẩm nổi bật", a count line, a search box "Tìm mỹ phẩm" and a sort select "Nổi bật"); on desktop a left column with the "Danh mục" radio list (Tất cả, Chăm sóc da, Trang điểm, Làm sạch & tẩy trang, Mặt nạ, Chống nắng, Chăm sóc cơ thể) and the box "Cam kết tại LUCY SPA" with three plain lines; a three-column grid; each card is a square cream image tile with a brand-red pill badge top left ("-15%" or "Mới"), the category in small grey text, the serif product name, the price in bold brand colour and the list price struck through. On a phone: search icon, "Lọc" and sort select in one row, two columns, the tab bar.

### 16.2 How it maps to our stack (Step P6-6)

- **Frame:** the shared site chrome (header, tab bar, footer, season band, contact button), `PublicPage` with the Back button, the same hero/band pattern as the home and services pages. The page has one `h1` (the hero headline). The hero image comes from the media library, or the brand panel when none is set (never the prototype's photo).
- **Section header:** text only, "Sản phẩm" (not "nổi bật", which would be wrong once a filter or another sort is chosen). No count beside it (rule of 2026-10-05); the count lives in the pagination line "Hiển thị x–y trong n".
- **Search and sort:** the kit list toolbar (no labels above), state in the URL (`?q&category&brand&sort&page`). Public search matches product name and brand; the SKU is not public.
- **Category filter:** desktop sidebar with the kit radio group; phone: the "Lọc" button opens the existing filter sheet. The categories are the Owner's product categories (nothing seeded); a brand filter appears only when more than one brand has published products.
- **Grid and card:** one kit `Card` surface per product, the whole card is the link with the shared hover and press motion, a fixed image ratio from the media variants, kit `Badge` for "-x%", "Mới" and "Hết hàng", category text, name, price, struck list price; a variant range reads "từ X ₫". Three columns beside the sidebar on wide screens, two on a phone. Money format as the rest of the site.
- **Paging:** 20 per page with the kit `Pagination` and server-side paging; filters and search run in the API (the catalog may hold hundreds of products, PRD §24.1).
- **Inherited without extra work:** VI/EN, light/dark/auto, season art, motion tokens and their reduced-motion rules, 44 px touch targets, SEO (metadata, canonical, hreflang, sitemap, JSON-LD), real 404 for anything unpublished.

### 16.3 Conflicts between the reference and the PRD or approved decisions (the PRD and decisions win)

| #   | In the reference                                                                                               | Conflict                                                                                                                                   | Resolution                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | No stock indicator on cards                                                                                    | P6-Q15: show "Hết hàng", never a quantity                                                                                                  | Add the "Hết hàng" badge on the card and the variant; never a number                                           |
| 2   | "12 sản phẩm phù hợp" under the title                                                                          | Owner rule 2026-10-05: headings are text only, counts live in the pagination line                                                          | Dropped; "Hiển thị x–y trong n" under the grid                                                                 |
| 3   | Header: Trang chủ, Dịch vụ, Mỹ phẩm, Đặt lịch, Lịch hẹn, Hóa đơn, account, CTA                                 | Approved header (Owner, 2026-10-03): no separate "Đặt lịch" item; Lịch hẹn and Hóa đơn for members only; no cosmetics item until its phase | Header and footer are not copied. Only a cosmetics item is added to the existing registry, subject to OQ-P6-27 |
| 4   | Address `/my-pham`                                                                                             | Our routes are English (`/services`); PRD §47 "Products"                                                                                   | OQ-P6-27                                                                                                       |
| 5   | Tab bar with five items, "Mỹ phẩm" label cut off                                                               | Our tab bar has 3 items (5 for members) with 44 px targets and no truncation                                                               | OQ-P6-27 proposes the entry for signed-out visitors only                                                       |
| 6   | Footer address, phone, tagline                                                                                 | Placeholders; ours come from the Owner-edited shop info                                                                                    | Never copied                                                                                                   |
| 7   | Hero stock photo, headline, sentence                                                                           | Placeholders; nothing invented                                                                                                             | Owner supplies image and text (OQ-P6-28); brand panel while empty                                              |
| 8   | Commitment box: "Sản phẩm chọn lọc rõ nguồn gốc", "Tư vấn phù hợp với tình trạng da", "Giá niêm yết minh bạch" | Business claims the Owner has not given; PRD §28.3: the software never attempts a skin assessment                                          | The box is Owner-supplied copy, hidden while empty (OQ-P6-28)                                                  |
| 9   | Sort "Nổi bật", badge "Mới"                                                                                    | PRD defines no featured or new rule                                                                                                        | OQ-P6-28                                                                                                       |
| 10  | "-13%" style badges                                                                                            | PRD §24 shows the crossed-out list price and the promotional price; the percent is display only                                            | Percent = round half up of (list − promotional) / list, shown only while a promotion is active                 |
| 11  | 12 products, no paging                                                                                         | A large catalog needs paging and server-side filters                                                                                       | 20 per page, kit `Pagination`                                                                                  |
| 12  | Phone hero: headline runs over the photo and is unreadable at 360 px                                           | Our gate needs readable text and no overlap                                                                                                | On a phone the text sits on a solid panel under the image; checked by the UX gate                              |
| 13  | Some targets under 44 px at 360 px (the page's own audit)                                                      | Our rule: 44 px touch targets (40 px desktop)                                                                                              | Ours meet the rule                                                                                             |
| 14  | Vietnamese only; a "Edit with Lovable" badge                                                                   | PRD §4.2: VI/EN                                                                                                                            | VI and EN; badge ignored                                                                                       |
| 15  | No product detail page, no buy button                                                                          | Matches T8 (view-only); a visitor still needs to know where to buy                                                                         | Detail page proposed in 16.4 with a "buy in the shop" panel from the shop info                                 |

### 16.4 Product detail page (no reference; proposed in the same style, pending the Owner's look)

- Breadcrumb and Back button (`Mỹ phẩm › category › product`), then a two-column layout on wide screens (gallery left, information right) and one column on a phone.
- **Gallery:** the main image with thumbnails from the product images (keyboard and swipe usable, alt text required in Vietnamese by the media rules).
- **Information:** category and brand text, the product name as the `h1` (serif), the price block (effective price, struck list price and the "-x%" badge while a promotion runs, "từ" for a range), a variant picker (kit `ChoiceCard` rows or segmented control, each showing its own price and "Hết hàng"), the Vietnamese or English description (one description field per language, PRD §23.2; no ingredients or usage fields are invented), the Owner-supplied commitment box.
- **Where to buy (T8, no cart, no quantity, no wishlist, no share):** a panel "Mua trực tiếp tại cửa hàng" with the shop address, hotline and hours from the shop info and the existing contact button. The wording is mine and needs the Owner's confirmation.
- **Related products:** up to four from the same category, derived from existing data.
- **States:** out of stock ("Hết hàng" on the product and on each variant), promotion, a real 404 for a draft or inactive product, JSON-LD `Product` with `offers` and `availability` InStock or OutOfStock (never a quantity).

### 16.5 Screen map

Staff screens follow the existing admin rules (page frame, `DataTable` and `Pagination`, forms as dialog, drawer or own page, FR1-FR15) and each UI Step runs the UX gate of `CLAUDE.md` (screenshots at 360, 768, 1440 light and 1440 dark, DOM audit, ratchet). **Only the public catalog list has a reference.** For every other screen the Owner may supply a reference before its Step; otherwise it is built on the kit and reviewed in the Step's screenshots.

| Screen                                                                                                                                        | Step         | Reference   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------- |
| Public catalog list `/products` (hero, search, sort, categories, commitment box, grid, paging)                                                | P6-6         | **Lovable** |
| Public product detail page                                                                                                                    | P6-6         | None (16.4) |
| Header and tab bar cosmetics entry; Owner-editable hero, commitment text, featured and new settings (Shop info tab)                           | P6-6         | None        |
| Products list; product create and edit page (long form) with variants, images, price versions, status                                         | P6-3         | None        |
| Brands and categories tabs; simple promotion drawer; cost visibility                                                                          | P6-3         | None        |
| Suppliers; stock levels per branch; receipts (list, create page); lots and expiry; movements; adjustments dialog; count session page          | P6-4         | None        |
| Low-stock and expiry notices (existing notification center); expiry-days setting                                                              | P6-4         | None        |
| Excel/CSV import: template, upload, preview table (valid, invalid, duplicates, new, update), confirm, history; bulk images; price update diff | P6-5         | None        |
| Product picker and product lines on a draft invoice; seller select; out-of-stock error state; start a product-only invoice                    | P6-10        | None        |
| Invoice detail with Spa side and Beauty side (per-side candidates, winner and reason, discount shares)                                        | P6-10, P6-11 | None        |
| Customer invoice detail with product lines; Beauty card with the real tier percent                                                            | P6-10, P6-11 | None        |
| Discount program form: scope SERVICES / PRODUCTS / BOTH and product targeting                                                                 | P6-11        | None        |
| Return cases (list, case page, private evidence upload); refund dialog with password re-entry; exchange                                       | P6-12-P6-14  | None        |
| Gift stock when marking a gift used or restoring it                                                                                           | P6-15        | None        |
| Full promotion campaigns (bulk select, schedule, preview, banner and popup link)                                                              | P6-16        | None        |
| Load readiness (P6-7)                                                                                                                         | P6-7         | No screen   |

## 17. Verification of this document

Read for this contract: `CLAUDE.md`, `LUCYSPA_HANDOFF.md`, `docs/PHASE5_LOYALTY_COMBOS_DESIGN.md`, PRD §3, §14, §16, §18-23, §24.1, §25-31, §38.3, §53, §56, §59-62; `packages/database/prisma/schema.prisma` (invoice, line, discount, application, redemption, loyalty snapshot, birthday, reward kind enums and models);
`packages/database/src/permission-catalog.ts` (54 codes); `docs/PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md` §7, §8, §11, §14, §15; `apps/api/src/auth/auth-throttle.service.ts`; `apps/web/next.config.ts`; the public endpoint cache headers.
Added on 2026-10-07 for section 16: the Lovable prototype (text fetch plus screenshots at 360 and 1440 px light opened), PRD §52 and the §56 Phase 8 list (one line added by the Owner's authorization).
Not verified: the pm2 configuration and `max_connections` on the server (not in the repository; to be read in P6-7); the absence of a general public rate limit (a search, to be re-checked in P6-7). No code, schema, migration, permission or server was changed by P6-1.
