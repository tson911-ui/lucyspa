# Phase 4: POS, Invoices & Payments — design contract

**Status: Step 1 of 11 (Design Contract) — CLOSED / OWNER APPROVED (revision 3).** Documentation only. No migration,
schema, API, UI or runtime change was made. Step 2 has **NOT** started. Nothing was deployed. This document is the authoritative
Phase 4 design contract; Q7 (before Step 8) and Q8 (before Step 10) remain open Owner checkpoints.

This document is the authoritative Phase 4 contract that Steps 2–11 must follow. Where it is silent,
`LUCY_SPA_PRD.md` governs; `LUCYSPA_HANDOFF.md` records the accepted state it builds on. Owner decisions
**Q0–Q6, Q9 and Q10 are LOCKED** (section 2.1) and the seven technical decisions **OP-1 through OP-7 are LOCKED /
OWNER-APPROVED** (section 2.3) and are integrated into the sections they govern. **Q7 (PayOS) and Q8 (invoice/revenue
notifications) are NOT locked**: they are explicit Owner checkpoints (Q7 before Step 8, Q8 before Step 10) and this
document deliberately leaves them open (sections 16 and 17).

Revision 3 adds the Owner-approved OP-7 (the narrow correction exception for zero-balance invoices and the append-only redemption release it requires) on top of revision 2, which reconciled the document with OP-1…OP-6. In particular the earlier global quantity-limit setting is
**gone** (the limit is per service and snapshot-based), and voucher handling was restructured so that code-less promotions
are automatic candidates while code vouchers are candidates only once supplied and validated.

Baseline: `main` at `97e048573d9a9f2a14ae9f62c3b4b4e68bb06433`, which the Owner reports as deployed and verified in
production (Notification Center V1 closed; 25 migrations; `lucyspa-api`, `lucyspa-web`, `lucyspa-worker` online).

---

## 1. Scope and non-goals

**In scope (PRD section 56, Phase 4, plus the Owner-approved carryovers):**

| Deliverable                                | PRD                | Step(s) |
| ------------------------------------------ | ------------------ | ------- |
| Phase 3 carryover: manager END resolution  | 13.4, Scenario C   | 2       |
| Phase 3 carryover: cancel unperformed line | 13, 49             | 2       |
| Staff-added service                        | 13.5               | 3       |
| Visit invoice                              | 14, 49             | 4, 5    |
| Service/product line architecture          | 14.1, 25           | 4, 5    |
| Discounts and vouchers                     | 16                 | 6       |
| Cash, split payments, payment states       | 15.2, 15.4, 15, 49 | 7       |
| Payment corrections (reversal)             | 39, 40, Scenario Q | 7       |
| PayOS adapter/interface and integration    | 15.3               | 8       |
| Digital invoice history                    | 6.6, 52            | 5, 9    |
| Invoice / revenue notifications            | 38, 50             | 10      |

**Explicit non-goals (never "for convenience"):**

- Phase 5: points, wallets, tiers, Member Discount, Birthday benefit/voucher, referral, combos, reward entitlements,
  customer-specific loyalty benefits.
- Phase 6: products, inventory, product lines, seller attribution, product returns/refunds, product promotions.
- Phase 7: tips, tour, commission, payroll, cash safe/register, deposits, daily closing.
- Phase 8: dashboards, revenue/employee reports, Excel/PDF export, audit-log UI.
- Official Vietnamese VAT / e-invoice issuance and any tax field (TBD, PRD 61); this document only defines a boundary (section 18).
- Service or combo refunds (PRD 29). Payment **correction** is not a refund (section 5.3).
- Reviews (PRD 37) — not assigned to any roadmap phase; not Phase 4.
- Premium motion, native apps, Zalo, physical payment speaker, shipping/COD.

**"Future-ready" means** clean boundaries, immutable history and additive extension points. It does not mean
speculative Phase 5–8 tables or nullable columns now.

## 2. Owner decisions

### 2.1 Locked (Q0–Q6, Q9, Q10)

| #   | Decision (summary; the section that applies it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q0  | All three Phase 3 carryovers are in Phase 4: manager resolution of a forgotten END (permission, reason, audit; Step 2); cancel an unperformed Visit line (unstarted only, never hard-delete; Step 2); staff-added service from the existing catalog with no arbitrary name/price (Step 3). (Sections 5.4, 22)                                                                                                                                                                                                                                   |
| Q1  | Price authority is permission-based, never role-name based; a KTV has no price power merely by being a KTV. For variable-price services the authorized POS actor selects the concrete price **inside the min/max captured by the Visit service-line snapshot**; later catalog changes never alter an existing transaction. Quantity is a positive integer under an Owner-controlled limit (**per service, snapshot-based — OP-1**). Price/quantity decisions are audited. (Sections 4.3, 6, 7, 11)                                              |
| Q2  | One Visit -> one **active** Invoice; created only after the Visit is COMPLETED; payment never controls Visit completion or END; an addition after completion is a **new Visit**; payer lives on the Invoice (booking owner by default, changeable by authorized staff before finalization, existing exact member lookup, guest payment without an account); customers see only invoices where they are the payer; several participants may share one Invoice; multiple methods use split payment, not invoice splitting. (Sections 4, 5, 9, 10) |
| Q3  | Integer VND; percentages round **half up to 1 VND**; no special cash rounding; deterministic, versioned calculation. (Section 7)                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q4  | No free-form employee discount percent/amount. Discounts/vouchers are predefined by Owner configuration; `APPLY_DISCOUNTS` applies an eligible configured benefit. Fixed-amount discount is **invoice-level** (no line allocation). Generic/program vouchers (validity, minimum spend, scope, total and per-customer limits). No stacking. No Phase 5 benefit types. (Section 8)                                                                                                                                                                |
| Q5  | No tip in Phase 4 (tip, cash safe, closing, tour, commission, payroll = Phase 7), but the payment model must not preclude tips. Cash records amount due, tendered, change, collector, time and its Invoice link. (Sections 4.5, 21)                                                                                                                                                                                                                                                                                                             |
| Q6  | Unpaid invoice: cancel with permission + reason + audit, never deleted. Payment history is never edited; corrections are explicit records. Cash reversal needs `CORRECT_PAYMENTS`, reason, password re-authentication and audit; if the remaining effective payments no longer cover the receivable the Invoice returns to `PENDING_PAYMENT`. A provider-confirmed PayOS payment is never manually reversed in Lucy Spa. Correction is not a service refund. The single narrow exception for zero-balance invoices is OP-7. (Sections 5, 9, 11) |
| Q9  | Permissions `VIEW_INVOICES`, `MANAGE_INVOICES`, `COLLECT_PAYMENTS`, `APPLY_DISCOUNTS`, `MANAGE_DISCOUNTS` (GLOBAL_ONLY), `CREATE_VOUCHERS` (GLOBAL_ONLY), `CANCEL_INVOICES`, `CORRECT_PAYMENTS`, `VIEW_REVENUE`; no role-name access; no broad automatic seeding (Owner grants); re-authentication for `CORRECT_PAYMENTS` and for cancelling a finalized invoice, not for ordinary POS actions; a `FINANCIAL` classification. (Section 11)                                                                                                      |
| Q10 | UI term "Hóa đơn"; code `INV-YYMMDD-XXXXXX`; no database id as a customer-facing code; the Invoice is an **internal commercial record/receipt**, never presented as an official VAT/e-invoice; no e-invoice integration in Phase 4 but the design is **e-invoice-ready** through a separate future integration model; browser print allowed; PDF/Excel stay Phase 8. (Section 18)                                                                                                                                                               |

### 2.2 NOT locked (explicit Owner checkpoints)

| #   | Checkpoint                                                            | Must be answered before | Where it is left open |
| --- | --------------------------------------------------------------------- | ----------------------- | --------------------- |
| Q7  | PayOS business choices                                                | **Step 8**              | Section 16.3          |
| Q8  | Invoice / revenue notification recipients, routing and content policy | **Step 10**             | Section 17            |

Nothing in Steps 1–7 or 9 may depend on an unresolved Q7/Q8 choice.

### 2.3 Locked technical decisions OP-1 … OP-7 (OWNER-APPROVED; do not reopen)

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Integrated in                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| OP-1 | The quantity limit is configured **per Service** (never one global setting), maintained through the existing service/pricing authority, and **snapshotted with the transaction-time service/pricing inputs when the service line is established**. A later catalog change never alters an existing Visit/Invoice (limit 10 at line creation stays 10 after the catalog moves to 20).                                                                                                                                                                                                                                                                                                                                                                                             | 3, 4.2, 4.3, 7.5, 11.1, 19, 20, 22                        |
| OP-2 | An Invoice whose calculated amount due is exactly 0 VND is valid. It arises only from the deterministic engine and configured benefits (staff never type a total). At finalization it goes **directly to `PAID` with no Payment row** (no fake 0-VND payment) and everything else is preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 4.1, 5.1, 9, 12, 13, 15, 20                               |
| OP-3 | A benefit with a per-customer usage limit is eligible **only with an identified MEMBER payer**. A guest payer makes it ineligible; guest identity is never fabricated from name/phone/email; guests remain eligible for benefits without a per-customer limit; no account creation is forced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 8.3, 10, 20                                               |
| OP-4 | `minimumSpend` is tested against the **eligible subtotal before the benefit** (only in-scope lines count), never the post-discount total, with no circular re-evaluation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 7.3, 8.3, 20                                              |
| OP-5 | **Code-less promotions** are evaluated automatically as candidates. **Code-based vouchers** become candidates only after their code is supplied and validated. **Exactly one** benefit wins (no stacking) with a deterministic tie-break.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 4.4, 8, 11.1, 12, 20                                      |
| OP-6 | Cash is recorded by any actor holding `COLLECT_PAYMENTS` within valid authority/scope for the invoice's branch (never a role name); no re-authentication for normal collection; the record preserves due, tendered, change, credited amount, collector, **server-recorded** time and method; no free backdating; `COLLECT_PAYMENTS` implies no price, discount, cancel, correction or revenue authority.                                                                                                                                                                                                                                                                                                                                                                         | 4.5, 11.1, 11.2, 11.3, 12, 20                             |
| OP-7 | **Controlled correction of a zero-balance invoice.** `PAID` -> `CANCELLED` is allowed **only** when the invoice was settled `ZERO_BALANCE`, its amount due is exactly 0 VND, it has no successful/effective Payment, the cancellation corrects a zero-balance transaction/benefit mistake (never a customer refund), and the actor holds `CANCEL_INVOICES` in scope, gives a reason and passes **fresh password re-authentication**, with full financial audit. It is **not** a generic `PAID` -> `CANCELLED` path: an invoice with any successful payment keeps the Q6 correction rules. A redemption the invoice consumed is **released** (append-only release record; the original redemption stays as history), protected against double release and miscounting by locking. | 4.1, 4.4, 5.1, 5.5, 6, 8.3, 9, 11, 12, 13, 14, 15, 20, 22 |

No OP decision conflicts with Q0–Q6, Q9 or Q10 (verified; section 24). OP-7 was raised as a consequence of OP-2 combined with Q6
(a zero-balance invoice has no payment to reverse) and is now approved by the Owner.

## 3. Foundations confirmed in the repository

Verified against the working tree at `97e0485` (not from memory).

| Foundation                                                                                                                                                                                                                                                         | Where                                                                                                     | Phase 4 use                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Visit` (owner nullable; identity fields, `COMPLETED`/`CANCELLED` final), `VisitParticipant`, `VisitServiceLine` (snapshot: code, VI/EN names, `catalog_price_min/max_vnd`, `catalog_pricing_unit`; KTV; `added_on_behalf/by/at`), `ServiceExecution`              | `schema.prisma:1131–1277`; guards `lucy_guard_visit*` in `20261005000001_phase3_booking_visit_foundation` | Invoice source; price range; KTV attribution; staff-added flag. **The Visit guard forbids any update of a COMPLETED visit** — so neither `PAID` nor a payer can be stored on the Visit |
| `BookingServiceLine` carries the same catalog snapshot and is copied to the visit line at arrival                                                                                                                                                                  | `schema.prisma:1094`, `operations.core.ts`                                                                | Where a per-service quantity-limit snapshot must also be taken (section 4.3.1)                                                                                                         |
| Snapshot immutability of visit/booking lines (guards reject rewriting snapshot columns)                                                                                                                                                                            | same migration, `lucy_guard_visit_service_line`, `lucy_guard_booking_child`                               | The price range and quantity limit the POS may use are trustworthy and frozen                                                                                                          |
| Service catalog with price range and unit (`PER_SERVICE`, `PER_NAIL`); price command restricted to GLOBAL_ONLY `MANAGE_SERVICE_PRICES` (reason, `expectedVersion`, audited before/after); service creation needs `MANAGE_SERVICES` **and** `MANAGE_SERVICE_PRICES` | `schema.prisma:742`, Phase 2 Step 4                                                                       | Price authority; the same authority will maintain the per-service quantity limit (section 4.3.1)                                                                                       |
| Permission catalog (code-owned, append-only, semantics immutable in SQL), `db:permissions:sync`, GLOBAL_ONLY capability, scopes GLOBAL/REGION/AREA/BRANCH, DENY, containment                                                                                       | `permission-catalog.ts:19`, `authorization.ts`, Phase 3 permission migration                              | New financial permission codes (own migration, as Phase 3 did)                                                                                                                         |
| `runAdminCommand` frame (graph lock, users sorted by UUID, session, transaction-time authority) and `appendAdminAudit`                                                                                                                                             | `admin-command.ts:53,119`                                                                                 | Every workforce POS command                                                                                                                                                            |
| Customer-command frame (session-only identity, ownership-based)                                                                                                                                                                                                    | `booking/customer-command.ts`                                                                             | Customer invoice reads (`/me/invoices`)                                                                                                                                                |
| Fresh re-authentication (`Session.reauthenticatedAt`, `hasFreshReauthentication`, `requireFresh` pattern, web `useReauthentication`/`reauth-dialog`)                                                                                                               | `auth/session.policy.ts:127`, `employees/employee.service.ts:1070`                                        | Re-auth boundaries (section 11.3)                                                                                                                                                      |
| Audit: append-only `audit_events`, action regex `^[A-Z][A-Z0-9_]*$`, `DataClassification` = `STANDARD`/`EMPLOYEE_PAY`, classification-gated reading                                                                                                                | `schema.prisma:684`, `audit-read.service.ts:84`                                                           | `FINANCIAL` classification and its visibility rule (section 11.4)                                                                                                                      |
| Outbox: `appendOutboxEvent(tx, …)`; `published_at` is one shared flag; Phase 3 relay and Leave consumer select **by aggregate type and event type**                                                                                                                | `outbox.ts:18`, `booking-jobs.ts:204`, `leave-jobs.ts:25`                                                 | Financial aggregates are ignored by existing relays; multi-consumer contract in section 15                                                                                             |
| Notification Center: registry with `OPERATIONS`/`HR` categories, entities `Booking`/`Visit`/`LeaveRequest` enforced by DB CHECKs, `params` allowlist, routing by subject employee                                                                                  | `notification-registry.ts:68`, `20261012000000_notification_foundation`, `notification-routing.ts:73`     | Prerequisites only (section 17); widening needs a migration                                                                                                                            |
| Idempotency: unique `(created_by_user_id, idempotency_key)` on bookings/visits; unique booking->visit link                                                                                                                                                         | `schema.prisma:1066,1161`                                                                                 | Payment idempotency pattern                                                                                                                                                            |
| Locking: `FOR UPDATE`, visit `FOR UPDATE NOWAIT` then line then execution, `SKIP LOCKED` consumer claims, SQLSTATE -> conflict mapping                                                                                                                             | `service-execution.core.ts:203`, `service-execution.service.ts`, `leave-notifications.ts`                 | Invoice/payment locking (section 14)                                                                                                                                                   |
| Exact member lookup (phone/email, masked, no account creation)                                                                                                                                                                                                     | `walkin.controller.ts` `GET branches/:branchId/members`                                                   | Attaching a member payer                                                                                                                                                               |
| Branch-local business dates computed by the database; BIGINT VND; `timestamptz(3)`; restrictive FKs; no-delete/no-truncate helper triggers                                                                                                                         | Phase 2/3 migrations                                                                                      | Financial tables                                                                                                                                                                       |
| Web: string-based VND (`formatVnd`), permission hints (`navigationFor`, `canAt`), role-admin groups, VI/EN dictionaries, node test setup                                                                                                                           | `apps/web/src/lib/workforce/*`                                                                            | POS UI                                                                                                                                                                                 |
| Global `CsrfGuard`: every non-GET needs same Origin, JSON, CSRF token and session cookie                                                                                                                                                                           | `csrf.guard.ts:29`                                                                                        | A public provider webhook needs a deliberate, narrow exemption (section 16.4)                                                                                                          |
| Test entry points: `pnpm test:integration` (database package list), `pnpm test:auth:integration` (`scripts/test-auth-integration.mjs`, sets `RUN_AUTH_INTEGRATION`)                                                                                                | root `package.json`                                                                                       | New suites must be added to those lists                                                                                                                                                |

**Repository facts that shape the design (none contradicts a locked decision):**

1. **No manager END resolution, no line cancel after start and no staff-added service exist.** `MANAGER_RESOLVED`,
   `resolution_reason` and `RESOLVE_SERVICE_EXECUTION` exist as schema/permission only; the `added_on_behalf` columns
   exist but nothing writes them; the only line-cancel paths are whole-booking/whole-walk-in cancellation before any
   START. This is why Q0 is required for invoicing.
2. **The database already allows Step 2 and 3 without a migration** for their own behavior (`PLANNED -> CANCELLED` is a legal
   line transition; a `MANAGER_RESOLVED` end with a reason is legal; the on-behalf CHECK exists). To be re-verified at Step 2/3.
   (The quantity-limit snapshot of OP-1 is a separate, Step 4 change, section 4.3.1.)
3. **`published_at` is single-consumer.** Notification Center Step 1 deliberately omitted `outbox_consumptions`
   because no event had two consumers. `INVOICE_PAID` will (section 15).
4. **The catalog has no quantity limit today.** `services` carries the price range and unit; booking and visit lines snapshot
   code, names, duration and price range. There is no settings write path (`app_settings` is migration-seeded) — this is
   **irrelevant to the design**, because OP-1 puts the limit on the Service, so Phase 4 adds **no** POS setting to the registry.
5. **Notification registry/CHECKs are closed** to Invoice entities and financial types; extending them is a migration (Step 10).
6. **Two `My Income` integration assertions fail only between 15:00 and 17:00 UTC** (pre-existing, documented in
   `docs/NOTIFICATION_CENTER_FINAL_VALIDATION.md`). Unrelated to Phase 4; not fixed in Step 1.

## 4. Domain and data model (design only; no table is created in Step 1)

Conventions (existing): UUID keys `gen_random_uuid()`, `timestamptz(3)`, **BIGINT VND** (decimal-string on the wire,
`BigInt` in code, never `number`), restrictive foreign keys, `row_version` optimistic concurrency on mutable rows,
branch-scoped, no hard delete, no truncate, business dates computed by the database from the branch timezone.
Tables are created in **Step 4** unless another Step is named. Additions are additive migrations. Column and table names below
are proposals fixed by the Step that creates them.

### 4.1 Invoice (`invoices`)

| Field                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `code`                                                                     | `code` unique, `INV-YYMMDD-XXXXXX` (section 4.10); the id is never customer-facing                                                                                                                                                                                                                                                                                                                                                                                                           |
| `branch_id`, `visit_id`                                                          | Branch = the Visit's branch (guard). **Partial unique index: at most one non-`CANCELLED` invoice per visit** (Q2)                                                                                                                                                                                                                                                                                                                                                                            |
| `status`                                                                         | `DRAFT`, `PENDING_PAYMENT`, `PAID`, `CANCELLED` (section 5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `payer_user_id`                                                                  | Nullable customer account (nullable = guest payer). Guard: must be a `CUSTOMER`. Editable only in `DRAFT` (section 10)                                                                                                                                                                                                                                                                                                                                                                       |
| `business_date`                                                                  | Branch-local date of creation, database-computed                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `calculation_version`                                                            | Integer; the pricing algorithm version that produced the stored amounts (section 7.3)                                                                                                                                                                                                                                                                                                                                                                                                        |
| `subtotal_vnd`, `discount_total_vnd`, `total_vnd`                                | Stored results of the engine (**never client input**); recomputed only while `DRAFT`; **frozen at finalization**. `total_vnd` is the **receivable / amount due** and may be exactly `0` (OP-2)                                                                                                                                                                                                                                                                                               |
| `finalized_at/_by`, `cancelled_at/_by`, `cancelled_from_status`, `cancel_reason` | Facts; `cancel_reason` is required when cancelled; `cancelled_from_status` is `DRAFT`, `PENDING_PAYMENT` or `PAID` (`PAID` only for the OP-7 correction, section 5.5)                                                                                                                                                                                                                                                                                                                        |
| `paid_at`, `paid_seq`                                                            | `paid_seq` increments each time the invoice becomes `PAID` (a reversal followed by full payment is a new "paid episode"); `paid_at` is the latest, NULL while never paid and while `PENDING_PAYMENT` after a reversal. A zero-balance invoice gets `paid_seq = 1`, `paid_at = finalized_at` at finalization. When an OP-7 cancellation voids that episode, `paid_at`/`paid_seq` are **kept as historical facts** (never cleared) and the cancellation records `cancelled_from_status = PAID` |
| `created_by_user_id`, `row_version`, `created_at`                                | Standard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

The paid amount is **never stored**; it is always computed from payments (section 9) so it cannot drift. A zero-balance
invoice keeps every service line, the original `subtotal_vnd`, the applied benefit, `discount_total_vnd`, the payer, the
`calculation_version` and its audit/history exactly like any other invoice; it simply has no Payment row.

### 4.2 Invoice line (`invoice_lines`) and service detail (`invoice_line_services`)

The line architecture is a generic line plus a **1:1 detail table per kind**, so Phase 5/6 add kinds and detail tables
additively without altering Phase 4 rows.

`invoice_lines` (generic): `id`, `invoice_id`, `sequence`, `kind` (enum; **Phase 4 defines only `SERVICE`**),
`item_code`, `name_vi`, `name_en` (immutable copies), `quantity`, `unit_price_vnd`, `gross_vnd`
(`= quantity × unit_price_vnd`), `price_set_by_user_id`, `price_set_at`, `row_version`.

`invoice_line_services` (kind = `SERVICE`, 1:1 with the line): `visit_service_line_id` (unique per invoice),
`service_id` (`ON DELETE RESTRICT`), `participant_id` (recipient), `employee_user_id` (KTV attribution, from the visit
line), `pricing_unit`, `catalog_price_min_vnd`, `catalog_price_max_vnd` and **`quantity_limit`** (all **copied from the
visit-line snapshot**, including the per-service limit snapshotted when that line was established — section 4.3.1),
`added_on_behalf` (copied fact).

Rules: only `DONE` visit lines become invoice lines; `CANCELLED` lines never do. Every non-cancelled line of the Visit is
present exactly once. No Phase 5/6/7/8 column exists on these tables.

### 4.3 Where the transaction-time pricing inputs live, and when they freeze (Q1, OP-1)

| Input                               | Lives in                                                                                                                                                                   | Frozen when                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Allowed min/max and unit            | Visit-line snapshot (Phase 3, already immutable) -> copied to `invoice_line_services` at DRAFT creation                                                                    | Already immutable at the visit line; the invoice copy never changes     |
| **Quantity limit (per service)**    | Catalog `services` -> **snapshotted on the booking/visit line when the line is established** (4.3.1) -> copied to `invoice_line_services.quantity_limit` at DRAFT creation | At line establishment (immutable there); the invoice copy never changes |
| Service code and names              | Same visit-line snapshot, copied to `invoice_lines`                                                                                                                        | Same                                                                    |
| Exact-price services (min = max)    | `unit_price_vnd` set automatically to that price at DRAFT creation                                                                                                         | At finalization                                                         |
| Variable-price services (min < max) | `unit_price_vnd` is NULL until an actor with `MANAGE_INVOICES` selects it; must satisfy `min <= price <= max`                                                              | At finalization                                                         |
| Quantity                            | `PER_SERVICE`: fixed 1. `PER_NAIL`: set explicitly by the actor (NULL until set), `1 <= q <= quantity_limit` of the line                                                   | At finalization                                                         |
| Applied benefit result              | `invoice_discount_applications` (section 8), written at finalization                                                                                                       | At finalization                                                         |
| Totals                              | `invoices.subtotal/discount_total/total`                                                                                                                                   | At finalization                                                         |

Consequences: the **catalog is never re-read after the line was established** for the range, unit or quantity limit; a
catalog price, range or quantity-limit change after that changes nothing on any existing Visit or Invoice. The price source
is the **visit-line snapshot** (price lock at the time the line was placed), consistent with Q1. Each price/quantity change
while `DRAFT` writes an audit event (before/after) and bumps `row_version`. Nothing outside `[min, max]` or above the
snapshotted limit is representable.

#### 4.3.1 Quantity-limit ownership and snapshot boundary (OP-1) — proposal, not implemented

| Layer                | Field (proposed)                              | Authority / writer                                                                                                                                                                                                                                                                                 | Written when                            | Later changes                                                            |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| Service (catalog)    | `services.max_quantity` (integer `>= 1`)      | The existing service **price command**, restricted to GLOBAL_ONLY `MANAGE_SERVICE_PRICES` (reason, `expectedVersion`, audited before/after). Service creation already needs `MANAGE_SERVICES` **and** `MANAGE_SERVICE_PRICES`, so it sets the initial limit. **No new permission; no role names.** | Service creation; price-command updates | Owner edits it in the catalog; affects only lines established afterwards |
| Booking service line | `booking_service_lines.max_quantity_snapshot` | The booking creation paths (customer booking, desk booking) copy it                                                                                                                                                                                                                                | When the booking line is established    | Immutable (snapshot guard)                                               |
| Visit service line   | `visit_service_lines.max_quantity_snapshot`   | Arrival copies it from the booking line; walk-in intake and the Step 3 staff-added line copy it from the catalog at that moment                                                                                                                                                                    | When the visit line is established      | Immutable (snapshot guard)                                               |
| Invoice line detail  | `invoice_line_services.quantity_limit`        | Draft creation copies it from the visit line                                                                                                                                                                                                                                                       | At DRAFT creation                       | Immutable                                                                |

Rules:

- **Example (Owner):** limit 10 when the visit line is established; the Owner later raises the catalog limit to 20; the existing
  Visit/Invoice keeps 10. Historical accuracy wins over later configuration.
- `PER_SERVICE` services have `max_quantity = 1` (CHECK); several performances are several lines. `PER_NAIL` services carry
  the Owner's limit. Changing a service to `PER_NAIL` through the price command must supply the limit.
- The existing snapshot guards (`lucy_guard_visit_service_line`, `lucy_guard_booking_child`) are extended so the new snapshot
  columns are immutable like the other snapshot columns.
- **Legacy rows:** the additive migration backfills `services.max_quantity = 1` and every existing booking/visit line snapshot
  `= 1`. `1` is the most restrictive neutral value and invents no business limit; the Owner raises the limit per `PER_NAIL`
  service afterwards. (Existing lines snapshotted `PER_SERVICE` are unaffected.)
- **Placement:** the schema change, backfill, guard extension, population in the existing line-creation paths (booking, walk-in,
  arrival copy; the Step 3 staff-added path is written to populate it) and the price-command/catalog-form extension belong to
  **Step 4** (section 19). Step 4's report must list these Phase 2/3 touch points. Nothing is implemented in Step 1.
- **No global setting:** Phase 4 adds no quantity-limit key to `app_settings` and no settings write path.

### 4.4 Discount, version, scope, supplied voucher, application, redemption

| Table                                                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discounts`                                                | The Owner-controlled **program**: `code` (unique), `name_vi/en`, **`requires_code`** (`false` = code-less promotion, automatic candidate; `true` = voucher program, candidate only via a supplied code), `terminated_at/_by/reason` (early termination), `is_active`, `row_version`. Never deleted                                                                                                         |
| `discount_versions`                                        | **Immutable configuration** per change: `discount_id`, `version_no`, `kind` (`PERCENT` \| `FIXED_AMOUNT`), `percent_bp` (basis points 1–10000) or `fixed_amount_vnd`, `valid_from/valid_until`, `min_spend_vnd`, `scope_mode` (`ALL_SERVICES` \| `SELECTED`), `usage_limit_total`, `usage_limit_per_customer` (both nullable = unlimited), `created_by`, `created_at`. Editing a program appends a version |
| `discount_version_services`, `discount_version_categories` | Scope for `SELECTED` (FKs to `services`/`service_categories`, `ON DELETE RESTRICT`)                                                                                                                                                                                                                                                                                                                        |
| `vouchers`                                                 | A redeemable **code** under a `requires_code = true` program: `discount_id`, canonical `code` (unique), `is_active`, `created_by`                                                                                                                                                                                                                                                                          |
| `invoice_voucher_entries`                                  | The codes **supplied** to a `DRAFT` invoice: `invoice_id`, `voucher_id`, `supplied_by/_at`, single removal transition `removed_by/_at`; unique active `(invoice_id, voucher_id)`. These are the voucher candidates; history is retained after finalization and is frozen there                                                                                                                             |
| `invoice_discount_applications`                            | The **winning benefit**, written **once at finalization** (at most one per invoice; immutable): `discount_id`, `version_id`, `voucher_id?`, rule snapshot (kind, value), eligible subtotal, computed amount, `candidates` (JSON: every evaluated candidate, eligibility result and amount), `selection_reason`, `finalized_by`, `applied_at`. No row exists when no benefit won                            |
| `discount_redemptions` (PRD `VoucherRedemption`)           | **Immutable, append-only** usage ledger written **at finalization for the winner only**: `invoice_id` (unique: one redemption per invoice), `discount_id`, `version_id`, `voucher_id?`, `payer_user_id?` (NULL for a guest), `redeemed_at` (server clock). It is never updated or deleted, so the fact that the redemption occurred is permanent                                                           |
| `discount_redemption_releases`                             | **Immutable, append-only** release record: `redemption_id` (**unique: a redemption is released at most once**), `released_at` (server clock), `released_by`, `cause` (`INVOICE_CANCELLED_UNPAID` \| `ZERO_BALANCE_CORRECTION`), `reason`. A redemption is **active** iff it has no release row. Written in the same transaction as the cancellation that causes it                                         |

Usage counts are **active** redemptions (no release row) per program. Per-customer counts are active redemptions of the program with the same
non-null `payer_user_id`. Releasing capacity therefore never edits or deletes the redemption: the observable history is
`redeemed` -> (invoice became `PAID` zero-balance) -> (invoice `CANCELLED` through OP-7) -> `released`, each with its own
timestamp, actor and audit record. Phase 5 benefit types (Member, Birthday, customer-specific loyalty) are **not** modeled; they will join
the candidate set through the seam in section 8.5. During `DRAFT` the winner and totals are computed by the same pure function and
shown to staff, and only the header amounts and the supplied voucher entries are stored; the frozen application and redemption rows
are written at finalization (and a release row only by a later cancellation).

### 4.5 Payment and correction

`payments` (Step 4 defines the cash shape; Step 8 extends it additively):

| Field                                  | Notes                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `invoice_id`, `branch_id`        | Branch = the invoice's branch                                                                                                                                                                                                                                                                                  |
| `method`                               | Phase 4 Step 4: `CASH`. `PAYOS` is added by the Step 8 migration                                                                                                                                                                                                                                               |
| `status`                               | `PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED` (section 5.2). Cash rows are created directly `SUCCEEDED` in one transaction                                                                                                                                                                          |
| `amount_due_vnd`                       | The **remaining balance of the invoice at the moment of collection** (before this payment), computed by the server under the invoice lock                                                                                                                                                                      |
| `amount_vnd`                           | The amount **credited toward the invoice** (`> 0`, `<= amount_due_vnd`). A smaller amount is a split payment. Independent of what was physically tendered. There is **no** zero-VND payment: a zero-balance invoice has no payment row                                                                         |
| `tendered_vnd`, `change_vnd`           | Cash only. `tendered >= amount`, `change = tendered - amount` (Phase 4 CHECK); `change` is **derived by the server**, never sent by the client. A future tip relaxes this by an additive migration; it is why credited amount and tender are separate columns                                                  |
| `collected_by_user_id`, `collected_at` | Collector = the authenticated actor. **`collected_at` is the server/database clock** (`clock_timestamp()` after the locks), never a client value; the request contract has no time field; a guard makes it immutable and requires `collected_at >= invoice.finalized_at`. `business_date` is database-computed |
| `idempotency_key`                      | UUID; unique per `(collected_by_user_id, idempotency_key)`                                                                                                                                                                                                                                                     |
| `row_version`, `created_at`            | Standard                                                                                                                                                                                                                                                                                                       |

`payment_corrections` (append-only): `id`, `payment_id` (**unique: a payment is reversed at most once**), `kind`
(`REVERSAL` only), `reason` (required), `actor_user_id`, `occurred_at` (server clock). The original payment row is **never**
edited. A payment is **effective** iff `status = SUCCEEDED` and it has no correction row.

**Provider boundary (created in Step 8, not Step 4):** `payment_attempts` (one row per provider request/poll) and
`payment_provider_events` (a webhook inbox with a unique provider dedupe key, verified-signature flag, raw payload,
processed outcome) plus provider reference columns on `payments`. They are deferred because their shape depends on the
current provider documentation and Q7 (section 16).

**Tip readiness (Q5):** Phase 4 stores neither tips nor a register/safe. A future `tips` record can reference the
payment and invoice without changing any Phase 4 row; only the cash CHECK is relaxed additively.

### 4.6 Future e-invoice integration model — **not created** (section 18)

### 4.7 Not created in Phase 4

Loyalty ledgers, product/combo/reward detail tables, tour/commission/tip tables, register/safe/closing, revenue
report tables, e-invoice documents, any global POS setting.

### 4.8 Relationships summary

`Visit 1 — 0..1 active Invoice` · `Invoice 1 — n InvoiceLine 1 — 1 InvoiceLineService -> VisitServiceLine` ·
`Invoice 1 — n InvoiceVoucherEntry -> Voucher -> Discount` · `Invoice 1 — 0..1 InvoiceDiscountApplication -> DiscountVersion -> Discount` ·
`Invoice 1 — n Payment 1 — 0..1 PaymentCorrection` · `Invoice 1 — 0..1 DiscountRedemption`.

### 4.9 Integrity guards (SQL, in Step 4)

Money `>= 0` (`total_vnd` may be 0) and `payments.amount_vnd > 0`; state-transition guard triggers; immutability after
finalization (section 6); partial unique indexes (one active invoice per visit; one application per invoice; one redemption
per invoice; one release per redemption; unique active supplied voucher per invoice); unique `code` and idempotency keys;
`payment_corrections.payment_id` unique; cash shape CHECK; `services.max_quantity` CHECK (`PER_SERVICE` => 1); **deferred
constraint trigger for reconciliation** (section 9), which also covers the zero-balance case; `ON DELETE RESTRICT` on every
reference to `services`, `service_categories`, `visits`, `visit_service_lines`, `branches`, `users`; no-delete and no-truncate
triggers reusing the Phase 3 helpers; database-computed business dates.

### 4.10 Invoice code

`INV-YYMMDD-XXXXXX`: branch-local creation date (database-computed) and six characters from the same unambiguous
alphabet as `BK-` codes (`booking.core.ts` `bookingCode`), generated with a cryptographic random source; unique
constraint with retry on collision. The code is the only customer-facing identifier.

## 5. State machines

### 5.1 Invoice

```
                 finalize (total > 0)               payments cover the receivable
   DRAFT ─────────────────────────► PENDING_PAYMENT ───────────────────────────► PAID
     │  │                               │  ▲                                       │
     │  │ finalize (total = 0)          │  └───────────────────────────────────────┘
     │  └───────────────────────────────┼──────────────────────────────────────────►│ (direct, no Payment row)
     │ cancel                           │ cancel          allowed correction (cash reversal)
     ▼                                  │                 leaves effective payments < receivable
 CANCELLED ◄────────────────────────────┘
```

| Transition                                     | Guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Permission / re-auth                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| (create) -> `DRAFT`                            | Visit `COMPLETED`; no non-cancelled invoice for the visit; branch-scoped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `MANAGE_INVOICES`                       |
| `DRAFT` -> `PENDING_PAYMENT`                   | Every line has a valid price and quantity; the engine recomputes; **calculated `total_vnd > 0`**; winning benefit application and redemption written                                                                                                                                                                                                                                                                                                                                                                                                                                         | `MANAGE_INVOICES`                       |
| `DRAFT` -> `PAID` (**zero balance**)           | Same finalization checks; **calculated `total_vnd` is exactly 0** (produced only by the engine from prices inside their ranges and configured benefits — the total is never an input). One transaction: invoice `PAID`, `paid_seq = 1`, `paid_at = finalized_at`, **no Payment row**, events `INVOICE_FINALIZED` then `INVOICE_PAID` (section 15). It never sits in `PENDING_PAYMENT`                                                                                                                                                                                                        | `MANAGE_INVOICES`                       |
| `DRAFT` -> `CANCELLED`                         | Reason required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `CANCEL_INVOICES`; no re-auth           |
| `PENDING_PAYMENT` -> `CANCELLED`               | **No effective payment** (reverse cash first); no non-terminal provider payment; reason required; the redemption (if any) is **released** by an appended release record (cause `INVOICE_CANCELLED_UNPAID`)                                                                                                                                                                                                                                                                                                                                                                                   | `CANCEL_INVOICES` **and fresh re-auth** |
| `PENDING_PAYMENT` -> `PAID`                    | Effective payments equal the receivable (section 9); performed by the payment write, never by a bare status update                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `COLLECT_PAYMENTS` (via the payment)    |
| `PAID` -> `PENDING_PAYMENT`                    | Only as the consequence of a reversal that leaves effective payments below the receivable. **Impossible for a zero-balance invoice** (it has no payment to reverse)                                                                                                                                                                                                                                                                                                                                                                                                                          | `CORRECT_PAYMENTS` + fresh re-auth      |
| `PAID` -> `CANCELLED` (`total_vnd > 0`)        | **Illegal — never available through OP-7.** An invoice with a successful/effective payment is corrected only by the Q6 path: reverse the cash payment (`CORRECT_PAYMENTS` + reason + re-auth), which returns it to `PENDING_PAYMENT`, and only then may it be cancelled by the `PENDING_PAYMENT` row above. A provider-confirmed (PayOS) payment cannot be reversed, so such an invoice cannot be cancelled in the system (Q7)                                                                                                                                                               | —                                       |
| `PAID` -> `CANCELLED` (**zero balance, OP-7**) | **Only** when **all** hold, checked in the command and backstopped by a database guard: the invoice is finalized `ZERO_BALANCE` (`total_vnd = 0`, `paid_seq = 1`, settled directly at finalization); its amount due is exactly 0; **no Payment row exists** (so none is successful/effective); a reason is supplied; the cancellation corrects a zero-balance benefit/transaction mistake and moves **no money** (not a refund). The redemption (if any) is **released** by an appended release record (cause `ZERO_BALANCE_CORRECTION`); `cancelled_from_status = PAID`; nothing is deleted | `CANCEL_INVOICES` + **fresh re-auth**   |
| `CANCELLED` -> anything                        | **Illegal** (terminal). A new invoice for the same visit may be created afterwards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                       |
| `DRAFT` from anything                          | **Illegal** (finalization is one-way)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                       |

A zero-balance invoice is a **real historical transaction** (section 4.1): it keeps its lines, subtotal, benefit, discount total,
payer, calculation version and audit. Staff cannot create it by typing a total: no request field carries a total, and the only way
to reach 0 is prices inside their ranges combined with a legitimately eligible configured benefit.

### 5.2 Payment

```
PENDING ──► SUCCEEDED          (cash: created directly SUCCEEDED)
PENDING ──► FAILED | EXPIRED | CANCELLED
SUCCEEDED ──(PaymentCorrection, cash only)──► remains SUCCEEDED but is no longer *effective*
```

`FAILED`, `EXPIRED`, `CANCELLED` and `SUCCEEDED` are terminal for `status`; a payment never returns to `PENDING`.
A `PayOS` payment becomes `SUCCEEDED` **only** through verified provider confirmation (section 16). Who may
cancel a pending provider payment, and the expiry/regenerate policy, are Q7. A zero-balance invoice never has a Payment,
and no zero-amount payment can exist (`amount_vnd > 0`).

### 5.3 Correction/reversal versus refund (Q6)

| Concept                 | Meaning                                                                                                                                                               | Phase 4                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Correction/reversal** | Marks an **erroneous accounting/payment record** (for example cash confirmed by mistake) as no longer effective, via an append-only record, reason, re-auth and audit | Cash only. The original payment stays visible. Emits `PAYMENT_REVERSED` so later phases can compensate        |
| **Refund**              | Returning money to a customer for a service already delivered                                                                                                         | **Not implemented.** Services are non-refundable (PRD 29). Product refunds are Phase 6                        |
| PayOS `SUCCEEDED`       | The external transaction happened                                                                                                                                     | **Never reversed inside Lucy Spa.** Handling of such money is outside the system (decision recorded under Q7) |

### 5.4 Visit COMPLETED and the Invoice lifecycle

- The Visit finishes independently of money. **END is never blocked, delayed or conditioned by payment or invoicing.**
- The Invoice is created **explicitly** from the POS for a `COMPLETED` Visit (lazy, idempotent), never inside the END
  transaction. A `COMPLETED` Visit without an invoice is visible on the POS board.
- Payment state is a property of the Invoice. The Visit keeps `COMPLETED`; there is **no `PAID` visit status** (the Visit
  guard makes completed visits immutable, and one stored status per concern is the Phase 3 principle). "Paid" is derived for display.
- A `CANCELLED` Visit has no invoice. A `COMPLETED` Visit contains only `DONE` and `CANCELLED` lines.
- A service requested after completion is a **new Visit** (walk-in); the completed Visit is never reopened.
- **Step 2 contract (implemented later):** a forgotten END is resolved by a manager with `RESOLVE_SERVICE_EXECUTION`
  (`end_kind = MANAGER_RESOLVED`, required reason, end time between `started_at` and now, audit `SERVICE_EXECUTION_RESOLVED`),
  making the line `DONE`; an unstarted `PLANNED`/`WAITING` line of an open visit may be cancelled with a reason and audit
  (never deleted; occupancy released by the existing trigger); after either, the Visit completes when no open line remains
  (or is cancelled by the existing rule when every line was cancelled before any start). Exact API and UI belong to Step 2.
- **Step 3 contract:** a staff-added line uses an existing, active, branch-offered service; the request has no price and no
  free-text service name; the line stores `added_on_behalf`, actor, time and KTV; it is placed through the availability engine
  under the existing locks; allowed only while the Visit is `OPEN` or `IN_SERVICE`. Its snapshot includes the service's current
  quantity limit once Step 4 introduces the column (section 4.3.1); Step 3 itself does not depend on it.

### 5.5 Cancellation paths and the OP-7 exception

| Path                                  | Applies to                                         | Money effect                              | Redemption                            |
| ------------------------------------- | -------------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| Cancel a draft                        | `DRAFT` (no redemption exists yet)                 | none                                      | none                                  |
| Cancel an unpaid finalized invoice    | `PENDING_PAYMENT` with no effective payment        | none                                      | released (`INVOICE_CANCELLED_UNPAID`) |
| **Zero-balance correction (OP-7)**    | `PAID` with `total_vnd = 0`, no Payment row        | **none — there is no payment to move**    | released (`ZERO_BALANCE_CORRECTION`)  |
| Any invoice with a successful payment | `PAID` / `PENDING_PAYMENT` with effective payments | Q6 rules only (reverse cash, then cancel) | released when finally cancelled       |

Rules of the OP-7 exception:

- It is a **correction of an erroneous zero-balance transaction/benefit**, not a refund: no service refund workflow exists or is
  introduced (services stay non-refundable, PRD 29), and no amount is returned to anyone.
- It is **not generic**: the guard requires `total_vnd = 0` and the absence of any payment row, so the transition is structurally
  impossible for an invoice that took a payment (cash, PayOS or split). Trying it on a financially settled invoice fails with a
  stable error and changes nothing; it must never be used as a shortcut around Q6.
- Authority: `CANCEL_INVOICES` at the invoice's branch (or above), a **required reason**, and **fresh password re-authentication**
  (checked server-side inside the transaction); `MANAGE_INVOICES` and `COLLECT_PAYMENTS` are not sufficient.
- History is preserved: the invoice, its lines, subtotal, applied benefit, discount total, payer, `calculation_version`, `paid_seq`
  and `paid_at` stay; the redemption stays and is released by an append-only record; the audit trail shows the redemption,
  the zero-balance `PAID` settlement, the cancellation and the release in order.
- After cancellation the visit has no active invoice, so **a new invoice may be created** for it (section 4.1 partial unique index);
  the released capacity can then be used again, subject to the normal eligibility rules.
- Events: `INVOICE_CANCELLED` carries `cancelledFrom = PAID`, `zeroBalanceCorrection = true` and `voidedPaidSeq = 1`, so any later
  consumer (for example Phase 5) that reacted to `INVOICE_PAID(invoice, 1)` can compensate; no `PAYMENT_REVERSED` is emitted (no payment).

## 6. Immutability

| Phase of life                                                                                 | May change                                                                                                                                                                          | May not change                                                                                     |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `DRAFT`                                                                                       | Payer; line unit price and quantity (within range and snapshotted limit); supplied voucher entries (add/remove, audited); recomputed totals; each change audited and version-bumped | Identity, code, visit link, line set, snapshots copied from visit lines                            |
| Finalized (`PENDING_PAYMENT`, `PAID`; cancellation adds only `cancelled_*`)                   | Only `status`, `paid_at`, `paid_seq`, `row_version` (through the legal transitions above)                                                                                           | Payer, lines, quantities, unit prices, voucher entries, application, totals, `calculation_version` |
| `CANCELLED`                                                                                   | Nothing                                                                                                                                                                             | Everything                                                                                         |
| Payments                                                                                      | `PENDING` -> terminal status only                                                                                                                                                   | Amounts, due, tender, collector, time, invoice link                                                |
| Corrections, audit, outbox, applications, discount versions, redemptions, redemption releases | **Append-only**                                                                                                                                                                     | Any rewrite or delete                                                                              |
| Voucher entries                                                                               | An entry's single removal transition (draft only) is the only permitted update                                                                                                      | Any other rewrite or delete                                                                        |

Enforcement is in PostgreSQL (guard triggers and CHECKs), not only in code. Corrections never rewrite history: a mistaken
finalized invoice is **cancelled** (with re-auth) and, if needed, **re-created as a new invoice** for the same visit; a
mistaken cash payment is **reversed** by an appended record.

## 7. Money model

### 7.1 Representation

Integer VND as `BIGINT` in PostgreSQL, `bigint`/decimal-string in TypeScript and on the wire. No floating point, no
`number` for money, anywhere. All arithmetic is exact integer arithmetic (`BigInt`).

### 7.2 Rounding (Q3)

Every monetary result derived from a percentage is rounded **half up to 1 VND**. For a percentage in basis points:

```
discount = floor((eligibleSubtotal × percent_bp + 5000) / 10000)      // integer arithmetic, half-up
```

No other rounding exists: line gross and fixed amounts are exact integers; there is **no special cash rounding**
(cash payments are exact to the dong; change is exact).

### 7.3 Calculation order and versioning (deterministic, `calculation_version = 1`)

1. For each line: `gross = quantity × unit_price` (`PER_SERVICE`: quantity 1).
2. `subtotal = Σ gross` over all lines.
3. **Candidate set** (section 8): (a) every active **code-less promotion**; (b) every **supplied and validated voucher**.
4. For **each candidate independently**:
   1. determine its **eligible lines** (`ALL_SERVICES`: all lines; `SELECTED`: only lines whose service or category is in scope);
   2. **eligible subtotal** = `Σ gross` of those lines, **before any benefit** (exact integer);
   3. test eligibility against that eligible subtotal: `eligible subtotal > 0` and `eligible subtotal >= min_spend_vnd` (OP-4), validity
      window, active/not terminated, usage limits, payer requirement (OP-3);
   4. only if eligible, compute its amount: `PERCENT`: `roundHalfUp(eligibleSubtotal × percent_bp / 10000)`;
      `FIXED_AMOUNT`: `min(fixed_amount, eligibleSubtotal)`.
5. Choose **exactly one** winner among eligible candidates (section 8.3) -> `discount_total` (0 when none).
6. `total = subtotal − discount_total` (never negative). `total` is the **receivable / amount due** and may be 0.

`minimumSpend` is **never** compared with the post-discount total, and the benefit never causes a second evaluation of
`minimumSpend` (no circularity: the eligible subtotal is fixed before the amount is computed). The engine is a pure function of
stored inputs; it lives in one module and is the only place amounts are computed. The result and `calculation_version` are
stored on the invoice. Later algorithm changes (for example Phase 5 adding candidates) use a **new version number**; finalized
invoices are **never recomputed**.

Worked example (OP-4): eligible service lines total 600,000 VND; other lines outside the program's scope total 500,000 VND;
`minimum spend = 500,000`. Eligible subtotal = 600,000, so the condition passes (the 500,000 of non-eligible lines neither help
nor hurt, and the whole-invoice subtotal of 1,100,000 is not used for this test).

### 7.4 Discount placement

Discounts are **invoice-level** results (Q4). Phase 4 does not allocate a fixed or percentage discount to individual
lines (the PRD defines no allocation rule); line `gross` is not reduced. Per-line net amounts are therefore **not
stored in Phase 4**; if a later phase needs them the Owner must define the rule then.

### 7.5 Quantity (Q1, OP-1)

`PER_SERVICE`: quantity is exactly 1. `PER_NAIL`: a positive integer not exceeding the **per-service limit snapshotted on the
line when it was established** (section 4.3.1, copied to `invoice_line_services.quantity_limit`). The limit is **not** a global
or registry setting and is **never re-read from the catalog** for an existing transaction. No unit other than the two existing
pricing units is modeled.

## 8. Discounts and vouchers (Q4, OP-3, OP-4, OP-5)

### 8.1 What Phase 4 supports

Owner-configured programs (percentage or fixed amount) with a validity period, minimum spend, scope (all services or
selected services/categories), total usage limit and per-customer usage limit, active flag and early termination, in two
candidate sources:

1. **Code-less promotion** (`requires_code = false`): an active configured promotion is **evaluated automatically** on every
   `DRAFT` calculation and at finalization. If eligible it becomes a candidate with no operator action; the operator neither
   types a code nor decides which promotion is better.
2. **Code-based voucher** (`requires_code = true`, with one or more `vouchers` codes): **never** a candidate automatically. It
   becomes a candidate only after its code has been **supplied** to the draft **and validated**; after that it joins the
   candidate set if eligible.

### 8.2 Who does what

- **Defining programs/versions/terminating:** `MANAGE_DISCOUNTS` (GLOBAL_ONLY). **Creating voucher codes:** `CREATE_VOUCHERS` (GLOBAL_ONLY). Audited.
- **Supplying/removing a voucher code** on a `DRAFT`: `APPLY_DISCOUNTS` (branch scope). It never lets anyone type a percentage or amount.
- **Validation at supply time:** the code must match an active voucher of an active, non-terminated program inside its validity window;
  otherwise it is rejected with a stable error and nothing changes. Validation is **not** a guarantee of eligibility: eligibility is
  re-evaluated by the engine on every recalculation and at finalization.
- **Code-less promotions are applied by the system.** Staff cannot remove an automatic better benefit (PRD 16.1: do not charge a
  less favorable eligible discount because staff did not select it). Removing a supplied voucher removes only that candidate.

### 8.3 Eligibility and deterministic selection (no stacking)

A candidate is **eligible** iff all of these hold (evaluated per section 7.3 step 4):

- program active and not terminated; now inside the version's validity;
- eligible lines exist, and the **eligible subtotal is greater than zero and `>= min_spend_vnd`** (OP-4);
- for a voucher: a valid, active supplied code of that program is on the invoice (OP-5);
- total usage limit not reached (counting **active** redemptions, i.e. those without a release record);
- **per-customer limit (OP-3):** if `usage_limit_per_customer` is **not null**, the invoice must have an **identified MEMBER payer**
  (`payer_user_id` not null) **and** that payer's active redemptions of the program must be below the limit. A **guest payer**
  (`payer_user_id` null) makes such a benefit **ineligible**. Identity is **never** inferred from guest name, phone, email or other
  loose data, and no account is created to satisfy the limit.
- A benefit whose `usage_limit_per_customer` is **null** does not need a payer: a guest is eligible when every other rule passes
  (the total usage limit still applies).

Selection: compute every eligible candidate's amount, choose the **largest customer benefit**. **Tie-break** (deterministic,
ordinal): equal amounts are ordered by program `code` ascending (binary/ordinal comparison), then program id ascending, then
voucher `code` ascending (two supplied codes of the same program yield the same amount). If the largest amount is 0 there is no
winner and no application row. **Exactly one** benefit wins — no stacking.

Examples (OP-5): code-less promotion worth 100,000 and a supplied valid voucher worth 150,000 -> **voucher wins**; if the voucher is
worth 50,000 -> **code-less promotion wins**; equal amounts -> the tie-break above.

The application row (written at finalization) stores every candidate, its eligibility result and amount, and `selection_reason`, so
staff can see and explain the choice and why a supplied voucher lost. Only the **winner** is redeemed: usage is consumed at
finalization under the program row lock; an eligible-but-losing or ineligible voucher consumes nothing. **Redemption lifecycle:** `redeemed` (immutable row at finalization)
-> `released` (an immutable release row written in the cancelling transaction: unpaid finalized cancellation, or the OP-7
zero-balance correction). Capacity is the count of redemptions without a release row; the redemption is never deleted or edited, and
it is never released twice (unique release per redemption, taken under the same locks as usage counting, section 14).

### 8.4 Guests

A guest payer can pay without an account and can receive any benefit that needs no per-customer identity (code-less promotions,
voucher programs with only a total limit). A per-customer-limited benefit is simply not among the guest's candidates; the POS
shows it as ineligible with the reason "member payer required". Attaching an existing member (exact lookup, before
finalization) makes it eligible on the next recalculation.

### 8.5 Seam for Phase 5 (not implemented)

The candidate step is one function that returns a list of `{source, amount, explanation}`. Phase 4 supplies only configured
discount programs and supplied vouchers. Phase 5 adds Member/Birthday candidates to the same list under a new
`calculation_version` without altering finalized invoices. Phase 4 contains no tier, wallet, birthday or point logic.

## 9. Reconciliation

Definitions: `effective_paid(invoice) = Σ amount_vnd` over payments with `status = SUCCEEDED` and **no correction row**
(0 when there are none). The receivable is `invoices.total_vnd`.

Invariants (enforced by a **deferred constraint trigger** on `payments`, `payment_corrections` and `invoices`, and
re-checked in the command):

1. `0 <= effective_paid <= total_vnd` at all times (no overpayment; cash change is not part of `amount_vnd`). For `total_vnd = 0`
   this forces `effective_paid = 0`, i.e. **no payment can exist on a zero-balance invoice**.
2. `status = PAID` ⇔ finalized and `effective_paid = total_vnd`. This holds for `total_vnd > 0` (payments cover it) **and** for
   `total_vnd = 0` (no payments, reached directly at finalization).
3. `status = PENDING_PAYMENT` ⇔ finalized and `effective_paid < total_vnd` (which implies `total_vnd > 0`). A finalized invoice
   with `total_vnd = 0` can never be `PENDING_PAYMENT`.
4. A payment's `amount_vnd` never exceeds the remaining balance (`amount_due_vnd`) at the moment it is recorded.
5. Split payment: any number of payments (CASH now, PAYOS later) whose effective amounts sum to `total_vnd`; the sum of
   **effective** amounts is the only quantity that decides `PAID`.
6. The invoice becomes `PAID` **inside the transaction** of the payment that completes it (or of the finalization when the total
   is 0), and returns to `PENDING_PAYMENT` inside the transaction of the reversal that leaves it short (each bumps
   `paid_seq`/`paid_at` accordingly and appends events).
7. Non-terminal provider payments do not count; they may not exist when cancelling (section 5.1).
8. Recorded payments and corrections are never updated or deleted. A "fake" zero-VND payment is impossible by CHECK.
9. `status = CANCELLED` ⇒ `effective_paid = 0`, and no payment can be recorded against a `CANCELLED` invoice.
10. **`PAID` -> `CANCELLED` is structurally possible only when `total_vnd = 0`** (which, by invariant 1, means no payment exists)
    **and** the invoice has no payment row at all; the database guard rejects it for any invoice with a payment row, so OP-7 cannot
    cancel a financially settled invoice. A `cancelled_from_status = PAID` invoice therefore always has `total_vnd = 0`.
11. A redemption is active iff it has no release row; a release row exists only for a redemption of a `CANCELLED` invoice; at most one
    release per redemption.

## 10. Payer and ownership model (Q2, OP-3)

- The Invoice carries `payer_user_id` (nullable). Default at creation: the Visit's `owner_user_id` (booking owner) when present.
- Before finalization an actor with `MANAGE_INVOICES` may change the payer: attach an existing member through the
  existing **exact** phone/email lookup (masked result, no enumeration, no account ever created) or clear the payer.
- Guest/walk-in payment is always possible with `payer_user_id = NULL`; no account creation is ever forced. A guest payer is
  **not** an identified customer for any redemption-limit purpose (section 8.3, 8.4).
- The payer is **never written to the Visit** (completed visits are immutable); a member who is only a participant is a
  service recipient, not a payer, unless staff attach them.
- Several participants may be on one Invoice (lines name their participant); split payment covers several methods.
  There is no invoice split by participant in Phase 4.
- **Customer access:** an authenticated customer can list and read only invoices whose `payer_user_id` is their own
  account; identity comes only from the session; no id from the browser selects another customer; foreign or missing
  invoices are indistinguishable (`NOT_FOUND`). Staff/KTV internals are limited to what the customer view needs.
- Which loyalty wallet a payer/participant earns into is a **Phase 5** decision; Phase 4 only records payer and per-line participant.

## 11. Authorization

### 11.1 Permission matrix

All codes are appended to the code-owned catalog (append-only), added by their own migration (enum values), and inserted
by `pnpm db:permissions:sync` at deployment. **No role is seeded**; the Owner grants them. Access is never decided by role name.
The Owner (kind `OWNER`) holds all, as today. The per-service quantity limit needs **no new permission** (it uses the existing
`MANAGE_SERVICE_PRICES`, section 4.3.1).

| Code               | Scope capability | Allows                                                                                                                                                                                                                                                          | Re-auth                            |
| ------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `VIEW_INVOICES`    | BRANCH_CAPABLE   | Read invoices, lines and payments of a branch; search by code/masked customer; POS board                                                                                                                                                                        | No                                 |
| `MANAGE_INVOICES`  | BRANCH_CAPABLE   | Create a draft from a completed visit, select price/quantity (within the snapshotted range and limit), set/clear payer, finalize (including a zero-balance finalization)                                                                                        | No                                 |
| `COLLECT_PAYMENTS` | BRANCH_CAPABLE   | **Record a cash payment** for an invoice of a branch where the actor holds it; (Step 8) start a provider payment — provider-operator permissions are **Q7**. It implies **no** price selection, discount, cancellation, correction or revenue-viewing authority | **No** (normal collection)         |
| `APPLY_DISCOUNTS`  | BRANCH_CAPABLE   | Supply/remove a **voucher code** on a draft (code-less promotions are applied automatically by the engine, not by this permission)                                                                                                                              | No                                 |
| `MANAGE_DISCOUNTS` | **GLOBAL_ONLY**  | Define, version and terminate discount programs                                                                                                                                                                                                                 | No (audited)                       |
| `CREATE_VOUCHERS`  | **GLOBAL_ONLY**  | Create voucher codes                                                                                                                                                                                                                                            | No (audited)                       |
| `CANCEL_INVOICES`  | BRANCH_CAPABLE   | Cancel an invoice: `DRAFT` freely with reason; `PENDING_PAYMENT` with fresh re-auth; and the **OP-7 zero-balance correction** (`PAID`, `total_vnd = 0`, no payment) with reason and fresh re-auth. It never cancels an invoice that took a payment              | Finalized/`PAID`-zero-balance only |
| `CORRECT_PAYMENTS` | BRANCH_CAPABLE   | Reverse an erroneous cash payment (reason required)                                                                                                                                                                                                             | **Always**                         |
| `VIEW_REVENUE`     | BRANCH_CAPABLE   | Read financial/revenue information at scope; reads `FINANCIAL` audit events; the basis for revenue routing once Q8 is decided                                                                                                                                   | No                                 |

Notes: `MANAGE_INVOICES` covers price/quantity selection; if the Owner later wants a separate price-selection code it is
an additive permission (not needed now). Cash collection is **permission-based only** (OP-6): it is not tied to Owner, manager,
KTV, cashier or any role name, nor to the KTV who served the customer. A KTV, a manager or anyone else may record cash only if the
Owner granted `COLLECT_PAYMENTS` at (or above) that branch. The collect **command** requires only `COLLECT_PAYMENTS`; finding and
reading the invoice through the POS board/detail requires `VIEW_INVOICES`; the two checks are independent (the Owner will normally
grant both to the same roles).

### 11.2 Scope and containment

- Branch-capable permissions use the existing engine: the invoice/payment's **branch** is the target scope; GLOBAL, REGION
  and AREA grants contain it; DENY overrides; Phase 4 adds no new scope kind.
- Every command locks the actor and re-decides authority **inside** the transaction (`runAdminCommand`), so revoked
  authority cannot be used by a stale session.
- `MANAGE_DISCOUNTS`/`CREATE_VOUCHERS` are `GLOBAL_ONLY`: a branch grant is refused by the engine and by the catalog.
- Employee hierarchy (team/subordinate checks) is **not** used for invoices; they are branch objects. Hierarchy stays the
  basis of person-targeted routing (Notification Center) only.
- The actor's account must be active and employment not ended; no other hierarchy or branch-assignment rule is added for cash
  collection beyond the permission and its scope at the invoice's branch.
- Customers never pass the workforce frame; customer reads are ownership-based only.

### 11.3 Re-authentication boundaries

Uses the existing fresh re-authentication (`hasFreshReauthentication`, the configured fresh window, the reusable web dialog).
**Required:** `CORRECT_PAYMENTS` (every reversal, together with a reason); `CANCEL_INVOICES` for a finalized invoice
(`PENDING_PAYMENT`, and the OP-7 zero-balance `PAID` correction). **Not required:** ordinary POS work (create draft, select price, finalize
including zero-balance, **record cash**, supply a code, cancel a `DRAFT`). Owner-only configuration commands (`MANAGE_DISCOUNTS`,
`CREATE_VOUCHERS`) do not require it in V1 (audited); this may be tightened without redesign.

### 11.4 `FINANCIAL` classification

- Add `FINANCIAL` to `DataClassification` (its own migration: enum value first, used later).
- All Phase 4 financial audit events (section 12) use `FINANCIAL`.
- **Reading** (extends the `EMPLOYEE_PAY` pattern in `audit-read.service.ts`): a `FINANCIAL` event is visible only with
  `VIEW_AUDIT_LOG` **and** `VIEW_REVENUE` at that branch, or unrestricted GLOBAL for both when the event has no branch.
- The nine permissions carry `dataClassification = FINANCIAL`. Step 4 must first confirm no code path treats a non-`STANDARD`
  permission classification specially (repository inspection found it consumed by audit reading and the catalog sync only).
- Outbox payloads and customer-facing responses never expose more than their audience needs.

## 12. Audit

Every command below appends an `audit_events` row **in the same transaction** with actor, entity, branch, reason where
required, before/after, request id, classification `FINANCIAL`:

`INVOICE_CREATED`, `INVOICE_PRICE_SET` (line, before/after price and quantity), `INVOICE_PAYER_SET`,
`INVOICE_VOUCHER_SUPPLIED`, `INVOICE_VOUCHER_REMOVED`,
`INVOICE_FINALIZED` (subtotal, discount total, total, `calculation_version`, the winning benefit or none, **every candidate with its
eligibility result and amount**, whether the result was zero-balance), `INVOICE_CANCELLED` (reason, `cancelledFrom`, `cancellationPath` = `DRAFT` \| `UNPAID_FINALIZED` \| `ZERO_BALANCE_CORRECTION`, the redemption released or none, and the re-authentication timestamp used for finalized/OP-7 paths), `DISCOUNT_REDEMPTION_RELEASED` (redemption, invoice, cause, reason, actor),
`PAYMENT_RECORDED` (method, **amount due, tendered, change, credited amount, collector**; the timestamp is the server's),
`PAYMENT_REVERSED` (reason, original payment reference), `INVOICE_PAID` (paid episode; `settlement` = payment or zero balance),
`INVOICE_REOPENED` (back to `PENDING_PAYMENT`), `DISCOUNT_CREATED`, `DISCOUNT_VERSIONED`, `DISCOUNT_TERMINATED`, `VOUCHER_CREATED`.
The per-service quantity limit is audited by the **existing** service price audit (`SERVICE_PRICE_CHANGED`, extended with
before/after limit; classification unchanged).
Step 2/3 audits (`SERVICE_EXECUTION_RESOLVED`, visit-line cancellation, staff-added line) stay `STANDARD` (operational).
Audit records never contain card/bank credentials, provider secrets, passwords or free-form personal data beyond ids.
Sensitive/manual actions (payer change, price selection, reversal, cancellation, voucher removal) always record a
reason or the selected values as specified above.

## 13. Idempotency

| Operation                                                    | Mechanism                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create invoice                                               | The one-active-invoice-per-visit rule is the key: a replay returns the existing invoice (no second row, no second event)                                                                                                                                      |
| Cash payment                                                 | Client UUID `idempotency_key`, unique per collector; a replay returns the stored payment (no second row, no second event); a replay never creates a second credit                                                                                             |
| Finalize (including zero balance), cancel, price/payer edits | State guard plus `expectedVersion` (`row_version`); repeating an already-applied terminal transition returns the current state quietly, with **no** second `INVOICE_PAID` for the same `paid_seq`                                                             |
| Supply/remove voucher                                        | Unique active `(invoice_id, voucher_id)`; repeats are no-ops                                                                                                                                                                                                  |
| Reversal                                                     | `payment_corrections.payment_id` unique; a repeat is a no-op returning the same result                                                                                                                                                                        |
| Cancel (all paths, including OP-7)                           | Guard on the current state plus `expectedVersion`; a repeat on an already-`CANCELLED` invoice is a quiet no-op; a `PAID` invoice with a payment row is refused every time                                                                                     |
| Redemption and release                                       | A redemption is created only at finalization for the winner (one per invoice); a release is created only by a cancellation (unique per redemption); repeating a cancellation returns the current `CANCELLED` state with **no** second release, audit or event |
| Provider webhook (Step 8)                                    | Unique provider dedupe key in the inbox; duplicates are recorded and ignored; application is a guarded state change                                                                                                                                           |
| Event consumers                                              | Unique `(event, consumer)` claim (section 15)                                                                                                                                                                                                                 |

## 14. Concurrency and locking

- **Lock order** (extends the existing one, never inverting it): graph lock (shared) -> `users` rows sorted by UUID ->
  actor session -> `visits` row (`FOR UPDATE NOWAIT`, as Step 7 does) -> `invoices` row (`FOR UPDATE`) ->
  `discounts` rows sorted by id (`FOR UPDATE`, for usage counting) -> `payments`. A command that cannot take a lock
  immediately maps the SQLSTATE (`55P03`, `40P01`, `40001`, `23505`, `23P01`) to a retryable conflict, as existing services do.
- **Invoice creation:** lock the visit, verify `COMPLETED`, insert (the partial unique index is the backstop).
- **Every invoice mutation (price, payer, voucher supply/removal, finalize, cancel) and every payment/reversal:** lock the
  invoice row first; recompute effective payments under the lock; the deferred reconciliation trigger is the database backstop.
  Two cashiers cannot jointly overpay; a payment and a cancellation serialize; a voucher change and a finalization serialize.
- **Finalization (including zero balance):** under the invoice lock and the winning program's row lock the engine runs a final time,
  checks limits, writes the application and redemption and sets the status; two concurrent finalizations cannot both consume the
  last usage.
- **Cancellation (including OP-7):** lock the invoice row first, re-read status, `total_vnd` and payment rows under the lock, then lock the
  redemption's program row (same order as finalization) and insert the release row; the unique release key and the invoice state guard make
  a concurrent second cancellation a no-op, so capacity is released exactly once and a concurrent finalization/eligibility count either sees
  the redemption active (before the release commits) or released (after), never half-released. A cancellation and a payment attempt on the same
  invoice serialize; a payment against a zero-balance or cancelled invoice is rejected.
- **Sampling time:** business timestamps (finalization, **collection**, reversal) come from the database clock after locks
  (`clock_timestamp()`), never from the client.
- **END independence:** no financial lock is ever taken by the START/END path.
- Real-concurrency race tests are required (section 20), like the Phase 3 race suites.

## 15. Events and the outbox contract

### 15.1 Events

Appended in the source transaction with `appendOutboxEvent`; schema version 1; payloads carry ids and minimal facts and
**no personal data** (consumers re-read authoritative state by id):

| Event                                                      | Aggregate                  | Emitted by                                                                  | Notes                                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVOICE_FINALIZED`                                        | `Invoice`                  | Step 5 (every finalization, including zero balance)                         | invoice id, branch, visit, `total_vnd`, `calculation_version`                                                                                                                                               |
| `INVOICE_PAID`                                             | `Invoice`                  | Step 7 (payment that completes the invoice) **and Step 5 (zero balance)**   | invoice id, branch, **`paid_seq`** (the paid episode), receivable, **`settlement`: `PAYMENT` \| `ZERO_BALANCE`**                                                                                            |
| `INVOICE_REOPENED`                                         | `Invoice`                  | Step 7 (reversal leaves it short)                                           | invoice id, `paid_seq` being reversed. Never emitted for a zero-balance invoice                                                                                                                             |
| `INVOICE_CANCELLED`                                        | `Invoice`                  | Step 5 (all invoice cancellations, including OP-7); Step 6 adds the release | invoice id, `cancelledFrom` (`DRAFT` \| `PENDING_PAYMENT` \| `PAID`), `zeroBalanceCorrection` (true only for OP-7), `voidedPaidSeq` (the voided paid episode, OP-7 only), whether a redemption was released |
| `PAYMENT_SUCCEEDED`                                        | `Payment`                  | Step 7/8                                                                    | payment id, invoice id, method, credited `amount_vnd`. **Not emitted for a zero-balance invoice (no payment exists)**                                                                                       |
| `PAYMENT_REVERSED`                                         | `Payment`                  | Step 7                                                                      | payment id, correction id, invoice id                                                                                                                                                                       |
| `PAYMENT_FAILED` / `PAYMENT_EXPIRED` / provider anomalies  | `Payment`                  | Step 8                                                                      | technical input for financial exceptions (recipients are Q8)                                                                                                                                                |
| `SERVICE_EXECUTION_RESOLVED`, visit-line cancel/add events | `ServiceExecution`/`Visit` | Steps 2–3                                                                   | operational; consumed by the existing Phase 3 relay where applicable                                                                                                                                        |

Because an invoice can be paid, reversed and paid again, **`INVOICE_PAID` is identified by `(invoice id, paid_seq)`**;
consumers dedupe on that pair, and a later phase that awards value on `INVOICE_PAID` must also honour `PAYMENT_REVERSED` **and
`INVOICE_CANCELLED.voidedPaidSeq`** (an OP-7 cancellation voids the zero-balance paid episode without any payment event).
For a zero-balance invoice the pair is `(invoice, 1)` with `settlement = ZERO_BALANCE`; its eligible paid amount is 0 (a Phase 5
consumer must read the authoritative amounts, not assume a payment exists). Both events are appended in the finalizing
transaction, `INVOICE_FINALIZED` first. Financial events use **new aggregate types** (`Invoice`, `Payment`), which the existing
Phase 3 relay and the Leave consumer already ignore (they filter by aggregate and event type).

### 15.2 Multi-consumer contract (resolves the single `published_at` limitation)

- **Financial events never use `published_at` as consumption state.** It stays NULL for them, so no consumer can hide an
  event from another.
- A new table `outbox_consumptions(event_id -> outbox_events, consumer, consumed_at, outcome)` with
  **`UNIQUE(event_id, consumer)`** records each independent consumer's handling. Each consumer has a stable name
  (for example `notifications`, later `loyalty`, `payroll`, `reporting`).
- A consumer selects events of its aggregate/event types that have **no consumption row for its own name**, in id order
  with a cursor and bounded pages; in one transaction it applies its effects **and inserts its consumption row**
  (claiming with `FOR UPDATE SKIP LOCKED`, as the Leave consumer does). A failure rolls both back, so the event is retried.
  A duplicate concurrent attempt fails the unique key harmlessly. Effects must also be idempotent by their own natural key.
- A new consumer added later starts by reading history (no consumption row exists), which gives safe backfill.
- Existing Phase 3 and Leave consumers are **unchanged** (they keep `published_at`); the new mechanism is used only for
  new financial events. It is introduced by the first migration that needs it (Step 10, first consumer), while Steps 5–9
  emit events under this contract without any consumer touching `published_at`.
- Ordering is by `occurred_at, id`; consumers must not assume strict global ordering across aggregates.
- Retention: events and consumptions are retained (no deletion), consistent with PRD 40.

## 16. PayOS provider boundary (Step 8; provisional, Q7 open)

### 16.1 Provider-neutral boundary

A `PaymentProvider` interface owned by the domain: create a payment request (returns a provider reference and a
customer-facing payment link/QR), read authoritative status, cancel a pending request, and verify+parse an inbound
notification. `PayOS` is one adapter behind it; a deterministic test provider proves the contract. When no provider
configuration exists the method is **disabled** with a clear error (nothing is mocked into production behavior).
Credentials come only from environment variables, are never committed, logged, audited or returned, and follow the
existing optional-config pattern in `packages/server/src/environment.ts` with placeholders only in `.env.example`.

### 16.2 Principles that are locked

- **Authoritative confirmation only:** a provider payment becomes `SUCCEEDED` **only** when authenticity is verified
  (signature per the current provider documentation) **and** the provider's data matches the stored payment (reference,
  amount, currency, state). **Staff can never mark a bank transfer as received.** No manual "paid" action exists.
- Webhook processing is idempotent and duplicate-safe (unique provider event key in an inbox); replays and out-of-order events are safe.
- A missed webhook is recovered by **reconciliation** (worker sweep and on-demand authoritative status read), using the
  DB-authoritative plus recovery pattern of the Phase 3 warnings (Redis is never the source of truth).
- A provider-confirmed payment is **never reversed** inside Lucy Spa (section 5.3).
- The current PayOS documentation must be **re-verified at Step 8 time**; nothing in this document assumes a payload,
  signature scheme, field name, limit or environment behavior.

### 16.3 Explicitly **unresolved** (Q7 — not locked; Owner checkpoint before Step 8)

1. Merchant account/credentials availability and the sandbox/live **acceptance policy** (what is proven before/after deployment).
2. Payment link/QR **expiry** policy.
3. **Regenerate/cancel** policy for pending requests.
4. **Final operator permissions** for provider payments (who may create, cancel, regenerate, view anomalies). OP-6 fixes only the
   **cash** rule; it does not decide provider-payment permissions.
5. Whether a partially matching or late confirmation is auto-applied or held for review.
6. How money already confirmed by the provider but wrongly created is handled outside Lucy Spa (recorded, not modeled here). This
   includes an invoice whose **content** was wrong (for example a wrong benefit) but which was settled by a confirmed PayOS payment: Q6
   forbids reversing that payment and OP-7 does not apply (it needs no payment), so no in-system correction path exists until Q7 decides.
7. Public webhook URL/deployment timing (live verification needs a reachable HTTPS endpoint, i.e. a deployment the Owner requests).

### 16.4 CSRF and session boundary for the public webhook

The global `CsrfGuard` rejects every non-GET request without same Origin, JSON, CSRF token and session cookie, so a
server-to-server webhook would be refused. The design requires an **explicit, narrow, route-level exemption** (a declared
marker on one controller route, not a path pattern or a relaxed guard) with these compensations: no session/cookie is read
or created; authenticity is the provider signature, verified **before** any state change; a small body limit; rate limiting;
constant, non-revealing responses; only the inbox write and the guarded reconciliation function may run; no workforce or
customer authority is ever implied. The exemption is designed and tested in Step 8.

## 17. Notification prerequisites (Q8 open)

**Technical prerequisites only.** The final customer/Owner/manager policy — who is notified, when, with what content, and
whether the Owner receives financial alerts directly — is **Q8**, decided by the Owner before Step 10, and is **not** locked here.

Prerequisites Step 10 will need (none implemented now):

1. **Invoice aggregate support:** widen the closed `notifications` CHECKs (`type`, `entity_type`, type/entity pairing,
   branch scope) to an `Invoice` entity and new types; registry (single source in `packages/contracts`) gains the entity,
   a target kind and i18n keys.
2. **A financial notification category** in the registry and inbox UI (VI/EN).
3. **Branch/authority-aware routing:** the existing routing resolves supervisors of a _subject employee_; invoice events have a
   branch (and possibly a collector) as subject. A branch-based recipient primitive built on the same authority graph
   (permission + scope + containment + active employment, DENY respected) is required. Which permission and levels apply is Q8.
4. **Events:** `INVOICE_PAID` (including its zero-balance form, `settlement`) and the financial exception events of section 15.1,
   consumed through the multi-consumer contract (15.2). Whether a zero-balance paid invoice, or an OP-7 cancellation of one, notifies anyone is part of Q8.
5. **Content rule:** `params` remain ids/dates/enums under an allowlist (no free text); whether amounts may appear is part of Q8.
6. **Customer inbox:** customers already have an in-app inbox; whether they receive invoice notifications is Q8.

## 18. E-invoice-ready boundary (Q10)

- Lucy Spa's Invoice is an **internal commercial transaction record/receipt** (UI: "Hóa đơn"). It is **never** labelled or
  behaves as an official Vietnamese VAT/e-invoice merely because it can be printed. Phase 4 issues no tax document and has no
  provider integration.
- **No tax fields, tax rates, tax codes, buyer tax identifiers or provider-specific attributes** are added to `invoices` or
  `invoice_lines`; guessing current Vietnamese tax-provider rules is prohibited.
- **What makes it ready:** (1) finalized invoices, lines, totals, codes and payments are immutable, so a fixed source of truth
  exists (including zero-balance invoices); (2) every correction is an appended record (reversal/cancellation), so an official
  document can be linked, replaced or adjusted later without rewriting history; (3) the internal `code` is stable and never
  reused; (4) the `Invoice` is the single aggregate a future integration references by id.
- **Future integration model (not created):** a dedicated table (for example `einvoice_documents`) referencing `invoice_id`
  with provider, provider document reference, status, timestamps and provider metadata, plus its own event history and
  outbox events, created additively when that phase is implemented. It never mutates an internal invoice.
- At that time the then-current Vietnamese regulations and the selected provider must be **re-verified**; this document
  asserts nothing about them.
- **Phase 4 print:** a browser print view of an invoice is allowed (print-friendly page, no PDF engine). PDF/Excel export is Phase 8.

## 19. Migration strategy

All migrations are additive and non-destructive; no reset, no `db push`; generated SQL is reviewed; hand-written SQL
guards follow the existing convention and the known Prisma composite-FK diff limitation is unchanged. Enum values are
committed in their own migration before any statement uses them (as `20261005000000_phase3_permission_codes` did).

| Step | Migration / change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2    | None expected (re-verify the visit/line/execution guards); a narrow forward migration only if a guard blocks a legal Step 2 transition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3    | None expected (on-behalf CHECK exists); same rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4    | (a) `PermissionCode` + nine values, `DataClassification` + `FINANCIAL`; (b) **quantity-limit foundation (OP-1):** `services.max_quantity`, `booking_service_lines.max_quantity_snapshot`, `visit_service_lines.max_quantity_snapshot`, CHECKs, backfill to 1, snapshot-guard extension; population of the snapshot in the existing booking, walk-in, arrival-copy and Step 3 staff-added paths; extension of the service price command and catalog form to set the limit under `MANAGE_SERVICE_PRICES`; (c) tables of sections 4.1–4.5 (cash shape), guards, reconciliation trigger (with the zero-balance rule), indexes. **No `app_settings` change** |
| 5–7  | None planned; forward corrective migrations only if a defect is found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8    | `payment_attempts`, `payment_provider_events`, `payments.method += PAYOS`, provider reference columns, relaxing the cash-only NOT NULLs into a per-method CHECK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 9    | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 10   | `outbox_consumptions`; widen `notifications` CHECKs (type/entity/params) for Invoice and the financial category                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 11   | None (the gate may add a forward fix migration only for a proven defect)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Because Step 4 touches Phase 2/3 code paths for OP-1, its report must list each touched file and re-run the affected Phase 3
booking/walk-in/arrival tests (focused, not the full regression). Deployment (only when the Owner asks): verified backup ->
`pnpm db:deploy` -> `pnpm db:permissions:sync` -> environment for any provider -> rebuild and restart API, Web, Worker.
Production is at 25 migrations; Phase 4 migrations are pending until then. New permission codes are inert until the Owner
grants them; after deployment the Owner should set the quantity limit of each `PER_NAIL` service (until then it is 1).

## 20. Testing strategy

Per-Step focused tests only; **one** comprehensive Final Validation Gate at Step 11. New database suites are added to the
`packages/database` `test:integration` list and API suites to `scripts/test-auth-integration.mjs`.

| Area                                   | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database invariants                    | Money CHECKs; state-transition guards; immutability after finalization; one active invoice per visit; one application/redemption per invoice; reconciliation trigger (overpay, under-pay, PAID/PENDING equivalence, **`total = 0` PAID with no payment, payment on a zero-balance invoice rejected**); no zero-VND payment; cash shape; no-delete/no-truncate; restrictive FKs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Quantity limit (OP-1)                  | Limit snapshotted at booking/visit line creation and copied to the invoice line; **catalog raised 10 -> 20 after line creation leaves the existing line at 10**; snapshot columns immutable by guard; `PER_SERVICE` => 1; quantity above the snapshot rejected; backfill to 1; no global setting exists; price-command permission (`MANAGE_SERVICE_PRICES`) and audit of the limit change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Zero-balance (OP-2)                    | Finalize with total 0 -> `PAID` directly, `paid_seq = 1`, no Payment row, lines/subtotal/benefit/discount total/payer/version preserved; events `INVOICE_FINALIZED` then `INVOICE_PAID(settlement = ZERO_BALANCE)`; no `PAYMENT_SUCCEEDED`; replay emits nothing new; total cannot be supplied by a client; cancel rule per OP-7; consumers read authoritative amounts; cancel path per OP-7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Zero-balance correction (OP-7)         | `PAID` zero-balance invoice with no payment: cancellation succeeds only with `CANCEL_INVOICES`, a reason and **fresh re-auth** (each missing element refused); `MANAGE_INVOICES`/`COLLECT_PAYMENTS` alone refused; **an invoice with a cash, PayOS or split payment (effective or reversed) is refused by the command and by the database guard**; `total_vnd > 0` refused; original lines/subtotal/benefit/discount/payer/version/`paid_seq`/`paid_at` preserved; `cancelled_from_status = PAID`; redemption row still present after cancellation and a single release row appended (cause `ZERO_BALANCE_CORRECTION`); usage capacity returns exactly once; concurrent double-cancel and cancel vs new-eligibility-count races; repeat is a no-op (no second release/audit/event); audit/event sequence redeemed -> paid -> cancelled -> released; no `PAYMENT_*` events and no money movement; new invoice can be created for the visit afterwards; no refund endpoint or state exists |
| Rounding and calculation               | Pure-function tests: half-up boundaries (`.5` cases), basis-point extremes, fixed amount capped by the eligible subtotal, large `BigInt` values, order of steps, `calculation_version` stored, no float use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Minimum spend (OP-4)                   | Eligible subtotal (scope) vs whole subtotal (the 600,000 / 500,000 / 500,000 example passes); post-discount total never used; boundary equal to minimum passes; no circular re-evaluation; scope with no eligible lines ineligible                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Pricing inputs                         | Exact vs range services; price outside `[min,max]` rejected; per-nail quantity limits; catalog change after line creation does not alter the invoice; frozen at finalization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Discounts (OP-3, OP-5)                 | Eligibility matrix (validity, scope, limits, requires-code); **code-less promotion is an automatic candidate; a voucher is not a candidate until supplied and validated**; invalid/expired/inactive code rejected without change; removal removes only that candidate; code-less 100,000 vs voucher 150,000 (voucher wins) and 50,000 (promotion wins); tie-break determinism; exactly one winner; only the winner is redeemed; not-selected voucher consumes nothing; release on cancel; config change never alters finalized invoices                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Guests (OP-3)                          | Guest payer + per-customer-limited benefit ineligible; guest + total-limit-only benefit eligible; no identity inferred from name/phone/email; attaching a member makes the benefit eligible; per-customer counts only for identified members; no account creation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Cash collection (OP-6)                 | Actor with only `COLLECT_PAYMENTS` at the branch can record cash and cannot select price, supply codes, cancel, reverse or read revenue; refused without the permission, at another branch, with DENY, or with `GLOBAL_ONLY` misuse; no role-name path; **no re-auth prompt for normal collection**; request has no timestamp/change field; `collected_at` is server time and immutable; due/tendered/change/credited/collector/method persisted; audit + event; split-payment arithmetic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Authorization and scope                | Every permission x grants x branch/area/region/global x DENY x revoked assignment x ended employment x Owner; `GLOBAL_ONLY` refusal at branch scope; KTV without grants refused; branch isolation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Re-authentication                      | Required and enforced server-side for reversal (**with reason**, `CORRECT_PAYMENTS`) and finalized-cancel; not required for ordinary POS incl. cash; expired freshness refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Idempotency                            | Replayed create/payment/finalize/cancel/reversal/voucher-supply return the original result with no duplicate rows, audit or events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Concurrency / races (real connections) | Two cashiers overpaying; payment vs cancel; double finalize (including the last discount usage); two invoices for one visit; voucher limit contention; payer change vs finalize; voucher supply vs finalize; no deadlock with the documented lock order; END unaffected by billing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Split payment and corrections          | Multi-payment sums; last-payment completion; reversal returns to `PENDING_PAYMENT`; re-payment increments `paid_seq`; append-only correction; PayOS reversal refused; no reversal path for zero-balance invoices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Immutable financial history            | Updates/deletes/truncates of payments, corrections, audit, applications, redemptions, versions rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Customer ownership                     | Only own-payer invoices (including zero-balance ones); foreign/missing indistinguishable; no id-based enumeration; session-only identity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Webhook security/replay (Step 8)       | Valid/invalid/missing signature; replay; duplicate; out-of-order; amount/reference mismatch; unknown reference; exemption limited to that route; no session effect; missing credentials disable the method                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Events/outbox                          | Emitted in the same transaction; rollback leaves none; multi-consumer independence; `INVOICE_PAID` dedupe by `paid_seq`; existing relays ignore financial aggregates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Phase 3 regression                     | Visit lifecycle, START/END, warnings, reassignment, booking/walk-in/arrival (including the new snapshot population), notification inbox unchanged; Step 2/3 additions keep occupancy and warning behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Web                                    | Permission hints, VND formatting from strings, VI/EN, no hard-coded role names, print view, ineligible-benefit reasons                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Repo gates (Step 11)                   | `format:check`, `lint`, `typecheck`, `test`, `build`, migrations on a scratch database, protected-file check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 21. Deferrals

| To      | Item                                                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 5 | Points/wallets/tiers; Member Discount; Birthday benefit/voucher; customer-specific loyalty vouchers; referral; combos and free-entitlement lines; wallet attribution of payer vs participant; awarding on `INVOICE_PAID`; correcting points on `PAYMENT_REVERSED`; mixed-invoice allocation rules |
| Phase 6 | Product lines, seller attribution, stock, product promotions/campaigns, product returns and Beauty refund flows, `REFUNDED` invoice state                                                                                                                                                         |
| Phase 7 | Tips, cash register/safe/deposits/closing, tour, commission, payroll                                                                                                                                                                                                                              |
| Phase 8 | Revenue/dashboards/reports, Excel/PDF export, audit-log UI                                                                                                                                                                                                                                        |
| TBD     | Official tax/e-invoice integration; tax fields; date-specific branch closures; booking modification; Reviews placement; service refunds (not allowed by current policy)                                                                                                                           |

## 22. Execution sequence

| Step | Name                                                                                                | Report                                        | Gate                                      |
| ---- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| 1    | Design Contract                                                                                     | this document                                 | Owner review                              |
| 2    | Visit Completion Carryover (END resolution, cancel line)                                            | `docs/PHASE4_STEP2_VISIT_COMPLETION.md`       | Owner review, checkpoint                  |
| 3    | Staff-Added Service                                                                                 | `docs/PHASE4_STEP3_STAFF_ADDED_SERVICE.md`    | Owner review, checkpoint                  |
| 4    | POS Database + Permissions Foundation (**includes the OP-1 per-service quantity-limit foundation**) | `docs/PHASE4_STEP4_DATABASE_FOUNDATION.md`    | Owner review, checkpoint                  |
| 5    | Invoice / POS                                                                                       | `docs/PHASE4_STEP5_INVOICE_POS.md`            | Owner review, checkpoint                  |
| 6    | Discounts / Vouchers                                                                                | `docs/PHASE4_STEP6_DISCOUNTS_VOUCHERS.md`     | Owner review, checkpoint                  |
| 7    | Cash / Split Payments / Payment States / Corrections                                                | `docs/PHASE4_STEP7_PAYMENTS.md`               | Owner review, checkpoint                  |
| 8    | PayOS                                                                                               | `docs/PHASE4_STEP8_PAYOS.md`                  | **Q7 answered first**; review, checkpoint |
| 9    | Customer Invoice History                                                                            | `docs/PHASE4_STEP9_CUSTOMER_INVOICES.md`      | Owner review, checkpoint                  |
| 10   | Invoice / Revenue Notifications                                                                     | `docs/PHASE4_STEP10_INVOICE_NOTIFICATIONS.md` | **Q8 answered first**; review, checkpoint |
| 11   | Final Validation                                                                                    | `docs/PHASE4_FINAL_VALIDATION.md`             | Single comprehensive gate; no deploy      |

Dependencies: 2 and 3 do not depend on invoice tables; 4 precedes 5–8; 5 precedes 6 and 7; 7 precedes 8; 5 and 7 precede
9; 7 and 8 precede 10. **Q7 must be revisited before Step 8; Q8 before Step 10.** Every Step is followed by Owner review
and a checkpoint commit/push before the next. No production deployment happens between Steps or before Step 11 unless the
Owner requests it. Live PayOS verification requires credentials and a reachable webhook and therefore a deployment the Owner requests.

Step 2 and 3 web/API pieces may be built before Q7/Q8 are answered because they depend on neither.

**Step expectations for OP-7 and the redemption release:**

- **Step 4** creates `discount_redemptions` and `discount_redemption_releases` (both append-only, unique keys as in 4.4), the `cancelled_from_status` column, and the invoice state guard that permits `PAID` -> `CANCELLED` only when `total_vnd = 0` and no payment row exists (invariants 9–11).
- **Step 5** implements the invoice cancellation command for **all** paths, including the OP-7 zero-balance correction with `CANCEL_INVOICES`, a required reason and server-verified fresh re-authentication, its audit and `INVOICE_CANCELLED` event. No redemption exists yet in Step 5, so it releases nothing; its tests cover the refusal of every invoice that has a payment row (payments themselves arrive in Step 7, so the guard is proven at the database level in Step 4/5 and re-proven end to end in Step 7).
- **Step 6** creates the redemption at finalization and **extends every cancellation path** (unpaid finalized and OP-7) to write the release row under the documented locks, with the redeem -> paid -> cancel -> release history and race tests.
- **Step 7** re-proves that a cash-paid or split-paid invoice is refused by the OP-7 path and follows only Q6.

## 23. Technical decisions: status

All seven technical decisions (OP-1…OP-6 listed as "awaiting confirmation" in revision 1, and OP-7 raised in revision 2) are now **LOCKED /
OWNER-APPROVED** (section 2.3) and are integrated above; none remains open:

| #    | Status | Where the contract now states it                      |
| ---- | ------ | ----------------------------------------------------- |
| OP-1 | LOCKED | 2.3, 3, 4.2, 4.3, 4.3.1, 7.5, 11.1, 12, 19, 20, 22    |
| OP-2 | LOCKED | 2.3, 4.1, 5.1, 5.2, 9, 12, 13, 15.1, 20               |
| OP-3 | LOCKED | 2.3, 4.4, 8.3, 8.4, 10, 20                            |
| OP-4 | LOCKED | 2.3, 7.3, 8.3, 20                                     |
| OP-5 | LOCKED | 2.3, 4.4, 8.1–8.3, 11.1, 12, 20                       |
| OP-6 | LOCKED | 2.3, 4.5, 11.1–11.3, 12, 20                           |
| OP-7 | LOCKED | 2.3, 4.1, 4.4, 5.1, 5.5, 6, 8.3, 9, 11, 12–15, 20, 22 |

**No technical decision remains open.** The only unresolved Owner checkpoints are **Q7** (before Step 8) and **Q8** (before Step 10).

One related ambiguity is **not** invented away and belongs to Q7: an invoice with a wrong benefit that was settled by a confirmed PayOS
payment has no in-system correction path (section 16.3, item 6).

## 24. Verification of this document

- Every locked decision Q0–Q6, Q9, Q10 is represented (section 2.1 and the section it names). OP-1…OP-7 are marked LOCKED and are
  integrated into data model, snapshot contract, state machine, calculation, eligibility, redemption, reconciliation, authorization,
  audit, events, testing and migration sections. Q7 and Q8 are marked **not locked** (sections 2.2, 16.3, 17) and no business
  choice under them is made.
- **Consistency checks after revision 3:** the quantity limit is per Service and snapshot-based everywhere (no global setting
  remains; `app_settings` is untouched); a zero-balance invoice needs no Payment and is covered by the state machine, the
  reconciliation invariants and the event contract; a guest payer cannot consume a per-customer-limited benefit; `minimumSpend` uses the
  eligible pre-benefit subtotal; code-less promotions are automatic candidates while vouchers need a supplied, validated code; exactly
  one benefit wins with a deterministic tie-break; cash uses `COLLECT_PAYMENTS` at branch scope without re-authentication and with a
  server-recorded time; reversal still needs `CORRECT_PAYMENTS` + reason + re-authentication + audit; **an invoice with any payment can never be cancelled through OP-7** (structural
  guard: `total_vnd = 0` and no payment row); a zero-balance invoice never has a fake 0-VND payment; redemption release is an append-only record
  that leaves the original redemption visible and cannot happen twice; no service-refund workflow was introduced (OP-7 moves no money).
- No OP decision conflicts with Q0–Q6, Q9 or Q10. OP-7 is consistent with Q6 (a payment-settled invoice still follows Q6), Q9 (`CANCEL_INVOICES`,
  re-authentication for finalized cancellation) and Q4/OP-5 (one benefit, released capacity).
- No repository fact contradicts a locked decision. Facts that constrain implementation are recorded in section 3 (notably the
  immutable COMPLETED visit, the single-consumer outbox, the existing booking/visit snapshot guards that the OP-1 columns extend,
  and the CSRF guard).
- No migration, schema, API, UI or runtime file was created or changed by this Step.
- `apps/web/next-env.d.ts` was not touched.
