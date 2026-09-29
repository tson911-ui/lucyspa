# Phase 4 — Step 5: Invoice / POS

**Status: CLOSED / OWNER APPROVED** — implemented, validated locally, checkpoint-committed and pushed (`feat: complete phase 4 step 5 invoice pos`), not deployed to production. Step 6 has not started.
Sources of truth: [PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md](PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md) (locked decisions Q0–Q10, OP-1…OP-7; sections 4, 5, 11, 20, 22) and [PHASE4_STEP4_POS_DATABASE_PERMISSIONS.md](PHASE4_STEP4_POS_DATABASE_PERMISSIONS.md) (schema, guards, section 20 contract notes).

## 1. Scope

Implemented on the closed Step 4 foundation: create/open the invoice of a COMPLETED visit, build its lines from the visit's DONE service lines, choose a concrete price and quantity inside the historical snapshot, resolve/change the payer, server-calculated totals, finalize (including the zero-balance direct `PAID`, OP-2), cancellation for every scheduled path (DRAFT, finalized-unpaid, OP-7 zero-balance `PAID`), a read API + POS board, and a functional VI/EN web POS.

Not implemented (later steps): discounts/vouchers/redemptions (Step 6), cash payments/corrections/PayOS (Steps 7–8), receipts, revenue/notification wiring (Step 10), official e-invoice (Q10), product POS, loyalty, tips. Q7 and Q8 are untouched and remain unresolved Owner checkpoints.

## 2. Owner questions

None. Design 11.1 assigns price/quantity selection, payer set/clear and finalize to `MANAGE_INVOICES`; design section 22 puts the cancellation command for all three paths in Step 5 and 5.5 requires fresh re-authentication outside DRAFT. No Step 4 invariant is weakened, no design decision is reopened.

## 3. Lifecycle

`DRAFT -> PENDING_PAYMENT` (finalize), `DRAFT -> PAID` directly only for a receivable of exactly 0 (no Payment row, `paid_seq = 1`, `paid_at = finalized_at`), `DRAFT | PENDING_PAYMENT | PAID(total 0, no payment row) -> CANCELLED`. `PAID -> CANCELLED` with any payment row is refused (`INVOICE_CANCEL_NOT_ALLOWED`; Step 7/Q6). A cancelled invoice keeps every fact; a new invoice may then be created for the visit (Step 4 partial unique index: one non-CANCELLED invoice per visit).

## 4. API (all under `/api/v1/pos`, session cookie; mutations need JSON, exact Origin and CSRF)

| Route                                           | Permission (at the record's own branch) | Purpose                                                                                                                        |
| ----------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET branches/:branchId/board?date=`            | `VIEW_INVOICES`                         | COMPLETED visits with no active invoice + invoices, trailing 7 branch-local days ending at `date` (default today); `canManage` |
| `GET branches/:branchId/members?phone=\|email=` | `MANAGE_INVOICES`                       | Exact-match member lookup (masked contacts; reuses the walk-in lookup)                                                         |
| `POST visits/:visitId/invoice` (empty body)     | `MANAGE_INVOICES`                       | Open the active invoice of a COMPLETED visit, creating a DRAFT; returns `{ invoice, created }`                                 |
| `GET invoices/:id`                              | `VIEW_INVOICES`                         | Invoice with lines, readiness and permitted `actions`                                                                          |
| `POST invoices/:id/lines/:lineId/price`         | `MANAGE_INVOICES`                       | `{ expectedVersion, unitPriceVnd?, quantity? }`                                                                                |
| `POST invoices/:id/payer`                       | `MANAGE_INVOICES`                       | `{ expectedVersion, payerUserId: uuid \| null }`                                                                               |
| `POST invoices/:id/finalize`                    | `MANAGE_INVOICES`                       | `{ expectedVersion }`                                                                                                          |
| `POST invoices/:id/cancel`                      | `CANCEL_INVOICES`                       | `{ expectedVersion, reason }`                                                                                                  |

Bodies are strict (`forbidNonWhitelisted`): a client can never send a total, subtotal, line gross, price range, quantity limit, status, branch, visit or payer details. Only the permitted choices exist. The record's branch is always read from the database; the client never selects it. New public errors (all 409): `INVOICE_VISIT_NOT_COMPLETED`, `INVOICE_STATE_INVALID`, `INVOICE_NOT_READY`, `INVOICE_CANCEL_NOT_ALLOWED`; conflicts/deadlocks/lock timeouts/serialization/unique races map to `CONFLICT`, never to raw database errors.

## 5. Draft creation

- Visit row locked `FOR UPDATE` (blocking): concurrent creations serialize, the second finds the first's invoice and returns it (`created:false`). The Step 4 partial unique index is the backstop. Never created inside the END transaction; the visit is never mutated or reopened.
- Lines = exactly the visit's DONE service lines (cancelled lines never), each an `invoice_lines` row plus an exact `invoice_line_services` snapshot (historical price range, quantity limit, pricing unit, KTV, participant, item code/names, `added_on_behalf`). The live catalog is never read.
- Business date and `created_at` come from the database clock (`now()`, `lucy_branch_local_date`) so the Step 4 guard agrees. The invoice code uses the Step 4 generator with up to 5 collision retries.
- A visit with no DONE line cannot be invoiced (`INVOICE_VISIT_NOT_COMPLETED`).

## 6. Payer

Default: the visit's booking owner (`CUSTOMER`) when there is one, otherwise NULL = guest payer (never inferred from guest names/phones). `MANAGE_INVOICES` may set an active member found by exact phone/email lookup, choose the booking owner, or clear to guest — DRAFT only, versioned, audited. Only an ACTIVE customer account is accepted; any other account is rejected (`VALIDATION_FAILED payerUserId`). Frozen at finalization by the Step 4 guards.

## 7. Price and quantity

- Range price (min < max): stays unset at creation; the cashier chooses an integer VND in `[min, max]` of the **historical** snapshot. Exact price (min = max): set automatically at creation.
- PER_SERVICE: quantity exactly 1 (automatic). PER_NAIL: quantity is a positive integer in `[1, quantityLimit]` chosen by the cashier (OP-1 snapshot).
- Repeating the same choice is a no-op (no version bump, no audit). Editing after finalization is impossible (guard + `INVOICE_STATE_INVALID`).

## 8. Calculation (`calculation_version = 1`, `apps/api/src/pos/invoice.calc.ts`)

Integer VND in `bigint`, no floating point, no rounding: line gross = quantity × unit price; subtotal = Σ gross; discount total = 0 in Step 5 (Step 6 supplies it); total = subtotal − discount. Totals are recomputed on the server after every price edit and at finalization from the stored lines. The Step 4 database guards re-verify the same rules.

## 9. Authorization and scope

Every request is authorized inside its transaction against the record's own branch (`decide` on the authorization graph; deny beats grant; GLOBAL covers branches; branch grants never cover other branches). Sessions resolve inside the transaction with the shared auth-graph lock, so a permission/role/scope change is honored on the next command. A customer, an outsider, a user missing the permission, and a user with the permission in another branch are all rejected with `FORBIDDEN` (an unknown id is `NOT_FOUND`; ids are unguessable UUIDs). Cancellation of a finalized invoice or the OP-7 correction needs fresh password re-authentication (`REAUTHENTICATION_REQUIRED`, the existing `freshAuthSeconds` rule); a DRAFT cancel does not.

## 10. FINANCIAL audit and events

Audit actions (classification always `FINANCIAL` by the Step 4 CHECK, so visible only to `VIEW_AUDIT_LOG` + `VIEW_REVENUE`): `INVOICE_CREATED`, `INVOICE_PRICE_SET`, `INVOICE_PAYER_SET`, `INVOICE_FINALIZED`, `INVOICE_PAID` (zero balance), `INVOICE_CANCELLED` (with the from-status/path and reason). Audit metadata carries ids, amounts, versions and reasons; no password, contact detail or free-form guest data. Outbox aggregate `Invoice`: `INVOICE_FINALIZED`, `INVOICE_PAID` (settlement ZERO_BALANCE), `INVOICE_CANCELLED`, written in the same transaction. The existing relays filter by aggregate type and ignore them (verified); no notification is created (Step 10).

## 11. Idempotency and concurrency

- Commands lock the invoice row `FOR UPDATE` and compare the invoice `expectedVersion`; a stale version is `CONFLICT` and writes nothing.
- Finalize replay: same actor, `rowVersion == expectedVersion + 1`, already finalized → current state, no second audit/event. Cancel replay: same actor, already CANCELLED → current state. A different actor's terminal state is `INVOICE_STATE_INVALID`.
- Lock order follows Step 4 section 20 (shared auth-graph lock → visit → invoice); timestamps come from the database clock.
- Real-connection races (committed data, two-party latch): concurrent open ×2 → one invoice, one `INVOICE_CREATED`, one `created:true`; double finalize → one PENDING_PAYMENT, one audit, one event; price edit vs finalize (same `expectedVersion`) → exactly one wins and the total always equals the winning line; cancel vs finalize → one terminal outcome with consistent audit.

## 12. Web POS (VI/EN, existing components)

- Navigation "Hóa đơn / Invoices" (`VIEW_INVOICES` anywhere), routes `/workforce/pos` and `/workforce/pos/[id]`.
- Board: branch (only branches where `VIEW_INVOICES` is held) and date filters, "awaiting an invoice" table with **Create invoice** (only when `canManage`), recent invoices with status badge, payer and total; passive 30 s refresh.
- Invoice: header/status, line table (service, guest, KTV, historical range, unit price/quantity inputs only where the line permits them, amount), subtotal/total from the server, payer section (booking owner / guest buttons, exact phone/email lookup with masked result), **Finalize** (disabled with a readiness message until every line is priced), cancel with required reason and the existing `useReauthentication` dialog. Every command sends the server `version`; the server's answer replaces the invoice; failures reload.
- Deliberately absent: payment, cash, PayOS, discount, voucher, refund controls.
- The new stylesheet block is a two-rule `.wf-summary` (totals).

## 13. Schema / migrations

None. Step 4 migrations are untouched; the foundation already contained everything required. Contract types (`InvoiceResponse`, `InvoiceLineResponse`, `InvoiceOpenedResponse`, request types, `PosBoard*`) were appended to `packages/contracts`.

## 14. Files

New: `apps/api/src/pos/{invoice.calc,invoice.core,invoice.service,invoice.controller}.ts`, `invoice.integration.test.ts`, `invoice.race.integration.test.ts`, `invoice.http.test.ts`; `apps/web/src/lib/workforce/pos.ts` (+ `pos.test.tsx`), `components/workforce/screens/{pos,pos-invoice}.tsx`, `app/[locale]/workforce/(app)/pos/{page,[id]/page}.tsx`.
Modified: `apps/api/src/app.module.ts` (registration), `auth/auth.error.ts` (4 codes), `walkin/walkin.core.ts` (export `maskEmail`), `packages/contracts/src/index.ts`, `apps/web/src/i18n/workforce.ts` (nav + `pos` dictionary VI/EN), `lib/workforce/permissions.ts` (+test), `app/workforce.css`, `scripts/test-auth-integration.mjs` (two suites registered). `apps/web/next-env.d.ts` untouched.

## 15. Tests and exact results (scratch database `lucy_spa_step5_validation_20260930`, all 31 migrations)

| Suite                                                                                                                                                                                  | Result                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `pos/invoice.integration.test.ts` (rollback fixtures: open, authorization/branch scope, price/quantity, payer, finalize, zero balance/OP-7, cancel paths, board/read, FINANCIAL audit) | 10/10                  |
| `pos/invoice.race.integration.test.ts` (real connections)                                                                                                                              | 5/5 (parent + 4 races) |
| `pos/invoice.http.test.ts` (strict bodies, CSRF/Origin, safe error mapping)                                                                                                            | 1/1                    |
| API regression: walk-in (+race), visit-service-add (+race), visit-completion, authorization, role-admin, service-catalog, POS ×3                                                       | 83/83                  |
| API regression: notification routing/inbox, leave notifications, operations, service-execution                                                                                         | 20/20                  |
| Database package: `test:integration`                                                                                                                                                   | 65/65 + races 5/5      |
| `pnpm test` (units: server 22, web 163, worker 18, API 151 passed / 53 integration skipped)                                                                                            | all pass               |
| `pnpm format:check`, `pnpm lint` (+ boundaries)                                                                                                                                        | pass                   |
| `tsc` (API build) and web `tsc --noEmit`                                                                                                                                               | pass                   |

Web production build not run (it regenerates `next-env.d.ts`).

## 16. Bugs found and fixed during the Step

Test-fixture and wrapper issues only, all fixed: public service methods threw synchronously (made `async` so validation throws are rejections); reauthenticated session fixtures must rotate twice; customer `users_kind_credentials` CHECK; employee fixtures need a branch assignment; a stale-reauth session cannot be created by update (sessions are immutable), covered by a never-reauthenticated session; the race test's price-vs-finalize assertion was wrong (both carry the same `expectedVersion`, so exactly one wins) and was corrected. No production defect was found in the Step 4 foundation.

## 17. Deferrals

Step 6: discounts/vouchers/redemptions (discount total stays 0). Step 7: cash payments and corrections, payment reversal before cancelling a paid invoice. Step 8: PayOS. Steps 9–10: reports/revenue, receipts, notification registry widening and Revenue notifications. Legacy unbilled visits older than the 7-day board window are not listed (they remain reachable by direct link/API).

## 18. Contract notes for Step 6

Step 6 supplies `discountTotal` to `calculateTotals`, must apply benefits inside the same invoice lock/version and before finalization freezes them, and must release redemptions when cancelling (`cancelInvoice` documents "no redemption exists before Step 6"). Owner checkpoints Q7 and Q8 remain unresolved.

## 19. Confirmations

**Closure review (Owner approved):** scope is only the approved Invoice/POS workflow; no discount/voucher engine (Step 6), no payment collection/correction (Step 7), no PayOS (Step 8), no e-invoice/tax/provider integration, no product/loyalty/combo/tip/payroll code; no Step 4 migration modified and none needed; `apps/web/next-env.d.ts` has no diff; lifecycle, historical snapshots, server-authoritative integer VND, FINANCIAL audit and concurrency/idempotency are as validated; Q7 and Q8 remain unresolved. Not deployed; Step 6 not started; `LUCYSPA_HANDOFF.md` records Step 5 as CLOSED / OWNER APPROVED.
