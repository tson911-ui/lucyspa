# Phase 9 (P9-1): automatic product import from supplier sources, design

Status: **design only, 2026-10-10. No code, no migration.** Every technical proposal below (P9-Tn) is **pending Owner approval**; nothing here is approved until the Owner says so in his own words. The Owner questionnaire is in section 15 (Vietnamese). Requirements come from PRD 30.1-30.9.14, 31.1-31.4 and section 56 (Phase 9). Locked rules (no auto-publish, no auto-price, supplier data separate from Lucy-curated data, failure isolation) are restated in section 1 and are not reopened here.

## 1. Fixed rules (from the PRD; not up for design)

1. The Lucy Beauty catalog is the source of truth. A supplier source is only an external information source (30.9.13).
2. Nothing the crawler finds becomes live on its own: `source -> staging -> validation -> duplicate check -> preview -> Owner approval -> catalog` (30.2).
3. A source price is **never** the selling price, and never silently changes one (30.5, 30.9.11). New products stay `DRAFT` until price and required sales fields are set.
4. A product missing from a source is never deleted or deactivated because of that (30.9.11, 30.9.13). A failed scan is never read as "everything was removed".
5. Content sync never overwrites Lucy-owned fields (price, stock, commission, curated text) (30.6).
6. Only authorized sources (30.9, section 12 below).
7. Money is integer VND; timestamps UTC; authorization is permission-based and server-side (CLAUDE.md).

## 2. What exists today (reuse, do not rebuild)

| Need               | Existing piece                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog            | `brands`, `product_categories` (tree), `products` (status `DRAFT/PUBLISHED/INACTIVE`, `source` JSONB, `name_vi/en` NOT NULL), `product_variants` (unique `sku`, `barcode`, `cost_price_vnd`), `product_price_versions` (append-only list price), `product_images` -> `media_assets` |
| Images             | Media library pipeline (`apps/api/src/website/media.processing.ts`): magic-byte sniff (JPEG/PNG/WebP only), 10 MB and 6000 px limits, `sharp`, three WebP variants (320/960/1920), unique `sha256` so identical files dedupe                                                        |
| Excel/CSV fallback | P6-5 `product_import_jobs/rows` + `/api/v1/product-imports` (preview, confirm, `IMPORT_PRODUCT_DATA`); kinds `CATALOG`, `OPENING_STOCK`, `PRICE_UPDATE` (price update is declared but not built)                                                                                    |
| Stock              | Receipts, lots, `stock_movements`; the importer never writes these                                                                                                                                                                                                                  |
| Suppliers          | `suppliers` table (name, contact), used by receipts and `usual_supplier_id`                                                                                                                                                                                                         |
| Background work    | `apps/worker` (BullMQ, outbox consumers, interval loops); in-app Notification Center only                                                                                                                                                                                           |
| Permissions        | `MANAGE_PRODUCTS`, `MANAGE_PRODUCT_PRICES`, `VIEW_PRODUCT_COST`, `IMPORT_PRODUCT_DATA`                                                                                                                                                                                              |

## 3. Sources and adapters

**P9-T1 (proposed): prefer the least fragile, most clearly authorized channel, in this order.** The order is also the order we try them for each supplier.

1. **Supplier-provided file or feed** (Excel, CSV, ZIP + manifest, price list by email). Most reliable and the clearest permission. Reuses the P6-5 reader; Phase 9 adds ZIP images (31.3).
2. **Supplier API or machine-readable catalog** (official API, public `products.json`-style endpoint, `sitemap.xml` plus schema.org `Product` JSON-LD). Structured, stable, cheap to read.
3. **Website HTML adapter** (per-source selectors). Needed when 1 and 2 do not exist. Breaks when the site changes.
4. **Headless browser** (only if the catalog is rendered by JavaScript). Last resort: slow, heavier, easier to get blocked. Off unless a source needs it.

**Adapter contract** (`packages/server`, pure functions, no DB): `discover(source) -> SourceRef[]`, `fetchRecord(ref) -> SourceProductRecord` (normalized: `sourceKey`, `name`, `sku`, `model`, `barcode`, `brandText`, `categoryPath[]`, `priceVnd?`, `promoPriceVnd?`, `currency`, `descriptionText`, `attributes{}`, `imageUrls[]`, `url`, `raw` hash), `health(source)`. One adapter per source type; a generic JSON-LD adapter first, source-specific ones added only when a real source needs it (30.8, 30.9.14). **A source is `READY` only after Test Source** shows a correct sample (name, SKU, price, images, category, URL) and a person confirms it.

Source statuses (30.9.14): `PENDING_VALIDATION`, `READY`, `ADAPTER_REQUIRED`, `AUTHENTICATION_REQUIRED`, `SOURCE_ERROR`, `DISABLED`. We never log in to a supplier site, solve captchas or get around blocking; a source that needs that is `AUTHENTICATION_REQUIRED` and waits for an official feed.

**Fetch safety** (worker only; the API never fetches third-party URLs): host allow-list taken from the source's configured URL; block private, loopback and link-local addresses after DNS resolution (SSRF); re-check every redirect; 15 s timeout, 5 MB page and 10 MB image cap, content-type and magic-byte checks; follow `robots.txt`; at most 1 request per second per host with an identifying User-Agent that has a contact address; descriptions are stored as plain text (tags stripped), never as HTML.

## 4. Data model (proposed, additive; first migration in P9-2)

Existing `suppliers` stays the supplier organization (**P9-T2**: reuse it, add sources under it). New tables (names provisional):

- `supplier_sources`: `supplier_id`, `kind` (`FILE|API|WEBSITE|FEED`), `base_url`, `adapter_key`, `status`, `scan_cadence` (`MANUAL|DAILY|WEEKLY`, default `MANUAL`), `permission_note`, `permission_confirmed_by/at` (section 12), `last_success_at`, `last_scan_id`, `row_version`.
- `import_scans`: one row per run: `source_id`, `trigger` (`MANUAL|SCHEDULE`), `started_at/finished_at`, `status` (`RUNNING|SUCCEEDED|PARTIAL|FAILED|SUSPECT`), counts per change type, `errors` JSONB, `actor_user_id` (null = schedule). This is the import history of 30.7.
- `source_records`: current view of one supplier product on one source: `(source_id, source_key)` unique, normalized fields, `content_hash`, `price_hash`, `images_hash`, `first_seen_at`, `last_seen_at`, `missing_scans`, `state`.
- `source_price_observations`: append-only `(source_record_id, scan_id, price_vnd, promo_price_vnd, currency, original_amount)`; different prices on different sources are kept side by side, never merged (30.9.11).
- `import_candidates`: the Lucy-side draft: proposed `name_vi/en`, `description_vi/en`, brand and category (matched id plus the source text), proposed variants, `state`, `warnings` JSONB, `matched_product_id?`, `reviewed_by/at`, `decision`.
- `candidate_sources`: link candidate <-> `source_records` (many sources per product; `match_kind` `EXACT|MANUAL|FUZZY`).
- `candidate_images`: `candidate_id`, `media_asset_id`, `source_url`, `sort_order`, `sha256`, `phash`.
- `source_value_mappings`: remembered answers ("supplier brand text 'THE WHOO' = brand X", "category path -> category Y"), so the Owner maps each value once.

No change to `products` columns is required. `products.source` (JSONB) gets a small provenance object on approval: `{ supplierId, sourceId, sourceKey, url, importedAt }`.

## 5. Mapping to the catalog

| Source field                   | Lucy target                            | Rule                                                                                                                                                      |
| ------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name                           | `products.name_vi` (and `name_en`)     | `name_en` is NOT NULL: **P9-T3** = start equal to the Vietnamese name and flag `NEEDS_TRANSLATION` (ask Owner, Q4)                                        |
| SKU / model                    | `product_variants.sku` (unique, 64)    | the stable business key; deterministic code `products.code` = slug of brand + model                                                                       |
| barcode                        | `product_variants.barcode`             | checked against existing variants                                                                                                                         |
| brand text                     | `products.brand_id`                    | matched through `source_value_mappings`; **never auto-created** (as in P6-5): an unknown brand is a review item with "create brand" for `MANAGE_PRODUCTS` |
| category path                  | `products.category_id`                 | same: mapped or reviewed, never silently created                                                                                                          |
| description, usage, attributes | `description_vi/en`                    | text only; sections joined with headings                                                                                                                  |
| variants (size, volume)        | `product_variants` (`label_vi/en`)     | one variant per SKU                                                                                                                                       |
| images                         | `product_images` + `media_assets`      | section 7                                                                                                                                                 |
| source price                   | `source_price_observations` only       | reference; see section 6                                                                                                                                  |
| source URL                     | `products.source`, `candidate_sources` | traceability                                                                                                                                              |
| stock                          | **not imported**                       | stock only enters through receipts and opening-stock import                                                                                               |

Approval creates the product as `DRAFT` (or, for a matched existing product, updates **only** supplier-owned content fields the reviewer ticks) in one transaction with an audit entry. Publishing stays the existing action and its existing validation (`PRODUCT_HAS_ERRORS`).

## 6. Price handling

1. Every observed price is stored per source and per scan (section 4). Nothing reads it automatically into `product_price_versions`.
2. **P9-T4 (proposed): selling-price suggestion, never automatic.** The reviewer can set a rule per brand or category (markup % over the supplier price, rounded to 1,000 VND, integer VND) and the review screen shows "suggested price". Applying it creates a normal price version (`reason` = "import suggestion") and needs `MANAGE_PRODUCT_PRICES`; bulk apply is allowed but is one explicit confirmed action with a preview.
3. Whether the supplier price is a wholesale cost or a recommended retail price, and whether it includes VAT, is **not assumed**: the Owner answers (Q6). The supplier price is written to `cost_price_vnd` only if the Owner says it is the cost, and only with `VIEW_PRODUCT_COST`-level permission.
4. A later price change on the source becomes `PRICE_CHANGED` with a review card: current Lucy price, old and new source price per source, optional suggestion. The live price changes only on approval.
5. Foreign-currency sources: keep original amount and currency in the observation; VND is derived with a rate the reviewer confirms. No silent conversion.

## 7. Images

Download in the worker, run through the existing media pipeline (sniff, limits, sharp, WebP variants). Order = source order; up to a cap per product (default 6, Q10). Filenames: `original_filename` = `brand-model-sku-01`, `-02` ...; storage keys stay hash-based as today. Duplicates: exact by `sha256` (free, the table is unique), near-duplicates by a 64-bit perceptual hash (`phash`) compared inside one candidate and across candidates of the same brand. A failed image never blocks the candidate; it gets the warning `IMAGE_MISSING` and the existing "no image" state. **P9-T5 (proposed):** create the `media_assets` row at download time so the review screen uses the normal image URLs and dedupe is automatic; the media library gets an "unused" filter. Images are the most legally sensitive item (section 12): downloaded only for sources whose permission note covers images.

## 8. Duplicate detection and matching

Layered, strongest first; the first hit decides, and a title alone never merges:

1. `(source_id, source_key)` already known -> same source record.
2. SKU or barcode equals an existing Lucy variant -> candidate is linked to that product (update path, not a new product).
3. Same normalized `brand + model/SKU` across sources -> same candidate (one product, several `candidate_sources`).
4. Same normalized name + brand + size/volume -> `POSSIBLE_DUPLICATE` (never automatic).
5. Image `phash` match with a different identifier -> `POSSIBLE_DUPLICATE`.

`POSSIBLE_DUPLICATE` is resolved by a reviewer with **Merge / Keep separate / Ignore**; the choice is remembered. **P9-T6 (proposed):** name similarity is computed in the worker (normalized tokens, Vietnamese diacritics folded), not with a new PostgreSQL extension, so no `CREATE EXTENSION` is needed on production.

## 9. Review-before-publish flow

States: `DETECTED -> EXTRACTED -> NORMALIZED -> MATCHED -> READY_FOR_REVIEW | NEEDS_REVIEW -> APPROVED | REJECTED | IGNORED -> IMPORTED`. Warnings that force `NEEDS_REVIEW`: unmapped brand or category, missing name or SKU, `POSSIBLE_DUPLICATE`, `IMAGE_MISSING`, price missing or zero, description empty, translation missing. A fully mapped candidate with no warning is `READY_FOR_REVIEW`.

Screen (admin, Mỹ phẩm > "Nhập từ nhà cung cấp"; `Page` + `PageHeader`, tabs, `DataTable` 20 per page, Drawer for one candidate, Dialog for confirmations, as in the UX gate): **Nguồn** (sources, Test Source, enable, cadence), **Chờ duyệt** (filter by state and warning), **Lần quét** (history), **Thay đổi** (re-sync items). The candidate drawer shows images, mapped brand and category, SKU, source prices per source, suggested price, warnings, source links. Actions: Approve, Reject, Ignore, and bulk **"Duyệt tất cả sản phẩm sẵn sàng"** that acts on `READY_FOR_REVIEW` only, after a preview dialog stating the count; warnings and exceptions are reviewed separately. A rejected or ignored candidate does not return unless the source record's content hash changes.

## 10. Re-sync and change detection

Each scan compares hashes with `source_records`: `NEW`, `UNCHANGED` (no work, no notification), `PRICE_CHANGED`, `CONTENT_CHANGED`, `IMAGE_CHANGED`, `SOURCE_REMOVED` (per source), `POSSIBLE_DUPLICATE`, `NEEDS_REVIEW`. Rules:

- **Removal guard (P9-T7, proposed):** `SOURCE_REMOVED` is only raised after the record is missing from **3 consecutive healthy scans**. A scan is `SUSPECT` (removals ignored, previous data kept, source flagged unhealthy) when it fails, or finds fewer than 70% of the last successful scan's records. A temporary outage never marks anything removed.
- "Removed" means "not found on source A", not "the supplier dropped it"; only when absent from every enabled source of the supplier is the product listed as absent from all known sources, and even then only a review item is created.
- Content or image changes are staged and shown as a diff; curated Lucy text is never overwritten without the reviewer ticking the field.
- Failure isolation: each source is scanned in its own job; one failing source does not affect the others (30.9.13).
- Scheduling: one BullMQ repeatable job per source with `scan_cadence` from the source row (default `MANUAL`), concurrency 1 per source, run as a system actor that can only create candidates and observations. A summary notification ("Có cập nhật từ nhà cung cấp: 15 mới, 8 đổi giá, ...") goes to holders of the review permission through the existing outbox and in-app Notification Center; no message when nothing changed.

## 11. Permissions and audit (proposed; P9-T8, pending approval)

Reuse: `IMPORT_PRODUCT_DATA` for file imports (unchanged), `MANAGE_PRODUCT_PRICES` to apply any price, `VIEW_PRODUCT_COST` for cost, `MANAGE_PRODUCTS` to publish. Two new permissions (66 -> 68, an additive migration in P9-2): `MANAGE_SUPPLIER_SOURCES` (add or edit a source, record the permission, Test Source, enable, set cadence, run a scan) and `REVIEW_SUPPLIER_IMPORTS` (view candidates, edit content, map brand and category, approve, reject, ignore; cannot touch prices). Neither is granted to anyone by the migration; the Owner grants them on the roles screen, as with the Wave 4 permissions. Checks are server-side by permission, never by role name. Every approval, rejection, merge, mapping and price application writes the audit log (actor, before/after, source and scan ids). Import history is never deleted.

## 12. Legal and scraping notes (not legal advice)

- **Written permission first.** PRD 30.9 allows only sources Lucy Spa is authorized to use. Product photos, descriptions and brand text are usually protected by copyright (Luật Sở hữu trí tuệ) and by the site's terms of use; reading a page is not the same as having the right to republish it. **P9-T9 (proposed gate):** a source cannot be enabled until `permission_note` (who gave permission, how, date, which content: text, images, prices) and the confirming user are recorded; images are downloaded only when the note says images are covered.
- Prefer an official feed or price list over scraping; ask the supplier for one first (Q1-Q2). Scraping a site against its terms, or after the owner says no, can lead to claims or blocking.
- Respect `robots.txt`, rate limits and any anti-bot measure; do not bypass logins, captchas or paywalls. Wholesale or members-only prices are confidential supplier information: never shown publicly.
- Brand names and logos are trademarks; use them only as the supplier allows. A lawyer should read the permission wording once before launch.
- No personal data is collected (products only). Do not import reviews or customer comments from supplier sites.

## 13. Risks

| Risk                                                                               | Mitigation                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No permission or permission withdrawn                                              | Gate in section 12; source can be disabled at once; imported data stays but no more scans                                                                                                   |
| Site changes, adapter breaks                                                       | `SUSPECT` scans, health status, previous data kept, nothing removed                                                                                                                         |
| Wrong price read (cost vs retail, VAT, currency)                                   | Price never goes live automatically; suggestions need confirmation; Q6 answers recorded                                                                                                     |
| Wrong image on a product                                                           | Image tied to its source record; reviewer sees images in the drawer; phash and hash dedupe                                                                                                  |
| Duplicate or merged products                                                       | Strong identifiers only; fuzzy matches are reviews; merge is explicit and logged                                                                                                            |
| Malicious or broken source content (HTML, huge files, redirects to internal hosts) | Plain-text only, size caps, SSRF guard, magic-byte image checks                                                                                                                             |
| AI classification is wrong or follows instructions hidden in page text             | **P9-T10 (proposed): no AI in the first version;** rules plus remembered mappings. AI only later, optional, low-confidence results always go to review, page text treated as untrusted data |
| Load on the supplier or on our server                                              | 1 request/second, scheduled off-peak, concurrency 1 per source, image work in the worker                                                                                                    |
| Storage growth                                                                     | Cap images per product, dedupe by hash, "unused media" filter; no deletion in Phase 9                                                                                                       |
| Bulk ingestion before the process is proven                                        | Follow PRD 30.9 order: small sample from **every** source first (proposal: 20 products per source), check duplicates, images and re-sync, Owner review, then bulk                           |

## 14. Proposed build steps (each waits for Owner approval)

P9-1 this design. P9-2 migration (tables, 2 permissions) and source configuration screen with the permission gate. P9-3 generic adapter + Test Source on one real source (or a file source). P9-4 image pipeline. P9-5 normalization, mapping memory, duplicate detection. P9-6 review screen and approval. P9-7 re-sync, change detection, schedule, notification. P9-8 ZIP bulk images and bulk price export/re-import (31.3, 31.4, finishing `PRICE_UPDATE`). P9-9 sample validation across all sources, then Owner review. P9-10 milestone and deploy guide. The online store stays OFF until the Owner opens it after Phase 9.

---

## 15. Câu hỏi cho chủ (trả lời ngắn là được; có "Đề xuất" thì chỉ cần nói "đồng ý" hoặc sửa)

Chưa có câu nào được xem là đã duyệt cho đến khi chủ trả lời bằng lời của mình.

1. **Nhà cung cấp và website.** Lucy Beauty lấy hàng của nhà cung cấp nào? Cho em địa chỉ từng website (có thể nhiều website cho một nhà cung cấp) và thương hiệu trên đó.
2. **Giấy phép.** Nhà cung cấp đã đồng ý bằng văn bản (email, tin nhắn, hợp đồng) cho Lucy Spa dùng chữ, ảnh và giá trên website của họ chưa? Đồng ý cho những gì: chữ mô tả, ảnh, giá? Họ có sẵn tệp Excel, bảng giá hay đường dẫn dữ liệu chính thức không? _Đề xuất: xin tệp hoặc dữ liệu chính thức trước, chỉ đọc website khi không có._
3. **Lấy những thông tin nào.** Tích những gì cần: tên, mã sản phẩm (SKU), mã vạch, thương hiệu, nhóm, mô tả, thành phần, cách dùng, dung tích, ảnh, giá. _Đề xuất: tất cả trừ tồn kho._
4. **Tên tiếng Anh.** Website nhà cung cấp có tiếng Anh không? Nếu không, tạm để tên tiếng Anh giống tên tiếng Việt và đánh dấu "cần dịch" được không?
5. **Số ảnh.** Mỗi sản phẩm lấy tối đa mấy ảnh? Dùng ảnh của nhà cung cấp hay Lucy Spa tự chụp lại một phần? _Đề xuất: tối đa 6 ảnh._
6. **Giá.** (a) Giá trên website nhà cung cấp là giá nhập (giá vốn), giá bán lẻ đề xuất hay giá đã gồm VAT? (b) Giá bán của Lucy Spa đặt thế nào: tự nhập từng sản phẩm, hay cộng thêm một tỷ lệ % lên giá nhà cung cấp (bao nhiêu %, theo thương hiệu hay theo nhóm)? (c) Làm tròn đến 1.000 đồng hay 10.000 đồng? _Đề xuất: hệ thống chỉ gợi ý giá, chủ xác nhận, không tự đổi giá bán._
7. **Ai duyệt.** Chỉ chủ duyệt, hay có thêm quản lý? Ai được đặt giá? Duyệt từng sản phẩm hay có nút "duyệt tất cả sản phẩm sẵn sàng"? _Đề xuất: quản lý được duyệt nội dung và ảnh; chỉ chủ (hoặc người chủ cấp quyền) được đặt giá._
8. **Tần suất kiểm tra.** Kiểm tra cập nhật bằng tay khi cần, hằng tuần hay hằng ngày? Giờ nào? Thông báo trong ứng dụng khi có thay đổi là đủ chưa? _Đề xuất: bằng tay lúc đầu, sau đó hằng tuần ngoài giờ làm._
9. **Sản phẩm biến mất khỏi website.** Chỉ báo cho chủ xem, không tự ẩn hay xóa sản phẩm trong Lucy Beauty. Đồng ý không?
10. **Nhà cung cấp đổi giá.** Chỉ báo "giá nhà cung cấp đã đổi" để chủ xem rồi mới đổi giá bán. Đồng ý không?
11. **Tồn kho.** Chỉ nhập tồn kho bằng phiếu nhập hàng như hiện nay, không lấy số tồn từ website nhà cung cấp. Đồng ý không?
12. **Số lượng và thử trước.** Dự kiến khoảng bao nhiêu sản phẩm? Thử trước với bao nhiêu sản phẩm mỗi website? _Đề xuất: 20 sản phẩm mỗi website, chủ xem kỹ rồi mới lấy hàng loạt._
13. **Sản phẩm đã có sẵn.** Một số sản phẩm đã nhập bằng Excel. Nếu website nhà cung cấp có cùng sản phẩm, giữ dữ liệu đang có của Lucy Spa và chỉ thêm những gì còn thiếu (ảnh, mô tả)? _Đề xuất: giữ dữ liệu của Lucy Spa, không ghi đè._
14. **AI hỗ trợ phân loại.** Có muốn dùng AI để gợi ý nhóm và thương hiệu không? Có thể tốn phí và có thể sai (luôn chờ chủ xem). _Đề xuất: bản đầu không dùng AI._
15. **Ai làm việc với nhà cung cấp.** Ai là người liên hệ xin phép và gửi lại giấy phép để em ghi vào hệ thống?
