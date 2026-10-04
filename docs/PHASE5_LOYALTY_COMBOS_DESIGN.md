# Phase 5: Loyalty, Membership, Referral, Birthday, Combos and Gift Catalog — design contract

Status: **P5-1 approved by the Owner 2026-10-04 (section 2.4); P5-2 approved (section 2.5); P5-6 approved 2026-10-05; P5-7 (combo sale, section 9.6) built, not deployed.** P5-1 itself was docs only.
Production state is whatever `LUCYSPA_HANDOFF.md` records (Phase 4 live at `58bfabc`); nothing here assumes a deploy.

Every rule below carries a source label so nothing is silently invented:

| Label    | Meaning                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `PRD §n` | Written in `LUCY_SPA_PRD.md` (sections 14, 16-21, 29, 56, 60, 61)                                                 |
| `P5-Qn`  | Locked Owner decision, 2026-10-04 (section 2.1). Never collides with Phase 4 Q0-Q10; **Phase 5 Q10 is withdrawn** |
| `P4 §n`  | Locked Phase 4 contract (`PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md`), reused unchanged                               |
| `P5-Tn`  | **Proposed technical decision**, needs Owner approval before the Step it names (like Phase 4 OP-x)                |
| `OQ-n`   | **Open question.** Not decided here. Each says which Step it blocks and, where useful, a proposed default         |

## 1. Scope, non-goals, foundations

**In scope (PRD §56 Phase 5):** independent non-expiring Spa and Beauty point wallets with permanent ledgers; the locked tier table;
Member Discount and best-offer selection; configurable Birthday Rewards (ships empty); the fixed one-time referral award; combo
definitions, counter sale, ownership, family use, restoration; the reward/gift catalog framework (ships empty); linked point
adjustments; a customer account page.

**Phase 5 only has Spa lines.** Product lines, stock and Beauty earning are Phase 6, so in Phase 5 the Beauty wallet receives only
the referral award (PRD §20.3) and manual adjustments (PRD §18.4). Mixed Spa/Beauty allocation is out of scope (section 17).

**Foundations confirmed in the repository (read, not assumed):**

- `outbox_events` and `outbox_consumptions` (`UNIQUE(event, consumer)`) exist; P4 §15.2 reserved the consumer name `loyalty`.
- `invoices` has `payer_user_id` (nullable = guest), `paid_seq`, `calculation_version`, `business_date`; `visit_id` is **NOT NULL**.
- `discount_redemptions` / `discount_redemption_releases` implement redeem-at-finalization and release-on-cancel; Phase 5 mirrors it.
- `customer_profiles.date_of_birth` (date, required at registration) is the only birthday source.
- `visit_participants.phone` is **free text**, not canonical; `users.phone_canonical` is canonical and unique.
- `registration_intents` has **no referrer field**; no loyalty, wallet, referral, combo or reward table exists yet.

## 2. Decisions

### 2.1 Locked Owner decisions (P5-Q1 … P5-Q9; do not reopen)

| #     | Decision                                                                                                                                                                                          | Applied in |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P5-Q1 | Points start at **0 from the go-live date**. **No backfill** for past paid invoices.                                                                                                              | 4.2, 11    |
| P5-Q2 | **The payer earns** the points, if the payer is a member. If the payer is a **guest, nobody earns** points (a member who is only a participant earns nothing).                                    | 4.1, 5.1   |
| P5-Q3 | **Round down per invoice** (930,500đ = 930 points).                                                                                                                                               | 4.3        |
| P5-Q4 | "Brand-new customer" = **a phone number with no completed visit ever, including guest visits**. The referrer phone can be entered **both by the customer at signup and by staff at the counter**. | 7          |
| P5-Q5 | The balance **never goes below 0**. If a reversal exceeds the balance: set it to 0, **record the shortfall in the ledger**, **flag it for the Owner**.                                            | 3.3, 4.5   |
| P5-Q6 | Birthday gift: build the **configuration feature, ship it empty** (no preset gift). The **date window is also Owner-configured**.                                                                 | 8          |
| P5-Q7 | Gift/benefit catalog: build the **empty framework in P5-9**.                                                                                                                                      | 10         |
| P5-Q8 | Combos are sold **at the counter via POS only, and only to members**.                                                                                                                             | 9.2        |
| P5-Q9 | **No notifications** (no SMS/Zalo/email). Customers see everything **on their account page only**.                                                                                                | 12         |

Phase 4 decisions that stay in force: Q2 (one Visit, one active invoice, payer on the invoice), Q3 (money rounds half-up), Q4/OP-5
(exactly one ordinary winner, no stacking), OP-2 (zero balance goes directly to `PAID`), OP-3 (identified member payer),
OP-4 (`minimumSpend` on the eligible subtotal before the benefit), Q6/OP-7 (corrections and zero-balance cancel), Q9 (permissions are
an Owner decision, no role names, no automatic seeding).

PRD rules reused as locked (not Phase 5 choices): 1,000đ = 1 point, whole points, tips earn nothing, points never expire and are not
currency (§18.1-18.3); tier table (§18.5); tier is read **before** the transaction earns (§18.6); ordinary promotions and the Member
Discount do not stack, the better one wins (§16.1); referral is fixed +10 Spa AND +10 Beauty, once per referred customer, never clawed
back (§20.3-20.4); combos have no expiry, stay with the purchaser, family use, restoration only by authorized staff (§17.2-17.5);
free entitlements generate no tour (§17.6); service/combo refunds do not exist (§29).

### 2.2 Proposed technical decisions (need Owner approval)

| #      | Proposal                                                                                                                                                                                                                                                            | Needed before |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| P5-T1  | **Points are awarded and reversed asynchronously** by the `loyalty` outbox consumer (P4 §15.2). Redemptions, releases and the tier snapshot are **synchronous** inside the invoice commands. A loyalty fault therefore never blocks a payment. Consequence in 12.3. | P5-2          |
| P5-T2  | **One Owner-activated go-live instant** (`loyalty_go_live.go_live_at`, set once, immutable, audited) gates the whole module (points, tiers, referral, birthday, combos). Before it is set Phase 5 code is dormant and invoices behave exactly as in Phase 4.        | P5-2          |
| P5-T3  | **The tier is read at finalization** under lock and **snapshotted**; a DRAFT only shows a non-binding preview (section 5.3).                                                                                                                                        | P5-4          |
| P5-T4  | **The Member Discount and points follow the payer** (same identity as OP-3), using the payer's Spa tier. A guest payer has no Member Discount.                                                                                                                      | P5-4          |
| P5-T5  | **`calculation_version = 2`**; drafts are recalculated at finalization under the version then in force; finalized v1 invoices are never touched (section 6.4).                                                                                                      | P5-4          |
| P5-T6  | **(APPROVED by the Owner, 2026-10-04, see 2.5)** Tie-break including the Member Discount: equal amounts → the **Member Discount** wins, so the customer keeps the promotion or voucher; among programs the Phase 4 order stays.                                     | P5-4          |
| P5-T7  | **(APPROVED by the Owner, 2026-10-05, see 2.5)** **Birthday is a separate layer applied after the single ordinary winner**, only when its configuration says it combines; a missing rule means no stacking (section 6.3, 8.1).                                      | P5-6          |
| P5-T8  | **(REJECTED by the Owner; hard block instead, see 2.5)** P5-Q5 applies to every negative ledger entry, manual adjustments included.                                                                                                                                 | P5-3          |
| P5-T9  | **Stale-episode guard:** the consumer awards only if the paid episode is still current at processing time (section 4.4).                                                                                                                                            | P5-3          |
| P5-T10 | **(APPROVED by the Owner, 2026-10-04, see 2.5)** **Referral binding window and resolution rules** of section 7.2-7.4, including the uniform public-signup response and the canonical phone index.                                                                   | P5-5          |
| P5-T11 | **Combo sessions are individual rows** (kind `PAID` or `BONUS`), consumed at invoice finalization with an append-only release, mirroring Phase 4 redemptions.                                                                                                       | P5-7          |
| P5-T12 | **Lock order extension** of section 12.2.                                                                                                                                                                                                                           | P5-2          |
| P5-T13 | **Permission names** of section 13 (no seeding).                                                                                                                                                                                                                    | P5-2          |

### 2.3 Open questions (not decided; do not implement)

| #     | Question                                                                                                                                                                                                                                                                                                                                                                                           | Blocks      | Proposed default (only if the Owner agrees)                                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OQ-1  | A counter combo sale has no Visit, but P4 Q2 says an invoice exists only for a COMPLETED Visit and `invoices.visit_id` is NOT NULL. May a standalone **counter-sale invoice** (no Visit) exist, and may a combo purchase also be a line on a normal Visit invoice?                                                                                                                                 | **P5-2**    | Yes to both: an invoice `kind` (`VISIT` / `COMBO_SALE`), `visit_id` NULL only for `COMBO_SALE`, all other Phase 4 rules unchanged.                                                                                                                                             |
| OQ-2  | Is there any Spa service or combo that must **not** earn points or **not** receive the Member Discount? PRD §17.2 mentions an "eligible purchase configuration" without defining it, and invoice-level discounts are not allocated to lines (P4 §7.4), so a mixed eligible/ineligible invoice has no defined amount.                                                                               | P5-3        | None excluded in Phase 5: every Spa service line and every combo purchase is eligible; any exclusion needs an Owner-defined allocation.                                                                                                                                        |
| OQ-3  | Where is the P5-Q5 "flag for Owner" shown, given P5-Q9 forbids notifications?                                                                                                                                                                                                                                                                                                                      | P5-3        | A permission-gated "loyalty exceptions" list in the admin area, no push and no in-app notification.                                                                                                                                                                            |
| OQ-4  | **ANSWERED 2026-10-04 (approved, see 2.5): a 0đ first visit does not trigger the reward.** Does a **zero-balance first visit** (OP-2, no payment) satisfy the referral condition "payment completes successfully" (PRD §20.3)? If not, the visit still makes B no longer new (P5-Q4), so that referral can never be awarded.                                                                       | P5-5        | No: an award needs `settlement = PAYMENT`.                                                                                                                                                                                                                                     |
| OQ-5  | **ANSWERED 2026-10-04 (approved, see 2.5): the person who received the service; anyone may pay; cancelled or never paid = no reward.** Which role makes a visit B's qualifying visit: B as **payer**, as a **member participant**, or either? And if B's first completed visit's invoice is cancelled and never paid, B is no longer new, so the referral is never awarded: confirm.               | P5-5        | B is a member participant (service recipient) of the visit; the payer can be anyone, including a guest. Never-paid means never awarded.                                                                                                                                        |
| OQ-6  | **ANSWERED 2026-10-04 (approved, see 2.5): only self-referral is blocked; a locked referrer is still rewarded.** Referral edge cases PRD §20.3 says not to invent limits for: a **mutual loop** (A refers B and B refers A before either visits), and the referrer's account being deactivated at award time.                                                                                      | P5-5        | Only the structural rules (referrer is another existing member; no self-referral); a deactivated referrer's ledger is still credited.                                                                                                                                          |
| OQ-7  | **ANSWERED 2026-10-04 (REJECTED as written, see 2.5): the Owner may correct the referrer before the award, with history.** The uniform public-signup response (7.3) means a customer who mistypes the referrer phone gets no feedback. Accept that trade-off?                                                                                                                                      | P5-5        | Accept; staff can bind at the counter with a masked confirmation.                                                                                                                                                                                                              |
| OQ-8  | **ANSWERED 2026-10-04 (Owner, see 2.5).** Birthday details PRD §19 leaves to configuration: **whose birthday** (payer or participant); how **29 February** is treated in non-leap years; the **base of a percentage** Birthday benefit; a **non-combinable** Birthday benefit versus the ordinary winner; **non-monetary** types (free service, gift) and their valuation against money (PRD §61). | P5-6        | Payer's birthday; 28 Feb in non-leap years; percentage on the amount left after the winner; Phase 5 ships monetary types only, free-service/gift types follow P5-9; a non-combinable monetary Birthday competes by amount, a non-monetary one never competes.                  |
| OQ-9  | Combos: is consumption allowed at **any branch** or only the selling branch? Which session is consumed first, `PAID` or `BONUS` (it decides future tour; history is immutable)? What happens when the **purchase payment is reversed after sessions were consumed** (PRD §61)? Are sessions usable before the purchase invoice is `PAID`? Do ordinary promotions apply to combo lines?             | P5-7 / P5-8 | Any branch the Owner configures; ask Owner for order; reversal allowed (money first), consumed sessions stay as history, unused sessions frozen and flagged (OQ-3 list); not usable before `PAID`; existing programs do not apply to combos until an Owner adds a combo scope. |
| OQ-10 | How far does P5-9 go: catalog CRUD, manual issuance, entitlement lifecycle only, or also POS redemption (which kinds)? PRD §21 defines entities, not flows, and forbids a point-priced reward program.                                                                                                                                                                                             | P5-9        | Catalog CRUD + manual issuance with reason + lifecycle + POS redemption of `FREE_SERVICE` only (reusing the combo consumption path).                                                                                                                                           |
| OQ-11 | What does the customer see for a manual adjustment: the reason text or a generic label?                                                                                                                                                                                                                                                                                                            | P5-10       | Generic label ("Điều chỉnh bởi Lucy Spa"); internal reason stays staff-only.                                                                                                                                                                                                   |

None of these blocked P5-1. The Owner asked to be asked about OQ-2 … OQ-11 **only when a step is blocked by one** (the "Blocks" column).

### 2.4 Owner approvals of 2026-10-04 (locked; do not reopen)

- **OQ-1: yes.** A "combo sale" invoice that is not tied to a Visit is allowed (implemented in P5-7, see section 16). The OQ-1 row above is kept for history.
- **P5-T1, P5-T2, P5-T12, P5-T13: approved as written.** **The loyalty go-live switch defaults to OFF**: the switch is a single immutable row (`loyalty_go_live`);
  its absence means OFF, and activating it is a deliberate later action.
- **OQ-2 … OQ-11 stay open.** Nothing may be implemented from their proposed defaults until the Owner answers the one that blocks a step.
- Open for P5-3 (not decided): which permission activates go-live. P5-T2 requires it to be `GLOBAL_ONLY` and re-authenticated, but section 13 lists no code for it.
  **Answered 2026-10-04 (below).**

### 2.5 Owner approvals after P5-2 review (2026-10-04, locked; do not reopen)

- **P5-2 approved as built:** the permission scopes and data classifications of section 13 as proposed; **P5-T3, P5-T4, P5-T5** (tier read at finalization and
  snapshotted, payer-based Member Discount, `calculation_version = 2`), **P5-T9** (stale-episode guard), **P5-T11** (combo sessions are individual rows).
  **A combo is issued only when its invoice is `PAID`** (never at finalization).
- **Go-live switch:** Owner only. One **new system-wide (`GLOBAL_ONLY`) permission** activates it (code `ACTIVATE_LOYALTY`, added in P5-3); switching it on **requires fresh
  re-authentication** (the existing password re-authentication; the repository has no 2FA); **granted to the Owner only** (no role or override may carry it). It stays **OFF**.
- **Deploy: none until the whole of Phase 5 is finished.** Every Phase 5 Step is built and validated on scratch databases only.
- **OQ-3 is answered by the Owner's own P5-3 instruction:** the P5-Q5 shortfall is flagged as a row in a permission-gated **loyalty exceptions list** in the admin area
  (derived from ledger entries with `shortfall_points > 0`; read-only; no notification, P5-Q9). OQ-4 … OQ-11 stay open.
- **OQ-2: Owner-approved (confirmed by the Owner after the P5-3 review).** Every Spa service line and every combo purchase earns; tips are excluded; points = `floor(total_vnd / 1000)` of the PAID invoice (4.1, 4.3).
- **P5-T8: REJECTED by the Owner (2026-10-04), replaced by a hard block.** A manual deduction (adjustment or linked correction) larger than the current balance is
  **refused** with "Số dư chỉ còn X điểm": nothing is written to the ledger and no exception row is created. A deduction up to the balance is allowed. The
  **reversal** of earned points (invoice reopened or cancelled) keeps the Owner-locked P5-Q5 rule: floor at 0, record the shortfall, flag it as an exception (3.3).
- **P5-T6: APPROVED by the Owner (P5-4 review, 2026-10-04), replacing the earlier provisional "Ưu tiên khuyến mãi/voucher" answer.** On an EQUAL amount the **Member Discount wins**, so the
  customer keeps their promotion or voucher (no redemption is consumed). The engine, its tests and the staff-facing reason (`MEMBER_TIE_OVER_PROGRAM`) follow this. P5-T3, P5-T4 and P5-T5 were already approved (2.5, first bullet).
- **OQ-2, second half: APPROVED by the Owner (P5-4 review, 2026-10-04).** The Member Discount applies to **all priced services, no exclusions**. OQ-2 is now fully answered (points half: all services earn, tips excluded).
- **P5-4 instruction (Owner, 2026-10-04):** the Member Discount is a candidate of the existing best-offer selection under `calculation_version = 2`; finalized invoices are never
  recalculated; the tier comes from the payer's Spa balance BEFORE the invoice and is snapshotted on it; Beauty is Phase 6; the system picks whichever of promotion or member discount
  is better for the customer (never both); staff see the reason; it applies only when go-live is ON; the birthday gift is P5-6.
- **P5-5 instruction (Owner, 2026-10-04):** referrer = the phone of an existing member, entered by the customer at signup or by staff at the counter
  (`MANAGE_REFERRALS`), fixed forever once set, no self-referral. "Brand-new customer" = a phone with no completed visit ever, guest visits included (P5-Q4). Reward = +10 Spa and +10 Beauty points to the referrer,
  once, when the new customer completes the first visit AND it is paid; never revoked on refund or cancel; idempotent; only when go-live is ON. Public signup must not reveal whether a phone is a member or show the
  referrer's name. Admin: a referral list, and the referrer on the customer profile. The Owner asked to be asked if an open question blocks the Step (example named: a 0đ first visit).
- **P5-5 decisions (Owner, in the Owner's own words, 2026-10-04; locked, do not reopen):**
  - **OQ-4: APPROVED.** A 0đ first visit does NOT trigger the reward; the first visit must have real money paid (`settlement = PAYMENT`).
  - **OQ-5: APPROVED.** "New customer" = the person who received the service; anyone may pay (a guest payer included); if the first invoice is cancelled or never paid there is no reward.
  - **OQ-6: APPROVED.** Only self-referral is blocked. Mutual A↔B referral is allowed. A locked or disabled referrer still receives the reward.
  - **OQ-7: REJECTED as written** (a mistyped referrer is not permanent). **Only the Owner may change a customer's referrer, and only BEFORE the reward has been granted.** The change needs a reason and is kept in history
    (old value, new value, actor, time). Once the reward is granted, the referrer is locked forever. A new Owner-only permission (`CHANGE_REFERRER`, `GLOBAL_ONLY`, fresh re-authentication, granted to no role or override) follows the `ACTIVATE_LOYALTY` pattern.
  - **P5-T10: APPROVED as proposed** (binding window until the first PAID episode, canonical participant-phone index, identical signup response).
  - **Go-live:** a referrer entered while go-live is OFF is stored and rewarded later if the conditions are met after go-live (the go-live DB guard is relaxed for referral binding only; points still need go-live ON).
    Visits completed before go-live DO count, so such a customer is no longer "new".
- **P5-5 review decisions (Owner, in the Owner's own words, 2026-10-04; locked, do not reopen):**
  - **"Already visited" = received a service.** Only a person who actually received a service counts as having visited. A booker or payer who received none (visit owner only) still counts as new and can still get a referrer. Built and tested (7.4, 7.6).
  - **Wording:** Lucy Spa is a spa, not a clinic. Never "khám" / "lượt khám" in Vietnamese; use "lượt đến" or "lượt làm dịch vụ" (rule added to `CLAUDE.md`).
- **"Khám phá" in the footer (Owner, 2026-10-04): keep it**, it means Explore, not clinic. The `CLAUDE.md` "khám" rule does not cover it.
- **OQ-8: ANSWERED by the Owner in the Owner's own words, 2026-10-04 (locked, do not reopen).** Birthday gift (P5-6, section 8):
  1. Whose birthday: the **PAYER's**. A guest payer gets no birthday gift.
  2. Born on 29 February: in a non-leap year the birthday is **28 February**.
  3. A **percentage** gift is calculated on the amount **remaining after the best offer**.
  4. A gift **not allowed to combine** is compared with the best offer and the **larger discount wins**. Non-money gifts are never compared.
  5. P5-6 covers **money gifts only** (fixed amount or percentage). Free-service and item gifts belong to P5-9.
  6. Usage limit: the default is **1 time per customer per year**; the configuration screen must still **force the Owner to choose explicitly** when saving.
- **P5-6 follow-ups to OQ-8 (Owner, in the Owner's own words, 2026-10-05; locked, do not reopen):**
  1. **A gift that may NOT combine is compared with the best offer, both calculated on the ORIGINAL invoice total; the larger discount wins.** Example: total 100,000đ, promotion 60,000đ against a fixed gift of 80,000đ: the gift wins and the customer pays 20,000đ. The "amount left after the best offer" base applies ONLY when the gift IS allowed to combine (this replaces my earlier reading that used the remaining amount for the comparison too).
  2. **Tie:** the existing offer stays and the gift is NOT counted as used.
  3. **"Per year" = per birthday occurrence**, not calendar year.
  4. **P5-T7: APPROVED.**
  5. **The birthday configuration is Owner only** (`MANAGE_BIRTHDAY_REWARDS`, changes its P5-T13 entry) and the **364-day maximum window** (days before + days after) is approved.
- **Owner review of P5-3 (approved):** reading loyalty follows the branch (`VIEW_LOYALTY` at the staff member's branch, like the POS member lookup); points are taken back on
  `INVOICE_REOPENED` / `INVOICE_CANCELLED` (not `PAYMENT_REVERSED`, which always comes with `INVOICE_REOPENED` for a paid invoice).
- Implementation notes of P5-3 (no decision changed): reversal is keyed on `INVOICE_REOPENED` and `INVOICE_CANCELLED` per 4.4 (`PAYMENT_REVERSED` always comes with
  `INVOICE_REOPENED` when a PAID invoice is reversed, so reacting to both would double-reverse); the earn key is `SPA_EARN:{invoice}:{paid_seq}` (one earn per paid episode,
  however many split payments it had).

## 3. Wallets and the point ledger (design only; nothing is created in P5-1)

### 3.1 Model

- Two wallets per customer, `SPA` and `BEAUTY`, never merged or transferred (PRD §18). Created lazily on first entry (balance 0).
- **Ledger** `loyalty_ledger_entries`: append-only, never updated or deleted (PRD §18.3-18.4). Columns (conceptual): id, user, wallet,
  `kind`, signed `points`, `idempotency_key` (unique), source references (invoice id, `paid_seq`, referral id, adjustment id), nullable
  `reverses_entry_id` / `corrects_entry_id` (each unique), `shortfall_points` (default 0), reason, actor, DB-clock `created_at`.
- `kind`: `EARN`, `EARN_REVERSAL`, `REFERRAL_AWARD`, `MANUAL_ADJUSTMENT`, `MANUAL_CORRECTION`. Referral awards are distinguishable
  from purchase points (PRD §20.4).
- **Balance** `loyalty_wallets.balance_points` is a cache updated in the same transaction as the ledger insert, under the wallet row
  lock. Invariants (CHECK + deferred constraint trigger + reconciliation test): `balance >= 0` and `balance = Σ ledger points`.
- **The tier is never stored as authority**: it is a pure function of the balance and the locked table (version 1). Only transactions
  snapshot it (section 5.3).
- Integer points everywhere; no fractional points, no carried remainder (PRD §18.1).

### 3.2 No expiry, no spending

No automatic expiry, annual reset or rolling expiry. No point can reduce an invoice, be mixed with money, be transferred or be
converted (PRD §18.2-18.3). The Member Discount never deducts points. A reward's own expiry never expires points (PRD §21).

### 3.3 Never below zero (P5-Q5 for reversals; hard block for manual deductions)

**Manual deductions (Owner decision, P5-T8 rejected):** a manual adjustment or correction of `r` points on a balance `b < r` is refused ("Số dư chỉ còn `b` điểm"); nothing is written, no
exception row. The clamp below applies to **reversals only**.

For a reversal of `r` points on a balance `b`: `applied = min(r, b)`; the entry stores `points = -applied` and
`shortfall_points = r - applied`; if `shortfall_points > 0` an exception record is created for the Owner (surface: OQ-3). The original
earn entry is untouched. Because the stored amount is the applied amount, `balance = Σ points` still holds.

Example: balance 40, a 100-point earn is reversed → entry `-40`, shortfall 60, flagged, balance 0.

## 4. Earning

### 4.1 Who earns, what counts (PRD §18.1, P5-Q2)

- Awarded only after the invoice reaches `PAID` (not on finalization), to the **invoice payer's Spa wallet**.
- `payer_user_id IS NULL` (guest) → **no entry at all**; the consumer records outcome `SKIPPED_GUEST`. The payer cannot change after
  finalization (P4 §10), so this is stable.
- Eligible amount (Phase 5, all lines are Spa) = the invoice's `total_vnd` after discounts, vouchers and Birthday; tips never earn
  (none exist before Phase 7). Free/entitlement lines are 0đ, so they add nothing. Exclusions: OQ-2.
- A zero-balance invoice (OP-2) earns 0 points; no entry is written.

### 4.2 Go-live (P5-Q1, P5-T2)

- The consumer **skips every paid episode whose `paid_at < go_live_at`** (outcome `SKIPPED_PRE_GO_LIVE`) even though P4 §15.2 lets a
  new consumer read history: the history read is allowed, awarding from it is not.
- A reopen/cancel event for such an episode finds no earn entry and is a no-op.
- An invoice paid before go-live, reversed and paid again after go-live has a new `paid_seq` with a new `paid_at`; that new episode
  earns normally (it is a new payment, not a backfill).
- Go-live is an Owner action recorded once; no date is hard-coded. Mechanism: P5-T2.

### 4.3 Rounding (P5-Q3)

`points = floor(eligible_paid_vnd / 1000)`, computed with integer (`BigInt`) division, **once per invoice** on the whole eligible amount,
never per line; the remainder is dropped (no carry-forward, PRD §18.1). 930,500đ → 930 points. This is deliberately different from
money rounding: **P4 Q3 rounds discount amounts half-up to 1 VND; Phase 5 rounds points down**; the two never apply to the same value.
A result of 0 writes no entry.

### 4.4 Events, reversal and the stale guard

| Event (from Phase 4)              | Consumer action                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INVOICE_PAID(invoice, paid_seq)` | Re-read authoritative state under lock; if the invoice is still `PAID` **at this `paid_seq`**, payer is a member and `paid_at >= go_live_at` → write `EARN`. Otherwise record `SKIPPED_*`. |
| `INVOICE_REOPENED(paid_seq)`      | Find the `EARN` entry of that episode; if present, write `EARN_REVERSAL` (full amount; clamp per P5-Q5). None → no-op.                                                                     |
| `INVOICE_CANCELLED.voidedPaidSeq` | Same as above for the voided episode (OP-7 voids a zero-balance episode with no payment event; it has no earn entry, so this is normally a no-op).                                         |
| `PAYMENT_REVERSED`                | **Not a key.** A reversal that leaves an invoice short always emits `INVOICE_REOPENED`; reacting to both would double-reverse.                                                             |

The stale guard (P5-T9) makes ordering safe: a `PAID` event processed after its own reopen is skipped, so a voided episode is never
awarded. Reversal never recomputes finalized history; it adds a linked entry (PRD §14.2, §18.4).

A tier decrease after a reversal is automatic (the tier is derived); it affects only later transactions (PRD §18.4, §18.6).

### 4.5 Referral points are not part of this reversal

`REFERRAL_AWARD` entries are never reversed by invoice events (PRD §20.4). See section 7.

## 5. Tiers and the Member Discount

### 5.1 Tier table (PRD §18.5, locked, not Owner-editable)

| Spa balance | Tier               | Member Discount (basis points) |
| ----------- | ------------------ | ------------------------------ |
| 0-499       | no membership tier | 0 (0%)                         |
| 500-999     | Silver             | 300 (3%)                       |
| 1,000-2,999 | Gold               | 400 (4%)                       |
| 3,000-4,999 | Platinum           | 500 (5%)                       |
| 5,000-9,999 | Diamond            | 700 (7%)                       |
| 10,000+     | Ruby               | 900 (9%)                       |

Spelling is **Diamond**. The table is versioned (`tier_table_version = 1`) so a future Owner-approved change is a new version and never
rewrites a snapshot. The Beauty wallet uses the same table independently, but no Beauty discount can occur in Phase 5 (no product lines).

### 5.2 The Member Discount

- Source `MEMBER_TIER`; payer must be an identified member (P5-Q2, P5-T4); guest → no candidate.
- Amount = `roundHalfUp(eligibleSubtotal × bp / 10000)` per P4 §7.2; eligible subtotal = all eligible lines before any benefit (OP-4).
- It consumes no points and no usage (PRD §18.2). Not using it never lowers the tier (PRD §18.6).

### 5.3 Tier timing and snapshot (PRD §18.6, §14.2, P5-T3)

1. A DRAFT shows a **preview** from the current balance, labelled non-binding.
2. **At finalization**, under the invoice lock and the payer's Spa wallet lock, read the balance, derive the tier, run the engine, and
   **snapshot** (new `invoice_loyalty_snapshot`): payer, wallet, **balance before**, tier, `tier_table_version`, applied basis points,
   the full candidate list with eligibility and amounts, winner and `selection_reason`, the Birthday configuration version and result,
   eligible amount per wallet.
3. The discount is fixed from then on, even if the invoice stays `PENDING_PAYMENT` for days or other invoices change the balance.
4. Crossing a threshold when this invoice is later paid never changes this invoice (PRD §18.6 example: 980 → Silver 3%, 100,000đ →
   97,000đ, 97 points, balance 1,077 = Gold from the **next** transaction).

## 6. Best-offer selection

### 6.1 Candidates (extends P4 §8.5 seam)

The single candidate function returns `{source, amount, explanation}`. Phase 5 adds `MEMBER_TIER` next to Phase 4's code-less
promotions and supplied vouchers. OP-3/OP-4/OP-5 apply unchanged to the Phase 4 sources.

### 6.2 Selection (PRD §16.1)

**Exactly one** ordinary winner: the largest customer benefit; no stacking of Member Discount with promotions or vouchers. Tie-break
(deterministic): amount descending → **the Member Discount before a promotion or voucher** (P5-T6, Owner decision of 2026-10-04: on an equal amount the customer keeps the voucher; this replaces
the earlier "promotion first" answer) → program `code` ascending (among programs only) → program id → voucher `code`. Staff see the winner and why (PRD §14.1,
§16.1); a customer is never given the weaker benefit because staff chose nothing. Only the winner is redeemed (unchanged from P4 §8.3).

Examples (PRD §16.1): Diamond 7% vs sale 15% on 500,000đ → sale wins, 425,000đ paid, 425 points; sale 5% vs Diamond 7% → Member wins.

### 6.3 Birthday layer (PRD §19, P5-T7)

Not an ordinary candidate and not part of OP-5. After the ordinary winner is chosen, the Birthday benefit applies **only if** its
configuration is active, the customer is eligible (section 8), and its configuration says it may combine with the winner's source
(`MEMBER_TIER`, ordinary promotion, voucher). **No rule means no stacking** (PRD §19). Order for a fixed monetary benefit:

`original eligible amount → ordinary winner → Birthday voucher → final eligible amount actually paid → points`

Example only (PRD §19): 500,000đ, Diamond 465,000đ, configured combinable 50,000đ → 415,000đ paid → 415 points. **50,000đ is an
example, never a default.** Free/gift benefits create no paid amount. Open sub-questions: OQ-8.

### 6.4 Calculation version (P5-T5)

`calculation_version = 2` adds the Member candidate and the Birthday layer. A DRAFT created under v1 is simply recalculated at
finalization with the version then in force and the stored version is overwritten; a **finalized** invoice keeps its version and is
never recomputed (P4 §7.3). While `go_live_at` is unset v2 produces exactly v1 results.

## 7. Referral

### 7.1 Facts (PRD §20; P5-Q4)

Customer phone is the identifier. The referrer is permanent: one referrer per referred customer, no ordinary flow can change it. A
customer can be both referred and a referrer (chain A → B → C); each link satisfies the conditions independently. The award is a fixed
**+10 Spa AND +10 Beauty** points, once per referred customer, independent of B's invoice value, never granted again for B's later
visits, never clawed back (PRD §20.3-20.4). The value is a versioned constant (`referral_award_version = 1`), not Owner-editable.

### 7.2 Binding

- Record `referrals`: unique `referred_user_id` (DB-enforced permanence; update/delete rejected by trigger), `referrer_user_id`,
  `bound_via` (`SIGNUP` / `COUNTER`), bound-by actor (counter), time.
- Referrer must be **another existing member** found by exact canonical phone; self-referral is impossible (PRD §20.2: "referred by another
  customer"). Loop and deactivated-account rules: OQ-6.
- **B must still be new** (P5-Q4): at binding, B has no completed visit, **or** B's only completed visit is B's first and its invoice is
  not yet `PAID` (P5-T10: a Visit completes before its invoice exists, so the counter must be able to bind during that window; the window
  closes at the first `PAID` episode).
- Signup: an optional referrer phone on the registration intent (new field, P5-5); resolved at registration completion.
- Counter: staff enter the referrer phone for an **existing member B** they identified; guests cannot be bound (no account to hold the
  link; a guest who later registers is no longer new anyway). Needs its own permission and an audit event.
- Replaying the same binding returns it; a different referrer is refused, never overwritten.

### 7.3 Phone privacy (no oracle)

- Public signup: the referrer phone is accepted if well-formed and resolved **silently** later; the response is identical whether or
  not the phone belongs to a member, so signup cannot be used to test which phones are members. Throttling reuses the existing auth
  throttle buckets. (Trade-off: OQ-7.)
- Counter: staff, being authorized, get an exact-match lookup with a **masked** result (same pattern as the P4 payer lookup), no listing,
  no enumeration. The UI exposes only what is necessary (PRD §20.1).

### 7.4 "Brand-new" test (P5-Q4) and the canonical phone

B is new iff the canonical phone of B has **no COMPLETED visit** in which B received a service: a visit participant with `customer_user_id = B`, or a participant
(member or guest) whose phone normalizes to B's canonical phone, in both cases with a DONE service line. **Owning or paying for a visit without receiving
a service does not count** (Owner decision, 2.5; this replaces the earlier wording that counted a visit owner). Because
`visit_participants.phone` is free text, historical rows must be normalized with the same canonicalizer and `normalization_version`
as `users.phone_canonical` (a generated/indexed canonical column, P5-5; rows that cannot be normalized never match). Visits before
go-live count as visits (a customer who came before is not new).

### 7.5 Award

Trigger: `INVOICE_PAID(invoice, paid_seq)` where, on re-read under lock: the episode is current (stale guard), `settlement = PAYMENT`
(OQ-4), the invoice's Visit is **B's first completed visit** (earliest `completed_at`, ties by id) with B as a qualifying participant
(OQ-5), and B's referral is not yet awarded. Then in one transaction, with the wallets locked in a fixed order: write
`REFERRAL_AWARD` +10 to A's **Spa** wallet and +10 to A's **Beauty** wallet (two independent entries) and mark the referral awarded
(`awarded_invoice_id`, `paid_seq`). Not reversed by `INVOICE_REOPENED` / `INVOICE_CANCELLED` / `PAYMENT_REVERSED`; if the same invoice is
paid again the unique referral key prevents a second award. The purchase points of B's invoice follow section 4 and can be reversed.

### 7.6 As built in P5-5 (Owner decisions of 2026-10-04 supersede the wording above where they differ)

- "Permanent" (7.1, 7.2) now means: fixed for staff and customers; **only the Owner** (`CHANGE_REFERRER`) may change the referrer, **before the reward**, with a reason and an append-only history (`referral_changes`); after the reward it is locked by the database.
- Binding is allowed while go-live is OFF (the DB guard moved to the award stamp, which needs go-live ON and a payment at or after it). The award needs real money (`settlement = PAYMENT`, total above 0), the referral bound before that payment, and the invoice's visit being the referred customer's first completed visit; the referred customer is a participant of that visit (by account or by canonical phone), anyone may pay.
- Mutual referral and a locked referrer need no rule (a customer account is always ACTIVE in the data model, and no code reads the referrer's status).

## 8. Birthday rewards (PRD §19, P5-Q6)

- **Ships empty:** no configuration exists at deploy; no preset gift, value, window or limit. Without an active configuration no
  Birthday benefit exists.
- Owner-configured fields: type, value, eligibility, Spa/Beauty scope, validity/conditions (optional minimum spend, tested per OP-4),
  permitted combinations (section 6.3), **date window** (P5-Q6), and a **usage limit that must be chosen explicitly** (a number or
  an explicit "unlimited"; there is no silent default, PRD §19 "do not invent a usage limit").
- Window: days before/after the customer's birthday, evaluated on the invoice `business_date` (branch timezone, CLAUDE.md) against
  `customer_profiles.date_of_birth`. Details of 29 February and whose birthday: OQ-8.
- Configurations are **versioned** like discount versions; the invoice snapshot stores the version and result so later edits change
  only future behavior (PRD §14.2, §19, Scenario F).
- Usage is a redemption row written at finalization and released append-only when the invoice is cancelled (same pattern and
  guarantees as P4 §8.3). A guest payer has no birthday benefit.
- Birthday never multiplies points (PRD §19).

### 8.1 As built in P5-6 (Owner decisions of 2026-10-04 and 2026-10-05 on OQ-8 in 2.5)

- **Configuration:** one configuration row (singleton) and append-only **versions** (the highest `version_no` is current). A version holds: active flag, kind
  `PERCENT` (basis points) or `FIXED_AMOUNT` (integer VND), minimum spend, `window_days_before` / `window_days_after`, three combine switches (member discount,
  automatic promotion, voucher; no rule means no stacking, 6.3) and the usage limit as N per birthday year or an explicit `unlimited`. No column has a default; the API refuses
  a save without every field, the usage limit included, and the screen offers no preselected usage option. Edit, activate and deactivate are all new versions.
  Nothing is inserted by the migration. `MANAGE_BIRTHDAY_REWARDS` is **Owner only** (Owner's P5-6 instruction): SQL refuses to attach it to a role or an override.
- **Whose birthday, the window (Owner):** the PAYER's, from `customer_profiles.date_of_birth`, on the invoice `business_date` (branch timezone), from `birthday - before` to
  `birthday + after`, inclusive. 29 February is 28 February in a non-leap year. `before + after <= 364` (**mine**, a technical bound so one date belongs to one birthday).
  A guest payer has no gift. Money gifts only (free service and item gifts: P5-9).
- **The layer (6.3, Owner decisions of 2026-10-04 and 2026-10-05):** after `evaluateDiscounts` picks the single ordinary winner W (amount `a`) on the eligible subtotal `S`:
  a percentage rounds half up and a fixed amount is capped by its base. If the configuration allows W's source the gift is **stacked** (`discount = a + gift`) and its base is the amount left
  after the offer (`S - a`). With no W it stands **alone** on `S`. Otherwise the gift and W are **both calculated on the original `S` and the larger discount wins**: the gift replaces W only
  when strictly larger (then W is not applied or redeemed, the member amount is 0 and the winner is `BIRTHDAY`); on a tie W stays and the gift is not used. Example: 100,000 with a 60,000
  offer against a fixed 80,000 gift that may not combine: the gift wins, 20,000 is paid. "Per year" is the **birthday occurrence** the invoice date belongs to (a window that crosses New Year is
  one birthday, so one use), counted per customer across all versions. The 364-day bound on days before + after is approved.
- **Invoice and DB:** `calculation_version` stays 2. The loyalty snapshot gets `birthday_amount_vnd` and `birthday_base_vnd` (and the existing `birthday_config_version` /
  `birthday_result`); winner `BIRTHDAY` means the gift is the only benefit. `lucy_check_invoice_discount` now reads discount = ordinary part + birthday amount. A
  `birthday_redemptions` row (one per invoice) is the usage ledger (migration `20261031000001` makes the guard re-verify the base: the whole eligible total for `BIRTHDAY`, eligible minus the ordinary part for a stacked gift whose source the version allows), `birthday_redemption_releases` returns the use when the invoice is cancelled (same causes as discount
  redemptions). SQL guards re-verify payer, go-live, current active version, the window (`lucy_birthday_occurrence`), minimum spend, amount and the usage limit under the
  configuration row lock. The TypeScript twin `birthdayOccurrence` is parity-tested against the SQL function.
- **Locks (12.2 extension):** invoice → discount program rows → **the birthday configuration row** (only when the payer has a birthday window now) → the payer's user row →
  wallets. A configuration save takes the same row, so saves and finalizations serialize.
- **Only when go-live is ON, finalized invoices never recalculated, points never doubled:** with go-live OFF no context loads; a DRAFT previews and finalization freezes the
  result in the snapshot; points are `floor(total / 1000)` of the total after the gift.

## 9. Combos

### 9.1 Definition (PRD §17.1-17.3)

Owner-configured: name, one **service**, paid sessions, bonus sessions, price, active flag, expiry mode (default and only Lucy Spa
mode: **no expiry**; the mode is stored so a future package can differ). Not hard-coded to 5+1 / 10+2. A combo's sessions can only be
consumed for its own service. Definitions are versioned; purchases snapshot name, service, session counts and price.

### 9.2 Sale (P5-Q8, OQ-1)

- Sold **only at the POS counter** and **only to an identified member payer** (the owner of the combo). No online purchase, no guest
  purchase. Needs a sale permission (section 13).
- The purchase is an invoice line (`COMBO_PURCHASE`), paid through the normal cash/PayOS flow. Standalone counter-sale invoices:
  OQ-1.
- **Member Discount and best-offer apply** to the combo line like any eligible line (PRD §17.7, bonus sessions do not disqualify it);
  whether ordinary promotions can target combos: OQ-9.
- **Points are earned once**, on the amount actually paid after discounts, in the Spa wallet at the paid episode, using the tier from
  before this purchase (PRD §17.7, Scenario O). 1,000,000đ at Diamond 7% = 930,000đ = 930 points.
- **Consumption earns 0 points**, including bonus sessions. An extra service bought during a combo visit is a normal eligible line
  earning on its own paid amount (PRD §17.8).

### 9.3 Ownership and issuance

- On the purchase's paid episode (consumer key `COMBO_ISSUE:{invoice_line_id}:{paid_seq}`) one **session row per session** is issued to
  the owner, each marked `PAID` or `BONUS` (P5-T11). Sessions are not usable before issuance (OQ-9).
- If the paid episode is reopened/voided: sessions not yet consumed are voided; consumed ones remain history; handling in OQ-9.

### 9.6 As built in P5-7 (combo sale; answers of 2026-10-05 collected through the question tool, **pending Owner confirmation in own words**)

- Invoice `kind` `VISIT` / `COMBO_SALE`; `visit_id` NULL exactly for `COMBO_SALE`; one `COMBO_PURCHASE` line (quantity 1, price = the combo price, never edited) with a detail row `invoice_line_combos` copying the current active combo version and the service category. Every Phase 4 rule is unchanged for `VISIT`.
- **Go-live OFF: no sale** (API `LOYALTY_NOT_LIVE`, DB refuses the invoice insert).
- Sale needs `SELL_COMBOS` and `MANAGE_INVOICES` at the branch, an active member buyer (fixed, becomes the owner). Finalization needs the combo to be unchanged in price/sessions and active (`COMBO_CHANGED`).
- **Best offer applies to the combo line** like its service (promotions, vouchers, Member Discount; tier read before the sale). **The birthday gift never applies** to a combo sale.
- Issued by the `loyalty` worker on `INVOICE_PAID` for the current paid episode only; the issued combo copies the sold line, not the live definition. Points earned once; a combo sale never triggers the referral reward (not a visit).
- **Reopen/cancel before use: the unused combo is revoked** (who ended the episode, reason, history kept); re-pay issues a new one. With a session in use it is not revoked automatically (audit trail only; P5-8 decides). OQ-9 (any branch, consume order, reversal after use) stays open for P5-8.

### 9.4 Consumption (PRD §17.4-17.6, P5-T11)

- Staff look up the owner by **exact** phone (masked result, as above), choose the session's service match, and record
  `OWNER` or `RELATIVE`, the relationship marker where appropriate, service recipient, KTV, the employee performing the action, and
  time. A relative uses the owner's phone only to let staff find the owner; no other account is exposed.
- The consumed service appears on the invoice as a **0đ line with a snapshot flag `free_entitlement`/`session_kind`**, so Phase 7
  tour and commission never pay on it (PRD §17.6) and can still distinguish `PAID` from `BONUS` (OQ-9).
- The session is **redeemed at invoice finalization** (one redemption per invoice line, unique) and **released append-only** when
  that invoice is cancelled (including OP-7); never deleted or edited, never released twice.
- Consumption earns no points and does not change tier or discount.

### 9.5 Restoration (PRD §17.5)

Ordinary staff cannot delete or edit consumption history. An authorized Owner/manager creates a **restoration record** linked to the
consumption, with reason, actor and time (re-authentication, like Phase 4 corrections), unique per consumption. Service/combo refunds
do not exist (PRD §29).

## 10. Gift / benefit catalog and entitlements (P5-Q7; PRD §21; built in P5-9)

An **empty framework**: no catalog item exists at deploy (the final catalog is TBD, PRD §61).

- **Catalog item:** type (`FREE_SERVICE`, `VOUCHER`, `PRODUCT_GIFT`, `OTHER`), name vi/en, active flag, optional expiry rule.
- **Entitlement:** type, quantity, owner/customer, issued source/campaign, issued date, expiry if configured, redemption history, status.
- Separate domain from points, combos and Phase 4 vouchers (PRD §21): a free service is never added to a points balance, redemption
  never deducts points, and **no point-priced reward program** is created from this catalog (PRD §21).
- Redemptions are append-only with releases, like combos. Free entitlements generate **no tour** and earn **no points** (PRD §17.6).
- A `PRODUCT_GIFT` item is descriptive only; stock handling is Phase 6.
- Depth of P5-9 (issuance and POS redemption flows): OQ-10. Birthday `FREE_SERVICE` / `GIFT` types arrive only after P5-9.

## 11. Events and idempotency keys

### 11.1 Consumed (from Phase 4, P4 §15.1)

`INVOICE_PAID(invoice, paid_seq, settlement)`, `INVOICE_REOPENED(paid_seq)`, `INVOICE_CANCELLED(voidedPaidSeq)` are read by the
`loyalty` consumer through `outbox_consumptions` (`UNIQUE(event_id, 'loyalty')`), never through `published_at`. `PAYMENT_REVERSED` is not
consumed (4.4). A consumer outcome is stored (`APPLIED`, `SKIPPED_GUEST`, `SKIPPED_PRE_GO_LIVE`, `SKIPPED_STALE`, `NOOP`).
`INVOICE_FINALIZED` is not consumed: redemptions and the snapshot are written by the finalizing command itself.

### 11.2 Emitted (new aggregates; ids and minimal facts only, no personal data)

`LOYALTY_POINTS_EARNED`, `LOYALTY_POINTS_REVERSED`, `LOYALTY_POINTS_ADJUSTED`, `LOYALTY_SHORTFALL_FLAGGED`, `REFERRAL_BOUND`,
`REFERRAL_AWARDED`, `COMBO_ISSUED`, `COMBO_SESSION_CONSUMED`, `COMBO_SESSION_RELEASED`, `COMBO_SESSION_RESTORED`, `REWARD_ISSUED`,
`REWARD_REDEEMED`. No Phase 5 consumer sends anything to customers (P5-Q9); later Phase 7 consumers (tour, commission) will read the combo events.

### 11.3 Idempotency keys

| Operation                  | Mechanism                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Earn                       | Ledger `idempotency_key = SPA_EARN:{invoice_id}:{paid_seq}` unique; replay returns the stored entry                                                          |
| Earn reversal              | `reverses_entry_id` unique (one reversal per earn entry); replay returns the same result                                                                     |
| Referral bind              | `referred_user_id` unique; same referrer replays, different referrer refused                                                                                 |
| Referral award             | `referrals.awarded_at` set once plus keys `REFERRAL_AWARD:{referral_id}:SPA` and `:BEAUTY`; replay or re-pay creates nothing                                 |
| Manual adjustment          | Client UUID unique per actor; a correction of an earlier entry also has `corrects_entry_id` unique, so the same effect cannot be corrected twice (PRD §18.4) |
| Combo issuance             | `COMBO_ISSUE:{invoice_line_id}:{paid_seq}` unique                                                                                                            |
| Combo redemption / release | One redemption per invoice line; one release per redemption; guarded by invoice state + `row_version` (as P4 §13)                                            |
| Combo restoration          | Unique per consumption                                                                                                                                       |
| Birthday / reward use      | One redemption per invoice; one release per redemption                                                                                                       |
| Consumer processing        | `UNIQUE(event_id, consumer)`; every effect also has the natural key above                                                                                    |

## 12. Locking, snapshot and consistency

### 12.1 Synchronous versus asynchronous

| Synchronous (in the invoice command, atomic with finalize/cancel) | Asynchronous (`loyalty` consumer, after commit) |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| Tier read and snapshot; Member/Birthday candidates                | `EARN` and `EARN_REVERSAL`                      |
| Birthday, combo-session and reward redemption and release         | Referral award                                  |
| Counter referral binding, manual adjustments (own transaction)    | Combo session issuance and voiding              |

### 12.2 Lock order (P5-T12; extends P4 §14, never inverts it)

graph lock (shared) → `users` rows sorted by UUID → actor session → `visits` row → `invoices` row → `discounts` rows sorted by id →
**the payer's `users` row (key-share, taken by the finalization tier read BEFORE the wallet; P5-4 precaution: a manual adjustment holds the customer row and then wants the wallet,
and the tier snapshot inserted next needs the same row through its foreign key. This is a reasoned ordering: the race against the real adjustment command passed with and without it, so
the deadlock was not reproduced)** → **`loyalty_wallets` rows sorted by (user id, wallet), shared for the finalization tier read, exclusive for ledger writes** →
**combo/reward rows sorted by id** → `payments`. The `loyalty` consumer follows the same order: event claim (`FOR UPDATE SKIP LOCKED`) →
`invoices` row → wallets sorted → ledger insert and `outbox_consumptions` row in one transaction. A lock that cannot be taken
immediately maps to the existing retryable conflict (`55P03`, `40P01`, `40001`, `23505`). Wallet rows are created with
`INSERT … ON CONFLICT DO NOTHING` then locked. Timestamps come from the DB clock (`clock_timestamp()`).

### 12.3 Consequence of asynchronous earning (P5-T1)

The next invoice of the same payer can be finalized before the previous award is processed, in which case its tier snapshot uses the
balance at that moment (a few seconds under a healthy worker; longer if the worker is down). Points are delayed, never lost, and the
snapshot records the exact balance used, so the result is auditable and never rewritten. The alternative (award synchronously in the
payment transaction) removes the lag but couples every payment path (cash, PayOS webhook, zero balance, reversal, OP-7) to loyalty;
it is not proposed.

## 13. Authorization (P5-T13; proposed names, none seeded, never role names, scope enforced server-side)

| Permission (proposed)     | Allows                                                             | Notes                                                   |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `VIEW_LOYALTY`            | Read a customer's wallets, ledger, referral, combos for staff work | Branch scope as for invoices                            |
| `ADJUST_LOYALTY_POINTS`   | Manual +/- points with wallet, amount, reason (PRD §18.4)          | `GLOBAL_ONLY`, `FINANCIAL`, fresh re-authentication     |
| `MANAGE_REFERRALS`        | Bind a referrer at the counter                                     | Audited; masked lookup                                  |
| `MANAGE_COMBOS`           | Combo definitions                                                  | `GLOBAL_ONLY`                                           |
| `SELL_COMBOS`             | Add a combo purchase to an invoice                                 | Needs `MANAGE_INVOICES` too                             |
| `CONSUME_COMBO_SESSIONS`  | Record session use, owner/relative                                 | Branch scope                                            |
| `RESTORE_COMBO_SESSIONS`  | Restoration with reason                                            | `GLOBAL_ONLY`, `FINANCIAL`, re-authentication           |
| `MANAGE_BIRTHDAY_REWARDS` | Birthday configuration and window                                  | `GLOBAL_ONLY`, **Owner only** (P5-6, Owner instruction) |
| `MANAGE_REWARD_CATALOG`   | Catalog items                                                      | `GLOBAL_ONLY`                                           |
| `ISSUE_REWARDS`           | Issue/void an entitlement with reason                              | Audited                                                 |
| `VIEW_LOYALTY_EXCEPTIONS` | See shortfall and combo exceptions                                 | Owner-level                                             |
| `CHANGE_REFERRER`         | Change a customer's referrer before the reward (P5-5)              | `GLOBAL_ONLY`, Owner only, fresh re-authentication      |

Activating go-live (P5-T2) is `GLOBAL_ONLY` and re-authenticated. Customers read only their own data, identity from the session
(NOT_FOUND for anything else), exactly as in P4 §10.

## 14. Audit

Audited with actor, time and reason where applicable: manual adjustments, shortfall flags, referral binding (counter) and any refused
change attempt, go-live activation, combo definition changes, combo restoration, Birthday and catalog configuration changes, reward
issuance/void. Audit events never contain a full phone number (masked) or a password.

## 15. Customer account page (P5-Q9, built in P5-10)

On the customer's own account page only (VI/EN, existing UI kit rules, DataTable + Pagination for lists over 20 rows): Spa and Beauty
balances and tiers, distance to the next tier, ledger history (earn, reversal, referral, adjustment), the referrer relationship
(masked), combos with remaining sessions and their usage history, entitlements, Birthday benefit status. **No SMS, Zalo or email; no
push**, and no other notification is created for any Phase 5 event. Shortfall flags and internal reasons are never shown to customers
(OQ-11).

## 16. Execution sequence (restored by the Owner, 2026-10-04)

| Step  | Content                                                                              |
| ----- | ------------------------------------------------------------------------------------ |
| P5-1  | Design contract (done)                                                               |
| P5-2  | DB + permissions foundation                                                          |
| P5-3  | Points & tiers: earn on paid, reverse on reversal, manual adjustment with reason     |
| P5-4  | Member discount at POS: best-offer selection, reason shown, tier snapshot on invoice |
| P5-5  | Referral                                                                             |
| P5-6  | Birthday gift config                                                                 |
| P5-7  | Combo sale                                                                           |
| P5-8  | Combo usage                                                                          |
| P5-9  | Gift catalog framework                                                               |
| P5-10 | Customer page + admin points screens                                                 |
| P5-11 | Final check, no deploy                                                               |

Placement notes (implementation level, no decision changed): P5-2 creates only the new loyalty/referral/combo/reward tables, the go-live
table and the permissions. The invoice changes of OQ-1 (an invoice `kind`, `visit_id` NULL only for `COMBO_SALE`, the `COMBO_PURCHASE` line kind,
the matching guard/integrity changes) touch the live Phase 4 guards and are made in **P5-7** with the combo sale that needs them. The
Member candidate and its `InvoiceDiscountApplication` extension are made in **P5-4**; the referrer field on `registration_intents` and the canonical
participant phone index in **P5-5**; the Birthday configuration tables in **P5-6**.

Each Step: targeted tests, its own report, Owner review (CLAUDE.md). Phase 5 testing must include real-concurrency races
(simultaneous finalization of two invoices of one payer, concurrent reversal and re-pay, concurrent referral awards, double-consumption
of one session) as in P4 §20, plus replay tests for every key in 11.3.

## 17. Out of scope (Phase 6 and later)

- **Phase 6:** product lines, stock, Beauty earning from purchases, mixed Spa/Beauty allocation of shared discounts and payments,
  product-fault exchange and refund point effects (PRD §28.5-28.6), the `REFUNDED` invoice state, cosmetic campaigns (PRD §22),
  Promotion/Campaign Management (PRD §24.1), employee seller attribution.
- **Phase 7:** tips, tour and commission computation on top of the Phase 5 flags, cash register, payroll.
- **Phase 8:** loyalty dashboards, reports and exports.
- **Never or Owner-gated:** point spending, point-priced rewards, point expiry, point transfer or cash-out, service/combo refunds
  (PRD §18.2-18.3, §29), SMS/Zalo/email notifications (P5-Q9), backfill of pre-go-live invoices (P5-Q1).
- PRD §61 items not resolved here stay unresolved: fractional/carry handling beyond P5-Q3, valuation of unlike promotional benefits,
  already-consumed campaign benefits (OQ-8, OQ-9), the final reward catalog.

## 18. Verification of this document

- Every rule is labelled by source (header table). PRD sections read for this Step: 14.1-14.3, 16, 16.1, 17.1-17.8, 18-18.6, 19, 20-20.4,
  21, 29, 56 (Phase 5/6), 60-61 and Scenarios D, F, G, O; Phase 4 design sections 2, 5.3, 7, 8, 10, 13-15, 21.
- Repository facts in section 1 were checked in `packages/database/prisma/schema.prisma`.
- No code, schema, migration, permission seed or UI is changed by P5-1; the only other edit is the Phase 5 status in `LUCYSPA_HANDOFF.md`.
- Conflicts found and resolved in writing: P5-Q1 vs P4 §15.2 history read (4.2); `PAYMENT_REVERSED` vs `INVOICE_REOPENED` as reversal key
  (4.4); Member Discount absent from the Phase 4 tie-break (6.2); Birthday vs OP-5 (6.3); P4 Q3 half-up vs P5-Q3 floor (4.3); Visit-bound
  invoices vs counter combo sale (OQ-1); free-text participant phones vs P5-Q4 (7.4); P5-Q5 flag vs P5-Q9 no notifications (OQ-3).
