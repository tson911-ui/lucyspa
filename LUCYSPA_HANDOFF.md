# Lucy Spa handoff (current state)

Historical detail (Phase 0-3, Phase 2 follow-up, Notification Center, Organization Hierarchy, production states,
Phase 4 Step 1-6 summaries): [docs/HANDOFF_HISTORY.md](docs/HANDOFF_HISTORY.md). Agent rules: [CLAUDE.md](CLAUDE.md).

## Start here

1. Read the PRD sections relevant to the requested task before implementation ([LUCY_SPA_PRD.md](LUCY_SPA_PRD.md);
   change it only with explicit Owner authorization), this file, and the requested Step's own doc.
2. Inspect `git status` / `git log` and the repository before changing anything. Preserve completed work.
3. One Step at a time; Owner review and checkpoint commit/push after every Step. Never deploy unless asked.
   Never touch `apps/web/next-env.d.ts`.

## Phase status

| Phase                                     | Status                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Phase 0                                   | PASS                                                                   |
| Phase 1 (auth and security)               | COMPLETE                                                               |
| Phase 2 (services, employees, operations) | CLOSED / PRODUCTION ACCEPTED (follow-up Steps 1-7 also accepted)       |
| Phase 3 (booking, walk-in, queue)         | COMPLETE / OWNER APPROVED                                              |
| Notification Center (in-app, V1)          | CLOSED / PRODUCTION VERIFIED                                           |
| **Phase 4 (POS, invoices, payments)**     | **IN PROGRESS: Steps 1-6 CLOSED / OWNER APPROVED; Step 7 NOT STARTED** |
| Phase 5+ (loyalty, payroll, finance)      | NOT started (deferred)                                                 |

## Phase 4 steps (docs: `docs/PHASE4_*`)

| Step | Name                                                                 | Status                                     |
| ---- | -------------------------------------------------------------------- | ------------------------------------------ |
| 1    | Design contract (`PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md`)            | CLOSED                                     |
| 2    | Visit completion carryover (manager END, cancel line)                | CLOSED                                     |
| 3    | Staff-added service                                                  | CLOSED                                     |
| 4    | POS database + permissions foundation (OP-1 quantity limit)          | CLOSED                                     |
| 5    | Invoice / POS (draft, price/quantity, payer, finalize, cancel, OP-7) | CLOSED                                     |
| 6    | Discounts / vouchers (+ historical service-category snapshot)        | CLOSED (`f898f2d`)                         |
| 7    | Cash / split payments / payment states / corrections                 | NOT STARTED                                |
| 8    | PayOS                                                                | NOT STARTED, **Q7 must be answered first** |
| 9    | Customer invoice history                                             | NOT STARTED                                |
| 10   | Invoice / revenue notifications                                      | NOT STARTED, **Q8 must be answered first** |
| 11   | Final validation (single full gate; no deploy)                       | NOT STARTED                                |

Phase 4 migrations so far: Step 3 (`20261013…`), Step 4 (`20261014000000-04`), Step 6 (`20261015000000`, category snapshot).

## Locked Owner decisions (do not reopen; details in the Phase 4 design doc)

- **Q0** Phase 3 carryovers are in Phase 4 (manager END resolution, cancel unperformed line, staff-added service).
- **Q1** Price is permission-based, chosen inside the visit-line snapshot range; catalog changes never alter a transaction.
- **Q2** One Visit -> one active Invoice, only after COMPLETED; payer on the invoice (owner default, guest allowed); split payment, not split invoices.
- **Q3** Integer VND; percentages round half up; no cash rounding; versioned deterministic calculation.
- **Q4** No free-form discount; Owner-configured discounts/vouchers; invoice-level; no stacking; Member/Birthday/loyalty stay Phase 5.
- **Q5** No tip in Phase 4 (tip, cash safe, closing, commission, payroll = Phase 7).
- **Q6** Unpaid invoice cancellable; cash reversal needs `CORRECT_PAYMENTS` + reason + re-auth; a confirmed PayOS payment is never manually reversed; correction is not a refund.
- **Q9** Nine financial permissions, no role-name access, no automatic seeding, re-auth only for `CORRECT_PAYMENTS` and finalized-invoice cancellation.
- **Q10** UI term "Hóa đơn"; code `INV-YYMMDD-XXXXXX`; internal receipt, not an official e-invoice.
- **OP-1** Quantity limit is per Service (`services.max_quantity`), snapshotted on the line; no global setting.
- **OP-2** Amount due exactly 0 -> finalize directly to PAID, no Payment row.
- **OP-3** A per-customer usage limit needs an identified MEMBER payer; a guest is ineligible for it.
- **OP-4** `minimumSpend` uses the eligible subtotal before the benefit.
- **OP-5** Code-less promotions are automatic candidates, vouchers only once supplied; exactly one winner, deterministic tie-break.
- **OP-6** Cash is recorded by any actor with `COLLECT_PAYMENTS` in scope; server-recorded time; no re-auth for normal collection.
- **OP-7** `PAID -> CANCELLED` only for a zero-balance invoice with no payment row; needs `CANCEL_INVOICES`, reason, fresh re-auth; releases the redemption.

## Open Owner checkpoints (NOT decided; do not decide or implement)

- **Q7 - PayOS:** answer before Step 8 (credentials, sandbox vs live, expiry, operator permissions, late/partial confirmation, webhook timing).
- **Q8 - Invoice / revenue notifications:** answer before Step 10 (recipients, routing, content, policy).

## Owner instruction for Step 7

Keep the payment architecture ready for a future **CARD / POS-terminal** integration, but **do NOT activate CARD**
(Lucy Spa has no POS terminal yet): no CARD method selectable, accepted or shown in the UI or API.

## Production

Deployed commit `97e0485` (Notification Center final validation); 25 migrations applied; api/web/worker online.
**Phase 4 (Steps 2-6) is NOT deployed.** Run `pnpm db:permissions:sync` at the next deployment. Deploy only when the Owner asks.

## Known pre-existing test flakes (unrelated to Phase 4; note in one line, do not investigate)

- Two `My Income` integration assertions fail only between 15:00 and 17:00 UTC.
- Worker Step 9 notification tests (`Redis job loss…`, `real Redis delayed-job loss…`) build the visit `serviceDate` from the UTC date and fail
  when the UTC and Vietnam dates differ (roughly 17:00-24:00 UTC).
