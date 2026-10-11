# Phase 7: Payroll, tips, commission and shop funds (sổ quỹ) — design contract

Status: **P7-1 design, APPROVED by the Owner on 2026-10-11 with the changes of section 14** (his answers are recorded there verbatim).
Sections 8, 9 and 12 read as approved; where section 14 differs, section 14 wins (referral code `P7-T16`, tips paid with payroll, go-live as
a setting with no default date, "safer option" rule). Production state is whatever `LUCYSPA_HANDOFF.md` records (`ac74013`, 108 migrations, 68 permissions).

| Label     | Meaning                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| `PRD §n`  | Written in `LUCY_SPA_PRD.md` (sections 7, 9.1, 17.6, 25, 26, 32-36, 49, 61, Phase 7 deliverables)                  |
| `P4/P6 §` | Locked earlier contract, reused unchanged (`PHASE4_POS_INVOICE_PAYMENTS_DESIGN.md`, `PHASE6_PRODUCTS_INVENTORY_…`) |
| `P7-Tn`   | **Proposed technical decision**, needs Owner approval before the Step that builds it                               |
| `OQ-n`    | **Open question** (continues after OQ-103). Section 12 is the Owner questionnaire; every question has a default    |

## 1. Scope, non-goals

**In scope (PRD Phase 7 deliverables):** tour (service) earnings, product commission, tips, payroll, cash safe, daily closing; plus the
two things the Owner asked for in the brief: salary advances and bonuses/deductions as payroll items.

**Non-goals (not Phase 7):** reports, dashboards, Excel/PDF export (Phase 8; Phase 7 gives screens and print-friendly payslips only);
tax/BHXH/PIT calculation (nothing in the PRD; payroll here is the **spa-paid gross payroll** of PRD §34, no statutory deductions are
invented); **automatic attendance-based deductions** (PRD §61 TBD: attendance is shown on the preview, never turned into money);
bank-statement import; online payroll payment or bank transfer through an API (**nothing is auto-paid**, "paid" is a manual record);
inter-branch cash transfers; rewriting any Phase 4-6 money flow.

**Rules that bind every Step:** money is integer VND (BigInt); timestamps UTC, business dates in the branch timezone (`Branch.timezone`);
authorization is permission + branch scope, never role names; financial history is never deleted or edited, a correction is a new
record that points at the old one; every write is audited (`DataClassification` already has `EMPLOYEE_PAY` and `FINANCIAL`); amounts that
PRD §61 leaves TBD (tour amounts, commission rates, salaries) **ship empty** as Owner-entered, effective-dated rows, like birthday rewards.

## 2. What exists today (read in the repository, not assumed)

| Need                | Exists                                                                                                                                                                                                                                                                  | Gap Phase 7 fills                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Staff               | `User` + `EmployeeProfile` (`baseSalaryVnd`, **current value only**); `EmploymentClassificationChange` (effective-dated: TRAINEE / COLLABORATOR / OFFICIAL_EMPLOYEE / ENDED); `EmployeeBranchAssignment`; `payrollEligible()` = OFFICIAL_EMPLOYEE only                  | Salary **history**; who earns tour / commission / tips (7 below)                     |
| Attendance / shifts | `AttendanceRecord` (check-in/out per employee, branch, business date); `LeaveRequest` (approved days). **No shift or schedule table for official staff**; only `CollaboratorWorkOccurrence` (CTV) has schedule + `agreedPayVnd`                                         | Nothing new: attendance and leave are **shown** on the payroll preview, never priced |
| CTV pay             | `CollaboratorWorkOccurrence.agreedPayVnd` (nullable = not agreed yet), branch-local `workDate`, `SCHEDULED`/`CANCELLED`, history guard trigger. PRD §9.1/§34: payroll **references** it, never copies it                                                                | Immutable reference from a closed run (P7-T3)                                        |
| Services performed  | `VisitServiceLine` (KTV, service, snapshots), `ServiceExecution` (START/END), `InvoiceLineService.employeeUserId` (the KTV on the invoice line, 1:1 per performed service)                                                                                              | Tour earning rows                                                                    |
| Invoices / payments | `Invoice` (`PAID`, `paid_seq` = paid episode, `paid_at`, `business_date`, `branchId`); `Payment` (CASH/PAYOS, `amountVnd` credited, `tenderedVnd`, `changeVnd`, `collectedBy`, `businessDate`); `PaymentCorrection` (cash REVERSAL → invoice back to `PENDING_PAYMENT`) | Fund entries fed from them; earnings keyed by `paid_seq`                             |
| Product sales       | `InvoiceLineProduct.sellerUserId` (required at the counter, **NULL on online lines**, W4-2), brand/category/product snapshots; `InvoiceLineAllocation` (per line `grossVnd`, `discountShareVnd`, `netVnd` per Spa/Beauty side)                                          | Commission rules + earning rows; seller correction (OQ-P6-25 left it to Phase 7)     |
| Money out           | `ProductRefund` (method CASH / BANK_TRANSFER_MANUAL, fresh re-auth via `RefundReauthenticationUse`); `ProductExchange` (difference handed back); `OnlineFailedDeliverySettlement` (refund + carrier fees); P6 deferred "cash drawer link of refunds" to here            | Cash/bank book entries for each                                                      |
| Combos              | `ComboSession.kind` keeps **paid and bonus sessions apart** (P5-T11, "for future tour rules"); `InvoiceLineComboUsage`                                                                                                                                                  | Rule: bonus = no tour (PRD §17.6); paid = OQ-104                                     |
| Permissions         | `VIEW_EMPLOYEE_PAY`, `MANAGE_EMPLOYEE_PAY`, `VIEW_REVENUE`, `COLLECT_PAYMENTS`, `CORRECT_PAYMENTS`, `VIEW_ATTENDANCE`… (68 codes). **`MANAGE_CASH` is in the PRD (§35.3) but not in the enum**                                                                          | Section 9                                                                            |
| Infrastructure      | Outbox (`outbox_events`, `outbox_consumptions` `UNIQUE(event, consumer)`), idempotent consumers (loyalty is the pattern), `AuditEvent`, `clientRequestId` idempotency, password re-authentication for refunds, `AppSetting`, My Income read model                       | New consumers `cash` and `compensation`                                              |
| My Income           | `my-income.service.ts` already lists `SERVICE_TOUR`, `COMMISSION`, `TIPS`, `ADJUSTMENTS` as **"not yet available, never zero"**                                                                                                                                         | Feed them as each source lands (P7-11); the "never zero before go-live" rule stays   |
| Not existing        | No tip, tour, commission, payroll, advance, fund, safe or closing table; `Payment.tendered ≥ amount` CHECK has no room for a tip (P4 §4.5 planned an additive relaxation)                                                                                               | Everything in sections 3-8                                                           |

## 3. Design gaps the current schema creates (each one is solved in section 4-8)

1. **Salary has no history.** `baseSalaryVnd` is a single number; a raise on the 1st would silently change last month's run → `P7-T1`.
2. **A closed run must be immutable but PRD says payroll references CTV occurrences and never copies their amount** → `P7-T3`.
3. **Earnings must be stored** (PRD §26/§33: history keeps its value). They are born at `PAID` per `paid_seq` and are reversed by new rows → `P7-T4`.
4. **Tour eligibility:** bonus combo sessions, rewards and gifts earn none (PRD §17.6); paid combo sessions are a policy question → `OQ-104`.
5. **Product commission** base, refund reversal, online lines with no seller, and seller correction after finalization → `P7-T6`, `OQ-105`, `OQ-106`.
6. **Tips** cannot ride on a `Payment` (PayOS amount must equal the invoice; tips earn no points and are not revenue) → `P7-T7`.
7. **Who is eligible** (official / CTV / trainee): `payrollEligible()` covers base salary only → `OQ-107`.
8. **The book has many sources**, easy to miss one → section 7.2 lists them all.
9. **Fresh password** for payroll close, mark-paid, cash withdrawal, advances, opening balance → `P7-T12`.

## 4. Staff pay

### 4.1 Components

| Component               | Source of truth                                                                                  | Notes                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Base salary (official)  | `employee_salary_versions` (new, effective-dated)                                                | Monthly amount as configured, never prorated automatically (PRD §34.1, `OQ-109`)                                             |
| CTV pay                 | `CollaboratorWorkOccurrence.agreedPayVnd`, `SCHEDULED`, by branch-local `workDate` in the period | Referenced by id, not copied; occurrences with no agreed pay are listed as **missing**, block nothing, never counted as zero |
| Tour (per paid service) | `pay_earnings` kind `TOUR`                                                                       | Fixed amount per service per effective-dated rule (PRD §33). No percentage-of-price service commission                       |
| Product commission      | `pay_earnings` kind `PRODUCT_COMMISSION`                                                         | PRD §26                                                                                                                      |
| Bonus                   | Manual run item, with reason                                                                     | Positive                                                                                                                     |
| Adjustment (±)          | Manual run item, with reason                                                                     | Includes mid-month proration, corrections of closed periods                                                                  |
| Deduction               | Manual run item, with reason                                                                     | **Manual only.** No attendance- or cash-difference-driven deduction (PRD §61, `OQ-112`)                                      |
| Advance recovery        | `salary_advances` (4.4)                                                                          | Suggested by the draft, editable, never makes net pay negative                                                               |
| **Tips (separate)**     | `tips` (section 6)                                                                               | Shown as `Tip khách hàng`, **not part of spa-paid payroll** (PRD §32/§34)                                                    |

`Base + Tour + Product commission + CTV pay + Bonus ± Adjustments − Deductions − Advance recovery = Spa-paid payroll`; tips are a
separate line below it.

### 4.2 Rules that ship empty

`tour_rules` (service, amount VND, effective from / to, active; append-only versions), `commission_rules` (scope, kind, value, effective
dates; append-only versions), salaries (history rows). **No default amount exists.** With no rule the earning is **not created** and the
service/product line appears on the "no rule" list for the Owner (nothing is guessed, nothing is zero-filled).

- **Tour rule resolution:** the rule version in force on the invoice `business_date` of the paid episode, for the line's `serviceId`.
- **Commission rule resolution** (PRD §26: percentage or fixed, by brand / category / product / employee, effective-dated), most specific
  first: employee+product, product, employee+category, category, employee+brand, brand, employee default, shop default. `PERCENT` is stored
  in basis points and rounds half up to 1 VND (P4 Q3); `FIXED` is VND per unit sold. A database constraint forbids two active rules of the
  same scope overlapping in time, so resolution is never ambiguous.
- **Snapshot:** the earning row stores rule version id, the base amount used and the result. Changing a rule never touches existing rows.

### 4.3 Monthly payroll run

One run per calendar month for the whole shop (cost lines carry the branch). States follow PRD §49: `DRAFT → CLOSED → PAID`.

1. **Generate / refresh draft** (`MANAGE_PAYROLL`): for every person who has anything in the period, creates a `pay_run_lines` row with
   itemised `pay_run_items`: base salary (OFFICIAL on the last day of the month, salary version in force on that day), CTV occurrences
   (references), unclaimed earnings with business date ≤ period end (**includes late items from earlier periods**, marked "late"), suggested
   advance recoveries. Refresh is allowed only while `DRAFT` and rebuilds only generated items; manual items survive.
2. **Preview** is the same screen: totals per person and per branch, the "no rule", "CTV pay not agreed", "negative net" and "cash
   differences of the month" warnings, and read-only attendance / leave context. Preview writes nothing; draft refresh writes the draft.
3. **Owner approval** = `CLOSE` (`APPROVE_PAYROLL` + fresh password): freezes the run (`P7-T3`), creates the payslips, nobody is paid.
4. **Mark paid** per person or whole run (`APPROVE_PAYROLL` + fresh password, `PAID`): records how it was paid (cash / bank) and writes the
   matching **fund outflow** in the same transaction (section 7). A person's payslip can be paid separately, so `PAID` on the run means all
   payslips are paid.
5. **Payslip** (per person, per run): items grouped as above, tips shown separately, net amount, prints cleanly; PDF/Excel export is Phase 8.
   The employee sees only their own (reuses My Income's own-data rule, no permission needed for self).

A closed run is never edited. A later correction is a signed **adjustment item in the next run** (PRD §34 "corrections use authorized
adjustments"). Backward transitions do not exist; a mistaken `PAID` is corrected by an explicit reversal record plus an adjustment, not by
reopening.

### 4.4 Salary advances (not in the PRD; designed because the Owner asked, limits are `OQ-110`)

`salary_advances`: employee, amount, requested/approved/paid timestamps and actors, reason, `status` `REQUESTED → APPROVED → PAID →
RECOVERED | WRITTEN_OFF` (append-only events, never deleted). Paying the advance writes a fund outflow (`ADVANCE`). Recoveries are
`pay_run_items` of kind `ADVANCE_RECOVERY` that reduce `outstanding`; a recovery is limited to the net pay available (the rest stays
outstanding for the next run). **Write-off** needs the Owner's permission, a reason and a fresh password. An advance never creates a
negative payslip and never auto-pays.

## 5. Earnings (tour and product commission)

### 5.1 Born at `PAID`, keyed by episode

A `compensation` outbox consumer (loyalty pattern: idempotent, `UNIQUE(consumer, event)`, skips episodes before the go-live date and
stale episodes) creates earnings when an invoice becomes `PAID`, keyed `UNIQUE(kind, source line, paid_seq, leg)`:

- **TOUR:** one row per `InvoiceLineService` of the paid episode, employee = `InvoiceLineService.employeeUserId`, if the line is an
  ordinary paid service line and a rule exists. A service consumed from a **bonus** combo session, a reward or a gift: no row (PRD §17.6).
  A service consumed from a **paid** combo session: `OQ-104`.
- **PRODUCT_COMMISSION:** one row per `InvoiceLineProduct` with a seller, base = the line's `InvoiceLineAllocation.netVnd` (after
  discounts; excludes shipping fee) per `OQ-105`. Online lines (seller NULL): none (`OQ-106`).

### 5.2 Reversal, never edit

- Cash `PaymentCorrection` (invoice back to `PENDING_PAYMENT`) or an OP-7 zero-balance cancellation: the consumer appends **reversal rows**
  (negative, `reverses_id`) for every earning of that episode. If the invoice is paid again it is a new `paid_seq` and new earnings.
- `ProductRefund` / accepted `ProductExchange`: a **proportional** reversal of the product commission (refunded units / sold units of
  the line, half-up to 1 VND; cumulative so many partial refunds never exceed the original). Tour is never reversed by a product return
  (services are never refunded, PRD §29).
- A reversal arriving after the earning's period was closed is **not** applied to the closed run: it stays unclaimed and joins the next
  draft as a late negative item (can make a person's net negative → flagged, never silently carried, see 4.4 rule).

### 5.3 Seller correction after finalization (closes OQ-P6-25) — `P7-T6`

Allowed for `MANAGE_PAYROLL`, with a reason, only while the earning is **not in a closed run**. It appends a reversal of the old earning
and a new earning for the new seller (audited, before/after). The invoice line's `sellerUserId` is not rewritten (financial history): the
correction record is the source for commission, and reports read "seller = latest correction, else the line". After a run is closed the
correction is an adjustment item in the next run instead.

## 6. Tips (PRD §32)

- **Separate record, never part of the invoice or payment.** PayOS must match the invoice amount (`AMOUNT_MISMATCH`), tips earn no points
  and are not revenue. `tips` row: invoice, visit, employee (the KTV who served; many rows if many KTVs), amount, method (cash at the
  counter by default; transfer only when the shop records it as received), recorded by, recorded at. One row per (invoice, employee).
- A tip is recorded **after** the invoice is `PAID`, by `COLLECT_PAYMENTS` (no new permission), within a short correction window; a
  mistake is fixed by a reversal row.
- **Cash flow:** a cash tip is a fund **inflow** (`TIP_IN`) and creates a "tips owed" balance per employee; paying it out is a fund
  **outflow** (`TIP_OUT`), at closing or on the payslip (`OQ-108`). The cash expected at closing therefore stays correct.
- **Tendered/change:** the `Payment` CHECK stays as is. A tip is not "tender above the amount"; the counter screen records the tip as its
  own step. (If the Owner later wants the single-step "customer gave more" flow, that is the additive CHECK relaxation P4 reserved; not
  proposed now.)
- The employee sees their tips (PRD §32) in My Income, **separate from salary**; tips never enter payroll net.

## 7. Shop funds: sổ quỹ (PRD §35)

### 7.1 Structure

- **Funds:** one `CASH` fund per branch (the drawer/safe) and one shared `BANK` fund (PayOS and manual transfers) by default (`OQ-111`).
- **Entries** (`fund_entries`, append-only, immutable): fund, branch, business date, direction `IN`/`OUT`, **category**, positive
  amount VND, source type + id (+ leg), reason, actor, occurred at, `reverses_id`. `UNIQUE(source_type, source_id, leg)` makes posting
  idempotent. A correction is a new reversing entry, never an edit.
- **Opening balance:** entered once per fund at go-live as a **counted** amount by `MANAGE_CASH` with a fresh password; **no backfill** of
  earlier days. Cash opening float (PRD §35.1, 1,000,000đ today) is a setting, not code.
- **Link to invoices/payments/refunds:** `source_type/source_id` points at the originating `Payment`, `PaymentCorrection`, `ProductRefund`,
  etc. The book never copies the invoice; it records the money movement.

### 7.2 Every source of money (so none is missed)

| Direction | Source                                                                                                        | Fund           | Category                           |
| --------- | ------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------- |
| IN        | `Payment` CASH, `SUCCEEDED` (credited `amountVnd`, **not** tendered; change is not a movement)                | branch cash    | `SALE_CASH`                        |
| IN        | `Payment` PAYOS, `SUCCEEDED` (including a late-confirmed row)                                                 | bank           | `SALE_BANK`                        |
| OUT       | `PaymentCorrection` (cash reversal)                                                                           | branch cash    | `PAYMENT_REVERSAL`                 |
| OUT       | `ProductRefund` CASH → cash; `BANK_TRANSFER_MANUAL` → bank                                                    | by method      | `PRODUCT_REFUND`                   |
| IN/OUT    | `ProductExchange` price difference (pays more / handed back), cash or transfer                                | by method      | `EXCHANGE_DIFFERENCE`              |
| OUT       | `OnlineFailedDeliverySettlement` refund (PayOS refunds do not exist; method on row)                           | by method      | `FAILED_DELIVERY_REFUND`           |
| OUT       | Carrier fees the shop pays **outside** the system (manual entry, `OnlineReturnCost` as a link when it exists) | cash or bank   | `MANUAL_EXPENSE`                   |
| IN / OUT  | Tips received / paid out                                                                                      | cash (or bank) | `TIP_IN` / `TIP_OUT`               |
| OUT       | Salary payout, advance payout                                                                                 | cash or bank   | `SALARY_PAYOUT` / `ADVANCE`        |
| IN / OUT  | Manual thu / chi (`MANAGE_CASH`, amount + reason required, PRD §35.3)                                         | chosen fund    | `MANUAL_INCOME` / `MANUAL_EXPENSE` |
| OUT / IN  | Owner withdrawal; KTV/staff **deposit** of collected cash (staff may deposit, not withdraw, PRD §35.3)        | cash           | `OWNER_WITHDRAWAL` / `DEPOSIT`     |
| OUT + IN  | Transfer between funds (e.g. cash banked)                                                                     | both           | `FUND_TRANSFER`                    |
| IN / OUT  | Day-closing difference (counted − expected)                                                                   | cash           | `COUNT_DIFFERENCE`                 |

### 7.3 Posting — `P7-T8`

A `cash` outbox consumer posts sources 1-5 (idempotent, `UNIQUE(source)`), exactly like loyalty: a fault there never blocks a payment.
Because a consumer can lag, **closing never trusts the consumer**: its preflight reads the source tables directly (payments, corrections,
refunds, exchanges, settlements of the branch and date) and refuses to close while any source row has no entry ("n items not posted yet").
Posting starts at the go-live instant; earlier payments are not backfilled.

### 7.4 Daily cash count and closing (PRD §35.2)

`Expected cash = opening float (previous day's chosen next-day float, or the opening balance on day one) + cash IN − cash OUT of the business
date`. At closing, `MANAGE_CASH`: enter **counted cash**, see the **difference**, a **reason is required for any non-zero difference**
(`OQ-112`), record an Owner withdrawal if any, record the **next-day float** (default 1,000,000đ from settings). A `cash_day_closings` row
(`UNIQUE(fund, business_date)`) stores all of it, the closing actor and time; **a closed day is locked**: entries for that date cannot be
added or changed, and anything that arrives late (a reversal found next morning) is dated the **next open day** with its original source
reference. The difference becomes a `COUNT_DIFFERENCE` entry on the next open day so the book stays equal to the counted cash. A closed day
is never reopened; an error is an explicit correcting entry plus a note. A difference is **never auto-deducted from anyone's pay** and
raises an Owner-visible alert above a configurable amount.

### 7.5 Reconciliation

Per branch and date, a read screen compares the invoices side (`SUM` of succeeded CASH payments less reversals) with the book side
(`SALE_CASH` entries) and shows the delta, the unposted items and open differences. By construction the delta is zero; the screen exists to
prove it and to catch consumer or data faults. Bank-statement matching is not in Phase 7.

## 8. Technical decisions (all pending Owner approval)

| #      | Decision                                                                                                                                                                                                                                                                                                                | Step         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| P7-T1  | Additive `employee_salary_versions` (employee, amount, effective from, reason, actor; append-only). The existing `baseSalaryVnd` write path (`MANAGE_EMPLOYEE_PAY`) is routed through it; `baseSalaryVnd` stays as the "current" cache. Backfill: one row from the current value at the go-live date.                   | P7-8         |
| P7-T2  | Rules (salary, tour, commission) are Owner data, effective-dated, append-only versions, shipped empty; no rule = no earning + a visible "no rule" list.                                                                                                                                                                 | P7-8         |
| P7-T3  | Payroll items reference source rows by id (occurrence, earning, tip, advance). **Closing sets the run id on those rows and a database guard blocks any edit to an occurrence's pay/status, or to an earning, that is in a closed run.** Corrections are items in the next run. A payslip stores its own printed totals. | P7-12, P7-14 |
| P7-T4  | Earnings are stored rows born at `PAID` keyed by `paid_seq`; reversals are appended negative rows; the consumer is idempotent and skips pre-go-live and stale episodes. An earning belongs to the period of the invoice `business_date`; if that period is closed it joins the next draft as "late".                    | P7-9         |
| P7-T5  | Tour amount is fixed per service and effective-dated (PRD §33); no percentage service commission.                                                                                                                                                                                                                       | P7-9         |
| P7-T6  | Commission base = line **net after discount** (`InvoiceLineAllocation.netVnd`); proportional cumulative reversal on refund/exchange; seller correction as an audited reversal + new earning, forbidden once the run is closed.                                                                                          | P7-9         |
| P7-T7  | Tips are a separate `tips` record linked to invoice + visit + employee; recorded by `COLLECT_PAYMENTS` after `PAID`; never in revenue, points or payroll net; the `Payment` CHECK is not relaxed.                                                                                                                       | P7-10        |
| P7-T8  | Fund entries are written by an idempotent `cash` outbox consumer (`UNIQUE(source)`), from the go-live instant with a counted opening balance and no backfill; closing preflight reads the sources directly.                                                                                                             | P7-3         |
| P7-T9  | Closing locks the business date; late items go to the next open day; a difference is its own entry and never touches pay.                                                                                                                                                                                               | P7-5         |
| P7-T10 | Nothing is auto-paid: "paid" is a manual record that creates the fund outflow in the same transaction.                                                                                                                                                                                                                  | P7-14        |
| P7-T11 | One payroll run per calendar month for the shop; states `DRAFT → CLOSED → PAID`; preview = draft screen; no backward transition.                                                                                                                                                                                        | P7-12        |
| P7-T12 | Fresh password (same mechanism as `RefundReauthenticationUse`, generalised to a shared "re-auth use" record in P7-2) for: opening balance, owner withdrawal, closing a day, closing a run, marking paid, advance payout and write-off. All commands carry `clientRequestId` (unique per actor).                         | P7-2         |
| P7-T13 | Payroll and fund screens and APIs are branch-scoped; the shop-wide run needs all-branch scope. Pay data is classified `EMPLOYEE_PAY`, money movement `FINANCIAL`; employees see their own payslip, earnings and tips without any permission.                                                                            | all          |
| P7-T14 | Attendance and leave are shown on the preview as context only. No automatic deduction (PRD §61).                                                                                                                                                                                                                        | P7-12        |
| P7-T15 | Go-live date for the cash book and for earnings is one setting chosen by the Owner (`OQ-113`); nothing before it is posted or earned.                                                                                                                                                                                   | P7-2         |

## 9. Permissions (proposed; none seeded; no automatic role assignment; never role names)

Count: **68 today + 5 new = 73** (Owner assigns them to roles in the existing role admin).

| Code                  | New? | Allows                                                                                                             |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `VIEW_EMPLOYEE_PAY`   | no   | View other people's salary, earnings, tips, payslips (branch scope)                                                |
| `MANAGE_EMPLOYEE_PAY` | no   | Set a person's base salary (writes a salary version)                                                               |
| `COLLECT_PAYMENTS`    | no   | Also records a customer's tip at the counter and a staff cash deposit                                              |
| `MANAGE_PAY_RULES`    | yes  | Create tour and commission rule versions                                                                           |
| `MANAGE_PAYROLL`      | yes  | Generate/refresh drafts, bonuses, adjustments, deductions, seller correction, advance requests                     |
| `APPROVE_PAYROLL`     | yes  | Close a run (the Owner's approval), mark paid, approve and pay advances, write-offs (always with a fresh password) |
| `VIEW_CASH`           | yes  | Read funds, book, closings, reconciliation                                                                         |
| `MANAGE_CASH`         | yes  | Manual thu/chi, owner withdrawal, transfer, opening balance, count and close the day (PRD §35.3 exact name)        |

(Employees need no permission for their own payslip, earnings or tips.) Owner approval is therefore a permission held by the Owner's
role, **never** a check of the word "Owner".

## 10. Build steps (each one: Owner review, targeted tests, report ≤ 40 lines; each UI Step carries the UX gate and the DOM audit)

Two independently deployable waves. **Wave A (cash book) is independent of pay and useful on its own**, so it goes first.

**Wave A: shop funds**

| Step | Content                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P7-2 | DB + permissions foundation for funds, opening balances, go-live setting, shared re-auth record, `VIEW_CASH`/`MANAGE_CASH` (additive migration, guards) |
| P7-3 | `cash` consumer: payments, reversals, refunds, exchanges, settlements; idempotency + stale tests; reconciliation query                                  |
| P7-4 | Manual thu/chi, deposits, owner withdrawal, fund transfer, API + audit + re-auth                                                                        |
| P7-5 | Daily count and closing: expected, difference, reason, next-day float, lock, preflight, late-item rule                                                  |
| P7-6 | Cash screens (book, closing, reconciliation), 360/768/1440 light + dark, all states                                                                     |
| P7-7 | **Wave A milestone:** full regression, deploy guide, rollback proof, Owner test script                                                                  |

**Wave B: compensation**

| Step  | Content                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P7-8  | Pay configuration: salary versions, tour rules, commission rules, `MANAGE_PAY_RULES`, "no rule" list (API + migration)              |
| P7-9  | `compensation` consumer: tour and product-commission earnings, reversals, seller correction; race + stale tests                     |
| P7-10 | Tips: record, reverse, owed balance, payout into the cash book                                                                      |
| P7-11 | Rule and earning screens, My Income feed (`FUTURE_SOURCES` fed one by one, "not available" before go-live)                          |
| P7-12 | Payroll run: draft, preview, items (bonus, adjustment, deduction), CTV references, late items, warnings                             |
| P7-13 | Salary advances: request, approve, pay (fund outflow), recovery items, write-off                                                    |
| P7-14 | Close + guards (P7-T3), mark paid + fund outflow, payslips, reversal of a mistaken paid mark                                        |
| P7-15 | Payroll screens and payslip print, all states, UX gate                                                                              |
| P7-16 | **Phase 7 milestone:** full regression (`pnpm check`, integration, smoke), deploy guide, rollback proof, Owner test script, handoff |

Wave B is deployed after the Owner has run Wave A for at least one closing cycle (recommended, not forced).

## 11. Risks

| Risk                                                    | Mitigation                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A source of money is missed in the book                 | Table 7.2 is the checklist; closing preflight reads sources directly; reconciliation screen; a test per source                 |
| Consumer lag or fault leaves the book behind            | Idempotent consumers, preflight blocks closing, "not posted" counter on the screen, retry visible                              |
| Double posting / double earning                         | `UNIQUE(source)` and `UNIQUE(kind, line, paid_seq, leg)`; race tests on a separate connection                                  |
| Payroll closed, then a refund or correction arrives     | Late items join the next draft; guards block edits to rows in a closed run                                                     |
| Wrong amounts typed (tour, rate, salary)                | Effective-dated versions, no overwrite, preview warnings, audit before/after, only `MANAGE_PAY_RULES` / `MANAGE_EMPLOYEE_PAY`  |
| Money paid twice or "paid" recorded without cash moving | Nothing auto-paid; mark-paid writes the fund outflow in the same transaction; fresh password; unique per (payslip)             |
| Negative net pay (late reversals, advances)             | Advance recovery capped at net; negative net is flagged on the draft and carried visibly, never hidden                         |
| Privacy: salary data seen by the wrong people           | `VIEW_EMPLOYEE_PAY` + branch scope, classification `EMPLOYEE_PAY`, own-data-only endpoints for staff, audit on reads of others |
| Cash difference blamed on a person                      | Differences are branch-level book entries; never a pay deduction; reason mandatory                                             |
| Online sales and cash tips have no seller/owner         | Explicit defaults (`OQ-106`, `OQ-108`); nothing is invented                                                                    |
| Go-live in the middle of a month                        | `OQ-113` default: first of a month, so the first run is clean                                                                  |
| Scope creep into tax/BHXH or auto-payments              | Listed as non-goals; PRD §61 forbids guessing                                                                                  |
| Data in production is real from day one                 | Wave A and B each deploy with rehearsal on a scratch copy, rollback proof, no backfill                                         |

## 12. Owner questionnaire (Vietnamese; each has a recommended default; answer "ok" to accept all)

Trả lời **"ok"** để đồng ý với mọi mục "Tôi khuyên", hoặc ghi "khác: …" cho mục nào muốn đổi. Đây là cách hiểu của tôi, chưa được
duyệt; chỉ lời của Chủ mới là duyệt. Xếp theo mức ảnh hưởng đến tiền thật.

| #      | Câu hỏi                                                                               | Tôi khuyên (mặc định)                                                                                                                                                                            | Chặn bước |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| OQ-104 | Khách dùng **buổi đã trả tiền trong gói combo** thì KTV có được tiền tour không?      | **Có**, như một dịch vụ thường (khách đã trả khi mua gói). Buổi **tặng** thì không (PRD §17.6).                                                                                                  | P7-9      |
| OQ-105 | Hoa hồng bán sản phẩm tính trên số tiền nào, và khi khách trả hàng/hoàn tiền thì sao? | Tính trên **giá sau giảm** của dòng hàng (không tính phí giao). Hoàn/đổi hàng thì **trừ lại hoa hồng theo tỷ lệ** số lượng trả.                                                                  | P7-9      |
| OQ-106 | Đơn **bán online** (không có người bán) có hoa hồng không?                            | **Không** có hoa hồng; sau này muốn thì Chủ chỉ định người.                                                                                                                                      | P7-9      |
| OQ-107 | Ai được tiền tour và hoa hồng?                                                        | Chỉ **nhân viên chính thức**. CTV đã có tiền công thỏa thuận, học việc không có. **Tip** thì thuộc người làm dịch vụ cho khách, dù là loại nào.                                                  | P7-8      |
| OQ-108 | **Tip** khách đưa: ghi nhận và trả cho KTV thế nào?                                   | Thu ngân ghi tip tiền mặt riêng (không tính vào doanh thu, không cộng điểm). **Trả tiền mặt cho KTV khi chốt quỹ cuối ngày**; phiếu lương chỉ hiện tổng tip để tham khảo.                        | P7-10     |
| OQ-109 | Người vào làm / nghỉ **giữa tháng** tính lương thế nào?                               | Hệ thống **không tự tính theo ngày**. Lương cơ bản tính đủ cho người đang là nhân viên chính thức vào ngày cuối tháng; muốn cắt giảm thì quản lý nhập **điều chỉnh** kèm lý do.                  | P7-12     |
| OQ-110 | **Tạm ứng lương**: giới hạn và cách thu hồi?                                          | Chỉ nhân viên chính thức; tối đa **50% lương cơ bản tháng**; mỗi người **một khoản đang mở**; Chủ duyệt từng khoản; **trừ hết vào kỳ lương kế tiếp** (không để lương âm, phần dư chuyển kỳ sau). | P7-13     |
| OQ-111 | Quỹ chia thế nào?                                                                     | **Mỗi chi nhánh một quỹ tiền mặt** + **một quỹ ngân hàng chung** (PayOS và chuyển khoản). Quỹ tiền mặt đầu ngày mặc định 1.000.000đ (chỉnh được trong cài đặt).                                  | P7-2      |
| OQ-112 | Cuối ngày **đếm tiền lệch** so với sổ thì sao?                                        | Cho chốt ngày nhưng **bắt buộc nhập lý do**; chênh lệch ghi thành một dòng riêng; **không bao giờ tự trừ vào lương**; báo Chủ khi lệch từ **50.000đ** trở lên (chỉnh được).                      | P7-5      |
| OQ-113 | **Bắt đầu** dùng sổ quỹ và lương từ khi nào?                                          | Từ **ngày 1 của một tháng** Chủ chọn: Chủ đếm tiền thật lập số dư đầu kỳ; **không nhập bù** ngày cũ; kỳ lương đầu là tháng trọn vẹn đầu tiên.                                                    | P7-2      |

Quyết định kỹ thuật đã gộp vào `P7-T1…T15` (chờ Chủ duyệt cùng đợt, không hỏi riêng): lịch sử lương, tham chiếu bất biến khi chốt kỳ, thu
tiền tip riêng khỏi hóa đơn, quỹ ghi qua tiến trình nền, chốt ngày khóa, sửa người bán trước khi chốt kỳ, mật khẩu xác nhận cho thao tác tiền.

## 13. Verification of this document

Read in the repository for this design: `CLAUDE.md`, `LUCYSPA_HANDOFF.md` (status, Production, Phase 9 deploy lines), `LUCY_SPA_PRD.md` sections
9.1, 17.6, 25, 26, 32-36, 49, 61, 62 (scenarios E, L) and the Phase 7 deliverables; `schema.prisma` models `EmployeeProfile`,
`EmploymentClassificationChange`, `AttendanceRecord`, `LeaveRequest`, `CollaboratorWorkOccurrence`, `VisitServiceLine`,
`ServiceExecution`, `Invoice`, `InvoiceLine`, `InvoiceLineService`, `InvoiceLineProduct`, `InvoiceLineAllocation`, `Payment`,
`PaymentCorrection`, `ProductRefund`, `ProductExchange`, `OnlineFailedDeliverySettlement`, `RefundReauthenticationUse`, `AuditEvent`,
`PermissionCode`; `apps/api/src/account/my-income.service.ts`; `apps/api/src/employees/employment.ts`; the P4 Q5/OP-6 and P6-T5/OQ-P6-25/W4-2
decisions. Names of the payment/refund outbox events and the exact shape of the re-auth record are confirmed by reading code at the start
of P7-2/P7-3, not assumed here. No code, migration or permission was created; no PRD section was changed.

## 14. Owner answers (2026-10-11) and what they change

Recorded as given. Numbers 1-10 are `OQ-104`…`OQ-113` in order. **Status of sections 8, 9, 12: APPROVED by the Owner** except where this
section changes them.

**Owner (English, as sent):**

> 1, 2, 4, 6, 7, 8, 9: OK as proposed.
>
> 3: Online sales earn commission only when the customer enters a staff member's referral code at checkout; that staff member gets the
> commission (same base and refund rules as answer 2; official employees only per answer 4). Each eligible staff member gets a unique,
> stable referral code the Owner can view/reset; invalid or inactive codes are rejected at checkout with a clear message; the code is
> stored on the order and cannot be changed after payment.
>
> 5: Tips are paid out on the payroll payment day, which the Owner chooses for each payroll run. Tips appear as a separate line on the
> payslip and stay outside revenue, loyalty points and commission base.
>
> 10: Go-live date for the cash book and payroll will be chosen later by the Owner: make it a setting (no default date), with the counted
> opening balance entered on that day; nothing posts before it.
>
> Technical decisions P7-T1..T15 and the 5 new permissions (68 → 73, granted to nobody): approved as written, except anything that would
> pay money or change an amount without the Owner's explicit click — for those, choose the safer option and note it.

**Tóm tắt tiếng Việt (nguyên ý của Chủ):** các câu 1, 2, 4, 6, 7, 8, 9 đồng ý như đề xuất. Câu 3: đơn online chỉ có hoa hồng khi khách nhập
**mã giới thiệu của nhân viên** lúc thanh toán; nhân viên đó nhận hoa hồng (cùng cách tính và hoàn tiền như câu 2; chỉ nhân viên chính thức);
mỗi nhân viên đủ điều kiện có **một mã duy nhất, ổn định**, Chủ xem và đặt lại được; mã sai hoặc đã tắt bị từ chối với thông báo rõ; mã lưu
trên đơn và **không đổi được sau khi đã thanh toán**. Câu 5: **tip trả vào ngày trả lương**, Chủ chọn ngày cho từng kỳ lương; tip là một dòng
riêng trên phiếu lương, nằm ngoài doanh thu, điểm thưởng và nền tính hoa hồng. Câu 10: **ngày bắt đầu** sổ quỹ và lương do Chủ chọn sau, là
một **cài đặt không có ngày mặc định**; số dư đầu kỳ đếm thật nhập đúng ngày đó; trước ngày đó không ghi gì. Quyết định kỹ thuật P7-T1…T15 và
5 quyền mới (68 → 73, chưa gán cho ai): duyệt như viết, **trừ** việc nào trả tiền hoặc đổi số tiền mà Chủ chưa bấm xác nhận: chọn phương án an
toàn hơn và ghi chú.

**Changes to the design (these replace the earlier text where they differ):**

- **OQ-106 → staff referral code (new `P7-T16`).** `employee_referral_codes` (employee, code, active, created/reset history; append-only
  resets, one active code per employee, globally unique, case-insensitive, no ambiguous characters). Only people who are OFFICIAL_EMPLOYEE
  on the day get one (created by the Owner's click, never automatically: it is shown in the staff list and the Owner can view or reset it
  with `MANAGE_PAY_RULES`; a reset keeps the old code as inactive history). The online checkout gets an optional field; an unknown, inactive
  or ineligible code is **rejected with a clear message** (the customer can clear it and continue). The code is stored on the order and
  **frozen once the order is paid** (a database guard rejects any change). Commission on an online line uses the same base and refund
  rules as the counter (`P7-T6`). A counter line keeps its `sellerUserId`; an online line without a code earns nothing; nobody is invented.
- **OQ-108 → tips paid with payroll (replaces 6 "cash flow" and 4.1/OQ-108 default).** A tip stays a fund `TIP_IN` when received (cash at
  the counter) and an owed balance per person. It is **not** paid out at the daily closing. The payroll run has a **payment day chosen by
  the Owner for that run** (a date on the run, set before closing); the owed tips of the period are shown as a **separate payslip line**
  and paid out (`TIP_OUT`) when the payslip is marked paid. Tips remain outside revenue, loyalty points and the commission base.
  The tip total is not part of net pay; the payslip shows "Net pay" and "Tips" as two separate amounts and the mark-paid action pays both
  (two fund entries) only on the explicit click.
- **OQ-113 → go-live is a setting, no default (replaces `P7-T15` default).** `cash_go_live_at` (instant) in settings, **empty until the
  Owner sets it**. While empty the cash book, the `cash` and `compensation` consumers and payroll do nothing (they record "skipped,
  not live"). Setting it needs `MANAGE_CASH` + fresh password and requires the counted opening balance of every fund in the same
  action; it can be set once, cannot be moved earlier, and nothing before it is ever posted or earned. First payroll period is chosen by
  the Owner (no assumption about the 1st of the month).
- **"Safer option" rule (Owner's exception to T1-T15).** Anything that would pay money or change an amount needs the Owner's explicit
  click: the draft never closes itself; suggested advance recoveries and late items are only **suggestions in the draft** until the
  Owner closes the run; `PAID` is a manual mark and never moves money outside the system; a salary-version backfill is **not
  created automatically** (the Owner enters the first salary version; until then the current `baseSalaryVnd` is shown as "chưa xác nhận" and the
  draft marks the base as unconfirmed); no referral code is created without the Owner's click; reversals of earnings are automatic records
  (they follow a payment reversal or refund that a person already clicked), but they only change a **draft** until the Owner closes it.
- New permission count unchanged: **68 + 5 = 73**, granted to nobody (no role is changed by any migration).
- Build steps: the staff referral code and its checkout field become **P7-10b** in Wave B, between tips and the rule screens.
