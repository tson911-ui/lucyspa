# Phase 4 Step 4 — POS Database Foundation + Permissions

Status: **CLOSED / OWNER APPROVED — implemented, validated locally, checkpoint-committed and pushed (`feat: complete phase 4 step 4 pos database foundation`), not deployed to production.** The five Owner-approved decisions of section 18 are preserved exactly. Step 5 has NOT started; Q7 and Q8 remain unresolved.
Contract: [PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md](PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md) (Step 1, `71c9286`), Step 2
[PHASE4_STEP2_VISIT_COMPLETION.md](PHASE4_STEP2_VISIT_COMPLETION.md) (`a30ae9a`), Step 3
[PHASE4_STEP3_STAFF_ADDED_SERVICE.md](PHASE4_STEP3_STAFF_ADDED_SERVICE.md) (`6a9eb30`). Locked decisions Q0–Q6, Q9–Q10 and OP-1…OP-7 are
untouched; Q7 (before Step 8) and Q8 (before Step 10) remain open and did not block this Step.

## 1. Scope and boundary

Step 4 is the **database and authorization foundation** of Phase 4. It creates the persistent structures the approved contract schedules for
this Step (design sections 4.1–4.5, 4.9, 19 row 4) and the guards that make the approved rules impossible to violate. It does **not**
implement any workflow: no invoice is created, priced, finalized, cancelled or paid; no discount is calculated or redeemed; no payment is
collected or reversed; no PayOS; no POS/checkout/history/notification UI; no revenue; no tip; no e-invoice; no Phase 5–8 behavior. The only
application code touched is the minimum the foundation requires: the permission catalog, the FINANCIAL audit classification, the
per-service quantity limit (catalog + the four line-creation paths), and labels in the existing role editor.

## 2. Repository facts discovered

- The design contract already schedules **all** tables of sections 4.1–4.5 for Step 4 ("Tables are created in Step 4"; section 19 row 4
  "(c) tables of sections 4.1–4.5 (cash shape), guards, reconciliation trigger, indexes"; section 22 "Step 4 creates
  `discount_redemptions` and `discount_redemption_releases`"). Nothing was added beyond that list.
- Permissions are code-owned (`packages/database/src/permission-catalog.ts`), enum values are added by an enum-only migration and rows by the
  operator sync (`pnpm db:permissions:sync`); the Owner (`kind = OWNER`) is virtual and holds everything, every other user only what is
  granted. No default role grants exist for any existing code, and none were added.
- Catalog semantics are a SQL CHECK (`permissions_catalog_semantics`, replaced in Phase 2/3); a GLOBAL_ONLY code cannot be overridden below
  GLOBAL scope (trigger `lucy_check_override_scope_capability` reads `permissions.scope_capability`; `role-admin.service.ts` derives its
  GLOBAL_ONLY set from the catalog) — so the two new GLOBAL_ONLY codes needed no engine change.
- Audit classification is consumed in exactly two places: the catalog sync/CHECK and `auditVisibility` (`audit-read.service.ts`), which is
  fail-closed: a classification with no visibility rule is never shown.
- Phase 3 already snapshots code, names, duration, price range and unit on booking and visit lines and guards them as immutable
  (`lucy_guard_booking_child`, `lucy_guard_visit_service_line`). A visit line has **no** quantity (Step 3).
- Money is `BIGINT` VND, business dates are `lucy_branch_local_date(branch, instant)`, permanent history uses
  `lucy_reject_permanent_history_mutation()`, idempotency is a client UUID unique per actor, locking is row-level `FOR UPDATE`.
- The invoice tables need a COMPLETED visit with DONE lines; a COMPLETED visit and its lines are immutable (Phase 3 guards), so an invoice
  can rely on them without further locking.
- The Owner's list for this Step included a `REFUNDED` invoice state. The approved contract does **not** define it for Phase 4: section 5.1
  has four states and section 21 defers `REFUNDED` to Phase 6 (services are non-refundable, PRD 29). It was not created (adding an enum value
  later is additive).

## 3. Approved contract, exactly as built

| Contract                                    | Built in Step 4                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q9 permissions, FINANCIAL, GLOBAL_ONLY x2   | Nine codes; `MANAGE_DISCOUNTS`, `CREATE_VOUCHERS` GLOBAL_ONLY; `DataClassification.FINANCIAL`; nothing granted                                     |
| Q2 one Visit -> one active Invoice, payer   | Partial unique index (`status <> 'CANCELLED'`); `payer_user_id` (customer account or NULL guest) on the invoice; one invoice per visit, no split   |
| Q3 integer VND, half-up                     | `BIGINT` everywhere, CHECKs, Q3 formula CHECK on the stored discount amount                                                                        |
| Q4/OP-3/OP-4/OP-5/OP-7 discount persistence | 9 tables, append-only history, one benefit and one redemption per invoice, release rules, OP-3 member requirement, usage limits under the row lock |
| Q5/Q6/OP-6 cash                             | `payments` (cash shape), append-only `payment_corrections`, server clock, split by several rows, no zero-VND payment, idempotency per collector    |
| OP-1 per-service quantity limit             | Section 4                                                                                                                                          |
| OP-2 / OP-7 zero balance                    | Section 10                                                                                                                                         |
| Q10 identity, e-invoice boundary            | Section 11                                                                                                                                         |

## 4. Quantity / quantityLimit persistence decision (OP-1)

**Decision:** the per-service limit lives on the catalog and is snapshotted with the other pricing inputs when a service line is established,
then copied to the invoice line detail. A visit line still has **no** quantity field.

| Layer                 | Column                                        | Written                                                                                 |
| --------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Catalog               | `services.max_quantity` (`>= 1`)              | Service creation and the price command (`MANAGE_SERVICE_PRICES`, audited before/after)  |
| Booking line          | `booking_service_lines.max_quantity_snapshot` | Booking creation                                                                        |
| Visit line            | `visit_service_lines.max_quantity_snapshot`   | Arrival (copied from the booking line), walk-in intake, staff-added line (from catalog) |
| Invoice line detail   | `invoice_line_services.quantity_limit`        | Copied from the visit line by a guard-verified insert; immutable                        |
| Invoice line quantity | `invoice_lines.quantity` (positive integer)   | The (later) POS command, `1 <= quantity <= quantity_limit`; PER_SERVICE is exactly 1    |

Why this and not another model (the Owner asked for the smallest model that satisfies the contract and historical accuracy):

1. OP-1's own example ("limit 10 when the line is established stays 10 after the catalog moves to 20", for the **existing Visit/Invoice**)
   requires the value to be frozen **before** the invoice exists. Copying from the live catalog when the draft is created would let a catalog
   change between the visit and its invoice alter an existing Visit's limit — a violation of the locked decision.
2. It mirrors exactly how the price range is already frozen (booking line -> visit line -> invoice detail), so the invoice never re-reads the
   catalog; sections 4.2, 4.3, 7.5, 19 and 20 of the approved contract describe this placement and the tests it requires.
3. An append-only limit history looked up by date would also satisfy OP-1 but is heavier and contrary to the snapshot pattern.
4. "Quantity" here is the number of **units of the pricing unit inside one performance** (for example nails for one `PER_NAIL` service), not
   a count of performances: one `VisitServiceLine` remains one operational performance, the same service performed twice stays two lines, and
   the invoice keeps one line per performance (no aggregation, so the link to each actual performance is never lost).

Legacy behavior: every existing service, booking line and visit line receives the neutral limit `1` (a PER_SERVICE service is always 1; the
Owner raises the limit of each PER_NAIL service afterwards). `1` is the most restrictive value and invents no business fact. Consequence for
the Owner to know: an already completed legacy visit with a PER_NAIL line can only be invoiced with quantity 1 (its snapshot is immutable);
new lines pick up the limit configured at that time.

Catalog API/UI (design 19(b)): service creation and the price command accept `maxQuantity` (integer >= 1; required for PER_NAIL; PER_SERVICE
is exactly 1, omitted or 1); an omitted limit on an existing PER_NAIL service is unchanged; the change is audited in `SERVICE_PRICE_CHANGED`
(before/after, classification unchanged) and applies only to lines established afterwards. The catalog form shows one field for PER_NAIL.

## 5. Migrations (five, additive, in order)

| Migration                                          | Content                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261014000000_phase4_financial_enums`            | `PermissionCode` + 9 values; `DataClassification` + `FINANCIAL` (enum values only, committed before use)                                                                                                                                    |
| `20261014000001_phase4_permission_semantics`       | `permissions_catalog_semantics` replaced (4 GLOBAL_ONLY codes; FINANCIAL for the nine); `audit_events_financial_classification` CHECK                                                                                                       |
| `20261014000002_phase4_quantity_limit_foundation`  | `services.max_quantity`, `booking_service_lines.max_quantity_snapshot`, `visit_service_lines.max_quantity_snapshot` (DEFAULT 1) + CHECKs; the two snapshot guards extended (immutable snapshot)                                             |
| `20261014000003_phase4_invoice_payment_foundation` | Enums; `invoices`, `invoice_lines`, `invoice_line_services`, `payments`, `payment_corrections`; CHECKs, indexes, FKs, guards, deferred integrity trigger, no-delete/no-truncate triggers                                                    |
| `20261014000004_phase4_discount_foundation`        | Enums; `discounts`, `discount_versions`, `discount_version_services`, `discount_version_categories`, `vouchers`, `invoice_voucher_entries`, `invoice_discount_applications`, `discount_redemptions`, `discount_redemption_releases`; guards |

Migration behavior for existing production data (validated, section 15):

- **No row is rewritten and no fact is invented.** New columns use a constant `DEFAULT 1` (metadata-only on PostgreSQL 11+); the existing
  guards are replaced by their previous bodies plus the new column; existing CHECKs hold for every existing row.
- **No invoice is fabricated** for the existing COMPLETED visits (all new tables start empty; the migration contains no backfill of financial
  data). A completed visit without an invoice is the normal state until the POS creates one (Step 5).
- **No permission is seeded or granted.** The nine enum values exist after `db:deploy`; catalog rows appear only when the operator runs
  `pnpm db:permissions:sync`; nothing is granted to any role or user, so the codes are inert until the Owner assigns them.
- Locks: the `ALTER TABLE ... ADD CONSTRAINT ... CHECK` statements validate existing rows under a brief exclusive lock (`services`,
  `booking_service_lines`, `visit_service_lines`, `audit_events`, `permissions`); these tables are small in production. Deployment order
  (only when the Owner asks): verified backup -> `pnpm db:deploy` -> `pnpm db:permissions:sync` -> rebuild/restart API, Web, Worker. Production
  is at 25 migrations; Step 2 adds none, Step 3 adds 1 and Step 4 adds 5, so it would be 31 after this Step.
- `prisma migrate diff` (migrations vs `schema.prisma`) shows only the two pre-existing composite-FK limitations
  (`organization_assignments_team_branch_fkey`, `team_memberships_team_branch_fkey`); nothing for any Phase 4 object. Partial unique indexes
  are not diffed by Prisma (existing convention).

## 6. Schema added (Prisma models and enums)

Enums: `InvoiceStatus` (`DRAFT`, `PENDING_PAYMENT`, `PAID`, `CANCELLED`), `InvoiceLineKind` (`SERVICE`), `PaymentMethod` (`CASH`), `PaymentStatus`
(`PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED`), `PaymentCorrectionKind` (`REVERSAL`), `DiscountKind`, `DiscountScopeMode`,
`DiscountReleaseCause`; `PermissionCode` +9; `DataClassification` +`FINANCIAL`.

| Model                                                            | Purpose                                                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invoice` (`invoices`)                                           | Internal receipt of one visit: code, branch, visit, status, payer, business date, calculation version, subtotal/discount/total, finalize/cancel/paid facts, version |
| `InvoiceLine` (`invoice_lines`)                                  | Generic line (`kind` SERVICE only): code, names, quantity, unit price, gross, who/when priced                                                                       |
| `InvoiceLineService` (`invoice_line_services`)                   | Exact copy of the visit-line snapshot: visit line, service, participant, KTV, unit, price range, `quantity_limit`, added-on-behalf                                  |
| `Payment` (`payments`)                                           | Cash shape: due, credited, tendered, change, collector, server time, idempotency key                                                                                |
| `PaymentCorrection` (`payment_corrections`)                      | Append-only reversal record (one per payment, reason, actor, server time)                                                                                           |
| `Discount`, `DiscountVersion`, `DiscountVersionService/Category` | Owner program (never deleted), immutable versions, scope                                                                                                            |
| `Voucher`, `InvoiceVoucherEntry`                                 | Codes under a code-requiring program; codes supplied to a draft (single removal transition)                                                                         |
| `InvoiceDiscountApplication`                                     | The one winning benefit (immutable), candidates JSON, reason                                                                                                        |
| `DiscountRedemption`, `DiscountRedemptionRelease`                | Permanent usage ledger; append-only release (active iff no release)                                                                                                 |

No tax, VAT, e-invoice provider, tip, loyalty, wallet, product, combo, register, closing or report column or table exists.

## 7. Permissions and scope

| Code               | Scope capability | Classification | Notes                                                                |
| ------------------ | ---------------- | -------------- | -------------------------------------------------------------------- |
| `VIEW_INVOICES`    | BRANCH_CAPABLE   | FINANCIAL      |                                                                      |
| `MANAGE_INVOICES`  | BRANCH_CAPABLE   | FINANCIAL      |                                                                      |
| `COLLECT_PAYMENTS` | BRANCH_CAPABLE   | FINANCIAL      | Cash by any holder in scope (OP-6); no re-auth for normal collection |
| `APPLY_DISCOUNTS`  | BRANCH_CAPABLE   | FINANCIAL      |                                                                      |
| `MANAGE_DISCOUNTS` | **GLOBAL_ONLY**  | FINANCIAL      | V1                                                                   |
| `CREATE_VOUCHERS`  | **GLOBAL_ONLY**  | FINANCIAL      | V1                                                                   |
| `CANCEL_INVOICES`  | BRANCH_CAPABLE   | FINANCIAL      | Fresh re-authentication for a finalized invoice (Step 5)             |
| `CORRECT_PAYMENTS` | BRANCH_CAPABLE   | FINANCIAL      | Fresh re-authentication always (Step 7)                              |
| `VIEW_REVENUE`     | BRANCH_CAPABLE   | FINANCIAL      | Also reads FINANCIAL audit events (section 8)                        |

Integration is through the existing architecture only: `PermissionCode` enum, code-owned `PERMISSION_CATALOG`, the catalog CHECK, the operator sync,
`PermissionCodeName` in the contracts, and labels/group in the existing role editor (VI/EN, a new "Finance" display group). No role name is
hard-coded and **no permission is granted to any existing role or user**: the repository/design determine that the Owner grants them, so no
grant mapping question arose. Enforcement of the scope rules: the catalog CHECK forbids a wrong scope/classification; a GLOBAL_ONLY code
cannot be overridden at a branch (SQL trigger and the role-admin API, both driven by the catalog). Re-authentication, permission checks and
scope decisions for the actions belong to the commands of Steps 5–8; the permissions themselves do nothing yet.

## 8. FINANCIAL classification

- `DataClassification.FINANCIAL` exists; the nine permissions carry it (catalog CHECK).
- `audit_events_financial_classification`: any audit action starting `INVOICE_`, `PAYMENT_`, `DISCOUNT_` or `VOUCHER_` (the actions of design
  section 12) must be classified FINANCIAL — the same pattern as `BASE_SALARY_CHANGED` -> EMPLOYEE_PAY. No existing action uses those prefixes
  and this Step writes no audit event.
- Reading: a FINANCIAL event needs `VIEW_AUDIT_LOG` **and** `VIEW_REVENUE` at its branch, or unrestricted GLOBAL for both when it has no branch;
  a branch DENY of `VIEW_REVENUE` removes that branch and the null-branch events; `VIEW_EMPLOYEE_PAY` never reveals financial events. Existing
  STANDARD/EMPLOYEE_PAY behavior is unchanged. `appendAdminAudit` and the audit response contract accept `FINANCIAL`.

## 9. Constraints, indexes and triggers

Guards are SQL (PostgreSQL), following the repository convention (`lucy_*` functions, fixed `search_path`, no `PUBLIC` execute). Rows below are
in the order of a request's life.

**Invoice** — CHECKs: `invoices_code_format` (`INV-YYMMDD-XXXXXX`, the date equals `business_date`, suffix alphabet without 0/1/I/O),
`invoices_money` (integer VND, `>= 0`, `discount <= subtotal`, `total = subtotal - discount`, total may be 0), `invoices_status_facts` (exactly the
facts of the current status; PENDING needs `total > 0`; PAID needs `paid_at`, `paid_seq >= 1`; CANCELLED needs who/when/why/`cancelled_from_status`;
from PAID only when `total = 0`, `paid_seq = 1`), `invoices_time_order`, non-blank reason, versions. Guard `lucy_guard_invoice`: created only as `DRAFT`
version 1, only for a COMPLETED visit and its branch, business date validated, payer must be a `CUSTOMER`; identity immutable; version +1; legal
transitions only (`DRAFT -> PENDING_PAYMENT | PAID | CANCELLED`, `PENDING_PAYMENT -> PAID | CANCELLED`, `PAID -> PENDING_PAYMENT | CANCELLED`);
frozen payer/amounts/finalization facts after finalization; `paid_seq` +1 exactly when becoming PAID; finalization needs every line priced and
subtotal = sum of lines; direct settlement only for total 0 with `paid_at = finalized_at`; **`PAID -> CANCELLED` only when `total = 0` and no payment row
exists at all**; CANCELLED is final. Indexes: unique `code`, **partial unique `invoices_visit_active_key (visit_id) WHERE status <> 'CANCELLED'`**, branch/date/status,
payer.

**Lines** — `invoice_lines` (quantity `>= 1`, price `>= 0`, gross exactly quantity x price and never NULL once both are set, price facts together,
guard: created/priced only while the invoice is `DRAFT`, identity/snapshot immutable). `invoice_line_services` (guard: recorded once, only while
DRAFT, must be a **DONE** line of **the invoice's own visit**, and every copied field must equal the visit-line snapshot, including
`quantity_limit`; PER_SERVICE limit is 1; unique per `(invoice, visit line)` so a cancelled invoice's lines can be invoiced again).

**Payments** — CHECKs `payments_amounts` (credited `> 0` and `<= amount due`; tendered `>= credited`; change exactly `tendered - credited`),
`payments_cash_succeeded`. Guard `lucy_guard_payment` (locks the invoice row `FOR UPDATE`, so two cashiers can never overpay even if a caller forgot
to lock): only against a `PENDING_PAYMENT` invoice of the same branch; **`collected_at` and `business_date` are overwritten with the database
clock** (no backdating); `amount_due_vnd` must equal the invoice balance at that moment; updates only PENDING -> terminal, never amounts/tender/collector/time.
`payment_corrections`: append-only; guard: cash and SUCCEEDED payment only, invoice `PENDING_PAYMENT` or `PAID`, one per payment, non-blank reason, server time.
Unique `(collector, idempotency_key)`.

**Commit-time integrity (deferred constraint triggers, `lucy_check_invoice_integrity`)** — every DONE service of the visit exactly once with its detail;
price within the snapshotted range and quantity within the snapshotted limit; finalized invoice fully priced with subtotal = sum of lines; payments
reconcile (`0 <= effective <= total`; `PAID` <=> `effective = total`, including total 0 with no payment; `PENDING_PAYMENT` <=> `effective < total`; a draft
has no payment; a cancelled invoice has no effective payment). Deferred means intermediate states inside a transaction are allowed, an inconsistent
invoice can never commit.

**Discounts** — programs immutable in identity/code/`requires_code`, termination permanent, never deleted; versions append-only (percent basis points
`1..10000` XOR fixed VND `> 0`, `valid_from < valid_until`, `min_spend >= 0`, NULL-means-unlimited limits `>= 1`); scope integrity (a SELECTED version names
services/categories, ALL_SERVICES none); vouchers only under code-requiring programs, canonical code, never deleted; voucher entries only on drafts, one
removal transition, unique active code per invoice; application (one per invoice, immutable, copies its version, **amount CHECK: percent rounds half up
`(eligible x bp + 5000) / 10000`, fixed capped by eligible, always `> 0`**, code-less promotion or a code of its own program); redemption (one per invoice, matches
the application and the invoice's payer, **OP-3: a per-customer-limited benefit needs an identified member payer**, usage limits counted over active redemptions under
the program row lock, time = database clock); release (only for a redemption of a CANCELLED invoice, cause matches how it was cancelled, at most once, append-only,
program row lock). Deferred `lucy_check_invoice_discount`: a draft has no application/redemption; a finalized invoice's discount total equals its applied benefit
(0 when none), an applied benefit has exactly one redemption and a supplied voucher, eligible subtotal `<=` subtotal, and a redemption is released exactly when
its invoice is cancelled.

**Permanent history** — no delete and no truncate on every table (`lucy_reject_financial_delete`, `lucy_reject_permanent_history_mutation`); corrections,
versions, scope rows, applications, redemptions and releases are append-only; every reference to `services`, `service_categories`, `visits`,
`visit_service_lines`, `branches`, `users` and between the new tables is `ON DELETE RESTRICT`. Idempotency: payments (per collector); create-invoice idempotency is
the one-active-invoice rule; supplied voucher entries by their partial unique key.

## 10. Historical-data behavior

- Existing visits, bookings, services, permissions and audit rows are untouched (checksums identical before/after the migrations, section 15).
- Existing services/lines get the neutral limit 1 (section 4); no invoice, payment, discount or permission grant is created.
- Catalog changes never rewrite an invoice: name/code/price range/limit are copies verified by guard against the visit-line snapshot, and the visit
  line behind a finalized invoice is DONE (immutable). Tested: a catalog rename and price change after invoicing leave the invoice unchanged.

## 11. Zero-balance compatibility (OP-2, OP-7)

- A receivable of exactly 0 is a valid invoice: `total_vnd = 0` is allowed; `PENDING_PAYMENT` requires `total > 0`, so a zero-balance invoice can only be
  settled **directly** (`DRAFT -> PAID`, `paid_seq = 1`, `paid_at = finalized_at`) and **never needs a Payment row**; `PAID` reconciles with zero effective
  payments; a zero-VND payment is impossible (`amount_vnd > 0`) and no payment can be recorded against a `PAID` invoice. No constraint requires a payment
  for PAID.
- OP-7 is structurally possible and structurally limited: `PAID -> CANCELLED` is allowed only when `total = 0` **and no payment row exists** (guard) and the
  record must satisfy `cancelled_from_status = PAID`, `paid_seq = 1`, `paid_at` kept; any invoice that took a payment (effective or reversed) is refused.
  A redemption the invoice consumed must be released in the same transaction (deferred check) with cause `ZERO_BALANCE_CORRECTION`; the redemption stays as
  history. After cancellation a new invoice may be created for the visit. The cancellation **workflow** (permission, reason, re-authentication, audit,
  event) is Step 5; nothing here implements it.

## 12. Internal invoice identity and the e-invoice boundary (Q10)

- `INV-YYMMDD-XXXXXX` is an internal commercial receipt code. `packages/database/src/invoice-code.ts` provides only the pure generator
  (`generateInvoiceCode(businessDate)`, cryptographic random source, the booking-code alphabet — unbiased because 256 is a multiple of 32 — plus
  `isInvoiceCode`); uniqueness is the database key and the (later) creation command retries on collision. No invoice is created by it.
- It is **not** an official VAT/e-invoice: no tax rate/code, buyer tax id, provider, provider id, official symbol or e-invoice status was added.
  Finalized invoices, lines, totals, codes and payments are immutable and every correction is an appended record, so a future `einvoice_documents`
  table can reference `invoice_id` additively.

## 13. API / UI changes (minimal, all directly required by the foundation)

| Change                                                                            | Where                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `maxQuantity` in `ServiceResponse`, `ServiceCreateRequest`, `ServicePriceRequest` | contracts, `service-catalog.*`, `catalog.input.ts` (`resolveMaxQuantity`), audit before/after    |
| Quantity-limit field in the catalog price fields (PER_NAIL only)                  | `service-price-fields.tsx`, `service-detail.tsx`, `services.tsx`, `pricing.ts`, i18n VI/EN       |
| Nine permission labels and a "Finance" group in the existing role editor          | `role-admin.ts`, `i18n/workforce.ts`                                                             |
| FINANCIAL audit visibility                                                        | `audit-read.service.ts`, `admin-command.ts`, contracts                                           |
| Limit snapshot when a line is established (four paths)                            | `booking.core.ts`, `operations.core.ts` (arrival), `walkin.core.ts`, `visit-service-add.core.ts` |

No invoice/POS/payment/discount/PayOS/history/notification endpoint or screen exists. The Phase 2/3 touch points are listed for the Owner as the
design requires (section 19); each is covered by focused regression tests below.

## 14. Files

Created: five migration folders (`20261014000000` … `20261014000004`), `packages/database/src/invoice-code.ts`,
`packages/database/src/phase4-pos-foundation.integration.test.ts`, `packages/database/src/phase4-pos-races.integration.test.ts`, this report.

Modified: `packages/database/prisma/schema.prisma`, `packages/database/package.json` (test list), `packages/database/src/{index,permission-catalog}.ts`,
`packages/contracts/src/index.ts`, `apps/api/src/authorization/{admin-command,audit-read.service}.ts`, `apps/api/src/catalog/{catalog.input,service-catalog.controller,service-catalog.service}.ts`,
`apps/api/src/booking/booking.core.ts`, `apps/api/src/operations/{operations.core,visit-service-add.core}.ts`, `apps/api/src/walkin/walkin.core.ts`,
`apps/web/src/components/workforce/screens/{service-price-fields,service-detail,services}.tsx`, `apps/web/src/lib/workforce/{pricing,role-admin}.ts`,
`apps/web/src/i18n/workforce.ts`, tests updated for the new shapes (`authorization*.test.ts`, `role-admin.integration.test.ts`, `service-catalog.*.test.ts`,
`customer-booking`/`operations`/`walkin`/`visit-service-add` integration tests, `pricing.test.tsx`), `docs/PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md`, `LUCYSPA_HANDOFF.md`.

## 15. Tests and exact results

Validation database: local scratch `lucy_spa_step4_validation_20260930` (all 31 migrations applied with `pnpm db:deploy`, catalog synced); not
`lucy_spa_dev`, not production. A second scratch database (`..._legacy_...`) proved the upgrade of production-shaped data. Both were dropped.

| Check                                                                                                                                                                                                                                    | Result                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| New `phase4-pos-foundation.integration.test` (permissions, FINANCIAL, OP-1 snapshots, header, lines, completeness, lifecycle, zero balance, payments, reconciliation, permanent history, discounts, applications, redemptions, releases) | **20 / 20 pass** (rollback fixtures)                                                              |
| New `phase4-pos-races.integration.test` (isolated schema of the full migration chain, committed data, two real connections: overpayment, payment vs cancel, one active invoice per visit, last discount usage), 4 runs                   | **5 / 5 pass** each run; schema dropped, 0 left                                                   |
| Database package `pnpm test:integration` (all suites)                                                                                                                                                                                    | **65 / 65 + 5 / 5 (races, separate invocation) = 70 pass** (was 45)                               |
| Migration upgrade of production-shaped data (26 migrations + a completed visit, booking, PER_NAIL lines, permissions, audit rows -> Step 4 migrations)                                                                                   | Existing-row checksums identical; new columns = 1; 0 invoices/payments/discounts; no code granted |
| `prisma migrate diff`, `migrate status`, `prisma validate`                                                                                                                                                                               | Only the two known composite-FK limitations; "Database schema is up to date"; valid               |
| API focused regression: customer-booking, arrival/operations, walk-in, Step 3 add-service (integration + HTTP), service catalog (integration + HTTP)                                                                                     | **53 / 53 pass**                                                                                  |
| API regression: reassignment, execution-reassignment race, operations race, service-execution, Step 2 completion (integration, race, HTTP), Step 3 race, walk-in race, availability                                                      | **67 / 67 pass**                                                                                  |
| API authorization / role administration / audit read (including the new FINANCIAL visibility and GLOBAL_ONLY overrides)                                                                                                                  | **37 / 37 pass**; plus customer-booking race and four HTTP suites **7 / 7**                       |
| `pnpm test` (no database opt-in)                                                                                                                                                                                                         | server 22/22; worker 8 pass + 1 skipped; web **156 / 156** (was 155); api 150 pass + 51 skipped   |
| `pnpm format:check`, `pnpm lint` (+ boundaries), `pnpm typecheck` (all packages)                                                                                                                                                         | pass                                                                                              |

A web production build was **not** run (it regenerates the protected `apps/web/next-env.d.ts`); `next typegen` (inside `pnpm typecheck`) is safe and
the file has no diff. The worker Redis integration test was not run: Step 4 changes nothing it reads.

The new suite found a real defect during development, now fixed and covered: several CHECKs (`discount_versions_value`, the application value rule,
`invoice_lines_gross`, and the CANCELLED branch of `invoices_status_facts`) evaluated to NULL — which a CHECK accepts — when a nullable column was
NULL. They now test `IS NOT NULL` explicitly.

Coverage of the requested list: migration applies (fresh and upgrade); permission catalog/scope; GLOBAL_ONLY for `MANAGE_DISCOUNTS`/`CREATE_VOUCHERS` (catalog CHECK,
branch override refused in SQL and in the role-admin API); FINANCIAL classification and audit visibility; invoice state enum and transitions; integer/non-negative
VND and large values beyond `Number.MAX_SAFE_INTEGER`; quantity `> 0` and within the snapshotted limit; per-service limit constraints (PER_SERVICE = 1);
snapshot/history (catalog raised 10 -> 20 leaves existing booking/visit/invoice at 10 while a new line carries 20); unique invoice code and format; one active
invoice per visit (and again after cancellation); payer member/guest rules; restrictive deletes/immutability; zero-balance PAID without a Payment and its OP-7
cancellation; no payment on a zero-balance invoice; migration with existing visits; concurrency of the guards.

## 16. Pre-existing unrelated failures / warnings

Not run and not touched: the two `My Income` integration assertions that fail only between 15:00 and 17:00 UTC (pre-existing, documented in
`docs/NOTIFICATION_CENTER_FINAL_VALIDATION.md`) and the non-failing `pg` queued-query deprecation warning. No pre-existing failure occurred in the
suites that were run.

## 17. Deferrals

Invoice creation/POS/price selection/payer selection/finalization/cancellation commands and the invoice code retry loop (Step 5); the discount engine,
voucher validation and redemption commands (Step 6); cash collection, split flow, reversal command and re-authentication enforcement (Step 7); PayOS
tables and states (`payment_attempts`, `payment_provider_events`, `PAYOS`, per-method CHECK; Step 8, Q7); customer invoice history (Step 9);
`outbox_consumptions` and invoice notifications (Step 10, Q8); financial audit events and outbox events (written by those commands; nothing is written
now); the full regression and the web build (Step 11); `REFUNDED`, products, loyalty, tips, reports, official e-invoice (later phases). Per-command race tests
of the workflows are scheduled with those Steps; this Step proves the database guards themselves under real concurrency.

## 18. Owner review decisions (all APPROVED) and final review

1. **Quantity-limit model — APPROVED as implemented:** service configuration (`services.max_quantity`) -> `booking_service_lines` snapshot ->
   `visit_service_lines` snapshot -> `invoice_line_services` historical snapshot. `VisitServiceLine` still has **no** quantity field; one
   `VisitServiceLine` remains one operational performance.
2. **`maxQuantity` required for PER_NAIL — APPROVED.** It is catalog validation (service creation and the price command), not an Invoice quantity field.
3. **DiscountVersion validity — APPROVED:** `valid_from < valid_until` is mandatory; `min_spend` defaults to 0.
4. **Conservative legacy backfill — APPROVED:** `max_quantity` / `max_quantity_snapshot` = 1 where history recorded no other value; no historical quantity is invented.
5. **`REFUNDED` stays OUT of Phase 4 — APPROVED.** The four approved invoice states remain `DRAFT`, `PENDING_PAYMENT`, `PAID`, `CANCELLED`; `REFUNDED`
   is deferred to Phase 6 and was not added because an implementation prompt mentioned it.

Preserved: a zero-balance invoice may become `PAID` without a fake 0-VND payment; OP-7 zero-balance cancellation stays structurally possible; no official
e-invoice, tax or provider field; no default financial permission grant; Q7 and Q8 remain unresolved.

**Focused final review (after the Owner decisions; no code changed):** the five migrations contain only DDL for the approved foundation (no INSERT/UPDATE/DELETE
of data, no role or user grant, no `REFUNDED`/tax/e-invoice/provider object); no invoice, payment, discount or voucher command, service, controller, screen or
notification exists (the only application code touched is the permission catalog, contracts, role-editor labels, FINANCIAL audit visibility, the catalog
`maxQuantity` and the four limit-snapshot paths); no checkout/POS workflow and no payment collection or reversal command exists; no locked Owner decision (Q0–Q6,
Q9–Q10, OP-1…OP-7) was changed and the design-contract edits are implementation-level clarifications; the production-shaped upgrade validation (section 15)
remains valid because no migration changed after it. `apps/web/next-env.d.ts` has no diff.

## 19. Design-contract clarifications made

`docs/PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md`, implementation-level only (no locked decision changed; whitespace re-padding of two tables aside):
(a) section 4.3.1: a "Step 4 decision (implemented; OP-1 unchanged)" bullet recording the model and the rejected alternatives; (b) a new section 4.11
"Step 4 implementation notes"; (c) section 19 row 4: an "as implemented" sentence naming the five migrations; (d) section 22 row 4: the report is
`docs/PHASE4_STEP4_POS_DATABASE_PERMISSIONS.md` (the Step 3 report and the handoff still name the old file, which never existed).

## 20. Contract notes for Steps 5–8

- Timestamps: use the database clock for finalize/cancel/paid (`clock_timestamp()` after the locks); collection/reversal/redemption/release times are
  overwritten by the database anyway. Business date: `lucy_branch_local_date(branch, now())`; the invoice code carries that date.
- Lock order: visit (`FOR UPDATE NOWAIT`) -> invoice -> discount program row -> payments (the guards take the invoice/program locks themselves in that order).
- Finalization: set every price/quantity, insert the application and the redemption, update the invoice (subtotal = sum of lines, discount total = the applied
  amount, `total = subtotal - discount`; `PAID` with `paid_seq = 1`, `paid_at = finalized_at` when `total = 0`) in **one transaction**. Cancellation: update the
  invoice to `CANCELLED` first, then insert the release (cause `INVOICE_CANCELLED_UNPAID` from `PENDING_PAYMENT`, `ZERO_BALANCE_CORRECTION` from `PAID`).
- Cash: `amount_due_vnd` = the invoice balance at that moment, `change = tendered - amount`, then update the invoice to `PAID` (`paid_seq + 1`) when covered; a reversal
  inserts the correction and returns the invoice to `PENDING_PAYMENT` (`paid_at` NULL, `paid_seq` kept).
- Step 8 relaxes the cash-only NOT NULLs (`tendered_vnd`, `change_vnd`, collector) and `payments_cash_succeeded` into a per-method rule and adds `PAYOS`.

## 21. Confirmations

`apps/web/next-env.d.ts` was not touched (no diff). Step 5 has **not** started; no checkout, POS workflow or payment collection is implemented. Nothing was
committed, pushed or deployed.
