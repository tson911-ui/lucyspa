# Phase 6 P6-11: Beauty points, expired-lot alert, discount scope screens, Wave 2 milestone

Status: committed locally, not pushed, not deployed. Owner words: design doc 2.19. My readings, **pending the Owner's yes/no**: 2.20 (OQ-77, OQ-78 in `docs/PHASE6_OWNER_DECISIONS_VI.md`).

## What changed

- **OQ-75 as changed by the Owner:** a sale that takes stock from an expired lot (the last resort) writes an audit event and an in-app alert (`EXPIRED_LOT_SOLD`, severity WARNING) to the `VIEW_INVENTORY` holders of the invoice's branch, naming invoice code, SKU and lot code, in the sale's transaction. The `inventory` consumer resolves the holders and key-share locks their user rows before the stock (the race test deadlocks without it; proven by mutation). Migration `20261110000000` widens two CHECKs of `notifications`.
- **Beauty points (T2, OQ-33, OQ-41):** the `loyalty` consumer earns in the BEAUTY wallet, key `BEAUTY_EARN:{invoice}:{paid_seq}`, for the payer, on the sum of the Beauty line allocations (product amount after discounts, never the shipping fee). Guest, non-member, pre-go-live and stale episodes earn nothing. Reversal needed no change (every EARN of the episode is reversed once, floor at 0 with shortfall).
- **Beauty tier snapshot (T4):** already written at finalization since P6-9; proven end to end. **Customer:** the Beauty card shows the real tier %, the history lists Beauty entries.
- **Scope on the discount screens** (design table row P6-11): form, detail and list show the scope and product targets (report `docs/PHASE6_STEP11_DISCOUNT_SCOPE_UI.md`).
- **Wave 2 milestone:** `docs/PHASE6_WAVE2_MILESTONE.md`, rollback proof `docs/PHASE6_WAVE2_ROLLBACK_PROOF.md`, deploy guide `docs/PHASE6_WAVE2_DEPLOY_CHECKLIST.md`.

## Migrations / permissions

One additive migration (`20261110000000`); Wave 2 total 7 (73 to 80). No permission added (65); `SELL_PRODUCTS` is granted to nobody.

## Tests

See the milestone doc for the full run. New: `beauty-loyalty.integration` (9), 3 races in `pricing-v3.race`, 1 race + 3 integration tests for the alert, registry/web/db-guard tests. Deliberate edits to existing tests: registry list and count, worker isolation event list, `pricing-v3` example A (Beauty 0 to 194), `product-sale` loyalty test (per wallet).

## Open

OQ-77 (alert content and where it opens), OQ-78 (scope screens included in P6-11); everything else is Owner-approved or mechanical. Nothing pushed or deployed.
