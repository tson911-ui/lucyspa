# Phase 5 P5-2: database and permissions foundation

Status: built and validated on a scratch database; **not deployed, nothing granted, no data created**. Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md`.

## What changed

- **Tables (16, all empty, no seed):** `loyalty_go_live`, `loyalty_wallets`, `loyalty_ledger_entries`, `referrals`, `invoice_loyalty_snapshots`,
  `combos`, `combo_versions`, `combo_purchases`, `combo_sessions`, `combo_session_consumptions`, `combo_session_releases`,
  `combo_session_restorations`, `reward_catalog_items`, `reward_entitlements`, `reward_redemptions`, `reward_redemption_releases`.
- **Go-live switch (P5-T2):** no row in `loyalty_go_live` means OFF (default). One immutable row, instant stamped by the database clock (no backdating,
  P5-Q1). While OFF, SQL refuses wallets, ledger entries, referrals, snapshots, combo purchases and consumptions, entitlements and redemptions.
  Combo definitions and catalog items can be configured before go-live.
- **Ledger:** append-only, whole points, `shortfall_points` for P5-Q5; balance cache = ledger sum and `>= 0` (deferred check); EARN only for the member
  payer of a PAID invoice at its current paid episode and only if paid at or after go-live (P5-Q1/Q2); one reversal per earn, one correction per effect.
- **Referrals:** permanent (one referrer per referred customer), award stamped once, exactly one Spa and one Beauty award entry (deferred check).
- **Tier snapshot:** locked PRD 18.5 table version 1 enforced by CHECK; one per invoice, identified payer.
- **Combos / rewards:** per-session rows, consumption under the session lock (own service, invoice branch, one active use), release only for a cancelled
  invoice with matching cause, restoration with reason, quantity under the entitlement lock; a cancelled invoice must release (deferred check on `invoices`).
- **Permissions:** 11 codes in the enum, catalog and role editor (new "Loyalty" group, VI/EN); semantics CHECK extended; none granted.

## Migrations

`20261027000000_phase5_permission_codes`, `20261027000001_phase5_permission_semantics`, `20261027000002_phase5_loyalty_foundation`,
`20261027000003_phase5_combo_reward_foundation`. Additive; no existing row is touched. Deploy order (only when asked): backup, `pnpm db:deploy`,
`pnpm db:permissions:sync`, restart API/Web/Worker.

## Not in this Step (by design)

No business logic, no UI beyond permission labels. Later: invoice `kind` / visit-less combo sale / `COMBO_PURCHASE` line (P5-7), Member candidate and
`InvoiceDiscountApplication` extension (P5-4), referrer field on `registration_intents` and canonical participant phone (P5-5), birthday tables (P5-6).
Notes: P5-8 must let a 0 VND combo-consumed line pass the invoice price-range integrity check; which permission activates go-live is open (P5-3).

## Tests (scratch DB `lucy_spa_p5_2_validation_20261004`, dropped afterwards; never the dev DB)

| Check                                                                                                                                 | Result                                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| New `phase5-loyalty-foundation.integration.test` (15 cases)                                                                           | 16 / 16 pass                                     |
| New `phase5-loyalty-races.integration.test` (isolated schema: session, reward quantity, combo version, lost wallet update, TRUNCATE)  | 6 / 6 pass                                       |
| Database package `test:integration` (all suites, both invocations)                                                                    | 87 / 87 + 11 / 11 pass                           |
| API role-admin, authorization integration + unit tests                                                                                | 21 / 21 pass                                     |
| Phase 4 POS API integration (invoice, discount, payment, PayOS, customer invoice, notifications) and POS race suites (run one by one) | 70 / 70; races 5 + 6 + 6 + 6 pass                |
| `prisma migrate diff` (DB vs schema), `prisma validate`, `pnpm typecheck`, `pnpm lint`                                                | only the 2 known composite-FK items; valid; pass |

Existing tests updated for the new catalog (52 codes: 11 new, 6 of them GLOBAL_ONLY, 2 FINANCIAL). Full `pnpm test` and `pnpm format:check` run before the push.

## UX gate (role editor, the only screen touched)

- Rendered the create-role drawer scrolled to the new group at 360, 768 and 1440 px light plus 1440 px dark (`.local/uxui-screens` rig: `.local/uxui-audit/shots/roles-*.png`, real app on the audit scratch DB `lucy_spa_uxaudit_20261001`, migrated).
- Opened and checked every image: one-line group heading ("Khách hàng thân thiết"), aligned rows, "Chỉ toàn hệ thống" badges, 44px rows, no horizontal scroll, dark theme readable.
- First render had a 2-line heading with an orphaned word at 1440; shortened (VI "Khách hàng thân thiết", EN "Loyalty and rewards") and re-rendered.
- DOM audit: one finding at 1440/768 (FR3 `surface-style-mix`, table + the existing kit drawer); unchanged by this Step; none at 360.
