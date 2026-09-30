# Phase 4 Step 10: invoice / revenue notifications

**Status: CLOSED / OWNER APPROVED** (checkpoint-committed and pushed, not deployed). Policy = Owner answers Q8 (design section 17.1, recorded before coding).
In-app only (existing Notification Center); no email/Zalo. Step 11 (final validation) not started.

## 1. What changed

- **Migration `20261017000000_phase4_step10_invoice_notifications`** (additive): `outbox_consumptions` (design 15.2, `UNIQUE(event_id, consumer)`, append-only);
  `notifications` CHECKs accept 7 new types and the `Invoice` / `Branch` entities (type <-> entity pairing kept, summary entity = its branch);
  partial unique index = one `REVENUE_SUMMARY_DUE` event per (branch, business date); index `(event_type, id)`.
- **Registry** (`packages/contracts`): category `FINANCE`; types `INVOICE_PAID`, `INVOICE_CANCELLED` (payer), `PAYOS_PAYMENT_SUCCEEDED`, `PAYOS_PAYMENT_ANOMALY`,
  `PAYMENT_REVERSED`, `INVOICE_CANCELLED_ALERT`, `REVENUE_DAILY_SUMMARY`. Params stay a strict allowlist (adds integer-VND strings + counts; never a reason or a name).
- **Consumer** `packages/server/src/invoice-notifications.ts`: claims each event (`FOR UPDATE SKIP LOCKED`, no consumption row of its own), re-reads authoritative rows,
  routes, inserts inbox rows, writes the consumption row last (one transaction). `published_at` is never used. Worker `invoice-notification-jobs.ts` (2 s tick, own transaction per event).
- **Routing** (`notification-routing.ts`): `resolvePermissionHolders` / `holdsPermissionAt` = permission + branch scope + DENY + active employment; no role names, no hierarchy.
- **Web**: FINANCE tab, VI/EN texts rendered from params, invoice link (customer `/invoices/:id`, staff `/pos/:id` with `VIEW_INVOICES`); the summary has no link (reports are later).

## 2. Recipients (Q8)

| Event                                                  | Who                                                                                  | Notes                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `INVOICE_PAID` (incl. zero balance)                    | payer with an ACTIVE customer account                                                | skipped if that paid episode was superseded (reversal / newer episode); guest payer: nothing; partial: nothing |
| `INVOICE_CANCELLED` from PENDING_PAYMENT / PAID (OP-7) | payer (no reason) + `CORRECT_PAYMENTS` holders at the branch                         | draft cancel: nothing                                                                                          |
| `PAYMENT_SUCCEEDED` (PayOS)                            | staff who created the request, if still ACTIVE with `COLLECT_PAYMENTS` at the branch | cash: nothing                                                                                                  |
| `PAYMENT_ANOMALY_FLAGGED`                              | that creator + `CORRECT_PAYMENTS` holders at the branch (once each)                  | amounts of that invoice only                                                                                   |
| `PAYMENT_REVERSED`                                     | `CORRECT_PAYMENTS` holders at the branch                                             |                                                                                                                |
| `REVENUE_SUMMARY_DUE` (21:30 branch-local)             | `VIEW_REVENUE` holders at the branch                                                 | total, cash, PayOS, paid count, pending count; only type with totals                                           |

Summary window = branch-local date 00:00 to the 21:30 dispatch instant (fixed, so a retry gives the same numbers); collected = effective (non-reversed) payments.

## 3. Permissions / decisions taken inside Q8 (Owner confirmed all five)

- No new permission. The Owner account passes every permission check, so the Owner receives exceptions and the summary as a holder.
- Management exceptions are not filtered by actor (a manager sees their own reversal). Expired/failed PayOS requests notify nobody (Q8 lists only success/anomaly).
- Summary is sent every day per active branch, even with zeros; a missed 21:30 is caught up until local midnight, never later.
- A paid -> reversed -> paid invoice notifies the payer once per paid episode that is still current.
- Inbox rows are not re-authorized at read time: a person who later loses `VIEW_REVENUE` / `CORRECT_PAYMENTS` keeps the history they legitimately received.

## 4. Tests (scratch DB `lucy_spa_step10_validation_20260930`, 35 migrations; dev DB untouched)

- `pos/invoice-notifications.integration` 12/12: payer PAID/zero/partial/guest/replay/read-state; superseded episode; cancel (payer + holders, no reason, draft silent, OP-7);
  reversal; PayOS success, revoked creator, anomaly (dedupe, scoping); summary schedule (21:29 no, 21:31 once, next date) and figures; inactive branch; consumption contract; CHECKs.
- `pos/invoice-notifications.race.integration` 1/1 (6 concurrent workers, concurrent schedulers). Worker `invoice-notification-isolation` 4/4 + `leave-relay-isolation` 2/2.
- Registry/notification API unit 9/9; `notification-inbox`, `notification-routing`, `leave-notifications` integration 3/3; database `notification-foundation` 1/1; web notification tests 11/11.
- api/worker/server/contracts build, web typecheck + build, eslint on touched files, `check-boundaries`: clean. Suite added to `scripts/test-auth-integration.mjs`.
- Not run (Final Validation): `pnpm check`, `pnpm test:integration`, `pnpm smoke`, browser check.

## 5. Deploy notes / open questions

- Deploy: `migrate deploy`, restart api + worker (no new env, no new permission). On a database that already holds Phase 4 events the consumer starts from history (design 15.2); production has none.
- Open: should a revoked holder stop seeing past finance rows (read-time re-check)? Should the summary skip days with no activity?
