# Phase 5 P5-4: Member Discount at the POS

Status: built and validated on a scratch database; **not deployed, loyalty stays OFF**. Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` (5.2-5.3, 6, 12.2, 2.5).
Also in this commit series: the Owner rejected P5-T8, so a manual deduction above the balance is **hard-blocked** (see "P5-T8" below).

## What changed

- **Best-offer selection:** the pure engine (`discount.engine.ts`) has one more candidate, the Member Discount: the payer's tier percent of every priced line (half up to 1 VND).
  The better of {best promotion/voucher, member} wins, never both. **On an equal amount a promotion or voucher wins** (P5-T6: answered through the question tool, **provisional until the Owner confirms**). `calculation_version = 2`;
  without a member (guest payer or loyalty OFF) the result is exactly the version 1 result.
- **Tier:** read from the payer's Spa wallet balance BEFORE the invoice (a DRAFT previews the current balance; finalization reads it under the wallet share lock) and frozen in
  `invoice_loyalty_snapshots` (balance, tier, table version, basis points, member amount, every candidate, winner and reason). A finalized invoice is never recalculated.
  Beauty is not used (Phase 6). Only when go-live is ON and the payer is a member.
- **Database (migration `20261029000000_phase5_member_discount`):** the snapshot carries `member_amount_vnd` with CHECKs (rule, half up, winner list); the invoice integrity
  trigger now accepts the invoice discount as EITHER the applied program benefit OR the member amount, never both, and refuses a snapshot on a draft. No program application or
  redemption exists for a member win (it consumes nothing).
- **Staff see the reason** on the invoice: "Gold 4% được áp dụng — …" when the member discount wins; "Ưu đãi đã áp dụng: Khuyến mãi … — Khuyến mãi được chọn vì có lợi hơn giảm giá hội viên"
  when a promotion wins; the candidates table lists the member row with its result (applied / eligible but not chosen / "Chưa đủ 500 điểm Spa."); a draft says the tier is a preview.
- **Lock order precaution (not a proven bug):** the tier read takes the payer's user row (key-share) before the wallet, so a manual adjustment (customer row, then wallet) and a finalization (wallet, then the snapshot's foreign key to the same user row) cannot form a cycle (design 12.2). A first race that deadlocked did so only because the test reused the finalizing cashier as the ledger actor and wrote through the ledger function directly; the race against the real adjustment command passes with and without the extra lock (checked), so the deadlock itself was not reproduced.

## P5-T8 (Owner: rejected, hard block)

A manual adjustment or linked correction larger than the current balance is refused with `LOYALTY_BALANCE_TOO_LOW` ("Số dư chỉ còn X điểm"); nothing is written and no exception row is
created (`appendLedgerEntry(..., { refuseBeyondBalance: true })`). Reversal of earned points keeps the P5-Q5 rule (floor at 0, shortfall recorded, exception row).

## Migrations

`20261029000000_phase5_member_discount` (additive). Deploy (only when asked, after all of Phase 5): backup, `pnpm db:deploy`, `pnpm db:permissions:sync`, restart API/Web/Worker.

## Decisions needed / notes

- Existing finalized invoices stay version 1 (no snapshot); new ones are version 2. The customer-facing invoice view does not show the member discount yet (P5-10).
- The Member Discount base is every priced line (Phase 5 has Spa lines only): the OQ-2 half "which services must not receive the Member Discount" is PENDING Owner approval, so this is the proposed default, provisional. P5-T6 (tie goes to a promotion or voucher) is also provisional until the Owner confirms. Birthday is P5-6.

## Tests (scratch DB `lucy_spa_p5_3_validation_20261004`)

| Check                                                                                                                                                                                 | Result               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Engine unit tests (member amount, PRD 16.1 examples, tie, no tier, version 1 equality)                                                                                                | 5 new + 11 old pass  |
| New API flows in `loyalty.integration.test` (OFF, no tier, Gold, preview, snapshot, frozen after a later balance, promotion beats member, tie, member beats promotion, guest, cancel) | 13 / 13              |
| New races `member-discount.race.integration.test` (two invoices of one payer, finalize vs balance change, cancel vs finalize)                                                         | 4 / 4, three runs    |
| Existing POS suites after `calculation_version` 2: invoice 10, discount 13, payment 11, payos 16, customer-invoice 8, notifications 12; races: invoice 5, discount 6, payment 6       | all pass             |
| Database foundation (new snapshot and integrity cases), Phase 4 foundation, database, notification foundation                                                                         | 42 / 42              |
| Web: member discount card (4), pos, loyalty                                                                                                                                           | pass                 |
| Full `pnpm test`, lint, format, typecheck                                                                                                                                             | see the final report |

## UX gate

- Rendered the invoice page at 360, 768, 1440 light + 1440 dark for: member discount won (finalized), draft with a Gold preview, draft with no tier, a promotion that beats the member discount.
- Images opened: member won 1440 light; draft Gold 360 light; promotion beats member 1440 dark; no tier 768 light (BEFORE the two fixes below); no tier 1440 light (AFTER the fixes). The other
  width/theme combinations were not opened one by one (the DOM audit ran on all of them).
- Fixed after the first look: the row for a payer with no tier read "Giảm giá hội viên Chưa có hạng" (now "Giảm giá hội viên"); its reason was cut off at two lines (now "Chưa đủ 500 điểm Spa.").
- DOM audit of the new states: the drafts show FR3 surface-style-mix (info Notice beside cards) and the candidates table at 360 shows FR8 row-height-uneven when row texts differ in length.
- DOM audit of the EXISTING invoice page after the refactor, on the audit database migrated with this step (go-live OFF), light, pages pos and pos-invoice:
  pos-invoice before the change 1440: 0, 768: 0, 360: 1 (FR8 row-height-uneven); after: 0, 0, 1 (the same finding); pos before and after 0, 0, 0. No count rose.
