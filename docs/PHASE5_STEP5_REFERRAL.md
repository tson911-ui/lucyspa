# Phase 5 P5-5: Referral

Status: built and validated on a scratch database; **not deployed, loyalty stays OFF**. Contract: `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 7 and the Owner decisions of 2026-10-04 in 2.5.
Also in this step: P5-T6 (equal amount: the Member Discount wins) and OQ-2 recorded as Owner-approved, engine fixed (commit `eeea0dd`).

## What changed

- **Binding:** a referrer is an existing member by exact phone (any status). Signup: optional field, stored on the registration intent and resolved silently at activation (a stranger, nobody, the own number: nothing is recorded and the answer is identical; only a malformed phone is a field error). Counter: `MANAGE_REFERRALS` at the branch, masked lookup then confirm. Fixed once set; no self-referral; mutual A↔B allowed. A customer is bindable while brand-new: no completed visit, or one whose invoice was never paid (window closes at the first payment). Bindable while go-live is OFF.
- **Brand-new** (P5-Q4): a phone with no completed visit ever, guest visits and visits before go-live included (`visit_participants.phone_canonical`, a generated column twin of `normalizePhone`).
- **Reward:** the `loyalty` consumer, on `INVOICE_PAID`, when go-live is ON and real money was paid (`settlement = PAYMENT`, not 0đ): +10 Spa and +10 Beauty to the referrer, once, if the invoice's visit is the referred customer's FIRST completed visit, they received the service (any payer, a guest included) and the referral was bound before the payment. Never reversed by a refund, reopen or cancel; idempotent (unique ledger keys, one stamp). Wallets are locked in the design's fixed order.
- **Owner correction (OQ-7 rejected as written):** `CHANGE_REFERRER`, Owner only (same pattern as `ACTIVATE_LOYALTY`: GLOBAL_ONLY, no role or override can hold it, fresh password), a reason, an append-only history (old, new, actor, time), only BEFORE the reward; after it the database locks the referrer forever.
- **Screens:** "Điểm thưởng" gets a Giới thiệu tab (list, status filter, 20/page, row menu); the customer profile gets a Người giới thiệu card (referrer, how, status, totals as a referrer, history of corrections) with Gắn / Đổi người giới thiệu in its header; public signup gets the optional field.

## Migrations (additive)

`20261030000000_phase5_change_referrer_code`, `20261030000001_phase5_referral` (permission semantics + Owner-only trigger, `referral_changes`, `registration_intents.referrer_phone_canonical`, `lucy_phone_canonical` + `visit_participants.phone_canonical`, the go-live guard on referral binding dropped and moved to the award stamp). Deploy (only when asked, after all of Phase 5): backup, `pnpm db:deploy`, `pnpm db:permissions:sync` (54 codes), restart API/Web/Worker.

## Permissions

New `CHANGE_REFERRER` (Owner only). `MANAGE_REFERRALS` (existed) binds at the counter; reading follows `VIEW_LOYALTY` at the branch. Nothing granted.

## Tests (scratch DB `lucy_spa_p5_3_validation_20261004`)

| Check                                                                                                        | Result           |
| ------------------------------------------------------------------------------------------------------------ | ---------------- |
| `referral.integration` (bind rules, award, 0đ, cancelled, brand-new window, participant phone, Owner change) | 10 / 10          |
| `referral.race.integration` (two consumers, award vs Owner change, bind vs payment, shared referrer wallets) | 4 / 4            |
| `registration.integration` signup referrer; `phase5-loyalty-foundation` (referral guards, history, phone)    | pass             |
| `loyalty`, `loyalty.race`, `member-discount.race`, `authorization` (54 codes), `discount` + race             | pass             |
| Unit: engine tie, registration referrer; web: referral card, tabs, errors                                    | pass             |
| Full `pnpm test`, lint, format, typecheck                                                                    | see final report |

## UX gate

- Rendered at 360, 768, 1440 light + 1440 dark: referral list, 6 profiles (referrer with totals, rewarded, pending with history, pending, no referrer), bind dialog, change dialog, public signup, and the P5-4 tie invoice (re-shot). The theme cookie was set per render (the auto theme follows the clock).
- Images opened: list 1440 light and 360 light; tuan 1440 and 768 light; hoa 360 light; lan 1440 dark; bich 1440 light; both dialogs 1440 light; pos-tie 1440 and 360 light; signup 1440 light, 360 light, 1440 dark. Others not opened one by one (DOM audit ran on all).
- Fixed after the first look: card label repeated its heading ("Người giới thiệu" → "Hội viên"), list heading repeated its tab ("Danh sách giới thiệu"), the optional signup label was bold like the required ones (now a hint).
- DOM audit (run on the P5-3 scratch database, not the uxaudit one): every page here is new to the baseline, so the compare shows them as rises from 0. The findings are the known ones: the referrer profile and the tie invoice show the FR8 row-height finding of the ledger / invoice phone card list at 360 (the baselined pos-invoice is also 360: 1), the bind dialog shows the dialog FR3 findings (a notice beside the card behind the overlay). Lists, 4 of 6 profiles and the change dialog: 0. The public signup page is not in the baseline; the screens script found no horizontal scroll or small target. Baselined pages were not re-audited: the only change near them is permission labels (the roles page lists no Owner-only code).

## Owner decisions after review (2026-10-04)

- **Received a service (Owner-approved):** "already visited" counts only a participant (by account or canonical phone) with a DONE service line in a COMPLETED visit. A visit owner or payer who received none is still new and can be bound; the earlier choice to count the owner is withdrawn. `completedVisitsOf` and the award query changed; new test "a booker who received no service is still new" (bind after the booking, the friend's visit does not reward, her own first visit does). `referral.integration` 12 / 12, `referral.race.integration` 5 / 5 on a fresh scratch database.
- **Wording (Owner-approved):** "khám" removed from Vietnamese text (4 strings in `apps/web/src/i18n/loyalty.ts`: "lần khám đầu tiên" → "lượt làm dịch vụ đầu tiên" ×3, "đã có lần khám trước" → "đã từng làm dịch vụ"); rule added to `CLAUDE.md`.

## Open questions

None new. A customer account is always ACTIVE in the data model, so "locked or disabled referrer" has no state to test; no code looks at the referrer's status.
