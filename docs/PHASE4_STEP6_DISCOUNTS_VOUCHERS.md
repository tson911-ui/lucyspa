# Phase 4 — Step 6: Discounts / Vouchers

**Status: CLOSED / OWNER APPROVED** — implemented, validated locally, checkpoint-committed and pushed (`feat: complete phase 4 step 6 discounts vouchers`), not deployed to production. Step 7 has not started; Step 8 has not started. **Follow-up defect fix (Owner-approved): the historical service-category snapshot, section 18.**
Sources of truth: [PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md](PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md) (Q3, Q4, Q9, OP-3, OP-4, OP-5, OP-7; sections 4.4, 7, 8, 11, 12, 13, 14, 15, 22), [PHASE4_STEP4_POS_DATABASE_PERMISSIONS.md](PHASE4_STEP4_POS_DATABASE_PERMISSIONS.md) (schema, guards, section 20) and [PHASE4_STEP5_INVOICE_POS.md](PHASE4_STEP5_INVOICE_POS.md).

## 1. Why this Step ran before Step 7

The Owner asked for Step 7 and pointed at this report, which did not exist: `main == origin/main == 8e2ea72` (Step 5), the handoff said Step 6 was NOT STARTED. Step 7 depends on Step 6 (design 22: 5 precedes 6 and 7, and the sequence is one reviewed Step at a time), so one focused question was asked and the Owner answered **"Do Step 6 first"**. This is that Step. **Step 7 is not started.** The Owner's Step 7 addition is recorded for it: keep the payment architecture ready for a future CARD / POS-terminal integration, but **do not activate CARD** (Lucy Spa has no terminal yet).

## 2. Scope

Implemented on the closed Step 4/5 foundation: Owner configuration of discount programs, immutable versions and voucher codes; a pure deterministic candidate engine; live evaluation on every DRAFT edit; supplying/removing a voucher code; the winning benefit written once at finalization as the immutable application plus its redemption; release of the redemption by every cancellation path (unpaid finalized, OP-7); web screens (VI/EN) for the Owner's discount configuration and the POS voucher/benefit display.

Not implemented: payments, cash, corrections, PayOS (Steps 7–8), customer history, notifications (Steps 9–10), Member/Birthday/loyalty benefits (Phase 5), stacking, free-form or per-line discounts, tips, e-invoice/tax fields. Q7 and Q8 are untouched and unresolved.

## 3. Owner questions

One (above): the missing Step 6 report. Answered. Nothing else was ambiguous: design 8.1–8.4 fix the eligibility, selection, guest and lifecycle rules and Step 4 fixed the schema, so no locked decision was reopened and no Step 4 invariant was weakened.

## 4. Engine (`apps/api/src/pos/discount.engine.ts`, pure)

`calculation_version = 1`; integer VND in `bigint`; no I/O.

1. Candidate set: (a) every **active, non-terminated code-less promotion** (`requires_code = false`) not yet expired, (b) every **supplied voucher** (whatever its state, so staff see why it failed).
2. For each candidate independently: eligible lines by scope (`ALL_SERVICES`, or `SELECTED` by service **or** category); **eligible subtotal = Σ gross of in-scope priced lines, before any benefit** (OP-4); unpriced lines never count.
3. Eligibility, first failing reason wins: `NOT_ACTIVE` (paused/terminated) → `VOUCHER_INACTIVE` → `NOT_STARTED` (`now < valid_from`; inclusive start) → `EXPIRED` (`now >= valid_until`; exclusive end) → `NO_ELIGIBLE_LINES` → `BELOW_MIN_SPEND` (eligible subtotal `< min_spend`) → `TOTAL_LIMIT_REACHED` (active redemptions ≥ limit) → OP-3: with a per-customer limit, `MEMBER_REQUIRED` for a guest payer or `CUSTOMER_LIMIT_REACHED` for a member at the limit.
4. Amount (only when eligible): `PERCENT` = `floor((eligible × bp + 5000) / 10000)` (half up to 1 VND, Q3); `FIXED_AMOUNT` = `min(fixed, eligible)`.
5. **Exactly one winner** (OP-5, no stacking): largest amount; ties by program `code`, then program id, then voucher `code`, all **ordinal** (binary) string comparison, order-independent. A candidate worth 0 never wins. `selection_reason` = `ONLY_ELIGIBLE` | `LARGEST_BENEFIT` | `TIE_BREAK_CODE_ORDER`.
6. `total = subtotal − discount` (never negative; may be exactly 0). The same function runs for the live DRAFT view and for finalization.

## 5. API

### 5.1 Owner configuration — `/api/v1/discounts` (all decided inside the transaction; `MANAGE_DISCOUNTS` / `CREATE_VOUCHERS` are **GLOBAL_ONLY**: a branch grant, even if the database were to store one, authorizes nothing)

| Route                                  | Permission                                       | Purpose                                                                                                                       |
| -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /` , `GET /:id`                   | `MANAGE_DISCOUNTS` or `CREATE_VOUCHERS` (GLOBAL) | Programs with the current version, derived status, active redemptions; detail with all versions and voucher codes             |
| `POST /`                               | `MANAGE_DISCOUNTS`                               | Create a program with its first version (`code` immutable, `requiresCode` immutable)                                          |
| `POST /:id/versions`                   | `MANAGE_DISCOUNTS`                               | Append an immutable version (optionally correct the names); `expectedVersion` = program version                               |
| `POST /:id/active`                     | `MANAGE_DISCOUNTS`                               | Pause / resume (reversible)                                                                                                   |
| `POST /:id/terminate`                  | `MANAGE_DISCOUNTS`                               | Early, **permanent** termination with a reason; a repeat is a quiet no-op                                                     |
| `POST /:id/vouchers`                   | `CREATE_VOUCHERS`                                | Create a code under a code-requiring program: explicit (canonicalized) or generated (10 characters, alphabet without 0/1/I/O) |
| `POST /:id/vouchers/:voucherId/active` | `CREATE_VOUCHERS`                                | Switch one code off/on                                                                                                        |

Validation (API; the Step 4 CHECKs are the backstop): code `^[A-Z][A-Z0-9_]{0,63}$` (upper-cased); non-blank names; `PERCENT` needs integer `percentBp` 1–10000 and no amount, `FIXED_AMOUNT` needs a VND `> 0` and no percentage; `valid_until > valid_from`; `min_spend >= 0`; `ALL_SERVICES` names no scope, `SELECTED` names at least one existing service/category; limits are null or `1…2³¹−1`. Errors: `DISCOUNT_CODE_TAKEN`, `DISCOUNT_STATE_INVALID` (terminated program, voucher for a code-less program), `CONFLICT` (stale version / unique race), `VALIDATION_FAILED` with a field. Bodies are strict: unknown fields (a total, a branch, a refund flag) are rejected.

### 5.2 POS — `/api/v1/pos` additions

| Route                                                            | Permission (at the invoice's branch) | Purpose                                           |
| ---------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| `POST invoices/:id/vouchers` `{expectedVersion, code}`           | `APPLY_DISCOUNTS`                    | Supply a code to a DRAFT                          |
| `POST invoices/:id/vouchers/:entryId/remove` `{expectedVersion}` | `APPLY_DISCOUNTS`                    | Withdraw that code (never an automatic promotion) |

A code is accepted only for an active voucher of an active, non-terminated program whose **current version is inside its validity window**; otherwise **one stable error `VOUCHER_INVALID`** whatever the reason (unknown, malformed, inactive, expired, not started, paused, terminated: no hint, nothing changes). Supplying is not a guarantee of eligibility; the engine re-evaluates every time. A repeat of a supplied code is a quiet no-op; a stale `expectedVersion` is `CONFLICT`. Nothing about a percentage or an amount can be typed by staff.
`InvoiceResponse` gained `discount` (`preview`, every `candidates[]` with eligibility reason and amount, `winner`, `selectionReason`, supplied `vouchers`, `appliedAt`) and `actions.applyVouchers`.

## 6. Draft behavior and finalization

- **DRAFT:** every edit (price, quantity, payer, voucher supply/removal) recomputes and stores the header `discount_total`/`total` (a payer change matters because of OP-3). `GET`/`open` show the **live** evaluation. A draft stores only the header amounts and the supplied entries: **no application, no redemption**.
- **Finalize** (`MANAGE_INVOICES`): under the invoice lock, every candidate program's row is taken `FOR UPDATE` **sorted by id** (design 14), usage is counted over **active** redemptions (those without a release row), the engine runs at the database clock, and in one transaction: `invoice_discount_applications` (immutable, stores **every evaluated candidate**, eligibility and amount, and the selection reason) → `discount_redemptions` (payer = the invoice's payer, NULL for a guest) → the invoice update (discount total = the applied amount; direct `PAID` with no Payment row when the total is exactly 0, OP-2). Only the **winner** consumes usage; an eligible loser or ineligible voucher consumes nothing. `INVOICE_FINALIZED` audit carries the benefit and all candidates; the event payload gained `discountTotalVnd`.
- **Replay** by the same actor returns the current state with no second application, redemption, audit or event. Finalized invoices are never recomputed; a later program version or termination does not change them.

## 7. Cancellation and release (design 5.5, 8.3, 14)

After the invoice is updated to `CANCELLED`, under the same locks (invoice → the redemption's program row), an **append-only release row** is inserted in the same transaction: cause `INVOICE_CANCELLED_UNPAID` (from `PENDING_PAYMENT`) or `ZERO_BALANCE_CORRECTION` (OP-7, `PAID` with total 0). The redemption row itself stays (history: redeemed → [zero-balance PAID] → cancelled → released). Capacity returns exactly once (unique release per redemption; a repeated cancellation by the same actor is a quiet no-op; another actor gets `INVOICE_STATE_INVALID`). A DRAFT cancellation releases nothing. A terminated program still releases. Audit `DISCOUNT_REDEMPTION_RELEASED`; `INVOICE_CANCELLED` audit `redemptionReleased` = the redemption id and the event carries `redemptionReleased: true`.

## 8. Authorization, audit, events

- `MANAGE_DISCOUNTS` (programs/versions/pause/terminate) and `CREATE_VOUCHERS` (codes) are separate GLOBAL_ONLY authorities; `APPLY_DISCOUNTS` (branch) only supplies/removes codes; none implies price, cancellation, collection or revenue authority. No role is seeded; access is never by role name. Cancelling a finalized invoice still needs fresh re-authentication.
- New FINANCIAL audit actions (branch NULL for configuration, so readable only with GLOBAL `VIEW_AUDIT_LOG` + `VIEW_REVENUE`): `DISCOUNT_CREATED`, `DISCOUNT_VERSIONED`, `DISCOUNT_ACTIVE_CHANGED`, `DISCOUNT_TERMINATED` (reason), `VOUCHER_CREATED`, `VOUCHER_ACTIVE_CHANGED`; branch-scoped `INVOICE_VOUCHER_SUPPLIED`, `INVOICE_VOUCHER_REMOVED`, `DISCOUNT_REDEMPTION_RELEASED`. `INVOICE_PRICE_SET`/`INVOICE_PAYER_SET`/`INVOICE_FINALIZED`/`INVOICE_CANCELLED` audits gained the discount facts. Audit is append-only (runtime-enforced, tested).
- No new outbox event type (design 15.1 has none for discounts); `INVOICE_FINALIZED` and `INVOICE_CANCELLED` payloads gained additive fields (`discountTotalVnd`, `redemptionReleased` now real). The existing relays still ignore the `Invoice` aggregate.

## 9. Idempotency and concurrency

Locks follow design 14: shared graph lock → users → session → invoice → **program rows sorted by id** → (Step 7) payments. Real-connection race suite (committed data, two-party latch, three to four rounds each): (1) two invoices finalizing for the **last usage** of a total-limited promotion → both finalize, exactly one redemption, one discounted; (2) one member's two invoices under a per-customer limit → one redemption; (3) two concurrent cancellations of one finalized invoice → one `OK`, one `INVOICE_STATE_INVALID`, **one release**, one audit/event; (4) a release racing the next finalization → never half-released (the loser either counts the usage as taken or as free; active redemptions always ≤ 1 and consistent with the redemption row); (5) voucher supply racing finalization on the same version → exactly one wins, no half-applied benefit.

## 10. Web (VI/EN, existing components)

- **"Ưu đãi / Discounts"** (management group, shown only with **GLOBAL** `MANAGE_DISCOUNTS` or `CREATE_VOUCHERS`; a branch grant never shows it): program list (benefit, Vietnam-time validity, derived status, usage); create form; program detail with the version in force, immutable history, **new version** (prefilled), pause/resume, termination with reason, voucher codes (create/generate, on/off, usage). Percent is typed as a decimal percent (≤ 2 decimals → integer basis points), validity in **Vietnam time (UTC+7)** sent as ISO instants; scope pickers list services and categories.
- **POS invoice:** discount row in the totals, the winning benefit with its explanation, every candidate with a localized ineligibility reason, the supplied codes with **Remove**, and a code input (`APPLY_DISCOUNTS` only) that can send nothing but a code. A draft's board total shows "—" (the live figure is on the invoice).
- Still absent everywhere: payment, cash, PayOS, refund, tip, loyalty.

## 11. Schema / migrations

**One additive migration**, `20261015000000_phase4_step6_service_category_snapshot` (section 18): the historical category snapshot for discount scope. The closed Step 4 migrations are untouched; the discount tables, CHECKs and guards were otherwise sufficient. Contract types were appended to `packages/contracts`. No permission was added or granted (run `pnpm db:permissions:sync` at deployment as before). Production would have 32 migrations after it.

## 12. Implementation-level decisions (no locked decision changed)

1. **Program locking at finalization takes every candidate program's row** (not only limited ones), sorted by id, so counts are read after the lock; the Step 4 redemption guard re-checks under the same lock.
2. **Scope by category** uses the **historical category snapshot** of the invoice line (section 18), never the live service. (The first version of this Step read the live category; the Owner rejected that as a historical-accuracy defect and the snapshot below replaced it.)
3. **Draft candidates exclude expired programs** (they would only clutter the list); not-yet-started programs are shown as `NOT_STARTED`; a supplied voucher is always shown with its result.
4. **Draft header vs live view:** the stored header is refreshed with each draft edit; a draft freshly opened is stored with discount 0 until its first edit, while the detail view is always live and finalization recomputes. The web board therefore shows "—" for a draft total.
5. Extra audits `DISCOUNT_ACTIVE_CHANGED` / `VOUCHER_ACTIVE_CHANGED` for the pause/switch commands (the design lists none for them; the `DISCOUNT_`/`VOUCHER_` prefix is already FINANCIAL by the Step 4 CHECK). Program names can be corrected while appending a version; the code and the code requirement never change.
6. Voucher codes generated by the system are 10 characters of a 32-symbol alphabet (~50 bits), never sequential. There is **no rate limit on supplying wrong codes** beyond the authenticated staff session (a deferral, see 15).

## 13. Files

New: `apps/api/src/pos/discount.engine.ts`, `discount.eval.ts`, `apps/api/src/discounts/{discount.core,discount.service,discount.controller}.ts`; tests `pos/discount.engine.test.ts`, `pos/discount.integration.test.ts`, `pos/discount.race.integration.test.ts`, `discounts/discount.http.test.ts`; web `lib/workforce/discounts.ts` (+ `discounts.test.tsx`), `components/workforce/screens/{discounts,discount-detail,discount-form}.tsx`, `app/[locale]/workforce/(app)/discounts/{page,[id]/page}.tsx`.
Modified: `pos/invoice.core.ts` (evaluation, finalize, cancel, voucher commands), `invoice.service.ts`, `invoice.controller.ts`, `app.module.ts`, `auth/auth.error.ts` (`VOUCHER_INVALID`, `DISCOUNT_STATE_INVALID`, `DISCOUNT_CODE_TAKEN`), `packages/contracts/src/index.ts`, `pos/invoice.integration.test.ts` (three additive expectations), web `i18n/workforce.ts`, `permissions.ts` (+test), `pos-invoice.tsx`, `pos.tsx`, `pos.test.tsx`, `app/workforce.css`, `scripts/test-auth-integration.mjs` (two suites registered); category-snapshot follow-up: the new migration, `packages/database/prisma/schema.prisma`, `booking/booking.core.ts`, `operations/operations.core.ts`, `operations/visit-service-add.core.ts`, `walkin/walkin.core.ts`, `pos/discount.eval.ts`, `pos/discount.engine.ts`, and additive assertions in the booking, arrival, walk-in, staff-added-service, database-foundation and discount tests. `apps/web/next-env.d.ts` untouched.

## 14. Tests and exact results (scratch database `lucy_spa_step6_validation_20260930`, all 31 migrations, recreated clean before the final run)

| Suite                                                                                                                                                                                                                                                                                                         | Result                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `pos/discount.engine.test.ts` (pure: half-up, cap, scope, OP-4 example, tie-breaks, OP-3, limits, reasons, zero total)                                                                                                                                                                                        | 10/10                              |
| `pos/discount.integration.test.ts` (rollback fixtures, per-sub-test savepoints: programs/authority/validation/versions/pause/terminate/vouchers/audit; draft evaluation; OP-3; voucher supply/remove; finalize; tie-break; total and per-customer limits; zero balance + OP-7 release; unpaid release; audit) | 12/12                              |
| `pos/discount.race.integration.test.ts` (real connections; 3 further consecutive runs)                                                                                                                                                                                                                        | 6/6, 6/6 ×3                        |
| `discounts/discount.http.test.ts` (strict bodies, CSRF/Origin, safe errors)                                                                                                                                                                                                                                   | 1/1                                |
| Step 5 regression: `invoice.integration` 10/10, `invoice.race` 5/5, `invoice.http` 1/1; `authorization`, `role-admin`, `service-catalog` integration                                                                                                                                                          | all pass (combined run: **67/67**) |
| `pnpm test`: API units 162 pass / 55 integration skipped (was 151), web **173** (was 163), server 22                                                                                                                                                                                                          | pass                               |
| `pnpm format:check`, `pnpm lint` (+ boundaries), API build, web `tsc --noEmit`                                                                                                                                                                                                                                | pass                               |

**Known failure not related to this Step:** `pnpm test` also runs the worker package, whose two Step 9 notification tests (`Redis job loss…`, `real Redis delayed-job loss…`) fail on a fixture insert: the fixture builds `serviceDate` from the UTC date of the arrival while the Step 1 visit guard requires the branch-local date; the run happened at 00:16 UTC (07:16 in Vietnam). The worker sources, the database and every file it uses are unchanged in this Step; it is a time-of-day-dependent fixture of the same class as the known `My Income` assertions (handoff fact 4). Worker units 15/18 pass.
A first run of the race suite left committed fixture rows because its cleanup referenced a variable declared inside the `try` (a test bug, fixed); those rows made a later combined run fail until the scratch database was recreated. The final combined run above is on a clean database.
The Step 4 database package suites were not rerun (no database or schema change). Web production build not run (it regenerates `next-env.d.ts`).

## 15. Deferrals and limitations

Step 7: cash/split payments, payment states, reversal/correction (and re-proving that a paid or split-paid invoice is refused by OP-7), **with the Owner's CARD-readiness requirement (architecture ready, method not activated)**. Step 8: PayOS (Q7 first). Steps 9–10: customer invoice history, notifications (Q8 first). Phase 5: Member/Birthday/loyalty candidates through the same candidate list under a new `calculation_version`. Not built: a supply-attempt rate limit for wrong voucher codes; a list of a program's redemptions (only counts); editing a program's code or requirement (immutable by design); a voucher-code bulk generator (one code per command).

## 16. Q7 / Q8

Untouched and unresolved Owner checkpoints (Q7 before Step 8, Q8 before Step 10).

## 17. Confirmations

**Closure:** Owner approved (including the historical category snapshot follow-up). Committed and pushed, not deployed. `apps/web/next-env.d.ts` untouched. Step 4 migrations not modified; the only migration added is `20261015000000_phase4_step6_service_category_snapshot`. Step 7 and Step 8 not started. `LUCYSPA_HANDOFF.md` records Step 6 as CLOSED / OWNER APPROVED. Q7 and Q8 remain unresolved.

## 18. Follow-up: historical service-category snapshot (Owner-approved defect fix)

**Defect.** The first implementation read the category for a `SELECTED`-by-category discount from the live `services.category_id` (through `InvoiceLineService.service`). Because the catalog may move a service to another category at any time, a move after the Visit could change the eligibility, candidates, winner and amount of an existing DRAFT and of the finalization run (a finalized invoice was already safe). The transaction snapshots did not record the category. This violated the approved historical-accuracy rule (Q1: catalog changes never alter an existing transaction).

**Fix.** An immutable `service_category_id` snapshot now travels with the other catalog inputs: **BookingServiceLine → VisitServiceLine → InvoiceLineService**.

- **Populated when the snapshot is first created:** booking creation (`booking.core`), walk-in intake (`walkin.core`) and the staff-added service (`visit-service-add.core`) take the service's category at that moment; **arrival** (`operations.core`) copies the booking line's value; **invoice opening** (`invoice.core`) copies the visit line's value. The application sets it explicitly on every path; the database also fills an unset value on INSERT (booking line, walk-in/staff-added visit line: the service's category at that instant; carried visit line and invoice detail: the upstream snapshot), so no creation path can silently omit it.
- **Guards (the existing ones, extended, same style as the price/limit snapshot):** the booking-line and visit-line guards add the column to the protected snapshot columns (immutable); a **carried visit line must equal its booking line's snapshot** (a different value is rejected: "copies the historical category of its booking line"); the invoice-detail guard requires an **exact copy of the visit line's** value ("The invoice line must copy the visit line snapshot") and stays insert-only.
- **Discount evaluation** reads only `InvoiceLineService.service_category_id` (`discount.eval.ts`). `serviceId` scope is unchanged. An **unknown (NULL) category never matches a category scope** (`discount.engine.ts`).
- **Column** is nullable on purpose: NULL means _unknown_, never a guess; new rows created through the application always have it.

**Migration and backfill** (`20261015000000_phase4_step6_service_category_snapshot`, additive; Step 4 migrations untouched; the guards below are the current definitions plus the category and nothing else). The historical category cannot always be read from the current catalog, but the audit trail records every category move (`SERVICE_UPDATED`, `before.categoryId`). The backfill is therefore derived, not invented:

1. Booking line / non-carried visit line created at T: if no category move of that service was recorded after T, the current category **is** the historical one; otherwise the category at T is the `before` value of the **first** recorded move after T. It is kept only if that category still exists and the first move is unambiguous (two moves at the very same instant cannot be ordered); otherwise it stays **NULL (unknown)**.
2. Visit lines that carry a booking line copy that snapshot; invoice details copy their visit line's (snapshot-to-snapshot).
3. The user triggers of the three tables are switched off only for those one-off UPDATEs (table-owner privilege, no superuser needed) and switched back on before the guards are replaced.
   Not detected: category changes made outside the audited catalog command (direct SQL) leave no trace and cannot be known.

**Backfill validated on a production-shaped scratch database** (31 migrations, then legacy rows, then this migration): a service moved twice (categories A→B→D at separate instants) → historical **A** (current D); a service never moved → its category; two moves recorded at one instant → **NULL**; a service whose former category was later deleted → **NULL**; the legacy visit line and the legacy draft invoice detail copied the same historical value.

**Focused tests (all pass):**

| Check                                                                                                                                                                                                                                                                                                       | Result                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Category-scoped discount uses the historical snapshot; moving the live service after the snapshot changes neither the draft, a draft edit, nor finalization (and a new visit of the moved service snapshots the new category); service scope unaffected; invoice detail immutable (`discount.integration`)  | pass (13/13 in that suite) |
| Engine: NULL category never matches a category scope, service scope and known categories unaffected (`discount.engine.test`)                                                                                                                                                                                | 11/11                      |
| Snapshot propagation and immutability per path: booking creation (`customer-booking`), arrival carry (`operations`), walk-in (`walkin`), staff-added service (`visit-service-add`), invoice opening (`invoice`, `discount`), each also asserting a later live category move does not alter the stored value | pass (combined run 76/76)  |
| Database guard (`phase4-pos-foundation`, new sub-test): fill at creation, immutability (booking, visit, invoice detail), carried-line copy and mismatch refusal, invoice-detail mismatch refusal, unaffected by later moves                                                                                 | pass (file 21/21)          |

The full regression matrix was intentionally **not** rerun for this fix. Not rerun: the discount race suite, HTTP suites, worker tests, web tests (no web or API-shape change).
