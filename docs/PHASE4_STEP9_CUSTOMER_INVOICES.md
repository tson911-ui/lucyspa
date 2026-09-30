# Phase 4 Step 9: customer invoice history

**Status: CLOSED / OWNER APPROVED** (checkpoint-committed and pushed, not deployed). Step 10 (Q8) untouched.
Contract: design section 10 "Customer access". Read only: **no migration, no new permission, no outbox event**.

## 1. What changed

- API `GET /api/v1/me/invoices?cursor=` (newest first, 20 per page, keyset cursor) and `GET /api/v1/me/invoices/:id`:
  `apps/api/src/pos/customer-invoice.{core,service,controller}.ts`, run through `runCustomerCommand` (staff sessions `FORBIDDEN`).
- Contracts `CustomerInvoice*` in `packages/contracts`. `invoice.core.ts`: `effectivePaid`/`balanceOf` take a minimal structural type
  (no behavior change) so the customer sees the same paid/balance rule as the POS.
- Web `/{vi,en}/account/invoices` and `/[id]`, nav link "Hóa đơn", VI + EN texts; `useFetch`/`LoadState` exported from `bookings.tsx`.

## 2. Visibility (one server-side `where`)

- `payer_user_id = session customer` AND `finalized_at IS NOT NULL` (the database makes it null only for a DRAFT and a cancelled draft).
  A foreign, guest-payer, draft or missing invoice is the same `NOT_FOUND`. Booking owner or participant without being payer sees nothing.
- No customer id from the browser; unknown query parameters are rejected (400).

## 3. Shown / never loaded

- Shown: code, status (PENDING_PAYMENT / PAID / CANCELLED), branch, dates, lines, subtotal, applied benefit (name, voucher code, amount),
  total, paid, balance, succeeded payments (a corrected one is flagged), internal-receipt note (Q10).
- Never loaded: staff/KTV identities, visit/line ids, cancel reason, correction reason/actor, PayOS request/QR/reference, pending/failed/expired
  payment attempts, anomalies, notes, discount candidates, price ranges, phone/email, another member's account name.

## 4. Tests (scratch DB `lucy_spa_step9_validation_20260930`, 34 migrations, dropped; dev DB untouched)

- `pos/customer-invoice.integration` 8/8 (visibility, staff parity + no leaks, payments/PayOS hidden/reversal, voucher, zero-balance, cancelled, paging, read-only); `pos/customer-invoice.http` 1/1.
- Regression for touched `invoice.core`: `pos/invoice.integration` 10/10, `pos/payment.integration` 11/11.
- Web `invoice.test` 5/5 + `booking.test` 8/8. api build, web typecheck, eslint on touched files, `check-boundaries`: clean.
- Not run (Final Validation): `pnpm check`, `pnpm test:integration`, `pnpm smoke`, web production build, browser check of the new pages.
- Suite added to `scripts/test-auth-integration.mjs`. Dev DB `lucy_spa_dev` is 12 migrations behind, hence the scratch DB (as in Step 8).

## 5. Owner answers (locked)

1. Drafts hidden; a cancelled invoice stays visible as "Đã hủy" with the reason hidden.
2. V1: guest-payer invoices are not viewable and are never attached later.
3. No customer self-pay in this Step; payment happens at the counter. Online self-pay would be a separate future feature.
