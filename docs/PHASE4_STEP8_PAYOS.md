# Phase 4 - Step 8: PayOS

**Status: CLOSED / OWNER APPROVED** (checkpoint-committed and pushed, not deployed). Step 9 not started; Q8 untouched.
Sources: [design](PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md) 4.5, 5.2, 13-16 (Q7 answers recorded in 2.2 and 16.3 first, plus 16.5), Step 7 report.
PayOS documentation re-verified 2026-09-30 (API reference and the official `@payos/node` 2.x source): HMAC-SHA256 over sorted `data` for responses and webhooks; create signature over five fields; `code "00"` = success.

## 1. What changed

- **API** (`/api/v1/pos`, all `COLLECT_PAYMENTS` at the invoice's branch): `POST invoices/:id/payments/payos` (amount + key only; part or all of the balance), `.../payments/:paymentId/cancel`, `.../refresh` (on-demand authoritative read). Staff cannot mark a transfer received: direct recording of PAYOS is refused and there is no reversal for it.
- **Webhook** `POST /api/v1/webhooks/payos`: the one route exempt from CSRF/Origin/session (marker + signature verified before any state change; 16 KB cap; forgeries throttled 60/min, authentic ones never; constant 401; 503 on failure so PayOS retries).
- **Settlement core** (`packages/server`, shared by API and worker): applies a verified confirmation exactly once; late confirmation = new succeeded row; amount mismatch / already paid or cancelled / more than the balance = anomaly (never applied); `PAYMENT_ANOMALY_FLAGGED` etc. emitted.
- **Worker sweep** (30 s, from PostgreSQL): expires requests after 15 min, applies a missed webhook, closes never-linked requests. Provider = real adapter from `PAYOS_CLIENT_ID/API_KEY/CHECKSUM_KEY` (all three or none; none = method disabled).
- **Management (`CORRECT_PAYMENTS`)**: `GET branches/:id/payment-anomalies`, `POST payment-anomalies/:id/review`, `POST invoices/:id/management-notes` (Q7 item 8; audited, changes nothing else).
- **Web (VI/EN)**: PayOS form, QR (rendered locally with `qrcode` 1.5.4), countdown, re-check/cancel, 5 s refresh while waiting, cash limited to the unheld rest, anomalies and notes for management.

## 2. Migrations (additive, 2)

`20261016000000` adds enum value `PAYOS`; `20261016000001` adds provider columns, CHECKs, partial unique indexes (one pending per invoice, one succeeded per order), the extended payment guard, an invoice-cancel guard, and 4 tables. Nothing dropped or rewritten. Prisma diff on a migrated DB shows no Step 8 drift.

## 3. Permissions, audit, events

No new permission. FINANCIAL audit: `PAYMENT_PROVIDER_REQUESTED/CONFIRMED/CANCELLED/EXPIRED/FAILED`, `PAYMENT_ANOMALY_FLAGGED/REVIEWED`, `INVOICE_MANAGEMENT_NOTE_ADDED` (webhook and worker as actor `SYSTEM`), plus `INVOICE_PAID`. Outbox: `PAYMENT_SUCCEEDED` (method PAYOS), `INVOICE_PAID`, `PAYMENT_EXPIRED`, `PAYMENT_FAILED`, `PAYMENT_ANOMALY_FLAGGED`; ids and amounts only.

## 4. Tests (scratch DB `lucy_spa_step8_validation_20260930`, 34 migrations; dropped after)

| Suite                                                                                                                                                    | Result                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `packages/server` (adapter, signatures, simulator, env)                                                                                                  | 29/29                     |
| `pos/payos.integration` (Q7 items 1-9 with a simulated PayOS, DB backstops with positive control)                                                        | 16/16                     |
| `pos/payos.race.integration` (dup webhook, webhook vs cancel, vs cash, concurrent create, vs sweep) x3                                                   | 6/6 x3                    |
| `pos/payos.http` (strict bodies, CSRF except the webhook, constant refusals), worker `payos-jobs`, web `pos`                                             | pass                      |
| Regression: payment (+race), invoice (+race), discount (+race), database phase4 foundation/races                                                         | 11+6, 10+5, 13+6, 26 pass |
| Units: web 180, api 165, server 29, worker 11; lint (+boundaries), `format:check`, typecheck                                                             | pass                      |
| Not run (Final Validation only): `pnpm check`, `pnpm test:integration`, `pnpm smoke`, web production build. **No live PayOS call was made** (Q7 item 1). |

## 5. Owner answers (closure)

1. Anomaly review and management notes stay on the existing `CORRECT_PAYMENTS`; no new permission.
2. Anomaly notification recipients are decided with Q8 in Step 10. The invoice page and the API list are enough for now (no inbox page).
3. The short bank memo (`LUCYSPA`) is accepted, provided matching relies on the PayOS order code and not the description. **Confirmed:** every path (webhook, status read, sweep) finds the payment by `provider_order_code` (unique in the database) and checks the amount against the stored request; the description is only sent to PayOS and is never read back, parsed or used to match.

## 6. Deployment checklist (only when the Owner asks)

Set `PAYOS_*` for api and worker, `db:deploy`, `db:permissions:sync`, register `https://<api-host>/api/v1/webhooks/payos` in PayOS, then pay a small real amount. The adapter trusts a success answer only with a valid signature; if the live account omits it on some call, creation reports "provider unavailable" and the sweep cleans up.
