# Phase 4 — Step 7: Cash / Split Payments / Payment States / Corrections

**Status: CLOSED / OWNER APPROVED** (checkpoint-committed and pushed, not deployed). Step 8 not started; Q7/Q8 untouched.
Sources: [design](PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md) (Q5, Q6, OP-6, OP-7; 4.5, 5.2, 5.3, 9, 11, 12-15), Step 4 (schema/guards), Steps 5-6.

## 1. What changed

- **Record cash** `POST /api/v1/pos/invoices/:id/payments` (`COLLECT_PAYMENTS` at the invoice's branch; no re-auth). Body: `method` (`CASH`), `amountVnd` (credited), `tenderedVnd`, `idempotencyKey` (UUID). No time/change/status/branch field exists. Credit may be less than the balance = split payment; `> balance` is `PAYMENT_AMOUNT_INVALID`. Server records due (= balance under the invoice lock), change, collector and the DB-clock `collected_at`. The payment that reaches the receivable sets the invoice `PAID` (`paid_seq + 1`) in the same transaction.
- **Reverse** `POST .../payments/:paymentId/reverse` (`CORRECT_PAYMENTS`, reason, fresh password re-auth every time). Appends a `payment_corrections` row (original untouched); a `PAID` invoice returns to `PENDING_PAYMENT` (`paid_at` NULL, `paid_seq` kept), so the next completing payment is a new episode. Not a refund. Zero-balance invoices have no payment to reverse.
- **Reads:** `InvoiceResponse` gained `payments[]` (with correction), `paidVnd`, `balanceVnd`, `actions.collectPayment`. Both payment commands return only `{ payment, invoice:{status, paid, balance, version…} }`, not the whole invoice, so `COLLECT_PAYMENTS` alone never exposes `VIEW_INVOICES` data (design 11.1: the two checks are independent).
- **Idempotency:** unique `(collector, key)`; replay returns the stored result even after the invoice became `PAID`; same key with other content is `CONFLICT`. Repeated reversal by the same actor is a no-op; by another `PAYMENT_STATE_INVALID`.
- **Web (VI/EN):** payments section on the invoice (history, paid/balance, cash form with display-only change preview, reverse with reason + existing re-auth dialog). Cash only, no CARD text anywhere.

## 2. Migrations

**None.** Step 4 already holds the cash shape, guards, reconciliation trigger and corrections. `DataClassification`/permissions unchanged (no new code; run `pnpm db:permissions:sync` at deployment as before).

## 3. Permissions and audit/events

`COLLECT_PAYMENTS` (record), `CORRECT_PAYMENTS` (+ re-auth), `CANCEL_INVOICES` unchanged; none implies another; nothing granted. FINANCIAL audit (entity = the Invoice, so one trail per invoice): `PAYMENT_RECORDED`, `PAYMENT_REVERSED`, `INVOICE_PAID` (settlement `PAYMENT`), `INVOICE_REOPENED`. Outbox: `PAYMENT_SUCCEEDED`/`PAYMENT_REVERSED` (aggregate `Payment`), `INVOICE_PAID` (by `paid_seq`), `INVOICE_REOPENED`; ids and amounts only, `published_at` stays NULL; existing relays filter by aggregate and ignore them.

## 4. Q6 / OP-7 re-proof

Cash-paid and split-paid invoices are refused by the cancel command and by the DB guard (`PAID -> CANCELLED` with any payment row). They can be cancelled only after every effective payment is reversed (then via `PENDING_PAYMENT`). Zero-balance OP-7 path unchanged.

## 5. Tests (scratch DB `lucy_spa_step7_validation_20260930`, 32 migrations; dropped after)

| Suite                                                                                                                                                                  | Result         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `pos/payment.integration` (authority OP-6, server time/change/business date, split, method rules, idempotency, reversal, paid episodes, Q6/OP-7, reads, immutability)  | 11/11          |
| `pos/payment.race.integration` (real connections: two cashiers overpaying, same key twice, payment vs cancel, double reversal, reversal vs completing payment), 3 runs | 6/6 x3         |
| `pos/payment.methods` unit, `invoice.http` (strict payment bodies, CSRF/Origin, error map)                                                                             | pass           |
| Regression, sequential: invoice + race, discount + race + engine                                                                                                       | 64/64 combined |
| `pnpm test` units: web 176, api 164 (+integration skipped), server 22, worker 8 (+1 skipped); `pnpm lint` (+ boundaries), `format:check`, API build, web `tsc`         | pass           |

Not run (per CLAUDE.md, Final Validation only): `pnpm check`, `pnpm test:integration`, `pnpm smoke`, web production build. Running integration files with parallel `node --test` collides on the shared DB; use `--test-concurrency=1` or the repo runner.

## 6. CARD-ready, CARD not activated (Owner instruction)

`apps/api/src/pos/payment.methods.ts` is the single per-method rule table (`active`, `reversible`, `tender`), typed by the DB `PaymentMethod` enum: adding a value to the enum breaks the build until its rules exist. The enum, contract union, request validation and UI are CASH-only; `CARD`, `PAYOS`, `cash`, `__proto__` etc. get `PAYMENT_METHOD_UNAVAILABLE` (tested; DB enum asserted `['CASH']`). To enable CARD later: additive migration (enum value + per-method relaxation of `payments_cash_succeeded`/tender NOT NULLs, shared with Step 8's PayOS), rule entry `active:false`, terminal handling, then flip. Credited amount vs tender and `method` in audit/events are already separate.

## 7. Owner answers (closure)

1. `COLLECT_PAYMENTS` and `VIEW_INVOICES` will be granted together through roles; no code change.
2. CARD reversal policy is deferred until a real POS terminal/provider exists: **open future decision** (not decided here).
3. Paid amount on board rows is deferred to the post-Phase 4 UX/UI redesign.
